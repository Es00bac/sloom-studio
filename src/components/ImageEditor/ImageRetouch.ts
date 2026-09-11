import type { ImageDocument, ImageLayer, LayerBitmap, RetouchSampleMode, RetouchToneRange } from '../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import type { Point } from './tools/types';

export type ToneBrushMode = 'dodge' | 'burn';
export type SpongeBrushMode = 'saturate' | 'desaturate';

export function resolveCloneStampSourcePoint({
  samplePoint,
  strokeStart,
  targetPoint,
}: {
  samplePoint: Point;
  strokeStart: Point;
  targetPoint: Point;
}): Point {
  return {
    x: samplePoint.x + (targetPoint.x - strokeStart.x),
    y: samplePoint.y + (targetPoint.y - strokeStart.y),
  };
}

export function applyCloneStampToBitmap(
  bitmap: LayerBitmap,
  options: {
    sourcePoint: Point;
    targetPoint: Point;
    size: number;
    opacity: number;
    sourceBitmap?: LayerBitmap;
  },
): void {
  const source = options.sourceBitmap ? getBitmapImageData(options.sourceBitmap) : getBitmapImageData(bitmap);
  const next = applyCloneStampToImageData(getBitmapImageData(bitmap), {
    ...options,
    sourceImageData: source,
  });
  putBitmapImageData(bitmap, next);
}

export function applySpotHealToBitmap(
  bitmap: LayerBitmap,
  options: {
    targetPoint: Point;
    sourcePoint?: Point;
    size: number;
    opacity: number;
    sourceBitmap?: LayerBitmap;
  },
): void {
  const source = options.sourceBitmap ? getBitmapImageData(options.sourceBitmap) : getBitmapImageData(bitmap);
  const next = applySpotHealToImageData(getBitmapImageData(bitmap), {
    ...options,
    sourceImageData: source,
  });
  putBitmapImageData(bitmap, next);
}

export function applyBlurBrushToBitmap(
  bitmap: LayerBitmap,
  options: {
    targetPoint: Point;
    sourcePoint?: Point;
    size: number;
    strength: number;
    sourceBitmap?: LayerBitmap;
  },
): void {
  const source = options.sourceBitmap ? getBitmapImageData(options.sourceBitmap) : getBitmapImageData(bitmap);
  const next = applyBlurBrushToImageData(getBitmapImageData(bitmap), {
    ...options,
    sourceImageData: source,
  });
  putBitmapImageData(bitmap, next);
}

export function applySharpenBrushToBitmap(
  bitmap: LayerBitmap,
  options: {
    targetPoint: Point;
    sourcePoint?: Point;
    size: number;
    strength: number;
    sourceBitmap?: LayerBitmap;
  },
): void {
  const source = options.sourceBitmap ? getBitmapImageData(options.sourceBitmap) : getBitmapImageData(bitmap);
  const next = applySharpenBrushToImageData(getBitmapImageData(bitmap), {
    ...options,
    sourceImageData: source,
  });
  putBitmapImageData(bitmap, next);
}

export function applySmudgeBrushToBitmap(
  bitmap: LayerBitmap,
  options: {
    sourcePoint: Point;
    targetPoint: Point;
    size: number;
    strength: number;
  },
): void {
  const next = applySmudgeBrushToImageData(getBitmapImageData(bitmap), options);
  putBitmapImageData(bitmap, next);
}

export function applyToneBrushToBitmap(
  bitmap: LayerBitmap,
  options: {
    mode: ToneBrushMode;
    targetPoint: Point;
    size: number;
    strength: number;
    toneRange?: ToneBrushRange;
    protectTones?: boolean;
  },
): void {
  const next = applyToneBrushToImageData(getBitmapImageData(bitmap), options);
  putBitmapImageData(bitmap, next);
}

export function applySpongeBrushToBitmap(
  bitmap: LayerBitmap,
  options: {
    mode: SpongeBrushMode;
    targetPoint: Point;
    size: number;
    strength: number;
    vibrance?: number;
    preserveLuminosity?: boolean;
  },
): void {
  const next = applySpongeBrushToImageData(getBitmapImageData(bitmap), options);
  putBitmapImageData(bitmap, next);
}

export function applyCloneStampToImageData(
  imageData: ImageData,
  options: {
    sourcePoint: Point;
    targetPoint: Point;
    size: number;
    opacity: number;
    sourceImageData?: ImageData;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const source = options.sourceImageData ?? imageData;
  const radius = Math.max(0, (options.size - 1) / 2);
  const integerRadius = Math.ceil(radius);
  const opacity = clamp01(options.opacity);
  const sourceCenterX = Math.round(options.sourcePoint.x);
  const sourceCenterY = Math.round(options.sourcePoint.y);
  const targetCenterX = Math.round(options.targetPoint.x);
  const targetCenterY = Math.round(options.targetPoint.y);

  for (let y = -integerRadius; y <= integerRadius; y += 1) {
    for (let x = -integerRadius; x <= integerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > radius + 0.001) continue;

      const sourceX = sourceCenterX + x;
      const sourceY = sourceCenterY + y;
      const targetX = targetCenterX + x;
      const targetY = targetCenterY + y;
      if (!contains(source, sourceX, sourceY) || !contains(imageData, targetX, targetY)) {
        continue;
      }

      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (targetY * output.width + targetX) * 4;
      output.data[targetOffset] = mixByte(imageData.data[targetOffset], source.data[sourceOffset], opacity);
      output.data[targetOffset + 1] = mixByte(imageData.data[targetOffset + 1], source.data[sourceOffset + 1], opacity);
      output.data[targetOffset + 2] = mixByte(imageData.data[targetOffset + 2], source.data[sourceOffset + 2], opacity);
      output.data[targetOffset + 3] = mixByte(imageData.data[targetOffset + 3], source.data[sourceOffset + 3], opacity);
    }
  }

  return output;
}

export function applySpotHealToImageData(
  imageData: ImageData,
  options: {
    targetPoint: Point;
    sourcePoint?: Point;
    size: number;
    opacity: number;
    sourceImageData?: ImageData;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const source = options.sourceImageData ?? imageData;
  const radius = Math.max(0, (options.size - 1) / 2);
  const integerRadius = Math.ceil(radius);
  const sampleRadius = Math.max(integerRadius + 1, Math.ceil(options.size));
  const targetCenterX = Math.round(options.targetPoint.x);
  const targetCenterY = Math.round(options.targetPoint.y);
  const sourceCenterX = Math.round(options.sourcePoint?.x ?? options.targetPoint.x);
  const sourceCenterY = Math.round(options.sourcePoint?.y ?? options.targetPoint.y);
  const repair = averageSurroundingPixels(source, sourceCenterX, sourceCenterY, radius, sampleRadius);

  if (!repair) return output;

  const opacity = clamp01(options.opacity);

  for (let y = -integerRadius; y <= integerRadius; y += 1) {
    for (let x = -integerRadius; x <= integerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > radius + 0.001) continue;

      const targetX = targetCenterX + x;
      const targetY = targetCenterY + y;
      if (!contains(imageData, targetX, targetY)) continue;

      const targetOffset = (targetY * output.width + targetX) * 4;
      output.data[targetOffset] = mixByte(imageData.data[targetOffset], repair[0], opacity);
      output.data[targetOffset + 1] = mixByte(imageData.data[targetOffset + 1], repair[1], opacity);
      output.data[targetOffset + 2] = mixByte(imageData.data[targetOffset + 2], repair[2], opacity);
      output.data[targetOffset + 3] = mixByte(imageData.data[targetOffset + 3], repair[3], opacity);
    }
  }

  return output;
}

export interface RetouchSampleSource {
  bitmap: LayerBitmap;
  coordinateSpace: 'layer' | 'document';
}

export interface RetouchSourcePlacement {
  coordinateSpace: RetouchSampleSource['coordinateSpace'];
  sourceBitmapCenter: Point;
  sourceDocumentCenter: Point;
  targetBitmapCenter: Point;
  targetDocumentCenter: Point;
}

export interface CloneStampOverlayDescriptor extends RetouchSourcePlacement {
  brushRadius: number;
  diameter: number;
  translation: Point;
}

export interface SpotHealPatchPlan extends RetouchSourcePlacement {
  brushRadius: number;
  sampleRadius: number;
}

export type RetouchBrushToolKind = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge';
export type RetouchBrushAdjustmentParameter = 'strength' | 'exposure' | 'saturation';
export type RetouchBrushSampleMode = RetouchSampleMode;
export type RetouchBrushOutputMode = 'activeLayer' | 'newLayer';
export type ToneBrushRange = RetouchToneRange;

export interface RetouchBrushWarning {
  code:
    | 'sample-mode-current-layer-only'
    | 'blend-mode-unsupported'
    | 'channel-target-unsupported'
    | 'new-layer-output-unsupported'
    | 'tone-range-unsupported';
  message: string;
}

export type RetouchWorkflowOutputMode = RetouchBrushOutputMode;
export type RetouchContentAwareRepairTool = 'spotHeal' | 'patch' | 'remove';
export type RetouchContentAwareRepairBlockerCode =
  | 'manual-patch-source-unsupported'
  | 'content-aware-remove-native-ai-unsupported'
  | 'new-layer-output-unsupported';

export interface RetouchWorkflowWarning {
  code:
    | 'sample-source-required'
    | 'live-clone-source-overlay-unsupported'
    | 'clone-source-transform-unsupported'
    | 'new-layer-output-unsupported'
    | 'destructive-active-layer-pixels'
    | 'patch-workflow-unsupported'
    | 'content-aware-remove-unsupported';
  message: string;
}

export interface CloneStampWorkflowDescriptor {
  descriptorId: 'image-clone-stamp-workflow:v1';
  tool: 'cloneStamp';
  preview: {
    id: string;
    signature: string;
  };
  brush: {
    size: number;
    radius: number;
    opacity: number;
  };
  sampleSource: {
    requested: RetouchSampleMode;
    readiness: 'ready' | 'needs-sample-point';
    coordinateSpaceWhenReady: RetouchSampleSource['coordinateSpace'];
    sourceBitmapWhenReady:
      | 'active-layer-snapshot-at-stroke-start'
      | 'visible-current-and-below-composite-at-stroke-start'
      | 'visible-all-layers-composite-at-stroke-start';
  };
  behavior: {
    aligned: boolean;
    strokeSourceBehavior: 'maintain-first-stroke-offset-across-strokes' | 'restart-from-sample-point-each-stroke';
  };
  liveCloneSourceOverlay: {
    status: 'unsupported';
    fallback: 'target-brush-cursor-only';
    warning: string;
  };
  cloneSourceTransform: {
    status: 'unsupported';
    supportedTransforms: [];
    warning: string;
  };
  outputTarget: {
    requested: RetouchWorkflowOutputMode;
    applied: 'activeLayer';
    supportsNewLayer: false;
    caveat: string;
  };
  nonDestructive: {
    supported: false;
    undoable: true;
    warning: string;
  };
  warnings: RetouchWorkflowWarning[];
}

export interface SpotHealWorkflowDescriptor {
  descriptorId: 'image-spot-heal-workflow:v1';
  tool: 'spotHeal';
  preview: {
    id: string;
    signature: string;
  };
  brush: {
    size: number;
    radius: number;
    opacity: number;
  };
  sampleSource: {
    requested: RetouchSampleMode;
    readiness: 'ready-on-stroke';
    coordinateSpaceWhenReady: RetouchSampleSource['coordinateSpace'];
    sourceBitmapWhenReady:
      | 'active-layer-snapshot-at-stroke-start'
      | 'visible-current-and-below-composite-at-stroke-start'
      | 'visible-all-layers-composite-at-stroke-start';
  };
  patchWorkflow: {
    status: 'unsupported';
    supportedSteps: ['paint-local-repair'];
    unsupportedSteps: ['lasso-patch-source-drag', 'patch-transform', 'destination-mode', 'transparent-mode'];
    warning: string;
  };
  removeWorkflow: {
    status: 'unsupported';
    warning: string;
  };
  outputTarget: {
    requested: RetouchWorkflowOutputMode;
    applied: 'activeLayer';
    supportsNewLayer: false;
    caveat: string;
  };
  nonDestructive: {
    supported: false;
    undoable: true;
    warning: string;
  };
  warnings: RetouchWorkflowWarning[];
}

export type RetouchWorkflowReadinessBlockerCode =
  | 'sample-source-required'
  | 'clone-source-overlay-unsupported'
  | 'clone-source-transform-unsupported'
  | 'patch-workflow-unsupported'
  | 'content-aware-remove-unsupported'
  | 'non-destructive-retouch-output-unsupported';

export interface RetouchWorkflowReadinessBlocker {
  code: RetouchWorkflowReadinessBlockerCode;
  message: string;
}

export interface RetouchWorkflowReadinessDescriptor {
  descriptorId: 'image-retouch-workflow-readiness:v1';
  readiness: 'ready' | 'blocked';
  sampleModes: Array<{
    mode: RetouchSampleMode;
    coordinateSpace: RetouchSampleSource['coordinateSpace'];
    cloneSource: CloneStampWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'];
    healSource: SpotHealWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'];
  }>;
  clone: {
    sampleMode: RetouchSampleMode;
    readiness: CloneStampWorkflowDescriptor['sampleSource']['readiness'];
    aligned: boolean;
    strokeSourceBehavior: CloneStampWorkflowDescriptor['behavior']['strokeSourceBehavior'];
    overlayStatus: CloneStampWorkflowDescriptor['liveCloneSourceOverlay']['status'];
    transformStatus: CloneStampWorkflowDescriptor['cloneSourceTransform']['status'];
    previewSignature: string;
  };
  heal: {
    sampleMode: RetouchSampleMode;
    readiness: SpotHealWorkflowDescriptor['sampleSource']['readiness'];
    patchWorkflowStatus: SpotHealWorkflowDescriptor['patchWorkflow']['status'];
    removeWorkflowStatus: SpotHealWorkflowDescriptor['removeWorkflow']['status'];
    previewSignature: string;
  };
  output: {
    requested: RetouchWorkflowOutputMode;
    applied: 'activeLayer';
    nonDestructiveSupported: false;
  };
  smudge: {
    requestedSampleMode: RetouchBrushSampleMode;
    appliedSampleMode: RetouchBrushSampleMode;
    compositeSamplingSupported: true;
    caveat: string;
    previewSignature: string;
  };
  blockers: RetouchWorkflowReadinessBlocker[];
  previewSignature: string;
}

export interface RetouchContentAwareRepairParityDescriptor {
  descriptorId: 'image-retouch-content-aware-repair-parity:v1';
  requestedTool: RetouchContentAwareRepairTool;
  sampleMode: RetouchSampleMode;
  localRepairRoute: {
    available: true;
    engine: 'local-deterministic-pixel-repair';
    handoff: 'use ImageContentAware local patch plan for selection/remove/patch quick actions';
  };
  patchSource: {
    requested: 'manual-source-drag' | 'none';
    supported: false;
    fallback: 'automatic-nearby-active-layer-pixels';
    blocker: 'manual-patch-source-unsupported';
    caveat: string;
  };
  removeRoute: {
    nativeObjectRemovalSupported: false;
    localAlphaRemoveAvailable: true;
    blocker: 'content-aware-remove-native-ai-unsupported';
    caveat: string;
  };
  output: {
    requested: RetouchWorkflowOutputMode;
    applied: 'activeLayer';
    supportsNewLayer: false;
    blockers: RetouchContentAwareRepairBlockerCode[];
    sourceBinSafety: 'commit-flattened-active-layer-result-before-handoff';
  };
  aiBoundary: {
    nativePhotoshopAiSupported: false;
    cloudExecutionWired: false;
    warning: string;
  };
  blockers: Array<{
    code: RetouchContentAwareRepairBlockerCode;
    message: string;
  }>;
  previewSignature: string;
}

export type TonalSaturationReadinessBlockerCode =
  | 'airbrush-rate-unsupported'
  | 'non-destructive-retouch-output-unsupported';

export interface TonalSaturationReadinessBlocker {
  code: TonalSaturationReadinessBlockerCode;
  message: string;
}

export interface TonalSaturationBrushReadinessDescriptor {
  descriptorId: 'image-tonal-saturation-brush-readiness:v1';
  readiness: 'ready' | 'blocked';
  tonalRanges: Array<{
    range: ToneBrushRange;
    label: string;
    luminanceGate: string;
  }>;
  dodge: {
    range: ToneBrushRange;
    exposure: number;
    protectTones: boolean;
    rangeTargetingSupported: true;
    protectTonesBehavior: string;
    exposureCaveat: string;
    previewSignature: string;
  };
  burn: {
    range: ToneBrushRange;
    exposure: number;
    protectTones: boolean;
    rangeTargetingSupported: true;
    protectTonesBehavior: string;
    exposureCaveat: string;
    previewSignature: string;
  };
  sponge: {
    mode: SpongeBrushMode;
    modes: SpongeBrushMode[];
    saturation: number;
    vibrance: number;
    preserveLuminosity: boolean;
    vibranceBehavior: string;
    luminancePreservation: string;
    previewSignature: string;
  };
  airbrushRate: {
    requestedAirbrush: boolean;
    requestedRate: number | null;
    status: 'supported' | 'unsupported';
    applied: 'discrete-stroke-spacing' | 'rate-adjusted';
    caveat: string;
  };
  output: {
    requested: RetouchBrushOutputMode;
    applied: RetouchBrushOutputMode;
    nonDestructiveSupported: boolean;
    caveat: string;
  };
  blockers: TonalSaturationReadinessBlocker[];
  previewSignature: string;
}

export interface RetouchBrushPlanDescriptor {
  descriptorId: 'image-retouch-brush-plan:v1';
  tool: RetouchBrushToolKind;
  mode?: SpongeBrushMode;
  label: string;
  operation: string;
  modes?: SpongeBrushMode[];
  adjustment: {
    parameter: RetouchBrushAdjustmentParameter;
    value: number;
    behavior: string;
  };
  brush: {
    size: number;
    radius: number;
    softness: number;
    spacingHint: number;
    falloff: 'soft-edge-preview-only';
  };
  sampling: {
    requested: RetouchBrushSampleMode;
    applied: RetouchBrushSampleMode;
    source:
      | 'current-layer-stroke-snapshot'
      | 'visible-current-and-below-stroke-snapshot'
      | 'visible-all-layers-stroke-snapshot'
      | 'previous-stroke-point-current-layer'
      | 'previous-stroke-point-live-composite'
      | 'active-layer-pixels';
  };
  tonal?: {
    range: ToneBrushRange;
    protectTones: boolean;
    supportsRangeTargeting: true;
  };
  saturation?: {
    vibrance: number;
    preserveLuminosity: boolean;
    supportsVibranceWeighting: true;
  };
  limits: {
    supportsSampleAllLayers: boolean;
    supportsBlendMode: false;
    supportsChannelTarget: false;
    supportsOutputToNewLayer: boolean;
  };
  dynamics: {
    supportsPressure: false;
    supportsTilt: false;
    supportsFlow: false;
    supportsAirbrushAccumulation: false;
    spacingPx: number;
    hardnessControl: 'softness-only';
    signature: string;
  };
  presetRouting: {
    recommendedCategories: Array<'soft-round' | 'airbrush' | 'smudge-retouch' | 'hard-round' | 'basic-round' | 'utility'>;
    recommendedPresetIds: string[];
    incompatiblePresetCategories: Array<'eraser'>;
    signature: string;
  };
  warnings: RetouchBrushWarning[];
  previewSignature: string;
}

export type RetouchReadinessToolKind = 'cloneStamp' | 'spotHeal' | 'blur' | 'sharpen';
export type RetouchReadinessActiveTarget = NonNullable<ImageDocument['activeLayerEditTarget']>;

export type RetouchToolReadinessBlockerCode =
  | 'active-layer-not-editable'
  | 'layer-mask-target-unsupported'
  | 'channel-target-unsupported'
  | 'sample-source-required';

export interface RetouchToolReadinessBlocker {
  code: RetouchToolReadinessBlockerCode;
  message: string;
}

export interface RetouchToolReadinessDescriptor {
  descriptorId: 'image-retouch-tool-readiness:v1';
  tool: RetouchReadinessToolKind;
  readiness: 'ready' | 'blocked';
  implemented: string[];
  unsupported: string[];
  routeSafety: {
    activeLayerEditable: boolean;
    activeTarget: RetouchReadinessActiveTarget;
    canPaint: boolean;
    blockers: RetouchToolReadinessBlocker[];
  };
  brushInput: {
    supportsPointer: true;
    supportsPressure: false;
    supportsTilt: false;
    supportsKeyboardSamplingShortcut: boolean;
    controls: string[];
  };
  sourceSampling: {
    requested: RetouchSampleMode;
    coordinateSpace: RetouchSampleSource['coordinateSpace'];
    source: CloneStampWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'];
    requiresExplicitSamplePoint: boolean;
    alignedBehavior: CloneStampWorkflowDescriptor['behavior']['strokeSourceBehavior'] | 'paint-at-current-pointer';
  };
  layerMaskChannelCaveats: string[];
  batchActions: {
    suitable: false;
    requiresRecordedPointerPath: true;
    requiresRecordedSamplePoint: boolean;
    reason: string;
    signature: string;
  };
  actionReadiness: {
    label: string;
    deterministic: true;
    recordable: true;
    requiresSamplePoint: boolean;
    signature: string;
  };
  sourceBinHandoff: {
    supported: false;
    target: 'source-bin';
    result: 'flattened-active-layer-retouch';
    warnings: [string, string, string];
    signature: string;
  };
  previewSignature: string;
}

export type RetouchSampleRoutingTool = 'cloneStamp' | 'spotHeal' | 'blurSharpenBrush';
export type RetouchParityStatus = 'supported' | 'unsupported' | 'blocked';
export type RetouchCloneSourceTransform = 'scale' | 'rotation' | 'flip' | 'offset';

export interface RetouchSampleRoutingToolCheck {
  status: 'supported';
  source: CloneStampWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'] | RetouchBrushPlanDescriptor['sampling']['source'];
  requiresSamplePoint: boolean;
  signature: string;
}

export interface RetouchBlurSharpenRoutingCheck extends RetouchSampleRoutingToolCheck {
  tools: ['blur', 'sharpen'];
}

export interface RetouchSmudgeRoutingCheck {
  status: 'supported';
  requested: RetouchSampleMode;
  applied: RetouchSampleMode;
  source: 'previous-stroke-point-current-layer' | 'previous-stroke-point-live-composite';
  blocker: null;
  signature: string;
}

export interface RetouchSampleRoutingCheck {
  mode: RetouchSampleMode;
  coordinateSpace: RetouchSampleSource['coordinateSpace'];
  cloneStamp: RetouchSampleRoutingToolCheck;
  spotHeal: RetouchSampleRoutingToolCheck;
  blurSharpenBrush: RetouchBlurSharpenRoutingCheck;
  smudge: RetouchSmudgeRoutingCheck;
}

export interface RetouchCloneSourceParityChecks {
  overlay: {
    checkId: 'clone-source-overlay';
    status: 'unsupported';
    fallback: CloneStampWorkflowDescriptor['liveCloneSourceOverlay']['fallback'];
    blocker: Extract<RetouchWorkflowReadinessBlockerCode, 'clone-source-overlay-unsupported'>;
    caveat: string;
    signature: string;
  };
  transform: {
    checkId: 'clone-source-transform';
    status: 'unsupported';
    requestedTransforms: RetouchCloneSourceTransform[];
    supportedTransforms: [];
    blocker: Extract<RetouchWorkflowReadinessBlockerCode, 'clone-source-transform-unsupported'>;
    caveat: string;
    signature: string;
  };
}

export interface RetouchRepairOutputParityChecks {
  patch: {
    checkId: 'patch-source-workflow';
    status: 'unsupported';
    supportedRoute: 'paint-local-repair';
    unsupportedSteps: SpotHealWorkflowDescriptor['patchWorkflow']['unsupportedSteps'];
    blocker: Extract<RetouchWorkflowReadinessBlockerCode, 'patch-workflow-unsupported'>;
    caveat: string;
    signature: string;
  };
  remove: {
    checkId: 'remove-tool-workflow';
    status: 'unsupported';
    localFallback: 'local-alpha-remove-from-content-aware-plan';
    blocker: Extract<RetouchWorkflowReadinessBlockerCode, 'content-aware-remove-unsupported'>;
    caveat: string;
    signature: string;
  };
  newLayerOutput: {
    checkId: 'retouch-new-layer-output';
    requested: boolean;
    status: 'unsupported';
    applied: 'activeLayer';
    blocker: Extract<RetouchWorkflowWarning['code'], 'new-layer-output-unsupported'>;
    caveat: string;
    signature: string;
  };
}

export interface RetouchNonDestructiveOutputPlan {
  checkId: 'non-destructive-retouch-output-plan';
  requested: RetouchWorkflowOutputMode;
  supported: false;
  applied: 'activeLayer';
  plan: 'undo-snapshot-active-layer-mutation';
  editableRetouchLayer: false;
  requiredForParity: ['clone-stamp-empty-retouch-layer', 'heal-sample-all-layers-on-new-layer', 'editable-retouch-replay'];
  sourceBinResult: 'flattened-active-layer-retouch';
  blocker: Extract<RetouchWorkflowReadinessBlockerCode, 'non-destructive-retouch-output-unsupported'>;
  caveats: [string, string, string];
  signature: string;
}

export interface RetouchSmudgeCompositeSamplingCheck {
  checkId: 'smudge-composite-sampling';
  requested: RetouchBrushSampleMode;
  applied: RetouchBrushSampleMode;
  compositeSamplingSupported: true;
  blockedModes: [];
  blocker: null;
  caveat: string;
  signature: string;
}

export interface RetouchParityChecksDescriptor {
  descriptorId: 'image-retouch-parity-checks:v1';
  readiness: 'ready' | 'blocked';
  sampleRouting: RetouchSampleRoutingCheck[];
  cloneSource: RetouchCloneSourceParityChecks;
  repairOutput: RetouchRepairOutputParityChecks;
  nonDestructiveOutput: RetouchNonDestructiveOutputPlan;
  smudgeCompositeSampling: RetouchSmudgeCompositeSamplingCheck;
  stableSignatures: {
    sampleRouting: string;
    cloneSource: string;
    repairOutput: string;
    nonDestructiveOutput: string;
    smudgeCompositeSampling: string;
    aggregate: string;
  };
  blockers: RetouchWorkflowReadinessBlocker[];
  previewSignature: string;
}

export interface RetouchParityChecksOptions {
  cloneSampleMode?: RetouchSampleMode;
  cloneAligned?: boolean;
  cloneHasSamplePoint?: boolean;
  healSampleMode?: RetouchSampleMode;
  smudgeSampleMode?: RetouchBrushSampleMode;
  output?: RetouchWorkflowOutputMode;
  size?: number;
  opacity?: number;
  smudgeStrength?: number;
}

export type RetouchLocalRouteTool = RetouchReadinessToolKind | 'smudge';
export type RetouchUnsupportedLocalOutputState =
  | 'editable-non-destructive-retouch-layer'
  | 'clone-source-overlay'
  | 'clone-source-transform'
  | 'perspective-clone'
  | 'advanced-healing-ai'
  | 'patch-remove-dedicated-ui';

export interface RetouchSampleSourceStateDescriptor {
  descriptorId: 'image-retouch-sample-source-state:v1';
  cloneStamp: {
    requested: RetouchSampleMode;
    readiness: CloneStampWorkflowDescriptor['sampleSource']['readiness'];
    coordinateSpace: RetouchSampleSource['coordinateSpace'];
    source: CloneStampWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'];
    requiresExplicitSamplePoint: true;
    aligned: boolean;
    strokeSourceBehavior: CloneStampWorkflowDescriptor['behavior']['strokeSourceBehavior'];
    previewId: string;
    signature: string;
  };
  spotHeal: {
    requested: RetouchSampleMode;
    readiness: SpotHealWorkflowDescriptor['sampleSource']['readiness'];
    coordinateSpace: RetouchSampleSource['coordinateSpace'];
    source: SpotHealWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'];
    requiresExplicitSamplePoint: false;
    previewId: string;
    signature: string;
  };
  smudge: {
    requested: RetouchBrushSampleMode;
    applied: RetouchBrushSampleMode;
    coordinateSpace: RetouchSampleSource['coordinateSpace'];
    compositeSampling: 'bounded-live-composite-resampling';
    supportedModes: ['currentLayer', 'currentAndBelow', 'allLayers'];
    caveat: string;
    signature: string;
  };
  stableSignature: string;
}

export interface RetouchOutputPolicyDescriptor {
  descriptorId: 'image-retouch-output-policy:v1';
  requested: RetouchWorkflowOutputMode;
  applied: 'activeLayer';
  undoable: true;
  destructivePixels: true;
  nonDestructiveLayer: {
    supported: false;
    blocker: Extract<RetouchWorkflowReadinessBlockerCode, 'non-destructive-retouch-output-unsupported'>;
    unsupportedState: 'editable-retouch-output-layer';
  };
  sourceBinHandoff: 'flattened-active-layer-retouch';
  blockers: RetouchWorkflowReadinessBlocker[];
  signature: string;
}

export interface RetouchBrushRouteSupportDescriptor {
  descriptorId: 'image-retouch-brush-route-support:v1';
  tool: RetouchLocalRouteTool;
  readiness: 'ready' | 'blocked';
  route: {
    activeLayerEditable: boolean;
    activeTarget: RetouchReadinessActiveTarget;
    requestedChannel: string;
    sampleMode: RetouchSampleMode;
    canPaint: boolean;
  };
  supported: string[];
  unsupported: string[];
  blockers: RetouchToolReadinessBlockerCode[];
  signature: string;
}

export interface RetouchPreviewIdsDescriptor {
  descriptorId: 'image-retouch-preview-ids:v1';
  cloneStamp: {
    id: string;
    signature: string;
  };
  spotHeal: {
    id: string;
    signature: string;
  };
  blur: {
    id: string;
    signature: string;
  };
  sharpen: {
    id: string;
    signature: string;
  };
  smudge: {
    id: string;
    signature: string;
  };
  signature: string;
}

export interface RetouchLocalOutputReadinessDescriptor {
  descriptorId: 'image-retouch-local-output-readiness:v1';
  readiness: 'ready' | 'blocked';
  sampleSource: RetouchSampleSourceStateDescriptor;
  outputPolicy: RetouchOutputPolicyDescriptor;
  routeSupport: RetouchBrushRouteSupportDescriptor[];
  previewIds: RetouchPreviewIdsDescriptor;
  unsupportedStates: RetouchUnsupportedLocalOutputState[];
  stableSignatures: {
    sampleSource: string;
    outputPolicy: string;
    brushRouteSupport: string;
    previewIds: string;
    aggregate: string;
  };
  blockers: RetouchWorkflowReadinessBlocker[];
  previewSignature: string;
}

export interface RetouchLocalOutputReadinessOptions {
  cloneSampleMode?: RetouchSampleMode;
  cloneAligned?: boolean;
  cloneHasSamplePoint?: boolean;
  healSampleMode?: RetouchSampleMode;
  smudgeSampleMode?: RetouchBrushSampleMode;
  output?: RetouchWorkflowOutputMode;
  size?: number;
  opacity?: number;
  activeLayerEditable?: boolean;
  activeTarget?: RetouchReadinessActiveTarget;
  requestedChannel?: string;
}

export function describeCloneStampToolWorkflow({
  sampleMode = 'currentLayer',
  aligned = true,
  hasSamplePoint = false,
  size,
  opacity,
  output = 'activeLayer',
}: {
  sampleMode?: RetouchSampleMode;
  aligned?: boolean;
  hasSamplePoint?: boolean;
  size: number;
  opacity: number;
  output?: RetouchWorkflowOutputMode;
}): CloneStampWorkflowDescriptor {
  const brush = normalizeRetouchWorkflowBrush(size, opacity);
  const overlayWarning = 'Live source crosshair/ghost overlay is not rendered while cloning.';
  const transformWarning = 'Clone source scale, rotation, flip, and offset transform controls are not implemented.';
  const outputCaveat = 'Clone Stamp strokes mutate the active pixel layer; empty retouch output layers are not generated.';
  const nonDestructiveWarning = 'Clone Stamp edits are destructive pixel mutations with undo snapshots, not editable non-destructive retouch layers.';
  const warnings: RetouchWorkflowWarning[] = [
    ...(hasSamplePoint ? [] : [{
      code: 'sample-source-required' as const,
      message: 'Clone Stamp requires an Alt/Option sample point before painting.',
    }]),
    {
      code: 'live-clone-source-overlay-unsupported',
      message: overlayWarning,
    },
    {
      code: 'clone-source-transform-unsupported',
      message: transformWarning,
    },
    ...(output === 'activeLayer' ? [] : [{
      code: 'new-layer-output-unsupported' as const,
      message: outputCaveat,
    }]),
    {
      code: 'destructive-active-layer-pixels',
      message: nonDestructiveWarning,
    },
  ];
  const previewId = [
    'clone-stamp',
    sampleMode,
    aligned ? 'aligned' : 'restart',
    hasSamplePoint ? 'sample-ready' : 'no-sample',
    brush.size,
    brush.opacity,
    output,
  ].join(':');

  return {
    descriptorId: 'image-clone-stamp-workflow:v1',
    tool: 'cloneStamp',
    preview: {
      id: previewId,
      signature: `image-clone-stamp-workflow:v1:${JSON.stringify({
        sampleMode,
        aligned,
        sampleReady: hasSamplePoint,
        size: brush.size,
        opacity: brush.opacity,
        output,
        warnings: warnings.map((warning) => warning.code),
      })}`,
    },
    brush,
    sampleSource: {
      requested: sampleMode,
      readiness: hasSamplePoint ? 'ready' : 'needs-sample-point',
      coordinateSpaceWhenReady: retouchSampleCoordinateSpace(sampleMode),
      sourceBitmapWhenReady: retouchSampleBitmapSource(sampleMode),
    },
    behavior: {
      aligned,
      strokeSourceBehavior: aligned
        ? 'maintain-first-stroke-offset-across-strokes'
        : 'restart-from-sample-point-each-stroke',
    },
    liveCloneSourceOverlay: {
      status: 'unsupported',
      fallback: 'target-brush-cursor-only',
      warning: overlayWarning,
    },
    cloneSourceTransform: {
      status: 'unsupported',
      supportedTransforms: [],
      warning: transformWarning,
    },
    outputTarget: {
      requested: output,
      applied: 'activeLayer',
      supportsNewLayer: false,
      caveat: outputCaveat,
    },
    nonDestructive: {
      supported: false,
      undoable: true,
      warning: nonDestructiveWarning,
    },
    warnings,
  };
}

export function describeSpotHealToolWorkflow({
  sampleMode = 'currentLayer',
  size,
  opacity,
  output = 'activeLayer',
}: {
  sampleMode?: RetouchSampleMode;
  size: number;
  opacity: number;
  output?: RetouchWorkflowOutputMode;
}): SpotHealWorkflowDescriptor {
  const brush = normalizeRetouchWorkflowBrush(size, opacity);
  const patchWarning = 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.';
  const removeWarning = 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.';
  const outputCaveat = output === 'activeLayer'
    ? 'Spot Heal writes repaired pixels into the active layer; sample-all-layers does not create a separate retouch layer.'
    : 'Spot Heal writes repaired pixels into the active layer; new retouch output layers are not generated.';
  const nonDestructiveWarning = 'Spot Heal repairs are destructive pixel mutations with undo snapshots, not editable non-destructive patch layers.';
  const warnings: RetouchWorkflowWarning[] = [
    {
      code: 'patch-workflow-unsupported',
      message: patchWarning,
    },
    {
      code: 'content-aware-remove-unsupported',
      message: removeWarning,
    },
    ...(output === 'activeLayer' ? [] : [{
      code: 'new-layer-output-unsupported' as const,
      message: outputCaveat,
    }]),
    {
      code: 'destructive-active-layer-pixels',
      message: nonDestructiveWarning,
    },
  ];
  const previewId = ['spot-heal', sampleMode, brush.size, brush.opacity, output].join(':');

  return {
    descriptorId: 'image-spot-heal-workflow:v1',
    tool: 'spotHeal',
    preview: {
      id: previewId,
      signature: `image-spot-heal-workflow:v1:${JSON.stringify({
        sampleMode,
        size: brush.size,
        opacity: brush.opacity,
        output,
        warnings: warnings.map((warning) => warning.code),
      })}`,
    },
    brush,
    sampleSource: {
      requested: sampleMode,
      readiness: 'ready-on-stroke',
      coordinateSpaceWhenReady: retouchSampleCoordinateSpace(sampleMode),
      sourceBitmapWhenReady: retouchSampleBitmapSource(sampleMode),
    },
    patchWorkflow: {
      status: 'unsupported',
      supportedSteps: ['paint-local-repair'],
      unsupportedSteps: ['lasso-patch-source-drag', 'patch-transform', 'destination-mode', 'transparent-mode'],
      warning: patchWarning,
    },
    removeWorkflow: {
      status: 'unsupported',
      warning: removeWarning,
    },
    outputTarget: {
      requested: output,
      applied: 'activeLayer',
      supportsNewLayer: false,
      caveat: outputCaveat,
    },
    nonDestructive: {
      supported: false,
      undoable: true,
      warning: nonDestructiveWarning,
    },
    warnings,
  };
}

export function describeRetouchContentAwareRepairParity({
  requestedTool = 'spotHeal',
  sampleMode = 'currentLayer',
  output = 'activeLayer',
}: {
  requestedTool?: RetouchContentAwareRepairTool;
  sampleMode?: RetouchSampleMode;
  output?: RetouchWorkflowOutputMode;
} = {}): RetouchContentAwareRepairParityDescriptor {
  const outputBlockers: RetouchContentAwareRepairBlockerCode[] = output === 'activeLayer'
    ? []
    : ['new-layer-output-unsupported'];
  const blockers: RetouchContentAwareRepairParityDescriptor['blockers'] = [
    ...(requestedTool === 'patch' ? [{
      code: 'manual-patch-source-unsupported' as const,
      message: 'Manual Patch source dragging is not implemented for retouch repair planning.',
    }] : []),
    {
      code: 'content-aware-remove-native-ai-unsupported',
      message: 'Photoshop semantic Remove Tool execution is not implemented; local remove only clears selected alpha.',
    },
    ...(output === 'activeLayer' ? [] : [{
      code: 'new-layer-output-unsupported' as const,
      message: 'Retouch content-aware repair commits undoable pixels to the active layer instead of creating a new retouch layer.',
    }]),
  ];

  return {
    descriptorId: 'image-retouch-content-aware-repair-parity:v1',
    requestedTool,
    sampleMode,
    localRepairRoute: {
      available: true,
      engine: 'local-deterministic-pixel-repair',
      handoff: 'use ImageContentAware local patch plan for selection/remove/patch quick actions',
    },
    patchSource: {
      requested: requestedTool === 'patch' ? 'manual-source-drag' : 'none',
      supported: false,
      fallback: 'automatic-nearby-active-layer-pixels',
      blocker: 'manual-patch-source-unsupported',
      caveat: 'Retouch Patch parity records manual source intent, but local repair still uses automatic content-aware sampling.',
    },
    removeRoute: {
      nativeObjectRemovalSupported: false,
      localAlphaRemoveAvailable: true,
      blocker: 'content-aware-remove-native-ai-unsupported',
      caveat: 'Remove-style local repair can clear selected pixels, but Photoshop semantic object removal is not wired.',
    },
    output: {
      requested: output,
      applied: 'activeLayer',
      supportsNewLayer: false,
      blockers: outputBlockers,
      sourceBinSafety: 'commit-flattened-active-layer-result-before-handoff',
    },
    aiBoundary: {
      nativePhotoshopAiSupported: false,
      cloudExecutionWired: false,
      warning: 'This retouch descriptor routes to local pixel repair metadata only; it does not dispatch Photoshop AI, Firefly, or provider cloud generation.',
    },
    blockers,
    previewSignature: `image-retouch-content-aware-repair-parity:v1:${JSON.stringify({
      requestedTool,
      sampleMode,
      output,
      blockers: blockers.map((blocker) => blocker.code),
    })}`,
  };
}

export function describeRetouchWorkflowReadiness({
  cloneSampleMode = 'currentLayer',
  cloneAligned = true,
  cloneHasSamplePoint = false,
  healSampleMode = 'currentLayer',
  smudgeSampleMode = 'currentLayer',
  output = 'activeLayer',
  size = 16,
  opacity = 1,
  smudgeStrength = 0.5,
}: {
  cloneSampleMode?: RetouchSampleMode;
  cloneAligned?: boolean;
  cloneHasSamplePoint?: boolean;
  healSampleMode?: RetouchSampleMode;
  smudgeSampleMode?: RetouchBrushSampleMode;
  output?: RetouchWorkflowOutputMode;
  size?: number;
  opacity?: number;
  smudgeStrength?: number;
} = {}): RetouchWorkflowReadinessDescriptor {
  const clone = describeCloneStampToolWorkflow({
    sampleMode: cloneSampleMode,
    aligned: cloneAligned,
    hasSamplePoint: cloneHasSamplePoint,
    size,
    opacity,
    output,
  });
  const heal = describeSpotHealToolWorkflow({
    sampleMode: healSampleMode,
    size,
    opacity,
    output,
  });
  const smudge = describeRetouchBrushToolPlan({
    tool: 'smudge',
    size,
    strength: smudgeStrength,
    sampleMode: smudgeSampleMode,
    output,
  });
  const smudgeCompositeSamplingCaveat = 'Smudge supports bounded current-and-below and all-layers sampling by resampling the visible composite between drag dabs.';
  const blockers = buildRetouchWorkflowReadinessBlockers({
    clone,
    heal,
    output,
  });

  const descriptor: RetouchWorkflowReadinessDescriptor = {
    descriptorId: 'image-retouch-workflow-readiness:v1',
    readiness: blockers.length === 0 ? 'ready' : 'blocked',
    sampleModes: (['currentLayer', 'currentAndBelow', 'allLayers'] as RetouchSampleMode[]).map((mode) => ({
      mode,
      coordinateSpace: retouchSampleCoordinateSpace(mode),
      cloneSource: retouchSampleBitmapSource(mode),
      healSource: retouchSampleBitmapSource(mode),
    })),
    clone: {
      sampleMode: clone.sampleSource.requested,
      readiness: clone.sampleSource.readiness,
      aligned: clone.behavior.aligned,
      strokeSourceBehavior: clone.behavior.strokeSourceBehavior,
      overlayStatus: clone.liveCloneSourceOverlay.status,
      transformStatus: clone.cloneSourceTransform.status,
      previewSignature: clone.preview.signature,
    },
    heal: {
      sampleMode: heal.sampleSource.requested,
      readiness: heal.sampleSource.readiness,
      patchWorkflowStatus: heal.patchWorkflow.status,
      removeWorkflowStatus: heal.removeWorkflow.status,
      previewSignature: heal.preview.signature,
    },
    output: {
      requested: output,
      applied: 'activeLayer',
      nonDestructiveSupported: false,
    },
    smudge: {
      requestedSampleMode: smudge.sampling.requested,
      appliedSampleMode: smudge.sampling.applied,
      compositeSamplingSupported: true,
      caveat: smudgeCompositeSamplingCaveat,
      previewSignature: smudge.previewSignature,
    },
    blockers,
    previewSignature: '',
  };

  descriptor.previewSignature = `image-retouch-workflow-readiness:v1:${JSON.stringify({
    clone: descriptor.clone.previewSignature,
    heal: descriptor.heal.previewSignature,
    smudge: descriptor.smudge.previewSignature,
    blockers: blockers.map((blocker) => blocker.code),
  })}`;

  return descriptor;
}

export function describeRetouchParityChecks({
  cloneSampleMode = 'currentLayer',
  cloneAligned = true,
  cloneHasSamplePoint = false,
  healSampleMode = 'currentLayer',
  smudgeSampleMode = 'currentLayer',
  output = 'activeLayer',
  size = 16,
  opacity = 1,
  smudgeStrength = 0.5,
}: RetouchParityChecksOptions = {}): RetouchParityChecksDescriptor {
  const readiness = describeRetouchWorkflowReadiness({
    cloneSampleMode,
    cloneAligned,
    cloneHasSamplePoint,
    healSampleMode,
    smudgeSampleMode,
    output,
    size,
    opacity,
    smudgeStrength,
  });
  const sampleRouting = buildRetouchSampleRoutingChecks();
  const cloneSource = buildRetouchCloneSourceParityChecks();
  const repairOutput = buildRetouchRepairOutputParityChecks(output);
  const nonDestructiveOutput = buildRetouchNonDestructiveOutputPlan(output);
  const smudgeCompositeSampling = buildRetouchSmudgeCompositeSamplingCheck(smudgeSampleMode);
  const stableSignatures = {
    sampleRouting: buildRetouchSampleRoutingMatrixSignature(sampleRouting),
    cloneSource: buildRetouchCloneSourceChecksSignature(cloneSource),
    repairOutput: buildRetouchRepairOutputChecksSignature(repairOutput),
    nonDestructiveOutput: nonDestructiveOutput.signature,
    smudgeCompositeSampling: smudgeCompositeSampling.signature,
    aggregate: '',
  };
  const descriptor: RetouchParityChecksDescriptor = {
    descriptorId: 'image-retouch-parity-checks:v1',
    readiness: readiness.readiness,
    sampleRouting,
    cloneSource,
    repairOutput,
    nonDestructiveOutput,
    smudgeCompositeSampling,
    stableSignatures,
    blockers: readiness.blockers,
    previewSignature: '',
  };

  descriptor.previewSignature = `image-retouch-parity-checks:v1:${JSON.stringify({
    sampleRouting: stableSignatures.sampleRouting,
    cloneSource: stableSignatures.cloneSource,
    repairOutput: stableSignatures.repairOutput,
    nonDestructiveOutput: stableSignatures.nonDestructiveOutput,
    smudgeCompositeSampling: stableSignatures.smudgeCompositeSampling,
    blockers: readiness.blockers.map((blocker) => blocker.code),
  })}`;
  descriptor.stableSignatures.aggregate = descriptor.previewSignature;

  return descriptor;
}

export function describeRetouchBrushToolPlan({
  tool,
  mode,
  size,
  strength,
  softness = 0.5,
  sampleMode = 'currentLayer',
  blendMode = 'normal',
  channel = 'rgb',
  output = 'activeLayer',
  toneRange = 'all',
  protectTones = false,
  spongeVibrance = 0,
  spongePreserveLuminosity = false,
}: {
  tool: RetouchBrushToolKind;
  mode?: SpongeBrushMode;
  size: number;
  strength: number;
  softness?: number;
  sampleMode?: RetouchBrushSampleMode;
  blendMode?: string;
  channel?: string;
  output?: RetouchBrushOutputMode;
  toneRange?: ToneBrushRange;
  protectTones?: boolean;
  spongeVibrance?: number;
  spongePreserveLuminosity?: boolean;
}): RetouchBrushPlanDescriptor {
  const brushSize = Math.max(1, Math.round(Number.isFinite(size) ? size : 1));
  const descriptorMode = tool === 'sponge' ? mode ?? 'saturate' : mode;
  const appliedSampleMode = appliedSampleModeForRetouchBrushTool(tool, sampleMode);
  const warnings = buildRetouchBrushWarnings({
    tool,
    sampleMode,
    blendMode,
    channel,
    output,
  });
  const descriptor: RetouchBrushPlanDescriptor = {
    descriptorId: 'image-retouch-brush-plan:v1',
    tool,
    ...(descriptorMode ? { mode: descriptorMode } : {}),
    label: labelForRetouchBrushTool(tool),
    operation: operationForRetouchBrushTool(tool, descriptorMode),
    ...(tool === 'sponge' ? { modes: ['saturate', 'desaturate'] as SpongeBrushMode[] } : {}),
    adjustment: {
      parameter: adjustmentParameterForRetouchBrushTool(tool),
      value: clamp01(strength),
      behavior: adjustmentBehaviorForRetouchBrushTool(tool, descriptorMode),
    },
    brush: {
      size: brushSize,
      radius: Math.max(0, (brushSize - 1) / 2),
      softness: clamp01(softness),
      spacingHint: Math.max(1, Math.round(brushSize / 3)),
      falloff: 'soft-edge-preview-only',
    },
    sampling: {
      requested: sampleMode,
      applied: appliedSampleMode,
      source: samplingSourceForRetouchBrushTool(tool, appliedSampleMode),
    },
    ...(tool === 'dodge' || tool === 'burn'
      ? {
          tonal: {
            range: toneRange,
            protectTones,
            supportsRangeTargeting: true,
          },
        }
      : {}),
    ...(tool === 'sponge'
      ? {
          saturation: {
            vibrance: clamp01(spongeVibrance),
            preserveLuminosity: spongePreserveLuminosity,
            supportsVibranceWeighting: true,
          },
        }
      : {}),
    limits: {
      supportsSampleAllLayers: retouchBrushSupportsCompositeSampling(tool),
      supportsBlendMode: false,
      supportsChannelTarget: false,
      supportsOutputToNewLayer: retouchBrushSupportsNewLayerOutput(tool),
    },
    dynamics: buildRetouchBrushDynamicsDescriptor({
      tool,
      size: brushSize,
      softness: clamp01(softness),
    }),
    presetRouting: buildRetouchBrushPresetRouting(tool),
    warnings,
    previewSignature: '',
  };

  descriptor.previewSignature = `image-retouch-brush-plan:v1:${JSON.stringify({
    tool: descriptor.tool,
    ...(descriptor.mode ? { mode: descriptor.mode } : {}),
    operation: descriptor.operation,
    size: descriptor.brush.size,
    [descriptor.adjustment.parameter === 'exposure'
      ? 'exposure'
      : descriptor.adjustment.parameter === 'saturation'
        ? 'saturation'
        : 'strength']: descriptor.adjustment.value,
    softness: descriptor.brush.softness,
    sampleMode,
    appliedSampleMode: descriptor.sampling.applied,
    blendMode,
    channel,
    output,
    ...(descriptor.tonal
      ? {
          toneRange: descriptor.tonal.range,
          protectTones: descriptor.tonal.protectTones,
        }
      : {}),
    ...(descriptor.saturation
      ? {
          spongeVibrance: descriptor.saturation.vibrance,
          spongePreserveLuminosity: descriptor.saturation.preserveLuminosity,
        }
      : {}),
    warnings: warnings.map((warning) => warning.code),
  })}`;

  return descriptor;
}

export function resolveRetouchStrokeDensityStep({
  size,
  airbrush,
  rate,
}: {
  size: number;
  airbrush: boolean;
  rate?: number | null;
}): number {
  const brushSize = Math.max(1, Math.round(Number.isFinite(size) ? size : 1));
  const discreteSpacing = Math.max(1, Math.round(brushSize / 3));
  if (!airbrush) return discreteSpacing;

  const boundedRate = clamp01(rate === null || rate === undefined ? 0 : rate);
  const spacingForRate = Math.max(1, Math.round(discreteSpacing * (1 - 0.85 * boundedRate)));
  return spacingForRate;
}

export function describeTonalSaturationBrushReadiness({
  dodgeRange = 'midtones',
  burnRange = 'midtones',
  protectTones = true,
  exposure = 0.5,
  spongeMode = 'saturate',
  saturation = 0.5,
  spongeVibrance = 0.65,
  spongePreserveLuminosity = true,
  size = 25,
  softness = 0.5,
  output = 'activeLayer',
  airbrush = false,
  rate = null,
}: {
  dodgeRange?: ToneBrushRange;
  burnRange?: ToneBrushRange;
  protectTones?: boolean;
  exposure?: number;
  spongeMode?: SpongeBrushMode;
  saturation?: number;
  spongeVibrance?: number;
  spongePreserveLuminosity?: boolean;
  size?: number;
  softness?: number;
  output?: RetouchBrushOutputMode;
  airbrush?: boolean;
  rate?: number | null;
} = {}): TonalSaturationBrushReadinessDescriptor {
  const dodge = describeRetouchBrushToolPlan({
    tool: 'dodge',
    size,
    strength: exposure,
    softness,
    output,
    toneRange: dodgeRange,
    protectTones,
  });
  const burn = describeRetouchBrushToolPlan({
    tool: 'burn',
    size,
    strength: exposure,
    softness,
    output,
    toneRange: burnRange,
    protectTones,
  });
  const sponge = describeRetouchBrushToolPlan({
    tool: 'sponge',
    mode: spongeMode,
    size,
    strength: saturation,
    softness,
    output,
    spongeVibrance,
    spongePreserveLuminosity,
  });
  const normalizedRate = rate === null ? null : clamp01(rate);
  const airbrushRateCaveat = airbrush
    ? 'Airbrush and rate adjust local brush stroke spacing; rate is bounded to [0, 1].'
    : 'Tone and sponge brushes use discrete spacing when Airbrush is disabled.';
  const outputSupported = output === 'activeLayer'
    || ([dodge.tool, burn.tool, sponge.tool] as RetouchBrushToolKind[]).every(retouchBrushSupportsNewLayerOutput);
  const appliedOutput: RetouchBrushOutputMode = outputSupported ? output : 'activeLayer';
  const outputCaveat = output === 'newLayer'
    ? 'Dodge, Burn, and Sponge can write an undoable generated retouch layer while preserving the source layer pixels.'
    : 'Dodge, Burn, and Sponge mutate undoable pixels on the active layer unless New Retouch Layer output is selected.';
  const blockers: TonalSaturationReadinessBlocker[] = [
    ...(!outputSupported ? [{
      code: 'non-destructive-retouch-output-unsupported' as const,
      message: outputCaveat,
    }] : []),
  ];
  const descriptor: TonalSaturationBrushReadinessDescriptor = {
    descriptorId: 'image-tonal-saturation-brush-readiness:v1',
    readiness: blockers.length === 0 ? 'ready' : 'blocked',
    tonalRanges: buildTonalRangeReadinessSummary(),
    dodge: {
      range: dodge.tonal?.range ?? dodgeRange,
      exposure: dodge.adjustment.value,
      protectTones: dodge.tonal?.protectTones ?? protectTones,
      rangeTargetingSupported: true,
      protectTonesBehavior: 'Scales RGB by target luminance to reduce hue shifts and channel clipping compared with independent channel dodge.',
      exposureCaveat: 'Exposure is a clamped per-dab strength value, not Photoshop airbrush accumulation over time.',
      previewSignature: dodge.previewSignature,
    },
    burn: {
      range: burn.tonal?.range ?? burnRange,
      exposure: burn.adjustment.value,
      protectTones: burn.tonal?.protectTones ?? protectTones,
      rangeTargetingSupported: true,
      protectTonesBehavior: 'Scales RGB by target luminance to reduce hue shifts and channel clipping compared with independent channel burn.',
      exposureCaveat: 'Exposure is a clamped per-dab strength value, not Photoshop airbrush accumulation over time.',
      previewSignature: burn.previewSignature,
    },
    sponge: {
      mode: sponge.mode ?? spongeMode,
      modes: sponge.modes ?? ['saturate', 'desaturate'],
      saturation: sponge.adjustment.value,
      vibrance: sponge.saturation?.vibrance ?? clamp01(spongeVibrance),
      preserveLuminosity: sponge.saturation?.preserveLuminosity ?? spongePreserveLuminosity,
      vibranceBehavior: 'Vibrance weights saturation changes toward muted pixels for saturate and already separated pixels for desaturate.',
      luminancePreservation: spongePreserveLuminosity
        ? 'Enabled: corrected RGB output is shifted back toward the source luminance after saturation math.'
        : 'Disabled: saturation math may shift perceived luminance.',
      previewSignature: sponge.previewSignature,
    },
    airbrushRate: {
      requestedAirbrush: airbrush,
      requestedRate: normalizedRate,
      status: 'supported',
      applied: airbrush ? 'rate-adjusted' : 'discrete-stroke-spacing',
      caveat: airbrushRateCaveat,
    },
    output: {
      requested: output,
      applied: appliedOutput,
      nonDestructiveSupported: true,
      caveat: outputCaveat,
    },
    blockers,
    previewSignature: '',
  };

  descriptor.previewSignature = `image-tonal-saturation-brush-readiness:v1:${JSON.stringify({
    dodge: descriptor.dodge.previewSignature,
    burn: descriptor.burn.previewSignature,
    sponge: descriptor.sponge.previewSignature,
    airbrush,
    rate: normalizedRate,
    output,
    blockers: blockers.map((blocker) => blocker.code),
  })}`;

  return descriptor;
}

export function describeRetouchToolReadiness({
  tool,
  sampleMode = 'currentLayer',
  hasSamplePoint = tool !== 'cloneStamp',
  aligned = true,
  output = 'activeLayer',
  activeLayerEditable = true,
  activeTarget = 'layer',
  requestedChannel = 'rgb',
}: {
  tool: RetouchReadinessToolKind;
  sampleMode?: RetouchSampleMode;
  hasSamplePoint?: boolean;
  aligned?: boolean;
  output?: RetouchWorkflowOutputMode;
  activeLayerEditable?: boolean;
  activeTarget?: RetouchReadinessActiveTarget;
  requestedChannel?: string;
}): RetouchToolReadinessDescriptor {
  const requiresSamplePoint = tool === 'cloneStamp';
  const blockers: RetouchToolReadinessBlocker[] = [
    ...(!activeLayerEditable ? [{
      code: 'active-layer-not-editable' as const,
      message: 'Retouch tools require an unlocked editable image layer with a bitmap.',
    }] : []),
    ...(activeTarget !== 'layer' ? [{
      code: 'layer-mask-target-unsupported' as const,
      message: 'Retouch tools do not route clone/heal/blur/sharpen strokes into layer masks.',
    }] : []),
    ...(requestedChannel !== 'rgb' ? [{
      code: 'channel-target-unsupported' as const,
      message: 'Retouch tools apply RGB pixel edits together; alpha and spot-channel retouch routing are not implemented.',
    }] : []),
    ...(requiresSamplePoint && !hasSamplePoint ? [{
      code: 'sample-source-required' as const,
      message: 'Clone Stamp requires an Alt/Option sample point before painting.',
    }] : []),
  ];
  const unsupported = buildRetouchToolUnsupportedStates(tool);
  const descriptor: RetouchToolReadinessDescriptor = {
    descriptorId: 'image-retouch-tool-readiness:v1',
    tool,
    readiness: blockers.length === 0 ? 'ready' : 'blocked',
    implemented: buildRetouchToolImplementedStates(tool),
    unsupported,
    routeSafety: {
      activeLayerEditable,
      activeTarget,
      canPaint: blockers.length === 0,
      blockers,
    },
    brushInput: {
      supportsPointer: true,
      supportsPressure: false,
      supportsTilt: false,
      supportsKeyboardSamplingShortcut: requiresSamplePoint,
      controls: controlsForRetouchReadinessTool(tool),
    },
    sourceSampling: {
      requested: sampleMode,
      coordinateSpace: retouchSampleCoordinateSpace(sampleMode),
      source: retouchSampleBitmapSource(sampleMode),
      requiresExplicitSamplePoint: requiresSamplePoint,
      alignedBehavior: requiresSamplePoint
        ? (aligned ? 'maintain-first-stroke-offset-across-strokes' : 'restart-from-sample-point-each-stroke')
        : 'paint-at-current-pointer',
    },
    layerMaskChannelCaveats: [
      'Layer masks can constrain visible output, but retouch strokes are written to active layer pixels.',
      'Alpha and spot-channel retouch edits are unsupported; convert/load channel selections before painting RGB pixels.',
    ],
    batchActions: {
      suitable: false,
      requiresRecordedPointerPath: true,
      requiresRecordedSamplePoint: requiresSamplePoint,
      reason: batchActionReasonForRetouchReadinessTool(tool),
      signature: buildRetouchBatchSignature({
        tool,
        sampleMode,
        aligned,
        requiresSamplePoint,
      }),
    },
    actionReadiness: {
      label: `${labelForRetouchReadinessTool(tool)} stroke`,
      deterministic: true,
      recordable: true,
      requiresSamplePoint,
      signature: buildRetouchActionSignature({
        tool,
        sampleMode,
        aligned,
        output,
        requiresSamplePoint,
      }),
    },
    sourceBinHandoff: buildRetouchSourceBinHandoffDescriptor({
      tool,
      sampleMode,
      output,
    }),
    previewSignature: '',
  };

  descriptor.previewSignature = `image-retouch-tool-readiness:v1:${JSON.stringify({
    tool,
    sampleMode,
    activeTarget,
    requestedChannel,
    activeLayerEditable,
    output,
    blockers: blockers.map((blocker) => blocker.code),
    unsupported,
  })}`;

  return descriptor;
}

export function describeRetouchSampleSourceState({
  cloneSampleMode = 'currentLayer',
  cloneAligned = true,
  cloneHasSamplePoint = false,
  healSampleMode = 'currentLayer',
  smudgeSampleMode = 'currentLayer',
  size = 16,
  opacity = 1,
  output = 'activeLayer',
}: RetouchLocalOutputReadinessOptions = {}): RetouchSampleSourceStateDescriptor {
  const clone = describeCloneStampToolWorkflow({
    sampleMode: cloneSampleMode,
    aligned: cloneAligned,
    hasSamplePoint: cloneHasSamplePoint,
    size,
    opacity,
    output,
  });
  const heal = describeSpotHealToolWorkflow({
    sampleMode: healSampleMode,
    size,
    opacity,
    output,
  });
  const smudgeCoordinateSpace = retouchSampleCoordinateSpace(smudgeSampleMode);
  const smudgeCaveat = 'Composite smudge sampling resamples the bounded visible composite between drag dabs.';
  const cloneSignature = `image-retouch-sample-source-state:v1:${JSON.stringify({
    tool: 'cloneStamp',
    sampleMode: cloneSampleMode,
    coordinateSpace: clone.sampleSource.coordinateSpaceWhenReady,
    source: clone.sampleSource.sourceBitmapWhenReady,
    sampleReady: cloneHasSamplePoint,
    aligned: cloneAligned,
    strokeSourceBehavior: clone.behavior.strokeSourceBehavior,
  })}`;
  const healSignature = `image-retouch-sample-source-state:v1:${JSON.stringify({
    tool: 'spotHeal',
    sampleMode: healSampleMode,
    coordinateSpace: heal.sampleSource.coordinateSpaceWhenReady,
    source: heal.sampleSource.sourceBitmapWhenReady,
    readiness: heal.sampleSource.readiness,
  })}`;
  const smudgeSignature = `image-retouch-sample-source-state:v1:${JSON.stringify({
    tool: 'smudge',
    sampleMode: smudgeSampleMode,
    applied: smudgeSampleMode,
    coordinateSpace: smudgeCoordinateSpace,
    compositeSampling: 'bounded-live-composite-resampling',
  })}`;

  return {
    descriptorId: 'image-retouch-sample-source-state:v1',
    cloneStamp: {
      requested: cloneSampleMode,
      readiness: clone.sampleSource.readiness,
      coordinateSpace: clone.sampleSource.coordinateSpaceWhenReady,
      source: clone.sampleSource.sourceBitmapWhenReady,
      requiresExplicitSamplePoint: true,
      aligned: cloneAligned,
      strokeSourceBehavior: clone.behavior.strokeSourceBehavior,
      previewId: clone.preview.id,
      signature: cloneSignature,
    },
    spotHeal: {
      requested: healSampleMode,
      readiness: heal.sampleSource.readiness,
      coordinateSpace: heal.sampleSource.coordinateSpaceWhenReady,
      source: heal.sampleSource.sourceBitmapWhenReady,
      requiresExplicitSamplePoint: false,
      previewId: heal.preview.id,
      signature: healSignature,
    },
    smudge: {
      requested: smudgeSampleMode,
      applied: smudgeSampleMode,
      coordinateSpace: smudgeCoordinateSpace,
      compositeSampling: 'bounded-live-composite-resampling',
      supportedModes: ['currentLayer', 'currentAndBelow', 'allLayers'],
      caveat: smudgeCaveat,
      signature: smudgeSignature,
    },
    stableSignature: `image-retouch-sample-source-state:v1:${JSON.stringify({
      cloneStamp: cloneSignature,
      spotHeal: healSignature,
      smudge: smudgeSignature,
    })}`,
  };
}

export function describeRetouchOutputPolicy({
  output = 'activeLayer',
}: {
  output?: RetouchWorkflowOutputMode;
} = {}): RetouchOutputPolicyDescriptor {
  const blockers: RetouchWorkflowReadinessBlocker[] = output === 'activeLayer'
    ? []
    : [{
        code: 'non-destructive-retouch-output-unsupported',
        message: 'Retouch workflows write undoable destructive pixels to the active layer; editable non-destructive retouch output layers are not supported.',
      }];
  return {
    descriptorId: 'image-retouch-output-policy:v1',
    requested: output,
    applied: 'activeLayer',
    undoable: true,
    destructivePixels: true,
    nonDestructiveLayer: {
      supported: false,
      blocker: 'non-destructive-retouch-output-unsupported',
      unsupportedState: 'editable-retouch-output-layer',
    },
    sourceBinHandoff: 'flattened-active-layer-retouch',
    blockers,
    signature: `image-retouch-output-policy:v1:${JSON.stringify({
      requested: output,
      applied: 'activeLayer',
      undoable: true,
      destructivePixels: true,
      nonDestructiveSupported: false,
      sourceBinHandoff: 'flattened-active-layer-retouch',
      blockers: blockers.map((blocker) => blocker.code),
    })}`,
  };
}

export function describeRetouchBrushRouteSupport({
  tool,
  sampleMode = 'currentLayer',
  hasSamplePoint = tool !== 'cloneStamp',
  activeLayerEditable = true,
  activeTarget = 'layer',
  requestedChannel = 'rgb',
}: {
  tool: RetouchLocalRouteTool;
  sampleMode?: RetouchSampleMode;
  hasSamplePoint?: boolean;
  activeLayerEditable?: boolean;
  activeTarget?: RetouchReadinessActiveTarget;
  requestedChannel?: string;
}): RetouchBrushRouteSupportDescriptor {
  const requiresSamplePoint = tool === 'cloneStamp';
  const blockers: RetouchToolReadinessBlockerCode[] = [
    ...(!activeLayerEditable ? ['active-layer-not-editable' as const] : []),
    ...(activeTarget !== 'layer' ? ['layer-mask-target-unsupported' as const] : []),
    ...(requestedChannel !== 'rgb' ? ['channel-target-unsupported' as const] : []),
    ...(requiresSamplePoint && !hasSamplePoint ? ['sample-source-required' as const] : []),
  ];
  const unsupported = unsupportedStatesForRetouchRouteTool(tool);
  const canPaint = blockers.length === 0;

  return {
    descriptorId: 'image-retouch-brush-route-support:v1',
    tool,
    readiness: canPaint ? 'ready' : 'blocked',
    route: {
      activeLayerEditable,
      activeTarget,
      requestedChannel,
      sampleMode,
      canPaint,
    },
    supported: supportedStatesForRetouchRouteTool(tool),
    unsupported,
    blockers,
    signature: `image-retouch-brush-route-support:v1:${JSON.stringify({
      tool,
      sampleMode,
      activeTarget,
      requestedChannel,
      activeLayerEditable,
      canPaint,
      blockers,
      unsupported,
    })}`,
  };
}

export function describeRetouchPreviewIds({
  cloneSampleMode = 'currentLayer',
  cloneAligned = true,
  cloneHasSamplePoint = false,
  healSampleMode = 'currentLayer',
  smudgeSampleMode = 'currentLayer',
  output = 'activeLayer',
  size = 16,
  opacity = 1,
}: RetouchLocalOutputReadinessOptions = {}): RetouchPreviewIdsDescriptor {
  const clone = describeCloneStampToolWorkflow({
    sampleMode: cloneSampleMode,
    aligned: cloneAligned,
    hasSamplePoint: cloneHasSamplePoint,
    size,
    opacity,
    output,
  });
  const heal = describeSpotHealToolWorkflow({
    sampleMode: healSampleMode,
    size,
    opacity,
    output,
  });
  const blur = describeRetouchBrushToolPlan({
    tool: 'blur',
    size,
    strength: opacity,
    sampleMode: healSampleMode,
    output,
  });
  const sharpen = describeRetouchBrushToolPlan({
    tool: 'sharpen',
    size,
    strength: opacity,
    sampleMode: healSampleMode,
    output,
  });
  const smudge = describeRetouchBrushToolPlan({
    tool: 'smudge',
    size,
    strength: opacity,
    sampleMode: smudgeSampleMode,
    output,
  });
  const descriptor = {
    descriptorId: 'image-retouch-preview-ids:v1' as const,
    cloneStamp: {
      id: clone.preview.id,
      signature: clone.preview.signature,
    },
    spotHeal: {
      id: heal.preview.id,
      signature: heal.preview.signature,
    },
    blur: {
      id: `blur:${healSampleMode}:${blur.brush.size}:${blur.adjustment.value}:${output}`,
      signature: blur.previewSignature,
    },
    sharpen: {
      id: `sharpen:${healSampleMode}:${sharpen.brush.size}:${sharpen.adjustment.value}:${output}`,
      signature: sharpen.previewSignature,
    },
    smudge: {
      id: `smudge:${smudgeSampleMode}:${smudge.brush.size}:${smudge.adjustment.value}:${output}`,
      signature: smudge.previewSignature,
    },
    signature: '',
  };
  descriptor.signature = `image-retouch-preview-ids:v1:${JSON.stringify({
    cloneStamp: descriptor.cloneStamp.id,
    spotHeal: descriptor.spotHeal.id,
    blur: descriptor.blur.id,
    sharpen: descriptor.sharpen.id,
    smudge: descriptor.smudge.id,
  })}`;
  return descriptor;
}

export function describeRetouchLocalOutputReadiness({
  cloneSampleMode = 'currentLayer',
  cloneAligned = true,
  cloneHasSamplePoint = false,
  healSampleMode = 'currentLayer',
  smudgeSampleMode = 'currentLayer',
  output = 'activeLayer',
  size = 16,
  opacity = 1,
  activeLayerEditable = true,
  activeTarget = 'layer',
  requestedChannel = 'rgb',
}: RetouchLocalOutputReadinessOptions = {}): RetouchLocalOutputReadinessDescriptor {
  const sampleSource = describeRetouchSampleSourceState({
    cloneSampleMode,
    cloneAligned,
    cloneHasSamplePoint,
    healSampleMode,
    smudgeSampleMode,
    output,
    size,
    opacity,
  });
  const outputPolicy = describeRetouchOutputPolicy({ output });
  const routeSupport = ([
    ['cloneStamp', cloneSampleMode, cloneHasSamplePoint],
    ['spotHeal', healSampleMode, true],
    ['blur', healSampleMode, true],
    ['sharpen', healSampleMode, true],
    ['smudge', smudgeSampleMode, true],
  ] as Array<[RetouchLocalRouteTool, RetouchSampleMode, boolean]>).map(([tool, sampleMode, hasSamplePoint]) => describeRetouchBrushRouteSupport({
    tool,
    sampleMode,
    hasSamplePoint,
    activeLayerEditable,
    activeTarget,
    requestedChannel,
  }));
  const previewIds = describeRetouchPreviewIds({
    cloneSampleMode,
    cloneAligned,
    cloneHasSamplePoint,
    healSampleMode,
    smudgeSampleMode,
    output,
    size,
    opacity,
  });
  const unsupportedStates = buildRetouchLocalOutputUnsupportedStates();
  const blockers: RetouchWorkflowReadinessBlocker[] = [
    ...(cloneHasSamplePoint ? [] : [{
      code: 'sample-source-required' as const,
      message: 'Clone Stamp requires an Alt/Option sample point before painting.',
    }]),
    ...outputPolicy.blockers,
  ];
  const brushRouteSupportSignature = `image-retouch-brush-route-support-matrix:v1:${JSON.stringify({
    routes: routeSupport.map((route) => route.signature),
  })}`;
  const descriptor: RetouchLocalOutputReadinessDescriptor = {
    descriptorId: 'image-retouch-local-output-readiness:v1',
    readiness: blockers.length === 0 && routeSupport.every((route) => route.readiness === 'ready') ? 'ready' : 'blocked',
    sampleSource,
    outputPolicy,
    routeSupport,
    previewIds,
    unsupportedStates,
    stableSignatures: {
      sampleSource: sampleSource.stableSignature,
      outputPolicy: outputPolicy.signature,
      brushRouteSupport: brushRouteSupportSignature,
      previewIds: previewIds.signature,
      aggregate: '',
    },
    blockers,
    previewSignature: '',
  };

  descriptor.previewSignature = `image-retouch-local-output-readiness:v1:${JSON.stringify({
    sampleSource: descriptor.stableSignatures.sampleSource,
    outputPolicy: descriptor.stableSignatures.outputPolicy,
    brushRouteSupport: descriptor.stableSignatures.brushRouteSupport,
    previewIds: descriptor.stableSignatures.previewIds,
    unsupportedStates,
    blockers: blockers.map((blocker) => blocker.code),
  })}`;
  descriptor.stableSignatures.aggregate = descriptor.previewSignature;

  return descriptor;
}

export function buildRetouchSampleSource({
  doc,
  layer,
  layerSnapshot,
  sampleMode,
}: {
  doc: ImageDocument;
  layer: ImageLayer;
  layerSnapshot: LayerBitmap;
  sampleMode: RetouchSampleMode;
}): RetouchSampleSource {
  if (sampleMode === 'currentLayer') {
    return {
      bitmap: layerSnapshot,
      coordinateSpace: 'layer',
    };
  }

  const composite = createBitmap(doc.width, doc.height);
  const ctx = composite.getContext('2d');
  if (!ctx) {
    return {
      bitmap: layerSnapshot,
      coordinateSpace: 'layer',
    };
  }

  const activeIndex = doc.layers.findIndex((candidate) => candidate.id === layer.id);
  doc.layers.forEach((candidate, index) => {
    if (!candidate.visible) return;
    if (sampleMode === 'currentAndBelow' && activeIndex >= 0 && index > activeIndex) return;
    const bitmap = candidate.id === layer.id ? layerSnapshot : candidate.bitmap;
    if (!bitmap) return;
    ctx.save();
    ctx.globalAlpha = clamp01(candidate.opacity);
    ctx.globalCompositeOperation = candidate.blendMode as GlobalCompositeOperation;
    ctx.drawImage(bitmap, candidate.x, candidate.y);
    ctx.restore();
  });

  return {
    bitmap: composite,
    coordinateSpace: 'document',
  };
}

export function buildCloneStampOverlayDescriptor({
  doc: _doc,
  layer,
  sampleSource,
  sourceDocumentPoint,
  targetDocumentPoint,
  size,
}: {
  doc?: ImageDocument;
  layer: ImageLayer;
  sampleSource: RetouchSampleSource;
  sourceDocumentPoint: Point;
  targetDocumentPoint: Point;
  size: number;
}): CloneStampOverlayDescriptor {
  const placement = buildRetouchSourcePlacement({
    layer,
    sampleSource,
    sourceDocumentPoint,
    targetDocumentPoint,
  });

  return {
    ...placement,
    brushRadius: Math.max(0, (size - 1) / 2),
    diameter: size,
    translation: {
      x: targetDocumentPoint.x - sourceDocumentPoint.x,
      y: targetDocumentPoint.y - sourceDocumentPoint.y,
    },
  };
}

export function buildSpotHealPatchPlan({
  layer,
  sampleSource,
  sourceDocumentPoint,
  targetDocumentPoint,
  size,
}: {
  layer: ImageLayer;
  sampleSource: RetouchSampleSource;
  sourceDocumentPoint?: Point;
  targetDocumentPoint: Point;
  size: number;
}): SpotHealPatchPlan {
  const sourceCenter = sourceDocumentPoint ?? targetDocumentPoint;
  const brushRadius = Math.max(0, (size - 1) / 2);
  const integerBrushRadius = Math.ceil(brushRadius);

  return {
    ...buildRetouchSourcePlacement({
      layer,
      sampleSource,
      sourceDocumentPoint: sourceCenter,
      targetDocumentPoint,
    }),
    brushRadius,
    sampleRadius: Math.max(integerBrushRadius + 1, Math.ceil(size)),
  };
}

export function applyBlurBrushToImageData(
  imageData: ImageData,
  options: {
    targetPoint: Point;
    sourcePoint?: Point;
    size: number;
    strength: number;
    sourceImageData?: ImageData;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const source = options.sourceImageData ?? imageData;
  const brushRadius = Math.max(0, (options.size - 1) / 2);
  const integerBrushRadius = Math.ceil(brushRadius);
  const blurRadius = Math.max(1, Math.ceil(options.size));
  const strength = clamp01(options.strength);
  const targetCenterX = Math.round(options.targetPoint.x);
  const targetCenterY = Math.round(options.targetPoint.y);
  const sourceCenterX = Math.round(options.sourcePoint?.x ?? options.targetPoint.x);
  const sourceCenterY = Math.round(options.sourcePoint?.y ?? options.targetPoint.y);

  for (let y = -integerBrushRadius; y <= integerBrushRadius; y += 1) {
    for (let x = -integerBrushRadius; x <= integerBrushRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > brushRadius + 0.001) continue;

      const targetX = targetCenterX + x;
      const targetY = targetCenterY + y;
      if (!contains(imageData, targetX, targetY)) continue;

      const blurred = averagePixelsInRadius(source, sourceCenterX + x, sourceCenterY + y, blurRadius);
      if (!blurred) continue;

      const targetOffset = (targetY * output.width + targetX) * 4;
      output.data[targetOffset] = mixByte(imageData.data[targetOffset], blurred[0], strength);
      output.data[targetOffset + 1] = mixByte(imageData.data[targetOffset + 1], blurred[1], strength);
      output.data[targetOffset + 2] = mixByte(imageData.data[targetOffset + 2], blurred[2], strength);
      output.data[targetOffset + 3] = mixByte(imageData.data[targetOffset + 3], blurred[3], strength);
    }
  }

  return output;
}

export function applySharpenBrushToImageData(
  imageData: ImageData,
  options: {
    targetPoint: Point;
    sourcePoint?: Point;
    size: number;
    strength: number;
    sourceImageData?: ImageData;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const source = options.sourceImageData ?? imageData;
  const brushRadius = Math.max(0, (options.size - 1) / 2);
  const integerBrushRadius = Math.ceil(brushRadius);
  const blurRadius = Math.max(1, Math.ceil(options.size));
  const strength = clamp01(options.strength);
  const targetCenterX = Math.round(options.targetPoint.x);
  const targetCenterY = Math.round(options.targetPoint.y);
  const sourceCenterX = Math.round(options.sourcePoint?.x ?? options.targetPoint.x);
  const sourceCenterY = Math.round(options.sourcePoint?.y ?? options.targetPoint.y);

  for (let y = -integerBrushRadius; y <= integerBrushRadius; y += 1) {
    for (let x = -integerBrushRadius; x <= integerBrushRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > brushRadius + 0.001) continue;

      const targetX = targetCenterX + x;
      const targetY = targetCenterY + y;
      if (!contains(imageData, targetX, targetY)) continue;

      const blurred = averagePixelsInRadius(source, sourceCenterX + x, sourceCenterY + y, blurRadius);
      if (!blurred) continue;

      const targetOffset = (targetY * output.width + targetX) * 4;
      output.data[targetOffset] = sharpenByte(imageData.data[targetOffset], blurred[0], strength);
      output.data[targetOffset + 1] = sharpenByte(imageData.data[targetOffset + 1], blurred[1], strength);
      output.data[targetOffset + 2] = sharpenByte(imageData.data[targetOffset + 2], blurred[2], strength);
      output.data[targetOffset + 3] = imageData.data[targetOffset + 3];
    }
  }

  return output;
}

export function applySmudgeBrushToImageData(
  imageData: ImageData,
  options: {
    sourcePoint: Point;
    targetPoint: Point;
    size: number;
    strength: number;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const radius = Math.max(0, (options.size - 1) / 2);
  const integerRadius = Math.ceil(radius);
  const strength = clamp01(options.strength);
  const sourceCenterX = Math.round(options.sourcePoint.x);
  const sourceCenterY = Math.round(options.sourcePoint.y);
  const targetCenterX = Math.round(options.targetPoint.x);
  const targetCenterY = Math.round(options.targetPoint.y);

  for (let y = -integerRadius; y <= integerRadius; y += 1) {
    for (let x = -integerRadius; x <= integerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > radius + 0.001) continue;

      const sourceX = sourceCenterX + x;
      const sourceY = sourceCenterY + y;
      const targetX = targetCenterX + x;
      const targetY = targetCenterY + y;
      if (!contains(imageData, sourceX, sourceY) || !contains(imageData, targetX, targetY)) {
        continue;
      }

      const sourceOffset = (sourceY * imageData.width + sourceX) * 4;
      const targetOffset = (targetY * output.width + targetX) * 4;
      output.data[targetOffset] = mixByte(imageData.data[targetOffset], imageData.data[sourceOffset], strength);
      output.data[targetOffset + 1] = mixByte(imageData.data[targetOffset + 1], imageData.data[sourceOffset + 1], strength);
      output.data[targetOffset + 2] = mixByte(imageData.data[targetOffset + 2], imageData.data[sourceOffset + 2], strength);
      output.data[targetOffset + 3] = mixByte(imageData.data[targetOffset + 3], imageData.data[sourceOffset + 3], strength);
    }
  }

  return output;
}

export function applyToneBrushToImageData(
  imageData: ImageData,
  options: {
    mode: ToneBrushMode;
    targetPoint: Point;
    size: number;
    strength: number;
    toneRange?: ToneBrushRange;
    protectTones?: boolean;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const radius = Math.max(0, (options.size - 1) / 2);
  const integerRadius = Math.ceil(radius);
  const strength = clamp01(options.strength);
  const toneRange = options.toneRange ?? 'all';
  const protectTones = options.protectTones ?? false;
  const centerX = Math.round(options.targetPoint.x);
  const centerY = Math.round(options.targetPoint.y);

  for (let y = -integerRadius; y <= integerRadius; y += 1) {
    for (let x = -integerRadius; x <= integerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > radius + 0.001) continue;

      const targetX = centerX + x;
      const targetY = centerY + y;
      if (!contains(imageData, targetX, targetY)) continue;

      const offset = (targetY * output.width + targetX) * 4;
      const red = imageData.data[offset];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      const rangeWeight = toneRangeWeight(luminance(red, green, blue), toneRange);
      const effectiveStrength = clamp01(strength * rangeWeight);
      if (effectiveStrength <= 0) {
        output.data[offset] = red;
        output.data[offset + 1] = green;
        output.data[offset + 2] = blue;
        output.data[offset + 3] = imageData.data[offset + 3];
        continue;
      }

      const next = protectTones
        ? applyProtectedToneChannels(red, green, blue, options.mode, effectiveStrength)
        : [
            applyToneChannel(red, options.mode, effectiveStrength),
            applyToneChannel(green, options.mode, effectiveStrength),
            applyToneChannel(blue, options.mode, effectiveStrength),
          ];
      output.data[offset] = next[0];
      output.data[offset + 1] = next[1];
      output.data[offset + 2] = next[2];
      output.data[offset + 3] = imageData.data[offset + 3];
    }
  }

  return output;
}

export function applySpongeBrushToImageData(
  imageData: ImageData,
  options: {
    mode: SpongeBrushMode;
    targetPoint: Point;
    size: number;
    strength: number;
    vibrance?: number;
    preserveLuminosity?: boolean;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const radius = Math.max(0, (options.size - 1) / 2);
  const integerRadius = Math.ceil(radius);
  const strength = clamp01(options.strength);
  const vibrance = clamp01(options.vibrance ?? 0);
  const preserveLuminosity = options.preserveLuminosity ?? false;
  const centerX = Math.round(options.targetPoint.x);
  const centerY = Math.round(options.targetPoint.y);

  for (let y = -integerRadius; y <= integerRadius; y += 1) {
    for (let x = -integerRadius; x <= integerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance > radius + 0.001) continue;

      const targetX = centerX + x;
      const targetY = centerY + y;
      if (!contains(imageData, targetX, targetY)) continue;

      const offset = (targetY * output.width + targetX) * 4;
      const red = imageData.data[offset];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      const neutral = Math.round((red + green + blue) / 3);
      const effectiveStrength = spongeEffectiveStrength(red, green, blue, options.mode, strength, vibrance);
      const next = [
        applySpongeChannel(red, neutral, options.mode, effectiveStrength),
        applySpongeChannel(green, neutral, options.mode, effectiveStrength),
        applySpongeChannel(blue, neutral, options.mode, effectiveStrength),
      ] as [number, number, number];
      const corrected = preserveLuminosity
        ? preserveLuminance(red, green, blue, next)
        : next;

      output.data[offset] = corrected[0];
      output.data[offset + 1] = corrected[1];
      output.data[offset + 2] = corrected[2];
      output.data[offset + 3] = imageData.data[offset + 3];
    }
  }

  return output;
}

function applySpongeChannel(
  value: number,
  neutral: number,
  mode: SpongeBrushMode,
  strength: number,
): number {
  if (mode === 'desaturate') {
    return mixByte(value, neutral, strength);
  }
  return clampByte(Math.round(neutral + (value - neutral) * (1 + strength)));
}

function spongeEffectiveStrength(
  red: number,
  green: number,
  blue: number,
  mode: SpongeBrushMode,
  strength: number,
  vibrance: number,
): number {
  if (vibrance <= 0) return strength;
  const saturation = colorSeparation(red, green, blue);
  const vibranceWeight = mode === 'saturate'
    ? Math.max(0, 1 - saturation) ** 2
    : Math.max(0, saturation);
  return clamp01(strength * mixNumber(1, vibranceWeight, vibrance));
}

function colorSeparation(red: number, green: number, blue: number): number {
  return (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
}

function preserveLuminance(
  originalRed: number,
  originalGreen: number,
  originalBlue: number,
  next: [number, number, number],
): [number, number, number] {
  const correction = luminance(originalRed, originalGreen, originalBlue) - luminance(next[0], next[1], next[2]);
  return [
    clampByte(Math.round(next[0] + correction)),
    clampByte(Math.round(next[1] + correction)),
    clampByte(Math.round(next[2] + correction)),
  ];
}

function toneRangeWeight(luma: number, range: ToneBrushRange): number {
  switch (range) {
    case 'all':
      return 1;
    case 'shadows':
      return 1 - smoothstep(80, 120, luma);
    case 'midtones':
      return smoothstep(48, 96, luma) * (1 - smoothstep(160, 208, luma));
    case 'highlights':
      return smoothstep(176, 216, luma);
  }
}

function applyProtectedToneChannels(
  red: number,
  green: number,
  blue: number,
  mode: ToneBrushMode,
  strength: number,
): [number, number, number] {
  const originalLuma = luminance(red, green, blue);
  const targetLuma = mode === 'dodge'
    ? mixNumber(originalLuma, 255, strength)
    : mixNumber(originalLuma, 0, strength);
  if (originalLuma <= 0.001) {
    const fallback = clampByte(Math.round(targetLuma));
    return [fallback, fallback, fallback];
  }

  const scale = targetLuma / originalLuma;
  return [
    clampByte(Math.round(red * scale)),
    clampByte(Math.round(green * scale)),
    clampByte(Math.round(blue * scale)),
  ];
}

function luminance(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mixNumber(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function buildRetouchSampleRoutingChecks(): RetouchSampleRoutingCheck[] {
  return (['currentLayer', 'currentAndBelow', 'allLayers'] as RetouchSampleMode[]).map((mode) => {
    const coordinateSpace = retouchSampleCoordinateSpace(mode);
    const cloneSource = retouchSampleBitmapSource(mode);
    const healSource = retouchSampleBitmapSource(mode);
    const blurSharpenSource = samplingSourceForRetouchBrushTool('blur', mode);
    const smudgeSource = samplingSourceForRetouchBrushTool('smudge', mode);

    return {
      mode,
      coordinateSpace,
      cloneStamp: {
        status: 'supported',
        source: cloneSource,
        requiresSamplePoint: true,
        signature: buildRetouchSampleRoutingSignature({
          mode,
          tool: 'cloneStamp',
          source: cloneSource,
          coordinateSpace,
          requiresSamplePoint: true,
        }),
      },
      spotHeal: {
        status: 'supported',
        source: healSource,
        requiresSamplePoint: false,
        signature: buildRetouchSampleRoutingSignature({
          mode,
          tool: 'spotHeal',
          source: healSource,
          coordinateSpace,
          requiresSamplePoint: false,
        }),
      },
      blurSharpenBrush: {
        status: 'supported',
        tools: ['blur', 'sharpen'],
        source: blurSharpenSource,
        requiresSamplePoint: false,
        signature: buildRetouchSampleRoutingSignature({
          mode,
          tool: 'blurSharpenBrush',
          source: blurSharpenSource,
          coordinateSpace,
          requiresSamplePoint: false,
        }),
      },
      smudge: {
        status: 'supported',
        requested: mode,
        applied: mode,
        source: smudgeSource === 'previous-stroke-point-live-composite'
          ? smudgeSource
          : 'previous-stroke-point-current-layer',
        blocker: null,
        signature: buildRetouchSmudgeSampleRoutingSignature({
          mode,
          applied: mode,
          source: smudgeSource === 'previous-stroke-point-live-composite'
            ? smudgeSource
            : 'previous-stroke-point-current-layer',
          status: 'supported',
          blocker: null,
        }),
      },
    };
  });
}

function buildRetouchSampleRoutingSignature({
  mode,
  tool,
  source,
  coordinateSpace,
  requiresSamplePoint,
}: {
  mode: RetouchSampleMode;
  tool: RetouchSampleRoutingTool;
  source: RetouchSampleRoutingToolCheck['source'];
  coordinateSpace: RetouchSampleSource['coordinateSpace'];
  requiresSamplePoint: boolean;
}): string {
  return `retouch-sample-routing:v1:${JSON.stringify({
    mode,
    tool,
    source,
    coordinateSpace,
    requiresSamplePoint,
  })}`;
}

function buildRetouchSmudgeSampleRoutingSignature({
  mode,
  applied,
  source,
  status,
  blocker,
}: {
  mode: RetouchSampleMode;
  applied: RetouchSampleMode;
  source: RetouchSmudgeRoutingCheck['source'];
  status: RetouchSmudgeRoutingCheck['status'];
  blocker: RetouchSmudgeRoutingCheck['blocker'];
}): string {
  return `retouch-smudge-sample-routing:v1:${JSON.stringify({
    mode,
    applied,
    status,
    source,
    blocker,
  })}`;
}

function buildRetouchSampleRoutingMatrixSignature(sampleRouting: RetouchSampleRoutingCheck[]): string {
  return `retouch-sample-routing-matrix:v1:${JSON.stringify({
    modes: sampleRouting.map((route) => route.mode),
    cloneStamp: sampleRouting.map((route) => route.cloneStamp.source),
    spotHeal: sampleRouting.map((route) => route.spotHeal.source),
    blurSharpen: sampleRouting.map((route) => route.blurSharpenBrush.source),
    smudge: sampleRouting.map((route) => route.smudge.status),
  })}`;
}

function buildRetouchCloneSourceParityChecks(): RetouchCloneSourceParityChecks {
  const overlay = {
    checkId: 'clone-source-overlay',
    status: 'unsupported',
    fallback: 'target-brush-cursor-only',
    blocker: 'clone-source-overlay-unsupported',
    caveat: 'Live source crosshair/ghost overlay is not rendered while cloning.',
    signature: `retouch-clone-source-check:v1:${JSON.stringify({
      checkId: 'clone-source-overlay',
      status: 'unsupported',
      fallback: 'target-brush-cursor-only',
      blocker: 'clone-source-overlay-unsupported',
    })}`,
  } satisfies RetouchCloneSourceParityChecks['overlay'];
  const requestedTransforms: RetouchCloneSourceTransform[] = ['scale', 'rotation', 'flip', 'offset'];
  const transform = {
    checkId: 'clone-source-transform',
    status: 'unsupported',
    requestedTransforms,
    supportedTransforms: [],
    blocker: 'clone-source-transform-unsupported',
    caveat: 'Clone source scale, rotation, flip, and offset transform controls are not implemented.',
    signature: `retouch-clone-source-check:v1:${JSON.stringify({
      checkId: 'clone-source-transform',
      status: 'unsupported',
      requestedTransforms,
      supportedTransforms: [],
      blocker: 'clone-source-transform-unsupported',
    })}`,
  } satisfies RetouchCloneSourceParityChecks['transform'];

  return {
    overlay,
    transform,
  };
}

function buildRetouchCloneSourceChecksSignature(cloneSource: RetouchCloneSourceParityChecks): string {
  return `retouch-clone-source-checks:v1:${JSON.stringify({
    overlay: cloneSource.overlay.signature,
    transform: cloneSource.transform.signature,
  })}`;
}

function buildRetouchRepairOutputParityChecks(output: RetouchWorkflowOutputMode): RetouchRepairOutputParityChecks {
  const unsupportedSteps: SpotHealWorkflowDescriptor['patchWorkflow']['unsupportedSteps'] = [
    'lasso-patch-source-drag',
    'patch-transform',
    'destination-mode',
    'transparent-mode',
  ];
  const patch = {
    checkId: 'patch-source-workflow',
    status: 'unsupported',
    supportedRoute: 'paint-local-repair',
    unsupportedSteps,
    blocker: 'patch-workflow-unsupported',
    caveat: 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.',
    signature: `retouch-repair-output-check:v1:${JSON.stringify({
      checkId: 'patch-source-workflow',
      status: 'unsupported',
      blocker: 'patch-workflow-unsupported',
      unsupportedSteps,
    })}`,
  } satisfies RetouchRepairOutputParityChecks['patch'];
  const remove = {
    checkId: 'remove-tool-workflow',
    status: 'unsupported',
    localFallback: 'local-alpha-remove-from-content-aware-plan',
    blocker: 'content-aware-remove-unsupported',
    caveat: 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.',
    signature: `retouch-repair-output-check:v1:${JSON.stringify({
      checkId: 'remove-tool-workflow',
      status: 'unsupported',
      blocker: 'content-aware-remove-unsupported',
      localFallback: 'local-alpha-remove-from-content-aware-plan',
    })}`,
  } satisfies RetouchRepairOutputParityChecks['remove'];
  const newLayerOutput = {
    checkId: 'retouch-new-layer-output',
    requested: output === 'newLayer',
    status: 'unsupported',
    applied: 'activeLayer',
    blocker: 'new-layer-output-unsupported',
    caveat: 'Retouch tools commit undoable pixels to the active layer; new clone/heal/repair output layers are not generated.',
    signature: `retouch-repair-output-check:v1:${JSON.stringify({
      checkId: 'retouch-new-layer-output',
      requested: output === 'newLayer',
      status: 'unsupported',
      applied: 'activeLayer',
      blocker: 'new-layer-output-unsupported',
    })}`,
  } satisfies RetouchRepairOutputParityChecks['newLayerOutput'];

  return {
    patch,
    remove,
    newLayerOutput,
  };
}

function buildRetouchRepairOutputChecksSignature(repairOutput: RetouchRepairOutputParityChecks): string {
  return `retouch-repair-output-checks:v1:${JSON.stringify({
    patch: repairOutput.patch.signature,
    remove: repairOutput.remove.signature,
    newLayerOutput: repairOutput.newLayerOutput.signature,
  })}`;
}

function buildRetouchNonDestructiveOutputPlan(output: RetouchWorkflowOutputMode): RetouchNonDestructiveOutputPlan {
  return {
    checkId: 'non-destructive-retouch-output-plan',
    requested: output,
    supported: false,
    applied: 'activeLayer',
    plan: 'undo-snapshot-active-layer-mutation',
    editableRetouchLayer: false,
    requiredForParity: ['clone-stamp-empty-retouch-layer', 'heal-sample-all-layers-on-new-layer', 'editable-retouch-replay'],
    sourceBinResult: 'flattened-active-layer-retouch',
    blocker: 'non-destructive-retouch-output-unsupported',
    caveats: [
      'Undo snapshots preserve rollback, but retouch strokes are not editable after commit.',
      'Sample-all/current-and-below sources are local document snapshots and are not replayable from Source Bin assets.',
      'A parity-complete plan needs editable retouch output layers before downstream handoff can preserve clone/heal state.',
    ],
    signature: `retouch-non-destructive-output-plan:v1:${JSON.stringify({
      requested: output,
      supported: false,
      applied: 'activeLayer',
      plan: 'undo-snapshot-active-layer-mutation',
      editableRetouchLayer: false,
      sourceBinResult: 'flattened-active-layer-retouch',
      blocker: 'non-destructive-retouch-output-unsupported',
    })}`,
  };
}

function buildRetouchSmudgeCompositeSamplingCheck(
  requested: RetouchBrushSampleMode,
): RetouchSmudgeCompositeSamplingCheck {
  const applied = appliedSampleModeForRetouchBrushTool('smudge', requested);

  return {
    checkId: 'smudge-composite-sampling',
    requested,
    applied,
    compositeSamplingSupported: true,
    blockedModes: [],
    blocker: null,
    caveat: 'Smudge composite sampling uses bounded live composite resampling between drag dabs.',
    signature: `retouch-smudge-composite-sampling:v1:${JSON.stringify({
      requested,
      applied,
      compositeSamplingSupported: true,
      blockedModes: [],
      blocker: null,
    })}`,
  };
}

function buildRetouchBrushWarnings({
  tool,
  sampleMode,
  blendMode,
  channel,
  output,
}: {
  tool: RetouchBrushToolKind;
  sampleMode: RetouchBrushSampleMode;
  blendMode: string;
  channel: string;
  output: RetouchBrushOutputMode;
}): RetouchBrushWarning[] {
  const warnings: RetouchBrushWarning[] = [];
  if (sampleMode !== 'currentLayer' && !retouchBrushSupportsCompositeSampling(tool)) {
    warnings.push({
      code: 'sample-mode-current-layer-only',
      message: `${labelForRetouchBrushTool(tool)} currently edits only the active pixel layer; ${sampleMode} sampling is not available for this brush.`,
    });
  }
  if (blendMode !== 'normal') {
    warnings.push({
      code: 'blend-mode-unsupported',
      message: 'Retouch brush blend modes are metadata only; strokes are applied with normal pixel replacement math.',
    });
  }
  if (channel !== 'rgb') {
    warnings.push({
      code: 'channel-target-unsupported',
      message: 'Retouch brush channel targeting is not implemented; RGB channels are edited together.',
    });
  }
  if (output !== 'activeLayer') {
    if (!retouchBrushSupportsNewLayerOutput(tool)) {
      warnings.push({
        code: 'new-layer-output-unsupported',
        message: 'Retouch brush output to a new layer is not implemented for this brush; strokes mutate the active layer.',
      });
    }
  }
  return warnings;
}

function retouchBrushSupportsNewLayerOutput(tool: RetouchBrushToolKind): boolean {
  return tool === 'dodge' || tool === 'burn' || tool === 'sponge';
}

function buildRetouchWorkflowReadinessBlockers({
  clone,
  heal,
  output,
}: {
  clone: CloneStampWorkflowDescriptor;
  heal: SpotHealWorkflowDescriptor;
  output: RetouchWorkflowOutputMode;
}): RetouchWorkflowReadinessBlocker[] {
  const blockers: RetouchWorkflowReadinessBlocker[] = [];
  if (clone.sampleSource.readiness === 'needs-sample-point') {
    blockers.push({
      code: 'sample-source-required',
      message: 'Clone Stamp requires an Alt/Option sample point before painting.',
    });
  }
  blockers.push(
    {
      code: 'clone-source-overlay-unsupported',
      message: clone.liveCloneSourceOverlay.warning,
    },
    {
      code: 'clone-source-transform-unsupported',
      message: clone.cloneSourceTransform.warning,
    },
    {
      code: 'patch-workflow-unsupported',
      message: heal.patchWorkflow.warning,
    },
    {
      code: 'content-aware-remove-unsupported',
      message: heal.removeWorkflow.warning,
    },
  );
  if (output !== 'activeLayer') {
    blockers.push({
      code: 'non-destructive-retouch-output-unsupported',
      message: 'Retouch workflows write undoable destructive pixels to the active layer; editable non-destructive retouch output layers are not supported.',
    });
  }
  return blockers;
}

function buildTonalRangeReadinessSummary(): TonalSaturationBrushReadinessDescriptor['tonalRanges'] {
  return [
    {
      range: 'all',
      label: 'All tones',
      luminanceGate: 'full-luminance-pass',
    },
    {
      range: 'shadows',
      label: 'Shadows',
      luminanceGate: 'weighted-below-120-luma',
    },
    {
      range: 'midtones',
      label: 'Midtones',
      luminanceGate: 'weighted-48-to-208-luma',
    },
    {
      range: 'highlights',
      label: 'Highlights',
      luminanceGate: 'weighted-above-176-luma',
    },
  ];
}

function buildRetouchToolImplementedStates(tool: RetouchReadinessToolKind): string[] {
  const common = [
    'undoable-active-pixel-layer-strokes',
    tool === 'blur' || tool === 'sharpen' ? 'brush-size-strength-controls' : 'brush-size-opacity-controls',
    'current-layer-sampling',
    'current-and-below-composite-sampling',
    'all-layers-composite-sampling',
  ];
  switch (tool) {
    case 'cloneStamp':
      return [...common, 'aligned-or-restart-source-offset'];
    case 'spotHeal':
      return [...common, 'paint-local-repair-from-surrounding-samples'];
    case 'blur':
      return [...common, 'local-average-softening'];
    case 'sharpen':
      return [...common, 'local-contrast-sharpening'];
  }
}

function buildRetouchToolUnsupportedStates(tool: RetouchReadinessToolKind): string[] {
  const common = [
    'editable-non-destructive-retouch-layer',
    'layer-mask-retouch-routing',
    'single-channel-retouch-routing',
    'batch-retouch-without-recorded-inputs',
  ];
  switch (tool) {
    case 'cloneStamp':
      return [...common, 'clone-source-overlay', 'clone-source-transform'];
    case 'spotHeal':
      return [...common, 'patch-source-drag', 'content-aware-remove-tool'];
    case 'blur':
    case 'sharpen':
      return common;
  }
}

function supportedStatesForRetouchRouteTool(tool: RetouchLocalRouteTool): string[] {
  const common = [
    'pointer-brush-strokes',
    'undoable-active-layer-pixel-output',
    'current-layer-sampling',
    'current-and-below-composite-sampling',
    'all-layers-composite-sampling',
  ];
  if (tool === 'cloneStamp') return [...common, 'aligned-or-restart-source-offset'];
  if (tool === 'spotHeal') return [...common, 'paint-local-repair-from-surrounding-samples'];
  if (tool === 'blur') return [...common, 'local-average-softening'];
  if (tool === 'sharpen') return [...common, 'local-contrast-sharpening'];
  return [...common, 'bounded-stroke-start-composite-smudge-sampling'];
}

function unsupportedStatesForRetouchRouteTool(tool: RetouchLocalRouteTool): string[] {
  const common = [
    'editable-non-destructive-retouch-layer',
    'layer-mask-retouch-routing',
    'single-channel-retouch-routing',
  ];
  if (tool === 'cloneStamp') {
    return [
      ...common,
      'clone-source-overlay',
      'clone-source-transform',
      'perspective-clone',
      'advanced-healing-ai',
      'patch-remove-dedicated-ui',
    ];
  }
  if (tool === 'spotHeal') {
    return [
      ...common,
      'patch-source-drag',
      'content-aware-remove-tool',
      'advanced-healing-ai',
      'patch-remove-dedicated-ui',
    ];
  }
  if (tool === 'smudge') {
    return [
      ...common,
      'finger-paint-start-color',
      'editable-non-destructive-smudge-layer',
    ];
  }
  return common;
}

function buildRetouchLocalOutputUnsupportedStates(): RetouchUnsupportedLocalOutputState[] {
  return [
    'editable-non-destructive-retouch-layer',
    'clone-source-overlay',
    'clone-source-transform',
    'perspective-clone',
    'advanced-healing-ai',
    'patch-remove-dedicated-ui',
  ];
}

function controlsForRetouchReadinessTool(tool: RetouchReadinessToolKind): string[] {
  switch (tool) {
    case 'cloneStamp':
      return ['size', 'opacity', 'sampleMode', 'aligned'];
    case 'spotHeal':
      return ['size', 'opacity', 'sampleMode'];
    case 'blur':
    case 'sharpen':
      return ['size', 'strength', 'sampleMode'];
  }
}

function batchActionReasonForRetouchReadinessTool(tool: RetouchReadinessToolKind): string {
  switch (tool) {
    case 'cloneStamp':
      return 'Clone Stamp batch playback is unsafe without a recorded sample point and pointer path.';
    case 'spotHeal':
      return 'Spot Heal batch playback requires a recorded pointer path because repairs depend on local image content.';
    case 'blur':
      return 'Blur brush batch playback requires a recorded pointer path and source sampling mode.';
    case 'sharpen':
      return 'Sharpen brush batch playback requires a recorded pointer path and source sampling mode.';
  }
}

function labelForRetouchReadinessTool(tool: RetouchReadinessToolKind): string {
  switch (tool) {
    case 'cloneStamp':
      return 'Clone Stamp';
    case 'spotHeal':
      return 'Spot Heal';
    case 'blur':
      return 'Blur brush';
    case 'sharpen':
      return 'Sharpen brush';
  }
}

function buildRetouchBrushDynamicsDescriptor({
  tool,
  size,
  softness,
}: {
  tool: RetouchBrushToolKind;
  size: number;
  softness: number;
}): RetouchBrushPlanDescriptor['dynamics'] {
  const spacingPx = Math.max(1, Math.round(size / 3));
  return {
    supportsPressure: false,
    supportsTilt: false,
    supportsFlow: false,
    supportsAirbrushAccumulation: false,
    spacingPx,
    hardnessControl: 'softness-only',
    signature: `retouch-brush-dynamics:v1:${JSON.stringify({
      tool,
      size,
      softness,
      spacingPx,
      pressure: false,
      tilt: false,
      flow: false,
      airbrushAccumulation: false,
    })}`,
  };
}

function buildRetouchBrushPresetRouting(
  tool: RetouchBrushToolKind,
): RetouchBrushPlanDescriptor['presetRouting'] {
  const recommendedCategories = recommendedPresetCategoriesForRetouchTool(tool);
  const recommendedPresetIds = recommendedPresetIdsForRetouchTool(tool);
  const incompatiblePresetCategories: Array<'eraser'> = ['eraser'];

  return {
    recommendedCategories,
    recommendedPresetIds,
    incompatiblePresetCategories,
    signature: `retouch-brush-preset-routing:v1:${JSON.stringify({
      tool,
      categories: recommendedCategories,
      presetIds: recommendedPresetIds,
      incompatible: incompatiblePresetCategories,
    })}`,
  };
}

function recommendedPresetCategoriesForRetouchTool(
  tool: RetouchBrushToolKind,
): RetouchBrushPlanDescriptor['presetRouting']['recommendedCategories'] {
  switch (tool) {
    case 'blur':
    case 'sharpen':
      return ['soft-round', 'airbrush', 'smudge-retouch'];
    case 'smudge':
      return ['smudge-retouch', 'soft-round', 'airbrush'];
    case 'dodge':
    case 'burn':
    case 'sponge':
      return ['airbrush', 'soft-round', 'smudge-retouch'];
  }
}

function recommendedPresetIdsForRetouchTool(tool: RetouchBrushToolKind): string[] {
  switch (tool) {
    case 'blur':
    case 'sharpen':
      return ['softRound', 'airbrush', 'textureStipple', 'watercolorWash'];
    case 'smudge':
      return ['watercolorWash', 'textureStipple', 'softRound', 'airbrush'];
    case 'dodge':
    case 'burn':
    case 'sponge':
      return ['airbrush', 'softRound', 'watercolorWash', 'textureStipple'];
  }
}

function buildRetouchActionSignature({
  tool,
  sampleMode,
  aligned,
  output,
  requiresSamplePoint,
}: {
  tool: RetouchReadinessToolKind;
  sampleMode: RetouchSampleMode;
  aligned: boolean;
  output: RetouchWorkflowOutputMode;
  requiresSamplePoint: boolean;
}): string {
  return `image-retouch-action-readiness:v1:${JSON.stringify({
    tool,
    sampleMode,
    aligned,
    output,
    recordable: true,
    requiresSamplePoint,
  })}`;
}

function buildRetouchBatchSignature({
  tool,
  sampleMode,
  aligned,
  requiresSamplePoint,
}: {
  tool: RetouchReadinessToolKind;
  sampleMode: RetouchSampleMode;
  aligned: boolean;
  requiresSamplePoint: boolean;
}): string {
  return `image-retouch-batch-readiness:v1:${JSON.stringify({
    tool,
    sampleMode,
    aligned,
    requiresPointerPath: true,
    requiresSamplePoint,
    suitable: false,
  })}`;
}

function buildRetouchSourceBinHandoffDescriptor({
  tool,
  sampleMode,
  output,
}: {
  tool: RetouchReadinessToolKind;
  sampleMode: RetouchSampleMode;
  output: RetouchWorkflowOutputMode;
}): RetouchToolReadinessDescriptor['sourceBinHandoff'] {
  const warningCodes = [
    'flattened-retouch-only',
    'snapshot-sampling-not-replayable',
    'non-destructive-output-unavailable',
  ] as const;

  return {
    supported: false,
    target: 'source-bin',
    result: 'flattened-active-layer-retouch',
    warnings: [
      'Source Bin handoff can only package flattened retouched pixels; editable clone/heal state is not preserved.',
      'Sample-all/current-and-below retouch sources stay local to the Image document snapshot and are not replayable from Source Bin assets.',
      'Non-destructive retouch output layers are unavailable, so reopen/edit handoff depends on the mutated source layer pixels.',
    ],
    signature: `image-retouch-source-bin-handoff:v1:${JSON.stringify({
      tool,
      sampleMode,
      output,
      supported: false,
      result: 'flattened-active-layer-retouch',
      warnings: warningCodes,
    })}`,
  };
}

function retouchBrushSupportsCompositeSampling(tool: RetouchBrushToolKind): boolean {
  return tool === 'blur' || tool === 'sharpen' || tool === 'smudge';
}

function appliedSampleModeForRetouchBrushTool(
  tool: RetouchBrushToolKind,
  requestedSampleMode: RetouchBrushSampleMode,
): RetouchBrushSampleMode {
  return retouchBrushSupportsCompositeSampling(tool) ? requestedSampleMode : 'currentLayer';
}

function normalizeRetouchWorkflowBrush(size: number, opacity: number): CloneStampWorkflowDescriptor['brush'] {
  const brushSize = Math.max(1, Math.round(Number.isFinite(size) ? size : 1));
  return {
    size: brushSize,
    radius: Math.max(0, (brushSize - 1) / 2),
    opacity: clamp01(opacity),
  };
}

function retouchSampleCoordinateSpace(sampleMode: RetouchSampleMode): RetouchSampleSource['coordinateSpace'] {
  return sampleMode === 'currentLayer' ? 'layer' : 'document';
}

function retouchSampleBitmapSource(
  sampleMode: RetouchSampleMode,
): CloneStampWorkflowDescriptor['sampleSource']['sourceBitmapWhenReady'] {
  if (sampleMode === 'currentLayer') return 'active-layer-snapshot-at-stroke-start';
  if (sampleMode === 'currentAndBelow') return 'visible-current-and-below-composite-at-stroke-start';
  return 'visible-all-layers-composite-at-stroke-start';
}

function labelForRetouchBrushTool(tool: RetouchBrushToolKind): string {
  switch (tool) {
    case 'blur':
      return 'Blur brush';
    case 'sharpen':
      return 'Sharpen brush';
    case 'smudge':
      return 'Smudge brush';
    case 'dodge':
      return 'Dodge brush';
    case 'burn':
      return 'Burn brush';
    case 'sponge':
      return 'Sponge brush';
  }
}

function operationForRetouchBrushTool(tool: RetouchBrushToolKind, mode?: SpongeBrushMode): string {
  switch (tool) {
    case 'blur':
      return 'soften-local-detail';
    case 'sharpen':
      return 'increase-local-contrast';
    case 'smudge':
      return 'drag-current-layer-pixels';
    case 'dodge':
      return 'lighten-local-tones';
    case 'burn':
      return 'darken-local-tones';
    case 'sponge':
      return mode === 'desaturate' ? 'reduce-local-saturation' : 'increase-local-saturation';
  }
}

function adjustmentParameterForRetouchBrushTool(tool: RetouchBrushToolKind): RetouchBrushAdjustmentParameter {
  if (tool === 'dodge' || tool === 'burn') return 'exposure';
  if (tool === 'sponge') return 'saturation';
  return 'strength';
}

function adjustmentBehaviorForRetouchBrushTool(tool: RetouchBrushToolKind, mode?: SpongeBrushMode): string {
  switch (tool) {
    case 'blur':
      return 'Mixes the current-layer starting pixels toward a local average inside the brush footprint.';
    case 'sharpen':
      return 'Adds local contrast by pushing RGB channels away from a local average.';
    case 'smudge':
      return 'Mixes pixels from the previous stroke point into the current brush footprint.';
    case 'dodge':
      return 'Dodge raises luminance inside the selected tonal range, with optional protected-tone scaling to limit color clipping.';
    case 'burn':
      return 'Burn lowers luminance inside the selected tonal range, with optional protected-tone scaling to limit color clipping.';
    case 'sponge':
      return mode === 'desaturate'
        ? 'Sponge desaturate reduces channel separation, with optional vibrance weighting and luminance preservation.'
        : 'Sponge saturate increases channel separation, with optional vibrance weighting and luminance preservation.';
  }
}

function samplingSourceForRetouchBrushTool(
  tool: RetouchBrushToolKind,
  sampleMode: RetouchBrushSampleMode,
): RetouchBrushPlanDescriptor['sampling']['source'] {
  if (tool === 'blur' || tool === 'sharpen') {
    if (sampleMode === 'allLayers') return 'visible-all-layers-stroke-snapshot';
    if (sampleMode === 'currentAndBelow') return 'visible-current-and-below-stroke-snapshot';
    return 'current-layer-stroke-snapshot';
  }
  if (tool === 'smudge') {
    return sampleMode === 'currentLayer'
      ? 'previous-stroke-point-current-layer'
      : 'previous-stroke-point-live-composite';
  }
  return 'active-layer-pixels';
}

function buildRetouchSourcePlacement({
  layer,
  sampleSource,
  sourceDocumentPoint,
  targetDocumentPoint,
}: {
  layer: ImageLayer;
  sampleSource: RetouchSampleSource;
  sourceDocumentPoint: Point;
  targetDocumentPoint: Point;
}): RetouchSourcePlacement {
  return {
    coordinateSpace: sampleSource.coordinateSpace,
    sourceBitmapCenter: resolveRetouchSourceBitmapPoint(sampleSource.coordinateSpace, layer, sourceDocumentPoint),
    sourceDocumentCenter: sourceDocumentPoint,
    targetBitmapCenter: {
      x: targetDocumentPoint.x - layer.x,
      y: targetDocumentPoint.y - layer.y,
    },
    targetDocumentCenter: targetDocumentPoint,
  };
}

function resolveRetouchSourceBitmapPoint(
  coordinateSpace: RetouchSampleSource['coordinateSpace'],
  layer: ImageLayer,
  documentPoint: Point,
): Point {
  if (coordinateSpace === 'document') {
    return documentPoint;
  }

  return {
    x: documentPoint.x - layer.x,
    y: documentPoint.y - layer.y,
  };
}

function applyToneChannel(value: number, mode: ToneBrushMode, strength: number): number {
  return mode === 'dodge'
    ? mixByte(value, 255, strength)
    : mixByte(value, 0, strength);
}

function sharpenByte(value: number, blurred: number, strength: number): number {
  return clampByte(Math.round(value + (value - blurred) * strength));
}

function averagePixelsInRadius(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
): [number, number, number, number] | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.sqrt(x * x + y * y) > radius + 0.001) continue;

      const sourceX = centerX + x;
      const sourceY = centerY + y;
      if (!contains(imageData, sourceX, sourceY)) continue;

      const offset = (sourceY * imageData.width + sourceX) * 4;
      red += imageData.data[offset];
      green += imageData.data[offset + 1];
      blue += imageData.data[offset + 2];
      alpha += imageData.data[offset + 3];
      count += 1;
    }
  }

  if (count === 0) return null;
  return [
    Math.round(red / count),
    Math.round(green / count),
    Math.round(blue / count),
    Math.round(alpha / count),
  ];
}

function averageSurroundingPixels(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  innerRadius: number,
  outerRadius: number,
): [number, number, number, number] | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;

  for (let y = -outerRadius; y <= outerRadius; y += 1) {
    for (let x = -outerRadius; x <= outerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= innerRadius + 0.001 || distance > outerRadius + 0.001) continue;

      const sourceX = centerX + x;
      const sourceY = centerY + y;
      if (!contains(imageData, sourceX, sourceY)) continue;

      const offset = (sourceY * imageData.width + sourceX) * 4;
      if (imageData.data[offset + 3] <= 0) continue;

      red += imageData.data[offset];
      green += imageData.data[offset + 1];
      blue += imageData.data[offset + 2];
      alpha += imageData.data[offset + 3];
      count += 1;
    }
  }

  if (count === 0) return null;
  return [
    Math.round(red / count),
    Math.round(green / count),
    Math.round(blue / count),
    Math.round(alpha / count),
  ];
}

function contains(imageData: ImageData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < imageData.width && y < imageData.height;
}

function cloneImageData(imageData: ImageData): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  if (typeof ImageData !== 'undefined') {
    try {
      return new ImageData(data, imageData.width, imageData.height);
    } catch {
      // Some test environments expose an incomplete ImageData constructor.
    }
  }
  return { width: imageData.width, height: imageData.height, data } as ImageData;
}

function mixByte(before: number, after: number, amount: number): number {
  return Math.round(before + (after - before) * amount);
}

function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
