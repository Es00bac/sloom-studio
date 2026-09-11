/**
 * Pressure (and other sensor) response curves for the brush engine.
 *
 * A response curve remaps a normalized 0..1 sensor input (pen pressure) through a
 * user-shaped transfer function before it drives size/opacity/flow. This is the
 * Krita "pressure curve" / Photoshop "transfer" feature: it lets a stylus feel
 * softer (light pressure does little) or harder (light pressure already strong).
 *
 * The default `linear` curve is the identity, so brushes behave exactly as before
 * unless a curve is explicitly configured.
 *
 * Pure, canvas-free, typed-array-free — runs identically on Desktop, Android,
 * ALOS and DeX (the WebView path included).
 */

import type {
  BrushCurvePoint,
  BrushResponseCurve,
  BrushResponseCurvePreset,
} from '../../types/imageEditor';

export type { BrushCurvePoint, BrushResponseCurve, BrushResponseCurvePreset };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export const RESPONSE_CURVE_PRESETS: Record<BrushResponseCurvePreset, BrushCurvePoint[]> = {
  // Identity — pressure maps straight through.
  linear: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  // Ease-in: light pressure does little, response builds late (a softer, more
  // forgiving feel — common for sketching and fine line work).
  soft: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.25 },
    { x: 1, y: 1 },
  ],
  // Ease-out: light pressure already lays down strongly (a snappier, more
  // responsive feel — common for inking).
  hard: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.75 },
    { x: 1, y: 1 },
  ],
  // S-curve: damps both extremes, accentuates the mid-range.
  sshape: [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.12 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.88 },
    { x: 1, y: 1 },
  ],
};

function sanitizePoints(points: BrushCurvePoint[]): BrushCurvePoint[] {
  const cleaned = points
    .filter((p) => p != null && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);
  return cleaned.length > 0 ? cleaned : RESPONSE_CURVE_PRESETS.linear;
}

/**
 * Normalize a curve *setting* while preserving its form: a known preset name
 * stays a string (so the UI and serialization keep the preset identity), an
 * explicit point array is sanitized, and anything missing/invalid becomes
 * 'linear'. Use this for storage; use `resolveResponseCurve` / `evalResponseCurve`
 * when you need concrete points.
 */
export function normalizeResponseCurve(curve: BrushResponseCurve | undefined | null): BrushResponseCurve {
  if (curve == null) return 'linear';
  if (typeof curve === 'string') {
    return (curve in RESPONSE_CURVE_PRESETS ? curve : 'linear') as BrushResponseCurvePreset;
  }
  return sanitizePoints(curve);
}

/** Resolve a curve setting (preset name, point array, or undefined) into clean points. */
export function resolveResponseCurve(curve: BrushResponseCurve | undefined | null): BrushCurvePoint[] {
  if (curve == null) return RESPONSE_CURVE_PRESETS.linear;
  if (typeof curve === 'string') {
    return RESPONSE_CURVE_PRESETS[curve] ?? RESPONSE_CURVE_PRESETS.linear;
  }
  return sanitizePoints(curve);
}

/**
 * Evaluate a response curve at `input` (clamped to 0..1) using piecewise-linear
 * interpolation between control points. Inputs before the first / after the last
 * point clamp to that endpoint's output.
 */
export function evalResponseCurve(curve: BrushResponseCurve | undefined | null, input: number): number {
  const points = resolveResponseCurve(curve);
  const x = clamp01(input);

  if (x <= points[0].x) return clamp01(points[0].y);
  const last = points[points.length - 1];
  if (x >= last.x) return clamp01(last.y);

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    if (x <= p1.x) {
      const span = p1.x - p0.x;
      if (span <= 0) return clamp01(p1.y); // coincident x — take the later point
      const t = (x - p0.x) / span;
      return clamp01(p0.y + (p1.y - p0.y) * t);
    }
  }
  return clamp01(last.y);
}
