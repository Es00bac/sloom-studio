import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_RETOUCH_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type ImageDocument,
  type ImageLayer,
  type LayerBitmap,
  type RetouchToolSettings,
} from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import { spongeSaturateBrushTool } from './spongeBrushTool';
import * as ImageRetouch from '../ImageRetouch';

const mods = { shift: false, alt: false, ctrl: false, meta: false };

class FakeCanvasContext {
  readonly imageData: ImageData;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
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

  drawImage(source: FakeOffscreenCanvas, dx: number, dy: number) {
    const sourceData = source.context.imageData.data;
    for (let sy = 0; sy < source.height; sy += 1) {
      for (let sx = 0; sx < source.width; sx += 1) {
        const targetX = sx + dx;
        const targetY = sy + dy;
        if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const targetOffset = (targetY * this.width + targetX) * 4;
        this.imageData.data[targetOffset] = sourceData[sourceOffset] ?? 0;
        this.imageData.data[targetOffset + 1] = sourceData[sourceOffset + 1] ?? 0;
        this.imageData.data[targetOffset + 2] = sourceData[sourceOffset + 2] ?? 0;
        this.imageData.data[targetOffset + 3] = sourceData[sourceOffset + 3] ?? 0;
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

function pointerEvent(): PointerEvent {
  return {
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
  } as PointerEvent;
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * bitmap.width + x) * 4;
  (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data.set(rgba, offset);
}

function getPixel(bitmap: LayerBitmap, x: number, y: number): [number, number, number, number] {
  const offset = (y * bitmap.width + x) * 4;
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
}

function makeLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(1, 1) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(layerOrLayers: ImageLayer | ImageLayer[], activeLayerId?: string): ImageDocument {
  const layers = Array.isArray(layerOrLayers) ? layerOrLayers : [layerOrLayers];
  const activeId = activeLayerId ?? layers[0]?.id ?? 'layer-1';
  return {
    id: 'doc-sponge',
    title: 'Sponge',
    width: 80,
    height: 1,
    layers,
    activeLayerId: activeId,
    activeLayerEditTarget: 'layer',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeEnv(
  doc: ImageDocument,
  activeLayer: ImageLayer,
  retouchToolSettings: RetouchToolSettings,
  brushSize = 1,
  storeOverrides: Partial<ToolEnv['store']> = {},
): ToolEnv {
  return {
    doc,
    activeLayer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS, size: brushSize, opacity: 0.5 },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    retouchToolSettings,
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: vi.fn(),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store: {
      setLayers: vi.fn(),
      bumpLayerBitmapVersion: vi.fn(),
      markDocumentDirty: vi.fn(),
      ...storeOverrides,
    } as unknown as ToolEnv['store'],
  };
}

function rgbLuminance([red, green, blue]: [number, number, number, number]): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

describe('spongeBrushTool retouch options', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('uses retouch settings for vibrance and luminosity preservation during real strokes', () => {
    const layer = makeLayer();
    setPixel(layer.bitmap!, 0, 0, [100, 150, 200, 255]);
    const doc = makeDoc(layer);
    const env = makeEnv(doc, layer, {
      ...DEFAULT_RETOUCH_TOOL_SETTINGS,
      spongeVibrance: 0,
      spongePreserveLuminosity: true,
    });
    const before = getPixel(layer.bitmap!, 0, 0);

    spongeSaturateBrushTool.onPointerDown?.(env, { x: 0, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerUp?.(env, { x: 0, y: 0 }, mods, pointerEvent());

    const after = getPixel(layer.bitmap!, 0, 0);
    expect(after[2] - after[0]).toBeGreaterThan(before[2] - before[0]);
    expect(Math.abs(rgbLuminance(after) - rgbLuminance(before))).toBeLessThanOrEqual(1);
  });

  it('retargets saturate strokes to a visible bitmap layer under the cursor when the active layer has no pixels', () => {
    const raster = makeLayer({ id: 'raster', name: 'Raster' });
    const activeVector = makeLayer({
      id: 'vector',
      name: 'Vector',
      type: 'vector',
      bitmap: undefined,
    });
    const originalPixel: [number, number, number, number] = [100, 150, 200, 255];
    setPixel(raster.bitmap!, 0, 0, originalPixel);
    const doc = makeDoc([raster, activeVector], activeVector.id);
    const env = makeEnv(doc, activeVector, {
      ...DEFAULT_RETOUCH_TOOL_SETTINGS,
      spongeVibrance: 0,
      spongePreserveLuminosity: true,
    });

    spongeSaturateBrushTool.onPointerDown?.(env, { x: 0, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerUp?.(env, { x: 0, y: 0 }, mods, pointerEvent());

    expect(getPixel(raster.bitmap!, 0, 0)).not.toEqual(originalPixel);
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, raster.id);
    expect(env.requestRender).toHaveBeenLastCalledWith({ invalidateBitmapCache: true });
  });

  it('restores sponge preview pixels when a stroke is canceled before commit', () => {
    const layer = makeLayer();
    const originalPixel: [number, number, number, number] = [100, 150, 200, 255];
    setPixel(layer.bitmap!, 0, 0, originalPixel);
    const doc = makeDoc(layer);
    const env = makeEnv(doc, layer, {
      ...DEFAULT_RETOUCH_TOOL_SETTINGS,
      spongeVibrance: 0,
      spongePreserveLuminosity: true,
    });

    spongeSaturateBrushTool.onPointerDown?.(env, { x: 0, y: 0 }, mods, pointerEvent());

    expect(getPixel(layer.bitmap!, 0, 0)).not.toEqual(originalPixel);

    spongeSaturateBrushTool.onCancel?.(env);

    expect(getPixel(layer.bitmap!, 0, 0)).toEqual(originalPixel);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('increases dab application count when airbrush and rate are enabled', () => {
	    const baselineApply = vi.spyOn(ImageRetouch, 'applySpongeBrushToBitmap');
	    const nonAirbrushLayer = makeLayer({ id: 'layer-non-airbrush' });
	    setPixel(nonAirbrushLayer.bitmap!, 0, 0, [100, 150, 200, 255]);
	    const baselineDoc = makeDoc(nonAirbrushLayer);
    const baselineEnv = makeEnv(baselineDoc, nonAirbrushLayer, {
      ...DEFAULT_RETOUCH_TOOL_SETTINGS,
      airbrush: false,
      rate: 0,
    }, 12);

    spongeSaturateBrushTool.onPointerDown?.(baselineEnv, { x: 0, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerMove?.(baselineEnv, { x: 24, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerUp?.(baselineEnv, { x: 24, y: 0 }, mods, pointerEvent());

    const baselineCallCount = baselineApply.mock.calls.length;
    baselineApply.mockClear();

    const airbrushLayer = makeLayer({ id: 'layer-airbrush' });
    setPixel(airbrushLayer.bitmap!, 0, 0, [100, 150, 200, 255]);
    const airbrushDoc = makeDoc(airbrushLayer);
    const airbrushEnv = makeEnv(airbrushDoc, airbrushLayer, {
      ...DEFAULT_RETOUCH_TOOL_SETTINGS,
      airbrush: true,
      rate: 1,
    }, 12);

    spongeSaturateBrushTool.onPointerDown?.(airbrushEnv, { x: 0, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerMove?.(airbrushEnv, { x: 24, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerUp?.(airbrushEnv, { x: 24, y: 0 }, mods, pointerEvent());

    expect(baselineApply.mock.calls.length).toBeGreaterThan(0);
    expect(baselineCallCount).toBeLessThan(baselineApply.mock.calls.length);
  });

  it('commits saturate strokes to a generated non-destructive retouch layer when requested', () => {
    const layer = makeLayer({ id: 'base-layer', name: 'Base Layer' });
    const originalPixel: [number, number, number, number] = [100, 150, 200, 255];
    setPixel(layer.bitmap!, 0, 0, originalPixel);
    const doc = makeDoc(layer);
    const setLayers = vi.fn((docId: string, layers: ImageLayer[], activeLayerId?: string | null) => {
      expect(docId).toBe(doc.id);
      doc.layers = layers;
      doc.activeLayerId = activeLayerId ?? doc.activeLayerId;
    });
    const env = makeEnv(doc, layer, {
      ...DEFAULT_RETOUCH_TOOL_SETTINGS,
      outputMode: 'newLayer',
      spongeVibrance: 0,
      spongePreserveLuminosity: true,
    } as RetouchToolSettings, 1, { setLayers } as Partial<ToolEnv['store']>);

    spongeSaturateBrushTool.onPointerDown?.(env, { x: 0, y: 0 }, mods, pointerEvent());
    spongeSaturateBrushTool.onPointerUp?.(env, { x: 0, y: 0 }, mods, pointerEvent());

    expect(getPixel(layer.bitmap!, 0, 0)).toEqual(originalPixel);
    expect(setLayers).toHaveBeenCalled();
    const committedLayers = setLayers.mock.calls.at(-1)?.[1] as ImageLayer[];
    const retouchLayer = committedLayers.find((candidate) => candidate.id !== layer.id);
    expect(retouchLayer).toBeTruthy();
    expect(committedLayers.map((candidate) => candidate.id)).toEqual([layer.id, retouchLayer?.id]);
    expect(retouchLayer?.name).toContain('Saturate');
    expect(retouchLayer?.metadata?.retouchOutput).toMatchObject({
      sourceLayerId: layer.id,
      tool: 'spongeSaturate',
      outputMode: 'newLayer',
    });
    expect(getPixel(retouchLayer!.bitmap!, 0, 0)).not.toEqual(originalPixel);
    expect(env.pushOperation).toHaveBeenCalledWith({
      kind: 'layerOp',
      docId: doc.id,
      before: [layer],
      after: committedLayers,
    });
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, retouchLayer?.id);
    expect(env.store.markDocumentDirty).toHaveBeenCalledWith(doc.id);
  });
});
