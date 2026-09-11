import { describe, expect, it } from 'vitest';
import { createImageCmykBuffer } from '../../../lib/iccTransforms';
import { resolveBundledImageCmykProfile } from './cmykProfiles';
import { buildImageCmykProcessSeparationPlan, preflightImageCmykInkLimit } from './cmykSeparations';

const buffer = () => createImageCmykBuffer(2, 1, new Uint8Array([
  255, 128, 0, 64, 255,
  255, 255, 255, 255, 0,
]));

describe('CMYK process separations and preflight', () => {
  it('creates alpha-aware C/M/Y/K grayscale plates and a profile-bound manifest without mutating source', () => {
    const source = buffer();
    const before = source.data.slice();
    const plan = buildImageCmykProcessSeparationPlan(source, resolveBundledImageCmykProfile('fogra39'));
    expect(plan.plates.map((plate) => plate.ink)).toEqual(['cyan', 'magenta', 'yellow', 'black']);
    expect(Array.from(plan.plates[0]!.inkCoverage)).toEqual([255, 0]);
    expect(Array.from(plan.plates[1]!.inkCoverage)).toEqual([128, 0]);
    expect(Array.from(plan.plates[0]!.grayscale)).toEqual([0, 255]);
    expect(new TextDecoder().decode(plan.plates[0]!.data.slice(0, 11))).toContain('P5');
    expect(source.data).toEqual(before);
    expect(plan.manifest.profile).toEqual(resolveBundledImageCmykProfile('fogra39'));
  });

  it('reports alpha-weighted total ink without mutating or producing an unbounded violation list', () => {
    const source = buffer();
    const result = preflightImageCmykInkLimit(source, 150);
    expect(result.overLimitPixelCount).toBe(1);
    expect(result.maxTotalInkPercent).toBeGreaterThan(150);
    expect(result.violations[0]).toMatchObject({ x: 0, y: 0 });
    expect(preflightImageCmykInkLimit(source, 400)).toMatchObject({ overLimitPixelCount: 0 });
    expect(() => preflightImageCmykInkLimit(source, 401)).toThrow(/400/i);
  });
});
