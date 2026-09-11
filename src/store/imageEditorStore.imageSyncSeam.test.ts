import { beforeEach, describe, expect, it } from 'vitest';

import { useImageEditorStore } from './imageEditorStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../types/imageEditor';

/**
 * Task #53, increment 1: the live-store seam for the unified Image op-sync. The pure op algebra is
 * covered by `imageDocumentNativeSync.test.ts`; this verifies the two store actions that bridge it to
 * the live document — `applyRemoteImageDocumentChange` (non-pixel ops, must preserve each surviving
 * layer's live `OffscreenCanvas` ref by id) and `applyRemoteLayerPixels` (atomic version+pixel flip).
 * Bitmaps are sentinel objects, never touched by a canvas API, so the seam runs cleanly under jsdom.
 */

// A unique object standing in for a live OffscreenCanvas — identity is what the assertions check.
const fakeBitmap = (tag: string): LayerBitmap => ({ __tag: tag } as unknown as LayerBitmap);

function makeLayer(id: string, patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id,
    name: id,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: fakeBitmap(`bitmap-${id}`),
    bitmapVersion: 1,
    mask: null,
    ...patch,
  };
}

function makeDocument(layers: ImageLayer[]): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Doc',
    width: 64,
    height: 64,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function openDoc(layers: ImageLayer[]): ImageDocument {
  const doc = makeDocument(layers);
  // Reset to a single known document for each test. Granular remote ops target the doc the
  // last snapshot seeded (note 819) — mark this doc as that seed, as a paired session would.
  useImageEditorStore.setState({ documents: [], activeDocId: null, syncedImageDocumentId: doc.id });
  useImageEditorStore.getState().openDocument(doc);
  return doc;
}

const activeDoc = (): ImageDocument => {
  const doc = useImageEditorStore.getState().documents.find((d) => d.id === 'doc-1');
  if (!doc) throw new Error('no active doc');
  return doc;
};

beforeEach(() => {
  useImageEditorStore.setState({ documents: [], activeDocId: null, syncedImageDocumentId: null });
});

describe('applyRemoteImageDocumentChange (#53 store seam)', () => {
  it('applies a metadata patch while preserving the layer’s live bitmap ref', () => {
    const layer = makeLayer('a');
    const liveBitmap = layer.bitmap;
    openDoc([layer]);

    const changed = useImageEditorStore.getState().applyRemoteImageDocumentChange({
      type: 'image-layer-props-updated',
      layerId: 'a',
      patch: { opacity: 0.5 } as ImageLayer,
    });

    expect(changed).toBe(true);
    const next = activeDoc().layers[0];
    expect(next.opacity).toBe(0.5);
    expect(next.bitmap).toBe(liveBitmap); // OffscreenCanvas ref carried across the wire round-trip
  });

  it('adds a remote layer as a null-bitmap shell without disturbing existing layers', () => {
    const existing = makeLayer('a');
    const existingBitmap = existing.bitmap;
    openDoc([existing]);

    const changed = useImageEditorStore.getState().applyRemoteImageDocumentChange({
      type: 'image-layer-added',
      index: 1,
      layer: { ...makeLayer('b'), bitmap: undefined, mask: undefined, hasBitmap: true, hasMask: false } as never,
    });

    expect(changed).toBe(true);
    const layers = activeDoc().layers;
    expect(layers.map((l) => l.id)).toEqual(['a', 'b']);
    expect(layers[0].bitmap).toBe(existingBitmap); // untouched
    expect(layers[1].bitmap).toBeNull(); // shell — pixels arrive via applyRemoteLayerPixels
  });

  it('removes a layer and keeps the survivor’s bitmap', () => {
    const a = makeLayer('a');
    const b = makeLayer('b');
    const bBitmap = b.bitmap;
    openDoc([a, b]);

    const changed = useImageEditorStore.getState().applyRemoteImageDocumentChange({
      type: 'image-layer-removed',
      layerId: 'a',
    });

    expect(changed).toBe(true);
    const layers = activeDoc().layers;
    expect(layers.map((l) => l.id)).toEqual(['b']);
    expect(layers[0].bitmap).toBe(bBitmap);
  });

  it('returns false and leaves the document untouched on a no-op op', () => {
    openDoc([makeLayer('a')]);
    const before = activeDoc();

    const changed = useImageEditorStore.getState().applyRemoteImageDocumentChange({
      type: 'image-layer-props-updated',
      layerId: 'a',
      patch: { opacity: 1 } as ImageLayer, // already 1 → nothing changes
    });

    expect(changed).toBe(false);
    expect(activeDoc()).toBe(before); // same reference; no churn
  });

  it('does nothing when there is no open document', () => {
    useImageEditorStore.setState({ documents: [], activeDocId: null });
    const changed = useImageEditorStore.getState().applyRemoteImageDocumentChange({
      type: 'image-active-layer-changed',
      activeLayerId: 'x',
    });
    expect(changed).toBe(false);
  });
});

describe('applyRemoteLayerPixels (#53 store seam)', () => {
  it('flips a layer’s bitmap, mask and version together', () => {
    openDoc([makeLayer('a', { bitmapVersion: 3 })]);
    const newBitmap = fakeBitmap('decoded');
    const newMask = fakeBitmap('decoded-mask');

    const changed = useImageEditorStore
      .getState()
      .applyRemoteLayerPixels('a', { bitmap: newBitmap, mask: newMask, bitmapVersion: 4 });

    expect(changed).toBe(true);
    const layer = activeDoc().layers[0];
    expect(layer.bitmap).toBe(newBitmap);
    expect(layer.mask).toBe(newMask);
    expect(layer.bitmapVersion).toBe(4);
    expect(layer.bitmapData).toBeUndefined();
  });

  it('returns false for an unknown layer id', () => {
    openDoc([makeLayer('a')]);
    const changed = useImageEditorStore
      .getState()
      .applyRemoteLayerPixels('missing', { bitmap: null, mask: null, bitmapVersion: 2 });
    expect(changed).toBe(false);
  });
});
