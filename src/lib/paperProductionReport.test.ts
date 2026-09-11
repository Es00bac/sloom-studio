import { describe, expect, it } from 'vitest';
import type { PdfxExportResult } from './paperPdfxExport';
import type { PdfxValidationReport } from './paperPdfxValidate';
import type { PaperProductionPreflightReport } from './paperProductionPreflight';
import { createPaperProductionExportReport, formatProductionValidationStatus } from './paperProductionReport';

const preflight: PaperProductionPreflightReport = {
  documentId: 'paper-1',
  revision: 1,
  standard: 'pdf-x-4',
  assetIds: [],
  expectedFontIds: ['managed-serif'],
  requestedSpotNames: ['PANTONE 185 C'],
  imagePpi: [],
  issues: [],
  pass: true,
};

const result: PdfxExportResult = {
  bytes: new Uint8Array([1]),
  standard: 'pdf-x-4',
  pageCount: 1,
  profileName: 'Exact FOGRA51 profile',
  approximateColor: false,
  nativeEvidence: {
    processObjectIds: ['process-panel'],
    spotPlates: [{ name: 'PANTONE 185 C', objectIds: ['spot-panel'] }],
    embeddedFontIds: ['managed-serif'],
    outlinedObjectIds: [],
    flattenedObjectIds: [],
    overprintObjectIds: [],
  },
};

const validation: PdfxValidationReport = {
  standard: 'pdf-x-4',
  headerVersion: '1.6',
  pass: true,
  checks: [{ id: 'no-rgb', label: 'No RGB color', pass: true }],
};

describe('Paper production export report', () => {
  it('does not claim ISO certification from the internal validator', () => {
    const report = createPaperProductionExportReport({ preflight, result, validation });
    const copy = formatProductionValidationStatus(report);

    expect(copy).toContain('Structurally verified');
    expect(copy).not.toMatch(/certified|ISO validation passed/i);
  });

  it('blocks absent embedded managed fonts, spots, approximate color, and failed checks', () => {
    const report = createPaperProductionExportReport({
      preflight,
      result: {
        ...result,
        approximateColor: true,
        nativeEvidence: { ...result.nativeEvidence, embeddedFontIds: [], spotPlates: [] },
      },
      validation: { ...validation, pass: false, checks: [{ id: 'no-rgb', label: 'No RGB color', pass: false }] },
    });

    expect(report.pass).toBe(false);
    expect(report.blockers.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'FONT_NOT_EMBEDDED',
      'SPOT_NOT_PLATED',
      'APPROXIMATE_COLOR_TRANSFORM',
      'PDFX_VALIDATION_NO_RGB',
    ]));
  });
});
