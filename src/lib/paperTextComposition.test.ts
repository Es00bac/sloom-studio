import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { composePaperTextFrame, type PaperManagedFontResolver } from './paperTextComposition';
import type { PaperManagedFontFace, PaperRichParagraph, PaperTextRun, PaperTypography } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperTextShaper } from './paperTextShaper';

function assetRef(seed: string): BinaryAssetRef {
  const sha256 = seed.repeat(64).slice(0, 64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function face(weight: number, patch: Partial<PaperManagedFontFace> = {}): PaperManagedFontFace {
  return {
    id: `fixture-${weight}`,
    familyId: 'fixture sans',
    familyName: 'Fixture Sans',
    postscriptName: `FixtureSans-${weight}`,
    weight,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x0, end: 0x10ffff }],
    format: 'truetype',
    fontAsset: assetRef(String((weight / 100) % 10)),
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...patch,
  };
}

function fixtureShaper(): PaperTextShaper {
  return {
    shape(request) {
      let offset = 0;
      const glyphs = Array.from(request.text).map((character) => {
        const advance = request.fontSizePt / 2;
        const glyph = {
          glyphId: character.codePointAt(0) ?? 1,
          cluster: offset,
          xAdvance: request.direction === 'ttb' ? 0 : advance,
          yAdvance: request.direction === 'ttb' ? -advance : 0,
          xOffset: 0,
          yOffset: 0,
        };
        offset += character.length;
        return glyph;
      });
      // A deterministic kerning pair used to prove wrapping measures the shaped candidate rather than the
      // sum of isolated graphemes. No other fixture string in this suite relies on an AV pair.
      if (request.direction !== 'ttb') {
        for (let index = 0; index < request.text.length - 1; index += 1) {
          if (request.text.slice(index, index + 2) === 'AV') glyphs[index].xAdvance -= request.fontSizePt / 4;
        }
      }
      return {
        direction: request.direction,
        glyphs,
        advanceX: glyphs.reduce((total, glyph) => total + glyph.xAdvance, 0),
        advanceY: glyphs.reduce((total, glyph) => total + glyph.yAdvance, 0),
      };
    },
    glyphPath: () => 'M 0 0 L 500 0 L 500 500 Z',
    destroy: () => undefined,
  };
}

function composeFixture(
  runs: PaperTextRun[],
  typographyPatch: Partial<PaperTypography> = {},
  onShapeFeatures?: (features: Record<string, boolean | number>) => void,
  onShapeRequest?: (request: Parameters<PaperTextShaper['shape']>[0]) => void,
  paragraphPatch: Omit<Partial<PaperRichParagraph>, 'runs'> = {},
) {
  let document = createDefaultPaperDocument({ title: 'Composition fixture' });
  const pageId = document.pages[0].id;
  const added = addFrameToPaperPage(document, pageId, {
    id: 'fixture-frame',
    kind: 'text',
    xMm: 0,
    yMm: 0,
    widthMm: 100,
    heightMm: 30,
  });
  const regular = face(400, { variableAxes: { opsz: { min: 8, default: 12, max: 72 } } });
  const bold = face(700);
  document = {
    ...added.document,
    importedFonts: [regular, bold],
  };
  const frame = {
    ...document.pages[0].frames[0],
    text: runs.map((run) => run.text).join(''),
    richText: [{ ...paragraphPatch, runs }],
    typography: {
      ...document.pages[0].frames[0].typography,
      fontFamily: 'Fixture Sans',
      fontSizePt: 12,
      leadingPt: 14,
      fontWeight: '400',
      ...typographyPatch,
    },
  };
  const resolver: PaperManagedFontResolver = async () => {
    const shaper = fixtureShaper();
    return onShapeFeatures || onShapeRequest ? {
      ...shaper,
      shape: (request) => {
        onShapeFeatures?.(request.features);
        onShapeRequest?.(request);
        return shaper.shape(request);
      },
    } : shaper;
  };
  return composePaperTextFrame(frame, document, resolver);
}

async function composeSizedFixture(input: {
  widthMm: number;
  heightMm: number;
  text?: string;
  columns?: number;
  columnBalance?: boolean;
  richText?: PaperRichParagraph[];
  typography?: Partial<PaperTypography>;
}) {
  let document = createDefaultPaperDocument({ title: 'Sized composition fixture' });
  const added = addFrameToPaperPage(document, document.pages[0].id, {
    id: 'sized-fixture-frame',
    kind: 'text',
    xMm: 0,
    yMm: 0,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    columns: input.columns ?? 1,
    columnBalance: input.columnBalance ?? false,
  });
  document = { ...added.document, importedFonts: [face(400)] };
  const sourceText = input.text ?? input.richText?.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';
  const frame = {
    ...document.pages[0].frames[0],
    text: sourceText,
    ...(input.richText ? { richText: input.richText } : {}),
    typography: {
      ...document.pages[0].frames[0].typography,
      fontFamily: 'Fixture Sans',
      fontSizePt: 12,
      leadingPt: 14,
      ...input.typography,
    },
  };
  return composePaperTextFrame(frame, document, async () => fixtureShaper());
}

describe('composePaperTextFrame', () => {
  it('keeps mixed rich runs on one deterministic baseline with exact faces', async () => {
    const composed = await composeFixture([{ text: 'Plain ' }, { text: 'bold', fontWeight: '700' }]);

    expect(composed.missingFaces).toEqual([]);
    expect(composed.lines).toHaveLength(1);
    expect(composed.lines[0].runs.map((run) => run.face.weight)).toEqual([400, 700]);
    expect(composed.caretMap[6].xPt).toBeLessThan(composed.caretMap[7].xPt);
  });

  it('orders mixed RTL run groups visually and maps RTL carets right-to-left', async () => {
    const composed = await composeFixture([
      { text: 'אב', color: '#dc2626' },
      { text: 'CD', color: '#2563eb' },
    ]);

    expect(composed.lines).toHaveLength(1);
    expect(composed.lines[0].runs.map((run) => run.color.color)).toEqual(['#2563eb', '#dc2626']);
    expect(composed.caretMap[0].xPt).toBeGreaterThan(composed.caretMap[1].xPt);
  });

  it('preserves run tracking, baseline shifts, and decoration data in glyph output', async () => {
    const composed = await composeFixture([
      { text: 'AB', tracking: 100 },
      { text: '2', vertAlign: 'super', underline: true, strike: true, highlight: '#fde047' },
    ]);
    const [tracked, raised] = composed.lines[0].runs;

    expect(tracked.advanceXPt).toBeCloseTo(13.2);
    expect(raised.fontSizePt).toBeCloseTo(8.4);
    expect(raised.glyphs[0].yPt).toBeLessThan(composed.lines[0].originYPt);
    expect(raised.decorations).toEqual({ underline: true, strike: true, highlight: '#fde047' });
  });

  it('disables the OpenType kern feature when Paper kerning is set to none', async () => {
    const shapedFeatures: Array<Record<string, boolean | number>> = [];
    await composeFixture([{ text: 'AVATAR' }], { fontKerning: 'none' }, (features) => shapedFeatures.push(features));

    expect(shapedFeatures.length).toBeGreaterThan(0);
    expect(shapedFeatures.every((features) => features.kern === false)).toBe(true);
  });

  it('derives CSS-compatible optical sizing when a variable face has no authored opsz', async () => {
    const requests: Array<Parameters<PaperTextShaper['shape']>[0]> = [];
    await composeFixture([{ text: 'Optical proof' }], {}, undefined, (request) => requests.push(request));

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.variations?.opsz === 16)).toBe(true);
  });

  it('maps a selected variable face weight to HarfBuzz like CSS export', async () => {
    const requests: Array<Parameters<PaperTextShaper['shape']>[0]> = [];
    let document = createDefaultPaperDocument({ title: 'Variable weight fixture' });
    const added = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'variable-weight-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 80,
      heightMm: 30,
    });
    const boldVariable = face(700, {
      variableAxes: { wght: { min: 100, default: 400, max: 900 } },
    });
    document = { ...added.document, importedFonts: [boldVariable] };
    const frame = {
      ...document.pages[0].frames[0],
      text: '日本語《にほんご》',
      typography: {
        ...document.pages[0].frames[0].typography,
        fontFamily: 'Fixture Sans',
        fontWeight: '700',
      },
    };
    const shaper = fixtureShaper();

    await composePaperTextFrame(frame, document, async () => ({
      ...shaper,
      shape: (request) => {
        requests.push(request);
        return shaper.shape(request);
      },
    }));

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.variations?.wght === 700)).toBe(true);
  });

  it('resolves mixed run kerning and numeric features before managed shaping', async () => {
    const requests: Array<Parameters<PaperTextShaper['shape']>[0]> = [];
    await composeFixture([
      { text: '12', fontKerning: 'none', numericStyle: 'tabular', smallCaps: false },
      { text: '34', fontKerning: 'normal', numericStyle: 'oldstyle' },
    ], { fontKerning: 'none', numericStyle: 'lining', smallCaps: true }, undefined, (request) => requests.push(request));

    const tabular = requests.find((request) => request.text === '12')?.features;
    const oldstyle = requests.find((request) => request.text === '34')?.features;
    expect(tabular).toEqual(expect.objectContaining({ kern: false, tnum: true }));
    expect(tabular).not.toHaveProperty('lnum');
    expect(tabular).not.toHaveProperty('smcp');
    expect(oldstyle).toEqual(expect.objectContaining({ kern: true, onum: true }));
    expect(oldstyle).not.toHaveProperty('lnum');
    expect(oldstyle).toEqual(expect.objectContaining({ smcp: true }));
  });

  it('uses paragraph and mixed-run leading in measurable shared line geometry', async () => {
    const paragraphLeading = await composeFixture(
      [{ text: 'Paragraph leading' }],
      { leadingPt: 14 },
      undefined,
      undefined,
      { leadingPt: 22 },
    );
    const mixedRunLeading = await composeFixture(
      [{ text: 'Base ' }, { text: 'tall', leadingPt: 31 }],
      { leadingPt: 14 },
      undefined,
      undefined,
      { leadingPt: 22 },
    );
    const lowerRunLeading = await composeFixture(
      [{ text: 'Base ' }, { text: 'lower', leadingPt: 11 }],
      { leadingPt: 14 },
      undefined,
      undefined,
      { leadingPt: 22 },
    );

    expect(paragraphLeading.lines[0].layoutBounds?.heightPt).toBeCloseTo(22);
    expect(mixedRunLeading.lines[0].layoutBounds?.heightPt).toBeCloseTo(31);
    expect(mixedRunLeading.lines[0].originYPt).toBeGreaterThan(paragraphLeading.lines[0].originYPt);
    // An explicit lower run survives as authored data, while FBL-006's shared paragraph strut remains the floor.
    expect(lowerRunLeading.lines[0].layoutBounds?.heightPt).toBeCloseTo(22);
  });

  it('preserves the print paragraph separator between authored rich blocks', async () => {
    const composed = await composeSizedFixture({
      widthMm: 100,
      heightMm: 100,
      richText: [
        { runs: [{ text: 'First' }] },
        { runs: [{ text: 'Second' }] },
        { runs: [{ text: 'Third' }] },
      ],
      typography: { fontSizePt: 12, leadingPt: 20 },
    });

    expect(composed.lines.map((line) => line.text)).toEqual(['First', 'Second', 'Third']);
    expect(composed.lines[1].originYPt - composed.lines[0].originYPt).toBeCloseTo(40);
    expect(composed.lines[2].originYPt - composed.lines[1].originYPt).toBeCloseTo(40);
  });

  it('uses contextual kerning when deciding whether the next word fits', async () => {
    const composed = await composeSizedFixture({
      widthMm: 13.5,
      heightMm: 40,
      text: 'AV AV',
      typography: { fontSizePt: 12, leadingPt: 14 },
    });

    expect(composed.lines.map((line) => line.text)).toEqual(['AV AV']);
  });

  it('lays out rich-run newlines as hard breaks instead of missing glyphs', async () => {
    const composed = await composeFixture([{ text: 'FIRST\nSECOND\nTHIRD' }], { fontSizePt: 12, leadingPt: 14 });

    expect(composed.missingGlyphs).toEqual([]);
    expect(composed.lines.map((line) => line.text)).toEqual(['FIRST', 'SECOND', 'THIRD']);
    expect(composed.lines.map((line) => line.originYPt)).toEqual([
      expect.any(Number), expect.any(Number), expect.any(Number),
    ]);
    expect(composed.lines[1].originYPt - composed.lines[0].originYPt).toBeCloseTo(14);
  });

  it('uses paragraph alignLast for the final line of justified managed text', async () => {
    const composed = await composeFixture(
      [{ text: 'Centered final line' }],
      { align: 'justify', alignLast: 'left' },
      undefined,
      undefined,
      { alignLast: 'center' },
    );

    expect(composed.lines).toHaveLength(1);
    expect(composed.lines[0].originXPt).toBeGreaterThan(composed.bounds.xPt);
    expect(composed.lines[0].originXPt - composed.bounds.xPt).toBeCloseTo(
      (composed.bounds.widthPt - composed.lines[0].widthPt) / 2,
    );
  });

  it('passes retained optical-size coordinates through deterministic HarfBuzz measurement and shaping', async () => {
    const requests: Array<Parameters<PaperTextShaper['shape']>[0]> = [];
    await composeFixture([{ text: 'Optical proof', fontVariationSettings: { opsz: 18 } }], {}, undefined, (request) => requests.push(request));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.variations?.opsz === 18)).toBe(true);
  });

  it('composes vertical Japanese with right-to-left columns and kinsoku', async () => {
    let document = createDefaultPaperDocument({ title: 'Vertical composition fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'vertical-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 30,
      heightMm: 8,
    });
    const managedFace = face(400);
    document = { ...added.document, importedFonts: [managedFace] };
    const frame = {
      ...document.pages[0].frames[0],
      text: '「花」、記憶。',
      typography: {
        ...document.pages[0].frames[0].typography,
        fontFamily: 'Fixture Sans',
        fontSizePt: 10,
        leadingPt: 11,
        writingMode: 'vertical-rl' as const,
        lineBreakStrict: true,
      },
    };
    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());

    expect(composed.writingMode).toBe('vertical-rl');
    expect(composed.missingFaces).toEqual([]);
    expect(composed.lines.length).toBeGreaterThanOrEqual(2);
    expect(composed.lines[1].originXPt).toBeLessThan(composed.lines[0].originXPt);
    expect(composed.lines.every((line) => !/^[、。」]/.test(line.text))).toBe(true);
  });

  it('keeps effective vertical orientation and every emphasis style in positioned geometry', async () => {
    const requests: Array<Parameters<PaperTextShaper['shape']>[0]> = [];
    const composed = await composeFixture([
      { text: 'AB', textOrientation: 'mixed', emphasis: 'dot' },
      { text: 'CD', textOrientation: 'upright', emphasis: 'open-dot' },
      { text: '花' },
      { text: '《《強》》' },
      { text: '無', emphasis: 'none' },
    ], {
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
      emphasis: 'circle',
    }, undefined, (request) => requests.push(request));

    const mixed = composed.lines.flatMap((line) => line.runs).find((run) => run.text === 'AB');
    const upright = composed.lines.flatMap((line) => line.runs).find((run) => run.text === 'CD');
    const mixedRequest = requests.find((request) => request.text === 'AB');
    const uprightRequest = requests.find((request) => request.text === 'CD');

    expect(mixed).toMatchObject({ glyphRotationDeg: 90 });
    expect(upright?.glyphRotationDeg).toBeUndefined();
    expect(mixedRequest).toMatchObject({ direction: 'ltr', script: 'Latn' });
    expect(mixedRequest?.features).not.toHaveProperty('vert');
    expect(uprightRequest).toMatchObject({ direction: 'ttb', script: 'Latn' });
    expect(uprightRequest?.features).toEqual(expect.objectContaining({ vert: true, vrt2: true }));
    expect(composed.emphasisMarks?.map((mark) => mark.style)).toEqual([
      'dot', 'dot', 'open-dot', 'open-dot', 'circle', 'sesame',
    ]);
  });

  it('marks first-box and post-rollover overflow as overset', async () => {
    const firstHorizontal = await composeSizedFixture({
      widthMm: 20,
      heightMm: 5,
      text: 'A',
      typography: { fontSizePt: 12, leadingPt: 20 },
    });
    const firstVertical = await composeSizedFixture({
      widthMm: 5,
      heightMm: 20,
      text: '花',
      typography: { fontSizePt: 12, leadingPt: 20, writingMode: 'vertical-rl' },
    });
    const postRollover = await composeSizedFixture({
      widthMm: 40,
      heightMm: 10,
      columns: 2,
      richText: [
        { runs: [{ text: 'A', fontSizePt: 4, leadingPt: 6 }] },
        { runs: [{ text: 'B', fontSizePt: 12, leadingPt: 20 }], spaceBeforeMm: 10 },
      ],
    });

    expect(firstHorizontal.overset).toBe(true);
    expect(firstHorizontal.lines[0].layoutBounds?.heightPt).toBeGreaterThan(firstHorizontal.bounds.heightPt);
    expect(firstVertical.overset).toBe(true);
    expect(firstVertical.lines[0].originXPt).toBeLessThan(firstVertical.bounds.xPt);
    expect(postRollover.lines.at(-1)?.columnIndex).toBe(1);
    expect(postRollover.overset).toBe(true);
  });

  it('lets paragraph strictness override the frame for managed Japanese line breaking', async () => {
    let document = createDefaultPaperDocument({ title: 'Paragraph kinsoku fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'paragraph-kinsoku-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 30,
      heightMm: 8,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const text = '花花花花、記';
    const base = {
      ...document.pages[0].frames[0],
      text,
      typography: {
        ...document.pages[0].frames[0].typography,
        fontFamily: 'Fixture Sans',
        fontSizePt: 10,
        leadingPt: 11,
        writingMode: 'vertical-rl' as const,
      },
    };
    const relaxed = await composePaperTextFrame({
      ...base,
      typography: { ...base.typography, lineBreakStrict: true },
      richText: [{ runs: [{ text }], lineBreakStrict: false }],
    }, document, async () => fixtureShaper());
    const strict = await composePaperTextFrame({
      ...base,
      typography: { ...base.typography, lineBreakStrict: false },
      richText: [{ runs: [{ text }], lineBreakStrict: true }],
    }, document, async () => fixtureShaper());

    expect(relaxed.lines.some((line) => line.text.startsWith('、'))).toBe(true);
    expect(strict.lines.every((line) => !line.text.startsWith('、'))).toBe(true);
  });

  it('records a missing exact face instead of substituting a browser font', async () => {
    let document = createDefaultPaperDocument({ title: 'Missing face fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'missing-face-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 60,
      heightMm: 20,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const frame = {
      ...document.pages[0].frames[0],
      text: 'Needs bold',
      richText: [{ runs: [{ text: 'Needs bold', fontWeight: '700' }] }],
      typography: { ...document.pages[0].frames[0].typography, fontFamily: 'Fixture Sans' },
    };
    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());

    expect(composed.missingFaces).toEqual([expect.objectContaining({ familyId: 'fixture sans', weight: 700 })]);
    expect(composed.lines).toEqual([]);
  });

  it('keeps ruby and emphasis as positioned managed annotations instead of raw notation glyphs', async () => {
    let document = createDefaultPaperDocument({ title: 'Annotation fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'annotation-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 80,
      heightMm: 30,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const frame = {
      ...document.pages[0].frames[0],
      text: '漢字《かんじ》《《強調》》',
      typography: { ...document.pages[0].frames[0].typography, fontFamily: 'Fixture Sans' },
    };
    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());

    expect(composed.lines[0].text).toBe('漢字強調');
    expect(composed.lines[0].runs.some((run) => run.annotation === 'ruby')).toBe(true);
    expect(composed.emphasisMarks).toHaveLength(2);
  });

  it('keeps rich paragraph boxes and hanging list markers on deterministic column geometry', async () => {
    let document = createDefaultPaperDocument({ title: 'Paragraph geometry fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'paragraph-geometry-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 28,
      heightMm: 60,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const text = 'A managed list item must continue on multiple deterministic lines.';
    const frame = {
      ...document.pages[0].frames[0],
      text: `•\t${text}`,
      richText: [{
        listMarker: '•',
        leftIndentMm: 2,
        shading: '#e5e7eb',
        borders: { top: { color: '#111827', widthPt: 1 }, paddingPt: 3 },
        runs: [{ text }],
      }],
      typography: { ...document.pages[0].frames[0].typography, fontFamily: 'Fixture Sans', fontSizePt: 12, leadingPt: 14 },
    };

    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());

    expect(composed.lines.length).toBeGreaterThan(1);
    expect(composed.lines[1].originXPt).toBeGreaterThan(composed.lines[0].originXPt);
    expect(composed.paragraphBoxes).toEqual([expect.objectContaining({
      xPt: composed.bounds.xPt,
      widthPt: composed.bounds.widthPt,
    })]);
  });

  it('reserves the drop-cap lane through the configured number of lines', async () => {
    let document = createDefaultPaperDocument({ title: 'Drop cap fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'drop-cap-frame',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 35,
      heightMm: 70,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const text = 'Drop caps reserve a deterministic lane while the following lines wrap beside them.';
    const frame = {
      ...document.pages[0].frames[0],
      text,
      richText: [{ runs: [{ text }], dropCapLines: 3 }],
      typography: { ...document.pages[0].frames[0].typography, fontFamily: 'Fixture Sans', fontSizePt: 12, leadingPt: 14 },
    };

    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());

    expect(composed.lines.length).toBeGreaterThanOrEqual(3);
    expect(composed.lines[1].originXPt).toBeGreaterThan(composed.lines[0].originXPt);
  });

  it('uses one frame-opening cap and derives its wrap lane from the exported float height', async () => {
    let document = createDefaultPaperDocument({ title: 'Frame opening drop cap fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'frame-opening-drop-cap',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 35,
      heightMm: 100,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const frame = {
      ...document.pages[0].frames[0],
      text: 'The opening paragraph is long enough to wrap across several deterministic lines beside its capital.\nThe second paragraph remains ordinary body text.',
      typography: {
        ...document.pages[0].frames[0].typography,
        fontFamily: 'Fixture Sans',
        fontSizePt: 9.2,
        leadingPt: 12.4,
        dropCapLines: 3,
      },
    };

    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());
    const openingLines = composed.lines.filter((line) => line.paragraphIndex === 0);
    const secondParagraphLines = composed.lines.filter((line) => line.paragraphIndex === 1);

    expect(openingLines.length).toBeGreaterThanOrEqual(3);
    expect(openingLines[0].runs[0].fontSizePt).toBeCloseTo(27.6);
    expect(openingLines[1].originXPt).toBeGreaterThan(openingLines[0].originXPt);
    expect(openingLines[2].originXPt).toBeCloseTo(openingLines[0].originXPt);
    expect(Math.max(...secondParagraphLines.flatMap((line) => line.runs.map((run) => run.fontSizePt)))).toBeCloseTo(9.2);
  });

  it('moves a complete overflowing word to the next legal line', async () => {
    const composed = await composeSizedFixture({
      widthMm: 23,
      heightMm: 30,
      text: 'AAAA BBBBB',
      typography: { fontSizePt: 12, leadingPt: 14 },
    });

    expect(composed.lines.map((line) => line.text)).toEqual(['AAAA', 'BBBBB']);
    expect(composed.lines.every((line) => line.widthPt <= composed.bounds.widthPt)).toBe(true);
  });

  it('inserts visible discretionary hyphens from language patterns only when enabled', async () => {
    const enabled = await composeSizedFixture({
      widthMm: 15,
      heightMm: 40,
      text: 'typesetting',
      typography: { fontSizePt: 12, leadingPt: 14, hyphenate: true },
    });
    const disabled = await composeSizedFixture({
      widthMm: 15,
      heightMm: 40,
      text: 'typesetting',
      typography: { fontSizePt: 12, leadingPt: 14, hyphenate: false },
    });

    expect(enabled.lines.map((line) => line.text)).toEqual(['type-', 'set-', 'ting']);
    expect(disabled.lines.every((line) => !line.text.endsWith('-'))).toBe(true);
    expect(enabled.lines.flatMap((line) => line.runs).some((run) => run.text.includes('-'))).toBe(true);
  });

  it('snaps every horizontal managed baseline to the document baseline grid', async () => {
    const composed = await composeSizedFixture({
      widthMm: 28,
      heightMm: 100,
      text: 'Baseline grid composition keeps every production line on the same vertical rhythm.',
      typography: { fontSizePt: 10, leadingPt: 13, hyphenate: false, alignToBaselineGrid: true },
    });
    const startPt = 12.7 * 72 / 25.4;
    const incrementPt = 4.6 * 72 / 25.4;

    expect(composed.lines.length).toBeGreaterThan(2);
    for (const line of composed.lines) {
      const gridIndex = (line.originYPt - startPt) / incrementPt;
      expect(gridIndex).toBeCloseTo(Math.round(gridIndex), 5);
    }
  });

  it('balances authored display lines without changing their count', async () => {
    const composed = await composeSizedFixture({
      widthMm: 65,
      heightMm: 45,
      text: 'A PROMPT STOPPED BEING DISPOSABLE AND BECAME MATERIAL WITH A ROUTE.',
      typography: { fontSizePt: 17.5, leadingPt: 18.2, lineBreak: 'balance', hyphenate: false },
    });

    expect(composed.lines.map((line) => line.text)).toEqual([
      'A PROMPT',
      'STOPPED BEING',
      'DISPOSABLE AND',
      'BECAME MATERIAL',
      'WITH A ROUTE.',
    ]);
  });

  it('balances managed text across authored columns when export balancing is enabled', async () => {
    const composed = await composeSizedFixture({
      widthMm: 50,
      heightMm: 100,
      columns: 2,
      columnBalance: true,
      text: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
      typography: { fontSizePt: 12, leadingPt: 14 },
    });
    const counts = composed.lines.reduce((totals, line) => {
      totals[line.columnIndex ?? 0] = (totals[line.columnIndex ?? 0] ?? 0) + 1;
      return totals;
    }, [] as number[]);

    expect(counts).toHaveLength(2);
    expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(1);
    expect(composed.overset).toBe(false);
  });

  it('keeps an explicit later paragraph drop cap without inheriting the frame cap everywhere', async () => {
    let document = createDefaultPaperDocument({ title: 'Explicit paragraph drop cap fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'explicit-paragraph-drop-cap',
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 70,
      heightMm: 100,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const frame = {
      ...document.pages[0].frames[0],
      text: 'Opening\nOrdinary\nExplicit',
      richText: [
        { runs: [{ text: 'Opening' }] },
        { runs: [{ text: 'Ordinary' }] },
        { runs: [{ text: 'Explicit' }], dropCapLines: 2 },
      ],
      typography: {
        ...document.pages[0].frames[0].typography,
        fontFamily: 'Fixture Sans',
        fontSizePt: 9.2,
        leadingPt: 12.4,
        dropCapLines: 3,
      },
    };

    const composed = await composePaperTextFrame(frame, document, async () => fixtureShaper());
    const largestSize = (paragraphIndex: number) => Math.max(
      ...composed.lines
        .filter((line) => line.paragraphIndex === paragraphIndex)
        .flatMap((line) => line.runs.map((run) => run.fontSizePt)),
    );

    expect(largestSize(0)).toBeCloseTo(27.6);
    expect(largestSize(1)).toBeCloseTo(9.2);
    expect(largestSize(2)).toBeCloseTo(18.4);
  });

  it('applies bubble vertical alignment to managed glyph coordinates', async () => {
    let document = createDefaultPaperDocument({ title: 'Bubble alignment fixture' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      id: 'bubble-alignment-frame',
      kind: 'speechBubble',
      xMm: 0,
      yMm: 0,
      widthMm: 60,
      heightMm: 45,
    });
    document = { ...added.document, importedFonts: [face(400)] };
    const base = {
      ...document.pages[0].frames[0],
      text: 'Centered in the bubble',
      typography: { ...document.pages[0].frames[0].typography, fontFamily: 'Fixture Sans', fontSizePt: 12, leadingPt: 14 },
    };

    const top = await composePaperTextFrame({ ...base, textVerticalAlign: 'top' }, document, async () => fixtureShaper());
    const bottom = await composePaperTextFrame({ ...base, textVerticalAlign: 'bottom' }, document, async () => fixtureShaper());

    expect(bottom.bounds).toEqual(top.bounds);
    expect(bottom.lines[0].originYPt).toBeGreaterThan(top.lines[0].originYPt);
  });
});
