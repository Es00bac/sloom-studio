import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { buildPaperPackageExport } from './paperPackageExport';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import {
  createBinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type {
  PaperDocument,
  PaperManagedFontFace,
  PaperManagedIccProfile,
} from '../types/paper';

/**
 * AUD-004 print-package gate: "Package for print" must contain the actual linked art, exact font
 * files, their license texts, and ICC profiles — with a deterministic digest manifest — and must
 * fail closed on fonts whose rights forbid packaging.
 */

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 21, 22, 23, 24, 25, 26]);
const fontBytesFixture = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 61, 62, 63, 64, 65]);
const licenseBytes = new TextEncoder().encode('SIL OPEN FONT LICENSE Version 1.1 — package fixture');

interface PackagedAssetManifestEntry {
  path: string;
  role: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
}

type PackageManifestWithAssets = Awaited<ReturnType<typeof buildPaperPackageExport>>['manifest'] & {
  packagedAssets?: PackagedAssetManifestEntry[];
};

async function seedRecord(bytes: Uint8Array, mimeType: string, fileName?: string): Promise<BinaryAssetRef> {
  const record = await createBinaryAssetRecord(bytes, { mimeType, ...(fileName ? { fileName } : {}) });
  return paperAssetRepository.put(record);
}

async function wipePaperAssetRepository(): Promise<void> {
  for (const ref of await paperAssetRepository.listRefs()) {
    await paperAssetRepository.delete(ref.id);
  }
}

function managedFace(fontAsset: BinaryAssetRef, overrides: Partial<PaperManagedFontFace> = {}): PaperManagedFontFace {
  return {
    id: `face-${fontAsset.sha256.slice(0, 8)}`,
    familyId: 'package test family',
    familyName: 'Package Test Family',
    postscriptName: 'PackageTestFamily-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x41, end: 0x5a }],
    format: 'truetype',
    fontAsset,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...overrides,
  };
}

function managedIccProfile(asset: BinaryAssetRef): PaperManagedIccProfile {
  return {
    id: asset.id,
    asset,
    description: 'Coated FOGRA39 (ISO 12647-2:2004)',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    source: { kind: 'user-import' },
  };
}

async function buildManagedDocument(overrides: {
  fonts?: PaperManagedFontFace[];
} = {}): Promise<{
  document: PaperDocument;
  refs: { image: BinaryAssetRef; font: BinaryAssetRef; license: BinaryAssetRef; icc: BinaryAssetRef };
}> {
  const image = await seedRecord(imageBytes, 'image/png', 'cover.png');
  const font = await seedRecord(fontBytesFixture, 'font/ttf', 'package-test.ttf');
  const license = await seedRecord(licenseBytes, 'text/plain', 'OFL.txt');
  const icc = await seedRecord(fogra39, 'application/vnd.iccprofile', 'FOGRA39L_coated.icc');

  const base = createDefaultPaperDocument({ title: 'Print Package', preset: 'comic-book' });
  const withFrame = addFrameToPaperPage(base, base.pages[0].id, {
    kind: 'image',
    xMm: 10,
    yMm: 10,
    widthMm: 80,
    heightMm: 100,
    asset: {
      label: 'Cover Art',
      kind: 'image',
      mimeType: 'image/png',
      locator: { kind: 'managed', ref: image },
    },
  } as never).document;

  return {
    document: {
      ...withFrame,
      importedFonts: overrides.fonts ?? [managedFace(font, { license: { id: 'user-license', textAsset: license } })],
      managedIccProfiles: [managedIccProfile(icc)],
    },
    refs: { image, font, license, icc },
  };
}

function expectManifestAndArchiveToAgree(
  exported: Awaited<ReturnType<typeof buildPaperPackageExport>>,
  entries: Record<string, Uint8Array>,
): void {
  const manifestPaths = exported.manifest.files.map((file) => file.path).sort();
  expect(new Set(manifestPaths).size, 'every manifest member needs a unique archive path').toBe(manifestPaths.length);
  expect(Object.keys(entries).sort()).toEqual(manifestPaths);
  expect(exported.entries.slice().sort()).toEqual(manifestPaths);
  for (const file of exported.manifest.files) {
    expect(entries[file.path], `archive must contain ${file.path}`).toBeDefined();
    expect(entries[file.path].byteLength, `${file.path} size must match the manifest`).toBe(file.bytes);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 0x10016); offset -= 1) {
    if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('ZIP fixture has no end-of-central-directory record.');
}

function duplicateFirstCentralDirectoryMember(bytes: Uint8Array): Uint8Array {
  const end = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralOffset = view.getUint32(end + 16, true);
  const nameLength = view.getUint16(centralOffset + 28, true);
  const extraLength = view.getUint16(centralOffset + 30, true);
  const commentLength = view.getUint16(centralOffset + 32, true);
  const memberLength = 46 + nameLength + extraLength + commentLength;
  const duplicate = bytes.slice(centralOffset, centralOffset + memberLength);
  const result = new Uint8Array(bytes.length + duplicate.byteLength);
  result.set(bytes.subarray(0, end), 0);
  result.set(duplicate, end);
  result.set(bytes.subarray(end), end + duplicate.byteLength);
  const resultView = new DataView(result.buffer);
  const newEnd = end + duplicate.byteLength;
  resultView.setUint16(newEnd + 8, view.getUint16(end + 8, true) + 1, true);
  resultView.setUint16(newEnd + 10, view.getUint16(end + 10, true) + 1, true);
  resultView.setUint32(newEnd + 12, view.getUint32(end + 12, true) + duplicate.byteLength, true);
  return result;
}

/** Preserve every local record and EOCD field while reversing only central records. */
function reorderCentralDirectoryMembers(bytes: Uint8Array): Uint8Array {
  const end = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralOffset = view.getUint32(end + 16, true);
  const entryCount = view.getUint16(end + 10, true);
  const members: Uint8Array[] = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    members.push(bytes.slice(offset, nextOffset));
    offset = nextOffset;
  }
  expect(offset).toBe(end);

  const result = bytes.slice();
  offset = centralOffset;
  for (const member of members.reverse()) {
    result.set(member, offset);
    offset += member.byteLength;
  }
  return result;
}

function mutateZipFlags(bytes: Uint8Array): Uint8Array {
  const result = bytes.slice();
  const end = findEndOfCentralDirectory(result);
  const view = new DataView(result.buffer);
  const centralOffset = view.getUint32(end + 16, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  view.setUint16(centralOffset + 8, view.getUint16(centralOffset + 8, true) | 1, true);
  view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) | 1, true);
  return result;
}

function mutateFirstZipCrc(bytes: Uint8Array, localOnly = false): Uint8Array {
  const result = bytes.slice();
  const end = findEndOfCentralDirectory(result);
  const view = new DataView(result.buffer);
  const centralOffset = view.getUint32(end + 16, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  const forged = view.getUint32(centralOffset + 16, true) ^ 0xffff_ffff;
  view.setUint32(localOffset + 14, forged, true);
  if (!localOnly) view.setUint32(centralOffset + 16, forged, true);
  return result;
}

function declareZipBombSize(bytes: Uint8Array): Uint8Array {
  const result = bytes.slice();
  const end = findEndOfCentralDirectory(result);
  const view = new DataView(result.buffer);
  const centralOffset = view.getUint32(end + 16, true);
  view.setUint32(centralOffset + 24, 0x7fff_ffff, true);
  return result;
}

function portablePathKey(path: string): string {
  return path.normalize('NFKC').toLocaleLowerCase('en-US');
}

afterEach(async () => {
  await wipePaperAssetRepository();
});

describe('paperPackageExport managed asset payloads (AUD-004)', () => {
  it('packages the actual linked art, exact fonts, license texts, and ICC profiles as usable files', async () => {
    const { document, refs } = await buildManagedDocument();

    const exported = await buildPaperPackageExport(document, []);
    const manifest = exported.manifest as PackageManifestWithAssets;
    const packaged = manifest.packagedAssets ?? [];
    expect(packaged.length).toBeGreaterThanOrEqual(4);
    expect(packaged.map((entry) => entry.path)).toEqual([...packaged.map((entry) => entry.path)].sort());

    const bySha = new Map(packaged.map((entry) => [entry.sha256, entry]));
    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));

    const expectations: Array<{ ref: BinaryAssetRef; bytes: Uint8Array; prefix: RegExp; role: string }> = [
      { ref: refs.image, bytes: imageBytes, prefix: /^Links\//, role: 'image' },
      { ref: refs.font, bytes: fontBytesFixture, prefix: /^Fonts\//, role: 'font' },
      { ref: refs.license, bytes: licenseBytes, prefix: /^Fonts\/Licenses\//, role: 'font-license' },
      { ref: refs.icc, bytes: fogra39, prefix: /^Profiles\//, role: 'icc-profile' },
    ];
    for (const expectation of expectations) {
      const entry = bySha.get(expectation.ref.sha256);
      expect(entry, `packagedAssets must list ${expectation.role}`).toBeDefined();
      expect(entry!.path).toMatch(expectation.prefix);
      expect(entry!.path).toContain(expectation.ref.sha256.slice(0, 12));
      expect(entry!.byteLength).toBe(expectation.ref.byteLength);
      expect(entry!.role).toBe(expectation.role);
      expect(entries[entry!.path], `ZIP must contain ${entry!.path}`).toBeDefined();
      expect(new Uint8Array(entries[entry!.path])).toEqual(expectation.bytes);
      expect(exported.entries).toContain(entry!.path);
    }

    // The pre-existing inventory surface stays intact.
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      'document.sloom-paper.json',
      'preflight-report.json',
      'manifest.json',
    ]));
    expect(manifest.files.map((file) => file.path)).toEqual(expect.arrayContaining(packaged.map((entry) => entry.path)));
  });

  it('produces deterministic package entry names across identical builds', async () => {
    const { document } = await buildManagedDocument();

    const first = await buildPaperPackageExport(document, []);
    const second = await buildPaperPackageExport(document, []);
    expect(first.entries).toEqual(second.entries);
    const firstAssets = (first.manifest as PackageManifestWithAssets).packagedAssets ?? [];
    const secondAssets = (second.manifest as PackageManifestWithAssets).packagedAssets ?? [];
    expect(firstAssets).toEqual(secondAssets);
  });

  it('packages a data-URL linked Source Library image as a real file while keeping metadata clean', async () => {
    const item: SourceBinLibraryItem = {
      id: 'source-data-image',
      label: 'Linked Panel',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: `data:image/png;base64,${Buffer.from(imageBytes).toString('base64')}`,
      createdAt: 1,
    } as SourceBinLibraryItem;
    const base = createDefaultPaperDocument({ title: 'Linked Package' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 5,
      yMm: 5,
      widthMm: 50,
      heightMm: 50,
      asset: { sourceBinItemId: item.id, label: item.label, kind: 'image' },
    } as never);

    const exported = await buildPaperPackageExport(document, [item]);
    const manifest = exported.manifest as PackageManifestWithAssets;
    const packaged = (manifest.packagedAssets ?? []).filter((entry) => entry.path.startsWith('Links/'));
    expect(packaged).toHaveLength(1);

    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(new Uint8Array(entries[packaged[0].path])).toEqual(imageBytes);
    // Metadata JSON entries must stay free of runtime data URLs.
    expect(new TextDecoder().decode(entries['Links/Linked-Panel.json'])).not.toMatch(/data:image/);
  });

  it('fails closed with an actionable diagnostic when a packaged font face forbids redistribution', async () => {
    const restrictedFont = await seedRecord(Uint8Array.from([0, 1, 0, 0, 77, 78, 79]), 'font/ttf', 'restricted.ttf');
    const { document } = await buildManagedDocument({
      fonts: [managedFace(restrictedFont, {
        id: 'face-restricted-package',
        familyId: 'restricted package family',
        familyName: 'Restricted Package Family',
        postscriptName: 'RestrictedPackage-Regular',
        embeddability: 'restricted',
      })],
    });

    await expect(
      Promise.resolve().then(() => buildPaperPackageExport(document, [])),
    ).rejects.toThrow(/Restricted Package Family/);
    await expect(
      Promise.resolve().then(() => buildPaperPackageExport(document, [])),
    ).rejects.toThrow(/restrict/i);
  });

  it('fails closed when a reachable managed record is missing instead of packaging inventories that lie', async () => {
    const { document, refs } = await buildManagedDocument();
    await paperAssetRepository.delete(refs.image.id);

    await expect(
      Promise.resolve().then(() => buildPaperPackageExport(document, [])),
    ).rejects.toThrow(new RegExp(refs.image.sha256.slice(0, 12)));
  });

  it('reserves a unique path when a crafted binary member name collides with link metadata', async () => {
    const binary = await seedRecord(Uint8Array.from([123, 34, 125]), 'application/json', 'placed.json');
    const base = createDefaultPaperDocument({ title: 'Binary/metadata collision' });
    const first = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 5,
      yMm: 5,
      widthMm: 20,
      heightMm: 20,
      asset: { label: 'Collision', kind: 'image', locator: { kind: 'managed', ref: binary } },
    } as never).document;
    const craftedLabel = `Collision-${binary.sha256.slice(0, 12)}`;
    const { document } = addFrameToPaperPage(first, first.pages[0].id, {
      kind: 'image',
      xMm: 30,
      yMm: 5,
      widthMm: 20,
      heightMm: 20,
      asset: { sourceBinItemId: 'external-metadata', label: craftedLabel, kind: 'image' },
    } as never);
    const external: SourceBinLibraryItem = {
      id: 'external-metadata',
      label: craftedLabel,
      kind: 'image',
      mimeType: 'application/json',
      assetUrl: 'https://example.test/external.json',
      createdAt: 1,
    } as SourceBinLibraryItem;

    const exported = await buildPaperPackageExport(document, [external]);
    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));

    expect(exported.manifest.packagedAssets).toHaveLength(1);
    expectManifestAndArchiveToAgree(exported, entries);
  });

  it('allocates distinct deterministic metadata paths for duplicate link labels', async () => {
    const base = createDefaultPaperDocument({ title: 'Duplicate link labels' });
    const first = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 5,
      yMm: 5,
      widthMm: 20,
      heightMm: 20,
      asset: { sourceBinItemId: 'external-one', label: 'Repeated Link', kind: 'image' },
    } as never).document;
    const { document } = addFrameToPaperPage(first, first.pages[0].id, {
      kind: 'image',
      xMm: 30,
      yMm: 5,
      widthMm: 20,
      heightMm: 20,
      asset: { sourceBinItemId: 'external-two', label: 'Repeated Link', kind: 'image' },
    } as never);
    const sourceItems = ['external-one', 'external-two'].map((id) => ({
      id,
      label: 'Repeated Link',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: `https://example.test/${id}.png`,
      createdAt: 1,
    } as SourceBinLibraryItem));

    const firstExport = await buildPaperPackageExport(document, sourceItems);
    const secondExport = await buildPaperPackageExport(document, sourceItems);
    const entries = unzipSync(new Uint8Array(await firstExport.blob.arrayBuffer()));

    expectManifestAndArchiveToAgree(firstExport, entries);
    expect(firstExport.entries).toEqual(secondExport.entries);
  });

  it('reserves paths in a portable NFKC case-folded namespace, including Windows-reserved labels', async () => {
    const labels = [
      'Repeated',
      'repeated',
      'Asset',
      'Ａｓｓｅｔ',
      'CON. ',
      'trailing dot...   ',
      '../control\\\u0000name',
      `${'long-label-'.repeat(400)}.tiff`,
    ];
    let document = createDefaultPaperDocument({ title: 'Portable paths' });
    const sourceItems: SourceBinLibraryItem[] = [];
    for (const [index, label] of labels.entries()) {
      const id = `portable-${index}`;
      document = addFrameToPaperPage(document, document.pages[0].id, {
        kind: 'image',
        xMm: 5 + index * 2,
        yMm: 5,
        widthMm: 10,
        heightMm: 10,
        asset: { sourceBinItemId: id, label, kind: 'image' },
      } as never).document;
      sourceItems.push({
        id,
        label,
        kind: 'image',
        mimeType: 'image/tiff',
        assetUrl: `https://example.test/${id}.tiff`,
        createdAt: 1,
      } as SourceBinLibraryItem);
    }

    const exported = await buildPaperPackageExport(document, sourceItems);
    const keys = exported.entries.map(portablePathKey);
    const repeatedPaths = exported.entries.filter((path) => /^Links\/repeated(?:-\d+)?\.json$/i.test(path));

    expect(new Set(keys).size, 'portable extractors must not collide by case or Unicode normalization').toBe(keys.length);
    expect(repeatedPaths).toHaveLength(2);
    expect(exported.entries.some((path) => /(?:^|\/)CON(?:\.|$)/i.test(path))).toBe(false);
    for (const path of exported.entries) {
      expect(new TextEncoder().encode(path).byteLength).toBeLessThanOrEqual(240);
      expect(path.split('/').every((segment) => !/[. ]$/.test(segment))).toBe(true);
      expect(path.split('/')).not.toContain('..');
    }
  });

  it('bounds hostile labels so the ZIP remains self-contained and its paths stay safe', async () => {
    const binary = await seedRecord(Uint8Array.from([1, 2, 3, 4]), 'image/png', 'art.png');
    const hostileLabel = `  ../\\\u0000\u0001日本語/😀 ${'very-long-'.repeat(8_000)}  `;
    const base = createDefaultPaperDocument({ title: hostileLabel });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 5,
      yMm: 5,
      widthMm: 20,
      heightMm: 20,
      asset: { label: hostileLabel, kind: 'image', locator: { kind: 'managed', ref: binary } },
    } as never);

    const exported = await buildPaperPackageExport(document, []);
    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));

    expect(exported.mimeType).toBe('application/zip');
    expect(exported.fileName).toMatch(/\.zip$/);
    expectManifestAndArchiveToAgree(exported, entries);
    for (const path of Object.keys(entries)) {
      expect(new TextEncoder().encode(path).byteLength).toBeLessThanOrEqual(240);
      expect([...path].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return character === '\\' || codePoint <= 0x1f || codePoint === 0x7f;
      })).toBe(false);
      expect(path.split('/')).not.toContain('..');
    }
  });

  it('fails honestly when ZIP construction itself fails instead of returning a JSON package that claims embedded files', async () => {
    const { document } = await buildManagedDocument();
    const forcedZipFailure = {
      zip: () => { throw new Error('forced ZIP failure'); },
    } as unknown as Parameters<typeof buildPaperPackageExport>[2];

    await expect(buildPaperPackageExport(document, [], forcedZipFailure)).rejects.toThrow(/no file was downloaded/i);
  });

  it.each([
    ['empty bytes', () => new Uint8Array()],
    ['truncated ZIP', (entries: Record<string, Uint8Array>) => zipSync(entries).slice(0, -1)],
    ['missing manifest', (entries: Record<string, Uint8Array>) => {
      const { 'manifest.json': _manifest, ...withoutManifest } = entries;
      return zipSync(withoutManifest);
    }],
    ['invalid manifest JSON', (entries: Record<string, Uint8Array>) => zipSync({ ...entries, 'manifest.json': strToU8('{not json') })],
    ['altered requested member', (entries: Record<string, Uint8Array>) => {
      const document = entries['document.sloom-paper.json'].slice();
      document[0] ^= 1;
      return zipSync({ ...entries, 'document.sloom-paper.json': document });
    }],
    ['extra member', (entries: Record<string, Uint8Array>) => zipSync({ ...entries, 'unexpected.txt': strToU8('not requested') })],
    ['duplicate member', (entries: Record<string, Uint8Array>) => duplicateFirstCentralDirectoryMember(zipSync(entries))],
    ['central-directory records reordered relative to valid local records', (entries: Record<string, Uint8Array>) => reorderCentralDirectoryMembers(zipSync(entries))],
    ['encrypted member', (entries: Record<string, Uint8Array>) => mutateZipFlags(zipSync(entries))],
    ['zip-bomb-like declared member size', (entries: Record<string, Uint8Array>) => declareZipBombSize(zipSync(entries))],
    ['matching forged local and central CRC', (entries: Record<string, Uint8Array>) => mutateFirstZipCrc(zipSync(entries))],
    ['local and central CRC disagreement', (entries: Record<string, Uint8Array>) => mutateFirstZipCrc(zipSync(entries), true)],
    ['valid but non-parity manifest', (entries: Record<string, Uint8Array>) => {
      const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>;
      return zipSync({ ...entries, 'manifest.json': strToU8(JSON.stringify({ ...manifest, title: 'forged package manifest' })) });
    }],
  ])('rejects %s returned by a compressor before callers can download or report success', async (_label, zip) => {
    const { document } = await buildManagedDocument();

    await expect(buildPaperPackageExport(document, [], { zip })).rejects.toThrow(/no file was downloaded/i);
  });
});
