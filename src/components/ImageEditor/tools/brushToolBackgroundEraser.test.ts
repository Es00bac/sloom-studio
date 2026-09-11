import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
} from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import {
  applyBackgroundEraserToImageData,
  backgroundEraserTool,
} from './brushTool';

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

function makeDoc(layer: ImageLayer): ImageDocument {
  return {
    id: 'doc-background-eraser',
    title: 'Background Eraser',
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

function makeEnv(doc: ImageDocument, layer: ImageLayer): ToolEnv {
  return {
    doc,
    activeLayer: layer,
    backgroundColor: '#00ff00',
    brushSettings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 3,
      color: '#ff0000',
      smoothing: 0,
    },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    selectionToolSettings: {
      ...DEFAULT_SELECTION_TOOL_SETTINGS,
      backgroundEraserTolerance: 5,
      backgroundEraserContiguous: true,
      backgroundEraserSampling: 'once',
      backgroundEraserUseBackgroundSwatch: false,
      backgroundEraserLimits: 'contiguous',
      backgroundEraserProtectForeground: false,
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

describe('Background Eraser pixel removal', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('clears only brush-bounded contiguous background pixels from ImageData alpha', () => {
    const imageData = makeImageData(5, 3, [
      [0, 255, 0, 255],
      [0, 254, 0, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [0, 255, 0, 255],
      [0, 253, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [0, 255, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [0, 255, 0, 255],
    ]);

    const result = applyBackgroundEraserToImageData(imageData, { x: 1, y: 1 }, {
      brushSize: 3,
      tolerance: 5,
      contiguous: true,
      sampling: 'once',
      limits: 'contiguous',
      protectForeground: false,
    });

    expect(result).toMatchObject({
      removedPixels: 5,
      bounds: { x: 0, y: 0, width: 2, height: 3 },
      sampleColor: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 5,
      contiguous: true,
      sampling: 'once',
      limits: 'contiguous',
      protectForeground: false,
    });
    expect(alphaAt(imageData, 0, 0)).toBe(0);
    expect(alphaAt(imageData, 1, 0)).toBe(0);
    expect(alphaAt(imageData, 0, 1)).toBe(0);
    expect(alphaAt(imageData, 1, 1)).toBe(0);
    expect(alphaAt(imageData, 0, 2)).toBe(0);
    expect(alphaAt(imageData, 3, 1)).toBe(255);
    expect(imageData.data.slice((1 * imageData.width + 1) * 4, (1 * imageData.width + 1) * 4 + 4)).toEqual(
      new Uint8ClampedArray([0, 255, 0, 0]),
    );
    expect(result.edgeSummary).toEqual({
      matchingMetric: 'rgb-euclidean-distance',
      tolerance: 5,
      matchingScope: 'brush-bounded-contiguous',
      sampleSource: 'pointer-sample',
      edgeMode: 'hard-alpha-cutout',
      antiAlias: false,
      fringePixels: 0,
      edgeCleanupPixels: 0,
      rgbPreserved: true,
      alphaClearValue: 0,
      boundsSignature: '0,0,2,3',
    });
    expect(result.signature).toBe('background-eraser:v1:5x3:1,1:3:5:contiguous:once:sample:unprotected:5:0,0,2,3');
  });

  it('uses the background swatch and protects foreground-colored pixels with bounded discontiguous limits', () => {
    const imageData = makeImageData(3, 1, [
      [0, 255, 0, 255],
      [255, 0, 0, 255],
      [0, 254, 0, 255],
    ]);

    const result = applyBackgroundEraserToImageData(imageData, { x: 1, y: 0 }, {
      brushSize: 5,
      tolerance: 5,
      contiguous: false,
      sampling: 'continuous',
      useBackgroundSwatch: true,
      backgroundColor: '#00ff00',
      foregroundColor: '#ff0000',
      limits: 'discontiguous',
      protectForeground: true,
    });

    expect(result.removedPixels).toBe(2);
    expect(alphaAt(imageData, 0, 0)).toBe(0);
    expect(alphaAt(imageData, 1, 0)).toBe(255);
    expect(alphaAt(imageData, 2, 0)).toBe(0);
    expect(result.sampleColor).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(result.signature).toBe('background-eraser:v1:3x1:1,0:5:5:discontiguous:continuous:swatch:protected:2:0,0,3,1');
  });

  it('softens the immediate alpha edge when edge cleanup is requested', () => {
    const imageData = makeImageData(3, 1, [
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);

    const result = applyBackgroundEraserToImageData(imageData, { x: 0, y: 0 }, {
      brushSize: 1,
      tolerance: 5,
      contiguous: true,
      sampling: 'once',
      limits: 'contiguous',
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
    expect(result.signature).toBe('background-eraser:v1:3x1:0,0:1:5:contiguous:once:sample:unprotected:1:0,0,1,1:edge-cleanup-1');
  });

  it('applies Background Eraser strokes as an undoable active-layer alpha edit', () => {
    const bitmap = new OffscreenCanvas(3, 1) as LayerBitmap;
    setPixel(bitmap, 0, 0, [0, 255, 0, 255]);
    setPixel(bitmap, 1, 0, [0, 254, 0, 255]);
    setPixel(bitmap, 2, 0, [0, 0, 255, 255]);
    const layer = makeLayer(bitmap);
    const doc = makeDoc(layer);
    const env = makeEnv(doc, layer);

    backgroundEraserTool.onPointerDown?.(env, { x: 10, y: 20 }, mods, pointerEvent());
    backgroundEraserTool.onPointerUp?.(env, { x: 10, y: 20 }, mods, pointerEvent());

    expect(getPixel(bitmap, 0, 0)[3]).toBe(0);
    expect(getPixel(bitmap, 1, 0)[3]).toBe(0);
    expect(getPixel(bitmap, 2, 0)[3]).toBe(207);
    expect(env.pushOperation).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'paint',
      docId: doc.id,
      layerId: layer.id,
      before: expect.objectContaining({ width: 3, height: 1 }),
      after: expect.objectContaining({ width: 3, height: 1 }),
    }));
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, layer.id);
    expect(env.store.markDocumentDirty).toHaveBeenCalledWith(doc.id);
    expect(env.requestRender).toHaveBeenCalled();
  });

  it('restores the exact pre-stroke bitmap, version, and dirty state when a stroke is canceled', () => {
    const bitmap = new OffscreenCanvas(3, 1) as LayerBitmap;
    setPixel(bitmap, 0, 0, [0, 255, 0, 255]);
    setPixel(bitmap, 1, 0, [0, 254, 0, 255]);
    setPixel(bitmap, 2, 0, [0, 0, 255, 255]);
    const layer = makeLayer(bitmap);
    const doc = makeDoc(layer);
    const env = makeEnv(doc, layer);
    const bitmapBeforeStroke = new Uint8ClampedArray(
      (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data,
    );

    backgroundEraserTool.onPointerDown?.(env, { x: 10, y: 20 }, mods, pointerEvent());

    expect(getPixel(bitmap, 0, 0)[3]).toBe(0);
    expect(getPixel(bitmap, 1, 0)[3]).toBe(0);
    expect(getPixel(bitmap, 2, 0)[3]).toBe(207);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.bumpLayerBitmapVersion).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();

    backgroundEraserTool.onCancel?.(env);
    backgroundEraserTool.onPointerUp?.(env, { x: 10, y: 20 }, mods, pointerEvent());

    expect(new Uint8ClampedArray((bitmap as unknown as FakeOffscreenCanvas).context.imageData.data))
      .toEqual(bitmapBeforeStroke);
    expect(getPixel(bitmap, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(bitmap, 1, 0)).toEqual([0, 254, 0, 255]);
    expect(getPixel(bitmap, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.bumpLayerBitmapVersion).not.toHaveBeenCalled();
    expect(layer.bitmapVersion).toBe(0);
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(doc.dirty).toBe(false);
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('does not mutate RGB channel, layer mask, or QuickMask edit targets', () => {
    const bitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
    setPixel(bitmap, 0, 0, [0, 255, 0, 255]);
    setPixel(bitmap, 1, 0, [0, 255, 0, 255]);
    const layer = makeLayer(bitmap);
    const rgbDoc = {
      ...makeDoc(layer),
      activeColorChannel: 'red',
    } satisfies ImageDocument;
    const rgbEnv = makeEnv(rgbDoc, layer);

    backgroundEraserTool.onPointerDown?.(rgbEnv, { x: 10, y: 20 }, mods, pointerEvent());
    backgroundEraserTool.onPointerUp?.(rgbEnv, { x: 10, y: 20 }, mods, pointerEvent());

    expect(getPixel(bitmap, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(rgbEnv.pushOperation).not.toHaveBeenCalled();

    const maskDoc = {
      ...makeDoc(layer),
      activeLayerEditTarget: 'mask',
    } satisfies ImageDocument;
    const maskEnv = makeEnv(maskDoc, layer);
    backgroundEraserTool.onPointerDown?.(maskEnv, { x: 10, y: 20 }, mods, pointerEvent());
    expect(maskEnv.pushOperation).not.toHaveBeenCalled();

    const quickMaskEnv = makeEnv(makeDoc(layer), layer);
    quickMaskEnv.store.quickMaskSettings.enabled = true;
    backgroundEraserTool.onPointerDown?.(quickMaskEnv, { x: 10, y: 20 }, mods, pointerEvent());
    expect(quickMaskEnv.pushOperation).not.toHaveBeenCalled();
  });
});
