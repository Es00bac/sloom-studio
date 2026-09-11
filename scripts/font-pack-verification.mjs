import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const FONT_PACK_METADATA_FILES = Object.freeze([
  'README.md',
  'DISTRIBUTION.md',
  'source-artifact.json',
  'catalog/families.tsv',
  'inventory/README.md',
  'inventory/SHA256SUMS',
  'inventory/font-inventory.json',
]);

export const APPROVED_FONT_PACK = Object.freeze({
  revision: '31507e786066f973e1b01fb479d6d718cd433a6c',
  googleFontsRepository: 'https://github.com/google/fonts.git',
  googleFontsCommit: '26c5c976d82d50c24a8f0a7ac455e0a7c639c226',
  liberationVersion: '2.1.5',
  liberationSha256: '7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0',
  mplusLicenseCommit: '0d4459efc913a91f33c3f08b219a5a95d282c7b8',
  mplusLicenseSha256: '1bd6eceefce3edcb25cad3d5a4fbec6405d66946a6672daf69fe667c7e52f591',
  catalogFamilyCount: 116,
  faceCount: 430,
  inventorySha256: 'f9902cc342471b4c58147347fc5a51ed8e6826fa04712ed37c54867105908cff',
  checksumManifestSha256: 'c1e2ea9159dbb7f3c73d3f720210b625ce36d8273989ec53eed6646bb2dedb1c',
  metadataSha256: Object.freeze({
    'README.md': 'fdb81dda83c37de55e2ab69673ffebb485b6d4cd8773a2aec9994e20d1fad499',
    'DISTRIBUTION.md': 'cc43fa7642520418f331fd5202ba4ac4245c8f731ce5370856994640992c92ac',
    'catalog/families.tsv': '6c599e380296fa625ed70dbdc64c20e09f00ca0af296bc340b06f95f98ea7c96',
    'inventory/README.md': '2cace0b2ad966919f8d32f69e8ea93f45b334e720e53a4b265af491baad5f17e',
  }),
  knownFace: Object.freeze({
    family: 'Liberation Sans',
    subfamily: 'Regular',
    postscriptName: 'LiberationSans',
    file: 'collection/base/liberationsans/LiberationSans-Regular.ttf',
    sha256: '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
  }),
  knownLicense: Object.freeze({
    file: 'collection/base/liberationsans/LICENSE',
    sha256: '93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b',
    byteLength: 4414,
  }),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function safeFontPackRelativePath(value) {
  const normalized = String(value).replace(/\\/g, '/');
  if (!normalized
    || isAbsolute(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Font integrity manifest contains an unsafe path: ${value}`);
  }
  return normalized;
}

function assertApprovedSourceLock(lock, approved) {
  if (lock?.schemaVersion !== 1
    || lock.fontPackRevision !== approved.revision
    || lock.googleFonts?.repository !== approved.googleFontsRepository
    || lock.googleFonts?.commit !== approved.googleFontsCommit
    || lock.liberationFonts?.version !== approved.liberationVersion
    || lock.liberationFonts?.sha256 !== approved.liberationSha256
    || lock.mplusLicense?.commit !== approved.mplusLicenseCommit
    || lock.mplusLicense?.sha256 !== approved.mplusLicenseSha256
    || lock.inventory?.catalogFamilyCount !== approved.catalogFamilyCount
    || lock.inventory?.faceCount !== approved.faceCount
    || lock.inventory?.criticalErrorCount !== 0
    || lock.inventory?.fontInventorySha256 !== approved.inventorySha256
    || lock.inventory?.sha256SumsSha256 !== approved.checksumManifestSha256
    || Object.entries(approved.metadataSha256).some(([path, hash]) => lock.metadataSha256?.[path] !== hash)
    || lock.packageSmokeFace?.family !== approved.knownFace.family
    || lock.packageSmokeFace?.subfamily !== approved.knownFace.subfamily
    || lock.packageSmokeFace?.postscriptName !== approved.knownFace.postscriptName
    || lock.packageSmokeFace?.file !== approved.knownFace.file
    || lock.packageSmokeFace?.sha256 !== approved.knownFace.sha256
    || lock.packageSmokeLicense?.file !== approved.knownLicense.file
    || lock.packageSmokeLicense?.sha256 !== approved.knownLicense.sha256
    || lock.packageSmokeLicense?.byteLength !== approved.knownLicense.byteLength) {
    throw new Error(`Font source lock does not match approved pack ${approved.revision}.`);
  }
}

function collectManifestEntries(inventory, approved) {
  if (!Array.isArray(inventory?.families)
    || inventory.catalogFamilyCount !== approved.catalogFamilyCount
    || inventory.families.length !== approved.catalogFamilyCount
    || inventory.faceCount !== approved.faceCount
    || inventory.fontFileCount !== approved.faceCount
    || inventory.criticalErrorCount !== 0) {
    throw new Error(`The Sloom font inventory does not match the approved ${approved.catalogFamilyCount}-family/${approved.faceCount}-face zero-critical-error collection.`);
  }

  const entries = [];
  const faces = [];
  for (const family of inventory.families) {
    if (!Array.isArray(family?.faces) || !Array.isArray(family?.licenses)) {
      throw new Error('The Sloom font inventory contains an invalid family entry.');
    }
    for (const entry of [...family.faces, ...family.licenses]) {
      if (typeof entry?.file !== 'string'
        || !/^[0-9a-f]{64}$/i.test(entry?.sha256 ?? '')
        || !Number.isSafeInteger(entry?.byteLength)
        || entry.byteLength <= 0) {
        throw new Error('The Sloom font inventory contains an invalid file entry.');
      }
      entries.push({
        file: safeFontPackRelativePath(entry.file),
        sha256: entry.sha256.toLowerCase(),
        byteLength: entry.byteLength,
      });
    }
    faces.push(...family.faces);
  }
  if (faces.length !== approved.faceCount) {
    throw new Error(`The Sloom font inventory does not enumerate exactly ${approved.faceCount} faces.`);
  }
  const knownFace = faces.find((face) => face.file === approved.knownFace.file);
  if (!knownFace
    || knownFace.family !== approved.knownFace.family
    || knownFace.subfamily !== approved.knownFace.subfamily
    || knownFace.postscriptName !== approved.knownFace.postscriptName
    || knownFace.sha256 !== approved.knownFace.sha256) {
    throw new Error('The approved package-smoke face is absent or has changed identity.');
  }
  const knownLicense = entries.find((entry) => entry.file === approved.knownLicense.file);
  if (!knownLicense
    || knownLicense.sha256 !== approved.knownLicense.sha256
    || knownLicense.byteLength !== approved.knownLicense.byteLength) {
    throw new Error('The approved package-smoke license is absent or has changed identity.');
  }
  return entries;
}

async function readRegularFile(path, relativePath) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new Error(`Font pack file is missing: ${relativePath}`);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
    throw new Error(`Font pack entry is not a non-empty regular file: ${relativePath}`);
  }
  return await readFile(path);
}

async function listPayloadFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) throw new Error(`Font pack contains a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error(`Font pack contains an unsupported entry: ${relativePath}`);
    }
  }
  await walk(root);
  return files.sort();
}

export async function verifyFontPackRoot(root, {
  approved = APPROVED_FONT_PACK,
  strictPayload = false,
  sourceLockPath,
} = {}) {
  const resolvedSourceLockPath = sourceLockPath
    ? resolve(sourceLockPath)
    : join(root, 'source-artifact.json');
  if (strictPayload && resolvedSourceLockPath !== resolve(root, 'source-artifact.json')) {
    throw new Error('Strict staged font verification requires source-artifact.json inside the staged root.');
  }
  const metadataBytes = new Map();
  for (const relativePath of FONT_PACK_METADATA_FILES) {
    const path = relativePath === 'source-artifact.json'
      ? resolvedSourceLockPath
      : join(root, relativePath);
    metadataBytes.set(relativePath, await readRegularFile(path, relativePath));
  }
  const sourceLockBytes = metadataBytes.get('source-artifact.json');
  const inventoryBytes = metadataBytes.get('inventory/font-inventory.json');
  const sumsBytes = metadataBytes.get('inventory/SHA256SUMS');

  let sourceLock;
  let inventory;
  try {
    sourceLock = JSON.parse(sourceLockBytes.toString('utf8'));
    inventory = JSON.parse(inventoryBytes.toString('utf8'));
  } catch {
    throw new Error('The font source lock or inventory is not valid JSON.');
  }
  assertApprovedSourceLock(sourceLock, approved);
  if (sha256(inventoryBytes) !== approved.inventorySha256
    || sha256(sumsBytes) !== approved.checksumManifestSha256) {
    throw new Error('The font inventory or checksum manifest does not match the immutable source lock.');
  }
  for (const [relativePath, expectedHash] of Object.entries(approved.metadataSha256)) {
    if (sha256(metadataBytes.get(relativePath)) !== expectedHash) {
      throw new Error(`Font pack metadata does not match the immutable source lock: ${relativePath}`);
    }
  }
  const inventoryEntries = collectManifestEntries(inventory, approved);
  const inventoryPaths = new Set();
  for (const entry of inventoryEntries) {
    if (inventoryPaths.has(entry.file)) throw new Error(`Duplicate font inventory path: ${entry.file}`);
    inventoryPaths.add(entry.file);
  }

  const checksums = new Map();
  for (const line of sumsBytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean)) {
    const match = /^([0-9a-f]{64})  (.+)$/i.exec(line);
    if (!match) throw new Error(`Invalid font integrity line: ${line}`);
    const relativePath = safeFontPackRelativePath(match[2]);
    if (checksums.has(relativePath)) throw new Error(`Duplicate font integrity path: ${relativePath}`);
    checksums.set(relativePath, match[1].toLowerCase());
  }

  for (const entry of inventoryEntries) {
    if (checksums.get(entry.file) !== entry.sha256) {
      throw new Error(`Font inventory and checksum manifest disagree for ${entry.file}.`);
    }
  }
  if (checksums.size !== inventoryPaths.size) {
    const extra = [...checksums.keys()].find((path) => !inventoryPaths.has(path));
    throw new Error(extra
      ? `Font checksum manifest contains an undeclared payload: ${extra}`
      : 'Font checksum manifest and inventory do not contain the same payload paths.');
  }
  for (const [relativePath, expectedHash] of checksums) {
    const bytes = await readRegularFile(join(root, relativePath), relativePath);
    const inventoryEntry = inventoryEntries.find((entry) => entry.file === relativePath);
    if (bytes.byteLength !== inventoryEntry.byteLength) {
      throw new Error(`Font byte length does not match the inventory for ${relativePath}.`);
    }
    if (sha256(bytes) !== expectedHash) throw new Error(`Font integrity check failed for ${relativePath}.`);
  }

  if (strictPayload) {
    const allowed = new Set([...FONT_PACK_METADATA_FILES, ...checksums.keys(), '.source-inventory.sha256']);
    const undeclared = (await listPayloadFiles(root)).filter((path) => !allowed.has(path));
    if (undeclared.length) throw new Error(`Staged font pack contains an undeclared file: ${undeclared[0]}`);
  }

  return {
    signature: sha256(Buffer.concat([sourceLockBytes, inventoryBytes, sumsBytes])),
    inventory,
    sourceLock,
    sourceLockPath: resolvedSourceLockPath,
    checksumCount: checksums.size,
    checksumPaths: [...checksums.keys()].sort(),
    knownFace: approved.knownFace,
    knownLicense: approved.knownLicense,
  };
}
