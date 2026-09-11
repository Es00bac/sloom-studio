import { describe, expect, it } from 'vitest';
import {
  applyImageDocumentNativeChange,
  diffImageDocumentNativeChanges,
  type ImageDocumentWire,
  type ImageLayerWire,
} from './imageDocumentNativeSync';

/**
 * The pure, canvas-free Image op model that the unified Image sync channel (#53) drives. Mirrors the
 * Flow/Paper op-core tests: the reducer applies each serialized op idempotently (same wire-document ref
 * on a no-op), and the diff emits the minimal ops — crucially treating a layer's **pixel version**
 * (`bitmapVersion` + presence flags) as its own op, separate from its metadata, so the out-of-band byte
 * transfer is decoupled from the JSON op stream. The two round-trip.
 */

function wireLayer(id: string, overrides: Partial<ImageLayerWire> = {}): ImageLayerWire {
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
    bitmapVersion: 1,
    hasBitmap: true,
    hasMask: false,
    ...overrides,
  };
}

function wireDoc(layers: ImageLayerWire[], overrides: Partial<ImageDocumentWire> = {}): ImageDocumentWire {
  return {
    id: 'doc-1',
    title: 'Untitled',
    width: 1024,
    height: 768,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

describe('applyImageDocumentNativeChange', () => {
  it('adds a layer at an index and is idempotent on a duplicate id', () => {
    const base = wireDoc([wireLayer('a')]);
    const added = applyImageDocumentNativeChange(base, { type: 'image-layer-added', index: 1, layer: wireLayer('b') });
    expect(added.layers.map((l) => l.id)).toEqual(['a', 'b']);

    const again = applyImageDocumentNativeChange(added, { type: 'image-layer-added', index: 1, layer: wireLayer('b') });
    expect(again).toBe(added); // same ref — no-op
  });

  it('removes a layer and reconciles active + selection', () => {
    const base = wireDoc([wireLayer('a'), wireLayer('b')], { activeLayerId: 'a', selectedLayerIds: ['a', 'b'] });
    const removed = applyImageDocumentNativeChange(base, { type: 'image-layer-removed', layerId: 'a' });
    expect(removed.layers.map((l) => l.id)).toEqual(['b']);
    expect(removed.activeLayerId).toBe('b'); // fell back to the surviving layer
    expect(removed.selectedLayerIds).toEqual(['b']);

    const again = applyImageDocumentNativeChange(removed, { type: 'image-layer-removed', layerId: 'a' });
    expect(again).toBe(removed); // already gone — no-op
  });

  it('reorders layers and no-ops an identical order', () => {
    const base = wireDoc([wireLayer('a'), wireLayer('b'), wireLayer('c')]);
    const reordered = applyImageDocumentNativeChange(base, { type: 'image-layers-reordered', layerIds: ['c', 'a', 'b'] });
    expect(reordered.layers.map((l) => l.id)).toEqual(['c', 'a', 'b']);

    const again = applyImageDocumentNativeChange(reordered, { type: 'image-layers-reordered', layerIds: ['c', 'a', 'b'] });
    expect(again).toBe(reordered);
  });

  it('merges a layer metadata patch and no-ops a patch that changes nothing', () => {
    const base = wireDoc([wireLayer('a', { opacity: 1 })]);
    const updated = applyImageDocumentNativeChange(base, {
      type: 'image-layer-props-updated',
      layerId: 'a',
      patch: { id: 'a', name: 'Renamed', type: 'image', visible: false, locked: false, opacity: 0.4, blendMode: 'multiply', x: 5, y: 6 },
    });
    expect(updated.layers[0]).toMatchObject({ name: 'Renamed', visible: false, opacity: 0.4, blendMode: 'multiply', x: 5 });

    const again = applyImageDocumentNativeChange(updated, {
      type: 'image-layer-props-updated',
      layerId: 'a',
      patch: { id: 'a', name: 'Renamed', type: 'image', visible: false, locked: false, opacity: 0.4, blendMode: 'multiply', x: 5, y: 6 },
    });
    expect(again).toBe(updated);
  });

  it('applies a pixel-version bump and no-ops the same version', () => {
    const base = wireDoc([wireLayer('a', { bitmapVersion: 3, hasBitmap: true, hasMask: false })]);
    const bumped = applyImageDocumentNativeChange(base, {
      type: 'image-layer-pixels-updated',
      layerId: 'a',
      bitmapVersion: 4,
      hasBitmap: true,
      hasMask: true,
    });
    expect(bumped.layers[0]).toMatchObject({ bitmapVersion: 4, hasMask: true });

    const again = applyImageDocumentNativeChange(bumped, {
      type: 'image-layer-pixels-updated',
      layerId: 'a',
      bitmapVersion: 4,
      hasBitmap: true,
      hasMask: true,
    });
    expect(again).toBe(bumped);
  });

  it('a props patch never disturbs the pixel version', () => {
    const base = wireDoc([wireLayer('a', { bitmapVersion: 7 })]);
    const updated = applyImageDocumentNativeChange(base, {
      type: 'image-layer-props-updated',
      layerId: 'a',
      patch: { id: 'a', name: 'a', type: 'image', visible: true, locked: false, opacity: 0.5, blendMode: 'normal', x: 0, y: 0 },
    });
    expect(updated.layers[0].bitmapVersion).toBe(7); // untouched by a metadata patch
  });

  it('updates document props and the active/selection pointers', () => {
    const base = wireDoc([wireLayer('a'), wireLayer('b')]);
    const resized = applyImageDocumentNativeChange(base, {
      type: 'image-document-props-updated',
      patch: { width: 2048, title: 'Big' },
    });
    expect(resized).toMatchObject({ width: 2048, title: 'Big' });

    const active = applyImageDocumentNativeChange(resized, {
      type: 'image-active-layer-changed',
      activeLayerId: 'b',
      selectedLayerIds: ['b'],
    });
    expect(active.activeLayerId).toBe('b');
    expect(active.selectedLayerIds).toEqual(['b']);
  });

  it('no-ops any op aimed at a missing layer', () => {
    const base = wireDoc([wireLayer('a')]);
    expect(applyImageDocumentNativeChange(base, { type: 'image-layer-removed', layerId: 'zz' })).toBe(base);
    expect(applyImageDocumentNativeChange(base, { type: 'image-layer-props-updated', layerId: 'zz', patch: { id: 'zz', name: 'x', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0 } })).toBe(base);
    expect(applyImageDocumentNativeChange(base, { type: 'image-layer-pixels-updated', layerId: 'zz', bitmapVersion: 9, hasBitmap: true, hasMask: false })).toBe(base);
  });

  it('replaces the whole document from a snapshot', () => {
    const a = wireDoc([wireLayer('a')]);
    const b = wireDoc([wireLayer('b')], { id: 'doc-2', title: 'B' });
    expect(applyImageDocumentNativeChange(a, { type: 'image-document-snapshot', document: b })).toBe(b);
  });
});

describe('diffImageDocumentNativeChanges', () => {
  it('emits nothing when unchanged', () => {
    const doc = wireDoc([wireLayer('a'), wireLayer('b')]);
    expect(diffImageDocumentNativeChanges(doc, doc)).toEqual([]);
  });

  it('detects an added layer with its index', () => {
    const prev = wireDoc([wireLayer('a')]);
    const next = wireDoc([wireLayer('a'), wireLayer('b')]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toEqual([{ type: 'image-layer-added', index: 1, layer: next.layers[1] }]);
  });

  it('detects a removed layer', () => {
    const prev = wireDoc([wireLayer('a'), wireLayer('b')]);
    const next = wireDoc([wireLayer('a')]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toContainEqual({ type: 'image-layer-removed', layerId: 'b' });
  });

  it('emits a reorder op when surviving layers change order', () => {
    const prev = wireDoc([wireLayer('a'), wireLayer('b'), wireLayer('c')]);
    const next = wireDoc([wireLayer('c'), wireLayer('a'), wireLayer('b')]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toContainEqual({ type: 'image-layers-reordered', layerIds: ['c', 'a', 'b'] });
  });

  it('emits a pixels op (not a props op) when only the bitmap version changed', () => {
    const prev = wireDoc([wireLayer('a', { bitmapVersion: 1 })]);
    const next = wireDoc([wireLayer('a', { bitmapVersion: 2, hasMask: true })]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toEqual([{ type: 'image-layer-pixels-updated', layerId: 'a', bitmapVersion: 2, hasBitmap: true, hasMask: true }]);
  });

  it('keeps Tiltmark base/state presence in the out-of-band pixel operation', () => {
    const prev = wireDoc([wireLayer('surface', { bitmapVersion: 1 })]);
    const next = wireDoc([wireLayer('surface', {
      bitmapVersion: 2,
      hasTiltmarkBase: true,
      hasTiltmarkSimulation: true,
    })]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toEqual([{
      type: 'image-layer-pixels-updated',
      layerId: 'surface',
      bitmapVersion: 2,
      hasBitmap: true,
      hasMask: false,
      hasTiltmarkBase: true,
      hasTiltmarkSimulation: true,
    }]);
    expect(applyImageDocumentNativeChange(prev, ops[0]).layers[0]).toMatchObject({
      hasTiltmarkBase: true,
      hasTiltmarkSimulation: true,
    });
  });

  it('emits a props op (not a pixels op) when only metadata changed', () => {
    const prev = wireDoc([wireLayer('a', { opacity: 1 })]);
    const next = wireDoc([wireLayer('a', { opacity: 0.3 })]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ type: 'image-layer-props-updated', layerId: 'a', patch: { opacity: 0.3 } });
  });

  it('emits narrow metadata patches and explicit deletions for simultaneous stale peers', () => {
    const prev = wireDoc([wireLayer('a', { opacity: 1, name: 'Keep', linkGroupId: 'other' })]);
    const nextLayer = wireLayer('a', { opacity: 0.5, name: 'Keep' });
    delete nextLayer.linkGroupId;
    const next = wireDoc([nextLayer]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toEqual([{
      type: 'image-layer-props-updated', layerId: 'a', patch: { opacity: 0.5 }, unsetKeys: ['linkGroupId'],
    }]);
    expect(applyImageDocumentNativeChange(prev, ops[0]).layers[0]).toMatchObject({ opacity: 0.5, name: 'Keep' });
    expect(applyImageDocumentNativeChange(prev, ops[0]).layers[0]).not.toHaveProperty('linkGroupId');
  });

  it('emits both a props op and a pixels op when a layer moved and was repainted', () => {
    const prev = wireDoc([wireLayer('a', { x: 0, bitmapVersion: 1 })]);
    const next = wireDoc([wireLayer('a', { x: 50, bitmapVersion: 2 })]);
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops.map((o) => o.type)).toEqual(['image-layer-props-updated', 'image-layer-pixels-updated']);
  });

  it('emits a document-props op when the canvas was resized', () => {
    const prev = wireDoc([wireLayer('a')], { width: 1024 });
    const next = wireDoc([wireLayer('a')], { width: 2048 });
    const ops = diffImageDocumentNativeChanges(prev, next);
    expect(ops).toEqual([{ type: 'image-document-props-updated', patch: { width: 2048 } }]);
  });

  it('round-trips: applying the diff to prev reproduces next', () => {
    const prev = wireDoc([wireLayer('a', { bitmapVersion: 1 }), wireLayer('b', { opacity: 1 })], { activeLayerId: 'a' });
    // remove a, repaint b, add c on top, resize, change active
    const next = wireDoc(
      [wireLayer('b', { opacity: 0.5, bitmapVersion: 9 }), wireLayer('c', { bitmapVersion: 1 })],
      { id: 'doc-1', title: 'Untitled', width: 4096, activeLayerId: 'c', selectedLayerIds: ['c'] },
    );

    const ops = diffImageDocumentNativeChanges(prev, next);
    let rebuilt = prev;
    for (const op of ops) rebuilt = applyImageDocumentNativeChange(rebuilt, op);

    expect(rebuilt.layers.map((l) => l.id)).toEqual(['b', 'c']);
    expect(rebuilt.layers.find((l) => l.id === 'b')).toMatchObject({ opacity: 0.5, bitmapVersion: 9 });
    expect(rebuilt.width).toBe(4096);
    expect(rebuilt.activeLayerId).toBe('c');
    expect(rebuilt.selectedLayerIds).toEqual(['c']);
  });
});
