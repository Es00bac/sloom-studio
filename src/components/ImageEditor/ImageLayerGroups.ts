import type { ImageLayer } from '../../types/imageEditor';

export interface ImageLayerGroupOption {
  id: string;
  name: string;
}

export interface ImageLayerPanelRow {
  layer: ImageLayer;
  depth: number;
}

export type ImageLayerGroupWarningCode =
  | 'missing-parent'
  | 'self-parent'
  | 'cycle-parent'
  | 'target-group-missing'
  | 'target-is-not-group'
  | 'nested-live-folder-parity'
  | 'group-opacity-live-parity'
  | 'group-blend-live-parity'
  | 'group-lock-live-parity'
  | 'group-pass-through-unsupported'
  | 'group-mask-unsupported';

export interface ImageLayerGroupWarning {
  code: ImageLayerGroupWarningCode;
  layerId: string;
  groupId?: string;
  message: string;
}

export interface ImageLayerGroupTreeNode {
  layer: ImageLayer;
  depth: number;
  parentGroupId: string | null;
  childLayerIds: string[];
  children: ImageLayerGroupTreeNode[];
}

export interface ImageLayerGroupTreeNormalization {
  layers: ImageLayer[];
  roots: ImageLayerGroupTreeNode[];
  nodesById: Record<string, ImageLayerGroupTreeNode>;
  warnings: ImageLayerGroupWarning[];
}

export interface ImageLayerGroupTreeSummaryNode {
  layerId: string;
  parentGroupId: string | null;
  depth: number;
  childLayerIds: string[];
  descendantLayerIds: string[];
}

export interface ImageLayerGroupPlanningDescriptor {
  rootLayerIds: string[];
  groupLayerIds: string[];
  leafLayerIds: string[];
  maxDepth: number;
  nodeCount: number;
  treeSummary: ImageLayerGroupTreeSummaryNode[];
  unsupported: {
    passThroughBlendGroupIds: string[];
    maskedGroupIds: string[];
    maskedChildLayerIds: string[];
  };
  warnings: ImageLayerGroupWarning[];
  previewSignature: string;
}

export type ImageLayerGroupBatchOperation =
  | 'move'
  | 'transform'
  | 'visibility'
  | 'lock'
  | 'opacity'
  | 'delete'
  | 'duplicate'
  | 'flatten'
  | 'ungroup';

export type ImageLayerGroupBatchBlockerCode =
  | 'batch-selection-missing-layer'
  | 'tree-has-normalization-warnings'
  | 'batch-cross-group-boundary'
  | 'batch-nested-group-selection'
  | 'batch-pass-through-group'
  | 'batch-group-mask'
  | 'batch-inherited-lock';

export type ImageLayerGroupHierarchyCaveat =
  | 'tree-normalized-with-warnings'
  | 'nested-group-normalized'
  | 'pass-through-group-metadata-only'
  | 'group-mask-metadata-only'
  | 'inherited-locks-block-batch'
  | 'inherited-opacity-preview-only';

export interface ImageLayerGroupHierarchyReadinessOptions {
  selectedLayerIds?: readonly string[];
  requestedBatchOperations?: readonly ImageLayerGroupBatchOperation[];
}

export interface ImageLayerGroupBatchOperationReadiness {
  selectedLayerIds: string[];
  existingSelectedLayerIds: string[];
  missingSelectedLayerIds: string[];
  requestedOperations: ImageLayerGroupBatchOperation[];
  crossGroupBoundaries: boolean;
  nestedSelection: boolean;
  blockedOperationIds: ImageLayerGroupBatchOperation[];
  blockerCodes: ImageLayerGroupBatchBlockerCode[];
}

export interface ImageLayerGroupHierarchyReadiness {
  descriptorId: 'image-layer-group-hierarchy-readiness:v1';
  ready: boolean;
  tree: {
    rootLayerIds: string[];
    groupLayerIds: string[];
    nestedGroupIds: string[];
    leafLayerIds: string[];
    maxDepth: number;
    nodeCount: number;
    treeSummary: ImageLayerGroupTreeSummaryNode[];
    warningCodes: ImageLayerGroupWarningCode[];
    warnings: ImageLayerGroupWarning[];
  };
  unsupported: ImageLayerGroupPlanningDescriptor['unsupported'];
  inheritance: ImageLayerGroupInheritanceSummary[];
  batchOperations: ImageLayerGroupBatchOperationReadiness;
  caveats: ImageLayerGroupHierarchyCaveat[];
  warnings: ImageLayerGroupWarning[];
  previewSignatures: {
    tree: string;
    readiness: string;
  };
}

export interface ImageLayerGroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageLayerGroupCompositingMode = 'normal' | 'pass-through';

export type ImageLayerGroupedStackCaveat =
  | 'normal-group-isolated-metadata'
  | 'pass-through-group-metadata-only'
  | 'nested-group-bounds-derived-from-descendants'
  | 'group-mask-metadata-only'
  | 'empty-group-bounds-unavailable'
  | 'batch-operation-blocked';
export type ImageLayerGroupedStackUnsupportedState =
  | 'pass-through-blend-fidelity'
  | 'live-photoshop-group-mask-parity'
  | 'deep-native-psd-group-mask-roundtrip'
  | 'destructive-batch-operations'
  | 'source-linked-destructive-batch';
export type ImageLayerGroupedStackSourceSafetyBlocker = 'source-linked-layer-destructive-batch';

export interface ImageLayerGroupCompositingDescriptor {
  mode: ImageLayerGroupCompositingMode;
  caveat: Extract<
    ImageLayerGroupedStackCaveat,
    'normal-group-isolated-metadata' | 'pass-through-group-metadata-only'
  >;
}

export interface ImageLayerGroupMaskReadiness {
  present: boolean;
  size: { width: number; height: number } | null;
  readiness: 'none' | 'metadata-only';
}

export interface ImageLayerGroupedStackGroupDescriptor {
  groupId: string;
  groupName: string;
  parentGroupId: string | null;
  depth: number;
  blendMode: ImageLayer['blendMode'];
  compositing: ImageLayerGroupCompositingDescriptor;
  directChildLayerIds: string[];
  descendantGroupIds: string[];
  leafLayerIds: string[];
  bounds: ImageLayerGroupBounds | null;
  mask: ImageLayerGroupMaskReadiness;
  caveats: ImageLayerGroupedStackCaveat[];
}

export type ImageLayerGroupedStackReadinessOptions = ImageLayerGroupHierarchyReadinessOptions;

export interface ImageLayerGroupedStackReadiness {
  descriptorId: 'image-layer-grouped-stack-readiness:v1';
  ready: boolean;
  groupCount: number;
  groups: ImageLayerGroupedStackGroupDescriptor[];
  groupMaskPlan: {
    maskedGroupIds: string[];
    metadataOnlyGroupIds: string[];
    liveRenderableGroupIds: string[];
    nativeRoundtripRiskGroupIds: string[];
    unsupportedStateCodes: Extract<
      ImageLayerGroupedStackUnsupportedState,
      'live-photoshop-group-mask-parity' | 'deep-native-psd-group-mask-roundtrip'
    >[];
  };
  sourceSafety: {
    sourceLinkedLayerIds: string[];
    selectedSourceLinkedLayerIds: string[];
    destructiveBatchSafe: boolean;
    blockers: ImageLayerGroupedStackSourceSafetyBlocker[];
  };
  unsupportedStateSummary: ImageLayerGroupedStackUnsupportedState[];
  batchOperations: ImageLayerGroupBatchOperationReadiness;
  blockers: ImageLayerGroupBatchBlockerCode[];
  caveats: ImageLayerGroupedStackCaveat[];
  previewSignature: string;
}

export interface ImageLayerGroupInheritanceSummary {
  layerId: string;
  ancestorGroupIds: string[];
  effectiveVisible: boolean;
  hiddenByLayerIds: string[];
  effectiveLocked: boolean;
  effectiveLocks: {
    full: boolean;
    pixels: boolean;
    position: boolean;
  };
  lockedByLayerIds: string[];
  effectiveOpacity: number;
  opacityChain: Array<{ layerId: string; opacity: number }>;
  warnings: ImageLayerGroupWarning[];
}

export interface ImageLayerGroupFlattenPlan {
  kind: 'flatten';
  groupId: string;
  groupName: string;
  insertionIndex: number;
  descendantLayerIds: string[];
  descendantGroupIds: string[];
  affectedLayerIds: string[];
  outputLayerName: string;
  effectiveVisible: boolean;
  effectiveLocked: boolean;
  effectiveOpacity: number;
  warnings: ImageLayerGroupWarning[];
}

export interface ImageLayerGroupUngroupPlan {
  kind: 'ungroup';
  groupId: string;
  groupName: string;
  removedGroupId: string;
  promotedToGroupId: string | null;
  directChildIds: string[];
  descendantLayerIds: string[];
  descendantGroupIds: string[];
  layers: ImageLayer[];
  warnings: ImageLayerGroupWarning[];
}

export function isImageLayerGroup(layer: ImageLayer | null | undefined): boolean {
  return layer?.type === 'group';
}

/**
 * Older documents used a non-Normal folder blend mode as their only pass-through hint. Keep
 * that intent readable while an explicit `false` flag selects an isolated folder blend.
 */
export function isImageLayerGroupPassThrough(layer: ImageLayer | null | undefined): boolean {
  return layer?.type === 'group'
    && (layer.groupPassThrough === true || (layer.groupPassThrough === undefined && layer.blendMode !== 'normal'));
}

export function getImageLayerGroupOptions(layers: readonly ImageLayer[]): ImageLayerGroupOption[] {
  return layers
    .filter((layer) => layer.type === 'group')
    .map((layer) => ({ id: layer.id, name: layer.name }));
}

export function getImageLayerGroupDescendantLayers(
  layers: readonly ImageLayer[],
  groupId: string,
): ImageLayer[] {
  const normalized = normalizeImageLayerGroupTree(layers);
  return getGroupDescendants(normalized.layers, groupId);
}

export function setImageLayerGroup(layer: ImageLayer, groupId: string | null): ImageLayer {
  if (groupId === layer.id) return layer;
  if (!groupId) return omitImageLayerGroupId(layer);
  return { ...layer, groupId };
}

export function canAssignImageLayerGroup(
  layer: ImageLayer,
  groupId: string | null,
  layers: readonly ImageLayer[],
): boolean {
  if (!groupId) return true;
  const parent = layers.find((candidate) => candidate.id === groupId && candidate.type === 'group');
  if (!parent || parent.id === layer.id) return false;
  const normalized = normalizeImageLayerGroupTree(layers);
  return !getAncestorGroupIds(parent, normalized.layers).includes(layer.id);
}

export function getImageLayerPanelRows(displayOrderLayers: readonly ImageLayer[]): ImageLayerPanelRow[] {
  const tree = normalizeImageLayerGroupTree(displayOrderLayers);
  return tree.layers
    .filter((layer) => !isImageLayerHiddenByCollapsedGroup(layer, tree))
    .map((layer) => ({
      layer,
      depth: tree.nodesById[layer.id]?.depth ?? 0,
    }));
}

export function isImageLayerEffectivelyVisible(
  layer: ImageLayer | null | undefined,
  layers: readonly ImageLayer[],
): boolean {
  if (!layer) return false;
  return getImageLayerGroupInheritanceSummary(layer, layers).effectiveVisible;
}

/**
 * The off-thread 8-bit compositor accepts a flat layer payload, so any explicit folder row or
 * child-to-folder link must stay on the tree compositor. Treat an orphaned link as hierarchical
 * too: normalization/refusal belongs to the tree path, never to a flattening optimization.
 */
export function hasImageLayerGroupHierarchy(layers: readonly ImageLayer[]): boolean {
  return layers.some((layer) => layer.type === 'group' || typeof layer.groupId === 'string');
}

export function normalizeImageLayerGroupTree(layers: readonly ImageLayer[]): ImageLayerGroupTreeNormalization {
  const warnings: ImageLayerGroupWarning[] = [];
  const groupIds = new Set(layers.filter(isImageLayerGroup).map((layer) => layer.id));
  const normalized = layers.map((layer): ImageLayer => {
    const groupExpanded = layer.type === 'group'
      ? { groupExpanded: layer.groupExpanded !== false }
      : {};

    if (!layer.groupId) {
      return { ...layer, ...groupExpanded };
    }
    if (layer.groupId === layer.id) {
      warnings.push(makeGroupWarning(
        'self-parent',
        layer.id,
        layer.groupId,
        `Layer "${layer.name}" cannot be parented to itself.`,
      ));
      return omitImageLayerGroupId({ ...layer, ...groupExpanded });
    }
    if (!groupIds.has(layer.groupId)) {
      warnings.push(makeGroupWarning(
        'missing-parent',
        layer.id,
        layer.groupId,
        `Layer "${layer.name}" references a missing group "${layer.groupId}".`,
      ));
      return omitImageLayerGroupId({ ...layer, ...groupExpanded });
    }
    return { ...layer, ...groupExpanded };
  });

  const normalizedById = new Map(normalized.map((layer) => [layer.id, layer]));
  const cycleChecked = normalized.map((layer): ImageLayer => {
    if (!layer.groupId) return layer;
    if (!hasAncestorCycle(layer.id, layer.groupId, normalizedById)) return layer;
    warnings.push(makeGroupWarning(
      'cycle-parent',
      layer.id,
      layer.groupId,
      `Layer "${layer.name}" would create a cyclic group tree.`,
    ));
    const nextLayer = omitImageLayerGroupId(layer);
    normalizedById.set(nextLayer.id, nextLayer);
    return nextLayer;
  });

  return buildGroupTree(cycleChecked, warnings);
}

export function getImageLayerGroupInheritanceSummary(
  sourceLayer: ImageLayer,
  layers: readonly ImageLayer[],
): ImageLayerGroupInheritanceSummary {
  const normalized = normalizeImageLayerGroupTree(layers);
  const layer = normalized.layers.find((candidate) => candidate.id === sourceLayer.id) ?? sourceLayer;
  return buildImageLayerGroupInheritanceSummary(layer, normalized);
}

function buildImageLayerGroupInheritanceSummary(
  layer: ImageLayer,
  normalized: ImageLayerGroupTreeNormalization,
  inherited?: {
    ancestorGroupIds: string[];
    hiddenByLayerIds: string[];
    lockedByLayerIds: string[];
    effectiveLocks: { full: boolean; pixels: boolean; position: boolean };
    opacityChain: Array<{ layerId: string; opacity: number }>;
  },
): ImageLayerGroupInheritanceSummary {
  const ancestorGroupIds = inherited?.ancestorGroupIds ?? getAncestorGroupIdsFromTree(layer, normalized);
  const chain = [layer, ...ancestorGroupIds
    .map((groupId) => normalized.layers.find((candidate) => candidate.id === groupId))
    .filter((candidate): candidate is ImageLayer => Boolean(candidate))];
  const opacityChain = [
    { layerId: layer.id, opacity: normalizeLayerOpacity(layer.opacity) },
    ...(inherited?.opacityChain ?? chain.slice(1).map((entry) => ({
      layerId: entry.id,
      opacity: normalizeLayerOpacity(entry.opacity),
    }))),
  ];
  const hiddenByLayerIds = inherited
    ? [...(layer.visible ? [] : [layer.id]), ...inherited.hiddenByLayerIds]
    : chain.filter((entry) => !entry.visible).map((entry) => entry.id);
  const lockedByLayerIds = inherited
    ? [...(isLayerLockingAnything(layer) ? [layer.id] : []), ...inherited.lockedByLayerIds]
    : chain.filter((entry) => isLayerLockingAnything(entry)).map((entry) => entry.id);
  const hasFullLock = Boolean(inherited?.effectiveLocks.full) || layer.locked || chain.slice(1).some((entry) => entry.locked);
  const hasPixelLock = hasFullLock || Boolean(inherited?.effectiveLocks.pixels) || layer.locks?.pixels === true || chain.slice(1).some((entry) => entry.locks?.pixels === true);
  const hasPositionLock = hasFullLock || Boolean(inherited?.effectiveLocks.position) || layer.locks?.position === true || chain.slice(1).some((entry) => entry.locks?.position === true);

  return {
    layerId: layer.id,
    ancestorGroupIds,
    effectiveVisible: hiddenByLayerIds.length === 0,
    hiddenByLayerIds,
    effectiveLocked: hasFullLock || hasPixelLock || hasPositionLock,
    effectiveLocks: {
      full: hasFullLock,
      pixels: hasPixelLock,
      position: hasPositionLock,
    },
    lockedByLayerIds,
    effectiveOpacity: roundOpacity(opacityChain.reduce((opacity, entry) => opacity * entry.opacity, 1)),
    opacityChain,
    warnings: normalized.warnings.filter((warning) => warning.layerId === layer.id || ancestorGroupIds.includes(warning.layerId)),
  };
}

function buildImageLayerGroupInheritanceSummaries(
  normalized: ImageLayerGroupTreeNormalization,
  selectedLayerIds: ReadonlySet<string> | null,
): ImageLayerGroupInheritanceSummary[] {
  const summaries = new Map<string, ImageLayerGroupInheritanceSummary>();

  const visit = (
    node: ImageLayerGroupTreeNode,
    inherited?: Parameters<typeof buildImageLayerGroupInheritanceSummary>[2],
  ): void => {
    const summary = buildImageLayerGroupInheritanceSummary(node.layer, normalized, inherited);
    if (selectedLayerIds === null || selectedLayerIds.has(node.layer.id)) {
      summaries.set(node.layer.id, summary);
    }
    if (node.layer.type !== 'group') return;
    const nextInherited = {
      ancestorGroupIds: [node.layer.id, ...(inherited?.ancestorGroupIds ?? [])],
      hiddenByLayerIds: [
        ...(node.layer.visible ? [] : [node.layer.id]),
        ...(inherited?.hiddenByLayerIds ?? []),
      ],
      lockedByLayerIds: [
        ...(isLayerLockingAnything(node.layer) ? [node.layer.id] : []),
        ...(inherited?.lockedByLayerIds ?? []),
      ],
      effectiveLocks: {
        full: Boolean(inherited?.effectiveLocks.full) || node.layer.locked,
        pixels: Boolean(inherited?.effectiveLocks.pixels) || node.layer.locked || node.layer.locks?.pixels === true,
        position: Boolean(inherited?.effectiveLocks.position) || node.layer.locked || node.layer.locks?.position === true,
      },
      opacityChain: [
        { layerId: node.layer.id, opacity: normalizeLayerOpacity(node.layer.opacity) },
        ...(inherited?.opacityChain ?? []),
      ],
    };
    for (const child of node.children) visit(child, nextInherited);
  };

  for (const root of normalized.roots) visit(root);
  return normalized.layers
    .map((layer) => summaries.get(layer.id))
    .filter((summary): summary is ImageLayerGroupInheritanceSummary => Boolean(summary));
}

export function buildImageLayerGroupPlanningDescriptor(
  layers: readonly ImageLayer[],
): ImageLayerGroupPlanningDescriptor {
  return buildImageLayerGroupPlanningDescriptorFromNormalized(normalizeImageLayerGroupTree(layers));
}

function buildImageLayerGroupPlanningDescriptorFromNormalized(
  normalized: ImageLayerGroupTreeNormalization,
): ImageLayerGroupPlanningDescriptor {
  const treeSummary = summarizeImageLayerGroupTree(normalized.roots);
  const groupLayerIds = normalized.layers
    .filter(isImageLayerGroup)
    .map((layer) => layer.id);
  const leafLayerIds = normalized.layers
    .filter((layer) => layer.type !== 'group')
    .map((layer) => layer.id);
  const passThroughBlendGroupIds = normalized.layers
    .filter(isImageLayerGroupPassThrough)
    .map((layer) => layer.id);
  const maskedGroupIds = normalized.layers
    .filter((layer) => layer.type === 'group' && Boolean(layer.mask))
    .map((layer) => layer.id);
  const maskedChildLayerIds = normalized.layers
    .filter((layer) => layer.type !== 'group' && Boolean(layer.mask))
    .map((layer) => layer.id);
  const warnings = [
    ...normalized.warnings,
    ...buildGroupPlanningUnsupportedWarnings(passThroughBlendGroupIds, maskedGroupIds),
  ];

  return {
    rootLayerIds: normalized.roots.map((node) => node.layer.id),
    groupLayerIds,
    leafLayerIds,
    maxDepth: treeSummary.reduce((maxDepth, node) => Math.max(maxDepth, node.depth), 0),
    nodeCount: normalized.layers.length,
    treeSummary,
    unsupported: {
      passThroughBlendGroupIds,
      maskedGroupIds,
      maskedChildLayerIds,
    },
    warnings,
    previewSignature: buildGroupPlanningPreviewSignature(
      normalized.roots.map((node) => node.layer.id),
      groupLayerIds,
      leafLayerIds,
      treeSummary,
      passThroughBlendGroupIds,
      maskedGroupIds,
      maskedChildLayerIds,
      warnings,
    ),
  };
}

export function describeImageLayerGroupHierarchyReadiness(
  layers: readonly ImageLayer[],
  options: ImageLayerGroupHierarchyReadinessOptions = {},
): ImageLayerGroupHierarchyReadiness {
  const normalized = normalizeImageLayerGroupTree(layers);
  const planning = buildImageLayerGroupPlanningDescriptorFromNormalized(normalized);
  const nestedGroupIds = normalized.layers
    .filter((layer) => layer.type === 'group' && Boolean(layer.groupId))
    .map((layer) => layer.id);
  const selectedLayerIds = dedupeStringList(options.selectedLayerIds ?? []);
  const requestedOperations = dedupeBatchOperations(options.requestedBatchOperations ?? []);
  const layersById = new Map(normalized.layers.map((layer) => [layer.id, layer]));
  const existingSelectedLayers = selectedLayerIds
    .map((layerId) => layersById.get(layerId))
    .filter((layer): layer is ImageLayer => Boolean(layer));
  const missingSelectedLayerIds = selectedLayerIds.filter((layerId) => !layersById.has(layerId));
  const inheritanceSourceLayerIds = selectedLayerIds.length > 0
    ? new Set(existingSelectedLayers.map((layer) => layer.id))
    : null;
  const inheritance = buildImageLayerGroupInheritanceSummaries(normalized, inheritanceSourceLayerIds);
  const batchOperations = buildGroupBatchOperationReadiness(
    selectedLayerIds,
    existingSelectedLayers,
    missingSelectedLayerIds,
    requestedOperations,
    normalized,
    planning,
    inheritance,
  );
  const caveats = buildHierarchyReadinessCaveats(normalized, planning, nestedGroupIds, inheritance);
  const warningCodes = planning.warnings.map((warning) => warning.code);
  const readiness: ImageLayerGroupHierarchyReadiness = {
    descriptorId: 'image-layer-group-hierarchy-readiness:v1',
    ready: planning.warnings.length === 0 && batchOperations.blockerCodes.length === 0,
    tree: {
      rootLayerIds: planning.rootLayerIds,
      groupLayerIds: planning.groupLayerIds,
      nestedGroupIds,
      leafLayerIds: planning.leafLayerIds,
      maxDepth: planning.maxDepth,
      nodeCount: planning.nodeCount,
      treeSummary: planning.treeSummary,
      warningCodes,
      warnings: planning.warnings,
    },
    unsupported: planning.unsupported,
    inheritance,
    batchOperations,
    caveats,
    warnings: planning.warnings,
    previewSignatures: {
      tree: planning.previewSignature,
      readiness: '',
    },
  };
  readiness.previewSignatures.readiness = buildGroupHierarchyReadinessSignature(readiness);
  return readiness;
}

export function describeImageLayerGroupedStackReadiness(
  layers: readonly ImageLayer[],
  options: ImageLayerGroupedStackReadinessOptions = {},
): ImageLayerGroupedStackReadiness {
  const normalized = normalizeImageLayerGroupTree(layers);
  const hierarchy = describeImageLayerGroupHierarchyReadiness(layers, options);
  const layersById = new Map(normalized.layers.map((layer) => [layer.id, layer]));
  const selectedLayers = dedupeStringList(options.selectedLayerIds ?? [])
    .map((layerId) => layersById.get(layerId))
    .filter((layer): layer is ImageLayer => Boolean(layer));
  const touchedGroupIds = collectTouchedGroupIds(selectedLayers, normalized.layers);
  const groups = normalized.layers
    .filter(isImageLayerGroup)
    .map((group) => describeGroupedStackGroup(group, normalized, touchedGroupIds, hierarchy.batchOperations.blockerCodes));
  const caveats = dedupeGroupedStackCaveats(groups.flatMap((group) => group.caveats));
  const blockers = hierarchy.batchOperations.blockerCodes;
  const groupMaskPlan = buildGroupMaskPlan(groups);
  const sourceSafety = buildGroupedStackSourceSafety(normalized.layers, selectedLayers, options.requestedBatchOperations ?? []);
  const unsupportedStateSummary = buildGroupedStackUnsupportedStateSummary(groups, blockers, groupMaskPlan, sourceSafety);
  const readiness: ImageLayerGroupedStackReadiness = {
    descriptorId: 'image-layer-grouped-stack-readiness:v1',
    ready: hierarchy.ready && !caveats.some(isUnsupportedGroupedStackCaveat),
    groupCount: groups.length,
    groups,
    groupMaskPlan,
    sourceSafety,
    unsupportedStateSummary,
    batchOperations: hierarchy.batchOperations,
    blockers,
    caveats,
    previewSignature: '',
  };
  readiness.previewSignature = buildGroupedStackReadinessSignature(readiness);
  return readiness;
}

export function planImageLayerGroupFlatten(
  layers: readonly ImageLayer[],
  groupId: string,
): ImageLayerGroupFlattenPlan {
  const normalized = normalizeImageLayerGroupTree(layers);
  const group = normalized.layers.find((layer) => layer.id === groupId);
  if (!group || group.type !== 'group') {
    return emptyFlattenPlan(groupId, normalized.warnings, group?.type === 'group' ? 'target-group-missing' : 'target-is-not-group');
  }

  const descendants = getGroupDescendants(normalized.layers, groupId);
  const descendantLayerIds = descendants
    .filter((layer) => layer.type !== 'group')
    .map((layer) => layer.id);
  const descendantGroupIds = descendants
    .filter(isImageLayerGroup)
    .map((layer) => layer.id);
  const affectedLayerIds = normalized.layers
    .filter((layer) => layer.id === groupId || getAncestorGroupIds(layer, normalized.layers).includes(groupId))
    .map((layer) => layer.id);
  const summary = getImageLayerGroupInheritanceSummary(group, normalized.layers);

  return {
    kind: 'flatten',
    groupId,
    groupName: group.name,
    insertionIndex: normalized.layers.findIndex((layer) => layer.id === groupId),
    descendantLayerIds,
    descendantGroupIds,
    affectedLayerIds,
    outputLayerName: `${group.name} (flattened)`,
    effectiveVisible: summary.effectiveVisible,
    effectiveLocked: summary.effectiveLocked,
    effectiveOpacity: summary.effectiveOpacity,
    warnings: [
      ...normalized.warnings,
      ...getLiveFolderParityWarnings(group, descendants),
    ],
  };
}

export function planImageLayerGroupUngroup(
  layers: readonly ImageLayer[],
  groupId: string,
): ImageLayerGroupUngroupPlan {
  const normalized = normalizeImageLayerGroupTree(layers);
  const group = normalized.layers.find((layer) => layer.id === groupId);
  if (!group || group.type !== 'group') {
    return emptyUngroupPlan(groupId, normalized.layers, normalized.warnings, group?.type === 'group' ? 'target-group-missing' : 'target-is-not-group');
  }

  const descendants = getGroupDescendants(normalized.layers, groupId);
  const directChildIds = normalized.layers
    .filter((layer) => layer.groupId === groupId)
    .map((layer) => layer.id);
  const parentGroupId = group.groupId ?? null;
  const nextLayers = normalized.layers
    .filter((layer) => layer.id !== groupId)
    .map((layer) => {
      if (layer.groupId !== groupId) return layer;
      return parentGroupId ? { ...layer, groupId: parentGroupId } : omitImageLayerGroupId(layer);
    });

  return {
    kind: 'ungroup',
    groupId,
    groupName: group.name,
    removedGroupId: group.id,
    promotedToGroupId: parentGroupId,
    directChildIds,
    descendantLayerIds: descendants.filter((layer) => layer.type !== 'group').map((layer) => layer.id),
    descendantGroupIds: descendants.filter(isImageLayerGroup).map((layer) => layer.id),
    layers: nextLayers,
    warnings: [
      ...normalized.warnings,
      ...getLiveFolderParityWarnings(group, descendants).filter((warning) => warning.code !== 'nested-live-folder-parity'),
    ],
  };
}

function isImageLayerHiddenByCollapsedGroup(
  layer: ImageLayer,
  normalized: ImageLayerGroupTreeNormalization,
): boolean {
  let groupId = layer.groupId;
  const seen = new Set<string>();
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId);
    const group = normalized.nodesById[groupId]?.layer;
    if (!group || group.type !== 'group') break;
    if (group.groupExpanded === false) return true;
    groupId = group.groupId;
  }
  return false;
}

function omitImageLayerGroupId(layer: ImageLayer): ImageLayer {
  const { groupId: _groupId, ...rest } = layer;
  return rest;
}

function buildGroupTree(
  layers: readonly ImageLayer[],
  warnings: ImageLayerGroupWarning[],
): ImageLayerGroupTreeNormalization {
  const nodesById: Record<string, ImageLayerGroupTreeNode> = {};
  for (const layer of layers) {
    nodesById[layer.id] = {
      layer,
      depth: 0,
      parentGroupId: layer.groupId ?? null,
      childLayerIds: [],
      children: [],
    };
  }

  for (const layer of layers) {
    if (!layer.groupId) continue;
    const parent = nodesById[layer.groupId];
    if (!parent) continue;
    parent.childLayerIds.push(layer.id);
    parent.children.push(nodesById[layer.id]);
  }

  const roots = layers
    .filter((layer) => !layer.groupId)
    .map((layer) => nodesById[layer.id]);
  for (const root of roots) {
    applyNodeDepth(root, 0);
  }

  return {
    layers: [...layers],
    roots,
    nodesById,
    warnings,
  };
}

function applyNodeDepth(node: ImageLayerGroupTreeNode, depth: number): void {
  node.depth = depth;
  for (const child of node.children) {
    applyNodeDepth(child, depth + 1);
  }
}

function summarizeImageLayerGroupTree(
  roots: readonly ImageLayerGroupTreeNode[],
): ImageLayerGroupTreeSummaryNode[] {
  const preOrder: ImageLayerGroupTreeNode[] = [];
  const descendantsByNode = new WeakMap<ImageLayerGroupTreeNode, string[]>();

  const collect = (node: ImageLayerGroupTreeNode): string[] => {
    const cached = descendantsByNode.get(node);
    if (cached) return cached;
    const ids: string[] = [];
    for (const child of node.children) {
      ids.push(child.layer.id, ...collect(child));
    }
    descendantsByNode.set(node, ids);
    return ids;
  };
  const visit = (node: ImageLayerGroupTreeNode): void => {
    preOrder.push(node);
    collect(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);

  return preOrder.map((node) => ({
    layerId: node.layer.id,
    parentGroupId: node.parentGroupId,
    depth: node.depth,
    childLayerIds: [...node.childLayerIds],
    descendantLayerIds: [...(descendantsByNode.get(node) ?? [])],
  }));
}

function getAncestorGroupIds(layer: ImageLayer, layers: readonly ImageLayer[]): string[] {
  return getAncestorGroupIdsFromMap(layer, new Map(layers.map((entry) => [entry.id, entry])));
}

function getAncestorGroupIdsFromMap(
  layer: ImageLayer,
  layersById: ReadonlyMap<string, ImageLayer>,
): string[] {
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

function getAncestorGroupIdsFromTree(
  layer: ImageLayer,
  normalized: ImageLayerGroupTreeNormalization,
): string[] {
  const ancestorGroupIds: string[] = [];
  const seen = new Set<string>();
  let groupId = layer.groupId;
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId);
    const node = normalized.nodesById[groupId];
    if (!node || node.layer.type !== 'group') break;
    ancestorGroupIds.push(groupId);
    groupId = node.parentGroupId ?? undefined;
  }
  return ancestorGroupIds;
}

function getGroupDescendants(layers: readonly ImageLayer[], groupId: string): ImageLayer[] {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  return layers.filter((layer) => layer.id !== groupId && getAncestorGroupIdsFromMap(layer, layersById).includes(groupId));
}

function hasAncestorCycle(
  layerId: string,
  parentGroupId: string,
  layersById: ReadonlyMap<string, ImageLayer>,
): boolean {
  const seen = new Set<string>();
  let currentGroupId: string | undefined = parentGroupId;
  while (currentGroupId) {
    if (currentGroupId === layerId || seen.has(currentGroupId)) return true;
    seen.add(currentGroupId);
    currentGroupId = layersById.get(currentGroupId)?.groupId;
  }
  return false;
}

function isLayerLockingAnything(layer: ImageLayer): boolean {
  return layer.locked || layer.locks?.pixels === true || layer.locks?.position === true;
}

function normalizeLayerOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(1, Math.max(0, opacity));
}

function roundOpacity(opacity: number): number {
  return Math.round(opacity * 10000) / 10000;
}

function getLiveFolderParityWarnings(
  group: ImageLayer,
  descendants: readonly ImageLayer[],
): ImageLayerGroupWarning[] {
  const descendantGroups = descendants.filter(isImageLayerGroup);
  const groups = [group, ...descendantGroups];
  const warnings: ImageLayerGroupWarning[] = [];
  if (descendantGroups.length > 0) {
    warnings.push(makeGroupWarning(
      'nested-live-folder-parity',
      group.id,
      undefined,
      'Nested folders are represented for planning, but live nested folder persistence/render parity is incomplete.',
    ));
  }
  if (groups.some((entry) => normalizeLayerOpacity(entry.opacity) !== 1)) {
    warnings.push(makeGroupWarning(
      'group-opacity-live-parity',
      group.id,
      undefined,
      'Folder opacity is summarized for planning; live group opacity compositing still needs bake/flatten handling.',
    ));
  }
  if (groups.some(isImageLayerGroupPassThrough)) {
    warnings.push(makeGroupWarning(
      'group-blend-live-parity',
      group.id,
      undefined,
      'Folder blend modes are summarized for planning; live pass-through/isolated folder blending is not fully supported.',
    ));
  }
  if (groups.some(isLayerLockingAnything)) {
    warnings.push(makeGroupWarning(
      'group-lock-live-parity',
      group.id,
      undefined,
      'Folder locks are inherited by helper summaries; live UI enforcement remains limited to existing lock paths.',
    ));
  }
  return warnings;
}

function buildGroupPlanningUnsupportedWarnings(
  passThroughBlendGroupIds: readonly string[],
  maskedGroupIds: readonly string[],
): ImageLayerGroupWarning[] {
  const warnings: ImageLayerGroupWarning[] = [];
  for (const layerId of passThroughBlendGroupIds) {
    warnings.push(makeGroupWarning(
      'group-pass-through-unsupported',
      layerId,
      undefined,
      'Folder blend mode/pass-through behavior is summarized for planning; live Photoshop pass-through group compositing is not yet supported.',
    ));
  }
  for (const layerId of maskedGroupIds) {
    warnings.push(makeGroupWarning(
      'group-mask-unsupported',
      layerId,
      undefined,
      'Layer group masks are detected for planning, but live folder mask compositing is not yet supported.',
    ));
  }
  return warnings;
}

function buildGroupBatchOperationReadiness(
  selectedLayerIds: readonly string[],
  selectedLayers: readonly ImageLayer[],
  missingSelectedLayerIds: readonly string[],
  requestedOperations: readonly ImageLayerGroupBatchOperation[],
  normalized: ImageLayerGroupTreeNormalization,
  planning: ImageLayerGroupPlanningDescriptor,
  inheritance: readonly ImageLayerGroupInheritanceSummary[],
): ImageLayerGroupBatchOperationReadiness {
  const crossGroupBoundaries = hasCrossGroupBoundary(selectedLayers);
  const nestedSelection = hasNestedGroupSelection(selectedLayers, normalized.layers);
  const touchedGroupIds = collectTouchedGroupIds(selectedLayers, normalized.layers);
  const blockerCodes: ImageLayerGroupBatchBlockerCode[] = [];
  if (missingSelectedLayerIds.length > 0) blockerCodes.push('batch-selection-missing-layer');
  if (normalized.warnings.length > 0) blockerCodes.push('tree-has-normalization-warnings');
  if (crossGroupBoundaries) blockerCodes.push('batch-cross-group-boundary');
  if (nestedSelection) blockerCodes.push('batch-nested-group-selection');
  if (planning.unsupported.passThroughBlendGroupIds.some((groupId) => touchedGroupIds.has(groupId))) {
    blockerCodes.push('batch-pass-through-group');
  }
  if (planning.unsupported.maskedGroupIds.some((groupId) => touchedGroupIds.has(groupId))) {
    blockerCodes.push('batch-group-mask');
  }
  if (inheritance.some((summary) => summary.effectiveLocked)) {
    blockerCodes.push('batch-inherited-lock');
  }

  return {
    selectedLayerIds: [...selectedLayerIds],
    existingSelectedLayerIds: selectedLayers.map((layer) => layer.id),
    missingSelectedLayerIds: [...missingSelectedLayerIds],
    requestedOperations: [...requestedOperations],
    crossGroupBoundaries,
    nestedSelection,
    blockedOperationIds: blockerCodes.length > 0 ? [...requestedOperations] : [],
    blockerCodes,
  };
}

function buildHierarchyReadinessCaveats(
  normalized: ImageLayerGroupTreeNormalization,
  planning: ImageLayerGroupPlanningDescriptor,
  nestedGroupIds: readonly string[],
  inheritance: readonly ImageLayerGroupInheritanceSummary[],
): ImageLayerGroupHierarchyCaveat[] {
  const caveats: ImageLayerGroupHierarchyCaveat[] = [];
  if (normalized.warnings.length > 0) caveats.push('tree-normalized-with-warnings');
  if (nestedGroupIds.length > 0) caveats.push('nested-group-normalized');
  if (planning.unsupported.passThroughBlendGroupIds.length > 0) caveats.push('pass-through-group-metadata-only');
  if (planning.unsupported.maskedGroupIds.length > 0) caveats.push('group-mask-metadata-only');
  if (inheritance.some((summary) => summary.effectiveLocked)) caveats.push('inherited-locks-block-batch');
  if (inheritance.some(hasInheritedOpacityCaveat)) caveats.push('inherited-opacity-preview-only');
  return caveats;
}

function hasCrossGroupBoundary(selectedLayers: readonly ImageLayer[]): boolean {
  if (selectedLayers.length < 2) return false;
  return new Set(selectedLayers.map((layer) => layer.groupId ?? '')).size > 1;
}

function hasNestedGroupSelection(
  selectedLayers: readonly ImageLayer[],
  layers: readonly ImageLayer[],
): boolean {
  const selectedLayerIds = new Set(selectedLayers.map((layer) => layer.id));
  return selectedLayers.some((layer) => {
    const ancestorGroupIds = getAncestorGroupIds(layer, layers);
    return ancestorGroupIds.length > 1
      || (layer.type === 'group' && selectedLayers.some((candidate) => (
        candidate.id !== layer.id && getAncestorGroupIds(candidate, layers).includes(layer.id)
      )))
      || ancestorGroupIds.some((groupId) => selectedLayerIds.has(groupId));
  });
}

function collectTouchedGroupIds(
  selectedLayers: readonly ImageLayer[],
  layers: readonly ImageLayer[],
): Set<string> {
  const touchedGroupIds = new Set<string>();
  for (const layer of selectedLayers) {
    if (layer.type === 'group') touchedGroupIds.add(layer.id);
    for (const groupId of getAncestorGroupIds(layer, layers)) {
      touchedGroupIds.add(groupId);
    }
  }
  return touchedGroupIds;
}

function hasInheritedOpacityCaveat(summary: ImageLayerGroupInheritanceSummary): boolean {
  if (summary.opacityChain.length < 2) return false;
  return summary.opacityChain.slice(1).some((entry) => entry.opacity !== 1);
}

function describeGroupedStackGroup(
  group: ImageLayer,
  normalized: ImageLayerGroupTreeNormalization,
  touchedGroupIds: ReadonlySet<string>,
  blockerCodes: readonly ImageLayerGroupBatchBlockerCode[],
): ImageLayerGroupedStackGroupDescriptor {
  const node = normalized.nodesById[group.id];
  const descendants = getGroupDescendants(normalized.layers, group.id);
  const descendantGroupIds = descendants.filter(isImageLayerGroup).map((layer) => layer.id);
  const leafLayerIds = descendants.filter((layer) => layer.type !== 'group').map((layer) => layer.id);
  const bounds = unionLayerBounds(descendants.filter((layer) => layer.type !== 'group'));
  const compositing = describeGroupCompositing(group);
  const caveats: ImageLayerGroupedStackCaveat[] = [compositing.caveat];
  if (descendantGroupIds.length > 0) caveats.push('nested-group-bounds-derived-from-descendants');
  if (group.mask) caveats.push('group-mask-metadata-only');
  if (!bounds) caveats.push('empty-group-bounds-unavailable');
  if (touchedGroupIds.has(group.id) && blockerCodes.length > 0) caveats.push('batch-operation-blocked');

  return {
    groupId: group.id,
    groupName: group.name,
    parentGroupId: group.groupId ?? null,
    depth: node?.depth ?? 0,
    blendMode: group.blendMode,
    compositing,
    directChildLayerIds: node?.childLayerIds ?? [],
    descendantGroupIds,
    leafLayerIds,
    bounds,
    mask: describeGroupMaskReadiness(group),
    caveats,
  };
}

function describeGroupCompositing(group: ImageLayer): ImageLayerGroupCompositingDescriptor {
  if (!isImageLayerGroupPassThrough(group)) {
    return {
      mode: 'normal',
      caveat: 'normal-group-isolated-metadata',
    };
  }
  return {
    mode: 'pass-through',
    caveat: 'pass-through-group-metadata-only',
  };
}

function describeGroupMaskReadiness(group: ImageLayer): ImageLayerGroupMaskReadiness {
  if (!group.mask) {
    return {
      present: false,
      size: null,
      readiness: 'none',
    };
  }
  return {
    present: true,
    size: {
      width: group.mask.width,
      height: group.mask.height,
    },
    readiness: 'metadata-only',
  };
}

function buildGroupMaskPlan(
  groups: readonly ImageLayerGroupedStackGroupDescriptor[],
): ImageLayerGroupedStackReadiness['groupMaskPlan'] {
  const maskedGroupIds = groups
    .filter((group) => group.mask.present)
    .map((group) => group.groupId);
  const unsupportedStateCodes: ImageLayerGroupedStackReadiness['groupMaskPlan']['unsupportedStateCodes'] = [];
  if (maskedGroupIds.length > 0) {
    unsupportedStateCodes.push('live-photoshop-group-mask-parity', 'deep-native-psd-group-mask-roundtrip');
  }
  return {
    maskedGroupIds,
    metadataOnlyGroupIds: [...maskedGroupIds],
    liveRenderableGroupIds: [],
    nativeRoundtripRiskGroupIds: [...maskedGroupIds],
    unsupportedStateCodes,
  };
}

function buildGroupedStackSourceSafety(
  layers: readonly ImageLayer[],
  selectedLayers: readonly ImageLayer[],
  requestedBatchOperations: readonly ImageLayerGroupBatchOperation[],
): ImageLayerGroupedStackReadiness['sourceSafety'] {
  const sourceLinkedLayerIds = layers.filter(isSourceLinkedLayer).map((layer) => layer.id);
  const selectedSourceLinkedLayerIds = selectedLayers.filter(isSourceLinkedLayer).map((layer) => layer.id);
  const destructiveRequested = requestedBatchOperations.some(isDestructiveGroupBatchOperation);
  const blockers: ImageLayerGroupedStackSourceSafetyBlocker[] = destructiveRequested && selectedSourceLinkedLayerIds.length > 0
    ? ['source-linked-layer-destructive-batch']
    : [];
  return {
    sourceLinkedLayerIds,
    selectedSourceLinkedLayerIds,
    destructiveBatchSafe: blockers.length === 0,
    blockers,
  };
}

function buildGroupedStackUnsupportedStateSummary(
  groups: readonly ImageLayerGroupedStackGroupDescriptor[],
  blockers: readonly ImageLayerGroupBatchBlockerCode[],
  groupMaskPlan: ImageLayerGroupedStackReadiness['groupMaskPlan'],
  sourceSafety: ImageLayerGroupedStackReadiness['sourceSafety'],
): ImageLayerGroupedStackUnsupportedState[] {
  const states: ImageLayerGroupedStackUnsupportedState[] = [];
  if (groups.some((group) => group.compositing.mode === 'pass-through')) states.push('pass-through-blend-fidelity');
  states.push(...groupMaskPlan.unsupportedStateCodes);
  if (blockers.length > 0) states.push('destructive-batch-operations');
  if (sourceSafety.blockers.length > 0) states.push('source-linked-destructive-batch');
  return Array.from(new Set(states));
}

function isSourceLinkedLayer(layer: ImageLayer): boolean {
  return Boolean(layer.metadata?.sourceLink?.id || layer.metadata?.smartLinkedSourceId);
}

function isDestructiveGroupBatchOperation(operation: ImageLayerGroupBatchOperation): boolean {
  return operation === 'delete' || operation === 'flatten' || operation === 'ungroup';
}

function unionLayerBounds(layers: readonly ImageLayer[]): ImageLayerGroupBounds | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    const bounds = getLayerBounds(layer);
    if (!bounds) continue;
    x0 = Math.min(x0, bounds.x);
    y0 = Math.min(y0, bounds.y);
    x1 = Math.max(x1, bounds.x + bounds.width);
    y1 = Math.max(y1, bounds.y + bounds.height);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return null;
  }
  return normalizeGroupBounds({
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  });
}

function getLayerBounds(layer: ImageLayer): ImageLayerGroupBounds | null {
  const source = layer.bitmap ?? layer.mask;
  if (!source || !Number.isFinite(source.width) || !Number.isFinite(source.height)) return null;
  return normalizeGroupBounds({
    x: Number.isFinite(layer.x) ? layer.x : 0,
    y: Number.isFinite(layer.y) ? layer.y : 0,
    width: Math.max(0, source.width),
    height: Math.max(0, source.height),
  });
}

function normalizeGroupBounds(bounds: ImageLayerGroupBounds): ImageLayerGroupBounds {
  return {
    x: roundGroupBoundsNumber(bounds.x),
    y: roundGroupBoundsNumber(bounds.y),
    width: roundGroupBoundsNumber(bounds.width),
    height: roundGroupBoundsNumber(bounds.height),
  };
}

function roundGroupBoundsNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dedupeGroupedStackCaveats(values: readonly ImageLayerGroupedStackCaveat[]): ImageLayerGroupedStackCaveat[] {
  return Array.from(new Set(values));
}

function isUnsupportedGroupedStackCaveat(caveat: ImageLayerGroupedStackCaveat): boolean {
  return caveat === 'pass-through-group-metadata-only'
    || caveat === 'group-mask-metadata-only'
    || caveat === 'empty-group-bounds-unavailable'
    || caveat === 'batch-operation-blocked';
}

function buildGroupedStackReadinessSignature(readiness: ImageLayerGroupedStackReadiness): string {
  return [
    readiness.descriptorId,
    `groups=${readiness.groups.map(formatGroupedStackGroupSignature).join(';') || 'none'}`,
    `batch=${formatSignatureList(readiness.batchOperations.requestedOperations)}`,
    `blockers=${formatSignatureList(readiness.blockers)}`,
    `caveats=${formatSignatureList(readiness.caveats)}`,
    `masks=metadata=${formatSignatureList(readiness.groupMaskPlan.metadataOnlyGroupIds)},live=${formatSignatureList(readiness.groupMaskPlan.liveRenderableGroupIds)},native-risk=${formatSignatureList(readiness.groupMaskPlan.nativeRoundtripRiskGroupIds)}`,
    `source=linked=${formatSignatureList(readiness.sourceSafety.sourceLinkedLayerIds)},selected=${formatSignatureList(readiness.sourceSafety.selectedSourceLinkedLayerIds)},blockers=${formatSignatureList(readiness.sourceSafety.blockers)}`,
    `unsupported=${formatSignatureList(readiness.unsupportedStateSummary)}`,
  ].join('|');
}

function formatGroupedStackGroupSignature(group: ImageLayerGroupedStackGroupDescriptor): string {
  return [
    group.groupId,
    group.compositing.mode,
    formatGroupBoundsSignature(group.bounds),
    `mask=${group.mask.present ? 1 : 0}`,
    `children=${group.directChildLayerIds.length > 0 ? group.directChildLayerIds.join('+') : 'none'}`,
  ].join(':');
}

function formatGroupBoundsSignature(bounds: ImageLayerGroupBounds | null): string {
  if (!bounds) return 'none';
  return [bounds.x, bounds.y, bounds.width, bounds.height].join(',');
}

function buildGroupPlanningPreviewSignature(
  rootLayerIds: readonly string[],
  groupLayerIds: readonly string[],
  leafLayerIds: readonly string[],
  treeSummary: readonly ImageLayerGroupTreeSummaryNode[],
  passThroughBlendGroupIds: readonly string[],
  maskedGroupIds: readonly string[],
  maskedChildLayerIds: readonly string[],
  warnings: readonly ImageLayerGroupWarning[],
): string {
  const maxDepth = treeSummary.reduce((max, node) => Math.max(max, node.depth), 0);
  return [
    `roots:${formatSignatureList(rootLayerIds)}`,
    `groups:${formatSignatureList(groupLayerIds)}`,
    `leaves:${formatSignatureList(leafLayerIds)}`,
    `maxDepth:${maxDepth}`,
    `unsupported:pass-through=${formatSignatureList(passThroughBlendGroupIds)};group-masks=${formatSignatureList(maskedGroupIds)};child-masks=${formatSignatureList(maskedChildLayerIds)}`,
    `warnings:${formatSignatureList(warnings.map((warning) => warning.code))}`,
  ].join('|');
}

function buildGroupHierarchyReadinessSignature(readiness: ImageLayerGroupHierarchyReadiness): string {
  return `image-layer-group-hierarchy-readiness:v1:${JSON.stringify({
    roots: readiness.tree.rootLayerIds,
    groups: readiness.tree.groupLayerIds,
    nested: readiness.tree.nestedGroupIds,
    selection: readiness.batchOperations.selectedLayerIds,
    blocked: readiness.batchOperations.blockedOperationIds,
    blockers: readiness.batchOperations.blockerCodes,
    warnings: readiness.tree.warningCodes,
    effective: readiness.inheritance.map((summary) => `${summary.layerId}:${summary.effectiveVisible}:${summary.effectiveLocked}:${summary.effectiveOpacity}`),
  })}`;
}

function emptyFlattenPlan(
  groupId: string,
  warnings: ImageLayerGroupWarning[],
  code: ImageLayerGroupWarningCode,
): ImageLayerGroupFlattenPlan {
  return {
    kind: 'flatten',
    groupId,
    groupName: '',
    insertionIndex: -1,
    descendantLayerIds: [],
    descendantGroupIds: [],
    affectedLayerIds: [],
    outputLayerName: 'Flattened Group',
    effectiveVisible: false,
    effectiveLocked: false,
    effectiveOpacity: 1,
    warnings: [
      ...warnings,
      makeGroupWarning(code, groupId, undefined, `Layer group "${groupId}" cannot be planned because it is missing or not a group.`),
    ],
  };
}

function emptyUngroupPlan(
  groupId: string,
  layers: readonly ImageLayer[],
  warnings: ImageLayerGroupWarning[],
  code: ImageLayerGroupWarningCode,
): ImageLayerGroupUngroupPlan {
  return {
    kind: 'ungroup',
    groupId,
    groupName: '',
    removedGroupId: groupId,
    promotedToGroupId: null,
    directChildIds: [],
    descendantLayerIds: [],
    descendantGroupIds: [],
    layers: [...layers],
    warnings: [
      ...warnings,
      makeGroupWarning(code, groupId, undefined, `Layer group "${groupId}" cannot be planned because it is missing or not a group.`),
    ],
  };
}

function makeGroupWarning(
  code: ImageLayerGroupWarningCode,
  layerId: string,
  groupId: string | undefined,
  message: string,
): ImageLayerGroupWarning {
  return groupId
    ? { code, layerId, groupId, message }
    : { code, layerId, message };
}

function formatSignatureList(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : 'none';
}

function dedupeStringList(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function dedupeBatchOperations(values: readonly ImageLayerGroupBatchOperation[]): ImageLayerGroupBatchOperation[] {
  return Array.from(new Set(values));
}
