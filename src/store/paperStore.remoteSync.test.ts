import { beforeEach, describe, expect, it } from 'vitest';
import { usePaperStore } from './paperStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../lib/paperDocument';
import type { PaperDocument } from '../types/paper';

/**
 * `applyRemotePaperDocumentChange` is the store seam the unified Paper sync channel (#52) drives. These
 * verify it mutates the live document from a serialized op the way a remote client would, reconciles the
 * local selection when a selected frame/page is removed, leaves undo history untouched, and reports
 * change/no-op so a self-echoed op never thrashes.
 */

function seedDoc(frameCount: number): { document: PaperDocument; pageId: string; frameIds: string[] } {
  let document = createDefaultPaperDocument();
  const pageId = document.pages[0].id;
  const frameIds: string[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const result = addFrameToPaperPage(document, pageId, { kind: 'text', xMm: i * 10, yMm: 0, widthMm: 40, heightMm: 30, label: `f${i}` });
    document = result.document;
    frameIds.push(result.frameId);
  }
  return { document, pageId, frameIds };
}

let pageId = '';
let frameIds: string[] = [];

beforeEach(() => {
  const seeded = seedDoc(2);
  pageId = seeded.pageId;
  frameIds = seeded.frameIds;
  usePaperStore.setState({
    document: seeded.document,
    selectedPageId: pageId,
    selectedFrameId: frameIds[0],
    selectedFrameIds: [frameIds[0]],
    undoStack: [],
    redoStack: [],
  });
});

const framesOnSelectedPage = () =>
  usePaperStore.getState().document.pages.find((page) => page.id === pageId)?.frames ?? [];

describe('paperStore.applyRemotePaperDocumentChange', () => {
  it('adds a remote frame and reports a change', () => {
    const incoming = addFrameToPaperPage(createDefaultPaperDocument(), pageId, { kind: 'shape', xMm: 5, yMm: 5, widthMm: 40, heightMm: 30 });
    // Re-key the incoming frame onto our page id so the add lands.
    const incomingFrame = { ...incoming.document.pages[0].frames[0] };

    const changed = usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-frame-added',
      pageId,
      frame: incomingFrame,
    });
    expect(changed).toBe(true);
    expect(framesOnSelectedPage().some((f) => f.id === incomingFrame.id)).toBe(true);
  });

  it('is idempotent: re-adding the same frame id reports no change and does not push undo', () => {
    const frame = { ...framesOnSelectedPage()[0] };
    const changed = usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-frame-added',
      pageId,
      frame,
    });
    expect(changed).toBe(false);
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
  });

  it('moves a frame and no-ops a move to the same position', () => {
    expect(
      usePaperStore.getState().applyRemotePaperDocumentChange({ type: 'paper-frame-moved', pageId, frameId: frameIds[1], xMm: 77, yMm: 88 }),
    ).toBe(true);
    expect(framesOnSelectedPage().find((f) => f.id === frameIds[1])).toMatchObject({ xMm: 77, yMm: 88 });

    expect(
      usePaperStore.getState().applyRemotePaperDocumentChange({ type: 'paper-frame-moved', pageId, frameId: frameIds[1], xMm: 77, yMm: 88 }),
    ).toBe(false);
  });

  it('merges a frame-updated patch', () => {
    const changed = usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-frame-updated',
      pageId,
      frameId: frameIds[0],
      patch: { text: 'remote edit', opacity: 0.25 },
    });
    expect(changed).toBe(true);
    expect(framesOnSelectedPage().find((f) => f.id === frameIds[0])).toMatchObject({ text: 'remote edit', opacity: 0.25 });
  });

  it('removes a frame and clears it from the selection', () => {
    // frameIds[0] is the selected frame.
    const changed = usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-frame-removed',
      pageId,
      frameId: frameIds[0],
    });
    expect(changed).toBe(true);
    expect(framesOnSelectedPage().some((f) => f.id === frameIds[0])).toBe(false);
    // Selection reconciled — the removed frame is no longer selected.
    expect(usePaperStore.getState().selectedFrameId).toBeNull();
    expect(usePaperStore.getState().selectedFrameIds).not.toContain(frameIds[0]);
  });

  it('replaces the whole document from a snapshot and reconciles a stale selection', () => {
    const fresh = createDefaultPaperDocument({ title: 'Remote' }); // different page id, no frames
    const changed = usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-document-snapshot',
      document: fresh,
    });
    expect(changed).toBe(true);
    expect(usePaperStore.getState().document.title).toBe('Remote');
    // The previously-selected page/frame are gone — selection falls back to the new doc's first page.
    expect(usePaperStore.getState().selectedPageId).toBe(fresh.pages[0].id);
    expect(usePaperStore.getState().selectedFrameId).toBeNull();
    expect(usePaperStore.getState().selectedFrameIds).toEqual([]);
  });

  it('does not push undo history for remote ops', () => {
    usePaperStore.getState().applyRemotePaperDocumentChange({ type: 'paper-frame-moved', pageId, frameId: frameIds[0], xMm: 1, yMm: 2 });
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
    expect(usePaperStore.getState().redoStack).toHaveLength(0);
  });
});
