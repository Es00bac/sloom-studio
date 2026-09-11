import { describe, expect, it } from 'vitest';
import { createDefaultPaperDocument, updatePaperDocumentSetup } from './paperDocument';
import {
  PAPER_OUTPUT_INTENT_PROFILES,
  buildPaperPrintProductionMetadata,
  normalizePaperPrintProductionSpec,
} from './paperPrintProduction';

describe('paperPrintProduction', () => {
  it('normalizes browser proof defaults to an sRGB production intent', () => {
    const normalized = normalizePaperPrintProductionSpec();

    expect(normalized).toEqual({
      pdfStandard: 'browser-pdf',
      outputIntentProfileId: 'srgb',
      customOutputIntentName: '',
      totalInkLimitPercent: 300,
      blackPolicy: 'warn-rich-black',
      spotColorPolicy: 'warn',
      overprintPreview: false,
      marks: {
        cropMarks: false,
        cropMarkLengthMm: 5,
        cropMarkOffsetMm: 2,
        cropMarkStrokePt: 0.25,
        registrationMarks: false,
        colorBars: false,
        slugAreaMm: 0,
      },
      jobInfo: {
        jobName: '',
        jobNumber: '',
        client: '',
        author: '',
        notes: '',
      },
    });
    expect(PAPER_OUTPUT_INTENT_PROFILES.srgb.colorSpace).toBe('rgb');
  });

  it('builds press metadata for PDF/X CMYK targets without claiming browser export certification', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Press Book' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'pso-coated-v3-fogra51',
        totalInkLimitPercent: 280,
        blackPolicy: 'force-100k-text',
        spotColorPolicy: 'convert-process',
        overprintPreview: true,
      },
    });

    const metadata = buildPaperPrintProductionMetadata(doc);

    expect(metadata).toEqual(expect.objectContaining({
      pdfStandard: 'pdf-x-4',
      outputIntentProfileId: 'pso-coated-v3-fogra51',
      outputIntentColorSpace: 'cmyk',
      outputIntentLabel: 'PSO Coated v3 / FOGRA51',
      totalInkLimitPercent: 280,
      blackPolicy: 'force-100k-text',
      spotColorPolicy: 'convert-process',
      overprintPreview: true,
      browserPdfIsPressCertified: false,
    }));
    expect(metadata.limitations).toEqual(expect.arrayContaining([
      'Browser PDF export records the production intent but does not embed ICC output profiles or validate PDF/X conformance.',
    ]));
  });

  it('normalizes bounded crop-mark and slug settings without enabling them by default', () => {
    expect(normalizePaperPrintProductionSpec({
      marks: {
        cropMarks: true,
        cropMarkLengthMm: 999,
        cropMarkOffsetMm: -4,
        cropMarkStrokePt: 0,
        slugAreaMm: 999,
      },
    }).marks).toEqual({
      cropMarks: true,
      cropMarkLengthMm: 20,
      cropMarkOffsetMm: 0,
      cropMarkStrokePt: 0.1,
      registrationMarks: false,
      colorBars: false,
      slugAreaMm: 100,
    });
  });
});
