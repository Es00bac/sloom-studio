import { describe, expect, it } from 'vitest';
import {
  blendRgb,
  blendRgba8,
  clamp01,
  componentBlend,
  isComponentBlendMode,
  isSeparableBlendMode,
  luminosity,
  separableBlend,
  type Rgb,
} from './blendKernels';
import type { BlendMode } from '../../../types/imageEditor';

const ALL_MODES: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
];

/** Deterministic pseudo-random generator so probes are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('blend kernel spec properties', () => {
  it('classifies all sixteen supported modes', () => {
    expect(ALL_MODES).toHaveLength(16);
    for (const mode of ALL_MODES) {
      expect(isSeparableBlendMode(mode) || isComponentBlendMode(mode)).toBe(true);
    }
    expect(ALL_MODES.filter((mode) => isSeparableBlendMode(mode))).toHaveLength(12);
    expect(ALL_MODES.filter((mode) => isComponentBlendMode(mode))).toHaveLength(4);
  });

  it('clamps hostile kernel inputs instead of propagating them', () => {
    for (const mode of ['multiply', 'screen', 'difference', 'exclusion', 'soft-light'] as const) {
      expect(separableBlend(mode, -0.5, 1.5)).toBe(separableBlend(mode, 0, 1));
      expect(separableBlend(mode, Number.NaN, 0.5)).toBe(separableBlend(mode, 0, 0.5));
    }
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
  });

  it('matches known separable kernel values exactly', () => {
    expect(separableBlend('normal', 0.2, 0.8)).toBe(0.8);
    expect(separableBlend('multiply', 0.5, 0.5)).toBeCloseTo(0.25, 12);
    expect(separableBlend('screen', 0.5, 0.5)).toBeCloseTo(0.75, 12);
    expect(separableBlend('overlay', 0.5, 0.5)).toBeCloseTo(separableBlend('hard-light', 0.5, 0.5), 12);
    expect(separableBlend('darken', 0.3, 0.7)).toBe(0.3);
    expect(separableBlend('lighten', 0.3, 0.7)).toBe(0.7);
    expect(separableBlend('difference', 0.3, 0.9)).toBeCloseTo(0.6, 12);
    expect(separableBlend('exclusion', 0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('keeps color-dodge and color-burn inside [0,1] at the boundaries', () => {
    expect(separableBlend('color-dodge', 0, 0.3)).toBe(0);
    expect(separableBlend('color-dodge', 1, 0.3)).toBe(1);
    expect(separableBlend('color-dodge', 0.5, 1)).toBe(1);
    expect(separableBlend('color-burn', 1, 0.3)).toBe(1);
    expect(separableBlend('color-burn', 0, 0.3)).toBe(0);
    expect(separableBlend('color-burn', 0.5, 0)).toBe(0);
    expect(separableBlend('color-burn', 0.5, 0.5)).toBeCloseTo(0, 12);
  });

  it('preserves backdrop luminosity for the color mode and source hue for hue mode', () => {
    const backdrop: Rgb = { r: 0.6, g: 0.2, b: 0.2 };
    const source: Rgb = { r: 0.1, g: 0.8, b: 0.4 };
    expect(luminosity(componentBlend('color', backdrop, source)))
      .toBeCloseTo(luminosity(backdrop), 10);
    expect(luminosity(componentBlend('hue', backdrop, source)))
      .toBeCloseTo(luminosity(backdrop), 10);
    expect(luminosity(componentBlend('luminosity', backdrop, source)))
      .toBeCloseTo(luminosity(source), 10);
    const saturated = componentBlend('saturation', backdrop, source);
    const spread = (c: Rgb): number => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(spread(saturated)).toBeLessThanOrEqual(spread(source) + 1e-9);
    expect(luminosity(saturated)).toBeCloseTo(luminosity(backdrop), 10);
  });

  it('reproduces straight-alpha source-over exactly for the normal mode', () => {
    const result = blendRgb('normal', { r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 1, 0.5);
    expect(result.color.r).toBeCloseTo(0.5, 12);
    expect(result.alpha).toBeCloseTo(1, 12);
    const overTransparent = blendRgb(
      'normal',
      { r: 0.2, g: 0.4, b: 0.6 },
      { r: 0.8, g: 0.6, b: 0.4 },
      1,
      0,
    );
    expect(overTransparent.color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(overTransparent.alpha).toBe(1);
  });

  it('applies the backdrop-mix term only where the backdrop has alpha', () => {
    // With a fully transparent backdrop, every mode degenerates to the source.
    for (const mode of ALL_MODES) {
      const result = blendRgb(
        mode,
        { r: 0.9, g: 0.9, b: 0.9 },
        { r: 0.1, g: 0.1, b: 0.1 },
        0,
        1,
      );
      expect(result.color.r).toBeCloseTo(0.1, 12);
      expect(result.color.g).toBeCloseTo(0.1, 12);
      expect(result.color.b).toBeCloseTo(0.1, 12);
    }
  });

  it('matches straight-alpha source-over with a translucent backdrop for every mode', () => {
    const backdrop = { r: 0.8, g: 0.2, b: 0.4 };
    const source = { r: 0.1, g: 0.7, b: 0.9 };
    const backdropAlpha = 0.25;
    const sourceAlpha = 0.5;
    const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
    for (const mode of ALL_MODES) {
      const blended = isComponentBlendMode(mode)
        ? componentBlend(mode, backdrop, source)
        : {
            r: separableBlend(mode, backdrop.r, source.r),
            g: separableBlend(mode, backdrop.g, source.g),
            b: separableBlend(mode, backdrop.b, source.b),
          };
      const expected = {
        r: ((1 - sourceAlpha) * backdropAlpha * backdrop.r
          + sourceAlpha * (1 - backdropAlpha) * source.r
          + sourceAlpha * backdropAlpha * blended.r) / outputAlpha,
        g: ((1 - sourceAlpha) * backdropAlpha * backdrop.g
          + sourceAlpha * (1 - backdropAlpha) * source.g
          + sourceAlpha * backdropAlpha * blended.g) / outputAlpha,
        b: ((1 - sourceAlpha) * backdropAlpha * backdrop.b
          + sourceAlpha * (1 - backdropAlpha) * source.b
          + sourceAlpha * backdropAlpha * blended.b) / outputAlpha,
      };
      expect(blendRgb(mode, backdrop, source, backdropAlpha, sourceAlpha)).toEqual({
        color: {
          r: expect.closeTo(expected.r, 12),
          g: expect.closeTo(expected.g, 12),
          b: expect.closeTo(expected.b, 12),
        },
        alpha: expect.closeTo(outputAlpha, 12),
      });
    }
  });

  it('8-bit wrapper rounds within the integer domain', () => {
    const result = blendRgba8(
      'multiply',
      { r: 128, g: 200, b: 0, a: 255 },
      { r: 128, g: 100, b: 255, a: 128 },
    );
    for (const channel of [result.r, result.g, result.b, result.a]) {
      expect(Number.isInteger(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect(result.a).toBe(255);
    const opaque = blendRgba8(
      'multiply',
      { r: 128, g: 200, b: 0, a: 255 },
      { r: 128, g: 100, b: 255, a: 255 },
    );
    expect(opaque.r).toBe(Math.round((128 / 255) * (128 / 255) * 255));
    expect(opaque.g).toBe(Math.round((200 / 255) * (100 / 255) * 255));
    expect(opaque.b).toBe(0);
  });
});

const hasRealCanvas = (() => {
  if (typeof OffscreenCanvas === 'undefined') return false;
  try {
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    return Boolean(ctx && typeof ctx.globalCompositeOperation === 'string');
  } catch {
    return false;
  }
})();

describe.skipIf(!hasRealCanvas)('Canvas2D u8 parity (all 16 modes, opaque pixels)', () => {
  it('matches the Canvas2D compositor within 1/255 (2/255 for exclusion) on deterministic fixtures', () => {
    // Measured on HeadlessChrome 149 over 8192 deterministic samples: every
    // mode is within 1/255 except exclusion, whose large intermediate
    // cancellation in canvas's premultiplied 8-bit pipeline lands at 2/255
    // worst case. The float kernel is the spec-exact reference.
    const canvas = new OffscreenCanvas(64, 8);
    const ctx = canvas.getContext('2d')!;
    const rng = makeRng(0x5109);
    let worst = 0;
    for (const mode of ALL_MODES) {
      const tolerance = mode === 'exclusion' ? 2 : 1;
      for (let row = 0; row < 8; row += 1) {
        for (let x = 0; x < 64; x += 1) {
          const backdrop = {
            r: Math.round(rng() * 255),
            g: Math.round(rng() * 255),
            b: Math.round(rng() * 255),
          };
          const source = {
            r: Math.round(rng() * 255),
            g: Math.round(rng() * 255),
            b: Math.round(rng() * 255),
          };
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = `rgb(${backdrop.r},${backdrop.g},${backdrop.b})`;
          ctx.fillRect(x, row, 1, 1);
          ctx.globalCompositeOperation = mode as GlobalCompositeOperation;
          ctx.fillStyle = `rgb(${source.r},${source.g},${source.b})`;
          ctx.fillRect(x, row, 1, 1);
          const blended = ctx.getImageData(x, row, 1, 1).data;
          const expected = blendRgba8(mode, { ...backdrop, a: 255 }, { ...source, a: 255 });
          worst = Math.max(
            worst,
            Math.abs(blended[0]! - expected.r),
            Math.abs(blended[1]! - expected.g),
            Math.abs(blended[2]! - expected.b),
          );
          expect(Math.abs(blended[0]! - expected.r)).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(blended[1]! - expected.g)).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(blended[2]! - expected.b)).toBeLessThanOrEqual(tolerance);
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
  });
});
