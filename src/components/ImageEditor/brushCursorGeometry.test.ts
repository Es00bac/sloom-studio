import { describe, expect, it } from 'vitest';
import { computeBrushCursorRings } from './brushCursorGeometry';

describe('computeBrushCursorRings', () => {
  it('returns only the outer footprint for a hard brush', () => {
    const rings = computeBrushCursorRings({ sizePx: 100, roundness: 1, hardness: 1 });
    expect(rings.outer).toEqual({ width: 100, height: 100 });
    expect(rings.inner).toBeUndefined();
  });

  it('adds a hard-core inner ring for a soft brush', () => {
    const rings = computeBrushCursorRings({ sizePx: 100, roundness: 1, hardness: 0.5 });
    expect(rings.outer).toEqual({ width: 100, height: 100 });
    expect(rings.inner).toEqual({ width: 50, height: 50 });
  });

  it('scales the inner ring height by roundness', () => {
    const rings = computeBrushCursorRings({ sizePx: 100, roundness: 0.5, hardness: 0.5 });
    expect(rings.outer).toEqual({ width: 100, height: 50 });
    expect(rings.inner).toEqual({ width: 50, height: 25 });
  });

  it('omits the inner ring when the gap would be too small to read', () => {
    // diameter 10, hardness 0.9 -> core 9 -> gap 1px (< 3px): no ring.
    expect(computeBrushCursorRings({ sizePx: 10, roundness: 1, hardness: 0.9 }).inner).toBeUndefined();
    // hardness very close to 1 never draws a ring regardless of size.
    expect(computeBrushCursorRings({ sizePx: 400, roundness: 1, hardness: 0.995 }).inner).toBeUndefined();
  });

  it('clamps tiny and huge sizes and treats non-positive roundness as round', () => {
    expect(computeBrushCursorRings({ sizePx: 0, roundness: 0, hardness: 1 }).outer).toEqual({ width: 4, height: 4 });
    expect(computeBrushCursorRings({ sizePx: 9000, roundness: 1, hardness: 1 }).outer).toEqual({ width: 2000, height: 2000 });
  });

  it('clamps out-of-range hardness', () => {
    expect(computeBrushCursorRings({ sizePx: 100, roundness: 1, hardness: -1 }).inner).toEqual({ width: 2, height: 2 });
    expect(computeBrushCursorRings({ sizePx: 100, roundness: 1, hardness: 5 }).inner).toBeUndefined();
  });
});
