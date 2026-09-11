import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyFontPackRoot } from './font-pack-verification.mjs';
import { createFontPackFixture } from './font-pack-test-fixture.mjs';
import { prepareBundledFontLibrary } from './prepare-bundled-font-library.mjs';
import {
  smokePackagedFontLibraries,
  verifyPackagedFontLibraryRoot,
} from './package-font-library-smoke-lib.mjs';

const temporaryRoots = [];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function rebindInventoryArtifact(root, fixture, field, relativePath) {
  const hash = sha256(readFileSync(join(root, relativePath)));
  const sourceLock = JSON.parse(readFileSync(join(root, 'source-artifact.json'), 'utf8'));
  sourceLock.inventory[field] = hash;
  writeFileSync(join(root, 'source-artifact.json'), `${JSON.stringify(sourceLock, null, 2)}\n`);
  return field === 'fontInventorySha256'
    ? { ...fixture.approved, inventorySha256: hash }
    : { ...fixture.approved, checksumManifestSha256: hash };
}
const tempRoot = (prefix) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe('immutable bundled font artifact verification', () => {
  it('verifies the source lock, inventory identities, manifest, and every staged byte', async () => {
    const root = tempRoot('sloom-font-pack-fixture-');
    const fixture = createFontPackFixture(root);

    const result = await verifyFontPackRoot(root, { approved: fixture.approved });

    expect(result.checksumCount).toBe(5);
    expect(result.knownFace).toEqual(fixture.knownFace);
    expect(result.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a changed source lock and changed font bytes', async () => {
    const lockRoot = tempRoot('sloom-font-pack-lock-');
    const lockFixture = createFontPackFixture(lockRoot);
    const lock = JSON.parse(readFileSync(join(lockRoot, 'source-artifact.json'), 'utf8'));
    lock.googleFonts.commit = 'different-revision';
    writeFileSync(join(lockRoot, 'source-artifact.json'), JSON.stringify(lock));

    await expect(verifyFontPackRoot(lockRoot, { approved: lockFixture.approved }))
      .rejects.toThrow('does not match approved pack');

    const bytesRoot = tempRoot('sloom-font-pack-bytes-');
    const bytesFixture = createFontPackFixture(bytesRoot);
    writeFileSync(join(bytesRoot, bytesFixture.knownFace.file), 'known demo face byteX');
    await expect(verifyFontPackRoot(bytesRoot, { approved: bytesFixture.approved }))
      .rejects.toThrow(`Font integrity check failed for ${bytesFixture.knownFace.file}`);
  });

  it('rejects unsafe checksum paths before reading outside the pack', async () => {
    const root = tempRoot('sloom-font-pack-path-');
    const fixture = createFontPackFixture(root);
    writeFileSync(join(root, 'inventory', 'SHA256SUMS'), `${'a'.repeat(64)}  ../outside.ttf\n`);
    const approved = rebindInventoryArtifact(root, fixture, 'sha256SumsSha256', 'inventory/SHA256SUMS');

    await expect(verifyFontPackRoot(root, { approved }))
      .rejects.toThrow('unsafe path');
  });

  it('requires an exact inventory/checksum bijection, byte lengths, and a declared staged payload', async () => {
    const extraChecksumRoot = tempRoot('sloom-font-pack-extra-checksum-');
    const extraChecksumFixture = createFontPackFixture(extraChecksumRoot);
    writeFileSync(join(extraChecksumRoot, 'collection', 'base', 'extra.txt'), 'extra');
    const extraSums = `${readFileSync(join(extraChecksumRoot, 'inventory', 'SHA256SUMS'), 'utf8')}${'c'.repeat(64)}  collection/base/extra.txt\n`;
    writeFileSync(join(extraChecksumRoot, 'inventory', 'SHA256SUMS'), extraSums);
    const extraChecksumApproved = rebindInventoryArtifact(
      extraChecksumRoot,
      extraChecksumFixture,
      'sha256SumsSha256',
      'inventory/SHA256SUMS',
    );
    await expect(verifyFontPackRoot(extraChecksumRoot, { approved: extraChecksumApproved }))
      .rejects.toThrow('undeclared payload');

    const lengthRoot = tempRoot('sloom-font-pack-length-');
    const lengthFixture = createFontPackFixture(lengthRoot);
    const inventory = JSON.parse(readFileSync(join(lengthRoot, 'inventory', 'font-inventory.json'), 'utf8'));
    inventory.families[1].faces[0].byteLength += 1;
    writeFileSync(join(lengthRoot, 'inventory', 'font-inventory.json'), JSON.stringify(inventory));
    const lengthApproved = rebindInventoryArtifact(
      lengthRoot,
      lengthFixture,
      'fontInventorySha256',
      'inventory/font-inventory.json',
    );
    await expect(verifyFontPackRoot(lengthRoot, { approved: lengthApproved }))
      .rejects.toThrow('Font byte length does not match the inventory');

    const stagedRoot = tempRoot('sloom-font-pack-undeclared-stage-');
    const stagedFixture = createFontPackFixture(stagedRoot);
    writeFileSync(join(stagedRoot, 'undeclared.txt'), 'not in packaged allowlist');
    await expect(verifyFontPackRoot(stagedRoot, {
      approved: stagedFixture.approved,
      strictPayload: true,
    })).rejects.toThrow('undeclared file');
  });

  it('stages only a fully verified pack and re-verifies an apparently current target', async () => {
    const sourceRoot = tempRoot('sloom-font-pack-source-');
    const targetRoot = tempRoot('sloom-font-pack-target-');
    const fixture = createFontPackFixture(sourceRoot);

    const first = await prepareBundledFontLibrary({
      sourceRoot,
      targetRoot,
      verificationOptions: { approved: fixture.approved },
    });
    expect(first.changed).toBe(true);
    expect(readFileSync(join(targetRoot, fixture.knownFace.file), 'utf8')).toBe('known demo face bytes');

    const second = await prepareBundledFontLibrary({
      sourceRoot,
      targetRoot,
      verificationOptions: { approved: fixture.approved },
    });
    expect(second.changed).toBe(false);

    writeFileSync(join(targetRoot, fixture.knownFace.file), 'corrupt staged bytes');
    const repaired = await prepareBundledFontLibrary({
      sourceRoot,
      targetRoot,
      verificationOptions: { approved: fixture.approved },
    });
    expect(repaired.changed).toBe(true);
    await expect(verifyFontPackRoot(targetRoot, { approved: fixture.approved })).resolves.toBeTruthy();
  });

  it('keeps the prior verified target intact when replacement source verification fails', async () => {
    const sourceRoot = tempRoot('sloom-font-pack-atomic-source-');
    const targetRoot = tempRoot('sloom-font-pack-atomic-target-');
    const fixture = createFontPackFixture(sourceRoot);
    await prepareBundledFontLibrary({
      sourceRoot,
      targetRoot,
      verificationOptions: { approved: fixture.approved },
    });
    const originalTargetBytes = readFileSync(join(targetRoot, fixture.knownFace.file));

    writeFileSync(join(sourceRoot, fixture.knownFace.file), 'known demo face byteX');
    await expect(prepareBundledFontLibrary({
      sourceRoot,
      targetRoot,
      verificationOptions: { approved: fixture.approved },
    })).rejects.toThrow('Font integrity check failed');

    expect(readFileSync(join(targetRoot, fixture.knownFace.file))).toEqual(originalTargetBytes);
    expect(existsSync(join(targetRoot, '.source-inventory.sha256'))).toBe(true);
    await expect(verifyFontPackRoot(targetRoot, {
      approved: fixture.approved,
      strictPayload: true,
    })).resolves.toBeTruthy();
  });

  it('supports an exact legacy sibling collection by injecting the tracked immutable lock into staging', async () => {
    const sourceRoot = tempRoot('sloom-font-pack-legacy-source-');
    const targetRoot = tempRoot('sloom-font-pack-legacy-target-');
    const lockRoot = tempRoot('sloom-font-pack-external-lock-');
    const fixture = createFontPackFixture(sourceRoot);
    const externalLock = join(lockRoot, 'source-artifact.json');
    renameSync(join(sourceRoot, 'source-artifact.json'), externalLock);

    await prepareBundledFontLibrary({
      sourceRoot,
      targetRoot,
      verificationOptions: { approved: fixture.approved, sourceLockPath: externalLock },
    });

    expect(existsSync(join(sourceRoot, 'source-artifact.json'))).toBe(false);
    expect(readFileSync(join(targetRoot, 'source-artifact.json'))).toEqual(readFileSync(externalLock));
    await expect(verifyFontPackRoot(targetRoot, {
      approved: fixture.approved,
      strictPayload: true,
    })).resolves.toBeTruthy();
  });
});

describe('packaged exact-face smoke', () => {
  it('finds an unpacked installer resource and requests the known face through the runtime resolver', async () => {
    const sourceRoot = tempRoot('sloom-font-pack-package-source-');
    const releaseRoot = tempRoot('sloom-font-pack-release-');
    const fixture = createFontPackFixture(sourceRoot);
    const packagedRoot = join(releaseRoot, 'linux-unpacked', 'resources', 'font-library');
    cpSync(sourceRoot, packagedRoot, { recursive: true });

    const [result] = await smokePackagedFontLibraries(releaseRoot, { approved: fixture.approved });

    expect(result.requestUrl).toBe(`signal-loom-font://library/${fixture.knownFace.file}`);
    expect(result.sha256).toBe(fixture.knownFace.sha256);
    expect(result.byteLength).toBe(Buffer.byteLength('known demo face bytes'));
    expect(result.licenseRequestUrl).toBe(`signal-loom-font://library/${fixture.knownLicense.file}`);
    expect(result.licenseSha256).toBe(fixture.knownLicense.sha256);
  });

  it('fails when no installer resource exists or its exact face is changed', async () => {
    const emptyRelease = tempRoot('sloom-font-pack-empty-release-');
    await expect(smokePackagedFontLibraries(emptyRelease)).rejects.toThrow('No packaged resources/font-library');

    const sourceRoot = tempRoot('sloom-font-pack-bad-package-source-');
    const fixture = createFontPackFixture(sourceRoot);
    writeFileSync(join(sourceRoot, fixture.knownFace.file), 'known demo face byteX');
    await expect(verifyPackagedFontLibraryRoot(sourceRoot, { approved: fixture.approved }))
      .rejects.toThrow(`Font integrity check failed for ${fixture.knownFace.file}`);
  });
});
