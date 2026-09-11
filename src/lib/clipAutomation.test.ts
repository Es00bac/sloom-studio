import { describe, expect, it } from 'vitest';
import {
  buildAutomationExpression,
  getAutomationValueAtLocalTime,
  normalizeAutomationPoints,
} from './clipAutomation';

describe('normalizeAutomationPoints', () => {
  it('injects start and end anchors when none are present', () => {
    expect(
      normalizeAutomationPoints([{ timePercent: 50, valuePercent: 40 }], 100),
    ).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 50, valuePercent: 40 },
      { timePercent: 100, valuePercent: 100 },
    ]);
  });
});

describe('getAutomationValueAtLocalTime', () => {
  it('interpolates between automation points across the clip duration', () => {
    const points = normalizeAutomationPoints(
      [
        { timePercent: 25, valuePercent: 100 },
        { timePercent: 75, valuePercent: 20 },
      ],
      100,
    );

    expect(getAutomationValueAtLocalTime(points, 0, 8, 100)).toBeCloseTo(100, 4);
    expect(getAutomationValueAtLocalTime(points, 4, 8, 100)).toBeCloseTo(60, 4);
    expect(getAutomationValueAtLocalTime(points, 8, 8, 100)).toBeCloseTo(100, 4);
  });
});

describe('buildAutomationExpression', () => {
  it('emits a piecewise expression that starts at the first anchor and ends at the last', () => {
    const expression = buildAutomationExpression(
      [
        { timePercent: 0, valuePercent: 100 },
        { timePercent: 50, valuePercent: 40 },
        { timePercent: 100, valuePercent: 0 },
      ],
      8,
      100,
    );

    expect(expression).toContain('if(lte(T,4.0000)');
    expect(expression).toContain('0.4000');
    expect(expression).toContain('0.0000');
  });
});
