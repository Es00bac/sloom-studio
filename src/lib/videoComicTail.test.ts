import { describe, expect, it } from 'vitest';
import {
  COMIC_BODY_RADIUS_PERCENT,
  comicPolarTailToTipPercent,
  comicTailPxToTipPercent,
  comicTailQuadraticPoint,
  comicTailTipPercentToPx,
  resolveComicTailGeometry,
} from './videoComicTail';
import { migrateComicPolarTailToBezierTip } from './manualEditorState';

describe('comicTailTipPercentToPx', () => {
  it('maps the centre percent to zero offset', () => {
    expect(comicTailTipPercentToPx(50, 500)).toBe(0);
  });

  it('maps the body-radius percent to the body edge', () => {
    // percent 95 == 45 from centre == the body edge (halfExtent).
    expect(comicTailTipPercentToPx(50 + COMIC_BODY_RADIUS_PERCENT, 500)).toBeCloseTo(500, 6);
    expect(comicTailTipPercentToPx(50 - COMIC_BODY_RADIUS_PERCENT, 500)).toBeCloseTo(-500, 6);
  });

  it('round-trips through the px inverse', () => {
    for (const percent of [10, 33, 50, 72, 116, 150]) {
      const px = comicTailTipPercentToPx(percent, 320);
      expect(comicTailPxToTipPercent(px, 320)).toBeCloseTo(percent, 6);
    }
  });

  it('guards a degenerate half-extent in the inverse', () => {
    expect(comicTailPxToTipPercent(100, 0)).toBe(50);
  });
});

describe('comicPolarTailToTipPercent', () => {
  it('returns undefined when no polar data is present', () => {
    expect(comicPolarTailToTipPercent(undefined, undefined)).toBeUndefined();
  });

  it('matches the manualEditorState migration for the default polar tail', () => {
    const helper = comicPolarTailToTipPercent(115, 90);
    const migration = migrateComicPolarTailToBezierTip(115, 90);
    expect(helper).toBeDefined();
    expect(migration).toBeDefined();
    // The migration rounds to 2 decimals (clamp01to100); the painter helper keeps full precision.
    expect(helper!.tipXPercent).toBeCloseTo(migration!.tipXPercent, 1);
    expect(helper!.tipYPercent).toBeCloseTo(migration!.tipYPercent, 1);
  });

  it('points down-left for the default angle (115deg)', () => {
    const tip = comicPolarTailToTipPercent(115, 90)!;
    expect(tip.tipXPercent).toBeLessThan(50); // left of centre
    expect(tip.tipYPercent).toBeGreaterThan(50); // below centre (canvas y down)
  });
});

describe('resolveComicTailGeometry', () => {
  const body = { halfWidth: 510, halfHeight: 230, bodyShape: 'rect' as const };

  it('pokes the tip beyond the body edge for a far tip', () => {
    const geometry = resolveComicTailGeometry({
      ...body,
      tipXPercent: 50,
      tipYPercent: 140, // 90 from centre → well below the body edge (45)
      curvePercent: 50,
    });
    // requested tip is far, so it is honoured exactly
    expect(geometry.tip.y).toBeCloseTo(comicTailTipPercentToPx(140, 230), 6);
    // base sits on the bottom body edge
    expect(geometry.base.y).toBeCloseTo(230, 3);
    expect(geometry.tip.y).toBeGreaterThan(geometry.base.y);
  });

  it('guarantees a minimum poke when the requested tip is inside the body', () => {
    const geometry = resolveComicTailGeometry({
      ...body,
      tipXPercent: 50,
      tipYPercent: 60, // only 10 from centre → inside the body
      curvePercent: 50,
    });
    const baseDist = Math.hypot(geometry.base.x, geometry.base.y);
    const tipDist = Math.hypot(geometry.tip.x, geometry.tip.y);
    expect(tipDist).toBeGreaterThan(baseDist); // pushed out past the edge
  });

  it('keeps a straight funnel handle at the midpoint when curvePercent is 50', () => {
    const geometry = resolveComicTailGeometry({
      ...body,
      tipXPercent: 50,
      tipYPercent: 140,
      curvePercent: 50,
    });
    const midX = (geometry.base.x + geometry.tip.x) / 2;
    const midY = (geometry.base.y + geometry.tip.y) / 2;
    expect(geometry.curveHandle.x).toBeCloseTo(midX, 6);
    expect(geometry.curveHandle.y).toBeCloseTo(midY, 6);
  });

  it('bows the funnel handle to opposite sides for curvePercent above vs below 50', () => {
    const straight = resolveComicTailGeometry({ ...body, tipXPercent: 50, tipYPercent: 140, curvePercent: 50 });
    const high = resolveComicTailGeometry({ ...body, tipXPercent: 50, tipYPercent: 140, curvePercent: 100 });
    const low = resolveComicTailGeometry({ ...body, tipXPercent: 50, tipYPercent: 140, curvePercent: 0 });
    // A vertical tail bows horizontally; the two extremes straddle the straight midpoint.
    expect(Math.sign(high.curveHandle.x - straight.curveHandle.x)).toBe(
      -Math.sign(low.curveHandle.x - straight.curveHandle.x),
    );
    expect(high.curveHandle.x).not.toBeCloseTo(straight.curveHandle.x, 3);
  });

  it('places the mouth corners symmetrically about the base', () => {
    const geometry = resolveComicTailGeometry({ ...body, tipXPercent: 50, tipYPercent: 140, curvePercent: 50 });
    expect((geometry.baseLeft.x + geometry.baseRight.x) / 2).toBeCloseTo(geometry.base.x, 6);
    expect((geometry.baseLeft.y + geometry.baseRight.y) / 2).toBeCloseTo(geometry.base.y, 6);
  });

  it('supports an elliptical body boundary for thought bubbles', () => {
    const geometry = resolveComicTailGeometry({
      halfWidth: 300,
      halfHeight: 300,
      tipXPercent: 95, // 45 from centre → the ellipse edge to the right
      tipYPercent: 50,
      curvePercent: 50,
      bodyShape: 'ellipse',
    });
    // On a circular body the boundary point sits on the radius in the tip direction.
    expect(geometry.base.x).toBeCloseTo(300, 2);
    expect(geometry.base.y).toBeCloseTo(0, 2);
  });
});

describe('comicTailQuadraticPoint', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const from = { x: 0, y: 0 };
    const control = { x: 5, y: 10 };
    const to = { x: 10, y: 0 };
    expect(comicTailQuadraticPoint(from, control, to, 0)).toEqual(from);
    expect(comicTailQuadraticPoint(from, control, to, 1)).toEqual(to);
  });

  it('bends toward the control point at the midpoint', () => {
    const mid = comicTailQuadraticPoint({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }, 0.5);
    expect(mid.y).toBeGreaterThan(0);
  });
});
