import { describe, expect, it } from 'vitest';
import {
  chooseRulerStep,
  clampGridSpacing,
  createImageGuide,
  DEFAULT_IMAGE_VIEW_SETTINGS,
  findGuideNear,
  generateGridLines,
  generateRulerTicks,
  snapGuidePosition,
  type ImageViewSettings,
} from './ImageRulersGuides';
import type { ImageGuide } from '../../types/imageEditor';

describe('ImageRulersGuides', () => {
  it('chooses larger document steps as zoom shrinks so ticks stay readable', () => {
    expect(chooseRulerStep(1)).toBeLessThan(chooseRulerStep(0.1));
    // At zoom 1 a ~56px target picks a nice step >= 56 doc px.
    expect(chooseRulerStep(1)).toBeGreaterThanOrEqual(56);
    // Zoomed in, smaller doc steps suffice.
    expect(chooseRulerStep(8)).toBeLessThanOrEqual(chooseRulerStep(1));
  });

  it('generates ruler ticks across the visible screen span with major marks', () => {
    const ticks = generateRulerTicks(400, 0, 1);
    expect(ticks.length).toBeGreaterThan(0);
    // Every tick maps value -> screen consistently (zoom 1, pan 0 => screen === value).
    for (const tick of ticks) expect(tick.screen).toBeCloseTo(tick.value);
    expect(ticks.some((tick) => tick.major)).toBe(true);
    // A value of 0 is a major tick.
    const zero = ticks.find((tick) => tick.value === 0);
    expect(zero?.major).toBe(true);
  });

  it('respects pan and zoom when placing ticks', () => {
    const ticks = generateRulerTicks(400, 30, 2);
    for (const tick of ticks) expect(tick.screen).toBeCloseTo(tick.value * 2 + 30);
    // No ticks far outside the ruler span.
    for (const tick of ticks) {
      expect(tick.screen).toBeGreaterThanOrEqual(-1);
      expect(tick.screen).toBeLessThanOrEqual(401);
    }
  });

  it('returns empty ticks for degenerate inputs', () => {
    expect(generateRulerTicks(0, 0, 1)).toEqual([]);
    expect(generateRulerTicks(400, 0, 0)).toEqual([]);
  });

  it('generates interior grid lines at the configured spacing', () => {
    const { xs, ys } = generateGridLines(200, 100, 50);
    expect(xs).toEqual([50, 100, 150]);
    expect(ys).toEqual([50]);
  });

  it('clamps grid spacing to a sane range', () => {
    expect(clampGridSpacing(0)).toBeGreaterThanOrEqual(2);
    expect(clampGridSpacing(99999)).toBeLessThanOrEqual(2000);
    expect(clampGridSpacing(37.6)).toBe(38);
  });

  it('snaps guide positions to the grid only when snapping is on', () => {
    const snapping: ImageViewSettings = { ...DEFAULT_IMAGE_VIEW_SETTINGS, snap: true, gridSpacing: 50 };
    expect(snapGuidePosition(63, snapping)).toBe(50);
    expect(snapGuidePosition(80, snapping)).toBe(100);
    const free: ImageViewSettings = { ...DEFAULT_IMAGE_VIEW_SETTINGS, snap: false };
    expect(snapGuidePosition(63.4, free)).toBe(63);
  });

  it('finds the nearest guide on the same axis within tolerance', () => {
    const guides: ImageGuide[] = [
      { id: 'a', axis: 'x', position: 100 },
      { id: 'b', axis: 'y', position: 100 },
      { id: 'c', axis: 'x', position: 200 },
    ];
    expect(findGuideNear(guides, 'x', 104, 6)?.id).toBe('a');
    expect(findGuideNear(guides, 'x', 130, 6)).toBeNull();
    expect(findGuideNear(guides, 'y', 98, 6)?.id).toBe('b');
  });

  it('creates guides with unique ids and rounded positions', () => {
    const g1 = createImageGuide('x', 42.7);
    const g2 = createImageGuide('y', 10);
    expect(g1.position).toBe(43);
    expect(g1.axis).toBe('x');
    expect(g1.id).not.toBe(g2.id);
  });
});
