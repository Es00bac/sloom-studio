import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PAPER_PRODUCTION_VERIFICATION_SCOPE,
  PAPER_VERIFY_TOOLS,
  classifyPaperVerificationCommand,
  collectPaperSeparationFiles,
  countPaperPdfFontRows,
  countPaperPdfImageRows,
  listPaperPdfImages,
  resolvePaperProductionOutputDirectory,
  summarizePaperVerification,
} from './paper-production-verification-lib.mjs';

const ROOT = process.cwd();
const outputDirectory = resolvePaperProductionOutputDirectory(process.argv.slice(2), process.env, ROOT);
const standards = ['pdf-x-1a', 'pdf-x-4'];

function outputForTool(result) {
  const stdout = String(result?.stdout ?? '').trim();
  const stderr = String(result?.stderr ?? '').trim();
  return stdout || stderr;
}

function commandResult(tool, pdf, prefix) {
  const args = tool.args(pdf, prefix);
  const result = spawnSync(tool.command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const classified = classifyPaperVerificationCommand(tool.command, result);
  return {
    command: tool.command,
    args,
    ...classified,
    output: outputForTool(result),
  };
}

function markFailed(tool, detail) {
  if (tool.status === 'external-pending') return;
  tool.status = 'failed';
  tool.detail = tool.detail ? `${tool.detail}\n${detail}` : detail;
}

async function removePreviousSeparations(prefixName) {
  const entries = await readdir(outputDirectory);
  await Promise.all(entries
    .filter((entry) => entry.startsWith(`${prefixName}-`) && /\.tiff?$/i.test(entry))
    .map((entry) => unlink(path.join(outputDirectory, entry))));
}

async function generateGoldenPdfs() {
  const vitestEntrypoint = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitestEntrypoint)) {
    return { status: 'failed', detail: 'Vitest is not installed; golden PDFs cannot be generated.' };
  }
  const result = spawnSync(process.execPath, [
    vitestEntrypoint,
    'run',
    '--configLoader',
    'runner',
    'src/lib/paperProductionGolden.test.ts',
  ], {
    cwd: ROOT,
    env: { ...process.env, PAPER_PRODUCTION_OUTPUT_DIR: outputDirectory },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const classified = classifyPaperVerificationCommand('vitest golden fixture', result);
  return { ...classified, output: outputForTool(result) };
}

async function verifyPdf(standard) {
  const fileName = `paper-production-golden-${standard}.pdf`;
  const pdf = path.join(outputDirectory, fileName);
  const prefixName = `paper-production-golden-${standard}-separation`;
  const prefix = path.join(outputDirectory, prefixName);
  const report = { standard, file: fileName, tools: [] };

  if (!existsSync(pdf)) {
    report.tools.push({ command: 'golden-fixture', status: 'failed', detail: `Expected generated file is missing: ${fileName}` });
    return report;
  }

  for (const tool of PAPER_VERIFY_TOOLS) {
    if (tool.command === 'gs') await removePreviousSeparations(prefixName);
    const checked = commandResult(tool, pdf, prefix);
    if (tool.command === 'pdfinfo' && checked.status === 'passed' && !/^Pages:\s+1\s*$/m.test(checked.output)) {
      markFailed(checked, 'pdfinfo did not report exactly one page.');
    }
    if (tool.command === 'pdffonts' && checked.status === 'passed') {
      const embeddedFontCount = countPaperPdfFontRows(checked.output);
      checked.embeddedFontCount = embeddedFontCount;
      if (embeddedFontCount < 2) markFailed(checked, `Expected at least two embedded managed fonts, found ${embeddedFontCount}.`);
    }
    if (tool.command === 'pdfimages' && checked.status === 'passed') {
      const imageCount = countPaperPdfImageRows(checked.output);
      const images = listPaperPdfImages(checked.output);
      checked.imageCount = imageCount;
      checked.images = images;
      if (imageCount < 1) markFailed(checked, `Expected at least one ICC-converted image, found ${imageCount}.`);
      if (!images.some((image) => image.xPpi >= 300 && image.yPpi >= 300)) {
        markFailed(checked, 'Expected at least one placed image at 300 PPI or greater.');
      }
    }
    if (tool.command === 'gs' && checked.status === 'passed') {
      const files = await readdir(outputDirectory);
      const separations = collectPaperSeparationFiles(files, prefixName);
      checked.separations = separations;
      const expectedProcess = ['Black', 'Cyan', 'Magenta', 'Yellow'];
      if (!expectedProcess.every((plate) => separations.process.includes(plate))) {
        markFailed(checked, `Ghostscript did not emit every process plate (${expectedProcess.join(', ')}).`);
      }
      if (!separations.spot.includes('PANTONE 185 C')) {
        markFailed(checked, 'Ghostscript did not emit the PANTONE 185 C named spot plate.');
      }
    }
    report.tools.push(checked);
  }
  return report;
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  for (const standard of standards) {
    await rm(path.join(outputDirectory, `paper-production-golden-${standard}.pdf`), { force: true });
  }

  const generation = await generateGoldenPdfs();
  const standardReports = generation.status === 'passed'
    ? await Promise.all(standards.map((standard) => verifyPdf(standard)))
    : standards.map((standard) => ({ standard, file: `paper-production-golden-${standard}.pdf`, tools: [] }));
  const report = {
    formatVersion: 1,
    scope: PAPER_PRODUCTION_VERIFICATION_SCOPE,
    outputDirectory,
    generation,
    standards: standardReports,
    externalReview: {
      acrobatProPreflight: {
        status: 'external-pending',
        detail: 'Adobe Acrobat Pro Preflight is not available on this Linux host; no certification is claimed.',
      },
    },
    status: generation.status === 'failed' ? 'failed' : summarizePaperVerification(standardReports),
  };
  const reportPath = path.join(outputDirectory, 'paper-production-verification.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Paper production verification: ${report.status}\n${reportPath}\n`);
  if (report.status === 'failed') process.exitCode = 1;
}

await main();
