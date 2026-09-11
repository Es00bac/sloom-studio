const { basename, dirname, join } = require('node:path');

function sanitizePaperImagePathPart(value, fallback = 'paper-document') {
  return (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function buildPaperImageDefaultDirectoryPath(request, currentProjectPath) {
  const format = request?.format === 'jpeg' ? 'jpeg' : 'png';
  const directoryName = sanitizePaperImagePathPart(
    request?.directoryName,
    `${sanitizePaperImagePathPart(request?.title, 'paper-document')}-webcomic-${format}`,
  );
  return currentProjectPath ? join(dirname(currentProjectPath), directoryName) : directoryName;
}

function ensurePaperImageExportDirectory(selectedPath, directoryName) {
  const safeDirectoryName = sanitizePaperImagePathPart(directoryName, 'paper-webcomic-images');
  return basename(selectedPath) === safeDirectoryName ? selectedPath : join(selectedPath, safeDirectoryName);
}

function imageBufferFromDataUrl(dataUrl, expectedMimeType) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!match) {
    throw new Error('Paper image export received an invalid image data URL.');
  }
  if (match[1].toLowerCase() !== expectedMimeType) {
    throw new Error(`Paper image export expected ${expectedMimeType} but received ${match[1]}.`);
  }
  return match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
}

module.exports = {
  buildPaperImageDefaultDirectoryPath,
  ensurePaperImageExportDirectory,
  imageBufferFromDataUrl,
  sanitizePaperImagePathPart,
};
