import { describe, expect, it } from 'vitest';
import { depletePaintLoad, fadeInFactor, strokeTaperFactor } from './ImageBrushDryDynamics';

describe('ImageBrushDryDynamics', () => {
  it('fadeInFactor ramps 0->1 over fadeLength and clamps', () => {
    expect(fadeInFactor(0, 10)).toBe(0);
    expect(fadeInFactor(5, 10)).toBe(0.5);
    expect(fadeInFactor(10, 10)).toBe(1);
    expect(fadeInFactor(20, 10)).toBe(1);
    expect(fadeInFactor(5, 0)).toBe(1); // disabled
  });
  it('strokeTaperFactor tapers both ends, full in the middle', () => {
    expect(strokeTaperFactor(0, 0.2)).toBe(0);
    expect(strokeTaperFactor(0.1, 0.2)).toBeCloseTo(0.5, 5);
    expect(strokeTaperFactor(0.5, 0.2)).toBe(1);
    expect(strokeTaperFactor(0.9, 0.2)).toBeCloseTo(0.5, 5);
    expect(strokeTaperFactor(1, 0.2)).toBe(0);
    expect(strokeTaperFactor(0.5, 0)).toBe(1); // disabled
  });
  it('depletePaintLoad decays over distance', () => {
    expect(depletePaintLoad(1, 0, 0.01)).toBe(1);
    expect(depletePaintLoad(1, 100, 0.01)).toBeCloseTo(Math.exp(-1), 5);
    expect(depletePaintLoad(1, 100000, 0.01)).toBeCloseTo(0, 5);
    expect(depletePaintLoad(0.8, 50, 0)).toBe(0.8); // disabled falloff
  });
});
