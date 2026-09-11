import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import {
  appendPaperNativeContent,
  type PaperPdfxNativeContext,
} from './paperPdfxNativeContent';
import type { PaperRenderNode, PaperRenderTextNode } from './paperRenderPlan';
import type { PaperPrintPaint } from './paperPrintPaint';
import type { PaperManagedFontFace } from '../types/paper';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';

const liberationSerif = new Uint8Array(readFileSync('public/fonts/liberation/LiberationSerif-Regular.ttf'));
const FONT_ASSET_ID = `sha256:${'b'.repeat(64)}` as BinaryAssetId;

function managedFace(): PaperManagedFontFace {
  return {
    id: 'managed-serif',
    familyId: 'managed serif',
    familyName: 'Managed Serif',
    postscriptName: 'ManagedSerif-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x20, end: 0x7e }],
    format: 'truetype',
    fontAsset: {
      id: FONT_ASSET_ID,
      sha256: 'b'.repeat(64),
      mimeType: 'font/ttf',
      byteLength: liberationSerif.byteLength,
    },
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

function path(fill: PaperPrintPaint, overprint = false): PaperRenderNode {
  return {
    kind: 'path',
    objectId: 'path-1',
    path: 'M 0 0 L 30 0 L 30 30 L 0 30 Z',
    fill,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 0,
    strokeWidthPt: 0,
    strokeStyle: 'solid',
    overprint,
    boundsPt: { x: 0, y: 0, width: 30, height: 30 },
  };
}

function spotText(name: string, alternate = { c: 0, m: 0.9, y: 0.85, k: 0 }): PaperRenderTextNode {
  const face = managedFace();
  return {
    kind: 'text',
    objectId: 'rich-spot',
    sourceFrameId: 'rich-spot',
    opacity: 1,
    overprint: false,
    boundsPt: { x: 10, y: 10, width: 90, height: 30 },
    paints: {
      runs: [{ lineIndex: 0, runIndex: 0, fill: { kind: 'spot', name, alternate, tint: 1 } }],
      paragraphBoxes: [],
      emphasisMarks: [],
    },
    composed: {
      frameId: 'rich-spot',
      writingMode: 'horizontal-tb',
      bounds: { xPt: 10, yPt: 10, widthPt: 90, heightPt: 30 },
      caretMap: [],
      overset: false,
      missingFaces: [],
      missingGlyphs: [],
      lines: [{
        text: 'Spot',
        originXPt: 10,
        originYPt: 25,
        widthPt: 30,
        runs: [{
          text: 'Spot',
          face,
          fontSizePt: 14,
          unitsPerEm: 1000,
          color: { kind: 'css-color', color: '#e30613' },
          sourceStart: 0,
          sourceEnd: 4,
          glyphs: [{ glyphId: 1, cluster: 0, xAdvance: 7, yAdvance: 0, xOffset: 0, yOffset: 0, xPt: 10, yPt: 25 }],
        }],
      }],
    },
  };
}

function orientationText(): PaperRenderTextNode {
  const fill = { kind: 'gray' as const, gray: 0, tint: 1 };
  const node = spotText('PANTONE 185 C');
  return {
    ...node,
    objectId: 'orientation-text',
    sourceFrameId: 'orientation-text',
    paints: {
      runs: [
        { lineIndex: 0, runIndex: 0, fill },
        { lineIndex: 0, runIndex: 1, fill },
      ],
      paragraphBoxes: [],
      emphasisMarks: [fill, fill, fill, fill],
    },
    composed: {
      ...node.composed,
      frameId: 'orientation-text',
      writingMode: 'vertical-rl',
      lines: [{
        ...node.composed.lines[0],
        text: 'AB',
        runs: [
          {
            ...node.composed.lines[0].runs[0],
            text: 'A',
            sourceEnd: 1,
          },
          {
            ...node.composed.lines[0].runs[0],
            text: 'B',
            sourceStart: 1,
            sourceEnd: 2,
            glyphRotationDeg: 90,
            glyphs: [{ glyphId: 2, cluster: 1, xAdvance: 7, yAdvance: 0, xOffset: 0, yOffset: 0, xPt: 30, yPt: 25 }],
          },
        ],
      }],
      emphasisMarks: [
        { xPt: 50, yPt: 20, radiusPt: 1, color: { kind: 'css-color', color: '#111111' }, style: 'dot' },
        { xPt: 55, yPt: 20, radiusPt: 1, color: { kind: 'css-color', color: '#111111' }, style: 'open-dot' },
        { xPt: 60, yPt: 20, radiusPt: 1, color: { kind: 'css-color', color: '#111111' }, style: 'sesame' },
        { xPt: 65, yPt: 20, radiusPt: 1.25, color: { kind: 'css-color', color: '#111111' }, style: 'circle' },
      ],
    },
  };
}

function nativeContext(pdf: PDFDocument, standard: 'pdf-x-1a' | 'pdf-x-4' = 'pdf-x-4'): PaperPdfxNativeContext {
  return {
    standard,
    mediaHeightPt: 100,
    transform: {
      kind: 'icc',
      profileName: 'test',
      rgbToCmyk: ({ r, g, b }) => ({ c: 100 - r / 2.55, m: 100 - g / 2.55, y: 100 - b / 2.55, k: 0 }),
    },
    loadManagedFontBytes: async () => liberationSerif,
    fontCache: new Map(),
    spotDefinitions: new Map(),
    pdf,
  };
}

async function decodedPageContent(bytes: Uint8Array): Promise<string> {
  const loaded = await PDFDocument.load(bytes);
  const page = loaded.getPages()[0];
  const contents = page.node.Contents();
  if (!contents) return '';
  if (!(contents instanceof PDFArray)) return '';
  const streams = contents.asArray();
  return streams.map((ref) => {
    const stream = loaded.context.lookup(ref) as unknown as PDFRawStream;
    return Buffer.from(inflateSync(Buffer.from(stream.contents))).toString('latin1');
  }).join('\n');
}

describe('appendPaperNativeContent', () => {
  it('writes exact process CMYK operands and real overprint state', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    const evidence = await appendPaperNativeContent(pdf, page, [path({ kind: 'process-cmyk', c: 0.12, m: 0.34, y: 0.56, k: 0.78, tint: 1 }, true)], nativeContext(pdf));
    const bytes = await pdf.save({ useObjectStreams: false });

    expect(await decodedPageContent(bytes)).toMatch(/0\.12 0\.34 0\.56 0\.78 k/);
    expect(await decodedPageContent(bytes)).toMatch(/\/GSOP1 gs/);
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/OP true/);
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/op true/);
    expect(evidence.processObjectIds).toEqual(['path-1']);
    expect(evidence.overprintObjectIds).toEqual(['path-1']);
  });

  it('keeps rich spot text on one named plate and embeds its managed face', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    const evidence = await appendPaperNativeContent(pdf, page, [spotText('PANTONE 185 C')], nativeContext(pdf));
    const bytes = await pdf.save({ useObjectStreams: false });

    expect(Buffer.from(bytes).toString('latin1')).toContain('/Separation');
    expect(Buffer.from(bytes).toString('latin1')).toContain('PANTONE#20185#20C');
    expect(Buffer.from(bytes).toString('latin1')).toContain('/FontFile2');
    expect(evidence.spotPlates).toEqual([{ name: 'PANTONE 185 C', objectIds: ['rich-spot'] }]);
    expect(evidence.embeddedFontIds).toEqual(['managed-serif']);
  });

  it('flips the page coordinates without inverting the managed font outline', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    await appendPaperNativeContent(pdf, page, [spotText('PANTONE 185 C')], nativeContext(pdf));

    // A font's glyph space is already y-up. Only the authored page coordinates need Canvas y-down -> PDF
    // y-up conversion, so the text matrix must keep a positive d scale for an unrotated text frame.
    expect(await decodedPageContent(await pdf.save({ useObjectStreams: false })))
      .toMatch(/1 0 0 1 10 75 Tm/);
  });

  it('writes mixed vertical rotation and distinct emphasis paths into native PDF operators', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    await appendPaperNativeContent(pdf, page, [orientationText()], nativeContext(pdf));

    const content = await decodedPageContent(await pdf.save({ useObjectStreams: false }));
    expect(content).toMatch(/1 0 0 1 10 75 Tm/);
    expect(content).toMatch(/0 -1 1 0 30 75 Tm/);
    expect(content).toMatch(/0\.35 w/);
    expect(content).toMatch(/S\n/);
    expect(content.match(/ c\n/g)).toHaveLength(14);
  });

  it('rejects an ambiguous spot name with more than one alternate CMYK recipe', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    const context = nativeContext(pdf);
    await appendPaperNativeContent(pdf, page, [spotText('PANTONE 185 C')], context);

    await expect(appendPaperNativeContent(pdf, page, [spotText('PANTONE 185 C', { c: 0, m: 0.8, y: 0.85, k: 0 })], context))
      .rejects.toThrow(/different alternate/i);
  });

  it('allows supported opacity in PDF/X-4 and rejects live transparency in PDF/X-1a', async () => {
    const translucent = { ...path({ kind: 'gray', gray: 1, tint: 1 }), opacity: 0.5 };
    const x4 = await PDFDocument.create();
    await appendPaperNativeContent(x4, x4.addPage([100, 100]), [translucent], nativeContext(x4, 'pdf-x-4'));
    expect(Buffer.from(await x4.save({ useObjectStreams: false })).toString('latin1')).toMatch(/\/ca 0\.5/);

    const x1a = await PDFDocument.create();
    await expect(appendPaperNativeContent(x1a, x1a.addPage([100, 100]), [translucent], nativeContext(x1a, 'pdf-x-1a')))
      .rejects.toThrow(/PDF\/X-1a.*transparency/i);
  });

  it('keeps an opaque fill-only process path valid for PDF/X-1a', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    await expect(appendPaperNativeContent(
      pdf,
      page,
      [path({ kind: 'process-cmyk', c: 0.1, m: 0.2, y: 0.3, k: 0.4, tint: 1 })],
      nativeContext(pdf, 'pdf-x-1a'),
    )).resolves.toMatchObject({ processObjectIds: ['path-1'] });
  });
});
