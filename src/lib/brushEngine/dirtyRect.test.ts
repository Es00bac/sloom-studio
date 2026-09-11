import { describe, expect, it } from 'vitest';
import { dabRect, unionRect, intersectRect, clampRect, isEmptyRect } from './dirtyRect';

describe('dirtyRect', () => {
  it('builds a square dab rect centered on the point, ceil-padded', () => {
    expect(dabRect(10, 10, 4)).toEqual({ x: 8, y: 8, width: 4, height: 4 });
    // fractional radius rounds outward so the whole brush footprint is covered
    expect(dabRect(10, 10, 5)).toEqual({ x: 7, y: 7, width: 6, height: 6 });
  });

  it('unions two rects into their bounding box', () => {
    expect(unionRect({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 1, height: 1 }))
      .toEqual({ x: 0, y: 0, width: 6, height: 6 });
    expect(unionRect(null, { x: 5, y: 5, width: 1, height: 1 })).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });

  it('intersects and clamps to bounds, reporting empty when outside', () => {
    expect(clampRect({ x: -3, y: -3, width: 4, height: 4 }, 10, 10)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(isEmptyRect(intersectRect({ x: 0, y: 0, width: 2, height: 2 }, { x: 9, y: 9, width: 2, height: 2 }))).toBe(true);
  });
});
