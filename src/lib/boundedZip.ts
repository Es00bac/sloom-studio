import { Inflate } from 'fflate';

/**
 * Limits for ZIP-based import formats. The central directory is untrusted: all
 * declared limits are checked before inflation. Actual DEFLATE output is then
 * streamed through a fixed-size input window and reconciled as it is emitted.
 */
export interface BoundedZipLimits {
  archiveLabel: string;
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
}

export interface BoundedZipEntryMetadata {
  path: string;
  flags: number;
  compressedBytes: number;
  uncompressedBytes: number;
  compressionMethod: number;
  crc32: number;
  localHeaderOffset: number;
}

export interface BoundedZipPreflight {
  entries: readonly BoundedZipEntryMetadata[];
  totalUncompressedBytes: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const EOCD_MIN_BYTES = 22;
const EOCD_MAX_SEARCH_BYTES = EOCD_MIN_BYTES + 65_535;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const LOCAL_FILE_HEADER_BYTES = 30;
const ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
// Feeding an entire forged DEFLATE member to a synchronous inflater can spend
// unbounded work before its declared output size is reconciled. Keep each
// inflation step small enough that a size violation has a fixed overshoot.
const DEFLATE_INPUT_CHUNK_BYTES = 256;
// Legitimate DEFLATE can be slightly larger than its source. Empty-block bombs
// can be arbitrarily larger while producing no output, so also bound compressed
// work to a conservative multiple plus fixed container overhead.
const MAX_DEFLATE_COMPRESSED_OVERHEAD_BYTES = 64 * 1024;
const MAX_DEFLATE_COMPRESSED_TO_OUTPUT_FACTOR = 2;

/**
 * Inspect a conventional single-disk, non-ZIP64 archive without inflating it.
 * This intentionally accepts only stored and DEFLATE members, the formats used
 * by OOXML producers and fflate.
 */
export function preflightBoundedZip(
  bytes: Uint8Array,
  limits: BoundedZipLimits,
): BoundedZipPreflight {
  if (bytes.byteLength < EOCD_MIN_BYTES) fail(limits, 'archive is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view, bytes.byteLength);
  if (eocdOffset < 0) fail(limits, 'archive directory is missing or invalid');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const directoryDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntryCount = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntryCount !== entryCount) {
    fail(limits, 'multi-volume archives are not supported');
  }
  if (
    entryCount === 0xffff
    || directorySize === 0xffffffff
    || directoryOffset === 0xffffffff
  ) {
    fail(limits, 'ZIP64 archives are not supported');
  }
  if (entryCount > limits.maxEntries) {
    fail(limits, `archive exceeds ${limits.maxEntries} entries`);
  }
  if (directoryOffset + directorySize !== eocdOffset) {
    fail(limits, 'archive directory is truncated or misplaced');
  }

  const entries: BoundedZipEntryMetadata[] = [];
  const canonicalPaths = new Set<string>();
  let directoryCursor = directoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    assertRange(bytes, directoryCursor, CENTRAL_DIRECTORY_HEADER_BYTES, limits, 'directory entry is truncated');
    if (view.getUint32(directoryCursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      fail(limits, 'archive directory entry is invalid');
    }

    const flags = view.getUint16(directoryCursor + 8, true);
    const compressionMethod = view.getUint16(directoryCursor + 10, true);
    const crc32 = view.getUint32(directoryCursor + 16, true);
    const compressedBytes = view.getUint32(directoryCursor + 20, true);
    const uncompressedBytes = view.getUint32(directoryCursor + 24, true);
    const nameLength = view.getUint16(directoryCursor + 28, true);
    const extraLength = view.getUint16(directoryCursor + 30, true);
    const commentLength = view.getUint16(directoryCursor + 32, true);
    const diskStart = view.getUint16(directoryCursor + 34, true);
    const localHeaderOffset = view.getUint32(directoryCursor + 42, true);
    const variableLength = nameLength + extraLength + commentLength;
    assertRange(bytes, directoryCursor + CENTRAL_DIRECTORY_HEADER_BYTES, variableLength, limits, 'directory entry is truncated');

    if ((flags & ENCRYPTION_FLAGS) !== 0) fail(limits, 'encrypted archives are not supported');
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail(limits, `archive uses unsupported ZIP compression method ${compressionMethod}`);
    }
    if (
      diskStart === 0xffff
      || compressedBytes === 0xffffffff
      || uncompressedBytes === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      fail(limits, 'ZIP64 archives are not supported');
    }
    if (diskStart !== 0) fail(limits, 'multi-volume archives are not supported');

    const nameStart = directoryCursor + CENTRAL_DIRECTORY_HEADER_BYTES;
    const extraStart = nameStart + nameLength;
    validateExtraFields(bytes, extraStart, extraLength, limits);
    const path = decodePath(bytes.subarray(nameStart, nameStart + nameLength), flags, limits);
    validateBoundedZipPath(path, limits);
    const canonicalPath = path.normalize('NFC').toLocaleLowerCase('en-US');
    if (canonicalPaths.has(canonicalPath)) fail(limits, `archive contains duplicate path ${path}`);
    canonicalPaths.add(canonicalPath);

    if (uncompressedBytes > limits.maxEntryUncompressedBytes) {
      fail(limits, `archive entry exceeds ${limits.maxEntryUncompressedBytes} bytes`);
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      fail(limits, `expanded size exceeds ${limits.maxTotalUncompressedBytes} bytes`);
    }
    if (
      uncompressedBytes > 0
      && (
        compressedBytes === 0
        || uncompressedBytes / compressedBytes > limits.maxCompressionRatio
      )
    ) {
      fail(limits, 'archive contains a suspicious compression ratio');
    }
    if (
      compressionMethod === 8
      && compressedBytes > Math.max(
        MAX_DEFLATE_COMPRESSED_OVERHEAD_BYTES,
        uncompressedBytes * MAX_DEFLATE_COMPRESSED_TO_OUTPUT_FACTOR
          + MAX_DEFLATE_COMPRESSED_OVERHEAD_BYTES,
      )
    ) {
      fail(limits, 'archive entry requires excessive decompression work');
    }
    if (compressionMethod === 0 && compressedBytes !== uncompressedBytes) {
      fail(limits, 'stored archive entry size does not match its directory');
    }

    entries.push({
      path,
      flags,
      compressedBytes,
      uncompressedBytes,
      compressionMethod,
      crc32,
      localHeaderOffset,
    });
    directoryCursor += CENTRAL_DIRECTORY_HEADER_BYTES + variableLength;
  }

  if (directoryCursor !== eocdOffset) fail(limits, 'archive directory size does not match its entries');
  validateLocalRecords(bytes, view, entries, directoryOffset, limits);
  return { entries, totalUncompressedBytes };
}

/** Verify the decompressor returned exactly the members and sizes preflighted. */
export function validateInflatedBoundedZip(
  archive: Record<string, Uint8Array>,
  preflight: BoundedZipPreflight,
  limits: BoundedZipLimits,
): void {
  const actualPaths = Object.keys(archive);
  if (actualPaths.length !== preflight.entries.length) {
    fail(limits, 'inflated member count does not match its directory');
  }
  const expectedByPath = new Map(preflight.entries.map((entry) => [entry.path, entry]));
  let total = 0;
  for (const path of actualPaths) {
    const expected = expectedByPath.get(path);
    if (!expected) fail(limits, `inflated an unexpected path ${path}`);
    const actualBytes = archive[path].byteLength;
    if (actualBytes !== expected.uncompressedBytes) {
      fail(limits, `inflated size for ${path} does not match its directory`);
    }
    if (actualBytes > limits.maxEntryUncompressedBytes) {
      fail(limits, `archive entry exceeds ${limits.maxEntryUncompressedBytes} bytes`);
    }
    total += actualBytes;
    expectedByPath.delete(path);
  }
  if (expectedByPath.size > 0) fail(limits, 'did not inflate every declared member');
  if (total !== preflight.totalUncompressedBytes) {
    fail(limits, 'inflated total size does not match its directory');
  }
  if (total > limits.maxTotalUncompressedBytes) {
    fail(limits, `expanded size exceeds ${limits.maxTotalUncompressedBytes} bytes`);
  }
}

/** Preflight, inflate, and reconcile a bounded ZIP as one hard-to-misuse operation. */
export function unzipBoundedZipSync(
  bytes: Uint8Array,
  limits: BoundedZipLimits,
): Record<string, Uint8Array> {
  const preflight = preflightBoundedZip(bytes, limits);
  const archive: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let inflatedTotal = 0;
  for (const entry of preflight.entries) {
    const compressed = readCompressedEntryBytes(bytes, entry, limits);
    try {
      const output = entry.compressionMethod === 0
        ? inflateStoredEntry(compressed, entry, inflatedTotal, limits)
        : inflateDeflateEntry(compressed, entry, inflatedTotal, limits);
      archive[entry.path] = output;
      inflatedTotal += output.byteLength;
    } catch (error) {
      if (error instanceof BoundedZipError) throw error;
      fail(limits, `archive entry ${entry.path} could not be decompressed`);
    }
  }
  validateInflatedBoundedZip(archive, preflight, limits);
  return archive;
}

function readCompressedEntryBytes(
  bytes: Uint8Array,
  entry: BoundedZipEntryMetadata,
  limits: BoundedZipLimits,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES + nameLength + extraLength;
  assertRange(bytes, dataStart, entry.compressedBytes, limits, `compressed data for ${entry.path} is truncated`);
  return bytes.subarray(dataStart, dataStart + entry.compressedBytes);
}

function inflateStoredEntry(
  compressed: Uint8Array,
  entry: BoundedZipEntryMetadata,
  inflatedTotal: number,
  limits: BoundedZipLimits,
): Uint8Array {
  assertActualOutputWithinLimits(compressed.byteLength, entry, inflatedTotal, limits);
  if (crc32(compressed) !== entry.crc32) {
    fail(limits, `archive entry ${entry.path} failed its CRC check`);
  }
  return new Uint8Array(compressed);
}

function inflateDeflateEntry(
  compressed: Uint8Array,
  entry: BoundedZipEntryMetadata,
  inflatedTotal: number,
  limits: BoundedZipLimits,
): Uint8Array {
  // Allocate only the already-preflighted declared size. Inflate is fed small
  // compressed chunks so a forged size can produce only a bounded temporary
  // chunk before the callback aborts; the forged actual size is never retained.
  const output = new Uint8Array(entry.uncompressedBytes);
  let outputOffset = 0;
  let runningCrc = 0xffffffff;
  let completed = false;
  const inflater = new Inflate((chunk, final) => {
    const nextOffset = outputOffset + chunk.byteLength;
    assertActualOutputWithinLimits(nextOffset, entry, inflatedTotal, limits);
    output.set(chunk, outputOffset);
    outputOffset = nextOffset;
    runningCrc = updateCrc32(runningCrc, chunk);
    completed = final;
  });

  if (compressed.byteLength === 0) {
    fail(limits, `archive entry ${entry.path} could not be decompressed`);
  }
  for (let offset = 0; offset < compressed.byteLength; offset += DEFLATE_INPUT_CHUNK_BYTES) {
    const end = Math.min(offset + DEFLATE_INPUT_CHUNK_BYTES, compressed.byteLength);
    inflater.push(compressed.subarray(offset, end), end === compressed.byteLength);
  }

  if (!completed) fail(limits, `archive entry ${entry.path} is truncated`);
  if (outputOffset !== entry.uncompressedBytes) {
    fail(limits, `inflated size for ${entry.path} does not match its directory`);
  }
  if (((runningCrc ^ 0xffffffff) >>> 0) !== entry.crc32) {
    fail(limits, `archive entry ${entry.path} failed its CRC check`);
  }
  return output;
}

function assertActualOutputWithinLimits(
  actualBytes: number,
  entry: BoundedZipEntryMetadata,
  inflatedTotal: number,
  limits: BoundedZipLimits,
): void {
  if (actualBytes > entry.uncompressedBytes) {
    fail(limits, `inflated size for ${entry.path} exceeds its directory declaration`);
  }
  if (actualBytes > limits.maxEntryUncompressedBytes) {
    fail(limits, `archive entry exceeds ${limits.maxEntryUncompressedBytes} bytes`);
  }
  if (inflatedTotal + actualBytes > limits.maxTotalUncompressedBytes) {
    fail(limits, `expanded size exceeds ${limits.maxTotalUncompressedBytes} bytes`);
  }
}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function updateCrc32(current: number, bytes: Uint8Array): number {
  let value = current;
  for (const byte of bytes) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(view: DataView, byteLength: number): number {
  const searchStart = Math.max(0, byteLength - EOCD_MAX_SEARCH_BYTES);
  for (let offset = byteLength - EOCD_MIN_BYTES; offset >= searchStart; offset -= 1) {
    if (
      view.getUint32(offset, true) === EOCD_SIGNATURE
      && offset + EOCD_MIN_BYTES + view.getUint16(offset + 20, true) === byteLength
    ) {
      return offset;
    }
  }
  return -1;
}

function validateLocalRecords(
  bytes: Uint8Array,
  view: DataView,
  entries: readonly BoundedZipEntryMetadata[],
  directoryOffset: number,
  limits: BoundedZipLimits,
): void {
  const ordered = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.localHeaderOffset !== expectedOffset) {
      fail(limits, 'archive local records overlap or contain unreferenced data');
    }
    assertRange(bytes, entry.localHeaderOffset, LOCAL_FILE_HEADER_BYTES, limits, 'local header is truncated');
    if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
      fail(limits, `archive local header for ${entry.path} is invalid`);
    }
    const flags = view.getUint16(entry.localHeaderOffset + 6, true);
    const compressionMethod = view.getUint16(entry.localHeaderOffset + 8, true);
    const crc32 = view.getUint32(entry.localHeaderOffset + 14, true);
    const compressedBytes = view.getUint32(entry.localHeaderOffset + 18, true);
    const uncompressedBytes = view.getUint32(entry.localHeaderOffset + 22, true);
    const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    const nameStart = entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES;
    const extraStart = nameStart + nameLength;
    assertRange(bytes, nameStart, nameLength + extraLength, limits, `archive local header for ${entry.path} is truncated`);
    validateExtraFields(bytes, extraStart, extraLength, limits);
    const localPath = decodePath(bytes.subarray(nameStart, nameStart + nameLength), flags, limits);
    if (
      localPath !== entry.path
      || flags !== entry.flags
      || compressionMethod !== entry.compressionMethod
    ) {
      fail(limits, `archive local header for ${entry.path} disagrees with its directory`);
    }
    if ((flags & ENCRYPTION_FLAGS) !== 0) fail(limits, 'encrypted archives are not supported');

    const dataStart = extraStart + extraLength;
    const compressedEnd = dataStart + entry.compressedBytes;
    assertRange(bytes, dataStart, entry.compressedBytes, limits, `compressed data for ${entry.path} is truncated`);
    let recordEnd = compressedEnd;
    if ((flags & DATA_DESCRIPTOR_FLAG) === 0) {
      if (
        crc32 !== entry.crc32
        || compressedBytes !== entry.compressedBytes
        || uncompressedBytes !== entry.uncompressedBytes
      ) {
        fail(limits, `archive local header for ${entry.path} disagrees with its directory`);
      }
    } else {
      if (
        (crc32 !== 0 && crc32 !== entry.crc32)
        || (compressedBytes !== 0 && compressedBytes !== entry.compressedBytes)
        || (uncompressedBytes !== 0 && uncompressedBytes !== entry.uncompressedBytes)
      ) {
        fail(limits, `archive local header for ${entry.path} disagrees with its directory`);
      }
      recordEnd = validateDataDescriptor(bytes, view, compressedEnd, entry, limits);
    }
    expectedOffset = recordEnd;
  }
  if (expectedOffset !== directoryOffset) {
    fail(limits, 'archive local records do not end at its directory');
  }
}

function validateDataDescriptor(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  entry: BoundedZipEntryMetadata,
  limits: BoundedZipLimits,
): number {
  assertRange(bytes, offset, 12, limits, `data descriptor for ${entry.path} is truncated`);
  const hasSignature = view.getUint32(offset, true) === DATA_DESCRIPTOR_SIGNATURE;
  const valueOffset = offset + (hasSignature ? 4 : 0);
  assertRange(bytes, valueOffset, 12, limits, `data descriptor for ${entry.path} is truncated`);
  if (
    view.getUint32(valueOffset, true) !== entry.crc32
    || view.getUint32(valueOffset + 4, true) !== entry.compressedBytes
    || view.getUint32(valueOffset + 8, true) !== entry.uncompressedBytes
  ) {
    fail(limits, `data descriptor for ${entry.path} disagrees with its directory`);
  }
  return valueOffset + 12;
}

function validateExtraFields(
  bytes: Uint8Array,
  offset: number,
  length: number,
  limits: BoundedZipLimits,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) fail(limits, 'archive contains a malformed ZIP extra field');
    const fieldId = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (cursor + fieldLength > end) fail(limits, 'archive contains a malformed ZIP extra field');
    if (fieldId === ZIP64_EXTRA_FIELD_ID) fail(limits, 'ZIP64 archives are not supported');
    cursor += fieldLength;
  }
}

function decodePath(bytes: Uint8Array, flags: number, limits: BoundedZipLimits): string {
  // OOXML package part names are ASCII or UTF-8. Reject ambiguous legacy-codepage
  // names instead of letting the preflight and decompressor canonicalize them differently.
  try {
    const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if ((flags & UTF8_FLAG) === 0 && Array.from(path).some((character) => character.codePointAt(0)! > 0x7f)) {
      fail(limits, 'archive contains a non-UTF-8 path');
    }
    return path;
  } catch (error) {
    if (error instanceof BoundedZipError) throw error;
    fail(limits, 'archive contains an invalid path encoding');
  }
}

function validateBoundedZipPath(path: string, limits: BoundedZipLimits): void {
  const segments = path.split('/');
  const isDirectory = path.endsWith('/');
  const contentSegments = isDirectory ? segments.slice(0, -1) : segments;
  const hasUnsafeSegment = contentSegments.some((segment) => (
    segment === ''
    || segment === '.'
    || segment === '..'
    || segment.toLowerCase() === '__proto__'
    || segment.toLowerCase() === 'constructor'
    || segment.toLowerCase() === 'prototype'
  ));
  if (
    !path
    || path.includes('\\')
    || path.includes('\0')
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)
    || hasUnsafeSegment
  ) {
    fail(limits, `archive contains unsafe path ${path || '(empty)'}`);
  }
}

function assertRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  limits: BoundedZipLimits,
  message: string,
): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > bytes.byteLength
  ) {
    fail(limits, message);
  }
}

class BoundedZipError extends Error {}

function fail(limits: BoundedZipLimits, message: string): never {
  throw new BoundedZipError(`${limits.archiveLabel} ${message}`);
}
