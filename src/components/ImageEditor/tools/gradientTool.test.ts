import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushSettings, GradientToolSettings, LayerBitmap, SelectionToolSettings } from '../../../types/imageEditor';
import { describeGradientToolParity } from './gradientTool';
import type { ToolEnv } from './types';

class FakeCanvasContext {
  readonly imageData: ImageData;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
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

  save() {}
  restore() {}
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
        const tx = sx + dx;
        const ty = sy + dy;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const targetOffset = (ty * this.width + tx) * 4;
        this.imageData.data[targetOffset] = sourceData[sourceOffset];
        this.imageData.data[targetOffset + 1] = sourceData[sourceOffset + 1];
        this.imageData.data[targetOffset + 2] = sourceData[sourceOffset + 2];
        this.imageData.data[targetOffset + 3] = sourceData[sourceOffset + 3];
      }
    }
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  readonly context: FakeCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext(width, height);
  }

  getContext() {
    return this.context;
  }
}

function getPixel(bitmap: LayerBitmap, x: number, y: number): [number, number, number, number] {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  return [
    canvas.context.imageData.data[offset],
    canvas.context.imageData.data[offset + 1],
    canvas.context.imageData.data[offset + 2],
    canvas.context.imageData.data[offset + 3],
  ];
}

const brushSettings: BrushSettings = {
  size: 12,
  opacity: 1,
  hardness: 1,
  flow: 1,
  color: '#00ff00',
  spacing: 0.2,
  angleDeg: 0,
  roundness: 1,
  scatter: 0,
  smoothing: 0,
  pressureSize: 0,
  pressureOpacity: 0,
  pressureFlow: 0,
  tipShape: 'round',
};

const selectionToolSettings: SelectionToolSettings = {
  mode: 'replace',
  feather: 0,
  antiAlias: true,
  marqueeShape: 'rectangle',
  lassoShape: 'freehand',
  magicWandTolerance: 0,
  sampleAllLayers: true,
  contiguous: true,
  paintBucketBlendMode: 'normal',
  paintBucketPreserveTransparency: false,
};

const gradientToolSettings: GradientToolSettings = {
  mode: 'linear',
  colorMode: 'foregroundToBackground',
  reverse: true,
  dither: false,
};

describe('gradientTool', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('uses background color and reverse settings when painting a gradient stroke', async () => {
    const { gradientTool } = await import('./gradientTool');
    const bitmap = new OffscreenCanvas(3, 1) as LayerBitmap;
    const activeLayer = {
      id: 'active',
      name: 'Active',
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
    } as ToolEnv['activeLayer'];
    const pushOperation = vi.fn();
    const env = {
      doc: {
        id: 'doc-gradient',
        title: 'Gradient',
        width: 3,
        height: 1,
        layers: [activeLayer],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer,
      backgroundColor: '#0000ff',
      brushSettings,
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      gradientToolSettings,
      selectionToolSettings,
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation,
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        updateLayer: vi.fn(),
        bumpLayerBitmapVersion: vi.fn(),
        markDocumentDirty: vi.fn(),
      },
    } as unknown as ToolEnv;

    gradientTool.onPointerDown?.(env, { x: 0, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);
    gradientTool.onPointerUp?.(env, { x: 2, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    const left = getPixel(bitmap, 0, 0);
    const right = getPixel(bitmap, 2, 0);

    expect(left[2]).toBeGreaterThan(left[1]);
    expect(right[1]).toBeGreaterThan(right[2]);
    expect(pushOperation).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'paint',
      docId: 'doc-gradient',
      layerId: 'active',
    }));
  });

  it('uses persisted multi-stop colors when painting a gradient stroke', async () => {
    const { gradientTool } = await import('./gradientTool');
    const bitmap = new OffscreenCanvas(5, 1) as LayerBitmap;
    const activeLayer = {
      id: 'active',
      name: 'Active',
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
    } as ToolEnv['activeLayer'];
    const env = {
      doc: {
        id: 'doc-gradient-stops',
        title: 'Gradient Stops',
        width: 5,
        height: 1,
        layers: [activeLayer],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer,
      backgroundColor: '#0000ff',
      brushSettings,
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      gradientToolSettings: {
        mode: 'linear',
        colorMode: 'multiStop',
        reverse: false,
        colorStops: [
          { offset: 0, color: '#ff0000' },
          { offset: 0.5, color: '#00ff00' },
          { offset: 1, color: '#0000ff' },
        ],
        dither: false,
      } as GradientToolSettings & {
        colorStops: Array<{ offset: number; color: string }>;
      },
      selectionToolSettings,
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: vi.fn(),
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        updateLayer: vi.fn(),
        bumpLayerBitmapVersion: vi.fn(),
        markDocumentDirty: vi.fn(),
      },
    } as unknown as ToolEnv;

    gradientTool.onPointerDown?.(env, { x: 0, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);
    gradientTool.onPointerUp?.(env, { x: 4, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    expect(getPixel(bitmap, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(bitmap, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(bitmap, 4, 0)).toEqual([0, 0, 255, 255]);
  });

  it('applies reflected gradients symmetrically around the drag origin', async () => {
    const { gradientTool } = await import('./gradientTool');
    const bitmap = new OffscreenCanvas(5, 1) as LayerBitmap;
    const activeLayer = {
      id: 'active',
      name: 'Active',
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
    } as ToolEnv['activeLayer'];
    const env = {
      doc: {
        id: 'doc-gradient-reflected',
        title: 'Reflected Gradient',
        width: 5,
        height: 1,
        layers: [activeLayer],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer,
      backgroundColor: '#0000ff',
      brushSettings: { ...brushSettings, color: '#ff0000' },
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      gradientToolSettings: {
        mode: 'reflected',
        colorMode: 'foregroundToBackground',
        reverse: false,
        dither: false,
      } as GradientToolSettings,
      selectionToolSettings,
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: vi.fn(),
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        updateLayer: vi.fn(),
        bumpLayerBitmapVersion: vi.fn(),
        markDocumentDirty: vi.fn(),
      },
    } as unknown as ToolEnv;

    gradientTool.onPointerDown?.(env, { x: 2, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);
    gradientTool.onPointerUp?.(env, { x: 4, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    expect(getPixel(bitmap, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(bitmap, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(bitmap, 4, 0)).toEqual([0, 0, 255, 255]);
  });

  it('applies diamond gradients across both axes from the drag origin', async () => {
    const { gradientTool } = await import('./gradientTool');
    const bitmap = new OffscreenCanvas(5, 5) as LayerBitmap;
    const activeLayer = {
      id: 'active',
      name: 'Active',
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
    } as ToolEnv['activeLayer'];
    const env = {
      doc: {
        id: 'doc-gradient-diamond',
        title: 'Diamond Gradient',
        width: 5,
        height: 5,
        layers: [activeLayer],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer,
      backgroundColor: '#0000ff',
      brushSettings: { ...brushSettings, color: '#ff0000' },
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      gradientToolSettings: {
        mode: 'diamond',
        colorMode: 'foregroundToBackground',
        reverse: false,
        dither: false,
      } as GradientToolSettings,
      selectionToolSettings,
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: vi.fn(),
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        updateLayer: vi.fn(),
        bumpLayerBitmapVersion: vi.fn(),
        markDocumentDirty: vi.fn(),
      },
    } as unknown as ToolEnv;

    gradientTool.onPointerDown?.(env, { x: 2, y: 2 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);
    gradientTool.onPointerUp?.(env, { x: 4, y: 2 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    expect(getPixel(bitmap, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(bitmap, 4, 2)).toEqual([0, 0, 255, 255]);
    expect(getPixel(bitmap, 2, 4)).toEqual([0, 0, 255, 255]);
    expect(getPixel(bitmap, 3, 2)[0]).toBeGreaterThan(0);
    expect(getPixel(bitmap, 3, 2)[2]).toBeGreaterThan(0);
  });

  it('applies angle gradients around the drag origin', async () => {
    const { gradientTool } = await import('./gradientTool');
    const bitmap = new OffscreenCanvas(3, 3) as LayerBitmap;
    const activeLayer = {
      id: 'active',
      name: 'Active',
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
    } as ToolEnv['activeLayer'];
    const env = {
      doc: {
        id: 'doc-gradient-angle',
        title: 'Angle Gradient',
        width: 3,
        height: 3,
        layers: [activeLayer],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer,
      backgroundColor: '#0000ff',
      brushSettings: { ...brushSettings, color: '#ff0000' },
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      gradientToolSettings: {
        mode: 'angle',
        colorMode: 'foregroundToBackground',
        reverse: false,
        dither: false,
      } as GradientToolSettings,
      selectionToolSettings,
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: vi.fn(),
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        updateLayer: vi.fn(),
        bumpLayerBitmapVersion: vi.fn(),
        markDocumentDirty: vi.fn(),
      },
    } as unknown as ToolEnv;

    gradientTool.onPointerDown?.(env, { x: 1, y: 1 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);
    gradientTool.onPointerUp?.(env, { x: 2, y: 1 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    expect(getPixel(bitmap, 2, 1)[0]).toBeGreaterThan(getPixel(bitmap, 2, 1)[2]);
    expect(getPixel(bitmap, 1, 0)[2]).toBeGreaterThan(getPixel(bitmap, 1, 0)[0]);
  });

  it('builds deterministic gradient tool parity metadata for portable reversed presets', () => {
    const descriptor = describeGradientToolParity({
      settings: {
        mode: 'linear',
        colorMode: 'multiStop',
        reverse: true,
        dither: false,
        colorStops: [
          { offset: 0, color: '#111111', opacity: 0.25 },
          { offset: 0.6, color: '#eeeeee', opacity: 1 },
          { offset: 1, color: '#336699', opacity: 0.5 },
        ],
      },
      foregroundColor: '#ff0000',
      backgroundColor: '#0000ff',
      brushOpacity: 0.8,
      previewFrom: { x: 0, y: 0 },
      previewTo: { x: 100, y: 0 },
      presetId: 'user-metal',
    });

    expect(descriptor).toEqual({
      descriptorId: 'image-gradient-tool:v1',
      version: 1,
      presetId: 'user-metal',
      mode: 'linear',
      colorMode: 'multiStop',
      behavior: {
        foregroundToTransparent: false,
        reverse: true,
        dither: false,
        alphaStops: true,
      },
      presetPortability: {
        portable: true,
        format: 'signal-loom-gradient-preset:v1',
        stopCount: 3,
        warnings: [],
      },
      fill: expect.objectContaining({
        descriptorId: 'image-gradient-fill:v1',
        kind: 'custom-multi-stop',
        preview: {
          id: 'gradient-preview:linear:custom-multi-stop:0,0:100,0:3',
          signature: 'image-gradient-fill:v1|linear|custom-multi-stop|0,0|100,0|0:#336699@0.4|0.4:#eeeeee@0.8|1:#111111@0.2|alpha:0.8/0.8|dither:false',
        },
      }),
      preview: {
        id: 'gradient-tool-preview:user-metal:linear:multiStop:reverse',
        signature: 'image-gradient-tool:v1|user-metal|linear|multiStop|reverse:true|dither:false|image-gradient-fill:v1|linear|custom-multi-stop|0,0|100,0|0:#336699@0.4|0.4:#eeeeee@0.8|1:#111111@0.2|alpha:0.8/0.8|dither:false',
      },
      sourceBin: {
        presetSignature: 'signal-loom-gradient-preset:v1|user-metal|linear|multiStop|reverse:true|dither:false|stops:0:#336699@0.4|0.4:#eeeeee@0.8|1:#111111@0.2',
        exportSignature: 'image-gradient-tool-export:v1|preset:user-metal|fill:image-gradient-fill:v1|linear|custom-multi-stop|0,0|100,0|0:#336699@0.4|0.4:#eeeeee@0.8|1:#111111@0.2|alpha:0.8/0.8|dither:false|native-layer:false',
        caveats: [
          'Source Bin handoff stores normalized raster gradient metadata and preview signatures, not editable native gradient layers.',
          'Exports flatten the rendered gradient stroke into layer pixels before downstream reuse.',
        ],
      },
      unsupported: [
        { feature: 'mesh-gradient', status: 'unsupported', caveat: 'Mesh gradients are not available in the Gradient tool.' },
        { feature: 'noise-gradient', status: 'unsupported', caveat: 'Noise gradients are not available in the Gradient tool.' },
      ],
      caveats: [
        'Gradient tool strokes rasterize into the active pixel layer and do not remain editable gradient objects.',
        'Dither is available but disabled for this stroke.',
      ],
    });
  });

  it('reports dithered saved presets as first-class supported gradient tool behavior', () => {
    const descriptor = describeGradientToolParity({
      settings: {
        mode: 'linear',
        colorMode: 'multiStop',
        reverse: false,
        dither: true,
        presetId: 'warm-sunset',
        colorStops: [
          { offset: 0, color: '#2d1b69', opacity: 1 },
          { offset: 0.35, color: '#f97316', opacity: 0.8 },
          { offset: 1, color: '#fde68a', opacity: 0.45 },
        ],
      } as GradientToolSettings & { dither: boolean; presetId: string },
      foregroundColor: '#ff0000',
      backgroundColor: '#0000ff',
      brushOpacity: 0.75,
      previewFrom: { x: 0, y: 0 },
      previewTo: { x: 100, y: 0 },
    });

    expect(descriptor.presetId).toBe('warm-sunset');
    expect(descriptor.behavior.dither).toBe(true);
    expect(descriptor.behavior.alphaStops).toBe(true);
    expect(descriptor.presetPortability).toMatchObject({
      portable: true,
      format: 'signal-loom-gradient-preset:v1',
      stopCount: 3,
    });
    expect(descriptor.preview.signature).toContain('dither:true');
    expect(descriptor.fill.capabilities.dither).toBe(true);
    expect(descriptor.caveats).not.toContain('Dither is reported as unsupported metadata; renderer output is deterministic and undithered.');
  });

  it('emits source-bin handoff signatures without claiming editable native gradient layers', () => {
    const descriptor = describeGradientToolParity({
      settings: {
        mode: 'angle',
        colorMode: 'multiStop',
        reverse: true,
        dither: true,
        presetId: 'aurora-angle',
        colorStops: [
          { offset: 0, color: '#220044', opacity: 0.9 },
          { offset: 0.4, color: '#44ffaa', opacity: 0.5 },
          { offset: 1, color: '#ffffff', opacity: 0.2 },
        ],
      } as GradientToolSettings & { dither: boolean; presetId: string },
      foregroundColor: '#ff0000',
      backgroundColor: '#0000ff',
      brushOpacity: 0.6,
      previewFrom: { x: 10, y: 12 },
      previewTo: { x: 70, y: 44 },
    });

    expect(descriptor.sourceBin).toEqual({
      presetSignature: 'signal-loom-gradient-preset:v1|aurora-angle|angle|multiStop|reverse:true|dither:true|stops:0:#ffffff@0.12|0.6:#44ffaa@0.3|1:#220044@0.54',
      exportSignature: 'image-gradient-tool-export:v1|preset:aurora-angle|fill:image-gradient-fill:v1|angle|custom-multi-stop|10,12|70,44|0:#ffffff@0.12|0.6:#44ffaa@0.3|1:#220044@0.54|alpha:0.6/0.6|dither:true|native-layer:false',
      caveats: [
        'Source Bin handoff stores normalized raster gradient metadata and preview signatures, not editable native gradient layers.',
        'Exports flatten the rendered gradient stroke into layer pixels before downstream reuse.',
      ],
    });
    expect(descriptor.caveats).toContain(
      'Gradient tool strokes rasterize into the active pixel layer and do not remain editable gradient objects.',
    );
  });
});
