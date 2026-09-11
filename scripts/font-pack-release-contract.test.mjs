import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APPROVED_FONT_PACK } from './font-pack-verification.mjs';

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const sourceLock = JSON.parse(readFileSync(join(process.cwd(), 'resources', 'font-pack', 'source-artifact.json'), 'utf8'));
const acquisitionScript = readFileSync(join(process.cwd(), 'scripts', 'acquire-bundled-font-library.sh'), 'utf8');
const releaseWorkflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');
const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe('desktop release font artifact contract', () => {
  it('keeps the acquisition recipe and package-smoke identity pinned to the audited font pack', () => {
    expect(sourceLock).toMatchObject({
      fontPackRevision: APPROVED_FONT_PACK.revision,
      googleFonts: {
        repository: APPROVED_FONT_PACK.googleFontsRepository,
        commit: APPROVED_FONT_PACK.googleFontsCommit,
      },
      liberationFonts: {
        version: APPROVED_FONT_PACK.liberationVersion,
        sha256: APPROVED_FONT_PACK.liberationSha256,
      },
      mplusLicense: {
        commit: APPROVED_FONT_PACK.mplusLicenseCommit,
        sha256: APPROVED_FONT_PACK.mplusLicenseSha256,
      },
      packageSmokeFace: APPROVED_FONT_PACK.knownFace,
      packageSmokeLicense: APPROVED_FONT_PACK.knownLicense,
    });
    expect(acquisitionScript).toContain(`GOOGLE_FONTS_SHA=\${GOOGLE_FONTS_SHA:-${APPROVED_FONT_PACK.googleFontsCommit}}`);
    expect(acquisitionScript).toContain(`LIBERATION_VERSION=${APPROVED_FONT_PACK.liberationVersion}`);
    expect(acquisitionScript).toContain(`LIBERATION_SHA256=${APPROVED_FONT_PACK.liberationSha256}`);
    expect(acquisitionScript).toContain(`MPLUS_LICENSE_COMMIT=${APPROVED_FONT_PACK.mplusLicenseCommit}`);
    expect(acquisitionScript).toContain(`MPLUS_LICENSE_SHA256=${APPROVED_FONT_PACK.mplusLicenseSha256}`);
  });

  it('makes a verified staged font pack mandatory for every direct electron-builder invocation', async () => {
    expect(packageJson.build.beforePack).toBe('scripts/electron-builder-before-pack.cjs');
    expect(packageJson.build.afterPack).toBe('scripts/electron-builder-after-pack.cjs');
    expect(packageJson.build.extraResources).toContainEqual(expect.objectContaining({
      from: 'build/font-library',
      to: 'font-library',
      filter: expect.arrayContaining(['source-artifact.json', 'inventory/SHA256SUMS', 'collection/**/*']),
    }));

    const missingProject = mkdtempSync(join(tmpdir(), 'sloom-font-before-pack-'));
    temporaryRoots.push(missingProject);
    const beforePack = require('./electron-builder-before-pack.cjs');
    await expect(beforePack({ packager: { projectDir: missingProject } })).rejects.toThrow('Font pack file is missing');

    const afterPack = require('./electron-builder-after-pack.cjs');
    await expect(afterPack({})).rejects.toThrow('application output directory');
  });

  it('builds one verified CI artifact and requires it in every desktop package lane', () => {
    expect(releaseWorkflow).toContain('font-pack:');
    expect(releaseWorkflow).toContain('npm run acquire:font-library');
    expect(releaseWorkflow).toContain('npm run prepare:font-library');
    expect(releaseWorkflow).toContain('npm run verify:font-library');
    expect(releaseWorkflow).toContain(`sloom-font-pack-${APPROVED_FONT_PACK.revision}`);
    expect(releaseWorkflow).toContain('needs: font-pack');
    expect(releaseWorkflow).toContain('npm run smoke:packaged-font-library -- release');
    expect(releaseWorkflow.match(/if-no-files-found: error/g)?.length).toBeGreaterThanOrEqual(2);
    expect(releaseWorkflow).not.toContain('../fonts');
    expect(releaseWorkflow).not.toContain('/home/cabewse');
  });
});
