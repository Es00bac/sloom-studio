import type { PaperFrame } from '../types/paper';

interface Point {
  x: number;
  y: number;
}

const BUBBLE_CENTER: Point = { x: 50, y: 50 };
const TAIL_CURVE_MAX_OFFSET_RATIO = 0.3;

export function buildPaperBubblePath(frame: PaperFrame): string {
  return frame.kind === 'thoughtBubble'
    ? buildThoughtBubblePath(frame)
    : buildSpeechBubblePath(frame);
}

/** Point on the speech-balloon body (not its tail), in the frame's normalized 0..100 space. */
export function resolvePaperBubbleBodyPoint(frame: PaperFrame, angleDeg: number): Point {
  return pointOnBubble(resolveBubbleRadii(frame), angleDeg * Math.PI / 180);
}

/**
 * Samples the exact cubic path used by live/print speech balloons. The result is a simple polygon
 * suitable for compound-outline boolean operations; thought clouds are deliberately excluded because
 * their detached tail dots are multiple subpaths rather than one continuous balloon silhouette.
 */
export function samplePaperSpeechBubblePath(frame: PaperFrame, samplesPerCubic?: number): Point[] {
  if (frame.kind !== 'speechBubble') return [];
  // Bound chord error to roughly 0.015 mm even for unusually large display balloons. For a
  // quarter-circle cubic, n >= (π/4)/acos(1-error/r) keeps each flattened chord below that sagitta.
  const radiusMm = Math.max(frame.widthMm, frame.heightMm) / 2;
  const errorMm = 0.015;
  const adaptiveSamples = Math.ceil((Math.PI / 4) / Math.acos(Math.max(-1, 1 - errorMm / Math.max(errorMm, radiusMm))));
  const resolvedSamples = Math.max(18, Math.min(128, samplesPerCubic ?? adaptiveSamples));
  const tokens = buildSpeechBubblePath(frame).match(/[MCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const points: Point[] = [];
  let index = 0;
  let current: Point | undefined;

  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      current = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      points.push(current);
      continue;
    }
    if (command === 'C' && current) {
      const control1 = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      const control2 = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      const end = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      const start = current;
      for (let sample = 1; sample <= resolvedSamples; sample += 1) {
        const amount = sample / resolvedSamples;
        const inverse = 1 - amount;
        points.push({
          x: round((inverse ** 3 * start.x)
            + (3 * inverse ** 2 * amount * control1.x)
            + (3 * inverse * amount ** 2 * control2.x)
            + (amount ** 3 * end.x)),
          y: round((inverse ** 3 * start.y)
            + (3 * inverse ** 2 * amount * control1.y)
            + (3 * inverse * amount ** 2 * control2.y)
            + (amount ** 3 * end.y)),
        });
      }
      current = end;
      continue;
    }
    if (command === 'Z') continue;
    throw new Error(`Unsupported speech-bubble path command: ${command}`);
  }

  return points;
}

/** Samples only the continuous balloon body, deliberately excluding the speaker tail. */
export function samplePaperSpeechBubbleBody(frame: PaperFrame): Point[] {
  if (frame.kind !== 'speechBubble') return [];
  const radiusMm = Math.max(frame.widthMm, frame.heightMm) / 2;
  const errorMm = 0.015;
  const samplesPerQuarter = Math.max(18, Math.min(128, Math.ceil(
    (Math.PI / 4) / Math.acos(Math.max(-1, 1 - errorMm / Math.max(errorMm, radiusMm))),
  )));
  const sampleCount = samplesPerQuarter * 4;
  return Array.from({ length: sampleCount }, (_, index) => (
    resolvePaperBubbleBodyPoint(frame, index / sampleCount * 360)
  ));
}

export interface BubbleRadii {
  rLeft: number;
  rRight: number;
  rTop: number;
  rBottom: number;
}

// Legacy multipliers (unchanged) preserve every previously-authored bubble; the wider per-side clamp
// only applies when a side is explicitly set, so the handles produce a visible bulge/pinch.
const BUBBLE_BASE_RADIUS_X = 45;
const BUBBLE_BASE_RADIUS_Y = 38;
const BUBBLE_WARP_MULT_X = 4;
const BUBBLE_WARP_MULT_Y = 5;

export function resolveBubbleRadii(frame: PaperFrame): BubbleRadii {
  if (frame.bubbleShape === 'squircle') {
    return { rLeft: 44, rRight: 44, rTop: 36, rBottom: 36 };
  }
  const symmetricWarp = clamp(frame.bubbleWarp ?? 0.18, -0.35, 0.5);
  const sideRadius = (value: number | undefined, base: number, mult: number): number => (
    typeof value === 'number' && Number.isFinite(value)
      ? base + clamp(value, -0.8, 0.9) * mult
      : base + symmetricWarp * mult
  );
  return {
    rLeft: sideRadius(frame.bubbleWarpLeft, BUBBLE_BASE_RADIUS_X, BUBBLE_WARP_MULT_X),
    rRight: sideRadius(frame.bubbleWarpRight, BUBBLE_BASE_RADIUS_X, BUBBLE_WARP_MULT_X),
    rTop: sideRadius(frame.bubbleWarpTop, BUBBLE_BASE_RADIUS_Y, BUBBLE_WARP_MULT_Y),
    rBottom: sideRadius(frame.bubbleWarpBottom, BUBBLE_BASE_RADIUS_Y, BUBBLE_WARP_MULT_Y),
  };
}

function radiiAtAngle(radii: BubbleRadii, angle: number): { rx: number; ry: number } {
  // +y is down (screen coords), so sin >= 0 is the bottom edge.
  return {
    rx: Math.cos(angle) >= 0 ? radii.rRight : radii.rLeft,
    ry: Math.sin(angle) >= 0 ? radii.rBottom : radii.rTop,
  };
}

function pointOnBubble(radii: BubbleRadii, angle: number): Point {
  const { rx, ry } = radiiAtAngle(radii, angle);
  return {
    x: round(BUBBLE_CENTER.x + Math.cos(angle) * rx),
    y: round(BUBBLE_CENTER.y + Math.sin(angle) * ry),
  };
}

/** Cubic-bezier commands for a (possibly asymmetric) bubble body, split at every quadrant boundary so
 *  each sub-arc keeps one (rx, ry) pair. Quarter-ellipses meet with matching vertical/horizontal tangents
 *  at the axis points, so independent per-side radii stay smooth instead of kinking. */
function bubbleArcCommands(radii: BubbleRadii, startAngle: number, endAngle: number): string[] {
  const commands: string[] = [];
  const dir = endAngle >= startAngle ? 1 : -1;
  const quarter = Math.PI / 2;
  const EPS = 1e-9;
  let a0 = startAngle;
  let guard = 0;
  while ((dir > 0 ? a0 < endAngle - EPS : a0 > endAngle + EPS) && guard < 64) {
    guard += 1;
    let a1 = dir > 0
      ? (Math.floor(a0 / quarter + EPS) + 1) * quarter
      : (Math.ceil(a0 / quarter - EPS) - 1) * quarter;
    if (dir > 0 ? a1 > endAngle : a1 < endAngle) a1 = endAngle;
    if (Math.abs(a1 - a0) > EPS) {
      const mid = (a0 + a1) / 2;
      const { rx, ry } = radiiAtAngle(radii, mid);
      const alpha = (4 / 3) * Math.tan((a1 - a0) / 4);
      const control1 = {
        x: round(BUBBLE_CENTER.x + rx * (Math.cos(a0) - alpha * Math.sin(a0))),
        y: round(BUBBLE_CENTER.y + ry * (Math.sin(a0) + alpha * Math.cos(a0))),
      };
      const control2 = {
        x: round(BUBBLE_CENTER.x + rx * (Math.cos(a1) + alpha * Math.sin(a1))),
        y: round(BUBBLE_CENTER.y + ry * (Math.sin(a1) - alpha * Math.cos(a1))),
      };
      const end = pointOnBubble(radii, a1);
      commands.push(`C ${formatPoint(control1)} ${formatPoint(control2)} ${formatPoint(end)}`);
    }
    a0 = a1;
  }
  return commands;
}

export function buildSpeechBubblePath(frame: PaperFrame): string {
  const tail = resolveBubbleTail(frame);
  const base = resolveBubbleBase(frame, frame.bubbleShape === 'oval' ? 45 : 43, frame.bubbleShape === 'oval' ? 39 : 37);
  const tailWidth = clamp(frame.bubbleTailWidthPercent ?? 18, 4, 38);
  const radii = resolveBubbleRadii(frame);
  const baseRadiusX = base.x >= BUBBLE_CENTER.x ? radii.rRight : radii.rLeft;
  const baseRadiusY = base.y >= BUBBLE_CENTER.y ? radii.rBottom : radii.rTop;
  const baseAngle = Math.atan2((base.y - BUBBLE_CENTER.y) / baseRadiusY, (base.x - BUBBLE_CENTER.x) / baseRadiusX);
  const tailGapRadians = clamp(tailWidth / 110, 0.06, 0.4);
  const startAngle = baseAngle - tailGapRadians;
  const endAngle = baseAngle + tailGapRadians;
  const start = pointOnBubble(radii, startAngle);
  const end = pointOnBubble(radii, endAngle);
  const curveHandle = resolveTailCurveHandle(base, tail, frame.bubbleTailCurvePercent);
  const tailInControl = lerpPoint(end, curveHandle, 0.62);
  const tailOutControl = lerpPoint(tail, curveHandle, 0.52);
  const returnInControl = lerpPoint(tail, curveHandle, 0.52);
  const returnOutControl = lerpPoint(start, curveHandle, 0.62);
  // A bubble with no per-side warp is symmetric; keep the exact legacy arc so pre-existing art is
  // byte-for-byte identical. Only genuinely per-side bubbles take the quadrant-split path.
  const bodyCommands = radii.rLeft === radii.rRight && radii.rTop === radii.rBottom
    ? ellipseCubicArcCommands(radii.rRight, radii.rBottom, startAngle, endAngle - Math.PI * 2)
    : bubbleArcCommands(radii, startAngle, endAngle - Math.PI * 2);

  return `M ${formatPoint(start)} ${bodyCommands.join(' ')} C ${formatPoint(tailInControl)} ${formatPoint(tailOutControl)} ${formatPoint(tail)} C ${formatPoint(returnInControl)} ${formatPoint(returnOutControl)} ${formatPoint(start)} Z`;
}

export function buildThoughtBubblePath(frame: PaperFrame): string {
  const tail = resolveBubbleTail(frame);
  const base = resolveBubbleBase(frame, 43, 38);
  const path = [
    'M 50 5',
    'C 66 1 77 9 80 19',
    'C 94 20 100 34 94 47',
    'C 101 62 91 78 75 79',
    'C 70 93 52 99 39 91',
    'C 25 100 7 88 8 70',
    'C -3 60 0 40 12 34',
    'C 10 18 27 7 42 12',
    'C 44 9 47 6 50 5',
    'Z',
  ];
  const curveHandle = resolveTailCurveHandle(base, tail, frame.bubbleTailCurvePercent);
  const tailBubbleA = quadraticPoint(base, curveHandle, tail, 0.38);
  const tailBubbleB = quadraticPoint(base, curveHandle, tail, 0.68);

  return [
    path.join(' '),
    circleSubpath(tailBubbleA, 5.5),
    circleSubpath(tailBubbleB, 3.8),
    circleSubpath(tail, 2.4),
  ].join(' ');
}

export function resolveBubbleTailCurveHandle(frame: PaperFrame): Point {
  const tail = resolveBubbleTail(frame);
  const base = resolveBubbleBase(frame, 43, 38);
  return resolveTailCurveHandle(base, tail, frame.bubbleTailCurvePercent);
}

export function resolveBubbleTailCurvePercent(frame: PaperFrame, point: Point): number {
  const tail = resolveBubbleTail(frame);
  const base = resolveBubbleBase(frame, 43, 38);
  const axis = normalizePoint({
    x: tail.x - base.x,
    y: tail.y - base.y,
  });
  const distance = Math.max(1, Math.hypot(tail.x - base.x, tail.y - base.y));
  const midpoint = lerpPoint(base, tail, 0.5);
  const normal = { x: -axis.y, y: axis.x };
  const projectedOffset = ((point.x - midpoint.x) * normal.x) + ((point.y - midpoint.y) * normal.y);
  const maxOffset = distance * TAIL_CURVE_MAX_OFFSET_RATIO;
  return round(clamp(50 + (projectedOffset / maxOffset) * 50, 0, 100));
}

function resolveBubbleTail(frame: PaperFrame): Point {
  return {
    x: round(finiteOr(frame.tailXPercent, 72)),
    y: round(finiteOr(frame.tailYPercent, 92)),
  };
}

function resolveBubbleBase(frame: PaperFrame, radiusX: number, radiusY: number): Point {
  const targetX = clamp(frame.bubblePinchXPercent ?? 58, 0, 100);
  const targetY = clamp(frame.bubblePinchYPercent ?? 75, 0, 100);
  const normalizedX = (targetX - BUBBLE_CENTER.x) / radiusX;
  const normalizedY = (targetY - BUBBLE_CENTER.y) / radiusY;
  const length = Math.hypot(normalizedX, normalizedY);

  if (length < 0.001) {
    return pointOnEllipse(radiusX, radiusY, Math.PI / 2);
  }

  return {
    x: round(BUBBLE_CENTER.x + (normalizedX / length) * radiusX),
    y: round(BUBBLE_CENTER.y + (normalizedY / length) * radiusY),
  };
}

function pointOnEllipse(radiusX: number, radiusY: number, angle: number): Point {
  return {
    x: round(BUBBLE_CENTER.x + Math.cos(angle) * radiusX),
    y: round(BUBBLE_CENTER.y + Math.sin(angle) * radiusY),
  };
}

function ellipseCubicArcCommands(radiusX: number, radiusY: number, startAngle: number, endAngle: number): string[] {
  const delta = endAngle - startAngle;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const commands: string[] = [];

  for (let index = 0; index < segments; index += 1) {
    const angle0 = startAngle + step * index;
    const angle1 = angle0 + step;
    const alpha = (4 / 3) * Math.tan((angle1 - angle0) / 4);
    const control1 = {
      x: round(BUBBLE_CENTER.x + radiusX * (Math.cos(angle0) - alpha * Math.sin(angle0))),
      y: round(BUBBLE_CENTER.y + radiusY * (Math.sin(angle0) + alpha * Math.cos(angle0))),
    };
    const control2 = {
      x: round(BUBBLE_CENTER.x + radiusX * (Math.cos(angle1) + alpha * Math.sin(angle1))),
      y: round(BUBBLE_CENTER.y + radiusY * (Math.sin(angle1) - alpha * Math.cos(angle1))),
    };
    const end = pointOnEllipse(radiusX, radiusY, angle1);

    commands.push(`C ${formatPoint(control1)} ${formatPoint(control2)} ${formatPoint(end)}`);
  }

  return commands;
}

function circleSubpath(center: Point, radius: number): string {
  const r = round(radius);
  return `M ${formatPoint(center)} m ${r} 0 a ${r} ${r} 0 1 0 ${round(-r * 2)} 0 a ${r} ${r} 0 1 0 ${round(r * 2)} 0 Z`;
}

function lerpPoint(from: Point, to: Point, amount: number): Point {
  return {
    x: round(from.x + (to.x - from.x) * amount),
    y: round(from.y + (to.y - from.y) * amount),
  };
}

function quadraticPoint(from: Point, control: Point, to: Point, amount: number): Point {
  const inverse = 1 - amount;
  return {
    x: round((inverse * inverse * from.x) + (2 * inverse * amount * control.x) + (amount * amount * to.x)),
    y: round((inverse * inverse * from.y) + (2 * inverse * amount * control.y) + (amount * amount * to.y)),
  };
}

function resolveTailCurveHandle(base: Point, tail: Point, curvePercent: number | undefined): Point {
  const axis = normalizePoint({
    x: tail.x - base.x,
    y: tail.y - base.y,
  });
  const distance = Math.max(1, Math.hypot(tail.x - base.x, tail.y - base.y));
  const midpoint = lerpPoint(base, tail, 0.5);
  const normal = { x: -axis.y, y: axis.x };
  const curveAmount = (clamp(finiteOr(curvePercent, 55), 0, 100) - 50) / 50;
  const offset = distance * TAIL_CURVE_MAX_OFFSET_RATIO * curveAmount;
  return {
    x: round(midpoint.x + normal.x * offset),
    y: round(midpoint.y + normal.y * offset),
  };
}

function normalizePoint(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  if (length < 0.001) return { x: 0, y: 1 };
  return {
    x: point.x / length,
    y: point.y / length,
  };
}

function formatPoint(point: Point): string {
  return `${round(point.x)} ${round(point.y)}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
