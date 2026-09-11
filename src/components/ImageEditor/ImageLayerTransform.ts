import type {
  ImageLayer,
  ImageLayerTransformCorner,
  ImageLayerTransformCornerOffsets,
  ImageLayerWarpOffsets,
  LayerBitmap,
  PixelBuffer,
} from '../../types/imageEditor';
import { createBitmap } from './LayerBitmap';
import {
  isWarpMeshDeformed,
  normalizeWarpMesh,
  sampleWarpMeshDisplacement,
  type WarpMesh,
} from './ImageWarpMesh';
import { resamplePixelBuffer, type ResampleFilter } from './pixels/highBitTools';

export const DEFAULT_TRANSFORM_ORIGIN = 0.5;

export type TransformLayerLike = Pick<
  ImageLayer,
  'x' | 'y' | 'rotationDeg' | 'skewXDeg' | 'skewYDeg' | 'perspectiveX' | 'perspectiveY' | 'cornerOffsets' | 'transformOriginX' | 'transformOriginY' | 'bitmap'
> & {
  baseWidth?: number;
  baseHeight?: number;
  warp?: ImageLayerWarpOffsets;
  warpMesh?: WarpMesh | null;
};

export interface ImageLayerTransformOrigin {
  x: number;
  y: number;
}

export interface ImageLayerPivotPoint extends ImageLayerTransformOrigin {
  pivotX: number;
  pivotY: number;
}

export interface ImageLayerBitmapDrawMetrics {
  drawLeft: number;
  drawTop: number;
  drawWidth: number;
  drawHeight: number;
  pivotDocX: number;
  pivotDocY: number;
  sourcePivotX: number;
  sourcePivotY: number;
  originX: number;
  originY: number;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  perspectiveX: number;
  perspectiveY: number;
  warp: ImageLayerWarpOffsets;
  warpMesh: WarpMesh | null;
  cornerOffsets: ImageLayerTransformCornerOffsets;
}

export type ImageLayerTransformCapabilityKind =
  | 'move'
  | 'scale'
  | 'rotate'
  | 'skew'
  | 'distort'
  | 'perspective'
  | 'warp';

export type ImageLayerTransformPreviewKind = 'metadata' | 'raster-resample' | 'mesh';
export type ImageLayerTransformUndoOperation = 'transform' | 'layerOp';
export type ImageLayerTransformCommitModel = 'metadata' | 'rasterize-layer-operation';

export type ImageLayerTransformWarningCode =
  | 'unsupported-smart-source-safe-transform'
  | 'destructive-scale-rasterization'
  | 'export-rasterizes-transform-preview'
  | 'source-link-retained-transform-not-smart-object';

export interface ImageLayerTransformWarning {
  code: ImageLayerTransformWarningCode;
  severity: 'warning';
  message: string;
  capability?: ImageLayerTransformCapabilityKind;
}

export interface ImageLayerTransformSourceSafetyDescriptor {
  smartSourceSafe: boolean;
  limitationCodes: string[];
}

export interface ImageLayerTransformStatusDescriptor {
  destructive: boolean;
  nonDestructive: boolean;
  rasterizesOnApply: boolean;
  commitModel: ImageLayerTransformCommitModel;
}

export interface ImageLayerTransformDescriptorOptions {
  requireSmartSourceSafe?: boolean;
  requireNonDestructive?: boolean;
}

export interface ImageLayerTransformCapabilityDescriptor {
  kind: ImageLayerTransformCapabilityKind;
  label: string;
  supported: boolean;
  nonDestructive: boolean;
  undoOperation: ImageLayerTransformUndoOperation;
  previewKind: ImageLayerTransformPreviewKind;
  handleCount: number;
  numericFields: string[];
  transformStatus: ImageLayerTransformStatusDescriptor;
  sourceSafety: ImageLayerTransformSourceSafetyDescriptor;
  warnings: ImageLayerTransformWarning[];
}

export interface ImageLayerTransformSupportMatrixEntry {
  supported: boolean;
  commitModel: ImageLayerTransformCommitModel;
}

export interface ImageLayerTransformSourceLinkDescriptor {
  linked: boolean;
  smartSourceLike: boolean;
  sourceId: string | null;
  label: string | null;
  status: 'linked' | 'missing' | 'relinked' | 'unlinked';
  smartSourceSafe: boolean;
}

export interface ImageLayerTransformSetStatusDescriptor {
  destructive: boolean;
  nonDestructive: boolean;
  destructiveCapabilities: ImageLayerTransformCapabilityKind[];
  metadataOnlyCapabilities: ImageLayerTransformCapabilityKind[];
}

export interface ImageLayerTransformCapabilitySetDescriptor {
  descriptorId: 'image-layer-transform-capabilities:v2';
  layerId: string;
  layerType: ImageLayer['type'];
  sourceKind: 'bitmap' | 'text' | 'vector' | 'empty';
  sourceDimensions: { width: number; height: number } | null;
  capabilities: ImageLayerTransformCapabilityDescriptor[];
  sourceLink: ImageLayerTransformSourceLinkDescriptor;
  supportMatrix: Record<'pivot' | 'skew' | 'distort' | 'perspective' | 'warp', ImageLayerTransformSupportMatrixEntry>;
  transformStatus: ImageLayerTransformSetStatusDescriptor;
  preview: { id: string; signature: string };
  exportCaveats: ImageLayerTransformWarning[];
  warnings: ImageLayerTransformWarning[];
  previewSignature: string;
}

export type ImageLayerFreeTransformMode =
  | 'move'
  | 'resize'
  | 'rotate'
  | 'pivot'
  | 'skew'
  | 'distort'
  | 'perspective'
  | 'warp';

export type ImageLayerTransformReadinessBlocker =
  | 'layer-locked'
  | 'position-locked'
  | 'group-layer-unsupported'
  | 'missing-transform-source'
  | 'source-link-missing';

export type ImageLayerSmartObjectTransformParity = 'not-linked' | 'metadata-only';
export type ImageLayerTransformReadinessCommitModel = 'metadata' | 'rasterize-layer-operation' | 'mixed-metadata-and-rasterize';

export interface ImageLayerTransformReadinessModeSummary {
  mode: ImageLayerFreeTransformMode;
  ready: boolean;
  previewKind: ImageLayerTransformPreviewKind;
  numericControls: string[];
}

export interface ImageLayerTransformNumericControlDescriptor {
  id: string;
  label: string;
  available: boolean;
  value: number | null;
  min: number | null;
  max: number | null;
  step: number;
  unit: 'px' | 'deg' | 'ratio' | 'unitless';
}

export interface ImageLayerTransformPreviewStateDescriptor {
  active: boolean;
  applyReady: boolean;
  cancelReady: boolean;
  commitModel: ImageLayerTransformReadinessCommitModel;
  previewSignature: string;
  applySignature: string;
  cancelSignature: string;
}

export interface ImageLayerTransformSourceLinkedSummary {
  linked: boolean;
  smartObjectParity: ImageLayerSmartObjectTransformParity;
  sourceId: string | null;
  label: string | null;
  status: ImageLayerTransformSourceLinkDescriptor['status'];
  caveats: string[];
}

export interface ImageLayerTransformGeometryDescriptor {
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  centerX: number | null;
  centerY: number | null;
  pivotX: number | null;
  pivotY: number | null;
}

export interface ImageLayerTransformPivotDescriptor {
  originX: number;
  originY: number;
  sourceX: number | null;
  sourceY: number | null;
  docX: number | null;
  docY: number | null;
  signature: string;
}

export interface ImageLayerTransformPreviewSessionDescriptor {
  sessionType: 'layer-transform';
  active: boolean;
  applyReady: boolean;
  cancelReady: boolean;
  applyCommand: 'Enter';
  cancelCommand: 'Escape';
}

export type ImageLayerTransformHandleKind = 'rotate' | 'pivot';
export type ImageLayerTransformHandleAnchor = 'top-center-outside' | 'pivot-origin';

export interface ImageLayerTransformHandleDescriptor {
  id: 'rotate-handle' | 'pivot-handle';
  kind: ImageLayerTransformHandleKind;
  mode: Extract<ImageLayerFreeTransformMode, 'rotate' | 'pivot'>;
  anchor: ImageLayerTransformHandleAnchor;
  visible: boolean;
  point: { x: number | null; y: number | null };
  numericControls: string[];
}

export interface ImageLayerTransformReadinessSupportMatrixEntry {
  supported: boolean;
  previewKind: ImageLayerTransformPreviewKind;
  commitModel: ImageLayerTransformCommitModel;
  numericControls: string[];
}

export interface ImageLayerTransformSourceSafetySummary {
  smartSourceSafe: boolean;
  caveats: string[];
  smartObjectPreservation: 'native-smart-object-not-required' | 'metadata-only-not-native-smart-object';
  signature: string;
}

export type ImageLayerTransformUnsupportedModeParity =
  | 'bounded-numeric-metadata'
  | 'bounded-corner-offset-metadata'
  | 'bounded-mesh-preview';

export type ImageLayerTransformUnsupportedState =
  | 'photoshop-free-transform-skew-drag-handles'
  | 'photoshop-free-transform-distort-drag-handles'
  | 'split-plane-perspective-warp'
  | 'photoshop-weighted-puppet-mesh';

export type ImageLayerTransformUnsupportedBlockerCode =
  | 'photoshop-skew-handle-parity-unavailable'
  | 'photoshop-distort-handle-parity-unavailable'
  | 'photoshop-perspective-warp-parity-unavailable'
  | 'photoshop-warp-cage-parity-unavailable';

export interface ImageLayerTransformUnsupportedModeDescriptor {
  mode: Extract<ImageLayerFreeTransformMode, 'skew' | 'distort' | 'perspective' | 'warp'>;
  supported: boolean;
  parity: ImageLayerTransformUnsupportedModeParity;
  unsupportedStates: ImageLayerTransformUnsupportedState[];
  blockerCode: ImageLayerTransformUnsupportedBlockerCode;
  signature: string;
}

export interface ImageLayerTransformNormalizedState {
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  perspectiveX: number;
  perspectiveY: number;
  transformOriginX: number;
  transformOriginY: number;
  cornerOffsets: ImageLayerTransformCornerOffsets;
  warp: ImageLayerWarpOffsets;
}

export interface ImageLayerTransformReadinessDescriptor {
  descriptorId: 'image-layer-transform-readiness:v1';
  layerId: string;
  layerType: ImageLayer['type'];
  sourceKind: ImageLayerTransformCapabilitySetDescriptor['sourceKind'];
  sourceDimensions: ImageLayerTransformCapabilitySetDescriptor['sourceDimensions'];
  modeSummary: ImageLayerTransformReadinessModeSummary[];
  numericControls: ImageLayerTransformNumericControlDescriptor[];
  normalizedTransform: ImageLayerTransformNormalizedState;
  geometry: ImageLayerTransformGeometryDescriptor;
  pivot: ImageLayerTransformPivotDescriptor;
  previewState: ImageLayerTransformPreviewStateDescriptor;
  previewSession: ImageLayerTransformPreviewSessionDescriptor;
  handles: ImageLayerTransformHandleDescriptor[];
  supportMatrix: Record<'skew' | 'distort' | 'perspective' | 'warp', ImageLayerTransformReadinessSupportMatrixEntry>;
  sourceSafety: ImageLayerTransformSourceSafetySummary;
  sourceLinkedSummary: ImageLayerTransformSourceLinkedSummary;
  unsupportedModes: ImageLayerTransformUnsupportedModeDescriptor[];
  advancedDeformation: {
    perspective: {
      supported: boolean;
      actionSuitable: boolean;
      batchSuitable: boolean;
      previewSignature: string;
      exportSignature: string;
      unsupportedStates: Array<'split-plane-perspective-warp'>;
    };
    warp: {
      supported: boolean;
      actionSuitable: boolean;
      batchSuitable: boolean;
      previewSignature: string;
      exportSignature: string;
      unsupportedStates: Array<'photoshop-weighted-puppet-mesh'>;
    };
    workspace: {
      fullyInteractive: true;
      limitation: 'single-plane-and-regular-cage-deformation-workspace';
      unsupportedStates: Array<
        'split-plane-perspective-warp' | 'photoshop-weighted-puppet-mesh'
      >;
    };
    previewExportSignatures: {
      preview: string;
      export: string;
    };
  };
  exportCaveats: ImageLayerTransformWarning[];
  warnings: ImageLayerTransformWarning[];
  blockers: ImageLayerTransformReadinessBlocker[];
  handleSignature: string;
  preview: { id: string; signature: string };
}

const TRANSFORM_CAPABILITY_ORDER: ImageLayerTransformCapabilityKind[] = [
  'move',
  'scale',
  'rotate',
  'skew',
  'distort',
  'perspective',
  'warp',
];

export function clampImageLayerTransformOrigin(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TRANSFORM_ORIGIN;
  return Math.min(1, Math.max(0, Number(value)));
}

export function resolveImageLayerTransformOrigin(layer: Pick<ImageLayer, 'transformOriginX' | 'transformOriginY'>): ImageLayerTransformOrigin {
  return {
    x: clampImageLayerTransformOrigin(layer.transformOriginX),
    y: clampImageLayerTransformOrigin(layer.transformOriginY),
  };
}

export function getImageLayerPivotPoint(
  layer: Pick<ImageLayer, 'x' | 'y' | 'transformOriginX' | 'transformOriginY'>,
  size: { width: number; height: number } | null,
): ImageLayerPivotPoint | null {
  if (!size) return null;
  const origin = resolveImageLayerTransformOrigin(layer);
  return {
    ...origin,
    pivotX: layer.x + size.width * origin.x,
    pivotY: layer.y + size.height * origin.y,
  };
}

export function getImageLayerBitmapDrawMetrics(
  source: { width: number; height: number },
  layer: TransformLayerLike,
  offsetX = 0,
  offsetY = 0,
): ImageLayerBitmapDrawMetrics {
  const roundTransformNumber = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  };
  const normalizeRotation = (value: number | undefined): number => {
    if (!Number.isFinite(value)) return 0;
    let normalized = Number(value);
    while (normalized > 180) normalized -= 360;
    while (normalized <= -180) normalized += 360;
    return roundTransformNumber(normalized);
  };
  const normalizeSkew = (value: number | undefined): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-75, Math.min(75, roundTransformNumber(Number(value))));
  };
  const normalizePerspective = (value: number | undefined): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-0.95, Math.min(0.95, Math.round(Number(value) * 1000) / 1000));
  };
  const normalizeWarp = (value: number | undefined): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-1, Math.min(1, Math.round(Number(value) * 1000) / 1000));
  };
  const normalizePoint = (value: unknown): { x: number; y: number } => {
    const point = typeof value === 'object' && value !== null ? value as { x?: unknown; y?: unknown } : {};
    return {
      x: roundTransformNumber(typeof point.x === 'number' ? point.x : 0),
      y: roundTransformNumber(typeof point.y === 'number' ? point.y : 0),
    };
  };
  const normalizeCornerOffsetsLocal = (value: ImageLayerTransformCornerOffsets | undefined): ImageLayerTransformCornerOffsets => ({
    nw: normalizePoint(value?.nw),
    ne: normalizePoint(value?.ne),
    se: normalizePoint(value?.se),
    sw: normalizePoint(value?.sw),
  });
  const normalizeWarpLocal = (value: ImageLayerWarpOffsets | undefined): ImageLayerWarpOffsets => ({
    top: normalizeWarp(value?.top),
    right: normalizeWarp(value?.right),
    bottom: normalizeWarp(value?.bottom),
    left: normalizeWarp(value?.left),
  });
  const origin = resolveImageLayerTransformOrigin(layer);
  const baseWidth = (
    Number.isFinite(layer.baseWidth) && Number(layer.baseWidth) > 0
      ? Number(layer.baseWidth)
      : Number.isFinite(layer.bitmap?.width) && Number(layer.bitmap?.width) > 0
        ? Number(layer.bitmap?.width)
        : Math.max(1, source.width)
  );
  const baseHeight = (
    Number.isFinite(layer.baseHeight) && Number(layer.baseHeight) > 0
      ? Number(layer.baseHeight)
      : Number.isFinite(layer.bitmap?.height) && Number(layer.bitmap?.height) > 0
        ? Number(layer.bitmap?.height)
        : Math.max(1, source.height)
  );

  return {
    drawLeft: layer.x + offsetX,
    drawTop: layer.y + offsetY,
    drawWidth: source.width,
    drawHeight: source.height,
    pivotDocX: layer.x + baseWidth * origin.x,
    pivotDocY: layer.y + baseHeight * origin.y,
    sourcePivotX: baseWidth * origin.x - offsetX,
    sourcePivotY: baseHeight * origin.y - offsetY,
    originX: origin.x,
    originY: origin.y,
    rotationDeg: normalizeRotation(layer.rotationDeg),
    skewXDeg: normalizeSkew(layer.skewXDeg),
    skewYDeg: normalizeSkew(layer.skewYDeg),
    perspectiveX: normalizePerspective(layer.perspectiveX),
    perspectiveY: normalizePerspective(layer.perspectiveY),
    warp: normalizeWarpLocal(layer.warp),
    warpMesh: normalizeWarpMesh(layer.warpMesh),
    cornerOffsets: normalizeCornerOffsetsLocal(layer.cornerOffsets),
  };
}

export function describeImageLayerTransformCapabilities(
  layer: ImageLayer,
  options: ImageLayerTransformDescriptorOptions = {},
): ImageLayerTransformCapabilitySetDescriptor {
  const sourceKind = getLayerTransformSourceKind(layer);
  const sourceDimensions = getLayerTransformSourceDimensions(layer);
  const supported = Boolean(sourceDimensions && layer.type !== 'group' && !layer.locked && !layer.locks?.position);
  const warnings = getLayerTransformDescriptorWarnings(layer, options);
  const sourceLink = getLayerTransformSourceLinkDescriptor(layer);
  const capabilities = TRANSFORM_CAPABILITY_ORDER.map((kind) => (
    buildLayerTransformCapabilityDescriptor(kind, supported, options, sourceLink.smartSourceLike)
  ));
  const previewSignature = buildLayerTransformCapabilitiesPreviewSignature(
    layer,
    sourceKind,
    sourceDimensions,
    capabilities,
    warnings,
  );

  return {
    descriptorId: 'image-layer-transform-capabilities:v2',
    layerId: layer.id,
    layerType: layer.type,
    sourceKind,
    sourceDimensions,
    capabilities,
    sourceLink,
    supportMatrix: buildLayerTransformSupportMatrix(supported),
    transformStatus: buildLayerTransformSetStatus(capabilities),
    preview: {
      id: `image-layer-transform-capabilities:${layer.id}`,
      signature: previewSignature,
    },
    exportCaveats: getLayerTransformExportCaveats(sourceLink),
    warnings,
    previewSignature,
  };
}

export function buildImageLayerTransformReadiness(layer: ImageLayer): ImageLayerTransformReadinessDescriptor {
  const capabilities = describeImageLayerTransformCapabilities(layer, {
    requireSmartSourceSafe: true,
    requireNonDestructive: true,
  });
  const blockers = getLayerTransformReadinessBlockers(layer, capabilities);
  const normalizedTransform = buildLayerTransformReadinessNormalizedState(layer, capabilities.sourceDimensions);
  const geometry = buildLayerTransformReadinessGeometry(normalizedTransform);
  const pivot = buildLayerTransformReadinessPivot(normalizedTransform, layer.id);
  const modeSummary = buildLayerTransformReadinessModeSummary(capabilities, blockers);
  const numericControls = buildLayerTransformReadinessNumericControls(normalizedTransform, modeSummary);
  const handles = buildLayerTransformReadinessHandles(geometry, pivot, blockers);
  const supportMatrix = buildLayerTransformReadinessSupportMatrix(capabilities, blockers);
  const sourceSafety = buildLayerTransformReadinessSourceSafety(capabilities.capabilities);
  const sourceLinkedSummary = buildLayerTransformSourceLinkedSummary(capabilities.sourceLink);
  const unsupportedModes = buildLayerTransformUnsupportedModeDescriptors(supportMatrix);
  const commitModel = getLayerTransformReadinessCommitModel(capabilities.capabilities);
  const previewSession = buildLayerTransformReadinessPreviewSession(blockers);
  const warnings = [
    ...capabilities.warnings,
    ...capabilities.exportCaveats,
  ];
  const previewSignature = buildLayerTransformReadinessPreviewSignature({
    layerId: layer.id,
    layerType: layer.type,
    sourceKind: capabilities.sourceKind,
    sourceDimensions: capabilities.sourceDimensions,
    normalizedTransform,
    geometry,
    pivot,
    modeSummary,
    handles: handles.map((handle) => `${handle.id}:${handle.point.x ?? 'none'},${handle.point.y ?? 'none'}`),
    supportMatrix,
    sourceSafety,
    sourceSafetySignature: sourceSafety.signature,
    sourceLinkedSummary,
    unsupportedModeSignatures: unsupportedModes.map((mode) => mode.signature),
    blockers,
    warnings: warnings.map((warning) => warning.code),
    exportCaveats: capabilities.exportCaveats.map((warning) => warning.code),
  });
  const applyReady = blockers.length === 0;
  const handleSignature = buildLayerTransformHandleSignature(layer.id, handles);

  return {
    descriptorId: 'image-layer-transform-readiness:v1',
    layerId: layer.id,
    layerType: layer.type,
    sourceKind: capabilities.sourceKind,
    sourceDimensions: capabilities.sourceDimensions,
    modeSummary,
    numericControls,
    normalizedTransform,
    geometry,
    pivot,
    previewState: {
      active: applyReady,
      applyReady,
      cancelReady: true,
      commitModel,
      previewSignature,
      applySignature: `layer-transform-apply:v1|${layer.id}|ready=${applyReady}|commit=${commitModel}`,
      cancelSignature: `layer-transform-cancel:v1|${layer.id}|ready=true`,
    },
    previewSession,
    handles,
    supportMatrix,
    sourceSafety,
    sourceLinkedSummary,
    unsupportedModes,
    advancedDeformation: buildLayerTransformAdvancedDeformationDescriptor(layer.id, supportMatrix),
    exportCaveats: capabilities.exportCaveats,
    warnings,
    blockers,
    handleSignature,
    preview: {
      id: `image-layer-transform-readiness:${layer.id}`,
      signature: previewSignature,
    },
  };
}

function buildLayerTransformAdvancedDeformationDescriptor(
  layerId: string,
  supportMatrix: ImageLayerTransformReadinessDescriptor['supportMatrix'],
): ImageLayerTransformReadinessDescriptor['advancedDeformation'] {
  return {
    perspective: {
      supported: supportMatrix.perspective.supported,
      actionSuitable: supportMatrix.perspective.supported,
      batchSuitable: supportMatrix.perspective.supported,
      previewSignature: `layer-transform-advanced-preview:v1:${layerId}:perspective`,
      exportSignature: `layer-transform-advanced-export:v1:${layerId}:perspective:flattened-render`,
      unsupportedStates: ['split-plane-perspective-warp'],
    },
    warp: {
      supported: supportMatrix.warp.supported,
      actionSuitable: supportMatrix.warp.supported,
      batchSuitable: supportMatrix.warp.supported,
      previewSignature: `layer-transform-advanced-preview:v1:${layerId}:warp`,
      exportSignature: `layer-transform-advanced-export:v1:${layerId}:warp:flattened-render`,
      unsupportedStates: ['photoshop-weighted-puppet-mesh'],
    },
    workspace: {
      fullyInteractive: true,
      limitation: 'single-plane-and-regular-cage-deformation-workspace',
      unsupportedStates: [
        'split-plane-perspective-warp',
        'photoshop-weighted-puppet-mesh',
      ],
    },
    previewExportSignatures: {
      preview: `layer-transform-advanced-readiness-preview:v1:${layerId}:perspective|warp`,
      export: `layer-transform-advanced-readiness-export:v1:${layerId}:flattened-render`,
    },
  };
}

export function drawLayerBitmapTransformed(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  layer: TransformLayerLike,
  offsetX = 0,
  offsetY = 0,
): void {
  const metrics = getImageLayerBitmapDrawMetrics(
    source as { width: number; height: number },
    layer,
    offsetX,
    offsetY,
  );
  const corners = buildTransformedCornersFromMetrics(metrics);
  const getWidth = () => ('width' in source && typeof source.width === 'number' ? source.width : 0);
  const getHeight = () => ('height' in source && typeof source.height === 'number' ? source.height : 0);
  const cornersFormParallelogram = () => {
    const expectedSe = {
      x: corners.ne.x + corners.sw.x - corners.nw.x,
      y: corners.ne.y + corners.sw.y - corners.nw.y,
    };
    return Math.abs(expectedSe.x - corners.se.x) < 0.01 && Math.abs(expectedSe.y - corners.se.y) < 0.01;
  };
  const drawParallelogram = () => {
    const width = getWidth();
    const height = getHeight();
    if (width <= 0 || height <= 0) return;
    ctx.transform(
      (corners.ne.x - corners.nw.x) / width,
      (corners.ne.y - corners.nw.y) / width,
      (corners.sw.x - corners.nw.x) / height,
      (corners.sw.y - corners.nw.y) / height,
      corners.nw.x,
      corners.nw.y,
    );
    ctx.drawImage(source, 0, 0);
  };
  const getTriangleAffineTransform = (
    sourceTriangle: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
    destinationTriangle: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  ): { a: number; b: number; c: number; d: number; e: number; f: number } | null => {
    const [s0, s1, s2] = sourceTriangle;
    const [d0, d1, d2] = destinationTriangle;
    const determinant = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
    if (Math.abs(determinant) < 1e-8) return null;
    return {
      a: (
        d0.x * (s1.y - s2.y) +
        d1.x * (s2.y - s0.y) +
        d2.x * (s0.y - s1.y)
      ) / determinant,
      b: (
        d0.y * (s1.y - s2.y) +
        d1.y * (s2.y - s0.y) +
        d2.y * (s0.y - s1.y)
      ) / determinant,
      c: (
        d0.x * (s2.x - s1.x) +
        d1.x * (s0.x - s2.x) +
        d2.x * (s1.x - s0.x)
      ) / determinant,
      d: (
        d0.y * (s2.x - s1.x) +
        d1.y * (s0.x - s2.x) +
        d2.y * (s1.x - s0.x)
      ) / determinant,
      e: (
        d0.x * (s1.x * s2.y - s2.x * s1.y) +
        d1.x * (s2.x * s0.y - s0.x * s2.y) +
        d2.x * (s0.x * s1.y - s1.x * s0.y)
      ) / determinant,
      f: (
        d0.y * (s1.x * s2.y - s2.x * s1.y) +
        d1.y * (s2.x * s0.y - s0.x * s2.y) +
        d2.y * (s0.x * s1.y - s1.x * s0.y)
      ) / determinant,
    };
  };
  const drawTriangle = (
    sourceTriangle: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
    destinationTriangle: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  ) => {
    const matrix = getTriangleAffineTransform(sourceTriangle, destinationTriangle);
    if (!matrix) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(destinationTriangle[0].x, destinationTriangle[0].y);
    ctx.lineTo(destinationTriangle[1].x, destinationTriangle[1].y);
    ctx.lineTo(destinationTriangle[2].x, destinationTriangle[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  };
  const drawQuadrilateral = () => {
    const width = getWidth();
    const height = getHeight();
    if (width <= 0 || height <= 0) return;
    drawTriangle(
      [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }],
      [corners.nw, corners.ne, corners.se],
    );
    drawTriangle(
      [{ x: 0, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
      [corners.nw, corners.se, corners.sw],
    );
  };
  const drawWarpMesh = () => {
    const width = getWidth();
    const height = getHeight();
    if (width <= 0 || height <= 0) return;
    const columns = Math.max(6, Math.ceil(width / 48));
    const rows = Math.max(6, Math.ceil(height / 48));
    for (let row = 0; row < rows; row += 1) {
      const y0 = (row / rows) * height;
      const y1 = ((row + 1) / rows) * height;
      for (let column = 0; column < columns; column += 1) {
        const x0 = (column / columns) * width;
        const x1 = ((column + 1) / columns) * width;
        const p00 = transformSourcePoint(metrics, x0, y0);
        const p10 = transformSourcePoint(metrics, x1, y0);
        const p11 = transformSourcePoint(metrics, x1, y1);
        const p01 = transformSourcePoint(metrics, x0, y1);
        drawTriangle(
          [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }],
          [p00, p10, p11],
        );
        drawTriangle(
          [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
          [p00, p11, p01],
        );
      }
    }
  };
  const hasRotation = metrics.rotationDeg !== 0;
  const hasSkew = metrics.skewXDeg !== 0 || metrics.skewYDeg !== 0;
  const hasPerspective = metrics.perspectiveX !== 0 || metrics.perspectiveY !== 0;
  const hasWarp = hasImageLayerWarp(metrics.warp) || isWarpMeshDeformed(metrics.warpMesh);
  const hasDistort = (['nw', 'ne', 'se', 'sw'] as ImageLayerTransformCorner[]).some((corner) => (
    metrics.cornerOffsets[corner].x !== 0 || metrics.cornerOffsets[corner].y !== 0
  ));

  ctx.save();
  if (!hasRotation && !hasSkew && !hasPerspective && !hasWarp && !hasDistort) {
    ctx.drawImage(source, metrics.drawLeft, metrics.drawTop);
  } else if (hasWarp) {
    drawWarpMesh();
  } else if ((!hasDistort && !hasPerspective) || cornersFormParallelogram()) {
    drawParallelogram();
  } else {
    drawQuadrilateral();
  }
  ctx.restore();
}

export function rasterizeLayerBitmapTransformed(
  source: LayerBitmap,
  layer: TransformLayerLike,
  offsetX = 0,
  offsetY = 0,
): { bitmap: LayerBitmap; left: number; top: number } {
  const bounds = getImageLayerBitmapTransformedBounds(source, layer, offsetX, offsetY);
  const bitmap = createBitmap(bounds.width, bounds.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for transformed layer rasterization');
  }
  ctx.translate(-bounds.left, -bounds.top);
  drawLayerBitmapTransformed(ctx, source, layer, offsetX, offsetY);
  return {
    bitmap,
    left: bounds.left,
    top: bounds.top,
  };
}

/**
 * A4 authority path for destructive scale/crop commits. The UI may keep a
 * metadata preview, but a native-depth layer must call this helper when it
 * commits raster geometry; it never round-trips through the 8-bit canvas.
 */
export function resampleLayerPixelAuthority(
  layer: Pick<ImageLayer, 'pixels'>,
  width: number,
  height: number,
  filter: ResampleFilter = 'bilinear',
): PixelBuffer | null {
  return layer.pixels ? resamplePixelBuffer(layer.pixels, width, height, filter) : null;
}

export function getImageLayerBitmapTransformedBounds(
  source: { width: number; height: number },
  layer: TransformLayerLike,
  offsetX = 0,
  offsetY = 0,
): { left: number; top: number; width: number; height: number } {
  const metrics = getImageLayerBitmapDrawMetrics(source, layer, offsetX, offsetY);
  const points = hasImageLayerWarp(metrics.warp)
    ? sampleTransformedBorderPoints(metrics)
    : Object.values(buildTransformedCornersFromMetrics(metrics));
  const xs = points.map((corner) => corner.x);
  const ys = points.map((corner) => corner.y);
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  const right = Math.ceil(Math.max(...xs));
  const bottom = Math.ceil(Math.max(...ys));

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function buildTransformedCornersFromMetrics(
  metrics: ImageLayerBitmapDrawMetrics,
): Record<ImageLayerTransformCorner, { x: number; y: number }> {
  return {
    nw: transformSourcePoint(metrics, 0, 0),
    ne: transformSourcePoint(metrics, metrics.drawWidth, 0),
    se: transformSourcePoint(metrics, metrics.drawWidth, metrics.drawHeight),
    sw: transformSourcePoint(metrics, 0, metrics.drawHeight),
  };
}

export function roundImageLayerTransformNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function sampleTransformedBorderPoints(
  metrics: ImageLayerBitmapDrawMetrics,
  segments = 16,
): Array<{ x: number; y: number }> {
  const safeSegments = Math.max(1, segments);
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= safeSegments; index += 1) {
    points.push(transformSourcePoint(metrics, (index / safeSegments) * metrics.drawWidth, 0));
  }
  for (let index = 1; index <= safeSegments; index += 1) {
    points.push(transformSourcePoint(metrics, metrics.drawWidth, (index / safeSegments) * metrics.drawHeight));
  }
  for (let index = safeSegments - 1; index >= 0; index -= 1) {
    points.push(transformSourcePoint(metrics, (index / safeSegments) * metrics.drawWidth, metrics.drawHeight));
  }
  for (let index = safeSegments - 1; index >= 1; index -= 1) {
    points.push(transformSourcePoint(metrics, 0, (index / safeSegments) * metrics.drawHeight));
  }
  return points;
}

export function transformSourcePoint(
  metrics: ImageLayerBitmapDrawMetrics,
  sourceX: number,
  sourceY: number,
): { x: number; y: number } {
  const u = metrics.drawWidth > 0 ? sourceX / metrics.drawWidth : 0;
  const v = metrics.drawHeight > 0 ? sourceY / metrics.drawHeight : 0;
  const local = {
    x: sourceX - metrics.sourcePivotX,
    y: sourceY - metrics.sourcePivotY,
  };
  // Control-point warp mesh deforms the layer in its own (source-local) space before the
  // affine transforms; displacement is normalized to the layer dimensions.
  if (metrics.warpMesh && isWarpMeshDeformed(metrics.warpMesh)) {
    const displacement = sampleWarpMeshDisplacement(metrics.warpMesh, u, v);
    local.x += displacement.x * metrics.drawWidth;
    local.y += displacement.y * metrics.drawHeight;
  }
  const warped = applyWarpToPoint(local, metrics.drawWidth, metrics.drawHeight, u, v, metrics.warp);
  const perspectiveAdjusted = applyPerspectiveToPoint(
    warped,
    metrics.drawWidth,
    metrics.drawHeight,
    u,
    v,
    metrics.perspectiveX,
    metrics.perspectiveY,
  );
  const skewX = Math.tan((metrics.skewXDeg * Math.PI) / 180);
  const skewY = Math.tan((metrics.skewYDeg * Math.PI) / 180);
  const skewedX = perspectiveAdjusted.x + skewX * perspectiveAdjusted.y;
  const skewedY = perspectiveAdjusted.y + skewY * perspectiveAdjusted.x;
  const radians = (metrics.rotationDeg * Math.PI) / 180;
  const rotatedX = skewedX * Math.cos(radians) - skewedY * Math.sin(radians);
  const rotatedY = skewedX * Math.sin(radians) + skewedY * Math.cos(radians);
  const offset = interpolateCornerOffset(metrics.cornerOffsets, u, v);
  return {
    x: roundImageLayerTransformNumber(metrics.pivotDocX + rotatedX + offset.x),
    y: roundImageLayerTransformNumber(metrics.pivotDocY + rotatedY + offset.y),
  };
}

export function applyWarpToPoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  u: number,
  v: number,
  warp: ImageLayerWarpOffsets,
): { x: number; y: number } {
  const edgeCurveX = 4 * u * (1 - u);
  const edgeCurveY = 4 * v * (1 - v);
  return {
    x: point.x + width * 0.5 * edgeCurveY * (warp.right * u - warp.left * (1 - u)),
    y: point.y + height * 0.5 * edgeCurveX * (warp.bottom * v - warp.top * (1 - v)),
  };
}

export function applyPerspectiveToPoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  u: number,
  v: number,
  perspectiveX: number,
  perspectiveY: number,
): { x: number; y: number } {
  const xNorm = u * 2 - 1;
  const yNorm = v * 2 - 1;
  const factor = xNorm * yNorm;
  return {
    x: point.x + (width / 2) * perspectiveX * factor,
    y: point.y + (height / 2) * perspectiveY * factor,
  };
}

export function interpolateCornerOffset(
  offsets: ImageLayerTransformCornerOffsets,
  u: number,
  v: number,
): { x: number; y: number } {
  const top = {
    x: offsets.nw.x + (offsets.ne.x - offsets.nw.x) * u,
    y: offsets.nw.y + (offsets.ne.y - offsets.nw.y) * u,
  };
  const bottom = {
    x: offsets.sw.x + (offsets.se.x - offsets.sw.x) * u,
    y: offsets.sw.y + (offsets.se.y - offsets.sw.y) * u,
  };
  return {
    x: roundImageLayerTransformNumber(top.x + (bottom.x - top.x) * v),
    y: roundImageLayerTransformNumber(top.y + (bottom.y - top.y) * v),
  };
}

export function hasImageLayerWarp(warp: ImageLayerWarpOffsets): boolean {
  return warp.top !== 0 || warp.right !== 0 || warp.bottom !== 0 || warp.left !== 0;
}

function buildLayerTransformCapabilityDescriptor(
  kind: ImageLayerTransformCapabilityKind,
  supported: boolean,
  options: ImageLayerTransformDescriptorOptions,
  smartSourceLike: boolean,
): ImageLayerTransformCapabilityDescriptor {
  const scaleWarning = kind === 'scale' && options.requireNonDestructive
    ? [createLayerTransformWarning('destructive-scale-rasterization')]
    : [];
  const transformStatus = getLayerTransformCapabilityStatus(kind);
  return {
    kind,
    label: transformCapabilityLabel(kind),
    supported,
    nonDestructive: transformStatus.nonDestructive,
    undoOperation: transformStatus.commitModel === 'rasterize-layer-operation' ? 'layerOp' : 'transform',
    previewKind: transformCapabilityPreviewKind(kind),
    handleCount: transformCapabilityHandleCount(kind),
    numericFields: transformCapabilityNumericFields(kind),
    transformStatus,
    sourceSafety: getLayerTransformCapabilitySourceSafety(kind, smartSourceLike),
    warnings: scaleWarning,
  };
}

function getLayerTransformCapabilityStatus(
  kind: ImageLayerTransformCapabilityKind,
): ImageLayerTransformStatusDescriptor {
  const destructive = kind === 'scale';
  return {
    destructive,
    nonDestructive: !destructive,
    rasterizesOnApply: destructive,
    commitModel: destructive ? 'rasterize-layer-operation' : 'metadata',
  };
}

function getLayerTransformCapabilitySourceSafety(
  kind: ImageLayerTransformCapabilityKind,
  smartSourceLike: boolean,
): ImageLayerTransformSourceSafetyDescriptor {
  const limitationCodes: string[] = [];
  if (smartSourceLike) limitationCodes.push('smart-source-transform-not-retained');
  if (kind === 'scale') limitationCodes.push('scale-commits-raster-resample');
  return {
    smartSourceSafe: limitationCodes.length === 0,
    limitationCodes,
  };
}

function buildLayerTransformSupportMatrix(
  supported: boolean,
): ImageLayerTransformCapabilitySetDescriptor['supportMatrix'] {
  return {
    pivot: { supported, commitModel: 'metadata' },
    skew: { supported, commitModel: 'metadata' },
    distort: { supported, commitModel: 'metadata' },
    perspective: { supported, commitModel: 'metadata' },
    warp: { supported, commitModel: 'metadata' },
  };
}

function buildLayerTransformSetStatus(
  capabilities: ImageLayerTransformCapabilityDescriptor[],
): ImageLayerTransformSetStatusDescriptor {
  const destructiveCapabilities = capabilities
    .filter((capability) => capability.transformStatus.destructive)
    .map((capability) => capability.kind);
  return {
    destructive: false,
    nonDestructive: true,
    destructiveCapabilities,
    metadataOnlyCapabilities: capabilities
      .filter((capability) => capability.transformStatus.commitModel === 'metadata')
      .map((capability) => capability.kind),
  };
}

function getLayerTransformReadinessBlockers(
  layer: ImageLayer,
  capabilities: ImageLayerTransformCapabilitySetDescriptor,
): ImageLayerTransformReadinessBlocker[] {
  const blockers: ImageLayerTransformReadinessBlocker[] = [];
  if (layer.locked) blockers.push('layer-locked');
  if (layer.locks?.position) blockers.push('position-locked');
  if (layer.type === 'group') blockers.push('group-layer-unsupported');
  if (!capabilities.sourceDimensions) blockers.push('missing-transform-source');
  if (capabilities.sourceLink.status === 'missing') blockers.push('source-link-missing');
  return blockers;
}

function buildLayerTransformReadinessNormalizedState(
  layer: ImageLayer,
  sourceDimensions: ImageLayerTransformCapabilitySetDescriptor['sourceDimensions'],
): ImageLayerTransformNormalizedState {
  const metrics = getImageLayerBitmapDrawMetrics(sourceDimensions ?? { width: 1, height: 1 }, layer);
  return {
    x: roundImageLayerTransformNumber(layer.x),
    y: roundImageLayerTransformNumber(layer.y),
    width: sourceDimensions?.width ?? null,
    height: sourceDimensions?.height ?? null,
    rotationDeg: metrics.rotationDeg,
    skewXDeg: metrics.skewXDeg,
    skewYDeg: metrics.skewYDeg,
    perspectiveX: metrics.perspectiveX,
    perspectiveY: metrics.perspectiveY,
    transformOriginX: metrics.originX,
    transformOriginY: metrics.originY,
    cornerOffsets: metrics.cornerOffsets,
    warp: metrics.warp,
  };
}

function buildLayerTransformReadinessGeometry(
  transform: ImageLayerTransformNormalizedState,
): ImageLayerTransformGeometryDescriptor {
  const centerX = transform.width === null ? null : roundImageLayerTransformNumber(transform.x + transform.width / 2);
  const centerY = transform.height === null ? null : roundImageLayerTransformNumber(transform.y + transform.height / 2);
  const pivotX = transform.width === null ? null : roundImageLayerTransformNumber(transform.x + transform.width * transform.transformOriginX);
  const pivotY = transform.height === null ? null : roundImageLayerTransformNumber(transform.y + transform.height * transform.transformOriginY);
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    centerX,
    centerY,
    pivotX,
    pivotY,
  };
}

function buildLayerTransformReadinessPivot(
  transform: ImageLayerTransformNormalizedState,
  layerId = 'unknown',
): ImageLayerTransformPivotDescriptor {
  const sourceX = transform.width === null ? null : roundImageLayerTransformNumber(transform.width * transform.transformOriginX);
  const sourceY = transform.height === null ? null : roundImageLayerTransformNumber(transform.height * transform.transformOriginY);
  const docX = sourceX === null ? null : roundImageLayerTransformNumber(transform.x + sourceX);
  const docY = sourceY === null ? null : roundImageLayerTransformNumber(transform.y + sourceY);
  return {
    originX: transform.transformOriginX,
    originY: transform.transformOriginY,
    sourceX,
    sourceY,
    docX,
    docY,
    signature: `layer-transform-pivot:v1|${layerId}|origin=${transform.transformOriginX},${transform.transformOriginY}|source=${sourceX ?? 'none'},${sourceY ?? 'none'}|doc=${docX ?? 'none'},${docY ?? 'none'}`,
  };
}

function buildLayerTransformReadinessPreviewSession(
  blockers: ImageLayerTransformReadinessBlocker[],
): ImageLayerTransformPreviewSessionDescriptor {
  return {
    sessionType: 'layer-transform',
    active: blockers.length === 0,
    applyReady: blockers.length === 0,
    cancelReady: true,
    applyCommand: 'Enter',
    cancelCommand: 'Escape',
  };
}

function buildLayerTransformReadinessHandles(
  geometry: ImageLayerTransformGeometryDescriptor,
  pivot: ImageLayerTransformPivotDescriptor,
  blockers: ImageLayerTransformReadinessBlocker[],
): ImageLayerTransformHandleDescriptor[] {
  const visible = blockers.length === 0 && geometry.width !== null && geometry.height !== null;
  return [
    {
      id: 'rotate-handle',
      kind: 'rotate',
      mode: 'rotate',
      anchor: 'top-center-outside',
      visible,
      point: {
        x: geometry.centerX,
        y: roundImageLayerTransformNumber(geometry.y - 24),
      },
      numericControls: ['rotationDeg', 'transformOriginX', 'transformOriginY'],
    },
    {
      id: 'pivot-handle',
      kind: 'pivot',
      mode: 'pivot',
      anchor: 'pivot-origin',
      visible,
      point: {
        x: pivot.docX,
        y: pivot.docY,
      },
      numericControls: ['transformOriginX', 'transformOriginY'],
    },
  ];
}

function buildLayerTransformReadinessSupportMatrix(
  capabilities: ImageLayerTransformCapabilitySetDescriptor,
  blockers: ImageLayerTransformReadinessBlocker[],
): ImageLayerTransformReadinessDescriptor['supportMatrix'] {
  const unblocked = blockers.length === 0;
  return {
    skew: buildLayerTransformReadinessSupportEntry('skew', capabilities, unblocked),
    distort: buildLayerTransformReadinessSupportEntry('distort', capabilities, unblocked),
    perspective: buildLayerTransformReadinessSupportEntry('perspective', capabilities, unblocked),
    warp: buildLayerTransformReadinessSupportEntry('warp', capabilities, unblocked),
  };
}

function buildLayerTransformReadinessSupportEntry(
  kind: Extract<ImageLayerTransformCapabilityKind, 'skew' | 'distort' | 'perspective' | 'warp'>,
  capabilities: ImageLayerTransformCapabilitySetDescriptor,
  unblocked: boolean,
): ImageLayerTransformReadinessSupportMatrixEntry {
  const capability = capabilities.capabilities.find((entry) => entry.kind === kind);
  return {
    supported: Boolean(unblocked && capability?.supported),
    previewKind: capability?.previewKind ?? 'metadata',
    commitModel: capability?.transformStatus.commitModel ?? 'metadata',
    numericControls: capability?.numericFields ?? [],
  };
}

function buildLayerTransformReadinessSourceSafety(
  capabilities: ImageLayerTransformCapabilityDescriptor[],
): ImageLayerTransformSourceSafetySummary {
  const caveats = capabilities.flatMap((capability) => capability.sourceSafety.limitationCodes)
    .filter((code, index, allCodes) => allCodes.indexOf(code) === index);
  const smartSourceSafe = capabilities.every((capability) => capability.sourceSafety.smartSourceSafe);
  const smartObjectPreservation = smartSourceSafe
    ? 'native-smart-object-not-required'
    : 'metadata-only-not-native-smart-object';
  return {
    smartSourceSafe,
    caveats,
    smartObjectPreservation,
    signature: `layer-transform-source-safety:v1|smart=${smartSourceSafe}|caveats=${caveats.length > 0 ? caveats.join(',') : 'none'}|smart-object=${smartObjectPreservation}`,
  };
}

function buildLayerTransformUnsupportedModeDescriptors(
  supportMatrix: ImageLayerTransformReadinessDescriptor['supportMatrix'],
): ImageLayerTransformUnsupportedModeDescriptor[] {
  return [
    buildLayerTransformUnsupportedModeDescriptor({
      mode: 'skew',
      supported: supportMatrix.skew.supported,
      parity: 'bounded-numeric-metadata',
      unsupportedStates: ['photoshop-free-transform-skew-drag-handles'],
      blockerCode: 'photoshop-skew-handle-parity-unavailable',
    }),
    buildLayerTransformUnsupportedModeDescriptor({
      mode: 'distort',
      supported: supportMatrix.distort.supported,
      parity: 'bounded-corner-offset-metadata',
      unsupportedStates: ['photoshop-free-transform-distort-drag-handles'],
      blockerCode: 'photoshop-distort-handle-parity-unavailable',
    }),
    buildLayerTransformUnsupportedModeDescriptor({
      mode: 'perspective',
      supported: supportMatrix.perspective.supported,
      parity: 'bounded-numeric-metadata',
      unsupportedStates: ['split-plane-perspective-warp'],
      blockerCode: 'photoshop-perspective-warp-parity-unavailable',
    }),
    buildLayerTransformUnsupportedModeDescriptor({
      mode: 'warp',
      supported: supportMatrix.warp.supported,
      parity: 'bounded-mesh-preview',
      unsupportedStates: ['photoshop-weighted-puppet-mesh'],
      blockerCode: 'photoshop-warp-cage-parity-unavailable',
    }),
  ];
}

function buildLayerTransformUnsupportedModeDescriptor({
  mode,
  supported,
  parity,
  unsupportedStates,
  blockerCode,
}: Omit<ImageLayerTransformUnsupportedModeDescriptor, 'signature'>): ImageLayerTransformUnsupportedModeDescriptor {
  return {
    mode,
    supported,
    parity,
    unsupportedStates,
    blockerCode,
    signature: `layer-transform-unsupported:v1|${mode}|supported=${supported}|parity=${parity}|states=${unsupportedStates.join(',')}`,
  };
}

function buildLayerTransformHandleSignature(
  layerId: string,
  handles: ImageLayerTransformHandleDescriptor[],
): string {
  return [
    'layer-transform-handles:v1',
    layerId,
    ...handles.map((handle) => `${handle.id}:${handle.point.x ?? 'none'},${handle.point.y ?? 'none'}:visible=${handle.visible}`),
  ].join('|');
}

function buildLayerTransformReadinessModeSummary(
  capabilities: ImageLayerTransformCapabilitySetDescriptor,
  blockers: ImageLayerTransformReadinessBlocker[],
): ImageLayerTransformReadinessModeSummary[] {
  const ready = blockers.length === 0;
  return [
    buildLayerTransformReadinessMode('move', capabilities.capabilities.find((capability) => capability.kind === 'move'), ready),
    buildLayerTransformReadinessMode('resize', capabilities.capabilities.find((capability) => capability.kind === 'scale'), ready),
    buildLayerTransformReadinessMode('rotate', capabilities.capabilities.find((capability) => capability.kind === 'rotate'), ready),
    {
      mode: 'pivot',
      ready: ready && capabilities.supportMatrix.pivot.supported,
      previewKind: 'metadata',
      numericControls: ['transformOriginX', 'transformOriginY'],
    },
    buildLayerTransformReadinessMode('skew', capabilities.capabilities.find((capability) => capability.kind === 'skew'), ready),
    buildLayerTransformReadinessMode('distort', capabilities.capabilities.find((capability) => capability.kind === 'distort'), ready),
    buildLayerTransformReadinessMode('perspective', capabilities.capabilities.find((capability) => capability.kind === 'perspective'), ready),
    buildLayerTransformReadinessMode('warp', capabilities.capabilities.find((capability) => capability.kind === 'warp'), ready),
  ];
}

function buildLayerTransformReadinessMode(
  mode: ImageLayerFreeTransformMode,
  capability: ImageLayerTransformCapabilityDescriptor | undefined,
  unblocked: boolean,
): ImageLayerTransformReadinessModeSummary {
  return {
    mode,
    ready: Boolean(unblocked && capability?.supported),
    previewKind: capability?.previewKind ?? 'metadata',
    numericControls: capability?.numericFields ?? [],
  };
}

function buildLayerTransformReadinessNumericControls(
  normalizedTransform: ImageLayerTransformNormalizedState,
  modeSummary: ImageLayerTransformReadinessModeSummary[],
): ImageLayerTransformNumericControlDescriptor[] {
  const availableControls = new Set(modeSummary.flatMap((mode) => mode.numericControls));
  return [
    buildLayerTransformNumericControl('x', 'X', normalizedTransform.x, 0, null, 1, 'px', availableControls),
    buildLayerTransformNumericControl('y', 'Y', normalizedTransform.y, 0, null, 1, 'px', availableControls),
    buildLayerTransformNumericControl('width', 'Width', normalizedTransform.width, 1, null, 1, 'px', availableControls),
    buildLayerTransformNumericControl('height', 'Height', normalizedTransform.height, 1, null, 1, 'px', availableControls),
    buildLayerTransformNumericControl('rotationDeg', 'Rotation', normalizedTransform.rotationDeg, -180, 180, 0.01, 'deg', availableControls),
    buildLayerTransformNumericControl('transformOriginX', 'Pivot X', normalizedTransform.transformOriginX, 0, 1, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('transformOriginY', 'Pivot Y', normalizedTransform.transformOriginY, 0, 1, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('skewXDeg', 'Skew X', normalizedTransform.skewXDeg, -75, 75, 0.01, 'deg', availableControls),
    buildLayerTransformNumericControl('skewYDeg', 'Skew Y', normalizedTransform.skewYDeg, -75, 75, 0.01, 'deg', availableControls),
    buildLayerTransformNumericControl('cornerOffsets', 'Corner offsets', null, null, null, 0.01, 'px', availableControls),
    buildLayerTransformNumericControl('perspectiveX', 'Perspective X', normalizedTransform.perspectiveX, -0.95, 0.95, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('perspectiveY', 'Perspective Y', normalizedTransform.perspectiveY, -0.95, 0.95, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('warp.top', 'Warp top', normalizedTransform.warp.top, -1, 1, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('warp.right', 'Warp right', normalizedTransform.warp.right, -1, 1, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('warp.bottom', 'Warp bottom', normalizedTransform.warp.bottom, -1, 1, 0.001, 'ratio', availableControls),
    buildLayerTransformNumericControl('warp.left', 'Warp left', normalizedTransform.warp.left, -1, 1, 0.001, 'ratio', availableControls),
  ];
}

function buildLayerTransformNumericControl(
  id: string,
  label: string,
  value: number | null,
  min: number | null,
  max: number | null,
  step: number,
  unit: ImageLayerTransformNumericControlDescriptor['unit'],
  availableControls: Set<string>,
): ImageLayerTransformNumericControlDescriptor {
  return {
    id,
    label,
    available: availableControls.has(id),
    value,
    min,
    max,
    step,
    unit,
  };
}

function buildLayerTransformSourceLinkedSummary(
  sourceLink: ImageLayerTransformSourceLinkDescriptor,
): ImageLayerTransformSourceLinkedSummary {
  const caveats: string[] = [];
  if (sourceLink.status === 'missing') caveats.push('source-link-missing');
  if (sourceLink.linked) {
    caveats.push('smart-object-transform-not-native', 'smart-filters-not-retained');
  }
  return {
    linked: sourceLink.linked,
    smartObjectParity: sourceLink.linked ? 'metadata-only' : 'not-linked',
    sourceId: sourceLink.sourceId,
    label: sourceLink.label,
    status: sourceLink.status,
    caveats,
  };
}

function getLayerTransformReadinessCommitModel(
  capabilities: ImageLayerTransformCapabilityDescriptor[],
): ImageLayerTransformReadinessCommitModel {
  const commitModels = new Set(capabilities.map((capability) => capability.transformStatus.commitModel));
  if (commitModels.size > 1) return 'mixed-metadata-and-rasterize';
  return capabilities[0]?.transformStatus.commitModel ?? 'metadata';
}

function buildLayerTransformReadinessPreviewSignature(payload: {
  layerId: string;
  layerType: ImageLayer['type'];
  sourceKind: ImageLayerTransformCapabilitySetDescriptor['sourceKind'];
  sourceDimensions: ImageLayerTransformCapabilitySetDescriptor['sourceDimensions'];
  normalizedTransform: ImageLayerTransformNormalizedState;
  geometry: ImageLayerTransformGeometryDescriptor;
  pivot: ImageLayerTransformPivotDescriptor;
  modeSummary: ImageLayerTransformReadinessModeSummary[];
  handles: string[];
  supportMatrix: ImageLayerTransformReadinessDescriptor['supportMatrix'];
  sourceSafety: ImageLayerTransformSourceSafetySummary;
  sourceSafetySignature: string;
  sourceLinkedSummary: ImageLayerTransformSourceLinkedSummary;
  unsupportedModeSignatures: string[];
  blockers: ImageLayerTransformReadinessBlocker[];
  warnings: ImageLayerTransformWarningCode[];
  exportCaveats: ImageLayerTransformWarningCode[];
}): string {
  return `layer-transform-readiness:v1:${JSON.stringify(payload)}`;
}

function getLayerTransformSourceLinkDescriptor(layer: ImageLayer): ImageLayerTransformSourceLinkDescriptor {
  const sourceLink = layer.metadata?.sourceLink;
  const sourceId = sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? null;
  const linked = Boolean(sourceId);
  return {
    linked,
    smartSourceLike: linked,
    sourceId,
    label: sourceLink?.label ?? layer.metadata?.sourceLabel ?? null,
    status: sourceLink?.status ?? (linked ? 'linked' : 'unlinked'),
    smartSourceSafe: !linked,
  };
}

function getLayerTransformExportCaveats(
  sourceLink: ImageLayerTransformSourceLinkDescriptor,
): ImageLayerTransformWarning[] {
  const caveats: ImageLayerTransformWarning[] = [
    createLayerTransformWarning('export-rasterizes-transform-preview'),
  ];
  if (sourceLink.linked) {
    caveats.push(createLayerTransformWarning('source-link-retained-transform-not-smart-object'));
  }
  return caveats;
}

function buildLayerTransformCapabilitiesPreviewSignature(
  layer: ImageLayer,
  sourceKind: ImageLayerTransformCapabilitySetDescriptor['sourceKind'],
  sourceDimensions: ImageLayerTransformCapabilitySetDescriptor['sourceDimensions'],
  capabilities: ImageLayerTransformCapabilityDescriptor[],
  warnings: ImageLayerTransformWarning[],
): string {
  return `layer-transform-capabilities:v1:${JSON.stringify({
    layerId: layer.id,
    layerType: layer.type,
    sourceKind,
    sourceDimensions,
    transform: buildLayerTransformSignatureState(layer, sourceDimensions),
    capabilities: capabilities.map((capability) => ({
      kind: capability.kind,
      supported: capability.supported,
      nonDestructive: capability.nonDestructive,
      undoOperation: capability.undoOperation,
      previewKind: capability.previewKind,
    })),
    warnings: warnings.map((warning) => warning.code),
  })}`;
}

function buildLayerTransformSignatureState(
  layer: ImageLayer,
  sourceDimensions: ImageLayerTransformCapabilitySetDescriptor['sourceDimensions'],
) {
  const metrics = getImageLayerBitmapDrawMetrics(sourceDimensions ?? { width: 1, height: 1 }, layer);
  return {
    x: layer.x,
    y: layer.y,
    rotationDeg: metrics.rotationDeg,
    skewXDeg: metrics.skewXDeg,
    skewYDeg: metrics.skewYDeg,
    perspectiveX: metrics.perspectiveX,
    perspectiveY: metrics.perspectiveY,
    warp: metrics.warp,
    cornerOffsets: metrics.cornerOffsets,
    transformOriginX: metrics.originX,
    transformOriginY: metrics.originY,
  };
}

function getLayerTransformDescriptorWarnings(
  layer: ImageLayer,
  options: ImageLayerTransformDescriptorOptions,
): ImageLayerTransformWarning[] {
  const warnings: ImageLayerTransformWarning[] = [];
  if (options.requireSmartSourceSafe && hasSmartSourceMetadata(layer)) {
    warnings.push(createLayerTransformWarning('unsupported-smart-source-safe-transform'));
  }
  if (options.requireNonDestructive) {
    warnings.push(createLayerTransformWarning('destructive-scale-rasterization'));
  }
  return warnings;
}

function createLayerTransformWarning(code: ImageLayerTransformWarningCode): ImageLayerTransformWarning {
  if (code === 'unsupported-smart-source-safe-transform') {
    return {
      code,
      severity: 'warning',
      message: 'Native smart-source-safe transform semantics are not implemented; linked source metadata is retained but editable Smart Object transforms are not preserved.',
    };
  }

  if (code === 'export-rasterizes-transform-preview') {
    return {
      code,
      severity: 'warning',
      message: 'Export and flattened compositing rasterize the current transform preview; retained smart transform instructions are not embedded.',
    };
  }

  if (code === 'source-link-retained-transform-not-smart-object') {
    return {
      code,
      severity: 'warning',
      message: 'Source-link metadata is retained for relinking context, but transforms are stored on the Sloom Studio layer rather than as editable Smart Object transforms.',
    };
  }

  return {
    code,
    severity: 'warning',
    capability: 'scale',
    message: 'Layer scale previews resample bitmap pixels or text bounds and commit as layer operations instead of retaining a non-destructive smart transform.',
  };
}

function hasSmartSourceMetadata(layer: ImageLayer): boolean {
  return Boolean(layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId);
}

function getLayerTransformSourceKind(
  layer: ImageLayer,
): ImageLayerTransformCapabilitySetDescriptor['sourceKind'] {
  if (layer.bitmap) return 'bitmap';
  if (layer.text) return 'text';
  if (layer.metadata?.vectorShape) return 'vector';
  return 'empty';
}

function getLayerTransformSourceDimensions(
  layer: ImageLayer,
): ImageLayerTransformCapabilitySetDescriptor['sourceDimensions'] {
  if (layer.bitmap) {
    return {
      width: Math.max(1, layer.bitmap.width),
      height: Math.max(1, layer.bitmap.height),
    };
  }

  if (layer.text) {
    const lines = layer.text.content.split(/\r?\n/);
    const longestLine = Math.max(1, ...lines.map((line) => line.length));
    return {
      width: Math.max(1, layer.text.boxWidth ?? Math.max(48, longestLine * layer.text.fontSize * 0.58)),
      height: Math.max(
        1,
        layer.text.boxHeight ?? Math.max(
          layer.text.fontSize * layer.text.lineHeight,
          lines.length * layer.text.fontSize * layer.text.lineHeight,
        ),
      ),
    };
  }

  const vectorShape = layer.metadata?.vectorShape;
  if (vectorShape) {
    return {
      width: Math.max(1, vectorShape.width),
      height: Math.max(1, vectorShape.height),
    };
  }

  return null;
}

function transformCapabilityLabel(kind: ImageLayerTransformCapabilityKind): string {
  switch (kind) {
    case 'move':
      return 'Move';
    case 'scale':
      return 'Scale';
    case 'rotate':
      return 'Rotate';
    case 'skew':
      return 'Skew';
    case 'distort':
      return 'Distort';
    case 'perspective':
      return 'Perspective';
    case 'warp':
      return 'Warp';
  }
}

function transformCapabilityPreviewKind(kind: ImageLayerTransformCapabilityKind): ImageLayerTransformPreviewKind {
  if (kind === 'scale') return 'raster-resample';
  if (kind === 'warp') return 'mesh';
  return 'metadata';
}

function transformCapabilityHandleCount(kind: ImageLayerTransformCapabilityKind): number {
  switch (kind) {
    case 'move':
      return 0;
    case 'scale':
      return 8;
    case 'rotate':
      return 1;
    case 'skew':
    case 'distort':
    case 'perspective':
    case 'warp':
      return 4;
  }
}

function transformCapabilityNumericFields(kind: ImageLayerTransformCapabilityKind): string[] {
  switch (kind) {
    case 'move':
      return ['x', 'y'];
    case 'scale':
      return ['width', 'height'];
    case 'rotate':
      return ['rotationDeg', 'transformOriginX', 'transformOriginY'];
    case 'skew':
      return ['skewXDeg', 'skewYDeg'];
    case 'distort':
      return ['cornerOffsets'];
    case 'perspective':
      return ['perspectiveX', 'perspectiveY'];
    case 'warp':
      return ['warp.top', 'warp.right', 'warp.bottom', 'warp.left'];
  }
}
