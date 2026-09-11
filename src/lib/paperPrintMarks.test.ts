import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PRINT_PRODUCTION } from './paperPrintProduction';
import { buildPaperPrintSheetPlan, PAPER_POINTS_PER_MM } from './paperPrintMarks';

describe('paperPrintMarks', () => {
  it('keeps the historical bleed-media geometry when marks and slug are disabled', () => {
    const plan = buildPaperPrintSheetPlan(
      { widthMm: 210, heightMm: 297, bleedMm: 3 },
      DEFAULT_PAPER_PRINT_PRODUCTION,
    );

    expect(plan.contentOffsetPt).toEqual({ x: 0, y: 0 });
    expect(plan.cropMarks).toEqual([]);
    expect(plan.slugBox).toBeUndefined();
    expect(plan.mediaBox.widthPt).toBeCloseTo(216 * PAPER_POINTS_PER_MM, 5);
    expect(plan.mediaBox.heightPt).toBeCloseTo(303 * PAPER_POINTS_PER_MM, 5);
    expect(plan.trimBox.xPt).toBeCloseTo(3 * PAPER_POINTS_PER_MM, 5);
  });

  it('reserves mark clearance outside bleed and a separate bottom slug area', () => {
    const plan = buildPaperPrintSheetPlan(
      { widthMm: 100, heightMm: 150, bleedMm: 3 },
      {
        marks: {
          cropMarks: true,
          cropMarkLengthMm: 5,
          cropMarkOffsetMm: 2,
          cropMarkStrokePt: 0.25,
          registrationMarks: false,
          colorBars: false,
          slugAreaMm: 12,
        },
      },
    );

    expect(plan.contentOffsetPt.x).toBeCloseTo(7 * PAPER_POINTS_PER_MM, 5);
    expect(plan.bleedBox.xPt).toBeCloseTo(7 * PAPER_POINTS_PER_MM, 5);
    expect(plan.trimBox.xPt).toBeCloseTo(10 * PAPER_POINTS_PER_MM, 5);
    expect(plan.mediaBox.widthPt).toBeCloseTo(120 * PAPER_POINTS_PER_MM, 5);
    expect(plan.mediaBox.heightPt).toBeCloseTo(182 * PAPER_POINTS_PER_MM, 5);
    expect(plan.cropMarks).toHaveLength(8);
    expect(plan.cropMarks[0]).toMatchObject({
      id: 'crop:top-left:horizontal',
      strokeWidthPt: 0.25,
    });
    expect(plan.cropMarks[0].x1Pt).toBeCloseTo(0, 5);
    expect(plan.cropMarks[0].x2Pt).toBeCloseTo(5 * PAPER_POINTS_PER_MM, 5);
    expect(plan.slugBox?.heightPt).toBeCloseTo(12 * PAPER_POINTS_PER_MM, 5);
    expect(plan.slugBox?.yTopPt).toBeCloseTo(170 * PAPER_POINTS_PER_MM, 5);
  });

  it('builds all-plate registration targets, a process control strip, and sanitized job text', () => {
    const plan = buildPaperPrintSheetPlan(
      { widthMm: 100, heightMm: 150, bleedMm: 3 },
      {
        marks: {
          cropMarks: true,
          cropMarkLengthMm: 5,
          cropMarkOffsetMm: 2,
          cropMarkStrokePt: 0.25,
          registrationMarks: true,
          colorBars: true,
          slugAreaMm: 12,
        },
        jobInfo: {
          jobName: 'Summer catalog',
          jobNumber: 'CAT-42',
          client: 'Example Press',
          author: 'A. Operator',
          notes: 'Coated stock',
        },
      },
    );

    expect(plan.registrationMarks).toHaveLength(4);
    expect(plan.registrationMarks.map((mark) => mark.id)).toEqual([
      'registration:top', 'registration:right', 'registration:bottom', 'registration:left',
    ]);
    expect(plan.colorBars).toHaveLength(9);
    expect(plan.colorBars.at(-1)?.cmyk).toEqual({ c: 1, m: 1, y: 1, k: 1 });
    expect(plan.slugText).toContain('Job: Summer catalog');
    expect(plan.slugText).toContain('No: CAT-42');
    expect(plan.slugBox!.yTopPt).toBeGreaterThan(plan.colorBars[0].rect.yTopPt + plan.colorBars[0].rect.heightPt);
  });
});
