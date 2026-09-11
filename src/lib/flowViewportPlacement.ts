/** Axis-aligned screen-space rectangle (client pixel coordinates). */
export interface FlowViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Resolves the screen-space point to treat as "viewport center" when placing newly
 * inserted Flow content (a new node, a starter template, an installed node pack).
 *
 * When a docked Source Bin panel overlaps the flow viewport vertically, the plain
 * geometric center can land behind it — the panel renders above the canvas, so the
 * inserted node is visually hidden under it (MH-094/MH-097 real-browser finding). This
 * shifts the horizontal center rightward, past the panel's right edge, so insertion
 * lands in space the user can actually see. When the panel doesn't overlap (closed,
 * collapsed to a rail, docked elsewhere, or absent), the result is the plain center.
 */
export function resolveFlowViewportCenterScreenPoint(
  viewport: FlowViewportRect,
  sourceBinPanel: FlowViewportRect | null,
): { x: number; y: number } {
  const overlapsVertically = sourceBinPanel !== null
    && sourceBinPanel.top < viewport.bottom
    && sourceBinPanel.bottom > viewport.top;
  const clearLeft = overlapsVertically && sourceBinPanel
    ? Math.max(viewport.left, Math.min(viewport.right, sourceBinPanel.right))
    : viewport.left;

  return {
    x: (clearLeft + viewport.right) / 2,
    y: (viewport.top + viewport.bottom) / 2,
  };
}

/**
 * Resolves the flow-space point to pass to React Flow's `setCenter` so that a target flow
 * point (e.g. a newly-inserted template's geometric center) visually lands at the
 * Source-Bin-aware screen center instead of the viewport's plain geometric center.
 *
 * `setCenter(cx, cy)` always maps flow point `(cx, cy)` to the exact pixel center of the
 * viewport — it has no notion of the docked panel overlay. Placing a node clear of the panel
 * (`resolveFlowViewportCenterScreenPoint`) is undone the moment the camera re-centers on it,
 * because the pan re-centers using the FULL viewport width, dragging the node back under the
 * panel. This computes an adjusted target so the camera settles with the content still clear:
 * it solves for the flow point that, once centered, places `targetFlowPoint` at the clear
 * screen center rather than the viewport's true center.
 */
export function resolveSourceBinAwareSetCenterTarget(params: {
  viewport: FlowViewportRect;
  sourceBinPanel: FlowViewportRect | null;
  targetFlowPoint: { x: number; y: number };
  zoom: number;
}): { x: number; y: number } {
  const { viewport, sourceBinPanel, targetFlowPoint, zoom } = params;
  const clearCenterScreen = resolveFlowViewportCenterScreenPoint(viewport, sourceBinPanel);
  const trueCenterScreenX = (viewport.left + viewport.right) / 2;
  const safeZoom = zoom > 0 ? zoom : 1;
  const deltaScreenX = clearCenterScreen.x - trueCenterScreenX;

  return {
    x: targetFlowPoint.x - deltaScreenX / safeZoom,
    y: targetFlowPoint.y,
  };
}
