import type {
  DocumentViewport,
  ImageLayer,
  ImageLayerTransformCorner,
  ImageLayerTransformCornerOffsets,
  ImageLayerWarpOffsets,
} from '../../types/imageEditor';
import { canMoveImageLayer } from '../../lib/imageLayerLocks';
import { docToScreen, type Point, type Size } from './viewport';

export type ImageLayerTransformHandle = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export type ImageLayerTransformMode = 'resize' | 'skew' | 'distort' | 'perspective' | 'warp';

export interface ImageLayerTransformRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageLayerTransformBounds extends ImageLayerTransformRect {
  rotationDeg: number;
}

export interface ImageLayerTransformShape extends ImageLayerTransformRect {
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  perspectiveX: number;
  perspectiveY: number;
  warp?: ImageLayerWarpOffsets;
  transformOriginX: number;
  transformOriginY: number;
  cornerOffsets: ImageLayerTransformCornerOffsets;
}

export type ImageLayerTransformControlWarningCode =
  | 'no-transformable-layer-size'
  | 'layer-transform-controls-unavailable'
  | 'control-preview-rasterized-on-export';

export interface ImageLayerTransformControlWarning {
  code: ImageLayerTransformControlWarningCode;
  severity: 'warning';
  message: string;
}

export interface ImageLayerTransformControlSupportEntry {
  supported: boolean;
  handleCount: number;
}

export interface ImageLayerTransformControlSourceSafetyDescriptor {
  linked: boolean;
  smartSourceSafe: boolean;
  limitationCodes: string[];
}

export interface ImageLayerNumericTransformDescriptor {
  documentRect: ImageLayerTransformBounds;
  pivot: {
    x: number;
    y: number;
    transformOriginX: number;
    transformOriginY: number;
  };
  fields: Array<'x' | 'y' | 'width' | 'height' | 'rotationDeg' | 'transformOriginX' | 'transformOriginY'>;
  signature: string;
}

export interface ImageLayerTransformControlHandleDescriptor {
  kind: 'resize' | 'skew' | 'distort' | 'perspective' | 'warp';
  handle: ImageLayerTransformHandle | ImageLayerTransformCorner;
  point: Point;
  cursor: string;
}

export interface ImageLayerTransformControlPlanDescriptor {
  descriptorId: 'image-layer-transform-controls:v1';
  layerId: string;
  mode: ImageLayerTransformMode;
  supported: boolean;
  sourceSize: { width: number; height: number } | null;
  screenBounds: ImageLayerTransformRect | null;
  handles: ImageLayerTransformControlHandleDescriptor[];
  rotateHandle: { point: Point; cursor: 'grab' } | null;
  pivotHandle: { point: Point; cursor: 'move' } | null;
  numericTransform: ImageLayerNumericTransformDescriptor | null;
  preview: { id: string; signature: string };
  supportMatrix: Record<'pivot' | 'resize' | 'skew' | 'distort' | 'perspective' | 'warp', ImageLayerTransformControlSupportEntry>;
  sourceSafety: ImageLayerTransformControlSourceSafetyDescriptor;
  advancedDeformationWorkspace: {
    mode: 'perspective' | 'warp';
    fullyInteractive: false;
    actionSuitable: boolean;
    batchSuitable: boolean;
    limitation: 'overlay-handles-preview-only-not-live-deformation-workspace';
    unsupportedStates: string[];
    previewSignature: string;
    exportSignature: string;
  } | null;
  exportCaveats: ImageLayerTransformControlWarning[];
  warnings: ImageLayerTransformControlWarning[];
  signature: string;
}

export interface ImageLayerTransformControlPlanInput {
  layer: ImageLayer;
  viewport: DocumentViewport;
  mode: ImageLayerTransformMode;
  view?: Size;
}

export function getImageLayerIntrinsicSize(
  layer: ImageLayer,
): { width: number; height: number } | null {
  if (layer.bitmap) {
    return {
      width: Math.max(1, layer.bitmap.width),
      height: Math.max(1, layer.bitmap.height),
    };
  }

  if (layer.text) {
    const lines = layer.text.content.split(/\r?\n/);
    const longestLine = Math.max(1, ...lines.map((line) => line.length));
    const width = layer.text.boxWidth ?? Math.max(48, longestLine * layer.text.fontSize * 0.58);
    const height = layer.text.boxHeight ?? Math.max(
      layer.text.fontSize * layer.text.lineHeight,
      lines.length * layer.text.fontSize * layer.text.lineHeight,
    );
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
    };
  }

  return null;
}

export function createEmptyImageLayerTransformCornerOffsets(): ImageLayerTransformCornerOffsets {
  return {
    nw: { x: 0, y: 0 },
    ne: { x: 0, y: 0 },
    se: { x: 0, y: 0 },
    sw: { x: 0, y: 0 },
  };
}

export function createEmptyImageLayerWarpOffsets(): ImageLayerWarpOffsets {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
}

export function normalizeImageLayerTransformCornerOffsets(
  offsets: ImageLayerTransformCornerOffsets | undefined,
): ImageLayerTransformCornerOffsets {
  const target = offsets ?? createEmptyImageLayerTransformCornerOffsets();
  return {
    nw: normalizeTransformPoint(target.nw),
    ne: normalizeTransformPoint(target.ne),
    se: normalizeTransformPoint(target.se),
    sw: normalizeTransformPoint(target.sw),
  };
}

export function normalizeImageLayerWarpOffsets(
  warp: ImageLayerWarpOffsets | undefined,
): ImageLayerWarpOffsets {
  const target = warp ?? createEmptyImageLayerWarpOffsets();
  return {
    top: normalizeLayerWarpValue(target.top),
    right: normalizeLayerWarpValue(target.right),
    bottom: normalizeLayerWarpValue(target.bottom),
    left: normalizeLayerWarpValue(target.left),
  };
}

export function getImageLayerTransformShape(
  layer: Pick<ImageLayer, 'x' | 'y' | 'rotationDeg' | 'skewXDeg' | 'skewYDeg' | 'perspectiveX' | 'perspectiveY' | 'warp' | 'cornerOffsets' | 'transformOriginX' | 'transformOriginY'>,
  size: { width: number; height: number } | null,
): ImageLayerTransformShape | null {
  if (!size) return null;
  return {
    x: layer.x,
    y: layer.y,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
    rotationDeg: normalizeLayerRotation(layer.rotationDeg ?? 0, false),
    skewXDeg: normalizeLayerSkew(layer.skewXDeg ?? 0, false),
    skewYDeg: normalizeLayerSkew(layer.skewYDeg ?? 0, false),
    perspectiveX: normalizeLayerPerspective(layer.perspectiveX ?? 0),
    perspectiveY: normalizeLayerPerspective(layer.perspectiveY ?? 0),
    warp: normalizeImageLayerWarpOffsets(layer.warp),
    transformOriginX: clampTransformOrigin(layer.transformOriginX),
    transformOriginY: clampTransformOrigin(layer.transformOriginY),
    cornerOffsets: normalizeImageLayerTransformCornerOffsets(layer.cornerOffsets),
  };
}

export function getImageLayerTransformBounds(
  layer: ImageLayer,
  viewport: DocumentViewport,
  view?: Size,
): ImageLayerTransformBounds | null {
  const shape = getImageLayerTransformShape(layer, getImageLayerIntrinsicSize(layer));
  if (!shape) return null;
  const corners = getImageLayerTransformScreenCorners(shape, viewport, view);
  const borderPoints = getImageLayerTransformScreenBorderPoints(shape, viewport, 12, view);
  const extents = getPointExtents(borderPoints.length > 0 ? borderPoints : Object.values(corners));
  return {
    ...extents,
    rotationDeg: shape.rotationDeg,
  };
}

export function resizeLayerRectFromHandle({
  handle,
  origin,
  delta,
  keepAspect,
}: {
  handle: ImageLayerTransformHandle;
  origin: ImageLayerTransformRect;
  delta: Point;
  keepAspect: boolean;
}): ImageLayerTransformRect {
  const minSize = 1;
  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;
  const hasEast = handle.includes('e');
  const hasWest = handle.includes('w');
  const hasSouth = handle.includes('s');
  const hasNorth = handle.includes('n');
  const adjustsWidth = hasEast || hasWest;
  const adjustsHeight = hasSouth || hasNorth;

  if (hasEast) {
    width = origin.width + delta.x;
  } else if (hasWest) {
    width = origin.width - delta.x;
    x = origin.x + delta.x;
  }

  if (hasSouth) {
    height = origin.height + delta.y;
  } else if (hasNorth) {
    height = origin.height - delta.y;
    y = origin.y + delta.y;
  }

  width = Math.max(minSize, width);
  height = Math.max(minSize, height);

  if (keepAspect && origin.width > 0 && origin.height > 0) {
    const aspect = origin.width / origin.height;
    const widthDrivenHeight = width / aspect;
    const heightDrivenWidth = height * aspect;
    const widthDelta = Math.abs(width - origin.width);
    const heightDelta = Math.abs(height - origin.height);

    if (widthDelta >= heightDelta) {
      height = Math.max(minSize, widthDrivenHeight);
    } else {
      width = Math.max(minSize, heightDrivenWidth);
    }

    if (hasWest) {
      x = origin.x + origin.width - width;
    } else if (!adjustsWidth) {
      x = origin.x - (width - origin.width) / 2;
    }
    if (hasNorth) {
      y = origin.y + origin.height - height;
    } else if (!adjustsHeight) {
      y = origin.y - (height - origin.height) / 2;
    }
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function calculateLayerRotationDeg(
  center: Point,
  pointer: Point,
  snapToFifteenDegrees: boolean,
): number {
  const radians = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  let degrees = (radians * 180) / Math.PI;
  if (snapToFifteenDegrees) {
    degrees = Math.round(degrees / 15) * 15;
  }
  if (degrees > 180) degrees -= 360;
  if (degrees <= -180) degrees += 360;
  return Math.round(degrees * 100) / 100;
}

export function calculateLayerSkewDeg({
  axis,
  origin,
  delta,
  startSkewDeg,
  snapToFifteenDegrees,
}: {
  axis: 'x' | 'y';
  origin: ImageLayerTransformRect;
  delta: Point;
  startSkewDeg: number;
  snapToFifteenDegrees: boolean;
}): number {
  const baseline = axis === 'x' ? origin.height : origin.width;
  const deltaAmount = axis === 'x' ? delta.x : delta.y;
  const nextSkewDeg = startSkewDeg + ((Math.atan2(deltaAmount, Math.max(1, baseline)) * 180) / Math.PI);
  return normalizeLayerSkew(nextSkewDeg, snapToFifteenDegrees);
}

export function getImageLayerTransformTargetCorners(
  shape: ImageLayerTransformShape,
): Record<ImageLayerTransformCorner, Point> {
  return {
    nw: transformShapePoint(shape, 0, 0),
    ne: transformShapePoint(shape, 1, 0),
    se: transformShapePoint(shape, 1, 1),
    sw: transformShapePoint(shape, 0, 1),
  };
}

export function getImageLayerTransformScreenCorners(
  shape: ImageLayerTransformShape,
  viewport: DocumentViewport,
  view?: Size,
): Record<ImageLayerTransformCorner, Point> {
  const corners = getImageLayerTransformTargetCorners(shape);
  return {
    nw: docToScreen(corners.nw, viewport, view),
    ne: docToScreen(corners.ne, viewport, view),
    se: docToScreen(corners.se, viewport, view),
    sw: docToScreen(corners.sw, viewport, view),
  };
}

export function getImageLayerTransformScreenBorderPoints(
  shape: ImageLayerTransformShape,
  viewport: DocumentViewport,
  segments = 12,
  view?: Size,
): Point[] {
  return sampleShapeBorderPoints(shape, segments).map((point) => docToScreen(point, viewport, view));
}

export function getImageLayerTransformScreenExtents(
  corners: Record<ImageLayerTransformCorner, Point>,
): ImageLayerTransformRect {
  const values = Object.values(corners);
  const minX = Math.min(...values.map((corner) => corner.x));
  const minY = Math.min(...values.map((corner) => corner.y));
  const maxX = Math.max(...values.map((corner) => corner.x));
  const maxY = Math.max(...values.map((corner) => corner.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function getImageLayerTransformHandlePoints(
  corners: Record<ImageLayerTransformCorner, Point>,
  mode: ImageLayerTransformMode,
): Array<{ kind: 'resize' | 'skew' | 'distort' | 'perspective' | 'warp'; handle: ImageLayerTransformHandle | ImageLayerTransformCorner; point: Point; cursor: string }> {
  if (mode === 'distort' || mode === 'perspective') {
    return [
      { kind: mode, handle: 'nw', point: corners.nw, cursor: 'nwse-resize' },
      { kind: mode, handle: 'ne', point: corners.ne, cursor: 'nesw-resize' },
      { kind: mode, handle: 'se', point: corners.se, cursor: 'nwse-resize' },
      { kind: mode, handle: 'sw', point: corners.sw, cursor: 'nesw-resize' },
    ];
  }

  const north = midpoint(corners.nw, corners.ne);
  const east = midpoint(corners.ne, corners.se);
  const south = midpoint(corners.sw, corners.se);
  const west = midpoint(corners.nw, corners.sw);

  if (mode === 'warp') {
    return [
      { kind: 'warp', handle: 'n', point: north, cursor: 'ns-resize' },
      { kind: 'warp', handle: 'e', point: east, cursor: 'ew-resize' },
      { kind: 'warp', handle: 's', point: south, cursor: 'ns-resize' },
      { kind: 'warp', handle: 'w', point: west, cursor: 'ew-resize' },
    ];
  }

  if (mode === 'skew') {
    return [
      { kind: 'skew', handle: 'n', point: north, cursor: 'ew-resize' },
      { kind: 'skew', handle: 'e', point: east, cursor: 'ns-resize' },
      { kind: 'skew', handle: 's', point: south, cursor: 'ew-resize' },
      { kind: 'skew', handle: 'w', point: west, cursor: 'ns-resize' },
    ];
  }

  return [
    { kind: 'resize', handle: 'nw', point: corners.nw, cursor: 'nwse-resize' },
    { kind: 'resize', handle: 'n', point: north, cursor: 'ns-resize' },
    { kind: 'resize', handle: 'ne', point: corners.ne, cursor: 'nesw-resize' },
    { kind: 'resize', handle: 'e', point: east, cursor: 'ew-resize' },
    { kind: 'resize', handle: 'se', point: corners.se, cursor: 'nwse-resize' },
    { kind: 'resize', handle: 's', point: south, cursor: 'ns-resize' },
    { kind: 'resize', handle: 'sw', point: corners.sw, cursor: 'nesw-resize' },
    { kind: 'resize', handle: 'w', point: west, cursor: 'ew-resize' },
  ];
}

export function getImageLayerTransformRotateHandlePoint(
  corners: Record<ImageLayerTransformCorner, Point>,
  distance = 28,
): Point {
  const topMidpoint = midpoint(corners.nw, corners.ne);
  const edge = {
    x: corners.ne.x - corners.nw.x,
    y: corners.ne.y - corners.nw.y,
  };
  const edgeLength = Math.max(1, Math.hypot(edge.x, edge.y));
  const normal = {
    x: -edge.y / edgeLength,
    y: edge.x / edgeLength,
  };
  const center = midpoint(corners.nw, corners.se);
  const tentative = {
    x: topMidpoint.x + normal.x * distance,
    y: topMidpoint.y + normal.y * distance,
  };
  const inward = {
    x: center.x - topMidpoint.x,
    y: center.y - topMidpoint.y,
  };
  const dot = (tentative.x - topMidpoint.x) * inward.x + (tentative.y - topMidpoint.y) * inward.y;
  if (dot > 0) {
    return {
      x: topMidpoint.x - normal.x * distance,
      y: topMidpoint.y - normal.y * distance,
    };
  }
  return tentative;
}

export function moveLayerDistortCornerOffset({
  corner,
  originOffsets,
  delta,
}: {
  corner: ImageLayerTransformCorner;
  originOffsets: ImageLayerTransformCornerOffsets;
  delta: Point;
}): ImageLayerTransformCornerOffsets {
  return {
    ...originOffsets,
    [corner]: {
      x: roundTransformNumber(originOffsets[corner].x + delta.x),
      y: roundTransformNumber(originOffsets[corner].y + delta.y),
    },
  };
}

export function calculateLayerPerspectiveValue({
  axis,
  corner,
  origin,
  delta,
  startPerspective,
}: {
  axis: 'x' | 'y';
  corner: ImageLayerTransformCorner;
  origin: ImageLayerTransformRect;
  delta: Point;
  startPerspective: number;
}): number {
  const sign = getPerspectiveCornerSign(corner);
  const baseline = axis === 'x' ? origin.width / 2 : origin.height / 2;
  const deltaAmount = axis === 'x' ? delta.x : delta.y;
  return normalizeLayerPerspective(startPerspective + (deltaAmount / Math.max(1, baseline)) * sign);
}

export function calculateLayerWarpValue({
  handle,
  origin,
  delta,
  startWarp,
}: {
  handle: 'n' | 'e' | 's' | 'w';
  origin: ImageLayerTransformRect;
  delta: Point;
  startWarp: number;
}): number {
  const horizontal = handle === 'e' || handle === 'w';
  const baseline = horizontal ? origin.width / 2 : origin.height / 2;
  const deltaAmount = horizontal ? delta.x : delta.y;
  const sign = handle === 'e' || handle === 's' ? 1 : -1;
  return normalizeLayerWarpValue(startWarp + (deltaAmount / Math.max(1, baseline)) * sign);
}

export function describeImageLayerTransformControlPlan({
  layer,
  viewport,
  mode,
  view,
}: ImageLayerTransformControlPlanInput): ImageLayerTransformControlPlanDescriptor {
  const sourceSize = getImageLayerIntrinsicSize(layer);
  const shape = getImageLayerTransformShape(layer, sourceSize);
  const supported = Boolean(sourceSize && shape && layer.visible && canMoveImageLayer(layer));
  const screenCorners = shape ? getImageLayerTransformScreenCorners(shape, viewport, view) : null;
  const borderPoints = shape ? getImageLayerTransformScreenBorderPoints(shape, viewport, 12, view) : [];
  const screenBounds = shape
    ? normalizeLayerControlBounds(getPointExtents(borderPoints.length > 0 ? borderPoints : Object.values(screenCorners ?? {})))
    : null;
  const handles = supported && screenCorners
    ? getImageLayerTransformHandlePoints(screenCorners, mode).map((handle) => ({
        kind: handle.kind,
        handle: handle.handle,
        point: normalizeLayerControlPoint(handle.point),
        cursor: handle.cursor,
      }))
    : [];
  const rotateHandle = supported && screenCorners
    ? {
        point: normalizeLayerControlPoint(getImageLayerTransformRotateHandlePoint(screenCorners)),
        cursor: 'grab' as const,
      }
    : null;
  const pivotHandle = supported && shape
    ? {
        point: normalizeLayerControlPoint(docToScreen({
          x: shape.x + shape.width * shape.transformOriginX,
          y: shape.y + shape.height * shape.transformOriginY,
        }, viewport, view)),
        cursor: 'move' as const,
      }
    : null;
  const warnings = describeLayerTransformControlWarnings(layer, sourceSize, supported);
  const signature = buildImageLayerTransformControlPlanSignature(
    layer.id,
    mode,
    screenBounds,
    handles,
    rotateHandle?.point ?? null,
    pivotHandle?.point ?? null,
  );

  return {
    descriptorId: 'image-layer-transform-controls:v1',
    layerId: layer.id,
    mode,
    supported,
    sourceSize,
    screenBounds,
    handles,
    rotateHandle,
    pivotHandle,
    numericTransform: shape ? buildImageLayerNumericTransformDescriptor(layer.id, shape) : null,
    preview: {
      id: `image-layer-transform-controls:${layer.id}:${mode}`,
      signature,
    },
    supportMatrix: buildImageLayerTransformControlSupportMatrix(supported),
    sourceSafety: buildImageLayerTransformControlSourceSafety(layer),
    advancedDeformationWorkspace: buildImageLayerTransformAdvancedWorkspaceDescriptor(layer.id, mode, supported, signature),
    exportCaveats: [
      {
        code: 'control-preview-rasterized-on-export',
        severity: 'warning',
        message: 'Control overlays are deterministic previews only; flattened export rasterizes the layer transform through the renderer.',
      },
    ],
    warnings,
    signature,
  };
}

function buildImageLayerNumericTransformDescriptor(
  layerId: string,
  shape: ImageLayerTransformShape,
): ImageLayerNumericTransformDescriptor {
  const documentRect = {
    x: roundTransformControlNumber(shape.x),
    y: roundTransformControlNumber(shape.y),
    width: roundTransformControlNumber(shape.width),
    height: roundTransformControlNumber(shape.height),
    rotationDeg: roundTransformControlNumber(shape.rotationDeg),
  };
  const pivot = {
    x: roundTransformControlNumber(shape.x + shape.width * shape.transformOriginX),
    y: roundTransformControlNumber(shape.y + shape.height * shape.transformOriginY),
    transformOriginX: roundTransformControlNumber(shape.transformOriginX),
    transformOriginY: roundTransformControlNumber(shape.transformOriginY),
  };
  return {
    documentRect,
    pivot,
    fields: ['x', 'y', 'width', 'height', 'rotationDeg', 'transformOriginX', 'transformOriginY'],
    signature: [
      'image-layer-numeric-transform:v1',
      layerId,
      `${formatLayerControlNumber(documentRect.x)},${formatLayerControlNumber(documentRect.y)},${formatLayerControlNumber(documentRect.width)}x${formatLayerControlNumber(documentRect.height)}`,
      `r${formatLayerControlNumber(documentRect.rotationDeg)}`,
      `p${formatLayerControlNumber(pivot.x)},${formatLayerControlNumber(pivot.y)}`,
      `o${formatLayerControlNumber(pivot.transformOriginX)},${formatLayerControlNumber(pivot.transformOriginY)}`,
    ].join(':'),
  };
}

function buildImageLayerTransformAdvancedWorkspaceDescriptor(
  layerId: string,
  mode: ImageLayerTransformMode,
  supported: boolean,
  previewSignature: string,
): ImageLayerTransformControlPlanDescriptor['advancedDeformationWorkspace'] {
  if (mode !== 'perspective' && mode !== 'warp') return null;

  return {
    mode,
    fullyInteractive: false,
    actionSuitable: supported,
    batchSuitable: supported,
    limitation: 'overlay-handles-preview-only-not-live-deformation-workspace',
    unsupportedStates: mode === 'perspective'
      ? [
          'interactive-perspective-warp-grid',
          'split-plane-perspective-warp',
          'reopenable-deformation-workspace',
        ]
      : [
          'interactive-warp-mesh-density',
          'puppet-style-warp-pins',
          'reopenable-deformation-workspace',
        ],
    previewSignature,
    exportSignature: `image-layer-transform-controls-export:v1:${layerId}:${mode}:flattened-render`,
  };
}

function applyCornerTransform(
  corner: Point,
  centerX: number,
  centerY: number,
  skewX: number,
  skewY: number,
  cos: number,
  sin: number,
  offset: Point,
): Point {
  const skewedX = corner.x + skewX * corner.y;
  const skewedY = corner.y + skewY * corner.x;
  const rotatedX = skewedX * cos - skewedY * sin;
  const rotatedY = skewedX * sin + skewedY * cos;
  return {
    x: roundTransformNumber(centerX + rotatedX + offset.x),
    y: roundTransformNumber(centerY + rotatedY + offset.y),
  };
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function getPointExtents(points: Point[]): ImageLayerTransformRect {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function normalizeLayerRotation(rotationDeg: number, snapToFifteenDegrees: boolean): number {
  let normalized = rotationDeg;
  if (snapToFifteenDegrees) {
    normalized = Math.round(normalized / 15) * 15;
  }
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return roundTransformNumber(normalized);
}

function normalizeLayerSkew(skewDeg: number, snapToFifteenDegrees: boolean): number {
  let normalized = skewDeg;
  if (snapToFifteenDegrees) {
    normalized = Math.round(normalized / 15) * 15;
  }
  normalized = Math.max(-75, Math.min(75, normalized));
  return roundTransformNumber(normalized);
}

function normalizeLayerPerspective(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-0.95, Math.min(0.95, Math.round(value * 1000) / 1000));
}

function normalizeLayerWarpValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, Math.round(value * 1000) / 1000));
}

function getPerspectiveCornerSign(corner: ImageLayerTransformCorner): number {
  return corner === 'nw' || corner === 'se' ? 1 : -1;
}

function normalizeTransformPoint(point: Point | undefined): Point {
  return {
    x: roundTransformNumber(point?.x ?? 0),
    y: roundTransformNumber(point?.y ?? 0),
  };
}

function roundTransformNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function clampTransformOrigin(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, Number(value)));
}

function describeLayerTransformControlWarnings(
  layer: ImageLayer,
  sourceSize: { width: number; height: number } | null,
  supported: boolean,
): ImageLayerTransformControlWarning[] {
  if (supported) return [];
  if (!sourceSize) {
    return [
      {
        code: 'no-transformable-layer-size',
        severity: 'warning',
        message: 'Layer transform controls require bitmap or retained text bounds before handles can be planned.',
      },
    ];
  }
  return [
    {
      code: 'layer-transform-controls-unavailable',
      severity: 'warning',
      message: layer.visible
        ? 'Layer transform controls are unavailable for grouped, fully locked, or position-locked layers.'
        : 'Layer transform controls are hidden for invisible layers.',
    },
  ];
}

function buildImageLayerTransformControlSupportMatrix(
  supported: boolean,
): ImageLayerTransformControlPlanDescriptor['supportMatrix'] {
  return {
    pivot: { supported, handleCount: 1 },
    resize: { supported, handleCount: 8 },
    skew: { supported, handleCount: 4 },
    distort: { supported, handleCount: 4 },
    perspective: { supported, handleCount: 4 },
    warp: { supported, handleCount: 4 },
  };
}

function buildImageLayerTransformControlSourceSafety(
  layer: ImageLayer,
): ImageLayerTransformControlSourceSafetyDescriptor {
  const linked = Boolean(layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId);
  return {
    linked,
    smartSourceSafe: !linked,
    limitationCodes: linked ? ['smart-source-transform-controls-preview-only'] : [],
  };
}

function normalizeLayerControlPoint(point: Point): Point {
  return {
    x: roundTransformControlNumber(point.x),
    y: roundTransformControlNumber(point.y),
  };
}

function normalizeLayerControlBounds(bounds: ImageLayerTransformRect): ImageLayerTransformRect {
  return {
    x: roundTransformControlNumber(bounds.x),
    y: roundTransformControlNumber(bounds.y),
    width: roundTransformControlNumber(bounds.width),
    height: roundTransformControlNumber(bounds.height),
  };
}

function buildImageLayerTransformControlPlanSignature(
  layerId: string,
  mode: ImageLayerTransformMode,
  screenBounds: ImageLayerTransformRect | null,
  handles: ImageLayerTransformControlHandleDescriptor[],
  rotateHandlePoint: Point | null,
  pivotHandlePoint: Point | null,
): string {
  return [
    'image-layer-transform-controls:v1',
    layerId,
    mode,
    screenBounds ? formatLayerControlBounds(screenBounds) : 'none',
    handles.map((handle) => [
      handle.kind,
      handle.handle,
      formatLayerControlPoint(handle.point),
    ].join(':')).join('|'),
    `rotate:${rotateHandlePoint ? formatLayerControlPoint(rotateHandlePoint) : 'none'}`,
    `pivot:${pivotHandlePoint ? formatLayerControlPoint(pivotHandlePoint) : 'none'}`,
  ].join(':');
}

function formatLayerControlBounds(bounds: ImageLayerTransformRect): string {
  return [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  ].map(formatLayerControlNumber).join(',');
}

function formatLayerControlPoint(point: Point): string {
  return [
    point.x,
    point.y,
  ].map(formatLayerControlNumber).join(',');
}

function formatLayerControlNumber(value: number): string {
  return String(roundTransformControlNumber(value));
}

function roundTransformControlNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function transformShapePoint(
  shape: ImageLayerTransformShape,
  u: number,
  v: number,
): Point {
  const warp = normalizeImageLayerWarpOffsets(shape.warp);
  const sourceX = shape.width * u;
  const sourceY = shape.height * v;
  const local = {
    x: sourceX - shape.width * shape.transformOriginX,
    y: sourceY - shape.height * shape.transformOriginY,
  };
  const warped = applyWarpToLocalPoint(local, shape.width, shape.height, u, v, warp);
  const perspectiveAdjusted = applyPerspectiveToLocalPoint(
    warped,
    shape.width,
    shape.height,
    u,
    v,
    shape.perspectiveX,
    shape.perspectiveY,
  );
  const pivotX = shape.x + shape.width * shape.transformOriginX;
  const pivotY = shape.y + shape.height * shape.transformOriginY;
  const skewXRadians = (shape.skewXDeg * Math.PI) / 180;
  const skewYRadians = (shape.skewYDeg * Math.PI) / 180;
  const rotationRadians = (shape.rotationDeg * Math.PI) / 180;
  const offset = interpolateCornerOffset(shape.cornerOffsets, u, v);
  return applyCornerTransform(
    perspectiveAdjusted,
    pivotX,
    pivotY,
    Math.tan(skewXRadians),
    Math.tan(skewYRadians),
    Math.cos(rotationRadians),
    Math.sin(rotationRadians),
    offset,
  );
}

function sampleShapeBorderPoints(
  shape: ImageLayerTransformShape,
  segments: number,
): Point[] {
  const safeSegments = Math.max(1, segments);
  const points: Point[] = [];
  for (let index = 0; index <= safeSegments; index += 1) {
    points.push(transformShapePoint(shape, index / safeSegments, 0));
  }
  for (let index = 1; index <= safeSegments; index += 1) {
    points.push(transformShapePoint(shape, 1, index / safeSegments));
  }
  for (let index = safeSegments - 1; index >= 0; index -= 1) {
    points.push(transformShapePoint(shape, index / safeSegments, 1));
  }
  for (let index = safeSegments - 1; index >= 1; index -= 1) {
    points.push(transformShapePoint(shape, 0, index / safeSegments));
  }
  return points;
}

function applyWarpToLocalPoint(
  point: Point,
  width: number,
  height: number,
  u: number,
  v: number,
  warp: ImageLayerWarpOffsets,
): Point {
  const edgeCurveX = 4 * u * (1 - u);
  const edgeCurveY = 4 * v * (1 - v);
  return {
    x: point.x + width * 0.5 * edgeCurveY * (warp.right * u - warp.left * (1 - u)),
    y: point.y + height * 0.5 * edgeCurveX * (warp.bottom * v - warp.top * (1 - v)),
  };
}

function applyPerspectiveToLocalPoint(
  point: Point,
  width: number,
  height: number,
  u: number,
  v: number,
  perspectiveX: number,
  perspectiveY: number,
): Point {
  const xNorm = u * 2 - 1;
  const yNorm = v * 2 - 1;
  const factor = xNorm * yNorm;
  return {
    x: point.x + (width / 2) * perspectiveX * factor,
    y: point.y + (height / 2) * perspectiveY * factor,
  };
}

function interpolateCornerOffset(
  offsets: ImageLayerTransformCornerOffsets,
  u: number,
  v: number,
): Point {
  const top = {
    x: offsets.nw.x + (offsets.ne.x - offsets.nw.x) * u,
    y: offsets.nw.y + (offsets.ne.y - offsets.nw.y) * u,
  };
  const bottom = {
    x: offsets.sw.x + (offsets.se.x - offsets.sw.x) * u,
    y: offsets.sw.y + (offsets.se.y - offsets.sw.y) * u,
  };
  return {
    x: roundTransformNumber(top.x + (bottom.x - top.x) * v),
    y: roundTransformNumber(top.y + (bottom.y - top.y) * v),
  };
}
