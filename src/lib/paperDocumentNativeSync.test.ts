import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import type { PaperDocument, PaperFrame } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import {
  applyPaperDocumentNativeChange,
  diffPaperDocumentNativeChanges,
} from './paperDocumentNativeSync';

/**
 * The pure Paper op model that the unified Paper sync channel (#52) drives. Mirrors the Flow op-core
 * tests: the reducer applies each serialized op idempotently (same document ref on a no-op), and the
 * diff emits the minimal frame ops while collapsing any non-frame/page change to a snapshot — and the
 * two round-trip.
 */

/** Mint a real document + page id with `count` real frames (frames are pure data — no callbacks). */
function docWithFrames(count: number): { document: PaperDocument; pageId: string; frameIds: string[] } {
  let document = createDefaultPaperDocument();
  const pageId = document.pages[0].id;
  const frameIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = addFrameToPaperPage(document, pageId, { kind: 'text', xMm: i * 10, yMm: i * 10, widthMm: 40, heightMm: 30, label: `f${i}` });
    document = result.document;
    frameIds.push(result.frameId);
  }
  return { document, pageId, frameIds };
}

const frameOnPage = (document: PaperDocument, pageId: string, frameId: string): PaperFrame | undefined =>
  document.pages.find((page) => page.id === pageId)?.frames.find((frame) => frame.id === frameId);

function managedRef(): BinaryAssetRef {
  const sha256 = '4'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'image/png', byteLength: 3 };
}

describe('applyPaperDocumentNativeChange', () => {
  it('adds a remote frame and is idempotent on a duplicate id', () => {
    const base = docWithFrames(1);
    const incoming = docWithFrames(1); // a separate frame object to graft in
    const incomingFrame = frameOnPage(incoming.document, incoming.pageId, incoming.frameIds[0])!;

    const added = applyPaperDocumentNativeChange(base.document, {
      type: 'paper-frame-added',
      pageId: base.pageId,
      frame: incomingFrame,
    });
    expect(frameOnPage(added, base.pageId, incomingFrame.id)).toBeDefined();
    expect(added.pages[0].frames).toHaveLength(2);

    // Re-adding the same frame id is a no-op (same reference back).
    const again = applyPaperDocumentNativeChange(added, {
      type: 'paper-frame-added',
      pageId: base.pageId,
      frame: incomingFrame,
    });
    expect(again).toBe(added);
  });

  it('moves a frame and no-ops a move to the same position', () => {
    const { document, pageId, frameIds } = docWithFrames(1);
    const moved = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-moved',
      pageId,
      frameId: frameIds[0],
      xMm: 99,
      yMm: 42,
    });
    expect(frameOnPage(moved, pageId, frameIds[0])).toMatchObject({ xMm: 99, yMm: 42 });

    const again = applyPaperDocumentNativeChange(moved, {
      type: 'paper-frame-moved',
      pageId,
      frameId: frameIds[0],
      xMm: 99,
      yMm: 42,
    });
    expect(again).toBe(moved);
  });

  it('merges a frame-updated patch', () => {
    const { document, pageId, frameIds } = docWithFrames(1);
    const updated = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-updated',
      pageId,
      frameId: frameIds[0],
      patch: { text: 'hello', opacity: 0.5 },
    });
    expect(frameOnPage(updated, pageId, frameIds[0])).toMatchObject({ text: 'hello', opacity: 0.5 });
  });

  it('removes a frame and no-ops a removal of a missing frame', () => {
    const { document, pageId, frameIds } = docWithFrames(2);
    const removed = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-removed',
      pageId,
      frameId: frameIds[0],
    });
    expect(frameOnPage(removed, pageId, frameIds[0])).toBeUndefined();
    expect(removed.pages[0].frames).toHaveLength(1);

    const again = applyPaperDocumentNativeChange(removed, {
      type: 'paper-frame-removed',
      pageId,
      frameId: frameIds[0],
    });
    expect(again).toBe(removed);
  });

  it('replaces the whole document from a snapshot', () => {
    const a = createDefaultPaperDocument({ title: 'A' });
    const b = createDefaultPaperDocument({ title: 'B' });
    const result = applyPaperDocumentNativeChange(a, { type: 'paper-document-snapshot', document: b });
    expect(result).toBe(b);
  });

  it('no-ops a frame op aimed at a missing page', () => {
    const { document, frameIds } = docWithFrames(1);
    const result = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-removed',
      pageId: 'no-such-page',
      frameId: frameIds[0],
    });
    expect(result).toBe(document);
  });
});

describe('diffPaperDocumentNativeChanges', () => {
  it('emits nothing when unchanged', () => {
    const { document } = docWithFrames(2);
    expect(diffPaperDocumentNativeChanges(document, document)).toEqual([]);
  });

  it('detects an added frame', () => {
    const { document, pageId } = docWithFrames(1);
    const next = addFrameToPaperPage(document, pageId, { kind: 'shape', xMm: 50, yMm: 50, widthMm: 40, heightMm: 30 }).document;
    const ops = diffPaperDocumentNativeChanges(document, next);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('paper-frame-added');
  });

  it('detects a removed frame', () => {
    const { document, pageId, frameIds } = docWithFrames(2);
    const next = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-removed',
      pageId,
      frameId: frameIds[0],
    });
    const ops = diffPaperDocumentNativeChanges(document, next);
    expect(ops).toEqual([{ type: 'paper-frame-removed', pageId, frameId: frameIds[0] }]);
  });

  it('emits a pure move op when only position changed', () => {
    const { document, pageId, frameIds } = docWithFrames(1);
    const next = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-moved',
      pageId,
      frameId: frameIds[0],
      xMm: 123,
      yMm: 45,
    });
    const ops = diffPaperDocumentNativeChanges(document, next);
    expect(ops).toEqual([{ type: 'paper-frame-moved', pageId, frameId: frameIds[0], xMm: 123, yMm: 45 }]);
  });

  it('emits an update op (not a move) when non-position fields changed', () => {
    const { document, pageId, frameIds } = docWithFrames(1);
    const next = applyPaperDocumentNativeChange(document, {
      type: 'paper-frame-updated',
      pageId,
      frameId: frameIds[0],
      patch: { text: 'changed', xMm: 7 },
    });
    const ops = diffPaperDocumentNativeChanges(document, next);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('paper-frame-updated');
  });

  it('collapses a document-setup change to a single snapshot', () => {
    const { document } = docWithFrames(1);
    const next = { ...document, title: 'Renamed', view: { ...document.view, showGrid: !document.view.showGrid } };
    const ops = diffPaperDocumentNativeChanges(document, next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ type: 'paper-document-snapshot', document: next });
  });

  it('carries reachable managed asset ids in a structural snapshot without carrying bytes', () => {
    const { document, pageId } = docWithFrames(0);
    const next = addFrameToPaperPage(document, pageId, {
      kind: 'image',
      xMm: 1,
      yMm: 1,
      widthMm: 10,
      heightMm: 10,
      asset: { label: 'Managed', kind: 'image', locator: { kind: 'managed', ref: managedRef() } },
    }).document;
    const structural = { ...next, title: 'Managed asset snapshot' };

    expect(diffPaperDocumentNativeChanges(document, structural)).toEqual([{
      type: 'paper-document-snapshot',
      document: structural,
      assetIds: [managedRef().id],
    }]);
  });

  it('collapses a guide change to a snapshot (guides are structural, not frames)', () => {
    const { document, pageId } = docWithFrames(1);
    const next = {
      ...document,
      pages: document.pages.map((page) =>
        page.id === pageId
          ? { ...page, guides: [...page.guides, { id: 'g1', orientation: 'vertical' as const, positionMm: 10 }] }
          : page,
      ),
    };
    const ops = diffPaperDocumentNativeChanges(document, next);
    expect(ops).toEqual([{ type: 'paper-document-snapshot', document: next }]);
  });

  it('round-trips: applying the diff to prev reproduces next', () => {
    const { document, pageId, frameIds } = docWithFrames(2);
    // move one frame, edit another, add a third, remove none
    let next = applyPaperDocumentNativeChange(document, { type: 'paper-frame-moved', pageId, frameId: frameIds[0], xMm: 200, yMm: 10 });
    next = applyPaperDocumentNativeChange(next, { type: 'paper-frame-updated', pageId, frameId: frameIds[1], patch: { text: 'edited' } });
    next = addFrameToPaperPage(next, pageId, { kind: 'image', xMm: 5, yMm: 5, widthMm: 40, heightMm: 30 }).document;

    const ops = diffPaperDocumentNativeChanges(document, next);
    let rebuilt: PaperDocument = document;
    for (const op of ops) rebuilt = applyPaperDocumentNativeChange(rebuilt, op);

    // Frames (the synced content) match by id + key fields, ignoring volatile updatedAt.
    const rebuiltFrames = rebuilt.pages[0].frames;
    const nextFrames = next.pages[0].frames;
    expect(rebuiltFrames.map((f) => f.id).sort()).toEqual(nextFrames.map((f) => f.id).sort());
    expect(frameOnPage(rebuilt, pageId, frameIds[0])).toMatchObject({ xMm: 200, yMm: 10 });
    expect(frameOnPage(rebuilt, pageId, frameIds[1])).toMatchObject({ text: 'edited' });
  });
});
