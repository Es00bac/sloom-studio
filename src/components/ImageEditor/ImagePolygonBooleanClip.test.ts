import { describe, expect, it } from 'vitest';
import {
  clipSimplePolygons,
  polygonArea,
  type PolygonPoint,
} from './ImagePolygonBooleanClip';

function rect(left: number, top: number, right: number, bottom: number): PolygonPoint[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function coveredArea(rings: PolygonPoint[][], containsHoles: boolean): number {
  const magnitudes = rings.map((ring) => Math.abs(polygonArea(ring))).sort((a, b) => b - a);
  if (!containsHoles) {
    return magnitudes.reduce((sum, area) => sum + area, 0);
  }
  // Outer ring minus enclosed hole rings (sufficient for these fixtures).
  return magnitudes[0] - magnitudes.slice(1).reduce((sum, area) => sum + area, 0);
}

const squareA = rect(0, 0, 4, 4); // area 16
const squareB = rect(2, 2, 6, 6); // area 16, overlap with A = 4

describe('clipSimplePolygons — overlapping axis rectangles (known areas)', () => {
  it('intersect', () => {
    const result = clipSimplePolygons('intersect', squareA, squareB);
    expect(result.approximate).toBe(false);
    expect(result.rings).toHaveLength(1);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(4, 6);
  });

  it('union', () => {
    const result = clipSimplePolygons('union', squareA, squareB);
    expect(result.approximate).toBe(false);
    expect(result.rings).toHaveLength(1);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(28, 6);
  });

  it('subtract', () => {
    const result = clipSimplePolygons('subtract', squareA, squareB);
    expect(result.approximate).toBe(false);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(12, 6);
  });

  it('xor covers union minus intersection', () => {
    const result = clipSimplePolygons('xor', squareA, squareB);
    expect(result.approximate).toBe(false);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(24, 6);
  });
});

describe('clipSimplePolygons — rectangle × triangle partial overlap', () => {
  // Triangle (3,1)-(7,1)-(7,5); hypotenuse y = x - 2 crosses the square's
  // right edge at (4,2); overlap with the 4x4 square is the small wedge of
  // area 0.5 between x=3..4, y=1..x-2.
  const triangle: PolygonPoint[] = [
    { x: 3, y: 1 },
    { x: 7, y: 1 },
    { x: 7, y: 5 },
  ];

  it('intersect produces the analytic wedge area', () => {
    const result = clipSimplePolygons('intersect', squareA, triangle);
    expect(result.approximate).toBe(false);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(0.5, 6);
  });

  it('union and subtract stay consistent with the wedge', () => {
    const union = clipSimplePolygons('union', squareA, triangle);
    const subtract = clipSimplePolygons('subtract', squareA, triangle);
    expect(coveredArea(union.rings, union.containsHoles)).toBeCloseTo(16 + 8 - 0.5, 6);
    expect(coveredArea(subtract.rings, subtract.containsHoles)).toBeCloseTo(15.5, 6);
  });
});

describe('clipSimplePolygons — containment (no boundary crossings)', () => {
  const outer = rect(0, 0, 8, 8); // 64
  const inner = rect(2, 2, 6, 6); // 16

  it('subtract emits an even-odd hole pair', () => {
    const result = clipSimplePolygons('subtract', outer, inner);
    expect(result.rings).toHaveLength(2);
    expect(result.containsHoles).toBe(true);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(48, 6);
  });

  it('union keeps the outer ring; intersect keeps the inner ring', () => {
    const union = clipSimplePolygons('union', outer, inner);
    expect(union.rings).toHaveLength(1);
    expect(coveredArea(union.rings, union.containsHoles)).toBeCloseTo(64, 6);

    const intersect = clipSimplePolygons('intersect', outer, inner);
    expect(intersect.rings).toHaveLength(1);
    expect(coveredArea(intersect.rings, intersect.containsHoles)).toBeCloseTo(16, 6);
  });

  it('subtract of the contained subject is empty', () => {
    const result = clipSimplePolygons('subtract', inner, outer);
    expect(result.rings).toHaveLength(0);
  });
});

describe('clipSimplePolygons — concave union creating an enclosed hole', () => {
  // U-shape (open at the top) + a bar floating across both prongs: the union
  // encloses the pocket between the prongs below the bar.
  const uShape: PolygonPoint[] = [
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 4, y: 5 },
    { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 5 }, { x: 0, y: 5 },
  ]; // area 24
  const bar = rect(-1, 4, 7, 6); // area 16, overlaps each prong top by 2 → intersect 4

  it('produces an outer ring plus a hole ring with the exact covered area', () => {
    const result = clipSimplePolygons('union', uShape, bar);
    expect(result.approximate).toBe(false);
    expect(result.rings).toHaveLength(2);
    expect(result.containsHoles).toBe(true);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(24 + 16 - 4, 6);
  });
});

describe('clipSimplePolygons — degenerate inputs fall back to approximate', () => {
  it('shared-corner squares union is flagged approximate with a sane area', () => {
    const result = clipSimplePolygons('union', rect(0, 0, 4, 4), rect(4, 4, 8, 8));
    expect(result.approximate).toBe(true);
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(32, 2);
  });

  it('vertex-on-edge subtract is flagged approximate with a sane area', () => {
    // Triangle apex sits exactly on the square's top edge.
    const triangle: PolygonPoint[] = [
      { x: 2, y: 0 },
      { x: 6, y: 6 },
      { x: -2, y: 6 },
    ];
    const result = clipSimplePolygons('subtract', rect(0, 0, 4, 4), triangle);
    expect(result.approximate).toBe(true);
    // Triangle∩square integrates to 10 (width 4y/3 up to y=3, then full width 4),
    // so the exact difference is 16 − 10 = 6.
    expect(coveredArea(result.rings, result.containsHoles)).toBeCloseTo(6, 2);
  });
});

describe('clipSimplePolygons — input validation', () => {
  it('rejects degenerate rings', () => {
    expect(() => clipSimplePolygons('union', [{ x: 0, y: 0 }, { x: 1, y: 1 }], squareB)).toThrow();
  });
});
