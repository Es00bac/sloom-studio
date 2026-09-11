import {
  deflateSync,
  strFromU8,
  strToU8,
  zipSync,
} from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { Inflate as PakoInflate } from 'pako';
import {
  isBinaryAssetRef,
  verifyBinaryAssetRecord,
  type BinaryAssetId,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../assets/contentAddressedAsset';

export interface AssetContainerLimits {
  maxEntries: number;
  maxManifestBytes: number;
  maxAssetBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ASSET_CONTAINER_LIMITS: AssetContainerLimits = {
  maxEntries: 10_000,
  maxManifestBytes: 16 * 1024 * 1024,
  maxAssetBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

export interface ValidatedAssetContainerManifest<TDocument = unknown> {
  format: string;
  formatVersion: number;
  kind: string;
  document: TDocument;
  assets: BinaryAssetRef[];
  [extra: string]: unknown;
}

export interface ValidatedAssetContainer<TDocument = unknown> {
  manifest: ValidatedAssetContainerManifest<TDocument>;
  assets: Map<BinaryAssetId, BinaryAssetRecord>;
}

const ERROR_PREFIX = 'ValidatedAssetContainer:';
const MANIFEST_PATH = 'manifest.json';

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/icc': 'icc',
  'application/octet-stream': 'bin',
  'application/pdf': 'pdf',
  'application/vnd.iccprofile': 'icc',
  'application/woff': 'woff',
  'application/woff2': 'woff2',
  'font/otf': 'otf',
  'font/sfnt': 'sfnt',
  'font/ttf': 'ttf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
};

function containerError(message: string): Error {
  return new Error(`${ERROR_PREFIX} ${message}`);
}

function resolveLimits(overrides?: Partial<AssetContainerLimits>): AssetContainerLimits {
  const limits = { ...DEFAULT_ASSET_CONTAINER_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw containerError(`${name} must be a non-negative safe integer.`);
    }
  }
  return limits;
}

function assertSafeArchivePath(path: string): void {
  const pathSegments = path.split('/');
  if (
    path.length === 0
    || path.includes('\0')
    || path.includes('\\')
    || path.startsWith('/')
    || /^[a-z]:[\\/]/i.test(path)
    || pathSegments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw containerError(`unsafe archive path: ${path || '<empty>'}.`);
  }
}

function safeExtension(ref: BinaryAssetRef): string {
  if (ref.fileName) {
    const lastDot = ref.fileName.lastIndexOf('.');
    const candidate = lastDot >= 0 ? ref.fileName.slice(lastDot + 1).toLowerCase() : '';
    if (/^[a-z0-9]{1,16}$/.test(candidate)) {
      return candidate;
    }
  }

  const normalizedMimeType = ref.mimeType.trim().toLowerCase().split(';', 1)[0];
  const knownExtension = MIME_EXTENSIONS[normalizedMimeType];
  if (knownExtension) {
    return knownExtension;
  }

  const subtype = normalizedMimeType.split('/', 2)[1]
    ?.replace(/^x-/, '')
    .split('+', 1)[0]
    .split('.')
    .at(-1);
  return subtype && /^[a-z0-9]{1,16}$/.test(subtype) ? subtype : 'bin';
}

function assetEntryPath(ref: BinaryAssetRef): string {
  return `assets/${ref.sha256}.${safeExtension(ref)}`;
}

function validateManifest(value: unknown): ValidatedAssetContainerManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw containerError('manifest must be a JSON object.');
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.format !== 'string'
    || candidate.format.trim().length === 0
    || !Number.isSafeInteger(candidate.formatVersion)
    || (candidate.formatVersion as number) < 1
    || typeof candidate.kind !== 'string'
    || candidate.kind.trim().length === 0
    || !Object.hasOwn(candidate, 'document')
    || !Array.isArray(candidate.assets)
  ) {
    throw containerError('manifest has invalid required field types.');
  }

  const assetIds = new Set<BinaryAssetId>();
  for (const ref of candidate.assets) {
    if (!isBinaryAssetRef(ref)) {
      throw containerError('manifest contains a malformed asset reference.');
    }
    if (assetIds.has(ref.id)) {
      throw containerError(`manifest contains duplicate asset reference ${ref.id}.`);
    }
    assetIds.add(ref.id);
  }

  return candidate as unknown as ValidatedAssetContainerManifest;
}

function stringifyAndValidateManifest<TDocument>(
  manifest: ValidatedAssetContainerManifest<TDocument>,
): { bytes: Uint8Array; manifest: ValidatedAssetContainerManifest<TDocument> } {
  let json: string;
  let parsed: unknown;
  try {
    json = JSON.stringify(manifest);
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`${ERROR_PREFIX} manifest is not serializable JSON.`, { cause: error });
  }

  return {
    bytes: strToU8(json),
    manifest: validateManifest(parsed) as ValidatedAssetContainerManifest<TDocument>,
  };
}

function sameAssetRef(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.fileName === right.fileName;
}

function sha256Hex(bytes: Uint8Array): string {
  return [...sha256(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function assertEntryAndSizeLimits(
  entryCount: number,
  manifestBytes: number,
  assetSizes: readonly number[],
  limits: AssetContainerLimits,
): void {
  if (entryCount > limits.maxEntries) {
    throw containerError(`entries limit exceeded (${entryCount} > ${limits.maxEntries}).`);
  }
  if (manifestBytes > limits.maxManifestBytes) {
    throw containerError(`manifest size exceeds manifest limit (${manifestBytes} > ${limits.maxManifestBytes}).`);
  }

  let totalBytes = manifestBytes;
  if (totalBytes > limits.maxTotalBytes) {
    throw containerError(`total uncompressed size exceeds total limit (${totalBytes} > ${limits.maxTotalBytes}).`);
  }
  for (const assetSize of assetSizes) {
    if (!Number.isSafeInteger(assetSize) || assetSize < 0) {
      throw containerError('asset entry has an invalid uncompressed size.');
    }
    if (assetSize > limits.maxAssetBytes) {
      throw containerError(`asset size exceeds asset limit (${assetSize} > ${limits.maxAssetBytes}).`);
    }
    totalBytes += assetSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw containerError(`total uncompressed size exceeds total limit (${totalBytes} > ${limits.maxTotalBytes}).`);
    }
  }
}

export function packValidatedAssetContainer<TDocument>(
  inputManifest: ValidatedAssetContainerManifest<TDocument>,
  records: readonly BinaryAssetRecord[],
  limitOverrides?: Partial<AssetContainerLimits>,
): Uint8Array {
  const limits = resolveLimits(limitOverrides);
  const serialized = stringifyAndValidateManifest(inputManifest);
  const recordsById = new Map<BinaryAssetId, BinaryAssetRecord>();

  for (const record of records) {
    if (!isBinaryAssetRef(record.ref)) {
      throw containerError('asset record contains a malformed reference.');
    }
    if (!(record.bytes instanceof Uint8Array)) {
      throw containerError(`asset record ${record.ref.id} has invalid bytes.`);
    }
    if (recordsById.has(record.ref.id)) {
      throw containerError(`duplicate asset record ${record.ref.id}.`);
    }
    if (record.bytes.byteLength !== record.ref.byteLength) {
      throw containerError(`asset record ${record.ref.id} byte length does not match its reference.`);
    }
    if (sha256Hex(record.bytes) !== record.ref.sha256) {
      throw containerError(`asset record ${record.ref.id} hash does not match its reference.`);
    }
    recordsById.set(record.ref.id, record);
  }

  const files: Record<string, Uint8Array> = { [MANIFEST_PATH]: serialized.bytes };
  const assetSizes: number[] = [];
  for (const ref of serialized.manifest.assets) {
    const record = recordsById.get(ref.id);
    if (!record) {
      throw containerError(`missing asset record ${ref.id}.`);
    }
    if (!sameAssetRef(ref, record.ref)) {
      throw containerError(`asset record ${ref.id} reference does not match the manifest.`);
    }
    files[assetEntryPath(ref)] = record.bytes;
    assetSizes.push(record.bytes.byteLength);
    recordsById.delete(ref.id);
  }

  const undeclaredRecord = recordsById.keys().next().value as BinaryAssetId | undefined;
  if (undeclaredRecord) {
    throw containerError(`undeclared asset record ${undeclaredRecord}.`);
  }

  assertEntryAndSizeLimits(1 + assetSizes.length, serialized.bytes.byteLength, assetSizes, limits);
  return zipSync(files, { level: 6 });
}

// This reader accepts only the single-disk, non-ZIP64 subset emitted by the packer.
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_BYTES = 30;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const PACKER_ZIP_VERSION = 20;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const UTF8_FILENAME_FLAG = 0x0800;
const MAX_PACKER_ENTRY_NAME_BYTES = 'assets/'.length + 64 + 1 + 16;
const MAX_INFLATE_OUTPUT_CHUNK_BYTES = 64 * 1024;
const FFLATE_PACKER_BLOCK_BYTES = 7000;
const PACKER_ENTRY_HEADER_BYTES = LOCAL_FILE_HEADER_BYTES
  + CENTRAL_DIRECTORY_HEADER_BYTES
  + 2 * MAX_PACKER_ENTRY_NAME_BYTES;

interface ZipEntryMetadata {
  name: string;
  nameBytes: Uint8Array;
  flags: number;
  compression: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataStart: number;
  dataEnd: number;
}

interface ArchiveMetadata {
  manifest: ZipEntryMetadata;
  entries: Map<string, ZipEntryMetadata>;
}

function assertSupportedEntryEncoding(
  name: string,
  compression: number,
  compressedSize: number,
  uncompressedSize: number,
): void {
  if (compression !== 0 && compression !== 8) {
    throw containerError(`archive entry ${name} uses unsupported compression ${compression}.`);
  }
  if (compression === 0 && compressedSize !== uncompressedSize) {
    throw containerError(`stored archive entry ${name} has inconsistent size metadata.`);
  }
}

function maxPackerDeflateBytes(uncompressedSize: number): number {
  // fflate 0.8.3 reserves this exact upper bound for each packed DEFLATE stream.
  return uncompressedSize + 5 * (1 + Math.ceil(uncompressedSize / FFLATE_PACKER_BLOCK_BYTES));
}

function assertCompressedWorkBudget(entry: ZipEntryMetadata): void {
  if (
    entry.compression === 8
    && entry.compressedSize > maxPackerDeflateBytes(entry.uncompressedSize)
  ) {
    throw containerError(`compressed input for ${entry.name} exceeds the private packer work budget.`);
  }
}

function maxPackerArchiveBytes(limits: AssetContainerLimits): number {
  // Summed block ceilings add at most one extra block per entry; headers use the longest packer path.
  const deflateBlockOverhead = 5 * Math.ceil(limits.maxTotalBytes / FFLATE_PACKER_BLOCK_BYTES);
  const entryOverhead = limits.maxEntries * (PACKER_ENTRY_HEADER_BYTES + 10);
  const maximum = limits.maxTotalBytes
    + deflateBlockOverhead
    + entryOverhead
    + END_OF_CENTRAL_DIRECTORY_BYTES;
  return Number.isSafeInteger(maximum) ? maximum : Number.MAX_SAFE_INTEGER;
}

function assertByteRange(bytes: Uint8Array, offset: number, length: number, context: string): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset > bytes.byteLength - length
  ) {
    throw containerError(`${context} is outside the ZIP data.`);
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

interface EndOfCentralDirectory {
  offset: number;
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): EndOfCentralDirectory {
  const minimumOffset = Math.max(
    0,
    bytes.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES - MAX_ZIP_COMMENT_BYTES,
  );
  let offset = bytes.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES;

  for (; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + END_OF_CENTRAL_DIRECTORY_BYTES + commentLength !== bytes.byteLength) continue;
    if (commentLength !== 0) {
      throw containerError('ZIP archive comments are not supported by the private packer.');
    }

    const diskNumber = view.getUint16(offset + 4, true);
    const centralDirectoryDisk = view.getUint16(offset + 6, true);
    const diskEntryCount = view.getUint16(offset + 8, true);
    const entryCount = view.getUint16(offset + 10, true);
    const centralDirectorySize = view.getUint32(offset + 12, true);
    const centralDirectoryOffset = view.getUint32(offset + 16, true);
    if (
      diskEntryCount === 0xffff
      || entryCount === 0xffff
      || centralDirectorySize === 0xffffffff
      || centralDirectoryOffset === 0xffffffff
    ) {
      throw containerError('ZIP64 archives are not supported.');
    }
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== entryCount) {
      throw containerError('multi-disk ZIP archives are not supported.');
    }
    if (centralDirectoryOffset + centralDirectorySize !== offset) {
      throw containerError('central directory layout mismatch.');
    }
    return { offset, entryCount, centralDirectoryOffset, centralDirectorySize };
  }

  throw containerError('missing or invalid end-of-central-directory record.');
}

function decodeEntryName(nameBytes: Uint8Array, flags: number): string {
  try {
    return strFromU8(nameBytes, !(flags & UTF8_FILENAME_FLAG));
  } catch (error) {
    throw new Error(`${ERROR_PREFIX} archive entry name is invalid.`, { cause: error });
  }
}

function parseCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
  end: EndOfCentralDirectory,
): ZipEntryMetadata[] {
  const entries: ZipEntryMetadata[] = [];
  let previousLocalHeaderOffset = -1;
  let offset = end.centralDirectoryOffset;

  for (let index = 0; index < end.entryCount; index += 1) {
    assertByteRange(bytes, offset, CENTRAL_DIRECTORY_HEADER_BYTES, 'central directory header');
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      throw containerError('central directory header signature mismatch.');
    }

    const versionMadeBy = view.getUint16(offset + 4, true);
    const versionNeeded = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskNumber = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const variableLength = nameLength + extraLength + commentLength;
    assertByteRange(bytes, offset + CENTRAL_DIRECTORY_HEADER_BYTES, variableLength, 'central directory entry');

    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      throw containerError('ZIP64 archives are not supported.');
    }
    if (versionMadeBy !== PACKER_ZIP_VERSION || versionNeeded !== PACKER_ZIP_VERSION) {
      throw containerError('central directory entry is outside the private packer ZIP version.');
    }
    if (diskNumber !== 0) {
      throw containerError('multi-disk ZIP entries are not supported.');
    }
    if (nameLength > MAX_PACKER_ENTRY_NAME_BYTES || extraLength !== 0 || commentLength !== 0) {
      throw containerError('central directory entry is outside the private packer subset.');
    }
    if (localHeaderOffset <= previousLocalHeaderOffset) {
      throw containerError('central directory is not in canonical local-record order.');
    }
    if (flags & ~UTF8_FILENAME_FLAG) {
      throw containerError(`archive entry uses unsupported flags 0x${flags.toString(16)}.`);
    }
    const nameOffset = offset + CENTRAL_DIRECTORY_HEADER_BYTES;
    const nameBytes = bytes.subarray(nameOffset, nameOffset + nameLength);
    const name = decodeEntryName(nameBytes, flags);
    assertSafeArchivePath(name);
    assertSupportedEntryEncoding(name, compression, compressedSize, uncompressedSize);
    entries.push({
      name,
      nameBytes,
      flags,
      compression,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStart: 0,
      dataEnd: 0,
    });
    previousLocalHeaderOffset = localHeaderOffset;
    offset += CENTRAL_DIRECTORY_HEADER_BYTES + variableLength;
  }

  if (offset !== end.offset) {
    throw containerError('central directory size or entry count mismatch.');
  }
  return entries;
}

function reconcileLocalHeaders(
  bytes: Uint8Array,
  view: DataView,
  entries: ZipEntryMetadata[],
  centralDirectoryOffset: number,
): void {
  let expectedOffset = 0;

  for (const entry of entries) {
    if (entry.localHeaderOffset !== expectedOffset) {
      throw containerError(`local entry layout mismatch or trailing data before ${entry.name}.`);
    }
    assertByteRange(bytes, entry.localHeaderOffset, LOCAL_FILE_HEADER_BYTES, `local header for ${entry.name}`);
    if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw containerError(`local header signature mismatch for ${entry.name}.`);
    }

    const versionNeeded = view.getUint16(entry.localHeaderOffset + 4, true);
    const flags = view.getUint16(entry.localHeaderOffset + 6, true);
    const compression = view.getUint16(entry.localHeaderOffset + 8, true);
    const crc32 = view.getUint32(entry.localHeaderOffset + 14, true);
    const compressedSize = view.getUint32(entry.localHeaderOffset + 18, true);
    const uncompressedSize = view.getUint32(entry.localHeaderOffset + 22, true);
    const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    const nameOffset = entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES;
    assertByteRange(bytes, nameOffset, nameLength + extraLength, `local header fields for ${entry.name}`);
    const localNameBytes = bytes.subarray(nameOffset, nameOffset + nameLength);

    if (
      versionNeeded !== PACKER_ZIP_VERSION
      || extraLength !== 0
      || flags !== entry.flags
      || compression !== entry.compression
      || crc32 !== entry.crc32
      || compressedSize !== entry.compressedSize
      || uncompressedSize !== entry.uncompressedSize
      || !equalBytes(localNameBytes, entry.nameBytes)
    ) {
      throw containerError(`local header mismatch for ${entry.name}.`);
    }

    entry.dataStart = nameOffset + nameLength + extraLength;
    entry.dataEnd = entry.dataStart + entry.compressedSize;
    if (entry.dataEnd > centralDirectoryOffset) {
      throw containerError(`compressed data for ${entry.name} overlaps the central directory.`);
    }
    expectedOffset = entry.dataEnd;
  }

  if (expectedOffset !== centralDirectoryOffset) {
    throw containerError('local entry layout contains trailing or unclaimed data.');
  }
}

function inspectArchive(bytes: Uint8Array, limits: AssetContainerLimits): ArchiveMetadata {
  const archiveLimit = maxPackerArchiveBytes(limits);
  if (bytes.byteLength > archiveLimit) {
    throw containerError(`archive size exceeds the private packer input limit (${bytes.byteLength} > ${archiveLimit}).`);
  }
  if (bytes.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) {
    throw containerError('invalid ZIP data.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(bytes, view);
  if (end.entryCount > limits.maxEntries) {
    throw containerError(`entries limit exceeded (${end.entryCount} > ${limits.maxEntries}).`);
  }
  const parsedEntries = parseCentralDirectory(bytes, view, end);
  reconcileLocalHeaders(bytes, view, parsedEntries, end.centralDirectoryOffset);
  parsedEntries.forEach(assertCompressedWorkBudget);

  const entries = new Map<string, ZipEntryMetadata>();
  for (const entry of parsedEntries) {
    if (entries.has(entry.name)) {
      throw containerError(`duplicate archive entry ${entry.name}.`);
    }
    entries.set(entry.name, entry);
  }
  const manifest = entries.get(MANIFEST_PATH);
  if (!manifest) {
    throw containerError('missing manifest.json entry.');
  }
  return { manifest, entries };
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return value >>> 0;
});

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const value of bytes) {
    next = CRC32_TABLE[(next ^ value) & 0xff] ^ (next >>> 8);
  }
  return next >>> 0;
}

function assertEntryCrc(entry: ZipEntryMetadata, crc: number): void {
  const actualCrc = (crc ^ 0xffffffff) >>> 0;
  if (actualCrc !== entry.crc32) {
    throw containerError(`CRC mismatch for ${entry.name}.`);
  }
}

function assertCanonicalDeflateData(entry: ZipEntryMetadata, output: Uint8Array, compressed: Uint8Array): void {
  // pako's public stream state does not promise that avail_in remains meaningful
  // after a final push. Re-encoding with the only encoder/level used by our
  // writer makes complete consumption explicit: a valid member has exactly one
  // accepted raw-DEFLATE byte sequence for this private archive format.
  const canonical = deflateSync(output, { level: 6 });
  if (!equalBytes(canonical, compressed)) {
    throw containerError(`non-canonical or trailing compressed data for ${entry.name}.`);
  }
}

function inflateBoundedEntry(
  bytes: Uint8Array,
  entry: ZipEntryMetadata,
  outputLimit: number,
): Uint8Array {
  if (entry.uncompressedSize > outputLimit) {
    throw containerError(`declared output for ${entry.name} exceeds its container limit.`);
  }

  const output = new Uint8Array(entry.uncompressedSize);
  let outputBytes = 0;
  let crc = 0xffffffff;
  const outputChunkBytes = Math.max(1, Math.min(
    MAX_INFLATE_OUTPUT_CHUNK_BYTES,
    entry.uncompressedSize + 1,
    outputLimit + 1,
  ));
  const inflater = new PakoInflate({
    raw: true,
    chunkSize: outputChunkBytes,
  });
  inflater.onData = (chunk) => {
    const nextOutputBytes = outputBytes + chunk.byteLength;
    if (nextOutputBytes > entry.uncompressedSize || nextOutputBytes > outputLimit) {
      throw containerError(
        `actual output for ${entry.name} exceeds its declared/container limit after `
        + `${nextOutputBytes} bytes of actual output.`,
      );
    }
    output.set(chunk, outputBytes);
    outputBytes = nextOutputBytes;
    crc = updateCrc32(crc, chunk);
  };

  const compressed = bytes.subarray(entry.dataStart, entry.dataEnd);
  let succeeded: boolean;
  try {
    succeeded = inflater.push(compressed, true);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(ERROR_PREFIX)) throw error;
    throw new Error(`${ERROR_PREFIX} invalid DEFLATE data for ${entry.name}.`, { cause: error });
  }

  if (!succeeded || inflater.err !== 0 || !inflater.ended) {
    throw containerError(`incomplete or invalid DEFLATE data for ${entry.name}${inflater.msg ? `: ${inflater.msg}` : '.'}`);
  }
  if (outputBytes !== entry.uncompressedSize) {
    throw containerError(`actual output size mismatch for ${entry.name}.`);
  }
  assertEntryCrc(entry, crc);
  assertCanonicalDeflateData(entry, output, compressed);
  return output;
}

function extractBoundedEntry(
  bytes: Uint8Array,
  entry: ZipEntryMetadata,
  outputLimit: number,
): Uint8Array {
  if (entry.uncompressedSize > outputLimit) {
    throw containerError(`declared output for ${entry.name} exceeds its container limit.`);
  }
  if (entry.compression === 8) {
    return inflateBoundedEntry(bytes, entry, outputLimit);
  }

  const output = bytes.slice(entry.dataStart, entry.dataEnd);
  if (output.byteLength !== entry.uncompressedSize) {
    throw containerError(`actual output size mismatch for ${entry.name}.`);
  }
  assertEntryCrc(entry, updateCrc32(0xffffffff, output));
  return output;
}

function parseManifest(bytes: Uint8Array): ValidatedAssetContainerManifest {
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(bytes)) as unknown;
  } catch (error) {
    throw new Error(`${ERROR_PREFIX} manifest JSON is invalid.`, { cause: error });
  }
  return validateManifest(value);
}

function reconcileManifestEntries(
  manifest: ValidatedAssetContainerManifest,
  metadata: ArchiveMetadata,
  limits: AssetContainerLimits,
): Map<string, BinaryAssetRef> {
  const expectedPaths = new Map<string, BinaryAssetRef>();
  let declaredTotal = metadata.manifest.uncompressedSize;

  for (const ref of manifest.assets) {
    if (ref.byteLength > limits.maxAssetBytes) {
      throw containerError(`asset size exceeds asset limit (${ref.byteLength} > ${limits.maxAssetBytes}).`);
    }
    declaredTotal += ref.byteLength;
    if (!Number.isSafeInteger(declaredTotal) || declaredTotal > limits.maxTotalBytes) {
      throw containerError(`total declared size exceeds total limit (${declaredTotal} > ${limits.maxTotalBytes}).`);
    }

    const path = assetEntryPath(ref);
    const entry = metadata.entries.get(path);
    if (!entry) {
      throw containerError(`missing declared asset entry ${path}.`);
    }
    if (entry.uncompressedSize !== ref.byteLength) {
      throw containerError(`asset entry ${path} byte length does not match its reference.`);
    }
    expectedPaths.set(path, ref);
  }

  for (const path of metadata.entries.keys()) {
    if (path !== MANIFEST_PATH && !expectedPaths.has(path)) {
      throw containerError(`undeclared archive entry ${path}.`);
    }
  }
  return expectedPaths;
}

export async function unpackValidatedAssetContainer<TDocument = unknown>(
  bytes: Uint8Array,
  limitOverrides?: Partial<AssetContainerLimits>,
): Promise<ValidatedAssetContainer<TDocument>> {
  const limits = resolveLimits(limitOverrides);
  const metadata = inspectArchive(bytes, limits);
  const manifestBytes = extractBoundedEntry(
    bytes,
    metadata.manifest,
    Math.min(limits.maxManifestBytes, limits.maxTotalBytes),
  );
  const manifest = parseManifest(manifestBytes);
  const expectedPaths = reconcileManifestEntries(manifest, metadata, limits);
  const assets = new Map<BinaryAssetId, BinaryAssetRecord>();
  let retainedBytes = manifestBytes.byteLength;

  for (const [path, ref] of expectedPaths) {
    const entry = metadata.entries.get(path);
    if (!entry) throw containerError(`missing declared asset entry ${path}.`);
    const assetBytes = extractBoundedEntry(
      bytes,
      entry,
      Math.min(limits.maxAssetBytes, limits.maxTotalBytes - retainedBytes),
    );
    retainedBytes += assetBytes.byteLength;

    const record: BinaryAssetRecord = {
      ref: { ...ref },
      bytes: assetBytes,
    };
    if (!await verifyBinaryAssetRecord(record)) {
      throw containerError(`asset entry ${path} hash mismatch.`);
    }
    assets.set(record.ref.id, record);
  }

  return {
    manifest: manifest as ValidatedAssetContainerManifest<TDocument>,
    assets,
  };
}
