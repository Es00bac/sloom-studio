import { describe, expect, it } from 'vitest';
import {
  PAPER_EAN13_NOMINAL,
  buildPaperBarcodeGeometry,
  ean13CheckDigit,
  encodeEan13Modules,
  isbn10CheckCharacter,
  isbn10ToEan13,
  isValidEan13,
  isValidIsbn10,
  paperBarcodePhysicalSizeStatus,
  paperBarcodeQuadsOverlap,
  paperBarcodeQuietZoneQuads,
  paperBarcodeSymbolSizeMm,
  paperFrameCarriesPrintedInk,
  paperFrameInkQuad,
  resolvePaperBarcodeValue,
  sanitizePaperBarcodeInput,
} from './paperBarcode';
import type { PaperFrame } from '../types/paper';

// Locked GS1/ISO golden encodings. These exact 95-module strings were derived once from the
// published EAN-13 tables and are now regression vectors: any change to the parity tables,
// pattern derivation, or module ordering breaks them.
const GOLDEN_9780306406157 = '10101110110001001010011101111010100111010111101010101110011100101010000110011010011101000100101';
const GOLDEN_4901234567894 = '10100010110100111001100100100110100001001110101010100111010100001000100100100011101001011100101';

function barcodeFrame(overrides: Partial<PaperFrame> = {}, value = '978-0-306-40615-7'): PaperFrame {
  return {
    id: 'frame-barcode-fixture',
    kind: 'barcode',
    label: 'ISBN Barcode',
    xMm: 10,
    yMm: 10,
    widthMm: paperBarcodeSymbolSizeMm(1, true).widthMm,
    heightMm: paperBarcodeSymbolSizeMm(1, true).heightMm,
    rotationDeg: 0,
    locked: false,
    fillOpacity: 1,
    strokeOpacity: 1,
    strokeWidthMm: 0,
    barcode: { symbology: 'ean13', value, showHumanReadable: true },
    ...overrides,
  } as PaperFrame;
}

describe('ISBN-10 validation and check characters', () => {
  it('accepts the reference ISBN-10 0-306-40615-2 and an X-check ISBN-10', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('043942089X')).toBe(true);
  });

  it('rejects wrong check digits, misplaced X, and non-digit characters', () => {
    expect(isValidIsbn10('0306406153')).toBe(false);
    expect(isValidIsbn10('0306406X52')).toBe(false);
    expect(isValidIsbn10('03064061AB')).toBe(false);
    expect(isValidIsbn10('030640615')).toBe(false);
  });

  it('derives the modulo-11 check character including X', () => {
    expect(isbn10CheckCharacter('030640615')).toBe('2');
    expect(isbn10CheckCharacter('043942089')).toBe('X');
  });
});

describe('ISBN-13 / EAN-13 check digits', () => {
  it('accepts 9780306406157 and rejects a wrong final digit', () => {
    expect(isValidEan13('9780306406157')).toBe(true);
    expect(isValidEan13('9780306406158')).toBe(false);
  });

  it('derives the modulo-10 check digit', () => {
    expect(ean13CheckDigit('978030640615')).toBe(7);
    expect(ean13CheckDigit('490123456789')).toBe(4);
  });

  it('converts a valid ISBN-10 to its Bookland ISBN-13', () => {
    expect(isbn10ToEan13('0306406152')).toBe('9780306406157');
    expect(isbn10ToEan13('0306406153')).toBeUndefined();
  });
});

describe('resolvePaperBarcodeValue', () => {
  it('accepts separated ISBN-13 input and reports the Bookland prefix', () => {
    const resolution = resolvePaperBarcodeValue('978-0-306-40615-7');
    expect(resolution).toMatchObject({ status: 'valid', ean13: '9780306406157', inputKind: 'isbn13', bookland: true });
  });

  it('accepts a valid ISBN-10 and converts it to ISBN-13', () => {
    const resolution = resolvePaperBarcodeValue('0-306-40615-2');
    expect(resolution).toMatchObject({ status: 'valid', ean13: '9780306406157', inputKind: 'isbn10', bookland: true });
  });

  it('derives missing check digits from 9 and 12 digit input', () => {
    expect(resolvePaperBarcodeValue('030640615')).toMatchObject({ status: 'valid', ean13: '9780306406157', derivedCheckDigit: true });
    expect(resolvePaperBarcodeValue('978030640615')).toMatchObject({ status: 'valid', ean13: '9780306406157', derivedCheckDigit: true });
  });

  it('reports the expected check character for a wrong carried check digit', () => {
    expect(resolvePaperBarcodeValue('0306406159')).toMatchObject({ status: 'invalid', reason: 'isbn10-check-digit', expectedCheckCharacter: '2' });
    expect(resolvePaperBarcodeValue('9780306406158')).toMatchObject({ status: 'invalid', reason: 'ean13-check-digit', expectedCheckCharacter: '7' });
  });

  it('flags empty, malformed, and wrong-length values', () => {
    expect(resolvePaperBarcodeValue('')).toMatchObject({ status: 'invalid', reason: 'empty' });
    expect(resolvePaperBarcodeValue('978X306406157')).toMatchObject({ status: 'invalid', reason: 'bad-characters' });
    expect(resolvePaperBarcodeValue('9780306')).toMatchObject({ status: 'invalid', reason: 'bad-length' });
  });

  it('marks a valid non-Bookland EAN as a general EAN-13', () => {
    expect(resolvePaperBarcodeValue('4901234567894')).toMatchObject({ status: 'valid', bookland: false });
  });

  it('sanitizes separators and uppercase X', () => {
    expect(sanitizePaperBarcodeInput(' 978 0 306 40615 7 ')).toBe('9780306406157');
    expect(sanitizePaperBarcodeInput('043942089x')).toBe('043942089X');
  });
});

describe('EAN-13 module encoding', () => {
  it('encodes the golden ISBN-13 9780306406157 exactly', () => {
    const modules = encodeEan13Modules('9780306406157');
    expect(modules).toHaveLength(PAPER_EAN13_NOMINAL.dataModuleCount);
    expect(modules!.map((dark) => (dark ? '1' : '0')).join('')).toBe(GOLDEN_9780306406157);
  });

  it('encodes the golden EAN-13 4901234567894 exactly (parity table coverage)', () => {
    const modules = encodeEan13Modules('4901234567894');
    expect(modules!.map((dark) => (dark ? '1' : '0')).join('')).toBe(GOLDEN_4901234567894);
  });

  it('refuses to encode an invalid value', () => {
    expect(encodeEan13Modules('9780306406158')).toBeUndefined();
    expect(encodeEan13Modules('not-a-code')).toBeUndefined();
  });
});

describe('buildPaperBarcodeGeometry', () => {
  const size = paperBarcodeSymbolSizeMm(1, true);

  it('matches the GS1 nominal EAN-13 drawing at 100% (37.29 × 25.93 mm)', () => {
    expect(PAPER_EAN13_NOMINAL.symbolHeightMm).toBe(25.93);
    expect(PAPER_EAN13_NOMINAL.barHeightMm + PAPER_EAN13_NOMINAL.humanReadableZoneMm).toBeCloseTo(PAPER_EAN13_NOMINAL.symbolHeightMm, 6);
    expect(PAPER_EAN13_NOMINAL.barHeightMm + PAPER_EAN13_NOMINAL.guardExtensionMm).toBeCloseTo(PAPER_EAN13_NOMINAL.barsOnlyHeightMm, 6);
    expect(size).toEqual({ widthMm: 37.29, heightMm: 25.93 });
    expect(paperBarcodeSymbolSizeMm(1, false)).toEqual({ widthMm: 37.29, heightMm: 24.5 });
  });

  it('derives nominal EAN-13 proportions from a 100% placement', () => {
    const geometry = buildPaperBarcodeGeometry(
      { symbology: 'ean13', value: '9780306406157', showHumanReadable: true },
      size.widthMm,
      size.heightMm,
    );
    expect(geometry.moduleWidthMm).toBeCloseTo(0.33, 5);
    expect(geometry.magnification).toBeCloseTo(1, 5);
    expect(geometry.leftQuietZoneMm).toBeCloseTo(11 * 0.33, 5);
    expect(geometry.rightQuietZoneMm).toBeCloseTo(7 * 0.33, 5);
    expect(geometry.barHeightMm).toBeCloseTo(PAPER_EAN13_NOMINAL.barHeightMm, 2);
    expect(geometry.guardBarHeightMm).toBeCloseTo(PAPER_EAN13_NOMINAL.barHeightMm + PAPER_EAN13_NOMINAL.guardExtensionMm, 2);
  });

  it('draws one merged rect per dark run, guards taller than data bars', () => {
    const geometry = buildPaperBarcodeGeometry(
      { symbology: 'ean13', value: '9780306406157', showHumanReadable: true },
      size.widthMm,
      size.heightMm,
    );
    const darkModules = encodeEan13Modules('9780306406157')!.filter(Boolean).length;
    const coveredModules = geometry.bars.reduce((total, bar) => total + Math.round(bar.widthMm / geometry.moduleWidthMm), 0);
    expect(coveredModules).toBe(darkModules);
    expect(geometry.bars[0]).toMatchObject({ guard: true });
    expect(geometry.bars[0].xMm).toBeCloseTo(11 * 0.33, 5);
    expect(geometry.bars[0].widthMm).toBeCloseTo(0.33, 5);
    for (const bar of geometry.bars) {
      if (bar.guard) expect(bar.heightMm).toBeGreaterThan(geometry.barHeightMm);
      else expect(bar.heightMm).toBeCloseTo(geometry.barHeightMm, 6);
    }
  });

  it('places the human-readable groups in GS1 positions', () => {
    const geometry = buildPaperBarcodeGeometry(
      { symbology: 'ean13', value: '9780306406157', showHumanReadable: true },
      size.widthMm,
      size.heightMm,
    );
    expect(geometry.humanReadableGroups.map((group) => group.text)).toEqual(['9', '780306', '406157']);
    expect(geometry.humanReadableGroups[0].centerMm).toBeCloseTo(5.5 * 0.33, 4);
    expect(geometry.humanReadableGroups[1].centerMm).toBeCloseTo(35 * 0.33, 4);
    expect(geometry.humanReadableGroups[2].centerMm).toBeCloseTo(82 * 0.33, 4);
  });

  it('omits the digit zone when the interpretation is hidden', () => {
    const hidden = buildPaperBarcodeGeometry(
      { symbology: 'ean13', value: '9780306406157', showHumanReadable: false },
      paperBarcodeSymbolSizeMm(1, false).widthMm,
      paperBarcodeSymbolSizeMm(1, false).heightMm,
    );
    expect(hidden.humanReadableGroups).toHaveLength(0);
    expect(hidden.humanReadableZoneMm).toBe(0);
    expect(hidden.barHeightMm).toBeCloseTo(PAPER_EAN13_NOMINAL.barHeightMm, 2);
    expect(hidden.guardBarHeightMm).toBeCloseTo(PAPER_EAN13_NOMINAL.barsOnlyHeightMm, 2);
    expect(hidden.guardBarHeightMm).toBeGreaterThan(hidden.barHeightMm);
    expect(hidden.bars.filter((bar) => bar.guard).every((bar) => bar.heightMm === hidden.guardBarHeightMm)).toBe(true);
    expect(hidden.bars.filter((bar) => !bar.guard).every((bar) => bar.heightMm === hidden.barHeightMm)).toBe(true);
  });

  it('emits no bars for an unresolved value', () => {
    const geometry = buildPaperBarcodeGeometry(
      { symbology: 'ean13', value: '9780306406158', showHumanReadable: true },
      size.widthMm,
      size.heightMm,
    );
    expect(geometry.resolution).toMatchObject({ status: 'invalid' });
    expect(geometry.bars).toHaveLength(0);
    expect(geometry.humanReadableGroups).toHaveLength(0);
  });

  it('is deterministic for identical input', () => {
    const first = buildPaperBarcodeGeometry({ symbology: 'ean13', value: '4901234567894', showHumanReadable: true }, size.widthMm, size.heightMm);
    const second = buildPaperBarcodeGeometry({ symbology: 'ean13', value: '4901234567894', showHumanReadable: true }, size.widthMm, size.heightMm);
    expect(first).toEqual(second);
  });
});

describe('physical size status', () => {
  it('accepts the SC-2 80-200% magnification window and nominal height', () => {
    const size = paperBarcodeSymbolSizeMm(1, true);
    const status = paperBarcodePhysicalSizeStatus(
      buildPaperBarcodeGeometry({ symbology: 'ean13', value: '9780306406157', showHumanReadable: true }, size.widthMm, size.heightMm),
    );
    expect(status.magnificationInRange).toBe(true);
    expect(status.heightNominal).toBe(true);
  });

  it('flags undersized and oversized magnification', () => {
    const tiny = paperBarcodePhysicalSizeStatus(
      buildPaperBarcodeGeometry({ symbology: 'ean13', value: '9780306406157', showHumanReadable: true }, 20, 15),
    );
    expect(tiny.magnificationInRange).toBe(false);
    const huge = paperBarcodePhysicalSizeStatus(
      buildPaperBarcodeGeometry({ symbology: 'ean13', value: '9780306406157', showHumanReadable: true }, paperBarcodeSymbolSizeMm(2.5, true).widthMm, 60),
    );
    expect(huge.magnificationInRange).toBe(false);
  });

  it('flags truncated bar height at a valid magnification', () => {
    const size = paperBarcodeSymbolSizeMm(1, true);
    const status = paperBarcodePhysicalSizeStatus(
      buildPaperBarcodeGeometry({ symbology: 'ean13', value: '9780306406157', showHumanReadable: true }, size.widthMm, 14),
    );
    expect(status.magnificationInRange).toBe(true);
    expect(status.heightNominal).toBe(false);
  });
});

describe('quiet-zone obstruction geometry', () => {
  it('produces the two reserved band quads in page space for an unrotated frame', () => {
    const quads = paperBarcodeQuietZoneQuads(barcodeFrame());
    expect(quads).toHaveLength(2);
    const [left, right] = quads;
    expect(Math.min(...left.points.map((point) => point.xMm))).toBeCloseTo(10, 5);
    expect(Math.max(...left.points.map((point) => point.xMm))).toBeCloseTo(10 + 3.63, 3);
    expect(Math.min(...right.points.map((point) => point.xMm))).toBeCloseTo(10 + 37.29 - 2.31, 3);
    expect(Math.max(...right.points.map((point) => point.xMm))).toBeCloseTo(10 + 37.29, 3);
  });

  it('rotates the reserved bands with the frame', () => {
    const quads = paperBarcodeQuietZoneQuads(barcodeFrame({ rotationDeg: 90 }));
    // A 90° turn about the frame centre swaps each band's axes: the tall thin left quiet zone
    // (25.93 mm tall, 11 modules wide) and the right zone (7 modules wide) trade extents.
    const extents = quads.map((quad) => {
      const xs = quad.points.map((point) => point.xMm);
      const ys = quad.points.map((point) => point.yMm);
      return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    });
    expect(extents[0].width).toBeCloseTo(25.93, 2);
    expect(extents[0].height).toBeCloseTo(3.63, 2);
    expect(extents[1].width).toBeCloseTo(25.93, 2);
    expect(extents[1].height).toBeCloseTo(2.31, 2);
  });

  it('detects overlap and separation with the separating-axis test', () => {
    const quads = paperBarcodeQuietZoneQuads(barcodeFrame());
    const intruder = paperFrameInkQuad(barcodeFrame({ id: 'frame-intruder', kind: 'panel', xMm: 8, yMm: 8, widthMm: 5, heightMm: 5, fillColor: '#111827' }));
    expect(quads.some((quad) => paperBarcodeQuadsOverlap(quad, intruder))).toBe(true);
    const distant = paperFrameInkQuad(barcodeFrame({ id: 'frame-distant', kind: 'panel', xMm: 80, yMm: 80, widthMm: 5, heightMm: 5, fillColor: '#111827' }));
    expect(quads.some((quad) => paperBarcodeQuadsOverlap(quad, distant))).toBe(false);
    const touchingEdgeToEdge = paperFrameInkQuad(barcodeFrame({ id: 'frame-adjacent', kind: 'panel', xMm: 10 + 37.29, yMm: 0, widthMm: 5, heightMm: 5, fillColor: '#111827' }));
    expect(quads.some((quad) => paperBarcodeQuadsOverlap(quad, touchingEdgeToEdge))).toBe(false);
  });

  it('classifies which neighbouring frames actually print ink', () => {
    expect(paperFrameCarriesPrintedInk(barcodeFrame({ id: 'ink-panel', kind: 'panel', fillColor: '#111827', strokeColor: 'transparent', strokeWidthMm: 0 }))).toBe(true);
    expect(paperFrameCarriesPrintedInk(barcodeFrame({ id: 'empty-panel', kind: 'panel', fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0 }))).toBe(false);
    expect(paperFrameCarriesPrintedInk(barcodeFrame({ id: 'empty-text', kind: 'text', fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0 }))).toBe(false);
  });
});
