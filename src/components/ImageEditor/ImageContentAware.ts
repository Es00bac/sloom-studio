import type { SelectionMask } from './SelectionMask';

export const LOCAL_CONTENT_AWARE_APPROXIMATION_WARNING =
  'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.';

export type LocalContentAwarePatchTargetKind = 'selection' | 'transparent-pixels';
export type LocalContentAwarePatchOutputTarget = 'active-layer' | 'new-layer';
export type LocalContentAwareRequestedOutputTarget = LocalContentAwarePatchOutputTarget;
export type LocalContentAwareRepairOperation = 'fill' | 'remove' | 'patch';

export interface LocalContentAwareBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocalContentAwarePatchWarning {
  code: 'local-approximation' | 'ai-vs-local-approximation';
  severity: 'warning';
  message: string;
}

export interface LocalContentAwareTargetPolicy {
  mode: LocalContentAwarePatchTargetKind;
  selectionRequired: boolean;
  transparentFallback: boolean;
  description: string;
}

export interface LocalContentAwareOutputLimitation {
  code: 'local-active-layer-source';
  supported: true;
  description: string;
}

export interface LocalContentAwareUnsupportedControls {
  samplingAreaPreview: {
    supported: true;
    reason: string;
  };
  patchSourceControl: {
    supported: true;
    reason: string;
  };
}

export interface LocalContentAwareSamplingAreaPolicy {
  mode: 'auto-nearby-non-target' | 'manual-source-bounds';
  editable: boolean;
  excludesTargetPixels: true;
  excludesTransparentPixels: true;
  maxSampleRadius: number;
  description: string;
}

export interface LocalContentAwarePatchSourceStatus {
  mode: 'automatic-nearest-surrounding' | 'manual-source-bounds';
  userControllable: boolean;
  status: 'ready' | 'empty-target' | 'no-source-pixels';
  sourceBounds: LocalContentAwareBounds | null;
  sampledPixels: number;
  description: string;
}

export interface LocalContentAwareOutputToNewLayerStatus {
  supported: true;
  defaultEnabled: false;
  reason: string;
}

export interface LocalContentAwareTargetSummary {
  kind: LocalContentAwarePatchTargetKind;
  label: string;
  targetPixels: number;
  bounds: LocalContentAwareBounds | null;
  requiresSelection: boolean;
  usesTransparentFallback: boolean;
}

export interface LocalContentAwareLocalAiLimitation {
  localEngine: 'deterministic-pixel-patch';
  aiEquivalent: 'Photoshop Content-Aware Fill / Generative Fill';
  severity: 'warning';
  message: string;
}

export interface LocalContentAwarePreviewDescriptor {
  id: string;
  signature: string;
  signatureFields: readonly string[];
}

export interface LocalContentAwareCommandCapability {
  command: 'content-aware-fill' | 'content-aware-remove' | 'patch';
  engine: 'local-deterministic-pixel-repair';
  supportsSelectionTarget: true;
  supportsTransparentPixelTarget: true;
  supportsOutputToNewLayer: true;
  supportsManualPatchSource: true;
  supportsEditableSamplingArea: true;
  supportsAiSemanticSynthesis: false;
}

export interface LocalContentAwarePatchSourceLimits {
  sourceMode: 'automatic-nearby-layer-pixels' | 'manual-active-layer-bounds';
  maxSampleRadius: number;
  supportsManualSource: true;
  supportsCrossLayerSampling: false;
  description: string;
}

export interface LocalContentAwareOutputLimits {
  outputTarget: LocalContentAwarePatchOutputTarget;
  supportsNewLayer: true;
  supportsSourceBinDirectWrite: false;
  destructiveToActiveLayerPixels: boolean;
  description: string;
}

export interface LocalContentAwareUnsupportedState {
  code:
    | 'ai-semantic-synthesis-unsupported'
    | 'native-photoshop-content-aware-unsupported';
  supported: false;
  severity: 'warning';
  message: string;
}

export interface LocalContentAwarePreviewCaveat {
  code: 'local-preview-not-ai' | 'local-active-layer-source';
  severity: 'warning';
  message: string;
}

export interface LocalContentAwareSourceBinHandoff {
  mode: 'committed-active-layer-result';
  safeForSourceBin: true;
  requiresCommitBeforeHandoff: true;
  writesSourceBinDirectly: false;
  preservesOriginalSource: true;
  caveats: readonly string[];
}

export interface LocalContentAwareSelectionDiagnostics {
  selectionPresent: boolean;
  selectionEmpty: boolean;
  targetKind: LocalContentAwarePatchTargetKind;
  targetPixels: number;
  selectionBounds: LocalContentAwareBounds | null;
  blockerCodes: readonly LocalContentAwareInvalidSelectionBlocker['code'][];
  summary: string;
}

export interface LocalContentAwareSourceDiagnostics {
  targetHasPixels: boolean;
  sourceHasPixels: boolean;
  sampledPixels: number;
  transparentPixels: number;
  excludedTargetPixels: number;
  samplingBounds: LocalContentAwareBounds | null;
  blockerCodes: readonly LocalContentAwareInvalidSelectionBlocker['code'][];
  summary: string;
}

export interface LocalContentAwareManualPatchSourcePlan {
  requested: boolean;
  requestedBounds: LocalContentAwareBounds | null;
  supported: true;
  appliedSource: 'automatic-nearby-layer-pixels' | 'manual-active-layer-bounds';
  blockers: readonly string[];
  description: string;
}

export interface LocalContentAwareOutputTargetPlan {
  requested: LocalContentAwareRequestedOutputTarget;
  applied: LocalContentAwarePatchOutputTarget;
  supported: true;
  blockers: readonly string[];
  commitRequiredForSourceBin: true;
  sourceBinHandoff: 'commit-active-layer-result-before-export' | 'commit-local-repair-layer-before-export';
  description: string;
}

export interface LocalContentAwareHandoffSignatures {
  preview: string;
  export: string;
  sourceBin: string;
}

export interface LocalContentAwareAutomationSuitability {
  quickAction: {
    suitable: boolean;
    reason: string;
  };
  batch: {
    suitable: boolean;
    requiresPerDocumentTarget: true;
    blockers: readonly LocalContentAwareInvalidSelectionBlocker['code'][];
    reason: string;
  };
}

export interface LocalContentAwareInvalidSelectionBlocker {
  code: 'selection-size-mismatch' | 'empty-selection' | 'empty-transparent-target' | 'missing-source-pixels';
  severity: 'blocker';
  message: string;
}

export interface LocalContentAwareStablePreview {
  kind: 'local-content-aware-repair-preview';
  version: 1;
  signature: string;
  signatureFields: readonly string[];
}

export interface LocalContentAwareReadiness {
  readinessId: string;
  state: 'ready' | 'no-target-pixels' | 'no-source-pixels';
  undoable: true;
  blockers: readonly string[];
}

export interface LocalContentAwareSourcePixelSummary {
  sampledPixels: number;
  transparentPixels: number;
  excludedTargetPixels: number;
  bounds: LocalContentAwareBounds | null;
  averageRgba: [number, number, number, number] | null;
  alphaRange: { min: number; max: number } | null;
}

export interface LocalContentAwareSelectionValidation {
  imageSize: { width: number; height: number };
  maskSize: { width: number; height: number };
  compatible: boolean;
  blockerCodes: readonly 'selection-size-mismatch'[];
  summary: string;
}

export interface LocalContentAwareSamplingRegionRing {
  radius: number;
  bounds: LocalContentAwareBounds;
  candidatePixels: number;
  opaqueCandidatePixels: number;
  transparentCandidatePixels: number;
  targetPixelsExcluded: number;
}

export interface LocalContentAwareSamplingRegionPlan {
  strategy: 'expand-target-bounds-by-radius';
  targetBounds: LocalContentAwareBounds | null;
  outerBounds: LocalContentAwareBounds | null;
  maxRadius: number;
  rings: readonly LocalContentAwareSamplingRegionRing[];
  nearestOpaqueDistance: number | null;
  usableSourceRatio: number;
  signature: string;
}

export interface LocalContentAwareRepairOperationDescriptor {
  operation: LocalContentAwareRepairOperation;
  execution: 'sample-and-blend-source-pixels' | 'clear-target-alpha';
  photoshopEquivalent: 'Content-Aware Fill' | 'Remove Tool' | 'Patch Tool';
  requiresSourcePixels: boolean;
  modifiesRgb: boolean;
  modifiesAlpha: boolean;
  targetEffect: string;
  caveats: readonly string[];
  signature: string;
}

export interface LocalContentAwareOutputLayerPolicy {
  requested: LocalContentAwareRequestedOutputTarget;
  applied: LocalContentAwarePatchOutputTarget;
  createsLayer: boolean;
  activeLayerMutation: boolean;
  nonDestructive: boolean;
  preservesSourceLayerPixels: boolean;
  blockerCodes: readonly string[];
  caveats: readonly string[];
  signature: string;
}

export interface LocalContentAwarePatchPlan {
  kind: 'local-content-aware-fill-patch';
  operation: LocalContentAwareRepairOperation;
  imageSize: { width: number; height: number };
  targetKind: LocalContentAwarePatchTargetKind;
  requestedOutputTarget: LocalContentAwareRequestedOutputTarget;
  outputTarget: LocalContentAwarePatchOutputTarget;
  targetPolicy: LocalContentAwareTargetPolicy;
  outputLimitations: LocalContentAwareOutputLimitation[];
  unsupportedControls: LocalContentAwareUnsupportedControls;
  approximationWarning: LocalContentAwarePatchWarning & { code: 'ai-vs-local-approximation' };
  samplingAreaPolicy: LocalContentAwareSamplingAreaPolicy;
  samplingAreaCaveats: readonly string[];
  patchSource: LocalContentAwarePatchSourceStatus;
  outputToNewLayer: LocalContentAwareOutputToNewLayerStatus;
  outputTargetCaveats: readonly string[];
  targetSummary: LocalContentAwareTargetSummary;
  localAiLimitation: LocalContentAwareLocalAiLimitation;
  commandCapability: LocalContentAwareCommandCapability;
  patchSourceLimits: LocalContentAwarePatchSourceLimits;
  outputLimits: LocalContentAwareOutputLimits;
  unsupportedStates: readonly LocalContentAwareUnsupportedState[];
  previewCaveats: readonly LocalContentAwarePreviewCaveat[];
  sourceBinHandoff: LocalContentAwareSourceBinHandoff;
  selectionDiagnostics: LocalContentAwareSelectionDiagnostics;
  sourceDiagnostics: LocalContentAwareSourceDiagnostics;
  manualPatchSourcePlan: LocalContentAwareManualPatchSourcePlan;
  outputTargetPlan: LocalContentAwareOutputTargetPlan;
  selectionValidation: LocalContentAwareSelectionValidation;
  samplingRegionPlan: LocalContentAwareSamplingRegionPlan;
  operationDescriptor: LocalContentAwareRepairOperationDescriptor;
  outputLayerPolicy: LocalContentAwareOutputLayerPolicy;
  handoffSignatures: LocalContentAwareHandoffSignatures;
  automationSuitability: LocalContentAwareAutomationSuitability;
  invalidSelectionBlockers: readonly LocalContentAwareInvalidSelectionBlocker[];
  selectionBounds: LocalContentAwareBounds | null;
  samplingRadius: number;
  targetPixels: number;
  sourcePixels: LocalContentAwareSourcePixelSummary;
  warnings: LocalContentAwarePatchWarning[];
  readiness: LocalContentAwareReadiness;
  previewSignature: string;
  stablePreview: LocalContentAwareStablePreview;
  preview: LocalContentAwarePreviewDescriptor;
}

export interface LocalContentAwareFillResult {
  imageData: ImageData;
  changedPixels: number;
  patchPlan: LocalContentAwarePatchPlan;
}

export function buildTransparentPixelMask(imageData: ImageData): SelectionMask {
  const mask: SelectionMask = {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.width * imageData.height),
  };

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      if (imageData.data[offset + 3] === 0) {
        mask.data[y * mask.width + x] = 255;
      }
    }
  }

  return mask;
}

export function applyLocalContentAwareFillToImageData(
  imageData: ImageData,
  options: {
    selection?: SelectionMask | null;
    maxSampleRadius?: number;
    manualPatchSource?: LocalContentAwareBounds | null;
    operation?: LocalContentAwareRepairOperation;
  } = {},
): LocalContentAwareFillResult {
  const operation = options.operation ?? 'fill';
  const selection = options.selection ?? buildTransparentPixelMask(imageData);
  const maxSampleRadius = normalizeSampleRadius(options.maxSampleRadius);
  const patchPlan = describeLocalContentAwarePatchPlan(imageData, {
    selection: options.selection,
    operation,
    maxSampleRadius,
    manualPatchSource: options.manualPatchSource,
  });
  const output: ImageData = {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
  let changedPixels = 0;

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const alpha = getMaskAlpha(selection, x, y);
      if (alpha === 0) continue;

      const offset = (y * imageData.width + x) * 4;
      const mix = alpha / 255;

      if (operation === 'remove') {
        const beforeAlpha = output.data[offset + 3];
        const afterAlpha = mixByte(beforeAlpha, 0, mix);
        if (afterAlpha !== beforeAlpha) {
          changedPixels += 1;
        }
        output.data[offset + 3] = afterAlpha;
        continue;
      }

      const repair = sampleNearestSurroundingPixel(
        imageData,
        selection,
        x,
        y,
        maxSampleRadius,
        normalizeBoundsWithinImage(options.manualPatchSource ?? null, imageData.width, imageData.height),
      );
      if (!repair) continue;

      output.data[offset] = mixByte(imageData.data[offset], repair[0], mix);
      output.data[offset + 1] = mixByte(imageData.data[offset + 1], repair[1], mix);
      output.data[offset + 2] = mixByte(imageData.data[offset + 2], repair[2], mix);
      output.data[offset + 3] = mixByte(imageData.data[offset + 3], repair[3], mix);
      changedPixels += 1;
    }
  }

  return { imageData: output, changedPixels, patchPlan };
}

export function describeLocalContentAwarePatchPlan(
  imageData: ImageData,
  options: {
    selection?: SelectionMask | null;
    maxSampleRadius?: number;
    targetKind?: LocalContentAwarePatchTargetKind;
    outputTarget?: LocalContentAwareRequestedOutputTarget;
    manualPatchSource?: LocalContentAwareBounds | null;
    operation?: LocalContentAwareRepairOperation;
  } = {},
): LocalContentAwarePatchPlan {
  const operation = options.operation ?? 'fill';
  const targetKind = options.targetKind ?? (options.selection ? 'selection' : 'transparent-pixels');
  const requestedOutputTarget = options.outputTarget ?? 'active-layer';
  const outputTarget = requestedOutputTarget;
  const selection = options.selection ?? buildTransparentPixelMask(imageData);
  const samplingRadius = normalizeSampleRadius(options.maxSampleRadius);
  const selectionValidation = describeLocalContentAwareSelectionValidation(imageData, selection);
  const selectionBounds = normalizeBounds(maskBoundingBoxWithinImage(selection, imageData.width, imageData.height));
  const targetPixels = countTargetPixels(selection, imageData.width, imageData.height);
  const manualPatchSource = normalizeBoundsWithinImage(options.manualPatchSource ?? null, imageData.width, imageData.height);
  const sourcePixels = summarizeSourcePixels(
    imageData,
    selection,
    selectionBounds,
    samplingRadius,
    manualPatchSource,
  );
  const samplingRegionPlan = describeLocalContentAwareSamplingRegionPlan(imageData, selection, selectionBounds, samplingRadius);
  const operationDescriptor = describeLocalContentAwareRepairOperationDescriptor(operation);
  const outputLayerPolicy = describeLocalContentAwareOutputLayerPolicy(outputTarget);
  const approximationWarning: LocalContentAwarePatchWarning & { code: 'ai-vs-local-approximation' } = {
    code: 'ai-vs-local-approximation',
    severity: 'warning',
    message: LOCAL_CONTENT_AWARE_APPROXIMATION_WARNING,
  };
  const invalidSelectionBlockers = describeInvalidSelectionBlockers(operation, targetKind, targetPixels, sourcePixels, selectionValidation);
  const warnings: LocalContentAwarePatchWarning[] = [
    {
      code: 'local-approximation',
      severity: 'warning',
      message: LOCAL_CONTENT_AWARE_APPROXIMATION_WARNING,
    },
  ];
  const signaturePayload = {
    targetKind,
    outputTarget,
    selectionBounds,
    samplingRadius,
    targetPixels,
    sourcePixels,
    warnings: warnings.map((warning) => warning.code),
  };
  const previewSignature = `local-content-aware-patch:v1:${JSON.stringify(signaturePayload)}`;
  const stablePreviewSignaturePayload = {
    operation,
    targetKind,
    outputTarget,
    selectionBounds,
    samplingRadius,
    targetPixels,
    sourcePixels,
    selectionValidation,
    samplingRegionSignature: samplingRegionPlan.signature,
    operationSignature: operationDescriptor.signature,
    outputPolicySignature: outputLayerPolicy.signature,
    warnings: warnings.map((warning) => warning.code),
  };
  const stablePreview: LocalContentAwareStablePreview = {
    kind: 'local-content-aware-repair-preview',
    version: 1,
    signature: `local-content-aware-repair-preview:v1:${JSON.stringify(stablePreviewSignaturePayload)}`,
    signatureFields: [
      'operation',
      'targetKind',
      'outputTarget',
      'selectionBounds',
      'samplingRadius',
      'targetPixels',
      'sourcePixels',
      'warnings',
    ],
  };
  const warningCodes = warnings.map((warning) => warning.code);
  const blockerCodes = invalidSelectionBlockers.map((blocker) => blocker.code);
  const manualPatchSourcePlan = describeManualPatchSourcePlan(manualPatchSource);
  const outputTargetPlan = describeOutputTargetPlan(outputTarget);

  return {
    kind: 'local-content-aware-fill-patch',
    operation,
    imageSize: { width: imageData.width, height: imageData.height },
    targetKind,
    requestedOutputTarget,
    outputTarget,
    targetPolicy: describeTargetPolicy(targetKind),
    outputLimitations: [
      {
        code: 'local-active-layer-source',
        supported: true,
        description: 'Repair samples the active raster layer only. Output can replace that layer or be emitted as a separate local repair layer.',
      },
    ],
    unsupportedControls: {
      samplingAreaPreview: {
        supported: true,
        reason: 'The bounded sampling source is configurable as active-layer pixel bounds; it is not a Photoshop-native overlay.',
      },
      patchSourceControl: {
        supported: true,
        reason: 'A bounded active-layer source rectangle is applied deterministically; cross-layer source sampling is not available.',
      },
    },
    approximationWarning,
    samplingAreaPolicy: describeSamplingAreaPolicy(samplingRadius, manualPatchSource),
    samplingAreaCaveats: describeSamplingAreaCaveats(manualPatchSource),
    patchSource: describePatchSource(operation, sourcePixels, targetPixels, manualPatchSource),
    readiness: describeReadiness(operation, targetKind, targetPixels, sourcePixels),
    outputToNewLayer: describeOutputToNewLayerStatus(),
    outputTargetCaveats: describeOutputTargetCaveats(outputTarget),
    targetSummary: describeTargetSummary(targetKind, selectionBounds, targetPixels),
    localAiLimitation: {
      localEngine: 'deterministic-pixel-patch',
      aiEquivalent: 'Photoshop Content-Aware Fill / Generative Fill',
      severity: 'warning',
      message: LOCAL_CONTENT_AWARE_APPROXIMATION_WARNING,
    },
    commandCapability: describeCommandCapability(operation),
    patchSourceLimits: describePatchSourceLimits(samplingRadius, manualPatchSource),
    outputLimits: describeOutputLimits(outputTarget),
    unsupportedStates: describeUnsupportedStates(),
    previewCaveats: describePreviewCaveats(),
    sourceBinHandoff: describeSourceBinHandoff(),
    selectionDiagnostics: describeSelectionDiagnostics(options.selection, targetKind, targetPixels, selectionBounds, invalidSelectionBlockers),
    sourceDiagnostics: describeSourceDiagnostics(targetPixels, sourcePixels, invalidSelectionBlockers),
    manualPatchSourcePlan,
    outputTargetPlan,
    selectionValidation,
    samplingRegionPlan,
    operationDescriptor,
    outputLayerPolicy,
    handoffSignatures: buildHandoffSignatures(
      stablePreview.signature,
      operation,
      targetKind,
      outputTarget,
      selectionBounds,
      targetPixels,
      blockerCodes,
      warningCodes,
    ),
    automationSuitability: describeAutomationSuitability(invalidSelectionBlockers),
    invalidSelectionBlockers,
    selectionBounds,
    samplingRadius,
    targetPixels,
    sourcePixels,
    warnings,
    previewSignature,
    stablePreview,
    preview: {
      id: buildLocalContentAwarePreviewId(operation, targetKind, imageData.width, imageData.height, selectionBounds, samplingRadius, targetPixels),
      signature: stablePreview.signature,
      signatureFields: stablePreview.signatureFields,
    },
  };
}

export function buildLocalContentAwarePreviewId(
  operation: LocalContentAwareRepairOperation,
  targetKind: LocalContentAwarePatchTargetKind,
  width: number,
  height: number,
  bounds: LocalContentAwareBounds | null,
  samplingRadius: number,
  targetPixels: number,
): string {
  const command = describeCommandCapability(operation).command;
  const boundsKey = bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : 'none';
  return `local-${command}:${targetKind}:${width}x${height}:${boundsKey}:r${samplingRadius}:t${targetPixels}`;
}

export function describeLocalContentAwareSelectionValidation(
  imageData: ImageData,
  selection: SelectionMask,
): LocalContentAwareSelectionValidation {
  const compatible = selection.width === imageData.width && selection.height === imageData.height;
  return {
    imageSize: { width: imageData.width, height: imageData.height },
    maskSize: { width: selection.width, height: selection.height },
    compatible,
    blockerCodes: compatible ? [] : ['selection-size-mismatch'],
    summary: compatible
      ? 'Selection mask dimensions match the active layer image data.'
      : 'Selection mask dimensions do not match the active layer image data.',
  };
}

export function describeLocalContentAwareSamplingRegionPlan(
  imageData: ImageData,
  selection: SelectionMask,
  targetBounds: LocalContentAwareBounds | null,
  maxRadius: number,
): LocalContentAwareSamplingRegionPlan {
  const outerBounds = expandBounds(targetBounds, maxRadius, imageData.width, imageData.height);
  const rings: LocalContentAwareSamplingRegionRing[] = [];

  if (targetBounds) {
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      const bounds = expandBounds(targetBounds, radius, imageData.width, imageData.height);
      if (!bounds) continue;
      rings.push(describeSamplingRegionRing(imageData, selection, bounds, radius));
    }
  }

  const lastRing = rings[rings.length - 1] ?? null;
  const usableSourceRatio = lastRing && lastRing.candidatePixels > 0
    ? roundRatio(lastRing.opaqueCandidatePixels / lastRing.candidatePixels)
    : 0;
  const nearestOpaqueDistance = findNearestOpaqueSourceDistance(imageData, selection, targetBounds, outerBounds);
  const payload = {
    targetBounds,
    outerBounds,
    maxRadius,
    rings,
    nearestOpaqueDistance,
    usableSourceRatio,
  };

  return {
    strategy: 'expand-target-bounds-by-radius',
    targetBounds,
    outerBounds,
    maxRadius,
    rings,
    nearestOpaqueDistance,
    usableSourceRatio,
    signature: `local-content-aware-sampling-region:v1:${JSON.stringify(payload)}`,
  };
}

export function describeLocalContentAwareRepairOperationDescriptor(
  operation: LocalContentAwareRepairOperation,
): LocalContentAwareRepairOperationDescriptor {
  if (operation === 'remove') {
    const descriptor = {
      operation,
      execution: 'clear-target-alpha' as const,
      photoshopEquivalent: 'Remove Tool' as const,
      requiresSourcePixels: false,
      modifiesRgb: false,
      modifiesAlpha: true,
      targetEffect: 'Selected target pixels have alpha cleared locally; RGB bytes are preserved for undo/diff inspection.',
      caveats: [
        'This is not Photoshop semantic Remove Tool synthesis.',
        'No replacement pixels are generated for the removed area.',
      ],
    };

    return {
      ...descriptor,
      signature: buildOperationDescriptorSignature(descriptor),
    };
  }

  const descriptor = {
    operation,
    execution: 'sample-and-blend-source-pixels' as const,
    photoshopEquivalent: operation === 'patch' ? 'Patch Tool' as const : 'Content-Aware Fill' as const,
    requiresSourcePixels: true,
    modifiesRgb: true,
    modifiesAlpha: true,
    targetEffect: 'Selected or transparent target pixels are blended toward nearby opaque source pixels.',
    caveats: [
      'Deterministic pixel repair does not infer semantic objects or backgrounds.',
      'Sampling is automatic and active-layer only.',
    ],
  };

  return {
    ...descriptor,
    signature: buildOperationDescriptorSignature(descriptor),
  };
}

export function describeLocalContentAwareOutputLayerPolicy(
  requested: LocalContentAwarePatchOutputTarget,
): LocalContentAwareOutputLayerPolicy {
  const createsLayer = requested === 'new-layer';
  const payload = {
    requested,
    applied: requested,
    createsLayer,
    nonDestructive: createsLayer,
    blockerCodes: [],
  };

  return {
    requested,
    applied: requested,
    createsLayer,
    activeLayerMutation: !createsLayer,
    nonDestructive: createsLayer,
    preservesSourceLayerPixels: createsLayer,
    blockerCodes: [],
    caveats: createsLayer
      ? ['Local repair output contains only repaired target pixels on a new raster layer.', 'The source is the active raster layer; cross-layer and semantic AI synthesis are unavailable.']
      : ['Local repair commits undoable bitmap pixels to the active layer.', 'The source is the active raster layer; semantic AI synthesis is unavailable.'],
    signature: `local-content-aware-output-policy:v1:${JSON.stringify(payload)}`,
  };
}

function describeTargetPolicy(targetKind: LocalContentAwarePatchTargetKind): LocalContentAwareTargetPolicy {
  if (targetKind === 'selection') {
    return {
      mode: 'selection',
      selectionRequired: true,
      transparentFallback: false,
      description: 'Repairs selected pixels on the active layer using nearby non-selected opaque source pixels.',
    };
  }

  return {
    mode: 'transparent-pixels',
    selectionRequired: false,
    transparentFallback: true,
    description: 'When no selection is supplied, transparent pixels on the active layer become the repair target.',
  };
}

function describeSamplingAreaPolicy(
  samplingRadius: number,
  manualPatchSource: LocalContentAwareBounds | null,
): LocalContentAwareSamplingAreaPolicy {
  return {
    mode: manualPatchSource ? 'manual-source-bounds' : 'auto-nearby-non-target',
    editable: true,
    excludesTargetPixels: true,
    excludesTransparentPixels: true,
    maxSampleRadius: samplingRadius,
    description: manualPatchSource
      ? 'Samples opaque non-target pixels from the configured active-layer source bounds.'
      : 'Samples opaque pixels near the target while excluding selected/target pixels and transparent pixels.',
  };
}

function describeSamplingAreaCaveats(manualPatchSource: LocalContentAwareBounds | null): readonly string[] {
  return [
    manualPatchSource
      ? 'Sampling is bounded to the configured active-layer source rectangle.'
      : 'Sampling defaults to nearby active-layer pixels; a source rectangle can constrain it.',
    'Transparent pixels and target pixels are excluded from local repair sampling.',
    'No native Photoshop sampling-area session or cross-layer sampling is wired.',
  ];
}

function describePatchSource(
  operation: LocalContentAwareRepairOperation,
  sourcePixels: LocalContentAwareSourcePixelSummary,
  targetPixels: number,
  manualPatchSource: LocalContentAwareBounds | null,
): LocalContentAwarePatchSourceStatus {
  if (operation === 'remove') {
    return {
      mode: manualPatchSource ? 'manual-source-bounds' : 'automatic-nearest-surrounding',
      userControllable: true,
      status: targetPixels === 0 ? 'empty-target' : 'ready',
      sourceBounds: manualPatchSource,
      sampledPixels: sourcePixels.sampledPixels,
      description: 'Remove mode clears target alpha locally; it does not consume source-sampling candidates.',
    };
  }

  return {
    mode: manualPatchSource ? 'manual-source-bounds' : 'automatic-nearest-surrounding',
    userControllable: true,
    status: targetPixels === 0 ? 'empty-target' : sourcePixels.sampledPixels > 0 ? 'ready' : 'no-source-pixels',
    sourceBounds: sourcePixels.bounds,
    sampledPixels: sourcePixels.sampledPixels,
    description: manualPatchSource
      ? 'Patch source is constrained to the configured active-layer source bounds.'
      : 'Patch source is chosen automatically from nearby non-target opaque pixels; a source rectangle can constrain it.',
  };
}

function describeReadiness(
  operation: LocalContentAwareRepairOperation,
  targetKind: LocalContentAwarePatchTargetKind,
  targetPixels: number,
  sourcePixels: LocalContentAwareSourcePixelSummary,
): LocalContentAwareReadiness {
  const blockers: string[] = [];

  if (targetPixels === 0) {
    blockers.push(`No ${targetKind} target pixels were found.`);
  }

  if (operation !== 'remove' && targetPixels > 0 && sourcePixels.sampledPixels === 0) {
    blockers.push('No opaque non-target source pixels were found inside the sampling radius.');
  }

  const state = blockers.length === 0 ? 'ready' : targetPixels === 0 ? 'no-target-pixels' : 'no-source-pixels';

  return {
    readinessId: `local-content-aware-${operation}-${targetKind}:${state}:${targetPixels}:${sourcePixels.sampledPixels}`,
    state,
    undoable: true,
    blockers,
  };
}

function describeOutputToNewLayerStatus(): LocalContentAwareOutputToNewLayerStatus {
  return {
    supported: true,
    defaultEnabled: false,
    reason: 'Local repair can retain the source layer by writing only repaired target pixels to a new raster layer.',
  };
}

function describeOutputTargetCaveats(outputTarget: LocalContentAwarePatchOutputTarget): readonly string[] {
  return [
    outputTarget === 'new-layer'
      ? 'New-layer output retains the source layer and writes repaired target pixels only.'
      : 'Active-layer output replaces target pixels on the source layer.',
    'Export and Source Bin handoff must use the committed document result, not an uncommitted repair preview.',
    'Local repair is a deterministic approximation, not a generated AI layer variant.',
  ];
}

function describeTargetSummary(
  targetKind: LocalContentAwarePatchTargetKind,
  bounds: LocalContentAwareBounds | null,
  targetPixels: number,
): LocalContentAwareTargetSummary {
  return {
    kind: targetKind,
    label: targetKind === 'selection' ? 'Active selection' : 'Transparent pixels',
    targetPixels,
    bounds,
    requiresSelection: targetKind === 'selection',
    usesTransparentFallback: targetKind === 'transparent-pixels',
  };
}

function describeCommandCapability(operation: LocalContentAwareRepairOperation): LocalContentAwareCommandCapability {
  return {
    command: operation === 'remove' ? 'content-aware-remove' : operation === 'patch' ? 'patch' : 'content-aware-fill',
    engine: 'local-deterministic-pixel-repair',
    supportsSelectionTarget: true,
    supportsTransparentPixelTarget: true,
    supportsOutputToNewLayer: true,
    supportsManualPatchSource: true,
    supportsEditableSamplingArea: true,
    supportsAiSemanticSynthesis: false,
  };
}

function describePatchSourceLimits(
  samplingRadius: number,
  manualPatchSource: LocalContentAwareBounds | null,
): LocalContentAwarePatchSourceLimits {
  return {
    sourceMode: manualPatchSource ? 'manual-active-layer-bounds' : 'automatic-nearby-layer-pixels',
    maxSampleRadius: samplingRadius,
    supportsManualSource: true,
    supportsCrossLayerSampling: false,
    description: manualPatchSource
      ? 'Patch sources are limited to opaque non-target pixels inside the configured active-layer bounds.'
      : 'Patch sources are limited to nearby opaque pixels on the active layer unless source bounds are configured.',
  };
}

function describeOutputLimits(outputTarget: LocalContentAwarePatchOutputTarget): LocalContentAwareOutputLimits {
  return {
    outputTarget,
    supportsNewLayer: true,
    supportsSourceBinDirectWrite: false,
    destructiveToActiveLayerPixels: outputTarget === 'active-layer',
    description: outputTarget === 'new-layer'
      ? 'The committed result inserts a local repair layer while preserving source-layer pixels.'
      : 'The committed result updates active-layer pixels; export or Source Bin handoff must use the committed document result.',
  };
}

function describeUnsupportedStates(): readonly LocalContentAwareUnsupportedState[] {
  return [
    {
      code: 'ai-semantic-synthesis-unsupported',
      supported: false,
      severity: 'warning',
      message: 'Local repair does not synthesize semantic content with AI.',
    },
    {
      code: 'native-photoshop-content-aware-unsupported',
      supported: false,
      severity: 'warning',
      message: 'No native Photoshop Content-Aware Fill or Generative Fill handoff is wired.',
    },
  ];
}

function describePreviewCaveats(): readonly LocalContentAwarePreviewCaveat[] {
  return [
    {
      code: 'local-preview-not-ai',
      severity: 'warning',
      message: 'Preview signatures describe deterministic local pixel repair, not Photoshop or cloud AI synthesis.',
    },
    {
      code: 'local-active-layer-source',
      severity: 'warning',
      message: 'The deterministic repair samples only the active raster layer; it is not semantic or cross-layer synthesis.',
    },
  ];
}

function describeSourceBinHandoff(): LocalContentAwareSourceBinHandoff {
  return {
    mode: 'committed-active-layer-result',
    safeForSourceBin: true,
    requiresCommitBeforeHandoff: true,
    writesSourceBinDirectly: false,
    preservesOriginalSource: true,
    caveats: [
      'Source Bin handoff should reference the saved/committed document result, not an uncommitted preview.',
      'The original source asset is not overwritten by local content-aware repair.',
    ],
  };
}

function describeSelectionDiagnostics(
  selection: SelectionMask | null | undefined,
  targetKind: LocalContentAwarePatchTargetKind,
  targetPixels: number,
  selectionBounds: LocalContentAwareBounds | null,
  blockers: readonly LocalContentAwareInvalidSelectionBlocker[],
): LocalContentAwareSelectionDiagnostics {
  const blockerCodes = blockers.map((blocker) => blocker.code);
  const selectionPresent = Boolean(selection);
  const selectionEmpty = selectionPresent && targetPixels === 0;
  let summary = 'Selection target is ready for local repair on the active layer.';

  if (targetKind === 'transparent-pixels' && blockerCodes.includes('missing-source-pixels')) {
    summary = 'Transparent-pixel fallback target is blocked until nearby opaque source pixels exist.';
  } else if (targetKind === 'transparent-pixels' && blockerCodes.length === 0) {
    summary = 'Transparent-pixel fallback target is ready for local repair on the active layer.';
  } else if (blockerCodes.includes('empty-selection')) {
    summary = 'Selection target is blocked because the active selection does not cover any layer pixels.';
  } else if (blockerCodes.includes('missing-source-pixels')) {
    summary = 'Selection target is blocked until nearby opaque source pixels exist.';
  }

  return {
    selectionPresent,
    selectionEmpty,
    targetKind,
    targetPixels,
    selectionBounds,
    blockerCodes,
    summary,
  };
}

function describeSourceDiagnostics(
  targetPixels: number,
  sourcePixels: LocalContentAwareSourcePixelSummary,
  blockers: readonly LocalContentAwareInvalidSelectionBlocker[],
): LocalContentAwareSourceDiagnostics {
  const blockerCodes = blockers.map((blocker) => blocker.code);
  const targetHasPixels = targetPixels > 0;
  const sourceHasPixels = sourcePixels.sampledPixels > 0;
  let summary = sourceHasPixels
    ? `Automatic local repair can sample ${sourcePixels.sampledPixels} opaque non-target pixels inside the sampling area.`
    : 'No opaque non-target source pixels are available inside the automatic sampling area.';

  if (!targetHasPixels) {
    summary = 'Repair is blocked before source sampling because the target selection/fallback has no pixels.';
  } else if (blockerCodes.includes('missing-source-pixels')) {
    summary = 'Repair is blocked because no opaque non-target source pixels were found inside the automatic sampling area.';
  }

  return {
    targetHasPixels,
    sourceHasPixels,
    sampledPixels: sourcePixels.sampledPixels,
    transparentPixels: sourcePixels.transparentPixels,
    excludedTargetPixels: sourcePixels.excludedTargetPixels,
    samplingBounds: sourcePixels.bounds,
    blockerCodes,
    summary,
  };
}

function describeManualPatchSourcePlan(
  requestedBounds: LocalContentAwareBounds | null | undefined,
): LocalContentAwareManualPatchSourcePlan {
  const requested = Boolean(requestedBounds);
  return {
    requested,
    requestedBounds: normalizeBounds(requestedBounds ?? null),
    supported: true,
    appliedSource: requested ? 'manual-active-layer-bounds' : 'automatic-nearby-layer-pixels',
    blockers: [],
    description: requested
      ? 'Manual Patch source bounds constrain deterministic sampling to opaque non-target pixels in the active layer.'
      : 'Manual Patch source bounds were not requested; local repair samples automatic nearby active-layer pixels.',
  };
}

function describeOutputTargetPlan(
  requested: LocalContentAwareRequestedOutputTarget,
): LocalContentAwareOutputTargetPlan {
  return {
    requested,
    applied: requested,
    supported: true,
    blockers: [],
    commitRequiredForSourceBin: true,
    sourceBinHandoff: requested === 'new-layer'
      ? 'commit-local-repair-layer-before-export'
      : 'commit-active-layer-result-before-export',
    description: requested === 'new-layer'
      ? 'Local content-aware repair creates an undoable local repair layer before Source Bin handoff.'
      : 'Local content-aware repair commits undoable pixels to the active layer before Source Bin handoff.',
  };
}

function buildHandoffSignatures(
  preview: string,
  operation: LocalContentAwareRepairOperation,
  targetKind: LocalContentAwarePatchTargetKind,
  outputTarget: LocalContentAwarePatchOutputTarget,
  selectionBounds: LocalContentAwareBounds | null,
  targetPixels: number,
  blockers: readonly LocalContentAwareInvalidSelectionBlocker['code'][],
  warningCodes: readonly LocalContentAwarePatchWarning['code'][],
): LocalContentAwareHandoffSignatures {
  const payload = {
    operation,
    targetKind,
    outputTarget,
    selectionBounds,
    targetPixels,
    blockers,
    warningCodes,
  };

  return {
    preview,
    export: `local-content-aware-export:v1:${JSON.stringify(payload)}`,
    sourceBin: `local-content-aware-source-bin:v1:${JSON.stringify(payload)}`,
  };
}

function describeAutomationSuitability(
  blockers: readonly LocalContentAwareInvalidSelectionBlocker[],
): LocalContentAwareAutomationSuitability {
  const blockerCodes = blockers.map((blocker) => blocker.code);
  const suitable = blockerCodes.length === 0;

  return {
    quickAction: {
      suitable,
      reason: suitable
        ? 'Deterministic active-layer repair can run as an undoable quick action when target pixels and source pixels are ready.'
        : 'Quick action repair is blocked until target and source readiness issues are resolved.',
    },
    batch: {
      suitable,
      requiresPerDocumentTarget: true,
      blockers: blockerCodes,
      reason: 'Batch use is safe only for documents with a valid per-document selection or transparent-pixel target.',
    },
  };
}

function describeSamplingRegionRing(
  imageData: ImageData,
  selection: SelectionMask,
  bounds: LocalContentAwareBounds,
  radius: number,
): LocalContentAwareSamplingRegionRing {
  let candidatePixels = 0;
  let opaqueCandidatePixels = 0;
  let transparentCandidatePixels = 0;
  let targetPixelsExcluded = 0;

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      candidatePixels += 1;

      if (getMaskAlpha(selection, x, y) > 0) {
        targetPixelsExcluded += 1;
        continue;
      }

      const offset = (y * imageData.width + x) * 4;
      if (imageData.data[offset + 3] === 0) {
        transparentCandidatePixels += 1;
      } else {
        opaqueCandidatePixels += 1;
      }
    }
  }

  return {
    radius,
    bounds,
    candidatePixels,
    opaqueCandidatePixels,
    transparentCandidatePixels,
    targetPixelsExcluded,
  };
}

function findNearestOpaqueSourceDistance(
  imageData: ImageData,
  selection: SelectionMask,
  targetBounds: LocalContentAwareBounds | null,
  outerBounds: LocalContentAwareBounds | null,
): number | null {
  if (!targetBounds || !outerBounds) return null;

  const targetPixels: Array<{ x: number; y: number }> = [];
  for (let y = targetBounds.y; y < targetBounds.y + targetBounds.height; y += 1) {
    for (let x = targetBounds.x; x < targetBounds.x + targetBounds.width; x += 1) {
      if (getMaskAlpha(selection, x, y) > 0) {
        targetPixels.push({ x, y });
      }
    }
  }

  if (targetPixels.length === 0) return null;

  let nearest = Number.POSITIVE_INFINITY;
  for (let y = outerBounds.y; y < outerBounds.y + outerBounds.height; y += 1) {
    for (let x = outerBounds.x; x < outerBounds.x + outerBounds.width; x += 1) {
      if (getMaskAlpha(selection, x, y) > 0) continue;

      const offset = (y * imageData.width + x) * 4;
      if (imageData.data[offset + 3] === 0) continue;

      for (const target of targetPixels) {
        nearest = Math.min(nearest, Math.hypot(x - target.x, y - target.y));
      }
    }
  }

  return Number.isFinite(nearest) ? roundRatio(nearest) : null;
}

function buildOperationDescriptorSignature(
  descriptor: Pick<
    LocalContentAwareRepairOperationDescriptor,
    'operation' | 'execution' | 'requiresSourcePixels' | 'modifiesRgb' | 'modifiesAlpha'
  >,
): string {
  const payload = {
    operation: descriptor.operation,
    execution: descriptor.execution,
    requiresSourcePixels: descriptor.requiresSourcePixels,
    modifiesRgb: descriptor.modifiesRgb,
    modifiesAlpha: descriptor.modifiesAlpha,
  };
  return `local-content-aware-operation:v1:${JSON.stringify(payload)}`;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function describeInvalidSelectionBlockers(
  operation: LocalContentAwareRepairOperation,
  targetKind: LocalContentAwarePatchTargetKind,
  targetPixels: number,
  sourcePixels: LocalContentAwareSourcePixelSummary,
  selectionValidation: LocalContentAwareSelectionValidation,
): readonly LocalContentAwareInvalidSelectionBlocker[] {
  const blockers: LocalContentAwareInvalidSelectionBlocker[] = [];

  if (!selectionValidation.compatible) {
    blockers.push({
      code: 'selection-size-mismatch',
      severity: 'blocker',
      message: 'Selection mask dimensions must match the active layer image data before local repair can run.',
    });
  }

  if (targetPixels === 0) {
    blockers.push({
      code: targetKind === 'selection' ? 'empty-selection' : 'empty-transparent-target',
      severity: 'blocker',
      message: targetKind === 'selection'
        ? 'The active selection does not cover any layer pixels.'
        : 'No transparent active-layer pixels are available as a fallback target.',
    });
    return blockers;
  }

  if (operation !== 'remove' && sourcePixels.sampledPixels === 0) {
    blockers.push({
      code: 'missing-source-pixels',
      severity: 'blocker',
      message: 'No opaque non-target source pixels are available inside the sampling radius.',
    });
  }

  return blockers;
}

function sampleNearestSurroundingPixel(
  imageData: ImageData,
  selection: SelectionMask,
  targetX: number,
  targetY: number,
  maxSampleRadius: number,
  sourceBounds: LocalContentAwareBounds | null,
): [number, number, number, number] | null {
  for (let radius = 1; radius <= maxSampleRadius; radius += 1) {
    let totalWeight = 0;
    const totals = [0, 0, 0, 0];

    for (let y = targetY - radius; y <= targetY + radius; y += 1) {
      for (let x = targetX - radius; x <= targetX + radius; x += 1) {
        if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) continue;
        if (sourceBounds && !containsPoint(sourceBounds, x, y)) continue;
        if (getMaskAlpha(selection, x, y) > 0) continue;

        const offset = (y * imageData.width + x) * 4;
        const sourceAlpha = imageData.data[offset + 3];
        if (sourceAlpha === 0) continue;

        const distance = Math.hypot(x - targetX, y - targetY);
        if (distance === 0 || distance > radius) continue;

        const weight = 1 / distance;
        totals[0] += imageData.data[offset] * weight;
        totals[1] += imageData.data[offset + 1] * weight;
        totals[2] += imageData.data[offset + 2] * weight;
        totals[3] += sourceAlpha * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight > 0) {
      return [
        Math.round(totals[0] / totalWeight),
        Math.round(totals[1] / totalWeight),
        Math.round(totals[2] / totalWeight),
        Math.round(totals[3] / totalWeight),
      ];
    }
  }

  return null;
}

function getMaskAlpha(mask: SelectionMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.data[y * mask.width + x] ?? 0;
}

function mixByte(before: number, after: number, alpha: number): number {
  return Math.round(before + (after - before) * Math.max(0, Math.min(1, alpha)));
}

function normalizeSampleRadius(value: number | undefined): number {
  return Math.max(1, Math.round(value ?? 8));
}

function normalizeBounds(bounds: LocalContentAwareBounds | null): LocalContentAwareBounds | null {
  if (!bounds) return null;
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function normalizeBoundsWithinImage(
  bounds: LocalContentAwareBounds | null,
  width: number,
  height: number,
): LocalContentAwareBounds | null {
  if (!bounds) return null;
  const x0 = Math.max(0, Math.floor(bounds.x));
  const y0 = Math.max(0, Math.floor(bounds.y));
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const y1 = Math.min(height, Math.ceil(bounds.y + bounds.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function containsPoint(bounds: LocalContentAwareBounds, x: number, y: number): boolean {
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}

function maskBoundingBoxWithinImage(selection: SelectionMask, width: number, height: number): LocalContentAwareBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (getMaskAlpha(selection, x, y) === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function countTargetPixels(selection: SelectionMask, width: number, height: number): number {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (getMaskAlpha(selection, x, y) > 0) count += 1;
    }
  }
  return count;
}

function summarizeSourcePixels(
  imageData: ImageData,
  selection: SelectionMask,
  selectionBounds: LocalContentAwareBounds | null,
  samplingRadius: number,
  manualPatchSource: LocalContentAwareBounds | null,
): LocalContentAwareSourcePixelSummary {
  const samplingBounds = manualPatchSource ?? expandBounds(selectionBounds, samplingRadius, imageData.width, imageData.height);
  if (!samplingBounds) {
    return {
      sampledPixels: 0,
      transparentPixels: 0,
      excludedTargetPixels: 0,
      bounds: null,
      averageRgba: null,
      alphaRange: null,
    };
  }

  let sampledPixels = 0;
  let transparentPixels = 0;
  let excludedTargetPixels = 0;
  const totals = [0, 0, 0, 0];
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;
  let minAlpha = 255;
  let maxAlpha = 0;

  for (let y = samplingBounds.y; y < samplingBounds.y + samplingBounds.height; y += 1) {
    for (let x = samplingBounds.x; x < samplingBounds.x + samplingBounds.width; x += 1) {
      if (getMaskAlpha(selection, x, y) > 0) {
        excludedTargetPixels += 1;
        continue;
      }

      const offset = (y * imageData.width + x) * 4;
      const alpha = imageData.data[offset + 3];
      if (alpha === 0) {
        transparentPixels += 1;
        continue;
      }

      totals[0] += imageData.data[offset];
      totals[1] += imageData.data[offset + 1];
      totals[2] += imageData.data[offset + 2];
      totals[3] += alpha;
      sampledPixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (alpha < minAlpha) minAlpha = alpha;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }
  }

  return {
    sampledPixels,
    transparentPixels,
    excludedTargetPixels,
    bounds: sampledPixels > 0
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null,
    averageRgba: sampledPixels > 0
      ? [
          Math.round(totals[0] / sampledPixels),
          Math.round(totals[1] / sampledPixels),
          Math.round(totals[2] / sampledPixels),
          Math.round(totals[3] / sampledPixels),
        ]
      : null,
    alphaRange: sampledPixels > 0 ? { min: minAlpha, max: maxAlpha } : null,
  };
}

function expandBounds(
  bounds: LocalContentAwareBounds | null,
  radius: number,
  width: number,
  height: number,
): LocalContentAwareBounds | null {
  if (!bounds) return null;
  const x0 = Math.max(0, bounds.x - radius);
  const y0 = Math.max(0, bounds.y - radius);
  const x1 = Math.min(width, bounds.x + bounds.width + radius);
  const y1 = Math.min(height, bounds.y + bounds.height + radius);
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}
