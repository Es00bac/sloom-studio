import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  exportPaperDocumentToPrintHtml,
  parsePaperDocument,
  serializePaperDocument,
  updatePaperDocumentSetup,
} from './paperDocument';
import { applyPaperPageContextAction } from './paperUsabilityActions';
import { compilePaperRenderPlan } from './paperRenderPlan';
import { paperBarcodeSymbolSizeMm, PAPER_EAN13_NOMINAL } from './paperBarcode';
import type { PaperManagedFontFace } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperTextShaper } from './paperTextShaper';

function fixtureDocument() {
  return updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Barcode fixture' }), {
    bleedMm: 0,
    background: { type: 'solid', color: 'transparent' },
  });
}

function addBarcodeFrame(
  document: ReturnType<typeof fixtureDocument>,
  overrides: Record<string, unknown> = {},
): { document: ReturnType<typeof fixtureDocument>; frameId: string } {
  const nominal = paperBarcodeSymbolSizeMm(1, true);
  const added = addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'barcode',
    label: 'Cover ISBN',
    xMm: 20,
    yMm: 20,
    widthMm: nominal.widthMm,
    heightMm: nominal.heightMm,
    barcode: { symbology: 'ean13', value: '978-0-306-40615-7', showHumanReadable: true },
    ...overrides,
  });
  return added;
}

function fontRef(): BinaryAssetRef {
  const sha256 = 'b'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function managedFace(): PaperManagedFontFace {
  return {
    id: 'barcode-fixture-regular',
    familyId: 'Barcode Fixture Sans',
    familyName: 'Barcode Fixture Sans',
    postscriptName: 'BarcodeFixtureSans-Regular',
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

function fixtureShaper(): PaperTextShaper {
  return {
    shape(request) {
      const glyphs = Array.from(request.text).map((character, index) => ({
        glyphId: character.codePointAt(0) ?? 1,
        cluster: index,
        xAdvance: request.direction === 'ttb' ? 0 : request.fontSizePt / 2,
        yAdvance: request.direction === 'ttb' ? -request.fontSizePt / 2 : 0,
        xOffset: 0,
        yOffset: 0,
      }));
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

describe('barcode frame persistence', () => {
  it('round-trips the retained barcode spec through serialize/parse without coercion', () => {
    const { document: withBarcode, frameId } = addBarcodeFrame(fixtureDocument());
    const parsed = parsePaperDocument(serializePaperDocument(withBarcode));
    const frame = parsed.pages[0].frames.find((candidate) => candidate.id === frameId);

    expect(frame).toBeDefined();
    expect(frame!.kind).toBe('barcode');
    expect(frame!.barcode).toEqual({ symbology: 'ean13', value: '978-0-306-40615-7', showHumanReadable: true });
  });

  it('defaults a missing barcode payload for barcode frames instead of dropping the kind', () => {
    const { document: withBarcode, frameId } = addBarcodeFrame(fixtureDocument(), { barcode: undefined });
    const parsed = parsePaperDocument(serializePaperDocument(withBarcode));
    const frame = parsed.pages[0].frames.find((candidate) => candidate.id === frameId);

    expect(frame!.kind).toBe('barcode');
    expect(frame!.barcode).toEqual({ symbology: 'ean13', value: '', showHumanReadable: true });
  });

  it('uses nominal EAN-13 geometry and print-safe defaults for new barcode frames', () => {
    const base = fixtureDocument();
    const result = applyPaperPageContextAction(base, base.pages[0].id, 'add-barcode-here', {
      point: { xMm: 20, yMm: 20 },
    });
    const frame = result.document.pages[0].frames.find((candidate) => candidate.kind === 'barcode');
    expect(frame).toBeDefined();
    expect(frame!.widthMm).toBeCloseTo(PAPER_EAN13_NOMINAL.totalModuleCount * PAPER_EAN13_NOMINAL.moduleWidthMm, 5);
    expect(frame!.heightMm).toBeCloseTo(PAPER_EAN13_NOMINAL.symbolHeightMm, 5);
    expect(frame!.fillColor).toBe('#ffffff');
    expect(frame!.strokeColor).toBe('#000000');
    expect(frame!.strokeWidthMm).toBe(0);
    expect(frame!.barcode).toEqual({ symbology: 'ean13', value: '', showHumanReadable: true });
  });
});

describe('barcode print HTML', () => {
  it('renders the encoded bars and human-readable digits as deterministic SVG', () => {
    const { document: withBarcode } = addBarcodeFrame(fixtureDocument());
    const html = exportPaperDocumentToPrintHtml(withBarcode);
    const barcodeFigures = html.match(/<figure class="frame frame-barcode"[^>]*>[\s\S]*?<\/figure>/g);
    expect(barcodeFigures).toHaveLength(1);
    const figure = barcodeFigures![0];
    expect(figure).toContain('viewBox="0 0 113 78.576"');
    // Quiet-zone plate plus every merged bar run plus the three digit groups.
    expect(figure.match(/<rect /g)!.length).toBe(1 + 30);
    expect(figure.match(/<text /g)).toHaveLength(3);
    expect(figure).toContain('>9</text>');
    expect(figure).toContain('>780306</text>');
    expect(figure).toContain('>406157</text>');
    // Guard bars are the taller runs.
    expect(figure).toContain('height="74.242"');

    const secondExport = exportPaperDocumentToPrintHtml(withBarcode);
    expect(secondExport).toBe(html);
  });

  it('paints no bars for an unresolved value, and stays deterministic', () => {
    const { document: invalid } = addBarcodeFrame(fixtureDocument(), {
      barcode: { symbology: 'ean13', value: '9780306406158', showHumanReadable: true },
    });
    const html = exportPaperDocumentToPrintHtml(invalid);
    const figure = html.match(/<figure class="frame frame-barcode"[^>]*>[\s\S]*?<\/figure>/g)![0];
    // Only the quiet-zone plate rect; no bar rects and no digit text.
    expect(figure.match(/<rect /g)).toHaveLength(1);
    expect(figure).not.toContain('<text ');
    expect(exportPaperDocumentToPrintHtml(invalid)).toBe(html);
  });
});

describe('barcode native render plan', () => {
  it('compiles the bars as one native path node with the frame stroke as bar ink', async () => {
    const { document: withBarcode, frameId } = addBarcodeFrame(fixtureDocument(), {
      barcode: { symbology: 'ean13', value: '9780306406157', showHumanReadable: false },
    });
    const plan = await compilePaperRenderPlan(withBarcode);
    const nodes = plan.pages[0].nodes.filter((node) => 'sourceFrameId' in node && node.sourceFrameId === frameId);

    const barNode = nodes.find((node) => node.objectId === `${frameId}:barcode`);
    expect(barNode).toMatchObject({
      kind: 'path',
      fill: { kind: 'managed-rgb', r: 0, g: 0, b: 0, profile: 'srgb' },
      strokeOpacity: 0,
    });
    // Every bar run is one closed rectangle subpath.
    expect((barNode as { path: string }).path.match(/Z/g)).toHaveLength(30);
    // The plate under the symbol comes from the ordinary frame fill node.
    expect(nodes.some((node) => node.kind === 'path' && node.objectId === frameId)).toBe(true);
  });

  it('composes the human-readable digits as managed text nodes in GS1 groups', async () => {
    const face = managedFace();
    const { document: withBarcode, frameId } = addBarcodeFrame({
      ...fixtureDocument(),
      importedFonts: [face],
    }, {
      typography: { fontFamily: face.familyName },
    });
    const plan = await compilePaperRenderPlan(withBarcode, {
      managedFontResolver: async () => fixtureShaper(),
    });
    const textNodes = plan.pages[0].nodes.filter((node) => node.kind === 'text' && node.sourceFrameId === frameId);
    expect(textNodes.map((node) => (node as { objectId: string }).objectId)).toEqual([
      `${frameId}:barcode-hri-0`,
      `${frameId}:barcode-hri-1`,
      `${frameId}:barcode-hri-2`,
    ]);
    const runs = textNodes.flatMap((node) => {
      const composed = (node as { composed: { lines: Array<{ runs: Array<{ text: string }> }> } }).composed.lines
        .flatMap((line) => line.runs.map((run) => run.text));
      return composed;
    });
    expect(runs).toEqual(['9', '780306', '406157']);
  });

  it('reports missing managed faces for the digits through the production font gate', async () => {
    const { document: withBarcode, frameId } = addBarcodeFrame(fixtureDocument());
    const plan = await compilePaperRenderPlan(withBarcode);
    const textNodes = plan.pages[0].nodes.filter((node) => node.kind === 'text' && node.sourceFrameId === frameId);
    expect(textNodes).toHaveLength(3);
    for (const node of textNodes) {
      const missing = (node as { composed: { missingFaces: unknown[] } }).composed.missingFaces;
      expect(missing.length).toBeGreaterThan(0);
    }
  });

  it('compiles identical geometry for identical input (determinism)', async () => {
    const { document: withBarcode } = addBarcodeFrame(fixtureDocument(), {
      barcode: { symbology: 'ean13', value: '4901234567894', showHumanReadable: false },
    });
    const first = await compilePaperRenderPlan(withBarcode);
    const second = await compilePaperRenderPlan(withBarcode);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
