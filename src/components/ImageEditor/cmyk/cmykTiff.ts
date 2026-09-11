import { IMAGE_CMYK_MAX_PROFILE_BYTES, type ImageCmykBuffer } from '../../../lib/iccTransforms';
import type { ImageCmykProfileIdentity } from './cmykProfiles';

export const IMAGE_CMYK_TIFF_MAX_PIXELS = 8_388_608;
const ICC_HEADER_BYTES = 128;

export type ImageCmykOutputFormat = 'tiff' | 'jpeg';

export interface ImageCmykOutputPolicy {
  format: ImageCmykOutputFormat;
  status: 'supported' | 'refused';
  reason?: string;
}

export interface ImageCmykTiffExport {
  format: 'tiff';
  profile: ImageCmykProfileIdentity;
  width: number;
  height: number;
  samplesPerPixel: 4 | 5;
  /** One process-ink pixel is C, M, Y, K, optionally followed by unassociated alpha. */
  bytes: Uint8Array;
}

export interface DecodedImageCmykTiff {
  buffer: ImageCmykBuffer;
  profileBytes?: Uint8Array;
  warnings: readonly string[];
}

interface TiffEntry {
  type: number;
  count: number;
  value: number;
  entryOffset: number;
}

const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_TYPE_UNDEFINED = 7;

export function describeImageCmykOutputPolicy(format: ImageCmykOutputFormat): ImageCmykOutputPolicy {
  if (format === 'tiff') return { format, status: 'supported' };
  return {
    format,
    status: 'refused',
    reason: 'CMYK JPEG is unavailable because browser JPEG codecs do not preserve a four-component CMYK authority.',
  };
}

function assertCmykBuffer(buffer: ImageCmykBuffer): number {
  const { width, height, data } = buffer;
  if (buffer.model !== 'cmyk' || buffer.depth !== 'u8' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('CMYK TIFF export requires a valid u8 CMYK buffer.');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > IMAGE_CMYK_TIFF_MAX_PIXELS || data.byteLength !== pixels * 5) {
    throw new Error(`CMYK TIFF export is limited to ${IMAGE_CMYK_TIFF_MAX_PIXELS.toLocaleString()} C/M/Y/K/alpha pixels.`);
  }
  return pixels;
}

function profileTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function assertProfilePacket(bytes: Uint8Array): void {
  if (bytes.byteLength < ICC_HEADER_BYTES || bytes.byteLength > IMAGE_CMYK_MAX_PROFILE_BYTES) {
    throw new Error('CMYK TIFF requires bounded embedded ICC profile bytes.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(0, false);
  if (declared < ICC_HEADER_BYTES || declared > bytes.byteLength || profileTag(bytes, 36) !== 'acsp' || profileTag(bytes, 12) !== 'prtr' || profileTag(bytes, 16) !== 'CMYK') {
    throw new Error('CMYK TIFF requires a valid CMYK printer ICC profile.');
  }
}

/** Emits an uncompressed, little-endian DeviceCMYK TIFF with an embedded, exact ICC profile. */
export function encodeImageCmykTiff(
  buffer: ImageCmykBuffer,
  profile: ImageCmykProfileIdentity,
  profileBytes: Uint8Array,
): ImageCmykTiffExport {
  const pixelCount = assertCmykBuffer(buffer);
  assertProfilePacket(profileBytes);
  const samplesPerPixel = 5 as const;
  const tagCount = 14;
  const ifdOffset = 8;
  const ifdBytes = 2 + tagCount * 12 + 4;
  const bitsOffset = ifdOffset + ifdBytes;
  const extraSamplesOffset = bitsOffset + samplesPerPixel * 2;
  const profileOffset = extraSamplesOffset + 2;
  const stripOffset = profileOffset + profileBytes.byteLength;
  const stripByteCount = pixelCount * samplesPerPixel;
  const outputLength = stripOffset + stripByteCount;
  if (!Number.isSafeInteger(outputLength)) throw new Error('CMYK TIFF output would exceed safe memory bounds.');

  const bytes = new Uint8Array(outputLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, tagCount, true);

  let entry = ifdOffset + 2;
  const tag = (id: number, type: number, count: number, value: number) => {
    view.setUint16(entry, id, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, count, true);
    if (type === TIFF_TYPE_SHORT && count === 1) view.setUint16(entry + 8, value, true);
    else view.setUint32(entry + 8, value, true);
    entry += 12;
  };
  tag(256, TIFF_TYPE_LONG, 1, buffer.width);
  tag(257, TIFF_TYPE_LONG, 1, buffer.height);
  tag(258, TIFF_TYPE_SHORT, samplesPerPixel, bitsOffset);
  tag(259, TIFF_TYPE_SHORT, 1, 1);
  tag(262, TIFF_TYPE_SHORT, 1, 5);
  tag(273, TIFF_TYPE_LONG, 1, stripOffset);
  tag(277, TIFF_TYPE_SHORT, 1, samplesPerPixel);
  tag(278, TIFF_TYPE_LONG, 1, buffer.height);
  tag(279, TIFF_TYPE_LONG, 1, stripByteCount);
  tag(284, TIFF_TYPE_SHORT, 1, 1);
  tag(332, TIFF_TYPE_SHORT, 1, 1);
  tag(338, TIFF_TYPE_SHORT, 1, 2);
  tag(339, TIFF_TYPE_SHORT, 1, 1);
  tag(34675, TIFF_TYPE_UNDEFINED, profileBytes.byteLength, profileOffset);
  view.setUint32(entry, 0, true);
  for (let index = 0; index < samplesPerPixel; index += 1) view.setUint16(bitsOffset + index * 2, 8, true);
  view.setUint16(extraSamplesOffset, 2, true); // unassociated alpha: ink stays authoritative beneath transparency.
  bytes.set(profileBytes, profileOffset);
  bytes.set(buffer.data, stripOffset);
  return { format: 'tiff', profile, width: buffer.width, height: buffer.height, samplesPerPixel, bytes };
}

function requireRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`CMYK TIFF ${label} lies outside the file.`);
  }
}

function entryValues(bytes: Uint8Array, view: DataView, entry: TiffEntry): number[] {
  const bytesPerValue = entry.type === TIFF_TYPE_SHORT ? 2 : entry.type === TIFF_TYPE_LONG ? 4 : 1;
  const byteLength = entry.count * bytesPerValue;
  const offset = byteLength <= 4 ? entry.entryOffset + 8 : entry.value;
  requireRange(bytes, offset, byteLength, 'tag value');
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const valueOffset = offset + index * bytesPerValue;
    values.push(entry.type === TIFF_TYPE_SHORT ? view.getUint16(valueOffset, true) : entry.type === TIFF_TYPE_LONG ? view.getUint32(valueOffset, true) : bytes[valueOffset]!);
  }
  return values;
}

function requiredEntry(entries: Map<number, TiffEntry>, id: number, label: string): TiffEntry {
  const entry = entries.get(id);
  if (!entry) throw new Error(`CMYK TIFF requires a ${label} tag.`);
  return entry;
}

function requiredSingle(entries: Map<number, TiffEntry>, id: number, label: string): TiffEntry {
  const entry = requiredEntry(entries, id, label);
  if (entry.count !== 1) throw new Error(`CMYK TIFF requires exactly one ${label} tag.`);
  return entry;
}

/**
 * Bounded decoder for the exact uncompressed, chunk-less DeviceCMYK TIFF subset this lane writes.
 * Missing ICC data is preserved as an explicit warning; callers must choose a profile rather than guess.
 */
export function decodeImageCmykTiff(bytes: Uint8Array): DecodedImageCmykTiff {
  requireRange(bytes, 0, 8, 'header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0x4949 || view.getUint16(2, true) !== 42) throw new Error('Only little-endian classic CMYK TIFF is supported.');
  const ifdOffset = view.getUint32(4, true);
  requireRange(bytes, ifdOffset, 2, 'IFD');
  const tagCount = view.getUint16(ifdOffset, true);
  if (tagCount > 32) throw new Error('CMYK TIFF has too many IFD entries.');
  requireRange(bytes, ifdOffset + 2, tagCount * 12 + 4, 'IFD entries');
  const entries = new Map<number, TiffEntry>();
  for (let index = 0; index < tagCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const id = view.getUint16(entryOffset, true);
    if (entries.has(id)) throw new Error(`CMYK TIFF repeats tag ${id}.`);
    entries.set(id, {
      type: view.getUint16(entryOffset + 2, true),
      count: view.getUint32(entryOffset + 4, true),
      value: view.getUint32(entryOffset + 8, true),
      entryOffset,
    });
  }
  const value = (id: number, label: string) => entryValues(bytes, view, requiredSingle(entries, id, label))[0]!;
  const width = value(256, 'width');
  const height = value(257, 'height');
  const samplesPerPixel = value(277, 'samples-per-pixel');
  const pixelCount = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(pixelCount) || pixelCount > IMAGE_CMYK_TIFF_MAX_PIXELS) {
    throw new Error(`CMYK TIFF dimensions exceed ${IMAGE_CMYK_TIFF_MAX_PIXELS.toLocaleString()} pixels.`);
  }
  if (samplesPerPixel !== 4 && samplesPerPixel !== 5) throw new Error('CMYK TIFF must have four CMYK samples or CMYK plus alpha.');
  if (value(259, 'compression') !== 1 || value(262, 'photometric') !== 5 || value(284, 'planar-configuration') !== 1 || value(332, 'ink-set') !== 1 || value(339, 'sample-format') !== 1) {
    throw new Error('CMYK TIFF must be uncompressed chunky DeviceCMYK samples.');
  }
  const bits = entryValues(bytes, view, requiredEntry(entries, 258, 'bits-per-sample'));
  if (bits.length !== samplesPerPixel || bits.some((bit) => bit !== 8)) throw new Error('CMYK TIFF must use 8-bit samples.');
  if (samplesPerPixel === 5 && value(338, 'extra-samples') !== 2) throw new Error('CMYK TIFF alpha must be unassociated.');
  if (samplesPerPixel === 4 && entries.has(338)) throw new Error('CMYK-only TIFF must not declare an alpha extra-sample.');
  const stripOffset = value(273, 'strip-offset');
  const stripByteCount = value(279, 'strip-byte-count');
  const expectedStripBytes = pixelCount * samplesPerPixel;
  if (stripByteCount !== expectedStripBytes) throw new Error('CMYK TIFF strip length does not match its pixel geometry.');
  requireRange(bytes, stripOffset, stripByteCount, 'pixel strip');
  const data = new Uint8Array(pixelCount * 5);
  for (let pixel = 0, source = stripOffset, target = 0; pixel < pixelCount; pixel += 1, source += samplesPerPixel, target += 5) {
    data[target] = bytes[source]!;
    data[target + 1] = bytes[source + 1]!;
    data[target + 2] = bytes[source + 2]!;
    data[target + 3] = bytes[source + 3]!;
    data[target + 4] = samplesPerPixel === 5 ? bytes[source + 4]! : 255;
  }
  const profileEntry = entries.get(34675);
  if (!profileEntry) return { buffer: { model: 'cmyk', depth: 'u8', width, height, data }, warnings: ['CMYK TIFF has no embedded ICC profile; choose a profile before editing or export.'] };
  if (profileEntry.type !== TIFF_TYPE_UNDEFINED || profileEntry.count < ICC_HEADER_BYTES || profileEntry.count > IMAGE_CMYK_MAX_PROFILE_BYTES) {
    throw new Error('CMYK TIFF has an invalid embedded ICC profile tag.');
  }
  requireRange(bytes, profileEntry.value, profileEntry.count, 'ICC profile');
  return {
    buffer: { model: 'cmyk', depth: 'u8', width, height, data },
    profileBytes: bytes.slice(profileEntry.value, profileEntry.value + profileEntry.count),
    warnings: [],
  };
}
