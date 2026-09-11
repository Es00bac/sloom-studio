import { describe, expect, it } from 'vitest';
import {
  PRINT_SAFE_PALETTES,
  findPrintSafePalette,
  overInkSwatches,
  paletteToPaperSwatches,
} from './printSafePalettes';
import { totalInkPercent } from './paperSwatches';

describe('printSafePalettes', () => {
  it('ships several named palettes, each with swatches', () => {
    expect(PRINT_SAFE_PALETTES.length).toBeGreaterThanOrEqual(4);
    for (const palette of PRINT_SAFE_PALETTES) {
      expect(palette.id.length).toBeGreaterThan(0);
      expect(palette.swatches.length).toBeGreaterThan(0);
      expect(findPrintSafePalette(palette.id)).toBe(palette);
    }
  });

  it('keeps every CMYK channel in 0–100', () => {
    for (const palette of PRINT_SAFE_PALETTES) {
      for (const { cmyk } of palette.swatches) {
        for (const ch of [cmyk.c, cmyk.m, cmyk.y, cmyk.k]) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('respects each palette ink limit (only registration swatches may exceed it)', () => {
    for (const palette of PRINT_SAFE_PALETTES) {
      expect(overInkSwatches(palette)).toEqual([]);
      // Registration swatches are the only ones allowed over the limit.
      const registration = palette.swatches.filter((s) => s.registrationOnly);
      for (const swatch of registration) {
        expect(totalInkPercent(swatch.cmyk)).toBeGreaterThan(palette.inkLimitPercent);
      }
    }
  });

  it('converts a palette to press-accurate PaperSwatches', () => {
    const palette = findPrintSafePalette('skin-tones')!;
    const swatches = paletteToPaperSwatches(palette);
    expect(swatches).toHaveLength(palette.swatches.length);
    const first = swatches[0];
    expect(first.model).toBe('cmyk');
    expect(first.type).toBe('process');
    expect(first.cmyk).toEqual(palette.swatches[0].cmyk);
    // Ids are unique.
    expect(new Set(swatches.map((s) => s.id)).size).toBe(swatches.length);
    // A screen-RGB hint is always derived.
    expect(first.rgb).toBeDefined();
  });
});
