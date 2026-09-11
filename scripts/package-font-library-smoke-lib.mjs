import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import bundledFontLibrary from '../electron/bundled-font-library.cjs';
import { APPROVED_FONT_PACK, verifyFontPackRoot } from './font-pack-verification.mjs';

const MAX_PACKAGE_SCAN_DEPTH = 8;

export async function findPackagedFontLibraryRoots(searchRoot) {
  const roots = [];
  async function walk(directory, depth) {
    if (depth > MAX_PACKAGE_SCAN_DEPTH) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.name === 'font-library' && ['resources', 'Resources'].includes(basename(directory))) {
        roots.push(resolve(path));
        continue;
      }
      await walk(path, depth + 1);
    }
  }
  await walk(resolve(searchRoot), 0);
  return roots.sort();
}

export async function verifyPackagedFontLibraryRoot(fontRoot, { approved = APPROVED_FONT_PACK } = {}) {
  const verified = await verifyFontPackRoot(fontRoot, { approved, strictPayload: true });
  const resourcesPath = dirname(fontRoot);
  const resolvedRoot = bundledFontLibrary.resolveBundledFontLibraryRoot({
    appIsPackaged: true,
    resourcesPath,
    appRoot: '/unused-packaged-app-root',
    env: {},
  });
  if (resolvedRoot !== resolve(fontRoot)) {
    throw new Error(`Packaged runtime did not resolve its font-library resource at ${fontRoot}.`);
  }

  const requestUrl = `signal-loom-font://library/${approved.knownFace.file}`;
  const requestedPath = bundledFontLibrary.resolveBundledFontResourcePath(resolvedRoot, requestUrl);
  if (!requestedPath) {
    throw new Error(`Packaged runtime could not request exact face ${approved.knownFace.postscriptName}.`);
  }
  const bytes = await readFile(requestedPath);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== approved.knownFace.sha256) {
    throw new Error(`Packaged exact face ${approved.knownFace.postscriptName} has an unexpected hash.`);
  }

  const licenseRequestUrl = `signal-loom-font://library/${approved.knownLicense.file}`;
  const requestedLicensePath = bundledFontLibrary.resolveBundledFontResourcePath(resolvedRoot, licenseRequestUrl);
  if (!requestedLicensePath) {
    throw new Error(`Packaged runtime could not request the license for ${approved.knownFace.postscriptName}.`);
  }
  const licenseBytes = await readFile(requestedLicensePath);
  const actualLicenseHash = createHash('sha256').update(licenseBytes).digest('hex');
  if (licenseBytes.byteLength !== approved.knownLicense.byteLength
    || actualLicenseHash !== approved.knownLicense.sha256) {
    throw new Error(`Packaged license for ${approved.knownFace.postscriptName} does not match the approved artifact.`);
  }

  return {
    root: resolvedRoot,
    requestUrl,
    requestedPath,
    byteLength: bytes.byteLength,
    sha256: actualHash,
    licenseRequestUrl,
    licenseByteLength: licenseBytes.byteLength,
    licenseSha256: actualLicenseHash,
    checksumCount: verified.checksumCount,
  };
}

export async function smokePackagedFontLibraries(searchRoot, options) {
  const roots = await findPackagedFontLibraryRoots(searchRoot);
  if (!roots.length) {
    throw new Error(`No packaged resources/font-library directory was found under ${resolve(searchRoot)}.`);
  }
  return await Promise.all(roots.map((root) => verifyPackagedFontLibraryRoot(root, options)));
}
