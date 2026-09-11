import { describe, expect, it } from 'vitest';
import { PAPER_DEFAULT_SWATCHES } from './paperSwatchCatalog';
import { resolveSwatchCssColor } from './paperSwatches';

describe('paper default swatch catalog', () => {
  it('exposes uniquely-identified process + spot swatches', () => {
    const ids = PAPER_DEFAULT_SWATCHES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['cyan', 'magenta', 'yellow', 'black', 'registration']));
    expect(PAPER_DEFAULT_SWATCHES.find((s) => s.id === 'registration')?.type).toBe('spot');
  });

  it('derives screen RGB from each swatch CMYK definition', () => {
    const cyan = PAPER_DEFAULT_SWATCHES.find((s) => s.id === 'cyan')!;
    expect(cyan.rgb).toEqual({ r: 0, g: 255, b: 255 });
    expect(resolveSwatchCssColor(PAPER_DEFAULT_SWATCHES.find((s) => s.id === 'black')!)).toBe('rgb(0, 0, 0)');
    expect(resolveSwatchCssColor(PAPER_DEFAULT_SWATCHES.find((s) => s.id === 'paper')!)).toBe('rgb(255, 255, 255)');
  });
});
