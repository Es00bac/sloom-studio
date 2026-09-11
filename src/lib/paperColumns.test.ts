import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  DEFAULT_PAPER_COLUMN_GUTTER_MM,
  resolvePaperColumnCount,
  resolvePaperColumnGutterMm,
  resolvePaperTextColumns,
} from './paperColumns';

const frame = (patch: Partial<PaperFrame>): PaperFrame => ({ widthMm: 100, heightMm: 50, columns: 2, ...patch } as PaperFrame);

describe('paper column layout', () => {
  it('clamps the column count to at least one', () => {
    expect(resolvePaperColumnCount(frame({ columns: 3 }))).toBe(3);
    expect(resolvePaperColumnCount(frame({ columns: 0 }))).toBe(1);
  });

  it('falls back to the default gutter and honours an explicit one', () => {
    expect(resolvePaperColumnGutterMm(frame({}))).toBe(DEFAULT_PAPER_COLUMN_GUTTER_MM);
    expect(resolvePaperColumnGutterMm(frame({ columnGutterMm: 12 }))).toBe(12);
  });

  it('splits the content width into evenly-gutter-separated column boxes', () => {
    const columns = resolvePaperTextColumns(frame({ columns: 2, columnGutterMm: 10 }));
    expect(columns).toEqual([
      { xMm: 0, yMm: 0, widthMm: 45, heightMm: 50 },
      { xMm: 55, yMm: 0, widthMm: 45, heightMm: 50 },
    ]);
  });

  it('insets the columns by the content padding', () => {
    const columns = resolvePaperTextColumns(frame({ columns: 2, columnGutterMm: 10 }), 5);
    expect(columns).toEqual([
      { xMm: 5, yMm: 5, widthMm: 40, heightMm: 40 },
      { xMm: 55, yMm: 5, widthMm: 40, heightMm: 40 },
    ]);
  });

  it('returns one full-content column for a single-column frame', () => {
    expect(resolvePaperTextColumns(frame({ columns: 1 }))).toEqual([
      { xMm: 0, yMm: 0, widthMm: 100, heightMm: 50 },
    ]);
  });
});
