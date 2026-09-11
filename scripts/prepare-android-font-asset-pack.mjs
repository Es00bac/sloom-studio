#!/usr/bin/env node

import { copyFile, link, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBundledFontLibrary } from './prepare-bundled-font-library.mjs';
import { verifyFontPackRoot } from './font-pack-verification.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sourceRoot = resolve(projectRoot, 'build', 'font-library');
const assetsRoot = resolve(projectRoot, 'android', 'sloom_fonts', 'src', 'main', 'assets');
const targetRoot = resolve(assetsRoot, 'library');
const stagingRoot = resolve(assetsRoot, '.library-staging');

async function mirrorWithHardLinks(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await mirrorWithHardLinks(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported font-pack entry: ${sourcePath}`);
    try {
      await link(sourcePath, targetPath);
    } catch (error) {
      if (error?.code !== 'EXDEV' && error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function isCurrent() {
  try {
    const [sourceMarker, targetMarker, targetStat] = await Promise.all([
      readFile(join(sourceRoot, '.source-inventory.sha256'), 'utf8'),
      readFile(join(targetRoot, '.source-inventory.sha256'), 'utf8'),
      lstat(targetRoot),
    ]);
    if (!targetStat.isDirectory() || sourceMarker.trim() !== targetMarker.trim()) return false;
    const verified = await verifyFontPackRoot(targetRoot, { strictPayload: true });
    return verified.signature === sourceMarker.trim();
  } catch {
    return false;
  }
}

async function main() {
  await prepareBundledFontLibrary();
  await mkdir(assetsRoot, { recursive: true });
  if (await isCurrent()) {
    process.stdout.write(`Android font asset pack is current: ${targetRoot}\n`);
    return;
  }
  await rm(stagingRoot, { recursive: true, force: true });
  await mirrorWithHardLinks(sourceRoot, stagingRoot);
  await rm(targetRoot, { recursive: true, force: true });
  await rename(stagingRoot, targetRoot);
  process.stdout.write(`Prepared Android on-demand font asset pack at ${targetRoot}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
