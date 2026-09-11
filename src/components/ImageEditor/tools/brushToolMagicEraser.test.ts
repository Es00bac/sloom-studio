import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
} from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import {
  MAX_MAGIC_ERASER_PIXELS,
  applyMagicEraserToImageData,
  isMagicEraserResourceBounded,
  magicEraserTool,
} from './brushTool';
import { clearAllSelections, setSelection } from '../selectionRegistry';
import { createMask } from '../SelectionMask';
import { redo, undo } from '../undoRedoApply';

const mods = { shift: false, alt: false, ctrl: false, meta: false };

class FakeCanvasContext {
  readonly imageData: ImageData;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = makeImageData(width, height, new Array(width * height).fill([0, 0, 0, 0]));
  }

  getImageData() {
    return {
      width: this.width,
      height: this.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData.data.set(imageData.data);
  }

  drawImage(source: FakeOffscreenCanvas, dx = 0, dy = 0) {
    const sourceData = source.context.imageData.data;
    for (let sy = 0; sy < source.height; sy += 1) {
      for (let sx = 0; sx < source.width; sx += 1) {
        const tx = sx + dx;
        const ty = sy + dy;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const targetOffset = (ty * this.width + tx) * 4;
        this.imageData.data.set(sourceData.slice(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }
}

class FakeOffscreenCanvas {
  readonly context: FakeCanvasContext;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeImageData(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { width, height, data } as ImageData;
}

function alphaAt(imageData: ImageData, x: number, y: number): number {
  return imageData.data[(y * imageData.width + x) * 4 + 3] ?? 0;
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  canvas.context.imageData.data.set(rgba, offset);
}

function getPixel(bitmap: LayerBitmap, x: number, y: number): [number, number, number, number] {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  return [
    canvas.context.imageData.data[offset] ?? 0,
    canvas.context.imageData.data[offset + 1] ?? 0,
    canvas.context.imageData.data[offset + 2] ?? 0,
    canvas.context.imageData.data[offset + 3] ?? 0,
  ];
}

function pointerEvent(): PointerEvent {
  return {
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
  } as PointerEvent;
}

function makeLayer(bitmap: LayerBitmap): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 10,
    y: 20,
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

function makeEnv(doc: ImageDocument, layer: ImageLayer): ToolEnv {
  return {
    doc,
    activeLayer: layer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    selectionToolSettings: {
      ...DEFAULT_SELECTION_TOOL_SETTINGS,
      magicWandTolerance: 5,
      contiguous: true,
    },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: vi.fn(),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store: {
      quickMaskSettings: {
        enabled: false,
        viewMode: 'maskedAreas',
        overlayOpacity: 0.5,
      },
      updateLayer: vi.fn(),
      bumpLayerBitmapVersion: vi.fn(),
      markDocumentDirty: vi.fn(),
    } as unknown as ToolEnv['store'],
  };
}

function makeDoc(layer: ImageLayer): ImageDocument {
  return {
    id: 'doc-magic-eraser',
    title: 'Magic Eraser',
    width: 40,
    height: 40,
    layers: [layer],
    activeLayerId: layer.id,
    activeLayerEditTarget: 'layer',
    activeColorChannel: 'rgb',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  } satisfies ImageDocument;
}

describe('Magic Eraser pixel removal', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    clearAllSelections();
  });

  it('clears only contiguous matching pixels from ImageData alpha', () => {
    const imageData = makeImageData(4, 2, [
      [255, 0, 0, 255],
      [253, 0, 0, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 255],
      [252, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 128],
    ]);

    const result = applyMagicEraserToImageData(imageData, { x: 0, y: 0 }, {
      tolerance: 5,
      contiguous: true,
    });

    expect(result).toMatchObject({
      removedPixels: 3,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      seedColor: { r: 255, g: 0, b: 0, a: 255 },
      tolerance: 5,
      contiguous: true,
    });
    expect(alphaAt(imageData, 0, 0)).toBe(0);
    expect(alphaAt(imageData, 1, 0)).toBe(0);
    expect(alphaAt(imageData, 0, 1)).toBe(0);
    expect(alphaAt(imageData, 3, 0)).toBe(255);
    expect(alphaAt(imageData, 3, 1)).toBe(128);
    expect(imageData.data.slice(0, 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 0]));
    expect(result.edgeSummary).toEqual({
      matchingMetric: 'rgb-euclidean-distance',
      tolerance: 5,
      matchingScope: 'contiguous',
      connectivity: 4,
      edgeMode: 'hard-alpha-cutout',
      antiAlias: false,
      fringePixels: 0,
      edgeCleanupPixels: 0,
      rgbPreserved: true,
      alphaClearValue: 0,
      boundsSignature: '0,0,2,2',
    });
    expect(result.signature).toBe('magic-eraser:v1:4x2:0,0:5:contiguous:3:0,0,2,2');
  });

  it('clears all matching pixels when contiguous matching is disabled', () => {
    const imageData = makeImageData(4, 2, [
      [255, 0, 0, 255],
      [253, 0, 0, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 255],
      [252, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 128],
    ]);

    const result = applyMagicEraserToImageData(imageData, { x: 0, y: 0 }, {
      tolerance: 5,
      contiguous: false,
    });

    expect(result.removedPixels).toBe(5);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(alphaAt(imageData, 3, 0)).toBe(0);
    expect(alphaAt(imageData, 3, 1)).toBe(0);
    expect(result.signature).toBe('magic-eraser:v1:4x2:0,0:5:global:5:0,0,4,2');
  });

  it('softens the immediate alpha edge when edge cleanup is requested', () => {
    const imageData = makeImageData(3, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);

    const result = applyMagicEraserToImageData(imageData, { x: 0, y: 0 }, {
      tolerance: 5,
      contiguous: true,
      edgeCleanup: true,
    });

    expect(result.removedPixels).toBe(1);
    expect(alphaAt(imageData, 0, 0)).toBe(0);
    expect(alphaAt(imageData, 1, 0)).toBe(207);
    expect(alphaAt(imageData, 2, 0)).toBe(255);
    expect(result.edgeSummary).toMatchObject({
      edgeMode: 'one-pixel-alpha-fringe',
      antiAlias: true,
      fringePixels: 1,
      edgeCleanupPixels: 1,
      rgbPreserved: true,
    });
    expect(result.signature).toBe('magic-eraser:v1:3x1:0,0:5:contiguous:1:0,0,1,1:edge-cleanup-1');
  });

  it('applies Magic Eraser as an undoable active-layer alpha edit', () => {
    const bitmap = new OffscreenCanvas(4, 2) as LayerBitmap;
    setPixel(bitmap, 0, 0, [255, 0, 0, 255]);
    setPixel(bitmap, 1, 0, [253, 0, 0, 255]);
    setPixel(bitmap, 2, 0, [0, 0, 255, 255]);
    setPixel(bitmap, 3, 0, [255, 0, 0, 255]);
    setPixel(bitmap, 0, 1, [252, 0, 0, 255]);
    setPixel(bitmap, 1, 1, [0, 0, 255, 255]);
    setPixel(bitmap, 2, 1, [0, 0, 255, 255]);
    setPixel(bitmap, 3, 1, [255, 0, 0, 128]);
    const layer = makeLayer(bitmap);
    const doc = makeDoc(layer);
    const env = makeEnv(doc, layer);

    magicEraserTool.onPointerDown?.(env, { x: 10, y: 20 }, mods, pointerEvent());

    expect(getPixel(bitmap, 0, 0)[3]).toBe(0);
    expect(getPixel(bitmap, 1, 0)[3]).toBe(0);
    expect(getPixel(bitmap, 2, 0)[3]).toBe(207);
    expect(getPixel(bitmap, 0, 1)[3]).toBe(0);
    expect(getPixel(bitmap, 3, 0)[3]).toBe(255);
    expect(env.pushOperation).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'paint',
      docId: doc.id,
      layerId: layer.id,
      before: expect.objectContaining({ width: 4, height: 2 }),
      after: expect.objectContaining({ width: 4, height: 2 }),
    }));
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, layer.id);
    expect(env.store.markDocumentDirty).toHaveBeenCalledWith(doc.id);
    expect(env.requestRender).toHaveBeenCalledTimes(1);
  });

  it('clips a matching erase to the active document selection and replays its real undo/redo stack entry', () => {
    const bitmap = new OffscreenCanvas(4, 1) as LayerBitmap;
    setPixel(bitmap, 0, 0, [255, 0, 0, 255]);
    setPixel(bitmap, 1, 0, [255, 0, 0, 255]);
    setPixel(bitmap, 2, 0, [255, 0, 0, 255]);
    setPixel(bitmap, 3, 0, [0, 0, 255, 255]);
    const layer = makeLayer(bitmap);
    const doc = makeDoc(layer);
    const env = makeEnv(doc, layer);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
    useImageEditorStore.getState().openDocument(doc);
    env.store = useImageEditorStore.getState();
    env.pushOperation = env.store.pushOperation;
    const selection = createMask(doc.width, doc.height);
    selection.data[layer.y * selection.width + layer.x] = 255;
    setSelection(doc.id, selection);

    magicEraserTool.onPointerDown?.(env, { x: layer.x, y: layer.y }, mods, pointerEvent());

    expect(getPixel(bitmap, 0, 0)).toEqual([255, 0, 0, 0]);
    expect(getPixel(bitmap, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(bitmap, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(bitmap, 3, 0)).toEqual([0, 0, 255, 255]);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().redoStacks[doc.id] ?? []).toHaveLength(0);
    expect(undo(doc.id)).toBe(true);
    const undoBitmap = useImageEditorStore.getState().documents[0]?.layers[0]?.bitmap;
    expect(undoBitmap).toBeTruthy();
    expect(getPixel(undoBitmap!, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(useImageEditorStore.getState().undoStacks[doc.id] ?? []).toHaveLength(0);
    expect(useImageEditorStore.getState().redoStacks[doc.id]).toHaveLength(1);

    expect(redo(doc.id)).toBe(true);
    const redoBitmap = useImageEditorStore.getState().documents[0]?.layers[0]?.bitmap;
    expect(redoBitmap).toBeTruthy();
    expect(getPixel(redoBitmap!, 0, 0)).toEqual([255, 0, 0, 0]);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().redoStacks[doc.id] ?? []).toHaveLength(0);
  });

  it('fails closed above the deterministic Magic Eraser pixel limit without reading or mutating buffers', () => {
    const oversized = {
      width: MAX_MAGIC_ERASER_PIXELS + 1,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255]),
    } as ImageData;

    expect(isMagicEraserResourceBounded(MAX_MAGIC_ERASER_PIXELS, 1)).toBe(true);
    expect(isMagicEraserResourceBounded(MAX_MAGIC_ERASER_PIXELS + 1, 1)).toBe(false);
    const result = applyMagicEraserToImageData(oversized, { x: 0, y: 0 });

    expect(result.removedPixels).toBe(0);
    expect(result.resourceLimit).toEqual({
      maxPixels: MAX_MAGIC_ERASER_PIXELS,
      pixelCount: MAX_MAGIC_ERASER_PIXELS + 1,
      exceeded: true,
    });
    expect(result.signature).toContain(':pixel-limit');
    expect(Array.from(oversized.data)).toEqual([255, 0, 0, 255]);
  });

  it('does not mutate RGB channel edit targets because Magic Eraser clears alpha only', () => {
    const bitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
    setPixel(bitmap, 0, 0, [255, 0, 0, 255]);
    setPixel(bitmap, 1, 0, [255, 0, 0, 255]);
    const layer = makeLayer(bitmap);
    const doc = {
      ...makeDoc(layer),
      activeColorChannel: 'red',
    } satisfies ImageDocument;
    const env = makeEnv(doc, layer);

    magicEraserTool.onPointerDown?.(env, { x: 10, y: 20 }, mods, pointerEvent());

    expect(getPixel(bitmap, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(env.pushOperation).not.toHaveBeenCalled();
  });
});
