export interface ImageSpotChannelColor {
  r: number;
  g: number;
  b: number;
}

export interface ImageSpotChannelMaskInput {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | number[];
  kind?: 'grayscale' | 'alpha' | 'rgba';
}

export interface ImageSpotChannelMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageSpotChannelEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  color: ImageSpotChannelColor;
  opacity: number;
  solidity: number;
  visible: boolean;
  dataBase64: string;
  createdAt: number;
  updatedAt?: number;
}

export interface BuildImageSpotChannelEntryOptions {
  id?: string;
  name?: string;
  color?: Partial<ImageSpotChannelColor>;
  opacity?: number;
  solidity?: number;
  visible?: boolean;
  now?: number;
}

export interface UpdateImageSpotChannelMetadataOptions {
  name?: string;
  color?: Partial<ImageSpotChannelColor>;
  opacity?: number;
  solidity?: number;
  visible?: boolean;
  now?: number;
}

export interface RenderSpotChannelPreviewOptions {
  color: Partial<ImageSpotChannelColor>;
  opacity?: number;
  solidity?: number;
  visible?: boolean;
  baseRgba?: Uint8ClampedArray | Uint8Array | number[];
}

export type ImageSpotChannelExportFormat = 'source' | 'png' | 'jpeg' | 'webp' | 'psd' | 'tiff';

export interface BuildSpotChannelExportWarningsOptions {
  targetFormat?: ImageSpotChannelExportFormat;
  documentWidth?: number;
  documentHeight?: number;
}

export interface ImageSpotChannelPreviewMetadata {
  previewKind: 'rgb-tint-preview';
  tintColor: ImageSpotChannelColor;
  tintCssColor: string;
  opacity: number;
  solidity: number;
  effectiveOpacity: number;
  visible: boolean;
  warnings: string[];
}

/**
 * A deterministic, local proofing plate. The PGM byte stream deliberately
 * represents ink coverage as black (0) and paper as white (255), so it opens
 * as a useful grayscale separation in ordinary image viewers without claiming
 * native PSD, CMYK, or press-ready output.
 */
export interface ImageSpotChannelGrayscalePlate {
  kind: 'spot-grayscale-plate';
  channelId: string;
  channelName: string;
  width: number;
  height: number;
  effectiveOpacity: number;
  visible: boolean;
  inkCoverage: Uint8ClampedArray;
  grayscale: Uint8ClampedArray;
  mimeType: 'image/x-portable-graymap';
  filename: string;
  data: Uint8Array;
  signature: string;
  limitations: string[];
}

export interface ImageSpotChannelManifestDescriptor {
  id: string;
  kind: 'spot';
  name: string;
  index: number;
  width: number;
  height: number;
  pixelCount: number;
  byteLength: number;
  createdAt: number;
  updatedAt?: number;
  visible: boolean;
  preview: ImageSpotChannelPreviewMetadata;
  exportWarnings: string[];
}

export interface ImageSpotChannelWorkflowDescriptor {
  id: string;
  kind: 'spot-workflow';
  name: string;
  index: number;
  dimensions: string;
  pixelCount: number;
  byteLength: number;
  createdAt: number;
  updatedAt?: number;
  tint: {
    color: ImageSpotChannelColor;
    cssColor: string;
    opacity: number;
    solidity: number;
    effectiveOpacity: number;
    visible: boolean;
  };
  preview: {
    previewKind: 'rgb-tint-preview';
    signature: string;
    warning: string;
  };
  directPaint: {
    supported: false;
    enabled: false;
    reason: string;
  };
  printSeparation: {
    supported: false;
    warning: string;
  };
  exportWarnings: string[];
  warnings: string[];
}

export interface ImageSpotChannelPlanningDescriptor {
  kind: 'spot-channel-planning';
  channelCount: number;
  readinessSignature: string;
  directPaint: {
    supported: false;
    enabled: false;
    status: 'unsupported';
    signature: string;
    reason: string;
  };
  channels: Array<{
    id: string;
    name: string;
    dimensions: string;
    previewSignature: string;
    ready: boolean;
    byteLength: number;
  }>;
  printSeparation: {
    supported: false;
    status: 'metadata-only';
    warning: string;
  };
  exportWarnings: string[];
}

export type ImageSpotChannelReadinessIssueCode =
  | 'spot-channel-mask-invalid'
  | 'spot-channel-size-mismatch'
  | 'spot-channel-preview-rgb-only'
  | 'spot-channel-export-metadata-only'
  | 'spot-channel-export-prepress-required'
  | 'spot-channel-direct-paint-unsupported'
  | 'spot-channel-print-separation-unsupported';

export interface ImageSpotChannelReadinessIssue {
  code: ImageSpotChannelReadinessIssueCode;
  severity: 'blocker' | 'warning';
  channelId?: string;
  message: string;
}

export interface ImageSpotChannelReadinessDescriptor {
  kind: 'spot-channel-readiness';
  channelCount: number;
  targetFormat: ImageSpotChannelExportFormat;
  readinessSignature: string;
  metadata: {
    ready: boolean;
    signature: string;
    channels: Array<{
      id: string;
      name: string;
      index: number;
      dimensions: string;
      byteLength: number;
      tint: ImageSpotChannelWorkflowDescriptor['tint'];
      previewSignature: string;
      metadataSignature: string;
    }>;
  };
  preview: {
    ready: boolean;
    previewKind: 'rgb-tint-preview';
    previewSignatures: string[];
    invalidChannelIds: string[];
    warning: string;
    signature: string;
  };
  export: {
    ready: boolean;
    warnings: string[];
    signature: string;
  };
  directPaint: ImageSpotChannelPlanningDescriptor['directPaint'];
  printSeparation: ImageSpotChannelPlanningDescriptor['printSeparation'];
  documentCompatibility?: ImageSpotChannelDocumentCompatibilityDescriptor;
  blockers: ImageSpotChannelReadinessIssue[];
  warnings: ImageSpotChannelReadinessIssue[];
}

export interface ImageSpotChannelExportReadinessDescriptor {
  kind: 'spot-export-readiness';
  targetFormat: ImageSpotChannelExportFormat;
  channelCount: number;
  metadataStatus: 'none' | 'metadata-only';
  preview: {
    previewKind: 'rgb-tint-preview';
    ready: boolean;
    rgbOnly: true;
    signatures: string[];
    signature: string;
  };
  blockers: Array<ImageSpotChannelReadinessIssue & { signature: string }>;
  warnings: Array<ImageSpotChannelReadinessIssue & { signature: string }>;
  limitations: {
    directSpotPainting: false;
    realSpotPlates: false;
    photoshopSeparations: false;
    cmykSpotPressReadyExport: false;
    status: 'none' | 'metadata-only';
    externalPrepressRequired: boolean;
    signature: string;
  };
  exportSignature: string;
  signature: string;
}

export interface ImageSpotChannelDocumentCompatibilityDescriptor {
  targetDimensions: string;
  ready: boolean;
  signature: string;
  channels: Array<{
    id: string;
    name: string;
    dimensions: string;
    ready: boolean;
    blockerCodes: ImageSpotChannelReadinessIssueCode[];
    signature: string;
  }>;
  blockers: ImageSpotChannelReadinessIssue[];
}

export interface BuildImageSpotChannelPanelDescriptorOptions {
  selectedChannelId?: string | null;
  targetFormat?: ImageSpotChannelExportFormat;
  documentWidth?: number;
  documentHeight?: number;
}

export interface ImageSpotChannelPanelDescriptor {
  kind: 'spot-channel-panel';
  channelCount: number;
  selectedChannelId: string | null;
  selectedChannelName: string | null;
  selectedDimensions: string | null;
  directPaint: ImageSpotChannelPlanningDescriptor['directPaint'];
  printSeparation: ImageSpotChannelPlanningDescriptor['printSeparation'];
  documentCompatibility?: ImageSpotChannelDocumentCompatibilityDescriptor;
  blockers?: string[];
  warnings: string[];
  summaryLines: string[];
  signature: string;
}

const DEFAULT_SPOT_COLOR: ImageSpotChannelColor = { r: 0, g: 174, b: 239 };
const SPOT_PREVIEW_WARNING = 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.';
const SPOT_EXPORT_PREPRESS_WARNING = 'Use an external prepress tool for final spot-color separations before print handoff.';
const SPOT_DIRECT_PAINT_UNSUPPORTED_REASON = 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.';
const SPOT_PRINT_SEPARATION_WARNING = 'Sloom Studio does not emit native spot plates or press-ready separations.';
const SPOT_GRAYSCALE_PLATE_LIMITATIONS = [
  'This local grayscale plate is a mask-coverage proof, not a native spot plate or a CMYK process separation.',
  'Use an external prepress tool for press-ready spot-color output.',
];

export function buildImageSpotChannelEntry(
  mask: ImageSpotChannelMaskInput,
  existing: ImageSpotChannelEntry[] = [],
  options: BuildImageSpotChannelEntryOptions = {},
): ImageSpotChannelEntry {
  const normalized = normalizeImageSpotChannelMask(mask);
  const now = getTimestamp(options.now);
  const preferredName = sanitizeImageSpotChannelName(options.name) ?? getNextSpotChannelName(existing);

  return {
    id: options.id ?? `spot-${now}-${Math.floor(Math.random() * 1000)}`,
    name: getUniqueSpotChannelName(preferredName, existing),
    width: normalized.width,
    height: normalized.height,
    color: normalizeSpotColor(options.color),
    opacity: clampUnit(options.opacity ?? 1),
    solidity: clampUnit(options.solidity ?? 1),
    visible: options.visible ?? true,
    dataBase64: encodeSpotChannelMaskData(normalized.data),
    createdAt: now,
  };
}

export function buildImageSpotChannelManifest(
  channels: ImageSpotChannelEntry[],
): ImageSpotChannelManifestDescriptor[] {
  return channels.map((channel, index) => {
    const mask = decodeImageSpotChannelMask(channel);
    return {
      id: channel.id,
      kind: 'spot',
      name: channel.name,
      index,
      width: channel.width,
      height: channel.height,
      pixelCount: getMaskPixelCount(channel.width, channel.height),
      byteLength: mask?.data.length ?? 0,
      createdAt: channel.createdAt,
      ...(channel.updatedAt === undefined ? {} : { updatedAt: channel.updatedAt }),
      visible: channel.visible,
      preview: describeSpotChannelPreviewMetadata(channel),
      exportWarnings: buildSpotChannelExportWarnings([channel]),
    };
  });
}

export function buildImageSpotChannelWorkflowDescriptors(
  channels: ImageSpotChannelEntry[],
  options: BuildSpotChannelExportWarningsOptions = {},
): ImageSpotChannelWorkflowDescriptor[] {
  return channels.map((channel, index) => {
    const mask = decodeImageSpotChannelMask(channel);
    const preview = describeSpotChannelPreviewMetadata(channel);
    const dimensions = formatDimensions(channel.width, channel.height);
    const visibilitySignature = preview.visible ? 'visible' : 'hidden';
    const warnings = mask ? [] : ['Spot channel mask data is invalid and cannot be previewed.'];

    return {
      id: channel.id,
      kind: 'spot-workflow',
      name: channel.name,
      index,
      dimensions,
      pixelCount: getMaskPixelCount(channel.width, channel.height),
      byteLength: mask?.data.length ?? 0,
      createdAt: channel.createdAt,
      ...(channel.updatedAt === undefined ? {} : { updatedAt: channel.updatedAt }),
      tint: {
        color: preview.tintColor,
        cssColor: preview.tintCssColor,
        opacity: preview.opacity,
        solidity: preview.solidity,
        effectiveOpacity: preview.effectiveOpacity,
        visible: preview.visible,
      },
      preview: {
        previewKind: 'rgb-tint-preview',
        signature: `spot-preview:${channel.id}:${dimensions}:${preview.tintColor.r},${preview.tintColor.g},${preview.tintColor.b}:${preview.opacity}:${preview.solidity}:${visibilitySignature}`,
        warning: SPOT_PREVIEW_WARNING,
      },
      directPaint: {
        supported: false,
        enabled: false,
        reason: SPOT_DIRECT_PAINT_UNSUPPORTED_REASON,
      },
      printSeparation: {
        supported: false,
        warning: SPOT_PRINT_SEPARATION_WARNING,
      },
      exportWarnings: buildSpotChannelExportWarnings([channel], options),
      warnings,
    };
  });
}

export function buildImageSpotChannelPlanningDescriptor(
  channels: ImageSpotChannelEntry[],
  options: BuildSpotChannelExportWarningsOptions = {},
): ImageSpotChannelPlanningDescriptor {
  const workflows = buildImageSpotChannelWorkflowDescriptors(channels, options);
  const format = options.targetFormat ?? 'source';
  const channelSignature = workflows.map((channel) => {
    const visibility = channel.tint.visible ? 'visible' : 'hidden';
    return `${channel.id}:${channel.dimensions}:${channel.tint.color.r},${channel.tint.color.g},${channel.tint.color.b}:${channel.tint.opacity}:${channel.tint.solidity}:${visibility}`;
  }).join('|') || 'none';

  return {
    kind: 'spot-channel-planning',
    channelCount: workflows.length,
    readinessSignature: `spot-channels:${format}:${channelSignature}`,
    directPaint: {
      supported: false,
      enabled: false,
      status: 'unsupported',
      signature: `spot-edit:${workflows.length}:unsupported`,
      reason: SPOT_DIRECT_PAINT_UNSUPPORTED_REASON,
    },
    channels: workflows.map((channel) => ({
      id: channel.id,
      name: channel.name,
      dimensions: channel.dimensions,
      previewSignature: channel.preview.signature,
      ready: channel.warnings.length === 0,
      byteLength: channel.byteLength,
    })),
    printSeparation: {
      supported: false,
      status: 'metadata-only',
      warning: SPOT_PRINT_SEPARATION_WARNING,
    },
    exportWarnings: buildSpotChannelExportWarnings(channels, options),
  };
}

export function buildImageSpotChannelReadinessDescriptor(
  channels: ImageSpotChannelEntry[],
  options: BuildSpotChannelExportWarningsOptions = {},
): ImageSpotChannelReadinessDescriptor {
  const targetFormat = options.targetFormat ?? 'source';
  const workflows = buildImageSpotChannelWorkflowDescriptors(channels, { targetFormat });
  const planning = buildImageSpotChannelPlanningDescriptor(channels, { targetFormat });
  const documentCompatibility = buildSpotChannelDocumentCompatibilityDescriptor(channels, options);
  const metadataChannels = workflows.map((channel) => {
    const metadataSignature = buildSpotChannelMetadataSignature(channel);
    return {
      id: channel.id,
      name: channel.name,
      index: channel.index,
      dimensions: channel.dimensions,
      byteLength: channel.byteLength,
      tint: { ...channel.tint, color: { ...channel.tint.color } },
      previewSignature: channel.preview.signature,
      metadataSignature,
    };
  });
  const invalidChannelIds = workflows
    .filter((channel) => channel.warnings.length > 0)
    .map((channel) => channel.id);
  const maskBlockers: ImageSpotChannelReadinessIssue[] = workflows
    .filter((channel) => channel.warnings.length > 0)
    .map((channel) => ({
      code: 'spot-channel-mask-invalid',
      severity: 'blocker',
      channelId: channel.id,
      message: `Spot channel "${channel.name}" mask data is invalid and cannot be previewed or exported as metadata.`,
    }));
  const blockers = [
    ...maskBlockers,
    ...(documentCompatibility?.blockers ?? []),
  ];
  const exportWarnings = buildSpotChannelExportWarnings(channels, { targetFormat });
  const warnings = buildSpotChannelReadinessWarnings(channels.length, exportWarnings);
  const readinessParts = workflows.map((channel) => {
    const documentChannel = documentCompatibility?.channels.find((candidate) => candidate.id === channel.id);
    const readiness = channel.warnings.length === 0 && documentChannel?.ready !== false ? 'ready' : 'blocked';
    const visibility = channel.tint.visible ? 'visible' : 'hidden';
    return `${channel.id}:${channel.dimensions}:${channel.tint.color.r},${channel.tint.color.g},${channel.tint.color.b}:${channel.tint.opacity}:${channel.tint.solidity}:${visibility}:${readiness}`;
  });
  const metadataSignature = metadataChannels.map((channel) => channel.metadataSignature).join('+') || 'none';
  const previewSignature = workflows
    .map((channel) => `${channel.id}:${channel.warnings.length === 0 ? 'ready' : 'blocked'}`)
    .join('+') || 'none';

  return {
    kind: 'spot-channel-readiness',
    channelCount: workflows.length,
    targetFormat,
    readinessSignature: `spot-readiness:${targetFormat}:${readinessParts.join('+') || 'none'}`,
    metadata: {
      ready: maskBlockers.length === 0,
      signature: `spot-metadata:${metadataSignature}`,
      channels: metadataChannels,
    },
    preview: {
      ready: invalidChannelIds.length === 0,
      previewKind: 'rgb-tint-preview',
      previewSignatures: workflows.map((channel) => channel.preview.signature),
      invalidChannelIds,
      warning: SPOT_PREVIEW_WARNING,
      signature: `spot-preview-readiness:${previewSignature}`,
    },
    export: {
      ready: exportWarnings.length === 0 && blockers.length === 0,
      warnings: exportWarnings,
      signature: `spot-export:${targetFormat}:${workflows.length}:${workflows.length === 0 ? 'native' : 'metadata-only'}${blockers.length > 0 ? ':blocked' : ''}`,
    },
    directPaint: planning.directPaint,
    printSeparation: planning.printSeparation,
    ...(documentCompatibility ? { documentCompatibility } : {}),
    blockers,
    warnings,
  };
}

export function buildImageSpotChannelExportReadinessDescriptor(
  channels: ImageSpotChannelEntry[],
  options: BuildSpotChannelExportWarningsOptions = {},
): ImageSpotChannelExportReadinessDescriptor {
  const targetFormat = options.targetFormat ?? 'source';
  const readiness = buildImageSpotChannelReadinessDescriptor(channels, options);
  const metadataStatus = channels.length > 0 ? 'metadata-only' : 'none';
  const previewSignature = `spot-export-preview:v1:${readiness.preview.previewSignatures.join('+') || 'none'}`;
  const limitationSignature = [
    'spot-export-limitations:v1',
    targetFormat,
    metadataStatus,
    'no-direct-paint',
    'no-real-plates',
    'no-photoshop-separations',
    'no-cmyk-spot-press-ready',
  ].join(':');
  const blockers = readiness.blockers.map((issue) => ({
    ...issue,
    signature: buildSpotExportIssueSignature('blocker', issue),
  }));
  const warnings = readiness.warnings.map((issue) => ({
    ...issue,
    signature: buildSpotExportIssueSignature('warning', issue),
  }));
  const blockedState = blockers.length > 0 ? 'blocked' : 'ready';

  return {
    kind: 'spot-export-readiness',
    targetFormat,
    channelCount: channels.length,
    metadataStatus,
    preview: {
      previewKind: 'rgb-tint-preview',
      ready: readiness.preview.ready,
      rgbOnly: true,
      signatures: [...readiness.preview.previewSignatures],
      signature: previewSignature,
    },
    blockers,
    warnings,
    limitations: {
      directSpotPainting: false,
      realSpotPlates: false,
      photoshopSeparations: false,
      cmykSpotPressReadyExport: false,
      status: metadataStatus,
      externalPrepressRequired: channels.length > 0,
      signature: limitationSignature,
    },
    exportSignature: readiness.export.signature,
    signature: `spot-export-readiness:v1:${targetFormat}:${channels.length}:${metadataStatus}:${blockedState}:${previewSignature}`,
  };
}

export function buildImageSpotChannelPanelDescriptor(
  channels: ImageSpotChannelEntry[],
  options: BuildImageSpotChannelPanelDescriptorOptions = {},
): ImageSpotChannelPanelDescriptor {
  const targetFormat = options.targetFormat ?? 'source';
  const planning = buildImageSpotChannelPlanningDescriptor(channels, { targetFormat });
  const workflows = buildImageSpotChannelWorkflowDescriptors(channels, { targetFormat });
  const documentCompatibility = buildSpotChannelDocumentCompatibilityDescriptor(channels, options);
  const selectedChannel = workflows.find((channel) => channel.id === options.selectedChannelId) ?? null;
  const warnings = [
    SPOT_PREVIEW_WARNING,
    ...buildSpotChannelExportWarnings(channels, { targetFormat }),
  ];
  const summaryLines = [
    SPOT_PREVIEW_WARNING,
    SPOT_DIRECT_PAINT_UNSUPPORTED_REASON,
    SPOT_PRINT_SEPARATION_WARNING,
  ];
  const blockers = documentCompatibility?.blockers.map((blocker) => blocker.message) ?? [];
  const hasSizeMismatch = documentCompatibility?.blockers.some((blocker) => blocker.code === 'spot-channel-size-mismatch') ?? false;

  return {
    kind: 'spot-channel-panel',
    channelCount: channels.length,
    selectedChannelId: selectedChannel?.id ?? null,
    selectedChannelName: selectedChannel?.name ?? null,
    selectedDimensions: selectedChannel?.dimensions ?? null,
    directPaint: planning.directPaint,
    printSeparation: planning.printSeparation,
    ...(documentCompatibility ? { documentCompatibility, blockers } : {}),
    warnings,
    summaryLines,
    signature: documentCompatibility
      ? `spot-channel-panel:v1:${targetFormat}:${selectedChannel?.id ?? 'none'}:${selectedChannel?.dimensions ?? 'none'}:${documentCompatibility.ready ? 'ready' : 'blocked'}:${hasSizeMismatch ? 'size-mismatch' : 'none'}:warning-count=${warnings.length}`
      : `spot-channel-panel:v1:${targetFormat}:${selectedChannel?.id ?? 'none'}:${selectedChannel?.dimensions ?? 'none'}:warning-count=${warnings.length}`,
  };
}

export function describeSpotChannelPreviewMetadata(
  channel: Pick<ImageSpotChannelEntry, 'color' | 'opacity' | 'solidity' | 'visible'>,
): ImageSpotChannelPreviewMetadata {
  const tintColor = normalizeSpotColor(channel.color);
  const opacity = clampUnit(channel.opacity);
  const solidity = clampUnit(channel.solidity);

  return {
    previewKind: 'rgb-tint-preview',
    tintColor,
    tintCssColor: formatRgbCss(tintColor),
    opacity,
    solidity,
    effectiveOpacity: roundRatio(opacity * solidity),
    visible: channel.visible !== false,
    warnings: [SPOT_PREVIEW_WARNING],
  };
}

export function buildSpotChannelExportWarnings(
  channels: ImageSpotChannelEntry[],
  options: BuildSpotChannelExportWarningsOptions = {},
): string[] {
  if (channels.length === 0) return [];

  const countLabel = `${channels.length} spot channel${channels.length === 1 ? '' : 's'}`;
  const verb = channels.length === 1 ? 'is' : 'are';
  const formatLabel = options.targetFormat ? formatExportTarget(options.targetFormat) : null;
  const exportWarning = formatLabel
    ? `${countLabel} ${verb} preserved only as Sloom Studio metadata; ${formatLabel} export cannot emit native spot plates or press-ready separations.`
    : `${countLabel} ${verb} preserved only as Sloom Studio metadata; native spot plates and press-ready separations are not exported.`;

  return [exportWarning, SPOT_EXPORT_PREPRESS_WARNING];
}

export function updateImageSpotChannelMetadata(
  channels: ImageSpotChannelEntry[],
  id: string,
  updates: UpdateImageSpotChannelMetadataOptions,
): ImageSpotChannelEntry[] {
  return channels.map((channel) => {
    if (channel.id !== id) return channel;
    const otherChannels = channels.filter((candidate) => candidate.id !== id);
    const nextName = sanitizeImageSpotChannelName(updates.name);

    return {
      ...channel,
      name: nextName ? getUniqueSpotChannelName(nextName, otherChannels) : channel.name,
      color: updates.color ? normalizeSpotColor(updates.color, channel.color) : channel.color,
      opacity: updates.opacity === undefined ? channel.opacity : clampUnit(updates.opacity),
      solidity: updates.solidity === undefined ? channel.solidity : clampUnit(updates.solidity),
      visible: updates.visible ?? channel.visible,
      updatedAt: getTimestamp(updates.now),
    };
  });
}

export function decodeImageSpotChannelMask(channel: Pick<ImageSpotChannelEntry, 'width' | 'height' | 'dataBase64'>): ImageSpotChannelMask | null {
  if (!isPositiveInteger(channel.width) || !isPositiveInteger(channel.height)) return null;
  const decoded = decodeSpotChannelMaskData(channel.dataBase64);
  if (!decoded || decoded.length !== channel.width * channel.height) return null;
  return {
    width: channel.width,
    height: channel.height,
    data: decoded,
  };
}

export function renderSpotChannelPreview(
  mask: ImageSpotChannelMaskInput,
  options: RenderSpotChannelPreviewOptions,
): ImageSpotChannelMask {
  const normalized = normalizeImageSpotChannelMask(mask);
  const pixelCount = normalized.width * normalized.height;
  const base = options.baseRgba ? normalizeRgbaBuffer(options.baseRgba, pixelCount) : null;
  const color = normalizeSpotColor(options.color);
  const opacity = clampUnit(options.opacity ?? 1);
  const solidity = clampUnit(options.solidity ?? 1);
  const output = new Uint8ClampedArray(pixelCount * 4);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const outputOffset = pixel * 4;
    const baseAlpha = base ? base[outputOffset + 3] / 255 : 0;
    const spotAlpha = options.visible === false ? 0 : (normalized.data[pixel] / 255) * opacity * solidity;
    const outAlpha = spotAlpha + baseAlpha * (1 - spotAlpha);

    if (outAlpha <= 0) {
      output[outputOffset] = color.r;
      output[outputOffset + 1] = color.g;
      output[outputOffset + 2] = color.b;
      output[outputOffset + 3] = 0;
      continue;
    }

    const baseRed = base ? base[outputOffset] : 0;
    const baseGreen = base ? base[outputOffset + 1] : 0;
    const baseBlue = base ? base[outputOffset + 2] : 0;

    output[outputOffset] = blendPreviewComponent(color.r, baseRed, spotAlpha, baseAlpha, outAlpha);
    output[outputOffset + 1] = blendPreviewComponent(color.g, baseGreen, spotAlpha, baseAlpha, outAlpha);
    output[outputOffset + 2] = blendPreviewComponent(color.b, baseBlue, spotAlpha, baseAlpha, outAlpha);
    output[outputOffset + 3] = Math.round(outAlpha * 255);
  }

  return {
    width: normalized.width,
    height: normalized.height,
    data: output,
  };
}

/**
 * Materializes the persisted spot-mask state as a standalone binary PGM
 * grayscale plate. A full mask value is black in the plate (full ink), while
 * zero coverage is white (paper). Opacity, solidity, and visibility are all
 * applied before bytes are emitted, making this a truthful inspection/export
 * artifact rather than metadata-only evidence.
 */
export function buildImageSpotChannelGrayscalePlate(
  channel: ImageSpotChannelEntry,
): ImageSpotChannelGrayscalePlate | null {
  const mask = decodeImageSpotChannelMask(channel);
  if (!mask) return null;

  const visible = channel.visible !== false;
  const effectiveOpacity = visible ? roundRatio(clampUnit(channel.opacity) * clampUnit(channel.solidity)) : 0;
  const inkCoverage = new Uint8ClampedArray(mask.data.length);
  const grayscale = new Uint8ClampedArray(mask.data.length);

  for (let index = 0; index < mask.data.length; index += 1) {
    const coverage = Math.round(mask.data[index] * effectiveOpacity);
    inkCoverage[index] = coverage;
    grayscale[index] = 255 - coverage;
  }

  const header = new TextEncoder().encode(`P5\n${mask.width} ${mask.height}\n255\n`);
  const data = new Uint8Array(header.length + grayscale.length);
  data.set(header);
  data.set(grayscale, header.length);

  return {
    kind: 'spot-grayscale-plate',
    channelId: channel.id,
    channelName: channel.name,
    width: mask.width,
    height: mask.height,
    effectiveOpacity,
    visible,
    inkCoverage,
    grayscale,
    mimeType: 'image/x-portable-graymap',
    filename: formatImageSpotChannelPlateFilename(channel.name),
    data,
    signature: `spot-grayscale-plate:v1:${channel.id}:${mask.width}x${mask.height}:${effectiveOpacity}:${visible ? 'visible' : 'hidden'}:${data.length}`,
    limitations: [...SPOT_GRAYSCALE_PLATE_LIMITATIONS],
  };
}

export function formatImageSpotChannelPlateFilename(name: string): string {
  const normalized = sanitizeImageSpotChannelName(name) ?? 'spot-channel';
  const safeStem = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'spot-channel';
  return `${safeStem}-coverage.pgm`;
}

export function normalizeImageSpotChannelMask(mask: ImageSpotChannelMaskInput): ImageSpotChannelMask {
  if (!isPositiveInteger(mask.width) || !isPositiveInteger(mask.height)) {
    throw new Error('Spot channel masks require positive integer dimensions.');
  }
  const pixelCount = mask.width * mask.height;
  const source = Array.from(mask.data);
  const isRgba = mask.kind === 'rgba' || source.length === pixelCount * 4;
  if (!isRgba && source.length !== pixelCount) {
    throw new Error('Spot channel mask data must be grayscale/alpha or RGBA data matching the mask dimensions.');
  }
  if (isRgba && source.length !== pixelCount * 4) {
    throw new Error('RGBA spot channel mask data must contain four bytes per pixel.');
  }

  const data = new Uint8ClampedArray(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    data[pixel] = clampByte(isRgba ? source[pixel * 4 + 3] : source[pixel]);
  }

  return {
    width: mask.width,
    height: mask.height,
    data,
  };
}

export function sanitizeImageSpotChannelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || undefined;
}

function normalizeSpotColor(
  value: Partial<ImageSpotChannelColor> | undefined,
  fallback: ImageSpotChannelColor = DEFAULT_SPOT_COLOR,
): ImageSpotChannelColor {
  return {
    r: clampByte(value?.r ?? fallback.r),
    g: clampByte(value?.g ?? fallback.g),
    b: clampByte(value?.b ?? fallback.b),
  };
}

function normalizeRgbaBuffer(value: Uint8ClampedArray | Uint8Array | number[], pixelCount: number): Uint8ClampedArray {
  if (value.length !== pixelCount * 4) {
    throw new Error('Spot channel preview base data must contain RGBA data matching the mask dimensions.');
  }
  const output = new Uint8ClampedArray(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = clampByte(value[index]);
  }
  return output;
}

function blendPreviewComponent(
  spot: number,
  base: number,
  spotAlpha: number,
  baseAlpha: number,
  outAlpha: number,
): number {
  return Math.round((spot * spotAlpha + base * baseAlpha * (1 - spotAlpha)) / outAlpha);
}

function getNextSpotChannelName(existing: ImageSpotChannelEntry[]): string {
  let index = 1;
  const names = new Set(existing.map((channel) => channel.name));
  while (names.has(`Spot ${index}`)) {
    index += 1;
  }
  return `Spot ${index}`;
}

function getUniqueSpotChannelName(preferredName: string, existing: ImageSpotChannelEntry[]): string {
  const names = new Set(existing.map((channel) => channel.name));
  if (!names.has(preferredName)) return preferredName;
  if (/^Spot \d+$/.test(preferredName)) {
    return getNextSpotChannelName(existing);
  }
  let index = 2;
  while (names.has(`${preferredName} ${index}`)) {
    index += 1;
  }
  return `${preferredName} ${index}`;
}

function getMaskPixelCount(width: number, height: number): number {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return 0;
  return width * height;
}

function formatRgbCss(color: ImageSpotChannelColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function formatDimensions(width: number, height: number): string {
  return `${width}x${height}`;
}

function buildSpotChannelMetadataSignature(channel: ImageSpotChannelWorkflowDescriptor): string {
  const visibility = channel.tint.visible ? 'visible' : 'hidden';
  return `${channel.id}:${channel.byteLength}:${channel.tint.color.r},${channel.tint.color.g},${channel.tint.color.b}:${channel.tint.opacity}:${channel.tint.solidity}:${visibility}`;
}

function buildSpotChannelDocumentCompatibilityDescriptor(
  channels: ImageSpotChannelEntry[],
  options: Pick<BuildSpotChannelExportWarningsOptions, 'documentWidth' | 'documentHeight'>,
): ImageSpotChannelDocumentCompatibilityDescriptor | undefined {
  if (!isPositiveInteger(options.documentWidth ?? 0) || !isPositiveInteger(options.documentHeight ?? 0)) {
    return undefined;
  }

  const targetDimensions = formatDimensions(options.documentWidth as number, options.documentHeight as number);
  const blockers: ImageSpotChannelReadinessIssue[] = [];
  const channelDescriptors = channels.map((channel) => {
    const dimensions = formatDimensions(channel.width, channel.height);
    const blockerCodes: ImageSpotChannelReadinessIssueCode[] = [];

    if (channel.width !== options.documentWidth || channel.height !== options.documentHeight) {
      blockerCodes.push('spot-channel-size-mismatch');
      blockers.push({
        code: 'spot-channel-size-mismatch',
        severity: 'blocker',
        channelId: channel.id,
        message: `Spot channel "${channel.name}" is ${dimensions} but the active document is ${targetDimensions}.`,
      });
    }

    const ready = blockerCodes.length === 0;
    return {
      id: channel.id,
      name: channel.name,
      dimensions,
      ready,
      blockerCodes,
      signature: `spot-channel-size:${channel.id}:${dimensions}->${targetDimensions}:${ready ? 'ready' : 'blocked'}`,
    };
  });

  return {
    targetDimensions,
    ready: blockers.length === 0,
    signature: `spot-document-compatibility:v1:${targetDimensions}:${channelDescriptors.map((channel) => `${channel.id}:${channel.dimensions}:${channel.ready ? 'ready' : 'blocked'}`).join('+') || 'none'}`,
    channels: channelDescriptors,
    blockers,
  };
}

function buildSpotChannelReadinessWarnings(
  channelCount: number,
  exportWarnings: string[],
): ImageSpotChannelReadinessIssue[] {
  if (channelCount === 0) return [];
  const warnings: ImageSpotChannelReadinessIssue[] = [
    {
      code: 'spot-channel-preview-rgb-only',
      severity: 'warning',
      message: SPOT_PREVIEW_WARNING,
    },
  ];

  for (const warning of exportWarnings) {
    warnings.push({
      code: warning === SPOT_EXPORT_PREPRESS_WARNING
        ? 'spot-channel-export-prepress-required'
        : 'spot-channel-export-metadata-only',
      severity: 'warning',
      message: warning,
    });
  }

  warnings.push(
    {
      code: 'spot-channel-direct-paint-unsupported',
      severity: 'warning',
      message: SPOT_DIRECT_PAINT_UNSUPPORTED_REASON,
    },
    {
      code: 'spot-channel-print-separation-unsupported',
      severity: 'warning',
      message: SPOT_PRINT_SEPARATION_WARNING,
    },
  );

  return warnings;
}

function buildSpotExportIssueSignature(
  kind: 'blocker' | 'warning',
  issue: ImageSpotChannelReadinessIssue,
): string {
  return `spot-export-${kind}:${issue.code}:${issue.channelId ?? 'none'}`;
}

function formatExportTarget(format: ImageSpotChannelExportFormat): string {
  if (format === 'source') return 'Source';
  return format.toUpperCase();
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function encodeSpotChannelMaskData(data: Uint8ClampedArray): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.subarray(index, index + chunkSize);
    for (let inner = 0; inner < chunk.length; inner += 1) {
      binary += String.fromCharCode(chunk[inner] ?? 0);
    }
  }
  return btoa(binary);
}

function decodeSpotChannelMaskData(value: string): Uint8ClampedArray | null {
  try {
    const binary = atob(value);
    const data = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      data[index] = binary.charCodeAt(index);
    }
    return data;
  } catch {
    return null;
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value ?? 0)));
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function getTimestamp(value: number | undefined): number {
  return Number.isFinite(value) ? value ?? Date.now() : Date.now();
}
