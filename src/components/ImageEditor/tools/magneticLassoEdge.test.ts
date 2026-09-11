import { describe, expect, it } from 'vitest';
import { buildEdgeMagnitudeField, snapToStrongestEdge } from './magneticLassoEdge';

/** Build a packed-RGBA buffer where the left `edgeX` columns are black and the
 * rest white — a single vertical edge at column `edgeX`. */
function verticalEdgeImage(width: number, height: number, edgeX: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const v = x < edgeX ? 0 : 255;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return data;
}

function nonSymmetricLImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x >= 11 || (y >= 12 && x >= 5) ? 230 : 18;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

describe('buildEdgeMagnitudeField', () => {
  it('puts the strongest gradient at the vertical edge and ~zero in flat regions', () => {
    const w = 9;
    const h = 9;
    const field = buildEdgeMagnitudeField(verticalEdgeImage(w, h, 4), w, h);

    // Flat interior away from the edge is zero.
    expect(field[4 * w + 1]).toBe(0);
    expect(field[4 * w + 7]).toBe(0);
    // The boundary columns carry the strongest edge (normalized to 1).
    const atEdge = Math.max(field[4 * w + 3], field[4 * w + 4]);
    expect(atEdge).toBeCloseTo(1, 5);
  });
});

describe('snapToStrongestEdge', () => {
  const w = 9;
  const h = 9;
  const field = buildEdgeMagnitudeField(verticalEdgeImage(w, h, 4), w, h);

  it('pulls a nearby point onto the edge column', () => {
    const snapped = snapToStrongestEdge(field, w, h, { x: 2, y: 4 }, 3);
    expect([3, 4]).toContain(snapped.x);
    expect(snapped.y).toBe(4);
  });

  it('leaves a point put when no edge clears the contrast threshold', () => {
    const snapped = snapToStrongestEdge(field, w, h, { x: 1, y: 4 }, 1, 0.5);
    expect(snapped).toEqual({ x: 1, y: 4 });
  });

  it('clamps the fallback point inside the image bounds', () => {
    const snapped = snapToStrongestEdge(field, w, h, { x: -5, y: 100 }, 0);
    expect(snapped).toEqual({ x: 0, y: 8 });
  });

  it('snaps toward the local vertical boundary in a non-symmetric L-shaped composite', () => {
    const field = buildEdgeMagnitudeField(nonSymmetricLImage(20, 20), 20, 20);

    expect(snapToStrongestEdge(field, 20, 20, { x: 8, y: 4 }, 4, 0.15)).toEqual({ x: 10, y: 4 });
  });

  it('keeps a nearby contour ahead of a stronger but distant edge', () => {
    const width = 40;
    const height = 12;
    const syntheticField = new Float32Array(width * height);
    // The intended contour is weaker but one pixel from the pointer; the unrelated dominant
    // edge is six pixels away. A magnitude-only maximum incorrectly chooses the latter.
    for (let y = 1; y < height - 1; y += 1) {
      syntheticField[y * width + 20] = 0.7;
      syntheticField[y * width + 26] = 1;
    }

    expect(snapToStrongestEdge(syntheticField, width, height, { x: 19, y: 6 }, 8, 0.15)).toEqual({
      x: 20,
      y: 6,
    });
  });
});
