import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushSettings, LayerBitmap, SelectionToolSettings } from '../../../types/imageEditor';
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
        const alpha = (sourceData[sourceOffset + 3] / 255) * this.globalAlpha;
        if (alpha <= 0) continue;
        const inverse = 1 - alpha;
        this.imageData.data[targetOffset] = Math.round(sourceData[sourceOffset] * alpha + this.imageData.data[targetOffset] * inverse);
        this.imageData.data[targetOffset + 1] = Math.round(sourceData[sourceOffset + 1] * alpha + this.imageData.data[targetOffset + 1] * inverse);
        this.imageData.data[targetOffset + 2] = Math.round(sourceData[sourceOffset + 2] * alpha + this.imageData.data[targetOffset + 2] * inverse);
        this.imageData.data[targetOffset + 3] = Math.round((alpha + (this.imageData.data[targetOffset + 3] / 255) * inverse) * 255);
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

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  canvas.context.imageData.data[offset] = rgba[0];
  canvas.context.imageData.data[offset + 1] = rgba[1];
  canvas.context.imageData.data[offset + 2] = rgba[2];
  canvas.context.imageData.data[offset + 3] = rgba[3];
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

function makeSettings(overrides: Partial<{
  sampleAllLayers: boolean;
  contiguous: boolean;
  tolerance: number;
  antiAlias: boolean;
  paintBucketBlendMode: SelectionToolSettings['paintBucketBlendMode'];
  paintBucketPreserveTransparency: boolean;
}> = {}): SelectionToolSettings {
  return {
    mode: 'replace',
    feather: 0,
    antiAlias: overrides.antiAlias ?? true,
    marqueeShape: 'rectangle',
    lassoShape: 'freehand',
    magicWandTolerance: overrides.tolerance ?? 0,
    sampleAllLayers: overrides.sampleAllLayers ?? true,
    contiguous: overrides.contiguous ?? true,
    paintBucketBlendMode: overrides.paintBucketBlendMode ?? 'normal',
    paintBucketPreserveTransparency: overrides.paintBucketPreserveTransparency ?? false,
  } as unknown as SelectionToolSettings;
}

describe('paintBucketTool', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('uses the composite sample source when sample-all-layers is enabled', async () => {
    const { paintBucketTool } = await import('./paintBucketTool');
    const background = new OffscreenCanvas(2, 1) as LayerBitmap;
    setPixel(background, 0, 0, [255, 0, 0, 255]);
    setPixel(background, 1, 0, [0, 0, 255, 255]);
    const activeBitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
    const activeLayer = { id: 'active', name: 'Active', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: activeBitmap, bitmapVersion: 0, mask: null } as ToolEnv['activeLayer'];
    const env = {
      doc: {
        id: 'doc-bucket',
        title: 'Bucket',
        width: 2,
        height: 1,
        layers: [
          { id: 'bg', name: 'Background', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: background, bitmapVersion: 0, mask: null },
          activeLayer,
        ],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer,
      brushSettings,
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      selectionToolSettings: makeSettings({ sampleAllLayers: true, antiAlias: false }),
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

    paintBucketTool.onPointerDown?.(env, { x: 0, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    expect(getPixel(activeBitmap, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(activeBitmap, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('describes the tool workflow with fill output, channel target, and unsupported edge options', async () => {
    const { describePaintBucketToolWorkflow } = await import('./paintBucketTool');

    const descriptor = describePaintBucketToolWorkflow({
      brushSettings: {
        ...brushSettings,
        color: '#00AAff',
        opacity: 0.5,
      },
      selectionSettings: makeSettings({
        sampleAllLayers: false,
        contiguous: true,
        tolerance: 24,
        paintBucketBlendMode: 'overlay',
        paintBucketPreserveTransparency: true,
      }),
      activeColorChannel: 'green',
      requestedAntiAlias: true,
      requestedGapClose: 1,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'paint-bucket-tool-workflow:v1',
      tool: 'paintBucket',
      sampling: {
        sampleAllLayers: false,
        source: 'active-layer-bitmap',
      },
      matching: {
        scope: 'contiguous',
        connectivity: 4,
        gapClosePixels: 1,
        gapCloseSupported: false,
      },
      fill: {
        color: '#00aaff',
        opacity: 0.5,
        blendMode: 'overlay',
        preserveTransparency: true,
        output: 'active-layer-rgba',
      },
      target: {
        requestedChannel: 'green',
        writtenComponents: ['red', 'green', 'blue', 'alpha'],
        channelRouting: 'composite-rgba-channel-request-unsupported',
      },
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'gap-close-unsupported',
      'channel-specific-fill-unsupported',
    ]);
    expect(descriptor.previewSignature).toBe(
      'paint-bucket-tool-workflow:v1:{"tolerance":24,"sampling":"active-layer-bitmap","matching":{"scope":"contiguous","connectivity":4,"gapClosePixels":1},"fill":{"color":"#00aaff","opacity":0.5,"blendMode":"overlay","preserveTransparency":true,"output":"active-layer-rgba"},"target":{"requestedChannel":"green","channelRouting":"composite-rgba-channel-request-unsupported"},"warnings":["gap-close-unsupported","channel-specific-fill-unsupported"]}',
    );
  });

  it('captures workflow edge limits and flattened source-bin reuse metadata', async () => {
    const { describePaintBucketToolWorkflow } = await import('./paintBucketTool');

    const descriptor = describePaintBucketToolWorkflow({
      brushSettings: {
        ...brushSettings,
        color: '#8844ff',
        opacity: 0.7,
      },
      selectionSettings: makeSettings({
        sampleAllLayers: true,
        contiguous: false,
        tolerance: 18,
        paintBucketBlendMode: 'screen',
        paintBucketPreserveTransparency: false,
      }),
      activeColorChannel: 'green',
      requestedAntiAlias: true,
      requestedGapClose: 2,
    });

    expect(descriptor.edgeControls).toEqual({
      antiAlias: {
        requested: true,
        supported: true,
        maxPixels: 1,
      },
      gapClose: {
        requestedPixels: 2,
        supported: false,
        maxPixels: 0,
      },
    });
    expect(descriptor.sourceBin).toEqual({
      exportSignature: 'paint-bucket-tool-export:v1|paint-bucket-tool-workflow:v1:{"tolerance":18,"sampling":"visible-document-composite","matching":{"scope":"global","connectivity":"document-wide","gapClosePixels":2},"fill":{"color":"#8844ff","opacity":0.7,"blendMode":"screen","preserveTransparency":false,"output":"active-layer-rgba"},"target":{"requestedChannel":"green","channelRouting":"composite-rgba-channel-request-unsupported"},"warnings":["gap-close-unsupported","channel-specific-fill-unsupported"]}|flatten:active-layer-rgba',
      caveats: [
        'Paint Bucket Source Bin reuse captures flattened fill settings and signatures, not retained channel- or mask-native bucket objects.',
      ],
    });
  });

  it('exposes workflow readiness checks, fill routing, target blockers, and stable signatures', async () => {
    const { describePaintBucketToolWorkflow } = await import('./paintBucketTool');

    const descriptor = describePaintBucketToolWorkflow({
      brushSettings: {
        ...brushSettings,
        color: '#446688',
        opacity: 0.6,
      },
      selectionSettings: makeSettings({
        sampleAllLayers: true,
        contiguous: true,
        tolerance: 33,
        paintBucketBlendMode: 'soft-light',
        paintBucketPreserveTransparency: true,
      }),
      activeColorChannel: 'blue',
      target: 'quick-mask',
      requestedAntiAlias: true,
      requestedGapClose: 1,
      hasPixelSource: true,
      hasWritableLayer: true,
    });

    expect(descriptor.readinessChecks.map((check) => ({
      code: check.code,
      status: check.status,
      caveatCodes: check.caveatCodes,
      blockerCodes: check.blockerCodes,
    }))).toEqual([
      { code: 'tolerance', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'sample-all-layers', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'contiguous', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'anti-alias', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'gap-close', status: 'unsupported', caveatCodes: ['gap-close-unsupported'], blockerCodes: [] },
      { code: 'blend-mode', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'preserve-transparency', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'target-routing', status: 'blocked', caveatCodes: [], blockerCodes: ['quick-mask-runtime-route-unsupported'] },
      { code: 'channel-routing', status: 'blocked', caveatCodes: ['channel-specific-fill-unsupported'], blockerCodes: ['channel-specific-runtime-route-unsupported'] },
    ]);
    expect(descriptor.routing.target.blockers.map((blocker) => blocker.code)).toEqual([
      'quick-mask-runtime-route-unsupported',
      'channel-specific-runtime-route-unsupported',
    ]);
    expect(descriptor.routing.fill).toEqual({
      route: 'active-layer-rgba-compositor',
      blendMode: 'soft-light',
      preserveTransparency: true,
      opacity: 0.6,
      signature: 'paint-bucket-fill-routing:v1:{"route":"active-layer-rgba-compositor","blendMode":"soft-light","preserveTransparency":true,"opacity":0.6}',
    });
    expect(descriptor.stableSignatures).toEqual({
      workflow: descriptor.previewSignature,
      checks: 'image-paint-readiness-checks:v1:["tolerance:ready","sample-all-layers:ready","contiguous:ready","anti-alias:ready","gap-close:unsupported","blend-mode:ready","preserve-transparency:ready","target-routing:blocked","channel-routing:blocked"]',
      routing: 'paint-bucket-routing:v1:{"fill":{"route":"active-layer-rgba-compositor","blendMode":"soft-light","preserveTransparency":true,"opacity":0.6},"target":{"requested":"quick-mask","requestedChannel":"blue","writePath":"quick-mask-alpha","blockers":["quick-mask-runtime-route-unsupported","channel-specific-runtime-route-unsupported"]}}',
    });
  });
});
