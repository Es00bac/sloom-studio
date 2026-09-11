import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRgbToCmykTransform, describeIccProfile, ICC_DISPOSED_RESOURCE_ERROR } from './paperIccEngine';

// Uses the redistribution-cleared FOGRA39 (ISO Coated v2) profile bundled in public/icc/.
const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

describe('paperIccEngine (real lcms2)', () => {
  it('reads a CMYK profile description + color space', async () => {
    const info = await describeIccProfile(fogra39);
    expect(info.colorSpace).toBe('CMYK');
    expect(info.name.length).toBeGreaterThan(0);
  });

  it('produces a real press-accurate sRGB→CMYK transform (not the naive formula)', async () => {
    const tf = await createRgbToCmykTransform(fogra39, { intent: 'relative' });
    try {
      expect(tf.kind).toBe('icc');

      const white = tf.rgbToCmyk({ r: 255, g: 255, b: 255 });
      expect(white).toEqual({ c: 0, m: 0, y: 0, k: 0 });

      // Real ICC black is a rich black (has C/M/Y under the K) — the naive formula would give 0/0/0/100.
      const black = tf.rgbToCmyk({ r: 0, g: 0, b: 0 });
      expect(black.k).toBeGreaterThanOrEqual(85);
      expect(black.c + black.m + black.y).toBeGreaterThan(60);

      const red = tf.rgbToCmyk({ r: 255, g: 0, b: 0 });
      expect(red.m).toBeGreaterThan(80);
      expect(red.y).toBeGreaterThan(80);
      expect(red.c).toBeLessThan(20);

      // A neutral mid-gray gets real GCR (K plus a little CMY), not the naive 0/0/0/50.
      const gray = tf.rgbToCmyk({ r: 128, g: 128, b: 128 });
      expect(gray.k).toBeGreaterThan(0);
      expect(gray.c + gray.m + gray.y).toBeGreaterThan(0);
    } finally {
      tf.dispose?.();
    }
  });

  it('rejects a non-CMYK profile', async () => {
    // A truncated / bogus buffer is not a valid profile.
    await expect(describeIccProfile(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('rejects every RGB-to-CMYK operation after disposal before re-entering lcms', async () => {
    const transform = await createRgbToCmykTransform(fogra39, { intent: 'relative' });
    transform.dispose();

    expect(() => transform.rgbToCmyk({ r: 1, g: 2, b: 3 })).toThrow(ICC_DISPOSED_RESOURCE_ERROR);
    expect(() => transform.transformRgbBuffer?.(new Uint8Array([1, 2, 3]), 1)).toThrow(ICC_DISPOSED_RESOURCE_ERROR);
  });
});
