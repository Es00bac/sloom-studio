import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function createFontPackFixture(root) {
  const metadata = {
    'README.md': 'fixture font pack\n',
    'DISTRIBUTION.md': 'fixture distribution terms\n',
    'catalog/families.tsv': 'collection\tfamily\tslug\n',
    'inventory/README.md': 'fixture inventory\n',
  };
  const files = new Map([
    ['collection/base/demo/Demo-Regular.ttf', Buffer.from('known demo face bytes')],
    ['collection/base/demo/Demo-Bold.ttf', Buffer.from('demo bold face bytes')],
    ['collection/base/demo/OFL.txt', Buffer.from('demo license')],
    ['collection/base/other/Other-Regular.ttf', Buffer.from('other regular face bytes')],
    ['collection/base/other/OFL.txt', Buffer.from('other license')],
  ]);
  const knownFace = {
    family: 'Demo',
    subfamily: 'Regular',
    postscriptName: 'Demo-Regular',
    file: 'collection/base/demo/Demo-Regular.ttf',
    sha256: sha256(files.get('collection/base/demo/Demo-Regular.ttf')),
  };
  const knownLicense = {
    file: 'collection/base/demo/OFL.txt',
    sha256: sha256(files.get('collection/base/demo/OFL.txt')),
    byteLength: files.get('collection/base/demo/OFL.txt').byteLength,
  };
  const face = (file, family, subfamily, postscriptName) => ({
    file,
    family,
    subfamily,
    postscriptName,
    sha256: sha256(files.get(file)),
    byteLength: files.get(file).byteLength,
  });
  const license = (file) => ({
    file,
    sha256: sha256(files.get(file)),
    byteLength: files.get(file).byteLength,
  });
  const inventory = {
    catalogFamilyCount: 2,
    fontFileCount: 3,
    faceCount: 3,
    criticalErrorCount: 0,
    families: [
      {
        family: 'Demo',
        faces: [
          face(knownFace.file, 'Demo', 'Regular', 'Demo-Regular'),
          face('collection/base/demo/Demo-Bold.ttf', 'Demo', 'Bold', 'Demo-Bold'),
        ],
        licenses: [license('collection/base/demo/OFL.txt')],
      },
      {
        family: 'Other',
        faces: [face('collection/base/other/Other-Regular.ttf', 'Other', 'Regular', 'Other-Regular')],
        licenses: [license('collection/base/other/OFL.txt')],
      },
    ],
  };
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const sumsBytes = [...files]
    .map(([file, bytes]) => `${sha256(bytes)}  ${file}`)
    .join('\n') + '\n';
  const approved = {
    revision: 'fixture-font-pack-revision',
    googleFontsRepository: 'https://github.com/example/fonts.git',
    googleFontsCommit: 'fixture-google-fonts-commit',
    liberationVersion: 'fixture-liberation-version',
    liberationSha256: 'a'.repeat(64),
    mplusLicenseCommit: 'fixture-mplus-license-commit',
    mplusLicenseSha256: 'b'.repeat(64),
    catalogFamilyCount: 2,
    faceCount: 3,
    inventorySha256: sha256(inventoryBytes),
    checksumManifestSha256: sha256(sumsBytes),
    metadataSha256: Object.fromEntries(Object.entries(metadata).map(([path, bytes]) => [path, sha256(bytes)])),
    knownFace,
    knownLicense,
  };
  const sourceLock = {
    schemaVersion: 1,
    fontPackRevision: approved.revision,
    googleFonts: { repository: approved.googleFontsRepository, commit: approved.googleFontsCommit },
    liberationFonts: { version: approved.liberationVersion, sha256: approved.liberationSha256 },
    mplusLicense: { commit: approved.mplusLicenseCommit, sha256: approved.mplusLicenseSha256 },
    inventory: {
      catalogFamilyCount: 2,
      faceCount: 3,
      criticalErrorCount: 0,
      fontInventorySha256: approved.inventorySha256,
      sha256SumsSha256: approved.checksumManifestSha256,
    },
    metadataSha256: approved.metadataSha256,
    packageSmokeFace: knownFace,
    packageSmokeLicense: knownLicense,
  };

  for (const [relativePath, bytes] of files) {
    mkdirSync(join(root, relativePath, '..'), { recursive: true });
    writeFileSync(join(root, relativePath), bytes);
  }
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, 'inventory'), { recursive: true });
  writeFileSync(join(root, 'README.md'), metadata['README.md']);
  writeFileSync(join(root, 'DISTRIBUTION.md'), metadata['DISTRIBUTION.md']);
  writeFileSync(join(root, 'source-artifact.json'), `${JSON.stringify(sourceLock, null, 2)}\n`);
  writeFileSync(join(root, 'catalog', 'families.tsv'), metadata['catalog/families.tsv']);
  writeFileSync(join(root, 'inventory', 'README.md'), metadata['inventory/README.md']);
  writeFileSync(join(root, 'inventory', 'font-inventory.json'), inventoryBytes);
  writeFileSync(join(root, 'inventory', 'SHA256SUMS'), sumsBytes);
  return { approved, files, inventory, knownFace, knownLicense, sourceLock };
}
