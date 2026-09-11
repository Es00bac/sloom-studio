import type { ImageLayer, ImageLayerLocks } from '../types/imageEditor';

export type ImageLayerLockKey = keyof ImageLayerLocks;
export type ImageLayerLockBehaviorKind = 'full' | ImageLayerLockKey;
export type ImageLayerLockPersistedPath = 'locked' | 'locks.pixels' | 'locks.position';
export type ImageLayerLockBlockedOperation = 'pixel-edit' | 'move' | 'transform';
export type ImageLayerLockBatchOperation = 'toggle-full' | 'toggle-pixels' | 'toggle-position' | 'clear';
export type ImageLayerLockBatchWarningCode = 'unsupported-lock-batch-operation';
export type ImageLayerUnsupportedPhotoshopLockState =
  | 'transparent-pixels-lock'
  | 'image-pixels-lock'
  | 'artboard-lock'
  | 'lock-all-linked-layers';
export type ImageLayerLockParityBlocker = 'unsupported-transparent-pixels-lock';
export type ImageLayerLockParityOperation =
  | ImageLayerLockBatchOperation
  | 'toggle-transparent-pixels'
  | 'toggle-image-pixels'
  | 'toggle-artboard'
  | 'lock-all-linked-layers';

export interface ImageLayerLockBehaviorDescriptor {
  kind: ImageLayerLockBehaviorKind;
  label: string;
  enabled: boolean;
  persistedAs: ImageLayerLockPersistedPath;
  blocksPixelEdits: boolean;
  blocksMovement: boolean;
  blocksTransforms: boolean;
}

export interface ImageLayerLockWorkflowDescriptor {
  layerId: string;
  layerType: ImageLayer['type'];
  locked: boolean;
  full: boolean;
  pixels: boolean;
  position: boolean;
  canEditPixels: boolean;
  canMove: boolean;
  labels: string[];
  blockedOperations: ImageLayerLockBlockedOperation[];
  variants: ImageLayerLockBehaviorDescriptor[];
  previewSignature: string;
}

export interface ImageLayerLockBatchPlanningWarning {
  code: ImageLayerLockBatchWarningCode;
  severity: 'warning';
  layerIds: string[];
  message: string;
}

export interface ImageLayerLockBatchPlanningDescriptorOptions {
  selectedLayerIds?: readonly string[];
  requestedOperation?: ImageLayerLockBatchOperation;
}

export interface ImageLayerLockBatchPlanningDescriptor {
  selectedLayerIds: string[];
  selectedCount: number;
  requestedOperation: ImageLayerLockBatchOperation;
  lockedLayerIds: string[];
  blockedOperationSummary: Record<ImageLayerLockBlockedOperation, string[]>;
  warnings: ImageLayerLockBatchPlanningWarning[];
  previewSignature: string;
}

export interface ImageLayerLockParityReadinessOptions {
  requestedOperation?: ImageLayerLockParityOperation;
  actionPlayback?: boolean;
}

export interface ImageLayerLockParityReadinessDescriptor {
  descriptorId: 'image-layer-lock-parity-readiness:v1';
  layerId: string;
  supportedLockStates: ImageLayerLockBehaviorKind[];
  unsupportedPhotoshopStates: ImageLayerUnsupportedPhotoshopLockState[];
  invalidBlockers: ImageLayerLockParityBlocker[];
  actionSuitability: {
    recordable: boolean;
    playbackSafe: boolean;
    reason: string;
  };
  previewSignature: string;
}

const IMAGE_LAYER_LOCK_BEHAVIOR_DEFINITIONS: Array<Omit<ImageLayerLockBehaviorDescriptor, 'enabled'>> = [
  {
    kind: 'full',
    label: 'Full lock',
    persistedAs: 'locked',
    blocksPixelEdits: true,
    blocksMovement: true,
    blocksTransforms: true,
  },
  {
    kind: 'pixels',
    label: 'Pixel edits locked',
    persistedAs: 'locks.pixels',
    blocksPixelEdits: true,
    blocksMovement: false,
    blocksTransforms: false,
  },
  {
    kind: 'position',
    label: 'Position locked',
    persistedAs: 'locks.position',
    blocksPixelEdits: false,
    blocksMovement: true,
    blocksTransforms: true,
  },
];

export function sanitizeImageLayerLocks(value: unknown): ImageLayerLocks | undefined {
  if (!isRecord(value)) return undefined;
  const locks: ImageLayerLocks = {};
  if (value.pixels === true) locks.pixels = true;
  if (value.position === true) locks.position = true;
  return Object.keys(locks).length > 0 ? locks : undefined;
}

export function canEditImageLayerPixels(
  layer: ImageLayer | null | undefined,
  options: { allowTiltmarkSurface?: boolean } = {},
): layer is ImageLayer {
  return Boolean(
    layer
    && layer.type !== 'group'
    && !layer.locked
    && !layer.locks?.pixels
    && (options.allowTiltmarkSurface || layer.metadata?.tiltmark?.role !== 'surface'),
  );
}

export function canMoveImageLayer(layer: ImageLayer | null | undefined): layer is ImageLayer {
  return Boolean(layer && layer.type !== 'group' && !layer.locked && !layer.locks?.position);
}

export function hasAnyImageLayerLock(layer: ImageLayer | null | undefined): boolean {
  return Boolean(layer?.locked || layer?.locks?.pixels || layer?.locks?.position);
}

export function setImageLayerLockVariant(
  layer: ImageLayer,
  key: ImageLayerLockKey,
  enabled: boolean,
): ImageLayer {
  const locks = sanitizeImageLayerLocks(layer.locks) ?? {};
  if (enabled) {
    locks[key] = true;
  } else {
    delete locks[key];
  }

  return Object.keys(locks).length > 0
    ? { ...layer, locks }
    : omitImageLayerLocks(layer);
}

export function describeImageLayerLockWorkflow(layer: ImageLayer): ImageLayerLockWorkflowDescriptor {
  const full = layer.locked === true;
  const pixels = layer.locks?.pixels === true;
  const position = layer.locks?.position === true;
  const labels = describeImageLayerLockLabels(full, pixels, position);
  const blockedOperations = describeImageLayerLockBlockedOperations(full, pixels, position);
  const variants = IMAGE_LAYER_LOCK_BEHAVIOR_DEFINITIONS.map((definition) => ({
    ...definition,
    enabled: definition.kind === 'full'
      ? full
      : definition.kind === 'pixels'
        ? pixels
        : position,
  }));

  return {
    layerId: layer.id,
    layerType: layer.type,
    locked: hasAnyImageLayerLock(layer),
    full,
    pixels,
    position,
    canEditPixels: canEditImageLayerPixels(layer),
    canMove: canMoveImageLayer(layer),
    labels,
    blockedOperations,
    variants,
    previewSignature: buildImageLayerLockPreviewSignature(layer, variants, blockedOperations),
  };
}

export function buildImageLayerLockBatchPlanningDescriptor(
  layers: readonly ImageLayer[],
  options: ImageLayerLockBatchPlanningDescriptorOptions = {},
): ImageLayerLockBatchPlanningDescriptor {
  const selectedLayerIds = dedupeLayerIds(options.selectedLayerIds ?? [])
    .filter((layerId) => layers.some((layer) => layer.id === layerId));
  const selectedLayers = selectedLayerIds
    .map((layerId) => layers.find((layer) => layer.id === layerId))
    .filter((layer): layer is ImageLayer => Boolean(layer));
  const descriptors = selectedLayers.map((layer) => describeImageLayerLockWorkflow(layer));
  const blockedOperationSummary: Record<ImageLayerLockBlockedOperation, string[]> = {
    'pixel-edit': [],
    move: [],
    transform: [],
  };
  for (const descriptor of descriptors) {
    for (const operation of descriptor.blockedOperations) {
      blockedOperationSummary[operation].push(descriptor.layerId);
    }
  }
  const lockedLayerIds = descriptors
    .filter((descriptor) => descriptor.locked)
    .map((descriptor) => descriptor.layerId);
  const requestedOperation = options.requestedOperation ?? 'toggle-full';
  const warnings = selectedLayerIds.length > 1
    ? [makeLockBatchWarning(selectedLayerIds)]
    : [];

  return {
    selectedLayerIds,
    selectedCount: selectedLayerIds.length,
    requestedOperation,
    lockedLayerIds,
    blockedOperationSummary,
    warnings,
    previewSignature: buildLockBatchPreviewSignature(selectedLayerIds, requestedOperation, lockedLayerIds, blockedOperationSummary, warnings),
  };
}

export function describeImageLayerLockParityReadiness(
  layer: ImageLayer,
  options: ImageLayerLockParityReadinessOptions = {},
): ImageLayerLockParityReadinessDescriptor {
  const supportedLockStates: ImageLayerLockBehaviorKind[] = ['full', 'pixels', 'position'];
  const unsupportedPhotoshopStates: ImageLayerUnsupportedPhotoshopLockState[] = [
    'transparent-pixels-lock',
    'image-pixels-lock',
    'artboard-lock',
    'lock-all-linked-layers',
  ];
  const invalidBlockers: ImageLayerLockParityBlocker[] = options.requestedOperation === 'toggle-transparent-pixels'
    ? ['unsupported-transparent-pixels-lock']
    : [];
  const playbackSafe = invalidBlockers.length === 0;

  return {
    descriptorId: 'image-layer-lock-parity-readiness:v1',
    layerId: layer.id,
    supportedLockStates,
    unsupportedPhotoshopStates,
    invalidBlockers,
    actionSuitability: {
      recordable: true,
      playbackSafe,
      reason: playbackSafe
        ? 'Supported full, pixel-edit, and position lock states can be replayed as local layer metadata changes.'
        : 'Unsupported Photoshop lock states are descriptor-only and cannot be replayed as live layer mutations.',
    },
    previewSignature: [
      'lock-parity:v1',
      `layer:${layer.id}`,
      `supported:${formatSignatureList(supportedLockStates)}`,
      `unsupported:${formatSignatureList(unsupportedPhotoshopStates)}`,
      `blockers:${formatSignatureList(invalidBlockers)}`,
      `action:${playbackSafe ? 'safe' : 'unsafe'}`,
    ].join('|'),
  };
}

function omitImageLayerLocks(layer: ImageLayer): ImageLayer {
  const { locks: _locks, ...rest } = layer;
  return rest;
}

function describeImageLayerLockLabels(full: boolean, pixels: boolean, position: boolean): string[] {
  const labels: string[] = [];
  if (full) labels.push('Fully locked');
  if (pixels) labels.push('Pixel edits locked');
  if (position) labels.push('Position locked');
  return labels;
}

function describeImageLayerLockBlockedOperations(
  full: boolean,
  pixels: boolean,
  position: boolean,
): ImageLayerLockBlockedOperation[] {
  const blockedOperations: ImageLayerLockBlockedOperation[] = [];
  if (full || pixels) blockedOperations.push('pixel-edit');
  if (full || position) {
    blockedOperations.push('move', 'transform');
  }
  return blockedOperations;
}

function buildImageLayerLockPreviewSignature(
  layer: ImageLayer,
  variants: readonly ImageLayerLockBehaviorDescriptor[],
  blockedOperations: readonly ImageLayerLockBlockedOperation[],
): string {
  const enabledLocks = variants
    .filter((variant) => variant.enabled)
    .map((variant) => variant.kind);
  return [
    `layer:${layer.id}`,
    `type:${layer.type}`,
    `locks:${formatSignatureList(enabledLocks)}`,
    `blocked:${formatSignatureList(blockedOperations)}`,
  ].join('|');
}

function makeLockBatchWarning(layerIds: readonly string[]): ImageLayerLockBatchPlanningWarning {
  return {
    code: 'unsupported-lock-batch-operation',
    severity: 'warning',
    layerIds: [...layerIds],
    message: 'Layer lock helpers describe multi-select lock changes, but batch lock application is not yet wired into the Image workspace UI.',
  };
}

function buildLockBatchPreviewSignature(
  selectedLayerIds: readonly string[],
  requestedOperation: ImageLayerLockBatchOperation,
  lockedLayerIds: readonly string[],
  blockedOperationSummary: Record<ImageLayerLockBlockedOperation, string[]>,
  warnings: readonly ImageLayerLockBatchPlanningWarning[],
): string {
  return [
    `selected:${formatSignatureList(selectedLayerIds)}`,
    `operation:${requestedOperation}`,
    `locked:${formatSignatureList(lockedLayerIds)}`,
    `blocked:pixel-edit=${formatSignatureList(blockedOperationSummary['pixel-edit'])};move=${formatSignatureList(blockedOperationSummary.move)};transform=${formatSignatureList(blockedOperationSummary.transform)}`,
    `warnings:${formatSignatureList(warnings.map((warning) => warning.code))}`,
  ].join('|');
}

function dedupeLayerIds(layerIds: readonly string[]): string[] {
  return Array.from(new Set(layerIds));
}

function formatSignatureList(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : 'none';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
