import { describe, expect, it } from 'vitest';
import { resolvePaperBaselineLeadingPt, resolvePaperBaselineTopInsetMm, snapPaperBaselinePt } from './paperBaselineGrid';

describe('paperBaselineGrid', () => {
  const grid = { startMm: 10, incrementMm: 4 };

  it('snaps a baseline forward to the next document grid line', () => {
    const ptPerMm = 72 / 25.4;
    expect(snapPaperBaselinePt(11 * ptPerMm, grid)).toBeCloseTo(14 * ptPerMm, 5);
    expect(snapPaperBaselinePt(14 * ptPerMm, grid)).toBeCloseTo(14 * ptPerMm, 5);
  });

  it('uses whole grid increments for fallback leading and computes the first-line inset', () => {
    expect(resolvePaperBaselineLeadingPt(12, grid)).toBeCloseTo(8 * 72 / 25.4, 5);
    expect(resolvePaperBaselineTopInsetMm(10, 4 * 72 / 25.4, grid)).toBeCloseTo(0.8, 5);
  });
});
