import { describe, expect, it } from 'vitest';
import { buildBrushDabs } from './ImageBrushEngine';

const base = { size: 20, opacity: 1, flow: 1, spacing: 0.25, hardness: 1, color: '#fff' };

describe('dry-brush dynamics wired into buildBrushDabs', () => {
  it('with no dry-brush settings, opacity stays full across the stroke (no behavior change)', () => {
    const dabs = buildBrushDabs({ x: 0, y: 0 }, { x: 200, y: 0 }, base, 1);
    expect(dabs.length).toBeGreaterThan(2);
    expect(dabs[0].opacity).toBe(1);
    expect(dabs[dabs.length - 1].opacity).toBe(1);
  });

  it('fadeLength tapers opacity in from the stroke start', () => {
    const dabs = buildBrushDabs({ x: 0, y: 0 }, { x: 200, y: 0 }, { ...base, fadeLength: 8 }, 1, { startIndex: 0 });
    expect(dabs[0].opacity).toBeLessThan(dabs[dabs.length - 1].opacity);
    expect(dabs[0].opacity).toBe(0); // dab index 0 fully faded
  });

  it('paint load depletes opacity over distance (dry brush runs out)', () => {
    const near = buildBrushDabs({ x: 0, y: 0 }, { x: 10, y: 0 }, { ...base, paintLoad: 1, loadFalloff: 0.02 }, 1, { accumulatedDistancePx: 0 });
    const far = buildBrushDabs({ x: 0, y: 0 }, { x: 10, y: 0 }, { ...base, paintLoad: 1, loadFalloff: 0.02 }, 1, { accumulatedDistancePx: 300 });
    expect(far[0].opacity).toBeLessThan(near[0].opacity);
  });
});
