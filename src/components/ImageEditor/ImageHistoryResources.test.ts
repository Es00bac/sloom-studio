import { beforeEach, describe, expect, it } from 'vitest';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type { EditorOperation, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  disposeEditorOperation,
  editorOperationRetainedBytes,
  retainEditorOperation,
} from './ImageHistoryResources';
import { createPixelBuffer } from './pixels/PixelBuffer';

class ResourceCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return { drawImage() {} };
  }
}

function makeLayer(bitmap: LayerBitmap): ImageLayer {
  return {
    id: 'layer',
    name: 'Layer',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

function retainedPaintBitmap(operation: EditorOperation): LayerBitmap {
  if (operation.kind !== 'paint' || !operation.before) throw new Error('Expected retained paint bitmap');
  return operation.before;
}

describe('Image history retained resources', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = ResourceCanvas as unknown as typeof OffscreenCanvas;
    const state = useImageEditorStore.getState();
    for (const docId of new Set([...Object.keys(state.undoStacks), ...Object.keys(state.redoStacks)])) {
      state.clearHistory(docId);
    }
    useImageEditorStore.setState({ documents: [], activeDocId: null, undoStacks: {}, redoStacks: {} });
  });

  it('shares unchanged pixels inside one immutable operation and disposes only retained clones', () => {
    const source = new OffscreenCanvas(2, 1) as LayerBitmap;
    const layer = makeLayer(source);
    const retained = retainEditorOperation({
      kind: 'layerOp',
      docId: 'doc',
      before: [layer],
      after: [{ ...layer, name: 'Renamed' }],
    });
    if (retained.kind !== 'layerOp') throw new Error('Expected layer operation');

    const beforeBitmap = retained.before[0].bitmap;
    expect(beforeBitmap).not.toBe(source);
    expect(retained.after[0].bitmap).toBe(beforeBitmap);
    expect(editorOperationRetainedBytes(retained)).toBe(8);

    disposeEditorOperation(retained);
    disposeEditorOperation(retained);
    expect(beforeBitmap?.width).toBe(0);
    expect(beforeBitmap?.height).toBe(0);
    expect(source.width).toBe(2);
    expect(source.height).toBe(1);
  });

  it('releases evicted history and invalidated redo resources without touching source canvases', () => {
    const source = new OffscreenCanvas(1, 1) as LayerBitmap;
    const store = useImageEditorStore.getState();

    store.pushOperation({ kind: 'paint', docId: 'doc', layerId: 'layer', before: source, after: source });
    const firstRetained = retainedPaintBitmap(useImageEditorStore.getState().undoStacks.doc[0]);
    for (let index = 1; index <= 50; index += 1) {
      store.pushOperation({ kind: 'paint', docId: 'doc', layerId: 'layer', before: source, after: source });
    }
    expect(useImageEditorStore.getState().undoStacks.doc).toHaveLength(50);
    expect(firstRetained.width).toBe(0);
    expect(source.width).toBe(1);

    const moved = useImageEditorStore.getState().popUndo('doc');
    expect(moved).toBeDefined();
    const redoBitmap = retainedPaintBitmap(moved!);
    store.pushOperation({ kind: 'paint', docId: 'doc', layerId: 'layer', before: source, after: source });
    expect(useImageEditorStore.getState().redoStacks.doc).toEqual([]);
    expect(redoBitmap.width).toBe(0);

    const retainedBeforeClear = retainedPaintBitmap(useImageEditorStore.getState().undoStacks.doc[0]);
    store.clearHistory('doc');
    expect(retainedBeforeClear.width).toBe(0);
    expect(source.width).toBe(1);
  });

  it('counts layer-array pixels toward the byte cap and releases byte-evicted entries', () => {
    const source = new OffscreenCanvas(12_000, 12_000) as LayerBitmap;
    const layer = makeLayer(source);
    const store = useImageEditorStore.getState();

    store.pushOperation({ kind: 'layerOp', docId: 'large-doc', before: [layer], after: [layer] });
    const first = useImageEditorStore.getState().undoStacks['large-doc'][0];
    if (first.kind !== 'layerOp' || !first.before[0].bitmap) throw new Error('Expected retained layer bitmap');
    const firstBitmap = first.before[0].bitmap;
    expect(editorOperationRetainedBytes(first)).toBe(12_000 * 12_000 * 4);

    store.pushOperation({ kind: 'layerOp', docId: 'large-doc', before: [layer], after: [layer] });

    expect(useImageEditorStore.getState().undoStacks['large-doc']).toHaveLength(1);
    expect(firstBitmap.width).toBe(0);
    expect(source.width).toBe(12_000);
  });

  it('counts and releases high-bit authority retained by transform/crop layer history', () => {
    const source = new OffscreenCanvas(2, 1) as LayerBitmap;
    const pixels = createPixelBuffer({ width: 2, height: 1, depth: 'u16' });
    pixels.data.fill(1234);
    const layer = makeLayer(source);
    layer.pixels = pixels;
    const retained = retainEditorOperation({
      kind: 'layerOp',
      docId: 'doc',
      before: [layer],
      after: [{ ...layer, pixels: createPixelBuffer({ width: 3, height: 1, depth: 'u16' }) }],
    });
    if (retained.kind !== 'layerOp') throw new Error('Expected layer operation');
    expect(editorOperationRetainedBytes(retained)).toBe(8 + (2 * 1 * 4 * 2) + (3 * 1 * 4 * 2));
    const retainedBefore = retained.before[0].pixels;
    const retainedAfter = retained.after[0].pixels;
    disposeEditorOperation(retained);
    expect(retainedBefore?.data.every((value) => value === 0)).toBe(true);
    expect(retainedAfter?.data.every((value) => value === 0)).toBe(true);
    expect(pixels.data.some((value) => value !== 0)).toBe(true);
  });

  it('retains Tiltmark implement checkpoints as immutable paint-history metadata', () => {
    const source = new OffscreenCanvas(2, 2) as LayerBitmap;
    const history = {
      before: {
        engine: 'tiltmark',
        presetId: 'sable-round',
        checkpoint: { supply: { pigment: 0.8 } },
      },
      after: {
        engine: 'tiltmark',
        presetId: 'sable-round',
        checkpoint: { supply: { pigment: 0.55 } },
      },
    };
    const retained = retainEditorOperation({
      kind: 'paint',
      docId: 'doc',
      layerId: 'layer',
      before: source,
      after: source,
      tiltmarkHistory: history,
    });
    if (retained.kind !== 'paint') throw new Error('Expected paint operation');
    expect(retained.tiltmarkHistory).toEqual(history);
    expect(retained.tiltmarkHistory).not.toBe(history);
    (history.after.checkpoint.supply as { pigment: number }).pigment = 0;
    expect(retained.tiltmarkHistory?.after).toMatchObject({
      checkpoint: { supply: { pigment: 0.55 } },
    });
  });
});
