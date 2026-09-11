import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createAdjustmentLayer } from './ImageAdjustmentLayer';
import {
  buildAdjustmentLayerHistogram,
  buildAdjustmentHistogramFeedbackDescriptor,
  describeAdjustmentActionReadiness,
  describeAdjustmentHistogramFeedbackChecks,
  describeAdjustmentHistogramFeedbackReadiness,
  describeAdjustmentHistogramPreviewDependency,
  buildAdjustmentPreviewHistogramFeedback,
  isAdjustmentHistogramFeedbackChannelSupported,
} from './ImageAdjustmentHistogram';
import { buildImageHistogram } from './ImageHistogram';

class FakeContext {
  imageData: ImageData;

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height);
  }

  clearRect() {
    this.imageData.data.fill(0);
  }

  drawImage(image: unknown, dx = 0, dy = 0) {
    const source = (image as { context?: FakeContext }).context?.imageData;
    if (!source) return;
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const targetOffset = ((Math.round(dy + y) * this.imageData.width) + Math.round(dx + x)) * 4;
        const sourceOffset = ((y * source.width) + x) * 4;
        this.imageData.data[targetOffset] = source.data[sourceOffset];
        this.imageData.data[targetOffset + 1] = source.data[sourceOffset + 1];
        this.imageData.data[targetOffset + 2] = source.data[sourceOffset + 2];
        this.imageData.data[targetOffset + 3] = source.data[sourceOffset + 3];
      }
    }
  }

  fillRect() {}

  getImageData() {
    return cloneImageData(this.imageData);
  }

  putImageData(imageData: ImageData) {
    this.imageData = cloneImageData(imageData);
  }

  save() {}

  restore() {}
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
}

function makeImageData(width: number, height: number, data?: number[]): ImageData {
  return {
    width,
    height,
    data: data ? new Uint8ClampedArray(data) : new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function cloneImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function makeDoc(layers: ImageLayer[]): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 2,
    height: 1,
    layers,
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeLayer(id: string, rgba: [number, number, number, number]): ImageLayer {
  const bitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
  const imageData = makeImageData(2, 1);
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    imageData.data[offset] = rgba[0];
    imageData.data[offset + 1] = rgba[1];
    imageData.data[offset + 2] = rgba[2];
    imageData.data[offset + 3] = rgba[3];
  }
  bitmap.getContext('2d')?.putImageData(imageData, 0, 0);
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

describe('ImageAdjustmentHistogram', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
  });

  it('builds Levels and Curves histogram context from layers below the active adjustment only', () => {
    const lower = makeLayer('lower', [32, 40, 48, 255]);
    const levels = createAdjustmentLayer(makeDoc([]), 'levels', 'Levels');
    const upper = makeLayer('upper', [255, 255, 255, 255]);
    const histogram = buildAdjustmentLayerHistogram(makeDoc([lower, levels, upper]), levels);

    expect(histogram?.visiblePixels).toBe(2);
    expect(histogram?.channels.red[32]).toBe(2);
    expect(histogram?.channels.red[255]).toBe(0);
  });

  it('builds deterministic preview feedback labels from before and after histograms', () => {
    const before = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      128, 0, 0, 255,
      255, 0, 0, 255,
    ]));
    const after = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      64, 0, 0, 255,
      192, 0, 0, 255,
      255, 0, 0, 255,
    ]));

    expect(
      buildAdjustmentPreviewHistogramFeedback({
        adjustmentKind: 'levels',
        adjustmentChannel: 'rgb',
        beforeHistogram: before,
        afterHistogram: after,
      }),
    ).toEqual({
      adjustmentLabel: 'Levels preview',
      histogramChannel: 'luminance',
      channelLabel: 'Composite RGB',
      summaryLabel: 'Brighter composite tones',
      statsLabel: 'Luminance mean +7 (20 -> 27)',
      clippingLabel: 'Shadow clipping -1 px; highlight clipping unchanged',
      comparison: {
        channel: 'luminance',
        before: {
          min: 0,
          max: 54,
          mean: 20,
          clippedShadows: 2,
          clippedHighlights: 0,
          sampleCount: 4,
        },
        after: {
          min: 0,
          max: 54,
          mean: 27,
          clippedShadows: 1,
          clippedHighlights: 0,
          sampleCount: 4,
        },
        minDelta: 0,
        maxDelta: 0,
        meanDelta: 7,
        sampleCountDelta: 0,
        clippedShadowsDelta: -1,
        clippedHighlightsDelta: 0,
        tonalShift: 'brighter',
        contrastShift: 'stable',
        clippingShift: 'shadow-recovery',
      },
    });
  });

  it('describes histogram preview dependencies for adjustment planning', () => {
    expect(describeAdjustmentHistogramPreviewDependency({
      layerId: 'levels-1',
      adjustmentKind: 'levels',
      adjustmentChannel: 'rgb',
      documentSignature: 'doc:2x1:v4',
      layerIndex: 3,
      baseLayerIds: ['background', 'grade-base'],
    })).toEqual({
      version: 1,
      layerId: 'levels-1',
      required: true,
      supported: true,
      dependency: 'base-layers-before-adjustment',
      histogramChannel: 'luminance',
      sourceLayerIds: ['background', 'grade-base'],
      sourceSignature: 'histogram-preview:v1:{"layerId":"levels-1","kind":"levels","channel":"rgb","histogramChannel":"luminance","documentSignature":"doc:2x1:v4","layerIndex":3,"sourceLayerIds":["background","grade-base"]}',
      caveats: ['Histogram previews are advisory and use rendered 8-bit RGB canvas pixels from lower visible layers.'],
    });

    expect(describeAdjustmentHistogramPreviewDependency({
      layerId: 'hue-1',
      adjustmentKind: 'hueSaturation',
      adjustmentChannel: 'red',
      documentSignature: 'doc:2x1:v4',
      layerIndex: 1,
      baseLayerIds: ['background'],
    })).toMatchObject({
      required: false,
      supported: false,
      dependency: 'not-required',
      histogramChannel: 'red',
      caveats: ['Hue/Saturation previews do not require histogram feedback for planning.'],
    });
  });

  it('marks histogram readiness as blocked when no rendered base layers are available', () => {
    expect(describeAdjustmentHistogramPreviewDependency({
      layerId: 'levels-empty',
      adjustmentKind: 'levels',
      adjustmentChannel: 'rgb',
      documentSignature: 'doc:0x0:v1',
      layerIndex: 0,
      baseLayerIds: [],
    })).toEqual({
      version: 1,
      layerId: 'levels-empty',
      required: true,
      supported: false,
      dependency: 'base-layers-before-adjustment',
      histogramChannel: 'luminance',
      sourceLayerIds: [],
      sourceSignature: 'histogram-preview:v1:{"layerId":"levels-empty","kind":"levels","channel":"rgb","histogramChannel":"luminance","documentSignature":"doc:0x0:v1","layerIndex":0,"sourceLayerIds":[]}',
      caveats: [
        'Histogram preview is waiting for rendered lower visible layers before Levels/Curves feedback can be shown.',
        'Histogram previews are advisory and use rendered 8-bit RGB canvas pixels from lower visible layers.',
      ],
    });
  });

  it('builds deterministic before and after histogram feedback descriptors for adjustment previews', () => {
    const before = buildImageHistogram(makeImageData(3, 1, [
      0, 0, 0, 255,
      64, 64, 64, 255,
      255, 255, 255, 255,
    ]));
    const after = buildImageHistogram(makeImageData(3, 1, [
      16, 16, 16, 255,
      96, 96, 96, 255,
      240, 240, 240, 255,
    ]));

    expect(buildAdjustmentHistogramFeedbackDescriptor({
      layerId: 'adjustment-levels',
      adjustmentKind: 'levels',
      adjustmentChannel: 'rgb',
      beforeHistogram: before,
      afterHistogram: after,
      previewSignature: 'adjustment-layer:v1:levels',
    })).toEqual({
      version: 1,
      layerId: 'adjustment-levels',
      adjustmentKind: 'levels',
      histogramChannel: 'luminance',
      beforeVisiblePixels: 3,
      afterVisiblePixels: 3,
      feedback: {
        adjustmentLabel: 'Levels preview',
        histogramChannel: 'luminance',
        channelLabel: 'Composite RGB',
        summaryLabel: 'Brighter composite tones',
        statsLabel: 'Luminance mean +11 (106 -> 117)',
        clippingLabel: 'Shadow clipping -1 px; highlight clipping -1 px',
        comparison: {
          channel: 'luminance',
          before: {
            min: 0,
            max: 255,
            mean: 106,
            clippedShadows: 1,
            clippedHighlights: 1,
            sampleCount: 3,
          },
          after: {
            min: 16,
            max: 240,
            mean: 117,
            clippedShadows: 0,
            clippedHighlights: 0,
            sampleCount: 3,
          },
          minDelta: 16,
          maxDelta: -15,
          meanDelta: 11,
          sampleCountDelta: 0,
          clippedShadowsDelta: -1,
          clippedHighlightsDelta: -1,
          tonalShift: 'brighter',
          contrastShift: 'compressed',
          clippingShift: 'reduced',
        },
      },
      beforeAfterSignature: 'adjustment-histogram-feedback:v1:{"layerId":"adjustment-levels","kind":"levels","channel":"rgb","histogramChannel":"luminance","previewSignature":"adjustment-layer:v1:levels","beforeVisiblePixels":3,"afterVisiblePixels":3,"comparison":{"meanDelta":11,"clippedShadowsDelta":-1,"clippedHighlightsDelta":-1,"tonalShift":"brighter","contrastShift":"compressed","clippingShift":"reduced"}}',
    });
  });

  it('marks unsupported adjustment preview channels explicitly', () => {
    expect(isAdjustmentHistogramFeedbackChannelSupported('red')).toBe(true);
    expect(isAdjustmentHistogramFeedbackChannelSupported('alpha')).toBe(false);
  });

  it('describes preview/apply readiness blockers, unsupported Photoshop states, and handoff safety', () => {
    expect(describeAdjustmentActionReadiness({
      layerId: 'curves-1',
      adjustment: {
        kind: 'curves',
        channel: 'blue',
        points: [{ input: 0, output: 4 }],
        shadows: 0,
        midtones: 12,
        highlights: 0,
      },
      previewRequested: true,
      applyRequested: true,
      histogramSourceAvailable: false,
      sourceBinLinked: true,
      exportTarget: 'source-bin',
      batchDocumentCount: 3,
      photoshopEquivalentStates: ['native-curves-graph', 'camera-raw-filter'],
    })).toEqual({
      version: 1,
      layerId: 'curves-1',
      adjustmentKind: 'curves',
      histogramChannel: 'blue',
      preview: {
        requested: true,
        supported: false,
        semantics: 'preview-only',
        requiresHistogram: true,
        blockers: ['adjustment-histogram-source-unavailable', 'adjustment-parameters-invalid'],
      },
      apply: {
        requested: true,
        supported: false,
        semantics: 'non-destructive-adjustment-layer',
        blockers: ['adjustment-parameters-invalid'],
      },
      invalidParameterBlockers: [
        {
          code: 'adjustment-parameters-invalid',
          severity: 'blocker',
          parameter: 'points',
          message: 'Curves adjustments require at least two finite input/output points.',
        },
      ],
      unsupportedPhotoshopStates: [
        {
          state: 'native-curves-graph',
          severity: 'warning',
          message: 'Photoshop-equivalent state native-curves-graph is not represented by this adjustment readiness helper.',
        },
        {
          state: 'camera-raw-filter',
          severity: 'warning',
          message: 'Photoshop-equivalent state camera-raw-filter is not represented by this adjustment readiness helper.',
        },
      ],
      handoff: {
        exportTarget: 'source-bin',
        sourceBinLinked: true,
        safe: false,
        caveats: [
          'Source-bin handoff is blocked until invalid adjustment parameters are corrected.',
          'Source-bin export should include the adjustment preview signature so downstream Flow/Video consumers can detect stale renders.',
        ],
      },
      actionSuitability: {
        actionSafe: false,
        batchSafe: false,
        batchDocumentCount: 3,
        caveats: [
          'Action replay is blocked until readiness blockers are cleared.',
          'Batch application is blocked until all parameter and histogram requirements are satisfied.',
        ],
      },
      blockerCodes: ['adjustment-histogram-source-unavailable', 'adjustment-parameters-invalid'],
      warningCodes: ['unsupported-photoshop-equivalent-state'],
      signature: 'adjustment-action-readiness:v1:{"layerId":"curves-1","kind":"curves","histogramChannel":"blue","previewSupported":false,"applySupported":false,"blockerCodes":["adjustment-histogram-source-unavailable","adjustment-parameters-invalid"],"warningCodes":["unsupported-photoshop-equivalent-state"],"exportTarget":"source-bin","sourceBinLinked":true,"batchDocumentCount":3}',
    });
  });

  it('marks valid local Levels adjustments as action and single-document batch suitable', () => {
    expect(describeAdjustmentActionReadiness({
      layerId: 'levels-1',
      adjustment: {
        kind: 'levels',
        channel: 'rgb',
        inputBlack: 8,
        inputWhite: 240,
        gamma: 1.1,
        outputBlack: 4,
        outputWhite: 250,
      },
      previewRequested: true,
      applyRequested: true,
      histogramSourceAvailable: true,
      sourceBinLinked: false,
      exportTarget: 'document',
      batchDocumentCount: 1,
    })).toMatchObject({
      adjustmentKind: 'levels',
      histogramChannel: 'luminance',
      preview: {
        requested: true,
        supported: true,
        semantics: 'live-preview-before-apply',
        requiresHistogram: true,
        blockers: [],
      },
      apply: {
        requested: true,
        supported: true,
        semantics: 'non-destructive-adjustment-layer',
        blockers: [],
      },
      invalidParameterBlockers: [],
      handoff: {
        exportTarget: 'document',
        sourceBinLinked: false,
        safe: true,
        caveats: [],
      },
      actionSuitability: {
        actionSafe: true,
        batchSafe: true,
        batchDocumentCount: 1,
        caveats: [],
      },
      blockerCodes: [],
      warningCodes: [],
    });
  });

  it('describes adjustment histogram feedback readiness with scoped caveats and unsupported GPU preview state', () => {
    const before = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      64, 64, 64, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]));
    const after = buildImageHistogram(makeImageData(4, 1, [
      16, 16, 16, 255,
      64, 64, 64, 255,
      240, 240, 240, 255,
      255, 255, 255, 255,
    ]));

    const descriptor = describeAdjustmentHistogramFeedbackChecks({
      layerId: 'levels-feedback',
      adjustment: {
        kind: 'levels',
        channel: 'rgb',
        inputBlack: 4,
        inputWhite: 248,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      },
      sourceSignature: 'doc:hist:v1',
      previewSignature: 'adjustment-preview:v1:levels-feedback',
      previewRequested: true,
      histogramSourceAvailable: true,
      beforeHistogram: before,
      afterHistogram: after,
      channels: ['luminance', 'red'],
      maskFamily: 'raster-layer-mask',
      clippingFamily: 'layer-alpha',
      liveGpuPreviewRequested: true,
    });

    expect(descriptor).toMatchObject({
      version: 1,
      layerId: 'levels-feedback',
      adjustmentKind: 'levels',
      histogramChannel: 'luminance',
      preview: {
        requested: true,
        histogramRequired: true,
        ready: true,
        blockers: [],
      },
      histogramSignatures: {
        before: expect.stringContaining('"role":"before-adjustment"'),
        after: expect.stringContaining('"role":"after-adjustment"'),
        pair: expect.stringContaining('histogram-before-after:v1:'),
      },
      channelClippingDeltas: [
        {
          channel: 'luminance',
          clippedShadowsDelta: -1,
          clippedHighlightsDelta: -1,
          clippedTotalDelta: -2,
          clippingShift: 'reduced',
        },
        {
          channel: 'red',
          clippedShadowsDelta: -1,
          clippedHighlightsDelta: -1,
          clippedTotalDelta: -2,
          clippingShift: 'reduced',
        },
      ],
      caveats: [
        {
          code: 'masked-adjustment-feedback-advisory',
          severity: 'info',
          message: 'Masked adjustment histogram feedback is advisory because mask density or feathering can hide tonal changes outside the visible mask.',
        },
        {
          code: 'clipped-layer-feedback-advisory',
          severity: 'info',
          message: 'Clipped-layer histogram feedback is scoped by lower-layer alpha and should not be treated as full-document tone coverage.',
        },
        {
          code: 'gpu-preview-not-used-for-histogram-feedback',
          severity: 'warning',
          message: 'GPU adjustment preview is capability-gated for eligible compositor consumers; histogram feedback always uses deterministic rendered RGB metadata.',
        },
      ],
      liveGpuPreview: {
        requested: true,
        supported: false,
        state: 'not-used-for-histogram-feedback',
        caveats: ['GPU adjustment preview is capability-gated for eligible compositor consumers; histogram feedback always uses deterministic rendered RGB metadata.'],
      },
      blockers: [],
    });
    expect(descriptor.signature).toBe(describeAdjustmentHistogramFeedbackChecks({
      layerId: 'levels-feedback',
      adjustment: {
        kind: 'levels',
        channel: 'rgb',
        inputBlack: 4,
        inputWhite: 248,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      },
      sourceSignature: 'doc:hist:v1',
      previewSignature: 'adjustment-preview:v1:levels-feedback',
      previewRequested: true,
      histogramSourceAvailable: true,
      beforeHistogram: before,
      afterHistogram: after,
      channels: ['luminance', 'red'],
      maskFamily: 'raster-layer-mask',
      clippingFamily: 'layer-alpha',
      liveGpuPreviewRequested: true,
    }).signature);
    expect(descriptor.signature).toContain('"liveGpuPreview":"not-used-for-histogram-feedback"');
  });

  it('summarizes before-after histogram deltas, per-channel clipping feedback, and stable preview ids', () => {
    const before = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      64, 32, 16, 255,
      255, 64, 32, 255,
      255, 255, 255, 255,
    ]));
    const after = buildImageHistogram(makeImageData(4, 1, [
      16, 16, 16, 255,
      96, 48, 24, 255,
      240, 80, 40, 255,
      255, 255, 255, 255,
    ]));

    const descriptor = describeAdjustmentHistogramFeedbackReadiness({
      layerId: 'levels-feedback',
      adjustment: {
        kind: 'levels',
        channel: 'rgb',
        inputBlack: 4,
        inputWhite: 248,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      },
      sourceSignature: 'doc:hist:v2',
      previewSignature: 'adjustment-preview:v1:levels-feedback',
      previewRequested: true,
      histogramSourceAvailable: true,
      beforeHistogram: before,
      afterHistogram: after,
      channels: ['luminance', 'red', 'green', 'blue'],
      maskFamily: 'raster-layer-mask',
      clippingFamily: 'layer-alpha',
      liveGpuPreviewRequested: true,
    });

    expect(descriptor).toMatchObject({
      version: 1,
      layerId: 'levels-feedback',
      stablePreviewId: 'adjustment-preview:levels-feedback',
      histogramPairReady: true,
      beforeAfter: {
        visiblePixelDelta: 0,
        changedClippingChannels: ['luminance', 'red', 'green', 'blue'],
      },
      clippingFeedback: [
        {
          channel: 'luminance',
          beforeClippedShadows: 1,
          afterClippedShadows: 0,
          clippedShadowsDelta: -1,
          clippingShift: 'shadow-recovery',
          severity: 'info',
        },
        {
          channel: 'red',
          clippedShadowsDelta: -1,
          beforeClippedHighlights: 2,
          afterClippedHighlights: 1,
          clippedHighlightsDelta: -1,
          clippingShift: 'reduced',
          severity: 'info',
        },
        {
          channel: 'green',
          clippedShadowsDelta: -1,
          clippingShift: 'shadow-recovery',
          severity: 'info',
        },
        {
          channel: 'blue',
          clippedShadowsDelta: -1,
          clippingShift: 'shadow-recovery',
          severity: 'info',
        },
      ],
      scopeFeedback: {
        maskFamily: 'raster-layer-mask',
        clippingFamily: 'layer-alpha',
        advisory: true,
        caveatCodes: ['masked-adjustment-feedback-advisory', 'clipped-layer-feedback-advisory', 'gpu-preview-not-used-for-histogram-feedback'],
      },
      unsupportedStates: [
        {
          code: 'gpu-preview-not-used-for-histogram-feedback',
          status: 'unsupported',
          message: 'GPU adjustment preview is capability-gated for eligible compositor consumers; histogram feedback always uses deterministic rendered RGB metadata.',
        },
      ],
    });
    expect(descriptor.signature).toContain('adjustment-histogram-feedback-readiness:v1:');
    expect(descriptor.signature).toContain('"stablePreviewId":"adjustment-preview:levels-feedback"');
  });

  it('blocks adjustment histogram feedback readiness when source histograms are unavailable', () => {
    expect(describeAdjustmentHistogramFeedbackChecks({
      layerId: 'curves-feedback',
      adjustment: {
        kind: 'curves',
        channel: 'blue',
        points: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
        shadows: 0,
        midtones: 0,
        highlights: 0,
      },
      sourceSignature: 'doc:empty:v1',
      previewSignature: 'adjustment-preview:v1:curves-feedback',
      previewRequested: true,
      histogramSourceAvailable: false,
      beforeHistogram: null,
      afterHistogram: null,
      liveGpuPreviewRequested: false,
    })).toMatchObject({
      preview: {
        requested: true,
        histogramRequired: true,
        ready: false,
        blockers: [
          'adjustment-histogram-source-unavailable',
          'adjustment-before-histogram-unavailable',
          'adjustment-after-histogram-unavailable',
        ],
      },
      histogramSignatures: {
        before: null,
        after: null,
        pair: null,
      },
      channelClippingDeltas: [],
      caveats: [
        {
          code: 'adjustment-preview-not-ready',
          severity: 'warning',
          message: 'Adjustment histogram preview is not ready until before and after histogram signatures are available.',
        },
      ],
      liveGpuPreview: {
        requested: false,
        supported: false,
        state: 'not-requested',
        caveats: [],
      },
    });
  });
});
