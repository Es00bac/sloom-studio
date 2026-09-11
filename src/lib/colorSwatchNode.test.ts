import { describe, expect, it } from 'vitest';
import {
  formatColorSwatchPrompt,
  normalizeColorSwatchColors,
} from './colorSwatchNode';

describe('color swatch node helpers', () => {
  it('normalizes hex colors and formats primary palette guidance', () => {
    expect(normalizeColorSwatchColors(['#0f172a', '#38BDF8', 'bad', '#abc'])).toEqual([
      '#0F172A',
      '#38BDF8',
      '#AABBCC',
    ]);

    expect(formatColorSwatchPrompt({
      colorSwatchColors: ['#0f172a', '#38BDF8'],
      colorSwatchUsageMode: 'primary',
    })).toBe(
      'Color swatch: #0F172A, #38BDF8. Use these colors primarily and keep generated media aligned with this palette.',
    );
  });

  it('returns empty text until a palette has colors', () => {
    expect(formatColorSwatchPrompt({ colorSwatchColors: [] })).toBe('');
  });

  it('formats alternate usage modes with explicit hex values', () => {
    expect(formatColorSwatchPrompt({
      colorSwatchColors: ['#111111', '#eeeeee'],
      colorSwatchUsageMode: 'grade',
    })).toBe(
      'Color swatch: #111111, #EEEEEE. Use these colors as the color grade and lighting direction for the scene.',
    );
  });
});
