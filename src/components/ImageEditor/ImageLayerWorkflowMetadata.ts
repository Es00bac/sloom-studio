import type { BlendMode, ImageDocument, ImageLayer, ImageLayerFilterMask, ImageSourceLinkMetadata } from '../../types/imageEditor';
import { describeLayerFilterStackInterop } from './ImageLayerFilters';
import { describeImageLayerOrganization } from './ImageLayerOrganization';

const MAX_SMART_FILTER_MASK_SIGNATURE_CELLS = 4_194_304;

export interface ImageLayerWorkflowBadge {
  id: string;
  label: string;
  description: string;
}

export type ImageLayerBlendReadinessExportTarget = 'editable' | 'flattened';
export type ImageLayerBlendReadinessChannel = 'red' | 'green' | 'blue';
export type ImageLayerBlendReadinessKnockoutMode = 'none' | 'shallow' | 'deep';
export type ImageLayerBlendReadinessWarningCode =
  | 'fill-opacity-unsupported'
  | 'blend-if-unsupported'
  | 'channel-targeting-unsupported'
  | 'knockout-unsupported'
  | 'flattened-alpha';

export type ImageLayerBlendPortabilityCheckId =
  | 'fill-opacity'
  | 'blend-if'
  | 'channel-targeting'
  | 'knockout'
  | 'flattened-alpha';

export interface ImageLayerBlendModeSupportDescriptor {
  mode: BlendMode;
  label: string;
  canvasCompositeOperation: GlobalCompositeOperation;
  previewSupported: true;
  exportSupported: true;
}

export interface ImageLayerBlendModeSupportGroup {
  id: 'basic' | 'contrast' | 'component';
  label: string;
  modes: BlendMode[];
  caveats: string[];
}

export interface ImageLayerBlendUnsupportedStateDescriptor {
  id: 'fill-opacity' | 'blend-if' | 'channel-targeting' | 'knockout';
  label: string;
  supported: false;
  caveat: string;
}

export interface ImageLayerBlendReadinessUnsupportedStates {
  fillOpacity: {
    supported: false;
    requested: boolean;
    value: number;
    caveat?: string;
  };
  blendIf: {
    supported: false;
    requested: boolean;
    caveat?: string;
  };
  channelTargeting: {
    supported: false;
    requested: boolean;
    channels: ImageLayerBlendReadinessChannel[];
    caveat?: string;
  };
  knockout: {
    supported: false;
    requested: boolean;
    mode: ImageLayerBlendReadinessKnockoutMode;
    caveat?: string;
  };
}

export interface ImageLayerBlendReadinessAlphaOpacityCaveat {
  id: 'layer-opacity' | 'flattened-alpha';
  value: number;
  caveat: string;
}

export interface ImageLayerBlendPortabilityCheck {
  id: ImageLayerBlendPortabilityCheckId;
  label: string;
  supported: boolean;
  requested: boolean;
  status: 'ready' | 'warning' | 'unsupported';
  reasonCode?: ImageLayerBlendReadinessWarningCode;
  value?: number;
  channels?: ImageLayerBlendReadinessChannel[];
  mode?: ImageLayerBlendReadinessKnockoutMode;
  caveat?: string;
  signature: string;
}

export interface ImageLayerBlendModeReadinessOptions {
  exportTarget?: ImageLayerBlendReadinessExportTarget;
  fillOpacity?: number;
  blendIf?: boolean;
  channelTargeting?: readonly ImageLayerBlendReadinessChannel[];
  knockout?: Exclude<ImageLayerBlendReadinessKnockoutMode, 'none'>;
}

export interface ImageLayerBlendModeReadinessDescriptor {
  descriptorId: 'image-layer-blend-readiness:v1';
  layerId: string;
  layerName: string;
  blendMode: BlendMode;
  label: string;
  canvasCompositeOperation: GlobalCompositeOperation;
  supportedModes: ImageLayerBlendModeSupportDescriptor[];
  supportGroups: ImageLayerBlendModeSupportGroup[];
  previewExportParity: {
    previewSupported: true;
    exportSupported: true;
    parity: 'canvas-live' | 'canvas-flattened';
  };
  unsupported: ImageLayerBlendReadinessUnsupportedStates;
  alphaOpacityCaveats: ImageLayerBlendReadinessAlphaOpacityCaveat[];
  portabilityChecks: ImageLayerBlendPortabilityCheck[];
  knownMathLimitations: string[];
  warningCodes: ImageLayerBlendReadinessWarningCode[];
  signature: string;
  previewSignature: string;
  exportSignature: string;
}

export interface ImageLayerBlendModeReadinessCatalog {
  descriptorId: 'image-layer-blend-readiness-catalog:v1';
  supportedModes: ImageLayerBlendModeSupportDescriptor[];
  supportGroups: ImageLayerBlendModeSupportGroup[];
  unsupportedAdvancedStates: ImageLayerBlendUnsupportedStateDescriptor[];
  knownMathLimitations: string[];
  signature: string;
}

const IMAGE_LAYER_SUPPORTED_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const satisfies readonly BlendMode[];

const IMAGE_LAYER_BLEND_MODE_LABELS = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
} satisfies Record<BlendMode, string>;

const FILL_OPACITY_UNSUPPORTED_CAVEAT =
  'Photoshop Fill Opacity is unsupported; Sloom Studio applies only layer opacity for preview/export.';
const BLEND_IF_UNSUPPORTED_CAVEAT =
  'Photoshop Blend If source/underlying tonal range splitting is unsupported and does not affect preview/export pixels.';
const CHANNEL_TARGETING_UNSUPPORTED_CAVEAT =
  'Advanced blending channel targeting is unsupported; blend modes apply to the composited canvas result.';
const KNOCKOUT_UNSUPPORTED_CAVEAT =
  'Photoshop shallow/deep knockout is unsupported; group/layer stacks are rendered without knockout isolation.';
const LAYER_OPACITY_BLEND_CAVEAT =
  'Layer opacity uses Canvas globalAlpha before blend compositing; Photoshop fill opacity is not modeled.';
const FLATTENED_ALPHA_BLEND_CAVEAT =
  'Flattened export preserves canvas alpha compositing but does not retain editable Photoshop blend stacks.';
const CANVAS_BLEND_MATH_LIMITATION =
  'Canvas blend math is browser-managed and may not exactly match Photoshop in non-sRGB, high-bit-depth, or color-managed documents.';
const COMPONENT_BLEND_MATH_LIMITATION =
  'Hue, Saturation, Color, and Luminosity rely on Canvas 2D component blending and are treated as flattened sRGB preview/export approximations.';
const SOFT_LIGHT_DODGE_BURN_LIMITATION =
  'Soft Light and Color Dodge/Burn formulas are delegated to the browser Canvas implementation; parity should be validated visually for critical PSD roundtrips.';

const IMAGE_LAYER_BLEND_SUPPORT_GROUPS: readonly ImageLayerBlendModeSupportGroup[] = [
  {
    id: 'basic',
    label: 'Basic canvas blend modes',
    modes: ['normal', 'multiply', 'screen', 'overlay'],
    caveats: [],
  },
  {
    id: 'contrast',
    label: 'Contrast and comparison blend modes',
    modes: ['darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'],
    caveats: [CANVAS_BLEND_MATH_LIMITATION],
  },
  {
    id: 'component',
    label: 'Component blend modes',
    modes: ['hue', 'saturation', 'color', 'luminosity'],
    caveats: [COMPONENT_BLEND_MATH_LIMITATION],
  },
];

const IMAGE_LAYER_UNSUPPORTED_BLEND_STATES: readonly ImageLayerBlendUnsupportedStateDescriptor[] = [
  {
    id: 'fill-opacity',
    label: 'Fill Opacity',
    supported: false,
    caveat: FILL_OPACITY_UNSUPPORTED_CAVEAT,
  },
  {
    id: 'blend-if',
    label: 'Blend If',
    supported: false,
    caveat: BLEND_IF_UNSUPPORTED_CAVEAT,
  },
  {
    id: 'channel-targeting',
    label: 'Channel Targeting',
    supported: false,
    caveat: CHANNEL_TARGETING_UNSUPPORTED_CAVEAT,
  },
  {
    id: 'knockout',
    label: 'Knockout',
    supported: false,
    caveat: KNOCKOUT_UNSUPPORTED_CAVEAT,
  },
];

export function getImageLayerBlendModeReadinessCatalog(): ImageLayerBlendModeReadinessCatalog {
  const supportedModes = getImageLayerBlendModeSupportDescriptors();
  const supportGroups = cloneImageLayerBlendSupportGroups();
  const unsupportedAdvancedStates = IMAGE_LAYER_UNSUPPORTED_BLEND_STATES.map((state) => ({ ...state }));

  return {
    descriptorId: 'image-layer-blend-readiness-catalog:v1',
    supportedModes,
    supportGroups,
    unsupportedAdvancedStates,
    knownMathLimitations: getImageLayerBlendKnownMathLimitations(),
    signature: `image-layer-blend-readiness-catalog:v1:${JSON.stringify({
      modes: supportedModes.map((mode) => mode.mode),
      unsupported: unsupportedAdvancedStates.map((state) => state.id),
      groups: supportGroups.map((group) => group.id),
    })}`,
  };
}

export function describeImageLayerBlendModeReadiness(
  layer: ImageLayer,
  options: ImageLayerBlendModeReadinessOptions = {},
): ImageLayerBlendModeReadinessDescriptor {
  const exportTarget = options.exportTarget ?? 'editable';
  const blendMode = layer.blendMode;
  const unsupported = describeImageLayerBlendUnsupportedStates(options);
  const warningCodes = describeImageLayerBlendWarningCodes(unsupported, exportTarget);
  const alphaOpacityCaveats = describeImageLayerBlendAlphaOpacityCaveats(layer.opacity, exportTarget);
  const portabilityChecks = describeImageLayerBlendPortabilityChecks(layer.id, unsupported, exportTarget);
  const canvasCompositeOperation = imageLayerBlendModeToCanvasCompositeOperation(blendMode);
  const previewExportParity = exportTarget === 'flattened' ? 'canvas-flattened' : 'canvas-live';
  const normalizedOpacity = normalizeBlendReadinessRatio(layer.opacity, 1);

  return {
    descriptorId: 'image-layer-blend-readiness:v1',
    layerId: layer.id,
    layerName: layer.name,
    blendMode,
    label: IMAGE_LAYER_BLEND_MODE_LABELS[blendMode],
    canvasCompositeOperation,
    supportedModes: getImageLayerBlendModeSupportDescriptors(),
    supportGroups: cloneImageLayerBlendSupportGroups(),
    previewExportParity: {
      previewSupported: true,
      exportSupported: true,
      parity: previewExportParity,
    },
    unsupported,
    alphaOpacityCaveats,
    portabilityChecks,
    knownMathLimitations: getImageLayerBlendKnownMathLimitations(),
    warningCodes,
    signature: `image-layer-blend-readiness:v1:${JSON.stringify({
      layerId: layer.id,
      blendMode,
      opacity: normalizedOpacity,
      exportTarget,
      unsupported: {
        fillOpacity: unsupported.fillOpacity.requested ? unsupported.fillOpacity.value : null,
        blendIf: unsupported.blendIf.requested,
        channelTargeting: unsupported.channelTargeting.channels,
        knockout: unsupported.knockout.mode,
      },
      warningCodes,
    })}`,
    previewSignature: `image-layer-blend-readiness-preview:v1:${JSON.stringify({
      layerId: layer.id,
      blendMode,
      opacity: normalizedOpacity,
      unsupported: warningCodes.filter((code) => code !== 'flattened-alpha'),
      exportTarget,
    })}`,
    exportSignature: `image-layer-blend-readiness-export:v1:${JSON.stringify({
      layerId: layer.id,
      blendMode,
      canvasCompositeOperation,
      exportTarget,
      previewExportParity,
      warningCodes,
    })}`,
  };
}

function getImageLayerBlendModeSupportDescriptors(): ImageLayerBlendModeSupportDescriptor[] {
  return IMAGE_LAYER_SUPPORTED_BLEND_MODES.map((mode) => ({
    mode,
    label: IMAGE_LAYER_BLEND_MODE_LABELS[mode],
    canvasCompositeOperation: imageLayerBlendModeToCanvasCompositeOperation(mode),
    previewSupported: true,
    exportSupported: true,
  }));
}

function cloneImageLayerBlendSupportGroups(): ImageLayerBlendModeSupportGroup[] {
  return IMAGE_LAYER_BLEND_SUPPORT_GROUPS.map((group) => ({
    ...group,
    modes: [...group.modes],
    caveats: [...group.caveats],
  }));
}

function getImageLayerBlendKnownMathLimitations(): string[] {
  return [
    CANVAS_BLEND_MATH_LIMITATION,
    COMPONENT_BLEND_MATH_LIMITATION,
    SOFT_LIGHT_DODGE_BURN_LIMITATION,
  ];
}

function imageLayerBlendModeToCanvasCompositeOperation(blendMode: BlendMode): GlobalCompositeOperation {
  return blendMode === 'normal' ? 'source-over' : blendMode;
}

function describeImageLayerBlendUnsupportedStates(
  options: ImageLayerBlendModeReadinessOptions,
): ImageLayerBlendReadinessUnsupportedStates {
  const fillOpacity = normalizeBlendReadinessRatio(options.fillOpacity, 1);
  const fillOpacityRequested = fillOpacity < 1;
  const channelTargeting = dedupeImageLayerBlendChannels(options.channelTargeting ?? []);
  const knockoutMode = options.knockout ?? 'none';

  return {
    fillOpacity: {
      supported: false,
      requested: fillOpacityRequested,
      value: fillOpacity,
      ...(fillOpacityRequested ? { caveat: FILL_OPACITY_UNSUPPORTED_CAVEAT } : {}),
    },
    blendIf: {
      supported: false,
      requested: Boolean(options.blendIf),
      ...(options.blendIf ? { caveat: BLEND_IF_UNSUPPORTED_CAVEAT } : {}),
    },
    channelTargeting: {
      supported: false,
      requested: channelTargeting.length > 0,
      channels: channelTargeting,
      ...(channelTargeting.length > 0 ? { caveat: CHANNEL_TARGETING_UNSUPPORTED_CAVEAT } : {}),
    },
    knockout: {
      supported: false,
      requested: knockoutMode !== 'none',
      mode: knockoutMode,
      ...(knockoutMode !== 'none' ? { caveat: KNOCKOUT_UNSUPPORTED_CAVEAT } : {}),
    },
  };
}

function describeImageLayerBlendWarningCodes(
  unsupported: ImageLayerBlendReadinessUnsupportedStates,
  exportTarget: ImageLayerBlendReadinessExportTarget,
): ImageLayerBlendReadinessWarningCode[] {
  const warningCodes: ImageLayerBlendReadinessWarningCode[] = [];
  if (unsupported.fillOpacity.requested) warningCodes.push('fill-opacity-unsupported');
  if (unsupported.blendIf.requested) warningCodes.push('blend-if-unsupported');
  if (unsupported.channelTargeting.requested) warningCodes.push('channel-targeting-unsupported');
  if (unsupported.knockout.requested) warningCodes.push('knockout-unsupported');
  if (exportTarget === 'flattened') warningCodes.push('flattened-alpha');
  return warningCodes;
}

function describeImageLayerBlendAlphaOpacityCaveats(
  opacity: number,
  exportTarget: ImageLayerBlendReadinessExportTarget,
): ImageLayerBlendReadinessAlphaOpacityCaveat[] {
  const caveats: ImageLayerBlendReadinessAlphaOpacityCaveat[] = [
    {
      id: 'layer-opacity',
      value: normalizeBlendReadinessRatio(opacity, 1),
      caveat: LAYER_OPACITY_BLEND_CAVEAT,
    },
  ];
  if (exportTarget === 'flattened') {
    caveats.push({
      id: 'flattened-alpha',
      value: 1,
      caveat: FLATTENED_ALPHA_BLEND_CAVEAT,
    });
  }
  return caveats;
}

function describeImageLayerBlendPortabilityChecks(
  layerId: string,
  unsupported: ImageLayerBlendReadinessUnsupportedStates,
  exportTarget: ImageLayerBlendReadinessExportTarget,
): ImageLayerBlendPortabilityCheck[] {
  const checks: ImageLayerBlendPortabilityCheck[] = [
    describeUnsupportedBlendPortabilityCheck(layerId, {
      id: 'fill-opacity',
      label: 'Fill Opacity',
      requested: unsupported.fillOpacity.requested,
      reasonCode: 'fill-opacity-unsupported',
      caveat: unsupported.fillOpacity.caveat,
      value: unsupported.fillOpacity.value,
    }),
    describeUnsupportedBlendPortabilityCheck(layerId, {
      id: 'blend-if',
      label: 'Blend If',
      requested: unsupported.blendIf.requested,
      reasonCode: 'blend-if-unsupported',
      caveat: unsupported.blendIf.caveat,
    }),
    describeUnsupportedBlendPortabilityCheck(layerId, {
      id: 'channel-targeting',
      label: 'Channel Targeting',
      requested: unsupported.channelTargeting.requested,
      reasonCode: 'channel-targeting-unsupported',
      caveat: unsupported.channelTargeting.caveat,
      channels: unsupported.channelTargeting.channels,
    }),
    describeUnsupportedBlendPortabilityCheck(layerId, {
      id: 'knockout',
      label: 'Knockout',
      requested: unsupported.knockout.requested,
      reasonCode: 'knockout-unsupported',
      caveat: unsupported.knockout.caveat,
      mode: unsupported.knockout.mode,
    }),
  ];

  if (exportTarget === 'flattened') {
    const flattenedCheck: ImageLayerBlendPortabilityCheck = {
      id: 'flattened-alpha',
      label: 'Flattened alpha',
      supported: true,
      requested: true,
      status: 'warning',
      reasonCode: 'flattened-alpha',
      caveat: FLATTENED_ALPHA_BLEND_CAVEAT,
      signature: '',
    };
    checks.push({
      ...flattenedCheck,
      signature: buildImageLayerBlendPortabilityCheckSignature(layerId, flattenedCheck),
    });
  }

  return checks;
}

function describeUnsupportedBlendPortabilityCheck(
  layerId: string,
  input: {
    id: Exclude<ImageLayerBlendPortabilityCheckId, 'flattened-alpha'>;
    label: string;
    requested: boolean;
    reasonCode: ImageLayerBlendReadinessWarningCode;
    caveat?: string;
    value?: number;
    channels?: ImageLayerBlendReadinessChannel[];
    mode?: ImageLayerBlendReadinessKnockoutMode;
  },
): ImageLayerBlendPortabilityCheck {
  const check: ImageLayerBlendPortabilityCheck = {
    id: input.id,
    label: input.label,
    supported: false,
    requested: input.requested,
    status: input.requested ? 'unsupported' : 'ready',
    ...(input.requested ? { reasonCode: input.reasonCode } : {}),
    ...(typeof input.value === 'number' ? { value: input.value } : {}),
    ...(input.channels ? { channels: [...input.channels] } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.caveat ? { caveat: input.caveat } : {}),
    signature: '',
  };
  return {
    ...check,
    signature: buildImageLayerBlendPortabilityCheckSignature(layerId, check),
  };
}

function buildImageLayerBlendPortabilityCheckSignature(
  layerId: string,
  check: ImageLayerBlendPortabilityCheck,
): string {
  const payload: Record<string, unknown> = {
    layerId,
    id: check.id,
    status: check.status,
    requested: check.requested,
  };
  if (typeof check.value === 'number') payload.value = check.value;
  if (check.channels) payload.channels = check.channels;
  if (check.mode) payload.mode = check.mode;
  return `image-layer-blend-check:v1:${JSON.stringify(payload)}`;
}

function normalizeBlendReadinessRatio(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function dedupeImageLayerBlendChannels(
  channels: readonly ImageLayerBlendReadinessChannel[],
): ImageLayerBlendReadinessChannel[] {
  return Array.from(new Set(channels)).sort((left, right) => left.localeCompare(right));
}

export type ImageSmartSourceLinkedLayerWarningCode =
  | 'missing-source-link'
  | 'missing-source-id'
  | 'missing-source-asset'
  | 'relink-required'
  | 'repair-required'
  | 'metadata-only-psd-smart-object'
  | 'metadata-only-smart-filters'
  | 'smart-filter-mask-unsupported';

export interface ImageSmartSourceLinkedLayerWarning {
  code: ImageSmartSourceLinkedLayerWarningCode;
  message: string;
}

export interface ImageSmartSourceLinkedLayerStatusSummary {
  state: ImageSourceLinkMetadata['status'] | 'none';
  linked: boolean;
  missing: boolean;
  relinked: boolean;
  repairRequired: boolean;
  relinkReadiness: 'ready' | 'needs-source-id' | 'needs-source-asset';
  repairReadiness: 'not-needed' | 'ready' | 'blocked-missing-source-id';
}

export interface ImageSmartSourceLinkedLayerHistorySummary {
  relinkCount: number;
  lastRelinkAt?: number;
  lastSourceId?: string;
  entries: ImageSourceLinkMetadata['relinkHistory'];
}

export interface ImageSmartSourceLinkedLayerPreviewMetadata {
  previewId: string;
  layerBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceDimensions?: {
    width: number;
    height: number;
  };
  referenceSnapshot?: {
    snapshotId: string;
    name: string;
    createdAt: number;
    width: number;
    height: number;
    layerCount: number;
    activeLayerId: string | null;
    hasSelection: boolean;
    selectionVersion: number;
  };
}

export interface ImageSmartSourceLinkedLayerOperationStatus {
  status: 'ready' | 'metadata-only' | 'blocked';
  sourceId: string | null;
}

export interface ImageSmartSourceLinkedLayerOperationsDescriptor {
  editOriginal: ImageSmartSourceLinkedLayerOperationStatus & {
    preservesSourceSnapshot: boolean;
  };
  replaceContents: ImageSmartSourceLinkedLayerOperationStatus & {
    preservesTransform: boolean;
  };
  rasterize: {
    status: 'ready';
    preservesSourceLink: false;
  };
}

export interface ImageSmartSourceLinkedLayerSourceSnapshotPreservation {
  preserved: boolean;
  snapshotId?: string;
  layerCount: number;
  sourceIds: string[];
  missingSourceIds: string[];
}

export interface ImageSmartSourceLinkedLayerSourceSnapshotAvailability {
  available: boolean;
  snapshotId?: string;
  sourceId: string | null;
  sourcePresentInSnapshot: boolean;
  state: 'available' | 'missing-source-id' | 'missing-reference-snapshot' | 'source-not-in-snapshot';
  caveat?: string;
}

export interface ImageSmartSourceLinkedLayerExternalAssetPackaging {
  required: boolean;
  caveats: string[];
}

export interface ImageSmartSourceLinkedLayerSuiteHandoffBlocker {
  code: ImageSmartSourceLinkedLayerWarningCode;
  target: 'suite';
  message: string;
}

export interface ImageSmartSourceLinkedLayerSmartFiltersDescriptor {
  filterCount: number;
  enabledFilterCount: number;
  editableStack: boolean;
  nativePsdSmartFilters: false;
  limitationWarnings: ImageSmartSourceLinkedLayerWarning[];
  previewSignature: string;
  exportSignature: string;
  stackSignatures: {
    order: string;
    blend: string;
    opacity: string;
  };
  handoffWarnings: string[];
}

export interface ImageSmartSourceLinkedLayerRoundtripSummary {
  canRoundtripMetadata: boolean;
  nativePsdSmartObject: false;
  metadataOnlyPsdSmartObject: boolean;
  sourceId: string | null;
  status: ImageSourceLinkMetadata['status'] | 'none';
  relinkCount: number;
  warningCodes: ImageSmartSourceLinkedLayerWarningCode[];
}

export interface ImageSmartSourceLinkedLayerPsdSmartObjectDescriptor {
  nativePsdSmartObject: false;
  metadataOnly: true;
  flattenedPixels: true;
}

export interface ImageSmartSourceLinkedLayerAutomationSuitability {
  suitable: boolean;
  operation: 'replace-contents' | 'relink-repair' | 'edit-original' | 'batch-replace-contents';
  warningCodes: ImageSmartSourceLinkedLayerWarningCode[];
  caveats: string[];
}

export interface ImageSmartSourceLinkedLayerMetadataDescriptor {
  descriptorId: 'image-smart-source-linked-layer:v1';
  layerId: string;
  layerName: string;
  sourceId: string | null;
  label: string;
  status: ImageSmartSourceLinkedLayerStatusSummary;
  history: ImageSmartSourceLinkedLayerHistorySummary;
  operations: ImageSmartSourceLinkedLayerOperationsDescriptor;
  preview: ImageSmartSourceLinkedLayerPreviewMetadata;
  sourceSnapshotPreservation: ImageSmartSourceLinkedLayerSourceSnapshotPreservation;
  sourceSnapshotAvailability: ImageSmartSourceLinkedLayerSourceSnapshotAvailability;
  externalAssetPackaging: ImageSmartSourceLinkedLayerExternalAssetPackaging;
  suiteHandoffBlockers: ImageSmartSourceLinkedLayerSuiteHandoffBlocker[];
  smartFilters: ImageSmartSourceLinkedLayerSmartFiltersDescriptor;
  psdSmartObject?: ImageSmartSourceLinkedLayerPsdSmartObjectDescriptor;
  sourceLinkRoundtrip: ImageSmartSourceLinkedLayerRoundtripSummary;
  actionSuitability: {
    replaceContents: ImageSmartSourceLinkedLayerAutomationSuitability;
    relinkRepair: ImageSmartSourceLinkedLayerAutomationSuitability;
    editOriginal: ImageSmartSourceLinkedLayerAutomationSuitability;
  };
  batchSuitability: ImageSmartSourceLinkedLayerAutomationSuitability;
  warnings: ImageSmartSourceLinkedLayerWarning[];
  previewSignature: string;
}

export interface ImageSmartSourceLinkedLayerMetadataOptions {
  doc?: ImageDocument;
  sourceExists?: boolean;
  includePsdSmartObjectWarning?: boolean;
  referenceSnapshotId?: string;
}

export type ImageLayerSuiteHandoffTarget = 'flow' | 'video' | 'paper';
export type ImageLayerSuiteHandoffWarningCode =
  | 'blob-only-source-asset'
  | 'external-asset-packaging-required'
  | 'metadata-only-psd-smart-object';
export type ImageLayerSuiteHandoffBlockerCode = 'missing-source-id' | 'missing-source-asset';

export interface ImageLayerSuiteHandoffSourceAsset {
  id: string;
  label?: string;
  kind: string;
  mimeType?: string;
  assetId?: string;
  assetUrl?: string;
  scratchFileName?: string;
  nativeFilePath?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  sourceKey?: string;
  originNodeId?: string;
  isGenerated?: boolean;
}

export interface ImageLayerSuiteHandoffOptions {
  sourceAssets?: readonly ImageLayerSuiteHandoffSourceAsset[];
  includePsdSmartObjectWarning?: boolean;
}

export interface ImageLayerSuiteHandoffWarning {
  code: ImageLayerSuiteHandoffWarningCode;
  sourceId?: string;
  message: string;
}

export interface ImageLayerSuiteHandoffBlocker {
  code: ImageLayerSuiteHandoffBlockerCode;
  target: 'suite';
  layerId?: string;
  sourceId?: string;
  message: string;
}

export interface ImageLayerSuiteHandoffVisibleExportSummary {
  format: 'flattened-visible-raster';
  layerIds: string[];
  hiddenLayerIds: string[];
  maskLayerIds: string[];
  hasMasks: boolean;
  maskExport: {
    supported: true;
    format: 'alpha-masked-visible-raster';
    caveats: string[];
  };
}

export interface ImageLayerSuiteHandoffSourceAssetPackaging {
  required: boolean;
  requiredSourceIds: string[];
  packagedSourceIds: string[];
  missingSourceIds: string[];
  blobOnlySourceIds: string[];
  caveats: string[];
  warnings: ImageLayerSuiteHandoffWarning[];
}

export interface ImageLayerSuiteHandoffGeneratedSummary {
  count: number;
  sourceIds: string[];
  originNodeIds: string[];
}

export interface ImageLayerSuiteHandoffReferenceSummary {
  count: number;
  sourceIds: string[];
}

export interface ImageLayerSuiteHandoffSourceLinkedSummary {
  count: number;
  layerIds: string[];
  sourceIds: string[];
  missingSourceIds: string[];
}

export interface ImageLayerSuiteHandoffTargetReadiness {
  target: ImageLayerSuiteHandoffTarget;
  status: 'ready' | 'warning' | 'blocked';
  sendAction: 'send-to-flow-source-library' | 'send-to-video-source-library' | 'send-to-paper-source-library';
  sourceIds: string[];
  blockers: ImageLayerSuiteHandoffBlockerCode[];
  warnings: ImageLayerSuiteHandoffWarningCode[];
  caveats: string[];
}

export interface ImageLayerSuiteHandoffBlendReadinessSummary {
  layerId: string;
  blendMode: BlendMode;
  previewSignature: string;
  exportSignature: string;
  warningCodes: ImageLayerBlendReadinessWarningCode[];
}

export interface ImageLayerSuiteHandoffReadinessDescriptor {
  descriptorId: 'image-layer-suite-handoff-readiness:v1';
  documentId: string;
  documentTitle: string;
  visibleExport: ImageLayerSuiteHandoffVisibleExportSummary;
  sourceAssetPackaging: ImageLayerSuiteHandoffSourceAssetPackaging;
  generatedSummary: ImageLayerSuiteHandoffGeneratedSummary;
  referenceSummary: ImageLayerSuiteHandoffReferenceSummary;
  sourceLinkedSummary: ImageLayerSuiteHandoffSourceLinkedSummary;
  missingSourceIdBlockers: ImageLayerSuiteHandoffBlocker[];
  targets: Record<ImageLayerSuiteHandoffTarget, ImageLayerSuiteHandoffTargetReadiness>;
  blendReadiness: ImageLayerSuiteHandoffBlendReadinessSummary[];
  previewSignature: string;
}

export function describeImageSmartSourceLinkedLayerMetadata(
  layer: ImageLayer,
  options: ImageSmartSourceLinkedLayerMetadataOptions = {},
): ImageSmartSourceLinkedLayerMetadataDescriptor {
  const sourceLink = layer.metadata?.sourceLink;
  const sourceId = sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? null;
  const label = sourceLink?.label ?? layer.metadata?.sourceLabel ?? layer.name;
  const state = sourceLink?.status ?? (sourceId ? 'linked' : 'none');
  const sourceExists = options.sourceExists ?? (state !== 'missing' && Boolean(sourceId));
  const sourceWidth = sourceLink?.width;
  const sourceHeight = sourceLink?.height;
  const hasSourceDimensions = isFinitePositiveSize(sourceWidth, sourceHeight);
  const sourceDimensions = hasSourceDimensions
    ? { width: Math.floor(sourceWidth as number), height: Math.floor(sourceHeight as number) }
    : undefined;
  const historyEntries = normalizeRelinkHistory(sourceLink?.relinkHistory ?? []);
  const lastHistoryEntry = historyEntries[historyEntries.length - 1];
  const warnings = buildSmartSourceLinkedLayerWarnings({
    layer,
    sourceId,
    sourceExists,
    state,
    includePsdSmartObjectWarning: options.includePsdSmartObjectWarning,
  });
  const referenceSnapshot = options.doc?.snapshots?.find((snapshot) => snapshot.id === options.referenceSnapshotId);
  const filterSignature = buildSmartFilterPreviewSignature(layer);
  const sourceSnapshotPreservation = describeSourceSnapshotPreservation(referenceSnapshot, sourceId);
  const smartFilters = describeSmartFilterLimitations(layer);
  const sourceSnapshotAvailability = describeSourceSnapshotAvailability(
    referenceSnapshot,
    sourceId,
    sourceSnapshotPreservation,
  );
  const externalAssetPackaging = describeSmartSourceLinkedLayerExternalAssetPackaging(
    Boolean(options.includePsdSmartObjectWarning),
    smartFilters,
  );
  const suiteHandoffBlockers = describeSmartSourceLinkedLayerSuiteHandoffBlockers({
    sourceId,
    warnings,
    smartFilters,
  });
  const relinkReadiness = !sourceId ? 'needs-source-id' : sourceExists ? 'ready' : 'needs-source-asset';
  const repairReadiness = state !== 'missing' && sourceExists
    ? 'not-needed'
    : sourceId
      ? 'ready'
      : 'blocked-missing-source-id';
  const actionSuitability = describeSmartSourceLinkedLayerActionSuitability({
    sourceId,
    sourceExists,
    warnings,
    smartFilters,
  });

  return {
    descriptorId: 'image-smart-source-linked-layer:v1',
    layerId: layer.id,
    layerName: layer.name,
    sourceId,
    label,
    status: {
      state,
      linked: state === 'linked',
      missing: state === 'missing',
      relinked: state === 'relinked',
      repairRequired: state === 'missing' || !sourceExists,
      relinkReadiness,
      repairReadiness,
    },
    history: {
      relinkCount: historyEntries.length,
      ...(typeof lastHistoryEntry?.at === 'number' ? { lastRelinkAt: lastHistoryEntry.at } : {}),
      ...(lastHistoryEntry?.sourceId ? { lastSourceId: lastHistoryEntry.sourceId } : {}),
      entries: historyEntries,
    },
    operations: {
      editOriginal: {
        status: sourceId ? 'metadata-only' : 'blocked',
        sourceId,
        preservesSourceSnapshot: sourceSnapshotPreservation.preserved,
      },
      replaceContents: {
        status: sourceId && sourceExists ? 'ready' : 'blocked',
        sourceId,
        preservesTransform: true,
      },
      rasterize: {
        status: 'ready',
        preservesSourceLink: false,
      },
    },
    preview: {
      previewId: `smart-source-preview:${layer.id}:${sourceId ?? 'none'}:${referenceSnapshot?.id ?? 'live'}`,
      layerBounds: {
        x: Math.floor(layer.x),
        y: Math.floor(layer.y),
        width: Math.max(0, Math.floor(layer.bitmap?.width ?? sourceWidth ?? 0)),
        height: Math.max(0, Math.floor(layer.bitmap?.height ?? sourceHeight ?? 0)),
      },
      ...(sourceDimensions ? { sourceDimensions } : {}),
      ...(referenceSnapshot
        ? {
            referenceSnapshot: {
              snapshotId: referenceSnapshot.id,
              name: referenceSnapshot.name,
              createdAt: referenceSnapshot.createdAt,
              width: referenceSnapshot.width,
              height: referenceSnapshot.height,
              layerCount: referenceSnapshot.layers.length,
              activeLayerId: referenceSnapshot.activeLayerId,
              hasSelection: referenceSnapshot.hasSelection,
              selectionVersion: referenceSnapshot.selectionVersion,
            },
          }
        : {}),
    },
    sourceSnapshotPreservation,
    sourceSnapshotAvailability,
    externalAssetPackaging,
    suiteHandoffBlockers,
    smartFilters,
    ...(options.includePsdSmartObjectWarning
      ? {
          psdSmartObject: {
            nativePsdSmartObject: false,
            metadataOnly: true,
            flattenedPixels: true,
          },
        }
      : {}),
    sourceLinkRoundtrip: {
      canRoundtripMetadata: Boolean(layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLabel),
      nativePsdSmartObject: false,
      metadataOnlyPsdSmartObject: Boolean(options.includePsdSmartObjectWarning),
      sourceId,
      status: state,
      relinkCount: historyEntries.length,
      warningCodes: warnings.map((warning) => warning.code),
    },
    actionSuitability,
    batchSuitability: actionSuitability.batchReplaceContents,
    warnings,
    previewSignature: `image-smart-source-linked-layer:v1:${JSON.stringify({
      layerId: layer.id,
      sourceId,
      status: state,
      sourceExists,
      relinkHistory: historyEntries.map((entry) => ({
        at: entry.at,
        sourceId: entry.sourceId,
      })),
      snapshotId: referenceSnapshot?.id ?? null,
      ...(layer.filters?.length ? { filterSignature } : {}),
      warnings: warnings.map((warning) => warning.code),
      batchSuitable: actionSuitability.batchReplaceContents.suitable,
    })}`,
  };
}

export function describeImageLayerSuiteHandoffReadiness(
  doc: ImageDocument,
  options: ImageLayerSuiteHandoffOptions = {},
): ImageLayerSuiteHandoffReadinessDescriptor {
  const sourceAssets = sortSuiteHandoffAssets(options.sourceAssets ?? []);
  const sourceAssetById = new Map(sourceAssets.map((asset) => [asset.id, asset]));
  const sourceLinkedLayers = getSuiteHandoffSourceLinkedLayers(doc.layers);
  const visibleLayers = sortLayersById(doc.layers.filter((layer) => layer.visible));
  const hiddenLayerIds = sortStrings(doc.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const maskLayerIds = sortStrings(visibleLayers.filter((layer) => Boolean(layer.mask)).map((layer) => layer.id));
  const requiredSourceIds = sortStrings(sourceLinkedLayers.flatMap((layer) => {
    const sourceId = getSuiteHandoffLayerSourceId(layer);
    return sourceId ? [sourceId] : [];
  }));
  const missingSourceIds = requiredSourceIds.filter((sourceId) => !sourceAssetById.has(sourceId));
  const packagedSourceIds = requiredSourceIds.filter((sourceId) => {
    const asset = sourceAssetById.get(sourceId);
    return Boolean(asset && hasSuiteHandoffDurableAsset(asset));
  });
  const blobOnlySourceIds = requiredSourceIds.filter((sourceId) => {
    const asset = sourceAssetById.get(sourceId);
    return Boolean(asset && isSuiteHandoffBlobOnlyAsset(asset));
  });
  const missingSourceIdBlockers = sourceLinkedLayers.flatMap((layer): ImageLayerSuiteHandoffBlocker[] => {
    if (getSuiteHandoffLayerSourceId(layer)) return [];
    return [{
      code: 'missing-source-id',
      target: 'suite',
      layerId: layer.id,
      message: `Layer "${layer.name}" needs a durable Source Library id before Send to Flow, Video, or Paper.`,
    }];
  });
  const missingAssetBlockers = missingSourceIds.map((sourceId): ImageLayerSuiteHandoffBlocker => ({
    code: 'missing-source-asset',
    target: 'suite',
    sourceId,
    message: `Source Library asset "${sourceId}" must be packaged before Send to Flow, Video, or Paper.`,
  }));
  const blockers = [...missingSourceIdBlockers, ...missingAssetBlockers];
  const packagingWarnings = buildSuiteHandoffPackagingWarnings({
    blobOnlySourceIds,
    requiredSourceIds,
    includePsdSmartObjectWarning: Boolean(options.includePsdSmartObjectWarning),
  });
  const warningCodes = sortStrings(packagingWarnings.map((warning) => warning.code)) as ImageLayerSuiteHandoffWarningCode[];
  const blockerCodes = sortStrings(blockers.map((blocker) => blocker.code)) as ImageLayerSuiteHandoffBlockerCode[];
  const targetSourceIds = requiredSourceIds;
  const targets = describeSuiteHandoffTargets(targetSourceIds, blockerCodes, warningCodes);
  const blendReadiness = visibleLayers.map((layer) => {
    const descriptor = describeImageLayerBlendModeReadiness(layer, { exportTarget: 'flattened' });
    return {
      layerId: layer.id,
      blendMode: descriptor.blendMode,
      previewSignature: descriptor.previewSignature,
      exportSignature: descriptor.exportSignature,
      warningCodes: descriptor.warningCodes,
    };
  });

  return {
    descriptorId: 'image-layer-suite-handoff-readiness:v1',
    documentId: doc.id,
    documentTitle: doc.title,
    visibleExport: {
      format: 'flattened-visible-raster',
      layerIds: visibleLayers.map((layer) => layer.id),
      hiddenLayerIds,
      maskLayerIds,
      hasMasks: maskLayerIds.length > 0,
      maskExport: {
        supported: true,
        format: 'alpha-masked-visible-raster',
        caveats: maskLayerIds.length > 0
          ? ['Layer masks are flattened into exported visible pixels; editable masks stay in Sloom Studio metadata.']
          : [],
      },
    },
    sourceAssetPackaging: {
      required: requiredSourceIds.length > 0,
      requiredSourceIds,
      packagedSourceIds,
      missingSourceIds,
      blobOnlySourceIds,
      caveats: buildSuiteHandoffPackagingCaveats(packagingWarnings),
      warnings: packagingWarnings,
    },
    generatedSummary: describeSuiteHandoffGeneratedSources(sourceAssets, requiredSourceIds),
    referenceSummary: describeSuiteHandoffReferenceSources(sourceAssets, requiredSourceIds),
    sourceLinkedSummary: {
      count: sourceLinkedLayers.length,
      layerIds: sortStrings(sourceLinkedLayers.map((layer) => layer.id)),
      sourceIds: requiredSourceIds,
      missingSourceIds: sortStrings(sourceLinkedLayers.flatMap((layer) => (
        getSuiteHandoffLayerSourceId(layer) ? [] : [layer.id]
      ))),
    },
    missingSourceIdBlockers,
    targets,
    blendReadiness,
    previewSignature: `image-layer-suite-handoff-readiness:v1:${JSON.stringify({
      documentId: doc.id,
      visibleLayerIds: visibleLayers.map((layer) => layer.id),
      maskLayerIds,
      sourceIds: requiredSourceIds,
      missingSourceIds: sortStrings(sourceLinkedLayers.flatMap((layer) => (
        getSuiteHandoffLayerSourceId(layer) ? [] : [layer.id]
      ))),
      blobOnlySourceIds,
      targetStatuses: {
        flow: targets.flow.status,
        video: targets.video.status,
        paper: targets.paper.status,
      },
      blendSignatures: blendReadiness.map((readiness) => readiness.previewSignature),
    })}`,
  };
}

export function getImageLayerWorkflowBadges(
  layer: ImageLayer,
  layers?: readonly ImageLayer[],
): ImageLayerWorkflowBadge[] {
  const badges: ImageLayerWorkflowBadge[] = [];
  const organization = layers ? describeImageLayerOrganization(layer, layers) : null;

  if (layer.metadata?.tiltmark?.role === 'surface') {
    badges.push({
      id: 'tiltmark-physical-surface',
      label: 'TM',
      description: `Editable Tiltmark ${layer.metadata.tiltmark.surface?.name ?? 'physical'} surface; convert explicitly to bake its simulation into raster pixels.`,
    });
  }
  if (layer.metadata?.tiltmark?.role === 'group') {
    badges.push({
      id: 'tiltmark-surface-group',
      label: 'TM',
      description: 'Tiltmark smart-layer group.',
    });
  }
  if (layer.type === 'text' || layer.metadata?.editableText) {
    badges.push({
      id: 'editable-text',
      label: 'TXT',
      description: 'Text content and style can be edited from the selected layer controls.',
    });
  }
  if (layer.metadata?.smartLinkedSourceId) {
    badges.push({
      id: 'smart-linked-source',
      label: 'SRC',
      description: `Can update from Source Bin asset${layer.metadata.sourceLabel ? `: ${layer.metadata.sourceLabel}` : ''}.`,
    });
  }
  if (!organization) return badges;

  if (organization.source.linked && !badges.some((badge) => badge.id === 'smart-linked-source')) {
    badges.push({
      id: 'smart-linked-source',
      label: 'SRC',
      description: `Can update from Source Bin asset${organization.source.label ? `: ${organization.source.label}` : ''}.`,
    });
  }
  if (organization.colorLabel.applied) {
    badges.push({
      id: `color-label-${organization.colorLabel.id}`,
      label: organization.colorLabel.label.toUpperCase(),
      description: `Color label: ${organization.colorLabel.label}.`,
    });
  }
  if (organization.locks.full) {
    badges.push({
      id: 'lock-full',
      label: 'LOCK',
      description: 'Layer is fully locked.',
    });
  }
  if (organization.locks.pixels) {
    badges.push({
      id: 'lock-pixels',
      label: 'PX',
      description: 'Pixel edits are locked for this layer.',
    });
  }
  if (organization.locks.position) {
    badges.push({
      id: 'lock-position',
      label: 'POS',
      description: 'Position changes are locked for this layer.',
    });
  }
  if (organization.link.linked) {
    badges.push({
      id: 'linked-layer-group',
      label: 'LINK',
      description: `Linked movement group ${organization.link.groupId} includes ${organization.link.memberCount} layer(s).`,
    });
  }
  if (organization.group.isGroup) {
    badges.push({
      id: 'layer-group-folder',
      label: 'GRP',
      description: `Folder contains ${organization.group.childLayerIds.length} direct layer(s).`,
    });
  } else if (organization.group.groupId) {
    badges.push({
      id: 'layer-group-child',
      label: 'GRP',
      description: `Inside folder ${organization.group.groupName ?? organization.group.groupId}.`,
    });
  }
  return badges;
}

function sortSuiteHandoffAssets(
  assets: readonly ImageLayerSuiteHandoffSourceAsset[],
): ImageLayerSuiteHandoffSourceAsset[] {
  return [...assets].sort((left, right) => left.id.localeCompare(right.id));
}

function sortLayersById(layers: readonly ImageLayer[]): ImageLayer[] {
  return [...layers].sort((left, right) => left.id.localeCompare(right.id));
}

function sortStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function getSuiteHandoffSourceLinkedLayers(layers: readonly ImageLayer[]): ImageLayer[] {
  return sortLayersById(layers.filter((layer) => Boolean(
    layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLabel,
  )));
}

function getSuiteHandoffLayerSourceId(layer: ImageLayer): string | null {
  return layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? null;
}

function hasSuiteHandoffDurableAsset(asset: ImageLayerSuiteHandoffSourceAsset): boolean {
  return Boolean(asset.assetId || asset.nativeFilePath || asset.scratchFileName);
}

function isSuiteHandoffBlobOnlyAsset(asset: ImageLayerSuiteHandoffSourceAsset): boolean {
  return Boolean(asset.assetUrl?.startsWith('blob:') && !hasSuiteHandoffDurableAsset(asset));
}

function buildSuiteHandoffPackagingWarnings({
  blobOnlySourceIds,
  requiredSourceIds,
  includePsdSmartObjectWarning,
}: {
  blobOnlySourceIds: readonly string[];
  requiredSourceIds: readonly string[];
  includePsdSmartObjectWarning: boolean;
}): ImageLayerSuiteHandoffWarning[] {
  const warnings: ImageLayerSuiteHandoffWarning[] = [];
  if (blobOnlySourceIds.length > 0) {
    warnings.push({
      code: 'blob-only-source-asset',
      sourceId: blobOnlySourceIds[0],
      message: 'One or more Source Library assets only have blob preview URLs and need durable packaging before external suite handoff.',
    });
  }
  if (requiredSourceIds.length > 0) {
    warnings.push({
      code: 'external-asset-packaging-required',
      message: 'Package Source Library originals beside the flattened visible export for Flow, Video, and Paper handoff.',
    });
  }
  if (includePsdSmartObjectWarning) {
    warnings.push({
      code: 'metadata-only-psd-smart-object',
      message: 'PSD Smart Object data is metadata-only; suite handoff receives flattened pixels plus Source Library references.',
    });
  }
  return warnings.sort((left, right) => left.code.localeCompare(right.code));
}

function buildSuiteHandoffPackagingCaveats(
  warnings: readonly ImageLayerSuiteHandoffWarning[],
): string[] {
  return warnings.map((warning) => warning.message);
}

function describeSuiteHandoffGeneratedSources(
  assets: readonly ImageLayerSuiteHandoffSourceAsset[],
  requiredSourceIds: readonly string[],
): ImageLayerSuiteHandoffGeneratedSummary {
  const required = new Set(requiredSourceIds);
  const generatedAssets = assets.filter((asset) => required.has(asset.id) && asset.isGenerated);
  return {
    count: generatedAssets.length,
    sourceIds: sortStrings(generatedAssets.map((asset) => asset.id)),
    originNodeIds: sortStrings(generatedAssets.flatMap((asset) => (asset.originNodeId ? [asset.originNodeId] : []))),
  };
}

function describeSuiteHandoffReferenceSources(
  assets: readonly ImageLayerSuiteHandoffSourceAsset[],
  requiredSourceIds: readonly string[],
): ImageLayerSuiteHandoffReferenceSummary {
  const required = new Set(requiredSourceIds);
  const referenceAssets = assets.filter((asset) => required.has(asset.id) && !asset.isGenerated);
  return {
    count: referenceAssets.length,
    sourceIds: sortStrings(referenceAssets.map((asset) => asset.id)),
  };
}

function describeSuiteHandoffTargets(
  sourceIds: readonly string[],
  blockers: readonly ImageLayerSuiteHandoffBlockerCode[],
  warnings: readonly ImageLayerSuiteHandoffWarningCode[],
): Record<ImageLayerSuiteHandoffTarget, ImageLayerSuiteHandoffTargetReadiness> {
  return {
    flow: describeSuiteHandoffTarget('flow', sourceIds, blockers, warnings),
    video: describeSuiteHandoffTarget('video', sourceIds, blockers, warnings),
    paper: describeSuiteHandoffTarget('paper', sourceIds, blockers, warnings),
  };
}

function describeSuiteHandoffTarget(
  target: ImageLayerSuiteHandoffTarget,
  sourceIds: readonly string[],
  blockers: readonly ImageLayerSuiteHandoffBlockerCode[],
  warnings: readonly ImageLayerSuiteHandoffWarningCode[],
): ImageLayerSuiteHandoffTargetReadiness {
  const sendActionByTarget = {
    flow: 'send-to-flow-source-library',
    video: 'send-to-video-source-library',
    paper: 'send-to-paper-source-library',
  } as const satisfies Record<ImageLayerSuiteHandoffTarget, ImageLayerSuiteHandoffTargetReadiness['sendAction']>;
  return {
    target,
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready',
    sendAction: sendActionByTarget[target],
    sourceIds: [...sourceIds],
    blockers: [...blockers],
    warnings: [...warnings],
    caveats: target === 'video'
      ? ['Video handoff receives flattened visible pixels plus packaged sources; editable layer filter and effect stacks remain metadata-only.']
      : [`${target === 'flow' ? 'Flow' : 'Paper'} handoff packages Source Library assets beside the flattened visible export when available.`],
  };
}

function normalizeRelinkHistory(
  history: ImageSourceLinkMetadata['relinkHistory'],
): ImageSourceLinkMetadata['relinkHistory'] {
  return [...history].sort((left, right) => {
    const atDelta = left.at - right.at;
    if (atDelta !== 0) return atDelta;
    const sourceDelta = left.sourceId.localeCompare(right.sourceId);
    if (sourceDelta !== 0) return sourceDelta;
    return (left.label ?? '').localeCompare(right.label ?? '');
  });
}

function buildSmartSourceLinkedLayerWarnings({
  layer,
  sourceId,
  sourceExists,
  state,
  includePsdSmartObjectWarning,
}: {
  layer: ImageLayer;
  sourceId: string | null;
  sourceExists: boolean;
  state: ImageSmartSourceLinkedLayerStatusSummary['state'];
  includePsdSmartObjectWarning?: boolean;
}): ImageSmartSourceLinkedLayerWarning[] {
  const warnings: ImageSmartSourceLinkedLayerWarning[] = [];
  const hasSourceMetadata = Boolean(layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLabel);

  if (!hasSourceMetadata) {
    warnings.push({
      code: 'missing-source-link',
      message: `Layer "${layer.name}" has no source-link metadata.`,
    });
  }
  if (!sourceId) {
    warnings.push({
      code: 'missing-source-id',
      message: `Layer "${layer.name}" has no durable Source Library id for relink or repair.`,
    });
  }
  if (sourceId && !sourceExists) {
    warnings.push({
      code: 'missing-source-asset',
      message: `Source Library asset "${sourceId}" is not currently available.`,
    });
  }
  if (state === 'relinked') {
    warnings.push({
      code: 'relink-required',
      message: `Layer "${layer.name}" was relinked; verify the source dimensions and preview before export.`,
    });
  }
  if (state === 'missing' || !sourceExists) {
    warnings.push({
      code: 'repair-required',
      message: `Layer "${layer.name}" needs a source relink or repair before source-aware edits are reliable.`,
    });
  }
  if (includePsdSmartObjectWarning) {
    warnings.push({
      code: 'metadata-only-psd-smart-object',
      message: 'PSD export keeps source-link planning metadata but writes flattened pixels instead of native Smart Object data.',
    });
  }

  return warnings;
}

function isFinitePositiveSize(width: number | undefined, height: number | undefined): width is number {
  return Number.isFinite(width) && Number.isFinite(height) && Boolean(width && height);
}

function describeSourceSnapshotPreservation(
  snapshot: NonNullable<ImageDocument['snapshots']>[number] | undefined,
  sourceId: string | null,
): ImageSmartSourceLinkedLayerSourceSnapshotPreservation {
  if (!snapshot) {
    return {
      preserved: false,
      layerCount: 0,
      sourceIds: [],
      missingSourceIds: sourceId ? [sourceId] : [],
    };
  }

  const sourceIds = dedupeAndSortStrings(snapshot.layers.flatMap((layer) => {
    const id = layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId;
    return id ? [id] : [];
  }));

  return {
    preserved: true,
    snapshotId: snapshot.id,
    layerCount: snapshot.layers.length,
    sourceIds,
    missingSourceIds: sourceId && !sourceIds.includes(sourceId) ? [sourceId] : [],
  };
}

function describeSourceSnapshotAvailability(
  snapshot: NonNullable<ImageDocument['snapshots']>[number] | undefined,
  sourceId: string | null,
  preservation: ImageSmartSourceLinkedLayerSourceSnapshotPreservation,
): ImageSmartSourceLinkedLayerSourceSnapshotAvailability {
  const sourcePresentInSnapshot = Boolean(sourceId && preservation.sourceIds.includes(sourceId));
  const available = Boolean(snapshot && sourcePresentInSnapshot);
  const state: ImageSmartSourceLinkedLayerSourceSnapshotAvailability['state'] = available
    ? 'available'
    : !sourceId
      ? 'missing-source-id'
      : !snapshot
        ? 'missing-reference-snapshot'
        : 'source-not-in-snapshot';

  return {
    available,
    ...(snapshot ? { snapshotId: snapshot.id } : {}),
    sourceId,
    sourcePresentInSnapshot,
    state,
    ...(!available
      ? {
          caveat: !sourceId
            ? 'Source snapshot availability requires durable source-link metadata.'
            : !snapshot
              ? 'No reference snapshot was selected for source-linked before/after review.'
              : `Reference snapshot "${snapshot.id}" does not contain source "${sourceId}".`,
        }
      : {}),
  };
}

function describeSmartSourceLinkedLayerExternalAssetPackaging(
  includePsdSmartObjectWarning: boolean,
  smartFilters: ImageSmartSourceLinkedLayerSmartFiltersDescriptor,
): ImageSmartSourceLinkedLayerExternalAssetPackaging {
  const caveats: string[] = [];
  if (includePsdSmartObjectWarning) {
    caveats.push(
      'PSD Smart Object export is metadata-only; package the original Source Library asset beside flattened pixels for suite handoff.',
    );
  }
  if (smartFilters.filterCount > 0) {
    caveats.push(
      'Smart Filter stacks are flattened for native PSD handoff; keep Sloom Studio metadata with the packaged source asset.',
    );
  }
  return {
    required: caveats.length > 0,
    caveats,
  };
}

function describeSmartSourceLinkedLayerSuiteHandoffBlockers({
  sourceId,
  warnings,
  smartFilters,
}: {
  sourceId: string | null;
  warnings: ImageSmartSourceLinkedLayerWarning[];
  smartFilters: ImageSmartSourceLinkedLayerSmartFiltersDescriptor;
}): ImageSmartSourceLinkedLayerSuiteHandoffBlocker[] {
  const blockers: ImageSmartSourceLinkedLayerSuiteHandoffBlocker[] = [];
  for (const warning of warnings) {
    if (warning.code === 'missing-source-asset') {
      blockers.push({
        code: warning.code,
        target: 'suite',
        message: sourceId
          ? `Source Library asset "${sourceId}" is unavailable for Flow, Video, or Paper handoff.`
          : 'Source Library asset is unavailable for Flow, Video, or Paper handoff.',
      });
    }
    if (warning.code === 'missing-source-id') {
      blockers.push({
        code: warning.code,
        target: 'suite',
        message: 'Layer needs a durable Source Library id before Flow, Video, or Paper handoff.',
      });
    }
    if (warning.code === 'metadata-only-psd-smart-object') {
      blockers.push({
        code: warning.code,
        target: 'suite',
        message: 'Native PSD Smart Object data is not packaged; only metadata and flattened pixels are available.',
      });
    }
  }
  for (const warning of smartFilters.limitationWarnings) {
    blockers.push({
      code: warning.code,
      target: 'suite',
      message: warning.message,
    });
  }
  return blockers;
}

function describeSmartFilterLimitations(layer: ImageLayer): ImageSmartSourceLinkedLayerSmartFiltersDescriptor {
  const filters = layer.filters ?? [];
  const hasLocalFilterMask = filters.some((filter) => filter.mask != null);
  const interop = describeLayerFilterStackInterop(filters, {
    sourceBounds: {
      x: 0,
      y: 0,
      width: Math.max(0, Math.floor(layer.bitmap?.width ?? 0)),
      height: Math.max(0, Math.floor(layer.bitmap?.height ?? 0)),
    },
    smartFilterMask: hasLocalFilterMask ? 'local' : 'absent',
    exportTarget: 'flattened',
  });
  const limitationWarnings = filters.length > 0
    ? [
        {
          code: 'metadata-only-smart-filters' as const,
          message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
        },
        ...(hasLocalFilterMask ? [{
          code: 'smart-filter-mask-unsupported' as const,
          message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
        }] : []),
      ]
    : [];

  return {
    filterCount: filters.length,
    enabledFilterCount: filters.filter((filter) => filter.enabled).length,
    editableStack: filters.length > 0,
    nativePsdSmartFilters: false,
    limitationWarnings,
    previewSignature: buildSmartFilterPreviewSignature(layer),
    exportSignature: interop.exportSignature,
    stackSignatures: interop.stackSignatures,
    handoffWarnings: filters.length > 0
      ? [
          'Source Bin and Video handoff preserve flattened pixels plus Sloom Studio metadata only; editable native smart-filter roundtrip is unavailable.',
          ...(hasLocalFilterMask ? [
            'Per-filter alpha masks stay editable in Sloom Studio and bake into flattened handoff pixels; native PSD Smart Filter masks are not written.',
          ] : []),
        ]
      : [],
  };
}

function describeSmartSourceLinkedLayerActionSuitability({
  sourceId,
  sourceExists,
  warnings,
  smartFilters,
}: {
  sourceId: string | null;
  sourceExists: boolean;
  warnings: ImageSmartSourceLinkedLayerWarning[];
  smartFilters: ImageSmartSourceLinkedLayerSmartFiltersDescriptor;
}): ImageSmartSourceLinkedLayerMetadataDescriptor['actionSuitability'] & {
  batchReplaceContents: ImageSmartSourceLinkedLayerAutomationSuitability;
} {
  const warningCodes = warnings.map((warning) => warning.code);
  const blockingWarningCodes = warningCodes.filter((code) => (
    code === 'missing-source-link'
      || code === 'missing-source-id'
      || code === 'missing-source-asset'
      || code === 'repair-required'
  ));
  const replaceReady = Boolean(sourceId && sourceExists && blockingWarningCodes.length === 0);
  const smartFilterCaveats = smartFilters.limitationWarnings.map((warning) => warning.message);
  const replaceContents: ImageSmartSourceLinkedLayerAutomationSuitability = {
    suitable: replaceReady,
    operation: 'replace-contents',
    warningCodes: blockingWarningCodes,
    caveats: replaceReady
      ? [
          'Replace Contents can preserve transform, mask, layer effects, and source-link metadata.',
          ...smartFilterCaveats,
        ]
      : ['Replace Contents is blocked until the layer has an available Source Library image asset.'],
  };
  const relinkRepair: ImageSmartSourceLinkedLayerAutomationSuitability = {
    suitable: Boolean(sourceId),
    operation: 'relink-repair',
    warningCodes: warningCodes.filter((code) => code === 'missing-source-id' || code === 'missing-source-link'),
    caveats: sourceId
      ? ['Relink repair can update metadata once the replacement Source Library asset is selected.']
      : ['Relink repair needs durable source-link metadata before it can be automated.'],
  };
  const editOriginal: ImageSmartSourceLinkedLayerAutomationSuitability = {
    suitable: false,
    operation: 'edit-original',
    warningCodes: warningCodes.filter((code) => code === 'missing-source-id' || code === 'missing-source-link'),
    caveats: ['Edit Original is metadata-only; Sloom Studio does not launch or round-trip native external editors.'],
  };
  const batchReplaceContents: ImageSmartSourceLinkedLayerAutomationSuitability = {
    suitable: replaceReady,
    operation: 'batch-replace-contents',
    warningCodes: blockingWarningCodes,
    caveats: replaceReady
      ? [
          'Batch actions are suitable for deterministic source-linked bitmap replacement when each layer resolves to a durable Source Library asset.',
          ...smartFilterCaveats,
        ]
      : ['Batch actions are blocked by missing source-link metadata or unavailable Source Library assets.'],
  };

  return {
    replaceContents,
    relinkRepair,
    editOriginal,
    batchReplaceContents,
  };
}

function buildSmartFilterPreviewSignature(layer: ImageLayer): string {
  return `image-smart-filter-stack:v1:${JSON.stringify((layer.filters ?? []).map((filter) => ({
    id: filter.id,
    kind: filter.kind,
    enabled: filter.enabled,
    amount: filter.amount,
    opacity: filter.opacity ?? 1,
    blendMode: filter.blendMode ?? 'normal',
    ...(filter.mask ? { mask: buildSmartFilterMaskSignature(filter.mask) } : {}),
  })))}`;
}

function buildSmartFilterMaskSignature(mask: ImageLayerFilterMask): string {
  const width = Number.isFinite(mask.width) ? Math.max(0, Math.floor(mask.width)) : 0;
  const height = Number.isFinite(mask.height) ? Math.max(0, Math.floor(mask.height)) : 0;
  const pixelCount = width * height;
  if (
    width < 1
    || height < 1
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > MAX_SMART_FILTER_MASK_SIGNATURE_CELLS
    || mask.alpha.length < pixelCount
  ) {
    return `layer-filter-mask:v1:invalid:${width}x${height}:${mask.alpha.length}`;
  }

  let hash = 2166136261;
  for (let index = 0; index < pixelCount; index += 1) {
    const value = mask.alpha[index];
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 255;
    hash = Math.imul(hash ^ normalized, 16777619) >>> 0;
  }
  return `layer-filter-mask:v1:${width}x${height}:${pixelCount}:${hash.toString(16).padStart(8, '0')}`;
}

function dedupeAndSortStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
