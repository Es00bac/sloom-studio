/**
 * Wire/card layering geometry.
 *
 * Flow wires paint above the node layer so a wire is never swallowed by the
 * card it starts or ends on. To keep unrelated cards opaque, every wire is
 * clipped against the union of all node card rectangles, and a second copy of
 * the same wire is clipped to just the cards it is attached to. The union of
 * those two clips reads as "above my own cards, underneath everyone else's".
 */

export const FLOW_CARD_OCCLUDER_CLIP_ID = 'sl-flow-card-occluders';

/** Matches the `rounded-xl` corner of a node card shell. */
export const FLOW_CARD_CORNER_RADIUS = 12;

/**
 * Cards carry a border plus a soft shadow; nudging the occluder outwards keeps
 * a stroke from peeking out along a card edge.
 */
export const FLOW_CARD_OCCLUDER_OUTSET = 1;

/**
 * Half-extent of the synthetic rectangle used as the "everything" area of the
 * even-odd clip. Large enough for any realistic graph, small enough to stay
 * well inside single-precision rasterizer limits.
 */
const OCCLUDER_PLANE_EXTENT = 1_000_000;

export interface FlowCardRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface OccludingNodeLike {
  hidden?: boolean;
  measured?: { height?: number; width?: number };
  internals?: { positionAbsolute?: { x: number; y: number } };
}

/** Collects the on-screen card rectangles that should hide wires. */
export function collectFlowCardRects(
  nodes: Iterable<OccludingNodeLike>,
  outset = FLOW_CARD_OCCLUDER_OUTSET,
): FlowCardRect[] {
  const rects: FlowCardRect[] = [];
  for (const node of nodes) {
    const rect = flowCardRect(node, outset);
    if (rect) rects.push(rect);
  }
  return rects;
}

/** Card rectangle in flow coordinates, or null when the node cannot occlude. */
export function flowCardRect(
  node: OccludingNodeLike | null | undefined,
  outset = FLOW_CARD_OCCLUDER_OUTSET,
): FlowCardRect | null {
  if (!node || node.hidden) return null;
  const position = node.internals?.positionAbsolute;
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  if (!position || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return {
    height: height + outset * 2,
    width: width + outset * 2,
    x: position.x - outset,
    y: position.y - outset,
  };
}

/**
 * Even-odd clip path covering everything except the given card rectangles.
 * Applied to a wire, it lets the stroke render everywhere but under a card.
 */
export function buildCardOccluderClipPath(
  rects: FlowCardRect[],
  radius = FLOW_CARD_CORNER_RADIUS,
): string {
  const plane = `M ${-OCCLUDER_PLANE_EXTENT} ${-OCCLUDER_PLANE_EXTENT} H ${OCCLUDER_PLANE_EXTENT} V ${OCCLUDER_PLANE_EXTENT} H ${-OCCLUDER_PLANE_EXTENT} Z`;
  if (rects.length === 0) return plane;
  return [plane, ...rects.map((rect) => roundedRectPath(rect, radius))].join(' ');
}

/** Single rounded-rectangle subpath, matching the node card silhouette. */
export function roundedRectPath(rect: FlowCardRect, radius = FLOW_CARD_CORNER_RADIUS): string {
  const { height, width, x, y } = rect;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const right = x + width;
  const bottom = y + height;
  if (r === 0) {
    return `M ${round(x)} ${round(y)} H ${round(right)} V ${round(bottom)} H ${round(x)} Z`;
  }
  return [
    `M ${round(x + r)} ${round(y)}`,
    `H ${round(right - r)}`,
    `A ${round(r)} ${round(r)} 0 0 1 ${round(right)} ${round(y + r)}`,
    `V ${round(bottom - r)}`,
    `A ${round(r)} ${round(r)} 0 0 1 ${round(right - r)} ${round(bottom)}`,
    `H ${round(x + r)}`,
    `A ${round(r)} ${round(r)} 0 0 1 ${round(x)} ${round(bottom - r)}`,
    `V ${round(y + r)}`,
    `A ${round(r)} ${round(r)} 0 0 1 ${round(x + r)} ${round(y)}`,
    'Z',
  ].join(' ');
}

/** Stable clip id for the cards a single wire is attached to. */
export function flowEdgeAttachedClipId(edgeId: string): string {
  return `sl-flow-edge-cards-${edgeId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
