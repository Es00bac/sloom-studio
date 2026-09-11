import path from 'node:path';

export const PAPER_VERIFY_TOOLS = Object.freeze([
  { command: 'qpdf', args: (pdf) => ['--check', pdf] },
  { command: 'pdfinfo', args: (pdf) => [pdf] },
  { command: 'pdffonts', args: (pdf) => [pdf] },
  { command: 'pdfimages', args: (pdf) => ['-list', pdf] },
  { command: 'gs', args: (pdf, prefix) => ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=tiffsep', `-sOutputFile=${prefix}-%d.tif`, pdf] },
]);

export const PAPER_PRODUCTION_VERIFICATION_SCOPE =
  'Local structural inspection only; this is not Adobe Acrobat Preflight, ISO certification, or a press/RIP approval.';

export function resolvePaperProductionOutputDirectory(argv, environment, cwd) {
  let requested;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output-dir') {
      requested = argv[index + 1];
      if (!requested || requested.startsWith('--')) throw new Error('--output-dir requires a directory path.');
      index += 1;
      continue;
    }
    if (argument.startsWith('--output-dir=')) requested = argument.slice('--output-dir='.length);
  }
  const environmentDirectory = typeof environment.PAPER_PRODUCTION_OUTPUT_DIR === 'string'
    ? environment.PAPER_PRODUCTION_OUTPUT_DIR.trim()
    : '';
  const selected = requested?.trim() || environmentDirectory || path.join(cwd, 'artifacts', 'paper-production-verification');
  return path.resolve(cwd, selected);
}

export function classifyPaperVerificationCommand(command, result) {
  if (result?.error?.code === 'ENOENT') {
    return { status: 'external-pending', detail: `${command} is not installed on this host.` };
  }
  if (result?.status === 0) {
    const detail = String(result.stdout ?? result.stderr ?? '').trim();
    return { status: 'passed', detail };
  }
  const signal = result?.signal ? ` (signal ${result.signal})` : '';
  const output = String(result?.stderr ?? result?.stdout ?? '').trim();
  return {
    status: 'failed',
    detail: `${command} exited ${result?.status ?? 'without a status'}${signal}${output ? `: ${output}` : ''}`,
  };
}

export function collectPaperSeparationFiles(fileNames, prefix) {
  const selected = fileNames
    .map((file) => path.basename(file))
    .filter((file) => file.startsWith(`${prefix}-`) && /\.tiff?$/i.test(file));
  const processNames = ['Cyan', 'Magenta', 'Yellow', 'Black'];
  const process = new Set();
  const spot = new Set();
  let composite = false;

  for (const file of selected) {
    const match = /\(([^()]+)\)\.tiff?$/i.exec(file);
    if (!match) {
      composite = true;
      continue;
    }
    const name = match[1].trim();
    const processName = processNames.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (processName) process.add(processName);
    else if (name) spot.add(name);
  }

  return {
    files: selected.sort((left, right) => left.localeCompare(right)),
    composite,
    process: [...process].sort((left, right) => left.localeCompare(right)),
    spot: [...spot].sort((left, right) => left.localeCompare(right)),
  };
}

export function countPaperPdfFontRows(output) {
  return String(output)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .filter((line) => !/^name\s+type\s+/i.test(line.trim()))
    .filter((line) => !/^-{3,}/.test(line.trim()))
    .length;
}

export function countPaperPdfImageRows(output) {
  return listPaperPdfImages(output).length;
}

/** Parse Poppler's `pdfimages -list` rows without relying on fixed whitespace widths. */
export function listPaperPdfImages(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => /^\d+$/.test(fields[0] ?? '') && /^\d+$/.test(fields[1] ?? '') && fields[2]?.toLowerCase() === 'image')
    .map((fields) => ({
      widthPx: Number(fields[3]),
      heightPx: Number(fields[4]),
      xPpi: Number(fields[12]),
      yPpi: Number(fields[13]),
    }))
    .filter((image) => Number.isFinite(image.widthPx)
      && Number.isFinite(image.heightPx)
      && Number.isFinite(image.xPpi)
      && Number.isFinite(image.yPpi));
}

export function summarizePaperVerification(standards) {
  const toolStates = standards.flatMap((standard) => standard.tools.map((tool) => tool.status));
  if (toolStates.includes('failed')) return 'failed';
  if (toolStates.includes('external-pending')) return 'external-pending';
  return 'passed';
}
