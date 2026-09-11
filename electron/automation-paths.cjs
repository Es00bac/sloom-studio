const { delimiter: PLATFORM_PATH_DELIMITER } = require('node:path');

const ENABLE_AUTOMATION_PATHS = 'SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS';
const PROJECT_OPEN_PATH = 'SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH';
const PROJECT_SAVE_PATH = 'SIGNAL_LOOM_AUTOMATION_PROJECT_SAVE_PATH';
const IMPORT_MEDIA_PATHS = 'SIGNAL_LOOM_AUTOMATION_IMPORT_MEDIA_PATHS';
const PAPER_PDF_PATH = 'SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH';
const PAPER_IMAGE_DIRECTORY = 'SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY';

function isAutomationPathsEnabled(env = process.env) {
  return env?.[ENABLE_AUTOMATION_PATHS] === '1';
}

function getAutomationProjectOpenPath(env = process.env) {
  return getAutomationPath(env, PROJECT_OPEN_PATH);
}

function getAutomationProjectSavePath(env = process.env) {
  return getAutomationPath(env, PROJECT_SAVE_PATH);
}

function getAutomationPaperPdfPath(env = process.env) {
  return getAutomationPath(env, PAPER_PDF_PATH);
}

function getAutomationPaperImageDirectory(env = process.env) {
  return getAutomationPath(env, PAPER_IMAGE_DIRECTORY);
}

function getAutomationImportMediaPaths(env = process.env, delimiter = PLATFORM_PATH_DELIMITER) {
  if (!isAutomationPathsEnabled(env)) {
    return undefined;
  }

  const rawValue = env?.[IMPORT_MEDIA_PATHS];
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return undefined;
  }

  const paths = rawValue
    .split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  return paths.length > 0 ? paths : undefined;
}

function getAutomationPath(env, key) {
  if (!isAutomationPathsEnabled(env)) {
    return undefined;
  }

  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

module.exports = {
  getAutomationImportMediaPaths,
  getAutomationPaperImageDirectory,
  getAutomationPaperPdfPath,
  getAutomationProjectOpenPath,
  getAutomationProjectSavePath,
  isAutomationPathsEnabled,
};
