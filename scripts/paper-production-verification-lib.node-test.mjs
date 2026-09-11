import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  PAPER_VERIFY_TOOLS,
  classifyPaperVerificationCommand,
  collectPaperSeparationFiles,
  listPaperPdfImages,
  resolvePaperProductionOutputDirectory,
} from './paper-production-verification-lib.mjs';

test('uses a caller-supplied output directory before the repository default', () => {
  const cwd = '/workspace';
  assert.equal(
    resolvePaperProductionOutputDirectory(['--output-dir', 'proofs'], {}, cwd),
    path.join(cwd, 'proofs'),
  );
  assert.equal(
    resolvePaperProductionOutputDirectory([], { PAPER_PRODUCTION_OUTPUT_DIR: '/tmp/paper-proof' }, cwd),
    '/tmp/paper-proof',
  );
});

test('records missing external tools as pending instead of passing them', () => {
  assert.deepEqual(
    classifyPaperVerificationCommand('qpdf', { error: { code: 'ENOENT' } }),
    { status: 'external-pending', detail: 'qpdf is not installed on this host.' },
  );
  assert.deepEqual(
    classifyPaperVerificationCommand('qpdf', { status: 0, stdout: 'qpdf version 12' }),
    { status: 'passed', detail: 'qpdf version 12' },
  );
});

test('classifies Ghostscript CMYK and named-spot separation files', () => {
  const plates = collectPaperSeparationFiles([
    'paper-production-golden-pdf-x-4-separation-1.tif',
    'paper-production-golden-pdf-x-4-separation-1(Cyan).tif',
    'paper-production-golden-pdf-x-4-separation-1(Magenta).tif',
    'paper-production-golden-pdf-x-4-separation-1(Yellow).tif',
    'paper-production-golden-pdf-x-4-separation-1(Black).tif',
    'paper-production-golden-pdf-x-4-separation-1(PANTONE 185 C).tif',
  ], 'paper-production-golden-pdf-x-4-separation');

  assert.deepEqual(plates.process, ['Black', 'Cyan', 'Magenta', 'Yellow']);
  assert.deepEqual(plates.spot, ['PANTONE 185 C']);
  assert.equal(plates.composite, true);
  assert.equal(PAPER_VERIFY_TOOLS.map((tool) => tool.command).join(','), 'qpdf,pdfinfo,pdffonts,pdfimages,gs');
});

test('reads physical PPI from Poppler image rows', () => {
  const images = listPaperPdfImages(`page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1     0 image     600   399  cmyk    4   8  image  no        12  0   300   300  170K  18%`);

  assert.deepEqual(images, [{ widthPx: 600, heightPx: 399, xPpi: 300, yPpi: 300 }]);
});
