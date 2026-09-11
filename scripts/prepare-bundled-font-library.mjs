#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FONT_PACK_METADATA_FILES, verifyFontPackRoot } from './font-pack-verification.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const defaultSourceRoot = resolve(projectRoot, '..', 'fonts');
const acquiredSourceRoot = resolve(projectRoot, 'build', 'font-pack-source');
const defaultTargetRoot = resolve(projectRoot, 'build', 'font-library');
const trackedSourceLockPath = resolve(projectRoot, 'resources', 'font-pack', 'source-artifact.json');

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function targetIsCurrent(targetRoot, signature, verificationOptions) {
  try {
    const marker = (await readFile(join(targetRoot, '.source-inventory.sha256'), 'utf8')).trim();
    if (marker !== signature) return false;
    const verified = await verifyFontPackRoot(targetRoot, { ...verificationOptions, strictPayload: true });
    return verified.signature === signature;
  } catch {
    return false;
  }
}

export async function prepareBundledFontLibrary({
  sourceRoot,
  targetRoot = defaultTargetRoot,
  verificationOptions,
} = {}) {
  const {
    sourceLockPath: requestedSourceLockPath,
    ...targetVerificationOptions
  } = verificationOptions ?? {};
  const resolvedSourceRoot = resolve(sourceRoot
    || process.env.SLOOM_FONT_PACK_DIR
    || (await exists(acquiredSourceRoot) ? acquiredSourceRoot : defaultSourceRoot));
  const embeddedSourceLock = join(resolvedSourceRoot, 'source-artifact.json');
  const sourceVerificationOptions = {
    ...targetVerificationOptions,
    strictPayload: false,
    ...(!(await exists(embeddedSourceLock))
      ? { sourceLockPath: requestedSourceLockPath || trackedSourceLockPath }
      : {}),
  };
  let source;
  try {
    source = await verifyFontPackRoot(resolvedSourceRoot, sourceVerificationOptions);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No approved Sloom font pack was verified at ${resolvedSourceRoot}. ${detail}`);
  }

  if (await targetIsCurrent(targetRoot, source.signature, targetVerificationOptions)) {
    return { changed: false, root: targetRoot, ...source };
  }

  const parent = dirname(targetRoot);
  const transaction = randomUUID();
  const stagingRoot = join(parent, `.${targetRoot.split(/[\\/]/).pop()}.staging-${transaction}`);
  const previousRoot = join(parent, `.${targetRoot.split(/[\\/]/).pop()}.previous-${transaction}`);
  await mkdir(stagingRoot, { recursive: true });
  try {
    for (const relativePath of [...FONT_PACK_METADATA_FILES, ...source.checksumPaths]) {
      const destination = join(stagingRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      const sourcePath = relativePath === 'source-artifact.json'
        ? source.sourceLockPath
        : join(resolvedSourceRoot, relativePath);
      await cp(sourcePath, destination, {
        force: true,
        preserveTimestamps: true,
      });
    }
    await writeFile(join(stagingRoot, '.source-inventory.sha256'), `${source.signature}\n`, 'utf8');
    const staged = await verifyFontPackRoot(stagingRoot, { ...targetVerificationOptions, strictPayload: true });
    if (staged.signature !== source.signature) {
      throw new Error('Staged font pack signature does not match its verified source.');
    }
    const hadPrevious = await exists(targetRoot);
    if (hadPrevious) await rename(targetRoot, previousRoot);
    try {
      await rename(stagingRoot, targetRoot);
    } catch (error) {
      if (hadPrevious && !(await exists(targetRoot)) && await exists(previousRoot)) {
        await rename(previousRoot, targetRoot);
      }
      throw error;
    }
    if (hadPrevious) await rm(previousRoot, { recursive: true, force: true });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return { changed: true, root: targetRoot, ...source };
}

async function main() {
  const result = await prepareBundledFontLibrary();
  process.stdout.write(result.changed
    ? `Prepared 116 families / 430 faces at ${result.root}\n`
    : `Bundled font library is current: ${result.root}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
