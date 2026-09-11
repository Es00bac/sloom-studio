import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { buildPaperPdfx, type PdfxNativePage, type PdfxRasterPage, type PdfxStandard } from './paperPdfxExport';
import { validatePaperPdfx } from './paperPdfxValidate';
import { createRgbToCmykTransform } from './paperIccEngine';
import { APPROXIMATE_CMYK_TRANSFORM, type IccCmykTransform } from './paperColorManagement';
import { buildPaperPrintSheetPlan } from './paperPrintMarks';

/** Inflate the first DeviceCMYK image stream in a PDF back to raw 8-bit CMYK samples. */
async function readDeviceCmykImage(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const loaded = await PDFDocument.load(bytes);
  for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const cs = obj.dict.get(PDFName.of('ColorSpace'));
      if (cs && cs.toString() === '/DeviceCMYK') {
        return new Uint8Array(inflateSync(Buffer.from(obj.contents)));
      }
    }
  }
  return undefined;
}

async function decodedPdfPageContent(bytes: Uint8Array): Promise<string> {
  const loaded = await PDFDocument.load(bytes);
  const contents = loaded.getPages()[0]?.node.Contents();
  if (!contents || !(contents instanceof PDFArray)) return '';
  return contents.asArray().map((ref) => {
    const stream = loaded.context.lookup(ref) as unknown as PDFRawStream;
    return Buffer.from(inflateSync(Buffer.from(stream.contents))).toString('latin1');
  }).join('\n');
}

/** A transform that paints every pixel at 400% TAC — so ink-limit clamping is observable. */
const MAX_INK_TRANSFORM = {
  kind: 'icc',
  profileName: 'max-ink',
  rgbToCmyk: () => ({ c: 100, m: 100, y: 100, k: 100 }),
  transformRgbBuffer: (_rgb: Uint8Array, pixelCount: number) => new Uint8Array(pixelCount * 4).fill(255),
} as unknown as IccCmykTransform;

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

// A synthetic page: red band / white band / black band, fully opaque. Exercises real CMYK conversion.
function makePage(pageNumber: number, w = 96, h = 96): PdfxRasterPage {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      let r = 255, g = 255, b = 255;
      if (y < h / 3) { r = 255; g = 0; b = 0; }          // red
      else if (y >= (2 * h) / 3) { r = 0; g = 0; b = 0; } // black
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  // 3in × 3in trim (216pt) with 9pt (0.125") bleed.
  return { pageNumber, rgba, widthPx: w, heightPx: h, trimWidthPt: 216, trimHeightPt: 216, bleedPt: 9 };
}

async function fograTransform() {
  return createRgbToCmykTransform(fogra39, { intent: 'relative' });
}

async function withFograTransform<T>(work: (transform: IccCmykTransform) => Promise<T>): Promise<T> {
  const transform = await fograTransform();
  try {
    return await work(transform);
  } finally {
    transform.dispose?.();
  }
}

const profile = {
  iccBytes: fogra39,
  outputConditionIdentifier: 'FOGRA39',
  outputCondition: 'Coated FOGRA39 (ISO 12647-2:2004)',
};

describe('buildPaperPdfx', () => {
  it.each<PdfxStandard>(['pdf-x-1a', 'pdf-x-4'])('produces a structurally conformant %s', async (standard) => {
    return withFograTransform(async (transform) => {
    const result = await buildPaperPdfx([makePage(1), makePage(2)], {
      standard,
      profile,
      transform,
      title: 'Sloom Studio print test',
      author: 'Sloom Studio',
      docId: '0123456789abcdef0123456789abcdef',
      createdAt: new Date('2026-07-06T00:00:00Z'),
    });

    expect(result.pageCount).toBe(2);
    expect(result.approximateColor).toBe(false);

    const report = await validatePaperPdfx(result.bytes, { standard });
    const failed = report.checks.filter((c) => !c.pass).map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ''}`);
    expect(failed, `failed checks: ${failed.join('; ')}`).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.standard).toBe(standard);

    const otherStandard = standard === 'pdf-x-1a' ? 'pdf-x-4' : 'pdf-x-1a';
    expect((await validatePaperPdfx(result.bytes, { standard: otherStandard })).checks).toContainEqual(
      expect.objectContaining({ id: 'metadata-standard', pass: false }),
    );

    // Dump artifacts for external verification (gs/pdfinfo/veraPDF) when requested.
    const outDir = process.env.SLOOM_PDFX_OUT;
    if (outDir) writeFileSync(`${outDir}/sloom-${standard}.pdf`, result.bytes);
    });
  });

  it('blocks an over-limit CMYK raster instead of silently applying UCR', async () => {
    const base = { standard: 'pdf-x-4' as const, profile, transform: MAX_INK_TRANSFORM, docId: '0123456789abcdef0123456789abcdef' };
    // Without a limit the 400% paint survives to the file.
    const unlimited = await buildPaperPdfx([makePage(1, 8, 8)], base);
    const rawUnlimited = await readDeviceCmykImage(unlimited.bytes);
    expect(rawUnlimited).toBeDefined();
    expect(rawUnlimited![0] + rawUnlimited![1] + rawUnlimited![2] + rawUnlimited![3]).toBe(1020);

    // A press ceiling is a blocker; export never mutates the authored CMYK recipe.
    await expect(buildPaperPdfx([makePage(1, 8, 8)], { ...base, totalInkLimitPercent: 280 }))
      .rejects.toThrow(/400.*280/i);
  });

  it('can correct a single converted-byte TAC overshoot without masking real excess', async () => {
    const oneStepTransform = {
      ...MAX_INK_TRANSFORM,
      transformRgbBuffer: (_rgb: Uint8Array, pixelCount: number) => {
        const output = new Uint8Array(pixelCount * 4);
        for (let index = 0; index < pixelCount; index += 1) {
          output.set([255, 255, 255, 1], index * 4);
        }
        return output;
      },
    };
    const base = {
      standard: 'pdf-x-1a' as const,
      profile,
      transform: oneStepTransform,
      totalInkLimitPercent: 300,
      docId: '0123456789abcdef0123456789abcdef',
    };

    await expect(buildPaperPdfx([makePage(1, 8, 8)], base)).rejects.toThrow(/300\.392.*300/i);
    const corrected = await buildPaperPdfx([makePage(1, 8, 8)], {
      ...base,
      correctOneStepInkQuantization: true,
    });
    const cmyk = await readDeviceCmykImage(corrected.bytes);
    expect(cmyk).toBeDefined();
    expect(cmyk![0] + cmyk![1] + cmyk![2] + cmyk![3]).toBe(765);
  });

  it('marks output approximate when using the non-ICC transform (still structurally valid)', async () => {
    const result = await buildPaperPdfx([makePage(1)], {
      standard: 'pdf-x-4',
      profile,
      transform: APPROXIMATE_CMYK_TRANSFORM,
      docId: '0123456789abcdef0123456789abcdef',
    });
    expect(result.approximateColor).toBe(true);
    const report = await validatePaperPdfx(result.bytes);
    expect(report.pass).toBe(true);
  });

  it('rejects an empty document', async () => {
    return withFograTransform(async (transform) => {
      await expect(buildPaperPdfx([], { standard: 'pdf-x-4', profile, transform })).rejects.toThrow();
    });
  });

  it('emits a spot fill as a real /Separation plate and stays valid PDF/X', async () => {
    return withFograTransform(async (transform) => {
    const page = { ...makePage(1, 32, 32), spotFills: [
      { name: 'PANTONE 185 C', cmyk: { c: 0, m: 0.9, y: 0.85, k: 0 }, tint: 1, xPt: 20, yTopPt: 20, widthPt: 100, heightPt: 100 },
    ] };
    const result = await buildPaperPdfx([page], { standard: 'pdf-x-4', profile, transform, docId: '0123456789abcdef0123456789abcdef' });

    // The named colorant survives as a Separation colorspace (verified externally with gs tiffsep →
    // a "PANTONE 185 C" plate); the PDF name body escapes the spaces so RIPs read the colorant.
    const raw = Buffer.from(result.bytes).toString('latin1');
    expect(raw).toContain('/Separation');
    expect(raw).toContain('PANTONE#20185#20C');

    // Adding the spot colorspace + fill must not break PDF/X conformance.
    const report = await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' });
    expect(report.pass, report.checks.filter((c) => !c.pass).map((c) => c.label).join('; ')).toBe(true);
    });
  });

  it('writes a typed native render-plan page without creating a page-wide CMYK raster', async () => {
    return withFograTransform(async (transform) => {
    const nativePage: PdfxNativePage = {
      trimWidthPt: 144,
      trimHeightPt: 144,
      bleedPt: 0,
      loadManagedFontBytes: async () => {
        throw new Error('This fixture has no text.');
      },
      renderPlanPage: {
        pageId: 'native-page',
        pageNumber: 1,
        trimWidthPt: 144,
        trimHeightPt: 144,
        bleedPt: 0,
        nodes: [{
          kind: 'path',
          objectId: 'native-cmyk',
          path: 'M 0 0 L 30 0 L 30 30 L 0 30 Z',
          fill: { kind: 'process-cmyk', c: 0.12, m: 0.34, y: 0.56, k: 0.78, tint: 1 },
          opacity: 1,
          fillOpacity: 1,
          strokeOpacity: 0,
          strokeWidthPt: 0,
          strokeStyle: 'solid',
          overprint: true,
          boundsPt: { x: 0, y: 0, width: 30, height: 30 },
        }],
      },
    };
    const result = await buildPaperPdfx([nativePage], {
      standard: 'pdf-x-4', profile, transform, docId: '0123456789abcdef0123456789abcdef',
    });
    const streams = await decodedPdfPageContent(result.bytes);

    expect(streams).toMatch(/0\.12 0\.34 0\.56 0\.78 k/);
    expect(streams).toMatch(/\/GSOP1 gs/);
    expect(result.nativeEvidence.processObjectIds).toEqual(['native-cmyk']);
    expect(result.nativeEvidence.overprintObjectIds).toEqual(['native-cmyk']);
    expect(await readDeviceCmykImage(result.bytes)).toBeUndefined();
    expect((await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' })).pass).toBe(true);
    });
  });

  it('uses canonical expanded boxes and emits crop marks as native 100K paths', async () => {
    return withFograTransform(async (transform) => {
      const sheet = buildPaperPrintSheetPlan(
        { widthMm: 100, heightMm: 150, bleedMm: 3 },
        { marks: { cropMarks: true, cropMarkLengthMm: 5, cropMarkOffsetMm: 2, cropMarkStrokePt: 0.25, registrationMarks: false, colorBars: false, slugAreaMm: 12 } },
      );
      const productionMarks = sheet.cropMarks.map((mark) => ({
        kind: 'path' as const,
        objectId: `production:${mark.id}`,
        path: `M ${mark.x1Pt} ${mark.y1TopPt} L ${mark.x2Pt} ${mark.y2TopPt}`,
        stroke: { kind: 'process-cmyk' as const, c: 0, m: 0, y: 0, k: 1, tint: 1 },
        opacity: 1,
        fillOpacity: 0,
        strokeOpacity: 1,
        strokeWidthPt: mark.strokeWidthPt,
        strokeStyle: 'solid' as const,
        overprint: false,
        boundsPt: { x: 0, y: 0, width: 1, height: 1 },
      }));
      const nativePage: PdfxNativePage = {
        trimWidthPt: sheet.trimBox.widthPt,
        trimHeightPt: sheet.trimBox.heightPt,
        bleedPt: 3 * 72 / 25.4,
        loadManagedFontBytes: async () => { throw new Error('This fixture has no text.'); },
        flattenedGroups: [{
          objectId: 'flattened-origin',
          rgba: Uint8Array.from([255, 255, 255, 255]),
          widthPx: 1,
          heightPx: 1,
        }],
        renderPlanPage: {
          pageId: 'marks-page',
          pageNumber: 1,
          trimWidthPt: sheet.trimBox.widthPt,
          trimHeightPt: sheet.trimBox.heightPt,
          bleedPt: 3 * 72 / 25.4,
          printSheet: sheet,
          productionMarks,
          nodes: [{
            kind: 'path',
            objectId: 'authored-origin',
            path: 'M 0 0 L 10 0 L 10 10 L 0 10 Z',
            fill: { kind: 'process-cmyk', c: 0, m: 0, y: 0, k: 0.5, tint: 1 },
            opacity: 1,
            fillOpacity: 1,
            strokeOpacity: 0,
            strokeWidthPt: 0,
            strokeStyle: 'solid',
            overprint: false,
            boundsPt: { x: 0, y: 0, width: 10, height: 10 },
          }, {
            kind: 'flatten-group',
            objectId: 'flattened-origin',
            sourceFrameIds: ['flattened-origin'],
            reasonCodes: ['fixture-raster'],
            boundsPt: { x: 0, y: 0, width: 10, height: 10 },
            children: [],
          }],
        },
      };

      const result = await buildPaperPdfx([nativePage], {
        standard: 'pdf-x-4', profile, transform, docId: '0123456789abcdef0123456789abcdef',
      });
      const loaded = await PDFDocument.load(result.bytes);
      const page = loaded.getPages()[0];
      const stream = await decodedPdfPageContent(result.bytes);

      expect(page.getMediaBox().width).toBeCloseTo(sheet.mediaBox.widthPt, 4);
      expect(page.getMediaBox().height).toBeCloseTo(sheet.mediaBox.heightPt, 4);
      expect(page.getTrimBox()).toMatchObject({
        x: sheet.trimBox.xPt,
        width: sheet.trimBox.widthPt,
        height: sheet.trimBox.heightPt,
      });
      expect(page.getTrimBox().y).toBeCloseTo(
        sheet.mediaBox.heightPt - sheet.trimBox.yTopPt - sheet.trimBox.heightPt,
        4,
      );
      expect(page.getBleedBox()).toMatchObject({
        x: sheet.bleedBox.xPt,
        width: sheet.bleedBox.widthPt,
        height: sheet.bleedBox.heightPt,
      });
      expect(stream).toContain('0 0 0 1 K');
      expect(stream).toContain(`1 0 0 -1 ${sheet.contentOffsetPt.x} ${sheet.mediaBox.heightPt - sheet.contentOffsetPt.y} cm`);
      const contentMediaWidthPt = sheet.bleedBox.widthPt;
      const contentMediaHeightPt = sheet.bleedBox.heightPt;
      const streamLines = stream.split('\n');
      const rasterDrawIndex = streamLines.findIndex((line) => /\/Fg-\d+ Do/.test(line));
      const rasterMatrix = streamLines[rasterDrawIndex - 1]?.split(' ').slice(0, 6).map(Number) ?? [];
      expect(rasterMatrix[0]).toBeCloseTo(contentMediaWidthPt, 4);
      expect(rasterMatrix[3]).toBeCloseTo(contentMediaHeightPt, 4);
      expect(rasterMatrix[4]).toBeCloseTo(sheet.contentOffsetPt.x, 4);
      expect(rasterMatrix[5]).toBeCloseTo(sheet.mediaBox.heightPt - sheet.contentOffsetPt.y - contentMediaHeightPt, 4);
      expect(result.nativeEvidence.processObjectIds).toContain('authored-origin');
      expect(result.nativeEvidence.flattenedObjectIds).toContainEqual({ objectId: 'flattened-origin', reasons: ['fixture-raster'] });
      expect(result.nativeEvidence.processObjectIds.filter((id) => id.startsWith('production:'))).toHaveLength(8);
      expect((await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' })).pass).toBe(true);
    });
  });
});
