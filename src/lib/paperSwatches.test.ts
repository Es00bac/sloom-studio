import { describe, expect, it } from 'vitest';
import {
  cmykToRgb,
  parseHexColor,
  resolveSwatchCssColor,
  rgbToCmyk,
  rgbToCss,
  swatchScreenRgb,
  totalInkPercent,
  type PaperSwatch,
} from './paperSwatches';

describe('paper swatch color math (matches the Image naive RGB↔CMYK formula)', () => {
  it('separates RGB into CMYK percentages', () => {
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it('round-trips primary colors through CMYK', () => {
    expect(cmykToRgb({ c: 0, m: 100, y: 100, k: 0 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(cmykToRgb({ c: 0, m: 0, y: 0, k: 100 })).toEqual({ r: 0, g: 0, b: 0 });
    expect(cmykToRgb({ c: 100, m: 0, y: 0, k: 0 })).toEqual({ r: 0, g: 255, b: 255 });
  });

  it('reports total ink coverage for ink-limit preflight', () => {
    expect(totalInkPercent({ c: 80, m: 70, y: 70, k: 90 })).toBe(310);
  });

  it('renders the screen RGB from the swatch model channels', () => {
    const cmykSwatch: PaperSwatch = {
      id: 's1', name: 'Rich Red', type: 'process', model: 'cmyk',
      rgb: { r: 200, g: 30, b: 30 }, cmyk: { c: 0, m: 100, y: 100, k: 0 },
    };
    // CMYK model is authoritative for preview, not the stored rgb hint.
    expect(swatchScreenRgb(cmykSwatch)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('resolves a swatch (with optional tint) to a CSS color', () => {
    const red: PaperSwatch = { id: 's2', name: 'Red', type: 'process', model: 'rgb', rgb: { r: 255, g: 0, b: 0 } };
    expect(resolveSwatchCssColor(red)).toBe('rgb(255, 0, 0)');
    // 50% tint lerps from paper white toward the swatch color.
    expect(resolveSwatchCssColor(red, 50)).toBe('rgb(255, 128, 128)');
  });

  it('formats an RGB triple as a CSS color', () => {
    expect(rgbToCss({ r: 12, g: 34, b: 56 })).toBe('rgb(12, 34, 56)');
  });

  it('parses hex colors (3- and 6-digit) and rejects invalid input', () => {
    expect(parseHexColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexColor('0f0')).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseHexColor('rgb(1,2,3)')).toBeUndefined();
  });
});
