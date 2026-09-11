import { describe, expect, it } from 'vitest';
import {
  resolveExclusionsForTextFrame,
  resolveFrameWrapPolygon,
  resolveFrameWrapSpacers,
  toFrameLocalExclusion,
} from './paperTextWrap';
import type { PaperTextWrap } from '../types/paper';

const obstacle = (over: Record<string, unknown> = {}) => ({
  id: 'o',
  xMm: 10,
  yMm: 20,
  widthMm: 30,
  heightMm: 40,
  ...over,
});

const wrap = (mode: PaperTextWrap['mode'], extra: Partial<PaperTextWrap> = {}): PaperTextWrap => ({
  mode,
  standoffMm: 0,
  ...extra,
});

describe('resolveFrameWrapPolygon', () => {
  it('returns null when the frame has no wrap or wrap is off', () => {
    expect(resolveFrameWrapPolygon(obstacle())).toBeNull();
    expect(resolveFrameWrapPolygon(obstacle({ textWrap: wrap('none') }))).toBeNull();
  });

  it('uses the bounding rectangle for boundingBox and jumpObject', () => {
    expect(resolveFrameWrapPolygon(obstacle({ textWrap: wrap('boundingBox') }))).toEqual([
      { xMm: 10, yMm: 20 },
      { xMm: 40, yMm: 20 },
      { xMm: 40, yMm: 60 },
      { xMm: 10, yMm: 60 },
    ]);
    expect(resolveFrameWrapPolygon(obstacle({ textWrap: wrap('jumpObject') }))).toHaveLength(4);
  });

  it('traces free-form / SVG vertices (percent of the frame box) into document mm', () => {
    const poly = resolveFrameWrapPolygon(
      obstacle({
        vertices: [
          { xPercent: 0, yPercent: 0 },
          { xPercent: 100, yPercent: 0 },
          { xPercent: 50, yPercent: 100 },
        ],
        textWrap: wrap('contour'),
      }),
    );
    expect(poly).toEqual([
      { xMm: 10, yMm: 20 },
      { xMm: 40, yMm: 20 },
      { xMm: 25, yMm: 60 },
    ]);
  });

  it('approximates a round (ellipse) shape as a closed polygon spanning the frame box', () => {
    const poly = resolveFrameWrapPolygon(obstacle({ shapeKind: 'ellipse', textWrap: wrap('contour') }));
    expect(poly).not.toBeNull();
    const xs = poly!.map((p) => p.xMm);
    const ys = poly!.map((p) => p.yMm);
    expect(poly!.length).toBeGreaterThan(8);
    expect(Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...xs)).toBeCloseTo(40);
    expect(Math.min(...ys)).toBeCloseTo(20);
    expect(Math.max(...ys)).toBeCloseTo(60);
  });

  it('falls back to the bounding box when contour has no usable vertices/shape', () => {
    expect(resolveFrameWrapPolygon(obstacle({ textWrap: wrap('contour') }))).toHaveLength(4);
  });
});

describe('text-frame exclusions', () => {
  it('translates an obstacle polygon into the text frame local space with standoff', () => {
    expect(toFrameLocalExclusion([{ xMm: 10, yMm: 20 }], { xMm: 4, yMm: 5 }, 3)).toEqual({
      points: [{ xMm: 6, yMm: 15 }],
      standoffMm: 3,
    });
  });

  it('gathers wrap exclusions from other frames, skipping itself and non-wrapping frames', () => {
    const textFrame = { id: 't', xMm: 0, yMm: 0 };
    const frames = [
      { id: 't', xMm: 0, yMm: 0, widthMm: 50, heightMm: 50 }, // self — ignored
      obstacle({ id: 'o1', textWrap: wrap('boundingBox', { standoffMm: 2 }) }),
      obstacle({ id: 'o2' }), // no wrap — ignored
    ];
    const exclusions = resolveExclusionsForTextFrame(textFrame, frames);
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0].standoffMm).toBe(2);
    expect(exclusions[0].points[0]).toEqual({ xMm: 10, yMm: 20 });
  });
});

describe('resolveFrameWrapSpacers (CSS shape-outside floats)', () => {
  const textFrame = { id: 't', xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 };

  it('floats a left-half obstacle left (text to its right) as a rectangular spacer', () => {
    const spacers = resolveFrameWrapSpacers(textFrame, [
      { id: 'o', xMm: 0, yMm: 0, widthMm: 30, heightMm: 40, textWrap: wrap('boundingBox', { standoffMm: 2 }) },
    ]);
    expect(spacers).toEqual([
      { id: 'o', side: 'left', topMm: 0, widthMm: 30, heightMm: 40, shapeMarginMm: 2, shapeOutside: undefined },
    ]);
  });

  it('floats a right-half obstacle right (text to its left)', () => {
    const [spacer] = resolveFrameWrapSpacers(textFrame, [
      { id: 'o', xMm: 70, yMm: 10, widthMm: 30, heightMm: 20, textWrap: wrap('jumpObject') },
    ]);
    expect(spacer).toMatchObject({ side: 'right', topMm: 10, widthMm: 30, heightMm: 20 });
  });

  it('emits a shape-outside polygon for contour wrap and ignores non-overlapping / non-wrapping frames', () => {
    const spacers = resolveFrameWrapSpacers(textFrame, [
      { id: 'round', xMm: 0, yMm: 0, widthMm: 40, heightMm: 40, shapeKind: 'ellipse', textWrap: wrap('contour') },
      { id: 'far', xMm: 500, yMm: 500, widthMm: 10, heightMm: 10, textWrap: wrap('boundingBox') }, // off-frame
      { id: 'plain', xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }, // no wrap
    ]);
    expect(spacers).toHaveLength(1);
    expect(spacers[0].id).toBe('round');
    expect(spacers[0].shapeOutside).toMatch(/^polygon\(/);
  });
});
