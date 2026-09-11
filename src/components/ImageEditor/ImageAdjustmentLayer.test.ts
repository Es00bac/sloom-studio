import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageAdjustmentSettings, ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  applyBlackWhite,
  applyAdjustmentToImageData,
  applyAdjustmentToPixel,
  applyAdjustmentPresetToLayer,
  adjustmentLayerLabel,
  describeAdjustmentLayerReadiness,
  cloneImageData,
  createAdjustmentLayer,
  defaultAdjustmentSettings,
  buildAdjustmentWorkflowPresetDescriptor,
  buildAdjustmentStackPlanDescriptor,
  describeAdjustmentStackReadiness,
  validateAdjustmentPresetCompatibility,
  describeAdjustmentLayerPlan,
  getUnsupportedAdjustmentLayerPlanningWarnings,
  renderImageDocumentLayersToBitmap,
  compositeLayerRangeInto,
  composeLayerBitmapWithLiveMasks,
  setLiveMaskBypassLayer,
  clearMaskedLayerCache,
  serializeAdjustmentLayerPreset,
} from './ImageAdjustmentLayer';
import { createBitmap } from './LayerBitmap';
import { isImageLayerGroupPassThrough } from './ImageLayerGroups';
import { attachVectorMaskToLayer } from './ImageVectorMasks';

const ADJUSTMENT_LAYER_KINDS = [
  'brightnessContrast',
  'hueSaturation',
  'blackWhite',
  'invert',
  'exposure',
  'temperatureTint',
  'levels',
  'curves',
  'lut',
  'gradientMap',
  'channelMixer',
  'selectiveColor',
] as const;

class FakeContext {
  imageData: ImageData;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '#000000';
  private stack: Array<{ alpha: number; composite: string }> = [];

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height);
  }

  createImageData(width: number, height: number) {
    return makeImageData(width, height);
  }

  getImageData() {
    return cloneTestImageData(this.imageData);
  }

  putImageData(imageData: ImageData) {
    this.imageData = cloneTestImageData(imageData);
  }

  drawImage(image: unknown, dx = 0, dy = 0) {
    const source = (image as { context?: FakeContext }).context?.imageData;
    if (!source) return;
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const tx = Math.round(dx + x);
        const ty = Math.round(dy + y);
        if (tx < 0 || ty < 0 || tx >= this.imageData.width || ty >= this.imageData.height) {
          continue;
        }
        const sourceOffset = (y * source.width + x) * 4;
        const targetOffset = (ty * this.imageData.width + tx) * 4;
        this.imageData.data[targetOffset] = source.data[sourceOffset];
        this.imageData.data[targetOffset + 1] = source.data[sourceOffset + 1];
        this.imageData.data[targetOffset + 2] = source.data[sourceOffset + 2];
        this.imageData.data[targetOffset + 3] = Math.round(source.data[sourceOffset + 3] * this.globalAlpha);
      }
    }
  }

  clearRect() {
    this.imageData.data.fill(0);
  }

  fillRect() {}

  save() {
    this.stack.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
    });
  }

  restore() {
    const next = this.stack.pop();
    if (!next) return;
    this.globalAlpha = next.alpha;
    this.globalCompositeOperation = next.composite;
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function cloneTestImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function setPixel(imageData: ImageData, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = rgba[0];
  imageData.data[offset + 1] = rgba[1];
  imageData.data[offset + 2] = rgba[2];
  imageData.data[offset + 3] = rgba[3];
}

function getPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ];
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 2,
    height: 1,
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

function makeLayer(id: string, rgba: [number, number, number, number]): ImageLayer {
  const bitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
  const data = makeImageData(2, 1);
  setPixel(data, 0, 0, rgba);
  setPixel(data, 1, 0, rgba);
  bitmap.getContext('2d')?.putImageData(data, 0, 0);
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
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

function makeLayerWithBitmap(
  id: string,
  width: number,
  height: number,
  rgba: [number, number, number, number],
): ImageLayer {
  const bitmap = new OffscreenCanvas(width, height) as LayerBitmap;
  const data = makeImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(data, x, y, rgba);
    }
  }
  bitmap.getContext('2d')?.putImageData(data, 0, 0);
  return {
    ...makeLayer(id, rgba),
    bitmap,
  };
}

describe('ImageAdjustmentLayer', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('clones browser ImageData as a native ImageData instance for canvas putImageData', () => {
    class BrowserImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace = 'srgb';

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
    const previousImageData = globalThis.ImageData;
    globalThis.ImageData = BrowserImageData as unknown as typeof ImageData;
    try {
      const source = new BrowserImageData(new Uint8ClampedArray([1, 2, 3, 4]), 1, 1) as ImageData;

      const cloned = cloneImageData(source);

      expect(cloned).toBeInstanceOf(BrowserImageData);
      expect(Array.from(cloned.data)).toEqual([1, 2, 3, 4]);
      expect(cloned).not.toBe(source);
    } finally {
      globalThis.ImageData = previousImageData;
    }
  });

  it('creates document-sized non-destructive adjustment layers without pixel bitmaps', () => {
    const doc = makeDoc({ width: 640, height: 480 });

    const layer = createAdjustmentLayer(doc, 'hueSaturation', 'Color trim');

    expect(layer).toMatchObject({
      name: 'Color trim',
      type: 'adjustment',
      bitmap: null,
      x: 0,
      y: 0,
    });
    expect(layer.adjustment).toEqual(defaultAdjustmentSettings('hueSaturation'));
  });

  it('provides defaults and labels for levels and curves adjustment layers', () => {
    expect(applyBlackWhite(0, 41, 44, 217)).toEqual([33, 33, 33, 217]);
    expect(applyBlackWhite(0, 68, 12, 217)).toEqual([50, 50, 50, 217]);
    expect(defaultAdjustmentSettings('levels')).toEqual({
      kind: 'levels',
      channel: 'rgb',
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    });
    expect(defaultAdjustmentSettings('curves')).toEqual({
      kind: 'curves',
      channel: 'rgb',
      points: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
      shadows: 0,
      midtones: 0,
      highlights: 0,
    });
    expect(adjustmentLayerLabel('levels')).toBe('Levels');
    expect(adjustmentLayerLabel('curves')).toBe('Curves');
  });

  it('builds deterministic planning descriptors for every adjustment kind', () => {
    const doc = makeDoc({ width: 64, height: 32 });
    const descriptors = ADJUSTMENT_LAYER_KINDS.map((kind, index) => describeAdjustmentLayerPlan({
      ...createAdjustmentLayer(doc, kind, `${kind} layer`),
      id: `volatile-${index}`,
      opacity: index === 0 ? 0.5 : 1,
      blendMode: index === 1 ? 'screen' : 'normal',
      clippingMask: index === 2,
    }, {
      documentBounds: { x: 0, y: 0, width: 64, height: 32 },
    }));

    expect(descriptors.map((descriptor) => descriptor.kind)).toEqual([...ADJUSTMENT_LAYER_KINDS]);
    expect(descriptors.map((descriptor) => descriptor.settings)).toEqual(
      ADJUSTMENT_LAYER_KINDS.map((kind) => defaultAdjustmentSettings(kind)),
    );
    expect(descriptors.every((descriptor) => descriptor.warnings.length === 0)).toBe(true);
    expect(new Set(descriptors.map((descriptor) => descriptor.previewSignature)).size).toBe(ADJUSTMENT_LAYER_KINDS.length);
    expect(describeAdjustmentLayerPlan({
      ...createAdjustmentLayer(doc, 'levels', 'Levels layer'),
      id: 'volatile-levels',
    }, {
      documentBounds: { x: 0, y: 0, width: 64, height: 32 },
    })).toEqual(describeAdjustmentLayerPlan({
      ...createAdjustmentLayer(doc, 'levels', 'Levels layer'),
      id: 'volatile-levels',
    }, {
      documentBounds: { x: 0, y: 0, width: 64, height: 32 },
    }));
  });

  it('serializes adjustment presets without runtime layer identity', () => {
    const preset = serializeAdjustmentLayerPreset('  Blue   Curve  ', {
      kind: 'curves',
      channel: 'blue',
      points: [
        { input: 255, output: 0 },
        { input: 0, output: 255 },
        { input: 128.6, output: 64.2 },
      ],
      shadows: 7.5,
      midtones: -3.25,
      highlights: 12,
    }, {
      documentBounds: { x: 0, y: 0, width: 10, height: 8 },
    });

    expect(preset).toEqual({
      version: 1,
      label: 'Blue Curve',
      kind: 'curves',
      settings: {
        kind: 'curves',
        channel: 'blue',
        points: [
          { input: 0, output: 255 },
          { input: 129, output: 64 },
          { input: 255, output: 0 },
        ],
        shadows: 7.5,
        midtones: -3.25,
        highlights: 12,
      },
      previewSignature: 'adjustment-preset:v1:{"kind":"curves","settings":{"kind":"curves","channel":"blue","points":[{"input":0,"output":255},{"input":129,"output":64},{"input":255,"output":0}],"shadows":7.5,"midtones":-3.25,"highlights":12},"bounds":{"x":0,"y":0,"width":10,"height":8}}',
    });
  });

  it('describes adjustment workflow caveats for unsupported scope and document precision', () => {
    const layer = {
      ...createAdjustmentLayer(makeDoc({ width: 80, height: 40 }), 'levels', 'Press proof levels'),
      id: 'adjustment-levels-1',
      adjustment: {
        kind: 'levels' as const,
        channel: 'rgb' as const,
        inputBlack: 12,
        inputWhite: 244,
        gamma: 1.1,
        outputBlack: 8,
        outputWhite: 248,
      },
    };

    const descriptor = describeAdjustmentLayerPlan(layer, {
      documentBounds: { x: 0, y: 0, width: 80, height: 40 },
      clippingFamily: 'blend-if',
      maskFamily: 'vector-mask',
      colorMode: 'cmyk',
      bitDepth: 16,
      histogramPreview: true,
      livePreview: true,
    });

    expect(descriptor.workflow).toEqual({
      presetSerialization: {
        supported: true,
        family: 'single-adjustment',
        serializedKind: 'levels',
      },
      clipping: {
        family: 'blend-if',
        status: 'unsupported',
        notes: ['Blend-if clipping ranges are not represented by Image adjustment layers yet.'],
      },
      mask: {
        family: 'vector-mask',
        status: 'unsupported',
        notes: ['Vector and channel masks are planning metadata only for adjustment layers.'],
      },
      histogramPreview: {
        required: true,
        dependency: 'base-layers-before-adjustment',
        supported: true,
      },
      livePreview: {
        requested: true,
        supported: true,
        caveats: [
          'Live preview is computed through browser 8-bit RGB canvas output.',
          'Histogram preview depends on re-rendering lower visible layers before the adjustment.',
        ],
      },
      documentPrecision: {
        colorMode: 'cmyk',
        bitDepth: 16,
        status: 'preview-only',
        limitations: [
          'CMYK adjustment math is not native; previews are RGB approximations only.',
          '16-bit adjustment input is reduced to 8-bit browser canvas precision.',
        ],
      },
    });
    expect(descriptor.preview).toEqual({
      id: 'adjustment-preview:adjustment-levels-1',
      label: 'Levels preview',
      signature: descriptor.previewSignature,
      requiresHistogram: true,
      livePreviewCaveats: [
        'Live preview is computed through browser 8-bit RGB canvas output.',
        'Histogram preview depends on re-rendering lower visible layers before the adjustment.',
      ],
    });
    expect(descriptor.planSignature).toBe(
      'adjustment-plan:v1:{"layerId":"adjustment-levels-1","previewSignature":"adjustment-layer:v1:{\\"layerId\\":\\"adjustment-levels-1\\",\\"kind\\":\\"levels\\",\\"settings\\":{\\"kind\\":\\"levels\\",\\"channel\\":\\"rgb\\",\\"inputBlack\\":12,\\"inputWhite\\":244,\\"gamma\\":1.1,\\"outputBlack\\":8,\\"outputWhite\\":248},\\"scope\\":{\\"opacity\\":1,\\"blendMode\\":\\"normal\\",\\"clippingFamily\\":\\"blend-if\\",\\"maskFamily\\":\\"vector-mask\\",\\"presetFamily\\":\\"single-adjustment\\"},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":80,\\"height\\":40}}","workflowStatus":"preview-only","warnings":["unsupported-adjustment-clipping-family","unsupported-adjustment-mask-family"]}',
    );
  });

  it('serializes named adjustment workflow presets for tonal and color grading kinds', () => {
    const descriptor = buildAdjustmentWorkflowPresetDescriptor('  Grade Stack  ', [
      { label: 'Levels Lift', settings: { kind: 'levels', channel: 'rgb', inputBlack: -4, inputWhite: 300, gamma: 1, outputBlack: 12, outputWhite: 242 } },
      { label: 'Curve Soft S', settings: { kind: 'curves', channel: 'red', points: [{ input: 255, output: 240 }, { input: 0, output: 4 }], shadows: -12, midtones: 8, highlights: 16 } },
      { label: 'Hue Trim', settings: { kind: 'hueSaturation', hue: 205, saturation: -140, lightness: 24 } },
      { label: 'Exposure Match', settings: { kind: 'exposure', exposure: 4, offset: -1, gamma: 4 } },
      { label: 'Warm Tint', settings: { kind: 'temperatureTint', temperature: 140, tint: -180 } },
    ], {
      documentBounds: { x: 0, y: 0, width: 12, height: 8 },
    });

    expect(descriptor).toEqual({
      version: 1,
      label: 'Grade Stack',
      presetKinds: ['levels', 'curves', 'hueSaturation', 'exposure', 'temperatureTint'],
      presets: [
        {
          version: 1,
          label: 'Levels Lift',
          kind: 'levels',
          settings: { kind: 'levels', channel: 'rgb', inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 12, outputWhite: 242 },
          previewSignature: 'adjustment-preset:v1:{"kind":"levels","settings":{"kind":"levels","channel":"rgb","inputBlack":0,"inputWhite":255,"gamma":1,"outputBlack":12,"outputWhite":242},"bounds":{"x":0,"y":0,"width":12,"height":8}}',
        },
        {
          version: 1,
          label: 'Curve Soft S',
          kind: 'curves',
          settings: { kind: 'curves', channel: 'red', points: [{ input: 0, output: 4 }, { input: 255, output: 240 }], shadows: -12, midtones: 8, highlights: 16 },
          previewSignature: 'adjustment-preset:v1:{"kind":"curves","settings":{"kind":"curves","channel":"red","points":[{"input":0,"output":4},{"input":255,"output":240}],"shadows":-12,"midtones":8,"highlights":16},"bounds":{"x":0,"y":0,"width":12,"height":8}}',
        },
        {
          version: 1,
          label: 'Hue Trim',
          kind: 'hueSaturation',
          settings: { kind: 'hueSaturation', hue: 180, saturation: -100, lightness: 24 },
          previewSignature: 'adjustment-preset:v1:{"kind":"hueSaturation","settings":{"kind":"hueSaturation","hue":180,"saturation":-100,"lightness":24},"bounds":{"x":0,"y":0,"width":12,"height":8}}',
        },
        {
          version: 1,
          label: 'Exposure Match',
          kind: 'exposure',
          settings: { kind: 'exposure', exposure: 3, offset: -0.5, gamma: 3 },
          previewSignature: 'adjustment-preset:v1:{"kind":"exposure","settings":{"kind":"exposure","exposure":3,"offset":-0.5,"gamma":3},"bounds":{"x":0,"y":0,"width":12,"height":8}}',
        },
        {
          version: 1,
          label: 'Warm Tint',
          kind: 'temperatureTint',
          settings: { kind: 'temperatureTint', temperature: 100, tint: -100 },
          previewSignature: 'adjustment-preset:v1:{"kind":"temperatureTint","settings":{"kind":"temperatureTint","temperature":100,"tint":-100},"bounds":{"x":0,"y":0,"width":12,"height":8}}',
        },
      ],
      signature: 'adjustment-workflow-preset:v1:{"label":"Grade Stack","presetSignatures":["adjustment-preset:v1:{\\"kind\\":\\"levels\\",\\"settings\\":{\\"kind\\":\\"levels\\",\\"channel\\":\\"rgb\\",\\"inputBlack\\":0,\\"inputWhite\\":255,\\"gamma\\":1,\\"outputBlack\\":12,\\"outputWhite\\":242},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":12,\\"height\\":8}}","adjustment-preset:v1:{\\"kind\\":\\"curves\\",\\"settings\\":{\\"kind\\":\\"curves\\",\\"channel\\":\\"red\\",\\"points\\":[{\\"input\\":0,\\"output\\":4},{\\"input\\":255,\\"output\\":240}],\\"shadows\\":-12,\\"midtones\\":8,\\"highlights\\":16},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":12,\\"height\\":8}}","adjustment-preset:v1:{\\"kind\\":\\"hueSaturation\\",\\"settings\\":{\\"kind\\":\\"hueSaturation\\",\\"hue\\":180,\\"saturation\\":-100,\\"lightness\\":24},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":12,\\"height\\":8}}","adjustment-preset:v1:{\\"kind\\":\\"exposure\\",\\"settings\\":{\\"kind\\":\\"exposure\\",\\"exposure\\":3,\\"offset\\":-0.5,\\"gamma\\":3},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":12,\\"height\\":8}}","adjustment-preset:v1:{\\"kind\\":\\"temperatureTint\\",\\"settings\\":{\\"kind\\":\\"temperatureTint\\",\\"temperature\\":100,\\"tint\\":-100},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":12,\\"height\\":8}}"]}',
    });
  });

  it('builds deterministic adjustment stack plans with coverage and portability warnings', () => {
    const doc = makeDoc({ width: 320, height: 180 });
    const background = makeLayer('background', [80, 90, 100, 255]);
    const hue = {
      ...createAdjustmentLayer(doc, 'hueSaturation', 'Hue trim'),
      id: 'adjustment-hue',
      mask: new OffscreenCanvas(2, 1) as LayerBitmap,
      maskDensity: 0.75,
      maskFeather: 2,
    } as ImageLayer;
    const levels = {
      ...createAdjustmentLayer(doc, 'levels', 'Levels proof'),
      id: 'adjustment-levels',
      clippingMask: true,
      adjustment: {
        kind: 'levels' as const,
        channel: 'red' as const,
        inputBlack: 8,
        inputWhite: 240,
        gamma: 1.2,
        outputBlack: 4,
        outputWhite: 250,
      },
    };
    const curves = {
      ...createAdjustmentLayer(doc, 'curves', 'Curve proof'),
      id: 'adjustment-curves',
      adjustment: {
        kind: 'curves' as const,
        channel: 'blue' as const,
        points: [{ input: 255, output: 244 }, { input: 0, output: 8 }],
        shadows: -4,
        midtones: 12,
        highlights: 20,
      },
    };

    const descriptor = buildAdjustmentStackPlanDescriptor({
      ...doc,
      layers: [background, hue, levels, curves],
    }, {
      documentBounds: { x: 0, y: 0, width: 320, height: 180 },
      colorMode: 'cmyk',
      bitDepth: 16,
      livePreview: true,
      histogramPreview: true,
      presetFamily: 'camera-raw',
      importFamily: 'psd-native',
      exportFamily: 'flattened-raster',
    });

    expect(descriptor).toMatchObject({
      version: 1,
      documentId: 'doc-1',
      adjustmentLayerIds: ['adjustment-hue', 'adjustment-levels', 'adjustment-curves'],
      coverage: {
        hueSaturation: { count: 1, channels: ['rgb'], histogramRequired: false },
        levels: { count: 1, channels: ['red'], histogramRequired: true },
        curves: { count: 1, channels: ['blue'], histogramRequired: true },
      },
      masks: [
        {
          layerId: 'adjustment-hue',
          family: 'raster-layer-mask',
          density: 0.75,
          feather: 2,
          summary: 'Raster layer mask limits Hue/Saturation at 75% density with 2px feather.',
        },
      ],
      limitations: [
        'Adjustment layers are represented non-destructively in Sloom Studio state but exported raster formats flatten the visible result.',
        'CMYK adjustment math is not native; previews are RGB approximations only.',
        '16-bit adjustment input is reduced to 8-bit browser canvas precision.',
        'Raster masks support density and feather metadata, but mask editing parity is handled outside adjustment planning.',
        'Layer-alpha clipping is represented through the current lower-layer alpha mask only.',
      ],
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'unsupported-adjustment-preset-family',
      'adjustment-import-flattened',
      'adjustment-export-flattened',
    ]);
    expect(descriptor.previewSignature).toBe(
      'adjustment-stack-preview:v1:{"documentId":"doc-1","bounds":{"x":0,"y":0,"width":320,"height":180},"layerPreviewSignatures":["adjustment-layer:v1:{\\"layerId\\":\\"adjustment-hue\\",\\"kind\\":\\"hueSaturation\\",\\"settings\\":{\\"kind\\":\\"hueSaturation\\",\\"hue\\":0,\\"saturation\\":0,\\"lightness\\":0},\\"scope\\":{\\"opacity\\":1,\\"blendMode\\":\\"normal\\",\\"clippingFamily\\":\\"none\\",\\"maskFamily\\":\\"raster-layer-mask\\",\\"presetFamily\\":\\"camera-raw\\"},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":320,\\"height\\":180}}","adjustment-layer:v1:{\\"layerId\\":\\"adjustment-levels\\",\\"kind\\":\\"levels\\",\\"settings\\":{\\"kind\\":\\"levels\\",\\"channel\\":\\"red\\",\\"inputBlack\\":8,\\"inputWhite\\":240,\\"gamma\\":1.2,\\"outputBlack\\":4,\\"outputWhite\\":250},\\"scope\\":{\\"opacity\\":1,\\"blendMode\\":\\"normal\\",\\"clippingFamily\\":\\"layer-alpha\\",\\"maskFamily\\":\\"none\\",\\"presetFamily\\":\\"camera-raw\\"},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":320,\\"height\\":180}}","adjustment-layer:v1:{\\"layerId\\":\\"adjustment-curves\\",\\"kind\\":\\"curves\\",\\"settings\\":{\\"kind\\":\\"curves\\",\\"channel\\":\\"blue\\",\\"points\\":[{\\"input\\":0,\\"output\\":8},{\\"input\\":255,\\"output\\":244}],\\"shadows\\":-4,\\"midtones\\":12,\\"highlights\\":20},\\"scope\\":{\\"opacity\\":1,\\"blendMode\\":\\"normal\\",\\"clippingFamily\\":\\"none\\",\\"maskFamily\\":\\"none\\",\\"presetFamily\\":\\"camera-raw\\"},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":320,\\"height\\":180}}"]}',
    );
    expect(descriptor.planSignature).toBe(
      'adjustment-stack-plan:v1:{"previewSignature":"adjustment-stack-preview:v1:{\\"documentId\\":\\"doc-1\\",\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":320,\\"height\\":180},\\"layerPreviewSignatures\\":[\\"adjustment-layer:v1:{\\\\\\"layerId\\\\\\":\\\\\\"adjustment-hue\\\\\\",\\\\\\"kind\\\\\\":\\\\\\"hueSaturation\\\\\\",\\\\\\"settings\\\\\\":{\\\\\\"kind\\\\\\":\\\\\\"hueSaturation\\\\\\",\\\\\\"hue\\\\\\":0,\\\\\\"saturation\\\\\\":0,\\\\\\"lightness\\\\\\":0},\\\\\\"scope\\\\\\":{\\\\\\"opacity\\\\\\":1,\\\\\\"blendMode\\\\\\":\\\\\\"normal\\\\\\",\\\\\\"clippingFamily\\\\\\":\\\\\\"none\\\\\\",\\\\\\"maskFamily\\\\\\":\\\\\\"raster-layer-mask\\\\\\",\\\\\\"presetFamily\\\\\\":\\\\\\"camera-raw\\\\\\"},\\\\\\"bounds\\\\\\":{\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":0,\\\\\\"width\\\\\\":320,\\\\\\"height\\\\\\":180}}\\",\\"adjustment-layer:v1:{\\\\\\"layerId\\\\\\":\\\\\\"adjustment-levels\\\\\\",\\\\\\"kind\\\\\\":\\\\\\"levels\\\\\\",\\\\\\"settings\\\\\\":{\\\\\\"kind\\\\\\":\\\\\\"levels\\\\\\",\\\\\\"channel\\\\\\":\\\\\\"red\\\\\\",\\\\\\"inputBlack\\\\\\":8,\\\\\\"inputWhite\\\\\\":240,\\\\\\"gamma\\\\\\":1.2,\\\\\\"outputBlack\\\\\\":4,\\\\\\"outputWhite\\\\\\":250},\\\\\\"scope\\\\\\":{\\\\\\"opacity\\\\\\":1,\\\\\\"blendMode\\\\\\":\\\\\\"normal\\\\\\",\\\\\\"clippingFamily\\\\\\":\\\\\\"layer-alpha\\\\\\",\\\\\\"maskFamily\\\\\\":\\\\\\"none\\\\\\",\\\\\\"presetFamily\\\\\\":\\\\\\"camera-raw\\\\\\"},\\\\\\"bounds\\\\\\":{\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":0,\\\\\\"width\\\\\\":320,\\\\\\"height\\\\\\":180}}\\",\\"adjustment-layer:v1:{\\\\\\"layerId\\\\\\":\\\\\\"adjustment-curves\\\\\\",\\\\\\"kind\\\\\\":\\\\\\"curves\\\\\\",\\\\\\"settings\\\\\\":{\\\\\\"kind\\\\\\":\\\\\\"curves\\\\\\",\\\\\\"channel\\\\\\":\\\\\\"blue\\\\\\",\\\\\\"points\\\\\\":[{\\\\\\"input\\\\\\":0,\\\\\\"output\\\\\\":8},{\\\\\\"input\\\\\\":255,\\\\\\"output\\\\\\":244}],\\\\\\"shadows\\\\\\":-4,\\\\\\"midtones\\\\\\":12,\\\\\\"highlights\\\\\\":20},\\\\\\"scope\\\\\\":{\\\\\\"opacity\\\\\\":1,\\\\\\"blendMode\\\\\\":\\\\\\"normal\\\\\\",\\\\\\"clippingFamily\\\\\\":\\\\\\"none\\\\\\",\\\\\\"maskFamily\\\\\\":\\\\\\"none\\\\\\",\\\\\\"presetFamily\\\\\\":\\\\\\"camera-raw\\\\\\"},\\\\\\"bounds\\\\\\":{\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":0,\\\\\\"width\\\\\\":320,\\\\\\"height\\\\\\":180}}\\"]}","warningCodes":["unsupported-adjustment-preset-family","adjustment-import-flattened","adjustment-export-flattened"],"coverageKinds":["hueSaturation","levels","curves"]}',
    );
  });

  it('builds typed stack readiness signatures with explicit unsupported adjustment states', () => {
    const doc = makeDoc({ width: 320, height: 180 });
    const levels = {
      ...createAdjustmentLayer(doc, 'levels', 'Levels proof'),
      id: 'adjustment-levels',
      clippingMask: true,
    };
    const curves = {
      ...createAdjustmentLayer(doc, 'curves', 'Curve proof'),
      id: 'adjustment-curves',
      adjustment: {
        kind: 'curves' as const,
        channel: 'blue' as const,
        points: [{ input: 0, output: 0 }],
        shadows: 0,
        midtones: 0,
        highlights: 0,
      },
    };

    const descriptor = describeAdjustmentStackReadiness({
      ...doc,
      layers: [levels, curves],
    }, {
      documentBounds: { x: 0, y: 0, width: 320, height: 180 },
      colorMode: 'lab',
      bitDepth: 32,
      histogramSourceAvailable: false,
      livePreview: true,
      presetFamily: 'camera-raw',
      importFamily: 'psd-native',
      exportFamily: 'psd-native',
      maskFamily: 'vector-mask',
      clippingFamily: 'blend-if',
    });

    expect(descriptor).toMatchObject({
      version: 1,
      documentId: 'doc-1',
      score: {
        readyLayerCount: 0,
        totalLayerCount: 2,
        blockerCount: 9,
        warningCount: 5,
        unsupportedStateCount: 6,
        readinessRatio: 0,
      },
      stablePreviewIds: [
        'adjustment-preview:adjustment-levels',
        'adjustment-preview:adjustment-curves',
      ],
      unsupportedStates: [
        { code: 'true-high-bit-adjustment-pipeline-unsupported', status: 'unsupported' },
        { code: 'photoshop-preset-family-parity-unsupported', status: 'unsupported' },
        { code: 'lab-native-adjustment-unsupported', status: 'unsupported' },
        { code: 'native-psd-adjustment-fidelity-unsupported', status: 'unsupported' },
        { code: 'blend-if-adjustment-clipping-unsupported', status: 'unsupported' },
        { code: 'vector-mask-adjustment-scope-unsupported', status: 'unsupported' },
      ],
      layerReadiness: [
        {
          layerId: 'adjustment-levels',
          ready: false,
          blockerCodes: [
            'adjustment-histogram-source-unavailable',
            'adjustment-preset-serialization-unsupported',
            'adjustment-preset-import-unsupported',
            'adjustment-preset-export-unsupported',
          ],
          parameterCompleteness: { complete: true },
        },
        {
          layerId: 'adjustment-curves',
          ready: false,
          blockerCodes: [
            'adjustment-parameters-incomplete',
            'adjustment-histogram-source-unavailable',
            'adjustment-preset-serialization-unsupported',
            'adjustment-preset-import-unsupported',
            'adjustment-preset-export-unsupported',
          ],
          parameterCompleteness: { complete: false, missing: ['points[1]'] },
        },
      ],
    });
    expect(descriptor.stackSignature).toContain('adjustment-stack-readiness:v1:');
    expect(descriptor.stackSignature).toContain('"unsupportedStateCodes":["true-high-bit-adjustment-pipeline-unsupported"');
    expect(descriptor.presetCompatibility.signature).toContain('adjustment-preset-compatibility:v1:');
  });

  it('validates adjustment preset compatibility without parsing warning prose', () => {
    expect(validateAdjustmentPresetCompatibility({
      label: 'Imported ACV',
      settings: defaultAdjustmentSettings('curves'),
      presetFamily: 'photoshop-acv',
      importFamily: 'psd-native',
      exportFamily: 'psd-native',
      targetKind: 'levels',
    })).toMatchObject({
      version: 1,
      label: 'Imported ACV',
      sourceKind: 'curves',
      targetKind: 'levels',
      compatible: false,
      serialization: {
        family: 'photoshop-acv',
        supported: false,
        blockerCode: 'adjustment-preset-serialization-unsupported',
      },
      import: {
        family: 'psd-native',
        supported: false,
        status: 'preview-only',
        blockerCode: 'adjustment-preset-import-unsupported',
      },
      export: {
        family: 'psd-native',
        supported: false,
        status: 'preview-only',
        blockerCode: 'adjustment-preset-export-unsupported',
      },
      kindMatch: false,
      unsupportedStateCodes: [
        'photoshop-preset-family-parity-unsupported',
        'native-psd-adjustment-fidelity-unsupported',
      ],
    });
  });

  it('reports unsupported clipping, mask, and preset families deterministically', () => {
    const warnings = getUnsupportedAdjustmentLayerPlanningWarnings({
      clippingFamily: 'blend-if',
      maskFamily: 'vector-mask',
      presetFamily: 'camera-raw',
    });

    expect(warnings).toEqual([
      {
        code: 'unsupported-adjustment-clipping-family',
        severity: 'warning',
        message: 'Adjustment layer blend-if clipping is not supported yet; only normal lower-layer scope and layer-alpha clipping masks are represented.',
      },
      {
        code: 'unsupported-adjustment-mask-family',
        severity: 'warning',
        message: 'Adjustment layer vector-mask masks are not supported yet; only raster layer masks with density/feather metadata are represented.',
      },
      {
        code: 'unsupported-adjustment-preset-family',
        severity: 'warning',
        message: 'Adjustment preset family "camera-raw" is not supported yet; only single-adjustment Image presets can be serialized.',
      },
    ]);
    expect(serializeAdjustmentLayerPreset('Camera Raw', defaultAdjustmentSettings('exposure'), {
      presetFamily: 'camera-raw',
    })).toBeNull();
  });

  it('summarizes adjustment readiness with parameter completeness and preset portability states', () => {
    const layer = {
      ...createAdjustmentLayer(makeDoc({ width: 120, height: 80 }), 'curves', 'Curve import'),
      id: 'adjustment-readiness-curves',
      adjustment: {
        kind: 'curves',
        channel: 'blue',
        points: [{ input: 0, output: 4 }],
        shadows: Number.NaN,
        midtones: 12,
      } as unknown as ImageLayer['adjustment'],
    };

    const readiness = describeAdjustmentLayerReadiness(layer, {
      documentBounds: { x: 0, y: 0, width: 120, height: 80 },
      maskFamily: 'channel-mask',
      clippingFamily: 'blend-if',
      presetFamily: 'lookup-table',
      importFamily: 'psd-native',
      exportFamily: 'flattened-raster',
      histogramPreview: true,
      histogramSourceAvailable: false,
    });

    expect(readiness).toEqual({
      version: 1,
      layerId: 'adjustment-readiness-curves',
      kind: 'curves',
      label: 'Curves',
      parameterCompleteness: {
        complete: false,
        required: ['channel', 'points[0].input', 'points[0].output', 'points[1]', 'shadows', 'midtones', 'highlights'],
        missing: ['points[1]', 'shadows', 'highlights'],
        normalizedSettings: {
          kind: 'curves',
          channel: 'blue',
          points: [{ input: 0, output: 4 }],
          shadows: 0,
          midtones: 12,
          highlights: 0,
        },
      },
      histogram: {
        required: true,
        dependency: 'base-layers-before-adjustment',
        ready: false,
        reason: 'Histogram-dependent adjustments need rendered base layers before preset preview is ready.',
      },
      support: {
        clipping: {
          family: 'blend-if',
          status: 'unsupported',
          notes: ['Blend-if clipping ranges are not represented by Image adjustment layers yet.'],
        },
        mask: {
          family: 'channel-mask',
          status: 'unsupported',
          notes: ['Vector and channel masks are planning metadata only for adjustment layers.'],
        },
      },
      preset: {
        serialization: {
          family: 'lookup-table',
          ready: false,
          reason: 'Only single-adjustment Image presets serialize as live adjustment settings.',
        },
        import: {
          family: 'psd-native',
          ready: false,
          status: 'preview-only',
          reason: 'Native PSD adjustment controls import as planning metadata or flattened pixels.',
        },
        export: {
          family: 'flattened-raster',
          ready: false,
          status: 'preview-only',
          reason: 'Flattened raster export preserves pixels, not editable adjustment preset controls.',
        },
      },
      warnings: [
        {
          code: 'unsupported-adjustment-clipping-family',
          severity: 'warning',
          message: 'Adjustment layer blend-if clipping is not supported yet; only normal lower-layer scope and layer-alpha clipping masks are represented.',
        },
        {
          code: 'unsupported-adjustment-mask-family',
          severity: 'warning',
          message: 'Adjustment layer channel-mask masks are not supported yet; only raster layer masks with density/feather metadata are represented.',
        },
        {
          code: 'unsupported-adjustment-preset-family',
          severity: 'warning',
          message: 'Adjustment preset family "lookup-table" is not supported yet; only single-adjustment Image presets can be serialized.',
        },
        {
          code: 'adjustment-import-flattened',
          severity: 'warning',
          message: 'Adjustment psd-native import is represented as planning metadata or flattened pixels; native adjustment round-trip is not complete.',
        },
        {
          code: 'adjustment-export-flattened',
          severity: 'warning',
          message: 'Adjustment flattened-raster export flattens or approximates live adjustment layers instead of preserving native Photoshop adjustment controls.',
        },
      ],
      blockers: [
        {
          code: 'adjustment-parameters-incomplete',
          severity: 'blocker',
          message: 'Curves is missing required parameters: points[1], shadows, highlights.',
        },
        {
          code: 'adjustment-histogram-source-unavailable',
          severity: 'blocker',
          message: 'Curves requires rendered base layers before histogram-dependent preview is ready.',
        },
        {
          code: 'adjustment-preset-serialization-unsupported',
          severity: 'blocker',
          message: 'lookup-table presets cannot serialize as editable Sloom Studio adjustment settings.',
        },
        {
          code: 'adjustment-preset-import-unsupported',
          severity: 'blocker',
          message: 'psd-native adjustment presets do not import as editable Sloom Studio adjustment settings.',
        },
        {
          code: 'adjustment-preset-export-unsupported',
          severity: 'blocker',
          message: 'flattened-raster adjustment presets do not export as editable Sloom Studio adjustment settings.',
        },
      ],
      unsupportedStates: [
        'parameters-incomplete',
        'histogram-source-unavailable',
        'clipping:blend-if',
        'mask:channel-mask',
        'preset:lookup-table',
        'import:psd-native',
        'export:flattened-raster',
      ],
      previewSignature: readiness.previewSignature,
      signature: readiness.signature,
    });
    expect(readiness.previewSignature).toContain('"kind":"curves"');
    expect(readiness.signature).toBe(
      'adjustment-readiness:v1:{"layerId":"adjustment-readiness-curves","kind":"curves","complete":false,"histogramReady":false,"unsupportedStates":["parameters-incomplete","histogram-source-unavailable","clipping:blend-if","mask:channel-mask","preset:lookup-table","import:psd-native","export:flattened-raster"],"blockerCodes":["adjustment-parameters-incomplete","adjustment-histogram-source-unavailable","adjustment-preset-serialization-unsupported","adjustment-preset-import-unsupported","adjustment-preset-export-unsupported"],"warningCodes":["unsupported-adjustment-clipping-family","unsupported-adjustment-mask-family","unsupported-adjustment-preset-family","adjustment-import-flattened","adjustment-export-flattened"],"previewSignature":"adjustment-layer:v1:{\\"layerId\\":\\"adjustment-readiness-curves\\",\\"kind\\":\\"curves\\",\\"settings\\":{\\"kind\\":\\"curves\\",\\"channel\\":\\"blue\\",\\"points\\":[{\\"input\\":0,\\"output\\":4}],\\"shadows\\":0,\\"midtones\\":12,\\"highlights\\":0},\\"scope\\":{\\"opacity\\":1,\\"blendMode\\":\\"normal\\",\\"clippingFamily\\":\\"blend-if\\",\\"maskFamily\\":\\"channel-mask\\",\\"presetFamily\\":\\"lookup-table\\"},\\"bounds\\":{\\"x\\":0,\\"y\\":0,\\"width\\":120,\\"height\\":80}}"}',
    );
  });

  it('applies serialized adjustment presets to layers without mutating the source layer', () => {
    const original = {
      ...createAdjustmentLayer(makeDoc(), 'brightnessContrast', 'Adjust'),
      id: 'adjustment-preset-target',
      opacity: 0.4,
    };
    const preset = serializeAdjustmentLayerPreset('Warmth', {
      kind: 'temperatureTint',
      temperature: 40,
      tint: -12,
    });

    const applied = preset ? applyAdjustmentPresetToLayer(original, preset) : null;

    expect(applied).toMatchObject({
      id: 'adjustment-preset-target',
      type: 'adjustment',
      opacity: 0.4,
      adjustment: {
        kind: 'temperatureTint',
        temperature: 40,
        tint: -12,
      },
    });
    expect(original.adjustment).toEqual({
      kind: 'brightnessContrast',
      brightness: 0,
      contrast: 0,
    });
    expect(applied).not.toBe(original);
  });

  it('applies brightness and contrast through layer opacity', () => {
    const source = makeImageData(1, 1);
    setPixel(source, 0, 0, [100, 120, 140, 255]);

    const adjusted = applyAdjustmentToImageData(source, {
      kind: 'brightnessContrast',
      brightness: 40,
      contrast: 0,
    }, { opacity: 0.5 });

    expect(getPixel(adjusted, 0, 0)).toEqual([120, 140, 160, 255]);
  });

  it('uses adjustment masks to limit destructive-looking pixel changes', () => {
    const source = makeImageData(2, 1);
    setPixel(source, 0, 0, [10, 20, 30, 255]);
    setPixel(source, 1, 0, [10, 20, 30, 255]);
    const mask = makeImageData(2, 1);
    setPixel(mask, 0, 0, [255, 255, 255, 0]);
    setPixel(mask, 1, 0, [255, 255, 255, 255]);

    const adjusted = applyAdjustmentToImageData(source, { kind: 'invert' }, { mask });

    expect(getPixel(adjusted, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPixel(adjusted, 1, 0)).toEqual([245, 235, 225, 255]);
  });

  it('renders adjustment layer masks with density instead of treating zero-alpha areas as absolute', () => {
    const lower = makeLayer('lower', [10, 20, 30, 255]);
    const adjustment = createAdjustmentLayer(makeDoc(), 'invert', 'Invert');
    const mask = new OffscreenCanvas(2, 1) as LayerBitmap;
    const maskData = makeImageData(2, 1);
    setPixel(maskData, 0, 0, [255, 255, 255, 0]);
    setPixel(maskData, 1, 0, [255, 255, 255, 255]);
    mask.getContext('2d')?.putImageData(maskData, 0, 0);
    const doc = makeDoc({
      layers: [
        lower,
        {
          ...adjustment,
          mask,
          maskDensity: 0.5,
        } as ImageLayer,
      ],
    });

    const bitmap = renderImageDocumentLayersToBitmap(doc);
    const rendered = bitmap.getContext('2d')?.getImageData(0, 0, bitmap.width, bitmap.height);

    expect(rendered ? getPixel(rendered, 0, 0) : null).toEqual([128, 128, 128, 255]);
    expect(rendered ? getPixel(rendered, 1, 0) : null).toEqual([245, 235, 225, 255]);
  });

  it('renders adjustment layer masks with feathered falloff into neighboring pixels', () => {
    const lower = makeLayer('lower', [10, 20, 30, 255]);
    const adjustment = createAdjustmentLayer(makeDoc(), 'invert', 'Invert');
    const mask = new OffscreenCanvas(2, 1) as LayerBitmap;
    const maskData = makeImageData(2, 1);
    setPixel(maskData, 0, 0, [255, 255, 255, 255]);
    setPixel(maskData, 1, 0, [255, 255, 255, 0]);
    mask.getContext('2d')?.putImageData(maskData, 0, 0);
    const doc = makeDoc({
      layers: [
        lower,
        {
          ...adjustment,
          mask,
          maskFeather: 1,
        } as ImageLayer,
      ],
    });

    const bitmap = renderImageDocumentLayersToBitmap(doc);
    const rendered = bitmap.getContext('2d')?.getImageData(0, 0, bitmap.width, bitmap.height);
    const featheredPixel = rendered ? getPixel(rendered, 1, 0) : null;

    expect(featheredPixel?.[0]).toBeGreaterThan(10);
    expect(featheredPixel?.[0]).toBeLessThan(245);
    expect(featheredPixel?.[1]).toBeGreaterThan(20);
    expect(featheredPixel?.[1]).toBeLessThan(235);
  });

  it('renders retained vector masks live when flattening document layers', () => {
    const layer = attachVectorMaskToLayer(makeLayerWithBitmap('masked', 4, 2, [40, 120, 220, 255]), {
      id: 'vm-render',
      name: 'Left half',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
      },
    });
    const doc = makeDoc({
      width: 4,
      height: 2,
      layers: [layer],
    });

    const bitmap = renderImageDocumentLayersToBitmap(doc);
    const rendered = bitmap.getContext('2d')?.getImageData(0, 0, bitmap.width, bitmap.height);

    expect(rendered ? getPixel(rendered, 0, 0) : null).toEqual([40, 120, 220, 255]);
    expect(rendered ? getPixel(rendered, 1, 1) : null).toEqual([40, 120, 220, 255]);
    expect(rendered ? getPixel(rendered, 2, 0)[3] : null).toBe(0);
    expect(rendered ? getPixel(rendered, 3, 1)[3] : null).toBe(0);
  });

  it('intersects retained vector masks with existing raster layer masks during render', () => {
    const layer = attachVectorMaskToLayer(makeLayerWithBitmap('masked-intersection', 4, 1, [240, 60, 20, 255]), {
      id: 'vm-left',
      name: 'Left vector window',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    });
    const rasterMask = new OffscreenCanvas(4, 1) as LayerBitmap;
    const rasterMaskData = makeImageData(4, 1);
    setPixel(rasterMaskData, 0, 0, [255, 255, 255, 0]);
    setPixel(rasterMaskData, 1, 0, [255, 255, 255, 255]);
    setPixel(rasterMaskData, 2, 0, [255, 255, 255, 255]);
    setPixel(rasterMaskData, 3, 0, [255, 255, 255, 255]);
    rasterMask.getContext('2d')?.putImageData(rasterMaskData, 0, 0);
    const doc = makeDoc({
      width: 4,
      height: 1,
      layers: [{ ...layer, mask: rasterMask }],
    });

    const bitmap = renderImageDocumentLayersToBitmap(doc);
    const rendered = bitmap.getContext('2d')?.getImageData(0, 0, bitmap.width, bitmap.height);

    expect(rendered ? getPixel(rendered, 0, 0)[3] : null).toBe(0);
    expect(rendered ? getPixel(rendered, 1, 0) : null).toEqual([240, 60, 20, 255]);
    expect(rendered ? getPixel(rendered, 2, 0)[3] : null).toBe(0);
    expect(rendered ? getPixel(rendered, 3, 0)[3] : null).toBe(0);
  });

  it('applies levels remapping non-destructively to image data', () => {
    const source = makeImageData(1, 1);
    setPixel(source, 0, 0, [128, 192, 64, 255]);

    const adjusted = applyAdjustmentToImageData(source, {
      kind: 'levels',
      channel: 'rgb',
      inputBlack: 64,
      inputWhite: 192,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    });

    expect(getPixel(adjusted, 0, 0)).toEqual([128, 255, 0, 255]);
  });

  it('applies simple curves controls across tonal ranges', () => {
    const source = makeImageData(1, 1);
    setPixel(source, 0, 0, [20, 128, 235, 255]);

    const adjusted = applyAdjustmentToImageData(source, {
      kind: 'curves',
      channel: 'rgb',
      points: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
      shadows: -60,
      midtones: 20,
      highlights: 60,
    });

    expect(getPixel(adjusted, 0, 0)[0]).toBeLessThan(20);
    expect(getPixel(adjusted, 0, 0)[1]).toBeGreaterThan(128);
    expect(getPixel(adjusted, 0, 0)[2]).toBeGreaterThan(235);
  });

  it('applies levels and point curves to selected color channels', () => {
    const source = makeImageData(1, 1);
    setPixel(source, 0, 0, [64, 128, 192, 255]);

    const leveled = applyAdjustmentToImageData(source, {
      kind: 'levels',
      channel: 'red',
      inputBlack: 64,
      inputWhite: 192,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    });
    expect(getPixel(leveled, 0, 0)).toEqual([0, 128, 192, 255]);

    const curved = applyAdjustmentToImageData(source, {
      kind: 'curves',
      channel: 'blue',
      points: [{ input: 0, output: 0 }, { input: 192, output: 240 }, { input: 255, output: 255 }],
      shadows: 0,
      midtones: 0,
      highlights: 0,
    });
    expect(getPixel(curved, 0, 0)).toEqual([64, 128, 240, 255]);
  });

  it('applies LUT adjustments with identity and inverted lookup tables', () => {
    const source = makeImageData(1, 1);
    setPixel(source, 0, 0, [64, 128, 192, 255]);

    const identityLut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      identityLut[i] = i;
    }

    const identity = applyAdjustmentToImageData(source, {
      kind: 'lut',
      channel: 'rgb',
      lutData: identityLut,
    });
    expect(getPixel(identity, 0, 0)).toEqual([64, 128, 192, 255]);

    const invertedLut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      invertedLut[i] = 255 - i;
    }

    const inverted = applyAdjustmentToImageData(source, {
      kind: 'lut',
      channel: 'rgb',
      lutData: invertedLut,
    });
    expect(getPixel(inverted, 0, 0)).toEqual([191, 127, 63, 255]);
  });

  it('applies gradient map adjustments to map luminance to gradient colors', () => {
    const source = makeImageData(1, 1);
    setPixel(source, 0, 0, [128, 128, 128, 255]);

    const blackToWhite = applyAdjustmentToImageData(source, {
      kind: 'gradientMap',
      stops: [
        { position: 0, color: [0, 0, 0] },
        { position: 1, color: [255, 255, 255] },
      ],
    });
    expect(getPixel(blackToWhite, 0, 0)).toEqual([128, 128, 128, 255]);

    const blueToRed = applyAdjustmentToImageData(source, {
      kind: 'gradientMap',
      stops: [
        { position: 0, color: [0, 0, 255] },
        { position: 1, color: [255, 0, 0] },
      ],
    });
    const result = getPixel(blueToRed, 0, 0);
    expect(result[3]).toBe(255);
    expect(result[0]).toBeGreaterThan(100);
    expect(result[2]).toBeGreaterThan(100);
  });

  it('renders adjustment layers over lower layers without affecting layers above them', () => {
    const lower = makeLayer('lower', [20, 40, 60, 255]);
    const adjustment = createAdjustmentLayer(makeDoc(), 'invert', 'Invert');
    const upper = makeLayer('upper', [200, 10, 20, 255]);
    upper.x = 1;
    upper.bitmap = new OffscreenCanvas(1, 1) as LayerBitmap;
    const upperData = makeImageData(1, 1);
    setPixel(upperData, 0, 0, [200, 10, 20, 255]);
    upper.bitmap.getContext('2d')?.putImageData(upperData, 0, 0);
    const doc = makeDoc({ layers: [lower, adjustment, upper] });

    const bitmap = renderImageDocumentLayersToBitmap(doc);
    const rendered = bitmap.getContext('2d')?.getImageData(0, 0, bitmap.width, bitmap.height);

    expect(rendered ? getPixel(rendered, 0, 0) : null).toEqual([235, 215, 195, 255]);
    expect(rendered ? getPixel(rendered, 1, 0) : null).toEqual([200, 10, 20, 255]);
  });

  it('does not render children of hidden layer groups', () => {
    const child = makeLayer('group-child', [30, 180, 240, 255]);
    child.groupId = 'group-hidden';
    const hiddenGroup: ImageLayer = {
      id: 'group-hidden',
      name: 'Hidden group',
      type: 'group' as ImageLayer['type'],
      visible: false,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
      groupExpanded: true,
    };
    const doc = makeDoc({ layers: [child, hiddenGroup] });

    const bitmap = renderImageDocumentLayersToBitmap(doc);
    const rendered = bitmap.getContext('2d')?.getImageData(0, 0, bitmap.width, bitmap.height);

    expect(rendered ? getPixel(rendered, 0, 0) : null).toEqual([0, 0, 0, 0]);
  });

  it('renders nested isolated groups as a retained composite with group opacity', () => {
    const child = makeLayer('nested-child', [30, 180, 240, 255]);
    child.groupId = 'nested';
    const nested: ImageLayer = {
      id: 'nested', name: 'Nested', type: 'group', visible: true, locked: false,
      opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null, groupId: 'root',
    };
    const root: ImageLayer = {
      id: 'root', name: 'Root', type: 'group', visible: true, locked: false,
      opacity: 0.5, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null,
    };
    const rendered = renderImageDocumentLayersToBitmap(makeDoc({ layers: [child, nested, root] }))
      .getContext('2d')?.getImageData(0, 0, 2, 1);

    expect(rendered ? getPixel(rendered, 0, 0) : null).toEqual([30, 180, 240, 128]);
  });

  it('keeps pass-through group children live in the parent stack with inherited opacity', () => {
    const child = makeLayer('pass-child', [90, 40, 200, 255]);
    child.groupId = 'pass';
    const group: ImageLayer = {
      id: 'pass', name: 'Pass through', type: 'group', visible: true, locked: false,
      opacity: 0.25, blendMode: 'normal', groupPassThrough: true,
      x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null,
    };
    const rendered = renderImageDocumentLayersToBitmap(makeDoc({ layers: [child, group] }))
      .getContext('2d')?.getImageData(0, 0, 2, 1);

    expect(rendered ? getPixel(rendered, 0, 0) : null).toEqual([90, 40, 200, 64]);
  });

  it('treats an explicitly isolated non-Normal group as non-pass-through', () => {
    const group: ImageLayer = {
      id: 'multiply-folder', name: 'Multiply folder', type: 'group', visible: true, locked: false,
      opacity: 1, blendMode: 'multiply', groupPassThrough: false, x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null,
    };
    expect(isImageLayerGroupPassThrough(group)).toBe(false);
  });
});

describe('composeLayerBitmapWithLiveMasks memoization', () => {
  function maskedLayer(): ImageLayer {
    const layer = makeLayer('masked', [10, 20, 30, 255]);
    layer.mask = new OffscreenCanvas(2, 1) as LayerBitmap;
    return layer;
  }

  it('returns a cached result until the layer changes, and recomputes after a bitmapVersion bump', () => {
    clearMaskedLayerCache();
    setLiveMaskBypassLayer(null);
    const layer = maskedLayer();
    const first = composeLayerBitmapWithLiveMasks(layer);
    const second = composeLayerBitmapWithLiveMasks(layer);
    expect(first).not.toBeNull();
    expect(second).toBe(first); // cache hit — same masked bitmap reused

    const edited = { ...layer, bitmapVersion: layer.bitmapVersion + 1 };
    const third = composeLayerBitmapWithLiveMasks(edited);
    expect(third).not.toBe(first); // bitmapVersion bump invalidates the cache
  });

  it('bypasses the cache for the layer being actively painted (live mask preview stays fresh)', () => {
    clearMaskedLayerCache();
    const layer = maskedLayer();
    setLiveMaskBypassLayer(layer.id);
    const a = composeLayerBitmapWithLiveMasks(layer);
    const b = composeLayerBitmapWithLiveMasks(layer);
    expect(a).not.toBe(b); // recomputed each time while live (no stale masked composite)
    setLiveMaskBypassLayer(null);
  });
});

describe('compositeLayerRangeInto split-transparency', () => {
  function renderFull(doc: ImageDocument): ImageData {
    const bitmap = renderImageDocumentLayersToBitmap(doc);
    return bitmap.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height);
  }

  function renderSplit(doc: ImageDocument, k: number): ImageData {
    // Mirrors the live-stroke fast path: render the backdrop [0,k), then resume [k,n) from the
    // returned clipping state. Must match the unsplit full render exactly.
    const bitmap = createBitmap(doc.width, doc.height);
    const ctx = bitmap.getContext('2d')!;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    const state = compositeLayerRangeInto(bitmap, doc.layers, doc.width, doc.height, 0, k, null);
    compositeLayerRangeInto(bitmap, doc.layers, doc.width, doc.height, k, doc.layers.length, state);
    return bitmap.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height);
  }

  // Mirrors CompositeRenderer.compositeActiveAware exactly: render the backdrop [0,k) into one
  // canvas, drawImage-copy it into a scratch canvas, then resume [k,n) on the scratch.
  function renderViaBackdropCopy(doc: ImageDocument, k: number): ImageData {
    const backdrop = createBitmap(doc.width, doc.height);
    const bctx = backdrop.getContext('2d')!;
    bctx.clearRect(0, 0, backdrop.width, backdrop.height);
    const state = compositeLayerRangeInto(backdrop, doc.layers, doc.width, doc.height, 0, k, null);

    const scratch = createBitmap(doc.width, doc.height);
    const sctx = scratch.getContext('2d')!;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(backdrop, 0, 0);
    compositeLayerRangeInto(scratch, doc.layers, doc.width, doc.height, k, doc.layers.length, state);
    return scratch.getContext('2d')!.getImageData(0, 0, scratch.width, scratch.height);
  }

  it('produces identical pixels regardless of where the stack is split (incl. a clipping chain)', () => {
    const base = makeLayer('base', [200, 40, 40, 255]);
    const clipped: ImageLayer = { ...makeLayer('clipped', [40, 200, 40, 255]), clippingMask: true };
    const top = makeLayer('top', [40, 40, 200, 128]);
    const doc = makeDoc({ layers: [base, clipped, top], activeLayerId: 'clipped' });

    const full = renderFull(doc);
    for (let k = 0; k <= doc.layers.length; k += 1) {
      expect(Array.from(renderSplit(doc, k).data), `split at k=${k}`).toEqual(Array.from(full.data));
      expect(Array.from(renderViaBackdropCopy(doc, k).data), `backdrop-copy at k=${k}`).toEqual(Array.from(full.data));
    }
  });
});

describe('MH-051 retained adjustment staples', () => {
  it('mixes output RGB channels and retains the named settings defaults', () => {
    const settings = defaultAdjustmentSettings('channelMixer') as Extract<ImageAdjustmentSettings, { kind: 'channelMixer' }>;
    expect(settings).toMatchObject({ kind: 'channelMixer', red: [100, 0, 0], green: [0, 100, 0], blue: [0, 0, 100] });
    const mixed = applyAdjustmentToPixel([100, 40, 10, 255], { ...settings, red: [0, 100, 0] });
    expect(mixed).toEqual([40, 40, 10, 255]);
  });

  it('selectively grades only the requested colour family', () => {
    const settings = defaultAdjustmentSettings('selectiveColor') as Extract<ImageAdjustmentSettings, { kind: 'selectiveColor' }>;
    const changed = applyAdjustmentToPixel([220, 25, 20, 255], { ...settings, cyan: 20 });
    const untouched = applyAdjustmentToPixel([20, 25, 220, 255], { ...settings, cyan: 20 });
    expect(changed[0]).toBeLessThan(220);
    expect(untouched).toEqual([20, 25, 220, 255]);
  });
});

describe('MH-051 repair: Selective Colour targeting on realistic pixels', () => {
  type SelectiveSettings = Extract<ImageAdjustmentSettings, { kind: 'selectiveColor' }>;
  const base = defaultAdjustmentSettings('selectiveColor') as SelectiveSettings;
  const claims = (pixel: readonly number[], target: SelectiveSettings['target']) => {
    const graded = applyAdjustmentToPixel([pixel[0], pixel[1], pixel[2], pixel[3] ?? 255], { ...base, target, black: 20 });
    return graded[0] !== pixel[0] || graded[1] !== pixel[1] || graded[2] !== pixel[2];
  };

  const chromaticFamilies: Array<[SelectiveSettings['target'], readonly number[][]]> = [
    ['reds', [[178, 54, 40], [214, 48, 38]]],
    ['yellows', [[247, 220, 40], [230, 210, 90], [252, 235, 59]]],
    ['greens', [[58, 160, 52], [96, 182, 74]]],
    ['cyans', [[30, 200, 210], [80, 190, 220]]],
    ['blues', [[40, 80, 180], [70, 96, 205]]],
    ['magentas', [[210, 30, 200], [220, 90, 200]]],
  ];
  const chromaticTargets = chromaticFamilies.map(([target]) => target);

  it('claims realistic non-tie photo samples for their own family and no other family', () => {
    for (const [target, samples] of chromaticFamilies) {
      for (const pixel of samples) {
        for (const probed of chromaticTargets) {
          expect(claims(pixel, probed), `${probed} on ${JSON.stringify(pixel)}`).toBe(probed === target);
        }
      }
    }
  });

  it('splits hue-band boundaries deterministically instead of requiring exact channel ties', () => {
    // 30° red/yellow seam: exact tie falls to reds (table order), just past goes to yellows.
    expect(claims([200, 120, 40], 'reds')).toBe(true);
    expect(claims([200, 120, 40], 'yellows')).toBe(false);
    expect(claims([201, 121, 40], 'yellows')).toBe(true);
    expect(claims([201, 121, 40], 'reds')).toBe(false);
    // 330° magenta/red seam around hue wrap: exact tie falls to reds.
    expect(claims([240, 20, 130], 'reds')).toBe(true);
    expect(claims([240, 20, 130], 'magentas')).toBe(false);
    expect(claims([240, 20, 129], 'reds')).toBe(true);
    expect(claims([240, 20, 131], 'magentas')).toBe(true);
    // 150° green/cyan seam: exact tie falls to greens, just past goes to cyans.
    expect(claims([100, 250, 175], 'greens')).toBe(true);
    expect(claims([100, 250, 175], 'cyans')).toBe(false);
    expect(claims([100, 250, 176], 'cyans')).toBe(true);
  });

  it('keeps neutrals, blacks, and whites as the only claims on achromatic pixels', () => {
    const grays: readonly number[][] = [[128, 128, 128], [200, 199, 198]];
    const black = [8, 8, 8];
    const white = [245, 250, 240];
    const allTargets: SelectiveSettings['target'][] = [...chromaticTargets, 'whites', 'neutrals', 'blacks'];
    for (const pixel of grays) {
      for (const target of allTargets) {
        expect(claims(pixel, target), `${target} on ${JSON.stringify(pixel)}`).toBe(target === 'neutrals');
      }
    }
    for (const target of allTargets) {
      expect(claims(black, target)).toBe(target === 'blacks');
      expect(claims(white, target)).toBe(target === 'whites');
    }
  });

  it('leaves non-finite and desaturated-hostile pixels unmatched by every chromatic family', () => {
    const hostiles: ReadonlyArray<readonly [number, number, number]> = [
      [Number.NaN, Number.NaN, Number.NaN],
      [Number.NaN, 128, 64],
      [Number.POSITIVE_INFINITY, 10, 0],
      [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [-5, -300, -20],
    ];
    for (const [r, g, b] of hostiles) {
      for (const target of chromaticTargets) {
        const graded = applyAdjustmentToPixel([r, g, b, 255], { ...base, target, black: 20 });
        expect(graded).toEqual([r, g, b, 255]);
      }
    }
  });

  it('classifies hostile out-of-range channels deterministically through byte clamping', () => {
    // Clamps to [255, 0, 255]: a 300° hue that belongs to Magentas under the same wheel as valid bytes.
    const graded = applyAdjustmentToPixel([1000, -1000, 500, 255], { ...base, target: 'magentas', black: 20 });
    expect(graded).toEqual([255, 0, 255, 255]);
    // Unmatched targets return the hostile pixel exactly as supplied rather than guessing a family.
    expect(applyAdjustmentToPixel([1000, -1000, 500, 255], { ...base, target: 'cyans', black: 20 })).toEqual([1000, -1000, 500, 255]);
  });
});
