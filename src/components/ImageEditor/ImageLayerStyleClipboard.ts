import type { ImageLayer, ImageLayerEffect, ImageLayerFilter } from '../../types/imageEditor';
import {
  describeImageBlendModePortabilityReadiness,
  getImageBlendModeCapability,
  type ImageBlendModeChannelTarget,
  type ImageBlendModeKnockoutMode,
  type ImageBlendModePortabilityReadinessDescriptor,
  type ImageBlendModePortabilityReasonCode,
} from './CompositeRenderer';
import {
  describeLayerEffectUnsupportedStateDescriptors,
  describeLayerEffectStackInterop,
  type LayerEffectUnsupportedStateDescriptor,
  type LayerEffectStackInteropOptions,
  type PhotoshopLayerEffectKind,
} from './ImageLayerEffects';
import {
  describeLayerFilterStackInterop,
  type LayerFilterParameterType,
} from './ImageLayerFilters';

export interface ImageLayerStyleClipboard {
  opacity: number;
  blendMode: ImageLayer['blendMode'];
  effects: ImageLayerEffect[];
  filters: ImageLayerFilter[];
  metadata?: ImageLayerStyleClipboardMetadata;
}

export interface ImageLayerStyleClipboardMetadata {
  blendMode?: ImageLayerStyleBlendModeMetadata;
}

export interface ImageLayerStyleBlendModeMetadata {
  mode: ImageLayer['blendMode'];
  label: string;
  previewSupported: boolean;
  exportSupported: boolean;
  previewCompositeOperation: GlobalCompositeOperation;
  exportCompositeOperation: GlobalCompositeOperation;
  warnings: string[];
}

export interface ImageLayerStylePreset {
  id: string;
  label: string;
  style: ImageLayerStyleClipboard;
}

export interface ImageLayerStylePortabilityOptions {
  unsupportedEffectKinds?: readonly PhotoshopLayerEffectKind[];
  blendIf?: 'absent' | 'present';
  smartFilterMask?: 'absent' | 'present';
  filterParameterTypes?: readonly LayerFilterParameterType[];
  exportTarget?: 'editable' | 'flattened';
}

export interface ImageLayerStylePreviewExportParity {
  previewId: 'image-layer-style-preview-export:v1';
  previewSignature: string;
  exportSignature: string;
  parity: 'editable' | 'rasterized-export' | 'unsupported';
}

export interface ImageLayerStylePresetPortabilityDescriptor {
  id: 'image-layer-style-preset-portability:v1';
  portable: boolean;
  portableAcrossDocuments: boolean;
  opacity: number;
  effectPreviewId: string;
  filterPreviewId: 'image-layer-filters-stack:v1';
  effectPresetPortability: ReturnType<typeof describeLayerEffectStackInterop>['presetPortability'];
  warnings: string[];
}

export type ImageLayerStylePortabilityCheckId =
  | 'blend-mode'
  | 'effects'
  | 'global-light'
  | 'filters';

export type ImageLayerStylePortabilityCheckReasonCode =
  | 'effect-flattened-export'
  | 'effect-unsupported-metadata'
  | 'blend-if-unsupported'
  | 'global-light-native-style-roundtrip-unavailable'
  | 'filter-flattened-export'
  | 'smart-filter-mask-unsupported'
  | 'filter-parameter-unsupported';

export interface ImageLayerStylePortabilityCheck {
  id: ImageLayerStylePortabilityCheckId;
  label: string;
  status: 'ready' | 'warning' | 'blocked';
  reasonCodes: ImageLayerStylePortabilityCheckReasonCode[];
  warnings: string[];
  signature: string;
}

export interface ImageLayerStylePortabilityDescriptor {
  previewId: 'image-layer-style-portability:v2';
  portable: boolean;
  styleSignature: string;
  blendMode: ImageLayerStyleBlendModeMetadata;
  previewExportParity: ImageLayerStylePreviewExportParity;
  effectGlobalLightPortability: ReturnType<typeof describeLayerEffectStackInterop>['globalLightPortability'];
  effectPerEffectExportCaveats: ReturnType<typeof describeLayerEffectStackInterop>['perEffectExportCaveats'];
  presetPortability: ImageLayerStylePresetPortabilityDescriptor;
  stylePortabilityChecks: ImageLayerStylePortabilityCheck[];
  warnings: string[];
}

export type ImageLayerStyleClipboardExportTarget = 'editable' | 'flattened' | 'source-bin';
export type ImageLayerStyleClipboardSourceBinCaveatCode =
  | 'source-bin-visible-export-flattens-blend-stack'
  | 'source-bin-overwrite-needs-linked-source';

export interface ImageLayerStyleClipboardReadinessOptions {
  unsupportedEffectKinds?: readonly PhotoshopLayerEffectKind[];
  blendIf?: 'absent' | 'present';
  fillOpacity?: number;
  knockout?: Exclude<ImageBlendModeKnockoutMode, 'none'>;
  channelTargeting?: readonly ImageBlendModeChannelTarget[];
  smartFilterMask?: 'absent' | 'present';
  filterParameterTypes?: readonly LayerFilterParameterType[];
  exportTarget?: ImageLayerStyleClipboardExportTarget;
  sourceBinLinked?: boolean;
  batchLayerCount?: number;
}

export interface ImageLayerStyleSignatureSetOptions extends ImageLayerStyleClipboardReadinessOptions {
  presetId?: string;
}

export interface ImageLayerStyleSignatureSetDescriptor {
  id: 'image-layer-style-signatures:v1';
  layerId: string;
  styleSetSignature: string;
  clipboardSignature: string;
  presetSignature: string;
  previewRiskSignature: string;
  exportRiskSignature: string;
  unsupportedStateSignature: string;
  riskLevel: 'ready' | 'warning' | 'blocked';
  unsupportedStates: LayerEffectUnsupportedStateDescriptor[];
}

export interface ImageLayerStyleClipboardPortability {
  canCopyPasteWithinDocument: boolean;
  canSaveAsSignalLoomPreset: boolean;
  canRoundTripAsEditablePhotoshopStyle: false;
  reasonCodes: ImageLayerStyleClipboardReasonCode[];
}

export type ImageLayerStyleClipboardReasonCode =
  | 'blend-if-unsupported'
  | 'fill-opacity-unsupported'
  | 'knockout-unsupported'
  | 'channel-targeting-unsupported'
  | 'effect-portability-warning'
  | 'filter-portability-warning';

export interface ImageLayerStyleClipboardSourceBinParityCaveat {
  code: ImageLayerStyleClipboardSourceBinCaveatCode;
  target: ImageLayerStyleClipboardExportTarget;
  warning: string;
}

export interface ImageLayerStyleClipboardReadinessDescriptor {
  id: 'image-layer-style-clipboard-readiness:v1';
  layerId: string;
  layerName: string;
  clipboardPortability: ImageLayerStyleClipboardPortability;
  blendModeReadiness: ImageBlendModePortabilityReadinessDescriptor;
  exportSourceBinParityCaveats: ImageLayerStyleClipboardSourceBinParityCaveat[];
  actionSuitability: ImageBlendModePortabilityReadinessDescriptor['actionSuitability'];
  batchSuitability: ImageBlendModePortabilityReadinessDescriptor['batchSuitability'];
  clipboardSuitability: ImageLayerStyleClipboardSuitabilitySummary;
  stylePortabilityChecks: ImageLayerStylePortabilityCheck[];
  signature: string;
  warnings: string[];
}

export interface ImageLayerStyleClipboardSuitabilityItem {
  status: 'ready' | 'warning' | 'blocked';
  summary: string;
  reasonCodes: string[];
}

export interface ImageLayerStyleClipboardSuitabilitySummary {
  copyPaste: ImageLayerStyleClipboardSuitabilityItem;
  signalLoomPreset: ImageLayerStyleClipboardSuitabilityItem;
  batchApplication: ImageLayerStyleClipboardSuitabilityItem;
}

const IMAGE_LAYER_STYLE_PORTABILITY_PREVIEW_ID = 'image-layer-style-portability:v2' as const;
const IMAGE_LAYER_STYLE_PREVIEW_EXPORT_ID = 'image-layer-style-preview-export:v1' as const;
const IMAGE_LAYER_STYLE_PRESET_PORTABILITY_ID = 'image-layer-style-preset-portability:v1' as const;
const IMAGE_LAYER_FILTER_STACK_PREVIEW_ID = 'image-layer-filters-stack:v1' as const;

export function copyImageLayerStyle(layer: ImageLayer): ImageLayerStyleClipboard {
  return {
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    effects: cloneLayerStyleArray(layer.effects ?? []),
    filters: cloneLayerStyleArray(layer.filters ?? []),
    metadata: {
      blendMode: createBlendModeMetadata(layer.blendMode),
    },
  };
}

export function createImageLayerStylePreset(
  label: string,
  layer: ImageLayer,
  existingIds: Iterable<string> = [],
): ImageLayerStylePreset {
  const normalizedLabel = normalizePresetLabel(label);
  return {
    id: buildUniqueLayerStylePresetId(normalizedLabel, existingIds),
    label: normalizedLabel,
    style: copyImageLayerStyle(layer),
  };
}

export function applyImageLayerStylePreset(
  layer: ImageLayer,
  preset: ImageLayerStylePreset,
): ImageLayer {
  return pasteImageLayerStyle(layer, preset.style);
}

export function describeImageLayerStylePortability(
  layer: ImageLayer,
  options: ImageLayerStylePortabilityOptions = {},
): ImageLayerStylePortabilityDescriptor {
  const exportTarget = options.exportTarget ?? 'editable';
  const effectOptions: LayerEffectStackInteropOptions = {
    unsupportedEffectKinds: options.unsupportedEffectKinds,
    blendIf: options.blendIf,
    exportTarget,
  };
  const effectInterop = describeLayerEffectStackInterop(layer.effects ?? [], effectOptions);
  const filterInterop = describeLayerFilterStackInterop(layer.filters ?? [], {
    smartFilterMask: options.smartFilterMask,
    parameterTypes: options.filterParameterTypes,
    exportTarget,
  });
  const blendMode = createBlendModeMetadata(layer.blendMode);
  const warnings = [
    ...blendMode.warnings,
    ...effectInterop.warnings,
    ...filterInterop.rasterizationWarnings,
    ...filterInterop.caveats,
  ];
  const normalizedOpacity = normalizeOpacity(layer.opacity);
  const stylePortabilityChecks = describeStylePortabilityChecks({
    blendMode,
    effectInterop,
    filterInterop,
  });
  const previewSignature = [
    effectInterop.previewSignature,
    filterInterop.previewSignature,
    `blend-mode-preview:v1:${blendMode.mode}`,
  ].join('|');
  const exportSignature = [
    effectInterop.exportSignature,
    filterInterop.exportSignature,
    `blend-mode-export:v1:${blendMode.mode}`,
  ].join('|');

  return {
    previewId: IMAGE_LAYER_STYLE_PORTABILITY_PREVIEW_ID,
    portable: warnings.length === 0,
    styleSignature: `image-layer-style-portability:v1:${JSON.stringify({
      previewId: IMAGE_LAYER_STYLE_PORTABILITY_PREVIEW_ID,
      blendMode: layer.blendMode,
      opacity: normalizedOpacity,
      effects: effectInterop.exportSignature,
      filters: filterInterop.exportSignature,
    })}`,
    blendMode,
    previewExportParity: {
      previewId: IMAGE_LAYER_STYLE_PREVIEW_EXPORT_ID,
      previewSignature,
      exportSignature,
      parity: warnings.length > 0 && exportTarget === 'flattened' ? 'rasterized-export' : warnings.length > 0 ? 'unsupported' : 'editable',
    },
    effectGlobalLightPortability: effectInterop.globalLightPortability,
    effectPerEffectExportCaveats: effectInterop.perEffectExportCaveats,
    presetPortability: {
      id: IMAGE_LAYER_STYLE_PRESET_PORTABILITY_ID,
      portable: warnings.length === 0,
      portableAcrossDocuments: warnings.length === 0,
      opacity: normalizedOpacity,
      effectPreviewId: effectInterop.previewId,
      filterPreviewId: IMAGE_LAYER_FILTER_STACK_PREVIEW_ID,
      effectPresetPortability: effectInterop.presetPortability,
      warnings: [...warnings],
    },
    stylePortabilityChecks,
    warnings,
  };
}

export function describeImageLayerStyleClipboardReadiness(
  layer: ImageLayer,
  options: ImageLayerStyleClipboardReadinessOptions = {},
): ImageLayerStyleClipboardReadinessDescriptor {
  const stylePortability = describeImageLayerStylePortability(layer, {
    unsupportedEffectKinds: options.unsupportedEffectKinds,
    blendIf: options.blendIf,
    smartFilterMask: options.smartFilterMask,
    filterParameterTypes: options.filterParameterTypes,
    exportTarget: options.exportTarget === 'source-bin' ? 'flattened' : options.exportTarget,
  });
  const blendModeReadiness = describeImageBlendModePortabilityReadiness({
    activeModes: [layer.blendMode],
    blendIf: options.blendIf === 'present',
    fillOpacity: options.fillOpacity,
    knockout: options.knockout,
    channelTargeting: options.channelTargeting,
    exportTarget: options.exportTarget,
    sourceBinLinked: options.sourceBinLinked,
    batchLayerCount: options.batchLayerCount,
  });
  const clipboardReasonCodes = describeStyleClipboardReasonCodes(stylePortability, blendModeReadiness);
  const exportSourceBinParityCaveats = blendModeReadiness.exportSourceBinParityCaveats.map((caveat) => ({
    code: caveat.code === 'source-bin-overwrite-requires-linked-source'
      ? 'source-bin-overwrite-needs-linked-source' as const
      : caveat.code,
    target: caveat.target,
    warning: caveat.warning,
  }));
  const warnings = [
    ...stylePortability.warnings,
    ...blendModeReadiness.warnings,
  ];
  const clipboardSuitability = describeClipboardSuitabilitySummary(
    clipboardReasonCodes,
    stylePortability,
    blendModeReadiness,
  );

  return {
    id: 'image-layer-style-clipboard-readiness:v1',
    layerId: layer.id,
    layerName: layer.name,
    clipboardPortability: {
      canCopyPasteWithinDocument: true,
      canSaveAsSignalLoomPreset: clipboardReasonCodes.length === 0,
      canRoundTripAsEditablePhotoshopStyle: false,
      reasonCodes: clipboardReasonCodes,
    },
    blendModeReadiness,
    exportSourceBinParityCaveats,
    actionSuitability: blendModeReadiness.actionSuitability,
    batchSuitability: blendModeReadiness.batchSuitability,
    clipboardSuitability,
    stylePortabilityChecks: stylePortability.stylePortabilityChecks,
    signature: `image-layer-style-clipboard-readiness:v1:${JSON.stringify({
      layerId: layer.id,
      blendMode: layer.blendMode,
      styleSignature: stylePortability.styleSignature,
      blendSignature: blendModeReadiness.signature,
      styleChecks: stylePortability.stylePortabilityChecks.map((check) => check.signature),
      exportTarget: options.exportTarget ?? 'editable',
    })}`,
    warnings,
  };
}

export function describeImageLayerStyleSignatureSet(
  layer: ImageLayer,
  options: ImageLayerStyleSignatureSetOptions = {},
): ImageLayerStyleSignatureSetDescriptor {
  const enabledEffects = (layer.effects ?? []).filter((effect) => effect.enabled);
  const enabledFilters = (layer.filters ?? []).filter((filter) => filter.enabled);
  const unsupportedStates = describeLayerEffectUnsupportedStateDescriptors({
    unsupportedEffectKinds: options.unsupportedEffectKinds,
    blendIf: options.blendIf,
    nativePsdLiveEffects: 'required',
    smartObjectEffectPreservation: 'required',
  });
  const readiness = describeImageLayerStyleClipboardReadiness(layer, options);
  const stylePayload = {
    layerId: layer.id,
    blendMode: layer.blendMode,
    opacity: normalizeOpacity(layer.opacity),
    effectKinds: enabledEffects.map((effect) => effect.kind),
    filterKinds: enabledFilters.map((filter) => filter.kind),
  };
  const riskPayload = {
    layerId: layer.id,
    blendMode: layer.blendMode,
    unsupportedStates: unsupportedStates.map((state) => state.id),
    clipboardReasons: readiness.clipboardPortability.reasonCodes,
    styleChecks: readiness.stylePortabilityChecks.map((check) => ({
      id: check.id,
      status: check.status,
      reasonCodes: check.reasonCodes,
    })),
  };
  const exportTarget = options.exportTarget ?? 'editable';
  const blocked = unsupportedStates.length > 0 || readiness.clipboardPortability.reasonCodes.length > 0;
  const warning = readiness.batchSuitability.status === 'warning'
    || readiness.stylePortabilityChecks.some((check) => check.status === 'warning');

  return {
    id: 'image-layer-style-signatures:v1',
    layerId: layer.id,
    styleSetSignature: `image-layer-style-set:v1:${JSON.stringify(stylePayload)}`,
    clipboardSignature: `image-layer-style-clipboard:v1:${JSON.stringify({
      ...stylePayload,
      readinessSignature: readiness.signature,
    })}`,
    presetSignature: `image-layer-style-preset:v1:${JSON.stringify({
      presetId: options.presetId ?? 'unsaved',
      ...stylePayload,
      portable: readiness.clipboardPortability.canSaveAsSignalLoomPreset,
    })}`,
    previewRiskSignature: `image-layer-style-preview-risk:v1:${JSON.stringify(riskPayload)}`,
    exportRiskSignature: `image-layer-style-export-risk:v1:${JSON.stringify({
      ...riskPayload,
      target: exportTarget,
      sourceBinCaveats: readiness.exportSourceBinParityCaveats.map((caveat) => caveat.code),
      batchStatus: readiness.batchSuitability.status,
    })}`,
    unsupportedStateSignature: `image-layer-style-unsupported-states:v1:${unsupportedStates.map((state) => state.id).join('|') || 'none'}`,
    riskLevel: blocked ? 'blocked' : warning ? 'warning' : 'ready',
    unsupportedStates,
  };
}

export function pasteImageLayerStyle(
  layer: ImageLayer,
  clipboard: ImageLayerStyleClipboard,
): ImageLayer {
  return {
    ...layer,
    opacity: clipboard.opacity,
    blendMode: clipboard.blendMode,
    effects: cloneLayerStyleArray(clipboard.effects),
    filters: cloneLayerStyleArray(clipboard.filters),
  };
}

function cloneLayerStyleArray<T>(items: T[]): T[] {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(items)
    : JSON.parse(JSON.stringify(items)) as T[];
}

function createBlendModeMetadata(mode: ImageLayer['blendMode']): ImageLayerStyleBlendModeMetadata {
  const capability = getImageBlendModeCapability(mode);
  return {
    mode: capability.mode,
    label: capability.label,
    previewSupported: capability.preview.supported,
    exportSupported: capability.export.supported,
    previewCompositeOperation: capability.preview.compositeOperation,
    exportCompositeOperation: capability.export.compositeOperation,
    warnings: [...capability.warnings],
  };
}

function describeStylePortabilityChecks(input: {
  blendMode: ImageLayerStyleBlendModeMetadata;
  effectInterop: ReturnType<typeof describeLayerEffectStackInterop>;
  filterInterop: ReturnType<typeof describeLayerFilterStackInterop>;
}): ImageLayerStylePortabilityCheck[] {
  const effectReasonCodes: ImageLayerStylePortabilityCheckReasonCode[] = [];
  if (input.effectInterop.flattenedExport.rasterizesEffects) {
    effectReasonCodes.push('effect-flattened-export');
  }
  if (input.effectInterop.unsupportedEffects.length > 0) {
    effectReasonCodes.push('effect-unsupported-metadata');
  }
  if (input.effectInterop.unsupportedBlendIf.requiresFlatteningForParity) {
    effectReasonCodes.push('blend-if-unsupported');
  }
  const effectStatus: ImageLayerStylePortabilityCheck['status'] =
    input.effectInterop.unsupportedEffects.length > 0 || input.effectInterop.unsupportedBlendIf.requiresFlatteningForParity
      ? 'blocked'
      : input.effectInterop.flattenedExport.rasterizesEffects
        ? 'warning'
        : 'ready';

  const globalLightReasonCodes: ImageLayerStylePortabilityCheckReasonCode[] =
    input.effectInterop.globalLightPortability.usesGlobalLight
      ? ['global-light-native-style-roundtrip-unavailable']
      : [];
  const globalLightWarnings = input.effectInterop.globalLightPortability.usesGlobalLight
    ? ['Global light is preserved as Sloom Studio style metadata and presets, but not as editable native Photoshop layer-style data.']
    : [];

  const filterReasonCodes: ImageLayerStylePortabilityCheckReasonCode[] = [];
  if (input.filterInterop.exportFlattening.willRasterize) {
    filterReasonCodes.push('filter-flattened-export');
  }
  if (input.filterInterop.smartFilterMask.status === 'unsupported') {
    filterReasonCodes.push('smart-filter-mask-unsupported');
  }
  if (
    input.filterInterop.presetPortability.status === 'blocked'
    && input.filterInterop.smartFilterMask.status !== 'unsupported'
  ) {
    filterReasonCodes.push('filter-parameter-unsupported');
  }
  const filterStatus: ImageLayerStylePortabilityCheck['status'] =
    filterReasonCodes.some((code) => code === 'smart-filter-mask-unsupported' || code === 'filter-parameter-unsupported')
      ? 'blocked'
      : filterReasonCodes.length > 0
        ? 'warning'
        : 'ready';
  const filterWarnings = [
    ...input.filterInterop.rasterizationWarnings,
    ...(input.filterInterop.smartFilterMask.warning ? [input.filterInterop.smartFilterMask.warning] : []),
    ...input.filterInterop.presetPortability.warnings,
  ];

  return [
    buildStylePortabilityCheck({
      id: 'blend-mode',
      label: 'Blend mode',
      status: input.blendMode.warnings.length > 0 ? 'warning' : 'ready',
      reasonCodes: [],
      warnings: input.blendMode.warnings,
      signaturePayload: {
        mode: input.blendMode.mode,
        previewCompositeOperation: input.blendMode.previewCompositeOperation,
        exportCompositeOperation: input.blendMode.exportCompositeOperation,
      },
    }),
    buildStylePortabilityCheck({
      id: 'effects',
      label: 'Layer effects',
      status: effectStatus,
      reasonCodes: effectReasonCodes,
      warnings: input.effectInterop.warnings,
      signaturePayload: {
        previewId: input.effectInterop.previewId,
        effectKinds: input.effectInterop.effectKinds,
        perEffectExportCaveats: input.effectInterop.perEffectExportCaveats.map((caveat) => caveat.signature),
      },
    }),
    buildStylePortabilityCheck({
      id: 'global-light',
      label: 'Global light',
      status: globalLightReasonCodes.length > 0 ? 'warning' : 'ready',
      reasonCodes: globalLightReasonCodes,
      warnings: globalLightWarnings,
      signaturePayload: {
        usesGlobalLight: input.effectInterop.globalLightPortability.usesGlobalLight,
        angle: input.effectInterop.globalLightPortability.angle,
        participantEffectIds: input.effectInterop.globalLightPortability.participantEffectIds,
      },
    }),
    buildStylePortabilityCheck({
      id: 'filters',
      label: 'Layer filters',
      status: filterStatus,
      reasonCodes: filterReasonCodes,
      warnings: filterWarnings,
      signaturePayload: {
        filterPreviewSignature: input.filterInterop.previewSignature,
        smartFilterMask: input.filterInterop.smartFilterMask.status,
        exportFlattening: input.filterInterop.exportFlattening,
      },
    }),
  ];
}

function buildStylePortabilityCheck(input: {
  id: ImageLayerStylePortabilityCheckId;
  label: string;
  status: ImageLayerStylePortabilityCheck['status'];
  reasonCodes: ImageLayerStylePortabilityCheckReasonCode[];
  warnings: string[];
  signaturePayload: Record<string, unknown>;
}): ImageLayerStylePortabilityCheck {
  return {
    id: input.id,
    label: input.label,
    status: input.status,
    reasonCodes: [...input.reasonCodes],
    warnings: [...input.warnings],
    signature: `image-layer-style-check:v1:${JSON.stringify({
      id: input.id,
      status: input.status,
      reasonCodes: input.reasonCodes,
      ...input.signaturePayload,
    })}`,
  };
}

function describeStyleClipboardReasonCodes(
  stylePortability: ImageLayerStylePortabilityDescriptor,
  blendModeReadiness: ImageBlendModePortabilityReadinessDescriptor,
): ImageLayerStyleClipboardReasonCode[] {
  const reasonCodes: ImageLayerStyleClipboardReasonCode[] = [];
  for (const state of blendModeReadiness.unsupportedPhotoshopAdvancedStates) {
    if (!state.requested) continue;
    const reasonCode = mapBlendReasonCodeToClipboardReasonCode(state.reasonCode);
    if (reasonCode && !reasonCodes.includes(reasonCode)) {
      reasonCodes.push(reasonCode);
    }
  }
  if (stylePortability.stylePortabilityChecks.some((check) => (
    check.id === 'effects' && check.reasonCodes.includes('effect-unsupported-metadata')
  ))) {
    pushUniqueClipboardReason(reasonCodes, 'effect-portability-warning');
  }
  if (stylePortability.stylePortabilityChecks.some((check) => (
    check.id === 'filters'
    && (
      check.reasonCodes.includes('smart-filter-mask-unsupported')
      || check.reasonCodes.includes('filter-parameter-unsupported')
    )
  ))) {
    pushUniqueClipboardReason(reasonCodes, 'filter-portability-warning');
  }
  return reasonCodes;
}

function pushUniqueClipboardReason(
  reasonCodes: ImageLayerStyleClipboardReasonCode[],
  reasonCode: ImageLayerStyleClipboardReasonCode,
) {
  if (!reasonCodes.includes(reasonCode)) {
    reasonCodes.push(reasonCode);
  }
}

function mapBlendReasonCodeToClipboardReasonCode(
  reasonCode: ImageBlendModePortabilityReasonCode,
): ImageLayerStyleClipboardReasonCode | null {
  if (reasonCode === 'blend-if-unsupported') return 'blend-if-unsupported';
  if (reasonCode === 'fill-opacity-unsupported') return 'fill-opacity-unsupported';
  if (reasonCode === 'knockout-unsupported') return 'knockout-unsupported';
  if (reasonCode === 'channel-targeting-unsupported') return 'channel-targeting-unsupported';
  return null;
}

function describeClipboardSuitabilitySummary(
  clipboardReasonCodes: readonly ImageLayerStyleClipboardReasonCode[],
  stylePortability: ImageLayerStylePortabilityDescriptor,
  blendModeReadiness: ImageBlendModePortabilityReadinessDescriptor,
): ImageLayerStyleClipboardSuitabilitySummary {
  const copyPasteBlockedReasons = clipboardReasonCodes.filter((code) => code !== 'effect-portability-warning' && code !== 'filter-portability-warning');
  const copyPasteStatus: ImageLayerStyleClipboardSuitabilityItem['status'] = copyPasteBlockedReasons.length > 0
    ? 'warning'
    : 'ready';
  const presetReasons = clipboardReasonCodes.map((code) => code as string);
  const batchReasons = blendModeReadiness.batchSuitability.reasonCodes.map((code) => code as string);
  return {
    copyPaste: {
      status: copyPasteStatus,
      summary: copyPasteStatus === 'ready'
        ? 'Copy/paste keeps the layer style portable inside Sloom Studio.'
        : 'Copy/paste keeps the layer style inside Sloom Studio, but unsupported advanced blending stays metadata-only.',
      reasonCodes: [...copyPasteBlockedReasons],
    },
    signalLoomPreset: {
      status: stylePortability.presetPortability.portable && presetReasons.length === 0 ? 'ready' : 'blocked',
      summary: stylePortability.presetPortability.portable && presetReasons.length === 0
        ? 'Sloom Studio presets preserve this layer style without extra portability caveats.'
        : 'Sloom Studio presets cannot preserve unsupported advanced blending or non-portable style warnings.',
      reasonCodes: [...presetReasons],
    },
    batchApplication: {
      status: blendModeReadiness.batchSuitability.status,
      summary: blendModeReadiness.batchSuitability.status === 'ready'
        ? 'Batch application can reuse this layer style across the requested layer set.'
        : blendModeReadiness.batchSuitability.status === 'warning'
          ? 'Batch application is allowed, but export/handoff caveats remain for the requested layer set.'
          : 'Batch application is blocked by unsupported advanced blending and unlinked Source Bin export requirements.',
      reasonCodes: batchReasons,
    },
  };
}

function normalizePresetLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'Layer Style';
}

function normalizeOpacity(opacity: number): number {
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
}

function buildUniqueLayerStylePresetId(label: string, existingIds: Iterable<string>): string {
  const usedIds = new Set(existingIds);
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'layer-style';
  const base = `layer-style-${slug}`;
  if (!usedIds.has(base)) return base;
  let index = 2;
  while (usedIds.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}
