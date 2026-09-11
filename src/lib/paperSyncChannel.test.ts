import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the Paper channel's policy layer (#52): the coalesced emit, the `applyingRemote` echo guard,
 * and the `canEmit` authority gate — driving the *real* paperStore with the LAN seam mocked, and using
 * the test-only flush to bypass the debounce timer deterministically.
 */

// Hoisted so the vi.mock factories can close over this shared, mutable state without a TDZ error.
const h = vi.hoisted(() => ({
  androidAvailable: { value: false },
  served: { value: false },
  notify: vi.fn<(channel: string, change: unknown) => void>(),
}));

vi.mock('./androidLanServer', () => ({
  isAndroidLanServerAvailable: () => h.androidAvailable.value,
  notifyLanProjectChange: (channel: string, change: unknown) => h.notify(channel, change),
}));
vi.mock('./remoteHostClient', () => ({
  isServedLanSession: () => h.served.value,
}));
vi.mock('./projectSyncClient', () => ({
  ensureProjectSyncChannelStarted: vi.fn(async () => undefined),
}));

import { usePaperStore } from '../store/paperStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { clearProjectSyncChannels, getProjectSyncChannel } from './projectSyncService';
import {
  PAPER_SYNC_CHANNEL,
  __flushPaperSyncEmitForTests,
  __resetPaperSyncChannelForTests,
  __setPaperSyncDepsForTests,
  initializePaperSyncChannel,
} from './paperSyncChannel';
import type { PaperDocumentNativeChange } from './paperDocumentNativeSync';

let pageId = '';
let frameId = '';

beforeEach(() => {
  h.androidAvailable.value = false;
  h.served.value = false;
  h.notify.mockReset();
  clearProjectSyncChannels();
  __resetPaperSyncChannelForTests();
  __setPaperSyncDepsForTests({ prepareAssets: async () => true });

  let document = createDefaultPaperDocument();
  pageId = document.pages[0].id;
  const result = addFrameToPaperPage(document, pageId, { kind: 'text', xMm: 0, yMm: 0, widthMm: 40, heightMm: 30 });
  document = result.document;
  frameId = result.frameId;
  usePaperStore.setState({
    documents: [{
      id: document.id,
      document,
      selectedPageId: pageId,
      selectedFrameId: frameId,
      selectedFrameIds: [frameId],
      tool: 'select',
      zoom: 0.8,
    }],
    documentInstanceIds: { [document.id]: `instance-${document.id}` },
    activeDocumentId: document.id,
    document,
    selectedPageId: pageId,
    selectedFrameId: frameId,
    selectedFrameIds: [frameId],
    undoStack: [],
    redoStack: [],
    documentHistories: {},
    tool: 'select',
    zoom: 0.8,
  });
});

const lastEmit = () => h.notify.mock.calls.at(-1) as [string, PaperDocumentNativeChange] | undefined;

describe('paperSyncChannel', () => {
  it('seeds the ordered Paper tab catalog and exact active tab instead of a bare document', async () => {
    h.androidAvailable.value = true;
    const first = createDefaultPaperDocument({ title: 'First tab' });
    const second = createDefaultPaperDocument({ title: 'Second tab' });
    usePaperStore.setState({
      documents: [
        { id: 'first-tab', document: first, selectedPageId: first.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.75 },
        { id: 'second-tab', document: second, selectedPageId: second.pages[0].id, selectedFrameIds: [], tool: 'hand', zoom: 1.25 },
      ],
      activeDocumentId: 'second-tab',
      document: second,
      selectedPageId: second.pages[0].id,
      selectedFrameId: null,
      selectedFrameIds: [],
      tool: 'hand',
      zoom: 1.25,
    });
    initializePaperSyncChannel();

    const snapshot = await getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.snapshot() as unknown as {
      type?: string;
      schemaVersion?: number;
      workspace?: { activeDocumentId?: string; documents?: Array<{ id?: string }> };
    };

    expect(snapshot.type).toBe('paper-document-snapshot');
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.workspace?.activeDocumentId).toBe('second-tab');
    expect(snapshot.workspace?.documents?.map((document) => document.id)).toEqual(['first-tab', 'second-tab']);
  });

  it('the phone authority emits a workspace envelope after a local edit', async () => {
    h.androidAvailable.value = true;
    initializePaperSyncChannel();

    usePaperStore.getState().updateFrame(pageId, frameId, { xMm: 50 });
    await __flushPaperSyncEmitForTests();

    expect(h.notify).toHaveBeenCalled();
    const emit = lastEmit()!;
    expect(emit[0]).toBe(PAPER_SYNC_CHANNEL);
    expect(emit[1].type).toBe('paper-document-snapshot');
    expect(emit[1]).toMatchObject({ schemaVersion: 1 });
  });

  it('does not re-broadcast a remote op it applies (echo guard)', async () => {
    h.androidAvailable.value = true;
    initializePaperSyncChannel();
    h.notify.mockReset();

    const channel = getProjectSyncChannel(PAPER_SYNC_CHANNEL)!;
    await channel.applyRemote({ type: 'paper-frame-moved', pageId, frameId, xMm: 99, yMm: 99 } as PaperDocumentNativeChange);
    await __flushPaperSyncEmitForTests();

    expect(h.notify).not.toHaveBeenCalled();
  });

  it('a served client stays mute until its first remote apply, then emits', async () => {
    h.served.value = true; // served client, not the authority
    initializePaperSyncChannel();

    // A local edit before any seed must NOT push the client's stale document at the phone.
    usePaperStore.getState().updateFrame(pageId, frameId, { xMm: 5 });
    await __flushPaperSyncEmitForTests();
    expect(h.notify).not.toHaveBeenCalled();

    // Applying a remote op (the seed) earns the right to emit.
    const channel = getProjectSyncChannel(PAPER_SYNC_CHANNEL)!;
    await channel.applyRemote({ type: 'paper-frame-moved', pageId, frameId, xMm: 8, yMm: 8 } as PaperDocumentNativeChange);
    h.notify.mockReset();

    usePaperStore.getState().updateFrame(pageId, frameId, { xMm: 20 });
    await __flushPaperSyncEmitForTests();
    expect(h.notify).toHaveBeenCalled();
  });

  it('is inert when no sync session is active', async () => {
    // Neither authority nor served — initialize, edit, flush: nothing should be pushed.
    initializePaperSyncChannel();
    usePaperStore.getState().updateFrame(pageId, frameId, { xMm: 5 });
    await __flushPaperSyncEmitForTests();
    expect(h.notify).not.toHaveBeenCalled();
  });
});
