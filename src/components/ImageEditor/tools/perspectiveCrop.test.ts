import { describe, expect, it } from 'vitest';
import { applyHomography, solveHomography, warpPerspectiveToRect } from './perspectiveCrop';

const TL = { x: 0, y: 0 };

describe('solveHomography / applyHomography', () => {
  it('recovers an identity mapping for matching squares', () => {
    const square = [TL, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const h = solveHomography(square, square);
    expect(h).not.toBeNull();
    const p = applyHomography(h!, 5, 5);
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(5, 6);
  });

  it('maps each source corner exactly onto its destination corner', () => {
    const src = [TL, { x: 4, y: 1 }, { x: 5, y: 6 }, { x: 1, y: 5 }];
    const dst = [TL, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
    const h = solveHomography(src, dst);
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i += 1) {
      const p = applyHomography(h!, src[i].x, src[i].y);
      expect(p.x).toBeCloseTo(dst[i].x, 4);
      expect(p.y).toBeCloseTo(dst[i].y, 4);
    }
  });

  it('returns null for a degenerate (collinear) source quad', () => {
    const collinear = [TL, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    const dst = [TL, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(solveHomography(collinear, dst)).toBeNull();
  });
});

describe('warpPerspectiveToRect', () => {
  it('rectifies a quad region of a flat-colour image to the same colour', () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      data[i * 4] = 120;
      data[i * 4 + 1] = 60;
      data[i * 4 + 2] = 200;
      data[i * 4 + 3] = 255;
    }
    const quad = [
      { x: 1, y: 1 },
      { x: 6, y: 2 },
      { x: 5, y: 6 },
      { x: 2, y: 5 },
    ];
    const result = warpPerspectiveToRect({ data, width: w, height: h }, quad, 4, 4);
    expect(result).not.toBeNull();
    // Centre pixel samples the (uniform) source colour.
    const o = (2 * 4 + 2) * 4;
    expect(result!.data[o]).toBe(120);
    expect(result!.data[o + 1]).toBe(60);
    expect(result!.data[o + 2]).toBe(200);
    expect(result!.data[o + 3]).toBe(255);
  });

  it('returns transparent for output pixels whose source maps outside the image', () => {
    const w = 4;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    // A quad reaching well outside the source bounds -> some corners transparent.
    const quad = [
      { x: -20, y: -20 },
      { x: -10, y: -20 },
      { x: -10, y: -10 },
      { x: -20, y: -10 },
    ];
    const result = warpPerspectiveToRect({ data, width: w, height: h }, quad, 4, 4);
    expect(result).not.toBeNull();
    expect(result!.data[3]).toBe(0); // alpha of first pixel: outside -> transparent
  });
});
