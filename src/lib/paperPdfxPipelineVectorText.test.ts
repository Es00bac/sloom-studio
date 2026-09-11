import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup, updatePaperFrame } from './paperDocument';
import type { PaperDocument, PaperManagedFontFace } from '../types/paper';
import type { PaperSwatch } from './paperSwatches';
import { createBinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { exportPaperDocumentToPdfx, type PaperPdfxPipelineDeps } from './paperPdfxPipeline';
import { createRgbToCmykTransform } from './paperIccEngine';
import { validatePaperPdfx } from './paperPdfxValidate';
import type { BinaryAssetId, BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperOutputProfileResolution } from './paperManagedIccProfiles';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const liberationSerif = new Uint8Array(readFileSync('public/fonts/liberation/LiberationSerif-Regular.ttf'));
const FRAME_TEXT = 'Managed rich text reaches PDF/X';

const exactFogra39Profile: Extract<PaperOutputProfileResolution, { status: 'ready' }> = {
  status: 'ready',
  profile: {
    id: `sha256:${'a'.repeat(64)}` as BinaryAssetId,
    asset: { id: `sha256:${'a'.repeat(64)}` as BinaryAssetId, sha256: 'a'.repeat(64), mimeType: 'application/vnd.iccprofile', byteLength: fogra39.byteLength },
    description: 'ISO Coated v2 300% (ECI)',
    deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ', outputConditionId: 'FOGRA39', source: { kind: 'user-import' },
  },
  bytes: fogra39,
};

function managedFace(ref: BinaryAssetRef): PaperManagedFontFace {
  return {
    id: 'managed-serif', familyId: 'managed serif', familyName: 'Managed Serif', postscriptName: 'ManagedSerif-Regular',
    weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0, variableAxes: {},
    unicodeRanges: [{ start: 0x20, end: 0x7e }], format: 'truetype', fontAsset: ref,
    embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {},
  };
}

async function managedTextDocument(options: { richText?: PaperDocument['pages'][number]['frames'][number]['richText']; colorSwatchId?: string; text?: string } = {}) {
  const record = await createBinaryAssetRecord(liberationSerif, { mimeType: 'font/ttf' });
  let document = createDefaultPaperDocument({ title: 'Managed PDF/X text', preset: 'us-letter' });
  document = updatePaperDocumentSetup(document, { bleedMm: 3 });
  const pageId = document.pages[0].id;
  const added = addFrameToPaperPage(document, pageId, {
    kind: 'text', xMm: 15, yMm: 20, widthMm: 120, heightMm: 60,
    typography: {
      fontFamily: 'Managed Serif', fontSizePt: 14, leadingPt: 18, tracking: 0, hyphenate: false,
      align: 'left', color: '#101010', colorSwatchId: options.colorSwatchId, fontWeight: '400', fontStyle: 'normal',
    },
  });
  document = updatePaperFrame(added.document, pageId, added.frameId, {
    text: options.text ?? FRAME_TEXT,
    richText: options.richText,
  });
  return {
    document: { ...document, importedFonts: [managedFace(record.ref)] },
    frameId: added.frameId,
    fontRef: record.ref,
  };
}

function deps(onRasterize?: () => void): PaperPdfxPipelineDeps {
  return {
    createTransform: (bytes) => createRgbToCmykTransform(bytes, { intent: 'relative' }),
    loadManagedFontBytes: async () => liberationSerif,
    rasterizePage: async () => {
      onRasterize?.();
      throw new Error('Native managed text must not request a page raster.');
    },
  };
}

describe('exportPaperDocumentToPdfx managed text', () => {
  it.each(['pdf-x-1a', 'pdf-x-4'] as const)('embeds the exact content-addressed face for positioned rich text in %s without rasterizing the page', async (standard) => {
    const richText = [{ runs: [{ text: 'Managed ' }, { text: 'rich', fontWeight: '400', color: '#d11c2f', underline: true }, { text: ' text reaches PDF/X' }] }];
    const { document, fontRef } = await managedTextDocument({ richText });
    let rasterized = false;
    const result = await exportPaperDocumentToPdfx(
      document,
      { standard, outputDpi: 144, outputProfile: exactFogra39Profile },
      deps(() => { rasterized = true; }),
    );

    expect(rasterized).toBe(false);
    expect(Buffer.from(result.bytes).toString('latin1')).toContain('/FontFile2');
    expect(result.nativeEvidence.embeddedFontIds).toEqual(['managed-serif']);
    expect(result.nativeEvidence.flattenedObjectIds).toEqual([]);
    expect(document.importedFonts?.[0].fontAsset).toEqual(fontRef);
    expect((await validatePaperPdfx(result.bytes, { standard })).pass).toBe(true);
  });

  it('keeps managed rich spot text on a named Separation plate', async () => {
    const spot: PaperSwatch = {
      id: 'spot-red', name: 'Brand Red', type: 'spot', model: 'cmyk', spotName: 'PANTONE 185 C',
      rgb: { r: 227, g: 6, b: 19 }, cmyk: { c: 0, m: 90, y: 85, k: 0 },
    };
    const fixture = await managedTextDocument({ colorSwatchId: spot.id, text: 'SPOT TYPE' });
    const document = {
      ...fixture.document,
      swatches: [spot],
      printProduction: { ...fixture.document.printProduction, spotColorPolicy: 'preserve-named' as const },
    };
    const result = await exportPaperDocumentToPdfx(document, { standard: 'pdf-x-4', outputDpi: 144, outputProfile: exactFogra39Profile }, deps());

    const raw = Buffer.from(result.bytes).toString('latin1');
    expect(raw).toContain('/Separation');
    expect(raw).toContain('PANTONE#20185#20C');
    expect(result.nativeEvidence.spotPlates).toEqual([{ name: 'PANTONE 185 C', objectIds: [fixture.frameId] }]);
  });

  it('fails closed when a document references an unmanaged browser font', async () => {
    const base = await managedTextDocument();
    const document: PaperDocument = { ...base.document, importedFonts: [] };
    await expect(exportPaperDocumentToPdfx(document, { standard: 'pdf-x-4', outputProfile: exactFogra39Profile }, deps()))
      .rejects.toThrow(/unresolved fonts or glyphs/i);
  });

  it('fails closed for missing glyphs rather than baking browser fallback glyphs into the PDF', async () => {
    const { document } = await managedTextDocument({ text: 'Managed 日本語' });
    await expect(exportPaperDocumentToPdfx(document, { standard: 'pdf-x-4', outputProfile: exactFogra39Profile }, deps()))
      .rejects.toThrow(/unresolved fonts or glyphs/i);
  });
});
