import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHarfBuzzPaperTextShaper } from './paperTextShaper';

const LIBERATION_SERIF = resolve(process.cwd(), 'public/fonts/liberation/LiberationSerif-Regular.ttf');
const DEJAVU_SERIF = '/usr/share/fonts/TTF/DejaVuSerif.ttf';

async function createFixtureShaper(path = LIBERATION_SERIF) {
  const bytes = new Uint8Array(readFileSync(path));
  return createHarfBuzzPaperTextShaper(bytes);
}

describe('HarfBuzzPaperTextShaper', () => {
  it.runIf(existsSync(DEJAVU_SERIF))('shapes ligatures and keeps source cluster mapping', async () => {
    const shaper = await createFixtureShaper(DEJAVU_SERIF);
    try {
      const shaped = shaper.shape({
        text: 'office',
        direction: 'ltr',
        script: 'Latn',
        language: 'en',
        fontSizePt: 12,
        features: { liga: true },
      });

      expect(shaped.glyphs.length).toBeLessThan('office'.length);
      expect(shaped.glyphs.map((glyph) => glyph.cluster)).toEqual(expect.arrayContaining([0, 1]));
      expect(shaped.advanceX).toBeGreaterThan(0);
    } finally {
      shaper.destroy();
    }
  });

  it('shapes right-to-left text with stable advances', async () => {
    const shaper = await createFixtureShaper();
    try {
      const shaped = shaper.shape({
        text: 'שלום',
        direction: 'rtl',
        script: 'Hebr',
        language: 'he',
        fontSizePt: 12,
        features: {},
      });

      expect(shaped.direction).toBe('rtl');
      expect(shaped.advanceX).toBeGreaterThan(0);
      expect(shaped.glyphs.every((glyph) => Number.isFinite(glyph.xAdvance))).toBe(true);
    } finally {
      shaper.destroy();
    }
  });

  it('stops accepting requests after deterministic wrapper teardown', async () => {
    const shaper = await createFixtureShaper();
    shaper.destroy();

    expect(() => shaper.shape({
      text: 'text',
      direction: 'ltr',
      script: 'Latn',
      language: 'en',
      fontSizePt: 12,
      features: {},
    })).toThrow(/destroyed/i);
  });
});
