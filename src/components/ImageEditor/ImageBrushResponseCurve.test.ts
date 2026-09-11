import { describe, expect, it } from 'vitest';
import {
  RESPONSE_CURVE_PRESETS,
  evalResponseCurve,
  normalizeResponseCurve,
  resolveResponseCurve,
  type BrushCurvePoint,
} from './ImageBrushResponseCurve';

describe('ImageBrushResponseCurve', () => {
  it('treats the linear preset (and undefined) as the identity', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(evalResponseCurve('linear', x)).toBeCloseTo(x, 6);
      expect(evalResponseCurve(undefined, x)).toBeCloseTo(x, 6);
    }
  });

  it('soft (ease-in) dampens low/mid pressure below identity', () => {
    expect(evalResponseCurve('soft', 0.5)).toBeLessThan(0.5);
    // endpoints still pinned
    expect(evalResponseCurve('soft', 0)).toBeCloseTo(0, 6);
    expect(evalResponseCurve('soft', 1)).toBeCloseTo(1, 6);
  });

  it('hard (ease-out) lifts low/mid pressure above identity', () => {
    expect(evalResponseCurve('hard', 0.5)).toBeGreaterThan(0.5);
    expect(evalResponseCurve('hard', 0)).toBeCloseTo(0, 6);
    expect(evalResponseCurve('hard', 1)).toBeCloseTo(1, 6);
  });

  it('clamps inputs outside [0,1] to the curve endpoints', () => {
    expect(evalResponseCurve('linear', -3)).toBeCloseTo(0, 6);
    expect(evalResponseCurve('linear', 4)).toBeCloseTo(1, 6);
  });

  it('interpolates a custom control-point array piecewise-linearly', () => {
    const curve: BrushCurvePoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 1 },
    ];
    // halfway up the first segment: 0 -> 0.8 at x=0.25 => 0.4
    expect(evalResponseCurve(curve, 0.25)).toBeCloseTo(0.4, 6);
    // on the second segment at x=0.75: 0.8 -> 1.0 midpoint => 0.9
    expect(evalResponseCurve(curve, 0.75)).toBeCloseTo(0.9, 6);
    // exact control points returned exactly
    expect(evalResponseCurve(curve, 0.5)).toBeCloseTo(0.8, 6);
  });

  it('sanitizes dirty point arrays (sorts, clamps, drops non-finite)', () => {
    const dirty: BrushCurvePoint[] = [
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0.5, y: 5 }, // y out of range -> clamped to 1
      { x: Number.NaN, y: 0.3 }, // dropped
    ];
    const resolved = resolveResponseCurve(dirty);
    expect(resolved.map((p) => p.x)).toEqual([0, 0.5, 1]);
    expect(resolved[1].y).toBe(1);
    // every output stays within [0,1]
    for (const x of [0, 0.2, 0.5, 0.8, 1]) {
      const y = evalResponseCurve(dirty, x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to linear for empty arrays and unknown preset names', () => {
    expect(resolveResponseCurve([])).toEqual(RESPONSE_CURVE_PRESETS.linear);
    // @ts-expect-error — exercising the runtime guard for an unknown preset string
    expect(resolveResponseCurve('nonsense')).toEqual(RESPONSE_CURVE_PRESETS.linear);
  });

  it('normalizeResponseCurve preserves the curve form (preset string stays a string)', () => {
    // known preset stays its string form (UI + serialization keep the identity)
    expect(normalizeResponseCurve('soft')).toBe('soft');
    expect(normalizeResponseCurve('hard')).toBe('hard');
    // missing / unknown collapse to 'linear'
    expect(normalizeResponseCurve(undefined)).toBe('linear');
    expect(normalizeResponseCurve(null)).toBe('linear');
    // @ts-expect-error — runtime guard for an unknown preset string
    expect(normalizeResponseCurve('bogus')).toBe('linear');
    // an explicit array is sanitized (sorted, clamped) but stays an array
    const normalized = normalizeResponseCurve([
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ]);
    expect(Array.isArray(normalized)).toBe(true);
    expect(normalized).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('exposes the four named presets', () => {
    expect(Object.keys(RESPONSE_CURVE_PRESETS).sort()).toEqual(['hard', 'linear', 'soft', 'sshape']);
    for (const points of Object.values(RESPONSE_CURVE_PRESETS)) {
      expect(points[0]).toEqual({ x: 0, y: 0 });
      expect(points[points.length - 1]).toEqual({ x: 1, y: 1 });
    }
  });
});
