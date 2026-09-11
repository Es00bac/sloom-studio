import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  classifyFontFamily,
  isBoldWeight,
  isDisplayFontFamily,
  resolveBundledFontFace,
} from './paperFontResolution';

describe('paperFontResolution', () => {
  it('flags display/decorative faces Liberation cannot faithfully substitute', () => {
    // The shipped SFX preset + common comic/display faces → raster (real glyphs), not vector substitute.
    expect(isDisplayFontFamily('Impact, Haettenschweiler, sans-serif')).toBe(true);
    expect(isDisplayFontFamily('Bangers')).toBe(true);
    expect(isDisplayFontFamily('"Permanent Marker", cursive')).toBe(true);
    expect(isDisplayFontFamily('Comic Sans MS')).toBe(true);
    expect(isDisplayFontFamily('Some Handmade Face, fantasy')).toBe(true);
    // Ordinary text faces (incl. the app defaults) are NOT display → they stay selectable vector.
    expect(isDisplayFontFamily('Inter, system-ui, sans-serif')).toBe(false);
    expect(isDisplayFontFamily('Georgia, serif')).toBe(false);
    expect(isDisplayFontFamily('Arial, Helvetica, sans-serif')).toBe(false);
    expect(isDisplayFontFamily('"Courier New", monospace')).toBe(false);
  });

  it('classifies common font-family stacks into a bundled family', () => {
    expect(classifyFontFamily('Georgia, "Times New Roman", serif')).toBe('serif');
    expect(classifyFontFamily('Minion Pro')).toBe('serif');
    expect(classifyFontFamily('Arial, Helvetica, sans-serif')).toBe('sans');
    expect(classifyFontFamily('Inter')).toBe('sans');
    expect(classifyFontFamily('"Courier New", monospace')).toBe('mono');
    expect(classifyFontFamily('JetBrains Mono')).toBe('mono');
    // A sans face whose name contains "serif" (sans-serif) must not be misread as serif.
    expect(classifyFontFamily('PT Sans')).toBe('sans');
    expect(classifyFontFamily('')).toBe('sans');
  });

  it('reads bold from weight keywords and numeric weights', () => {
    expect(isBoldWeight('bold')).toBe(true);
    expect(isBoldWeight('700')).toBe(true);
    expect(isBoldWeight('600')).toBe(true);
    expect(isBoldWeight('500')).toBe(false);
    expect(isBoldWeight('normal')).toBe(false);
    expect(isBoldWeight(undefined)).toBe(false);
  });

  it('resolves typography to the matching Liberation face + url', () => {
    expect(resolveBundledFontFace({ fontFamily: 'Georgia', fontWeight: 'bold', fontStyle: 'italic' })).toEqual({
      family: 'serif',
      bold: true,
      italic: true,
      id: 'LiberationSerif-BoldItalic',
      url: '/fonts/liberation/LiberationSerif-BoldItalic.ttf',
    });
    expect(resolveBundledFontFace({ fontFamily: 'Arial', fontWeight: 'normal', fontStyle: 'normal' }).id).toBe(
      'LiberationSans-Regular',
    );
    expect(resolveBundledFontFace({ fontFamily: 'Courier New', fontWeight: '700', fontStyle: 'normal' }).id).toBe(
      'LiberationMono-Bold',
    );
  });

  it('embeds a bundled Liberation face as a real subset in a PDF (pdf-lib + fontkit)', async () => {
    const face = resolveBundledFontFace({ fontFamily: 'Times', fontWeight: 'normal', fontStyle: 'normal' });
    const bytes = new Uint8Array(readFileSync(`public${face.url}`));
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(bytes, { subset: true });
    const page = doc.addPage([200, 120]);
    page.drawText('Press-ready CMYK type', { x: 12, y: 60, size: 14, font, color: rgb(0, 0, 0) });
    const saved = await doc.save({ useObjectStreams: false });
    // A latin1 view of the bytes exposes the PDF's names/keywords for a structural check.
    const asText = Buffer.from(saved).toString('latin1');
    expect(asText).toContain('/FontFile2'); // embedded TrueType program (the font really travels in the PDF)
    expect(asText).toMatch(/\/BaseFont\s*\/\S*LiberationSerif/); // the embedded face is the Liberation subset
    expect(asText).toContain('/Type0'); // composite (CID-keyed) font — full glyph coverage
    expect(asText).toContain('/ToUnicode'); // searchable/selectable text
  });
});
