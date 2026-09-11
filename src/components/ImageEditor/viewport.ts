import type { DocumentViewport } from '../../types/imageEditor';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 64;

/** Keyboard/button view rotation steps, matching the common 15-degree ladders. */
export const VIEW_ROTATION_STEP_DEG = 15;
/** Two-finger twist rotations smaller than this are treated as jitter, not intent. */
export const VIEW_TWIST_MIN_DELTA_DEG = 1.5;

export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom) || zoom <= 0) return ZOOM_MIN;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/**
 * Normalize a canvas view rotation to (-180, 180] degrees. Non-finite values
 * (and exact multiples of 360) mean "no rotation" and return 0.
 */
export function normalizeViewRotationDeg(deg: number): number {
  if (!Number.isFinite(deg) || deg === 0) return 0;
  const wrapped = ((deg % 360) + 360) % 360;
  const signed = wrapped > 180 ? wrapped - 360 : wrapped;
  return signed === 0 ? 0 : signed;
}

/** Step the view rotation by ±15-degree increments from the current angle. */
export function rotateViewByStep(
  viewport: DocumentViewport,
  direction: 'cw' | 'ccw',
): DocumentViewport {
  const current = normalizeViewRotationDeg(viewport.rotationDeg ?? 0);
  const next = normalizeViewRotationDeg(current + (direction === 'cw' ? VIEW_ROTATION_STEP_DEG : -VIEW_ROTATION_STEP_DEG));
  return withViewRotation(viewport, next);
}

/** Set an arbitrary (twist-driven) view rotation, still bounded to (-180, 180]. */
export function rotateViewTo(viewport: DocumentViewport, deg: number): DocumentViewport {
  return withViewRotation(viewport, normalizeViewRotationDeg(deg));
}

export function resetViewRotation(viewport: DocumentViewport): DocumentViewport {
  if (!viewport.rotationDeg) return viewport;
  const { rotationDeg: _dropped, ...rest } = viewport;
  return rest;
}

function withViewRotation(viewport: DocumentViewport, deg: number): DocumentViewport {
  if (deg === 0) return resetViewRotation(viewport);
  return { ...viewport, rotationDeg: deg };
}

/** The fixed screen-space pivot (the view/container center) canvas view rotation turns around. */
export function viewRotationPivot(view: Size): Point {
  return { x: view.width / 2, y: view.height / 2 };
}

export function rotateScreenPoint(point: Point, viewport: DocumentViewport, view: Size): Point {
  const deg = normalizeViewRotationDeg(viewport.rotationDeg ?? 0);
  if (deg === 0) return point;
  const pivot = viewRotationPivot(view);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

export function unrotateScreenPoint(point: Point, viewport: DocumentViewport, view: Size): Point {
  const deg = normalizeViewRotationDeg(viewport.rotationDeg ?? 0);
  if (deg === 0) return point;
  return rotateScreenPoint(point, { ...viewport, rotationDeg: -deg }, view);
}

/** Pure device-space rotation parameters for the compositor: pivot + radians. */
export function buildViewRotationTransform(
  viewport: DocumentViewport,
  dpr: number,
  deviceSize: Size,
): { pivotX: number; pivotY: number; radians: number } {
  const deg = normalizeViewRotationDeg(viewport.rotationDeg ?? 0);
  if (deg === 0 || dpr <= 0) return { pivotX: 0, pivotY: 0, radians: 0 };
  return {
    pivotX: (deviceSize.width * dpr) / 2,
    pivotY: (deviceSize.height * dpr) / 2,
    radians: (deg * Math.PI) / 180,
  };
}

/**
 * Compute the zoom + pan that fits the entire document inside the container,
 * preserving aspect ratio. Centers the document.
 */
export function fitToContainer(doc: Size, container: Size): DocumentViewport {
  if (doc.width <= 0 || doc.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { zoom: 1, panX: 0, panY: 0 };
  }
  const zoom = clampZoom(
    Math.min(container.width / doc.width, container.height / doc.height),
  );
  const panX = (container.width - doc.width * zoom) / 2;
  const panY = (container.height - doc.height * zoom) / 2;
  return { zoom, panX, panY };
}

/**
 * Convert a screen-space (container-local) point to document pixel coordinates.
 * When `doc` is provided and the view is rotated, the point is first unrotated
 * around the view pivot so painting, selection, and hit-testing stay accurate
 * under canvas view rotation.
 */
export function screenToDoc(point: Point, viewport: DocumentViewport, view?: Size): Point {
  const unrotated = view ? unrotateScreenPoint(point, viewport, view) : point;
  return {
    x: (unrotated.x - viewport.panX) / viewport.zoom,
    y: (unrotated.y - viewport.panY) / viewport.zoom,
  };
}

/**
 * Convert a document pixel-space point to screen (container-local) coordinates.
 * With `view` (the container size) provided under rotation, the mapped point is
 * rotated around the view pivot to its on-screen position.
 */
export function docToScreen(point: Point, viewport: DocumentViewport, view?: Size): Point {
  const mapped = {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  };
  return view ? rotateScreenPoint(mapped, viewport, view) : mapped;
}

/**
 * Apply a zoom factor while keeping `anchor` (in screen coords) at the same
 * document point. Used by Ctrl+wheel and pinch zoom.
 */
export function zoomAround(
  viewport: DocumentViewport,
  anchor: Point,
  factor: number,
  view?: Size,
): DocumentViewport {
  const resolvedAnchor = view ? unrotateScreenPoint(anchor, viewport, view) : anchor;
  const before = screenToDoc(resolvedAnchor, viewport);
  const newZoom = clampZoom(viewport.zoom * factor);
  const newPanX = resolvedAnchor.x - before.x * newZoom;
  const newPanY = resolvedAnchor.y - before.y * newZoom;
  return {
    zoom: newZoom,
    panX: newPanX,
    panY: newPanY,
    ...(viewport.rotationDeg ? { rotationDeg: viewport.rotationDeg } : {}),
  };
}

/**
 * Translate the view by a delta. Both inputs in screen pixels; with `doc`
 * provided under rotation the delta is unrotated first so a finger moving
 * right always pans the artwork right on screen.
 */
export function panBy(viewport: DocumentViewport, dx: number, dy: number, view?: Size): DocumentViewport {
  if (view) {
    const start = unrotateScreenPoint({ x: 0, y: 0 }, viewport, view);
    const end = unrotateScreenPoint({ x: dx, y: dy }, viewport, view);
    return {
      zoom: viewport.zoom,
      panX: viewport.panX + (end.x - start.x),
      panY: viewport.panY + (end.y - start.y),
      ...(viewport.rotationDeg ? { rotationDeg: viewport.rotationDeg } : {}),
    };
  }
  return {
    zoom: viewport.zoom,
    panX: viewport.panX + dx,
    panY: viewport.panY + dy,
    ...(viewport.rotationDeg ? { rotationDeg: viewport.rotationDeg } : {}),
  };
}

/** A two-finger sample: distance between fingers and their midpoint (screen coords). */
export interface PinchSample {
  dist: number;
  midX: number;
  midY: number;
}

/**
 * Apply one incremental two-finger pinch step: zoom by the change in finger
 * distance anchored at the new midpoint, then pan by the midpoint translation.
 * Drives two-finger pinch-zoom + pan on the image canvas. With `doc` provided
 * under rotation, anchors and deltas are unrotated so zoom keeps the screen
 * anchor stable in a rotated view.
 */
export function applyPinch(
  viewport: DocumentViewport,
  prev: PinchSample,
  next: PinchSample,
  view?: Size,
): DocumentViewport {
  const factor = prev.dist > 0 ? next.dist / prev.dist : 1;
  const anchor = view ? unrotateScreenPoint({ x: next.midX, y: next.midY }, viewport, view) : { x: next.midX, y: next.midY };
  const zoomed = zoomAround(viewport, anchor, factor);
  return panBy(zoomed, next.midX - prev.midX, next.midY - prev.midY, view);
}

/**
 * Compute a screen-space rectangle for a document-space rectangle. Useful for
 * selection bounding boxes and the floating generative-fill prompt anchor.
 * Under view rotation (with `doc` provided) the rectangle's corners are
 * rotated and the returned axis-aligned bounds enclose them, so DOM overlays
 * still cover the visible artwork.
 */
export function docRectToScreen(
  rect: { x: number; y: number; width: number; height: number },
  viewport: DocumentViewport,
  view?: Size,
): { x: number; y: number; width: number; height: number } {
  const base = {
    x: rect.x * viewport.zoom + viewport.panX,
    y: rect.y * viewport.zoom + viewport.panY,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
  if (!view || !viewport.rotationDeg) return base;

  const corners = [
    { x: base.x, y: base.y },
    { x: base.x + base.width, y: base.y },
    { x: base.x, y: base.y + base.height },
    { x: base.x + base.width, y: base.y + base.height },
  ].map((point) => rotateScreenPoint(point, viewport, view));
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface DocumentBlitRegion {
  /** Source sub-rectangle in document (composite) pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination sub-rectangle in device (canvas backing-store) pixels. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Given the document's full device-space placement rect `(x0, y0, rectW, rectH)` (already snapped +
 * DPR-scaled) and the device canvas size, return only the part of the document that actually lands
 * on the canvas — as a source rect in document pixels and a destination rect in device pixels.
 *
 * Why: at high zoom the full document maps to a destination far larger than the canvas
 * (rectW ≈ docWidth × zoom × DPR). Blitting the whole composite into that giant off-canvas rect is
 * wasteful and — on a real GPU compositor surface (Electron/native Wayland, worst at HiDPI) — the
 * oversized scaled drawImage can be dropped entirely, leaving only the checkerboard (a plain
 * fillRect, which the GPU clips fine). Clamping the blit to the visible region keeps the destination
 * within the canvas, so the image always draws. Returns null when the document is fully off-canvas.
 */
export function computeVisibleDocumentBlit(
  x0: number,
  y0: number,
  rectW: number,
  rectH: number,
  docWidth: number,
  docHeight: number,
  deviceWidth: number,
  deviceHeight: number,
): DocumentBlitRegion | null {
  if (!(rectW > 0) || !(rectH > 0) || !(docWidth > 0) || !(docHeight > 0)) return null;
  if (!(deviceWidth > 0) || !(deviceHeight > 0)) return null;

  const vx0 = Math.max(0, x0);
  const vy0 = Math.max(0, y0);
  const vx1 = Math.min(deviceWidth, x0 + rectW);
  const vy1 = Math.min(deviceHeight, y0 + rectH);
  if (vx1 <= vx0 || vy1 <= vy0) return null;

  const scaleX = rectW / docWidth;
  const scaleY = rectH / docHeight;
  const sx = Math.max(0, (vx0 - x0) / scaleX);
  const sy = Math.max(0, (vy0 - y0) / scaleY);
  return {
    sx,
    sy,
    sw: Math.min(docWidth - sx, (vx1 - vx0) / scaleX),
    sh: Math.min(docHeight - sy, (vy1 - vy0) / scaleY),
    dx: vx0,
    dy: vy0,
    dw: vx1 - vx0,
    dh: vy1 - vy0,
  };
}

/**
 * Snap zoom to the nearest "preset" step (used by Ctrl+= / Ctrl+-).
 * Steps grow geometrically so each press feels like an even jump on screen.
 */
export const ZOOM_STEPS = [
  0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
];

export function zoomStepIn(zoom: number): number {
  for (const step of ZOOM_STEPS) {
    if (step > zoom + 0.0001) return clampZoom(step);
  }
  return clampZoom(zoom);
}

export function zoomStepOut(zoom: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    if (ZOOM_STEPS[i] < zoom - 0.0001) return clampZoom(ZOOM_STEPS[i]);
  }
  return clampZoom(zoom);
}

export function zoomViewportStepAroundCenter(
  viewport: DocumentViewport,
  container: Size,
  direction: 'in' | 'out',
  view?: Size,
): DocumentViewport {
  const targetZoom = direction === 'in' ? zoomStepIn(viewport.zoom) : zoomStepOut(viewport.zoom);
  const safeWidth = Number.isFinite(container.width) && container.width > 0 ? container.width : 0;
  const safeHeight = Number.isFinite(container.height) && container.height > 0 ? container.height : 0;
  const anchor = { x: safeWidth / 2, y: safeHeight / 2 };

  if (targetZoom === viewport.zoom) {
    return { ...viewport, zoom: targetZoom };
  }

  return zoomAround(viewport, anchor, targetZoom / viewport.zoom, view);
}
