import type {
  AdjustmentLayerKind,
  ImageAdjustmentSettings,
  ImageDocument,
  ImageLayer,
  LayerBitmap,
} from '../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import { renderLayerWithEffects } from './ImageLayerEffects';
import {
  applyLayerMaskToImageData,
  createProcessedLayerMaskBitmap,
  getProcessedLayerMaskImageData,
} from './ImageLayerMask';
import {
  drawLayerBitmapTransformed,
  getImageLayerBitmapTransformedBounds,
} from './ImageLayerTransform';
import {
  getImageLayerGroupDescendantLayers,
  isImageLayerEffectivelyVisible,
  isImageLayerGroupPassThrough,
  normalizeImageLayerGroupTree,
  type ImageLayerGroupTreeNode,
} from './ImageLayerGroups';
import { getLayerVectorMaskDescriptor, rasterizeLayerVectorMask } from './ImageVectorMasks';
import { materializeImageLinkedMasks } from './ImageLinkedMasks';
import { blackWhiteLumaByte, tryApplyAdjustmentGpu } from './ImageAdjustmentGpuPreview';

const bitmapOrigins = new WeakMap<LayerBitmap, { x: number; y: number }>();

function setBitmapOrigin(bitmap: LayerBitmap, x: number, y: number): void {
  bitmapOrigins.set(bitmap, { x, y });
}

function getBitmapOrigin(bitmap: LayerBitmap | null): { x: number; y: number } {
  return bitmap ? bitmapOrigins.get(bitmap) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
}

let adjustmentLayerCounter = 0;

export function defaultAdjustmentSettings(kind: AdjustmentLayerKind): ImageAdjustmentSettings {
  switch (kind) {
    case 'brightnessContrast':
      return { kind, brightness: 0, contrast: 0 };
    case 'hueSaturation':
      return { kind, hue: 0, saturation: 0, lightness: 0 };
    case 'blackWhite':
      return { kind };
    case 'invert':
      return { kind };
    case 'exposure':
      return { kind, exposure: 0, offset: 0, gamma: 1 };
    case 'temperatureTint':
      return { kind, temperature: 0, tint: 0 };
    case 'levels':
      return { kind, channel: 'rgb', inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 };
    case 'curves':
      return { kind, channel: 'rgb', points: [{ input: 0, output: 0 }, { input: 255, output: 255 }], shadows: 0, midtones: 0, highlights: 0 };
    case 'lut':
      return { kind, channel: 'rgb' };
    case 'gradientMap':
      return { kind, stops: [
        { position: 0, color: [0, 0, 0] },
        { position: 1, color: [255, 255, 255] }
      ]};
    case 'channelMixer':
      return { kind, red: [100, 0, 0], green: [0, 100, 0], blue: [0, 0, 100], constant: [0, 0, 0] };
    case 'selectiveColor':
      return { kind, target: 'reds', cyan: 0, magenta: 0, yellow: 0, black: 0 };
  }
}

export function createAdjustmentLayer(
  doc: ImageDocument,
  kind: AdjustmentLayerKind = 'brightnessContrast',
  name?: string,
): ImageLayer {
  const id = createUniqueAdjustmentLayerId(doc);
  return {
    id,
    name: name ?? adjustmentLayerLabel(kind),
    type: 'adjustment',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    adjustment: defaultAdjustmentSettings(kind),
  };
}

function createUniqueAdjustmentLayerId(doc: ImageDocument): string {
  const existingIds = new Set(doc.layers.map((layer) => layer.id));
  let id: string;
  do {
    adjustmentLayerCounter += 1;
    id = `layer-adjustment-${Date.now()}-${adjustmentLayerCounter}`;
  } while (existingIds.has(id));
  return id;
}

export function adjustmentLayerLabel(kind: AdjustmentLayerKind): string {
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

export interface AdjustmentLayerPlanningBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AdjustmentLayerClippingFamily =
  | 'none'
  | 'layer-alpha'
  | 'blend-if'
  | 'vector-path'
  | (string & {});

export type AdjustmentLayerMaskFamily =
  | 'none'
  | 'raster-layer-mask'
  | 'vector-mask'
  | 'channel-mask'
  | (string & {});

export type AdjustmentLayerPresetFamily =
  | 'single-adjustment'
  | 'camera-raw'
  | 'lookup-table'
  | 'gradient-map'
  | (string & {});

export type AdjustmentLayerImportFamily =
  | 'signal-loom'
  | 'psd-native'
  | 'xcf-native'
  | 'flattened-raster'
  | (string & {});

export type AdjustmentLayerExportFamily =
  | 'signal-loom'
  | 'psd-native'
  | 'flattened-raster'
  | (string & {});

export type AdjustmentLayerWorkflowColorMode = 'rgb' | 'cmyk' | 'lab' | 'grayscale' | 'indexed';
export type AdjustmentLayerWorkflowBitDepth = 8 | 16 | 32;
export type AdjustmentLayerWorkflowSupportStatus = 'supported' | 'partial' | 'preview-only' | 'conversion-required' | 'unsupported';

export type AdjustmentLayerPlanningWarningCode =
  | 'unsupported-adjustment-clipping-family'
  | 'unsupported-adjustment-mask-family'
  | 'unsupported-adjustment-preset-family'
  | 'adjustment-import-flattened'
  | 'adjustment-export-flattened';

export interface AdjustmentLayerPlanningWarning {
  code: AdjustmentLayerPlanningWarningCode;
  severity: 'warning';
  message: string;
}

export type AdjustmentLayerReadinessBlockerCode =
  | 'adjustment-parameters-incomplete'
  | 'adjustment-histogram-source-unavailable'
  | 'adjustment-preset-serialization-unsupported'
  | 'adjustment-preset-import-unsupported'
  | 'adjustment-preset-export-unsupported';

export interface AdjustmentLayerReadinessBlocker {
  code: AdjustmentLayerReadinessBlockerCode;
  severity: 'blocker';
  message: string;
}

export interface AdjustmentLayerPlanningOptions {
  documentBounds?: AdjustmentLayerPlanningBounds;
  clippingFamily?: AdjustmentLayerClippingFamily;
  maskFamily?: AdjustmentLayerMaskFamily;
  presetFamily?: AdjustmentLayerPresetFamily;
  colorMode?: AdjustmentLayerWorkflowColorMode;
  bitDepth?: AdjustmentLayerWorkflowBitDepth;
  histogramPreview?: boolean;
  histogramSourceAvailable?: boolean;
  livePreview?: boolean;
  importFamily?: AdjustmentLayerImportFamily;
  exportFamily?: AdjustmentLayerExportFamily;
}

export interface AdjustmentLayerPlanDescriptor {
  version: 1;
  layerId: string;
  layerName: string;
  kind: AdjustmentLayerKind;
  label: string;
  settings: ImageAdjustmentSettings;
  scope: {
    opacity: number;
    blendMode: ImageLayer['blendMode'];
    clippingFamily: AdjustmentLayerClippingFamily;
    maskFamily: AdjustmentLayerMaskFamily;
    presetFamily: AdjustmentLayerPresetFamily;
  };
  affectedBounds: AdjustmentLayerPlanningBounds;
  workflow: AdjustmentLayerWorkflowDescriptor;
  preview: AdjustmentLayerPreviewDescriptor;
  previewSignature: string;
  planSignature: string;
  warnings: AdjustmentLayerPlanningWarning[];
}

export interface AdjustmentLayerPreset {
  version: 1;
  label: string;
  kind: AdjustmentLayerKind;
  settings: ImageAdjustmentSettings;
  previewSignature: string;
}

export interface AdjustmentWorkflowPresetDescriptor {
  version: 1;
  label: string;
  presetKinds: AdjustmentLayerKind[];
  presets: AdjustmentLayerPreset[];
  signature: string;
}

export interface AdjustmentLayerWorkflowPresetInput {
  label: string;
  settings: ImageAdjustmentSettings;
}

export interface AdjustmentLayerScopeStatusDescriptor {
  family: AdjustmentLayerClippingFamily | AdjustmentLayerMaskFamily;
  status: AdjustmentLayerWorkflowSupportStatus;
  notes: string[];
}

export interface AdjustmentLayerDocumentPrecisionDescriptor {
  colorMode: AdjustmentLayerWorkflowColorMode;
  bitDepth: AdjustmentLayerWorkflowBitDepth;
  status: AdjustmentLayerWorkflowSupportStatus;
  limitations: string[];
}

export interface AdjustmentLayerWorkflowDescriptor {
  presetSerialization: {
    supported: boolean;
    family: AdjustmentLayerPresetFamily;
    serializedKind: AdjustmentLayerKind;
  };
  clipping: AdjustmentLayerScopeStatusDescriptor;
  mask: AdjustmentLayerScopeStatusDescriptor;
  histogramPreview: {
    required: boolean;
    dependency: 'base-layers-before-adjustment' | 'not-required';
    supported: boolean;
  };
  livePreview: {
    requested: boolean;
    supported: boolean;
    caveats: string[];
  };
  documentPrecision: AdjustmentLayerDocumentPrecisionDescriptor;
}

export interface AdjustmentLayerPreviewDescriptor {
  id: string;
  label: string;
  signature: string;
  requiresHistogram: boolean;
  livePreviewCaveats: string[];
}

export interface AdjustmentLayerCoverageDescriptor {
  count: number;
  channels: Array<'rgb' | 'red' | 'green' | 'blue'>;
  histogramRequired: boolean;
}

export interface AdjustmentLayerMaskInteractionDescriptor {
  layerId: string;
  family: AdjustmentLayerMaskFamily;
  density: number;
  feather: number;
  summary: string;
}

export interface AdjustmentStackPlanDescriptor {
  version: 1;
  documentId: string;
  adjustmentLayerIds: string[];
  layers: AdjustmentLayerPlanDescriptor[];
  coverage: Partial<Record<AdjustmentLayerKind, AdjustmentLayerCoverageDescriptor>>;
  masks: AdjustmentLayerMaskInteractionDescriptor[];
  limitations: string[];
  warnings: AdjustmentLayerPlanningWarning[];
  previewSignature: string;
  planSignature: string;
}

export interface AdjustmentLayerParameterCompletenessDescriptor {
  complete: boolean;
  required: string[];
  missing: string[];
  normalizedSettings: ImageAdjustmentSettings;
}

export interface AdjustmentLayerHistogramReadinessDescriptor {
  required: boolean;
  dependency: 'base-layers-before-adjustment' | 'not-required';
  ready: boolean;
  reason: string;
}

export interface AdjustmentLayerPresetReadinessDescriptor {
  serialization: {
    family: AdjustmentLayerPresetFamily;
    ready: boolean;
    reason: string;
  };
  import: {
    family: AdjustmentLayerImportFamily;
    ready: boolean;
    status: AdjustmentLayerWorkflowSupportStatus;
    reason: string;
  };
  export: {
    family: AdjustmentLayerExportFamily;
    ready: boolean;
    status: AdjustmentLayerWorkflowSupportStatus;
    reason: string;
  };
}

export interface AdjustmentLayerReadinessDescriptor {
  version: 1;
  layerId: string;
  kind: AdjustmentLayerKind;
  label: string;
  parameterCompleteness: AdjustmentLayerParameterCompletenessDescriptor;
  histogram: AdjustmentLayerHistogramReadinessDescriptor;
  support: {
    clipping: AdjustmentLayerScopeStatusDescriptor;
    mask: AdjustmentLayerScopeStatusDescriptor;
  };
  preset: AdjustmentLayerPresetReadinessDescriptor;
  warnings: AdjustmentLayerPlanningWarning[];
  blockers: AdjustmentLayerReadinessBlocker[];
  unsupportedStates: string[];
  previewSignature: string;
  signature: string;
}

export type AdjustmentLayerUnsupportedStateCode =
  | 'true-high-bit-adjustment-pipeline-unsupported'
  | 'photoshop-preset-family-parity-unsupported'
  | 'cmyk-native-adjustment-unsupported'
  | 'lab-native-adjustment-unsupported'
  | 'native-psd-adjustment-fidelity-unsupported'
  | 'blend-if-adjustment-clipping-unsupported'
  | 'vector-mask-adjustment-scope-unsupported'
  | 'channel-mask-adjustment-scope-unsupported';

export interface AdjustmentLayerUnsupportedStateDescriptor {
  code: AdjustmentLayerUnsupportedStateCode;
  status: 'unsupported';
  message: string;
}

export interface AdjustmentLayerReadinessSummaryDescriptor {
  layerId: string;
  ready: boolean;
  blockerCodes: AdjustmentLayerReadinessBlockerCode[];
  warningCodes: AdjustmentLayerPlanningWarningCode[];
  parameterCompleteness: AdjustmentLayerParameterCompletenessDescriptor;
  previewId: string;
  previewSignature: string;
}

export interface AdjustmentPresetCompatibilityDescriptor {
  version: 1;
  label: string;
  sourceKind: AdjustmentLayerKind;
  targetKind: AdjustmentLayerKind;
  compatible: boolean;
  serialization: {
    family: AdjustmentLayerPresetFamily;
    supported: boolean;
    blockerCode: 'adjustment-preset-serialization-unsupported' | null;
  };
  import: {
    family: AdjustmentLayerImportFamily;
    supported: boolean;
    status: AdjustmentLayerWorkflowSupportStatus;
    blockerCode: 'adjustment-preset-import-unsupported' | null;
  };
  export: {
    family: AdjustmentLayerExportFamily;
    supported: boolean;
    status: AdjustmentLayerWorkflowSupportStatus;
    blockerCode: 'adjustment-preset-export-unsupported' | null;
  };
  kindMatch: boolean;
  unsupportedStateCodes: AdjustmentLayerUnsupportedStateCode[];
  signature: string;
}

export interface AdjustmentStackReadinessDescriptor {
  version: 1;
  documentId: string;
  stackSignature: string;
  stackPreviewSignature: string;
  stackPlanSignature: string;
  stablePreviewIds: string[];
  score: {
    readyLayerCount: number;
    totalLayerCount: number;
    blockerCount: number;
    warningCount: number;
    unsupportedStateCount: number;
    readinessRatio: number;
  };
  layerReadiness: AdjustmentLayerReadinessSummaryDescriptor[];
  unsupportedStates: AdjustmentLayerUnsupportedStateDescriptor[];
  presetCompatibility: AdjustmentPresetCompatibilityDescriptor;
  warnings: AdjustmentLayerPlanningWarning[];
}

const SUPPORTED_ADJUSTMENT_CLIPPING_FAMILIES = new Set<string>(['none', 'layer-alpha']);
const SUPPORTED_ADJUSTMENT_MASK_FAMILIES = new Set<string>(['none', 'raster-layer-mask']);
const SUPPORTED_ADJUSTMENT_PRESET_FAMILIES = new Set<string>(['single-adjustment']);

export function describeAdjustmentLayerPlan(
  layer: Pick<ImageLayer, 'id' | 'name' | 'opacity' | 'blendMode' | 'clippingMask' | 'mask' | 'adjustment'>,
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentLayerPlanDescriptor {
  const settings = normalizeAdjustmentSettingsForMetadata(layer.adjustment ?? defaultAdjustmentSettings('brightnessContrast'));
  const bounds = normalizeAdjustmentPlanningBounds(options.documentBounds);
  const clippingFamily = options.clippingFamily ?? (layer.clippingMask ? 'layer-alpha' : 'none');
  const maskFamily = options.maskFamily ?? (layer.mask ? 'raster-layer-mask' : 'none');
  const presetFamily = options.presetFamily ?? 'single-adjustment';
  const warnings = getUnsupportedAdjustmentLayerPlanningWarnings({
    clippingFamily,
    maskFamily,
    presetFamily,
  });
  const scope = {
    opacity: clamp01(layer.opacity ?? 1),
    blendMode: layer.blendMode ?? 'normal',
    clippingFamily,
    maskFamily,
    presetFamily,
  };
  const workflow = describeAdjustmentLayerWorkflow(settings, scope, options);
  const previewSignature = buildAdjustmentLayerPreviewSignature(layer.id, settings, scope, bounds);
  const preview = {
    id: `adjustment-preview:${layer.id}`,
    label: `${adjustmentLayerLabel(settings.kind)} preview`,
    signature: previewSignature,
    requiresHistogram: workflow.histogramPreview.required,
    livePreviewCaveats: workflow.livePreview.caveats,
  };
  const planSignature = buildAdjustmentLayerPlanSignature(layer.id, previewSignature, workflow, warnings);

  return {
    version: 1,
    layerId: layer.id,
    layerName: layer.name,
    kind: settings.kind,
    label: adjustmentLayerLabel(settings.kind),
    settings,
    scope,
    affectedBounds: bounds,
    workflow,
    preview,
    previewSignature,
    planSignature,
    warnings,
  };
}

export function serializeAdjustmentLayerPreset(
  label: string,
  adjustment: ImageAdjustmentSettings,
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentLayerPreset | null {
  const clippingFamily = options.clippingFamily ?? 'none';
  const maskFamily = options.maskFamily ?? 'none';
  const presetFamily = options.presetFamily ?? 'single-adjustment';
  const warnings = getUnsupportedAdjustmentLayerPlanningWarnings({
    clippingFamily,
    maskFamily,
    presetFamily,
  });
  if (warnings.length > 0) return null;

  const settings = normalizeAdjustmentSettingsForMetadata(adjustment);
  const bounds = normalizeAdjustmentPlanningBounds(options.documentBounds);
  return {
    version: 1,
    label: normalizeAdjustmentPresetLabel(label),
    kind: settings.kind,
    settings,
    previewSignature: buildAdjustmentPresetPreviewSignature(settings, bounds),
  };
}

export function buildAdjustmentWorkflowPresetDescriptor(
  label: string,
  inputs: AdjustmentLayerWorkflowPresetInput[],
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentWorkflowPresetDescriptor {
  const presets = inputs
    .map((input) => serializeAdjustmentLayerPreset(input.label, input.settings, options))
    .filter((preset): preset is AdjustmentLayerPreset => preset !== null);
  const normalizedLabel = normalizeAdjustmentPresetLabel(label);

  return {
    version: 1,
    label: normalizedLabel,
    presetKinds: presets.map((preset) => preset.kind),
    presets,
    signature: `adjustment-workflow-preset:v1:${JSON.stringify({
      label: normalizedLabel,
      presetSignatures: presets.map((preset) => preset.previewSignature),
    })}`,
  };
}

export function buildAdjustmentStackPlanDescriptor(
  doc: ImageDocument,
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentStackPlanDescriptor {
  const bounds = normalizeAdjustmentPlanningBounds(options.documentBounds ?? {
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
  });
  const adjustmentLayers = doc.layers.filter((layer) => layer.type === 'adjustment' && layer.adjustment);
  const layers = adjustmentLayers.map((layer) => describeAdjustmentLayerPlan(layer, {
    ...options,
    documentBounds: bounds,
  }));
  const warnings = dedupeAdjustmentPlanningWarnings([
    ...layers.flatMap((layer) => layer.warnings),
    ...getAdjustmentPortabilityWarnings(options),
  ]);
  const coverage = buildAdjustmentCoverageDescriptor(layers);
  const masks = buildAdjustmentMaskInteractionDescriptors(adjustmentLayers);
  const limitations = buildAdjustmentStackLimitations(layers, options);
  const previewSignature = `adjustment-stack-preview:v1:${JSON.stringify({
    documentId: doc.id,
    bounds,
    layerPreviewSignatures: layers.map((layer) => layer.previewSignature),
  })}`;
  const planSignature = `adjustment-stack-plan:v1:${JSON.stringify({
    previewSignature,
    warningCodes: warnings.map((warning) => warning.code),
    coverageKinds: Object.keys(coverage),
  })}`;

  return {
    version: 1,
    documentId: doc.id,
    adjustmentLayerIds: layers.map((layer) => layer.layerId),
    layers,
    coverage,
    masks,
    limitations,
    warnings,
    previewSignature,
    planSignature,
  };
}

export function describeAdjustmentLayerReadiness(
  layer: Pick<ImageLayer, 'id' | 'name' | 'opacity' | 'blendMode' | 'clippingMask' | 'mask' | 'adjustment'>,
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentLayerReadinessDescriptor {
  const settings = layer.adjustment ?? defaultAdjustmentSettings('brightnessContrast');
  const plan = describeAdjustmentLayerPlan(layer, options);
  const parameterCompleteness = describeAdjustmentParameterCompleteness(settings);
  const histogram = describeAdjustmentHistogramReadiness(plan.workflow.histogramPreview, options);
  const preset = describeAdjustmentPresetReadiness(plan.scope.presetFamily, options);
  const unsupportedStates = buildAdjustmentUnsupportedStates({
    parameterCompleteness,
    histogram,
    plan,
    preset,
  });
  const warnings = dedupeAdjustmentPlanningWarnings([
    ...plan.warnings,
    ...getAdjustmentPortabilityWarnings(options),
  ]);
  const blockers = buildAdjustmentReadinessBlockers({
    parameterCompleteness,
    histogram,
    plan,
    preset,
  });
  const signature = `adjustment-readiness:v1:${JSON.stringify({
    layerId: plan.layerId,
    kind: plan.kind,
    complete: parameterCompleteness.complete,
    histogramReady: histogram.ready,
    unsupportedStates,
    blockerCodes: blockers.map((blocker) => blocker.code),
    warningCodes: warnings.map((warning) => warning.code),
    previewSignature: plan.previewSignature,
  })}`;

  return {
    version: 1,
    layerId: plan.layerId,
    kind: plan.kind,
    label: plan.label,
    parameterCompleteness,
    histogram,
    support: {
      clipping: plan.workflow.clipping,
      mask: plan.workflow.mask,
    },
    preset,
    warnings,
    blockers,
    unsupportedStates,
    previewSignature: plan.previewSignature,
    signature,
  };
}

export function validateAdjustmentPresetCompatibility(options: {
  label: string;
  settings: ImageAdjustmentSettings;
  presetFamily?: AdjustmentLayerPresetFamily;
  importFamily?: AdjustmentLayerImportFamily;
  exportFamily?: AdjustmentLayerExportFamily;
  targetKind?: AdjustmentLayerKind;
}): AdjustmentPresetCompatibilityDescriptor {
  const presetFamily = options.presetFamily ?? 'single-adjustment';
  const importFamily = options.importFamily ?? 'signal-loom';
  const exportFamily = options.exportFamily ?? 'signal-loom';
  const sourceKind = options.settings.kind;
  const targetKind = options.targetKind ?? sourceKind;
  const importReadiness = describeAdjustmentImportReadiness(importFamily);
  const exportReadiness = describeAdjustmentExportReadiness(exportFamily);
  const serializationSupported = SUPPORTED_ADJUSTMENT_PRESET_FAMILIES.has(presetFamily);
  const kindMatch = sourceKind === targetKind;
  const unsupportedStateCodes = buildAdjustmentUnsupportedStateDescriptors({
    presetFamily,
    importFamily,
    exportFamily,
  }).map((state) => state.code);
  const compatible = serializationSupported && importReadiness.ready && exportReadiness.ready && kindMatch;
  const label = normalizeAdjustmentPresetLabel(options.label);

  return {
    version: 1,
    label,
    sourceKind,
    targetKind,
    compatible,
    serialization: {
      family: presetFamily,
      supported: serializationSupported,
      blockerCode: serializationSupported ? null : 'adjustment-preset-serialization-unsupported',
    },
    import: {
      family: importFamily,
      supported: importReadiness.ready,
      status: importReadiness.status,
      blockerCode: importReadiness.ready ? null : 'adjustment-preset-import-unsupported',
    },
    export: {
      family: exportFamily,
      supported: exportReadiness.ready,
      status: exportReadiness.status,
      blockerCode: exportReadiness.ready ? null : 'adjustment-preset-export-unsupported',
    },
    kindMatch,
    unsupportedStateCodes,
    signature: `adjustment-preset-compatibility:v1:${JSON.stringify({
      label,
      sourceKind,
      targetKind,
      presetFamily,
      importFamily,
      exportFamily,
      compatible,
      unsupportedStateCodes,
    })}`,
  };
}

export function describeAdjustmentStackReadiness(
  doc: ImageDocument,
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentStackReadinessDescriptor {
  const plan = buildAdjustmentStackPlanDescriptor(doc, options);
  const readiness = plan.layers.map((layerPlan) => {
    const layer = doc.layers.find((candidate) => candidate.id === layerPlan.layerId) ?? {
      id: layerPlan.layerId,
      name: layerPlan.layerName,
      opacity: layerPlan.scope.opacity,
      blendMode: layerPlan.scope.blendMode,
      clippingMask: layerPlan.scope.clippingFamily === 'layer-alpha',
      mask: null,
      adjustment: layerPlan.settings,
    };
    return describeAdjustmentLayerReadiness(layer, options);
  });
  const layerReadiness: AdjustmentLayerReadinessSummaryDescriptor[] = readiness.map((descriptor) => ({
    layerId: descriptor.layerId,
    ready: descriptor.blockers.length === 0 && descriptor.warnings.length === 0,
    blockerCodes: descriptor.blockers.map((blocker) => blocker.code),
    warningCodes: descriptor.warnings.map((warning) => warning.code),
    parameterCompleteness: descriptor.parameterCompleteness,
    previewId: `adjustment-preview:${descriptor.layerId}`,
    previewSignature: descriptor.previewSignature,
  }));
  const unsupportedStates = buildAdjustmentUnsupportedStateDescriptors(options);
  const readyLayerCount = layerReadiness.filter((layer) => layer.ready).length;
  const totalLayerCount = layerReadiness.length;
  const blockerCount = layerReadiness.reduce((total, layer) => total + layer.blockerCodes.length, 0);
  const presetCompatibility = validateAdjustmentPresetCompatibility({
    label: 'Adjustment Stack',
    settings: plan.layers[0]?.settings ?? defaultAdjustmentSettings('brightnessContrast'),
    presetFamily: options.presetFamily,
    importFamily: options.importFamily,
    exportFamily: options.exportFamily,
  });
  const unsupportedStateCodes = unsupportedStates.map((state) => state.code);
  const stablePreviewIds = layerReadiness.map((layer) => layer.previewId);
  const readinessRatio = totalLayerCount > 0 ? Math.round((readyLayerCount / totalLayerCount) * 1000) / 1000 : 1;
  const stackSignature = `adjustment-stack-readiness:v1:${JSON.stringify({
    documentId: doc.id,
    stackPreviewSignature: plan.previewSignature,
    stackPlanSignature: plan.planSignature,
    stablePreviewIds,
    readyLayerCount,
    totalLayerCount,
    blockerCount,
    warningCodes: plan.warnings.map((warning) => warning.code),
    unsupportedStateCodes,
    presetCompatibilitySignature: presetCompatibility.signature,
  })}`;

  return {
    version: 1,
    documentId: doc.id,
    stackSignature,
    stackPreviewSignature: plan.previewSignature,
    stackPlanSignature: plan.planSignature,
    stablePreviewIds,
    score: {
      readyLayerCount,
      totalLayerCount,
      blockerCount,
      warningCount: plan.warnings.length,
      unsupportedStateCount: unsupportedStates.length,
      readinessRatio,
    },
    layerReadiness,
    unsupportedStates,
    presetCompatibility,
    warnings: plan.warnings,
  };
}

export function applyAdjustmentPresetToLayer(
  layer: ImageLayer,
  preset: AdjustmentLayerPreset,
): ImageLayer {
  return {
    ...layer,
    type: 'adjustment',
    bitmap: null,
    adjustment: normalizeAdjustmentSettingsForMetadata(preset.settings),
  };
}

export function getUnsupportedAdjustmentLayerPlanningWarnings(
  options: AdjustmentLayerPlanningOptions = {},
): AdjustmentLayerPlanningWarning[] {
  const warnings: AdjustmentLayerPlanningWarning[] = [];
  const clippingFamily = options.clippingFamily ?? 'none';
  const maskFamily = options.maskFamily ?? 'none';
  const presetFamily = options.presetFamily ?? 'single-adjustment';

  if (!SUPPORTED_ADJUSTMENT_CLIPPING_FAMILIES.has(clippingFamily)) {
    warnings.push({
      code: 'unsupported-adjustment-clipping-family',
      severity: 'warning',
      message: `Adjustment layer ${clippingFamily} clipping is not supported yet; only normal lower-layer scope and layer-alpha clipping masks are represented.`,
    });
  }

  if (!SUPPORTED_ADJUSTMENT_MASK_FAMILIES.has(maskFamily)) {
    warnings.push({
      code: 'unsupported-adjustment-mask-family',
      severity: 'warning',
      message: `Adjustment layer ${maskFamily} masks are not supported yet; only raster layer masks with density/feather metadata are represented.`,
    });
  }

  if (!SUPPORTED_ADJUSTMENT_PRESET_FAMILIES.has(presetFamily)) {
    warnings.push({
      code: 'unsupported-adjustment-preset-family',
      severity: 'warning',
      message: `Adjustment preset family "${presetFamily}" is not supported yet; only single-adjustment Image presets can be serialized.`,
    });
  }

  return warnings;
}

function getAdjustmentPortabilityWarnings(
  options: AdjustmentLayerPlanningOptions,
): AdjustmentLayerPlanningWarning[] {
  const warnings: AdjustmentLayerPlanningWarning[] = [];
  if (options.importFamily === 'psd-native' || options.importFamily === 'xcf-native' || options.importFamily === 'flattened-raster') {
    warnings.push({
      code: 'adjustment-import-flattened',
      severity: 'warning',
      message: `Adjustment ${options.importFamily} import is represented as planning metadata or flattened pixels; native adjustment round-trip is not complete.`,
    });
  }
  if (options.exportFamily === 'psd-native' || options.exportFamily === 'flattened-raster') {
    warnings.push({
      code: 'adjustment-export-flattened',
      severity: 'warning',
      message: `Adjustment ${options.exportFamily} export flattens or approximates live adjustment layers instead of preserving native Photoshop adjustment controls.`,
    });
  }
  return warnings;
}

function dedupeAdjustmentPlanningWarnings(
  warnings: AdjustmentLayerPlanningWarning[],
): AdjustmentLayerPlanningWarning[] {
  const seen = new Set<AdjustmentLayerPlanningWarningCode>();
  return warnings.filter((warning) => {
    if (seen.has(warning.code)) return false;
    seen.add(warning.code);
    return true;
  });
}

function buildAdjustmentCoverageDescriptor(
  layers: AdjustmentLayerPlanDescriptor[],
): Partial<Record<AdjustmentLayerKind, AdjustmentLayerCoverageDescriptor>> {
  const coverage: Partial<Record<AdjustmentLayerKind, AdjustmentLayerCoverageDescriptor>> = {};
  for (const layer of layers) {
    const channel = getAdjustmentSettingsChannel(layer.settings);
    const current = coverage[layer.kind] ?? {
      count: 0,
      channels: [],
      histogramRequired: false,
    };
    current.count += 1;
    if (!current.channels.includes(channel)) {
      current.channels.push(channel);
    }
    current.histogramRequired = current.histogramRequired || layer.kind === 'levels' || layer.kind === 'curves';
    coverage[layer.kind] = current;
  }
  return coverage;
}

function buildAdjustmentMaskInteractionDescriptors(
  layers: ImageLayer[],
): AdjustmentLayerMaskInteractionDescriptor[] {
  return layers
    .filter((layer) => !!layer.mask)
    .map((layer) => {
      const density = clamp01(layer.maskDensity ?? 1);
      const feather = Math.max(0, normalizeFiniteAdjustmentNumber(layer.maskFeather, 0));
      return {
        layerId: layer.id,
        family: 'raster-layer-mask',
        density,
        feather,
        summary: `Raster layer mask limits ${adjustmentLayerLabel(layer.adjustment?.kind ?? 'brightnessContrast')} at ${Math.round(density * 100)}% density with ${feather}px feather.`,
      };
    });
}

function buildAdjustmentStackLimitations(
  layers: AdjustmentLayerPlanDescriptor[],
  options: AdjustmentLayerPlanningOptions,
): string[] {
  const limitations = new Set<string>();
  if (options.exportFamily === 'flattened-raster' || options.exportFamily === 'psd-native') {
    limitations.add('Adjustment layers are represented non-destructively in Sloom Studio state but exported raster formats flatten the visible result.');
  }
  for (const layer of layers) {
    for (const limitation of layer.workflow.documentPrecision.limitations) {
      limitations.add(limitation);
    }
    if (layer.workflow.clipping.status === 'partial' || layer.workflow.clipping.status === 'unsupported') {
      for (const note of layer.workflow.clipping.notes) {
        limitations.add(note);
      }
    }
    if (layer.workflow.mask.status === 'partial' || layer.workflow.mask.status === 'unsupported') {
      for (const note of layer.workflow.mask.notes) {
        limitations.add(note);
      }
    }
  }
  return [...limitations];
}

function getAdjustmentSettingsChannel(
  settings: ImageAdjustmentSettings,
): 'rgb' | 'red' | 'green' | 'blue' {
  if (settings.kind === 'levels' || settings.kind === 'curves') {
    return settings.channel;
  }
  return 'rgb';
}

function describeAdjustmentParameterCompleteness(
  settings: ImageAdjustmentSettings,
): AdjustmentLayerParameterCompletenessDescriptor {
  const required = getAdjustmentRequiredParameters(settings);
  const missing = required.filter((path) => isAdjustmentParameterMissing(settings, path));
  return {
    complete: missing.length === 0,
    required,
    missing,
    normalizedSettings: normalizeAdjustmentSettingsForMetadata(settings),
  };
}

function getAdjustmentRequiredParameters(settings: ImageAdjustmentSettings): string[] {
  switch (settings.kind) {
    case 'brightnessContrast':
      return ['brightness', 'contrast'];
    case 'hueSaturation':
      return ['hue', 'saturation', 'lightness'];
    case 'blackWhite':
    case 'invert':
      return [];
    case 'exposure':
      return ['exposure', 'offset', 'gamma'];
    case 'temperatureTint':
      return ['temperature', 'tint'];
    case 'lut':
      return ['channel'];
    case 'gradientMap':
      return ['stops'];
    case 'levels':
      return ['channel', 'inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'];
    case 'curves':
      return ['channel', 'points[0].input', 'points[0].output', 'points[1]', 'shadows', 'midtones', 'highlights'];
    case 'channelMixer':
      return ['red', 'green', 'blue', 'constant'];
    case 'selectiveColor':
      return ['target', 'cyan', 'magenta', 'yellow', 'black'];
  }
}

function isAdjustmentParameterMissing(settings: ImageAdjustmentSettings, path: string): boolean {
  const source = settings as unknown as Record<string, unknown>;
  if (path === 'red' || path === 'green' || path === 'blue' || path === 'constant') {
    const values = source[path];
    return !Array.isArray(values) || values.length !== 3 || values.some((value) => typeof value !== 'number' || !Number.isFinite(value));
  }
  if (path === 'target') {
    return !['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].includes(source.target as string);
  }
  if (path === 'channel') {
    return source.channel !== 'rgb' && source.channel !== 'red' && source.channel !== 'green' && source.channel !== 'blue';
  }
  if (path === 'points[0].input' || path === 'points[0].output') {
    const point = Array.isArray(source.points) ? source.points[0] as Record<string, unknown> | undefined : undefined;
    const key = path.endsWith('.input') ? 'input' : 'output';
    return typeof point?.[key] !== 'number' || !Number.isFinite(point[key]);
  }
  if (path === 'points[1]') {
    return !Array.isArray(source.points) || source.points.length < 2;
  }
  return typeof source[path] !== 'number' || !Number.isFinite(source[path]);
}

function describeAdjustmentHistogramReadiness(
  histogramPreview: AdjustmentLayerWorkflowDescriptor['histogramPreview'],
  options: AdjustmentLayerPlanningOptions,
): AdjustmentLayerHistogramReadinessDescriptor {
  const ready = !histogramPreview.required || options.histogramSourceAvailable !== false;
  return {
    required: histogramPreview.required,
    dependency: histogramPreview.dependency,
    ready,
    reason: histogramPreview.required
      ? ready
        ? 'Histogram-dependent preview can use the rendered base layer stack.'
        : 'Histogram-dependent adjustments need rendered base layers before preset preview is ready.'
      : 'Adjustment kind does not require histogram input.',
  };
}

function describeAdjustmentPresetReadiness(
  presetFamily: AdjustmentLayerPresetFamily,
  options: AdjustmentLayerPlanningOptions,
): AdjustmentLayerPresetReadinessDescriptor {
  const importFamily = options.importFamily ?? 'signal-loom';
  const exportFamily = options.exportFamily ?? 'signal-loom';
  return {
    serialization: {
      family: presetFamily,
      ready: SUPPORTED_ADJUSTMENT_PRESET_FAMILIES.has(presetFamily),
      reason: SUPPORTED_ADJUSTMENT_PRESET_FAMILIES.has(presetFamily)
        ? 'Single-adjustment Image presets serialize as live adjustment settings.'
        : 'Only single-adjustment Image presets serialize as live adjustment settings.',
    },
    import: describeAdjustmentImportReadiness(importFamily),
    export: describeAdjustmentExportReadiness(exportFamily),
  };
}

function describeAdjustmentImportReadiness(
  family: AdjustmentLayerImportFamily,
): AdjustmentLayerPresetReadinessDescriptor['import'] {
  if (family === 'signal-loom') {
    return {
      family,
      ready: true,
      status: 'supported',
      reason: 'Sloom Studio adjustment presets import as editable adjustment settings.',
    };
  }
  if (family === 'psd-native') {
    return {
      family,
      ready: false,
      status: 'preview-only',
      reason: 'Native PSD adjustment controls import as planning metadata or flattened pixels.',
    };
  }
  return {
    family,
    ready: false,
    status: 'preview-only',
    reason: `${family} adjustment import is represented as planning metadata or flattened pixels.`,
  };
}

function describeAdjustmentExportReadiness(
  family: AdjustmentLayerExportFamily,
): AdjustmentLayerPresetReadinessDescriptor['export'] {
  if (family === 'signal-loom') {
    return {
      family,
      ready: true,
      status: 'supported',
      reason: 'Sloom Studio adjustment presets export as editable adjustment settings.',
    };
  }
  if (family === 'flattened-raster') {
    return {
      family,
      ready: false,
      status: 'preview-only',
      reason: 'Flattened raster export preserves pixels, not editable adjustment preset controls.',
    };
  }
  return {
    family,
    ready: false,
    status: 'preview-only',
    reason: `${family} adjustment export flattens or approximates live adjustment controls.`,
  };
}

function buildAdjustmentUnsupportedStates(input: {
  parameterCompleteness: AdjustmentLayerParameterCompletenessDescriptor;
  histogram: AdjustmentLayerHistogramReadinessDescriptor;
  plan: AdjustmentLayerPlanDescriptor;
  preset: AdjustmentLayerPresetReadinessDescriptor;
}): string[] {
  const states: string[] = [];
  if (!input.parameterCompleteness.complete) states.push('parameters-incomplete');
  if (!input.histogram.ready) states.push('histogram-source-unavailable');
  if (input.plan.workflow.clipping.status === 'unsupported') states.push(`clipping:${input.plan.scope.clippingFamily}`);
  if (input.plan.workflow.mask.status === 'unsupported') states.push(`mask:${input.plan.scope.maskFamily}`);
  if (!input.preset.serialization.ready) states.push(`preset:${input.preset.serialization.family}`);
  if (!input.preset.import.ready) states.push(`import:${input.preset.import.family}`);
  if (!input.preset.export.ready) states.push(`export:${input.preset.export.family}`);
  return states;
}

function buildAdjustmentReadinessBlockers(input: {
  parameterCompleteness: AdjustmentLayerParameterCompletenessDescriptor;
  histogram: AdjustmentLayerHistogramReadinessDescriptor;
  plan: AdjustmentLayerPlanDescriptor;
  preset: AdjustmentLayerPresetReadinessDescriptor;
}): AdjustmentLayerReadinessBlocker[] {
  const blockers: AdjustmentLayerReadinessBlocker[] = [];
  if (!input.parameterCompleteness.complete) {
    blockers.push({
      code: 'adjustment-parameters-incomplete',
      severity: 'blocker',
      message: `${input.plan.label} is missing required parameters: ${input.parameterCompleteness.missing.join(', ')}.`,
    });
  }
  if (!input.histogram.ready) {
    blockers.push({
      code: 'adjustment-histogram-source-unavailable',
      severity: 'blocker',
      message: `${input.plan.label} requires rendered base layers before histogram-dependent preview is ready.`,
    });
  }
  if (!input.preset.serialization.ready) {
    blockers.push({
      code: 'adjustment-preset-serialization-unsupported',
      severity: 'blocker',
      message: `${input.preset.serialization.family} presets cannot serialize as editable Sloom Studio adjustment settings.`,
    });
  }
  if (!input.preset.import.ready) {
    blockers.push({
      code: 'adjustment-preset-import-unsupported',
      severity: 'blocker',
      message: `${input.preset.import.family} adjustment presets do not import as editable Sloom Studio adjustment settings.`,
    });
  }
  if (!input.preset.export.ready) {
    blockers.push({
      code: 'adjustment-preset-export-unsupported',
      severity: 'blocker',
      message: `${input.preset.export.family} adjustment presets do not export as editable Sloom Studio adjustment settings.`,
    });
  }
  return blockers;
}

function buildAdjustmentUnsupportedStateDescriptors(
  options: AdjustmentLayerPlanningOptions,
): AdjustmentLayerUnsupportedStateDescriptor[] {
  const states: AdjustmentLayerUnsupportedStateDescriptor[] = [];
  const add = (state: AdjustmentLayerUnsupportedStateDescriptor) => {
    if (!states.some((candidate) => candidate.code === state.code)) states.push(state);
  };

  if (options.bitDepth === 16 || options.bitDepth === 32) {
    add({
      code: 'true-high-bit-adjustment-pipeline-unsupported',
      status: 'unsupported',
      message: 'True 16/32-bit adjustment processing is not implemented; browser canvas previews are reduced to 8-bit RGB.',
    });
  }
  if (options.presetFamily && !SUPPORTED_ADJUSTMENT_PRESET_FAMILIES.has(options.presetFamily)) {
    add({
      code: 'photoshop-preset-family-parity-unsupported',
      status: 'unsupported',
      message: 'Photoshop preset-family parity is not implemented; only Sloom Studio single-adjustment presets serialize as editable settings.',
    });
  }
  if (options.colorMode === 'cmyk') {
    add({
      code: 'cmyk-native-adjustment-unsupported',
      status: 'unsupported',
      message: 'Native CMYK adjustment operations are not implemented; previews are RGB approximations.',
    });
  }
  if (options.colorMode === 'lab') {
    add({
      code: 'lab-native-adjustment-unsupported',
      status: 'unsupported',
      message: 'Native LAB adjustment operations are not implemented; previews are RGB approximations.',
    });
  }
  if (options.importFamily === 'psd-native' || options.exportFamily === 'psd-native') {
    add({
      code: 'native-psd-adjustment-fidelity-unsupported',
      status: 'unsupported',
      message: 'Native PSD adjustment fidelity is not implemented; PSD import/export uses planning metadata, approximation, or flattened pixels.',
    });
  }
  if (options.clippingFamily === 'blend-if') {
    add({
      code: 'blend-if-adjustment-clipping-unsupported',
      status: 'unsupported',
      message: 'Blend-if clipping ranges are not represented by Image adjustment layers yet.',
    });
  }
  if (options.maskFamily === 'vector-mask') {
    add({
      code: 'vector-mask-adjustment-scope-unsupported',
      status: 'unsupported',
      message: 'Vector masks are planning metadata only for adjustment layer scope.',
    });
  }
  if (options.maskFamily === 'channel-mask') {
    add({
      code: 'channel-mask-adjustment-scope-unsupported',
      status: 'unsupported',
      message: 'Channel masks are planning metadata only for adjustment layer scope.',
    });
  }

  return states;
}

function describeAdjustmentLayerWorkflow(
  settings: ImageAdjustmentSettings,
  scope: AdjustmentLayerPlanDescriptor['scope'],
  options: AdjustmentLayerPlanningOptions,
): AdjustmentLayerWorkflowDescriptor {
  const histogramRequired = settings.kind === 'levels' || settings.kind === 'curves' || options.histogramPreview === true;
  const documentPrecision = describeAdjustmentLayerDocumentPrecision(
    options.colorMode ?? 'rgb',
    options.bitDepth ?? 8,
  );
  const livePreviewCaveats = describeAdjustmentLayerLivePreviewCaveats({
    requested: options.livePreview === true,
    histogramRequired,
    documentPrecision,
  });

  return {
    presetSerialization: {
      supported: SUPPORTED_ADJUSTMENT_PRESET_FAMILIES.has(scope.presetFamily),
      family: scope.presetFamily,
      serializedKind: settings.kind,
    },
    clipping: describeAdjustmentLayerClippingStatus(scope.clippingFamily),
    mask: describeAdjustmentLayerMaskStatus(scope.maskFamily),
    histogramPreview: {
      required: histogramRequired,
      dependency: histogramRequired ? 'base-layers-before-adjustment' : 'not-required',
      supported: histogramRequired,
    },
    livePreview: {
      requested: options.livePreview === true,
      supported: documentPrecision.status !== 'unsupported',
      caveats: livePreviewCaveats,
    },
    documentPrecision,
  };
}

function describeAdjustmentLayerClippingStatus(
  family: AdjustmentLayerClippingFamily,
): AdjustmentLayerScopeStatusDescriptor {
  if (family === 'none') {
    return { family, status: 'supported', notes: [] };
  }
  if (family === 'layer-alpha') {
    return {
      family,
      status: 'partial',
      notes: ['Layer-alpha clipping is represented through the current lower-layer alpha mask only.'],
    };
  }
  if (family === 'blend-if') {
    return {
      family,
      status: 'unsupported',
      notes: ['Blend-if clipping ranges are not represented by Image adjustment layers yet.'],
    };
  }
  return {
    family,
    status: 'unsupported',
    notes: [`${family} clipping is planning metadata only for adjustment layers.`],
  };
}

function describeAdjustmentLayerMaskStatus(
  family: AdjustmentLayerMaskFamily,
): AdjustmentLayerScopeStatusDescriptor {
  if (family === 'none') {
    return { family, status: 'supported', notes: [] };
  }
  if (family === 'raster-layer-mask') {
    return {
      family,
      status: 'partial',
      notes: ['Raster masks support density and feather metadata, but mask editing parity is handled outside adjustment planning.'],
    };
  }
  if (family === 'vector-mask' || family === 'channel-mask') {
    return {
      family,
      status: 'unsupported',
      notes: ['Vector and channel masks are planning metadata only for adjustment layers.'],
    };
  }
  return {
    family,
    status: 'unsupported',
    notes: [`${family} masks are planning metadata only for adjustment layers.`],
  };
}

function describeAdjustmentLayerDocumentPrecision(
  colorMode: AdjustmentLayerWorkflowColorMode,
  bitDepth: AdjustmentLayerWorkflowBitDepth,
): AdjustmentLayerDocumentPrecisionDescriptor {
  const limitations: string[] = [];
  let status: AdjustmentLayerWorkflowSupportStatus = 'supported';

  if (colorMode === 'cmyk') {
    status = 'preview-only';
    limitations.push('CMYK adjustment math is not native; previews are RGB approximations only.');
  } else if (colorMode === 'lab') {
    status = 'unsupported';
    limitations.push('Lab adjustment workflows are not implemented.');
  } else if (colorMode === 'indexed' || colorMode === 'grayscale') {
    status = 'conversion-required';
    limitations.push(`${labelAdjustmentWorkflowColorMode(colorMode)} documents require RGB conversion before adjustment math runs.`);
  }

  if (bitDepth === 16) {
    limitations.push('16-bit adjustment input is reduced to 8-bit browser canvas precision.');
    if (status === 'supported') status = 'conversion-required';
  } else if (bitDepth === 32) {
    limitations.push('32-bit adjustment input must be tone-mapped to 8-bit browser canvas precision.');
    if (status === 'supported') status = 'conversion-required';
  }

  return { colorMode, bitDepth, status, limitations };
}

function describeAdjustmentLayerLivePreviewCaveats(input: {
  requested: boolean;
  histogramRequired: boolean;
  documentPrecision: AdjustmentLayerDocumentPrecisionDescriptor;
}): string[] {
  if (!input.requested) return [];
  const caveats = ['Live preview is computed through browser 8-bit RGB canvas output.'];
  if (input.histogramRequired) {
    caveats.push('Histogram preview depends on re-rendering lower visible layers before the adjustment.');
  }
  if (input.documentPrecision.status === 'unsupported') {
    caveats.push('Live preview is unavailable for unsupported color-mode workflows.');
  }
  return caveats;
}

function buildAdjustmentLayerPlanSignature(
  layerId: string,
  previewSignature: string,
  workflow: AdjustmentLayerWorkflowDescriptor,
  warnings: AdjustmentLayerPlanningWarning[],
): string {
  return `adjustment-plan:v1:${JSON.stringify({
    layerId,
    previewSignature,
    workflowStatus: workflow.documentPrecision.status,
    warnings: warnings.map((warning) => warning.code),
  })}`;
}

function buildAdjustmentLayerPreviewSignature(
  layerId: string,
  settings: ImageAdjustmentSettings,
  scope: AdjustmentLayerPlanDescriptor['scope'],
  bounds: AdjustmentLayerPlanningBounds,
): string {
  return `adjustment-layer:v1:${JSON.stringify({
    layerId,
    kind: settings.kind,
    settings,
    scope,
    bounds,
  })}`;
}

function buildAdjustmentPresetPreviewSignature(
  settings: ImageAdjustmentSettings,
  bounds: AdjustmentLayerPlanningBounds,
): string {
  return `adjustment-preset:v1:${JSON.stringify({
    kind: settings.kind,
    settings,
    bounds,
  })}`;
}

function normalizeAdjustmentSettingsForMetadata(settings: ImageAdjustmentSettings): ImageAdjustmentSettings {
  switch (settings.kind) {
    case 'brightnessContrast':
      return {
        kind: settings.kind,
        brightness: normalizeAdjustmentNumber(settings.brightness, -150, 150, 0),
        contrast: normalizeAdjustmentNumber(settings.contrast, -100, 100, 0),
      };
    case 'hueSaturation':
      return {
        kind: settings.kind,
        hue: normalizeAdjustmentNumber(settings.hue, -180, 180, 0),
        saturation: normalizeAdjustmentNumber(settings.saturation, -100, 100, 0),
        lightness: normalizeAdjustmentNumber(settings.lightness, -100, 100, 0),
      };
    case 'blackWhite':
      return { kind: settings.kind };
    case 'invert':
      return { kind: settings.kind };
    case 'exposure':
      return {
        kind: settings.kind,
        exposure: normalizeAdjustmentNumber(settings.exposure, -3, 3, 0),
        offset: normalizeAdjustmentNumber(settings.offset, -0.5, 0.5, 0),
        gamma: normalizeAdjustmentNumber(settings.gamma, 0.1, 3, 1),
      };
    case 'temperatureTint':
      return {
        kind: settings.kind,
        temperature: normalizeAdjustmentNumber(settings.temperature, -100, 100, 0),
        tint: normalizeAdjustmentNumber(settings.tint, -100, 100, 0),
      };
    case 'levels':
      return {
        kind: settings.kind,
        channel: normalizeAdjustmentChannel(settings.channel),
        inputBlack: normalizeAdjustmentByte(settings.inputBlack, 0, 254, 0),
        inputWhite: normalizeAdjustmentByte(settings.inputWhite, 1, 255, 255),
        gamma: normalizeAdjustmentNumber(settings.gamma, 0.1, 3, 1),
        outputBlack: normalizeAdjustmentByte(settings.outputBlack, 0, 255, 0),
        outputWhite: normalizeAdjustmentByte(settings.outputWhite, 0, 255, 255),
      };
    case 'curves':
      return {
        kind: settings.kind,
        channel: normalizeAdjustmentChannel(settings.channel),
        points: normalizeCurvePointsForMetadata(settings.points),
        shadows: normalizeAdjustmentNumber(settings.shadows, -120, 120, 0),
        midtones: normalizeAdjustmentNumber(settings.midtones, -120, 120, 0),
        highlights: normalizeAdjustmentNumber(settings.highlights, -120, 120, 0),
      };
    case 'lut':
      return {
        kind: settings.kind,
        channel: normalizeAdjustmentChannel(settings.channel),
        lutData: settings.lutData,
        lutDataValues: settings.lutData ? Array.from(settings.lutData) : settings.lutDataValues,
      };
    case 'gradientMap':
      return {
        kind: settings.kind,
        stops: (settings.stops || [])
          .map((stop) => ({
            position: clamp01(stop.position),
            color: [
              clampByte(stop.color[0]),
              clampByte(stop.color[1]),
              clampByte(stop.color[2]),
            ] as [number, number, number],
          }))
          .sort((a, b) => a.position - b.position),
      };
    case 'channelMixer':
      return {
        kind: settings.kind,
        red: normalizeMixerCoefficients(settings.red, [100, 0, 0]),
        green: normalizeMixerCoefficients(settings.green, [0, 100, 0]),
        blue: normalizeMixerCoefficients(settings.blue, [0, 0, 100]),
        constant: normalizeMixerCoefficients(settings.constant, [0, 0, 0]),
      };
    case 'selectiveColor':
      return {
        kind: settings.kind,
        target: normalizeSelectiveColorTarget(settings.target),
        cyan: normalizeAdjustmentNumber(settings.cyan, -100, 100, 0),
        magenta: normalizeAdjustmentNumber(settings.magenta, -100, 100, 0),
        yellow: normalizeAdjustmentNumber(settings.yellow, -100, 100, 0),
        black: normalizeAdjustmentNumber(settings.black, -100, 100, 0),
      };
  }
}

function normalizeMixerCoefficients(
  values: readonly number[] | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  return [
    normalizeAdjustmentNumber(values?.[0] ?? fallback[0], -200, 200, fallback[0]),
    normalizeAdjustmentNumber(values?.[1] ?? fallback[1], -200, 200, fallback[1]),
    normalizeAdjustmentNumber(values?.[2] ?? fallback[2], -200, 200, fallback[2]),
  ];
}

function normalizeSelectiveColorTarget(value: unknown): Extract<ImageAdjustmentSettings, { kind: 'selectiveColor' }>['target'] {
  const allowed = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'] as const;
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : 'reds';
}

function normalizeCurvePointsForMetadata(
  points: Array<{ input: number; output: number }> | undefined,
): Array<{ input: number; output: number }> {
  const source = points?.length ? points : [{ input: 0, output: 0 }, { input: 255, output: 255 }];
  return source
    .map((point) => ({
      input: normalizeAdjustmentByte(point.input, 0, 255, 0),
      output: normalizeAdjustmentByte(point.output, 0, 255, 0),
    }))
    .sort((a, b) => a.input - b.input || a.output - b.output);
}

function normalizeAdjustmentChannel(channel: 'rgb' | 'red' | 'green' | 'blue'): 'rgb' | 'red' | 'green' | 'blue' {
  return channel === 'red' || channel === 'green' || channel === 'blue' ? channel : 'rgb';
}

function normalizeAdjustmentPlanningBounds(bounds: AdjustmentLayerPlanningBounds | undefined): AdjustmentLayerPlanningBounds {
  return {
    x: normalizeFiniteAdjustmentNumber(bounds?.x, 0),
    y: normalizeFiniteAdjustmentNumber(bounds?.y, 0),
    width: Math.max(0, normalizeFiniteAdjustmentNumber(bounds?.width, 0)),
    height: Math.max(0, normalizeFiniteAdjustmentNumber(bounds?.height, 0)),
  };
}

function normalizeAdjustmentPresetLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized.slice(0, 64) : 'Adjustment Preset';
}

function labelAdjustmentWorkflowColorMode(colorMode: AdjustmentLayerWorkflowColorMode): string {
  switch (colorMode) {
    case 'rgb':
      return 'RGB';
    case 'cmyk':
      return 'CMYK';
    case 'lab':
      return 'Lab';
    case 'grayscale':
      return 'Grayscale';
    case 'indexed':
      return 'Indexed color';
  }
}

function normalizeAdjustmentByte(value: number, min: number, max: number, fallback: number): number {
  return clampByte(normalizeAdjustmentNumber(value, min, max, fallback));
}

function normalizeAdjustmentNumber(value: number, min: number, max: number, fallback: number): number {
  return clamp(normalizeFiniteAdjustmentNumber(value, fallback), min, max);
}

function normalizeFiniteAdjustmentNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function renderImageDocumentLayersToBitmap(doc: ImageDocument): LayerBitmap {
  const bitmap = createBitmap(doc.width, doc.height);
  const ctx = getCtx(bitmap);
  ctx.clearRect(0, 0, bitmap.width, bitmap.height);
  const layers = materializeImageLinkedMasks(doc.layers);
  const tree = normalizeImageLayerGroupTree(layers);
  const groupBounds = buildGroupRenderBounds(tree.roots, doc.width, doc.height);
  compositeLayerTreeInto(bitmap, tree.roots, tree.layers, doc.width, doc.height, 1, 0, 0, groupBounds);
  return bitmap;
}

interface ImageGroupRenderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildGroupRenderBounds(
  roots: readonly ImageLayerGroupTreeNode[],
  docWidth: number,
  docHeight: number,
): ReadonlyMap<string, ImageGroupRenderBounds> {
  const boundsByGroupId = new Map<string, ImageGroupRenderBounds>();
  const visit = (node: ImageLayerGroupTreeNode): ImageGroupRenderBounds | null => {
    if (node.layer.type !== 'group') return getLayerRenderBounds(node.layer, docWidth, docHeight);
    const childBounds = node.children
      .map((child) => visit(child))
      .filter((bounds): bounds is ImageGroupRenderBounds => Boolean(bounds));
    const groupMaskBounds = node.layer.mask
      ? getLayerRenderBounds(node.layer, docWidth, docHeight)
      : null;
    const bounds = unionRenderBounds([...childBounds, ...(groupMaskBounds ? [groupMaskBounds] : [])], docWidth, docHeight);
    const normalized = bounds ?? { x: 0, y: 0, width: 1, height: 1 };
    boundsByGroupId.set(node.layer.id, normalized);
    return normalized;
  };
  for (const root of roots) visit(root);
  return boundsByGroupId;
}

function getLayerRenderBounds(
  layer: ImageLayer,
  docWidth: number,
  docHeight: number,
): ImageGroupRenderBounds | null {
  const styled = layer.bitmap && (layer.effects?.some((effect) => effect.enabled) || layer.filters?.some((filter) => filter.enabled))
    ? renderLayerWithEffects(layer)
    : null;
  const source = styled?.bitmap ?? layer.bitmap ?? layer.mask;
  if (!source || !Number.isFinite(source.width) || !Number.isFinite(source.height)) return null;
  if (layer.bitmap) {
    const transformed = getImageLayerBitmapTransformedBounds(
      source,
      layer,
      styled?.offsetX ?? 0,
      styled?.offsetY ?? 0,
    );
    return unionRenderBounds([{
      x: transformed.left,
      y: transformed.top,
      width: transformed.width,
      height: transformed.height,
    }], docWidth, docHeight);
  }
  return unionRenderBounds([{
    x: Number.isFinite(layer.x) ? layer.x : 0,
    y: Number.isFinite(layer.y) ? layer.y : 0,
    width: Math.max(0, source.width),
    height: Math.max(0, source.height),
  }], docWidth, docHeight);
}

function unionRenderBounds(
  bounds: readonly ImageGroupRenderBounds[],
  docWidth: number,
  docHeight: number,
): ImageGroupRenderBounds | null {
  if (bounds.length === 0) return null;
  const left = Math.max(0, Math.floor(Math.min(...bounds.map((entry) => entry.x))));
  const top = Math.max(0, Math.floor(Math.min(...bounds.map((entry) => entry.y))));
  const right = Math.min(docWidth, Math.ceil(Math.max(...bounds.map((entry) => entry.x + entry.width))));
  const bottom = Math.min(docHeight, Math.ceil(Math.max(...bounds.map((entry) => entry.y + entry.height))));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Render the normalized folder tree rather than flattening folder membership away.  The legacy
 * range compositor below remains intentionally flat for incremental brush recomposition; the
 * full preview/export renderer uses this path so isolated folders, nested folders, opacity, and
 * group masks have exactly the same raster result when a document is rendered from scratch.
 */
function compositeLayerTreeInto(
  bitmap: LayerBitmap,
  nodes: readonly ImageLayerGroupTreeNode[],
  layers: readonly ImageLayer[],
  docWidth: number,
  docHeight: number,
  inheritedOpacity = 1,
  surfaceOriginX = 0,
  surfaceOriginY = 0,
  groupBounds: ReadonlyMap<string, ImageGroupRenderBounds> = new Map(),
  contextIsTranslated = false,
): LayerBitmap | null {
  const ctx = getCtx(bitmap);
  if (!contextIsTranslated) {
    ctx.save();
    if (surfaceOriginX !== 0 || surfaceOriginY !== 0) ctx.translate(-surfaceOriginX, -surfaceOriginY);
  }
  let clippingBaseMask: LayerBitmap | null = null;
  for (const node of nodes) {
    const layer = node.layer;
    if (!layer.visible) continue;
    if (layer.type === 'group') {
      const nextBase = compositeLayerGroupNodeInto(
        bitmap,
        node,
        layers,
        docWidth,
        docHeight,
        inheritedOpacity,
        surfaceOriginX,
        surfaceOriginY,
        groupBounds,
      );
      if (nextBase) clippingBaseMask = nextBase;
      continue;
    }
    clippingBaseMask = compositeLayerLeafInto(
      bitmap,
      layer,
      docWidth,
      docHeight,
      clippingBaseMask,
      inheritedOpacity,
      bitmap.width,
      bitmap.height,
      surfaceOriginX,
      surfaceOriginY,
    );
  }
  if (!contextIsTranslated) ctx.restore();
  return clippingBaseMask;
}

function compositeLayerGroupNodeInto(
  target: LayerBitmap,
  node: ImageLayerGroupTreeNode,
  layers: readonly ImageLayer[],
  docWidth: number,
  docHeight: number,
  inheritedOpacity: number,
  surfaceOriginX: number,
  surfaceOriginY: number,
  groupBounds: ReadonlyMap<string, ImageGroupRenderBounds>,
): LayerBitmap | null {
  const group = node.layer;
  const bounds = groupBounds.get(group.id) ?? { x: 0, y: 0, width: docWidth, height: docHeight };
  if (isImageLayerGroupPassThrough(group)) {
    // Pass-through does not create an intermediate blend backdrop: each child reaches the
    // parent stack with its own blend mode. Folder opacity remains meaningful by multiplying
    // it into every direct child, matching the visible pass-through workflow rather than
    // silently dropping it as the former flat compositor did.
    const lastLeafMask = compositeLayerTreeInto(
      target,
      node.children,
      layers,
      docWidth,
      docHeight,
      inheritedOpacity * clamp01(group.opacity),
      surfaceOriginX,
      surfaceOriginY,
      groupBounds,
      true,
    );
    return renderPassThroughGroupAlphaMask(node, layers, docWidth, docHeight, bounds, groupBounds, group.opacity)
      ?? lastLeafMask;
  }

  const isolated = createBitmap(bounds.width, bounds.height);
  setBitmapOrigin(isolated, bounds.x, bounds.y);
  const isolatedCtx = getCtx(isolated);
  isolatedCtx.clearRect(0, 0, isolated.width, isolated.height);
  compositeLayerTreeInto(isolated, node.children, layers, docWidth, docHeight, 1, bounds.x, bounds.y, groupBounds);
  applyGroupMaskToBitmap(isolated, group, docWidth, docHeight, bounds.x, bounds.y);

  const targetCtx = getCtx(target);
  targetCtx.save();
  targetCtx.globalAlpha = clamp01(group.opacity) * inheritedOpacity;
  targetCtx.globalCompositeOperation = toCanvasCompositeOperation(group.blendMode);
  targetCtx.drawImage(isolated, bounds.x, bounds.y);
  targetCtx.restore();
  return isolated;
}

function renderPassThroughGroupAlphaMask(
  node: ImageLayerGroupTreeNode,
  layers: readonly ImageLayer[],
  docWidth: number,
  docHeight: number,
  bounds: ImageGroupRenderBounds,
  groupBounds: ReadonlyMap<string, ImageGroupRenderBounds>,
  groupOpacity: number,
): LayerBitmap | null {
  const mask = createBitmap(bounds.width, bounds.height);
  setBitmapOrigin(mask, bounds.x, bounds.y);
  const ctx = getCtx(mask);
  ctx.clearRect(0, 0, mask.width, mask.height);
  compositeLayerTreeInto(
    mask,
    node.children,
    layers,
    docWidth,
    docHeight,
    clamp01(groupOpacity),
    bounds.x,
    bounds.y,
    groupBounds,
  );
  const data = getBitmapImageData(mask).data;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 0) return mask;
  }
  return null;
}

function compositeLayerLeafInto(
  target: LayerBitmap,
  sourceLayer: ImageLayer,
  docWidth: number,
  docHeight: number,
  clippingBaseMask: LayerBitmap | null,
  inheritedOpacity: number,
  surfaceWidth: number,
  surfaceHeight: number,
  surfaceOriginX: number,
  surfaceOriginY: number,
): LayerBitmap | null {
  const layer = inheritedOpacity === 1
    ? sourceLayer
    : { ...sourceLayer, opacity: clamp01(sourceLayer.opacity) * inheritedOpacity };
  if (layer.type === 'adjustment' && layer.adjustment) {
    if (layer.clippingMask) {
      if (clippingBaseMask) applyAdjustmentLayerToBitmap(target, layer, { clippingMask: clippingBaseMask });
      return clippingBaseMask;
    }
    applyAdjustmentLayerToBitmap(target, layer);
    return clippingBaseMask;
  }
  const ctx = getCtx(target);
  if (layer.clippingMask) {
    if (clippingBaseMask) {
      const clippingMaskOrigin = getBitmapOrigin(clippingBaseMask);
      paintPixelLayer(ctx, layer, {
        clippingMask: clippingBaseMask,
        documentWidth: docWidth,
        documentHeight: docHeight,
        surfaceWidth,
        surfaceHeight,
        surfaceOriginX,
        surfaceOriginY,
        clippingMaskOriginX: clippingMaskOrigin.x,
        clippingMaskOriginY: clippingMaskOrigin.y,
      });
    }
    return clippingBaseMask;
  }
  paintPixelLayer(ctx, layer);
  return renderLayerAlphaMask(layer, surfaceWidth, surfaceHeight, surfaceOriginX, surfaceOriginY) ?? clippingBaseMask;
}

function applyGroupMaskToBitmap(
  bitmap: LayerBitmap,
  group: ImageLayer,
  documentWidth: number,
  documentHeight: number,
  surfaceOriginX: number,
  surfaceOriginY: number,
): void {
  if (!group.mask) return;
  const mask = createProcessedLayerMaskBitmap(group) ?? group.mask;
  const ctx = getCtx(bitmap);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, -surfaceOriginX, -surfaceOriginY, documentWidth, documentHeight);
  ctx.restore();
}

/**
 * Composite a contiguous slice of the layer stack — `layers[startIndex, endIndex)` — into an
 * already-prepared `bitmap`, resuming from a given `clippingBaseMask` state and returning the
 * updated state. Splitting the full render at any boundary `k` and running [0,k) then [k,n) yields
 * exactly the same pixels as [0,n) (verified by test), which lets a live brush stroke recomposite
 * only the active layer and everything above it over a cached backdrop of the layers below.
 *
 * `layers` is always the FULL stack (visibility/group/clipping resolution needs every layer); only
 * the [startIndex, endIndex) window is painted. The caller clears/prepares `bitmap` before [0, …).
 */
export function compositeLayerRangeInto(
  bitmap: LayerBitmap,
  layers: readonly ImageLayer[],
  docWidth: number,
  docHeight: number,
  startIndex: number,
  endIndex: number,
  clippingBaseMask: LayerBitmap | null,
): LayerBitmap | null {
  const ctx = getCtx(bitmap);
  for (let i = startIndex; i < endIndex; i += 1) {
    const layer = layers[i];
    if (!layer || !isImageLayerEffectivelyVisible(layer, layers)) continue;
    if (layer.type === 'group') {
      clippingBaseMask = renderGroupAlphaMask(layer, layers, docWidth, docHeight);
      continue;
    }
    if (layer.type === 'adjustment' && layer.adjustment) {
      if (layer.clippingMask) {
        if (clippingBaseMask) {
          applyAdjustmentLayerToBitmap(bitmap, layer, { clippingMask: clippingBaseMask });
        }
        continue;
      }
      applyAdjustmentLayerToBitmap(bitmap, layer);
      continue;
    }
    if (layer.clippingMask) {
      if (clippingBaseMask) {
        paintPixelLayer(ctx, layer, { clippingMask: clippingBaseMask, documentWidth: docWidth, documentHeight: docHeight });
      }
      continue;
    }
    paintPixelLayer(ctx, layer);
    const nextBaseMask = renderLayerAlphaMask(layer, docWidth, docHeight);
    if (nextBaseMask) {
      clippingBaseMask = nextBaseMask;
    }
  }
  return clippingBaseMask;
}

export function applyAdjustmentLayerToBitmap(
  target: LayerBitmap,
  layer: ImageLayer,
  options: {
    clippingMask?: LayerBitmap;
  } = {},
): void {
  if (!layer.adjustment) return;
  const source = getBitmapImageData(target);
  const mask = getProcessedLayerMaskImageData(layer) ?? undefined;
  const clippingMask = options.clippingMask ? getBitmapImageData(options.clippingMask) : undefined;
  // The GPU path only accepts the exact unmasked, full-opacity subset. Any non-null
  // result is already composited; a null result is the normal CPU fallback signal.
  const gpuAdjusted = tryApplyAdjustmentGpu(source, layer.adjustment, {
    opacity: layer.opacity,
    hasMask: Boolean(mask),
    hasClippingMask: Boolean(clippingMask),
  });
  const adjusted = gpuAdjusted ?? applyAdjustmentToImageData(source, layer.adjustment, {
    opacity: layer.opacity,
    mask,
    clippingMask,
  });
  putBitmapImageData(target, adjusted);
}


export function applyAdjustmentToImageData(
  source: ImageData,
  adjustment: ImageAdjustmentSettings,
  options: {
    opacity?: number;
    mask?: ImageData;
    clippingMask?: ImageData;
  } = {},
): ImageData {
  const output = cloneImageData(source);
  const opacity = clamp01(options.opacity ?? 1);
  const hasMask = !!options.mask;
  const maskData = options.mask?.data;
  const maskWidth = options.mask?.width ?? 0;
  const maskHeight = options.mask?.height ?? 0;
  const hasClippingMask = !!options.clippingMask;
  const clippingMaskData = options.clippingMask?.data;
  const clippingMaskWidth = options.clippingMask?.width ?? 0;
  const clippingMaskHeight = options.clippingMask?.height ?? 0;
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const sourceData = source.data;
  const outputData = output.data;

  const kind = adjustment.kind;
  const isSeparable = kind !== 'hueSaturation'
    && kind !== 'blackWhite'
    && kind !== 'gradientMap'
    && kind !== 'channelMixer'
    && kind !== 'selectiveColor';

  if (isSeparable) {
    const lutR = new Uint8ClampedArray(256);
    const lutG = new Uint8ClampedArray(256);
    const lutB = new Uint8ClampedArray(256);

    const tempPixel: Rgba = [0, 0, 0, 255];
    for (let i = 0; i < 256; i++) {
      tempPixel[0] = i; tempPixel[1] = 0; tempPixel[2] = 0;
      lutR[i] = applyAdjustmentToPixel(tempPixel, adjustment)[0];

      tempPixel[0] = 0; tempPixel[1] = i; tempPixel[2] = 0;
      lutG[i] = applyAdjustmentToPixel(tempPixel, adjustment)[1];

      tempPixel[0] = 0; tempPixel[1] = 0; tempPixel[2] = i;
      lutB[i] = applyAdjustmentToPixel(tempPixel, adjustment)[2];
    }

    for (let y = 0; y < sourceHeight; y++) {
      const rowOffset = y * sourceWidth;
      for (let x = 0; x < sourceWidth; x++) {
        const offset = (rowOffset + x) * 4;
        const rIn = sourceData[offset];
        const gIn = sourceData[offset + 1];
        const bIn = sourceData[offset + 2];
        const aIn = sourceData[offset + 3];

        const rOut = lutR[rIn];
        const gOut = lutG[gIn];
        const bOut = lutB[bIn];

        const maskAlpha = readLayerMaskAlpha({
          x,
          y,
          hasMask,
          maskData,
          maskWidth,
          maskHeight,
          hasClippingMask,
          clippingMaskData,
          clippingMaskWidth,
          clippingMaskHeight,
        });

        const mix = opacity * maskAlpha;
        if (mix >= 1) {
          outputData[offset] = rOut;
          outputData[offset + 1] = gOut;
          outputData[offset + 2] = bOut;
        } else if (mix <= 0) {
          outputData[offset] = rIn;
          outputData[offset + 1] = gIn;
          outputData[offset + 2] = bIn;
        } else {
          outputData[offset] = rIn + (rOut - rIn) * mix;
          outputData[offset + 1] = gIn + (gOut - gIn) * mix;
          outputData[offset + 2] = bIn + (bOut - bIn) * mix;
        }
        outputData[offset + 3] = aIn;
      }
    }
  } else {
    const tempPixel: Rgba = [0, 0, 0, 0];
    for (let y = 0; y < sourceHeight; y++) {
      const rowOffset = y * sourceWidth;
      for (let x = 0; x < sourceWidth; x++) {
        const offset = (rowOffset + x) * 4;
        const rIn = sourceData[offset];
        const gIn = sourceData[offset + 1];
        const bIn = sourceData[offset + 2];
        const aIn = sourceData[offset + 3];

        tempPixel[0] = rIn;
        tempPixel[1] = gIn;
        tempPixel[2] = bIn;
        tempPixel[3] = aIn;

        const adjusted = applyAdjustmentToPixel(tempPixel, adjustment);
        const rOut = adjusted[0];
        const gOut = adjusted[1];
        const bOut = adjusted[2];

        const maskAlpha = readLayerMaskAlpha({
          x,
          y,
          hasMask,
          maskData,
          maskWidth,
          maskHeight,
          hasClippingMask,
          clippingMaskData,
          clippingMaskWidth,
          clippingMaskHeight,
        });

        const mix = opacity * maskAlpha;
        if (mix >= 1) {
          outputData[offset] = rOut;
          outputData[offset + 1] = gOut;
          outputData[offset + 2] = bOut;
        } else if (mix <= 0) {
          outputData[offset] = rIn;
          outputData[offset + 1] = gIn;
          outputData[offset + 2] = bIn;
        } else {
          outputData[offset] = rIn + (rOut - rIn) * mix;
          outputData[offset + 1] = gIn + (gOut - gIn) * mix;
          outputData[offset + 2] = bIn + (bOut - bIn) * mix;
        }
        outputData[offset + 3] = aIn;
      }
    }
  }

  return output;
}


const svgImageCache = new Map<string, { img: HTMLImageElement; loaded: boolean }>();

function paintVectorLayerDirectly(
  ctx: OffscreenCanvasRenderingContext2D,
  svgSource: string,
  layer: ImageLayer,
): void {
  let cached = svgImageCache.get(svgSource);
  if (!cached) {
    const img = new Image();
    const blob = new Blob([svgSource], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    cached = { img, loaded: false };
    svgImageCache.set(svgSource, cached);

    img.onload = () => {
      if (cached) {
        cached.loaded = true;
      }
      URL.revokeObjectURL(url);
      window.dispatchEvent(new CustomEvent('sloom-svg-loaded'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  if (cached.loaded) {
    ctx.save();
    ctx.globalAlpha = clamp01(layer.opacity);
    ctx.globalCompositeOperation = toCanvasCompositeOperation(layer.blendMode);

    if (layer.mask) {
      const processedMask = createProcessedLayerMaskBitmap(layer);
      const maskWidth = processedMask?.width ?? layer.mask.width;
      const maskHeight = processedMask?.height ?? layer.mask.height;
      const tempBitmap = createBitmap(maskWidth, maskHeight);
      const tempCtx = getCtx(tempBitmap);
      tempCtx.drawImage(cached.img, 0, 0, maskWidth, maskHeight);
      tempCtx.globalCompositeOperation = 'destination-in';
      tempCtx.drawImage(processedMask ?? layer.mask, 0, 0);
      drawLayerBitmapTransformed(ctx, tempBitmap, layer);
    } else {
      drawLayerBitmapTransformed(ctx, cached.img, layer);
    }

    ctx.restore();
  }
}

function paintPixelLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: ImageLayer,
  options: {
    clippingMask?: LayerBitmap;
    documentWidth?: number;
    documentHeight?: number;
    surfaceWidth?: number;
    surfaceHeight?: number;
    surfaceOriginX?: number;
    surfaceOriginY?: number;
    clippingMaskOriginX?: number;
    clippingMaskOriginY?: number;
  } = {},
): void {
  if (!layer.bitmap) {
    if (layer.type === 'vector') {
      const svgSource = layer.vectorRecipe || layer.metadata?.originalSvgSource;
      if (svgSource) {
        paintVectorLayerDirectly(ctx, svgSource, layer);
      }
    }
    return;
  }
  const styled = layer.effects?.some((effect) => effect.enabled) || layer.filters?.some((filter) => filter.enabled)
    ? renderLayerWithEffects(layer)
    : null;

  ctx.save();
  ctx.globalAlpha = clamp01(layer.opacity);
  ctx.globalCompositeOperation = toCanvasCompositeOperation(layer.blendMode);
  const source = styled
    ? styled.bitmap
    : hasLiveLayerMask(layer) ? composeLayerBitmapWithLiveMasks(layer) ?? layer.bitmap : layer.bitmap;
  const offsetX = styled?.offsetX ?? 0;
  const offsetY = styled?.offsetY ?? 0;
  if (styled) {
    if (options.clippingMask && options.documentWidth && options.documentHeight) {
      ctx.drawImage(composeLayerWithClippingMask(
        layer,
        source,
        options.clippingMask,
        options.surfaceWidth ?? options.documentWidth,
        options.surfaceHeight ?? options.documentHeight,
        offsetX,
        offsetY,
        options.surfaceOriginX ?? 0,
        options.surfaceOriginY ?? 0,
        options.clippingMaskOriginX ?? 0,
        options.clippingMaskOriginY ?? 0,
      ), options.surfaceOriginX ?? 0, options.surfaceOriginY ?? 0);
    } else {
      drawLayerBitmapTransformed(ctx, source, layer, offsetX, offsetY);
    }
  } else {
    if (options.clippingMask && options.documentWidth && options.documentHeight) {
      ctx.drawImage(composeLayerWithClippingMask(
        layer,
        source,
        options.clippingMask,
        options.surfaceWidth ?? options.documentWidth,
        options.surfaceHeight ?? options.documentHeight,
        offsetX,
        offsetY,
        options.surfaceOriginX ?? 0,
        options.surfaceOriginY ?? 0,
        options.clippingMaskOriginX ?? 0,
        options.clippingMaskOriginY ?? 0,
      ), options.surfaceOriginX ?? 0, options.surfaceOriginY ?? 0);
    } else {
      drawLayerBitmapTransformed(ctx, source, layer);
    }
  }
  ctx.restore();
}

function renderLayerAlphaMask(
  layer: ImageLayer,
  surfaceWidth: number,
  surfaceHeight: number,
  surfaceOriginX = 0,
  surfaceOriginY = 0,
): LayerBitmap | null {
  if (!layer.bitmap) return null;
  const mask = createBitmap(surfaceWidth, surfaceHeight);
  setBitmapOrigin(mask, surfaceOriginX, surfaceOriginY);
  const ctx = getCtx(mask);
  ctx.save();
  if (surfaceOriginX !== 0 || surfaceOriginY !== 0) ctx.translate(-surfaceOriginX, -surfaceOriginY);
  paintLayerAlphaToMask(ctx, layer);
  ctx.restore();
  return mask;
}

function renderGroupAlphaMask(
  group: ImageLayer,
  layers: readonly ImageLayer[],
  documentWidth: number,
  documentHeight: number,
): LayerBitmap | null {
  const descendants = getImageLayerGroupDescendantLayers(layers, group.id)
    .filter((layer) => layer.type !== 'group' && isImageLayerEffectivelyVisible(layer, layers));
  if (descendants.length === 0) return null;

  const mask = createBitmap(documentWidth, documentHeight);
  const ctx = getCtx(mask);
  let painted = false;
  for (const layer of descendants) {
    painted = paintLayerAlphaToMask(ctx, layer) || painted;
  }
  return painted ? mask : null;
}

function paintLayerAlphaToMask(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: ImageLayer,
): boolean {
  if (!layer.bitmap) return false;
  const styled = layer.effects?.some((effect) => effect.enabled) || layer.filters?.some((filter) => filter.enabled)
    ? renderLayerWithEffects(layer)
    : null;
  const source = styled
    ? styled.bitmap
    : hasLiveLayerMask(layer) ? composeLayerBitmapWithLiveMasks(layer) ?? layer.bitmap : layer.bitmap;
  ctx.save();
  ctx.globalAlpha = clamp01(layer.opacity);
  drawLayerBitmapTransformed(ctx, source, layer, styled?.offsetX ?? 0, styled?.offsetY ?? 0);
  ctx.restore();
  return true;
}

function composeLayerWithClippingMask(
  layer: ImageLayer,
  source: CanvasImageSource,
  clippingMask: LayerBitmap,
  surfaceWidth: number,
  surfaceHeight: number,
  offsetX = 0,
  offsetY = 0,
  surfaceOriginX = 0,
  surfaceOriginY = 0,
  clippingMaskOriginX = 0,
  clippingMaskOriginY = 0,
): LayerBitmap {
  const bitmap = createBitmap(surfaceWidth, surfaceHeight);
  const ctx = getCtx(bitmap);
  ctx.save();
  if (surfaceOriginX !== 0 || surfaceOriginY !== 0) ctx.translate(-surfaceOriginX, -surfaceOriginY);
  drawLayerBitmapTransformed(ctx, source, layer, offsetX, offsetY);
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(clippingMask, clippingMaskOriginX - surfaceOriginX, clippingMaskOriginY - surfaceOriginY);
  return bitmap;
}

interface MaskedLayerCacheEntry {
  signature: string;
  result: LayerBitmap;
}

// Applying a layer mask is a full getImageData → per-pixel loop → putImageData round-trip with a
// fresh bitmap allocation. Without memoization it re-ran on EVERY composite (every brush frame) for
// any masked layer — the cliff behind "a second, masked/differently-sized layer makes the brush
// sluggish", since that layer isn't even being edited. Cache it the same way layer effects are
// cached (keyed by the fields that change its appearance; bitmapVersion bumps on any pixel/mask
// edit). The cached bitmap is only read by callers, never mutated, so sharing it is safe.
const maskedLayerCache = new Map<string, MaskedLayerCacheEntry>();
const MAX_MASKED_LAYER_CACHE_ENTRIES = 64;
let liveMaskBypassLayerId: string | null = null;

/**
 * During a live stroke the active layer's pixels/mask change in place without a bitmapVersion bump,
 * so the compositor marks that layer here to bypass the cache and recompute it fresh each frame —
 * keeping painting through a layer mask crisp. Every other masked layer stays a cache hit.
 */
export function setLiveMaskBypassLayer(layerId: string | null): void {
  liveMaskBypassLayerId = layerId;
}

/** Clears the masked-layer composite memo (tests / document disposal). */
export function clearMaskedLayerCache(): void {
  maskedLayerCache.clear();
}

function buildMaskedLayerSignature(layer: ImageLayer): string {
  return JSON.stringify({
    w: layer.bitmap?.width ?? 0,
    h: layer.bitmap?.height ?? 0,
    bitmapVersion: layer.bitmapVersion,
    maskW: layer.mask?.width ?? 0,
    maskH: layer.mask?.height ?? 0,
    maskDensity: layer.maskDensity ?? null,
    maskFeather: layer.maskFeather ?? null,
    vectorMask: getLayerVectorMaskDescriptor(layer) ?? null,
  });
}

export function composeLayerBitmapWithLiveMasks(layer: ImageLayer): LayerBitmap | null {
  if (!layer.bitmap) return null;
  const vectorMaskDescriptor = getLayerVectorMaskDescriptor(layer);
  const hasVectorMask = Boolean(vectorMaskDescriptor?.enabled);
  if (!layer.mask && !hasVectorMask) return layer.bitmap;

  // The layer being actively painted recomputes fresh; all others hit the memo.
  const signature = liveMaskBypassLayerId === layer.id ? null : buildMaskedLayerSignature(layer);
  if (signature !== null) {
    const cached = maskedLayerCache.get(layer.id);
    if (cached && cached.signature === signature) return cached.result;
  }

  const output = createBitmap(layer.bitmap.width, layer.bitmap.height);
  const rasterMasked = layer.mask
    ? applyLayerMaskToImageData(getBitmapImageData(layer.bitmap), layer)
    : cloneImageData(getBitmapImageData(layer.bitmap));

  if (hasVectorMask) {
    const vectorMask = rasterizeLayerVectorMask(layer);
    applyMaskAlphaToImageData(rasterMasked, getBitmapImageData(vectorMask));
  }

  putBitmapImageData(output, rasterMasked);

  if (signature !== null) {
    if (!maskedLayerCache.has(layer.id) && maskedLayerCache.size >= MAX_MASKED_LAYER_CACHE_ENTRIES) {
      const oldest = maskedLayerCache.keys().next().value;
      if (oldest !== undefined) maskedLayerCache.delete(oldest);
    }
    maskedLayerCache.set(layer.id, { signature, result: output });
  }
  return output;
}

function hasLiveLayerMask(layer: ImageLayer): boolean {
  return Boolean(layer.mask || getLayerVectorMaskDescriptor(layer)?.enabled);
}

function applyMaskAlphaToImageData(imageData: ImageData, mask: ImageData): void {
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      const maskAlpha = x < mask.width && y < mask.height
        ? mask.data[(y * mask.width + x) * 4 + 3] ?? 0
        : 0;
      imageData.data[offset + 3] = Math.round((imageData.data[offset + 3] * maskAlpha) / 255);
    }
  }
}

export function applyAdjustmentToPixel(pixel: Rgba, adjustment: ImageAdjustmentSettings): Rgba {
  const [r, g, b, a] = pixel;
  switch (adjustment.kind) {
    case 'brightnessContrast':
      return applyBrightnessContrast(r, g, b, a, adjustment.brightness, adjustment.contrast);
    case 'hueSaturation':
      return applyHueSaturation(r, g, b, a, adjustment.hue, adjustment.saturation, adjustment.lightness);
    case 'blackWhite':
      return applyBlackWhite(r, g, b, a);
    case 'invert':
      return [255 - r, 255 - g, 255 - b, a];
    case 'exposure':
      return applyExposure(r, g, b, a, adjustment.exposure, adjustment.offset, adjustment.gamma);
    case 'temperatureTint':
      return applyTemperatureTint(r, g, b, a, adjustment.temperature, adjustment.tint);
    case 'levels':
      return applyByChannel([r, g, b, a], adjustment.channel, (channel) => applyLevelsChannel(channel, adjustment.inputBlack, adjustment.inputWhite, adjustment.gamma, adjustment.outputBlack, adjustment.outputWhite));
    case 'curves':
      return applyByChannel([r, g, b, a], adjustment.channel, (channel) => applyCurvesChannel(channel, adjustment.points, adjustment.shadows, adjustment.midtones, adjustment.highlights));
    case 'lut':
      return applyLutAdjustment(
        r,
        g,
        b,
        a,
        adjustment.channel,
        adjustment.lutData && adjustment.lutData.length === 256
          ? adjustment.lutData
          : adjustment.lutDataValues
            ? Uint8ClampedArray.from(adjustment.lutDataValues)
            : undefined,
      );
    case 'gradientMap':
      return applyGradientMapAdjustment(r, g, b, a, adjustment.stops);
    case 'channelMixer':
      return applyChannelMixer(r, g, b, a, adjustment);
    case 'selectiveColor':
      return applySelectiveColor(r, g, b, a, adjustment);
  }
}

export function applyChannelMixer(
  r: number,
  g: number,
  b: number,
  a: number,
  adjustment: Extract<ImageAdjustmentSettings, { kind: 'channelMixer' }>,
): Rgba {
  const mix = (coefficients: readonly number[], constant: number) => clampByte(
    r * (coefficients[0] ?? 0) / 100
    + g * (coefficients[1] ?? 0) / 100
    + b * (coefficients[2] ?? 0) / 100
    + constant * 2.55,
  );
  return [
    mix(adjustment.red, adjustment.constant[0] ?? 0),
    mix(adjustment.green, adjustment.constant[1] ?? 0),
    mix(adjustment.blue, adjustment.constant[2] ?? 0),
    a,
  ];
}

export function applySelectiveColor(
  r: number,
  g: number,
  b: number,
  a: number,
  adjustment: Extract<ImageAdjustmentSettings, { kind: 'selectiveColor' }>,
): Rgba {
  if (!selectiveColorTargetMatches(r, g, b, adjustment.target)) return [r, g, b, a];
  // CMY sliders reduce their matching RGB channel; K darkens all channels.
  const cyan = adjustment.cyan * 2.55;
  const magenta = adjustment.magenta * 2.55;
  const yellow = adjustment.yellow * 2.55;
  const black = adjustment.black * 2.55;
  return [clampByte(r - cyan - black), clampByte(g - magenta - black), clampByte(b - yellow - black), a];
}

type SelectiveColorChromaticTarget = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas';

// Photographic secondaries are never exact channel ties, so chromatic families own the
// nearest hue band (60° apart) instead of requiring two channels to match byte-for-byte.
const SELECTIVE_COLOR_HUE_CENTERS: ReadonlyArray<readonly [SelectiveColorChromaticTarget, number]> = [
  ['reds', 0],
  ['yellows', 60],
  ['greens', 120],
  ['cyans', 180],
  ['blues', 240],
  ['magentas', 300],
];
const SELECTIVE_COLOR_MIN_CHROMA_SPREAD = 16;

function selectiveColorHueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function selectiveColorHueFamily(degrees: number): SelectiveColorChromaticTarget {
  let family = SELECTIVE_COLOR_HUE_CENTERS[0][0];
  let best = Number.POSITIVE_INFINITY;
  // Strict less-than keeps the table order as the deterministic tie-break at band edges.
  for (const [candidate, center] of SELECTIVE_COLOR_HUE_CENTERS) {
    const distance = selectiveColorHueDistance(degrees, center);
    if (distance < best) {
      family = candidate;
      best = distance;
    }
  }
  return family;
}

function selectiveColorTargetMatches(
  r: number,
  g: number,
  b: number,
  target: Extract<ImageAdjustmentSettings, { kind: 'selectiveColor' }>['target'],
): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const luma = (r + g + b) / 3;
  if (target === 'whites') return luma >= 205 && spread < 55;
  if (target === 'blacks') return luma <= 55;
  if (target === 'neutrals') return spread < 28 && luma > 55 && luma < 205;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return false;
  // Classify on clamped channels so hostile out-of-range callers stay deterministic.
  const cr = clampByte(r);
  const cg = clampByte(g);
  const cb = clampByte(b);
  const chromaSpread = Math.max(cr, cg, cb) - Math.min(cr, cg, cb);
  if (chromaSpread < SELECTIVE_COLOR_MIN_CHROMA_SPREAD) return false;
  return selectiveColorHueFamily(rgbToHsl(cr, cg, cb)[0] * 360) === target;
}

export function applyBrightnessContrast(
  r: number,
  g: number,
  b: number,
  a: number,
  brightness: number,
  contrast: number,
): Rgba {
  const c = clamp(contrast, -255, 255);
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  return [
    clampByte(factor * (r - 128) + 128 + brightness),
    clampByte(factor * (g - 128) + 128 + brightness),
    clampByte(factor * (b - 128) + 128 + brightness),
    a,
  ];
}

export function applyHueSaturation(
  r: number,
  g: number,
  b: number,
  a: number,
  hue: number,
  saturation: number,
  lightness: number,
): Rgba {
  const hsl = rgbToHsl(r, g, b);
  const h = wrap01(hsl[0] + hue / 360);
  const s = clamp01(hsl[1] * (1 + saturation / 100));
  const l = clamp01(hsl[2] + lightness / 100);
  const rgb = hslToRgb(h, s, l);
  return [rgb[0], rgb[1], rgb[2], a];
}

export function applyBlackWhite(r: number, g: number, b: number, a: number): Rgba {
  const luma = blackWhiteLumaByte(r, g, b);
  return [luma, luma, luma, a];
}

export function applyExposure(
  r: number,
  g: number,
  b: number,
  a: number,
  exposure: number,
  offset: number,
  gamma: number,
): Rgba {
  const safeGamma = Math.max(0.01, gamma || 1);
  const adjust = (channel: number) => {
    const exposed = (channel / 255) * 2 ** exposure + offset;
    return clampByte(255 * Math.max(0, exposed) ** (1 / safeGamma));
  };
  return [adjust(r), adjust(g), adjust(b), a];
}

export function applyTemperatureTint(
  r: number,
  g: number,
  b: number,
  a: number,
  temperature: number,
  tint: number,
): Rgba {
  return [
    clampByte(r + temperature - tint * 0.25),
    clampByte(g + tint),
    clampByte(b - temperature - tint * 0.25),
    a,
  ];
}

export function applyLevelsChannel(
  channel: number,
  inputBlack: number,
  inputWhite: number,
  gamma: number,
  outputBlack: number,
  outputWhite: number,
): number {
  const black = clamp(inputBlack, 0, 254);
  const white = Math.max(black + 1, clamp(inputWhite, 1, 255));
  const safeGamma = Math.max(0.05, gamma || 1);
  const outBlack = clamp(outputBlack, 0, 255);
  const outWhite = clamp(outputWhite, 0, 255);
  const normalized = clamp01((channel - black) / (white - black));
  const corrected = normalized ** (1 / safeGamma);
  return clampByte(outBlack + corrected * (outWhite - outBlack));
}

export function applyCurvesChannel(
  channel: number,
  points: Array<{ input: number; output: number }> | undefined,
  shadows: number,
  midtones: number,
  highlights: number,
): number {
  const curve = evaluateCurvePoints(channel, points);
  const t = channel / 255;
  const shadowWeight = (1 - t) * (1 - t);
  const midtoneWeight = 4 * t * (1 - t);
  const highlightWeight = t * t;
  const delta = shadows * shadowWeight + midtones * midtoneWeight + highlights * highlightWeight;
  return clampByte(curve + delta);
}

export function applyByChannel(
  pixel: Rgba,
  channel: 'rgb' | 'red' | 'green' | 'blue',
  apply: (channel: number) => number,
): Rgba {
  const [r, g, b, a] = pixel;
  if (channel === 'red') return [apply(r), g, b, a];
  if (channel === 'green') return [r, apply(g), b, a];
  if (channel === 'blue') return [r, g, apply(b), a];
  return [apply(r), apply(g), apply(b), a];
}

export function evaluateCurvePoints(
  channel: number,
  points: Array<{ input: number; output: number }> | undefined,
): number {
  const normalized = (points?.length ? points : [{ input: 0, output: 0 }, { input: 255, output: 255 }])
    .map((point) => ({ input: clamp(point.input, 0, 255), output: clamp(point.output, 0, 255) }))
    .sort((a, b) => a.input - b.input);
  if (channel <= normalized[0].input) return normalized[0].output;
  for (let index = 1; index < normalized.length; index += 1) {
    const prev = normalized[index - 1];
    const next = normalized[index];
    if (channel <= next.input) {
      const span = Math.max(1, next.input - prev.input);
      const t = (channel - prev.input) / span;
      return prev.output + (next.output - prev.output) * t;
    }
  }
  return normalized[normalized.length - 1].output;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === red) {
    h = (green - blue) / d + (green < blue ? 6 : 0);
  } else if (max === green) {
    h = (blue - red) / d + 2;
  } else {
    h = (red - green) / d + 4;
  }

  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const gray = clampByte(l * 255);
    return [gray, gray, gray];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hueToRgb(p, q, h + 1 / 3) * 255),
    clampByte(hueToRgb(p, q, h) * 255),
    clampByte(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

export function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

export function applyLutAdjustment(
  r: number,
  g: number,
  b: number,
  a: number,
  channel: 'rgb' | 'red' | 'green' | 'blue',
  lutData?: Uint8ClampedArray,
): Rgba {
  if (!lutData || lutData.length !== 256) {
    return [r, g, b, a];
  }
  if (channel === 'red') return [lutData[r], g, b, a];
  if (channel === 'green') return [r, lutData[g], b, a];
  if (channel === 'blue') return [r, g, lutData[b], a];
  return [lutData[r], lutData[g], lutData[b], a];
}

export function applyGradientMapAdjustment(
  r: number,
  g: number,
  b: number,
  a: number,
  stops: Array<{ position: number; color: [number, number, number] }> = [],
): Rgba {
  if (!stops.length) {
    return [r, g, b, a];
  }
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const normalized = clamp01(luma / 255);
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  if (sortedStops.length === 0) return [r, g, b, a];
  if (normalized <= sortedStops[0].position) {
    const color = sortedStops[0].color;
    return [color[0], color[1], color[2], a];
  }
  for (let i = 1; i < sortedStops.length; i++) {
    const prev = sortedStops[i - 1];
    const next = sortedStops[i];
    if (normalized <= next.position) {
      const span = Math.max(0.001, next.position - prev.position);
      const t = (normalized - prev.position) / span;
      const color = [
        clampByte(prev.color[0] + (next.color[0] - prev.color[0]) * t),
        clampByte(prev.color[1] + (next.color[1] - prev.color[1]) * t),
        clampByte(prev.color[2] + (next.color[2] - prev.color[2]) * t),
      ];
      return [color[0], color[1], color[2], a];
    }
  }
  const lastColor = sortedStops[sortedStops.length - 1].color;
  return [lastColor[0], lastColor[1], lastColor[2], a];
}

export function cloneImageData(imageData: ImageData): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, imageData.width, imageData.height);
  }
  return {
    width: imageData.width,
    height: imageData.height,
    data,
  } as ImageData;
}

function readLayerMaskAlpha({
  x,
  y,
  hasMask,
  maskData,
  maskWidth,
  maskHeight,
  hasClippingMask,
  clippingMaskData,
  clippingMaskWidth,
  clippingMaskHeight,
}: {
  x: number;
  y: number;
  hasMask: boolean;
  maskData?: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
  hasClippingMask: boolean;
  clippingMaskData?: Uint8ClampedArray;
  clippingMaskWidth: number;
  clippingMaskHeight: number;
}): number {
  let maskAlpha = 1;
  if (hasMask && maskData) {
    maskAlpha *= readAlpha(maskData, maskWidth, maskHeight, x, y);
  }
  if (hasClippingMask && clippingMaskData) {
    maskAlpha *= readAlpha(clippingMaskData, clippingMaskWidth, clippingMaskHeight, x, y);
  }
  return clamp01(maskAlpha);
}

function readAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return data[(y * width + x) * 4 + 3] / 255;
}

function toCanvasCompositeOperation(blendMode: ImageLayer['blendMode']): GlobalCompositeOperation {
  return blendMode === 'normal' ? 'source-over' : blendMode;
}

function getCtx(bitmap: LayerBitmap): OffscreenCanvasRenderingContext2D {
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for image adjustment layer.');
  return ctx;
}

export function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

type Rgba = [number, number, number, number];
