import type {
  ImageLayer,
  ImageLayerMetadata,
  ImageVectorPathPoint,
  LayerBitmap,
} from '../../types/imageEditor';
import { createBitmap } from './LayerBitmap';
import { createMask, invertMask, setPolygon, type SelectionMask } from './SelectionMask';

export type ImageVectorMaskFillRule = 'evenodd';

export interface ImageVectorMaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageVectorMaskPathDescriptor {
  closed: boolean;
  fillRule: ImageVectorMaskFillRule;
  bounds: ImageVectorMaskBounds | null;
  points: ImageVectorPathPoint[];
}

export interface ImageVectorMaskDescriptor {
  id: string;
  name: string;
  kind: 'path';
  targetLayerId: string | null;
  enabled: boolean;
  inverted: boolean;
  linked: boolean;
  path: ImageVectorMaskPathDescriptor;
}

export type ImageVectorMaskDescriptorInput = Omit<
  ImageVectorMaskDescriptor,
  'path' | 'targetLayerId' | 'inverted' | 'linked'
> &
  Partial<Pick<ImageVectorMaskDescriptor, 'targetLayerId' | 'inverted' | 'linked'>> & {
  path: Omit<ImageVectorMaskPathDescriptor, 'fillRule' | 'bounds'> & {
    fillRule?: ImageVectorMaskFillRule;
    bounds?: ImageVectorMaskBounds | null;
  };
};

export type ImageLayerVectorMaskMetadata = ImageLayerMetadata & {
  vectorMask?: ImageVectorMaskDescriptor;
};

export type ImageLayerWithVectorMask = ImageLayer & {
  metadata?: ImageLayerVectorMaskMetadata;
};

export type ImageVectorMaskRasterizationOutputSource = 'layer-mask' | 'layer-bitmap' | 'fallback';

export type ImageVectorMaskWarningCode =
  | 'no-vector-mask'
  | 'vector-mask-disabled'
  | 'target-layer-mismatch'
  | 'unsupported-vector-mask-kind'
  | 'open-path-not-rasterized'
  | 'insufficient-path-points'
  | 'live-bezier-editing-unsupported'
  | 'advanced-path-operations-unsupported'
  | 'boolean-operations-unsupported'
  | 'psd-vector-mask-roundtrip-limited'
  | 'live-vector-render-unsupported';

export interface ImageVectorMaskPlanningWarning {
  code: ImageVectorMaskWarningCode;
  message: string;
}

export interface ImageVectorMaskCapabilityAvailability {
  liveBezierEditing?: boolean;
  advancedPathOperations?: boolean;
  liveVectorRender?: boolean;
}

export type ImageVectorMaskLimitationCategory = 'editing' | 'boolean' | 'psd' | 'rendering';

export interface ImageVectorMaskLimitation {
  code: ImageVectorMaskWarningCode;
  category: ImageVectorMaskLimitationCategory;
  severity: 'warning';
  message: string;
}

export interface ImageVectorMaskPlanPreview {
  id: string;
  signature: string;
}

export type ImageVectorMaskReadinessState = 'ready' | 'ready-with-caveats' | 'blocked';

export interface ImageVectorMaskRasterizationReadiness {
  readinessId: string;
  action: 'rasterize';
  state: ImageVectorMaskReadinessState;
  blockingWarningCodes: ImageVectorMaskWarningCode[];
  exportCaveat: string;
}

export interface ImageVectorMaskTargetMismatch {
  expectedLayerId: string;
  actualLayerId: string;
  warningCode: 'target-layer-mismatch';
}

export interface ImageVectorMaskRasterizationPlan {
  layerId: string;
  descriptorId: string | null;
  targetLayerId: string | null;
  enabled: boolean;
  inverted: boolean;
  linked: boolean;
  canRasterize: boolean;
  outputWidth: number;
  outputHeight: number;
  outputSource: ImageVectorMaskRasterizationOutputSource;
  pathBounds: ImageVectorMaskBounds | null;
  preview: ImageVectorMaskPlanPreview;
  readiness: ImageVectorMaskRasterizationReadiness;
  limitations: ImageVectorMaskLimitation[];
  exportCaveats: string[];
  targetMismatch: ImageVectorMaskTargetMismatch | null;
  warnings: ImageVectorMaskPlanningWarning[];
}

export type ImageVectorMaskActionKind =
  | 'retain'
  | 'rasterize'
  | 'toggle-invert'
  | 'toggle-link'
  | 'boolean-combine'
  | 'boolean-subtract'
  | 'boolean-intersect'
  | 'boolean-exclude'
  | 'psd-editable-roundtrip';

export type ImageVectorMaskActionState = 'ready' | 'blocked' | 'unsupported';

export interface ImageVectorMaskActionSuitability {
  kind: ImageVectorMaskActionKind;
  label: string;
  state: ImageVectorMaskActionState;
  batchSuitable: boolean;
  destructive: boolean;
  preservesEditableVectorMask: boolean;
  requiresRasterization: boolean;
  blockingWarningCodes: ImageVectorMaskWarningCode[];
  caveats: string[];
}

export type ImageVectorMaskUnsupportedStateCode =
  | 'boolean-vector-mask-live-stack-unsupported'
  | 'psd-editable-vector-mask-roundtrip-unsupported';

export interface ImageVectorMaskUnsupportedState {
  code: ImageVectorMaskUnsupportedStateCode;
  category: 'boolean' | 'psd';
  state: 'unsupported';
  message: string;
}

export interface ImageVectorMaskRetainedReadiness {
  present: boolean;
  descriptorId: string | null;
  pathEditable: boolean;
  preservesVectorPath: boolean;
  targetLayerId: string | null;
  enabled: boolean;
  linked: boolean;
  inverted: boolean;
}

export interface ImageVectorMaskStateReadiness {
  targetLayerId: string | null;
  targetMatchesLayer: boolean;
  enabled: boolean;
  linked: boolean;
  inverted: boolean;
}

export interface ImageVectorMaskBatchSuitability {
  rasterizeSuitable: boolean;
  retainSuitable: boolean;
  blockingWarningCodes: ImageVectorMaskWarningCode[];
  caveats: string[];
}

export type ImageVectorMaskParityState = 'ready' | 'ready-with-caveats' | 'blocked' | 'unsupported';
export type ImageVectorMaskBooleanMode = 'combine' | 'subtract' | 'intersect' | 'exclude';
export type ImageVectorMaskCreationCaveat = 'target-local-retained-path-copy';
export type ImageVectorMaskBooleanCaveat =
  | 'live-vector-mask-boolean-stack-unsupported'
  | 'overlap-resolution-unsupported'
  | 'materialize-path-boolean-before-vector-mask';
export type ImageVectorMaskBezierCaveat =
  | 'bezier-handles-unsupported'
  | 'smooth-anchor-conversion-unsupported';
export type ImageVectorMaskRasterizationCaveat =
  | 'rasterizes-vector-mask-to-alpha'
  | 'rasterization-bakes-editable-path'
  | 'psd-editable-vector-mask-roundtrip-limited';

export interface ImageVectorMaskCreationParityCheck {
  state: Extract<ImageVectorMaskParityState, 'ready' | 'blocked'>;
  ready: boolean;
  source: 'path-backed-layer-metadata';
  caveats: ImageVectorMaskCreationCaveat[];
  signature: string;
}

export interface ImageVectorMaskBooleanParityCheck {
  state: Extract<ImageVectorMaskParityState, 'unsupported'>;
  supportedModes: ImageVectorMaskBooleanMode[];
  unsupportedModes: ImageVectorMaskBooleanMode[];
  caveats: ImageVectorMaskBooleanCaveat[];
  signature: string;
}

export interface ImageVectorMaskBezierParityCheck {
  state: Extract<ImageVectorMaskParityState, 'unsupported'>;
  caveats: ImageVectorMaskBezierCaveat[];
  signature: string;
}

export interface ImageVectorMaskRasterizationParityCheck {
  state: ImageVectorMaskReadinessState;
  canRasterize: boolean;
  outputSource: ImageVectorMaskRasterizationOutputSource;
  destructive: true;
  preservesEditableVectorMask: false;
  blockingWarningCodes: ImageVectorMaskWarningCode[];
  caveats: ImageVectorMaskRasterizationCaveat[];
  signature: string;
}

export interface ImageVectorMaskParityChecks {
  checkId: 'image-vector-mask-parity:v1';
  layerId: string;
  descriptorId: string | null;
  targetLayerId: string | null;
  creation: ImageVectorMaskCreationParityCheck;
  booleanOperations: ImageVectorMaskBooleanParityCheck;
  bezierEditing: ImageVectorMaskBezierParityCheck;
  rasterization: ImageVectorMaskRasterizationParityCheck;
  signature: string;
}

export interface ImageVectorMaskReadinessSummary {
  layerId: string;
  retained: ImageVectorMaskRetainedReadiness;
  state: ImageVectorMaskStateReadiness;
  rasterization: ImageVectorMaskRasterizationPlan;
  actions: ImageVectorMaskActionSuitability[];
  batch: ImageVectorMaskBatchSuitability;
  parityChecks: ImageVectorMaskParityChecks;
  unsupportedStates: ImageVectorMaskUnsupportedState[];
  handoffCaveats: string[];
}

export type ImageVectorMaskPathOperationKind =
  | 'retain'
  | 'rasterize'
  | 'editBezierHandles'
  | 'nativePsdRoundtrip';

export interface ImageVectorMaskPathOperationCheck {
  state: ImageVectorMaskActionState;
  blockers: ImageVectorMaskWarningCode[];
  preservesEditablePath: boolean;
  signature: string;
}

export interface ImageVectorMaskPathOperationReadiness {
  layerId: string;
  descriptorId: string | null;
  pathValidity: {
    closed: boolean;
    pointCount: number;
    canRetain: boolean;
    canRasterize: boolean;
    blockers: ImageVectorMaskWarningCode[];
  };
  operations: Record<ImageVectorMaskPathOperationKind, ImageVectorMaskPathOperationCheck>;
  signature: string;
}

export function getLayerVectorMaskDescriptor(layer: ImageLayer | null | undefined): ImageVectorMaskDescriptor | null {
  const descriptor = (layer as ImageLayerWithVectorMask | null | undefined)?.metadata?.vectorMask;
  return descriptor ? normalizeVectorMaskDescriptor(descriptor, layer?.id ?? null) : null;
}

export function attachVectorMaskToLayer(
  layer: ImageLayer,
  descriptor: ImageVectorMaskDescriptorInput,
): ImageLayerWithVectorMask {
  return {
    ...layer,
    metadata: {
      ...layer.metadata,
      vectorMask: normalizeVectorMaskDescriptor(descriptor, layer.id),
    },
  };
}

export function rasterizeLayerVectorMask(layer: ImageLayer): LayerBitmap {
  const { width, height } = resolveLayerMaskSize(layer);
  const selection = evaluateLayerVectorMask(layer, width, height);
  return selectionMaskToLayerMaskBitmap(selection);
}

export function evaluateLayerVectorMask(
  layer: ImageLayer,
  width = resolveLayerMaskSize(layer).width,
  height = resolveLayerMaskSize(layer).height,
): SelectionMask {
  const mask = createMask(width, height);
  const descriptor = getLayerVectorMaskDescriptor(layer);
  if (!descriptor?.enabled) return mask;
  if (descriptor.kind !== 'path' || !descriptor.path.closed || descriptor.path.points.length < 3) return mask;

  setPolygon(mask, descriptor.path.points, 255);
  if (descriptor.inverted) invertMask(mask);
  return mask;
}

export function normalizeVectorMaskDescriptor(
  descriptor: ImageVectorMaskDescriptorInput,
  fallbackTargetLayerId: string | null = null,
): ImageVectorMaskDescriptor {
  const points = descriptor.path.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: Math.round(point.x),
      y: Math.round(point.y),
    }));

  return {
    id: descriptor.id,
    name: descriptor.name,
    kind: 'path',
    targetLayerId: normalizeTargetLayerId(descriptor.targetLayerId, fallbackTargetLayerId),
    enabled: descriptor.enabled,
    inverted: descriptor.inverted === true,
    linked: descriptor.linked ?? true,
    path: {
      closed: descriptor.path.closed,
      fillRule: descriptor.path.fillRule ?? 'evenodd',
      bounds: computeVectorMaskPathBounds(points),
      points,
    },
  };
}

export function planLayerVectorMaskRasterization(
  layer: ImageLayer,
  capabilities: ImageVectorMaskCapabilityAvailability = {},
): ImageVectorMaskRasterizationPlan {
  const output = resolveLayerMaskSize(layer);
  const descriptor = getLayerVectorMaskDescriptor(layer);
  const warnings: ImageVectorMaskPlanningWarning[] = [];
  let targetMismatch: ImageVectorMaskTargetMismatch | null = null;
  let canRasterize = false;

  if (!descriptor) {
    warnings.push({
      code: 'no-vector-mask',
      message: 'Layer does not have a vector mask descriptor.',
    });
  } else {
    if (descriptor.targetLayerId !== null && descriptor.targetLayerId !== layer.id) {
      targetMismatch = {
        expectedLayerId: descriptor.targetLayerId,
        actualLayerId: layer.id,
        warningCode: 'target-layer-mismatch',
      };
      warnings.push({
        code: 'target-layer-mismatch',
        message: `Vector mask targets layer "${descriptor.targetLayerId}" but is attached to "${layer.id}".`,
      });
    }

    if (!descriptor.enabled) {
      warnings.push({
        code: 'vector-mask-disabled',
        message: 'Vector mask is disabled and will not be rasterized.',
      });
    } else if ((descriptor as { kind?: string }).kind !== 'path') {
      warnings.push({
        code: 'unsupported-vector-mask-kind',
        message: 'Only path-backed vector masks can be rasterized.',
      });
    } else if (!descriptor.path.closed) {
      warnings.push({
        code: 'open-path-not-rasterized',
        message: 'Open vector mask paths are retained but cannot be rasterized as layer masks.',
      });
    } else if (descriptor.path.points.length < 3) {
      warnings.push({
        code: 'insufficient-path-points',
        message: 'Vector mask rasterization requires at least three finite path points.',
      });
    } else {
      canRasterize = true;
    }

    warnings.push(...getVectorMaskUnsupportedCapabilityWarnings(capabilities));
  }
  const limitations = buildVectorMaskLimitations(warnings);
  const blockingWarningCodes = warnings
    .filter((warning) => isVectorMaskBlockingWarning(warning.code))
    .map((warning) => warning.code);
  const descriptorId = descriptor?.id ?? null;
  const targetLayerId = descriptor?.targetLayerId ?? null;
  const pathBounds = descriptor?.path.bounds ?? null;
  const previewSignaturePayload = {
    layerId: layer.id,
    descriptorId,
    targetLayerId,
    enabled: descriptor?.enabled ?? false,
    inverted: descriptor?.inverted ?? false,
    linked: descriptor?.linked ?? true,
    outputWidth: output.width,
    outputHeight: output.height,
    outputSource: output.source,
    pathBounds,
    canRasterize,
    warnings: warnings.map((warning) => warning.code),
  };

  return {
    layerId: layer.id,
    descriptorId,
    targetLayerId,
    enabled: descriptor?.enabled ?? false,
    inverted: descriptor?.inverted ?? false,
    linked: descriptor?.linked ?? true,
    canRasterize,
    outputWidth: output.width,
    outputHeight: output.height,
    outputSource: output.source,
    pathBounds,
    preview: {
      id: `vector-mask-preview:${layer.id}:${descriptorId ?? 'none'}`,
      signature: `vector-mask:v1:${JSON.stringify(previewSignaturePayload)}`,
    },
    readiness: {
      readinessId: `vector-mask-rasterize:${layer.id}:${descriptorId ?? 'none'}`,
      action: 'rasterize',
      state: canRasterize
        ? warnings.length > 0
          ? 'ready-with-caveats'
          : 'ready'
        : 'blocked',
      blockingWarningCodes,
      exportCaveat: 'Vector masks can be rasterized to layer-mask alpha, but editable PSD vector-mask round-trip metadata is limited.',
    },
    limitations,
    exportCaveats: [
      'Live preview/export composites retained vector masks as rasterized alpha.',
      'Editable PSD vector mask round-trip and boolean operations remain limited.',
    ],
    targetMismatch,
    warnings,
  };
}

export function summarizeLayerVectorMaskReadiness(
  layer: ImageLayer,
  capabilities: ImageVectorMaskCapabilityAvailability = {},
): ImageVectorMaskReadinessSummary {
  const rasterization = planLayerVectorMaskRasterization(layer, capabilities);
  const descriptor = getLayerVectorMaskDescriptor(layer);
  const hasDescriptor = Boolean(descriptor);
  const targetMatchesLayer = !descriptor?.targetLayerId || descriptor.targetLayerId === layer.id;
  const retainSuitable = hasDescriptor && targetMatchesLayer;
  const rasterizeSuitable = rasterization.canRasterize && rasterization.readiness.blockingWarningCodes.length === 0;
  const parityChecks = buildVectorMaskParityChecks(layer, descriptor, rasterization, retainSuitable);

  return {
    layerId: layer.id,
    retained: {
      present: hasDescriptor,
      descriptorId: descriptor?.id ?? null,
      pathEditable: descriptor?.kind === 'path',
      preservesVectorPath: hasDescriptor,
      targetLayerId: descriptor?.targetLayerId ?? null,
      enabled: descriptor?.enabled ?? false,
      linked: descriptor?.linked ?? true,
      inverted: descriptor?.inverted ?? false,
    },
    state: {
      targetLayerId: descriptor?.targetLayerId ?? null,
      targetMatchesLayer,
      enabled: descriptor?.enabled ?? false,
      linked: descriptor?.linked ?? true,
      inverted: descriptor?.inverted ?? false,
    },
    rasterization,
    actions: buildVectorMaskActionSuitability(rasterization, hasDescriptor, retainSuitable, rasterizeSuitable),
    batch: {
      rasterizeSuitable,
      retainSuitable,
      blockingWarningCodes: rasterization.readiness.blockingWarningCodes,
      caveats: [
        'Batch rasterization is deterministic for closed finite polygon vector masks.',
        'Batch retain handoff preserves metadata, but external PSD consumers may not reopen it as an editable vector mask.',
      ],
    },
    parityChecks,
    unsupportedStates: getVectorMaskUnsupportedStates(),
    handoffCaveats: getVectorMaskHandoffCaveats(),
  };
}

export function describeVectorMaskPathOperationReadiness(
  layer: ImageLayer,
): ImageVectorMaskPathOperationReadiness {
  const descriptor = getLayerVectorMaskDescriptor(layer);
  const rasterization = planLayerVectorMaskRasterization(layer);
  const descriptorId = descriptor?.id ?? null;
  const closed = descriptor?.path.closed ?? false;
  const pointCount = descriptor?.path.points.length ?? 0;
  const canRetain = Boolean(descriptor);
  const canRasterize = rasterization.canRasterize;
  const blockers = rasterization.readiness.blockingWarningCodes;
  const operations: ImageVectorMaskPathOperationReadiness['operations'] = {
    retain: buildVectorMaskPathOperationCheck({
      layerId: layer.id,
      descriptorId,
      kind: 'retain',
      state: canRetain ? 'ready' : 'blocked',
      blockers: canRetain ? [] : ['no-vector-mask'],
      preservesEditablePath: true,
    }),
    rasterize: buildVectorMaskPathOperationCheck({
      layerId: layer.id,
      descriptorId,
      kind: 'rasterize',
      state: canRasterize ? 'ready' : 'blocked',
      blockers,
      preservesEditablePath: false,
    }),
    editBezierHandles: buildVectorMaskPathOperationCheck({
      layerId: layer.id,
      descriptorId,
      kind: 'editBezierHandles',
      state: 'unsupported',
      blockers: ['live-bezier-editing-unsupported'],
      preservesEditablePath: false,
    }),
    nativePsdRoundtrip: buildVectorMaskPathOperationCheck({
      layerId: layer.id,
      descriptorId,
      kind: 'nativePsdRoundtrip',
      state: 'unsupported',
      blockers: ['psd-vector-mask-roundtrip-limited'],
      preservesEditablePath: false,
    }),
  };
  const payload = {
    layerId: layer.id,
    descriptorId,
    pathValidity: {
      closed,
      pointCount,
      canRetain,
      canRasterize,
      blockers,
    },
    operations: {
      retain: operations.retain.signature,
      rasterize: operations.rasterize.signature,
      editBezierHandles: operations.editBezierHandles.signature,
      nativePsdRoundtrip: operations.nativePsdRoundtrip.signature,
    },
  };
  return {
    layerId: layer.id,
    descriptorId,
    pathValidity: {
      closed,
      pointCount,
      canRetain,
      canRasterize,
      blockers,
    },
    operations,
    signature: `image-vector-mask-path-operations:v1:${JSON.stringify(payload)}`,
  };
}

function buildVectorMaskParityChecks(
  layer: ImageLayer,
  descriptor: ImageVectorMaskDescriptor | null,
  rasterization: ImageVectorMaskRasterizationPlan,
  retainSuitable: boolean,
): ImageVectorMaskParityChecks {
  const descriptorId = descriptor?.id ?? null;
  const targetLayerId = descriptor?.targetLayerId ?? null;
  const creation = buildVectorMaskCreationParityCheck(layer.id, descriptorId, targetLayerId, retainSuitable);
  const booleanOperations = buildVectorMaskBooleanParityCheck(layer.id, descriptorId);
  const bezierEditing = buildVectorMaskBezierParityCheck(layer.id, descriptorId);
  const rasterizationCheck = buildVectorMaskRasterizationParityCheck(layer.id, descriptorId, rasterization);
  const payload = {
    layerId: layer.id,
    descriptorId,
    targetLayerId,
    creation: creation.signature,
    booleanOperations: booleanOperations.signature,
    bezierEditing: bezierEditing.signature,
    rasterization: rasterizationCheck.signature,
  };

  return {
    checkId: 'image-vector-mask-parity:v1',
    layerId: layer.id,
    descriptorId,
    targetLayerId,
    creation,
    booleanOperations,
    bezierEditing,
    rasterization: rasterizationCheck,
    signature: `image-vector-mask-parity:v1:${JSON.stringify(payload)}`,
  };
}

function buildVectorMaskPathOperationCheck(params: {
  layerId: string;
  descriptorId: string | null;
  kind: ImageVectorMaskPathOperationKind;
  state: ImageVectorMaskActionState;
  blockers: ImageVectorMaskWarningCode[];
  preservesEditablePath: boolean;
}): ImageVectorMaskPathOperationCheck {
  const payload = {
    layerId: params.layerId,
    descriptorId: params.descriptorId,
    kind: params.kind,
    state: params.state,
    blockers: params.blockers,
    preservesEditablePath: params.preservesEditablePath,
  };
  return {
    state: params.state,
    blockers: params.blockers,
    preservesEditablePath: params.preservesEditablePath,
    signature: `image-vector-mask-operation:v1:${JSON.stringify(payload)}`,
  };
}

function buildVectorMaskCreationParityCheck(
  layerId: string,
  descriptorId: string | null,
  targetLayerId: string | null,
  ready: boolean,
): ImageVectorMaskCreationParityCheck {
  const caveats: ImageVectorMaskCreationCaveat[] = ['target-local-retained-path-copy'];
  const payload = {
    layerId,
    descriptorId,
    targetLayerId,
    ready,
    caveats,
  };

  return {
    state: ready ? 'ready' : 'blocked',
    ready,
    source: 'path-backed-layer-metadata',
    caveats,
    signature: `image-vector-mask-creation:v1:${JSON.stringify(payload)}`,
  };
}

function buildVectorMaskBooleanParityCheck(
  layerId: string,
  descriptorId: string | null,
): ImageVectorMaskBooleanParityCheck {
  const supportedModes: ImageVectorMaskBooleanMode[] = [];
  const unsupportedModes: ImageVectorMaskBooleanMode[] = ['combine', 'subtract', 'intersect', 'exclude'];
  const caveats: ImageVectorMaskBooleanCaveat[] = [
    'live-vector-mask-boolean-stack-unsupported',
    'overlap-resolution-unsupported',
    'materialize-path-boolean-before-vector-mask',
  ];
  const payload = {
    layerId,
    descriptorId,
    state: 'unsupported',
    supportedModes,
    unsupportedModes,
    caveats,
  };

  return {
    state: 'unsupported',
    supportedModes,
    unsupportedModes,
    caveats,
    signature: `image-vector-mask-booleans:v1:${JSON.stringify(payload)}`,
  };
}

function buildVectorMaskBezierParityCheck(
  layerId: string,
  descriptorId: string | null,
): ImageVectorMaskBezierParityCheck {
  const caveats: ImageVectorMaskBezierCaveat[] = [
    'bezier-handles-unsupported',
    'smooth-anchor-conversion-unsupported',
  ];
  const payload = {
    layerId,
    descriptorId,
    state: 'unsupported',
    caveats,
  };

  return {
    state: 'unsupported',
    caveats,
    signature: `image-vector-mask-bezier:v1:${JSON.stringify(payload)}`,
  };
}

function buildVectorMaskRasterizationParityCheck(
  layerId: string,
  descriptorId: string | null,
  rasterization: ImageVectorMaskRasterizationPlan,
): ImageVectorMaskRasterizationParityCheck {
  const caveats: ImageVectorMaskRasterizationCaveat[] = [
    'rasterizes-vector-mask-to-alpha',
    'rasterization-bakes-editable-path',
    'psd-editable-vector-mask-roundtrip-limited',
  ];
  const payload = {
    layerId,
    descriptorId,
    state: rasterization.readiness.state,
    canRasterize: rasterization.canRasterize,
    outputSource: rasterization.outputSource,
    blockingWarningCodes: rasterization.readiness.blockingWarningCodes,
    caveats,
  };

  return {
    state: rasterization.readiness.state,
    canRasterize: rasterization.canRasterize,
    outputSource: rasterization.outputSource,
    destructive: true,
    preservesEditableVectorMask: false,
    blockingWarningCodes: rasterization.readiness.blockingWarningCodes,
    caveats,
    signature: `image-vector-mask-rasterization:v1:${JSON.stringify(payload)}`,
  };
}

export function getVectorMaskUnsupportedCapabilityWarnings(
  capabilities: ImageVectorMaskCapabilityAvailability = {},
): ImageVectorMaskPlanningWarning[] {
  const warnings: ImageVectorMaskPlanningWarning[] = [];
  if (capabilities.liveBezierEditing !== true) {
    warnings.push({
      code: 'live-bezier-editing-unsupported',
      message: 'Live Bezier handle editing is not available for vector masks yet.',
    });
  }
  if (capabilities.advancedPathOperations !== true) {
    warnings.push({
      code: 'advanced-path-operations-unsupported',
      message: 'Advanced vector mask path operations are not available yet.',
    });
  }
  warnings.push(
    {
      code: 'boolean-operations-unsupported',
      message: 'Vector mask boolean combine/subtract/intersect/exclude modes are not modeled yet.',
    },
    {
      code: 'psd-vector-mask-roundtrip-limited',
      message: 'PSD handoff can preserve rasterized alpha, but editable vector mask metadata is limited.',
    },
  );
  if (capabilities.liveVectorRender === false) {
    warnings.push({
      code: 'live-vector-render-unsupported',
      message: 'The target renderer does not composite vector masks live; rasterize to a layer mask for preview/export parity.',
    });
  }
  return warnings;
}

function buildVectorMaskLimitations(
  warnings: readonly ImageVectorMaskPlanningWarning[],
): ImageVectorMaskLimitation[] {
  return warnings
    .map((warning): ImageVectorMaskLimitation | null => {
      const category = getVectorMaskLimitationCategory(warning.code);
      return category
        ? {
            code: warning.code,
            category,
            severity: 'warning',
            message: warning.message,
          }
        : null;
    })
    .filter((limitation): limitation is ImageVectorMaskLimitation => limitation !== null);
}

function getVectorMaskLimitationCategory(
  code: ImageVectorMaskWarningCode,
): ImageVectorMaskLimitationCategory | null {
  if (code === 'live-bezier-editing-unsupported') return 'editing';
  if (code === 'advanced-path-operations-unsupported' || code === 'boolean-operations-unsupported') {
    return 'boolean';
  }
  if (code === 'psd-vector-mask-roundtrip-limited') return 'psd';
  if (code === 'live-vector-render-unsupported') return 'rendering';
  return null;
}

function isVectorMaskBlockingWarning(code: ImageVectorMaskWarningCode): boolean {
  return code === 'no-vector-mask'
    || code === 'vector-mask-disabled'
    || code === 'unsupported-vector-mask-kind'
    || code === 'open-path-not-rasterized'
    || code === 'insufficient-path-points';
}

function buildVectorMaskActionSuitability(
  rasterization: ImageVectorMaskRasterizationPlan,
  hasDescriptor: boolean,
  retainSuitable: boolean,
  rasterizeSuitable: boolean,
): ImageVectorMaskActionSuitability[] {
  const descriptorBlockers = hasDescriptor ? [] : (['no-vector-mask'] satisfies ImageVectorMaskWarningCode[]);
  const stateActionBlockers = retainSuitable ? [] : rasterization.readiness.blockingWarningCodes;

  return [
    {
      kind: 'retain',
      label: 'Retain Vector Mask',
      state: retainSuitable ? 'ready' : 'blocked',
      batchSuitable: retainSuitable,
      destructive: false,
      preservesEditableVectorMask: true,
      requiresRasterization: false,
      blockingWarningCodes: stateActionBlockers,
      caveats: ['Retained vector masks are Sloom Studio metadata and may not reopen as editable PSD vector masks.'],
    },
    {
      kind: 'rasterize',
      label: 'Rasterize Vector Mask',
      state: rasterizeSuitable ? 'ready' : 'blocked',
      batchSuitable: rasterizeSuitable,
      destructive: true,
      preservesEditableVectorMask: false,
      requiresRasterization: true,
      blockingWarningCodes: rasterization.readiness.blockingWarningCodes,
      caveats: ['Rasterization produces deterministic alpha but bakes the vector mask into pixels/mask data.'],
    },
    {
      kind: 'toggle-invert',
      label: 'Toggle Vector Mask Invert',
      state: hasDescriptor ? 'ready' : 'blocked',
      batchSuitable: hasDescriptor,
      destructive: false,
      preservesEditableVectorMask: true,
      requiresRasterization: false,
      blockingWarningCodes: descriptorBlockers,
      caveats: ['Invert is retained as vector-mask state and applied during rasterized preview/export.'],
    },
    {
      kind: 'toggle-link',
      label: 'Toggle Vector Mask Link',
      state: hasDescriptor ? 'ready' : 'blocked',
      batchSuitable: hasDescriptor,
      destructive: false,
      preservesEditableVectorMask: true,
      requiresRasterization: false,
      blockingWarningCodes: descriptorBlockers,
      caveats: ['Link state is retained for handoff planning; independent transform editing remains limited.'],
    },
    ...buildUnsupportedVectorMaskActions(),
  ];
}

function buildUnsupportedVectorMaskActions(): ImageVectorMaskActionSuitability[] {
  const booleanCaveats = ['Live boolean vector-mask stacks are not modeled for retained vector-mask output.'];
  return [
    {
      kind: 'boolean-combine',
      label: 'Combine Vector Masks',
      state: 'unsupported',
      batchSuitable: false,
      destructive: false,
      preservesEditableVectorMask: false,
      requiresRasterization: false,
      blockingWarningCodes: [],
      caveats: booleanCaveats,
    },
    {
      kind: 'boolean-subtract',
      label: 'Subtract Vector Masks',
      state: 'unsupported',
      batchSuitable: false,
      destructive: false,
      preservesEditableVectorMask: false,
      requiresRasterization: false,
      blockingWarningCodes: [],
      caveats: booleanCaveats,
    },
    {
      kind: 'boolean-intersect',
      label: 'Intersect Vector Masks',
      state: 'unsupported',
      batchSuitable: false,
      destructive: false,
      preservesEditableVectorMask: false,
      requiresRasterization: false,
      blockingWarningCodes: [],
      caveats: booleanCaveats,
    },
    {
      kind: 'boolean-exclude',
      label: 'Exclude Vector Masks',
      state: 'unsupported',
      batchSuitable: false,
      destructive: false,
      preservesEditableVectorMask: false,
      requiresRasterization: false,
      blockingWarningCodes: [],
      caveats: booleanCaveats,
    },
    {
      kind: 'psd-editable-roundtrip',
      label: 'PSD Editable Vector Mask Round Trip',
      state: 'unsupported',
      batchSuitable: false,
      destructive: false,
      preservesEditableVectorMask: false,
      requiresRasterization: false,
      blockingWarningCodes: [],
      caveats: ['PSD export can preserve raster alpha/metadata caveats, not guaranteed native editable vector masks.'],
    },
  ];
}

function getVectorMaskUnsupportedStates(): ImageVectorMaskUnsupportedState[] {
  return [
    {
      code: 'boolean-vector-mask-live-stack-unsupported',
      category: 'boolean',
      state: 'unsupported',
      message: 'Live vector-mask boolean stacks are not retained; materialize supported path booleans before masking.',
    },
    {
      code: 'psd-editable-vector-mask-roundtrip-unsupported',
      category: 'psd',
      state: 'unsupported',
      message: 'PSD handoff can carry rasterized alpha and metadata caveats, not a guaranteed editable Photoshop vector mask.',
    },
  ];
}

function getVectorMaskHandoffCaveats(): string[] {
  return [
    'Retained vector masks stay editable inside Sloom Studio as path metadata.',
    'Preview/export rasterizes vector masks to alpha for deterministic output.',
    'PSD handoff should be treated as metadata/raster-alpha preservation, not native editable vector-mask parity.',
    'Boolean vector-mask stacks, overlaps, and live PSD vector-mask states remain unsupported.',
  ];
}

function normalizeTargetLayerId(
  targetLayerId: string | null | undefined,
  fallbackTargetLayerId: string | null,
): string | null {
  if (typeof targetLayerId === 'string' && targetLayerId.trim().length > 0) {
    return targetLayerId.trim();
  }
  if (typeof fallbackTargetLayerId === 'string' && fallbackTargetLayerId.trim().length > 0) {
    return fallbackTargetLayerId.trim();
  }
  return null;
}

function computeVectorMaskPathBounds(points: ImageVectorPathPoint[]): ImageVectorMaskBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function resolveLayerMaskSize(
  layer: ImageLayer,
): { width: number; height: number; source: ImageVectorMaskRasterizationOutputSource } {
  if (layer.mask) {
    return {
      width: sanitizeMaskDimension(layer.mask.width),
      height: sanitizeMaskDimension(layer.mask.height),
      source: 'layer-mask',
    };
  }
  if (layer.bitmap) {
    return {
      width: sanitizeMaskDimension(layer.bitmap.width),
      height: sanitizeMaskDimension(layer.bitmap.height),
      source: 'layer-bitmap',
    };
  }
  return {
    width: 1,
    height: 1,
    source: 'fallback',
  };
}

function sanitizeMaskDimension(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.round(value);
}

function selectionMaskToLayerMaskBitmap(mask: SelectionMask): LayerBitmap {
  const bitmap = createBitmap(mask.width, mask.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for vector mask rasterization');
  const imageData = ctx.createImageData(mask.width, mask.height);

  for (let index = 0; index < mask.data.length; index += 1) {
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = mask.data[index] ?? 0;
  }

  ctx.putImageData(imageData, 0, 0);
  return bitmap;
}
