import type { DocumentViewport } from '../../types/imageEditor';
import {
  getSelectionTransformUnsupportedSemanticWarnings,
  getSelectionTransformTargetCorners as getSelectionTransformTargetCornersDoc,
  type SelectionTransformPlanningWarning,
  type SelectionTransformBounds,
  type SelectionTransformCorner,
  type SelectionTransformCornerOffsets,
  type SelectionTransformMode,
  type SelectionTransformShape,
  type SelectionTransformUnsupportedSemantic,
} from './ImageSelectionTransform';
import {
  calculateLayerRotationDeg,
  resizeLayerRectFromHandle,
  type ImageLayerTransformHandle,
} from './ImageLayerTransformControls';
import { docToScreen, type Point, type Size } from './viewport';

export type SelectionTransformHandle = ImageLayerTransformHandle;

export interface SelectionTransformControlHandleDescriptor {
  kind: 'resize' | 'skew' | 'distort';
  handle: SelectionTransformHandle | SelectionTransformCorner;
  point: Point;
  cursor: string;
}

export interface SelectionTransformControlPivotDescriptor {
  anchor: 'selection-center';
  editable: false;
  docPoint: Point;
  screenPoint: Point;
  signature: string;
}

export type SelectionTransformControlCaveatCode =
  | 'skew-affine-edge-controls'
  | 'distort-corner-offset-controls';

export interface SelectionTransformControlModeCaveatDescriptor {
  code: SelectionTransformControlCaveatCode;
  mode: Extract<SelectionTransformMode, 'skew' | 'distort'>;
  support: 'supported' | 'limited';
  active: boolean;
  message: string;
}

export type SelectionTransformControlOverlayUnsupportedCode =
  | 'marching-ants-control-preview-unsupported'
  | 'photoshop-overlay-control-preview-unsupported';

export interface SelectionTransformControlOverlayUnsupportedDescriptor {
  code: SelectionTransformControlOverlayUnsupportedCode;
  supported: false;
  fallback: 'transform-outline-and-handles' | 'selection-transform-preview-overlay';
  message: string;
}

export interface SelectionTransformControlPlanDescriptor {
  mode: SelectionTransformMode;
  screenBounds: SelectionTransformBounds;
  pivot: SelectionTransformControlPivotDescriptor;
  handles: SelectionTransformControlHandleDescriptor[];
  rotateHandle: {
    point: Point;
    cursor: 'grab';
  };
  warnings: SelectionTransformPlanningWarning[];
  modeCaveats: SelectionTransformControlModeCaveatDescriptor[];
  overlayStates: SelectionTransformControlOverlayUnsupportedDescriptor[];
  signature: string;
}

export interface SelectionTransformControlPlanInput {
  shape: SelectionTransformShape;
  viewport: DocumentViewport;
  mode: SelectionTransformMode;
  requestedSemantics?: SelectionTransformUnsupportedSemantic[];
  view?: Size;
}

export function getSelectionTransformScreenBounds(
  bounds: SelectionTransformBounds,
  viewport: DocumentViewport,
  view?: Size,
): SelectionTransformBounds {
  // Extents over all four corners, not a two-corner subtraction: under canvas view rotation
  // the mapped bottom-right is not "after" the mapped top-left, and the extents stay a true
  // axis-aligned bounding box. Identical results in upright views.
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => docToScreen(point, viewport, view));
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const topLeft = { x: minX, y: minY };
  const bottomRight = { x: maxX, y: maxY };
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export function moveSelectionBounds(
  origin: SelectionTransformBounds,
  delta: Point,
): SelectionTransformBounds {
  return {
    x: Math.round(origin.x + delta.x),
    y: Math.round(origin.y + delta.y),
    width: origin.width,
    height: origin.height,
  };
}

export function resizeSelectionBoundsFromHandle({
  handle,
  origin,
  delta,
  keepAspect,
}: {
  handle: SelectionTransformHandle;
  origin: SelectionTransformBounds;
  delta: Point;
  keepAspect: boolean;
}): SelectionTransformBounds {
  return resizeLayerRectFromHandle({
    handle,
    origin,
    delta,
    keepAspect,
  });
}

export function calculateSelectionRotationDeg({
  center,
  startPoint,
  point,
  startRotationDeg,
  snapToFifteenDegrees,
}: {
  center: Point;
  startPoint: Point;
  point: Point;
  startRotationDeg: number;
  snapToFifteenDegrees: boolean;
}): number {
  const startPointerDeg = calculateLayerRotationDeg(center, startPoint, false);
  const pointerDeg = calculateLayerRotationDeg(center, point, false);
  return normalizeSelectionRotation(startRotationDeg + pointerDeg - startPointerDeg, snapToFifteenDegrees);
}

export function calculateSelectionSkewDeg({
  axis,
  origin,
  delta,
  startSkewDeg,
  snapToFifteenDegrees,
}: {
  axis: 'x' | 'y';
  origin: SelectionTransformBounds;
  delta: Point;
  startSkewDeg: number;
  snapToFifteenDegrees: boolean;
}): number {
  const baseline = axis === 'x' ? origin.height : origin.width;
  const deltaAmount = axis === 'x' ? delta.x : delta.y;
  const nextSkewDeg = startSkewDeg + ((Math.atan2(deltaAmount, Math.max(1, baseline)) * 180) / Math.PI);
  return normalizeSelectionSkew(nextSkewDeg, snapToFifteenDegrees);
}

export function getSelectionTransformTargetCorners(
  shape: SelectionTransformShape,
): Record<SelectionTransformCorner, Point> {
  return getSelectionTransformTargetCornersDoc(shape);
}

export function getSelectionTransformScreenCorners(
  shape: SelectionTransformShape,
  viewport: DocumentViewport,
  view?: Size,
): Record<SelectionTransformCorner, Point> {
  const corners = getSelectionTransformTargetCorners(shape);
  return {
    nw: docToScreen(corners.nw, viewport, view),
    ne: docToScreen(corners.ne, viewport, view),
    se: docToScreen(corners.se, viewport, view),
    sw: docToScreen(corners.sw, viewport, view),
  };
}

export function getSelectionTransformScreenExtents(
  corners: Record<SelectionTransformCorner, Point>,
): SelectionTransformBounds {
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

export function getSelectionTransformHandlePoints(
  corners: Record<SelectionTransformCorner, Point>,
  mode: SelectionTransformMode,
): Array<{ kind: 'resize' | 'skew' | 'distort'; handle: SelectionTransformHandle | SelectionTransformCorner; point: Point; cursor: string }> {
  if (mode === 'distort') {
    return [
      { kind: 'distort', handle: 'nw', point: corners.nw, cursor: 'nwse-resize' },
      { kind: 'distort', handle: 'ne', point: corners.ne, cursor: 'nesw-resize' },
      { kind: 'distort', handle: 'se', point: corners.se, cursor: 'nwse-resize' },
      { kind: 'distort', handle: 'sw', point: corners.sw, cursor: 'nesw-resize' },
    ];
  }

  const north = midpoint(corners.nw, corners.ne);
  const east = midpoint(corners.ne, corners.se);
  const south = midpoint(corners.sw, corners.se);
  const west = midpoint(corners.nw, corners.sw);

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

export function getSelectionTransformRotateHandlePoint(
  corners: Record<SelectionTransformCorner, Point>,
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

export function moveSelectionDistortCornerOffset({
  corner,
  originOffsets,
  delta,
}: {
  corner: SelectionTransformCorner;
  originOffsets: SelectionTransformCornerOffsets;
  delta: Point;
}): SelectionTransformCornerOffsets {
  return {
    ...originOffsets,
    [corner]: {
      x: roundSelectionControlNumber(originOffsets[corner].x + delta.x),
      y: roundSelectionControlNumber(originOffsets[corner].y + delta.y),
    },
  };
}

export function describeSelectionTransformControlPlan({
  shape,
  viewport,
  mode,
  requestedSemantics,
  view,
}: SelectionTransformControlPlanInput): SelectionTransformControlPlanDescriptor {
  const screenCorners = getSelectionTransformScreenCorners(shape, viewport, view);
  const screenBounds = normalizeSelectionControlBounds(getSelectionTransformScreenExtents(screenCorners));
  const pivot = buildSelectionTransformControlPivot(shape, viewport, view);
  const handles = getSelectionTransformHandlePoints(screenCorners, mode).map((handle) => ({
    kind: handle.kind,
    handle: handle.handle,
    point: normalizeSelectionControlPoint(handle.point),
    cursor: handle.cursor,
  }));
  const rotateHandle = {
    point: normalizeSelectionControlPoint(getSelectionTransformRotateHandlePoint(screenCorners)),
    cursor: 'grab' as const,
  };

  return {
    mode,
    screenBounds,
    pivot,
    handles,
    rotateHandle,
    warnings: getSelectionTransformUnsupportedSemanticWarnings(requestedSemantics),
    modeCaveats: buildSelectionTransformControlModeCaveats(mode),
    overlayStates: buildSelectionTransformControlOverlayStates(),
    signature: buildSelectionTransformControlPlanSignature(mode, screenBounds, handles, rotateHandle.point, pivot.screenPoint),
  };
}

function buildSelectionTransformControlPivot(
  shape: SelectionTransformShape,
  viewport: DocumentViewport,
  view?: Size,
): SelectionTransformControlPivotDescriptor {
  const docPoint = normalizeSelectionControlPoint({
    x: shape.bounds.x + shape.bounds.width / 2,
    y: shape.bounds.y + shape.bounds.height / 2,
  });
  const screenPoint = normalizeSelectionControlPoint(docToScreen(docPoint, viewport, view));

  return {
    anchor: 'selection-center',
    editable: false,
    docPoint,
    screenPoint,
    signature: `selection-transform-control-pivot:v1:selection-center:${formatSelectionControlPoint(docPoint)}:${formatSelectionControlPoint(screenPoint)}`,
  };
}

function buildSelectionTransformControlModeCaveats(
  mode: SelectionTransformMode,
): SelectionTransformControlModeCaveatDescriptor[] {
  return [
    {
      code: 'skew-affine-edge-controls',
      mode: 'skew',
      support: 'supported',
      active: mode === 'skew',
      message: 'Skew controls expose affine edge handles for selection-mask preview only; applied selections do not retain editable skew handles.',
    },
    {
      code: 'distort-corner-offset-controls',
      mode: 'distort',
      support: 'limited',
      active: mode === 'distort',
      message: 'Distort controls expose four bounded corner offsets; perspective and mesh warp controls remain unsupported for selections.',
    },
  ];
}

function buildSelectionTransformControlOverlayStates(): SelectionTransformControlOverlayUnsupportedDescriptor[] {
  return [
    {
      code: 'marching-ants-control-preview-unsupported',
      supported: false,
      fallback: 'transform-outline-and-handles',
      message: 'Control planning does not generate animated marching ants; the deterministic outline, handles, and pivot describe the preview affordance.',
    },
    {
      code: 'photoshop-overlay-control-preview-unsupported',
      supported: false,
      fallback: 'selection-transform-preview-overlay',
      message: 'Control planning does not synthesize Photoshop-style overlay blending; callers render the existing transform preview overlay.',
    },
  ];
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function normalizeSelectionRotation(rotationDeg: number, snapToFifteenDegrees: boolean): number {
  let normalized = rotationDeg;
  if (snapToFifteenDegrees) {
    normalized = Math.round(normalized / 15) * 15;
  }
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return roundSelectionControlNumber(normalized);
}

function normalizeSelectionSkew(skewDeg: number, snapToFifteenDegrees: boolean): number {
  let normalized = skewDeg;
  if (snapToFifteenDegrees) {
    normalized = Math.round(normalized / 15) * 15;
  }
  normalized = Math.max(-75, Math.min(75, normalized));
  return roundSelectionControlNumber(normalized);
}

function roundSelectionControlNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeSelectionControlPoint(point: Point): Point {
  return {
    x: roundSelectionControlNumber(point.x),
    y: roundSelectionControlNumber(point.y),
  };
}

function normalizeSelectionControlBounds(bounds: SelectionTransformBounds): SelectionTransformBounds {
  return {
    x: roundSelectionControlNumber(bounds.x),
    y: roundSelectionControlNumber(bounds.y),
    width: roundSelectionControlNumber(bounds.width),
    height: roundSelectionControlNumber(bounds.height),
  };
}

function buildSelectionTransformControlPlanSignature(
  mode: SelectionTransformMode,
  screenBounds: SelectionTransformBounds,
  handles: SelectionTransformControlHandleDescriptor[],
  rotateHandlePoint: Point,
  pivotPoint: Point,
): string {
  return [
    'selection-transform-controls',
    mode,
    formatSelectionControlBounds(screenBounds),
    handles.map((handle) => [
      handle.kind,
      handle.handle,
      formatSelectionControlPoint(handle.point),
    ].join(':')).join('|'),
    `rotate:${formatSelectionControlPoint(rotateHandlePoint)}`,
    `pivot:${formatSelectionControlPoint(pivotPoint)}`,
  ].join(':');
}

function formatSelectionControlBounds(bounds: SelectionTransformBounds): string {
  return [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  ].map(formatSelectionControlNumber).join(',');
}

function formatSelectionControlPoint(point: Point): string {
  return [
    point.x,
    point.y,
  ].map(formatSelectionControlNumber).join(',');
}

function formatSelectionControlNumber(value: number): string {
  return String(roundSelectionControlNumber(value));
}
