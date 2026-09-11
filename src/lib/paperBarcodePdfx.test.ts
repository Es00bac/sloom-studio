import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PaperDocument, PaperManagedFontFace, PaperManagedIccProfile } from '../types/paper';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from './paperDocument';
import { exportValidatedPaperPdfx, type ExportValidatedPaperPdfxDependencies } from './paperProductionPreflight';
import { exportPaperDocumentToPdfx } from './paperPdfxPipeline';
import { validatePaperPdfx } from './paperPdfxValidate';
import { createRgbToCmykTransform } from './paperIccEngine';
import { paperBarcodeSymbolSizeMm } from './paperBarcode';
import type { PdfxStandard } from './paperPdfxExport';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const liberationSerif = new Uint8Array(readFileSync('public/fonts/liberation/LiberationSerif-Regular.ttf'));
const liberationSerifSha = createHash('sha256').update(liberationSerif).digest('hex');
const FIXED_CREATED_AT = new Date('2026-08-26T00:00:00Z');
const FIXED_DOCUMENT_ID = '00112233445566778899aabbccddeeff';
const HRI_FONT_FAMILY = 'Liberation Serif';

function liberationFace(): PaperManagedFontFace {
  return {
    id: `sha256:${liberationSerifSha}`,
    familyId: HRI_FONT_FAMILY,
    familyName: HRI_FONT_FAMILY,
    postscriptName: 'LiberationSerif',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x0, end: 0x10ffff }],
    format: 'truetype',
    fontAsset: {
      id: `sha256:${liberationSerifSha}`,
      sha256: liberationSerifSha,
      mimeType: 'font/ttf',
      byteLength: liberationSerif.byteLength,
    },
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

function barcodeDocument(options: { showHumanReadable: boolean; withManagedFace?: boolean }): { document: PaperDocument; frameId: string } {
  const profileSha = 'f'.repeat(64);
  const profile: PaperManagedIccProfile = {
    id: `sha256:${profileSha}`,
    asset: { id: `sha256:${profileSha}`, sha256: profileSha, mimeType: 'application/vnd.iccprofile', byteLength: fogra39.length },
    description: 'Coated FOGRA39 (ISO 12647-2:2004)',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    registryName: 'http://www.color.org',
    source: { kind: 'user-import' },
  };
  let document = createDefaultPaperDocument({ title: 'Barcode PDF/X', preset: 'a4', dpi: 300 });
  document = updatePaperDocumentSetup(document, {
    bleedMm: 3,
    printProduction: {
      pdfStandard: 'pdf-x-4',
      outputIntentProfileId: 'custom',
      outputIntentProfileAssetId: profile.id,
      customOutputIntentName: 'FOGRA39',
      totalInkLimitPercent: 300,
      spotColorPolicy: 'preserve-named',
    },
    managedIccProfiles: [profile],
  });
  const nominal = paperBarcodeSymbolSizeMm(1, options.showHumanReadable);
  const added = addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'barcode',
    label: 'Cover ISBN',
    xMm: 40,
    yMm: 200,
    widthMm: nominal.widthMm,
    heightMm: nominal.heightMm,
    typography: { fontFamily: HRI_FONT_FAMILY },
    barcode: { symbology: 'ean13', value: '9780306406157', showHumanReadable: options.showHumanReadable },
  });
  return {
    document: options.withManagedFace
      ? { ...added.document, importedFonts: [liberationFace()] }
      : added.document,
    frameId: added.frameId,
  };
}

function deps(standard: PdfxStandard, download: (bytes: Uint8Array) => void | Promise<void>): ExportValidatedPaperPdfxDependencies {
  return {
    standard,
    requiredPpi: 300,
    generate: (frozenDocument) => exportPaperDocumentToPdfx(
      frozenDocument,
      {
        standard,
        outputDpi: 300,
        outputProfile: {
          status: 'ready',
          profile: frozenDocument.managedIccProfiles![0],
          bytes: fogra39,
        },
        title: 'Barcode PDF/X',
        createdAt: FIXED_CREATED_AT,
        documentId: FIXED_DOCUMENT_ID,
      },
      {
        createTransform: () => createRgbToCmykTransform(fogra39, { intent: 'relative' }),
        loadManagedFontBytes: async (assetRef) => {
          if (assetRef.sha256 !== liberationSerifSha) throw new Error(`Unexpected font asset ${assetRef.id}.`);
          return liberationSerif;
        },
        rasterizePage: async () => {
          throw new Error('A barcode-only document must never enter the raster path.');
        },
      },
    ),
    validate: (bytes, options) => validatePaperPdfx(bytes, options),
    download,
  };
}

describe('barcode PDF/X export', () => {
  it('exports a valid ISBN barcode with human-readable digits as native vector objects and passes PDF/X validation', async () => {
    const { document, frameId } = barcodeDocument({ showHumanReadable: true, withManagedFace: true });
    const saved: Uint8Array[] = [];
    const result = await exportValidatedPaperPdfx(document, deps('pdf-x-4', (bytes) => {
      saved.push(new Uint8Array(bytes));
    }));

    expect(result.status, result.status === 'blocked' ? JSON.stringify(result.issues) : '').toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.report.blockers).toEqual([]);
    expect(result.report.processObjects).toContain(frameId);
    expect(result.report.processObjects).toContain(`${frameId}:barcode`);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(result.bytes);
    expect(result.bytes.length).toBeGreaterThan(500);
  }, 30_000);

  it('is byte-stable across repeated exports', async () => {
    const { document } = barcodeDocument({ showHumanReadable: true, withManagedFace: true });
    const first = await exportValidatedPaperPdfx(document, deps('pdf-x-4', () => undefined));
    const second = await exportValidatedPaperPdfx(document, deps('pdf-x-4', () => undefined));

    expect(first.status).toBe('saved');
    expect(second.status).toBe('saved');
    if (first.status !== 'saved' || second.status !== 'saved') return;
    expect(first.bytes).toEqual(second.bytes);
  }, 30_000);

  it('blocks the strict export when the digits are shown without an exact managed face', async () => {
    const { document } = barcodeDocument({ showHumanReadable: true });
    const result = await exportValidatedPaperPdfx(document, deps('pdf-x-4', () => undefined));

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    const fontBlockers = result.issues.filter((issue) => issue.code === 'MISSING_MANAGED_FONT' || issue.code === 'MISSING_MANAGED_GLYPH');
    expect(fontBlockers.length).toBeGreaterThan(0);
    expect(fontBlockers.some((issue) => issue.objectId?.includes(':barcode-hri-') || issue.message.includes(':barcode-hri-'))).toBe(true);
    expect(fontBlockers.every((issue) => issue.fixAction === 'manage-font')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'BARCODE_HRI_HIDDEN')).toBe(false);
  }, 30_000);

  it('blocks the strict export when the human-readable digits are hidden', async () => {
    const { document } = barcodeDocument({ showHumanReadable: false });
    const result = await exportValidatedPaperPdfx(document, deps('pdf-x-4', () => undefined));

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.issues.some((issue) => issue.code === 'BARCODE_HRI_HIDDEN')).toBe(true);
  }, 30_000);
});
