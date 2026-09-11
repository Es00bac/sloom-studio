import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  createBinaryAssetRecord,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../assets/contentAddressedAsset';
import {
  DEFAULT_ASSET_CONTAINER_LIMITS,
  packValidatedAssetContainer,
  unpackValidatedAssetContainer,
  type AssetContainerLimits,
} from './ValidatedAssetContainer';

const manifest = (assets: BinaryAssetRef[] = []) => ({
  format: 'paper-test',
  formatVersion: 2,
  kind: 'paper',
  document: { title: 'Bounded test' },
  assets,
  futureField: { retained: true },
});

function zipWithManifest(value: unknown, entries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(value)),
    ...entries,
  });
}

function assetPath(ref: BinaryAssetRef, extension = 'png'): string {
  return `assets/${ref.sha256}.${extension}`;
}

function withLimits(overrides: Partial<AssetContainerLimits>): AssetContainerLimits {
  return { ...DEFAULT_ASSET_CONTAINER_LIMITS, ...overrides };
}

function replaceAllAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  expect(to).toHaveLength(from.length);
  const output = new Uint8Array(bytes);
  const source = strToU8(from);
  const replacement = strToU8(to);
  let replacements = 0;

  for (let offset = 0; offset <= output.length - source.length; offset += 1) {
    if (source.every((value, index) => output[offset + index] === value)) {
      output.set(replacement, offset);
      replacements += 1;
      offset += source.length - 1;
    }
  }

  expect(replacements).toBe(2);
  return output;
}

function setCentralUncompressedSize(bytes: Uint8Array, size: number): Uint8Array {
  const output = new Uint8Array(bytes);
  let centralHeader = -1;
  output.forEach((value, index) => {
    if (
      value === 0x50
      && output[index + 1] === 0x4b
      && output[index + 2] === 0x01
      && output[index + 3] === 0x02
    ) {
      centralHeader = index;
    }
  });
  expect(centralHeader).toBeGreaterThan(-1);
  new DataView(output.buffer, output.byteOffset, output.byteLength)
    .setUint32(centralHeader + 24, size, true);
  return output;
}

interface ZipEntryHeaderOffsets {
  local: number;
  central: number;
}

function findZipEntryHeaderOffsets(bytes: Uint8Array, path: string): ZipEntryHeaderOffsets {
  const pathBytes = strToU8(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let local = -1;
  let central = -1;

  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    const signature = view.getUint32(offset, true);
    const isLocal = signature === 0x04034b50;
    const isCentral = signature === 0x02014b50;
    if (!isLocal && !isCentral) continue;

    const nameLengthOffset = offset + (isLocal ? 26 : 28);
    const nameOffset = offset + (isLocal ? 30 : 46);
    if (nameLengthOffset + 2 > bytes.byteLength) continue;
    const nameLength = view.getUint16(nameLengthOffset, true);
    if (nameLength !== pathBytes.byteLength || nameOffset + nameLength > bytes.byteLength) continue;
    if (!pathBytes.every((value, index) => bytes[nameOffset + index] === value)) continue;

    if (isLocal) local = offset;
    else central = offset;
  }

  expect(local).toBeGreaterThanOrEqual(0);
  expect(central).toBeGreaterThanOrEqual(0);
  return { local, central };
}

function forgeZipEntrySizes(
  bytes: Uint8Array,
  path: string,
  sizes: { compressed?: number; uncompressed?: number },
): Uint8Array {
  const output = new Uint8Array(bytes);
  const offsets = findZipEntryHeaderOffsets(output, path);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  if (sizes.compressed !== undefined) {
    view.setUint32(offsets.local + 18, sizes.compressed, true);
    view.setUint32(offsets.central + 20, sizes.compressed, true);
  }
  if (sizes.uncompressed !== undefined) {
    view.setUint32(offsets.local + 22, sizes.uncompressed, true);
    view.setUint32(offsets.central + 24, sizes.uncompressed, true);
  }
  return output;
}

function appendZipEntryCompressedData(
  bytes: Uint8Array,
  path: string,
  trailing: Uint8Array,
): Uint8Array {
  const offsets = findZipEntryHeaderOffsets(bytes, path);
  const sourceView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = sourceView.getUint16(offsets.local + 26, true);
  const extraLength = sourceView.getUint16(offsets.local + 28, true);
  const compressedSize = sourceView.getUint32(offsets.local + 18, true);
  const dataEnd = offsets.local + 30 + nameLength + extraLength + compressedSize;
  const endRecord = bytes.byteLength - 22;
  expect(sourceView.getUint32(endRecord, true)).toBe(0x06054b50);
  const centralDirectoryOffset = sourceView.getUint32(endRecord + 16, true);
  expect(dataEnd).toBe(centralDirectoryOffset);

  const output = new Uint8Array(bytes.byteLength + trailing.byteLength);
  output.set(bytes.subarray(0, dataEnd));
  output.set(trailing, dataEnd);
  output.set(bytes.subarray(dataEnd), dataEnd + trailing.byteLength);

  const outputView = new DataView(output.buffer);
  const nextCompressedSize = compressedSize + trailing.byteLength;
  const nextCentralOffset = offsets.central + trailing.byteLength;
  const nextEndRecord = endRecord + trailing.byteLength;
  outputView.setUint32(offsets.local + 18, nextCompressedSize, true);
  outputView.setUint32(nextCentralOffset + 20, nextCompressedSize, true);
  outputView.setUint32(nextEndRecord + 16, centralDirectoryOffset + trailing.byteLength, true);
  return output;
}

function findEndRecord(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 0x10016); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('ZIP fixture has no end record.');
}

function setMatchingEntryCrc(bytes: Uint8Array, path: string, crc: number): Uint8Array {
  const output = bytes.slice();
  const offsets = findZipEntryHeaderOffsets(output, path);
  const view = new DataView(output.buffer);
  view.setUint32(offsets.local + 14, crc, true);
  view.setUint32(offsets.central + 16, crc, true);
  return output;
}

function insertBeforeCentralDirectory(bytes: Uint8Array, inserted: Uint8Array): Uint8Array {
  const end = findEndRecord(bytes);
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = source.getUint32(end + 16, true);
  const output = new Uint8Array(bytes.byteLength + inserted.byteLength);
  output.set(bytes.subarray(0, central));
  output.set(inserted, central);
  output.set(bytes.subarray(central), central + inserted.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(end + inserted.byteLength + 16, central + inserted.byteLength, true);
  return output;
}

function prependUnreferencedBytes(bytes: Uint8Array, prefix: Uint8Array): Uint8Array {
  const end = findEndRecord(bytes);
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = source.getUint32(end + 16, true);
  const entries = source.getUint16(end + 10, true);
  const output = new Uint8Array(bytes.byteLength + prefix.byteLength);
  output.set(prefix);
  output.set(bytes, prefix.byteLength);
  const view = new DataView(output.buffer);
  let offset = central + prefix.byteLength;
  for (let index = 0; index < entries; index += 1) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    view.setUint32(offset + 42, view.getUint32(offset + 42, true) + prefix.byteLength, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  view.setUint32(end + prefix.byteLength + 16, central + prefix.byteLength, true);
  return output;
}

function addEocdComment(bytes: Uint8Array): Uint8Array {
  const end = findEndRecord(bytes);
  const output = new Uint8Array(bytes.byteLength + 1);
  output.set(bytes);
  output[output.byteLength - 1] = 0x21;
  new DataView(output.buffer).setUint16(end + 20, 1, true);
  return output;
}

/** Preserve all local records and EOCD fields while reversing only central records. */
function reorderCentralDirectoryMembers(bytes: Uint8Array): Uint8Array {
  const end = findEndRecord(bytes);
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

  const output = bytes.slice();
  offset = centralOffset;
  for (const member of members.reverse()) {
    output.set(member, offset);
    offset += member.byteLength;
  }
  return output;
}

const CANONICAL_FFLATE_LEVELS = [0, 6] as const;

describe('ValidatedAssetContainer', () => {
  it('round-trips and verifies content-addressed entries', async () => {
    const asset = await createBinaryAssetRecord(
      new Uint8Array([1, 2, 3]),
      { mimeType: 'image/png', fileName: '../../Panel Final.PNG' },
    );
    const inputManifest = manifest([asset.ref]);

    const bytes = packValidatedAssetContainer(inputManifest, [asset]);
    const archivePaths = Object.keys(unzipSync(bytes));
    const opened = await unpackValidatedAssetContainer(bytes);

    expect(archivePaths).toEqual(['manifest.json', assetPath(asset.ref)]);
    expect(opened.manifest).toEqual(inputManifest);
    expect(opened.assets.get(asset.ref.id)).toEqual(asset);
    expect(opened.assets.get(asset.ref.id)?.bytes).not.toBe(asset.bytes);
  });

  it.each([
    '../escape.bin',
    'assets/../escape.bin',
    '/absolute.bin',
    'C:\\absolute.bin',
    '\\server\\share.bin',
  ])('rejects unsafe archive path %s', async (path) => {
    const malicious = zipWithManifest(manifest(), { [path]: new Uint8Array([1]) });
    await expect(unpackValidatedAssetContainer(malicious)).rejects.toThrow(/path/i);
  });

  it('rejects duplicate archive names', async () => {
    const archive = zipWithManifest(manifest(), {
      'first.bin': new Uint8Array([1]),
      'other.bin': new Uint8Array([2]),
    });
    const duplicate = replaceAllAscii(archive, 'other.bin', 'first.bin');

    await expect(unpackValidatedAssetContainer(duplicate)).rejects.toThrow(/duplicate/i);
  });

  it('rejects undeclared and non-normalized entries', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1]), { mimeType: 'image/png' });

    await expect(unpackValidatedAssetContainer(zipWithManifest(manifest(), {
      [assetPath(asset.ref)]: asset.bytes,
    }))).rejects.toThrow(/undeclared/i);
    await expect(unpackValidatedAssetContainer(zipWithManifest(manifest([asset.ref]), {
      [assetPath(asset.ref, 'bin')]: asset.bytes,
    }))).rejects.toThrow(/undeclared|missing|normalized/i);
  });

  it('rejects missing manifest and declared asset entries', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1]), { mimeType: 'image/png' });

    await expect(unpackValidatedAssetContainer(zipSync({
      [assetPath(asset.ref)]: asset.bytes,
    }))).rejects.toThrow(/missing.*manifest/i);
    await expect(unpackValidatedAssetContainer(zipWithManifest(manifest([asset.ref])))).rejects.toThrow(/missing.*asset/i);
  });

  it('rejects malformed references and foreign manifest types', async () => {
    const sha256 = 'a'.repeat(64);
    const invalidRef = {
      id: `sha256:${sha256}`,
      sha256,
      mimeType: 'image/png',
      byteLength: '1',
    };

    await expect(unpackValidatedAssetContainer(zipWithManifest({
      ...manifest(),
      assets: [invalidRef],
    }))).rejects.toThrow(/asset reference/i);
    await expect(unpackValidatedAssetContainer(zipWithManifest({
      ...manifest(),
      assets: ['legacy.png'],
    }))).rejects.toThrow(/asset reference|manifest/i);
    await expect(unpackValidatedAssetContainer(zipWithManifest({
      ...manifest(),
      formatVersion: '2',
    }))).rejects.toThrow(/manifest/i);
    await expect(unpackValidatedAssetContainer(zipWithManifest([]))).rejects.toThrow(/manifest/i);
  });

  it('rejects invalid JSON and unsupported compression', async () => {
    const invalidJson = zipSync({ 'manifest.json': strToU8('{') });
    await expect(unpackValidatedAssetContainer(invalidJson)).rejects.toThrow(/manifest.*JSON/i);

    const archive = zipWithManifest(manifest());
    const unsupportedCompression = new Uint8Array(archive);
    unsupportedCompression[8] = 99;
    unsupportedCompression[9] = 0;
    const centralHeader = unsupportedCompression.findIndex((value, index) => (
      value === 0x50
      && unsupportedCompression[index + 1] === 0x4b
      && unsupportedCompression[index + 2] === 0x01
      && unsupportedCompression[index + 3] === 0x02
    ));
    expect(centralHeader).toBeGreaterThan(-1);
    unsupportedCompression[centralHeader + 10] = 99;
    unsupportedCompression[centralHeader + 11] = 0;
    await expect(unpackValidatedAssetContainer(unsupportedCompression)).rejects.toThrow(/compression|zip/i);
  });

  it('enforces entry, manifest, per-asset, and total uncompressed limits', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const value = manifest([asset.ref]);
    const manifestBytes = strToU8(JSON.stringify(value)).byteLength;
    const archive = zipWithManifest(value, { [assetPath(asset.ref)]: asset.bytes });

    await expect(unpackValidatedAssetContainer(archive, withLimits({ maxEntries: 1 }))).rejects.toThrow(/entries.*limit/i);
    await expect(unpackValidatedAssetContainer(archive, withLimits({
      maxManifestBytes: manifestBytes - 1,
    }))).rejects.toThrow(/manifest.*limit/i);
    await expect(unpackValidatedAssetContainer(archive, withLimits({ maxAssetBytes: 2 }))).rejects.toThrow(/asset.*limit/i);
    await expect(unpackValidatedAssetContainer(archive, withLimits({
      maxTotalBytes: manifestBytes + asset.bytes.byteLength - 1,
    }))).rejects.toThrow(/total.*limit/i);
    expect(() => packValidatedAssetContainer(manifest(), [], withLimits({
      maxTotalBytes: strToU8(JSON.stringify(manifest())).byteLength - 1,
    }))).toThrow(/total.*limit/i);
  });

  it('rejects inconsistent stored-entry sizes before extraction', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const asset = await createBinaryAssetRecord(bytes, { mimeType: 'image/png' });
    const forgedRef = { ...asset.ref, byteLength: 1 };
    const archive = zipSync({
      'manifest.json': [strToU8(JSON.stringify(manifest([forgedRef]))), { level: 0 }],
      [assetPath(forgedRef)]: [bytes, { level: 0 }],
    });
    const forgedSizes = setCentralUncompressedSize(archive, 1);

    await expect(unpackValidatedAssetContainer(
      forgedSizes,
      withLimits({ maxAssetBytes: 1 }),
    )).rejects.toThrow(/stored.*size metadata|asset.*limit/i);
  });

  it('bounds deflated output before consuming a forged oversized payload', async () => {
    const actualBytes = new Uint8Array(32 * 1024).fill(65);
    const declaredBytes = actualBytes.slice(0, 64);
    const asset = await createBinaryAssetRecord(declaredBytes, { mimeType: 'image/png' });
    const path = assetPath(asset.ref);
    const archive = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest([asset.ref]))),
      [path]: actualBytes,
    });
    const forged = forgeZipEntrySizes(archive, path, { uncompressed: declaredBytes.byteLength });

    const error = await unpackValidatedAssetContainer(forged).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/65 actual output bytes|65 bytes of actual output/i);
  });

  it('rejects compressed input beyond the private packer work budget before inflate', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const path = assetPath(asset.ref);
    const archive = zipWithManifest(manifest([asset.ref]), { [path]: asset.bytes });
    const padded = appendZipEntryCompressedData(archive, path, new Uint8Array(32));

    await expect(unpackValidatedAssetContainer(padded)).rejects.toThrow(/compressed.*work budget/i);
  });

  it('rejects trailing deflate input through canonical compressed-slice equality', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const path = assetPath(asset.ref);
    const archive = zipWithManifest(manifest([asset.ref]), { [path]: asset.bytes });
    const trailing = appendZipEntryCompressedData(archive, path, new Uint8Array([0]));

    await expect(unpackValidatedAssetContainer(trailing)).rejects.toThrow(/non-canonical|trailing compressed/i);
  });

  it.each([
    'matching forged local and central CRC',
    'local and central CRC disagreement',
    'EOCD comment and trailing bytes',
    'unreferenced gap before central directory',
    'prepended unreferenced bytes',
    'deflated member data overlapping the next local header',
    'one MiB padding declared as deflate data',
  ])('rejects the Sol canonical-ZIP mutation: %s', async (mutation) => {
    const bytes = mutation === 'one MiB padding declared as deflate data'
      ? new Uint8Array(1_050_000).fill(65)
      : new Uint8Array([1, 2, 3]);
    const asset = await createBinaryAssetRecord(bytes, { mimeType: 'image/png' });
    const path = assetPath(asset.ref);
    const archive = zipWithManifest(manifest([asset.ref]), { [path]: asset.bytes });
    const offsets = findZipEntryHeaderOffsets(archive, path);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    let mutated: Uint8Array;

    if (mutation === 'matching forged local and central CRC') {
      mutated = setMatchingEntryCrc(archive, path, view.getUint32(offsets.central + 16, true) ^ 0xffffffff);
    } else if (mutation === 'local and central CRC disagreement') {
      mutated = archive.slice();
      new DataView(mutated.buffer).setUint32(offsets.local + 14, 0, true);
    } else if (mutation === 'EOCD comment and trailing bytes') {
      await expect(unpackValidatedAssetContainer(addEocdComment(archive))).rejects.toThrow(/comment|end-of-central/i);
      mutated = new Uint8Array(archive.byteLength + 1);
      mutated.set(archive);
      mutated[mutated.byteLength - 1] = 0x21;
    } else if (mutation === 'unreferenced gap before central directory') {
      mutated = insertBeforeCentralDirectory(archive, new Uint8Array([0]));
    } else if (mutation === 'prepended unreferenced bytes') {
      mutated = prependUnreferencedBytes(archive, new Uint8Array([0, 1]));
    } else if (mutation === 'deflated member data overlapping the next local header') {
      const manifestOffsets = findZipEntryHeaderOffsets(archive, 'manifest.json');
      mutated = archive.slice();
      const output = new DataView(mutated.buffer);
      const nextLocalOffset = offsets.local;
      const manifestDataStart = manifestOffsets.local + 30
        + output.getUint16(manifestOffsets.local + 26, true)
        + output.getUint16(manifestOffsets.local + 28, true);
      const overlappingSize = nextLocalOffset - manifestDataStart + 1;
      output.setUint32(manifestOffsets.local + 18, overlappingSize, true);
      output.setUint32(manifestOffsets.central + 20, overlappingSize, true);
    } else {
      mutated = appendZipEntryCompressedData(archive, path, new Uint8Array(1024 * 1024));
    }

    await expect(unpackValidatedAssetContainer(mutated)).rejects.toThrow(/CRC|local|layout|central|canonical|trailing|end-of-central/i);
  });

  it.each(CANONICAL_FFLATE_LEVELS)('checks the CRC of every stored and deflated member (level %s)', async (level) => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const archive = zipSync({
      'manifest.json': [strToU8(JSON.stringify(manifest([asset.ref]))), { level }],
      [assetPath(asset.ref)]: [asset.bytes, { level }],
    });

    for (const path of ['manifest.json', assetPath(asset.ref)]) {
      await expect(unpackValidatedAssetContainer(setMatchingEntryCrc(archive, path, 0))).rejects.toThrow(/CRC/i);
    }
  });

  it('accepts exact fflate stored and level-six compressor output', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    for (const level of CANONICAL_FFLATE_LEVELS) {
      const archive = zipSync({
        'manifest.json': [strToU8(JSON.stringify(manifest([asset.ref]))), { level }],
        [assetPath(asset.ref)]: [asset.bytes, { level }],
      });
      await expect(unpackValidatedAssetContainer(archive)).resolves.toMatchObject({
        manifest: manifest([asset.ref]),
      });
    }
  });

  it('rejects duplicate, overlapping, and overflowing local offsets', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const archive = zipWithManifest(manifest([asset.ref]), { [assetPath(asset.ref)]: asset.bytes });
    const assetOffsets = findZipEntryHeaderOffsets(archive, assetPath(asset.ref));
    const manifestOffsets = findZipEntryHeaderOffsets(archive, 'manifest.json');

    const duplicateOffset = archive.slice();
    new DataView(duplicateOffset.buffer).setUint32(assetOffsets.central + 42, 0, true);
    await expect(unpackValidatedAssetContainer(duplicateOffset)).rejects.toThrow(/local|layout/i);

    const overlapOffset = archive.slice();
    new DataView(overlapOffset.buffer).setUint32(assetOffsets.central + 42, manifestOffsets.local + 1, true);
    await expect(unpackValidatedAssetContainer(overlapOffset)).rejects.toThrow(/local|layout|header/i);

    const overflowOffset = archive.slice();
    new DataView(overflowOffset.buffer).setUint32(assetOffsets.central + 42, 0xffff_fffe, true);
    await expect(unpackValidatedAssetContainer(overflowOffset)).rejects.toThrow(/outside|local|layout/i);
  });

  it('rejects central-directory records reordered relative to valid local records', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const archive = zipWithManifest(manifest([asset.ref]), { [assetPath(asset.ref)]: asset.bytes });

    await expect(unpackValidatedAssetContainer(reorderCentralDirectoryMembers(archive)))
      .rejects.toThrow(/canonical|order/i);
  });

  it('rejects archives beyond the packer-derived total input cap', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const value = manifest([asset.ref]);
    const path = assetPath(asset.ref);
    const archive = zipWithManifest(value, { [path]: asset.bytes });
    const padded = appendZipEntryCompressedData(archive, path, new Uint8Array(4096));
    const declaredTotal = strToU8(JSON.stringify(value)).byteLength + asset.bytes.byteLength;

    await expect(unpackValidatedAssetContainer(padded, withLimits({
      maxEntries: 2,
      maxTotalBytes: declaredTotal,
    }))).rejects.toThrow(/archive.*limit/i);
  });

  it('rejects stored payload trailing data hidden by forged matching sizes', async () => {
    const declaredBytes = new Uint8Array([1, 2, 3]);
    const actualBytes = new Uint8Array(4096).fill(1);
    actualBytes.set(declaredBytes);
    const asset = await createBinaryAssetRecord(declaredBytes, { mimeType: 'image/png' });
    const path = assetPath(asset.ref);
    const archive = zipSync({
      'manifest.json': [strToU8(JSON.stringify(manifest([asset.ref]))), { level: 0 }],
      [path]: [actualBytes, { level: 0 }],
    });
    const forged = forgeZipEntrySizes(archive, path, {
      compressed: declaredBytes.byteLength,
      uncompressed: declaredBytes.byteLength,
    });

    await expect(unpackValidatedAssetContainer(forged)).rejects.toThrow(/layout|trailing|mismatch/i);
  });

  it('rejects local headers that disagree with the central directory', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const path = assetPath(asset.ref);
    const archive = zipWithManifest(manifest([asset.ref]), { [path]: asset.bytes });
    const offsets = findZipEntryHeaderOffsets(archive, path);
    const mutations: Array<(bytes: Uint8Array, view: DataView) => void> = [
      (bytes) => { bytes[offsets.local + 30] ^= 1; },
      (_bytes, view) => { view.setUint16(offsets.local + 6, 0x0800, true); },
      (_bytes, view) => { view.setUint16(offsets.local + 8, 0, true); },
      (_bytes, view) => { view.setUint32(offsets.local + 14, 0, true); },
      (_bytes, view) => { view.setUint32(offsets.local + 18, 1, true); },
      (_bytes, view) => { view.setUint32(offsets.local + 22, 1, true); },
    ];

    for (const mutate of mutations) {
      const mismatched = new Uint8Array(archive);
      mutate(mismatched, new DataView(mismatched.buffer));
      await expect(unpackValidatedAssetContainer(mismatched)).rejects.toThrow(/local|header|mismatch/i);
    }
  });

  it('rejects declared byte-length and content-hash mismatches', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const wrongLengthRef = { ...asset.ref, byteLength: 2 };
    const wrongContent = new Uint8Array([1, 2, 4]);

    await expect(unpackValidatedAssetContainer(zipWithManifest(manifest([wrongLengthRef]), {
      [assetPath(wrongLengthRef)]: asset.bytes,
    }))).rejects.toThrow(/byte length|size/i);
    await expect(unpackValidatedAssetContainer(zipWithManifest(manifest([asset.ref]), {
      [assetPath(asset.ref)]: wrongContent,
    }))).rejects.toThrow(/hash/i);
  });

  it('rejects inconsistent inputs while packing', async () => {
    const asset = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    const other = await createBinaryAssetRecord(new Uint8Array([4]), { mimeType: 'image/png' });
    const alteredRecord: BinaryAssetRecord = {
      ref: { ...asset.ref, mimeType: 'image/jpeg' },
      bytes: asset.bytes,
    };

    expect(() => packValidatedAssetContainer(manifest([asset.ref]), [])).toThrow(/missing/i);
    expect(() => packValidatedAssetContainer(manifest(), [asset])).toThrow(/undeclared/i);
    expect(() => packValidatedAssetContainer(manifest([asset.ref]), [asset, asset])).toThrow(/duplicate/i);
    expect(() => packValidatedAssetContainer(manifest([asset.ref]), [alteredRecord])).toThrow(/reference/i);
    expect(() => packValidatedAssetContainer(manifest([asset.ref]), [{
      ...asset,
      bytes: other.bytes,
    }])).toThrow(/byte length/i);
    expect(() => packValidatedAssetContainer(manifest([asset.ref]), [{
      ...asset,
      bytes: new Uint8Array([1, 2, 4]),
    }])).toThrow(/hash/i);
  });
});
