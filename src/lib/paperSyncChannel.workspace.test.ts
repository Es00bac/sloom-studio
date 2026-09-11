import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  androidAvailable: { value: false },
  served: { value: false },
  notify: vi.fn<(channel: string, change: unknown) => Promise<boolean>>(async () => true),
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
import { MemoryPaperAssetRepository, type PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import {
  createBinaryAssetRecord,
  type BinaryAssetId,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type { PaperDocument, PaperManagedFontFace, PaperManagedIccProfile, PaperWorkspaceDocumentSnapshot } from '../types/paper';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperFrame } from './paperDocument';
import { clearProjectSyncChannels, getProjectSyncChannel } from './projectSyncService';
import {
  PAPER_SYNC_CHANNEL,
  __flushPaperSyncEmitForTests,
  __resetPaperSyncChannelForTests,
  __setPaperSyncDepsForTests,
  initializePaperSyncChannel,
} from './paperSyncChannel';
import {
  createPaperWorkspaceSnapshotChange,
  type PaperDocumentNativeChange,
  type PaperWorkspaceSnapshotChange,
} from './paperDocumentNativeSync';

interface ManagedWorkspaceFixture {
  documents: PaperWorkspaceDocumentSnapshot[];
  records: BinaryAssetRecord[];
}

async function managedWorkspaceFixture(): Promise<ManagedWorkspaceFixture> {
  const art = await createBinaryAssetRecord(new Uint8Array([1, 2, 3, 4]), { mimeType: 'image/png', fileName: 'art.png' });
  const font = await createBinaryAssetRecord(new Uint8Array([5, 6, 7, 8]), { mimeType: 'font/ttf', fileName: 'studio.ttf' });
  const license = await createBinaryAssetRecord(new TextEncoder().encode('Studio font license'), { mimeType: 'text/plain', fileName: 'LICENSE.txt' });
  const icc = await createBinaryAssetRecord(new Uint8Array([9, 10, 11, 12]), { mimeType: 'application/vnd.iccprofile', fileName: 'press.icc' });

  let artDocument = createDefaultPaperDocument({ title: 'Managed art tab' });
  artDocument = addFrameToPaperPage(artDocument, artDocument.pages[0].id, {
    kind: 'image',
    xMm: 10,
    yMm: 10,
    widthMm: 80,
    heightMm: 60,
    asset: { label: 'Managed art', kind: 'image', locator: { kind: 'managed', ref: art.ref } },
  }).document;

  const managedFace: PaperManagedFontFace = {
    id: 'studio-face',
    familyId: 'studio',
    familyName: 'Studio Face',
    postscriptName: 'StudioFace-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x20, end: 0x7e }],
    format: 'truetype',
    fontAsset: font.ref,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: { id: 'Studio-License', textAsset: license.ref },
  };
  const profile: PaperManagedIccProfile = {
    id: icc.ref.id,
    asset: icc.ref,
    description: 'Studio press profile',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'STUDIO-PRESS',
    source: { kind: 'user-import' },
  };
  const productionDocument: PaperDocument = {
    ...createDefaultPaperDocument({ title: 'Managed type and color tab' }),
    importedFonts: [managedFace],
    managedIccProfiles: [profile],
  };

  return {
    records: [art, font, license, icc],
    documents: [
      { id: 'art-tab', document: artDocument, assetIds: [art.ref.id], selectedPageId: artDocument.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 },
      { id: 'production-tab', document: productionDocument, assetIds: [font.ref.id, license.ref.id, icc.ref.id].sort(), selectedPageId: productionDocument.pages[0].id, selectedFrameIds: [], tool: 'hand', zoom: 1.2 },
    ],
  };
}

class FailingPutRepository implements PaperAssetRepository {
  private readonly delegate = new MemoryPaperAssetRepository();
  private putCount = 0;
  private readonly failAt: number;

  constructor(failAt: number) {
    this.failAt = failAt;
  }

  seed(record: BinaryAssetRecord): Promise<BinaryAssetRef> {
    return this.delegate.put(record);
  }

  async put(record: BinaryAssetRecord): Promise<BinaryAssetRef> {
    this.putCount += 1;
    if (this.putCount === this.failAt) throw new Error('injected repository failure');
    return this.delegate.put(record);
  }

  get(id: BinaryAssetId): Promise<BinaryAssetRecord | undefined> { return this.delegate.get(id); }
  has(id: BinaryAssetId): Promise<boolean> { return this.delegate.has(id); }
  delete(id: BinaryAssetId): Promise<void> { return this.delegate.delete(id); }
  listRefs(): Promise<BinaryAssetRef[]> { return this.delegate.listRefs(); }
}

function installWorkspace(documents: PaperWorkspaceDocumentSnapshot[], activeDocumentId: string): void {
  const active = documents.find((candidate) => candidate.id === activeDocumentId)!;
  usePaperStore.setState({
    documents,
    documentInstanceIds: Object.fromEntries(documents.map((candidate) => [candidate.id, `instance-${candidate.id}`])),
    activeDocumentId,
    document: active.document,
    selectedPageId: active.selectedPageId ?? active.document.pages[0].id,
    selectedFrameId: active.selectedFrameId ?? null,
    selectedFrameIds: active.selectedFrameIds ?? [],
    tool: active.tool,
    zoom: active.zoom,
    undoStack: [],
    redoStack: [],
    documentHistories: {},
  });
}

async function buildTransmittedWorkspace(): Promise<{
  change: PaperWorkspaceSnapshotChange;
  payloads: Map<string, string>;
  fixture: ManagedWorkspaceFixture;
}> {
  const fixture = await managedWorkspaceFixture();
  const sender = new MemoryPaperAssetRepository();
  for (const record of fixture.records) await sender.put(record);
  const payloads = new Map<string, string>();
  h.androidAvailable.value = true;
  h.served.value = false;
  installWorkspace(fixture.documents, 'production-tab');
  __setPaperSyncDepsForTests({
    repository: sender,
    putAsset: async (_channel, assetId, value) => {
      payloads.set(assetId, value);
      return true;
    },
  });
  initializePaperSyncChannel();
  const change = await getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.snapshot() as PaperWorkspaceSnapshotChange;
  return { change, payloads, fixture };
}

beforeEach(() => {
  h.androidAvailable.value = false;
  h.served.value = false;
  h.notify.mockReset();
  clearProjectSyncChannels();
  __resetPaperSyncChannelForTests();
});

describe('Paper workspace sync envelope', () => {
  it('round-trips two tabs plus managed art, custom font, and ICC bytes into a clean receiver', async () => {
    const { change, payloads, fixture } = await buildTransmittedWorkspace();
    expect(change.schemaVersion).toBe(1);
    expect(change.workspace.documents.map((candidate) => candidate.id)).toEqual(['art-tab', 'production-tab']);
    expect(change.workspace.activeDocumentId).toBe('production-tab');
    expect(change.workspace.assetRefs.map((ref) => ref.id)).toEqual(fixture.records.map((record) => record.ref.id).sort());
    expect(payloads.size).toBe(4);

    __resetPaperSyncChannelForTests();
    clearProjectSyncChannels();
    h.androidAvailable.value = false;
    h.served.value = true;
    const receiver = new MemoryPaperAssetRepository();
    const blank = createDefaultPaperDocument({ title: 'Clean receiver' });
    installWorkspace([{ id: 'blank-tab', document: blank, selectedPageId: blank.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'blank-tab');
    usePaperStore.getState().markDocumentSaved('blank-tab', { kind: 'project' });
    __setPaperSyncDepsForTests({
      repository: receiver,
      getAsset: async (_channel, assetId) => payloads.get(assetId) ?? null,
    });
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(change)).resolves.toBe(true);
    const state = usePaperStore.getState();
    expect(state.documents.map((candidate) => [candidate.id, candidate.document.title])).toEqual([
      ['art-tab', 'Managed art tab'],
      ['production-tab', 'Managed type and color tab'],
    ]);
    expect(state.activeDocumentId).toBe('production-tab');
    expect(state.document.title).toBe('Managed type and color tab');
    for (const record of fixture.records) {
      expect(await receiver.get(record.ref.id)).toEqual(record);
    }
  });

  it.each(['missing', 'corrupt'] as const)('defers the entire workspace when a managed asset is %s', async (failure) => {
    const { change, payloads } = await buildTransmittedWorkspace();
    __resetPaperSyncChannelForTests();
    clearProjectSyncChannels();
    h.androidAvailable.value = false;
    h.served.value = true;
    const receiver = new MemoryPaperAssetRepository();
    const blank = createDefaultPaperDocument({ title: 'Must remain' });
    installWorkspace([{ id: 'blank-tab', document: blank, selectedPageId: blank.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'blank-tab');
    const failedId = change.workspace.assetRefs[1].id;
    __setPaperSyncDepsForTests({
      repository: receiver,
      getAsset: async (_channel, assetId) => {
        if (assetId !== failedId) return payloads.get(assetId) ?? null;
        return failure === 'missing' ? null : 'data:application/octet-stream;base64,AAAA';
      },
    });
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(change)).rejects.toThrow(/managed asset/);
    expect(usePaperStore.getState().activeDocumentId).toBe('blank-tab');
    expect(usePaperStore.getState().document.title).toBe('Must remain');
    expect(await receiver.listRefs()).toEqual([]);
  });

  it('rejects an unsupported workspace schema without falling through to legacy document replacement', async () => {
    const { change } = await buildTransmittedWorkspace();
    const unsupported = { ...change, schemaVersion: 99 } as unknown as PaperDocumentNativeChange;
    __resetPaperSyncChannelForTests();
    clearProjectSyncChannels();
    h.served.value = true;
    const receiver = new MemoryPaperAssetRepository();
    const blank = createDefaultPaperDocument({ title: 'Unsupported schema baseline' });
    installWorkspace([{ id: 'blank-tab', document: blank, selectedPageId: blank.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'blank-tab');
    __setPaperSyncDepsForTests({ repository: receiver, getAsset: async () => null });
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(unsupported)).resolves.toBe(false);
    expect(usePaperStore.getState().activeDocumentId).toBe('blank-tab');
    expect(usePaperStore.getState().document.title).toBe('Unsupported schema baseline');
    expect(await receiver.listRefs()).toEqual([]);
  });

  it('rolls back every earlier repository write after a later write fails and preserves baseline records', async () => {
    const { change, payloads, fixture } = await buildTransmittedWorkspace();
    __resetPaperSyncChannelForTests();
    clearProjectSyncChannels();
    h.served.value = true;
    const receiver = new FailingPutRepository(2);
    const preExistingManaged = fixture.records[0];
    const unrelated = await createBinaryAssetRecord(new Uint8Array([42]), { mimeType: 'image/png', fileName: 'keep.png' });
    await receiver.seed(preExistingManaged);
    await receiver.seed(unrelated);
    const baselineRefs = (await receiver.listRefs()).sort((left, right) => left.id.localeCompare(right.id));
    const blank = createDefaultPaperDocument({ title: 'Atomic receiver baseline' });
    installWorkspace([{ id: 'blank-tab', document: blank, selectedPageId: blank.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'blank-tab');
    __setPaperSyncDepsForTests({
      repository: receiver,
      getAsset: async (_channel, assetId) => payloads.get(assetId) ?? null,
    });
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(change)).rejects.toThrow(/repository commit failed/);
    expect(usePaperStore.getState().activeDocumentId).toBe('blank-tab');
    expect(usePaperStore.getState().document.title).toBe('Atomic receiver baseline');
    expect((await receiver.listRefs()).sort((left, right) => left.id.localeCompare(right.id))).toEqual(baselineRefs);
    expect(await receiver.get(preExistingManaged.ref.id)).toEqual(preExistingManaged);
    expect(await receiver.get(unrelated.ref.id)).toEqual(unrelated);
  });

  it('rejects a correctly hashed font record assigned to an image-frame role before any publication', async () => {
    const { change, payloads } = await buildTransmittedWorkspace();
    const substituted = structuredClone(change);
    const fontRef = substituted.workspace.documents[1].document.importedFonts![0].fontAsset;
    const artFrame = substituted.workspace.documents[0].document.pages[0].frames.find((frame) => frame.kind === 'image')!;
    const originalLocator = artFrame.asset!.locator;
    if (originalLocator?.kind !== 'managed') throw new Error('Expected a managed image fixture.');
    artFrame.asset!.locator = { kind: 'managed', ref: fontRef };
    substituted.workspace.documents[0].assetIds = [fontRef.id];
    substituted.workspace.assetRefs = substituted.workspace.assetRefs
      .filter((ref) => ref.id !== originalLocator.ref.id);
    substituted.assetIds = substituted.workspace.assetRefs.map((ref) => ref.id);

    __resetPaperSyncChannelForTests();
    clearProjectSyncChannels();
    h.served.value = true;
    const receiver = new MemoryPaperAssetRepository();
    const blank = createDefaultPaperDocument({ title: 'Role baseline' });
    installWorkspace([{ id: 'blank-tab', document: blank, selectedPageId: blank.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'blank-tab');
    __setPaperSyncDepsForTests({
      repository: receiver,
      getAsset: async (_channel, assetId) => payloads.get(assetId) ?? null,
    });
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(substituted)).resolves.toBe(false);
    expect(usePaperStore.getState().activeDocumentId).toBe('blank-tab');
    expect(usePaperStore.getState().document.title).toBe('Role baseline');
    expect(await receiver.listRefs()).toEqual([]);
  });

  it('publishes every verified asset before the envelope event', async () => {
    const fixture = await managedWorkspaceFixture();
    const sender = new MemoryPaperAssetRepository();
    for (const record of fixture.records) await sender.put(record);
    const events: string[] = [];
    h.androidAvailable.value = true;
    installWorkspace(fixture.documents, 'production-tab');
    __setPaperSyncDepsForTests({
      repository: sender,
      putAsset: async (_channel, assetId) => {
        events.push(`asset:${assetId}`);
        return true;
      },
    });
    h.notify.mockImplementation(async () => {
      events.push('envelope');
      return true;
    });
    initializePaperSyncChannel();
    usePaperStore.setState((state) => ({
      document: { ...state.document, title: 'Changed after pairing', updatedAt: Date.now() },
    }));
    await __flushPaperSyncEmitForTests();

    expect(events.at(-1)).toBe('envelope');
    expect(events.slice(0, -1)).toHaveLength(4);
    expect(events.slice(0, -1).every((event) => event.startsWith('asset:sha256:'))).toBe(true);
  });

  it('does not publish workspace metadata when the sender repository lacks a reachable record', async () => {
    const fixture = await managedWorkspaceFixture();
    const sender = new MemoryPaperAssetRepository();
    await sender.put(fixture.records[0]);
    await sender.put(fixture.records[1]);
    h.androidAvailable.value = true;
    installWorkspace(fixture.documents, 'production-tab');
    __setPaperSyncDepsForTests({ repository: sender, putAsset: async () => true });
    initializePaperSyncChannel();
    usePaperStore.setState((state) => ({
      document: { ...state.document, title: 'Cannot publish', updatedAt: Date.now() },
    }));

    await __flushPaperSyncEmitForTests();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('serializes concurrent inbound envelopes so delayed older work cannot overwrite the newer arrival', async () => {
    const { change, payloads } = await buildTransmittedWorkspace();
    const newer: PaperWorkspaceSnapshotChange = structuredClone(change);
    newer.workspace.documents[1].document.title = 'Newest title';
    newer.document = newer.workspace.documents[1].document;

    __resetPaperSyncChannelForTests();
    clearProjectSyncChannels();
    h.androidAvailable.value = false;
    h.served.value = true;
    const receiver = new MemoryPaperAssetRepository();
    const blank = createDefaultPaperDocument({ title: 'Clean receiver' });
    installWorkspace([{ id: 'blank-tab', document: blank, selectedPageId: blank.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'blank-tab');
    usePaperStore.getState().markDocumentSaved('blank-tab', { kind: 'project' });
    let releaseFirst!: (value: string | null) => void;
    const firstFetch = new Promise<string | null>((resolve) => { releaseFirst = resolve; });
    let fetchCount = 0;
    __setPaperSyncDepsForTests({
      repository: receiver,
      getAsset: async (_channel, assetId) => {
        fetchCount += 1;
        if (fetchCount === 1) return firstFetch;
        return payloads.get(assetId) ?? null;
      },
    });
    initializePaperSyncChannel();
    const channel = getProjectSyncChannel(PAPER_SYNC_CHANNEL)!;
    const olderApply = channel.applyRemote(change);
    const newerApply = channel.applyRemote(newer);
    await vi.waitFor(() => expect(fetchCount).toBe(1));
    releaseFirst(payloads.get(change.workspace.assetRefs[0].id) ?? null);
    await Promise.all([olderApply, newerApply]);

    expect(usePaperStore.getState().document.title).toBe('Newest title');
    expect(usePaperStore.getState().activeDocumentId).toBe('production-tab');
  });

  it('rebases a pending local frame edit over an unrelated remote frame edit and republishes the merge', async () => {
    let baselineDocument = createDefaultPaperDocument({ title: 'Simultaneous page' });
    baselineDocument = addFrameToPaperPage(baselineDocument, baselineDocument.pages[0].id, {
      id: 'local-frame', kind: 'text', text: 'local baseline', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
    }).document;
    baselineDocument = addFrameToPaperPage(baselineDocument, baselineDocument.pages[0].id, {
      id: 'remote-frame', kind: 'text', text: 'remote baseline', xMm: 60, yMm: 10, widthMm: 40, heightMm: 20,
    }).document;
    const baselineDocuments: PaperWorkspaceDocumentSnapshot[] = [{
      id: 'shared-tab', document: baselineDocument, selectedPageId: baselineDocument.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    }];
    h.androidAvailable.value = true;
    installWorkspace(baselineDocuments, 'shared-tab');
    initializePaperSyncChannel();

    usePaperStore.setState((state) => ({
      document: updatePaperFrame(
        state.document,
        state.document.pages[0].id,
        'local-frame',
        { text: 'phone pending' },
      ),
    }));
    const remoteDocument = updatePaperFrame(
      baselineDocument,
      baselineDocument.pages[0].id,
      'remote-frame',
      { text: 'desktop applied' },
    );
    const remote = createPaperWorkspaceSnapshotChange({
      document: remoteDocument,
      documents: [{ ...baselineDocuments[0], document: remoteDocument }],
      activeDocumentId: 'shared-tab', selectedPageId: remoteDocument.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    });

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(remote)).resolves.toBe(true);
    const frames = usePaperStore.getState().document.pages[0].frames;
    expect(frames.find(({ id }) => id === 'local-frame')?.text).toBe('phone pending');
    expect(frames.find(({ id }) => id === 'remote-frame')?.text).toBe('desktop applied');

    await __flushPaperSyncEmitForTests();
    const published = h.notify.mock.calls.at(-1)?.[1] as PaperWorkspaceSnapshotChange;
    expect(published.type).toBe('paper-document-snapshot');
    const publishedFrames = published.workspace.documents[0].document.pages[0].frames;
    expect(publishedFrames.find(({ id }) => id === 'local-frame')?.text).toBe('phone pending');
    expect(publishedFrames.find(({ id }) => id === 'remote-frame')?.text).toBe('desktop applied');
  });

  it('accepts a same-field conflict and republishes the pending local winner', async () => {
    let document = createDefaultPaperDocument({ title: 'Conflict page' });
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'shared-frame', kind: 'text', text: 'baseline', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
    }).document;
    const documents: PaperWorkspaceDocumentSnapshot[] = [{
      id: 'shared-tab', document, selectedPageId: document.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    }];
    h.androidAvailable.value = true;
    installWorkspace(documents, 'shared-tab');
    initializePaperSyncChannel();

    usePaperStore.setState((state) => ({
      document: updatePaperFrame(state.document, state.document.pages[0].id, 'shared-frame', {
        text: 'phone local winner',
      }),
    }));
    const remoteDocument = updatePaperFrame(document, document.pages[0].id, 'shared-frame', {
      text: 'desktop conflicting value',
    });
    const remote = createPaperWorkspaceSnapshotChange({
      document: remoteDocument,
      documents: [{ ...documents[0], document: remoteDocument }],
      activeDocumentId: 'shared-tab', selectedPageId: remoteDocument.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    });

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(remote)).resolves.toBe(true);
    expect(usePaperStore.getState().document.pages[0].frames[0].text).toBe('phone local winner');
    await __flushPaperSyncEmitForTests();
    const published = h.notify.mock.calls.at(-1)?.[1] as PaperWorkspaceSnapshotChange;
    expect(published.workspace.documents[0].document.pages[0].frames[0].text).toBe('phone local winner');
  });

  it('merges a stale peer envelope against its declared base after the phone edit was already acknowledged', async () => {
    let baselineDocument = createDefaultPaperDocument({ title: 'Stale-peer page' });
    baselineDocument = addFrameToPaperPage(baselineDocument, baselineDocument.pages[0].id, {
      id: 'phone-frame', kind: 'text', text: 'phone baseline', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
    }).document;
    baselineDocument = addFrameToPaperPage(baselineDocument, baselineDocument.pages[0].id, {
      id: 'desktop-frame', kind: 'text', text: 'desktop baseline', xMm: 60, yMm: 10, widthMm: 40, heightMm: 20,
    }).document;
    const makeChange = (document: PaperDocument) => createPaperWorkspaceSnapshotChange({
      document,
      documents: [{
        id: 'shared-tab', document, selectedPageId: document.pages[0].id,
        selectedFrameIds: [], tool: 'select', zoom: 0.8,
      }],
      activeDocumentId: 'shared-tab', selectedPageId: document.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    });
    const baseline = makeChange(baselineDocument);
    h.androidAvailable.value = true;
    installWorkspace(baseline.workspace.documents, 'shared-tab');
    initializePaperSyncChannel();

    usePaperStore.setState((state) => ({
      document: updatePaperFrame(state.document, state.document.pages[0].id, 'phone-frame', { text: 'phone first' }),
    }));
    await __flushPaperSyncEmitForTests();
    const phoneAuthority = usePaperStore.getState().document;

    const staleDesktopDocument = updatePaperFrame(
      baselineDocument,
      baselineDocument.pages[0].id,
      'desktop-frame',
      { text: 'desktop second' },
    );
    const staleDesktop = {
      ...makeChange(staleDesktopDocument),
      baseWorkspace: baseline.workspace,
    } satisfies PaperWorkspaceSnapshotChange;
    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(staleDesktop)).resolves.toBe(true);

    const frames = usePaperStore.getState().document.pages[0].frames;
    expect(phoneAuthority.pages[0].frames.find(({ id }) => id === 'phone-frame')?.text).toBe('phone first');
    expect(frames.find(({ id }) => id === 'phone-frame')?.text).toBe('phone first');
    expect(frames.find(({ id }) => id === 'desktop-frame')?.text).toBe('desktop second');
  });

  it('preserves an unsent local tab when the first phone authority seed arrives', async () => {
    const local = createDefaultPaperDocument({ title: 'Unsent desktop tab' });
    const remote = createDefaultPaperDocument({ title: 'Phone authority tab' });
    installWorkspace([{
      id: 'local-tab', document: local, selectedPageId: local.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    }], 'local-tab');
    h.served.value = true;
    __setPaperSyncDepsForTests({
      prepareAssets: async () => true,
      commitAssets: async () => true,
    });
    initializePaperSyncChannel();
    const seed = createPaperWorkspaceSnapshotChange({
      document: remote,
      documents: [{
        id: 'phone-tab', document: remote, selectedPageId: remote.pages[0].id,
        selectedFrameIds: [], tool: 'select', zoom: 0.8,
      }],
      activeDocumentId: 'phone-tab', selectedPageId: remote.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    });

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote(seed)).resolves.toBe(true);
    expect(usePaperStore.getState().documents.map(({ id }) => id).sort()).toEqual(['local-tab', 'phone-tab']);
    expect(usePaperStore.getState().documents.find(({ id }) => id === 'local-tab')?.document.title)
      .toBe('Unsent desktop tab');

    await __flushPaperSyncEmitForTests();
    const published = h.notify.mock.calls.at(-1)?.[1] as PaperWorkspaceSnapshotChange;
    expect(published.workspace.documents.map(({ id }) => id).sort()).toEqual(['local-tab', 'phone-tab']);
  });
});

describe('Paper legacy payload compatibility', () => {
  it('applies an old snapshot to a single tab and keeps its catalog entry coherent', async () => {
    const local = createDefaultPaperDocument({ title: 'Local' });
    const remote = createDefaultPaperDocument({ title: 'Legacy remote' });
    installWorkspace([{ id: 'only-tab', document: local, selectedPageId: local.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 }], 'only-tab');
    h.served.value = true;
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote({
      type: 'paper-document-snapshot',
      document: remote,
    } satisfies PaperDocumentNativeChange)).resolves.toBe(true);
    expect(usePaperStore.getState().document).toBe(remote);
    expect(usePaperStore.getState().documents[0].document).toBe(remote);
    expect(usePaperStore.getState().activeDocumentId).toBe('only-tab');
  });

  it('rejects an unrelated old full snapshot on a multi-tab receiver', async () => {
    const first = createDefaultPaperDocument({ title: 'First' });
    const second = createDefaultPaperDocument({ title: 'Second' });
    const unrelated = createDefaultPaperDocument({ title: 'Unrelated legacy sender' });
    installWorkspace([
      { id: 'first-tab', document: first, selectedPageId: first.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 },
      { id: 'second-tab', document: second, selectedPageId: second.pages[0].id, selectedFrameIds: [], tool: 'select', zoom: 0.8 },
    ], 'second-tab');
    h.served.value = true;
    initializePaperSyncChannel();

    await expect(getProjectSyncChannel(PAPER_SYNC_CHANNEL)!.applyRemote({
      type: 'paper-document-snapshot',
      document: unrelated,
    } satisfies PaperDocumentNativeChange)).resolves.toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Second');
    expect(usePaperStore.getState().documents.map((candidate) => candidate.document.title)).toEqual(['First', 'Second']);
  });
});
