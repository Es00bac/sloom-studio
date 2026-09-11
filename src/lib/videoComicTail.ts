/**
 * Pure comic speech-bubble / thought-bubble tail geometry for the Video workspace.
 *
 * This is the Video-side adaptation of Paper's reusable bezier tail
 * (`src/lib/paperBubblePaths.ts` — `buildSpeechBubblePath` / `resolveBubbleTailCurveHandle`).
 * Where Paper works in a fixed 0–100 SVG viewbox, the Video painter draws into a px canvas whose
 * bubble body is centred on the origin and spans [-halfWidth, halfWidth] × [-halfHeight, halfHeight].
 *
 * The tail model driven by the clip fields Phase 1 added (`comicTailTipXPercent`,
 * `comicTailTipYPercent`, `comicTailCurvePercent`) and the keyframe channels
 * (`tailTipXPercent` / `tailTipYPercent` / `tailCurvePercent`, resolved per playhead progress):
 *
 *  - The tip is expressed as a percent of the bubble frame (0–100, origin top-left, 50/50 = body
 *    centre). The body edge sits at `COMIC_BODY_RADIUS_PERCENT` (45) from centre — i.e. the body
 *    occupies ~90% of the tip-percent frame, matching Paper's ellipse radius and the polar→bezier
 *    migration in `manualEditorState.ts`. Tips beyond [5, 95] (i.e. beyond 45 from centre) poke out
 *    of the body; tips can exceed [0, 100] to reach further toward a character face.
 *  - The funnel curvature (`curvePercent`, 0–100, 50 = straight) bows the tail toward one side by
 *    offsetting the bezier control handle perpendicular to the base→tip axis (Paper parity, same
 *    0.3 max-offset ratio).
 *
 * Everything here is canvas-free and deterministic so it can be unit-tested directly; the painter in
 * `mediaComposition.ts` consumes the returned points to build a `Path2D`.
 */

export interface ComicTailPoint {
  x: number;
  y: number;
}

/** Body half-extent in tip-percent space. Tip percent 95 (or 5) lands on the body edge. */
export const COMIC_BODY_RADIUS_PERCENT = 45;

/** Paper parity: max perpendicular curve-handle offset as a fraction of the base→tip distance. */
const COMIC_TAIL_CURVE_MAX_OFFSET_RATIO = 0.3;
/** Minimum poke of the tail beyond the body edge, as a fraction of the smaller body half-extent. */
const COMIC_TAIL_MIN_POKE_RATIO = 0.18;
/** Tail mouth half-width where it joins the body, as a fraction of the smaller body half-extent. */
const COMIC_TAIL_MOUTH_RATIO = 0.16;
/** Legacy polar length (px) → tip distance (percent) scale, mirroring the Phase 1 migration. */
const COMIC_TAIL_PX_TO_PERCENT = 0.2;
/**
 * Base tip distance (percent) for the polar→bezier fallback. Kept identical to
 * `manualEditorState.COMIC_TAIL_BODY_RADIUS_PERCENT` (30) so this painter fallback matches the
 * clip-normalize migration exactly. Note: this is the polar seed distance, NOT the body edge
 * ({@link COMIC_BODY_RADIUS_PERCENT} = 45); a default ~90px tail lands ~48 from centre, poking just
 * beyond the body edge.
 */
const COMIC_POLAR_TAIL_BASE_PERCENT = 30;
const COMIC_TAIL_DEFAULT_ANGLE_DEG = 115;
const COMIC_TAIL_DEFAULT_LENGTH_PX = 90;

/** Default bezier tip (down-right, poking below the body) when a bubble has no tail data at all. */
export const COMIC_TAIL_DEFAULT_TIP_X_PERCENT = 72;
export const COMIC_TAIL_DEFAULT_TIP_Y_PERCENT = 116;
/** Neutral (straight) funnel. */
export const COMIC_TAIL_DEFAULT_CURVE_PERCENT = 50;

export interface ComicTailGeometryInput {
  /** Body box half-width in px (body spans [-halfWidth, halfWidth]). */
  halfWidth: number;
  /** Body box half-height in px. */
  halfHeight: number;
  /** Tail tip X as a percent of the bubble frame (50 = centre; may exceed [0,100]). */
  tipXPercent: number;
  /** Tail tip Y as a percent of the bubble frame (50 = centre; may exceed [0,100]). */
  tipYPercent: number;
  /** Funnel curvature 0–100 (50 = straight). */
  curvePercent: number;
  /** Body outline the tail attaches to: rounded-rect (speech) or ellipse (thought). */
  bodyShape: 'rect' | 'ellipse';
}

export interface ComicTailGeometry {
  /** Attachment centre on the body boundary along the centre→tip ray. */
  base: ComicTailPoint;
  /** Left / right corners of the tail mouth on the body boundary. */
  baseLeft: ComicTailPoint;
  baseRight: ComicTailPoint;
  /** The drawn tip (equal to the requested tip, or pushed out to guarantee a visible poke). */
  tip: ComicTailPoint;
  /** Perpendicular-offset control point encoding the funnel curvature. */
  curveHandle: ComicTailPoint;
  /** Cubic controls for baseLeft → tip. */
  leftControl1: ComicTailPoint;
  leftControl2: ComicTailPoint;
  /** Cubic controls for tip → baseRight. */
  rightControl1: ComicTailPoint;
  rightControl2: ComicTailPoint;
}

/** Maps a tail-tip percent to a px offset from the body centre for one axis. */
export function comicTailTipPercentToPx(tipPercent: number, halfExtentPx: number): number {
  return ((finiteOr(tipPercent, 50) - 50) / COMIC_BODY_RADIUS_PERCENT) * halfExtentPx;
}

/** Inverse of {@link comicTailTipPercentToPx}: a px offset from centre back to a tip percent. */
export function comicTailPxToTipPercent(px: number, halfExtentPx: number): number {
  if (!Number.isFinite(halfExtentPx) || Math.abs(halfExtentPx) < 1e-6) {
    return 50;
  }
  return 50 + (px / halfExtentPx) * COMIC_BODY_RADIUS_PERCENT;
}

/**
 * Converts a legacy polar tail (angle deg — 0 = right, 90 = down; length px) to a bezier tip
 * percent, mirroring `manualEditorState.migrateComicPolarTailToBezierTip` so the painter's fallback
 * matches the clip-normalize path. Returns `undefined` when no polar data is present.
 */
export function comicPolarTailToTipPercent(
  angleDeg: number | undefined,
  lengthPx: number | undefined,
): { tipXPercent: number; tipYPercent: number } | undefined {
  const hasAngle = typeof angleDeg === 'number' && Number.isFinite(angleDeg);
  const hasLength = typeof lengthPx === 'number' && Number.isFinite(lengthPx);
  if (!hasAngle && !hasLength) {
    return undefined;
  }

  const resolvedAngleDeg = hasAngle ? (angleDeg as number) : COMIC_TAIL_DEFAULT_ANGLE_DEG;
  const resolvedLengthPx = Math.max(0, hasLength ? (lengthPx as number) : COMIC_TAIL_DEFAULT_LENGTH_PX);
  const angleRad = resolvedAngleDeg * (Math.PI / 180);
  const distancePercent = clamp(
    COMIC_POLAR_TAIL_BASE_PERCENT + resolvedLengthPx * COMIC_TAIL_PX_TO_PERCENT,
    22,
    72,
  );

  return {
    tipXPercent: clamp(50 + Math.cos(angleRad) * distancePercent, 0, 100),
    tipYPercent: clamp(50 + Math.sin(angleRad) * distancePercent, 0, 100),
  };
}

/**
 * Resolves the full bezier tail geometry (attachment, tip, curve handle, cubic controls) for a comic
 * bubble body of the given half-extents. Pure; the painter turns the returned points into a Path2D.
 */
export function resolveComicTailGeometry(input: ComicTailGeometryInput): ComicTailGeometry {
  const halfWidth = Math.max(1, input.halfWidth);
  const halfHeight = Math.max(1, input.halfHeight);
  const minHalf = Math.min(halfWidth, halfHeight);

  const tipPx: ComicTailPoint = {
    x: comicTailTipPercentToPx(input.tipXPercent, halfWidth),
    y: comicTailTipPercentToPx(input.tipYPercent, halfHeight),
  };

  // Direction from the body centre toward the requested tip. Fall back to straight down when the
  // tip collapses onto the centre so the tail never degenerates to a zero-length ray.
  const tipLength = Math.hypot(tipPx.x, tipPx.y);
  const dir = tipLength < 1e-6 ? { x: 0, y: 1 } : { x: tipPx.x / tipLength, y: tipPx.y / tipLength };

  const base = bodyBoundaryPoint(dir, halfWidth, halfHeight, input.bodyShape);
  const baseDist = Math.hypot(base.x, base.y);

  // Guarantee a visible poke: if the requested tip lands inside (or barely beyond) the body, push it
  // out along the base→tip ray by a minimum amount. Far tips (a character face across the panel)
  // stay exactly where requested.
  const minPoke = COMIC_TAIL_MIN_POKE_RATIO * minHalf;
  const tip: ComicTailPoint =
    tipLength >= baseDist + minPoke
      ? tipPx
      : { x: dir.x * (baseDist + minPoke), y: dir.y * (baseDist + minPoke) };

  const perp: ComicTailPoint = { x: -dir.y, y: dir.x };
  const tailAxisLength = Math.hypot(tip.x - base.x, tip.y - base.y);
  const mouthHalf = Math.min(COMIC_TAIL_MOUTH_RATIO * minHalf, 0.6 * Math.max(1, tailAxisLength));
  const baseLeft: ComicTailPoint = { x: base.x + perp.x * mouthHalf, y: base.y + perp.y * mouthHalf };
  const baseRight: ComicTailPoint = { x: base.x - perp.x * mouthHalf, y: base.y - perp.y * mouthHalf };

  const curveHandle = resolveTailCurveHandle(base, tip, input.curvePercent);

  return {
    base,
    baseLeft,
    baseRight,
    tip,
    curveHandle,
    leftControl1: lerpPoint(baseLeft, curveHandle, 0.62),
    leftControl2: lerpPoint(tip, curveHandle, 0.52),
    rightControl1: lerpPoint(tip, curveHandle, 0.52),
    rightControl2: lerpPoint(baseRight, curveHandle, 0.62),
  };
}

/** Quadratic bezier sample through (from, control, to). Used for thought-bubble puff placement. */
export function comicTailQuadraticPoint(
  from: ComicTailPoint,
  control: ComicTailPoint,
  to: ComicTailPoint,
  amount: number,
): ComicTailPoint {
  const inverse = 1 - amount;
  return {
    x: inverse * inverse * from.x + 2 * inverse * amount * control.x + amount * amount * to.x,
    y: inverse * inverse * from.y + 2 * inverse * amount * control.y + amount * amount * to.y,
  };
}

function bodyBoundaryPoint(
  dir: ComicTailPoint,
  halfWidth: number,
  halfHeight: number,
  bodyShape: 'rect' | 'ellipse',
): ComicTailPoint {
  if (bodyShape === 'ellipse') {
    const denom = Math.hypot(dir.x / halfWidth, dir.y / halfHeight);
    const edge = denom < 1e-6 ? Math.min(halfWidth, halfHeight) : 1 / denom;
    return { x: dir.x * edge, y: dir.y * edge };
  }

  const edge = 1 / Math.max(Math.abs(dir.x) / halfWidth, Math.abs(dir.y) / halfHeight, 1e-6);
  return { x: dir.x * edge, y: dir.y * edge };
}

function resolveTailCurveHandle(
  base: ComicTailPoint,
  tip: ComicTailPoint,
  curvePercent: number,
): ComicTailPoint {
  const axisLength = Math.max(1, Math.hypot(tip.x - base.x, tip.y - base.y));
  const axis = { x: (tip.x - base.x) / axisLength, y: (tip.y - base.y) / axisLength };
  const normal = { x: -axis.y, y: axis.x };
  const midpoint = lerpPoint(base, tip, 0.5);
  const curveAmount = (clamp(finiteOr(curvePercent, COMIC_TAIL_DEFAULT_CURVE_PERCENT), 0, 100) - 50) / 50;
  const offset = axisLength * COMIC_TAIL_CURVE_MAX_OFFSET_RATIO * curveAmount;
  return { x: midpoint.x + normal.x * offset, y: midpoint.y + normal.y * offset };
}

function lerpPoint(from: ComicTailPoint, to: ComicTailPoint, amount: number): ComicTailPoint {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
