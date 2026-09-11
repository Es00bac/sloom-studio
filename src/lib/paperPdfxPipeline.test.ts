import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup, updatePaperFrame } from './paperDocument';
import { addPaperPage } from './paperDocument';
import type { PaperSwatch } from './paperSwatches';
import {
  exportPaperDocumentToPdfx,
  type PaperPdfxPipelineDeps,
  type RasterizePageOptions,
} from './paperPdfxPipeline';
import { validatePaperPdfx } from './paperPdfxValidate';
import { createRgbToCmykTransform } from './paperIccEngine';
import type { PaperOutputProfileResolution } from './paperManagedIccProfiles';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const FOGRA39_ASSET_ID = `sha256:${'a'.repeat(64)}` as BinaryAssetId;
const exactFogra39Profile: Extract<PaperOutputProfileResolution, { status: 'ready' }> = {
  status: 'ready',
  profile: {
    id: FOGRA39_ASSET_ID,
    asset: { id: FOGRA39_ASSET_ID, sha256: 'a'.repeat(64), mimeType: 'application/vnd.iccprofile', byteLength: fogra39.byteLength },
    description: 'ISO Coated v2 300% (ECI)',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    source: { kind: 'user-import' },
  },
  bytes: fogra39,
};

// Deterministic synthetic rasterizer (no canvas needed): opaque mid-gray page at a small size.
function stubRaster(widthPx = 48, heightPx = 64) {
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (let i = 0; i < widthPx * heightPx; i += 1) {
    rgba[i * 4] = 128; rgba[i * 4 + 1] = 64; rgba[i * 4 + 2] = 32; rgba[i * 4 + 3] = 255;
  }
  return { rgba, widthPx, heightPx };
}

function deps(): PaperPdfxPipelineDeps {
  return {
    rasterizePage: async () => stubRaster(),
    createTransform: (bytes) => createRgbToCmykTransform(bytes, { intent: 'relative' }),
  };
}

async function decodedPageContent(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPages()[0]?.node.Contents();
  if (!(contents instanceof PDFArray)) return '';
  return contents.asArray().map((reference) => {
    const stream = pdf.context.lookup(reference) as unknown as PDFRawStream;
    return Buffer.from(inflateSync(Buffer.from(stream.contents))).toString('latin1');
  }).join('\n');
}

function fullPageImageSelectionRaster(): { rgba: Uint8Array; widthPx: number; heightPx: number } {
  const widthPx = 1000;
  const heightPx = 1000;
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (let y = 200; y < 500; y += 1) {
    for (let x = 100; x < 600; x += 1) {
      const offset = (y * widthPx + x) * 4;
      rgba[offset] = 32;
      rgba[offset + 1] = 96;
      rgba[offset + 2] = 192;
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, widthPx, heightPx };
}

describe('paperPdfxPipeline', () => {
  it('exports a real multi-page PDF/X-4 from a PaperDocument', async () => {
    let document = createDefaultPaperDocument({ title: 'Pipeline test', preset: 'us-letter' });
    document = addPaperPage(document); // 2 pages

    const result = await exportPaperDocumentToPdfx(
      document,
      { standard: 'pdf-x-4', outputProfile: exactFogra39Profile, outputDpi: 150 },
      deps(),
    );

    expect(result.pageCount).toBe(2);
    expect(result.approximateColor).toBe(false);
    const report = await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' });
    expect(report.pass, JSON.stringify(report.checks.filter((c) => !c.pass))).toBe(true);
  });

  it('deliberately flattens a KDP page without requiring managed text faces or retaining live opacity', async () => {
    let document = createDefaultPaperDocument({ title: 'KDP flattened page', preset: 'us-letter' });
    const added = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      text: 'Browser text becomes process CMYK pixels',
      opacity: 0.65,
      typography: { fontFamily: 'Unmanaged Display', fontSizePt: 24 },
    });
    document = added.document;
    document = {
      ...document,
      printProduction: {
        ...document.printProduction,
        marks: {
          ...document.printProduction.marks,
          registrationMarks: true,
          colorBars: true,
          slugAreaMm: 12,
        },
        jobInfo: {
          ...document.printProduction.jobInfo,
          jobName: 'KDP proof controls',
        },
      },
    };
    const seen: Array<{ pageId: string; dpi: number; options?: RasterizePageOptions }> = [];
    const result = await exportPaperDocumentToPdfx(
      document,
      {
        standard: 'pdf-x-1a',
        outputProfile: exactFogra39Profile,
        outputDpi: 300,
        flattenAllPages: true,
      },
      {
        ...deps(),
        rasterizePage: async (pageId, dpi, options) => {
          seen.push({ pageId, dpi, options });
          return stubRaster();
        },
      },
    );

    expect(seen).toEqual([{
      pageId: document.pages[0].id,
      dpi: 300,
      options: { includePageBackground: true },
    }]);
    expect(result.nativeEvidence.flattenedObjectIds).toEqual([{
      objectId: `kdp-page-flatten:${document.pages[0].id}`,
      reasons: ['kdp-full-page-flatten'],
    }]);
    expect(result.nativeEvidence.embeddedFontIds).toEqual([]);
    expect(result.nativeEvidence.processObjectIds.filter((id) => id.startsWith('production:'))).toHaveLength(21);
    expect(result.nativeEvidence.overprintObjectIds.filter((id) => id.startsWith('production:registration:'))).toHaveLength(12);
    const report = await validatePaperPdfx(result.bytes, { standard: 'pdf-x-1a' });
    expect(report.pass, JSON.stringify(report.checks.filter((check) => !check.pass))).toBe(true);
  });

  it('emits a real /Separation spot plate end-to-end without a page-wide raster', async () => {
    let document = createDefaultPaperDocument({ title: 'Spot pipeline', preset: 'us-letter' });
    const spot: PaperSwatch = { id: 'sw-spot', name: 'Brand', type: 'spot', model: 'cmyk', spotName: 'PANTONE 185 C', rgb: { r: 227, g: 6, b: 19 }, cmyk: { c: 0, m: 90, y: 85, k: 0 } };
    document = { ...document, swatches: [spot], printProduction: { ...document.printProduction, spotColorPolicy: 'preserve-named' } };
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, { kind: 'panel', xMm: 20, yMm: 20, widthMm: 60, heightMm: 40, strokeWidthMm: 0, strokeColor: 'transparent', cornerRadiusMm: 0 });
    document = updatePaperFrame(added.document, pageId, added.frameId, { fillColor: '#e30613', fillSwatchId: 'sw-spot' });

    const seen: (RasterizePageOptions | undefined)[] = [];
    const spyDeps: PaperPdfxPipelineDeps = { ...deps(), rasterizePage: async (_id, _dpi, opts) => { seen.push(opts); return stubRaster(); } };

    const result = await exportPaperDocumentToPdfx(document, { standard: 'pdf-x-4', outputProfile: exactFogra39Profile, outputDpi: 150 }, spyDeps);

    // Native spot paint does not need the legacy page raster at all.
    expect(seen).toEqual([]);
    // The exported PDF carries a real /Separation plate for the colorant.
    const raw = Buffer.from(result.bytes).toString('latin1');
    expect(raw).toContain('/Separation');
    expect(raw).toContain('PANTONE#20185#20C');
    const report = await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' });
    expect(report.pass, JSON.stringify(report.checks.filter((c) => !c.pass))).toBe(true);
  });

  it('rasterizes only a stroked-text flatten group and stays valid PDF/X-4', async () => {
    let document = createDefaultPaperDocument({ title: 'Outline pipeline', preset: 'us-letter' });
    const pageId = document.pages[0].id;
    // A stroked caption is otherwise vector-safe → outlined (filled + stroked curves), not rasterized.
    const added = addFrameToPaperPage(document, pageId, {
      kind: 'caption', xMm: 20, yMm: 20, widthMm: 80, heightMm: 30, text: 'BOOM',
      textStrokeWidthMm: 0.6, textStrokeColor: '#ffffff',
      typography: { fontFamily: 'Georgia, serif', fontSizePt: 28, color: '#000000' },
    });
    document = added.document;

    const seen: (RasterizePageOptions | undefined)[] = [];
    const spyDeps: PaperPdfxPipelineDeps = {
      ...deps(),
      rasterizePage: async (_id, _dpi, opts) => { seen.push(opts); return stubRaster(); },
    };
    const result = await exportPaperDocumentToPdfx(document, { standard: 'pdf-x-4', outputProfile: exactFogra39Profile, outputDpi: 150 }, spyDeps);

    // The native plan identifies only the decorated frame as a raster boundary.
    expect(seen[0]?.renderFrameIds).toEqual([added.frameId]);
    expect(seen[0]?.includePageBackground).toBe(false);
    // The exported file is still a conformant PDF/X-4.
    const report = await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' });
    expect(report.pass, JSON.stringify(report.checks.filter((c) => !c.pass))).toBe(true);
  });

  it('crops a page-sized managed-image selection and emits it at the frame bounds', async () => {
    let document = createDefaultPaperDocument({ title: 'Placed image pipeline', preset: 'custom' });
    document = updatePaperDocumentSetup(document, { widthMm: 100, heightMm: 100, bleedMm: 0 });
    const pageId = document.pages[0].id;
    const asset = {
      id: `sha256:${'b'.repeat(64)}` as BinaryAssetId,
      sha256: 'b'.repeat(64),
      mimeType: 'image/png',
      byteLength: 12,
    };
    const added = addFrameToPaperPage(document, pageId, {
      kind: 'image', xMm: 10, yMm: 20, widthMm: 50, heightMm: 30,
      fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0,
      asset: {
        label: 'Managed image', kind: 'image', pixelWidth: 500, pixelHeight: 300,
        locator: { kind: 'managed', ref: asset },
      },
    });

    const result = await exportPaperDocumentToPdfx(
      added.document,
      { standard: 'pdf-x-4', outputProfile: exactFogra39Profile, outputDpi: 300 },
      {
        ...deps(),
        rasterizePage: async () => fullPageImageSelectionRaster(),
      },
    );

    const content = await decodedPageContent(result.bytes);
    // 50x30 mm at (10,20) mm on a 100x100 mm page: the image must not receive the full-media matrix.
    expect(content).toMatch(/141\.732[0-9]* 0 0 85\.039[0-9]* 28\.346[0-9]* 141\.732[0-9]* cm\s*\/Fg-[0-9]+ Do/);
  });

  it('rejects PDF/X export when no exact managed profile is resolved', async () => {
    const document = createDefaultPaperDocument({ title: 'Missing managed profile', preset: 'us-letter' });

    await expect(exportPaperDocumentToPdfx(document, { standard: 'pdf-x-4', outputDpi: 150 }, deps())).rejects.toThrow(/exact managed CMYK output profile/i);
  });
});
