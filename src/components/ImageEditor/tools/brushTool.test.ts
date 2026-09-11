import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
} from '../../../types/imageEditor';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { describeBrushAndEraserToolWorkflow, magicEraserTool } from './brushTool';
import type { ToolEnv } from './types';

describe('brush and eraser workflow descriptors', () => {
  it('describes supported local brush and eraser routes with deterministic preview metadata', () => {
    const descriptor = describeBrushAndEraserToolWorkflow({
      ...DEFAULT_BRUSH_SETTINGS,
      size: 24,
      opacity: 0.5,
      flow: 0.25,
      hardness: 0.75,
      smoothing: 0.4,
      pressureSize: 0.2,
      pressureFlow: 0.6,
      pressureAngle: 0.7,
      colorJitter: 0.3,
      symmetryMode: 'vertical',
    }, {
      activeRoute: 'layer-mask',
      channel: 'red',
      quickMaskEnabled: false,
      previewFrom: { x: 2, y: 3 },
      previewTo: { x: 34, y: 3 },
      pressure: 0.5,
      seed: 11,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'image-brush-eraser-workflow:v1',
      deterministic: true,
      tools: {
        brush: {
          status: 'supported',
          operation: 'paint-color',
          routes: {
            pixelLayer: { supported: true, channel: 'rgb', compositing: 'source-over' },
            rgbChannel: { supported: true, channel: 'red', compositing: 'source-over' },
            layerMask: { supported: true, brushTarget: 'reveal-or-conceal-from-color' },
            quickMask: { supported: true, brushTarget: 'selection-coverage-from-color' },
          },
        },
        eraser: {
          status: 'supported',
          operation: 'remove-pixels-or-reveal-masks',
          routes: {
            pixelLayer: { supported: true, channel: 'rgb', compositing: 'destination-out' },
            rgbChannel: { supported: true, channel: 'red', compositing: 'source-over-channel-route' },
            layerMask: { supported: true, brushTarget: 'conceal-mask' },
            quickMask: { supported: true, brushTarget: 'reveal-selection-coverage' },
          },
        },
        backgroundEraser: {
          status: 'partial',
          operation: 'brush-bounded-background-alpha-clear',
          routes: {
            pixelLayer: { supported: true, channel: 'rgb', compositing: 'alpha-clear' },
            rgbChannel: { supported: false },
            layerMask: { supported: false },
            quickMask: { supported: false },
          },
          sampling: {
            mode: 'once',
            source: 'pointer-sample',
          },
          tolerance: {
            value: 32,
            metric: 'rgb-euclidean-distance',
          },
          output: {
            target: 'active-pixel-layer-alpha',
            alpha: 0,
            undoable: true,
          },
        },
        magicEraser: {
          status: 'supported',
          operation: 'remove-contiguous-color-by-tolerance',
          tolerance: {
            value: 32,
            metric: 'rgb-euclidean-distance',
          },
          output: {
            target: 'active-pixel-layer-alpha',
            alpha: 0,
            undoable: true,
          },
        },
      },
      behavior: {
        opacity: { value: 0.5, affects: ['dab-alpha'] },
        flow: { value: 0.25, affects: ['dab-build-up'] },
        hardness: { value: 0.75, affects: ['dab-edge-falloff'] },
        smoothing: { value: 0.4, followFactor: 0.66 },
      },
      preview: {
        deterministic: true,
        from: { x: 2, y: 3 },
        to: { x: 34, y: 3 },
        seed: 11,
        channel: 'red',
        activeRoute: 'layer-mask',
      },
    });
    expect(descriptor.preview.signature).toBe('24:0.12:0.5:0.4:11:2,3->23.12,3:9');
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'background-eraser-heuristic-limits',
      'advanced-dynamics-unsupported',
      'advanced-dynamics-unsupported',
    ]);
    expect(descriptor.warnings.map((warning) => warning.field)).toEqual([
      undefined,
      'pressureAngle',
      'colorJitter',
    ]);
    expect(descriptor.signature).toBe(
      'image-brush-eraser-workflow:v1:{"toolStatus":{"brush":"supported","eraser":"supported","backgroundEraser":"partial","magicEraser":"supported"},"route":"layer-mask","channel":"red","quickMask":false,"settings":{"size":24,"opacity":0.5,"flow":0.25,"hardness":0.75,"smoothing":0.4,"symmetry":"vertical"},"preview":"24:0.12:0.5:0.4:11:2,3->23.12,3:9","warnings":["background-eraser-heuristic-limits","pressureAngle","colorJitter"]}',
    );
    expect(describeBrushAndEraserToolWorkflow({
      ...DEFAULT_BRUSH_SETTINGS,
      size: 24,
      opacity: 0.5,
      flow: 0.25,
      hardness: 0.75,
      smoothing: 0.4,
      pressureSize: 0.2,
      pressureFlow: 0.6,
      pressureAngle: 0.7,
      colorJitter: 0.3,
      symmetryMode: 'vertical',
    }, {
      activeRoute: 'layer-mask',
      channel: 'red',
      quickMaskEnabled: false,
      previewFrom: { x: 2, y: 3 },
      previewTo: { x: 34, y: 3 },
      pressure: 0.5,
      seed: 11,
    })).toEqual(descriptor);
  });

  it('describes bounded Background Eraser settings without claiming channel, mask, or QuickMask routes', () => {
    const descriptor = describeBrushAndEraserToolWorkflow(DEFAULT_BRUSH_SETTINGS, {
      activeRoute: 'pixel-layer',
      backgroundEraserTolerance: 18,
      backgroundEraserContiguous: false,
      backgroundEraserSampling: 'continuous',
      backgroundEraserUseBackgroundSwatch: true,
      backgroundEraserLimits: 'discontiguous',
      backgroundEraserProtectForeground: true,
      backgroundEraserForegroundColor: '#ff0000',
      backgroundEraserBackgroundColor: '#00ff00',
    });

    expect(descriptor.tools.backgroundEraser).toMatchObject({
      status: 'partial',
      operation: 'brush-bounded-background-alpha-clear',
      routes: {
        pixelLayer: {
          supported: true,
          active: true,
          channel: 'rgb',
          compositing: 'alpha-clear',
        },
        rgbChannel: { supported: false },
        layerMask: { supported: false },
        quickMask: { supported: false },
      },
      tolerance: {
        value: 18,
        metric: 'rgb-euclidean-distance',
      },
      matching: {
        scope: 'brush-bounded',
        contiguous: false,
        limits: 'discontiguous',
      },
      sampling: {
        mode: 'continuous',
        source: 'background-swatch',
      },
      protectForeground: {
        enabled: true,
        color: '#ff0000',
        semantics: 'heuristic-rgb-distance',
      },
      output: {
        target: 'active-pixel-layer-alpha',
        alpha: 0,
        undoable: true,
      },
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'background-eraser-heuristic-limits',
    ]);
    expect(descriptor.signature).toContain('"backgroundEraser":"partial"');
  });

  it('marks QuickMask as the active route when enabled while preserving channel route metadata', () => {
    const descriptor = describeBrushAndEraserToolWorkflow(DEFAULT_BRUSH_SETTINGS, {
      activeRoute: 'pixel-layer',
      channel: 'blue',
      quickMaskEnabled: true,
    });

    expect(descriptor.activeRoute).toBe('quick-mask');
    expect(descriptor.tools.brush.routes.quickMask.active).toBe(true);
    expect(descriptor.tools.eraser.routes.quickMask.active).toBe(true);
    expect(descriptor.tools.brush.routes.rgbChannel.channel).toBe('blue');
    expect(descriptor.signature).toContain('"route":"quick-mask"');
  });

  it('describes Magic Eraser tolerance and contiguous/global matching without claiming mask routes', () => {
    const contiguous = describeBrushAndEraserToolWorkflow(DEFAULT_BRUSH_SETTINGS, {
      activeRoute: 'pixel-layer',
      magicEraserTolerance: 18,
      magicEraserContiguous: true,
    });
    expect(contiguous.tools.magicEraser).toMatchObject({
      status: 'supported',
      operation: 'remove-contiguous-color-by-tolerance',
      routes: {
        pixelLayer: {
          supported: true,
          active: true,
          channel: 'rgb',
          compositing: 'alpha-clear',
        },
        rgbChannel: { supported: false },
        layerMask: { supported: false },
        quickMask: { supported: false },
      },
      tolerance: {
        value: 18,
        metric: 'rgb-euclidean-distance',
      },
      matching: {
        scope: 'contiguous',
        connectivity: 4,
      },
      output: {
        target: 'active-pixel-layer-alpha',
        alpha: 0,
        undoable: true,
      },
    });
    expect(contiguous.warnings.map((warning) => warning.code)).toEqual(['background-eraser-heuristic-limits']);
    expect(contiguous.signature).toContain('"magicEraser":"supported"');

    const global = describeBrushAndEraserToolWorkflow(DEFAULT_BRUSH_SETTINGS, {
      magicEraserTolerance: 6,
      magicEraserContiguous: false,
    });
    expect(global.tools.magicEraser.matching).toMatchObject({
      scope: 'global',
      connectivity: 'layer-wide',
    });
    expect(global.signature).toContain('"warnings":["background-eraser-heuristic-limits"]');
  });
});


class FakeMagicEraserCanvasContext {
  readonly imageData: ImageData;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = makeMagicEraserImageData(
      width,
      height,
      new Array(width * height).fill([0, 0, 0, 0]),
    );
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

  drawImage(source: FakeMagicEraserOffscreenCanvas, dx = 0, dy = 0) {
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

class FakeMagicEraserOffscreenCanvas {
  readonly context: FakeMagicEraserCanvasContext;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeMagicEraserCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeMagicEraserImageData(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { width, height, data } as ImageData;
}

function getMagicEraserPixel(
  bitmap: LayerBitmap,
  x: number,
  y: number,
): [number, number, number, number] {
  const canvas = bitmap as unknown as FakeMagicEraserOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  return [
    canvas.context.imageData.data[offset] ?? 0,
    canvas.context.imageData.data[offset + 1] ?? 0,
    canvas.context.imageData.data[offset + 2] ?? 0,
    canvas.context.imageData.data[offset + 3] ?? 0,
  ];
}

function setMagicEraserPixel(
  bitmap: LayerBitmap,
  x: number,
  y: number,
  rgba: [number, number, number, number],
) {
  const canvas = bitmap as unknown as FakeMagicEraserOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  canvas.context.imageData.data.set(rgba, offset);
}

function makeMagicEraserLayer(bitmap: LayerBitmap): ImageLayer {
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

function makeMagicEraserDoc(layer: ImageLayer): ImageDocument {
  return {
    id: 'doc-magic-eraser-guards',
    title: 'Magic Eraser Guards',
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

function makeMagicEraserEnv(doc: ImageDocument, layer: ImageLayer): ToolEnv {
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

describe('magicEraserTool guard regressions', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeMagicEraserOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not mutate pixels when the active edit target is the layer mask', () => {
    const bitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
    setMagicEraserPixel(bitmap, 0, 0, [255, 0, 0, 255]);
    setMagicEraserPixel(bitmap, 1, 0, [255, 0, 0, 255]);
    const layer = makeMagicEraserLayer(bitmap);
    const doc = {
      ...makeMagicEraserDoc(layer),
      activeLayerEditTarget: 'mask',
    } satisfies ImageDocument;
    const env = makeMagicEraserEnv(doc, layer);

    magicEraserTool.onPointerDown?.(env, { x: 10, y: 20 }, {
      shift: false,
      alt: false,
      ctrl: false,
      meta: false,
    }, {
      pointerType: 'mouse',
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
    } as PointerEvent);

    expect(getMagicEraserPixel(bitmap, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getMagicEraserPixel(bitmap, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.bumpLayerBitmapVersion).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
  });

  it('does not mutate pixels when QuickMask is active', () => {
    const bitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
    setMagicEraserPixel(bitmap, 0, 0, [255, 0, 0, 255]);
    setMagicEraserPixel(bitmap, 1, 0, [255, 0, 0, 255]);
    const layer = makeMagicEraserLayer(bitmap);
    const doc = makeMagicEraserDoc(layer);
    const env = makeMagicEraserEnv(doc, layer);
    env.store.quickMaskSettings.enabled = true;

    magicEraserTool.onPointerDown?.(env, { x: 10, y: 20 }, {
      shift: false,
      alt: false,
      ctrl: false,
      meta: false,
    }, {
      pointerType: 'mouse',
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
    } as PointerEvent);

    expect(getMagicEraserPixel(bitmap, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getMagicEraserPixel(bitmap, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.bumpLayerBitmapVersion).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
  });
});
