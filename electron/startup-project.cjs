const { opendir, stat } = require('node:fs/promises');
const { basename, dirname, join } = require('node:path');

const STARTUP_PROJECT_STATE_FILE = 'startup-project.json';
const SIGNAL_LOOM_PROJECT_EXTENSION = '.sloom';
const MAX_STARTUP_PROJECT_BACKUPS = 20;

function buildStartupProjectStatePath(userDataPath) {
  return join(userDataPath, STARTUP_PROJECT_STATE_FILE);
}

function serializeStartupProjectState(filePath, reopenLastProjectOnStartup = false) {
  return `${JSON.stringify({
    ...(filePath ? { currentProjectPath: filePath } : {}),
    reopenLastProjectOnStartup: reopenLastProjectOnStartup === true,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`;
}

function parseStartupProjectState(contents) {
  try {
    const parsed = JSON.parse(contents);
    return typeof parsed?.currentProjectPath === 'string' && parsed.currentProjectPath.trim()
      ? parsed.currentProjectPath
      : undefined;
  } catch {
    return undefined;
  }
}

function parseStartupProjectReopenPreference(contents) {
  try {
    return JSON.parse(contents)?.reopenLastProjectOnStartup === true;
  } catch {
    return false;
  }
}

function resolveStartupProjectPath(filePath, fileExists) {
  if (!filePath || !filePath.toLowerCase().endsWith(SIGNAL_LOOM_PROJECT_EXTENSION)) {
    return undefined;
  }

  // Existence is deliberately not used as a validity check here. A remembered project can be
  // temporarily unavailable (unmounted drive, permissions, interrupted sync); retaining the path
  // lets startup present a useful recovery choice instead of permanently forgetting it.
  void fileExists;
  return filePath;
}

function startupProjectFailure(error, phase = 'prepare') {
  const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown project error');
  const errorCode = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : undefined;
  const lowerMessage = rawMessage.toLowerCase();
  let code;

  if (errorCode === 'ENOENT') code = 'missing';
  else if (['EACCES', 'EPERM', 'EBUSY', 'EIO'].includes(errorCode) || phase === 'read') code = 'unreadable';
  else if (lowerMessage.includes('could not be parsed')) code = 'corrupt';
  else if (phase === 'parse' || lowerMessage.includes('not a valid sloom studio project')) code = 'invalid-project';
  else code = 'preparation-failed';

  const fallbackMessages = {
    missing: 'The remembered project is not currently available.',
    unreadable: 'The remembered project could not be read.',
    corrupt: 'The remembered project contains invalid JSON.',
    'invalid-project': 'The remembered file is not a valid Sloom Studio project.',
    'preparation-failed': 'The remembered project could not be prepared for opening.',
  };

  return {
    code,
    message: rawMessage && rawMessage !== '[object Object]' ? rawMessage : fallbackMessages[code],
  };
}

async function* startupProjectDirectoryEntries(projectDirectory, dependencies) {
  // Keep the legacy injected readdir seam for deterministic unit tests. Production uses Dir.read()
  // so a directory full of old backups never creates a large entry array or an unbounded stat fan-out.
  if (dependencies.readdir) {
    for (const entry of await dependencies.readdir(projectDirectory, { withFileTypes: true })) yield entry;
    return;
  }

  const directory = await (dependencies.opendir ?? opendir)(projectDirectory);
  try {
    for (;;) {
      const entry = await directory.read();
      if (!entry) return;
      yield entry;
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
}

function compareStartupProjectBackups(left, right) {
  const byModifiedTime = right.modifiedAtMs - left.modifiedAtMs;
  return byModifiedTime || left.filePath.localeCompare(right.filePath);
}

function retainStartupProjectBackup(backups, backup) {
  backups.push(backup);
  backups.sort(compareStartupProjectBackups);
  if (backups.length > MAX_STARTUP_PROJECT_BACKUPS) backups.length = MAX_STARTUP_PROJECT_BACKUPS;
}

async function discoverStartupProjectBackups(filePath, dependencies = {}) {
  if (!filePath || !filePath.toLowerCase().endsWith(SIGNAL_LOOM_PROJECT_EXTENSION)) return [];
  const getStat = dependencies.stat ?? stat;
  const projectDirectory = dirname(filePath);
  const backupPrefix = `${basename(filePath)}.bak`.toLowerCase();

  try {
    const backups = [];
    for await (const entry of startupProjectDirectoryEntries(projectDirectory, dependencies)) {
      if (!entry?.isFile?.() || !entry.name.toLowerCase().startsWith(backupPrefix)) continue;
      const backupPath = join(projectDirectory, entry.name);
      try {
        // Sequential stat calls retain predictable I/O and the array above never exceeds the public cap.
        const fileStat = await getStat(backupPath);
        retainStartupProjectBackup(backups, { filePath: backupPath, modifiedAtMs: Number(fileStat.mtimeMs) || 0 });
      } catch {
        // A backup can disappear between directory read and stat; keep the other usable candidates.
      }
    }
    return backups;
  } catch {
    return [];
  }
}

async function buildStartupProjectRecovery(filePath, error, phase, dependencies = {}) {
  return {
    filePath,
    failure: startupProjectFailure(error, phase),
    backups: await (dependencies.discoverBackups ?? discoverStartupProjectBackups)(filePath),
  };
}

async function prepareRememberedStartupProject(options) {
  const {
    filePath,
    reopenLastProjectOnStartup,
    readProject,
    parseProject,
    prepareProject,
    discoverBackups,
  } = options;
  if (!reopenLastProjectOnStartup || !filePath) return { status: 'blank' };

  let contents;
  try {
    contents = await readProject(filePath);
  } catch (error) {
    return {
      status: 'recovery',
      recovery: await buildStartupProjectRecovery(filePath, error, 'read', { discoverBackups }),
    };
  }

  let document;
  try {
    document = parseProject(contents);
  } catch (error) {
    return {
      status: 'recovery',
      recovery: await buildStartupProjectRecovery(filePath, error, 'parse', { discoverBackups }),
    };
  }

  try {
    return { status: 'project', prepared: await prepareProject(filePath, document) };
  } catch (error) {
    return {
      status: 'recovery',
      recovery: await buildStartupProjectRecovery(filePath, error, 'prepare', { discoverBackups }),
    };
  }
}

module.exports = {
  MAX_STARTUP_PROJECT_BACKUPS,
  STARTUP_PROJECT_STATE_FILE,
  buildStartupProjectRecovery,
  buildStartupProjectStatePath,
  discoverStartupProjectBackups,
  parseStartupProjectReopenPreference,
  parseStartupProjectState,
  prepareRememberedStartupProject,
  resolveStartupProjectPath,
  serializeStartupProjectState,
  startupProjectFailure,
};
