const { createHash, randomUUID } = require('node:crypto');
const {
  closeSync,
  constants,
  createReadStream,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  rmdirSync,
  rmSync,
  unlinkSync,
} = require('node:fs');
const { copyFile, realpath, stat, statfs } = require('node:fs/promises');
const { basename, extname, join, relative, resolve } = require('node:path');

const MAX_CONSOLIDATION_ENTRIES = 1_000;
const MAX_CONSOLIDATED_FILE_NAME_BYTES = 220;
const MIN_CONSOLIDATION_FREE_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/i;

async function fingerprintMediaFile(filePath) {
  const canonicalPath = await realpath(filePath);
  const info = await stat(canonicalPath);
  if (!info.isFile()) throw new Error('Media capability does not resolve to a regular file.');
  if (info.size <= 0) throw new Error('Media capability resolves to an empty file.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(canonicalPath)) hash.update(chunk);
  return {
    canonicalPath,
    byteSize: info.size,
    fingerprint: `sha256:${hash.digest('hex')}`,
  };
}

function fingerprintMatches(expected, actual) {
  if (typeof expected !== 'string' || !expected.trim()) return true;
  const expectedMatch = SHA256_PATTERN.exec(expected.trim());
  if (!expectedMatch) return !/^sha256:/i.test(expected.trim());
  const actualMatch = SHA256_PATTERN.exec(String(actual ?? '').trim());
  return Boolean(expectedMatch && actualMatch && expectedMatch[1].toLowerCase() === actualMatch[1].toLowerCase());
}

async function inspectRelinkCandidate({ filePath, expectedFingerprint }) {
  const inspected = await fingerprintMediaFile(filePath);
  if (!fingerprintMatches(expectedFingerprint, inspected.fingerprint)) {
    throw new Error('The selected file does not match the original media fingerprint.');
  }
  return inspected;
}

async function createMediaConsolidationTransaction(
  { entries, targetDirectory, transactionId = randomUUID() },
  {
    copyFileExclusive = (sourcePath, stagePath) => copyFile(sourcePath, stagePath, constants.COPYFILE_EXCL),
    getAvailableBytes = availableBytesForDirectory,
    promoteFileExclusive = (stagePath, targetPath) => linkSync(stagePath, targetPath),
    afterPromotionVerified = () => undefined,
  } = {},
) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('At least one media item is required for consolidation.');
  if (entries.length > MAX_CONSOLIDATION_ENTRIES) throw new Error(`Consolidation is limited to ${MAX_CONSOLIDATION_ENTRIES} media items per operation.`);
  const canonicalTargetDirectory = await realpath(targetDirectory);
  if (!(await stat(canonicalTargetDirectory)).isDirectory()) throw new Error('The consolidation target is not a directory.');

  const reservedNames = new Set();
  const prepared = [];
  const inspectedEntries = [];
  for (const entry of entries) {
    if (!entry || typeof entry.itemId !== 'string' || !entry.itemId.trim() || typeof entry.sourcePath !== 'string') {
      throw new Error('A consolidation entry is missing its media identity or source capability.');
    }
    const source = await fingerprintMediaFile(entry.sourcePath);
    if (!fingerprintMatches(entry.expectedFingerprint, source.fingerprint)) {
      throw new Error(`Media '${entry.itemId}' no longer matches its ingested fingerprint.`);
    }
    inspectedEntries.push({ entry, source });
  }
  const sourceBytes = inspectedEntries.reduce((total, item) => total + BigInt(item.source.byteSize), 0n);
  const proportionalSafetyMarginBytes = (sourceBytes + 19n) / 20n;
  const safetyMarginBytes = proportionalSafetyMarginBytes > BigInt(MIN_CONSOLIDATION_FREE_SPACE_MARGIN_BYTES)
    ? proportionalSafetyMarginBytes
    : BigInt(MIN_CONSOLIDATION_FREE_SPACE_MARGIN_BYTES);
  const availableValue = await getAvailableBytes(canonicalTargetDirectory);
  const availableBytes = typeof availableValue === 'bigint'
    ? availableValue
    : BigInt(Math.max(0, Math.floor(Number(availableValue) || 0)));
  if (availableBytes < sourceBytes + safetyMarginBytes) {
    throw new Error(`The selected folder needs ${formatBytes(sourceBytes + safetyMarginBytes)} free for verified consolidation, but only ${formatBytes(availableBytes)} is available.`);
  }

  // All disposable files live below a fresh private namespace. Destination paths are public as
  // soon as they are hard-linked and are never later treated as transaction-owned cleanup paths:
  // Node has no portable identity-conditional unlink, so check-then-unlink would be racy.
  const stageDirectory = mkdtempSync(resolve(
    canonicalTargetDirectory,
    `.sloom-consolidating-${sanitizePathPart(transactionId)}-`,
  ));
  assertDirectChild(stageDirectory, canonicalTargetDirectory);

  try {
    for (const { entry, source } of inspectedEntries) {
      const fileName = chooseAvailableFileName(entry.fileName || basename(source.canonicalPath), canonicalTargetDirectory, reservedNames);
      const targetPath = resolve(canonicalTargetDirectory, fileName);
      assertDirectChild(targetPath, canonicalTargetDirectory);
      const stagePath = resolve(stageDirectory, `${prepared.length}.part`);
      assertPathInsideDirectory(stagePath, stageDirectory);
      try {
        await copyFileExclusive(source.canonicalPath, stagePath);
        const staged = await fingerprintMediaFile(stagePath);
        if (staged.byteSize !== source.byteSize || staged.fingerprint !== source.fingerprint) {
          throw new Error(`Staged copy verification failed for media '${entry.itemId}'.`);
        }
        const owner = openOwnedFile(stagePath);
        prepared.push({
          itemId: entry.itemId,
          sourcePath: source.canonicalPath,
          targetPath,
          stagePath,
          fileName,
          byteSize: source.byteSize,
          fingerprint: source.fingerprint,
          owner,
        });
      } catch (error) {
        // COPYFILE_EXCL reports EEXIST without owning the pre-existing path.
        // Other failures may leave a partial file created by this transaction.
        if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
          rmSync(stagePath, { force: true });
        }
        throw error;
      }
    }
  } catch (error) {
    for (const entry of prepared) {
      removePathOnlyWhileOwned(entry.stagePath, entry.owner);
      closeOwnedFile(entry.owner);
    }
    removeEmptyStageDirectory(stageDirectory);
    throw error;
  }

  let committed = false;
  let finalized = false;
  const promotedPaths = new Map();
  return {
    targetDirectory: canonicalTargetDirectory,
    entries: prepared.map(({ stagePath: _stagePath, owner: _owner, ...entry }) => ({ ...entry })),
    commit() {
      if (committed) return;
      if (finalized) throw new Error('The media consolidation transaction is already finalized.');
      try {
        for (const entry of prepared) {
          // A same-directory hard link promotes without replacing a target created after prepare.
          promoteFileExclusive(entry.stagePath, entry.targetPath);
          if (!pathMatchesOwner(entry.targetPath, entry.owner)) {
            throw new Error(`Promoted media ownership changed before commit for '${entry.itemId}'.`);
          }
          promotedPaths.set(entry.targetPath, entry.owner);
          afterPromotionVerified(entry.targetPath, entry.itemId);
          removePathOnlyWhileOwned(entry.stagePath, entry.owner);
        }
        removeEmptyStageDirectory(stageDirectory);
        committed = true;
      } catch (error) {
        for (const entry of prepared) {
          removePathOnlyWhileOwned(entry.stagePath, entry.owner);
          closeOwnedFile(entry.owner);
        }
        removeEmptyStageDirectory(stageDirectory);
        finalized = true;
        if (promotedPaths.size > 0) throw buildPartialPromotionError(error, prepared, promotedPaths);
        throw error;
      }
    },
    rollback() {
      if (finalized) return;
      for (const entry of prepared) {
        removePathOnlyWhileOwned(entry.stagePath, entry.owner);
        closeOwnedFile(entry.owner);
      }
      removeEmptyStageDirectory(stageDirectory);
      promotedPaths.clear();
      committed = false;
      finalized = true;
    },
    finalize() {
      if (finalized) return;
      for (const entry of prepared) closeOwnedFile(entry.owner);
      promotedPaths.clear();
      finalized = true;
    },
  };
}

function buildPartialPromotionError(cause, prepared, promotedPaths) {
  const retainedNames = prepared
    .filter((entry) => promotedPaths.has(entry.targetPath))
    .map((entry) => entry.fileName);
  const count = retainedNames.length;
  const error = new Error(
    `Consolidation stopped after ${count} destination ${count === 1 ? 'path was' : 'paths were'} published. `
    + `Those paths were left untouched because deleting a public pathname during rollback is unsafe. `
    + `Check the selected folder for: ${retainedNames.join(', ')}.`,
    { cause },
  );
  error.code = 'SLOOM_CONSOLIDATION_PARTIAL_PUBLISH';
  error.retainedFileNames = retainedNames;
  return error;
}

function buildConsolidationPostCommitError(cause, transaction) {
  const retainedEntries = Array.isArray(transaction?.entries) ? transaction.entries : [];
  const retainedFileNames = retainedEntries
    .map((entry) => entry?.fileName)
    .filter((fileName) => typeof fileName === 'string' && fileName.length > 0);
  const retainedFilePaths = retainedEntries
    .map((entry) => entry?.targetPath)
    .filter((targetPath) => typeof targetPath === 'string' && targetPath.length > 0);
  const count = retainedFilePaths.length;
  const error = new Error(
    `Consolidation published ${count} destination ${count === 1 ? 'path' : 'paths'} before the Source Library commit failed. `
    + 'Those published paths were left untouched. '
    + `Check the selected folder for: ${retainedFileNames.join(', ')}. `
    + `Published paths: ${retainedFilePaths.join(', ')}.`,
    { cause },
  );
  error.code = 'SLOOM_CONSOLIDATION_POST_COMMIT_FAILURE';
  error.retainedFileNames = retainedFileNames;
  error.retainedFilePaths = retainedFilePaths;
  return error;
}

function openOwnedFile(filePath) {
  const fd = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const identity = fstatSync(fd, { bigint: true });
    if (!identity.isFile()) throw new Error('Staged media ownership does not reference a regular file.');
    return { fd, device: identity.dev, inode: identity.ino, closed: false };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function pathMatchesOwner(filePath, owner) {
  if (!owner || owner.closed) return false;
  try {
    const current = lstatSync(filePath, { bigint: true });
    const held = fstatSync(owner.fd, { bigint: true });
    return current.isFile()
      && held.isFile()
      && current.dev === owner.device
      && current.ino === owner.inode
      && held.dev === owner.device
      && held.ino === owner.inode;
  } catch {
    return false;
  }
}

function removePathOnlyWhileOwned(filePath, owner) {
  if (!pathMatchesOwner(filePath, owner)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

function closeOwnedFile(owner) {
  if (!owner || owner.closed) return;
  owner.closed = true;
  closeSync(owner.fd);
}

function removeEmptyStageDirectory(stageDirectory) {
  try {
    rmdirSync(stageDirectory);
  } catch (error) {
    if (error && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY')) return;
    throw error;
  }
}

async function availableBytesForDirectory(directoryPath) {
  const fileSystem = await statfs(directoryPath, { bigint: true });
  return fileSystem.bavail * fileSystem.bsize;
}

function formatBytes(value) {
  const bytes = typeof value === 'bigint' ? value : BigInt(value);
  const mib = Number(bytes / (1024n * 1024n));
  return `${mib.toLocaleString('en-US')} MiB`;
}

function chooseAvailableFileName(requestedName, targetDirectory, reservedNames) {
  const safeName = sanitizeFileName(requestedName);
  const extension = extname(safeName);
  const stem = safeName.slice(0, safeName.length - extension.length) || 'media';
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = index === 1 ? `${stem}${extension}` : `${stem} (${index})${extension}`;
    if (!reservedNames.has(candidate.toLowerCase()) && !existsSync(join(targetDirectory, candidate))) {
      reservedNames.add(candidate.toLowerCase());
      return candidate;
    }
  }
  throw new Error('Could not allocate a collision-safe consolidation file name.');
}

function sanitizeFileName(value) {
  const leaf = basename(String(value ?? '').trim()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!leaf) return 'media';
  const rawExtension = extname(leaf);
  const extension = truncateUtf8(rawExtension, 32);
  const rawStem = leaf.slice(0, leaf.length - rawExtension.length) || 'media';
  const stem = truncateUtf8(rawStem, MAX_CONSOLIDATED_FILE_NAME_BYTES - Buffer.byteLength(extension, 'utf8'))
    .replace(/[. ]+$/g, '') || 'media';
  return `${stem}${extension}`;
}

function truncateUtf8(value, maximumBytes) {
  let result = '';
  let bytes = 0;
  for (const character of String(value)) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function sanitizePathPart(value) {
  return String(value ?? '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'transaction';
}

function assertDirectChild(filePath, directoryPath) {
  const child = relative(directoryPath, filePath);
  if (!child || child.startsWith('..') || child.includes('/') || child.includes('\\')) {
    throw new Error('Media consolidation attempted to escape its selected directory.');
  }
}

function assertPathInsideDirectory(filePath, directoryPath) {
  const child = relative(directoryPath, filePath);
  if (!child || child.startsWith('..') || child.includes('/') || child.includes('\\')) {
    throw new Error('Media consolidation staging attempted to escape its private directory.');
  }
}

module.exports = {
  MAX_CONSOLIDATION_ENTRIES,
  MIN_CONSOLIDATION_FREE_SPACE_MARGIN_BYTES,
  createMediaConsolidationTransaction,
  fingerprintMatches,
  fingerprintMediaFile,
  inspectRelinkCandidate,
  buildConsolidationPostCommitError,
};
