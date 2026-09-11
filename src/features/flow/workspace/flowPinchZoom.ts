/**
 * Deterministic two-finger pinch math for the Flow canvas viewport.
 *
 * React Flow's built-in `zoomOnPinch` only engages when the gesture reaches the pane's
 * d3-zoom; if a finger lands on a node, the node's drag handler swallows the gesture and
 * the canvas never zooms. To make pinch work anywhere (over nodes included) we intercept
 * the two-finger gesture ourselves and drive `setViewport` directly with this math, so the
 * result never depends on which element happens to be under the fingers.
 *
 * The React Flow viewport is { x, y, zoom } where (x, y) is the screen-space pixel
 * translation of the flow origin and `zoom` is the scale. Midpoints are expressed in
 * coordinates relative to the canvas container (clientX - rect.left, clientY - rect.top).
 */

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PinchSample {
  /** Distance between the two touch points (container-local px). */
  dist: number;
  /** Midpoint between the two touch points (container-local px). */
  midX: number;
  midY: number;
}

export interface ZoomBounds {
  minZoom: number;
  maxZoom: number;
}

export function pinchSampleFromPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): PinchSample {
  return {
    dist: Math.hypot(ax - bx, ay - by),
    midX: (ax + bx) / 2,
    midY: (ay + by) / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Advance the viewport for one pinch frame: pan by the midpoint movement, then scale about
 * the current midpoint so the point under the fingers stays put while zooming.
 */
export function computePinchViewport(
  current: FlowViewport,
  prev: PinchSample,
  next: PinchSample,
  bounds: ZoomBounds,
): FlowViewport {
  const ratio = prev.dist > 0 ? next.dist / prev.dist : 1;
  const targetZoom = clamp(current.zoom * ratio, bounds.minZoom, bounds.maxZoom);
  // Effective scale after clamping (so anchoring stays exact at the zoom limits).
  const scale = current.zoom > 0 ? targetZoom / current.zoom : 1;

  // 1) Pan by how far the two-finger midpoint moved.
  const pannedX = current.x + (next.midX - prev.midX);
  const pannedY = current.y + (next.midY - prev.midY);

  // 2) Scale about the current midpoint, keeping that screen point fixed.
  const x = next.midX - (next.midX - pannedX) * scale;
  const y = next.midY - (next.midY - pannedY) * scale;

  return { x, y, zoom: targetZoom };
}
