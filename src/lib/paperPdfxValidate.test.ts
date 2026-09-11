import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { summarizePdfxReport, validatePaperPdfx } from './paperPdfxValidate';

describe('paperPdfxValidate', () => {
  it('flags live transparency when validating a PDF/X-1a handoff', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    const state = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', ca: 0.5, CA: 1 }));
    page.node.setExtGState(PDFName.of('GS1'), state);

    const report = await validatePaperPdfx(await pdf.save(), { standard: 'pdf-x-1a' });

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'x1a-no-live-transparency',
      pass: false,
    }));
  });

  it('flags ExtGState alpha even when the optional Type entry is absent', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    const state = pdf.context.register(pdf.context.obj({ ca: 0.5, CA: 1 }));
    page.node.setExtGState(PDFName.of('GS1'), state);

    const report = await validatePaperPdfx(await pdf.save(), { standard: 'pdf-x-1a' });

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'x1a-no-live-transparency',
      pass: false,
      detail: 'ExtGState alpha',
    }));
  });

  it('uses structural language rather than a conformance claim in summaries', () => {
    expect(summarizePdfxReport({
      standard: 'pdf-x-4',
      headerVersion: '1.6',
      pass: true,
      checks: [],
    })).toContain('Structural checks passed');
  });
});
