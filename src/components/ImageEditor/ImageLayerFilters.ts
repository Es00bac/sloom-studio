import type { BlendMode, ImageLayerFilter, ImageLayerFilterMask, LayerFilterKind } from '../../types/imageEditor';

export interface LayerFilterBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayerFilterParameterType =
  | 'amount'
  | 'curve'
  | 'channel-map'
  | 'kernel'
  | 'lookup-table'
  | 'procedural'
  | (string & {});

export interface LayerFilterStackDescriptorOptions {
  sourceBounds?: LayerFilterBounds;
  /**
   * `local` is Sloom Studio's owned per-filter alpha grid. `present` is a
   * native/external Smart Filter mask that this runtime cannot round-trip.
   */
  smartFilterMask?: 'absent' | 'local' | 'present';
  parameterTypes?: readonly LayerFilterParameterType[];
  parameterTypesByFilterId?: Readonly<Record<string, readonly LayerFilterParameterType[]>>;
}

export interface LayerFilterStackInteropOptions extends LayerFilterStackDescriptorOptions {
  exportTarget?: 'editable' | 'flattened';
}

export interface LayerFilterDescriptor {
  id: string;
  kind: LayerFilterKind;
  family: LayerFilterFamily;
  label: string;
  enabled: boolean;
  amount: number;
  opacity: number;
  blendMode: BlendMode;
  order: number;
  affectedBounds: LayerFilterBounds;
  previewSignature: string;
  parameterCaveats: LayerFilterParameterCaveat[];
}

export interface LayerFilterStackDescriptor {
  filters: LayerFilterDescriptor[];
  affectedBounds: LayerFilterBounds;
  previewSignature: string;
  warnings: string[];
}

export interface LayerFilterStackPreset {
  version: 1;
  label: string;
  filters: Array<Pick<ImageLayerFilter, 'kind' | 'enabled' | 'amount' | 'opacity' | 'blendMode'>>;
  previewSignature: string;
}

export interface LayerFilterStackPresetMaterializeOptions extends LayerFilterStackDescriptorOptions {
  idPrefix?: string;
}

export interface LayerFilterStackPresetMaterialization {
  filters: ImageLayerFilter[];
  presetSignature: string;
  replaySignature: string;
  warnings: string[];
}

export type LayerFilterStackEditOperation =
  | {
      type: 'reorder';
      filterId: string;
      toIndex: number;
    }
  | {
      type: 'set-opacity';
      filterId: string;
      opacity: number;
    }
  | {
      type: 'set-blend-mode';
      filterId: string;
      blendMode: BlendMode;
    }
  | {
      type: 'set-enabled';
      filterId: string;
      enabled: boolean;
    }
  | {
      type: 'set-amount';
      filterId: string;
      amount: number;
    };

export interface LayerFilterStackEditBlocker {
  code:
    | 'filter-not-found'
    | 'filter-order-out-of-range'
    | 'invalid-filter-amount'
    | 'invalid-filter-opacity'
    ;
  severity: 'blocking';
  filterId: string;
  message: string;
}

export interface LayerFilterStackEditResult {
  filters: ImageLayerFilter[];
  changed: boolean;
  blockers: LayerFilterStackEditBlocker[];
  signatures: LayerFilterStackSignatures;
  previewSignature: string;
  exportSignature: string;
}

export interface LayerFilterStackInteropDescriptor {
  filters: LayerFilterDescriptor[];
  affectedBounds: LayerFilterBounds;
  blendOrderSignature: string;
  previewSignature: string;
  exportSignature: string;
  rasterizationWarnings: string[];
  caveats: string[];
  smartFilterMask: LayerFilterSmartMaskDescriptor;
  filterFamilyGaps: LayerFilterFamilyGap[];
  previewReadiness: LayerFilterPreviewReadiness;
  controlReadiness: LayerFilterControlReadiness;
  stackSignatures: LayerFilterStackSignatures;
  presetPortability: LayerFilterPresetPortability;
  exportFlattening: LayerFilterExportFlattening;
  nonDestructiveLimits: string[];
  smartFilterStyleLimits: LayerFilterSmartFilterStyleLimit[];
  portability: LayerFilterStackPortability;
}

export interface LayerFilterSmartFilterStyleLimit {
  id: 'mask' | 'blend-mode' | 'opacity' | 'order';
  editable: boolean;
  portability: 'metadata-only' | 'flattened-handoff';
  warning: string;
}

export interface LayerFilterStackPortability {
  portableWithinSignalLoom: boolean;
  portableAcrossSignalLoomDocuments: boolean;
  portableAsEditablePhotoshopSmartFilters: false;
  sourceBinVisibleExport: 'flattened-preview-plus-metadata';
  suiteVideoHandoff: 'flattened-visible-raster-plus-metadata';
  warnings: string[];
  signature: string;
}

export type LayerFilterFamily = 'adjustment' | 'geometry' | 'texture' | 'photographic';

export interface LayerFilterParameterCaveat {
  parameterType: LayerFilterParameterType;
  warning: string;
}

export interface LayerFilterSmartMaskDescriptor {
  status: 'absent' | 'editable-local' | 'unsupported';
  warning?: string;
}

export interface LayerFilterFamilyGap {
  family: LayerFilterFamily;
  implementedKinds: LayerFilterKind[];
  missingPhotoshopFamilies: string[];
  warning: string;
}

export interface LayerFilterPreviewReadiness {
  status: 'ready' | 'partial';
  liveCanvasPreview: boolean;
  stackSignature: string;
  gaps: string[];
}

export interface LayerFilterControlReadiness {
  amount: boolean;
  blendMode: boolean;
  enabled: boolean;
  opacity: boolean;
  reorder: boolean;
  smartFilterMask: boolean;
  advancedParameters: boolean;
}

export interface LayerFilterStackSignatures {
  order: string;
  blend: string;
  opacity: string;
}

export interface LayerFilterPresetPortability {
  status: 'portable' | 'blocked';
  signature: string;
  warnings: string[];
}

export interface LayerFilterExportFlattening {
  target: 'editable' | 'flattened';
  willRasterize: boolean;
  warnings: string[];
}

export interface EditableLayerFilterSupportSummary {
  kind: LayerFilterKind;
  family: LayerFilterFamily;
  label: string;
  defaultAmount: number;
}

export interface EditableLayerFilterStackControls {
  reorder: boolean;
  opacity: boolean;
  blendMode: boolean;
  enabled: boolean;
  amount: boolean;
}

export interface EditableLayerFilterStackParitySignatures {
  preview: string;
  export: string;
  order: string;
  blend: string;
  opacity: string;
}

export interface EditableLayerFilterStackBlocker {
  code:
    | 'smart-filter-mask-unsupported'
    | 'advanced-filter-parameters-unsupported'
    | 'flattened-export-rasterizes-stack';
  severity: 'blocking' | 'warning';
  message: string;
}

export interface EditableLayerFilterStackReadiness {
  supportedFilters: EditableLayerFilterSupportSummary[];
  stackControls: EditableLayerFilterStackControls;
  paritySignatures: EditableLayerFilterStackParitySignatures;
  blockers: EditableLayerFilterStackBlocker[];
  interop: LayerFilterStackInteropDescriptor;
}

export interface LayerFilterActionLayerMetadataInput {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  hasBitmap: boolean;
  sourceBinId?: string;
}

export interface LayerFilterActionReadinessOptions extends LayerFilterStackInteropOptions {
  layer?: LayerFilterActionLayerMetadataInput;
  visibleExportTarget?: 'source-bin' | 'suite-handoff';
  batchMode?: boolean;
  galleryFilterRequested?: string;
  nativeSmartFilterRequested?: boolean;
}

export interface LayerFilterSourceBinHandoffReadiness {
  status: 'safe' | 'blocked' | 'warning';
  visibleExportRequired: boolean;
  warnings: string[];
}

export interface LayerFilterActionLayerMetadata {
  layerId: string | null;
  layerName: string;
  layerType: string;
  visible: boolean;
  locked: boolean;
  hasBitmap: boolean;
  sourceBinId?: string;
  filterCount: number;
  enabledFilterCount: number;
  filterKinds: LayerFilterKind[];
  sourceBinHandoff: LayerFilterSourceBinHandoffReadiness;
}

export interface LayerFilterActionSemantics {
  preview: 'non-destructive-live';
  commit: 'metadata-stack' | 'blocked';
  preservesSourcePixels: boolean;
  mutatesPixelsOnCommit: boolean;
  previewSignature: string;
  commitSignature: string;
}

export interface LayerFilterUnsupportedState {
  code: 'filter-gallery-unsupported' | 'native-smart-filter-roundtrip-unsupported';
  status: 'unsupported';
  message: string;
}

export interface LayerFilterActionBlocker {
  code:
    | 'layer-locked'
    | 'missing-pixel-source'
    | 'invalid-filter-amount'
    | 'invalid-filter-opacity'
    | 'smart-filter-mask-unsupported'
    | 'advanced-filter-parameters-unsupported'
    | 'filter-gallery-unsupported'
    | 'native-smart-filter-roundtrip-unsupported'
    | 'visible-source-bin-handoff-blocked';
  severity: 'blocking' | 'warning';
  filterId?: string;
  message: string;
}

export interface LayerFilterBatchSuitability {
  status: 'suitable' | 'blocked';
  deterministic: boolean;
  actionRecordable: boolean;
  replayTarget: 'active-layer';
  signature: string;
  warnings: string[];
}

export interface LayerFilterActionReadiness {
  supportedStack: EditableLayerFilterSupportSummary[];
  layerMetadata: LayerFilterActionLayerMetadata;
  semantics: LayerFilterActionSemantics;
  unsupportedStates: LayerFilterUnsupportedState[];
  blockers: LayerFilterActionBlocker[];
  batchSuitability: LayerFilterBatchSuitability;
  interop: LayerFilterStackInteropDescriptor;
}

const SMART_FILTER_MASK_WARNING =
  'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.';
const MAX_LAYER_FILTER_MASK_SIGNATURE_CELLS = 4_194_304;
const SUPPORTED_LAYER_FILTER_PARAMETER_TYPES = new Set<LayerFilterParameterType>(['amount']);
const SUPPORTED_LAYER_FILTER_KINDS: readonly LayerFilterKind[] = [
  'grayscale',
  'invert',
  'sepia',
  'blur',
  'pixelate',
  'sharpen',
  'noise',
  'denoise',
];

export function describeLayerFilterStack(
  filters: readonly ImageLayerFilter[] | undefined,
  options: LayerFilterStackDescriptorOptions = {},
): LayerFilterStackDescriptor {
  let affectedBounds = normalizeFilterBounds(options.sourceBounds);
  const descriptors: LayerFilterDescriptor[] = [];

  (filters ?? []).forEach((filter, order) => {
    if (filter.enabled) {
      affectedBounds = expandFilterBounds(affectedBounds, layerFilterExpansion(filter));
    }
    const signatureItem = createLayerFilterSignatureItem(filter, order, affectedBounds, true);
    descriptors.push({
      id: filter.id,
      kind: filter.kind,
      family: layerFilterFamily(filter.kind),
      label: layerFilterLabel(filter.kind),
      enabled: filter.enabled,
      amount: filter.amount,
      opacity: filter.opacity ?? 1,
      blendMode: filter.blendMode ?? 'normal',
      order,
      affectedBounds,
      previewSignature: `filter:v1:${JSON.stringify(signatureItem)}`,
      parameterCaveats: getLayerFilterParameterCaveats(filter, options),
    });
  });

  return {
    filters: descriptors,
    affectedBounds,
    previewSignature: buildLayerFilterStackPreviewSignature(filters, descriptors, true),
    warnings: getUnsupportedLayerFilterWarnings(options),
  };
}

export function getUnsupportedLayerFilterWarnings(
  options: LayerFilterStackDescriptorOptions = {},
): string[] {
  const warnings: string[] = [];
  if (options.smartFilterMask === 'present') {
    warnings.push(SMART_FILTER_MASK_WARNING);
  }

  const seenParameterTypes = new Set<LayerFilterParameterType>();
  for (const parameterType of options.parameterTypes ?? []) {
    if (SUPPORTED_LAYER_FILTER_PARAMETER_TYPES.has(parameterType) || seenParameterTypes.has(parameterType)) {
      continue;
    }
    seenParameterTypes.add(parameterType);
    warnings.push(
      `Non-destructive ${parameterType} filter parameters are not supported yet; only scalar amount parameters are editable in Image filter stacks.`,
    );
  }

  return warnings;
}

export function describeLayerFilterStackInterop(
  filters: readonly ImageLayerFilter[] | undefined,
  options: LayerFilterStackInteropOptions = {},
): LayerFilterStackInteropDescriptor {
  const descriptor = describeLayerFilterStack(filters, options);
  const exportTarget = options.exportTarget ?? 'editable';
  const smartFilterMask = options.smartFilterMask ?? 'absent';
  const unsupportedParameters = getUnsupportedLayerFilterParameterTypes(getLayerFilterStackParameterTypes(options));
  const orderItems = descriptor.filters.map((filter) => ({
    order: filter.order,
    kind: filter.kind,
    enabled: filter.enabled,
    opacity: filter.opacity,
    blendMode: filter.blendMode,
  }));
  const stackSignatures = getLayerFilterStackSignatures(descriptor.filters);
  const previewItems = descriptor.filters.map((filter) => {
    const mask = filters?.[filter.order]?.mask;
    return {
      order: filter.order,
      id: filter.id,
      kind: filter.kind,
      enabled: filter.enabled,
      amount: filter.amount,
      opacity: filter.opacity,
      blendMode: filter.blendMode,
      bounds: filter.affectedBounds,
      ...(mask ? { mask: getLayerFilterMaskSignature(mask) } : {}),
    };
  });
  const exportItems = previewItems.map(({ id: _id, ...item }) => item);
  const smartFilterMaskDescriptor = getLayerFilterSmartMaskDescriptor(smartFilterMask);
  const rasterizationWarnings = getLayerFilterRasterizationWarnings(exportTarget, descriptor.filters);
  const exportFlattening = getLayerFilterExportFlattening(
    exportTarget,
    descriptor.filters,
    smartFilterMaskDescriptor,
    unsupportedParameters,
    rasterizationWarnings,
  );
  const previewSignature = `layer-filter-preview:v1:${JSON.stringify({
    filters: previewItems,
    smartFilterMask,
  })}`;
  const presetPortability = getLayerFilterPresetPortability(
    descriptor.filters,
    smartFilterMaskDescriptor,
    unsupportedParameters,
  );

  return {
    filters: descriptor.filters,
    affectedBounds: descriptor.affectedBounds,
    blendOrderSignature: `layer-filter-order:v1:${JSON.stringify(orderItems)}`,
    previewSignature,
    exportSignature: `layer-filter-export:v1:${JSON.stringify({
      target: exportTarget,
      filters: exportItems,
      smartFilterMask,
      unsupportedParameters,
    })}`,
    rasterizationWarnings,
    caveats: descriptor.warnings,
    smartFilterMask: smartFilterMaskDescriptor,
    filterFamilyGaps: getLayerFilterFamilyGaps(),
    previewReadiness: getLayerFilterPreviewReadiness(previewSignature, smartFilterMaskDescriptor, unsupportedParameters),
    controlReadiness: getLayerFilterControlReadiness(smartFilterMaskDescriptor),
    stackSignatures,
    presetPortability,
    exportFlattening,
    nonDestructiveLimits: getLayerFilterNonDestructiveLimits(smartFilterMaskDescriptor, unsupportedParameters),
    smartFilterStyleLimits: getLayerFilterSmartFilterStyleLimits(smartFilterMaskDescriptor),
    portability: getLayerFilterStackPortability(smartFilterMaskDescriptor, unsupportedParameters),
  };
}

export function describeEditableFilterStackReadiness(
  filters: readonly ImageLayerFilter[] | undefined,
  options: LayerFilterStackInteropOptions = {},
): EditableLayerFilterStackReadiness {
  const interop = describeLayerFilterStackInterop(filters, options);
  return {
    supportedFilters: getEditableLayerFilterSupportSummary(),
    stackControls: {
      reorder: interop.controlReadiness.reorder,
      opacity: interop.controlReadiness.opacity,
      blendMode: interop.controlReadiness.blendMode,
      enabled: interop.controlReadiness.enabled,
      amount: interop.controlReadiness.amount,
    },
    paritySignatures: {
      preview: interop.previewSignature,
      export: interop.exportSignature,
      order: interop.stackSignatures.order,
      blend: interop.stackSignatures.blend,
      opacity: interop.stackSignatures.opacity,
    },
    blockers: getEditableLayerFilterStackBlockers(interop),
    interop,
  };
}

export function describeLayerFilterActionReadiness(
  filters: readonly ImageLayerFilter[] | undefined,
  options: LayerFilterActionReadinessOptions = {},
): LayerFilterActionReadiness {
  const interop = describeLayerFilterStackInterop(filters, options);
  const layerMetadata = getLayerFilterActionLayerMetadata(filters, options);
  const unsupportedStates = getLayerFilterUnsupportedStates(options);
  const blockers = getLayerFilterActionBlockers(filters, interop, layerMetadata, unsupportedStates, options);
  const blocked = blockers.some((blocker) => blocker.severity === 'blocking');

  return {
    supportedStack: getEditableLayerFilterSupportSummary(),
    layerMetadata,
    semantics: {
      preview: 'non-destructive-live',
      commit: blocked ? 'blocked' : 'metadata-stack',
      preservesSourcePixels: true,
      mutatesPixelsOnCommit: false,
      previewSignature: interop.previewSignature,
      commitSignature: interop.exportSignature,
    },
    unsupportedStates,
    blockers,
    batchSuitability: getLayerFilterBatchSuitability(filters, layerMetadata, blockers, options),
    interop,
  };
}

export function serializeLayerFilterStackPreset(
  label: string,
  filters: readonly ImageLayerFilter[] | undefined,
  options: LayerFilterStackDescriptorOptions = {},
): LayerFilterStackPreset | null {
  const descriptor = describeLayerFilterStack(filters, options);
  // Presets intentionally carry reusable filter parameters only. Refuse rather
  // than silently dropping an owned alpha grid from a source-layer stack.
  if (descriptor.warnings.length > 0 || options.smartFilterMask === 'local') return null;
  return {
    version: 1,
    label: normalizeLayerFilterPresetLabel(label),
    filters: (filters ?? []).map((filter) => ({
      kind: filter.kind,
      enabled: filter.enabled,
      amount: filter.amount,
      opacity: filter.opacity ?? 1,
      blendMode: filter.blendMode ?? 'normal',
    })),
    previewSignature: buildLayerFilterStackPreviewSignature(filters, descriptor.filters, false),
  };
}

export function materializeLayerFilterStackPreset(
  preset: LayerFilterStackPreset,
  options: LayerFilterStackPresetMaterializeOptions = {},
): LayerFilterStackPresetMaterialization {
  const idPrefix = normalizeLayerFilterPresetIdPrefix(options.idPrefix ?? preset.label);
  const filters = preset.filters.map((filter, index): ImageLayerFilter => ({
    id: `${idPrefix}-${filter.kind}-${index}`,
    kind: filter.kind,
    enabled: filter.enabled,
    amount: filter.amount,
    opacity: filter.opacity ?? 1,
    blendMode: filter.blendMode ?? 'normal',
  }));
  const descriptor = describeLayerFilterStack(filters, options);
  const presetSignature = buildLayerFilterStackPreviewSignature(filters, descriptor.filters, false);
  return {
    filters,
    presetSignature,
    replaySignature: `layer-filter-preset-replay:v1:${JSON.stringify({
      label: preset.label,
      filterKinds: filters.map((filter) => filter.kind),
      filterIds: filters.map((filter) => filter.id),
      previewSignature: presetSignature,
    })}`,
    warnings: descriptor.warnings,
  };
}

export function applyLayerFilterStackEditOperation(
  filters: readonly ImageLayerFilter[] | undefined,
  operation: LayerFilterStackEditOperation,
  options: LayerFilterStackInteropOptions = {},
): LayerFilterStackEditResult {
  const sourceFilters = cloneLayerFilterStack(filters);
  const filterIndex = sourceFilters.findIndex((filter) => filter.id === operation.filterId);
  if (filterIndex < 0) {
    return createLayerFilterStackEditResult(sourceFilters, false, [{
      code: 'filter-not-found',
      severity: 'blocking',
      filterId: operation.filterId,
      message: `Cannot edit filter "${operation.filterId}" because it is not in the editable stack.`,
    }], options);
  }

  const filter = sourceFilters[filterIndex];
  const blocker = getLayerFilterStackEditBlocker(filter, sourceFilters.length, operation);
  if (blocker) {
    return createLayerFilterStackEditResult(sourceFilters, false, [blocker], options);
  }

  const editedFilters = cloneLayerFilterStack(sourceFilters);
  let changed = false;
  switch (operation.type) {
    case 'reorder': {
      const [moved] = editedFilters.splice(filterIndex, 1);
      editedFilters.splice(operation.toIndex, 0, moved);
      changed = filterIndex !== operation.toIndex;
      break;
    }
    case 'set-opacity':
      editedFilters[filterIndex] = {
        ...editedFilters[filterIndex],
        opacity: operation.opacity,
      };
      changed = sourceFilters[filterIndex].opacity !== operation.opacity;
      break;
    case 'set-blend-mode':
      editedFilters[filterIndex] = {
        ...editedFilters[filterIndex],
        blendMode: operation.blendMode,
      };
      changed = sourceFilters[filterIndex].blendMode !== operation.blendMode;
      break;
    case 'set-enabled':
      editedFilters[filterIndex] = {
        ...editedFilters[filterIndex],
        enabled: operation.enabled,
      };
      changed = sourceFilters[filterIndex].enabled !== operation.enabled;
      break;
    case 'set-amount':
      editedFilters[filterIndex] = {
        ...editedFilters[filterIndex],
        amount: operation.amount,
      };
      changed = sourceFilters[filterIndex].amount !== operation.amount;
      break;
  }

  return createLayerFilterStackEditResult(editedFilters, changed, [], options);
}

export function createDefaultLayerFilter(kind: LayerFilterKind): ImageLayerFilter {
  return {
    id: `filter-${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    kind,
    enabled: true,
    amount: defaultFilterAmount(kind),
    opacity: 1,
    blendMode: 'normal',
  };
}

function createLayerFilterStackEditResult(
  filters: readonly ImageLayerFilter[],
  changed: boolean,
  blockers: LayerFilterStackEditBlocker[],
  options: LayerFilterStackInteropOptions,
): LayerFilterStackEditResult {
  const clonedFilters = cloneLayerFilterStack(filters);
  const interop = describeLayerFilterStackInterop(clonedFilters, options);
  return {
    filters: clonedFilters,
    changed,
    blockers,
    signatures: interop.stackSignatures,
    previewSignature: interop.previewSignature,
    exportSignature: interop.exportSignature,
  };
}

function getLayerFilterStackEditBlocker(
  filter: ImageLayerFilter,
  stackLength: number,
  operation: LayerFilterStackEditOperation,
): LayerFilterStackEditBlocker | null {
  switch (operation.type) {
    case 'reorder':
      if (!Number.isInteger(operation.toIndex) || operation.toIndex < 0 || operation.toIndex >= stackLength) {
        return {
          code: 'filter-order-out-of-range',
          severity: 'blocking',
          filterId: operation.filterId,
          message: `Cannot move ${layerFilterLabel(filter.kind)} to stack index ${operation.toIndex}; valid indexes are 0 through ${Math.max(0, stackLength - 1)}.`,
        };
      }
      return null;
    case 'set-opacity':
      if (!Number.isFinite(operation.opacity) || operation.opacity < 0 || operation.opacity > 1) {
        return {
          code: 'invalid-filter-opacity',
          severity: 'blocking',
          filterId: operation.filterId,
          message: `${layerFilterLabel(filter.kind)} has an invalid opacity; filter opacity must be between 0 and 1.`,
        };
      }
      return null;
    case 'set-amount':
      if (!Number.isFinite(operation.amount) || operation.amount < 0) {
        return {
          code: 'invalid-filter-amount',
          severity: 'blocking',
          filterId: operation.filterId,
          message: `${layerFilterLabel(filter.kind)} has an invalid amount; filter amounts must be finite numbers at or above 0.`,
        };
      }
      return null;
    case 'set-blend-mode':
      return null;
    case 'set-enabled':
      return null;
  }
}

function cloneLayerFilterStack(filters: readonly ImageLayerFilter[] | undefined): ImageLayerFilter[] {
  return (filters ?? []).map((filter) => ({
    id: filter.id,
    kind: filter.kind,
    enabled: filter.enabled,
    amount: filter.amount,
    opacity: filter.opacity ?? 1,
    blendMode: filter.blendMode ?? 'normal',
    mask: filter.mask
      ? { width: filter.mask.width, height: filter.mask.height, alpha: [...filter.mask.alpha] }
      : undefined,
  }));
}

function getEditableLayerFilterSupportSummary(): EditableLayerFilterSupportSummary[] {
  return SUPPORTED_LAYER_FILTER_KINDS.map((kind) => ({
    kind,
    family: layerFilterFamily(kind),
    label: layerFilterLabel(kind),
    defaultAmount: defaultFilterAmount(kind),
  }));
}

function getEditableLayerFilterStackBlockers(
  interop: LayerFilterStackInteropDescriptor,
): EditableLayerFilterStackBlocker[] {
  const blockers: EditableLayerFilterStackBlocker[] = [];
  if (interop.smartFilterMask.status === 'unsupported' && interop.smartFilterMask.warning) {
    blockers.push({
      code: 'smart-filter-mask-unsupported',
      severity: 'blocking',
      message: interop.smartFilterMask.warning,
    });
  }
  if (interop.nonDestructiveLimits.includes('Unsupported filter parameters require rasterization or lossy preset omission.')) {
    blockers.push({
      code: 'advanced-filter-parameters-unsupported',
      severity: 'blocking',
      message: 'Unsupported filter parameters require rasterization or lossy preset omission.',
    });
  }
  if (interop.exportFlattening.willRasterize) {
    const rasterWarning = interop.exportFlattening.warnings.find((warning) => (
      warning === 'Layer filter stacks are rasterized into flattened exports; editable smart-filter roundtrip is not preserved.'
    ));
    if (rasterWarning) {
      blockers.push({
        code: 'flattened-export-rasterizes-stack',
        severity: 'warning',
        message: rasterWarning,
      });
    }
  }
  return blockers;
}

function getLayerFilterActionLayerMetadata(
  filters: readonly ImageLayerFilter[] | undefined,
  options: LayerFilterActionReadinessOptions,
): LayerFilterActionLayerMetadata {
  const sourceBinHandoff = getLayerFilterSourceBinHandoffReadiness(options.layer, options.visibleExportTarget);
  return {
    layerId: options.layer?.id ?? null,
    layerName: options.layer?.name ?? 'Active layer',
    layerType: options.layer?.type ?? 'unknown',
    visible: options.layer?.visible ?? true,
    locked: options.layer?.locked ?? false,
    hasBitmap: options.layer?.hasBitmap ?? true,
    sourceBinId: options.layer?.sourceBinId,
    filterCount: filters?.length ?? 0,
    enabledFilterCount: (filters ?? []).filter((filter) => filter.enabled).length,
    filterKinds: (filters ?? []).map((filter) => filter.kind),
    sourceBinHandoff,
  };
}

function getLayerFilterSourceBinHandoffReadiness(
  layer: LayerFilterActionLayerMetadataInput | undefined,
  visibleExportTarget: LayerFilterActionReadinessOptions['visibleExportTarget'],
): LayerFilterSourceBinHandoffReadiness {
  const warnings: string[] = [];
  const visibleExportRequired = visibleExportTarget === 'source-bin' || visibleExportTarget === 'suite-handoff';
  if (visibleExportRequired && layer?.visible === false) {
    warnings.push('Visible source-bin handoff is blocked because the layer is hidden.');
  }
  if (visibleExportTarget === 'source-bin' && !layer?.sourceBinId) {
    warnings.push(
      'Visible source-bin handoff cannot preserve editable layer filter metadata; export a flattened preview plus source metadata.',
    );
  }
  return {
    status: warnings.some((warning) => warning.includes('blocked')) ? 'blocked' : warnings.length > 0 ? 'warning' : 'safe',
    visibleExportRequired,
    warnings,
  };
}

function getLayerFilterUnsupportedStates(
  options: LayerFilterActionReadinessOptions,
): LayerFilterUnsupportedState[] {
  return [
    {
      code: 'filter-gallery-unsupported',
      status: 'unsupported',
      message: options.galleryFilterRequested
        ? `${options.galleryFilterRequested} is not available as an editable Image filter stack; use a supported filter or flatten externally.`
        : 'Photoshop Filter Gallery effects are not available as editable Image filter stacks; use supported scalar filters or flatten externally.',
    },
    {
      code: 'native-smart-filter-roundtrip-unsupported',
      status: 'unsupported',
      message: 'Native Photoshop Smart Filters are metadata-only in Image and cannot roundtrip as editable native smart filters.',
    },
  ];
}

function getLayerFilterActionBlockers(
  filters: readonly ImageLayerFilter[] | undefined,
  interop: LayerFilterStackInteropDescriptor,
  layerMetadata: LayerFilterActionLayerMetadata,
  unsupportedStates: readonly LayerFilterUnsupportedState[],
  options: LayerFilterActionReadinessOptions,
): LayerFilterActionBlocker[] {
  const blockers: LayerFilterActionBlocker[] = [];
  if (layerMetadata.locked) {
    blockers.push({
      code: 'layer-locked',
      severity: 'blocking',
      message: 'Layer filters cannot be committed while the target layer is locked.',
    });
  }
  if (!layerMetadata.hasBitmap && layerMetadata.filterCount > 0) {
    blockers.push({
      code: 'missing-pixel-source',
      severity: 'blocking',
      message: 'Layer filters need a bitmap-backed layer or flattened visible source before preview or commit.',
    });
  }
  for (const filter of filters ?? []) {
    if (!Number.isFinite(filter.amount) || filter.amount < 0) {
      blockers.push({
        code: 'invalid-filter-amount',
        severity: 'blocking',
        filterId: filter.id,
        message: `${layerFilterLabel(filter.kind)} has an invalid amount; filter amounts must be finite numbers at or above 0.`,
      });
    }
    if (!Number.isFinite(filter.opacity) || filter.opacity < 0 || filter.opacity > 1) {
      blockers.push({
        code: 'invalid-filter-opacity',
        severity: 'blocking',
        filterId: filter.id,
        message: `${layerFilterLabel(filter.kind)} has an invalid opacity; filter opacity must be between 0 and 1.`,
      });
    }
  }
  for (const blocker of getEditableLayerFilterStackBlockers(interop)) {
    if (blocker.code === 'flattened-export-rasterizes-stack') continue;
    blockers.push({
      code: blocker.code,
      severity: blocker.severity,
      message: blocker.message,
    });
  }
  if (options.galleryFilterRequested) {
    const galleryState = unsupportedStates.find((state) => state.code === 'filter-gallery-unsupported');
    if (galleryState) {
      blockers.push({
        code: 'filter-gallery-unsupported',
        severity: 'blocking',
        message: galleryState.message,
      });
    }
  }
  if (options.nativeSmartFilterRequested) {
    const smartFilterState = unsupportedStates.find((state) => (
      state.code === 'native-smart-filter-roundtrip-unsupported'
    ));
    if (smartFilterState) {
      blockers.push({
        code: 'native-smart-filter-roundtrip-unsupported',
        severity: 'blocking',
        message: smartFilterState.message,
      });
    }
  }
  const blockingHandoffWarning = layerMetadata.sourceBinHandoff.warnings.find((warning) => warning.includes('blocked'));
  if (blockingHandoffWarning) {
    blockers.push({
      code: 'visible-source-bin-handoff-blocked',
      severity: 'blocking',
      message: blockingHandoffWarning,
    });
  }
  return blockers;
}

function getLayerFilterBatchSuitability(
  filters: readonly ImageLayerFilter[] | undefined,
  layerMetadata: LayerFilterActionLayerMetadata,
  blockers: readonly LayerFilterActionBlocker[],
  options: LayerFilterActionReadinessOptions,
): LayerFilterBatchSuitability {
  const blockingCodes = blockers
    .filter((blocker) => blocker.severity === 'blocking')
    .map((blocker) => blocker.code);
  const warnings = [
    'Batch replay targets the active layer and preserves filter metadata only when the destination layer supports Image filter stacks.',
  ];
  if (options.visibleExportTarget === 'source-bin') {
    warnings.push(
      'Source Bin handoff preserves flattened preview pixels plus metadata only; editable smart-filter order, blend mode, and opacity stay local to Image.',
    );
  }
  if (options.visibleExportTarget === 'suite-handoff') {
    warnings.push(
      'Video handoff preserves flattened visible pixels plus metadata only; editable smart-filter order, blend mode, and opacity stay local to Image.',
    );
  }
  if (!options.batchMode) {
    warnings.push('Batch/action suitability was described without enabling batch mode; treat this as planning metadata only.');
  }
  return {
    status: blockingCodes.length > 0 ? 'blocked' : 'suitable',
    deterministic: true,
    actionRecordable: blockingCodes.length === 0,
    replayTarget: 'active-layer',
    signature: `layer-filter-batch:v1:${JSON.stringify({
      layerType: layerMetadata.layerType,
      filterKinds: (filters ?? []).map((filter) => filter.kind),
      enabledFilterCount: layerMetadata.enabledFilterCount,
      blockers: blockingCodes,
      visibleExportTarget: options.visibleExportTarget ?? null,
    })}`,
    warnings,
  };
}

function getUnsupportedLayerFilterParameterTypes(
  parameterTypes: readonly LayerFilterParameterType[],
): LayerFilterParameterType[] {
  const seen = new Set<LayerFilterParameterType>();
  const unsupported: LayerFilterParameterType[] = [];
  for (const parameterType of parameterTypes) {
    if (SUPPORTED_LAYER_FILTER_PARAMETER_TYPES.has(parameterType) || seen.has(parameterType)) continue;
    seen.add(parameterType);
    unsupported.push(parameterType);
  }
  return unsupported;
}

function getLayerFilterStackParameterTypes(
  options: LayerFilterStackDescriptorOptions,
): LayerFilterParameterType[] {
  return [
    ...(options.parameterTypes ?? []),
    ...Object.values(options.parameterTypesByFilterId ?? {}).flat(),
  ];
}

function getLayerFilterParameterCaveats(
  filter: ImageLayerFilter,
  options: LayerFilterStackDescriptorOptions,
): LayerFilterParameterCaveat[] {
  return getUnsupportedLayerFilterParameterTypes(options.parameterTypesByFilterId?.[filter.id] ?? [])
    .map((parameterType) => ({
      parameterType,
      warning:
        `Non-destructive ${parameterType} parameters for ${layerFilterLabel(filter.kind)} are not supported yet; only scalar amount is editable.`,
    }));
}

function getLayerFilterSmartMaskDescriptor(
  smartFilterMask: 'absent' | 'local' | 'present',
): LayerFilterSmartMaskDescriptor {
  if (smartFilterMask === 'local') {
    return {
      status: 'editable-local',
      warning:
        'Per-filter alpha masks stay editable and composited in Sloom Studio; native Photoshop Smart Filter masks are not round-tripped.',
    };
  }
  if (smartFilterMask === 'present') {
    return {
      status: 'unsupported',
      warning: SMART_FILTER_MASK_WARNING,
    };
  }
  return { status: 'absent' };
}

function getLayerFilterFamilyGaps(): LayerFilterFamilyGap[] {
  return [
    {
      family: 'adjustment',
      implementedKinds: ['grayscale', 'invert', 'sepia'],
      missingPhotoshopFamilies: ['camera-raw', 'lens-correction', 'liquify', 'neural-filters'],
      warning:
        'Adjustment-style layer filters are limited to grayscale, invert, and sepia; Camera Raw, Lens Correction, Liquify, and Neural Filters remain unsupported as editable filters.',
    },
    {
      family: 'geometry',
      implementedKinds: ['blur', 'pixelate', 'sharpen'],
      missingPhotoshopFamilies: ['adaptive-blur', 'field-blur', 'motion-blur', 'smart-sharpen'],
      warning:
        'Geometry filters cover basic blur, sharpen, and pixelate only; adaptive blur, Field Blur, Motion Blur, and Smart Sharpen controls remain unsupported.',
    },
    {
      family: 'texture',
      implementedKinds: ['noise'],
      missingPhotoshopFamilies: ['add-grain', 'clouds', 'render-lighting', 'texture-gallery'],
      warning:
        'Texture filters only expose deterministic noise; grain, clouds, lighting, and gallery textures remain unsupported.',
    },
    {
      family: 'photographic',
      implementedKinds: ['denoise'],
      missingPhotoshopFamilies: ['camera-raw', 'lens-correction', 'chromatic-aberration', 'defringe'],
      warning:
        'Photographic correction provides a retained local impulse-noise reduction filter only; camera/lens profiles, chromatic aberration, defringe, RAW development, and learned denoise remain unsupported.',
    },
  ];
}

function getLayerFilterPreviewReadiness(
  stackSignature: string,
  smartFilterMask: LayerFilterSmartMaskDescriptor,
  unsupportedParameters: readonly LayerFilterParameterType[],
): LayerFilterPreviewReadiness {
  const gaps: string[] = [];
  if (smartFilterMask.status === 'unsupported') {
    gaps.push('Smart-filter mask previews are not composited.');
  }
  if (unsupportedParameters.length > 0) {
    gaps.push('Advanced per-filter parameter editors are not available.');
  }
  return {
    status: gaps.length > 0 ? 'partial' : 'ready',
    liveCanvasPreview: true,
    stackSignature,
    gaps,
  };
}

function getLayerFilterControlReadiness(
  smartFilterMask: LayerFilterSmartMaskDescriptor,
): LayerFilterControlReadiness {
  return {
    amount: true,
    blendMode: true,
    enabled: true,
    opacity: true,
    reorder: true,
    smartFilterMask: smartFilterMask.status !== 'unsupported',
    advancedParameters: false,
  };
}

function getLayerFilterStackSignatures(
  filters: readonly LayerFilterDescriptor[],
): LayerFilterStackSignatures {
  return {
    order: `layer-filter-order:v1:${JSON.stringify(filters.map((filter) => ({
      order: filter.order,
      kind: filter.kind,
      enabled: filter.enabled,
    })))}`,
    blend: `layer-filter-blend:v1:${JSON.stringify(filters.map((filter) => ({
      order: filter.order,
      kind: filter.kind,
      blendMode: filter.blendMode,
    })))}`,
    opacity: `layer-filter-opacity:v1:${JSON.stringify(filters.map((filter) => ({
      order: filter.order,
      kind: filter.kind,
      opacity: filter.opacity,
    })))}`,
  };
}

function getLayerFilterPresetPortability(
  filters: readonly LayerFilterDescriptor[],
  smartFilterMask: LayerFilterSmartMaskDescriptor,
  unsupportedParameters: readonly LayerFilterParameterType[],
): LayerFilterPresetPortability {
  const warnings: string[] = [];
  if (smartFilterMask.status === 'unsupported' || smartFilterMask.status === 'editable-local' || unsupportedParameters.length > 0) {
    warnings.push('Preset export is blocked while per-filter alpha masks or unsupported filter parameters are required.');
  }
  return {
    status: warnings.length > 0 ? 'blocked' : 'portable',
    signature: `layer-filter-preset:v1:${JSON.stringify(filters.map((filter) => ({
      order: filter.order,
      kind: filter.kind,
      enabled: filter.enabled,
      amount: filter.amount,
      opacity: filter.opacity,
      blendMode: filter.blendMode,
    })))}`,
    warnings,
  };
}

function getLayerFilterExportFlattening(
  exportTarget: 'editable' | 'flattened',
  filters: readonly LayerFilterDescriptor[],
  smartFilterMask: LayerFilterSmartMaskDescriptor,
  unsupportedParameters: readonly LayerFilterParameterType[],
  rasterizationWarnings: readonly string[],
): LayerFilterExportFlattening {
  const warnings = [...rasterizationWarnings];
  if (exportTarget === 'flattened'
    && filters.length > 0
    && (smartFilterMask.status === 'unsupported' || smartFilterMask.status === 'editable-local' || unsupportedParameters.length > 0)
  ) {
    warnings.push(
      'Per-filter alpha masks and advanced parameters bake into flattened output; native Smart Filter roundtrip is unsupported.',
    );
  }
  return {
    target: exportTarget,
    willRasterize: exportTarget === 'flattened' && filters.length > 0,
    warnings,
  };
}

function getLayerFilterNonDestructiveLimits(
  smartFilterMask: LayerFilterSmartMaskDescriptor,
  unsupportedParameters: readonly LayerFilterParameterType[],
): string[] {
  const limits = [
    'Editable stacks preserve order, amount, opacity, blend mode, enabled state, and owned per-filter alpha masks.',
  ];
  if (smartFilterMask.status === 'unsupported') {
    limits.push('Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.');
  }
  if (unsupportedParameters.length > 0) {
    limits.push('Unsupported filter parameters require rasterization or lossy preset omission.');
  }
  return limits;
}

function getLayerFilterSmartFilterStyleLimits(
  smartFilterMask: LayerFilterSmartMaskDescriptor,
): LayerFilterSmartFilterStyleLimit[] {
  const limits: LayerFilterSmartFilterStyleLimit[] = [];
  if (smartFilterMask.status === 'editable-local') {
    limits.push({
      id: 'mask',
      editable: true,
      portability: 'flattened-handoff',
      warning:
        'Per-filter alpha masks stay editable and composited in Sloom Studio, then bake into flattened handoff pixels; native Photoshop Smart Filter masks are not round-tripped.',
    });
  }
  if (smartFilterMask.status === 'unsupported') {
    limits.push({
      id: 'mask',
      editable: false,
      portability: 'metadata-only',
      warning: 'Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.',
    });
  }
  limits.push(
    {
      id: 'blend-mode',
      editable: true,
      portability: 'flattened-handoff',
      warning:
        'Per-filter blend modes stay editable in Sloom Studio but flatten into preview/export pixels for native smart-filter handoff.',
    },
    {
      id: 'opacity',
      editable: true,
      portability: 'flattened-handoff',
      warning:
        'Per-filter opacity stays editable in Sloom Studio metadata but is baked into flattened preview/export pixels.',
    },
    {
      id: 'order',
      editable: true,
      portability: 'flattened-handoff',
      warning:
        'Per-filter order stays deterministic in Sloom Studio metadata but does not roundtrip as editable native smart-filter order.',
    },
  );
  return limits;
}

function getLayerFilterStackPortability(
  smartFilterMask: LayerFilterSmartMaskDescriptor,
  unsupportedParameters: readonly LayerFilterParameterType[],
): LayerFilterStackPortability {
  const warnings: string[] = [];
  if (smartFilterMask.status === 'unsupported') {
    warnings.push('Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.');
  }
  if (unsupportedParameters.length > 0) {
    warnings.push('Unsupported filter parameters require rasterization or lossy preset omission.');
  }
  warnings.push(
    'Source Bin and Video handoff preserve flattened pixels plus Sloom Studio metadata only; editable native smart-filter roundtrip is unavailable.',
  );
  return {
    portableWithinSignalLoom: warnings.length === 1,
    portableAcrossSignalLoomDocuments: warnings.length === 1,
    portableAsEditablePhotoshopSmartFilters: false,
    sourceBinVisibleExport: 'flattened-preview-plus-metadata',
    suiteVideoHandoff: 'flattened-visible-raster-plus-metadata',
    warnings,
    signature: `layer-filter-portability:v1:${JSON.stringify({
      portableWithinSignalLoom: warnings.length === 1,
      portableAcrossSignalLoomDocuments: warnings.length === 1,
      portableAsEditablePhotoshopSmartFilters: false,
      sourceBinVisibleExport: 'flattened-preview-plus-metadata',
      suiteVideoHandoff: 'flattened-visible-raster-plus-metadata',
      warnings,
    })}`,
  };
}

function getLayerFilterRasterizationWarnings(
  exportTarget: 'editable' | 'flattened',
  filters: readonly LayerFilterDescriptor[],
): string[] {
  return exportTarget === 'flattened' && filters.length > 0
    ? ['Layer filter stacks are rasterized into flattened exports; editable smart-filter roundtrip is not preserved.']
    : [];
}

function buildLayerFilterStackPreviewSignature(
  filters: readonly ImageLayerFilter[] | undefined,
  descriptors: readonly LayerFilterDescriptor[],
  includeIds: boolean,
): string {
  const signatureItems = (filters ?? []).map((filter, order) => (
    createLayerFilterSignatureItem(filter, order, descriptors[order]?.affectedBounds, includeIds)
  ));
  return `filter-stack:v1:${JSON.stringify(signatureItems)}`;
}

function createLayerFilterSignatureItem(
  filter: ImageLayerFilter,
  order: number,
  bounds: LayerFilterBounds | undefined,
  includeId: boolean,
): Record<string, unknown> {
  return includeId
    ? {
        order,
        id: filter.id,
        kind: filter.kind,
        enabled: filter.enabled,
        amount: filter.amount,
        opacity: filter.opacity ?? 1,
        blendMode: filter.blendMode ?? 'normal',
        bounds: normalizeFilterBounds(bounds),
        ...(filter.mask ? { mask: getLayerFilterMaskSignature(filter.mask) } : {}),
      }
    : {
        order,
        kind: filter.kind,
        enabled: filter.enabled,
        amount: filter.amount,
        opacity: filter.opacity ?? 1,
        blendMode: filter.blendMode ?? 'normal',
        bounds: normalizeFilterBounds(bounds),
        ...(filter.mask ? { mask: getLayerFilterMaskSignature(filter.mask) } : {}),
      };
}

function getLayerFilterMaskSignature(mask: ImageLayerFilterMask): string {
  const width = Number.isFinite(mask.width) ? Math.max(0, Math.floor(mask.width)) : 0;
  const height = Number.isFinite(mask.height) ? Math.max(0, Math.floor(mask.height)) : 0;
  const pixelCount = width * height;
  if (
    width < 1
    || height < 1
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > MAX_LAYER_FILTER_MASK_SIGNATURE_CELLS
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

function normalizeFilterBounds(bounds: LayerFilterBounds | undefined): LayerFilterBounds {
  return {
    x: normalizeFiniteNumber(bounds?.x, 0),
    y: normalizeFiniteNumber(bounds?.y, 0),
    width: Math.max(0, normalizeFiniteNumber(bounds?.width, 0)),
    height: Math.max(0, normalizeFiniteNumber(bounds?.height, 0)),
  };
}

function normalizeFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function layerFilterExpansion(filter: ImageLayerFilter): number {
  if (!filter.enabled) return 0;
  switch (filter.kind) {
    case 'blur':
      return Math.max(0, Math.round(filter.amount));
    case 'sharpen':
      return filter.amount > 0 ? 1 : 0;
    case 'grayscale':
    case 'sepia':
    case 'invert':
    case 'noise':
    case 'pixelate':
    case 'denoise':
      return 0;
  }
}

function expandFilterBounds(bounds: LayerFilterBounds, expansion: number): LayerFilterBounds {
  if (expansion <= 0) return bounds;
  return {
    x: bounds.x - expansion,
    y: bounds.y - expansion,
    width: bounds.width + expansion * 2,
    height: bounds.height + expansion * 2,
  };
}

function normalizeLayerFilterPresetLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'Filter Stack';
}

function normalizeLayerFilterPresetIdPrefix(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized.length > 0 ? normalized : 'filter-stack';
}

export function layerFilterLabel(kind: LayerFilterKind): string {
  switch (kind) {
    case 'blur':
      return 'Blur';
    case 'sharpen':
      return 'Sharpen';
    case 'grayscale':
      return 'Grayscale';
    case 'sepia':
      return 'Sepia';
    case 'invert':
      return 'Invert';
    case 'noise':
      return 'Noise';
    case 'pixelate':
      return 'Pixelate';
    case 'denoise':
      return 'Reduce Noise';
  }
}

function layerFilterFamily(kind: LayerFilterKind): LayerFilterFamily {
  switch (kind) {
    case 'grayscale':
    case 'invert':
    case 'sepia':
      return 'adjustment';
    case 'blur':
    case 'pixelate':
    case 'sharpen':
      return 'geometry';
    case 'noise':
      return 'texture';
    case 'denoise':
      return 'photographic';
  }
}

export function applyLayerFiltersToImageData(
  imageData: ImageData,
  filters: ImageLayerFilter[] | undefined,
): ImageData {
  let output = cloneImageData(imageData);
  for (const filter of filters ?? []) {
    if (!filter.enabled) continue;
    const source = cloneImageData(output);
    let filtered = source;
    switch (filter.kind) {
      case 'blur':
        filtered = applyBoxBlur(source, filter.amount);
        break;
      case 'sharpen':
        filtered = applySharpen(source, filter.amount);
        break;
      case 'grayscale':
        filtered = applyGrayscale(source, filter.amount);
        break;
      case 'sepia':
        filtered = applySepia(source, filter.amount);
        break;
      case 'invert':
        filtered = applyInvert(source, filter.amount);
        break;
      case 'noise':
        filtered = applyNoise(source, filter.amount);
        break;
      case 'denoise':
        filtered = applyDenoise(source, filter.amount);
        break;
      case 'pixelate':
        filtered = applyPixelate(source, filter.amount);
        break;
    }
    output = blendImageData(source, filtered, filter.opacity, filter.blendMode, filter.mask);
  }
  return output;
}

function blendImageData(
  source: ImageData,
  filtered: ImageData,
  opacity: number | undefined,
  blendMode: BlendMode | undefined,
  mask: ImageLayerFilterMask | undefined,
): ImageData {
  const amount = clampUnit(opacity ?? 1);
  const mode = blendMode ?? 'normal';
  if (amount >= 1 && mode === 'normal' && !mask) return filtered;
  if (amount <= 0) return source;
  const output = cloneImageData(source);
  forEachPixel(output, (offset) => {
    const pixel = offset / 4;
    const x = pixel % output.width;
    const y = Math.floor(pixel / output.width);
    const maskAlpha = mask ? readFilterMaskAlpha(mask, x, y, output.width, output.height) : 255;
    const effectiveAmount = amount * (maskAlpha / 255);
    output.data[offset] = blendRgbByte(source.data[offset], filtered.data[offset], effectiveAmount, mode);
    output.data[offset + 1] = blendRgbByte(source.data[offset + 1], filtered.data[offset + 1], effectiveAmount, mode);
    output.data[offset + 2] = blendRgbByte(source.data[offset + 2], filtered.data[offset + 2], effectiveAmount, mode);
    output.data[offset + 3] = blendByte(source.data[offset + 3], filtered.data[offset + 3], effectiveAmount);
  });
  if (mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity') {
    forEachPixel(output, (offset) => {
      const rgb = blendHslMode(
        source.data[offset],
        source.data[offset + 1],
        source.data[offset + 2],
        filtered.data[offset],
        filtered.data[offset + 1],
        filtered.data[offset + 2],
        mode,
      );
      const pixel = offset / 4;
      const x = pixel % output.width;
      const y = Math.floor(pixel / output.width);
      const effectiveAmount = amount * (mask ? readFilterMaskAlpha(mask, x, y, output.width, output.height) / 255 : 1);
      output.data[offset] = blendByte(source.data[offset], rgb[0], effectiveAmount);
      output.data[offset + 1] = blendByte(source.data[offset + 1], rgb[1], effectiveAmount);
      output.data[offset + 2] = blendByte(source.data[offset + 2], rgb[2], effectiveAmount);
    });
  }
  return output;
}

export function createLayerFilterMask(width: number, height: number, fill = 255): ImageLayerFilterMask {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const value = Math.max(0, Math.min(255, Math.round(fill)));
  return { width: safeWidth, height: safeHeight, alpha: Array(safeWidth * safeHeight).fill(value) };
}

export function setLayerFilterMaskCoverage(mask: ImageLayerFilterMask, coverage: number): ImageLayerFilterMask {
  const value = Math.max(0, Math.min(255, Math.round(coverage * 255)));
  return { ...mask, alpha: mask.alpha.map(() => value) };
}

function readFilterMaskAlpha(mask: ImageLayerFilterMask, x: number, y: number, outputWidth: number, outputHeight: number): number {
  if (mask.width < 1 || mask.height < 1 || mask.alpha.length < mask.width * mask.height) return 255;
  const sourceX = Math.min(mask.width - 1, Math.max(0, Math.floor((x / Math.max(1, outputWidth)) * mask.width)));
  const sourceY = Math.min(mask.height - 1, Math.max(0, Math.floor((y / Math.max(1, outputHeight)) * mask.height)));
  const value = mask.alpha[sourceY * mask.width + sourceX];
  return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 255;
}

function blendByte(source: number, filtered: number, opacity: number): number {
  return clampByte(Math.round(source + (filtered - source) * opacity));
}

function blendRgbByte(source: number, filtered: number, opacity: number, blendMode: BlendMode): number {
  if (blendMode === 'hue' || blendMode === 'saturation' || blendMode === 'color' || blendMode === 'luminosity') {
    return source;
  }
  const base = source / 255;
  const blend = filtered / 255;
  const composed = composeBlendChannel(base, blend, blendMode);
  return blendByte(source, clampByte(composed * 255), opacity);
}

function composeBlendChannel(base: number, blend: number, mode: BlendMode): number {
  switch (mode) {
    case 'normal':
      return blend;
    case 'multiply':
      return base * blend;
    case 'screen':
      return 1 - (1 - base) * (1 - blend);
    case 'overlay':
      return base <= 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);
    case 'darken':
      return Math.min(base, blend);
    case 'lighten':
      return Math.max(base, blend);
    case 'color-dodge':
      return blend >= 1 ? 1 : Math.min(1, base / (1 - blend));
    case 'color-burn':
      return blend <= 0 ? 0 : 1 - Math.min(1, (1 - base) / blend);
    case 'hard-light':
      return blend <= 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);
    case 'soft-light':
      return blend <= 0.5
        ? base - (1 - 2 * blend) * base * (1 - base)
        : base + (2 * blend - 1) * (softLightHelper(base) - base);
    case 'difference':
      return Math.abs(base - blend);
    case 'exclusion':
      return base + blend - 2 * base * blend;
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return blend;
  }
}

function softLightHelper(value: number): number {
  return value <= 0.25
    ? ((16 * value - 12) * value + 4) * value
    : Math.sqrt(value);
}

function blendHslMode(
  sourceR: number,
  sourceG: number,
  sourceB: number,
  filteredR: number,
  filteredG: number,
  filteredB: number,
  blendMode: Extract<BlendMode, 'hue' | 'saturation' | 'color' | 'luminosity'>,
): [number, number, number] {
  const [sourceHue, sourceSat, sourceLight] = rgbToHsl(sourceR, sourceG, sourceB);
  const [filteredHue, filteredSat, filteredLight] = rgbToHsl(filteredR, filteredG, filteredB);
  switch (blendMode) {
    case 'hue':
      return hslToRgb(filteredHue, sourceSat, sourceLight);
    case 'saturation':
      return hslToRgb(sourceHue, filteredSat, sourceLight);
    case 'color':
      return hslToRgb(filteredHue, filteredSat, sourceLight);
    case 'luminosity':
      return hslToRgb(sourceHue, sourceSat, filteredLight);
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  if (delta !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / delta + 2) / 6;
        break;
      default:
        h = ((rn - gn) / delta + 4) / 6;
        break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
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

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function defaultFilterAmount(kind: LayerFilterKind): number {
  switch (kind) {
    case 'blur':
    case 'pixelate':
      return 8;
    case 'noise':
      return 25;
    case 'denoise':
      return 60;
    case 'sharpen':
      return 50;
    case 'grayscale':
    case 'sepia':
    case 'invert':
      return 100;
  }
}

function applyDenoise(source: ImageData, amount: number): ImageData {
  const output = cloneImageData(source);
  const mix = clampUnit(amount / 100);
  if (mix <= 0) return output;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const channels: [number[], number[], number[]] = [[], [], []];
      for (let sampleY = Math.max(0, y - 1); sampleY <= Math.min(source.height - 1, y + 1); sampleY += 1) {
        for (let sampleX = Math.max(0, x - 1); sampleX <= Math.min(source.width - 1, x + 1); sampleX += 1) {
          const sampleOffset = (sampleY * source.width + sampleX) * 4;
          channels[0].push(source.data[sampleOffset]);
          channels[1].push(source.data[sampleOffset + 1]);
          channels[2].push(source.data[sampleOffset + 2]);
        }
      }
      const offset = (y * source.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const values = channels[channel].sort((left, right) => left - right);
        const median = values[Math.floor(values.length / 2)];
        output.data[offset + channel] = blendByte(source.data[offset + channel], median, mix);
      }
      output.data[offset + 3] = source.data[offset + 3];
    }
  }
  return output;
}

function applyPixelate(source: ImageData, amount: number): ImageData {
  const size = Math.max(1, Math.round(amount));
  const output = cloneImageData(source);

  for (let blockY = 0; blockY < source.height; blockY += size) {
    for (let blockX = 0; blockX < source.width; blockX += size) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      const yMax = Math.min(source.height, blockY + size);
      const xMax = Math.min(source.width, blockX + size);

      for (let y = blockY; y < yMax; y += 1) {
        for (let x = blockX; x < xMax; x += 1) {
          const offset = (y * source.width + x) * 4;
          r += source.data[offset];
          g += source.data[offset + 1];
          b += source.data[offset + 2];
          a += source.data[offset + 3];
          count += 1;
        }
      }

      const average: [number, number, number, number] = [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
        Math.round(a / count),
      ];

      for (let y = blockY; y < yMax; y += 1) {
        for (let x = blockX; x < xMax; x += 1) {
          const offset = (y * output.width + x) * 4;
          output.data[offset] = average[0];
          output.data[offset + 1] = average[1];
          output.data[offset + 2] = average[2];
          output.data[offset + 3] = average[3];
        }
      }
    }
  }

  return output;
}

function applyNoise(source: ImageData, amount: number): ImageData {
  const strength = Math.max(0, Math.min(255, amount));
  const output = cloneImageData(source);

  forEachPixel(output, (offset) => {
    const pixelIndex = offset / 4;
    const delta = Math.round((pseudoRandom(pixelIndex) * 2 - 1) * strength);
    output.data[offset] = clampByte(source.data[offset] + delta);
    output.data[offset + 1] = clampByte(source.data[offset + 1] + delta);
    output.data[offset + 2] = clampByte(source.data[offset + 2] + delta);
    output.data[offset + 3] = source.data[offset + 3];
  });

  return output;
}

function pseudoRandom(index: number): number {
  const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function applyBoxBlur(source: ImageData, amount: number): ImageData {
  const radius = Math.max(0, Math.round(amount));
  if (radius === 0) return cloneImageData(source);

  const width = source.width;
  const height = source.height;

  // 1. Horizontal pass (sliding window)
  const temp = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < height; y += 1) {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let aSum = 0;
    let count = 0;

    // Initialize window for x = 0
    const startX = -radius;
    const endX = radius;
    for (let xx = startX; xx <= endX; xx += 1) {
      if (xx >= 0 && xx < width) {
        const offset = (y * width + xx) * 4;
        rSum += source.data[offset];
        gSum += source.data[offset + 1];
        bSum += source.data[offset + 2];
        aSum += source.data[offset + 3];
        count += 1;
      }
    }

    for (let x = 0; x < width; x += 1) {
      const outOffset = (y * width + x) * 4;
      temp[outOffset] = Math.round(rSum / count);
      temp[outOffset + 1] = Math.round(gSum / count);
      temp[outOffset + 2] = Math.round(bSum / count);
      temp[outOffset + 3] = Math.round(aSum / count);

      // Slide window right: subtract element leaving, add element entering
      const leavingX = x - radius;
      if (leavingX >= 0 && leavingX < width) {
        const offset = (y * width + leavingX) * 4;
        rSum -= source.data[offset];
        gSum -= source.data[offset + 1];
        bSum -= source.data[offset + 2];
        aSum -= source.data[offset + 3];
        count -= 1;
      }

      const enteringX = x + radius + 1;
      if (enteringX >= 0 && enteringX < width) {
        const offset = (y * width + enteringX) * 4;
        rSum += source.data[offset];
        gSum += source.data[offset + 1];
        bSum += source.data[offset + 2];
        aSum += source.data[offset + 3];
        count += 1;
      }
    }
  }

  // 2. Vertical pass (sliding window) on intermediate result
  const output = cloneImageData(source);
  for (let x = 0; x < width; x += 1) {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let aSum = 0;
    let count = 0;

    // Initialize window for y = 0
    const startY = -radius;
    const endY = radius;
    for (let yy = startY; yy <= endY; yy += 1) {
      if (yy >= 0 && yy < height) {
        const offset = (yy * width + x) * 4;
        rSum += temp[offset];
        gSum += temp[offset + 1];
        bSum += temp[offset + 2];
        aSum += temp[offset + 3];
        count += 1;
      }
    }

    for (let y = 0; y < height; y += 1) {
      const outOffset = (y * width + x) * 4;
      output.data[outOffset] = Math.round(rSum / count);
      output.data[outOffset + 1] = Math.round(gSum / count);
      output.data[outOffset + 2] = Math.round(bSum / count);
      output.data[outOffset + 3] = Math.round(aSum / count);

      // Slide window down: subtract element leaving, add element entering
      const leavingY = y - radius;
      if (leavingY >= 0 && leavingY < height) {
        const offset = (leavingY * width + x) * 4;
        rSum -= temp[offset];
        gSum -= temp[offset + 1];
        bSum -= temp[offset + 2];
        aSum -= temp[offset + 3];
        count -= 1;
      }

      const enteringY = y + radius + 1;
      if (enteringY >= 0 && enteringY < height) {
        const offset = (enteringY * width + x) * 4;
        rSum += temp[offset];
        gSum += temp[offset + 1];
        bSum += temp[offset + 2];
        aSum += temp[offset + 3];
        count += 1;
      }
    }
  }

  return output;
}

function applySharpen(source: ImageData, amount: number): ImageData {
  const mix = clamp01(amount / 100);
  const blurred = applyBoxBlur(source, 1);
  const output = cloneImageData(source);
  forEachPixel(output, (offset) => {
    output.data[offset] = clampByte(source.data[offset] + (source.data[offset] - blurred.data[offset]) * mix);
    output.data[offset + 1] = clampByte(source.data[offset + 1] + (source.data[offset + 1] - blurred.data[offset + 1]) * mix);
    output.data[offset + 2] = clampByte(source.data[offset + 2] + (source.data[offset + 2] - blurred.data[offset + 2]) * mix);
    output.data[offset + 3] = source.data[offset + 3];
  });
  return output;
}

function applyGrayscale(source: ImageData, amount: number): ImageData {
  const mix = clamp01(amount / 100);
  const output = cloneImageData(source);
  forEachPixel(output, (offset) => {
    const gray = clampByte(
      source.data[offset] * 0.2126 +
        source.data[offset + 1] * 0.7152 +
        source.data[offset + 2] * 0.0722,
    );
    output.data[offset] = mixByte(source.data[offset], gray, mix);
    output.data[offset + 1] = mixByte(source.data[offset + 1], gray, mix);
    output.data[offset + 2] = mixByte(source.data[offset + 2], gray, mix);
    output.data[offset + 3] = source.data[offset + 3];
  });
  return output;
}

function applySepia(source: ImageData, amount: number): ImageData {
  const mix = clamp01(amount / 100);
  const output = cloneImageData(source);
  forEachPixel(output, (offset) => {
    const r = source.data[offset];
    const g = source.data[offset + 1];
    const b = source.data[offset + 2];
    output.data[offset] = mixByte(r, clampByte(r * 0.393 + g * 0.769 + b * 0.189), mix);
    output.data[offset + 1] = mixByte(g, clampByte(r * 0.349 + g * 0.686 + b * 0.168), mix);
    output.data[offset + 2] = mixByte(b, clampByte(r * 0.272 + g * 0.534 + b * 0.131), mix);
    output.data[offset + 3] = source.data[offset + 3];
  });
  return output;
}

function applyInvert(source: ImageData, amount: number): ImageData {
  const mix = clamp01(amount / 100);
  const output = cloneImageData(source);
  forEachPixel(output, (offset) => {
    output.data[offset] = mixByte(source.data[offset], 255 - source.data[offset], mix);
    output.data[offset + 1] = mixByte(source.data[offset + 1], 255 - source.data[offset + 1], mix);
    output.data[offset + 2] = mixByte(source.data[offset + 2], 255 - source.data[offset + 2], mix);
    output.data[offset + 3] = source.data[offset + 3];
  });
  return output;
}

function forEachPixel(imageData: ImageData, callback: (offset: number) => void): void {
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    callback(offset);
  }
}

function cloneImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function mixByte(before: number, after: number, amount: number): number {
  return clampByte(before + (after - before) * amount);
}

function clampByte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
