import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOutlineFont, glyphOpsToContentStream, measureTextWidthPt, outlineTextRun } from './paperGlyphOutlines';

const SERIF = resolve(process.cwd(), 'public/fonts/liberation/LiberationSerif-Regular.ttf');
const serifBytes = (): Uint8Array => new Uint8Array(readFileSync(SERIF));
const UPM = 2048; // Liberation Serif unitsPerEm

describe('createOutlineFont', () => {
  it('parses a real font and exposes unitsPerEm + layout', () => {
    const font = createOutlineFont(serifBytes());
    expect(font).toBeDefined();
    expect(font!.unitsPerEm).toBe(UPM);
    expect(typeof font!.layout).toBe('function');
  });

  it('returns undefined for non-font bytes', () => {
    expect(createOutlineFont(new TextEncoder().encode('not a font'))).toBeUndefined();
    expect(createOutlineFont(new Uint8Array(0))).toBeUndefined();
  });
});

describe('outlineTextRun', () => {
  it('emits a filled path that starts with a moveTo', () => {
    const font = createOutlineFont(serifBytes())!;
    const { ops } = outlineTextRun(font, 'A', 12, 0, 0);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].op).toBe('m');
  });

  it('scales glyph coordinates by fontSizePt / unitsPerEm from the pen origin', () => {
    const font = createOutlineFont(serifBytes())!;
    const size = 12;
    const penX = 10;
    const baseline = 20;
    const { ops } = outlineTextRun(font, 'A', size, penX, baseline);
    const first = ops[0];
    expect(first.op).toBe('m');
    // Liberation Serif 'A' first contour point is moveTo(461,53) in font units.
    if (first.op === 'm') {
      expect(first.x).toBeCloseTo(penX + (461 * size) / UPM, 2);
      expect(first.y).toBeCloseTo(baseline + (53 * size) / UPM, 2);
    }
  });

  it('reports the run advance in pt (matches the glyph advance width)', () => {
    const font = createOutlineFont(serifBytes())!;
    const size = 12;
    const { advancePt } = outlineTextRun(font, 'A', size, 0, 0);
    // 'A' advances 1479 font units in Liberation Serif.
    expect(advancePt).toBeCloseTo((1479 * size) / UPM, 2);
  });

  it('adds tracking to the advance once per glyph', () => {
    const font = createOutlineFont(serifBytes())!;
    const base = outlineTextRun(font, 'Ag', 12, 0, 0).advancePt;
    const tracked = outlineTextRun(font, 'Ag', 12, 0, 0, 5).advancePt;
    expect(tracked).toBeCloseTo(base + 2 * 5, 3); // two glyphs → +2×tracking
  });

  it('produces cubic Bézier ops for a glyph with curves (no quadratic left in the output)', () => {
    const font = createOutlineFont(serifBytes())!;
    const { ops } = outlineTextRun(font, 'o', 24, 0, 0); // round glyph → curves
    expect(ops.some((o) => o.op === 'c')).toBe(true);
    // Every curve is cubic (the type only allows 'm' | 'l' | 'c' | 'h').
    expect(ops.every((o) => o.op === 'm' || o.op === 'l' || o.op === 'c' || o.op === 'h')).toBe(true);
  });

  it('returns an empty path for empty text', () => {
    const font = createOutlineFont(serifBytes())!;
    const { ops, advancePt } = outlineTextRun(font, '', 12, 0, 0);
    expect(ops).toEqual([]);
    expect(advancePt).toBe(0);
  });
});

describe('measureTextWidthPt', () => {
  it('matches the run advance so wrap uses the same metrics as drawing', () => {
    const font = createOutlineFont(serifBytes())!;
    const measured = measureTextWidthPt(font, 'Ag Vector', 12);
    const drawn = outlineTextRun(font, 'Ag Vector', 12, 0, 0).advancePt;
    expect(measured).toBeCloseTo(drawn, 3);
  });

  it('adds tracking once per glyph and returns 0 for empty text', () => {
    const font = createOutlineFont(serifBytes())!;
    const base = measureTextWidthPt(font, 'Ag', 12);
    expect(measureTextWidthPt(font, 'Ag', 12, 5)).toBeCloseTo(base + 2 * 5, 3);
    expect(measureTextWidthPt(font, '', 12)).toBe(0);
  });
});

describe('glyphOpsToContentStream', () => {
  it('serializes each op to its PDF path operator', () => {
    const stream = glyphOpsToContentStream([
      { op: 'm', x: 1, y: 2 },
      { op: 'l', x: 3, y: 4 },
      { op: 'c', x1: 5, y1: 6, x2: 7, y2: 8, x: 9, y: 10 },
      { op: 'h' },
    ]);
    expect(stream).toBe('1.000 2.000 m\n3.000 4.000 l\n5.000 6.000 7.000 8.000 9.000 10.000 c\nh');
  });
});
