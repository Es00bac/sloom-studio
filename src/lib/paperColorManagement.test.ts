import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import {
  applyBlackPolicy,
  cmykToPdfComponents,
  collectPrintColorPreflight,
  enforceInkLimit,
  isRichBlack,
  resolvePrintColorFromHex,
  resolvePrintColorFromSwatch,
  type IccCmykTransform,
} from './paperColorManagement';
import type { PaperSwatch } from './paperSwatches';

describe('resolvePrintColorFromHex', () => {
  it('converts black to 100% K and flags approximate for the naive transform', () => {
    const color = resolvePrintColorFromHex('#000000');
    expect(color.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(color.approximate).toBe(true);
  });

  it('does NOT flag approximate when an ICC transform is supplied', () => {
    const icc: IccCmykTransform = { kind: 'icc', profileName: 'ISO Coated v2', rgbToCmyk: () => ({ c: 1, m: 2, y: 3, k: 4 }) };
    const color = resolvePrintColorFromHex('#123456', icc);
    expect(color.approximate).toBe(false);
    expect(color.profileName).toBe('ISO Coated v2');
    expect(color.cmyk).toEqual({ c: 1, m: 2, y: 3, k: 4 });
  });

  it('falls back to registration-safe black for an unparseable color rather than guessing', () => {
    const color = resolvePrintColorFromHex('not-a-color');
    expect(color.cmyk.k).toBe(100);
    expect(color.approximate).toBe(false);
  });
});

describe('resolvePrintColorFromSwatch', () => {
  const cmykSwatch: PaperSwatch = { id: 's1', name: 'Deep Blue', type: 'process', model: 'cmyk', rgb: { r: 0, g: 0, b: 128 }, cmyk: { c: 100, m: 100, y: 0, k: 20 } };
  const spotSwatch: PaperSwatch = { id: 's2', name: 'PANTONE 032', type: 'spot', model: 'cmyk', rgb: { r: 239, g: 51, b: 64 }, cmyk: { c: 0, m: 90, y: 70, k: 0 }, spotName: 'PANTONE 032 C' };

  it('emits an authored CMYK swatch verbatim and press-accurate (not approximate)', () => {
    const color = resolvePrintColorFromSwatch(cmykSwatch);
    expect(color.space).toBe('cmyk');
    expect(color.cmyk).toEqual({ c: 100, m: 100, y: 0, k: 20 });
    expect(color.approximate).toBe(false);
  });

  it('emits a spot swatch as a separation with its ink name + alternate CMYK', () => {
    const color = resolvePrintColorFromSwatch(spotSwatch, 100);
    expect(color.space).toBe('separation');
    expect(color.spotName).toBe('PANTONE 032 C');
    expect(color.tintPercent).toBe(100);
    expect(color.approximate).toBe(false);
  });

  it('scales an authored CMYK swatch by tint', () => {
    const color = resolvePrintColorFromSwatch(cmykSwatch, 50);
    expect(color.cmyk).toEqual({ c: 50, m: 50, y: 0, k: 10 });
  });
});

describe('enforceInkLimit', () => {
  it('leaves colors under the limit untouched', () => {
    const result = enforceInkLimit({ c: 40, m: 30, y: 20, k: 10 }, 300);
    expect(result.reduced).toBe(false);
    expect(result.cmyk).toEqual({ c: 40, m: 30, y: 20, k: 10 });
  });

  it('reduces C/M/Y while keeping K high when over the limit', () => {
    const result = enforceInkLimit({ c: 100, m: 100, y: 100, k: 100 }, 300);
    expect(result.reduced).toBe(true);
    expect(result.cmyk.k).toBeGreaterThanOrEqual(95);
    expect(result.cmyk.c).toBeLessThan(100);
    expect(result.finalTotal).toBeLessThanOrEqual(300);
  });

  it('caps K when the color is all-black and over the limit', () => {
    const result = enforceInkLimit({ c: 0, m: 0, y: 0, k: 320 }, 300);
    expect(result.cmyk.k).toBeLessThanOrEqual(300);
  });
});

describe('applyBlackPolicy', () => {
  it('rewrites rich-black TEXT to pure 100K under force-100k-text', () => {
    const rich = resolvePrintColorFromHex('#000814'); // → C100 M60 Y0 K92 (a rich black)
    expect(isRichBlack(rich.cmyk)).toBe(true);
    const out = applyBlackPolicy(rich, 'force-100k-text', true);
    expect(out.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('leaves non-text rich black untouched under force-100k-text', () => {
    const rich = resolvePrintColorFromHex('#000814');
    const out = applyBlackPolicy(rich, 'force-100k-text', false);
    expect(out).toEqual(rich);
  });

  it('leaves everything untouched under allow-rich-black', () => {
    const rich = resolvePrintColorFromHex('#000814');
    expect(applyBlackPolicy(rich, 'allow-rich-black', true)).toEqual(rich);
  });
});

describe('isRichBlack', () => {
  it('detects a black-with-CMY as rich black', () => {
    expect(isRichBlack({ c: 60, m: 40, y: 40, k: 100 })).toBe(true);
  });
  it('does not flag pure 100K as rich black', () => {
    expect(isRichBlack({ c: 0, m: 0, y: 0, k: 100 })).toBe(false);
  });
});

describe('cmykToPdfComponents', () => {
  it('maps 0–100 channels to 0–1 PDF operands', () => {
    expect(cmykToPdfComponents({ c: 100, m: 50, y: 0, k: 25 })).toEqual([1, 0.5, 0, 0.25]);
  });
});

describe('collectPrintColorPreflight', () => {
  it('counts approximate RGB colors, ink overages, and rich-black text honestly', () => {
    let doc = createDefaultPaperDocument({ title: 'Preflight' });
    const pageId = doc.pages[0].id;
    // A text frame set in a rich black (RGB → approximate + rich-black registration risk).
    doc = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      label: 'Body',
      xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'Hello',
      typography: { color: '#000814' },
      fillColor: 'transparent',
    }).document;

    const preflight = collectPrintColorPreflight(doc, { inkLimitPercent: 300 });
    expect(preflight.approximateColorFrameCount).toBeGreaterThan(0);
    expect(preflight.richBlackTextFrameCount).toBeGreaterThan(0);
    expect(preflight.warnings.some((w) => w.includes('approximate'))).toBe(true);
  });

  it('reports authored TAC overflow as a strict-export blocker instead of rewriting the ink', () => {
    const overInk: PaperSwatch = {
      id: 'over-ink', name: 'Heavy black', type: 'process', model: 'cmyk',
      rgb: { r: 0, g: 0, b: 0 }, cmyk: { c: 100, m: 100, y: 100, k: 100 },
    };
    const base = createDefaultPaperDocument({ title: 'TAC' });
    const added = addFrameToPaperPage({ ...base, swatches: [overInk] }, base.pages[0].id, {
      kind: 'panel', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30,
      fillColor: '#000000', fillSwatchId: overInk.id,
    });

    const preflight = collectPrintColorPreflight(added.document, { inkLimitPercent: 280 });

    expect(preflight.overInkFrameCount).toBeGreaterThan(0);
    expect(preflight.warnings.join(' ')).toMatch(/block strict production export/i);
    expect(preflight.warnings.join(' ')).not.toMatch(/reduced on export/i);
  });
});
