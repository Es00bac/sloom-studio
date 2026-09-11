import type { ImageLayer, ImageLayerColorLabel, ImageSourceLinkMetadata, LayerType } from '../../types/imageEditor';
import { hasAnyImageLayerLock } from '../../lib/imageLayerLocks';
import { describeImageClippingMaskReadiness, type ImageClippingMaskReadiness } from './ImageClippingMask';
import { getImageLayerGroupInheritanceSummary, normalizeImageLayerGroupTree } from './ImageLayerGroups';

export interface ImageLayerColorLabelDefinition {
  id: ImageLayerColorLabel;
  label: string;
  swatch: string;
}

export type ImageLayerPanelVisibilityFilter = 'all' | 'visible' | 'hidden';
export type ImageLayerPanelLockFilter = 'all' | 'locked' | 'unlocked';
export type ImageLayerPanelSourceFilter = 'all' | 'linked' | 'unlinked';
export type ImageLayerPanelTypeFilter = 'all' | LayerType;
export type ImageLayerPanelColorFilter = 'all' | ImageLayerColorLabel;

export interface ImageLayerPanelFilters {
  query?: string;
  type?: ImageLayerPanelTypeFilter;
  visibility?: ImageLayerPanelVisibilityFilter;
  lockState?: ImageLayerPanelLockFilter;
  source?: ImageLayerPanelSourceFilter;
  colorLabel?: ImageLayerPanelColorFilter;
}

export type ImageLayerOrganizationBatchOperation = 'label' | 'lock' | 'link' | 'group' | 'source-link';

export type ImageLayerOrganizationWarningCode =
  | 'multi-select-label-unsupported'
  | 'multi-select-lock-unsupported'
  | 'multi-select-link-unsupported'
  | 'multi-select-group-unsupported'
  | 'multi-select-source-link-unsupported'
  | 'multi-select-cross-group-boundaries-unsupported'
  | 'multi-select-nested-group-unsupported'
  | 'multi-select-group-pass-through-unsupported'
  | 'multi-select-group-mask-unsupported';

export interface ImageLayerOrganizationWarning {
  code: ImageLayerOrganizationWarningCode;
  operation: ImageLayerOrganizationBatchOperation;
  layerIds: string[];
  message: string;
}

export interface ImageLayerOrganizationGroupSelectionBoundary {
  groupId: string | null;
  selectedLayerIds: string[];
  passThroughGroupIds: string[];
  maskedGroupIds: string[];
  nestedSelection: boolean;
}

export interface ImageLayerOrganizationSelectionSummary {
  selectedCount: number;
  selectedLayerIds: string[];
  boundaries: ImageLayerOrganizationGroupSelectionBoundary[];
  crossGroupBoundaries: boolean;
  nestedSelection: boolean;
  passThroughGroupIds: string[];
  maskedGroupIds: string[];
}

export interface ImageLayerColorLabelOrganizationDescriptor extends ImageLayerColorLabelDefinition {
  applied: boolean;
}

export interface ImageLayerLockOrganizationDescriptor {
  locked: boolean;
  full: boolean;
  pixels: boolean;
  position: boolean;
  labels: string[];
}

export interface ImageLayerLinkOrganizationDescriptor {
  linked: boolean;
  groupId?: string;
  memberCount: number;
  memberLayerIds: string[];
}

export interface ImageLayerGroupOrganizationDescriptor {
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  expanded?: boolean;
  depth: number;
  ancestorGroupIds: string[];
  collapsedAncestorGroupIds: string[];
  childLayerIds: string[];
  descendantLayerIds: string[];
  effectiveVisible: boolean;
  effectiveLocked: boolean;
  effectiveOpacity: number;
}

export interface ImageLayerSourceOrganizationDescriptor {
  linked: boolean;
  sourceId?: string;
  label?: string;
  status: ImageSourceLinkMetadata['status'] | 'none';
  sizeLabel?: string;
  format?: string;
  mimeType?: string;
  warnings: string[];
}

export interface ImageLayerSearchFilterDescriptor {
  query: string;
  activeFilterCount: number;
  matchesQuery: boolean;
  matchesFilters: boolean;
  hiddenByCollapsedGroup: boolean;
  visibleInFilteredPanel: boolean;
}

export interface ImageLayerOrganizationDescriptor {
  layerId: string;
  layerName: string;
  type: LayerType;
  colorLabel: ImageLayerColorLabelOrganizationDescriptor;
  locks: ImageLayerLockOrganizationDescriptor;
  link: ImageLayerLinkOrganizationDescriptor;
  group: ImageLayerGroupOrganizationDescriptor;
  source: ImageLayerSourceOrganizationDescriptor;
  searchFilter: ImageLayerSearchFilterDescriptor;
  searchableText: string;
}

export interface ImageLayerOrganizationWorkflowMetadataOptions {
  filters?: ImageLayerPanelFilters;
  selectedLayerIds?: readonly string[];
  requestedBatchOperations?: readonly ImageLayerOrganizationBatchOperation[];
}

export interface ImageLayerOrganizationWorkflowMetadata {
  descriptors: ImageLayerOrganizationDescriptor[];
  selectedLayerIds: string[];
  filteredLayerIds: string[];
  visibleLayerIds: string[];
  selectionSummary?: ImageLayerOrganizationSelectionSummary;
  warnings: ImageLayerOrganizationWarning[];
}

export interface ImageLayerOrganizationPlanningSummary {
  totalLayerCount: number;
  filteredLayerIds: string[];
  visibleLayerIds: string[];
  selectedLayerIds: string[];
  labelSummary: {
    appliedCount: number;
    countsByLabel: Record<ImageLayerColorLabel, number>;
  };
  filterSummary: {
    query: string;
    activeFilterCount: number;
    hiddenByCollapsedGroupIds: string[];
    matchingLayerIds: string[];
  };
  multiSelect: {
    enabled: boolean;
    selectedCount: number;
    unsupportedOperations: ImageLayerOrganizationBatchOperation[];
  };
  warningCodes: ImageLayerOrganizationWarningCode[];
  selectionSummary: ImageLayerOrganizationSelectionSummary;
  previewSignature: string;
}

export type ImageLayerStackOrganizationBlockerCode =
  | 'multi-select-cross-group-boundaries-unsupported'
  | 'multi-select-nested-group-unsupported'
  | 'multi-select-group-pass-through-unsupported'
  | 'multi-select-group-mask-unsupported'
  | 'unsupported-grouped-transform-state';
export type ImageLayerOrganizationParityAction = 'create-clipping-mask' | 'release-clipping-mask' | 'link-layers' | 'lock-layers' | 'label-layers' | 'group-layers';
export type ImageLayerOrganizationSuiteHandoffTarget = 'internal' | 'psd-export' | 'source-library' | 'flow' | 'video' | 'paper';
export type ImageLayerOrganizationSupportedState =
  | 'single-layer-labels'
  | 'full-pixel-position-locks'
  | 'pairwise-linked-layer-movement'
  | 'multi-select-linked-movement'
  | 'multi-select-sibling-transform'
  | 'single-level-layer-groups'
  | 'one-level-clipping-mask-rendering';
export type ImageLayerOrganizationUnsupportedPhotoshopState =
  | 'multi-select-batch-layer-operations'
  | 'linked-layer-transform-propagation'
  | 'nested-clipping-mask-chain-editing'
  | 'native-psd-clipping-group-roundtrip'
  | 'pass-through-group-compositing'
  | 'group-mask-rendering';
export type ImageLayerOrganizationParityBlocker =
  | 'clipping-mask-missing-base'
  | 'clipping-mask-hidden-base'
  | 'clipping-mask-group-base-handoff';

export type ImageLayerStackUnsupportedTransformReason =
  | 'group-transform'
  | 'nested-group-transform'
  | 'descendant-transform-in-group';

export interface ImageLayerStackLinkGroupSummary {
  groupId: string;
  memberLayerIds: string[];
  memberCount: number;
}

export interface ImageLayerStackUnsupportedTransformState {
  layerId: string;
  layerName: string;
  groupId: string | null;
  reasons: ImageLayerStackUnsupportedTransformReason[];
}

export interface ImageLayerStackOrganizationReadiness {
  ready: boolean;
  layerCount: number;
  groups: {
    groupCount: number;
    groupLayerIds: string[];
    collapsedGroupIds: string[];
    passThroughGroupIds: string[];
    maskedGroupIds: string[];
    nestedGroupIds: string[];
  };
  multiSelect: ImageLayerOrganizationPlanningSummary['multiSelect'] & {
    selectedLayerIds: string[];
    crossGroupBoundaries: boolean;
    nestedSelection: boolean;
  };
  searchFilter: {
    query: string;
    activeFilterCount: number;
    filteredLayerIds: string[];
    visibleLayerIds: string[];
    hiddenByCollapsedGroupIds: string[];
  };
  labels: ImageLayerOrganizationPlanningSummary['labelSummary'];
  locks: {
    lockedLayerIds: string[];
    fullyLockedLayerIds: string[];
    pixelLockedLayerIds: string[];
    positionLockedLayerIds: string[];
  };
  links: {
    linkedLayerIds: string[];
    linkGroupIds: string[];
    linkGroups: ImageLayerStackLinkGroupSummary[];
  };
  sourceLinks: {
    linkedLayerIds: string[];
    missingLayerIds: string[];
    relinkedLayerIds: string[];
  };
  clippingMasks: {
    clippedLayerIds: string[];
    baseLayerIds: string[];
  };
  batchOperationCaveats: ImageLayerOrganizationWarningCode[];
  blockers: ImageLayerStackOrganizationBlockerCode[];
  unsupportedGroupedTransformStates: ImageLayerStackUnsupportedTransformState[];
  previewSignatures: {
    organization: string;
    stack: string;
  };
}

export interface ImageLayerClippingMaskChainReadiness {
  baseLayerId: string | null;
  clippedLayerIds: string[];
  valid: boolean;
}

export interface ImageLayerClippingMaskGroupBaseVisibility {
  baseLayerId: string;
  effectiveVisible: boolean;
  visibleDescendantLayerIds: string[];
  hiddenDescendantLayerIds: string[];
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface ImageLayerOrganizationParityReadinessOptions extends ImageLayerOrganizationWorkflowMetadataOptions {
  requestedAction?: ImageLayerOrganizationParityAction;
  suiteHandoffTarget?: ImageLayerOrganizationSuiteHandoffTarget;
}

export interface ImageLayerOrganizationParityReadiness {
  descriptorId: 'image-layer-organization-parity-readiness:v1';
  layerCount: number;
  selectedLayerIds: string[];
  supportedLayerOrganization: ImageLayerOrganizationSupportedState[];
  unsupportedPhotoshopStates: ImageLayerOrganizationUnsupportedPhotoshopState[];
  invalidBlockers: ImageLayerOrganizationParityBlocker[];
  clippingMasks: {
    chains: ImageLayerClippingMaskChainReadiness[];
    clippedLayerIds: string[];
    baseLayerIds: string[];
    invalidLayerIds: string[];
    groupBaseLayerIds: string[];
    visibleGroupBaseLayerIds: string[];
    hiddenGroupBaseLayerIds: string[];
    hiddenBaseLayerIds: string[];
    groupBaseVisibility: ImageLayerClippingMaskGroupBaseVisibility[];
  };
  multiLayerOperations: {
    selectedCount: number;
    supportedOperations: ImageLayerOrganizationBatchOperation[];
    unsupportedOperations: ImageLayerOrganizationBatchOperation[];
  };
  actionSuitability: {
    recordable: boolean;
    playbackSafe: boolean;
    blockers: ImageLayerOrganizationParityBlocker[];
  };
  batchSuitability: {
    supported: boolean;
    blockers: ImageLayerOrganizationWarningCode[];
  };
  suiteHandoffCaveats: string[];
  previewSignature: string;
}

export const IMAGE_LAYER_COLOR_LABELS: ImageLayerColorLabelDefinition[] = [
  { id: 'none', label: 'No Label', swatch: 'transparent' },
  { id: 'red', label: 'Red', swatch: '#ef4444' },
  { id: 'orange', label: 'Orange', swatch: '#f97316' },
  { id: 'yellow', label: 'Yellow', swatch: '#eab308' },
  { id: 'green', label: 'Green', swatch: '#22c55e' },
  { id: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { id: 'violet', label: 'Violet', swatch: '#8b5cf6' },
  { id: 'gray', label: 'Gray', swatch: '#94a3b8' },
];

export const IMAGE_LAYER_TYPE_FILTERS: Array<{ id: ImageLayerPanelTypeFilter; label: string }> = [
  { id: 'all', label: 'All Types' },
  { id: 'image', label: 'Image' },
  { id: 'text', label: 'Text' },
  { id: 'adjustment', label: 'Adjustment' },
  { id: 'vector', label: 'Vector' },
  { id: 'mask', label: 'Mask' },
  { id: 'group', label: 'Group' },
];

const IMAGE_LAYER_ORGANIZATION_BATCH_OPERATIONS: ImageLayerOrganizationBatchOperation[] = [
  'label',
  'lock',
  'link',
  'group',
  'source-link',
];

export function imageLayerColorLabelById(value: unknown): ImageLayerColorLabelDefinition {
  return IMAGE_LAYER_COLOR_LABELS.find((label) => label.id === value) ?? IMAGE_LAYER_COLOR_LABELS[0];
}

export function filterImageLayersForPanel(
  layers: readonly ImageLayer[],
  filters: ImageLayerPanelFilters,
): ImageLayer[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  return layers.filter((layer) => (
    matchesQuery(layer, query)
    && matchesType(layer, filters.type ?? 'all')
    && matchesVisibility(layer, filters.visibility ?? 'all')
    && matchesLockState(layer, filters.lockState ?? 'all')
    && matchesSourceState(layer, filters.source ?? 'all')
    && matchesColorLabel(layer, filters.colorLabel ?? 'all')
  ));
}

export function countActiveImageLayerPanelFilters(filters: ImageLayerPanelFilters): number {
  let count = 0;
  if (filters.query?.trim()) count += 1;
  if (filters.type && filters.type !== 'all') count += 1;
  if (filters.visibility && filters.visibility !== 'all') count += 1;
  if (filters.lockState && filters.lockState !== 'all') count += 1;
  if (filters.source && filters.source !== 'all') count += 1;
  if (filters.colorLabel && filters.colorLabel !== 'all') count += 1;
  return count;
}

export function buildImageLayerSearchableText(layer: ImageLayer): string {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of getImageLayerSearchValues(layer)) {
    const normalized = normalizeSearchValue(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values.join(' ');
}

export function describeImageLayerOrganization(
  layer: ImageLayer,
  layers: readonly ImageLayer[] = [layer],
  filters: ImageLayerPanelFilters = {},
): ImageLayerOrganizationDescriptor {
  const normalized = normalizeImageLayerGroupTree(layers);
  const normalizedLayer = normalized.layers.find((candidate) => candidate.id === layer.id) ?? layer;
  const normalizedLayers = normalized.layers.length > 0 ? normalized.layers : [layer];
  const groupSummary = getImageLayerGroupInheritanceSummary(normalizedLayer, normalizedLayers);
  const groupNode = normalized.nodesById[normalizedLayer.id];
  const parentGroup = normalizedLayer.groupId
    ? normalized.layers.find((candidate) => candidate.id === normalizedLayer.groupId && candidate.type === 'group')
    : undefined;
  const collapsedAncestorGroupIds = groupSummary.ancestorGroupIds.filter((groupId) => {
    const ancestor = normalized.layers.find((candidate) => candidate.id === groupId && candidate.type === 'group');
    return ancestor?.groupExpanded === false;
  });
  const query = filters.query?.trim().toLowerCase() ?? '';
  const matchesFilters = filterImageLayersForPanel([normalizedLayer], filters).length === 1;

  return {
    layerId: normalizedLayer.id,
    layerName: normalizedLayer.name,
    type: normalizedLayer.type,
    colorLabel: describeImageLayerColorLabel(normalizedLayer),
    locks: describeImageLayerLocks(normalizedLayer),
    link: describeImageLayerLink(normalizedLayer, normalized.layers),
    group: {
      isGroup: normalizedLayer.type === 'group',
      ...(normalizedLayer.groupId ? { groupId: normalizedLayer.groupId } : {}),
      ...(parentGroup ? { groupName: parentGroup.name } : {}),
      ...(normalizedLayer.type === 'group' ? { expanded: normalizedLayer.groupExpanded !== false } : {}),
      depth: groupNode?.depth ?? 0,
      ancestorGroupIds: groupSummary.ancestorGroupIds,
      collapsedAncestorGroupIds,
      childLayerIds: groupNode?.childLayerIds ?? [],
      descendantLayerIds: collectDescendantLayerIds(groupNode),
      effectiveVisible: groupSummary.effectiveVisible,
      effectiveLocked: groupSummary.effectiveLocked,
      effectiveOpacity: groupSummary.effectiveOpacity,
    },
    source: describeImageLayerSource(normalizedLayer),
    searchFilter: {
      query,
      activeFilterCount: countActiveImageLayerPanelFilters(filters),
      matchesQuery: matchesQuery(normalizedLayer, query),
      matchesFilters,
      hiddenByCollapsedGroup: collapsedAncestorGroupIds.length > 0,
      visibleInFilteredPanel: matchesFilters && collapsedAncestorGroupIds.length === 0,
    },
    searchableText: buildImageLayerSearchableText(normalizedLayer),
  };
}

export function buildImageLayerOrganizationWorkflowMetadata(
  layers: readonly ImageLayer[],
  options: ImageLayerOrganizationWorkflowMetadataOptions = {},
): ImageLayerOrganizationWorkflowMetadata {
  const filters = options.filters ?? {};
  const descriptors = layers.map((layer) => describeImageLayerOrganization(layer, layers, filters));
  const selectedLayerIds = dedupeLayerIds(options.selectedLayerIds ?? []);
  const selectionSummary = buildImageLayerOrganizationSelectionSummary(selectedLayerIds, layers);

  return {
    descriptors,
    selectedLayerIds,
    ...(selectionSummary.selectedCount > 0 ? { selectionSummary } : {}),
    filteredLayerIds: descriptors
      .filter((descriptor) => descriptor.searchFilter.matchesFilters)
      .map((descriptor) => descriptor.layerId),
    visibleLayerIds: descriptors
      .filter((descriptor) => descriptor.searchFilter.visibleInFilteredPanel)
      .map((descriptor) => descriptor.layerId),
    warnings: buildImageLayerOrganizationWarnings(
      selectedLayerIds,
      options.requestedBatchOperations ?? IMAGE_LAYER_ORGANIZATION_BATCH_OPERATIONS,
      selectionSummary,
    ),
  };
}

export function buildImageLayerOrganizationPlanningSummary(
  layers: readonly ImageLayer[],
  options: ImageLayerOrganizationWorkflowMetadataOptions = {},
): ImageLayerOrganizationPlanningSummary {
  const metadata = buildImageLayerOrganizationWorkflowMetadata(layers, options);
  const selectionSummary = metadata.selectionSummary ?? buildImageLayerOrganizationSelectionSummary(metadata.selectedLayerIds, layers);
  const labelCounts = buildInitialLabelCounts();
  for (const descriptor of metadata.descriptors) {
    labelCounts[descriptor.colorLabel.id] += 1;
  }
  const hiddenByCollapsedGroupIds = metadata.descriptors
    .filter((descriptor) => descriptor.searchFilter.hiddenByCollapsedGroup)
    .map((descriptor) => descriptor.layerId);
  const unsupportedOperations = metadata.warnings
    .filter((warning) => warning.code === `multi-select-${warning.operation}-unsupported`)
    .map((warning) => warning.operation);
  const query = options.filters?.query?.trim().toLowerCase() ?? '';

  return {
    totalLayerCount: layers.length,
    filteredLayerIds: metadata.filteredLayerIds,
    visibleLayerIds: metadata.visibleLayerIds,
    selectedLayerIds: metadata.selectedLayerIds,
    labelSummary: {
      appliedCount: metadata.descriptors.filter((descriptor) => descriptor.colorLabel.applied).length,
      countsByLabel: labelCounts,
    },
    filterSummary: {
      query,
      activeFilterCount: countActiveImageLayerPanelFilters(options.filters ?? {}),
      hiddenByCollapsedGroupIds,
      matchingLayerIds: metadata.filteredLayerIds,
    },
    multiSelect: {
      enabled: metadata.selectedLayerIds.length > 1,
      selectedCount: metadata.selectedLayerIds.length,
      unsupportedOperations,
    },
    warningCodes: metadata.warnings.map((warning) => warning.code),
    selectionSummary,
    previewSignature: buildOrganizationPlanningPreviewSignature(
      metadata,
      labelCounts,
      query,
      hiddenByCollapsedGroupIds,
      unsupportedOperations,
      selectionSummary,
    ),
  };
}

export function describeImageLayerStackOrganizationReadiness(
  layers: readonly ImageLayer[],
  options: ImageLayerOrganizationWorkflowMetadataOptions = {},
): ImageLayerStackOrganizationReadiness {
  const metadata = buildImageLayerOrganizationWorkflowMetadata(layers, options);
  const planning = buildImageLayerOrganizationPlanningSummary(layers, options);
  const groupLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.group.isGroup)
    .map((descriptor) => descriptor.layerId);
  const collapsedGroupIds = metadata.descriptors
    .filter((descriptor) => descriptor.group.isGroup && descriptor.group.expanded === false)
    .map((descriptor) => descriptor.layerId);
  const passThroughGroupIds = layers
    .filter((layer) => layer.type === 'group' && layer.blendMode !== 'normal')
    .map((layer) => layer.id);
  const maskedGroupIds = layers
    .filter((layer) => layer.type === 'group' && Boolean(layer.mask))
    .map((layer) => layer.id);
  const nestedGroupIds = layers
    .filter((layer) => layer.type === 'group' && Boolean(layer.groupId))
    .map((layer) => layer.id);
  const lockedLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.locks.locked)
    .map((descriptor) => descriptor.layerId);
  const fullyLockedLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.locks.full)
    .map((descriptor) => descriptor.layerId);
  const pixelLockedLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.locks.pixels)
    .map((descriptor) => descriptor.layerId);
  const positionLockedLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.locks.position)
    .map((descriptor) => descriptor.layerId);
  const linkGroups = summarizeLayerLinkGroups(layers);
  const linkedLayerIds = linkGroups.flatMap((group) => group.memberLayerIds);
  const sourceLinkedLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.source.linked)
    .map((descriptor) => descriptor.layerId);
  const sourceMissingLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.source.status === 'missing')
    .map((descriptor) => descriptor.layerId);
  const sourceRelinkedLayerIds = metadata.descriptors
    .filter((descriptor) => descriptor.source.status === 'relinked')
    .map((descriptor) => descriptor.layerId);
  const clippingMasks = summarizeClippingMasks(layers);
  const unsupportedGroupedTransformStates = summarizeUnsupportedGroupedTransformStates(layers);
  const blockers = summarizeLayerStackBlockers(planning.warningCodes, unsupportedGroupedTransformStates);
  const readiness: ImageLayerStackOrganizationReadiness = {
    ready: planning.warningCodes.length === 0 && blockers.length === 0,
    layerCount: layers.length,
    groups: {
      groupCount: groupLayerIds.length,
      groupLayerIds,
      collapsedGroupIds,
      passThroughGroupIds,
      maskedGroupIds,
      nestedGroupIds,
    },
    multiSelect: {
      ...planning.multiSelect,
      selectedLayerIds: planning.selectedLayerIds,
      crossGroupBoundaries: planning.selectionSummary.crossGroupBoundaries,
      nestedSelection: planning.selectionSummary.nestedSelection,
    },
    searchFilter: {
      query: planning.filterSummary.query,
      activeFilterCount: planning.filterSummary.activeFilterCount,
      filteredLayerIds: planning.filteredLayerIds,
      visibleLayerIds: planning.visibleLayerIds,
      hiddenByCollapsedGroupIds: planning.filterSummary.hiddenByCollapsedGroupIds,
    },
    labels: planning.labelSummary,
    locks: {
      lockedLayerIds,
      fullyLockedLayerIds,
      pixelLockedLayerIds,
      positionLockedLayerIds,
    },
    links: {
      linkedLayerIds,
      linkGroupIds: linkGroups.map((group) => group.groupId),
      linkGroups,
    },
    sourceLinks: {
      linkedLayerIds: sourceLinkedLayerIds,
      missingLayerIds: sourceMissingLayerIds,
      relinkedLayerIds: sourceRelinkedLayerIds,
    },
    clippingMasks,
    batchOperationCaveats: planning.warningCodes,
    blockers,
    unsupportedGroupedTransformStates,
    previewSignatures: {
      organization: planning.previewSignature,
      stack: '',
    },
  };
  readiness.previewSignatures.stack = buildLayerStackReadinessSignature(readiness);
  return readiness;
}

export function describeImageLayerOrganizationParityReadiness(
  layers: readonly ImageLayer[],
  options: ImageLayerOrganizationParityReadinessOptions = {},
): ImageLayerOrganizationParityReadiness {
  const planning = buildImageLayerOrganizationPlanningSummary(layers, options);
  const clippingMasks = summarizeClippingMaskReadiness(layers);
  const invalidBlockers = summarizeOrganizationParityBlockers(clippingMasks, options.suiteHandoffTarget ?? 'internal');
  const supportedLayerOrganization: ImageLayerOrganizationSupportedState[] = [
    'single-layer-labels',
    'full-pixel-position-locks',
    'pairwise-linked-layer-movement',
    'multi-select-linked-movement',
    'multi-select-sibling-transform',
    'single-level-layer-groups',
    'one-level-clipping-mask-rendering',
  ];
  const unsupportedPhotoshopStates: ImageLayerOrganizationUnsupportedPhotoshopState[] = [
    'multi-select-batch-layer-operations',
    'linked-layer-transform-propagation',
    'nested-clipping-mask-chain-editing',
    'native-psd-clipping-group-roundtrip',
    'pass-through-group-compositing',
    'group-mask-rendering',
  ];
  const unsupportedOperations = planning.multiSelect.enabled
    ? planning.multiSelect.unsupportedOperations
    : [];
  const batchBlockers = planning.warningCodes;
  const playbackSafe = invalidBlockers.length === 0 && batchBlockers.length === 0;

  return {
    descriptorId: 'image-layer-organization-parity-readiness:v1',
    layerCount: layers.length,
    selectedLayerIds: planning.selectedLayerIds,
    supportedLayerOrganization,
    unsupportedPhotoshopStates,
    invalidBlockers,
    clippingMasks,
    multiLayerOperations: {
      selectedCount: planning.multiSelect.selectedCount,
      supportedOperations: planning.multiSelect.enabled ? [] : IMAGE_LAYER_ORGANIZATION_BATCH_OPERATIONS,
      unsupportedOperations,
    },
    actionSuitability: {
      recordable: true,
      playbackSafe,
      blockers: invalidBlockers,
    },
    batchSuitability: {
      supported: batchBlockers.length === 0,
      blockers: batchBlockers,
    },
    suiteHandoffCaveats: describeOrganizationSuiteHandoffCaveats(clippingMasks, options.suiteHandoffTarget ?? 'internal'),
    previewSignature: buildOrganizationParityReadinessSignature(
      layers.length,
      planning.selectedLayerIds,
      clippingMasks,
      invalidBlockers,
      batchBlockers,
      playbackSafe,
      options.suiteHandoffTarget ?? 'internal',
    ),
  };
}

function matchesQuery(layer: ImageLayer, query: string): boolean {
  if (!query) return true;
  return getImageLayerSearchValues(layer).some((value) => normalizeSearchValue(value).includes(query));
}

function matchesType(layer: ImageLayer, type: ImageLayerPanelTypeFilter): boolean {
  return type === 'all' || layer.type === type;
}

function matchesVisibility(layer: ImageLayer, visibility: ImageLayerPanelVisibilityFilter): boolean {
  if (visibility === 'all') return true;
  return visibility === 'visible' ? layer.visible : !layer.visible;
}

function matchesLockState(layer: ImageLayer, lockState: ImageLayerPanelLockFilter): boolean {
  if (lockState === 'all') return true;
  const locked = hasAnyImageLayerLock(layer);
  return lockState === 'locked' ? locked : !locked;
}

function matchesSourceState(layer: ImageLayer, source: ImageLayerPanelSourceFilter): boolean {
  if (source === 'all') return true;
  const linked = Boolean(layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink);
  return source === 'linked' ? linked : !linked;
}

function matchesColorLabel(layer: ImageLayer, colorLabel: ImageLayerPanelColorFilter): boolean {
  if (colorLabel === 'all') return true;
  const layerLabel = imageLayerColorLabelById(layer.colorLabel).id;
  return layerLabel === colorLabel;
}

function describeImageLayerColorLabel(layer: ImageLayer): ImageLayerColorLabelOrganizationDescriptor {
  const colorLabel = imageLayerColorLabelById(layer.colorLabel);
  return {
    ...colorLabel,
    applied: colorLabel.id !== 'none',
  };
}

function describeImageLayerLocks(layer: ImageLayer): ImageLayerLockOrganizationDescriptor {
  const full = layer.locked === true;
  const pixels = layer.locks?.pixels === true;
  const position = layer.locks?.position === true;
  const labels: string[] = [];
  if (full) labels.push('Fully locked');
  if (pixels) labels.push('Pixel edits locked');
  if (position) labels.push('Position locked');
  return {
    locked: hasAnyImageLayerLock(layer),
    full,
    pixels,
    position,
    labels,
  };
}

function describeImageLayerLink(
  layer: ImageLayer,
  layers: readonly ImageLayer[],
): ImageLayerLinkOrganizationDescriptor {
  if (!layer.linkGroupId) {
    return {
      linked: false,
      memberCount: 1,
      memberLayerIds: [layer.id],
    };
  }

  const memberLayerIds = layers
    .filter((candidate) => candidate.linkGroupId === layer.linkGroupId)
    .map((candidate) => candidate.id);
  return {
    linked: true,
    groupId: layer.linkGroupId,
    memberCount: memberLayerIds.length,
    memberLayerIds,
  };
}

function describeImageLayerSource(layer: ImageLayer): ImageLayerSourceOrganizationDescriptor {
  const sourceLink = layer.metadata?.sourceLink;
  const sourceId = sourceLink?.id ?? layer.metadata?.smartLinkedSourceId;
  return {
    linked: Boolean(sourceId),
    ...(sourceId ? { sourceId } : {}),
    ...(sourceLink?.label || layer.metadata?.sourceLabel ? { label: sourceLink?.label ?? layer.metadata?.sourceLabel } : {}),
    status: sourceLink?.status ?? (sourceId ? 'linked' : 'none'),
    ...formatSourceLinkSize(sourceLink),
    ...(layer.metadata?.sourceFormat ? { format: layer.metadata.sourceFormat } : {}),
    ...(layer.metadata?.sourceMimeType ? { mimeType: layer.metadata.sourceMimeType } : {}),
    warnings: [...(layer.metadata?.sourceWarnings ?? [])],
  };
}

function formatSourceLinkSize(sourceLink: ImageSourceLinkMetadata | undefined): Pick<ImageLayerSourceOrganizationDescriptor, 'sizeLabel'> {
  if (!sourceLink || !Number.isFinite(sourceLink.width) || !Number.isFinite(sourceLink.height)) return {};
  return {
    sizeLabel: `${sourceLink.width}x${sourceLink.height}`,
  };
}

function collectDescendantLayerIds(node: ReturnType<typeof normalizeImageLayerGroupTree>['nodesById'][string] | undefined): string[] {
  if (!node) return [];
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(child.layer.id);
    ids.push(...collectDescendantLayerIds(child));
  }
  return ids;
}

function getImageLayerSearchValues(layer: ImageLayer): Array<string | undefined> {
  return [
    layer.name,
    layer.type,
    layer.metadata?.sourceLabel ?? layer.metadata?.sourceLink?.label,
    layer.metadata?.smartLinkedSourceId ?? layer.metadata?.sourceLink?.id,
    layer.metadata?.sourceFormat,
    layer.metadata?.sourceMimeType,
    layer.linkGroupId,
  ];
}

function normalizeSearchValue(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function getAncestorGroupIds(layer: ImageLayer, layers: readonly ImageLayer[]): string[] {
  const layersById = new Map(layers.map((entry) => [entry.id, entry]));
  const ancestorGroupIds: string[] = [];
  const seen = new Set<string>();
  let groupId = layer.groupId;
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId);
    const group = layersById.get(groupId);
    if (!group || group.type !== 'group') break;
    ancestorGroupIds.push(group.id);
    groupId = group.groupId;
  }
  return ancestorGroupIds;
}

function dedupeLayerIds(layerIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const layerId of layerIds) {
    if (!layerId || seen.has(layerId)) continue;
    seen.add(layerId);
    deduped.push(layerId);
  }
  return deduped;
}

function buildInitialLabelCounts(): Record<ImageLayerColorLabel, number> {
  return IMAGE_LAYER_COLOR_LABELS.reduce((counts, label) => {
    counts[label.id] = 0;
    return counts;
  }, {} as Record<ImageLayerColorLabel, number>);
}

function buildOrganizationPlanningPreviewSignature(
  metadata: ImageLayerOrganizationWorkflowMetadata,
  labelCounts: Record<ImageLayerColorLabel, number>,
  query: string,
  hiddenByCollapsedGroupIds: readonly string[],
  unsupportedOperations: readonly ImageLayerOrganizationBatchOperation[],
  selectionSummary: ImageLayerOrganizationSelectionSummary,
): string {
  const labelSummary = IMAGE_LAYER_COLOR_LABELS
    .map((label) => `${label.id}=${labelCounts[label.id]}`)
    .join(',');
  return [
    `layers:${metadata.descriptors.length}`,
    `filtered:${formatSignatureList(metadata.filteredLayerIds)}`,
    `visible:${formatSignatureList(metadata.visibleLayerIds)}`,
    `selected:${formatSignatureList(metadata.selectedLayerIds)}`,
    `selection:${buildSelectionSummaryPreviewFragment(selectionSummary)}`,
    `labels:${labelSummary}`,
    `filters:query=${query},count=${metadata.descriptors[0]?.searchFilter.activeFilterCount ?? 0},hidden=${formatSignatureList(hiddenByCollapsedGroupIds)}`,
    `unsupported:${formatSignatureList(unsupportedOperations)}`,
  ].join('|');
}

export function buildImageLayerOrganizationSelectionSummary(
  selectedLayerIds: readonly string[],
  layers: readonly ImageLayer[],
): ImageLayerOrganizationSelectionSummary {
  const normalized = normalizeImageLayerGroupTree(layers);
  const dedupedSelectedLayerIds = dedupeLayerIds(selectedLayerIds);
  const selectedLayersById = new Map(normalized.layers.map((layer) => [layer.id, layer]));
  const selectedLayerIdsInDocument = dedupedSelectedLayerIds.filter((layerId) => selectedLayersById.has(layerId));
  const selectedLayerSet = new Set(selectedLayerIdsInDocument);

  const boundaryGroups = new Map<string, ImageLayerOrganizationGroupSelectionBoundary>();
  const allPassThroughGroupIds = new Set<string>();
  const allMaskedGroupIds = new Set<string>();
  let nestedSelection = false;

  for (const selectedLayerId of selectedLayerIdsInDocument) {
    const selectedLayer = selectedLayersById.get(selectedLayerId);
    if (!selectedLayer) continue;

    const ancestorGroupIds = getAncestorGroupIds(selectedLayer, normalized.layers);
    const boundaryGroupId = ancestorGroupIds.length > 0 ? ancestorGroupIds[ancestorGroupIds.length - 1] : null;
    const boundaryKey = boundaryGroupId ?? '__ungrouped__';
    const boundary = boundaryGroups.get(boundaryKey);
    const boundaryEntry = boundary ?? {
      groupId: boundaryGroupId,
      selectedLayerIds: [],
      passThroughGroupIds: [],
      maskedGroupIds: [],
      nestedSelection: false,
    };

    boundaryEntry.selectedLayerIds.push(selectedLayerId);

    const relatedGroupIds = new Set<string>();
    if (selectedLayer.type === 'group') {
      relatedGroupIds.add(selectedLayer.id);
    }
    for (const ancestorGroupId of ancestorGroupIds) {
      relatedGroupIds.add(ancestorGroupId);
    }

    for (const groupId of relatedGroupIds) {
      const group = selectedLayersById.get(groupId);
      if (!group || group.type !== 'group') continue;

      if (group.blendMode !== 'normal') {
        if (!boundaryEntry.passThroughGroupIds.includes(group.id)) {
          boundaryEntry.passThroughGroupIds.push(group.id);
        }
        allPassThroughGroupIds.add(group.id);
      }

      if (group.mask) {
        if (!boundaryEntry.maskedGroupIds.includes(group.id)) {
          boundaryEntry.maskedGroupIds.push(group.id);
        }
        allMaskedGroupIds.add(group.id);
      }
    }

    for (const ancestorGroupId of ancestorGroupIds) {
      if (selectedLayerSet.has(ancestorGroupId)) {
        nestedSelection = true;
        boundaryEntry.nestedSelection = true;
      }
    }

    boundaryGroups.set(boundaryKey, boundaryEntry);
  }

  const boundaries = Array.from(boundaryGroups.values()).sort((left, right) => {
    if (left.groupId === null) return -1;
    if (right.groupId === null) return 1;
    return left.groupId.localeCompare(right.groupId);
  });

  return {
    selectedCount: selectedLayerIdsInDocument.length,
    selectedLayerIds: selectedLayerIdsInDocument,
    boundaries,
    crossGroupBoundaries: boundaries.length > 1,
    nestedSelection,
    passThroughGroupIds: [...allPassThroughGroupIds],
    maskedGroupIds: [...allMaskedGroupIds],
  };
}

function buildImageLayerOrganizationWarnings(
  selectedLayerIds: readonly string[],
  requestedBatchOperations: readonly ImageLayerOrganizationBatchOperation[],
  selectionSummary: ImageLayerOrganizationSelectionSummary,
): ImageLayerOrganizationWarning[] {
  if (selectedLayerIds.length < 2) return [];
  const requested = new Set(requestedBatchOperations);
  const warnings: ImageLayerOrganizationWarning[] = [];
  for (const operation of IMAGE_LAYER_ORGANIZATION_BATCH_OPERATIONS) {
    if (!requested.has(operation)) continue;
    warnings.push(makeUnsupportedBatchWarning(operation, selectedLayerIds));
  }

  if (selectionSummary.crossGroupBoundaries) {
    warnings.push(makeUnsupportedSelectionBoundaryBatchWarning(
      'multi-select-cross-group-boundaries-unsupported',
      selectedLayerIds,
    ));
  }

  if (selectionSummary.nestedSelection) {
    warnings.push(makeUnsupportedSelectionBoundaryBatchWarning(
      'multi-select-nested-group-unsupported',
      selectedLayerIds,
    ));
  }

  if (selectionSummary.passThroughGroupIds.length > 0) {
    warnings.push(makeUnsupportedSelectionBoundaryBatchWarning(
      'multi-select-group-pass-through-unsupported',
      selectedLayerIds,
    ));
  }

  if (selectionSummary.maskedGroupIds.length > 0) {
    warnings.push(makeUnsupportedSelectionBoundaryBatchWarning(
      'multi-select-group-mask-unsupported',
      selectedLayerIds,
    ));
  }

  return warnings;
}

function buildSelectionSummaryPreviewFragment(summary: ImageLayerOrganizationSelectionSummary): string {
  const boundarySummary = summary.boundaries.map((boundary) => {
    const groupLabel = boundary.groupId ?? 'ungrouped';
    return `${groupLabel}:{${formatSignatureList(boundary.selectedLayerIds)}}`
      + ` pass-through=${formatSignatureList(boundary.passThroughGroupIds)}`
      + ` masked=${formatSignatureList(boundary.maskedGroupIds)}`
      + ` nested=${boundary.nestedSelection ? '1' : '0'}`;
  }).join(';');

  return [
    `boundaries=${summary.boundaries.length > 0 ? boundarySummary : 'none'}`,
    `cross=${summary.crossGroupBoundaries ? 1 : 0}`,
    `nested=${summary.nestedSelection ? 1 : 0}`,
    `pass-through=${formatSignatureList(summary.passThroughGroupIds)}`,
    `masked=${formatSignatureList(summary.maskedGroupIds)}`,
  ].join(',');
}

function summarizeLayerLinkGroups(layers: readonly ImageLayer[]): ImageLayerStackLinkGroupSummary[] {
  const groups = new Map<string, string[]>();
  for (const layer of layers) {
    if (!layer.linkGroupId) continue;
    const memberLayerIds = groups.get(layer.linkGroupId) ?? [];
    memberLayerIds.push(layer.id);
    groups.set(layer.linkGroupId, memberLayerIds);
  }
  return Array.from(groups.entries()).map(([groupId, memberLayerIds]) => ({
    groupId,
    memberLayerIds,
    memberCount: memberLayerIds.length,
  }));
}

function summarizeClippingMasks(layers: readonly ImageLayer[]): ImageLayerStackOrganizationReadiness['clippingMasks'] {
  const clippedLayerIds: string[] = [];
  const baseLayerIds: string[] = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (!layer.clippingMask) continue;
    clippedLayerIds.push(layer.id);
    const baseLayer = findClippingBaseLayer(layers, index);
    if (baseLayer && !baseLayerIds.includes(baseLayer.id)) {
      baseLayerIds.push(baseLayer.id);
    }
  }
  return {
    clippedLayerIds,
    baseLayerIds,
  };
}

function summarizeClippingMaskReadiness(
  layers: readonly ImageLayer[],
): ImageLayerOrganizationParityReadiness['clippingMasks'] {
  const clipping = describeImageClippingMaskReadiness(layers);
  const groupBaseVisibility = summarizeGroupBaseVisibilityForOrganization(clipping);
  return {
    chains: clipping.chains.map((chain) => ({
      baseLayerId: chain.baseLayerId,
      clippedLayerIds: chain.clippedLayerIds,
      valid: chain.valid,
    })),
    clippedLayerIds: clipping.clippedLayerIds,
    baseLayerIds: clipping.baseLayerIds,
    invalidLayerIds: clipping.invalidLayerIds,
    groupBaseLayerIds: clipping.groupBaseLayerIds,
    visibleGroupBaseLayerIds: groupBaseVisibility
      .filter((entry) => entry.effectiveVisible)
      .map((entry) => entry.baseLayerId),
    hiddenGroupBaseLayerIds: groupBaseVisibility
      .filter((entry) => !entry.effectiveVisible)
      .map((entry) => entry.baseLayerId),
    hiddenBaseLayerIds: clipping.hiddenBaseLayerIds,
    groupBaseVisibility,
  };
}

function summarizeGroupBaseVisibilityForOrganization(
  clipping: ImageClippingMaskReadiness,
): ImageLayerClippingMaskGroupBaseVisibility[] {
  const seen = new Set<string>();
  const summaries: ImageLayerClippingMaskGroupBaseVisibility[] = [];
  for (const chain of clipping.chains) {
    if (chain.baseKind !== 'group' || !chain.baseLayerId || seen.has(chain.baseLayerId)) continue;
    seen.add(chain.baseLayerId);
    summaries.push({
      baseLayerId: chain.baseLayerId,
      effectiveVisible: chain.baseVisible,
      visibleDescendantLayerIds: chain.visibleBaseDescendantLayerIds,
      hiddenDescendantLayerIds: chain.hiddenBaseDescendantLayerIds,
      bounds: chain.baseBounds,
    });
  }
  return summaries;
}

function summarizeOrganizationParityBlockers(
  clippingMasks: ImageLayerOrganizationParityReadiness['clippingMasks'],
  handoffTarget: ImageLayerOrganizationSuiteHandoffTarget,
): ImageLayerOrganizationParityBlocker[] {
  const blockers: ImageLayerOrganizationParityBlocker[] = [];
  if (clippingMasks.chains.some((chain) => chain.baseLayerId === null && !chain.valid)) {
    blockers.push('clipping-mask-missing-base');
  }
  if (clippingMasks.hiddenBaseLayerIds.length > 0) {
    blockers.push('clipping-mask-hidden-base');
  }
  if (handoffTarget !== 'internal' && clippingMasks.groupBaseLayerIds.length > 0) {
    blockers.push('clipping-mask-group-base-handoff');
  }
  return blockers;
}

function describeOrganizationSuiteHandoffCaveats(
  clippingMasks: ImageLayerOrganizationParityReadiness['clippingMasks'],
  handoffTarget: ImageLayerOrganizationSuiteHandoffTarget,
): string[] {
  const caveats: string[] = [];
  if (handoffTarget === 'psd-export' && clippingMasks.clippedLayerIds.length > 0) {
    caveats.push('PSD export preserves clipping-mask flags as Sloom Studio metadata, but native Photoshop clipping groups are not guaranteed.');
  }
  if (handoffTarget !== 'internal' && clippingMasks.groupBaseLayerIds.length > 0) {
    caveats.push('Group-base clipping masks flatten through visible descendant alpha for preview/export handoff.');
  }
  return caveats;
}

function buildOrganizationParityReadinessSignature(
  layerCount: number,
  selectedLayerIds: readonly string[],
  clippingMasks: ImageLayerOrganizationParityReadiness['clippingMasks'],
  invalidBlockers: readonly ImageLayerOrganizationParityBlocker[],
  batchBlockers: readonly ImageLayerOrganizationWarningCode[],
  playbackSafe: boolean,
  handoffTarget: ImageLayerOrganizationSuiteHandoffTarget,
): string {
  return [
    'layer-organization-parity:v1',
    `layers:${layerCount}`,
    `selected:${formatSignatureList(selectedLayerIds)}`,
    `clipping:${formatClippingChainSignature(clippingMasks.chains)}`,
    `group-base-visibility:${formatGroupBaseVisibilitySignature(clippingMasks.groupBaseVisibility)}`,
    `invalid:${formatSignatureList(invalidBlockers)}`,
    `batch:${formatSignatureList(batchBlockers)}`,
    `action:${playbackSafe ? 'safe' : 'unsafe'}`,
    `handoff:${handoffTarget}`,
  ].join('|');
}

function formatClippingChainSignature(chains: readonly ImageLayerClippingMaskChainReadiness[]): string {
  if (chains.length === 0) return 'none';
  return chains
    .map((chain) => `${chain.clippedLayerIds.join('+')}->${chain.baseLayerId ?? 'none'}`)
    .join(',');
}

function formatGroupBaseVisibilitySignature(
  summaries: readonly ImageLayerClippingMaskGroupBaseVisibility[],
): string {
  if (summaries.length === 0) return 'none';
  return summaries
    .map((summary) => [
      `${summary.baseLayerId}=${summary.effectiveVisible ? 'visible' : 'hidden'}`,
      formatSignatureList(summary.visibleDescendantLayerIds),
      formatSignatureList(summary.hiddenDescendantLayerIds),
      summary.bounds ? [summary.bounds.x, summary.bounds.y, summary.bounds.width, summary.bounds.height].join(',') : 'none',
    ].join(':'))
    .join(';');
}

function findClippingBaseLayer(layers: readonly ImageLayer[], clippedLayerIndex: number): ImageLayer | undefined {
  const clippedLayer = layers[clippedLayerIndex];
  for (let index = clippedLayerIndex - 1; index >= 0; index -= 1) {
    const candidate = layers[index];
    if (candidate.clippingMask) continue;
    if (candidate.groupId !== clippedLayer.groupId) continue;
    return candidate;
  }
  return undefined;
}

function summarizeUnsupportedGroupedTransformStates(
  layers: readonly ImageLayer[],
): ImageLayerStackUnsupportedTransformState[] {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  return layers.flatMap((layer) => {
    if (!hasLayerTransformState(layer)) return [];
    const reasons: ImageLayerStackUnsupportedTransformReason[] = [];
    if (layer.type === 'group') {
      reasons.push('group-transform');
      if (layer.groupId) {
        reasons.push('nested-group-transform');
      }
    } else if (layer.groupId && layersById.get(layer.groupId)?.type === 'group') {
      reasons.push('descendant-transform-in-group');
    }
    if (reasons.length === 0) return [];
    return [{
      layerId: layer.id,
      layerName: layer.name,
      groupId: layer.groupId ?? null,
      reasons,
    }];
  });
}

function hasLayerTransformState(layer: ImageLayer): boolean {
  return Boolean(
    (Number.isFinite(layer.rotationDeg) && layer.rotationDeg !== 0)
    || (Number.isFinite(layer.skewXDeg) && layer.skewXDeg !== 0)
    || (Number.isFinite(layer.skewYDeg) && layer.skewYDeg !== 0)
    || (Number.isFinite(layer.perspectiveX) && layer.perspectiveX !== 0)
    || (Number.isFinite(layer.perspectiveY) && layer.perspectiveY !== 0)
    || layer.warp
    || layer.cornerOffsets,
  );
}

function summarizeLayerStackBlockers(
  warningCodes: readonly ImageLayerOrganizationWarningCode[],
  unsupportedGroupedTransformStates: readonly ImageLayerStackUnsupportedTransformState[],
): ImageLayerStackOrganizationBlockerCode[] {
  const blockers: ImageLayerStackOrganizationBlockerCode[] = [];
  for (const code of warningCodes) {
    if (isLayerStackBlockerWarning(code)) {
      blockers.push(code);
    }
  }
  if (unsupportedGroupedTransformStates.length > 0) {
    blockers.push('unsupported-grouped-transform-state');
  }
  return blockers;
}

function isLayerStackBlockerWarning(
  code: ImageLayerOrganizationWarningCode,
): code is Extract<ImageLayerStackOrganizationBlockerCode, ImageLayerOrganizationWarningCode> {
  return code === 'multi-select-cross-group-boundaries-unsupported'
    || code === 'multi-select-nested-group-unsupported'
    || code === 'multi-select-group-pass-through-unsupported'
    || code === 'multi-select-group-mask-unsupported';
}

function buildLayerStackReadinessSignature(readiness: ImageLayerStackOrganizationReadiness): string {
  const labelSummary = IMAGE_LAYER_COLOR_LABELS
    .map((label) => `${label.id}=${readiness.labels.countsByLabel[label.id]}`)
    .join(',');
  return [
    `stack:layers=${readiness.layerCount}`,
    `groups=${formatSignatureList(readiness.groups.groupLayerIds)}`,
    `collapsed=${formatSignatureList(readiness.groups.collapsedGroupIds)}`,
    `pass-through=${formatSignatureList(readiness.groups.passThroughGroupIds)}`,
    `masked=${formatSignatureList(readiness.groups.maskedGroupIds)}`,
    `selected=${formatSignatureList(readiness.multiSelect.selectedLayerIds)}`,
    `filtered=${formatSignatureList(readiness.searchFilter.filteredLayerIds)}`,
    `labels=${labelSummary}`,
    `locks=${formatSignatureList(readiness.locks.lockedLayerIds)}`,
    `links=${formatLinkGroupSignature(readiness.links.linkGroups)}`,
    `clipping=${formatClippingSignature(readiness.clippingMasks)}`,
    `blockers=${formatSignatureList(readiness.blockers)}`,
    `unsupported-transforms=${formatUnsupportedTransformSignature(readiness.unsupportedGroupedTransformStates)}`,
  ].join('|');
}

function formatLinkGroupSignature(linkGroups: readonly ImageLayerStackLinkGroupSummary[]): string {
  if (linkGroups.length === 0) return 'none';
  return linkGroups
    .map((group) => `${group.groupId}:${group.memberLayerIds.join('+')}`)
    .join(',');
}

function formatClippingSignature(clippingMasks: ImageLayerStackOrganizationReadiness['clippingMasks']): string {
  if (clippingMasks.clippedLayerIds.length === 0) return 'none';
  return clippingMasks.clippedLayerIds
    .map((layerId, index) => `${layerId}->${clippingMasks.baseLayerIds[index] ?? 'none'}`)
    .join(',');
}

function formatUnsupportedTransformSignature(
  states: readonly ImageLayerStackUnsupportedTransformState[],
): string {
  if (states.length === 0) return 'none';
  return states
    .map((state) => `${state.layerId}:${state.reasons.join('+')}`)
    .join(';');
}

function makeUnsupportedBatchWarning(
  operation: ImageLayerOrganizationBatchOperation,
  selectedLayerIds: readonly string[],
): ImageLayerOrganizationWarning {
  const label = getBatchOperationLabel(operation);
  return {
    code: `multi-select-${operation}-unsupported` as ImageLayerOrganizationWarningCode,
    operation,
    layerIds: [...selectedLayerIds],
    message: `${label} changes are described for selected layers, but multi-select batch organization edits are not yet applied by the Image workspace UI.`,
  };
}

function makeUnsupportedSelectionBoundaryBatchWarning(
  code: ImageLayerOrganizationWarningCode,
  selectedLayerIds: readonly string[],
): ImageLayerOrganizationWarning {
  return {
    code,
    operation: 'source-link',
    layerIds: [...selectedLayerIds],
    message: getBatchSelectionWarningMessage(code),
  };
}

function getBatchSelectionWarningMessage(code: ImageLayerOrganizationWarningCode): string {
  switch (code) {
    case 'multi-select-cross-group-boundaries-unsupported':
      return 'Layer organization helpers can describe selected layers, but descriptor-only multi-select changes are limited when selections cross group boundaries.';
    case 'multi-select-nested-group-unsupported':
      return 'Layer organization helpers can describe multi-select changes, but descriptor-only nested selections spanning parent/child groups are not yet applied in the Image workspace UI.';
    case 'multi-select-group-pass-through-unsupported':
      return 'Layer organization helpers can describe multi-select changes, but descriptor-only batch operations over pass-through groups are currently unsupported in the Image workspace UI.';
    case 'multi-select-group-mask-unsupported':
      return 'Layer organization helpers can describe multi-select changes, but descriptor-only grouped-mask selection behavior is not yet applied in the Image workspace UI.';
    default:
      return 'Layer organization batch changes are described for selected layers, but multi-select batch behavior is not yet applied by the Image workspace UI.';
  }
}

function getBatchOperationLabel(operation: ImageLayerOrganizationBatchOperation): string {
  switch (operation) {
    case 'label':
      return 'Color label';
    case 'lock':
      return 'Layer lock';
    case 'link':
      return 'Layer link';
    case 'group':
      return 'Layer group';
    case 'source-link':
      return 'Source-link';
  }
}

function formatSignatureList(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : 'none';
}
