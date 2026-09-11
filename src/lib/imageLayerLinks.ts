import type { ImageLayer } from '../types/imageEditor';
import { canMoveImageLayer } from './imageLayerLocks';

export type ImageLayerLinkWorkflowOperation = 'move' | 'transform' | 'batch-link';
export type ImageLayerLinkWarningCode =
  | 'unsupported-linked-transform-semantics'
  | 'unsupported-batch-link-operation';
export type ImageLayerLinkStationaryReason = 'full-lock' | 'position-lock' | 'group-layer';
export type ImageLayerLinkSupportedOperation = 'link-pair' | 'unlink-single' | 'move-linked-members';
export type ImageLayerUnsupportedPhotoshopLinkState =
  | 'linked-scale-rotate-skew-perspective-warp'
  | 'batch-link-selected-layers'
  | 'linked-group-layer-members';
export type ImageLayerLinkParityBlocker =
  | 'linked-transform-unsupported'
  | 'stationary-linked-members'
  | 'group-layer-selected';

export interface ImageLayerLinkWorkflowWarning {
  code: ImageLayerLinkWarningCode;
  severity: 'warning';
  layerIds: string[];
  message: string;
}

export interface ImageLayerLinkMemberDescriptor {
  layerId: string;
  layerName: string;
  layerType: ImageLayer['type'];
  linked: boolean;
  canMove: boolean;
  stationaryReason?: ImageLayerLinkStationaryReason;
}

export interface ImageLayerLinkWorkflowDescriptorOptions {
  requestedOperation?: ImageLayerLinkWorkflowOperation;
  selectedLayerIds?: readonly string[];
}

export interface ImageLayerLinkWorkflowDescriptor {
  activeLayerId: string;
  groupId?: string;
  linked: boolean;
  memberCount: number;
  memberLayerIds: string[];
  movableLayerIds: string[];
  stationaryLayerIds: string[];
  movementSupported: boolean;
  transformSupported: boolean;
  members: ImageLayerLinkMemberDescriptor[];
  warnings: ImageLayerLinkWorkflowWarning[];
  previewSignature: string;
}

export interface ImageLayerLinkGroupPlanningSummary {
  groupId: string;
  memberLayerIds: string[];
  movableLayerIds: string[];
  stationaryLayerIds: string[];
}

export interface ImageLayerLinkBatchPlanningDescriptorOptions extends ImageLayerLinkWorkflowDescriptorOptions {
  activeLayerId: string;
}

export interface ImageLayerLinkBatchPlanningDescriptor {
  activeLayerId: string;
  selectedLayerIds: string[];
  linkGroupSummaries: ImageLayerLinkGroupPlanningSummary[];
  unlinkedLayerIds: string[];
  warningCodes: ImageLayerLinkWarningCode[];
  previewSignature: string;
}

export interface ImageLayerLinkParityReadinessOptions extends ImageLayerLinkBatchPlanningDescriptorOptions {
  actionPlayback?: boolean;
}

export interface ImageLayerLinkParityReadinessDescriptor {
  descriptorId: 'image-layer-link-parity-readiness:v1';
  activeLayerId: string;
  selectedLayerIds: string[];
  supportedOperations: ImageLayerLinkSupportedOperation[];
  unsupportedPhotoshopStates: ImageLayerUnsupportedPhotoshopLinkState[];
  invalidBlockers: ImageLayerLinkParityBlocker[];
  movableLayerIds: string[];
  stationaryLayerIds: string[];
  actionSuitability: {
    recordable: boolean;
    playbackSafe: boolean;
    reason: string;
  };
  batchSuitability: {
    supported: boolean;
    selectedCount: number;
    reason: string;
  };
  previewSignature: string;
}

export function isImageLayerLinked(layer: ImageLayer | null | undefined): boolean {
  return Boolean(layer?.linkGroupId);
}

export function getImageLayerLinkGroupMembers(
  layer: ImageLayer | null | undefined,
  layers: readonly ImageLayer[],
): ImageLayer[] {
  if (!layer?.linkGroupId) return layer ? [layer] : [];
  return layers.filter((candidate) => candidate.linkGroupId === layer.linkGroupId);
}

export function createImageLayerLinkGroupId(): string {
  return `link-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function linkImageLayers(
  layers: readonly ImageLayer[],
  primaryLayerId: string,
  secondaryLayerId: string,
  createId: () => string = createImageLayerLinkGroupId,
): ImageLayer[] {
  if (primaryLayerId === secondaryLayerId) return [...layers];
  const primary = layers.find((layer) => layer.id === primaryLayerId);
  const secondary = layers.find((layer) => layer.id === secondaryLayerId);
  if (!primary || !secondary || primary.type === 'group' || secondary.type === 'group') return [...layers];

  const nextGroupId = primary.linkGroupId ?? secondary.linkGroupId ?? createId();
  const mergedGroupIds = new Set([primary.linkGroupId, secondary.linkGroupId].filter(Boolean));
  return layers.map((layer) => {
    if (layer.id === primaryLayerId || layer.id === secondaryLayerId || (layer.linkGroupId && mergedGroupIds.has(layer.linkGroupId))) {
      return { ...layer, linkGroupId: nextGroupId };
    }
    return layer;
  });
}

export function unlinkImageLayer(layers: readonly ImageLayer[], layerId: string): ImageLayer[] {
  const target = layers.find((layer) => layer.id === layerId);
  if (!target?.linkGroupId) return [...layers];
  const groupId = target.linkGroupId;
  const withoutTarget = layers.map((layer) => (
    layer.id === layerId ? omitImageLayerLinkGroup(layer) : layer
  ));
  const remaining = withoutTarget.filter((layer) => layer.linkGroupId === groupId);
  if (remaining.length >= 2) return withoutTarget;
  return withoutTarget.map((layer) => (
    layer.linkGroupId === groupId ? omitImageLayerLinkGroup(layer) : layer
  ));
}

export function translateLinkedImageLayers(
  layers: readonly ImageLayer[],
  layerId: string,
  delta: { x: number; y: number },
): ImageLayer[] {
  const active = layers.find((layer) => layer.id === layerId);
  if (!active) return [...layers];
  const members = new Set(getImageLayerLinkGroupMembers(active, layers).map((layer) => layer.id));
  if (members.size === 0) members.add(layerId);
  return layers.map((layer) => {
    if (!members.has(layer.id) || !canMoveImageLayer(layer)) return layer;
    return {
      ...layer,
      x: layer.x + delta.x,
      y: layer.y + delta.y,
    };
  });
}

export function describeImageLayerLinkWorkflow(
  layers: readonly ImageLayer[],
  layerId: string,
  options: ImageLayerLinkWorkflowDescriptorOptions = {},
): ImageLayerLinkWorkflowDescriptor {
  const active = layers.find((layer) => layer.id === layerId);
  const members = active ? getImageLayerLinkGroupMembers(active, layers) : [];
  const memberDescriptors = members.map((member) => describeImageLayerLinkMember(member));
  const memberLayerIds = memberDescriptors.map((member) => member.layerId);
  const movableLayerIds = memberDescriptors
    .filter((member) => member.canMove)
    .map((member) => member.layerId);
  const stationaryLayerIds = memberDescriptors
    .filter((member) => !member.canMove)
    .map((member) => member.layerId);
  const hasLinkedMovementGroup = Boolean(active?.linkGroupId && members.length > 1);
  const warnings = describeImageLayerLinkWarnings(memberLayerIds, hasLinkedMovementGroup, options);

  return {
    activeLayerId: active?.id ?? layerId,
    groupId: active?.linkGroupId,
    linked: Boolean(active?.linkGroupId),
    memberCount: members.length,
    memberLayerIds,
    movableLayerIds,
    stationaryLayerIds,
    movementSupported: Boolean(active && canMoveImageLayer(active) && movableLayerIds.length > 0),
    transformSupported: Boolean(active && canMoveImageLayer(active) && !hasLinkedMovementGroup),
    members: memberDescriptors,
    warnings,
    previewSignature: buildImageLayerLinkPreviewSignature(active?.id ?? layerId, active?.linkGroupId, memberLayerIds, movableLayerIds, stationaryLayerIds, warnings),
  };
}

export function buildImageLayerLinkBatchPlanningDescriptor(
  layers: readonly ImageLayer[],
  options: ImageLayerLinkBatchPlanningDescriptorOptions,
): ImageLayerLinkBatchPlanningDescriptor {
  const selectedLayerIds = dedupeLayerIds(options.selectedLayerIds ?? [])
    .filter((layerId) => layers.some((layer) => layer.id === layerId));
  const linkGroupSummaries = describeLinkGroupPlanningSummaries(layers);
  const unlinkedLayerIds = selectedLayerIds.filter((layerId) => {
    const layer = layers.find((candidate) => candidate.id === layerId);
    return layer && !layer.linkGroupId;
  });
  const workflow = describeImageLayerLinkWorkflow(layers, options.activeLayerId, {
    requestedOperation: options.requestedOperation,
    selectedLayerIds,
  });
  const warningCodes = workflow.warnings.map((warning) => warning.code);

  return {
    activeLayerId: workflow.activeLayerId,
    selectedLayerIds,
    linkGroupSummaries,
    unlinkedLayerIds,
    warningCodes,
    previewSignature: buildLinkBatchPreviewSignature(workflow.activeLayerId, selectedLayerIds, linkGroupSummaries, unlinkedLayerIds, warningCodes),
  };
}

export function describeImageLayerLinkParityReadiness(
  layers: readonly ImageLayer[],
  options: ImageLayerLinkParityReadinessOptions,
): ImageLayerLinkParityReadinessDescriptor {
  const selectedLayerIds = dedupeLayerIds(options.selectedLayerIds ?? [])
    .filter((layerId) => layers.some((layer) => layer.id === layerId));
  const workflow = describeImageLayerLinkWorkflow(layers, options.activeLayerId, {
    requestedOperation: options.requestedOperation,
    selectedLayerIds,
  });
  const supportedOperations: ImageLayerLinkSupportedOperation[] = [
    'link-pair',
    'unlink-single',
    'move-linked-members',
  ];
  const unsupportedPhotoshopStates: ImageLayerUnsupportedPhotoshopLinkState[] = [
    'linked-scale-rotate-skew-perspective-warp',
    'batch-link-selected-layers',
    'linked-group-layer-members',
  ];
  const invalidBlockers: ImageLayerLinkParityBlocker[] = [];
  if (options.requestedOperation === 'transform' && workflow.memberCount > 1) {
    invalidBlockers.push('linked-transform-unsupported');
  }
  if (workflow.stationaryLayerIds.length > 0) {
    invalidBlockers.push('stationary-linked-members');
  }
  if (selectedLayerIds.some((layerId) => layers.find((layer) => layer.id === layerId)?.type === 'group')) {
    invalidBlockers.push('group-layer-selected');
  }

  const batchSupported = selectedLayerIds.length <= 2
    && !selectedLayerIds.some((layerId) => layers.find((layer) => layer.id === layerId)?.type === 'group');
  const playbackSafe = invalidBlockers.length === 0 && options.requestedOperation !== 'transform';

  return {
    descriptorId: 'image-layer-link-parity-readiness:v1',
    activeLayerId: workflow.activeLayerId,
    selectedLayerIds,
    supportedOperations,
    unsupportedPhotoshopStates,
    invalidBlockers,
    movableLayerIds: workflow.movableLayerIds,
    stationaryLayerIds: workflow.stationaryLayerIds,
    actionSuitability: {
      recordable: true,
      playbackSafe,
      reason: playbackSafe
        ? 'Pairwise link/unlink and linked movement can be replayed against stable layer ids.'
        : 'Linked layer transforms and batch link selection are descriptor-only; only linked movement replay is safe.',
    },
    batchSuitability: {
      supported: batchSupported,
      selectedCount: selectedLayerIds.length,
      reason: batchSupported
        ? 'Pairwise selected layers can be linked by the existing helper.'
        : 'Batch link helpers can summarize selections but only pairwise link creation is implemented.',
    },
    previewSignature: [
      'link-parity:v1',
      `active:${workflow.activeLayerId}`,
      `selected:${formatSignatureList(selectedLayerIds)}`,
      `supported:${formatSignatureList(supportedOperations)}`,
      `unsupported:${formatSignatureList(unsupportedPhotoshopStates)}`,
      `movable:${formatSignatureList(workflow.movableLayerIds)}`,
      `stationary:${formatSignatureList(workflow.stationaryLayerIds)}`,
      `blockers:${formatSignatureList(invalidBlockers)}`,
      `action:${playbackSafe ? 'safe' : 'unsafe'}`,
      `batch:${batchSupported ? 'supported' : 'unsupported'}`,
    ].join('|'),
  };
}

export function sanitizeImageLayerLinkGroupId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function omitImageLayerLinkGroup(layer: ImageLayer): ImageLayer {
  const { linkGroupId: _linkGroupId, ...rest } = layer;
  return rest;
}

function describeImageLayerLinkMember(layer: ImageLayer): ImageLayerLinkMemberDescriptor {
  const canMove = canMoveImageLayer(layer);
  const stationaryReason = canMove ? undefined : describeStationaryReason(layer);
  return {
    layerId: layer.id,
    layerName: layer.name,
    layerType: layer.type,
    linked: Boolean(layer.linkGroupId),
    canMove,
    ...(stationaryReason ? { stationaryReason } : {}),
  };
}

function describeStationaryReason(layer: ImageLayer): ImageLayerLinkStationaryReason {
  if (layer.type === 'group') return 'group-layer';
  if (layer.locked) return 'full-lock';
  return 'position-lock';
}

function describeImageLayerLinkWarnings(
  memberLayerIds: readonly string[],
  hasLinkedMovementGroup: boolean,
  options: ImageLayerLinkWorkflowDescriptorOptions,
): ImageLayerLinkWorkflowWarning[] {
  const warnings: ImageLayerLinkWorkflowWarning[] = [];
  if (hasLinkedMovementGroup) {
    warnings.push(createImageLayerLinkWarning('unsupported-linked-transform-semantics', memberLayerIds));
  }

  const selectedLayerIds = dedupeLayerIds(options.selectedLayerIds ?? []);
  if (options.requestedOperation === 'batch-link' && selectedLayerIds.length > 2) {
    warnings.push(createImageLayerLinkWarning('unsupported-batch-link-operation', selectedLayerIds));
  }

  return warnings;
}

function describeLinkGroupPlanningSummaries(layers: readonly ImageLayer[]): ImageLayerLinkGroupPlanningSummary[] {
  const groupIds = dedupeLayerIds(layers
    .map((layer) => layer.linkGroupId)
    .filter((groupId): groupId is string => Boolean(groupId)));

  return groupIds.map((groupId) => {
    const members = layers.filter((layer) => layer.linkGroupId === groupId);
    const memberDescriptors = members.map((member) => describeImageLayerLinkMember(member));
    return {
      groupId,
      memberLayerIds: memberDescriptors.map((member) => member.layerId),
      movableLayerIds: memberDescriptors
        .filter((member) => member.canMove)
        .map((member) => member.layerId),
      stationaryLayerIds: memberDescriptors
        .filter((member) => !member.canMove)
        .map((member) => member.layerId),
    };
  });
}

function createImageLayerLinkWarning(
  code: ImageLayerLinkWarningCode,
  layerIds: readonly string[],
): ImageLayerLinkWorkflowWarning {
  if (code === 'unsupported-linked-transform-semantics') {
    return {
      code,
      severity: 'warning',
      layerIds: [...layerIds],
      message: 'Linked layer groups currently move together, but scale, rotate, skew, perspective, and warp transforms are not propagated across linked members.',
    };
  }

  return {
    code,
    severity: 'warning',
    layerIds: [...layerIds],
    message: 'Link helpers currently create or merge one pair at a time; multi-select batch link operations are descriptor-only.',
  };
}

function buildImageLayerLinkPreviewSignature(
  activeLayerId: string,
  groupId: string | undefined,
  memberLayerIds: readonly string[],
  movableLayerIds: readonly string[],
  stationaryLayerIds: readonly string[],
  warnings: readonly ImageLayerLinkWorkflowWarning[],
): string {
  return [
    `active:${activeLayerId}`,
    `group:${groupId ?? 'none'}`,
    `members:${formatSignatureList(memberLayerIds)}`,
    `movable:${formatSignatureList(movableLayerIds)}`,
    `stationary:${formatSignatureList(stationaryLayerIds)}`,
    `warnings:${formatSignatureList(warnings.map((warning) => warning.code))}`,
  ].join('|');
}

function buildLinkBatchPreviewSignature(
  activeLayerId: string,
  selectedLayerIds: readonly string[],
  linkGroupSummaries: readonly ImageLayerLinkGroupPlanningSummary[],
  unlinkedLayerIds: readonly string[],
  warningCodes: readonly ImageLayerLinkWarningCode[],
): string {
  const groups = linkGroupSummaries.length > 0
    ? linkGroupSummaries
      .map((group) => `${group.groupId}[${formatSignatureList(group.memberLayerIds)}/movable=${formatSignatureList(group.movableLayerIds)}/stationary=${formatSignatureList(group.stationaryLayerIds)}]`)
      .join(';')
    : 'none';
  return [
    `active:${activeLayerId}`,
    `selected:${formatSignatureList(selectedLayerIds)}`,
    `groups:${groups}`,
    `unlinked:${formatSignatureList(unlinkedLayerIds)}`,
    `warnings:${formatSignatureList(warningCodes)}`,
  ].join('|');
}

function dedupeLayerIds(layerIds: readonly string[]): string[] {
  return Array.from(new Set(layerIds));
}

function formatSignatureList(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : 'none';
}
