import type { LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import type { Point } from './tools/types';

export type ImageLiquifyMode = 'push' | 'twirl' | 'pucker' | 'bloat';
export type ImageLiquifyFalloff = 'quadratic' | 'linear' | 'constant';
export type ImageLiquifyPlanningWarning =
  | 'unsupported-face-aware-liquify'
  | 'unsupported-reconstruct-liquify'
  | 'unsupported-smooth-liquify'
  | 'unsupported-non-destructive-mesh'
  | 'unsupported-smart-object-preservation';
export type ImageLiquifyToolMatrixMode = ImageLiquifyMode | 'reconstruct' | 'smooth';
export type ImageLiquifyPhotoshopUnsupportedState =
  | 'face-aware-liquify'
  | 'reconstruct-tool'
  | 'smooth-tool'
  | 'editable-liquify-mesh'
  | 'smart-object-liquify-filter';
export type ImageLiquifySmartSourceCaveat =
  | 'smart-object-preservation-is-metadata-only'
  | 'source-linked-layer-must-be-exported-as-derived-bitmap';
export type ImageLiquifyNonDestructiveLimitation =
  | 'liquify-commits-pixels-on-apply'
  | 'no-reopenable-liquify-mesh-state'
  | 'callers-need-history-or-duplicate-layer-for-reversal';
export type ImageLiquifyBatchActionCaveat =
  | 'requires-fixed-brush-center-radius-strength-and-mask'
  | 'not-suitable-for-face-aware-automatic-batch-liquify';
export type ImageLiquifyUnsupportedControlMode = Extract<ImageLiquifyToolMatrixMode, 'reconstruct' | 'smooth'>;
export type ImageLiquifySourcePreservationWarning = ImageLiquifyPlanningWarning | ImageLiquifySmartSourceCaveat;
export type ImageLiquifySourceKind = 'bitmap-layer' | 'source-linked-layer' | 'smart-object-layer';
export type ImageLiquifySupportMatrixMode =
  | ImageLiquifyToolMatrixMode
  | 'freeze-mask'
  | 'thaw-mask'
  | 'face-aware'
  | 'smart-filter';
export type ImageLiquifySupportCategory = 'deformation' | 'mask' | 'recovery' | 'face' | 'non-destructive';
export type ImageLiquifySupportPreviewKind =
  | 'bitmap-deformation-preview'
  | 'freeze-thaw-overlay'
  | 'unsupported-control';
export type ImageLiquifySupportOutputKind = 'derived-bitmap' | 'mask-overlay' | 'unsupported';
export type ImageLiquifyBlockerCode =
  | ImageLiquifyPlanningWarning
  | 'unsupported-smart-filter-liquify'
  | 'missing-active-pixel-layer'
  | 'missing-liquify-preview-session';
export type ImageLiquifyBlockerFallback =
  | 'history-snapshot-or-cancel-preview'
  | 'manual-brush-liquify'
  | 'duplicate-layer-or-source-linked-derived-bitmap'
  | 'snapshot-or-derived-bitmap-apply'
  | 'select-a-pixel-layer-or-duplicate-visible'
  | 'build-preview-session-before-apply';
export type ImageLiquifyUnsupportedRequestFeature =
  | 'reconstruct'
  | 'smooth'
  | 'face-aware'
  | 'non-destructive-mesh'
  | 'smart-filter';
export type ImageLiquifyReadinessLaneFeature =
  | 'full-liquify-workspace-ui'
  | ImageLiquifyUnsupportedRequestFeature;
export type ImageLiquifyReadinessLaneUnsupportedState =
  | 'full-liquify-workspace-ui'
  | ImageLiquifyPhotoshopUnsupportedState;
export type ImageLiquifyReadinessLaneFallback =
  | 'descriptor-backed-brush-preview-and-history-cancel'
  | ImageLiquifyBlockerFallback;

export interface ImageLiquifyBlockerDescriptor {
  code: ImageLiquifyBlockerCode;
  fallback: ImageLiquifyBlockerFallback;
  signature: string;
}

export interface ImageLiquifyModeSupportEntry {
  mode: ImageLiquifySupportMatrixMode;
  category: ImageLiquifySupportCategory;
  supported: boolean;
  ready: boolean;
  requested: boolean;
  actionSuitable: boolean;
  batchSuitable: boolean;
  previewKind: ImageLiquifySupportPreviewKind;
  outputKind: ImageLiquifySupportOutputKind;
  blocker: ImageLiquifyBlockerDescriptor | null;
  signature: string;
}

export interface ImageLiquifyModeSupportMatrixDescriptor {
  entries: ImageLiquifyModeSupportEntry[];
  mask: {
    dimensions: string;
    freezeMaskReady: boolean;
    thawMaskReady: boolean;
    frozenPixelCount: number;
    thawedPixelCount: number;
    effectiveFrozenPixelCount: number;
  };
  unsupportedRequestedModes: ImageLiquifyUnsupportedControlMode[];
  unsupportedRequestedStates: ImageLiquifyPhotoshopUnsupportedState[];
  signature: string;
}

export interface ImageLiquifySourceSafetyDescriptor {
  sourceKind: ImageLiquifySourceKind;
  originalMutation: 'mutate-active-bitmap' | 'preserve-source-reference';
  commitTarget: 'active-bitmap-layer' | 'derived-bitmap-layer';
  nonDestructive: false;
  smartFilterSupported: false;
  sourceLinkedOriginalPreserved: boolean;
  warnings: ImageLiquifySourcePreservationWarning[];
  signature: string;
}

export interface ImageLiquifyUnsupportedRequestDescriptor extends ImageLiquifyBlockerDescriptor {
  feature: ImageLiquifyUnsupportedRequestFeature;
}

export interface ImageLiquifyApplyCancelPlan {
  sessionId: string;
  previewSignature: string;
  apply: {
    allowed: boolean;
    destructiveCommit: true;
    commandId: string;
    signature: string;
    undoSnapshotLabel: string;
    blockedBy: ImageLiquifyBlockerDescriptor[];
  };
  cancel: {
    allowed: true;
    discardsPreview: true;
    restoresSourcePixels: true;
    signature: string;
  };
  sourceSafety: ImageLiquifySourceSafetyDescriptor;
  unsupportedRequests: ImageLiquifyUnsupportedRequestDescriptor[];
}

export interface ImageLiquifyReadinessLaneUnsupportedDescriptor {
  feature: ImageLiquifyReadinessLaneFeature;
  supported: false;
  requested: boolean;
  state: ImageLiquifyReadinessLaneUnsupportedState;
  fallback: ImageLiquifyReadinessLaneFallback;
  signature: string;
}

export interface ImageLiquifyDeformationReadinessDescriptor {
  lane: 'image-deformation-liquify';
  session: {
    id: string;
    previewId: string;
    previewSignature: string;
    applySignature: string;
    cancelSignature: string;
  };
  modeSupport: ImageLiquifyModeSupportMatrixDescriptor;
  sourceSafety: ImageLiquifySourceSafetyDescriptor;
  applyAllowed: boolean;
  applyBlockers: ImageLiquifyBlockerDescriptor[];
  unsupportedStates: ImageLiquifyReadinessLaneUnsupportedDescriptor[];
  signature: string;
}

export interface ImageLiquifyWorkspaceUiDescriptor {
  mounted: true;
  workspaceKind: 'dockable-liquify-panel';
  documentId: string;
  layerId: string;
  modeControls: Array<{
    mode: ImageLiquifyMode;
    label: string;
    supported: true;
    visible: true;
    active: boolean;
    previewSignature: string;
  }>;
  brushControls: {
    radius: { value: number; min: number; max: number; step: number };
    strength: { value: number; min: number; max: number; step: number };
    falloff: { value: ImageLiquifyFalloff; options: ImageLiquifyFalloff[] };
    center: { x: number; y: number };
    previewScale: number;
  };
  freezeThawControls: ImageLiquifySessionControlDescriptor['freezeThaw'];
  preview: ImageLiquifyBrushPreviewDescriptor;
  commands: {
    preview: { enabled: boolean; signature: string };
    apply: { enabled: boolean; destructiveCommit: true; commandId: string; signature: string };
    cancel: { enabled: true; signature: string };
  };
  unsupportedControls: Array<{
    feature: ImageLiquifyUnsupportedRequestFeature;
    label: string;
    supported: false;
    fallback: ImageLiquifyBlockerFallback;
    signature: string;
  }>;
  sourceSafety: ImageLiquifySourceSafetyDescriptor;
  signature: string;
}

export interface ImageLiquifyBrushPreviewDescriptor {
  id: string;
  signature: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scale: number;
}

export interface ImageLiquifyModeControlDescriptor {
  mode: ImageLiquifyToolMatrixMode;
  supported: boolean;
  parity: 'basic' | 'unsupported';
  requested: boolean;
}

export interface ImageLiquifySessionControlDescriptor {
  modes: ImageLiquifyModeControlDescriptor[];
  faceAware: {
    supported: boolean;
    parity: 'unsupported';
    requested: boolean;
  };
  nonDestructiveMesh: {
    supported: boolean;
    parity: 'unsupported';
    requested: boolean;
  };
  freezeThaw: {
    freezeMaskReady: boolean;
    thawMaskReady: boolean;
    frozenPixelCount: number;
    thawedPixelCount: number;
    effectiveFrozenPixelCount: number;
    overlayPreviewSupported: boolean;
    limitation: 'freeze-thaw-mask-controls-are-descriptor-backed';
  };
  sourcePreservation: {
    preserveSmartObjectsRequested: boolean;
    smartObjectFilterSupported: false;
    sourceLinkedOriginalPreserved: true;
    outputRequiresDerivedBitmap: boolean;
    limitation: 'smart-source-warning-only-no-live-smart-filter';
  };
}

export interface ImageLiquifySessionDescriptor {
  id: string;
  controls: ImageLiquifySessionControlDescriptor;
  brush: ImageLiquifySessionMetadata['brush'];
  preview: ImageLiquifyBrushPreviewDescriptor;
  warnings: ImageLiquifyPlanningWarning[];
}

export interface ImageLiquifyMask {
  width: number;
  height: number;
  freeze?: Uint8ClampedArray;
  thaw?: Uint8ClampedArray;
}

export interface ImageLiquifySessionMetadata {
  brush: {
    mode: ImageLiquifyMode;
    radius: number;
    strength: number;
    falloff: ImageLiquifyFalloff;
    previewScale: number;
  };
  center: Point;
  previewBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  mask: {
    width: number;
    height: number;
    frozenPixelCount: number;
    thawedPixelCount: number;
  } | null;
}

export interface ImageLiquifyOptions {
  mode: ImageLiquifyMode;
  center: Point;
  radius: number;
  strength: number;
  direction?: Point;
  falloff?: ImageLiquifyFalloff;
  previewScale?: number;
  mask?: ImageLiquifyMask;
}

export interface ImageLiquifyPlanningContext {
  documentId?: string;
  layerId?: string;
  sourceKind?: ImageLiquifySourceKind;
  preserveSmartObjects?: boolean;
  requestedFaceAware?: boolean;
  requestedModes?: ImageLiquifyToolMatrixMode[];
  requestedNonDestructiveMesh?: boolean;
  hasActivePixelLayer?: boolean;
  hasPreviewSession?: boolean;
}

export interface ImageLiquifyReadinessContext extends ImageLiquifyPlanningContext {
  mask?: ImageLiquifyMask;
}

export interface ImageLiquifyReadinessDescriptor {
  supportedLocalDeformations: ImageLiquifyMode[];
  modeReadiness: Array<{
    mode: ImageLiquifyMode;
    ready: boolean;
    actionSuitable: boolean;
    batchSuitable: boolean;
    exportSafe: boolean;
    limitation: 'brush-local-bitmap-deformation-only';
    previewSignature: string;
  }>;
  sessionState: {
    type: 'bitmap-preview-session';
    destructiveApply: boolean;
    previewBeforeCommit: boolean;
    undoSnapshotRequired: boolean;
  };
  controlState: {
    brushRadius: boolean;
    strength: boolean;
    falloff: ImageLiquifyFalloff[];
    faceAware: boolean;
    reconstruct: boolean;
    smooth: boolean;
  };
  freezeThaw: {
    supported: boolean;
    freezeMaskSupported: boolean;
    thawMaskSupported: boolean;
    frozenPixelCount: number;
    thawedPixelCount: number;
    limitation: 'mask-guided-local-brush-protection-only';
  };
  freezeThawReadiness: {
    ready: boolean;
    frozenPixelCount: number;
    thawedPixelCount: number;
    actionSuitable: boolean;
    batchSuitable: boolean;
    exportSafe: boolean;
    previewSignature: string;
    exportSignature: string;
    limitation: 'mask-guided-local-brush-protection-only';
  };
  freezeThawMaskReadiness: {
    ready: boolean;
    maskDimensions: string;
    freezeMaskReady: boolean;
    thawMaskReady: boolean;
    frozenPixelCount: number;
    thawedPixelCount: number;
    effectiveFrozenPixelCount: number;
    overlayPreviewReady: boolean;
    limitation: 'freeze-thaw-overlay-preview-with-bitmap-commit-only';
  };
  unsupportedControlReadiness: Array<{
    mode: ImageLiquifyUnsupportedControlMode;
    requested: true;
    supported: false;
    ready: false;
    warning: Extract<ImageLiquifyPlanningWarning, 'unsupported-reconstruct-liquify' | 'unsupported-smooth-liquify'>;
    fallback: 'history-snapshot-or-duplicate-layer-before-apply';
    previewSignature: string;
  }>;
  sourcePreservationReadiness: {
    preserveSmartObjectsRequested: boolean;
    smartObjectFilterSupported: false;
    sourceLinkedOriginalPreserved: true;
    outputRequiresDerivedBitmap: boolean;
    warnings: ImageLiquifySourcePreservationWarning[];
    caveat: 'smart-source-is-not-mutated-but-liquify-output-is-a-derived-bitmap';
  };
  unsupportedPhotoshopEquivalentStates: ImageLiquifyPhotoshopUnsupportedState[];
  smartSourceCaveats: ImageLiquifySmartSourceCaveat[];
  nonDestructiveLimitations: ImageLiquifyNonDestructiveLimitation[];
  previewExportSignatures: {
    preview: string;
    export: string;
  };
  workspace: {
    fullyInteractive: false;
    brushPreviewSupported: true;
    beforeAfterSplitViewSupported: false;
    reopenableMeshWorkspaceSupported: false;
    limitation: 'descriptor-only-session-not-live-deformation-workspace';
    unsupportedFeatures: Array<
      'interactive-deformation-mesh' | 'reopenable-before-after-workspace' | 'face-aware-overlay-controls'
    >;
  };
  onCanvasWorkspaceReadiness: {
    ready: false;
    descriptorOnly: true;
    brushBoundsReady: true;
    freezeOverlayReady: boolean;
    thawOverlayReady: boolean;
    interactiveMeshReady: false;
    beforeAfterPreviewReady: false;
    limitation: 'on-canvas-descriptors-only-no-mounted-liquify-workspace';
    signature: string;
  };
  exportSourceBinHandoffSafety: {
    safeForFlattenedExport: boolean;
    safeForSourceBinDerivedBitmap: boolean;
    preservesOriginalSource: boolean;
    caveat: 'handoff-should-use-derived-bitmap-or-snapshot-not-original-smart-source';
  };
  batchActionSuitability: {
    deterministic: boolean;
    suitableForRecordedActions: boolean;
    caveats: ImageLiquifyBatchActionCaveat[];
  };
  readinessSignature: string;
}

export interface ImageLiquifyPlanningDescriptor {
  toolSupport: Array<{
    mode: ImageLiquifyToolMatrixMode;
    supported: boolean;
    parity: 'basic' | 'unsupported';
  }>;
  maskSummary: {
    width: number;
    height: number;
    frozenPixelCount: number;
    thawedPixelCount: number;
    effectiveFrozenPixelCount: number;
    hasFreezeMask: boolean;
    hasThawMask: boolean;
  } | null;
  falloff: {
    mode: ImageLiquifyFalloff;
    supportedModes: ImageLiquifyFalloff[];
    limitation: 'brush-local-falloff-only';
  };
  preview: {
    id: string;
    signature: string;
    bounds: ImageLiquifySessionMetadata['previewBounds'];
    scale: number;
  };
  warnings: ImageLiquifyPlanningWarning[];
  session: ImageLiquifySessionDescriptor;
}

const LIQUIFY_TOOL_MATRIX_MODES: Array<ImageLiquifyToolMatrixMode> = [
  'push',
  'twirl',
  'pucker',
  'bloat',
  'reconstruct',
  'smooth',
];
const SUPPORTED_LIQUIFY_LOCAL_DEFORMATIONS: ImageLiquifyMode[] = ['push', 'twirl', 'pucker', 'bloat'];

export function applyLiquifyToImageData(imageData: ImageData, options: ImageLiquifyOptions): ImageData {
  const output = cloneImageData(imageData);
  const radius = Math.max(0, options.radius);
  const strength = clamp(options.strength, -1, 1);
  if (radius <= 0 || strength === 0) return output;

  const integerRadius = Math.ceil(radius);
  const minX = Math.max(0, Math.floor(options.center.x - integerRadius));
  const maxX = Math.min(imageData.width - 1, Math.ceil(options.center.x + integerRadius));
  const minY = Math.max(0, Math.floor(options.center.y - integerRadius));
  const maxY = Math.min(imageData.height - 1, Math.ceil(options.center.y + integerRadius));
  const direction = normalizePoint(options.direction ?? { x: 1, y: 0 });
  const falloffMode = options.falloff ?? 'quadratic';

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offsetX = x - options.center.x;
      const offsetY = y - options.center.y;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > radius) continue;
      const targetThawed = isLiquifyPixelThawed(options.mask, x, y);
      if (!targetThawed && isLiquifyPixelFrozen(options.mask, x, y)) continue;

      const falloff = getLiquifyBrushFalloff(distance, radius, falloffMode);
      const sourcePoint = mapDestinationToSource({
        mode: options.mode,
        center: options.center,
        x,
        y,
        offsetX,
        offsetY,
        strength,
        falloff,
        direction,
      });
      if (!targetThawed && doesLiquifySampleTouchFrozen(options.mask, sourcePoint.x, sourcePoint.y)) continue;
      const sampled = sampleImageData(imageData, sourcePoint.x, sourcePoint.y);
      const targetOffset = (y * imageData.width + x) * 4;
      output.data[targetOffset] = sampled[0];
      output.data[targetOffset + 1] = sampled[1];
      output.data[targetOffset + 2] = sampled[2];
      output.data[targetOffset + 3] = sampled[3];
    }
  }

  return output;
}

export function applyLiquifyToBitmap(bitmap: LayerBitmap, options: ImageLiquifyOptions): void {
  putBitmapImageData(bitmap, applyLiquifyToImageData(getBitmapImageData(bitmap), options));
}

export function getLiquifyBrushFalloff(
  distance: number,
  radius: number,
  mode: ImageLiquifyFalloff = 'quadratic',
): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  const normalized = clamp(1 - distance / radius, 0, 1);
  if (mode === 'constant') return normalized > 0 ? 1 : 0;
  if (mode === 'linear') return normalized;
  return normalized ** 2;
}

export function getLiquifyBrushStrength(strength: number, falloff: number): number {
  return clamp(strength, -1, 1) * clamp(falloff, 0, 1);
}

export function buildLiquifySessionMetadata(options: ImageLiquifyOptions): ImageLiquifySessionMetadata {
  const radius = Math.max(0, options.radius);
  const mask = options.mask ?? null;
  const previewScale = clampPreviewScale(options.previewScale);
  return {
    brush: {
      mode: options.mode,
      radius,
      strength: clamp(options.strength, -1, 1),
      falloff: options.falloff ?? 'quadratic',
      previewScale,
    },
    center: { ...options.center },
    previewBounds: {
      x: options.center.x - radius,
      y: options.center.y - radius,
      width: radius * 2,
      height: radius * 2,
    },
    mask: mask
      ? {
          width: mask.width,
          height: mask.height,
          frozenPixelCount: countMaskPixels(mask.freeze),
          thawedPixelCount: countMaskPixels(mask.thaw),
        }
      : null,
  };
}

export function buildLiquifyPlanningDescriptor(
  options: ImageLiquifyOptions,
  context: ImageLiquifyPlanningContext = {},
): ImageLiquifyPlanningDescriptor {
  const metadata = buildLiquifySessionMetadata(options);
  const session = buildLiquifySessionDescriptor(options, context);
  const warnings = session.warnings;
  const maskControl = buildLiquifyFreezeThawControlDescriptor(options.mask);
  const maskSummary = metadata.mask
    ? {
        ...metadata.mask,
        effectiveFrozenPixelCount: maskControl.effectiveFrozenPixelCount,
        hasFreezeMask: (options.mask?.freeze?.length ?? 0) > 0,
        hasThawMask: (options.mask?.thaw?.length ?? 0) > 0,
      }
    : null;

  return {
    toolSupport: [
      { mode: 'push', supported: true, parity: 'basic' },
      { mode: 'twirl', supported: true, parity: 'basic' },
      { mode: 'pucker', supported: true, parity: 'basic' },
      { mode: 'bloat', supported: true, parity: 'basic' },
      { mode: 'reconstruct', supported: false, parity: 'unsupported' },
      { mode: 'smooth', supported: false, parity: 'unsupported' },
    ],
    maskSummary,
    falloff: {
      mode: metadata.brush.falloff,
      supportedModes: ['quadratic', 'linear', 'constant'],
      limitation: 'brush-local-falloff-only',
    },
    preview: {
      ...session.preview,
      bounds: metadata.previewBounds,
    },
    warnings,
    session,
  };
}

export function buildLiquifySessionDescriptor(
  options: ImageLiquifyOptions,
  context: ImageLiquifyPlanningContext = {},
): ImageLiquifySessionDescriptor {
  const metadata = buildLiquifySessionMetadata(options);
  const documentId = context.documentId ?? 'document';
  const layerId = context.layerId ?? 'layer';
  const requestedModes = getRequestedLiquifyModes(context.requestedModes, options.mode);
  const warnings = getLiquifyPlanningWarnings(requestedModes, context);

  return {
    id: `liquify-session-${documentId}-${layerId}-${metadata.brush.mode}`,
    controls: {
      modes: LIQUIFY_TOOL_MATRIX_MODES.map((mode) => ({
        mode,
        supported: mode === 'push' || mode === 'twirl' || mode === 'pucker' || mode === 'bloat',
        parity: mode === 'push' || mode === 'twirl' || mode === 'pucker' || mode === 'bloat'
          ? 'basic'
          : 'unsupported',
        requested: requestedModes.includes(mode),
      })),
      faceAware: {
        supported: false,
        parity: 'unsupported',
        requested: Boolean(context.requestedFaceAware),
      },
      nonDestructiveMesh: {
        supported: false,
        parity: 'unsupported',
        requested: Boolean(context.requestedNonDestructiveMesh),
      },
      freezeThaw: buildLiquifyFreezeThawControlDescriptor(options.mask),
      sourcePreservation: buildLiquifySourcePreservationControlDescriptor(context),
    },
    brush: metadata.brush,
    preview: buildLiquifyBrushPreviewDescriptor(metadata, documentId, layerId),
    warnings,
  };
}

export function buildLiquifyBrushPreviewDescriptor(
  metadata: ImageLiquifySessionMetadata,
  documentId: string,
  layerId: string,
): ImageLiquifyBrushPreviewDescriptor {
  const maskSummary = metadata.mask
    ? {
        width: metadata.mask.width,
        height: metadata.mask.height,
        frozenPixelCount: metadata.mask.frozenPixelCount,
        thawedPixelCount: metadata.mask.thawedPixelCount,
      }
    : null;

  return {
    id: `liquify-${documentId}-${layerId}-${metadata.brush.mode}`,
    signature: [
      'liquify',
      documentId,
      layerId,
      metadata.brush.mode,
      `${formatPlanningNumber(metadata.center.x)},${formatPlanningNumber(metadata.center.y)}`,
      formatPlanningNumber(metadata.brush.radius),
      formatPlanningNumber(metadata.brush.strength),
      metadata.brush.falloff,
      formatPlanningNumber(metadata.brush.previewScale),
      maskSummary ? `${maskSummary.width}x${maskSummary.height}` : 'no-mask',
      String(maskSummary?.frozenPixelCount ?? 0),
      String(maskSummary?.thawedPixelCount ?? 0),
    ].join(':'),
    bounds: metadata.previewBounds,
    scale: metadata.brush.previewScale,
  };
}

export function buildLiquifyModeSupportMatrix(
  context: ImageLiquifyReadinessContext = {},
): ImageLiquifyModeSupportMatrixDescriptor {
  const documentId = context.documentId ?? 'document';
  const layerId = context.layerId ?? 'layer';
  const requestedModes = getUniqueReadinessRequestedLiquifyModes(context.requestedModes);
  const requestedModeSet = new Set<ImageLiquifyToolMatrixMode>(requestedModes);
  const maskControls = buildLiquifyFreezeThawControlDescriptor(context.mask);
  const maskDimensions = getLiquifyMaskDimensions(context.mask);
  const smartFilterRequested = isLiquifySmartFilterRequested(context);
  const unsupportedRequestedModes: ImageLiquifyUnsupportedControlMode[] = [];
  const unsupportedRequestedStates: ImageLiquifyPhotoshopUnsupportedState[] = [];

  if (requestedModeSet.has('reconstruct')) {
    unsupportedRequestedModes.push('reconstruct');
    unsupportedRequestedStates.push('reconstruct-tool');
  }
  if (requestedModeSet.has('smooth')) {
    unsupportedRequestedModes.push('smooth');
    unsupportedRequestedStates.push('smooth-tool');
  }
  if (context.requestedFaceAware) {
    unsupportedRequestedStates.push('face-aware-liquify');
  }
  if (context.requestedNonDestructiveMesh) {
    unsupportedRequestedStates.push('editable-liquify-mesh');
  }
  if (smartFilterRequested) {
    unsupportedRequestedStates.push('smart-object-liquify-filter');
  }

  return {
    entries: [
      ...SUPPORTED_LIQUIFY_LOCAL_DEFORMATIONS.map((mode) => buildLiquifyModeSupportEntry({
        mode,
        category: 'deformation',
        requested: requestedModeSet.has(mode),
        documentId,
        layerId,
        previewKind: 'bitmap-deformation-preview',
        outputKind: 'derived-bitmap',
      })),
      buildLiquifyModeSupportEntry({
        mode: 'freeze-mask',
        category: 'mask',
        requested: maskControls.freezeMaskReady,
        documentId,
        layerId,
        previewKind: 'freeze-thaw-overlay',
        outputKind: 'mask-overlay',
      }),
      buildLiquifyModeSupportEntry({
        mode: 'thaw-mask',
        category: 'mask',
        requested: maskControls.thawMaskReady,
        documentId,
        layerId,
        previewKind: 'freeze-thaw-overlay',
        outputKind: 'mask-overlay',
      }),
      buildLiquifyModeSupportEntry({
        mode: 'reconstruct',
        category: 'recovery',
        requested: requestedModeSet.has('reconstruct'),
        documentId,
        layerId,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: buildLiquifyBlockerDescriptor(
          documentId,
          layerId,
          'reconstruct',
          'unsupported-reconstruct-liquify',
          'history-snapshot-or-cancel-preview',
        ),
      }),
      buildLiquifyModeSupportEntry({
        mode: 'smooth',
        category: 'recovery',
        requested: requestedModeSet.has('smooth'),
        documentId,
        layerId,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: buildLiquifyBlockerDescriptor(
          documentId,
          layerId,
          'smooth',
          'unsupported-smooth-liquify',
          'history-snapshot-or-cancel-preview',
        ),
      }),
      buildLiquifyModeSupportEntry({
        mode: 'face-aware',
        category: 'face',
        requested: Boolean(context.requestedFaceAware),
        documentId,
        layerId,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: buildLiquifyBlockerDescriptor(
          documentId,
          layerId,
          'face-aware',
          'unsupported-face-aware-liquify',
          'manual-brush-liquify',
        ),
      }),
      buildLiquifyModeSupportEntry({
        mode: 'smart-filter',
        category: 'non-destructive',
        requested: smartFilterRequested,
        documentId,
        layerId,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: buildLiquifyBlockerDescriptor(
          documentId,
          layerId,
          'smart-filter',
          'unsupported-smart-filter-liquify',
          'duplicate-layer-or-source-linked-derived-bitmap',
        ),
      }),
    ],
    mask: {
      dimensions: maskDimensions,
      freezeMaskReady: maskControls.freezeMaskReady,
      thawMaskReady: maskControls.thawMaskReady,
      frozenPixelCount: maskControls.frozenPixelCount,
      thawedPixelCount: maskControls.thawedPixelCount,
      effectiveFrozenPixelCount: maskControls.effectiveFrozenPixelCount,
    },
    unsupportedRequestedModes,
    unsupportedRequestedStates,
    signature: [
      'liquify-support-matrix',
      'v1',
      documentId,
      layerId,
      requestedModes.join('|') || 'none',
      context.requestedFaceAware ? 'face-aware' : 'no-face-aware',
      context.requestedNonDestructiveMesh ? 'mesh' : 'no-mesh',
      smartFilterRequested ? 'smart' : 'bitmap',
      maskDimensions,
      String(maskControls.frozenPixelCount),
      String(maskControls.thawedPixelCount),
      String(maskControls.effectiveFrozenPixelCount),
    ].join(':'),
  };
}

export function buildLiquifyApplyCancelPlan(
  options: ImageLiquifyOptions,
  context: ImageLiquifyPlanningContext = {},
): ImageLiquifyApplyCancelPlan {
  const documentId = context.documentId ?? 'document';
  const layerId = context.layerId ?? 'layer';
  const session = buildLiquifySessionDescriptor(options, context);
  const metadata = buildLiquifySessionMetadata(options);
  const operationSignature = buildLiquifyOperationSignature(metadata);
  const sourceSafety = buildLiquifySourceSafetyDescriptor(context, documentId, layerId);
  const sourceOutputKind = sourceSafety.commitTarget === 'derived-bitmap-layer' ? 'derived-bitmap' : 'active-bitmap';
  const applyBlockers = buildLiquifyApplyBlockers(context, documentId, layerId);

  return {
    sessionId: session.id,
    previewSignature: session.preview.signature,
    apply: {
      allowed: applyBlockers.length === 0,
      destructiveCommit: true,
      commandId: `apply-liquify-${documentId}-${layerId}-${metadata.brush.mode}`,
      signature: [
        'liquify-apply',
        'v1',
        documentId,
        layerId,
        operationSignature,
        sourceSafety.sourceKind,
        sourceOutputKind,
      ].join(':'),
      undoSnapshotLabel: `Before Liquify ${layerId}`,
      blockedBy: applyBlockers,
    },
    cancel: {
      allowed: true,
      discardsPreview: true,
      restoresSourcePixels: true,
      signature: ['liquify-cancel', 'v1', documentId, layerId, operationSignature].join(':'),
    },
    sourceSafety,
    unsupportedRequests: buildLiquifyUnsupportedRequestDescriptors(context, documentId, layerId),
  };
}

export function buildLiquifyDeformationReadinessDescriptor(
  options: ImageLiquifyOptions,
  context: ImageLiquifyPlanningContext = {},
): ImageLiquifyDeformationReadinessDescriptor {
  const documentId = context.documentId ?? 'document';
  const layerId = context.layerId ?? 'layer';
  const session = buildLiquifySessionDescriptor(options, context);
  const applyCancel = buildLiquifyApplyCancelPlan(options, context);
  const unsupportedStates = buildLiquifyReadinessLaneUnsupportedDescriptors(context, documentId, layerId);

  return {
    lane: 'image-deformation-liquify',
    session: {
      id: session.id,
      previewId: session.preview.id,
      previewSignature: session.preview.signature,
      applySignature: applyCancel.apply.signature,
      cancelSignature: applyCancel.cancel.signature,
    },
    modeSupport: buildLiquifyModeSupportMatrix({ ...context, mask: options.mask }),
    sourceSafety: applyCancel.sourceSafety,
    applyAllowed: applyCancel.apply.allowed,
    applyBlockers: applyCancel.apply.blockedBy,
    unsupportedStates,
    signature: [
      'liquify-lane',
      'v1',
      documentId,
      layerId,
      session.preview.signature,
      applyCancel.sourceSafety.sourceKind,
      applyCancel.sourceSafety.commitTarget,
      unsupportedStates.map((state) => state.feature).join('|') || 'none',
    ].join(':'),
  };
}

export function buildLiquifyWorkspaceUiDescriptor(
  options: ImageLiquifyOptions,
  context: ImageLiquifyPlanningContext = {},
): ImageLiquifyWorkspaceUiDescriptor {
  const documentId = context.documentId ?? 'document';
  const layerId = context.layerId ?? 'layer';
  const metadata = buildLiquifySessionMetadata(options);
  const session = buildLiquifySessionDescriptor(options, context);
  const applyCancelPlan = buildLiquifyApplyCancelPlan(options, context);
  const freezeThawControls = buildLiquifyFreezeThawControlDescriptor(options.mask);
  const activePixelLayerReady = context.hasActivePixelLayer ?? true;
  const unsupportedControls = buildLiquifyWorkspaceUnsupportedControls(context, documentId, layerId);

  return {
    mounted: true,
    workspaceKind: 'dockable-liquify-panel',
    documentId,
    layerId,
    modeControls: SUPPORTED_LIQUIFY_LOCAL_DEFORMATIONS.map((mode) => ({
      mode,
      label: getLiquifyModeLabel(mode),
      supported: true,
      visible: true,
      active: metadata.brush.mode === mode,
      previewSignature: `liquify-mode-preview:v1:${documentId}:${layerId}:${mode}`,
    })),
    brushControls: {
      radius: {
        value: metadata.brush.radius,
        min: 1,
        max: 400,
        step: 1,
      },
      strength: {
        value: metadata.brush.strength,
        min: -1,
        max: 1,
        step: 0.01,
      },
      falloff: {
        value: metadata.brush.falloff,
        options: ['quadratic', 'linear', 'constant'],
      },
      center: {
        x: metadata.center.x,
        y: metadata.center.y,
      },
      previewScale: metadata.brush.previewScale,
    },
    freezeThawControls,
    preview: session.preview,
    commands: {
      preview: {
        enabled: activePixelLayerReady,
        signature: `liquify-preview-command:v1:${documentId}:${layerId}:${session.preview.signature}`,
      },
      apply: {
        enabled: applyCancelPlan.apply.allowed,
        destructiveCommit: true,
        commandId: applyCancelPlan.apply.commandId,
        signature: applyCancelPlan.apply.signature,
      },
      cancel: {
        enabled: true,
        signature: applyCancelPlan.cancel.signature,
      },
    },
    unsupportedControls,
    sourceSafety: applyCancelPlan.sourceSafety,
    signature: [
      'liquify-workspace-ui',
      'v1',
      documentId,
      layerId,
      metadata.brush.mode,
      `${formatPlanningNumber(metadata.center.x)},${formatPlanningNumber(metadata.center.y)}`,
      formatPlanningNumber(metadata.brush.radius),
      formatPlanningNumber(metadata.brush.strength),
      metadata.brush.falloff,
      applyCancelPlan.sourceSafety.sourceKind,
      activePixelLayerReady ? 'preview-ready' : 'preview-blocked',
      applyCancelPlan.apply.allowed ? 'apply-ready' : 'apply-blocked',
      `freeze=${freezeThawControls.effectiveFrozenPixelCount}`,
      `unsupported=${unsupportedControls.map((control) => control.feature).join('|') || 'none'}`,
    ].join(':'),
  };
}

export function describeLiquifyReadiness(
  context: ImageLiquifyReadinessContext = {},
): ImageLiquifyReadinessDescriptor {
  const requestedModes = getReadinessRequestedLiquifyModes(context.requestedModes);
  const documentId = context.documentId ?? 'document';
  const layerId = context.layerId ?? 'layer';
  const frozenPixelCount = countMaskPixels(context.mask?.freeze);
  const thawedPixelCount = countMaskPixels(context.mask?.thaw);
  const freezeThawMaskReadiness = buildLiquifyFreezeThawMaskReadinessDescriptor(context.mask);
  const unsupportedControlReadiness = buildLiquifyUnsupportedControlReadinessDescriptors(
    requestedModes,
    documentId,
    layerId,
  );
  const sourcePreservationReadiness = buildLiquifySourcePreservationReadinessDescriptor(context);
  const unsupportedStates: ImageLiquifyPhotoshopUnsupportedState[] = [];

  if (context.requestedFaceAware) unsupportedStates.push('face-aware-liquify');
  if (requestedModes.includes('reconstruct')) unsupportedStates.push('reconstruct-tool');
  if (requestedModes.includes('smooth')) unsupportedStates.push('smooth-tool');
  if (context.requestedNonDestructiveMesh) unsupportedStates.push('editable-liquify-mesh');
  if (context.preserveSmartObjects) unsupportedStates.push('smart-object-liquify-filter');

  return {
    supportedLocalDeformations: [...SUPPORTED_LIQUIFY_LOCAL_DEFORMATIONS],
    modeReadiness: SUPPORTED_LIQUIFY_LOCAL_DEFORMATIONS.map((mode) => ({
      mode,
      ready: true,
      actionSuitable: true,
      batchSuitable: true,
      exportSafe: true,
      limitation: 'brush-local-bitmap-deformation-only',
      previewSignature: `liquify-mode-preview:v1:${documentId}:${layerId}:${mode}`,
    })),
    sessionState: {
      type: 'bitmap-preview-session',
      destructiveApply: true,
      previewBeforeCommit: true,
      undoSnapshotRequired: true,
    },
    controlState: {
      brushRadius: true,
      strength: true,
      falloff: ['quadratic', 'linear', 'constant'],
      faceAware: false,
      reconstruct: false,
      smooth: false,
    },
    freezeThaw: {
      supported: true,
      freezeMaskSupported: true,
      thawMaskSupported: true,
      frozenPixelCount,
      thawedPixelCount,
      limitation: 'mask-guided-local-brush-protection-only',
    },
    freezeThawReadiness: {
      ready: true,
      frozenPixelCount,
      thawedPixelCount,
      actionSuitable: true,
      batchSuitable: true,
      exportSafe: true,
      previewSignature: `liquify-freeze-thaw-preview:v1:${documentId}:${layerId}:${context.mask ? `${context.mask.width}x${context.mask.height}` : 'no-mask'}:${frozenPixelCount}:${thawedPixelCount}`,
      exportSignature: `liquify-freeze-thaw-export:v1:${documentId}:${layerId}:derived-bitmap`,
      limitation: 'mask-guided-local-brush-protection-only',
    },
    freezeThawMaskReadiness,
    unsupportedControlReadiness,
    sourcePreservationReadiness,
    unsupportedPhotoshopEquivalentStates: unsupportedStates,
    smartSourceCaveats: [
      'smart-object-preservation-is-metadata-only',
      'source-linked-layer-must-be-exported-as-derived-bitmap',
    ],
    nonDestructiveLimitations: [
      'liquify-commits-pixels-on-apply',
      'no-reopenable-liquify-mesh-state',
      'callers-need-history-or-duplicate-layer-for-reversal',
    ],
    previewExportSignatures: {
      preview: `liquify-readiness-preview:v1:${documentId}:${layerId}:${SUPPORTED_LIQUIFY_LOCAL_DEFORMATIONS.join('|')}:${context.mask ? `${context.mask.width}x${context.mask.height}` : 'no-mask'}:${frozenPixelCount}:${thawedPixelCount}`,
      export: `liquify-readiness-export:v1:${documentId}:${layerId}:derived-bitmap`,
    },
    workspace: {
      fullyInteractive: false,
      brushPreviewSupported: true,
      beforeAfterSplitViewSupported: false,
      reopenableMeshWorkspaceSupported: false,
      limitation: 'descriptor-only-session-not-live-deformation-workspace',
      unsupportedFeatures: [
        'interactive-deformation-mesh',
        'reopenable-before-after-workspace',
        'face-aware-overlay-controls',
      ],
    },
    onCanvasWorkspaceReadiness: {
      ready: false,
      descriptorOnly: true,
      brushBoundsReady: true,
      freezeOverlayReady: freezeThawMaskReadiness.freezeMaskReady,
      thawOverlayReady: freezeThawMaskReadiness.thawMaskReady,
      interactiveMeshReady: false,
      beforeAfterPreviewReady: false,
      limitation: 'on-canvas-descriptors-only-no-mounted-liquify-workspace',
      signature: [
        'liquify-canvas-readiness',
        'v1',
        documentId,
        layerId,
        freezeThawMaskReadiness.maskDimensions,
        String(freezeThawMaskReadiness.effectiveFrozenPixelCount),
        String(freezeThawMaskReadiness.thawedPixelCount),
        unsupportedControlReadiness.map((control) => control.mode).join('|') || 'none',
        context.preserveSmartObjects ? 'smart' : 'bitmap',
      ].join(':'),
    },
    exportSourceBinHandoffSafety: {
      safeForFlattenedExport: true,
      safeForSourceBinDerivedBitmap: true,
      preservesOriginalSource: false,
      caveat: 'handoff-should-use-derived-bitmap-or-snapshot-not-original-smart-source',
    },
    batchActionSuitability: {
      deterministic: true,
      suitableForRecordedActions: true,
      caveats: [
        'requires-fixed-brush-center-radius-strength-and-mask',
        'not-suitable-for-face-aware-automatic-batch-liquify',
      ],
    },
    readinessSignature: [
      'liquify-readiness',
      documentId,
      layerId,
      requestedModes.join('|') || 'none',
      context.requestedFaceAware ? 'face-aware' : 'no-face-aware',
      context.requestedNonDestructiveMesh ? 'mesh' : 'no-mesh',
      context.preserveSmartObjects ? 'smart' : 'bitmap',
      context.mask ? `${context.mask.width}x${context.mask.height}` : 'no-mask',
      String(frozenPixelCount),
      String(thawedPixelCount),
    ].join(':'),
  };
}

function buildLiquifyReadinessLaneUnsupportedDescriptors(
  context: ImageLiquifyPlanningContext,
  documentId: string,
  layerId: string,
): ImageLiquifyReadinessLaneUnsupportedDescriptor[] {
  const requestedModes = getUniqueReadinessRequestedLiquifyModes(context.requestedModes);
  const descriptors: ImageLiquifyReadinessLaneUnsupportedDescriptor[] = [
    buildLiquifyReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'face-aware',
      'face-aware-liquify',
      Boolean(context.requestedFaceAware),
      'manual-brush-liquify',
    ),
    buildLiquifyReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'reconstruct',
      'reconstruct-tool',
      requestedModes.includes('reconstruct'),
      'history-snapshot-or-cancel-preview',
    ),
    buildLiquifyReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'smooth',
      'smooth-tool',
      requestedModes.includes('smooth'),
      'history-snapshot-or-cancel-preview',
    ),
    buildLiquifyReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'non-destructive-mesh',
      'editable-liquify-mesh',
      Boolean(context.requestedNonDestructiveMesh),
      'snapshot-or-derived-bitmap-apply',
    ),
    buildLiquifyReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'smart-filter',
      'smart-object-liquify-filter',
      isLiquifySmartFilterRequested(context),
      'duplicate-layer-or-source-linked-derived-bitmap',
    ),
  ];

  return descriptors;
}

function buildLiquifyWorkspaceUnsupportedControls(
  context: ImageLiquifyPlanningContext,
  documentId: string,
  layerId: string,
): ImageLiquifyWorkspaceUiDescriptor['unsupportedControls'] {
  const requestedModes = getUniqueReadinessRequestedLiquifyModes(context.requestedModes);
  const controls: ImageLiquifyWorkspaceUiDescriptor['unsupportedControls'] = [];

  if (context.requestedFaceAware) {
    controls.push(buildLiquifyWorkspaceUnsupportedControl(
      documentId,
      layerId,
      'face-aware',
      'Face-Aware',
      'manual-brush-liquify',
    ));
  }
  if (requestedModes.includes('reconstruct')) {
    controls.push(buildLiquifyWorkspaceUnsupportedControl(
      documentId,
      layerId,
      'reconstruct',
      'Reconstruct',
      'history-snapshot-or-cancel-preview',
    ));
  }
  if (requestedModes.includes('smooth')) {
    controls.push(buildLiquifyWorkspaceUnsupportedControl(
      documentId,
      layerId,
      'smooth',
      'Smooth',
      'history-snapshot-or-cancel-preview',
    ));
  }
  if (context.requestedNonDestructiveMesh) {
    controls.push(buildLiquifyWorkspaceUnsupportedControl(
      documentId,
      layerId,
      'non-destructive-mesh',
      'Reopenable Mesh',
      'snapshot-or-derived-bitmap-apply',
    ));
  }
  if (isLiquifySmartFilterRequested(context)) {
    controls.push(buildLiquifyWorkspaceUnsupportedControl(
      documentId,
      layerId,
      'smart-filter',
      'Smart Filter',
      'duplicate-layer-or-source-linked-derived-bitmap',
    ));
  }

  return controls;
}

function buildLiquifyWorkspaceUnsupportedControl(
  documentId: string,
  layerId: string,
  feature: ImageLiquifyUnsupportedRequestFeature,
  label: string,
  fallback: ImageLiquifyBlockerFallback,
): ImageLiquifyWorkspaceUiDescriptor['unsupportedControls'][number] {
  return {
    feature,
    label,
    supported: false,
    fallback,
    signature: ['liquify-workspace-unsupported-control', 'v1', documentId, layerId, feature].join(':'),
  };
}

function getLiquifyModeLabel(mode: ImageLiquifyMode): string {
  switch (mode) {
    case 'push':
      return 'Push';
    case 'twirl':
      return 'Twirl';
    case 'pucker':
      return 'Pucker';
    case 'bloat':
      return 'Bloat';
  }
}

function buildLiquifyReadinessLaneUnsupportedDescriptor(
  documentId: string,
  layerId: string,
  feature: ImageLiquifyReadinessLaneFeature,
  state: ImageLiquifyReadinessLaneUnsupportedState,
  requested: boolean,
  fallback: ImageLiquifyReadinessLaneFallback,
): ImageLiquifyReadinessLaneUnsupportedDescriptor {
  return {
    feature,
    supported: false,
    requested,
    state,
    fallback,
    signature: ['liquify-unsupported', 'v1', documentId, layerId, feature].join(':'),
  };
}

function buildLiquifyFreezeThawControlDescriptor(
  mask: ImageLiquifyMask | undefined,
): ImageLiquifySessionControlDescriptor['freezeThaw'] {
  const freezeMaskReady = (mask?.freeze?.length ?? 0) > 0;
  const thawMaskReady = (mask?.thaw?.length ?? 0) > 0;
  return {
    freezeMaskReady,
    thawMaskReady,
    frozenPixelCount: countMaskPixels(mask?.freeze),
    thawedPixelCount: countMaskPixels(mask?.thaw),
    effectiveFrozenPixelCount: countEffectiveFrozenMaskPixels(mask),
    overlayPreviewSupported: freezeMaskReady || thawMaskReady,
    limitation: 'freeze-thaw-mask-controls-are-descriptor-backed',
  };
}

function buildLiquifySourcePreservationControlDescriptor(
  context: ImageLiquifyPlanningContext,
): ImageLiquifySessionControlDescriptor['sourcePreservation'] {
  return {
    preserveSmartObjectsRequested: Boolean(context.preserveSmartObjects),
    smartObjectFilterSupported: false,
    sourceLinkedOriginalPreserved: true,
    outputRequiresDerivedBitmap: true,
    limitation: 'smart-source-warning-only-no-live-smart-filter',
  };
}

function buildLiquifyFreezeThawMaskReadinessDescriptor(
  mask: ImageLiquifyMask | undefined,
): ImageLiquifyReadinessDescriptor['freezeThawMaskReadiness'] {
  const controls = buildLiquifyFreezeThawControlDescriptor(mask);
  return {
    ready: true,
    maskDimensions: mask ? `${mask.width}x${mask.height}` : 'no-mask',
    freezeMaskReady: controls.freezeMaskReady,
    thawMaskReady: controls.thawMaskReady,
    frozenPixelCount: controls.frozenPixelCount,
    thawedPixelCount: controls.thawedPixelCount,
    effectiveFrozenPixelCount: controls.effectiveFrozenPixelCount,
    overlayPreviewReady: controls.overlayPreviewSupported,
    limitation: 'freeze-thaw-overlay-preview-with-bitmap-commit-only',
  };
}

function buildLiquifyUnsupportedControlReadinessDescriptors(
  requestedModes: ImageLiquifyToolMatrixMode[],
  documentId: string,
  layerId: string,
): ImageLiquifyReadinessDescriptor['unsupportedControlReadiness'] {
  return requestedModes
    .filter((mode): mode is ImageLiquifyUnsupportedControlMode => mode === 'reconstruct' || mode === 'smooth')
    .map((mode) => ({
      mode,
      requested: true,
      supported: false,
      ready: false,
      warning: mode === 'reconstruct' ? 'unsupported-reconstruct-liquify' : 'unsupported-smooth-liquify',
      fallback: 'history-snapshot-or-duplicate-layer-before-apply',
      previewSignature: `liquify-unsupported-control:v1:${documentId}:${layerId}:${mode}`,
    }));
}

function buildLiquifySourcePreservationReadinessDescriptor(
  context: ImageLiquifyReadinessContext,
): ImageLiquifyReadinessDescriptor['sourcePreservationReadiness'] {
  const warnings: ImageLiquifySourcePreservationWarning[] = [
    'source-linked-layer-must-be-exported-as-derived-bitmap',
  ];
  if (context.preserveSmartObjects) {
    warnings.unshift('unsupported-smart-object-preservation');
  }

  return {
    preserveSmartObjectsRequested: Boolean(context.preserveSmartObjects),
    smartObjectFilterSupported: false,
    sourceLinkedOriginalPreserved: true,
    outputRequiresDerivedBitmap: true,
    warnings,
    caveat: 'smart-source-is-not-mutated-but-liquify-output-is-a-derived-bitmap',
  };
}

function buildLiquifyModeSupportEntry({
  mode,
  category,
  requested,
  documentId,
  layerId,
  previewKind,
  outputKind,
  blocker = null,
}: {
  mode: ImageLiquifySupportMatrixMode;
  category: ImageLiquifySupportCategory;
  requested: boolean;
  documentId: string;
  layerId: string;
  previewKind: ImageLiquifySupportPreviewKind;
  outputKind: ImageLiquifySupportOutputKind;
  blocker?: ImageLiquifyBlockerDescriptor | null;
}): ImageLiquifyModeSupportEntry {
  const supported = blocker === null;
  return {
    mode,
    category,
    supported,
    ready: supported,
    requested,
    actionSuitable: supported,
    batchSuitable: supported,
    previewKind,
    outputKind,
    blocker,
    signature: [
      'liquify-support',
      'v1',
      documentId,
      layerId,
      mode,
      supported ? 'supported' : 'blocked',
      requested ? 'requested' : 'available',
    ].join(':'),
  };
}

function buildLiquifyBlockerDescriptor(
  documentId: string,
  layerId: string,
  feature: string,
  code: ImageLiquifyBlockerCode,
  fallback: ImageLiquifyBlockerFallback,
): ImageLiquifyBlockerDescriptor {
  return {
    code,
    fallback,
    signature: ['liquify-blocker', 'v1', documentId, layerId, feature, code].join(':'),
  };
}

function buildLiquifyApplyBlockers(
  context: ImageLiquifyPlanningContext,
  documentId: string,
  layerId: string,
): ImageLiquifyBlockerDescriptor[] {
  const blockers: ImageLiquifyBlockerDescriptor[] = [];
  if (context.hasActivePixelLayer === false) {
    blockers.push(buildLiquifyBlockerDescriptor(
      documentId,
      layerId,
      'apply',
      'missing-active-pixel-layer',
      'select-a-pixel-layer-or-duplicate-visible',
    ));
  }
  if (context.hasPreviewSession === false) {
    blockers.push(buildLiquifyBlockerDescriptor(
      documentId,
      layerId,
      'apply',
      'missing-liquify-preview-session',
      'build-preview-session-before-apply',
    ));
  }

  return blockers;
}

function buildLiquifyUnsupportedRequestDescriptors(
  context: ImageLiquifyPlanningContext,
  documentId: string,
  layerId: string,
): ImageLiquifyUnsupportedRequestDescriptor[] {
  const requestedModes = new Set(getUniqueReadinessRequestedLiquifyModes(context.requestedModes));
  const descriptors: ImageLiquifyUnsupportedRequestDescriptor[] = [];

  if (requestedModes.has('reconstruct')) {
    descriptors.push({
      feature: 'reconstruct',
      ...buildLiquifyBlockerDescriptor(
        documentId,
        layerId,
        'reconstruct',
        'unsupported-reconstruct-liquify',
        'history-snapshot-or-cancel-preview',
      ),
    });
  }
  if (requestedModes.has('smooth')) {
    descriptors.push({
      feature: 'smooth',
      ...buildLiquifyBlockerDescriptor(
        documentId,
        layerId,
        'smooth',
        'unsupported-smooth-liquify',
        'history-snapshot-or-cancel-preview',
      ),
    });
  }
  if (context.requestedFaceAware) {
    descriptors.push({
      feature: 'face-aware',
      ...buildLiquifyBlockerDescriptor(
        documentId,
        layerId,
        'face-aware',
        'unsupported-face-aware-liquify',
        'manual-brush-liquify',
      ),
    });
  }
  if (context.requestedNonDestructiveMesh) {
    descriptors.push({
      feature: 'non-destructive-mesh',
      ...buildLiquifyBlockerDescriptor(
        documentId,
        layerId,
        'non-destructive-mesh',
        'unsupported-non-destructive-mesh',
        'snapshot-or-derived-bitmap-apply',
      ),
    });
  }
  if (isLiquifySmartFilterRequested(context)) {
    descriptors.push({
      feature: 'smart-filter',
      ...buildLiquifyBlockerDescriptor(
        documentId,
        layerId,
        'smart-filter',
        'unsupported-smart-filter-liquify',
        'duplicate-layer-or-source-linked-derived-bitmap',
      ),
    });
  }

  return descriptors;
}

function buildLiquifySourceSafetyDescriptor(
  context: ImageLiquifyPlanningContext,
  documentId: string,
  layerId: string,
): ImageLiquifySourceSafetyDescriptor {
  const sourceKind = getLiquifySourceKind(context);
  const smartFilterRequested = isLiquifySmartFilterRequested(context);
  const commitTarget = sourceKind === 'bitmap-layer' && !context.preserveSmartObjects
    ? 'active-bitmap-layer'
    : 'derived-bitmap-layer';
  const warnings: ImageLiquifySourcePreservationWarning[] = [];

  if (sourceKind === 'smart-object-layer' || context.preserveSmartObjects) {
    warnings.push('unsupported-smart-object-preservation');
    warnings.push('smart-object-preservation-is-metadata-only');
  }
  if (commitTarget === 'derived-bitmap-layer') {
    warnings.push('source-linked-layer-must-be-exported-as-derived-bitmap');
  }

  return {
    sourceKind,
    originalMutation: commitTarget === 'derived-bitmap-layer' ? 'preserve-source-reference' : 'mutate-active-bitmap',
    commitTarget,
    nonDestructive: false,
    smartFilterSupported: false,
    sourceLinkedOriginalPreserved: commitTarget === 'derived-bitmap-layer',
    warnings,
    signature: [
      'liquify-source-safety',
      'v1',
      documentId,
      layerId,
      sourceKind,
      commitTarget === 'derived-bitmap-layer' ? 'derived-bitmap' : 'active-bitmap',
      smartFilterRequested ? 'smart-filter-unsupported' : 'no-smart-filter',
    ].join(':'),
  };
}

function buildLiquifyOperationSignature(metadata: ImageLiquifySessionMetadata): string {
  return [
    metadata.brush.mode,
    `${formatPlanningNumber(metadata.center.x)},${formatPlanningNumber(metadata.center.y)}`,
    formatPlanningNumber(metadata.brush.radius),
    formatPlanningNumber(metadata.brush.strength),
    metadata.brush.falloff,
    metadata.mask ? `${metadata.mask.width}x${metadata.mask.height}` : 'no-mask',
    String(metadata.mask?.frozenPixelCount ?? 0),
    String(metadata.mask?.thawedPixelCount ?? 0),
  ].join(':');
}

function getLiquifySourceKind(context: ImageLiquifyPlanningContext): ImageLiquifySourceKind {
  if (context.sourceKind) return context.sourceKind;
  if (context.preserveSmartObjects) return 'smart-object-layer';
  return 'bitmap-layer';
}

function isLiquifySmartFilterRequested(context: ImageLiquifyPlanningContext): boolean {
  return Boolean(context.preserveSmartObjects || context.sourceKind === 'smart-object-layer');
}

function getLiquifyMaskDimensions(mask: ImageLiquifyMask | undefined): string {
  return mask ? `${mask.width}x${mask.height}` : 'no-mask';
}

function getUniqueReadinessRequestedLiquifyModes(
  requestedModes: ImageLiquifyPlanningContext['requestedModes'],
): ImageLiquifyToolMatrixMode[] {
  const requested = getReadinessRequestedLiquifyModes(requestedModes);
  const selected = new Set<ImageLiquifyToolMatrixMode>();
  const unique: ImageLiquifyToolMatrixMode[] = [];
  for (const mode of requested) {
    if (selected.has(mode)) continue;
    selected.add(mode);
    unique.push(mode);
  }

  return unique;
}

function cloneImageData(imageData: ImageData): ImageData {
  // Must be a real ImageData — the result is written back via ctx.putImageData(), which rejects a
  // plain object cast `as ImageData`. Structural fallback only for pure-node tests lacking ImageData.
  const data = new Uint8ClampedArray(imageData.data);
  if (typeof ImageData !== 'undefined') return new ImageData(data, imageData.width, imageData.height);
  return { width: imageData.width, height: imageData.height, data } as ImageData;
}

function mapDestinationToSource({
  mode,
  center,
  x,
  y,
  offsetX,
  offsetY,
  strength,
  falloff,
  direction,
}: {
  mode: ImageLiquifyMode;
  center: Point;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  strength: number;
  falloff: number;
  direction: Point;
}): Point {
  if (mode === 'push') {
    const effectiveStrength = getLiquifyBrushStrength(strength, falloff);
    return {
      x: x - direction.x * effectiveStrength,
      y: y - direction.y * effectiveStrength,
    };
  }

  if (mode === 'twirl') {
    const angle = -getLiquifyBrushStrength(strength, falloff) * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: center.x + offsetX * cos - offsetY * sin,
      y: center.y + offsetX * sin + offsetY * cos,
    };
  }

  const scaleAmount = 0.75 * getLiquifyBrushStrength(strength, falloff);
  const scale = mode === 'pucker' ? Math.max(0, 1 - scaleAmount) : 1 + scaleAmount;
  return {
    x: center.x + offsetX * scale,
    y: center.y + offsetY * scale,
  };
}

function sampleImageData(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const clampedX = clamp(x, 0, imageData.width - 1);
  const clampedY = clamp(y, 0, imageData.height - 1);
  const left = Math.floor(clampedX);
  const top = Math.floor(clampedY);
  const right = Math.min(imageData.width - 1, left + 1);
  const bottom = Math.min(imageData.height - 1, top + 1);
  const mixX = clampedX - left;
  const mixY = clampedY - top;
  const topLeft = getPixel(imageData, left, top);
  const topRight = getPixel(imageData, right, top);
  const bottomLeft = getPixel(imageData, left, bottom);
  const bottomRight = getPixel(imageData, right, bottom);

  return [0, 1, 2, 3].map((channel) => {
    const topMix = mixNumber(topLeft[channel], topRight[channel], mixX);
    const bottomMix = mixNumber(bottomLeft[channel], bottomRight[channel], mixX);
    return Math.round(mixNumber(topMix, bottomMix, mixY));
  }) as [number, number, number, number];
}

function getPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset] ?? 0,
    imageData.data[offset + 1] ?? 0,
    imageData.data[offset + 2] ?? 0,
    imageData.data[offset + 3] ?? 0,
  ];
}

function normalizePoint(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  if (!Number.isFinite(length) || length === 0) return { x: 1, y: 0 };
  return {
    x: point.x / length,
    y: point.y / length,
  };
}

function getRequestedLiquifyModes(
  requestedModes: ImageLiquifyPlanningContext['requestedModes'],
  fallbackMode: ImageLiquifyMode,
): ImageLiquifyToolMatrixMode[] {
  const request = Array.isArray(requestedModes) && requestedModes.length > 0 ? requestedModes : [fallbackMode];
  const selected = new Set<ImageLiquifyToolMatrixMode>([fallbackMode]);
  for (const requested of request) {
    const isKnown = LIQUIFY_TOOL_MATRIX_MODES.includes(requested);
    if (!isKnown) continue;
    selected.add(requested);
  }

  if (selected.size === 0) {
    selected.add(fallbackMode);
  }

  return LIQUIFY_TOOL_MATRIX_MODES.filter((mode) => selected.has(mode));
}

function getReadinessRequestedLiquifyModes(
  requestedModes: ImageLiquifyPlanningContext['requestedModes'],
): ImageLiquifyToolMatrixMode[] {
  if (!requestedModes || requestedModes.length === 0) return [];
  const selected = new Set<ImageLiquifyToolMatrixMode>();
  for (const requested of requestedModes) {
    if (LIQUIFY_TOOL_MATRIX_MODES.includes(requested)) {
      selected.add(requested);
    }
  }

  return requestedModes.filter((mode): mode is ImageLiquifyToolMatrixMode => selected.has(mode));
}

function getLiquifyPlanningWarnings(
  requestedModes: ImageLiquifyToolMatrixMode[],
  context: ImageLiquifyPlanningContext,
): ImageLiquifyPlanningWarning[] {
  const warnings: ImageLiquifyPlanningWarning[] = [];
  if (context.requestedFaceAware) {
    warnings.push('unsupported-face-aware-liquify');
  }
  if (requestedModes.includes('reconstruct')) {
    warnings.push('unsupported-reconstruct-liquify');
  }
  if (requestedModes.includes('smooth')) {
    warnings.push('unsupported-smooth-liquify');
  }
  if (context.preserveSmartObjects) {
    warnings.push('unsupported-smart-object-preservation');
  }
  if (context.requestedNonDestructiveMesh) {
    warnings.push('unsupported-non-destructive-mesh');
  }

  return warnings;
}

function mixNumber(before: number, after: number, amount: number): number {
  return before + (after - before) * amount;
}

function isLiquifyPixelFrozen(mask: ImageLiquifyMask | undefined, x: number, y: number): boolean {
  if (!mask) return false;
  const index = getMaskIndex(mask, x, y);
  if (index < 0) return false;
  if (isLiquifyMaskIndexThawed(mask, index)) return false;
  return (mask.freeze?.[index] ?? 0) > 0;
}

function isLiquifyPixelThawed(mask: ImageLiquifyMask | undefined, x: number, y: number): boolean {
  if (!mask) return false;
  const index = getMaskIndex(mask, x, y);
  if (index < 0) return false;
  return isLiquifyMaskIndexThawed(mask, index);
}

function doesLiquifySampleTouchFrozen(mask: ImageLiquifyMask | undefined, x: number, y: number): boolean {
  if (!mask) return false;
  const left = Math.floor(x);
  const right = Math.ceil(x);
  const top = Math.floor(y);
  const bottom = Math.ceil(y);
  return (
    isLiquifyPixelFrozen(mask, left, top) ||
    isLiquifyPixelFrozen(mask, right, top) ||
    isLiquifyPixelFrozen(mask, left, bottom) ||
    isLiquifyPixelFrozen(mask, right, bottom)
  );
}

function getMaskIndex(mask: ImageLiquifyMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return -1;
  return y * mask.width + x;
}

function countMaskPixels(values: Uint8ClampedArray | undefined): number {
  if (!values) return 0;
  let count = 0;
  for (const value of values) {
    if (value > 0) count += 1;
  }
  return count;
}

function countEffectiveFrozenMaskPixels(mask: ImageLiquifyMask | undefined): number {
  if (!mask?.freeze) return 0;
  const maskCapacity = getLiquifyMaskCapacity(mask);
  const length = maskCapacity > 0 ? maskCapacity : Math.max(mask.freeze.length, mask.thaw?.length ?? 0);
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if ((mask.freeze[index] ?? 0) > 0 && (mask.thaw?.[index] ?? 0) <= 0) {
      count += 1;
    }
  }
  return count;
}

function getLiquifyMaskCapacity(mask: ImageLiquifyMask): number {
  const width = Number.isFinite(mask.width) ? Math.max(0, Math.trunc(mask.width)) : 0;
  const height = Number.isFinite(mask.height) ? Math.max(0, Math.trunc(mask.height)) : 0;
  return width * height;
}

function clampPreviewScale(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return clamp(value as number, 0.1, 8);
}

function isLiquifyMaskIndexThawed(mask: ImageLiquifyMask, index: number): boolean {
  return (mask.thaw?.[index] ?? 0) > 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function formatPlanningNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}
