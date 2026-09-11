export type ImageHistogramChannel = 'luminance' | 'red' | 'green' | 'blue' | 'alpha';

export interface ImageHistogram {
  channels: Record<ImageHistogramChannel, Uint32Array>;
  totalPixels: number;
  visiblePixels: number;
  transparentPixels: number;
  minLuminance: number | null;
  maxLuminance: number | null;
  meanLuminance: number | null;
}

export interface ImageHistogramChannelStats {
  min: number | null;
  max: number | null;
  mean: number | null;
  clippedShadows: number;
  clippedHighlights: number;
  sampleCount: number;
}

export type ImageHistogramTonalShift = 'darker' | 'stable' | 'brighter';
export type ImageHistogramContrastShift = 'compressed' | 'stable' | 'expanded';
export type ImageHistogramClippingShift =
  | 'reduced'
  | 'stable'
  | 'increased'
  | 'shadow-recovery'
  | 'highlight-recovery'
  | 'shadow-clipping'
  | 'highlight-clipping'
  | 'mixed';

export interface ImageHistogramChannelComparison {
  channel: ImageHistogramChannel;
  before: ImageHistogramChannelStats;
  after: ImageHistogramChannelStats;
  minDelta: number | null;
  maxDelta: number | null;
  meanDelta: number | null;
  sampleCountDelta: number;
  clippedShadowsDelta: number;
  clippedHighlightsDelta: number;
  tonalShift: ImageHistogramTonalShift;
  contrastShift: ImageHistogramContrastShift;
  clippingShift: ImageHistogramClippingShift;
}

export type ImageHistogramPanelChannel = 'luminance' | 'red' | 'green' | 'blue';
export type ImageHistogramPreviewKind = 'static' | 'adjustment-preview' | 'live-preview';
export type ImageHistogramSignatureValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[];

export interface ImageHistogramReadoutDescriptor extends ImageHistogramChannelStats {
  channel: ImageHistogramPanelChannel;
  label: string;
  rangeLabel: string;
  meanLabel: string;
  clippingLabel: string;
  clippedTotal: number;
  hasSamples: boolean;
  isClipped: boolean;
}

export interface ImageHistogramClippingDescriptor {
  clippedShadows: number;
  clippedHighlights: number;
  clippedTotal: number;
  clippedChannels: ImageHistogramPanelChannel[];
}

export interface ImageHistogramChannelReadoutDescriptor {
  channel: ImageHistogramChannel;
  label: string;
  rangeLabel: string;
  meanLabel: string;
  clippingLabel: string;
  clippedTotal: number;
  hasSamples: boolean;
  isClipped: boolean;
  isToneChannel: boolean;
  isSupported: boolean;
  caveats: string[];
  min: number | null;
  max: number | null;
  mean: number | null;
  clippedShadows: number;
  clippedHighlights: number;
  sampleCount: number;
}

export type ImageHistogramCoverageWarningCode =
  | 'histogram-channel-clipped'
  | 'histogram-alpha-informational'
  | 'histogram-channel-empty';

export interface ImageHistogramCoverageWarning {
  code: ImageHistogramCoverageWarningCode;
  severity: 'info' | 'warning';
  channel: ImageHistogramChannel;
  clippedShadows: number;
  clippedHighlights: number;
  message: string;
}

export interface ImageHistogramChannelCoverageDescriptor {
  channel: ImageHistogramChannel;
  label: string;
  sampleCount: number;
  coverageRatio: number;
  hasSamples: boolean;
  toneAdjustable: boolean;
  clippedShadows: number;
  clippedHighlights: number;
  clippedTotal: number;
  warning: ImageHistogramCoverageWarning | null;
}

export interface ImageHistogramChannelCoverageSummaryDescriptor {
  version: 1;
  totalPixels: number;
  visiblePixels: number;
  transparentPixels: number;
  requestedChannels: ImageHistogramChannel[];
  supportedToneChannels: ImageHistogramChannel[];
  informationalChannels: ImageHistogramChannel[];
  missingChannels: string[];
  coverage: Partial<Record<ImageHistogramChannel, ImageHistogramChannelCoverageDescriptor>>;
  warnings: ImageHistogramCoverageWarning[];
  signature: string;
}

export type ImageHistogramSignatureRole =
  | 'source'
  | 'before-adjustment'
  | 'after-adjustment'
  | 'adjustment-preview';

export interface BuildImageHistogramSignatureOptions {
  role?: ImageHistogramSignatureRole;
  sourceSignature?: string;
  channels?: ImageHistogramChannel[];
}

export interface ImageHistogramChannelClippingDeltaDescriptor {
  channel: ImageHistogramChannel;
  beforeClippedShadows: number;
  afterClippedShadows: number;
  clippedShadowsDelta: number;
  beforeClippedHighlights: number;
  afterClippedHighlights: number;
  clippedHighlightsDelta: number;
  clippedTotalDelta: number;
  clippingShift: ImageHistogramClippingShift;
}

export interface ImageHistogramBeforeAfterSignatureDescriptor {
  version: 1;
  sourceSignature: string;
  beforeSignature: string;
  afterSignature: string;
  channels: ImageHistogramChannel[];
  channelClippingDeltas: ImageHistogramChannelClippingDeltaDescriptor[];
  changedClippingChannels: ImageHistogramChannel[];
  stableSignature: string;
}

export interface ImageHistogramPreviewSourceDescriptor {
  kind: Exclude<ImageHistogramPreviewKind, 'static'>;
  sourceSignature: string;
  signatureFields: Record<string, ImageHistogramSignatureValue>;
  caveats: string[];
}

export interface ImageHistogramPanelPreviewDescriptor extends ImageHistogramPreviewSourceDescriptor {
  adjustmentLayerId: string | null;
  adjustmentKind: string | null;
  adjustmentChannel: string | null;
  beforeSignature: string | null;
  afterSignature: string;
}

export interface ImageHistogramPanelComparisonDescriptor {
  beforeSignature: string | null;
  afterSignature: string;
  sourceSignature: string;
  channels: Record<ImageHistogramPanelChannel, ImageHistogramChannelComparison>;
  changedChannels: ImageHistogramPanelChannel[];
  meanDeltaRange: { min: number; max: number } | null;
  clippingShift: ImageHistogramClippingShift;
}

export interface ImageHistogramPanelDescriptor {
  version: 1;
  panel: 'image-histogram';
  previewKind: ImageHistogramPreviewKind;
  livePreview: boolean;
  sourceLabel: string;
  sourceSignature: string;
  histogramSignature: string;
  totalPixels: number;
  visiblePixels: number;
  transparentPixels: number;
  channelOrder: ImageHistogramPanelChannel[];
  channelSummaries: Record<ImageHistogramPanelChannel, ImageHistogramReadoutDescriptor>;
  clipping: ImageHistogramClippingDescriptor;
  preview?: ImageHistogramPanelPreviewDescriptor;
  comparison?: ImageHistogramPanelComparisonDescriptor;
  caveats: string[];
}

export interface BuildImageHistogramPanelDescriptorOptions {
  histogram: ImageHistogram;
  sourceSignature: string;
  sourceLabel?: string;
  preview?: {
    kind: Exclude<ImageHistogramPreviewKind, 'static'>;
    beforeHistogram?: ImageHistogram;
    beforeSignature?: string;
    adjustmentLayerId?: string;
    adjustmentKind?: string;
    adjustmentChannel?: string;
    signatureFields?: Record<string, ImageHistogramSignatureValue>;
  };
}

export interface BuildImageHistogramPreviewSourceDescriptorOptions {
  kind: Exclude<ImageHistogramPreviewKind, 'static'>;
  sourceSignature: string;
  adjustmentLayerId?: string;
  adjustmentKind?: string;
  adjustmentChannel?: string;
  signatureFields?: Record<string, ImageHistogramSignatureValue>;
}

const HISTOGRAM_PANEL_CHANNELS: ImageHistogramPanelChannel[] = ['luminance', 'red', 'green', 'blue'];
const HISTOGRAM_SIGNATURE_CHANNELS: ImageHistogramChannel[] = ['luminance', 'red', 'green', 'blue', 'alpha'];

export function buildImageHistogram(imageData: ImageData): ImageHistogram {
  const channels: Record<ImageHistogramChannel, Uint32Array> = {
    luminance: new Uint32Array(256),
    red: new Uint32Array(256),
    green: new Uint32Array(256),
    blue: new Uint32Array(256),
    alpha: new Uint32Array(256),
  };
  const totalPixels = imageData.width * imageData.height;
  let visiblePixels = 0;
  let minLuminance: number | null = null;
  let maxLuminance: number | null = null;
  let luminanceTotal = 0;

  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const red = imageData.data[offset];
    const green = imageData.data[offset + 1];
    const blue = imageData.data[offset + 2];
    const alpha = imageData.data[offset + 3];

    channels.alpha[alpha] += 1;
    if (alpha === 0) continue;

    visiblePixels += 1;
    channels.red[red] += 1;
    channels.green[green] += 1;
    channels.blue[blue] += 1;

    const luminance = clampByte(Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722));
    channels.luminance[luminance] += 1;
    luminanceTotal += luminance;
    minLuminance = minLuminance === null ? luminance : Math.min(minLuminance, luminance);
    maxLuminance = maxLuminance === null ? luminance : Math.max(maxLuminance, luminance);
  }

  return {
    channels,
    totalPixels,
    visiblePixels,
    transparentPixels: totalPixels - visiblePixels,
    minLuminance,
    maxLuminance,
    meanLuminance: visiblePixels > 0 ? Math.round(luminanceTotal / visiblePixels) : null,
  };
}

export function buildImageHistogramPanelDescriptor(
  options: BuildImageHistogramPanelDescriptorOptions,
): ImageHistogramPanelDescriptor {
  const previewKind = options.preview?.kind ?? 'static';
  const channelSummaries = buildPanelChannelSummaries(options.histogram);
  const clipping = buildPanelClippingDescriptor(channelSummaries);
  const histogramSignature = buildHistogramPanelSignature({
    histogram: options.histogram,
    sourceSignature: options.sourceSignature,
    previewKind,
    channelSummaries,
  });
  const sourceDescriptor = options.preview
    ? buildImageHistogramPreviewSourceDescriptor({
      kind: options.preview.kind,
      sourceSignature: options.sourceSignature,
      adjustmentLayerId: options.preview.adjustmentLayerId,
      adjustmentKind: options.preview.adjustmentKind,
      adjustmentChannel: options.preview.adjustmentChannel,
      signatureFields: options.preview.signatureFields,
    })
    : null;
  const comparison = options.preview?.beforeHistogram && sourceDescriptor
    ? buildPanelComparisonDescriptor({
      beforeHistogram: options.preview.beforeHistogram,
      afterHistogram: options.histogram,
      beforeSignature: options.preview.beforeSignature ?? null,
      afterSignature: histogramSignature,
      sourceSignature: sourceDescriptor.sourceSignature,
    })
    : undefined;
  const preview = options.preview && sourceDescriptor
    ? {
      ...sourceDescriptor,
      adjustmentLayerId: options.preview.adjustmentLayerId ?? null,
      adjustmentKind: options.preview.adjustmentKind ?? null,
      adjustmentChannel: options.preview.adjustmentChannel ?? null,
      beforeSignature: options.preview.beforeSignature ?? null,
      afterSignature: histogramSignature,
    }
    : undefined;

  return {
    version: 1,
    panel: 'image-histogram',
    previewKind,
    livePreview: previewKind === 'live-preview',
    sourceLabel: options.sourceLabel ?? 'Histogram source',
    sourceSignature: options.sourceSignature,
    histogramSignature,
    totalPixels: options.histogram.totalPixels,
    visiblePixels: options.histogram.visiblePixels,
    transparentPixels: options.histogram.transparentPixels,
    channelOrder: [...HISTOGRAM_PANEL_CHANNELS],
    channelSummaries,
    clipping,
    ...(preview ? { preview } : {}),
    ...(comparison ? { comparison } : {}),
    caveats: sourceDescriptor?.caveats ?? [],
  };
}

export function buildImageHistogramChannelReadoutDescriptor(
  options: {
    histogram: ImageHistogram;
    channel: ImageHistogramChannel;
  },
): ImageHistogramChannelReadoutDescriptor {
  const stats = getHistogramChannelStats(options.histogram, options.channel);
  const isToneChannel = options.channel !== 'alpha';
  const caveats = isToneChannel
    ? []
    : ['Alpha histogram is informational only; tone clipping and tone-adjustment channels are not derived from alpha.'];

  return {
    channel: options.channel,
    label: getHistogramChannelLabel(options.channel),
    rangeLabel: stats.min === null || stats.max === null ? '-' : `${stats.min}-${stats.max}`,
    meanLabel: stats.mean === null ? '--' : String(stats.mean),
    clippingLabel: `${stats.clippedShadows} ${pluralize('shadow', stats.clippedShadows)} / ${stats.clippedHighlights} ${pluralize('highlight', stats.clippedHighlights)}`,
    clippedTotal: stats.clippedShadows + stats.clippedHighlights,
    hasSamples: stats.sampleCount > 0,
    isClipped: (stats.clippedShadows + stats.clippedHighlights) > 0,
    isToneChannel,
    isSupported: isToneChannel,
    caveats,
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
    clippedShadows: stats.clippedShadows,
    clippedHighlights: stats.clippedHighlights,
    sampleCount: stats.sampleCount,
  };
}

export function describeImageHistogramChannelCoverage(
  histogram: ImageHistogram,
  options: {
    requestedChannels?: ImageHistogramChannel[];
    clipWarningThreshold?: number;
  } = {},
): ImageHistogramChannelCoverageSummaryDescriptor {
  const requestedChannels = [...(options.requestedChannels ?? ['luminance', 'red', 'green', 'blue'])];
  const clipWarningThreshold = Math.max(1, Math.round(options.clipWarningThreshold ?? 1));
  const coverage: Partial<Record<ImageHistogramChannel, ImageHistogramChannelCoverageDescriptor>> = {};
  const warnings: ImageHistogramCoverageWarning[] = [];
  const supportedToneChannels: ImageHistogramChannel[] = [];
  const informationalChannels: ImageHistogramChannel[] = [];
  const missingChannels: string[] = [];
  const signatureCoverage: Record<string, {
    sampleCount: number;
    clippedShadows: number;
    clippedHighlights: number;
  }> = {};

  for (const channel of requestedChannels) {
    if (!histogram.channels[channel]) {
      missingChannels.push(channel);
      continue;
    }

    const stats = getHistogramChannelStats(histogram, channel);
    const toneAdjustable = channel !== 'alpha';
    const clippedTotal = stats.clippedShadows + stats.clippedHighlights;
    const denominator = channel === 'alpha' ? histogram.totalPixels : histogram.visiblePixels;
    const warning = buildHistogramCoverageWarning({
      channel,
      toneAdjustable,
      clippedTotal,
      clippedShadows: stats.clippedShadows,
      clippedHighlights: stats.clippedHighlights,
      sampleCount: stats.sampleCount,
      clipWarningThreshold,
    });
    const descriptor: ImageHistogramChannelCoverageDescriptor = {
      channel,
      label: getHistogramChannelLabel(channel),
      sampleCount: stats.sampleCount,
      coverageRatio: denominator > 0 ? roundRatio(stats.sampleCount / denominator) : 0,
      hasSamples: stats.sampleCount > 0,
      toneAdjustable,
      clippedShadows: stats.clippedShadows,
      clippedHighlights: stats.clippedHighlights,
      clippedTotal,
      warning,
    };

    coverage[channel] = descriptor;
    signatureCoverage[channel] = {
      sampleCount: stats.sampleCount,
      clippedShadows: stats.clippedShadows,
      clippedHighlights: stats.clippedHighlights,
    };
    if (toneAdjustable) {
      supportedToneChannels.push(channel);
    } else {
      informationalChannels.push(channel);
    }
    if (warning) warnings.push(warning);
  }

  return {
    version: 1,
    totalPixels: histogram.totalPixels,
    visiblePixels: histogram.visiblePixels,
    transparentPixels: histogram.transparentPixels,
    requestedChannels,
    supportedToneChannels,
    informationalChannels,
    missingChannels,
    coverage,
    warnings,
    signature: `histogram-channel-coverage:v1:${stableStringify({
      requestedChannels,
      visiblePixels: histogram.visiblePixels,
      transparentPixels: histogram.transparentPixels,
      clipWarningThreshold,
      coverage: signatureCoverage,
    })}`,
  };
}

export function buildImageHistogramSignature(
  histogram: ImageHistogram,
  options: BuildImageHistogramSignatureOptions = {},
): string {
  const channels = [...(options.channels ?? HISTOGRAM_SIGNATURE_CHANNELS)];
  return `histogram-signature:v1:${stableStringify({
    role: options.role ?? 'source',
    sourceSignature: options.sourceSignature ?? 'unspecified-source',
    totalPixels: histogram.totalPixels,
    visiblePixels: histogram.visiblePixels,
    transparentPixels: histogram.transparentPixels,
    channels: buildHistogramSignatureChannelStats(histogram, channels),
  })}`;
}

export function describeImageHistogramBeforeAfterSignatures(options: {
  beforeHistogram: ImageHistogram;
  afterHistogram: ImageHistogram;
  sourceSignature: string;
  channels?: ImageHistogramChannel[];
}): ImageHistogramBeforeAfterSignatureDescriptor {
  const channels = [...(options.channels ?? HISTOGRAM_PANEL_CHANNELS)];
  const beforeSignature = buildImageHistogramSignature(options.beforeHistogram, {
    role: 'before-adjustment',
    sourceSignature: options.sourceSignature,
    channels,
  });
  const afterSignature = buildImageHistogramSignature(options.afterHistogram, {
    role: 'after-adjustment',
    sourceSignature: options.sourceSignature,
    channels,
  });
  const channelClippingDeltas = channels.map((channel) => buildHistogramChannelClippingDelta(
    options.beforeHistogram,
    options.afterHistogram,
    channel,
  ));
  const changedClippingChannels = channelClippingDeltas
    .filter((delta) => delta.clippedShadowsDelta !== 0 || delta.clippedHighlightsDelta !== 0)
    .map((delta) => delta.channel);
  const stableSignature = `histogram-before-after:v1:${stableStringify({
    sourceSignature: options.sourceSignature,
    beforeSignature,
    afterSignature,
    channels,
    channelClippingDeltas: channelClippingDeltas.map((delta) => ({
      channel: delta.channel,
      clippedShadowsDelta: delta.clippedShadowsDelta,
      clippedHighlightsDelta: delta.clippedHighlightsDelta,
      clippedTotalDelta: delta.clippedTotalDelta,
      clippingShift: delta.clippingShift,
    })),
  })}`;

  return {
    version: 1,
    sourceSignature: options.sourceSignature,
    beforeSignature,
    afterSignature,
    channels,
    channelClippingDeltas,
    changedClippingChannels,
    stableSignature,
  };
}

export function buildImageHistogramPreviewSourceDescriptor(
  options: BuildImageHistogramPreviewSourceDescriptorOptions,
): ImageHistogramPreviewSourceDescriptor {
  const signatureFields = buildPreviewSignatureFields(options);
  return {
    kind: options.kind,
    sourceSignature: `histogram-preview:v1:${stableStringify({
      kind: options.kind,
      sourceSignature: options.sourceSignature,
      adjustmentLayerId: options.adjustmentLayerId ?? null,
      adjustmentKind: options.adjustmentKind ?? null,
      adjustmentChannel: options.adjustmentChannel ?? null,
      signatureFields: normalizeSignatureFields(options.signatureFields ?? {}),
    })}`,
    signatureFields,
    caveats: getPreviewSourceCaveats(options.kind),
  };
}

export function getHistogramChannelStats(
  histogram: ImageHistogram,
  channel: ImageHistogramChannel,
): ImageHistogramChannelStats {
  const bins = histogram.channels[channel];
  let min: number | null = null;
  let max: number | null = null;
  let sampleCount = 0;
  let weightedTotal = 0;

  for (let index = 0; index < bins.length; index += 1) {
    const count = bins[index];
    if (count === 0) continue;
    min = min ?? index;
    max = index;
    sampleCount += count;
    weightedTotal += index * count;
  }

  return {
    min,
    max,
    mean: sampleCount > 0 ? Math.round(weightedTotal / sampleCount) : null,
    clippedShadows: bins[0] ?? 0,
    clippedHighlights: bins[255] ?? 0,
    sampleCount,
  };
}

export function compareHistogramChannelStats(
  beforeHistogram: ImageHistogram,
  afterHistogram: ImageHistogram,
  channel: ImageHistogramChannel,
): ImageHistogramChannelComparison {
  const before = getHistogramChannelStats(beforeHistogram, channel);
  const after = getHistogramChannelStats(afterHistogram, channel);
  const minDelta = diffNullable(after.min, before.min);
  const maxDelta = diffNullable(after.max, before.max);
  const meanDelta = diffNullable(after.mean, before.mean);
  const clippedShadowsDelta = after.clippedShadows - before.clippedShadows;
  const clippedHighlightsDelta = after.clippedHighlights - before.clippedHighlights;

  return {
    channel,
    before,
    after,
    minDelta,
    maxDelta,
    meanDelta,
    sampleCountDelta: after.sampleCount - before.sampleCount,
    clippedShadowsDelta,
    clippedHighlightsDelta,
    tonalShift: classifyTonalShift(meanDelta),
    contrastShift: classifyContrastShift(
      diffNullable(
        computeRange(after.min, after.max),
        computeRange(before.min, before.max),
      ),
    ),
    clippingShift: classifyClippingShift(clippedShadowsDelta, clippedHighlightsDelta),
  };
}

export function formatHistogramChannelSummary(
  histogram: ImageHistogram,
  channel: ImageHistogramChannel,
): string {
  const stats = getHistogramChannelStats(histogram, channel);
  return `${getHistogramChannelLabel(channel)} ${formatNullableRange(stats.min)}-${formatNullableRange(stats.max)} mean ${formatNullableRange(stats.mean)}, clip ${stats.clippedShadows}/${stats.clippedHighlights}`;
}

export function summarizeHistogramBins(channel: Uint32Array, bucketCount: number): number[] {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    throw new Error('Histogram bucket count must be a positive integer.');
  }
  const buckets = Array.from({ length: bucketCount }, () => 0);
  for (let index = 0; index < channel.length; index += 1) {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((index / channel.length) * bucketCount));
    buckets[bucketIndex] += channel[index];
  }
  return buckets;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, value));
}

function diffNullable(next: number | null, previous: number | null): number | null {
  if (next === null || previous === null) return null;
  return next - previous;
}

function computeRange(min: number | null, max: number | null): number | null {
  if (min === null || max === null) return null;
  return max - min;
}

function classifyTonalShift(meanDelta: number | null): ImageHistogramTonalShift {
  if (meanDelta === null || meanDelta === 0) return 'stable';
  return meanDelta > 0 ? 'brighter' : 'darker';
}

function classifyContrastShift(rangeDelta: number | null): ImageHistogramContrastShift {
  if (rangeDelta === null || rangeDelta === 0) return 'stable';
  return rangeDelta > 0 ? 'expanded' : 'compressed';
}

function classifyClippingShift(
  clippedShadowsDelta: number,
  clippedHighlightsDelta: number,
): ImageHistogramClippingShift {
  const shadowChanged = clippedShadowsDelta !== 0;
  const highlightChanged = clippedHighlightsDelta !== 0;
  if (!shadowChanged && !highlightChanged) return 'stable';
  if (clippedShadowsDelta < 0 && !highlightChanged) return 'shadow-recovery';
  if (clippedHighlightsDelta < 0 && !shadowChanged) return 'highlight-recovery';
  if (clippedShadowsDelta > 0 && !highlightChanged) return 'shadow-clipping';
  if (clippedHighlightsDelta > 0 && !shadowChanged) return 'highlight-clipping';
  if (clippedShadowsDelta <= 0 && clippedHighlightsDelta <= 0) return 'reduced';
  if (clippedShadowsDelta >= 0 && clippedHighlightsDelta >= 0) return 'increased';
  return 'mixed';
}

function buildPanelChannelSummaries(
  histogram: ImageHistogram,
): Record<ImageHistogramPanelChannel, ImageHistogramReadoutDescriptor> {
  return HISTOGRAM_PANEL_CHANNELS.reduce(
    (summaries, channel) => {
      const stats = getHistogramChannelStats(histogram, channel);
      const clippedTotal = stats.clippedShadows + stats.clippedHighlights;
      summaries[channel] = {
        ...stats,
        channel,
        label: getHistogramChannelLabel(channel),
        rangeLabel: `${formatNullableRange(stats.min)}-${formatNullableRange(stats.max)}`,
        meanLabel: formatNullableRange(stats.mean),
        clippingLabel: `${stats.clippedShadows} ${pluralize('shadow', stats.clippedShadows)} / ${stats.clippedHighlights} ${pluralize('highlight', stats.clippedHighlights)}`,
        clippedTotal,
        hasSamples: stats.sampleCount > 0,
        isClipped: clippedTotal > 0,
      };
      return summaries;
    },
    {} as Record<ImageHistogramPanelChannel, ImageHistogramReadoutDescriptor>,
  );
}

function buildPanelClippingDescriptor(
  channelSummaries: Record<ImageHistogramPanelChannel, ImageHistogramReadoutDescriptor>,
): ImageHistogramClippingDescriptor {
  const clippedChannels = HISTOGRAM_PANEL_CHANNELS.filter(
    (channel) => channelSummaries[channel].isClipped,
  );
  return {
    clippedShadows: HISTOGRAM_PANEL_CHANNELS.reduce(
      (total, channel) => total + channelSummaries[channel].clippedShadows,
      0,
    ),
    clippedHighlights: HISTOGRAM_PANEL_CHANNELS.reduce(
      (total, channel) => total + channelSummaries[channel].clippedHighlights,
      0,
    ),
    clippedTotal: HISTOGRAM_PANEL_CHANNELS.reduce(
      (total, channel) => total + channelSummaries[channel].clippedTotal,
      0,
    ),
    clippedChannels,
  };
}

function buildHistogramPanelSignature(options: {
  histogram: ImageHistogram;
  sourceSignature: string;
  previewKind: ImageHistogramPreviewKind;
  channelSummaries: Record<ImageHistogramPanelChannel, ImageHistogramReadoutDescriptor>;
}): string {
  const channelMeans = {} as Record<ImageHistogramPanelChannel, number | null>;
  const channelRanges = {} as Record<ImageHistogramPanelChannel, [number | null, number | null]>;
  const channelClipping = {} as Record<ImageHistogramPanelChannel, [number, number]>;

  for (const channel of HISTOGRAM_PANEL_CHANNELS) {
    const summary = options.channelSummaries[channel];
    channelMeans[channel] = summary.mean;
    channelRanges[channel] = [summary.min, summary.max];
    channelClipping[channel] = [summary.clippedShadows, summary.clippedHighlights];
  }

  return `histogram-panel:v1:${stableStringify({
    sourceSignature: options.sourceSignature,
    previewKind: options.previewKind,
    visiblePixels: options.histogram.visiblePixels,
    transparentPixels: options.histogram.transparentPixels,
    totalPixels: options.histogram.totalPixels,
    channelMeans,
    channelRanges,
    channelClipping,
  })}`;
}

function buildHistogramSignatureChannelStats(
  histogram: ImageHistogram,
  channels: ImageHistogramChannel[],
): Partial<Record<ImageHistogramChannel, ImageHistogramChannelStats>> {
  const stats: Partial<Record<ImageHistogramChannel, ImageHistogramChannelStats>> = {};
  for (const channel of channels) {
    stats[channel] = getHistogramChannelStats(histogram, channel);
  }
  return stats;
}

function buildHistogramChannelClippingDelta(
  beforeHistogram: ImageHistogram,
  afterHistogram: ImageHistogram,
  channel: ImageHistogramChannel,
): ImageHistogramChannelClippingDeltaDescriptor {
  const comparison = compareHistogramChannelStats(beforeHistogram, afterHistogram, channel);
  return {
    channel,
    beforeClippedShadows: comparison.before.clippedShadows,
    afterClippedShadows: comparison.after.clippedShadows,
    clippedShadowsDelta: comparison.clippedShadowsDelta,
    beforeClippedHighlights: comparison.before.clippedHighlights,
    afterClippedHighlights: comparison.after.clippedHighlights,
    clippedHighlightsDelta: comparison.clippedHighlightsDelta,
    clippedTotalDelta: comparison.clippedShadowsDelta + comparison.clippedHighlightsDelta,
    clippingShift: comparison.clippingShift,
  };
}

function buildPanelComparisonDescriptor(options: {
  beforeHistogram: ImageHistogram;
  afterHistogram: ImageHistogram;
  beforeSignature: string | null;
  afterSignature: string;
  sourceSignature: string;
}): ImageHistogramPanelComparisonDescriptor {
  const channels = HISTOGRAM_PANEL_CHANNELS.reduce(
    (comparisons, channel) => {
      comparisons[channel] = compareHistogramChannelStats(
        options.beforeHistogram,
        options.afterHistogram,
        channel,
      );
      return comparisons;
    },
    {} as Record<ImageHistogramPanelChannel, ImageHistogramChannelComparison>,
  );
  const changedChannels = HISTOGRAM_PANEL_CHANNELS.filter((channel) => {
    const comparison = channels[channel];
    return comparison.minDelta !== 0
      || comparison.maxDelta !== 0
      || comparison.meanDelta !== 0
      || comparison.sampleCountDelta !== 0
      || comparison.clippedShadowsDelta !== 0
      || comparison.clippedHighlightsDelta !== 0;
  });
  const meanDeltas = HISTOGRAM_PANEL_CHANNELS
    .map((channel) => channels[channel].meanDelta)
    .filter((value): value is number => value !== null && value !== 0);

  return {
    beforeSignature: options.beforeSignature,
    afterSignature: options.afterSignature,
    sourceSignature: options.sourceSignature,
    channels,
    changedChannels,
    meanDeltaRange: meanDeltas.length > 0
      ? { min: Math.min(...meanDeltas), max: Math.max(...meanDeltas) }
      : null,
    clippingShift: summarizeComparisonClippingShift(channels),
  };
}

function summarizeComparisonClippingShift(
  channels: Record<ImageHistogramPanelChannel, ImageHistogramChannelComparison>,
): ImageHistogramClippingShift {
  const shadowDelta = HISTOGRAM_PANEL_CHANNELS.reduce(
    (total, channel) => total + channels[channel].clippedShadowsDelta,
    0,
  );
  const highlightDelta = HISTOGRAM_PANEL_CHANNELS.reduce(
    (total, channel) => total + channels[channel].clippedHighlightsDelta,
    0,
  );
  return classifyClippingShift(shadowDelta, highlightDelta);
}

function buildPreviewSignatureFields(
  options: BuildImageHistogramPreviewSourceDescriptorOptions,
): Record<string, ImageHistogramSignatureValue> {
  return {
    adjustmentChannel: options.adjustmentChannel ?? null,
    adjustmentKind: options.adjustmentKind ?? null,
    adjustmentLayerId: options.adjustmentLayerId ?? null,
    ...normalizeSignatureFields(options.signatureFields ?? {}),
  };
}

function buildHistogramCoverageWarning(options: {
  channel: ImageHistogramChannel;
  toneAdjustable: boolean;
  clippedTotal: number;
  clippedShadows: number;
  clippedHighlights: number;
  sampleCount: number;
  clipWarningThreshold: number;
}): ImageHistogramCoverageWarning | null {
  if (!options.toneAdjustable) {
    return {
      code: 'histogram-alpha-informational',
      severity: 'info',
      channel: options.channel,
      clippedShadows: options.clippedShadows,
      clippedHighlights: options.clippedHighlights,
      message: 'Alpha is shown for coverage only; tone adjustments do not use alpha histogram bins.',
    };
  }
  if (options.sampleCount === 0) {
    return {
      code: 'histogram-channel-empty',
      severity: 'warning',
      channel: options.channel,
      clippedShadows: options.clippedShadows,
      clippedHighlights: options.clippedHighlights,
      message: `${getHistogramChannelLabel(options.channel)} has no visible samples for histogram feedback.`,
    };
  }
  if (options.clippedTotal >= options.clipWarningThreshold) {
    return {
      code: 'histogram-channel-clipped',
      severity: 'warning',
      channel: options.channel,
      clippedShadows: options.clippedShadows,
      clippedHighlights: options.clippedHighlights,
      message: `${getHistogramChannelLabel(options.channel)} has ${options.clippedTotal} clipped pixels; preview/apply should preserve a visible clipping warning.`,
    };
  }
  return null;
}

function normalizeSignatureFields(
  fields: Record<string, ImageHistogramSignatureValue>,
): Record<string, ImageHistogramSignatureValue> {
  const normalized: Record<string, ImageHistogramSignatureValue> = {};
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    normalized[key] = Array.isArray(value) ? [...value] : value;
  }
  return normalized;
}

function getPreviewSourceCaveats(kind: Exclude<ImageHistogramPreviewKind, 'static'>): string[] {
  if (kind === 'live-preview') {
    return ['Live preview histograms may lag pointer updates and should not be treated as committed document state.'];
  }
  return ['Adjustment preview histograms are advisory and use rendered 8-bit RGB canvas pixels.'];
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

function formatNullableRange(value: number | null): string {
  return value === null ? '-' : String(value);
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}
