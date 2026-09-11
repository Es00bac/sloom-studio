import type {
  AdjustmentLayerKind,
  ImageAdjustmentSettings,
  ImageDocument,
  ImageLayer,
} from '../../types/imageEditor';
import {
  renderImageDocumentLayersToBitmap,
  type AdjustmentLayerClippingFamily,
  type AdjustmentLayerMaskFamily,
} from './ImageAdjustmentLayer';
import {
  buildImageHistogram,
  buildImageHistogramSignature,
  compareHistogramChannelStats,
  describeImageHistogramBeforeAfterSignatures,
  type ImageHistogram,
  type ImageHistogramChannel,
  type ImageHistogramChannelComparison,
  type ImageHistogramChannelClippingDeltaDescriptor,
} from './ImageHistogram';
import { getBitmapImageData } from './LayerBitmap';

type AdjustmentPreviewChannel = 'rgb' | 'red' | 'green' | 'blue';

export interface AdjustmentPreviewHistogramFeedback {
  adjustmentLabel: string;
  histogramChannel: ImageHistogramChannel;
  channelLabel: string;
  summaryLabel: string;
  statsLabel: string;
  clippingLabel: string;
  comparison: ImageHistogramChannelComparison;
}

export interface AdjustmentHistogramFeedbackDescriptor {
  version: 1;
  layerId: string;
  adjustmentKind: AdjustmentLayerKind;
  histogramChannel: ImageHistogramChannel;
  beforeVisiblePixels: number;
  afterVisiblePixels: number;
  feedback: AdjustmentPreviewHistogramFeedback;
  beforeAfterSignature: string;
}

export interface AdjustmentHistogramPreviewDependencyDescriptor {
  version: 1;
  layerId: string;
  required: boolean;
  supported: boolean;
  dependency: 'base-layers-before-adjustment' | 'not-required';
  histogramChannel: ImageHistogramChannel;
  sourceLayerIds: string[];
  sourceSignature: string;
  caveats: string[];
}

export type AdjustmentReadinessBlockerCode =
  | 'adjustment-histogram-source-unavailable'
  | 'adjustment-parameters-invalid';

export interface AdjustmentActionReadinessBlocker {
  code: 'adjustment-parameters-invalid';
  severity: 'blocker';
  parameter: string;
  message: string;
}

export interface UnsupportedPhotoshopEquivalentStateDescriptor {
  state: string;
  severity: 'warning';
  message: string;
}

export interface AdjustmentActionReadinessDescriptor {
  version: 1;
  layerId: string;
  adjustmentKind: AdjustmentLayerKind;
  histogramChannel: ImageHistogramChannel;
  preview: {
    requested: boolean;
    supported: boolean;
    semantics: 'not-requested' | 'preview-only' | 'live-preview-before-apply';
    requiresHistogram: boolean;
    blockers: AdjustmentReadinessBlockerCode[];
  };
  apply: {
    requested: boolean;
    supported: boolean;
    semantics: 'not-requested' | 'non-destructive-adjustment-layer';
    blockers: AdjustmentReadinessBlockerCode[];
  };
  invalidParameterBlockers: AdjustmentActionReadinessBlocker[];
  unsupportedPhotoshopStates: UnsupportedPhotoshopEquivalentStateDescriptor[];
  handoff: {
    exportTarget: 'document' | 'source-bin' | 'download';
    sourceBinLinked: boolean;
    safe: boolean;
    caveats: string[];
  };
  actionSuitability: {
    actionSafe: boolean;
    batchSafe: boolean;
    batchDocumentCount: number;
    caveats: string[];
  };
  blockerCodes: AdjustmentReadinessBlockerCode[];
  warningCodes: Array<'unsupported-photoshop-equivalent-state'>;
  signature: string;
}

export type AdjustmentHistogramFeedbackCheckBlockerCode =
  | AdjustmentReadinessBlockerCode
  | 'adjustment-before-histogram-unavailable'
  | 'adjustment-after-histogram-unavailable';

export type AdjustmentHistogramFeedbackCaveatCode =
  | 'adjustment-preview-not-ready'
  | 'masked-adjustment-feedback-advisory'
  | 'clipped-layer-feedback-advisory'
  | 'gpu-preview-not-used-for-histogram-feedback';

export interface AdjustmentHistogramFeedbackCaveat {
  code: AdjustmentHistogramFeedbackCaveatCode;
  severity: 'info' | 'warning';
  message: string;
}

export interface AdjustmentHistogramFeedbackChecksDescriptor {
  version: 1;
  layerId: string;
  adjustmentKind: AdjustmentLayerKind;
  histogramChannel: ImageHistogramChannel;
  previewSignature: string;
  preview: {
    requested: boolean;
    histogramRequired: boolean;
    ready: boolean;
    blockers: AdjustmentHistogramFeedbackCheckBlockerCode[];
  };
  histogramSignatures: {
    before: string | null;
    after: string | null;
    pair: string | null;
  };
  channelClippingDeltas: ImageHistogramChannelClippingDeltaDescriptor[];
  caveats: AdjustmentHistogramFeedbackCaveat[];
  liveGpuPreview: {
    requested: boolean;
    supported: false;
    state: 'not-requested' | 'not-used-for-histogram-feedback';
    caveats: string[];
  };
  blockers: AdjustmentHistogramFeedbackCheckBlockerCode[];
  signature: string;
}

export interface AdjustmentHistogramChannelClippingFeedbackDescriptor extends ImageHistogramChannelClippingDeltaDescriptor {
  severity: 'info' | 'warning';
  label: string;
}

export interface AdjustmentHistogramFeedbackReadinessDescriptor {
  version: 1;
  layerId: string;
  adjustmentKind: AdjustmentLayerKind;
  histogramChannel: ImageHistogramChannel;
  stablePreviewId: string;
  previewSignature: string;
  histogramPairReady: boolean;
  beforeAfter: {
    beforeSignature: string | null;
    afterSignature: string | null;
    pairSignature: string | null;
    visiblePixelDelta: number | null;
    changedClippingChannels: ImageHistogramChannel[];
  };
  clippingFeedback: AdjustmentHistogramChannelClippingFeedbackDescriptor[];
  scopeFeedback: {
    maskFamily: AdjustmentLayerMaskFamily;
    clippingFamily: AdjustmentLayerClippingFamily;
    advisory: boolean;
    caveatCodes: AdjustmentHistogramFeedbackCaveatCode[];
  };
  unsupportedStates: Array<{
    code: 'gpu-preview-not-used-for-histogram-feedback';
    status: 'unsupported';
    message: string;
  }>;
  checks: AdjustmentHistogramFeedbackChecksDescriptor;
  signature: string;
}

type AdjustmentHistogramFeedbackChannel = Extract<ImageHistogramChannel, 'red' | 'green' | 'blue'>;

export function isAdjustmentHistogramFeedbackChannelSupported(
  channel: ImageHistogramChannel,
): channel is AdjustmentHistogramFeedbackChannel {
  return channel === 'red' || channel === 'green' || channel === 'blue';
}

export function buildAdjustmentLayerHistogram(
  doc: ImageDocument,
  layer: ImageLayer,
): ImageHistogram | null {
  if (layer.type !== 'adjustment') return null;
  if (!layer.adjustment || (layer.adjustment.kind !== 'levels' && layer.adjustment.kind !== 'curves')) {
    return null;
  }
  const layerIndex = doc.layers.findIndex((candidate) => candidate.id === layer.id);
  if (layerIndex <= 0) return null;

  const baseDoc: ImageDocument = {
    ...doc,
    layers: doc.layers.slice(0, layerIndex),
    activeLayerId: null,
  };
  const bitmap = renderImageDocumentLayersToBitmap(baseDoc);
  return buildImageHistogram(getBitmapImageData(bitmap));
}

export function describeAdjustmentHistogramPreviewDependency(options: {
  layerId: string;
  adjustmentKind: AdjustmentLayerKind;
  adjustmentChannel: AdjustmentPreviewChannel;
  documentSignature: string;
  layerIndex: number;
  baseLayerIds: string[];
}): AdjustmentHistogramPreviewDependencyDescriptor {
  const histogramChannel = getHistogramChannelForAdjustment(options.adjustmentChannel);
  const required = options.adjustmentKind === 'levels' || options.adjustmentKind === 'curves';
  const baseLayersAvailable = options.baseLayerIds.length > 0;
  const sourceLayerIds = [...options.baseLayerIds];
  const sourceSignature = `histogram-preview:v1:${JSON.stringify({
    layerId: options.layerId,
    kind: options.adjustmentKind,
    channel: options.adjustmentChannel,
    histogramChannel,
    documentSignature: options.documentSignature,
    layerIndex: normalizeLayerIndex(options.layerIndex),
    sourceLayerIds,
  })}`;

  return {
    version: 1,
    layerId: options.layerId,
    required,
    supported: required ? baseLayersAvailable : false,
    dependency: required ? 'base-layers-before-adjustment' : 'not-required',
    histogramChannel,
    sourceLayerIds,
    sourceSignature,
    caveats: required
      ? [
          ...(!baseLayersAvailable
            ? ['Histogram preview is waiting for rendered lower visible layers before Levels/Curves feedback can be shown.']
            : []),
          'Histogram previews are advisory and use rendered 8-bit RGB canvas pixels from lower visible layers.',
        ]
      : [`${getAdjustmentKindLabel(options.adjustmentKind)} previews do not require histogram feedback for planning.`],
  };
}

export function buildAdjustmentPreviewHistogramFeedback(options: {
  adjustmentKind: AdjustmentLayerKind;
  adjustmentChannel: AdjustmentPreviewChannel;
  beforeHistogram: ImageHistogram;
  afterHistogram: ImageHistogram;
}): AdjustmentPreviewHistogramFeedback {
  const histogramChannel = getHistogramChannelForAdjustment(options.adjustmentChannel);
  const comparison = compareHistogramChannelStats(
    options.beforeHistogram,
    options.afterHistogram,
    histogramChannel,
  );

  return {
    adjustmentLabel: `${getAdjustmentKindLabel(options.adjustmentKind)} preview`,
    histogramChannel,
    channelLabel: getAdjustmentChannelLabel(options.adjustmentChannel),
    summaryLabel: `${capitalize(comparison.tonalShift)} ${getAdjustmentSummarySubject(options.adjustmentChannel)}`,
    statsLabel: `${getHistogramChannelLabel(histogramChannel)} mean ${formatSignedDelta(comparison.meanDelta)} (${formatNullableStat(comparison.before.mean)} -> ${formatNullableStat(comparison.after.mean)})`,
    clippingLabel: `Shadow clipping ${formatPixelDelta(comparison.clippedShadowsDelta)}; highlight clipping ${formatPixelDelta(comparison.clippedHighlightsDelta)}`,
    comparison,
  };
}

export function buildAdjustmentHistogramFeedbackDescriptor(options: {
  layerId: string;
  adjustmentKind: AdjustmentLayerKind;
  adjustmentChannel: AdjustmentPreviewChannel;
  beforeHistogram: ImageHistogram;
  afterHistogram: ImageHistogram;
  previewSignature: string;
}): AdjustmentHistogramFeedbackDescriptor {
  const histogramChannel = getHistogramChannelForAdjustment(options.adjustmentChannel);
  const feedback = buildAdjustmentPreviewHistogramFeedback({
    adjustmentKind: options.adjustmentKind,
    adjustmentChannel: options.adjustmentChannel,
    beforeHistogram: options.beforeHistogram,
    afterHistogram: options.afterHistogram,
  });
  const comparison = feedback.comparison;
  const beforeAfterSignature = `adjustment-histogram-feedback:v1:${JSON.stringify({
    layerId: options.layerId,
    kind: options.adjustmentKind,
    channel: options.adjustmentChannel,
    histogramChannel,
    previewSignature: options.previewSignature,
    beforeVisiblePixels: options.beforeHistogram.visiblePixels,
    afterVisiblePixels: options.afterHistogram.visiblePixels,
    comparison: {
      meanDelta: comparison.meanDelta,
      clippedShadowsDelta: comparison.clippedShadowsDelta,
      clippedHighlightsDelta: comparison.clippedHighlightsDelta,
      tonalShift: comparison.tonalShift,
      contrastShift: comparison.contrastShift,
      clippingShift: comparison.clippingShift,
    },
  })}`;

  return {
    version: 1,
    layerId: options.layerId,
    adjustmentKind: options.adjustmentKind,
    histogramChannel,
    beforeVisiblePixels: options.beforeHistogram.visiblePixels,
    afterVisiblePixels: options.afterHistogram.visiblePixels,
    feedback,
    beforeAfterSignature,
  };
}

export function describeAdjustmentActionReadiness(options: {
  layerId: string;
  adjustment: ImageAdjustmentSettings;
  previewRequested?: boolean;
  applyRequested?: boolean;
  histogramSourceAvailable?: boolean;
  sourceBinLinked?: boolean;
  exportTarget?: 'document' | 'source-bin' | 'download';
  batchDocumentCount?: number;
  photoshopEquivalentStates?: string[];
}): AdjustmentActionReadinessDescriptor {
  const histogramChannel = getHistogramChannelForAdjustment(getAdjustmentPreviewChannel(options.adjustment));
  const requiresHistogram = options.adjustment.kind === 'levels' || options.adjustment.kind === 'curves';
  const previewRequested = options.previewRequested ?? false;
  const applyRequested = options.applyRequested ?? false;
  const histogramSourceAvailable = options.histogramSourceAvailable ?? true;
  const sourceBinLinked = options.sourceBinLinked ?? false;
  const exportTarget = options.exportTarget ?? 'document';
  const batchDocumentCount = Math.max(1, Math.round(options.batchDocumentCount ?? 1));
  const invalidParameterBlockers = validateAdjustmentParameters(options.adjustment);
  const blockerCodes = uniqueBlockerCodes([
    ...(requiresHistogram && !histogramSourceAvailable ? ['adjustment-histogram-source-unavailable' as const] : []),
    ...(invalidParameterBlockers.length > 0 ? ['adjustment-parameters-invalid' as const] : []),
  ]);
  const previewBlockers = uniqueBlockerCodes([
    ...(requiresHistogram && !histogramSourceAvailable ? ['adjustment-histogram-source-unavailable' as const] : []),
    ...(invalidParameterBlockers.length > 0 ? ['adjustment-parameters-invalid' as const] : []),
  ]);
  const applyBlockers = uniqueBlockerCodes([
    ...(invalidParameterBlockers.length > 0 ? ['adjustment-parameters-invalid' as const] : []),
  ]);
  const unsupportedPhotoshopStates = (options.photoshopEquivalentStates ?? []).map((state) => ({
    state,
    severity: 'warning' as const,
    message: `Photoshop-equivalent state ${state} is not represented by this adjustment readiness helper.`,
  }));
  const warningCodes = unsupportedPhotoshopStates.length > 0
    ? ['unsupported-photoshop-equivalent-state' as const]
    : [];
  const handoffCaveats = buildHandoffCaveats({
    exportTarget,
    sourceBinLinked,
    hasBlockers: blockerCodes.length > 0,
  });
  const actionCaveats = buildActionSuitabilityCaveats({
    hasBlockers: blockerCodes.length > 0,
    batchDocumentCount,
    requiresHistogram,
    histogramSourceAvailable,
  });
  const previewSupported = previewRequested && previewBlockers.length === 0;
  const applySupported = applyRequested && applyBlockers.length === 0;
  const handoffSafe = handoffCaveats.length === 0;
  const actionSafe = blockerCodes.length === 0;
  const batchSafe = actionSafe && actionCaveats.length === 0;

  return {
    version: 1,
    layerId: options.layerId,
    adjustmentKind: options.adjustment.kind,
    histogramChannel,
    preview: {
      requested: previewRequested,
      supported: previewSupported,
      semantics: previewRequested
        ? (previewSupported ? 'live-preview-before-apply' : 'preview-only')
        : 'not-requested',
      requiresHistogram,
      blockers: previewBlockers,
    },
    apply: {
      requested: applyRequested,
      supported: applySupported,
      semantics: applyRequested ? 'non-destructive-adjustment-layer' : 'not-requested',
      blockers: applyBlockers,
    },
    invalidParameterBlockers,
    unsupportedPhotoshopStates,
    handoff: {
      exportTarget,
      sourceBinLinked,
      safe: handoffSafe,
      caveats: handoffCaveats,
    },
    actionSuitability: {
      actionSafe,
      batchSafe,
      batchDocumentCount,
      caveats: actionCaveats,
    },
    blockerCodes,
    warningCodes,
    signature: `adjustment-action-readiness:v1:${JSON.stringify({
      layerId: options.layerId,
      kind: options.adjustment.kind,
      histogramChannel,
      previewSupported,
      applySupported,
      blockerCodes,
      warningCodes,
      exportTarget,
      sourceBinLinked,
      batchDocumentCount,
    })}`,
  };
}

export function describeAdjustmentHistogramFeedbackChecks(options: {
  layerId: string;
  adjustment: ImageAdjustmentSettings;
  sourceSignature: string;
  previewSignature: string;
  previewRequested?: boolean;
  histogramSourceAvailable?: boolean;
  beforeHistogram?: ImageHistogram | null;
  afterHistogram?: ImageHistogram | null;
  channels?: ImageHistogramChannel[];
  maskFamily?: AdjustmentLayerMaskFamily;
  clippingFamily?: AdjustmentLayerClippingFamily;
  liveGpuPreviewRequested?: boolean;
}): AdjustmentHistogramFeedbackChecksDescriptor {
  const previewRequested = options.previewRequested ?? false;
  const histogramSourceAvailable = options.histogramSourceAvailable ?? true;
  const histogramRequired = options.adjustment.kind === 'levels' || options.adjustment.kind === 'curves';
  const histogramChannel = getHistogramChannelForAdjustment(getAdjustmentPreviewChannel(options.adjustment));
  const beforeHistogram = options.beforeHistogram ?? null;
  const afterHistogram = options.afterHistogram ?? null;
  const invalidParameterBlockers = validateAdjustmentParameters(options.adjustment);
  const blockers = uniqueFeedbackBlockerCodes([
    ...(histogramRequired && !histogramSourceAvailable
      ? ['adjustment-histogram-source-unavailable' as const]
      : []),
    ...(histogramRequired && !beforeHistogram
      ? ['adjustment-before-histogram-unavailable' as const]
      : []),
    ...(previewRequested && !afterHistogram
      ? ['adjustment-after-histogram-unavailable' as const]
      : []),
    ...(invalidParameterBlockers.length > 0
      ? ['adjustment-parameters-invalid' as const]
      : []),
  ]);
  const channels = [...(options.channels ?? [histogramChannel])];
  const beforeAfter = beforeHistogram && afterHistogram
    ? describeImageHistogramBeforeAfterSignatures({
      beforeHistogram,
      afterHistogram,
      sourceSignature: options.sourceSignature,
      channels,
    })
    : null;
  const beforeSignature = beforeAfter?.beforeSignature
    ?? (beforeHistogram
      ? buildImageHistogramSignature(beforeHistogram, {
        role: 'before-adjustment',
        sourceSignature: options.sourceSignature,
        channels,
      })
      : null);
  const afterSignature = beforeAfter?.afterSignature
    ?? (afterHistogram
      ? buildImageHistogramSignature(afterHistogram, {
        role: 'after-adjustment',
        sourceSignature: options.sourceSignature,
        channels,
      })
      : null);
  const previewReady = previewRequested && blockers.length === 0;
  const liveGpuPreview = buildLiveGpuPreviewDescriptor(options.liveGpuPreviewRequested ?? false);
  const caveats = buildAdjustmentHistogramFeedbackCaveats({
    previewRequested,
    previewReady,
    maskFamily: options.maskFamily ?? 'none',
    clippingFamily: options.clippingFamily ?? 'none',
    liveGpuPreview,
  });
  const channelClippingDeltas = beforeAfter?.channelClippingDeltas ?? [];

  return {
    version: 1,
    layerId: options.layerId,
    adjustmentKind: options.adjustment.kind,
    histogramChannel,
    previewSignature: options.previewSignature,
    preview: {
      requested: previewRequested,
      histogramRequired,
      ready: previewReady,
      blockers,
    },
    histogramSignatures: {
      before: beforeSignature,
      after: afterSignature,
      pair: beforeAfter?.stableSignature ?? null,
    },
    channelClippingDeltas,
    caveats,
    liveGpuPreview,
    blockers,
    signature: `adjustment-histogram-feedback-checks:v1:${JSON.stringify({
      layerId: options.layerId,
      kind: options.adjustment.kind,
      histogramChannel,
      previewSignature: options.previewSignature,
      previewReady,
      blockers,
      beforeSignature,
      afterSignature,
      pairSignature: beforeAfter?.stableSignature ?? null,
      channelClippingDeltas: channelClippingDeltas.map((delta) => ({
        channel: delta.channel,
        clippedShadowsDelta: delta.clippedShadowsDelta,
        clippedHighlightsDelta: delta.clippedHighlightsDelta,
        clippedTotalDelta: delta.clippedTotalDelta,
        clippingShift: delta.clippingShift,
      })),
      caveatCodes: caveats.map((caveat) => caveat.code),
      liveGpuPreview: liveGpuPreview.state,
    })}`,
  };
}

export function describeAdjustmentHistogramFeedbackReadiness(options: {
  layerId: string;
  adjustment: ImageAdjustmentSettings;
  sourceSignature: string;
  previewSignature: string;
  previewRequested?: boolean;
  histogramSourceAvailable?: boolean;
  beforeHistogram?: ImageHistogram | null;
  afterHistogram?: ImageHistogram | null;
  channels?: ImageHistogramChannel[];
  maskFamily?: AdjustmentLayerMaskFamily;
  clippingFamily?: AdjustmentLayerClippingFamily;
  liveGpuPreviewRequested?: boolean;
}): AdjustmentHistogramFeedbackReadinessDescriptor {
  const checks = describeAdjustmentHistogramFeedbackChecks(options);
  const beforeHistogram = options.beforeHistogram ?? null;
  const afterHistogram = options.afterHistogram ?? null;
  const histogramPairReady = beforeHistogram !== null && afterHistogram !== null && checks.histogramSignatures.pair !== null;
  const clippingFeedback = checks.channelClippingDeltas
    .filter((delta) => delta.clippedShadowsDelta !== 0 || delta.clippedHighlightsDelta !== 0)
    .map((delta) => ({
      ...delta,
      severity: Math.abs(delta.clippedTotalDelta) > 4 ? 'warning' as const : 'info' as const,
      label: `${getHistogramChannelLabel(delta.channel)} clipping ${formatPixelDelta(delta.clippedTotalDelta)}`,
    }));
  const unsupportedStates = checks.liveGpuPreview.state === 'not-used-for-histogram-feedback'
    ? checks.liveGpuPreview.caveats.map((message) => ({
      code: 'gpu-preview-not-used-for-histogram-feedback' as const,
      status: 'unsupported' as const,
      message,
    }))
    : [];
  const caveatCodes = checks.caveats.map((caveat) => caveat.code);
  const stablePreviewId = `adjustment-preview:${options.layerId}`;
  const beforeAfter = {
    beforeSignature: checks.histogramSignatures.before,
    afterSignature: checks.histogramSignatures.after,
    pairSignature: checks.histogramSignatures.pair,
    visiblePixelDelta: beforeHistogram && afterHistogram ? afterHistogram.visiblePixels - beforeHistogram.visiblePixels : null,
    changedClippingChannels: checks.channelClippingDeltas
      .filter((delta) => delta.clippedShadowsDelta !== 0 || delta.clippedHighlightsDelta !== 0)
      .map((delta) => delta.channel),
  };

  return {
    version: 1,
    layerId: options.layerId,
    adjustmentKind: options.adjustment.kind,
    histogramChannel: checks.histogramChannel,
    stablePreviewId,
    previewSignature: options.previewSignature,
    histogramPairReady,
    beforeAfter,
    clippingFeedback,
    scopeFeedback: {
      maskFamily: options.maskFamily ?? 'none',
      clippingFamily: options.clippingFamily ?? 'none',
      advisory: caveatCodes.includes('masked-adjustment-feedback-advisory')
        || caveatCodes.includes('clipped-layer-feedback-advisory'),
      caveatCodes,
    },
    unsupportedStates,
    checks,
    signature: `adjustment-histogram-feedback-readiness:v1:${JSON.stringify({
      layerId: options.layerId,
      adjustmentKind: options.adjustment.kind,
      histogramChannel: checks.histogramChannel,
      stablePreviewId,
      previewSignature: options.previewSignature,
      histogramPairReady,
      beforeAfter,
      clippingFeedback: clippingFeedback.map((feedback) => ({
        channel: feedback.channel,
        clippedShadowsDelta: feedback.clippedShadowsDelta,
        clippedHighlightsDelta: feedback.clippedHighlightsDelta,
        clippedTotalDelta: feedback.clippedTotalDelta,
        clippingShift: feedback.clippingShift,
        severity: feedback.severity,
      })),
      caveatCodes,
      unsupportedStateCodes: unsupportedStates.map((state) => state.code),
      checksSignature: checks.signature,
    })}`,
  };
}

function getHistogramChannelForAdjustment(channel: AdjustmentPreviewChannel): ImageHistogramChannel {
  switch (channel) {
    case 'rgb':
      return 'luminance';
    case 'red':
      return 'red';
    case 'green':
      return 'green';
    case 'blue':
      return 'blue';
  }
}

function getAdjustmentPreviewChannel(adjustment: ImageAdjustmentSettings): AdjustmentPreviewChannel {
  return adjustment.kind === 'levels' || adjustment.kind === 'curves' ? adjustment.channel : 'rgb';
}

function getAdjustmentKindLabel(kind: AdjustmentLayerKind): string {
  switch (kind) {
    case 'brightnessContrast':
      return 'Brightness/Contrast';
    case 'hueSaturation':
      return 'Hue/Saturation';
    case 'blackWhite':
      return 'Black & White';
    case 'invert':
      return 'Invert';
    case 'exposure':
      return 'Exposure';
    case 'temperatureTint':
      return 'Temperature/Tint';
    case 'levels':
      return 'Levels';
    case 'curves':
      return 'Curves';
    case 'lut':
      return 'LUT';
    case 'gradientMap':
      return 'Gradient Map';
    case 'channelMixer':
      return 'Channel Mixer';
    case 'selectiveColor':
      return 'Selective Colour';
  }
}

function validateAdjustmentParameters(adjustment: ImageAdjustmentSettings): AdjustmentActionReadinessBlocker[] {
  switch (adjustment.kind) {
    case 'brightnessContrast':
      return validateFiniteParameters(adjustment, ['brightness', 'contrast']);
    case 'hueSaturation':
      return validateFiniteParameters(adjustment, ['hue', 'saturation', 'lightness']);
    case 'exposure': {
      const blockers = validateFiniteParameters(adjustment, ['exposure', 'offset', 'gamma']);
      if (!Number.isFinite(adjustment.gamma) || adjustment.gamma <= 0) {
        blockers.push({
          code: 'adjustment-parameters-invalid',
          severity: 'blocker',
          parameter: 'gamma',
          message: 'Exposure gamma must be a finite value greater than zero.',
        });
      }
      return blockers;
    }
    case 'temperatureTint':
      return validateFiniteParameters(adjustment, ['temperature', 'tint']);
    case 'levels': {
      const blockers = validateFiniteParameters(adjustment, ['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite']);
      if (adjustment.inputBlack >= adjustment.inputWhite) {
        blockers.push({
          code: 'adjustment-parameters-invalid',
          severity: 'blocker',
          parameter: 'inputRange',
          message: 'Levels input black must be lower than input white.',
        });
      }
      if (!Number.isFinite(adjustment.gamma) || adjustment.gamma <= 0) {
        blockers.push({
          code: 'adjustment-parameters-invalid',
          severity: 'blocker',
          parameter: 'gamma',
          message: 'Levels gamma must be a finite value greater than zero.',
        });
      }
      return blockers;
    }
    case 'curves':
      if (
        adjustment.points.length < 2
        || adjustment.points.some((point) => !Number.isFinite(point.input) || !Number.isFinite(point.output))
      ) {
        return [{
          code: 'adjustment-parameters-invalid',
          severity: 'blocker',
          parameter: 'points',
          message: 'Curves adjustments require at least two finite input/output points.',
        }];
      }
      return validateFiniteParameters(adjustment, ['shadows', 'midtones', 'highlights']);
    case 'blackWhite':
    case 'invert':
      return [];
    case 'lut':
      return adjustment.lutData && adjustment.lutData.length !== 256
        ? [{ code: 'adjustment-parameters-invalid', severity: 'blocker', parameter: 'lutData', message: 'LUT data must contain 256 entries.' }]
        : [];
    case 'gradientMap':
      return adjustment.stops.length < 2
        ? [{ code: 'adjustment-parameters-invalid', severity: 'blocker', parameter: 'stops', message: 'Gradient Map requires at least two color stops.' }]
        : [];
    case 'channelMixer':
      return (['red', 'green', 'blue', 'constant'] as const).flatMap((parameter) => {
        const values = adjustment[parameter];
        return values.length === 3 && values.every(Number.isFinite)
          ? []
          : [{ code: 'adjustment-parameters-invalid' as const, severity: 'blocker' as const, parameter, message: `Channel Mixer ${parameter} must contain three finite values.` }];
      });
    case 'selectiveColor':
      return validateFiniteParameters(adjustment, ['cyan', 'magenta', 'yellow', 'black']);
  }
}

function validateFiniteParameters<T extends Record<string, unknown>>(
  source: T,
  keys: Array<keyof T & string>,
): AdjustmentActionReadinessBlocker[] {
  return keys
    .filter((key) => typeof source[key] !== 'number' || !Number.isFinite(source[key]))
    .map((parameter) => ({
      code: 'adjustment-parameters-invalid' as const,
      severity: 'blocker' as const,
      parameter,
      message: `${parameter} must be a finite number.`,
    }));
}

function uniqueBlockerCodes(codes: AdjustmentReadinessBlockerCode[]): AdjustmentReadinessBlockerCode[] {
  return codes.filter((code, index) => codes.indexOf(code) === index);
}

function uniqueFeedbackBlockerCodes(
  codes: AdjustmentHistogramFeedbackCheckBlockerCode[],
): AdjustmentHistogramFeedbackCheckBlockerCode[] {
  return codes.filter((code, index) => codes.indexOf(code) === index);
}

function buildLiveGpuPreviewDescriptor(
  requested: boolean,
): AdjustmentHistogramFeedbackChecksDescriptor['liveGpuPreview'] {
  if (!requested) {
    return {
      requested: false,
      supported: false,
      state: 'not-requested',
      caveats: [],
    };
  }
  return {
    requested: true,
    supported: false,
    state: 'not-used-for-histogram-feedback',
    caveats: ['GPU adjustment preview is capability-gated for eligible compositor consumers; histogram feedback always uses deterministic rendered RGB metadata.'],
  };
}

function buildAdjustmentHistogramFeedbackCaveats(options: {
  previewRequested: boolean;
  previewReady: boolean;
  maskFamily: AdjustmentLayerMaskFamily;
  clippingFamily: AdjustmentLayerClippingFamily;
  liveGpuPreview: AdjustmentHistogramFeedbackChecksDescriptor['liveGpuPreview'];
}): AdjustmentHistogramFeedbackCaveat[] {
  const caveats: AdjustmentHistogramFeedbackCaveat[] = [];
  if (options.previewRequested && !options.previewReady) {
    caveats.push({
      code: 'adjustment-preview-not-ready',
      severity: 'warning',
      message: 'Adjustment histogram preview is not ready until before and after histogram signatures are available.',
    });
  }
  if (options.maskFamily !== 'none') {
    caveats.push({
      code: 'masked-adjustment-feedback-advisory',
      severity: 'info',
      message: 'Masked adjustment histogram feedback is advisory because mask density or feathering can hide tonal changes outside the visible mask.',
    });
  }
  if (options.clippingFamily !== 'none') {
    caveats.push({
      code: 'clipped-layer-feedback-advisory',
      severity: 'info',
      message: 'Clipped-layer histogram feedback is scoped by lower-layer alpha and should not be treated as full-document tone coverage.',
    });
  }
  for (const message of options.liveGpuPreview.caveats) {
    caveats.push({
      code: 'gpu-preview-not-used-for-histogram-feedback',
      severity: 'warning',
      message,
    });
  }
  return caveats;
}

function buildHandoffCaveats(options: {
  exportTarget: 'document' | 'source-bin' | 'download';
  sourceBinLinked: boolean;
  hasBlockers: boolean;
}): string[] {
  const caveats: string[] = [];
  if (options.exportTarget === 'source-bin' && options.hasBlockers) {
    caveats.push('Source-bin handoff is blocked until invalid adjustment parameters are corrected.');
  }
  if (options.exportTarget === 'source-bin' && options.sourceBinLinked) {
    caveats.push('Source-bin export should include the adjustment preview signature so downstream Flow/Video consumers can detect stale renders.');
  }
  return caveats;
}

function buildActionSuitabilityCaveats(options: {
  hasBlockers: boolean;
  batchDocumentCount: number;
  requiresHistogram: boolean;
  histogramSourceAvailable: boolean;
}): string[] {
  if (options.hasBlockers) {
    return [
      'Action replay is blocked until readiness blockers are cleared.',
      'Batch application is blocked until all parameter and histogram requirements are satisfied.',
    ];
  }
  if (options.batchDocumentCount > 1 && options.requiresHistogram && !options.histogramSourceAvailable) {
    return ['Batch application requires a histogram source for every document.'];
  }
  return [];
}

function getAdjustmentChannelLabel(channel: AdjustmentPreviewChannel): string {
  switch (channel) {
    case 'rgb':
      return 'Composite RGB';
    case 'red':
      return 'Red channel';
    case 'green':
      return 'Green channel';
    case 'blue':
      return 'Blue channel';
  }
}

function getAdjustmentSummarySubject(channel: AdjustmentPreviewChannel): string {
  switch (channel) {
    case 'rgb':
      return 'composite tones';
    case 'red':
      return 'red channel';
    case 'green':
      return 'green channel';
    case 'blue':
      return 'blue channel';
  }
}

function getHistogramChannelLabel(channel: ImageHistogramChannel): string {
  switch (channel) {
    case 'luminance':
      return 'Luminance';
    case 'red':
      return 'Red';
    case 'green':
      return 'Green';
    case 'blue':
      return 'Blue';
    case 'alpha':
      return 'Alpha';
  }
}

function formatSignedDelta(value: number | null): string {
  if (value === null) return 'n/a';
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

function formatPixelDelta(value: number): string {
  if (value === 0) return 'unchanged';
  return `${value > 0 ? `+${value}` : String(value)} px`;
}

function formatNullableStat(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

function normalizeLayerIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}
