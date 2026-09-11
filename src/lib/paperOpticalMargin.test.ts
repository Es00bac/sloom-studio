import { describe, expect, it } from 'vitest';
import type { PaperDocument, PaperFrame, PaperManagedFontFace } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { addFrameToPaperPage, createDefaultPaperDocument, parsePaperDocument, serializePaperDocument } from './paperDocument';
import { composePaperTextFrame } from './paperTextComposition';
import { buildPaperIdmlParts } from './paperIdmlExport';
import type { PaperTextShaper } from './paperTextShaper';

const PT_PER_MM = 72 / 25.4;

function fontRef(): BinaryAssetRef {
  const sha256 = 'e'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function managedFace(): PaperManagedFontFace {
  return {
    id: 'oma-fixture-regular',
    familyId: 'OMA Fixture Sans',
    familyName: 'OMA Fixture Sans',
    postscriptName: 'OmaFixtureSans-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x0, end: 0x10ffff }],
    format: 'truetype',
    fontAsset: fontRef(),
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

/**
 * Realistic ink geometry in a 1000-upem face at a 0.5 em advance: punctuation ink starts 150 units
 * right of its origin (a positive left-side bearing, so optical alignment pulls it out to the
 * margin) and ends at 400 units, leaving a 200-unit right-side bearing to hang at line end.
 * Letters deliberately carry ink left of the origin (like an italic swash) so the tests prove the
 * character gate, not the outline geometry, decides what shifts.
 */
const INK = { punctuationMinX: 150, punctuationMaxX: 400, letterMinX: -80, letterMaxX: 460 };
const ADVANCE_EM = 0.5;

function fixtureShaper(): PaperTextShaper {
  return {
    unitsPerEm: 1000,
    shape(request) {
      const glyphs = Array.from(request.text).map((character, index) => ({
        glyphId: character.codePointAt(0) ?? 1,
        cluster: index,
        xAdvance: request.fontSizePt * ADVANCE_EM,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
      }));
      return {
        direction: request.direction,
        glyphs,
        advanceX: glyphs.reduce((total, glyph) => total + glyph.xAdvance, 0),
        advanceY: 0,
      };
    },
    glyphPath: (glyphId) => {
      const character = String.fromCodePoint(glyphId);
      const isPunctuation = HANGING.has(character);
      const minX = isPunctuation ? INK.punctuationMinX : INK.letterMinX;
      const maxX = isPunctuation ? INK.punctuationMaxX : INK.letterMaxX;
      return `M ${minX} 0 L ${maxX} 0 L ${maxX} 500 L ${minX} 500 Z`;
    },
    destroy: () => undefined,
  };
}

const HANGING = new Set(['\u201C', '\u201D', '\u2018', '\u2019', '-', '\u2014', '.', ',']);

function textFrame(text: string, typography: Partial<PaperFrame['typography']>, widthMm = 120): PaperFrame {
  const base = createDefaultPaperDocument({ title: 'OMA scratch' });
  const added = addFrameToPaperPage(base, base.pages[0].id, {
    kind: 'text',
    label: 'OMA frame',
    xMm: 10,
    yMm: 10,
    widthMm,
    heightMm: 60,
    text,
    typography: { fontFamily: 'OMA Fixture Sans', fontSizePt: 12, align: 'left', ...typography },
  });
  return added.document.pages[0].frames.find((frame) => frame.id === added.frameId)!;
}

interface ComposedLineEdges {
  originXPt: number;
  firstGlyphXPt: number;
  lastGlyphXPt: number;
}

async function composeLines(frame: PaperFrame): Promise<ComposedLineEdges[]> {
  const face = managedFace();
  const document = { importedFonts: [face] } as Pick<PaperDocument, 'importedFonts'>;
  const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());
  expect(composed.missingFaces).toHaveLength(0);
  return composed.lines.map((line) => {
    const glyphs = line.runs.flatMap((run) => run.glyphs);
    return {
      originXPt: line.originXPt,
      firstGlyphXPt: glyphs[0]?.xPt ?? Number.NaN,
      lastGlyphXPt: glyphs[glyphs.length - 1]?.xPt ?? Number.NaN,
    };
  });
}

function leadingShiftPt(fontSizePt: number): number {
  return (INK.punctuationMinX / 1000) * fontSizePt;
}

function trailingShiftPt(fontSizePt: number): number {
  return fontSizePt * ADVANCE_EM - (INK.punctuationMaxX / 1000) * fontSizePt;
}

describe('optical margin alignment composition', () => {
  it('aligns a leading typographic quote by its real glyph outline bearing', async () => {
    const fontSizePt = 12;
    const plain = await composeLines(textFrame('\u201CQuoted text', { opticalMarginAlignment: false }));
    const hung = await composeLines(textFrame('\u201CQuoted text', { opticalMarginAlignment: true }));

    expect(plain).toHaveLength(1);
    expect(hung).toHaveLength(1);
    // Positive left-side bearing: the quote is pulled left so its ink starts exactly on the margin.
    expect(plain[0].firstGlyphXPt - hung[0].firstGlyphXPt).toBeCloseTo(leadingShiftPt(fontSizePt), 6);
    // The line's box origin stays margin-aligned; only the glyph pen moves toward the margin.
    expect(hung[0].originXPt).toBeCloseTo(plain[0].originXPt, 6);
  });

  it('hangs trailing punctuation by its real right-side bearing', async () => {
    const fontSizePt = 12;
    const plain = await composeLines(textFrame('Quoted text,', { opticalMarginAlignment: false }));
    const hung = await composeLines(textFrame('Quoted text,', { opticalMarginAlignment: true }));

    expect(plain).toHaveLength(1);
    expect(hung).toHaveLength(1);
    // Positive right-side bearing: the comma shifts right so its ink ends exactly on the margin.
    expect(hung[0].lastGlyphXPt - plain[0].lastGlyphXPt).toBeCloseTo(trailingShiftPt(fontSizePt), 6);
    // The shift is confined to the final glyph; the leading letter does not move.
    expect(hung[0].firstGlyphXPt).toBeCloseTo(plain[0].firstGlyphXPt, 6);
  });

  it('never shifts a leading or trailing letter, even one whose ink starts left of its origin', async () => {
    const plain = await composeLines(textFrame('Quoted text', { opticalMarginAlignment: false }));
    const hung = await composeLines(textFrame('Quoted text', { opticalMarginAlignment: true }));
    expect(hung[0].firstGlyphXPt).toBeCloseTo(plain[0].firstGlyphXPt, 6);
    expect(hung[0].lastGlyphXPt).toBeCloseTo(plain[0].lastGlyphXPt, 6);
  });

  it('shifts punctuation that starts or ends a wrapped or hard-broken continuation line', async () => {
    const plain = await composeLines(textFrame('First line\n\u2014continuation', { opticalMarginAlignment: false }));
    const hung = await composeLines(textFrame('First line\n\u2014continuation', { opticalMarginAlignment: true }));
    expect(plain).toHaveLength(2);
    expect(hung).toHaveLength(2);
    expect(plain[1].firstGlyphXPt - hung[1].firstGlyphXPt).toBeCloseTo(leadingShiftPt(12), 6);
    expect(hung[0].firstGlyphXPt).toBeCloseTo(plain[0].firstGlyphXPt, 6);
  });

  it('leaves centered and right-aligned lines untouched', async () => {
    for (const align of ['center', 'right'] as const) {
      const plain = await composeLines(textFrame('\u201CQuoted text,', { opticalMarginAlignment: false, align }));
      const hung = await composeLines(textFrame('\u201CQuoted text,', { opticalMarginAlignment: true, align }));
      expect(hung[0].firstGlyphXPt).toBeCloseTo(plain[0].firstGlyphXPt, 6);
      expect(hung[0].lastGlyphXPt).toBeCloseTo(plain[0].lastGlyphXPt, 6);
    }
  });

  it('keeps the historical default (no setting) exactly unchanged', async () => {
    const unset = await composeLines(textFrame('\u201CQuoted text,', {}));
    const off = await composeLines(textFrame('\u201CQuoted text,', { opticalMarginAlignment: false }));
    expect(unset[0].firstGlyphXPt).toBeCloseTo(off[0].firstGlyphXPt, 6);
    expect(unset[0].lastGlyphXPt).toBeCloseTo(off[0].lastGlyphXPt, 6);
  });

  it('is deterministic for identical input', async () => {
    const first = await composeLines(textFrame('\u201CQuoted text,', { opticalMarginAlignment: true }));
    const second = await composeLines(textFrame('\u201CQuoted text,', { opticalMarginAlignment: true }));
    expect(first).toEqual(second);
  });
});

describe('optical margin alignment persistence and interchange', () => {
  function documentWithOpticalMargin(enabled: boolean): PaperDocument {
    const base = createDefaultPaperDocument({ title: 'OMA fixture' });
    return addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      label: 'OMA frame',
      xMm: 10,
      yMm: 10,
      widthMm: 120,
      heightMm: 60,
      text: '\u201CQuoted text',
      typography: { opticalMarginAlignment: enabled },
    }).document;
  }

  it('round-trips the authored setting through serialize/parse', () => {
    for (const enabled of [true, false]) {
      const parsed = parsePaperDocument(serializePaperDocument(documentWithOpticalMargin(enabled)));
      const frame = parsed.pages[0].frames[0];
      expect(frame.typography.opticalMarginAlignment).toBe(enabled);
    }
    const unset = parsePaperDocument(serializePaperDocument(documentWithOpticalMargin(false)));
    expect(unset.pages[0].frames[0].typography.opticalMarginAlignment).toBe(false);
  });

  it('writes the authored OpticalMarginAlignment into the IDML story preference', () => {
    for (const enabled of [true, false]) {
      const parts = buildPaperIdmlParts(documentWithOpticalMargin(enabled));
      const story = Object.entries(parts).find(([path]) => path.startsWith('Stories/Story_'))![1];
      expect(story).toContain(`OpticalMarginAlignment="${enabled ? 'true' : 'false'}"`);
    }
  });
});

describe('optical margin geometry sanity', () => {
  it('positions both edges in physical points relative to the content box', async () => {
    const fontSizePt = 12;
    const frame = textFrame('\u201CQuoted,', { opticalMarginAlignment: true });
    const [line] = await composeLines(frame);
    // The content box for a text frame starts at its 2 mm padding; the quote is pulled out by its
    // left-side bearing, and the eight-glyph line's final comma origin sits seven advances later,
    // then hangs by its right-side bearing so its ink ends exactly at the line's advance end.
    const expectedPlainStart = 2 * PT_PER_MM;
    expect(line.firstGlyphXPt).toBeCloseTo(expectedPlainStart - leadingShiftPt(fontSizePt), 4);
    expect(line.lastGlyphXPt).toBeCloseTo(
      expectedPlainStart - leadingShiftPt(fontSizePt) + 7 * fontSizePt * ADVANCE_EM + trailingShiftPt(fontSizePt),
      4,
    );
  });
});
