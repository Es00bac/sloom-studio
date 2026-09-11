import type { ResultType } from '../types/flow';

export type BinaryResumeKind = Extract<ResultType, 'image' | 'video' | 'audio' | 'package'>;

export interface BinaryResumeSample {
  head: Uint8Array;
  tail: Uint8Array;
  size: number;
  tailOffset: number;
}

export const BINARY_RESUME_SAMPLE_BYTES = 256 * 1024;
export const MAX_BINARY_RESUME_BYTES = 512 * 1024 * 1024;

const ASCII = new TextDecoder('ascii');

const MIME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  'image/png': ['image/png'],
  'image/gif': ['image/gif'],
  'image/webp': ['image/webp'],
  'image/avif': ['image/avif'],
  'image/bmp': ['image/bmp', 'image/x-ms-bmp'],
  'image/tiff': ['image/tiff', 'image/x-tiff'],
  'image/svg+xml': ['image/svg+xml'],
  'image/vnd.adobe.photoshop': ['image/vnd.adobe.photoshop', 'image/x-photoshop'],
  'image/x-xcf': ['image/x-xcf'],
  'image/x-exr': ['image/x-exr', 'image/exr'],
  'video/mp4': ['video/mp4', 'video/x-m4v'],
  'video/quicktime': ['video/quicktime'],
  'video/webm': ['video/webm'],
  'video/x-matroska': ['video/x-matroska'],
  'video/x-msvideo': ['video/x-msvideo', 'video/avi'],
  'video/hevc': ['video/hevc', 'video/h265'],
  'video/ogg': ['video/ogg'],
  'audio/mpeg': ['audio/mpeg', 'audio/mp3'],
  'audio/wav': ['audio/wav', 'audio/x-wav', 'audio/wave'],
  'audio/ogg': ['audio/ogg', 'audio/opus'],
  'audio/flac': ['audio/flac', 'audio/x-flac'],
  'audio/mp4': ['audio/mp4', 'audio/x-m4a'],
  'audio/aac': ['audio/aac'],
  'audio/aiff': ['audio/aiff', 'audio/x-aiff'],
  'audio/x-caf': ['audio/x-caf'],
  'audio/x-ms-wma': ['audio/x-ms-wma'],
  'application/zip': ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
};

export function binaryMimeMatches(detectedMimeType: string, claimedMimeType: string): boolean {
  const normalized = claimedMimeType.split(';', 1)[0].trim().toLowerCase();
  return (MIME_ALIASES[detectedMimeType] ?? [detectedMimeType]).includes(normalized);
}

export function sniffBinaryResumeSample(
  sample: BinaryResumeSample,
  expectedKind: BinaryResumeKind,
): string | undefined {
  if (
    sample.size <= 0
    || sample.size > MAX_BINARY_RESUME_BYTES
    || sample.head.length === 0
    || sample.head.length > BINARY_RESUME_SAMPLE_BYTES
    || sample.tail.length > BINARY_RESUME_SAMPLE_BYTES
    || sample.tailOffset < 0
    || sample.tailOffset + sample.tail.length > sample.size
  ) {
    return undefined;
  }

  switch (expectedKind) {
    case 'image':
      return sniffImage(sample);
    case 'video':
      return sniffVideo(sample);
    case 'audio':
      return sniffAudio(sample);
    case 'package':
      return isStructurallyPlausibleZip(sample) ? 'application/zip' : undefined;
  }
}

function sniffImage(sample: BinaryResumeSample): string | undefined {
  const { head } = sample;
  const complete = head.length === sample.size;
  if (isPng(sample)) return 'image/png';
  if (isJpeg(sample)) return 'image/jpeg';
  if (complete && isGif(head)) return 'image/gif';
  if (isWebp(head, sample.size)) return 'image/webp';

  const iso = sniffIsoBmff(sample);
  if (iso === 'image/avif') return iso;

  if (isBmp(head, sample.size)) return 'image/bmp';
  if (complete && isTiff(head, sample.size)) return 'image/tiff';
  if (complete && isSvg(head)) return 'image/svg+xml';
  if (complete && isPsd(head)) return 'image/vnd.adobe.photoshop';
  if (complete && isXcf(head)) return 'image/x-xcf';
  if (complete && isExr(head)) return 'image/x-exr';
  return undefined;
}

function sniffVideo(sample: BinaryResumeSample): string | undefined {
  const complete = sample.head.length === sample.size;
  const iso = sniffIsoBmff(sample);
  if (iso?.startsWith('video/')) return iso;
  if (complete && isEbmlVideo(sample.head)) {
    const doctype = lowerAscii(sample.head.subarray(0, Math.min(sample.head.length, 4096)));
    if (doctype.includes('webm')) return 'video/webm';
    if (doctype.includes('matroska')) return 'video/x-matroska';
  }
  if (complete && isAvi(sample.head)) return 'video/x-msvideo';
  if (complete && isOgg(sample.head, 'video')) return 'video/ogg';
  if (complete && isHevcAnnexB(sample.head)) return 'video/hevc';
  return undefined;
}

function sniffAudio(sample: BinaryResumeSample): string | undefined {
  const { head } = sample;
  const complete = head.length === sample.size;
  const iso = sniffIsoBmff(sample);
  if (iso === 'audio/mp4') return iso;
  if (complete && isWav(head)) return 'audio/wav';
  if (complete && isMp3(head)) return 'audio/mpeg';
  if (complete && isFlac(head)) return 'audio/flac';
  if (complete && isOgg(head, 'audio')) return 'audio/ogg';
  if (complete && isAacAdts(head)) return 'audio/aac';
  if (complete && isAiff(head)) return 'audio/aiff';
  if (complete && isCaf(head)) return 'audio/x-caf';
  if (complete && isAsfAudio(head)) {
    return 'audio/x-ms-wma';
  }
  return undefined;
}

function isPng(sample: BinaryResumeSample): boolean {
  const signature = bytesAt(sample, 0, 8);
  if (!signature || !startsWithBytes(signature, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;

  let offset = 8;
  let chunkIndex = 0;
  let colorType = -1;
  let seenPalette = false;
  let seenIdat = false;
  let idatBytes = 0;
  let idatEnded = false;

  while (offset < sample.size) {
    if (sample.size - offset < 12) return false;
    const chunkHeader = bytesAt(sample, offset, 8);
    if (!chunkHeader) return false;
    const length = readU32BE(chunkHeader, 0);
    if (length === undefined || length > sample.size - offset - 12) return false;
    const chunk = bytesAt(sample, offset + 4, length + 8);
    if (!chunk) return false;
    const type = asciiAt(chunk, 0, 4);
    const storedCrc = readU32BE(chunk, length + 4);
    if (storedCrc === undefined || pngCrc32(chunk.subarray(0, length + 4)) !== storedCrc) return false;

    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = readU32BE(chunk, 4) ?? 0;
      const height = readU32BE(chunk, 8) ?? 0;
      const bitDepth = chunk[12];
      colorType = chunk[13];
      const allowedDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width === 0 || height === 0 || !allowedDepths[colorType]?.includes(bitDepth)
        || chunk[14] !== 0 || chunk[15] !== 0 || ![0, 1].includes(chunk[16])
      ) return false;
    } else if (type === 'IHDR') {
      return false;
    } else if (type === 'PLTE') {
      if (seenPalette || seenIdat || length === 0 || length > 768 || length % 3 !== 0 || [0, 4].includes(colorType)) return false;
      seenPalette = true;
    } else if (type === 'IDAT') {
      if (idatEnded || (colorType === 3 && !seenPalette)) return false;
      seenIdat = true;
      idatBytes += length;
    } else if (type === 'IEND') {
      return length === 0 && seenIdat && idatBytes > 0 && offset + 12 === sample.size;
    } else {
      if (seenIdat) idatEnded = true;
      const firstTypeByte = chunk[0];
      if (firstTypeByte >= 0x41 && firstTypeByte <= 0x5a) return false;
    }

    offset += length + 12;
    chunkIndex += 1;
  }
  return false;
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isJpeg(sample: BinaryResumeSample): boolean {
  const bytes = sample.head;
  if (!startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return false;
  let offset = 2;
  let foundFrame = false;
  let scanDataOffset = -1;
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) return false;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    const length = readU16BE(bytes, offset);
    if (!length || length < 2 || offset + length > bytes.length) return false;
    if (marker === 0xda) {
      if (!foundFrame || length < 6) return false;
      scanDataOffset = offset + length;
      break;
    }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      foundFrame = length >= 8
        && (readU16BE(bytes, offset + 3) ?? 0) > 0
        && (readU16BE(bytes, offset + 5) ?? 0) > 0;
    }
    offset += length;
  }
  return foundFrame
    && scanDataOffset >= 0
    && sample.size - scanDataOffset > 2
    && sample.tailOffset + sample.tail.length === sample.size
    && sample.tail.length >= 2
    && sample.tail.at(-2) === 0xff
    && sample.tail.at(-1) === 0xd9;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || (!startsWithAscii(bytes, 'GIF87a') && !startsWithAscii(bytes, 'GIF89a'))) return false;
  const width = readU16LE(bytes, 6) ?? 0;
  const height = readU16LE(bytes, 8) ?? 0;
  if (width === 0 || height === 0) return false;
  const colorTableBytes = (bytes[10] & 0x80) === 0 ? 0 : 3 * (2 ** ((bytes[10] & 0x07) + 1));
  let offset = 13 + colorTableBytes;
  let seenImage = false;
  while (offset < bytes.length) {
    const introducer = bytes[offset++];
    if (introducer === 0x3b) return seenImage && offset === bytes.length;
    if (introducer === 0x21) {
      if (offset >= bytes.length) return false;
      offset += 1;
      const end = skipGifSubBlocks(bytes, offset);
      if (end < 0) return false;
      offset = end;
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > bytes.length) return false;
    const imageWidth = readU16LE(bytes, offset + 4) ?? 0;
    const imageHeight = readU16LE(bytes, offset + 6) ?? 0;
    if (imageWidth === 0 || imageHeight === 0) return false;
    const packed = bytes[offset + 8];
    offset += 9;
    if ((packed & 0x80) !== 0) offset += 3 * (2 ** ((packed & 0x07) + 1));
    if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return false;
    offset += 1;
    const dataStart = offset;
    const end = skipGifSubBlocks(bytes, offset);
    if (end < 0 || end <= dataStart + 1) return false;
    offset = end;
    seenImage = true;
  }
  return false;
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  let payloadBytes = 0;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === 0) return payloadBytes > 0 ? offset : -1;
    if (length > bytes.length - offset) return -1;
    payloadBytes += length;
    offset += length;
  }
  return -1;
}

function isWebp(bytes: Uint8Array, totalSize: number): boolean {
  if (bytes.length !== totalSize || bytes.length < 30 || !isRiffType(bytes, 'WEBP')) return false;
  const declaredSize = (readU32LE(bytes, 4) ?? 0) + 8;
  if (declaredSize !== totalSize) return false;
  let offset = 12;
  let seenCanvas = false;
  let seenImagePayload = false;
  while (offset < totalSize) {
    if (totalSize - offset < 8) return false;
    const chunkType = asciiAt(bytes, offset, 4);
    const chunkSize = readU32LE(bytes, offset + 4);
    if (chunkSize === undefined || chunkSize > totalSize - offset - 8) return false;
    const payload = offset + 8;
    const paddedEnd = payload + chunkSize + (chunkSize & 1);
    if (paddedEnd > totalSize) return false;
    if (chunkType === 'VP8X') {
      if (seenCanvas || offset !== 12 || chunkSize !== 10
        || readU24LE(bytes, payload + 4) === 0xffffff || readU24LE(bytes, payload + 7) === 0xffffff) return false;
      seenCanvas = true;
    } else if (chunkType === 'VP8 ') {
      if (chunkSize < 10 || !startsWithBytes(bytes.subarray(payload + 3), [0x9d, 0x01, 0x2a])) return false;
      const width = (readU16LE(bytes, payload + 6) ?? 0) & 0x3fff;
      const height = (readU16LE(bytes, payload + 8) ?? 0) & 0x3fff;
      if (width === 0 || height === 0) return false;
      seenImagePayload = true;
    } else if (chunkType === 'VP8L') {
      if (chunkSize < 5 || bytes[payload] !== 0x2f) return false;
      seenImagePayload = true;
    } else if (chunkType === 'ANMF') {
      if (chunkSize <= 16) return false;
      seenImagePayload = true;
    }
    offset = paddedEnd;
  }
  return offset === totalSize && seenImagePayload;
}

function isBmp(bytes: Uint8Array, totalSize: number): boolean {
  if (!startsWithAscii(bytes, 'BM') || bytes.length < 26) return false;
  const declaredSize = readU32LE(bytes, 2) ?? 0;
  const pixelOffset = readU32LE(bytes, 10) ?? 0;
  const dibSize = readU32LE(bytes, 14) ?? 0;
  if (declaredSize !== totalSize || ![12, 40, 52, 56, 64, 108, 124].includes(dibSize)
    || 14 + dibSize > bytes.length || pixelOffset < 14 + dibSize || pixelOffset >= totalSize) return false;
  const core = dibSize === 12;
  const width = core ? readU16LE(bytes, 18) : readU32LE(bytes, 18);
  const height = core ? readU16LE(bytes, 20) : readI32LE(bytes, 22);
  const planes = readU16LE(bytes, core ? 22 : 26);
  const bitsPerPixel = readU16LE(bytes, core ? 24 : 28) ?? 0;
  if (!width || !height || planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)) return false;
  if (core) {
    const minimumPixelBytes = Math.ceil((width * bitsPerPixel) / 32) * 4 * height;
    return minimumPixelBytes <= totalSize - pixelOffset;
  }
  const compression = readU32LE(bytes, 30) ?? 0;
  const imageSize = readU32LE(bytes, 34) ?? 0;
  if (compression === 0) {
    const minimumPixelBytes = Math.ceil((width * bitsPerPixel) / 32) * 4 * Math.abs(height);
    return minimumPixelBytes <= totalSize - pixelOffset;
  }
  return imageSize > 0 && imageSize <= totalSize - pixelOffset;
}

function isTiff(bytes: Uint8Array, totalSize: number): boolean {
  const little = startsWithBytes(bytes, [0x49, 0x49, 0x2a, 0x00]);
  const big = startsWithBytes(bytes, [0x4d, 0x4d, 0x00, 0x2a]);
  if (!little && !big) return false;
  const offset = little ? readU32LE(bytes, 4) : readU32BE(bytes, 4);
  if (offset === undefined || offset < 8 || offset + 6 > totalSize) return false;
  const entries = little ? readU16LE(bytes, offset) : readU16BE(bytes, offset);
  return entries !== undefined && entries > 0 && entries <= 4096 && offset + 2 + entries * 12 + 4 <= bytes.length;
}

function isSvg(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    .replace(/^\ufeff/, '')
    .trimStart();
  if (!/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text)) return false;
  const completeText = new TextDecoder().decode(bytes).trim();
  return /<\/svg>\s*$/i.test(completeText) || /<svg\b[^>]*\/>(?:\s|<!--[^]*?-->)*$/i.test(completeText);
}

function isPsd(bytes: Uint8Array): boolean {
  if (!startsWithAscii(bytes, '8BPS') || bytes.length < 40) return false;
  const version = readU16BE(bytes, 4) ?? 0;
  if (![1, 2].includes(version) || bytes.subarray(6, 12).some((byte) => byte !== 0)
    || (readU16BE(bytes, 12) ?? 0) === 0 || (readU32BE(bytes, 14) ?? 0) === 0
    || (readU32BE(bytes, 18) ?? 0) === 0) return false;
  let offset = 26;
  for (let section = 0; section < 2; section += 1) {
    const length = readU32BE(bytes, offset);
    if (length === undefined || length > bytes.length - offset - 4) return false;
    offset += 4 + length;
  }
  const layerLengthBytes = version === 1 ? 4 : 8;
  const layerLength = version === 1 ? readU32BE(bytes, offset) : readSafeU64BE(bytes, offset);
  if (layerLength === undefined || layerLength > bytes.length - offset - layerLengthBytes) return false;
  offset += layerLengthBytes + layerLength;
  const compression = readU16BE(bytes, offset);
  return compression !== undefined && compression <= 3 && offset + 2 < bytes.length;
}

function isXcf(bytes: Uint8Array): boolean {
  if (!startsWithAscii(bytes, 'gimp xcf ') || bytes.length < 30) return false;
  const versionEnd = bytes.indexOf(0, 9);
  if (versionEnd < 0 || versionEnd > 20) return false;
  const version = asciiAt(bytes, 9, versionEnd - 9);
  const dimensions = versionEnd + 1;
  return /^(?:file|v\d{3})$/.test(version)
    && (readU32BE(bytes, dimensions) ?? 0) > 0
    && (readU32BE(bytes, dimensions + 4) ?? 0) > 0
    && dimensions + 12 < bytes.length;
}

function isExr(bytes: Uint8Array): boolean {
  if (!startsWithBytes(bytes, [0x76, 0x2f, 0x31, 0x01]) || bytes.length < 16) return false;
  const version = readU32LE(bytes, 4) ?? 0;
  if ((version & 0xff) < 1 || (version & 0xff) > 2) return false;
  let offset = 8;
  let attributes = 0;
  while (offset < bytes.length && bytes[offset] !== 0) {
    const nameEnd = bytes.indexOf(0, offset);
    if (nameEnd < 0) return false;
    const typeEnd = bytes.indexOf(0, nameEnd + 1);
    if (typeEnd < 0) return false;
    const size = readU32LE(bytes, typeEnd + 1);
    if (size === undefined || size > bytes.length - typeEnd - 5) return false;
    offset = typeEnd + 5 + size;
    attributes += 1;
  }
  return attributes > 0 && offset + 1 < bytes.length;
}

function isAvi(bytes: Uint8Array): boolean {
  if (!isRiffType(bytes, 'AVI ') || (readU32LE(bytes, 4) ?? 0) + 8 !== bytes.length) return false;
  let offset = 12;
  let seenHeader = false;
  let movieBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) return false;
    const type = asciiAt(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    if (size === undefined || size > bytes.length - offset - 8) return false;
    if (type === 'LIST' && size >= 4) {
      const listType = asciiAt(bytes, offset + 8, 4);
      if (listType === 'hdrl') seenHeader = true;
      if (listType === 'movi' && size > 4) movieBytes += size - 4;
    }
    offset += 8 + size + (size & 1);
    if (offset > bytes.length) return false;
  }
  return offset === bytes.length && seenHeader && movieBytes > 0;
}

function isWav(bytes: Uint8Array): boolean {
  if (!isRiffType(bytes, 'WAVE') || (readU32LE(bytes, 4) ?? 0) + 8 !== bytes.length) return false;
  let offset = 12;
  let seenFormat = false;
  let dataBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) return false;
    const type = asciiAt(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    if (size === undefined || size > bytes.length - offset - 8) return false;
    const payload = offset + 8;
    if (type === 'fmt ') {
      const format = readU16LE(bytes, payload) ?? 0;
      const channels = readU16LE(bytes, payload + 2) ?? 0;
      const sampleRate = readU32LE(bytes, payload + 4) ?? 0;
      if (seenFormat || size < 16 || format === 0 || channels === 0 || sampleRate === 0) return false;
      seenFormat = true;
    } else if (type === 'data') {
      if (!seenFormat || size === 0) return false;
      dataBytes += size;
    }
    offset = payload + size + (size & 1);
    if (offset > bytes.length) return false;
  }
  return offset === bytes.length && seenFormat && dataBytes > 0;
}

function isMp3(bytes: Uint8Array): boolean {
  let offset = 0;
  if (startsWithAscii(bytes, 'ID3')) {
    if (bytes.length < 10 || bytes.slice(6, 10).some((byte) => byte > 0x7f)) return false;
    offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  for (let index = offset; index + 3 < Math.min(bytes.length, offset + 4096); index += 1) {
    if (bytes[index] !== 0xff || (bytes[index + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[index + 1] >> 3) & 0x03;
    const layer = (bytes[index + 1] >> 1) & 0x03;
    const bitrate = (bytes[index + 2] >> 4) & 0x0f;
    const sampleRate = (bytes[index + 2] >> 2) & 0x03;
    const frameLength = mp3FrameLength(bytes, index);
    if (version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3
      && frameLength !== undefined && frameLength > 4 && index + frameLength <= bytes.length) return true;
  }
  return false;
}

function mp3FrameLength(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > bytes.length) return undefined;
  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return undefined;
  const mpeg1 = versionBits === 3;
  const layerIndex = layerBits === 3 ? 0 : layerBits === 2 ? 1 : 2;
  const mpeg1Rates = [
    [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ];
  const mpeg2Rates = [
    [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ];
  const baseSampleRates = [44100, 48000, 32000];
  const sampleRate = baseSampleRates[sampleRateIndex] / (versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4);
  const bitrate = (mpeg1 ? mpeg1Rates : mpeg2Rates)[layerIndex][bitrateIndex - 1] * 1000;
  const padding = (bytes[offset + 2] >> 1) & 1;
  if (layerBits === 3) return Math.floor((12 * bitrate) / sampleRate + padding) * 4;
  return Math.floor(((layerBits === 1 && !mpeg1 ? 72 : 144) * bitrate) / sampleRate + padding);
}

function isFlac(bytes: Uint8Array): boolean {
  if (!startsWithAscii(bytes, 'fLaC') || bytes.length < 44) return false;
  let offset = 4;
  let seenStreamInfo = false;
  let last = false;
  while (!last) {
    if (offset + 4 > bytes.length) return false;
    last = (bytes[offset] & 0x80) !== 0;
    const type = bytes[offset] & 0x7f;
    const length = readU24BE(bytes, offset + 1);
    if (length === undefined || length > bytes.length - offset - 4) return false;
    if (type === 0) {
      if (seenStreamInfo || offset !== 4 || length !== 34) return false;
      seenStreamInfo = true;
    }
    offset += 4 + length;
  }
  return seenStreamInfo && offset + 2 <= bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xfc) === 0xf8;
}

function isOgg(bytes: Uint8Array, expected: 'audio' | 'video'): boolean {
  let offset = 0;
  let pages = 0;
  let serial: number | undefined;
  let seenCodec = false;
  let seenEos = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 27 || !startsWithAscii(bytes.subarray(offset), 'OggS') || bytes[offset + 4] !== 0) return false;
    const headerType = bytes[offset + 5];
    const pageSerial = readU32LE(bytes, offset + 14);
    const sequence = readU32LE(bytes, offset + 18);
    const segmentCount = bytes[offset + 26];
    if (pageSerial === undefined || sequence !== pages || offset + 27 + segmentCount > bytes.length) return false;
    if (serial === undefined) serial = pageSerial;
    if (pageSerial !== serial || (pages === 0 && (headerType & 0x02) === 0)) return false;
    let payloadLength = 0;
    for (let index = 0; index < segmentCount; index += 1) payloadLength += bytes[offset + 27 + index];
    const pageLength = 27 + segmentCount + payloadLength;
    if (pageLength > bytes.length - offset) return false;
    const storedCrc = readU32LE(bytes, offset + 22);
    const page = Uint8Array.from(bytes.subarray(offset, offset + pageLength));
    page.fill(0, 22, 26);
    if (storedCrc === undefined || oggCrc32(page) !== storedCrc) return false;
    if (pages === 0) {
      const payload = bytes.subarray(offset + 27 + segmentCount, offset + pageLength);
      const codec = lowerAscii(payload.subarray(0, Math.min(payload.length, 64)));
      seenCodec = expected === 'video'
        ? codec.includes('theora')
        : codec.includes('vorbis') || codec.includes('opushead') || startsWithAscii(payload, 'fLaC') || startsWithAscii(payload, 'Speex   ');
    }
    seenEos = (headerType & 0x04) !== 0;
    offset += pageLength;
    pages += 1;
  }
  return pages > 0 && seenCodec && seenEos;
}

function oggCrc32(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x80000000) !== 0 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

function isAacAdts(bytes: Uint8Array): boolean {
  let offset = 0;
  let frames = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 7 || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) return false;
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x0f;
    const headerLength = (bytes[offset + 1] & 0x01) === 0 ? 9 : 7;
    const frameLength = ((bytes[offset + 3] & 0x03) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
    if (sampleRateIndex >= 13 || frameLength <= headerLength || frameLength > bytes.length - offset) return false;
    offset += frameLength;
    frames += 1;
  }
  return frames > 0;
}

function isAiff(bytes: Uint8Array): boolean {
  if (!startsWithAscii(bytes, 'FORM') || !['AIFF', 'AIFC'].includes(asciiAt(bytes, 8, 4))
    || (readU32BE(bytes, 4) ?? 0) + 8 !== bytes.length) return false;
  let offset = 12;
  let seenCommon = false;
  let soundBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) return false;
    const type = asciiAt(bytes, offset, 4);
    const size = readU32BE(bytes, offset + 4);
    if (size === undefined || size > bytes.length - offset - 8) return false;
    const payload = offset + 8;
    if (type === 'COMM') {
      if (seenCommon || size < 18 || (readU16BE(bytes, payload) ?? 0) === 0 || (readU32BE(bytes, payload + 2) ?? 0) === 0) return false;
      seenCommon = true;
    } else if (type === 'SSND') {
      if (!seenCommon || size <= 8) return false;
      soundBytes += size - 8;
    }
    offset = payload + size + (size & 1);
    if (offset > bytes.length) return false;
  }
  return offset === bytes.length && seenCommon && soundBytes > 0;
}

function isCaf(bytes: Uint8Array): boolean {
  if (!startsWithAscii(bytes, 'caff') || readU16BE(bytes, 4) !== 1 || readU16BE(bytes, 6) !== 0) return false;
  let offset = 8;
  let seenDescription = false;
  let audioBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return false;
    const type = asciiAt(bytes, offset, 4);
    const size = readSafeU64BE(bytes, offset + 4);
    if (size === undefined || size > bytes.length - offset - 12) return false;
    if (type === 'desc') {
      if (seenDescription || size !== 32) return false;
      seenDescription = true;
    } else if (type === 'data') {
      if (!seenDescription || size <= 4) return false;
      audioBytes += size - 4;
    }
    offset += 12 + size;
  }
  return offset === bytes.length && seenDescription && audioBytes > 0;
}

function isAsfAudio(bytes: Uint8Array): boolean {
  const headerGuid = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c];
  const dataGuid = [0x36, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c];
  if (!startsWithBytes(bytes, headerGuid) || bytes.length < 54) return false;
  const headerSize = readSafeU64LE(bytes, 16);
  if (headerSize === undefined || headerSize < 30 || headerSize + 50 > bytes.length) return false;
  const dataOffset = headerSize;
  const dataSize = readSafeU64LE(bytes, dataOffset + 16);
  return startsWithBytes(bytes.subarray(dataOffset), dataGuid)
    && dataSize !== undefined && dataSize >= 50 && dataOffset + dataSize === bytes.length;
}

function isHevcAnnexB(bytes: Uint8Array): boolean {
  const types = new Set<number>();
  for (let index = 0; index + 5 < Math.min(bytes.length, 4096); index += 1) {
    const start = bytes[index] === 0 && bytes[index + 1] === 0
      && (bytes[index + 2] === 1 || (bytes[index + 2] === 0 && bytes[index + 3] === 1));
    if (!start) continue;
    const nalOffset = index + (bytes[index + 2] === 1 ? 3 : 4);
    const nalType = (bytes[nalOffset] >> 1) & 0x3f;
    types.add(nalType);
  }
  return types.has(32) && types.has(33) && types.has(34) && [...types].some((type) => type <= 31);
}

function isEbmlVideo(bytes: Uint8Array): boolean {
  if (!startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]) || bytes.length < 16) return false;
  const headerSize = readEbmlVint(bytes, 4);
  if (!headerSize || headerSize.value <= 0 || headerSize.value > bytes.length - 4 - headerSize.length) return false;
  const headerEnd = 4 + headerSize.length + headerSize.value;
  const headerText = lowerAscii(bytes.subarray(0, headerEnd));
  if (!headerText.includes('webm') && !headerText.includes('matroska')) return false;
  const segment = findBytes(bytes, [0x18, 0x53, 0x80, 0x67], headerEnd);
  if (segment < 0) return false;
  const tracks = findBytes(bytes, [0x16, 0x54, 0xae, 0x6b], segment + 4);
  const cluster = findBytes(bytes, [0x1f, 0x43, 0xb6, 0x75], segment + 4);
  return tracks >= 0 && cluster > tracks && findBytes(bytes, [0xa3], cluster + 4) > cluster;
}

function readEbmlVint(bytes: Uint8Array, offset: number): { length: number; value: number } | undefined {
  if (offset >= bytes.length || bytes[offset] === 0) return undefined;
  let mask = 0x80;
  let length = 1;
  while ((bytes[offset] & mask) === 0 && length <= 8) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return undefined;
  let value = bytes[offset] & (mask - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return Number.isSafeInteger(value) ? { length, value } : undefined;
}

function findBytes(bytes: Uint8Array, value: readonly number[], from = 0): number {
  outer: for (let offset = Math.max(0, from); offset + value.length <= bytes.length; offset += 1) {
    for (let index = 0; index < value.length; index += 1) {
      if (bytes[offset + index] !== value[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function sniffIsoBmff(sample: BinaryResumeSample): string | undefined {
  const budget: IsoParseBudget = { remainingBoxes: MAX_ISO_BOX_WORK };
  const boxes = parseIsoBoxes(sample, 0, sample.size, 0, budget);
  if (!boxes || boxes.length < 2 || boxes[0].type !== 'ftyp'
    || boxes.filter((box) => box.type === 'ftyp').length !== 1) return undefined;
  const fileType = boxes[0];
  const bytes = bytesAt(sample, fileType.payloadOffset, fileType.payloadSize);
  if (!bytes || bytes.length < 8 || bytes.length % 4 !== 0) return undefined;
  const brands = [asciiAt(bytes, 0, 4)];
  for (let offset = 8; offset + 4 <= bytes.length; offset += 4) brands.push(asciiAt(bytes, offset, 4));

  const mediaData = boxes.filter((box) => box.type === 'mdat');
  if (mediaData.length === 0 || mediaData.some((box) => box.payloadSize === 0)) return undefined;
  if (brands.some((brand) => ['avif', 'avis'].includes(brand))) {
    return boxes.filter((box) => box.type === 'meta' && box.payloadSize > 4).length === 1
      ? 'image/avif'
      : undefined;
  }

  const forbiddenTopLevel = new Set([
    'trak', 'mdia', 'minf', 'stbl', 'hdlr', 'tkhd', 'mdhd', 'vmhd', 'smhd',
    'dinf', 'dref', 'stsd', 'stts', 'stsc', 'stsz', 'stz2', 'stco', 'co64',
  ]);
  if (boxes.some((box) => forbiddenTopLevel.has(box.type))) return undefined;
  const movies = boxes.filter((box) => box.type === 'moov');
  if (movies.length !== 1) return undefined;
  const trackKinds = validateIsoMovie(sample, movies[0], mediaData, budget);
  if (!trackKinds) return undefined;
  if (trackKinds.has('video')) return brands.includes('qt  ') ? 'video/quicktime' : 'video/mp4';
  if (trackKinds.has('audio')) return 'audio/mp4';
  return undefined;
}

const MAX_ISO_BOX_DEPTH = 8;
const MAX_ISO_BOX_WORK = 2_048;
const MAX_ISO_TABLE_ENTRIES = 65_536;

interface IsoParseBudget {
  remainingBoxes: number;
}

interface IsoBox {
  type: string;
  offset: number;
  size: number;
  payloadOffset: number;
  payloadSize: number;
}

function parseIsoBoxes(
  sample: BinaryResumeSample,
  start: number,
  end: number,
  depth: number,
  budget: IsoParseBudget,
): IsoBox[] | undefined {
  if (depth > MAX_ISO_BOX_DEPTH || start < 0 || end < start || end > sample.size) return undefined;
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    if (budget.remainingBoxes <= 0) return undefined;
    budget.remainingBoxes -= 1;
    const header = bytesAt(sample, offset, Math.min(16, end - offset));
    if (!header || header.length < 8) return undefined;
    const size32 = readU32BE(header, 0);
    const type = asciiAt(header, 4, 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      size = readSafeU64BE(header, 8);
      headerSize = 16;
    }
    if (size32 === 0 || size === undefined || size < headerSize || size > end - offset
      || !isPrintableIsoType(type)) return undefined;
    boxes.push({ type, offset, size, payloadOffset: offset + headerSize, payloadSize: size - headerSize });
    offset += size;
  }
  return offset === end ? boxes : undefined;
}

function isPrintableIsoType(type: string): boolean {
  return type.length === 4 && [...type].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e;
  });
}

function validateIsoMovie(
  sample: BinaryResumeSample,
  movie: IsoBox,
  mediaData: readonly IsoBox[],
  budget: IsoParseBudget,
): Set<'video' | 'audio'> | undefined {
  const boxes = parseIsoBoxes(sample, movie.payloadOffset, movie.payloadOffset + movie.payloadSize, 1, budget);
  if (!boxes || countIsoBoxes(boxes, 'mvhd') !== 1 || !validateIsoDurationHeader(sample, onlyIsoBox(boxes, 'mvhd')!, 'mvhd')) {
    return undefined;
  }
  const tracks = boxes.filter((box) => box.type === 'trak');
  if (tracks.length === 0 || boxes.some((box) => [
    'moov', 'mdia', 'minf', 'stbl', 'hdlr', 'mdhd', 'vmhd', 'smhd', 'dinf', 'dref',
    'stsd', 'stts', 'stsc', 'stsz', 'stz2', 'stco', 'co64',
  ].includes(box.type))) return undefined;

  const kinds = new Set<'video' | 'audio'>();
  for (const track of tracks) {
    const kind = validateIsoTrack(sample, track, mediaData, budget);
    if (kind === undefined) return undefined;
    if (kind !== 'other') kinds.add(kind);
  }
  return kinds.size > 0 ? kinds : undefined;
}

function validateIsoTrack(
  sample: BinaryResumeSample,
  track: IsoBox,
  mediaData: readonly IsoBox[],
  budget: IsoParseBudget,
): 'video' | 'audio' | 'other' | undefined {
  const boxes = parseIsoBoxes(sample, track.payloadOffset, track.payloadOffset + track.payloadSize, 2, budget);
  const trackHeader = boxes && onlyIsoBox(boxes, 'tkhd');
  const media = boxes && onlyIsoBox(boxes, 'mdia');
  if (!boxes || !trackHeader || !media || !validateIsoDurationHeader(sample, trackHeader, 'tkhd')
    || boxes.some((box) => ['moov', 'trak', 'minf', 'stbl', 'hdlr', 'mdhd', 'vmhd', 'smhd', 'dinf', 'dref',
      'stsd', 'stts', 'stsc', 'stsz', 'stz2', 'stco', 'co64'].includes(box.type))) return undefined;
  return validateIsoMedia(sample, media, mediaData, budget);
}

function validateIsoMedia(
  sample: BinaryResumeSample,
  media: IsoBox,
  mediaData: readonly IsoBox[],
  budget: IsoParseBudget,
): 'video' | 'audio' | 'other' | undefined {
  const boxes = parseIsoBoxes(sample, media.payloadOffset, media.payloadOffset + media.payloadSize, 3, budget);
  const mediaHeader = boxes && onlyIsoBox(boxes, 'mdhd');
  const handler = boxes && onlyIsoBox(boxes, 'hdlr');
  const mediaInformation = boxes && onlyIsoBox(boxes, 'minf');
  if (!boxes || !mediaHeader || !handler || !mediaInformation
    || !validateIsoDurationHeader(sample, mediaHeader, 'mdhd')
    || boxes.some((box) => ['moov', 'trak', 'mdia', 'stbl', 'tkhd', 'vmhd', 'smhd', 'dinf', 'dref',
      'stsd', 'stts', 'stsc', 'stsz', 'stz2', 'stco', 'co64'].includes(box.type))) return undefined;
  const handlerBytes = bytesAt(sample, handler.payloadOffset, handler.payloadSize);
  if (!handlerBytes || handlerBytes.length < 12 || handlerBytes[0] !== 0) return undefined;
  const handlerType = asciiAt(handlerBytes, 8, 4);
  if (handlerType !== 'vide' && handlerType !== 'soun') return 'other';
  const kind = handlerType === 'vide' ? 'video' : 'audio';
  return validateIsoMediaInformation(sample, mediaInformation, kind, mediaData, budget) ? kind : undefined;
}

function validateIsoMediaInformation(
  sample: BinaryResumeSample,
  mediaInformation: IsoBox,
  kind: 'video' | 'audio',
  mediaData: readonly IsoBox[],
  budget: IsoParseBudget,
): boolean {
  const boxes = parseIsoBoxes(
    sample,
    mediaInformation.payloadOffset,
    mediaInformation.payloadOffset + mediaInformation.payloadSize,
    4,
    budget,
  );
  if (!boxes || !onlyIsoBox(boxes, 'dinf') || !onlyIsoBox(boxes, 'stbl')) return false;
  const requiredHeader = kind === 'video' ? 'vmhd' : 'smhd';
  const forbiddenHeader = kind === 'video' ? 'smhd' : 'vmhd';
  if (!onlyIsoBox(boxes, requiredHeader) || countIsoBoxes(boxes, forbiddenHeader) !== 0
    || boxes.some((box) => ['moov', 'trak', 'mdia', 'minf', 'hdlr', 'tkhd', 'mdhd', 'dref',
      'stsd', 'stts', 'stsc', 'stsz', 'stz2', 'stco', 'co64'].includes(box.type))) return false;
  const dataReferenceCount = validateIsoDataInformation(sample, onlyIsoBox(boxes, 'dinf')!, budget);
  return dataReferenceCount !== undefined && validateIsoSampleTable(
    sample,
    onlyIsoBox(boxes, 'stbl')!,
    kind,
    dataReferenceCount,
    mediaData,
    budget,
  );
}

function validateIsoDataInformation(
  sample: BinaryResumeSample,
  dataInformation: IsoBox,
  budget: IsoParseBudget,
): number | undefined {
  const boxes = parseIsoBoxes(
    sample,
    dataInformation.payloadOffset,
    dataInformation.payloadOffset + dataInformation.payloadSize,
    5,
    budget,
  );
  const reference = boxes && onlyIsoBox(boxes, 'dref');
  if (!boxes || !reference || boxes.length !== 1) return undefined;
  const bytes = bytesAt(sample, reference.payloadOffset, reference.payloadSize);
  if (!bytes || bytes.length < 8 || readU32BE(bytes, 0) !== 0) return undefined;
  const entryCount = readU32BE(bytes, 4);
  if (!entryCount || entryCount > MAX_ISO_TABLE_ENTRIES) return undefined;
  const entries = parseIsoBoxes(sample, reference.payloadOffset + 8, reference.payloadOffset + reference.payloadSize, 6, budget);
  if (!entries || entries.length !== entryCount) return undefined;
  for (const entry of entries) {
    const entryBytes = bytesAt(sample, entry.payloadOffset, entry.payloadSize);
    if (entry.type !== 'url ' || !entryBytes || entryBytes.length < 4
      || entryBytes[0] !== 0 || (readU24BE(entryBytes, 1) ?? 0) !== 1) return undefined;
  }
  return entryCount;
}

interface IsoSampleDescription {
  codec: string;
  dataReferenceIndex: number;
}

interface IsoSampleSizes {
  count: number;
  fixedSize: number;
  sizes?: readonly number[];
}

interface IsoSampleToChunk {
  firstChunk: number;
  samplesPerChunk: number;
  descriptionIndex: number;
}

function validateIsoSampleTable(
  sample: BinaryResumeSample,
  sampleTable: IsoBox,
  kind: 'video' | 'audio',
  dataReferenceCount: number,
  mediaData: readonly IsoBox[],
  budget: IsoParseBudget,
): boolean {
  const boxes = parseIsoBoxes(sample, sampleTable.payloadOffset, sampleTable.payloadOffset + sampleTable.payloadSize, 5, budget);
  if (!boxes) return false;
  const stsd = onlyIsoBox(boxes, 'stsd');
  const stts = onlyIsoBox(boxes, 'stts');
  const stsc = onlyIsoBox(boxes, 'stsc');
  const sizeBox = onlyIsoBox(boxes, 'stsz') ?? onlyIsoBox(boxes, 'stz2');
  const offsetBox = onlyIsoBox(boxes, 'stco') ?? onlyIsoBox(boxes, 'co64');
  if (!stsd || !stts || !stsc || !sizeBox || !offsetBox
    || countIsoBoxes(boxes, 'stsz') + countIsoBoxes(boxes, 'stz2') !== 1
    || countIsoBoxes(boxes, 'stco') + countIsoBoxes(boxes, 'co64') !== 1
    || boxes.some((box) => ['moov', 'trak', 'mdia', 'minf', 'stbl', 'hdlr', 'tkhd', 'mdhd',
      'vmhd', 'smhd', 'dinf', 'dref'].includes(box.type))) return false;

  const descriptions = parseIsoSampleDescriptions(sample, stsd, kind, dataReferenceCount, budget);
  const timedSamples = parseIsoTimeToSample(sample, stts);
  const mappings = parseIsoSampleToChunk(sample, stsc);
  const sizes = parseIsoSampleSizes(sample, sizeBox);
  const offsets = parseIsoChunkOffsets(sample, offsetBox);
  if (!descriptions || timedSamples === undefined || !mappings || !sizes || !offsets
    || timedSamples !== sizes.count || offsets.length === 0) return false;

  let mappedSamples = 0;
  for (let index = 0; index < mappings.length; index += 1) {
    const mapping = mappings[index];
    const nextFirst = mappings[index + 1]?.firstChunk ?? offsets.length + 1;
    if (mapping.firstChunk > offsets.length || nextFirst <= mapping.firstChunk
      || mapping.descriptionIndex > descriptions.length) return false;
    mappedSamples += (nextFirst - mapping.firstChunk) * mapping.samplesPerChunk;
    if (!Number.isSafeInteger(mappedSamples) || mappedSamples > sizes.count) return false;
  }
  if (mappedSamples !== sizes.count) return false;

  let mappingIndex = 0;
  let sampleIndex = 0;
  let previousOffset = -1;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    while (mappingIndex + 1 < mappings.length && mappings[mappingIndex + 1].firstChunk <= chunkIndex + 1) mappingIndex += 1;
    const mapping = mappings[mappingIndex];
    let chunkBytes = 0;
    for (let item = 0; item < mapping.samplesPerChunk; item += 1) {
      const sampleSize = sizes.fixedSize || sizes.sizes?.[sampleIndex];
      if (!sampleSize) return false;
      chunkBytes += sampleSize;
      sampleIndex += 1;
    }
    const chunkOffset = offsets[chunkIndex];
    const range = mediaData.find((box) => (
      chunkOffset >= box.payloadOffset && chunkOffset + chunkBytes <= box.payloadOffset + box.payloadSize
    ));
    if (!range || chunkOffset <= previousOffset || !Number.isSafeInteger(chunkOffset + chunkBytes)) return false;
    const evidence = bytesAt(sample, chunkOffset, Math.min(chunkBytes, 16));
    if (!evidence || !evidence.some((byte) => byte !== 0)) return false;
    previousOffset = chunkOffset;
  }
  return sampleIndex === sizes.count;
}

function parseIsoSampleDescriptions(
  sample: BinaryResumeSample,
  sampleDescription: IsoBox,
  kind: 'video' | 'audio',
  dataReferenceCount: number,
  budget: IsoParseBudget,
): IsoSampleDescription[] | undefined {
  const bytes = bytesAt(sample, sampleDescription.payloadOffset, sampleDescription.payloadSize);
  if (!bytes || bytes.length < 8 || readU32BE(bytes, 0) !== 0) return undefined;
  const entryCount = readU32BE(bytes, 4);
  if (!entryCount || entryCount > 32) return undefined;
  const entries = parseIsoBoxes(
    sample,
    sampleDescription.payloadOffset + 8,
    sampleDescription.payloadOffset + sampleDescription.payloadSize,
    6,
    budget,
  );
  if (!entries || entries.length !== entryCount) return undefined;
  const descriptions: IsoSampleDescription[] = [];
  for (const entry of entries) {
    const description = parseIsoSampleEntry(sample, entry, kind, budget);
    if (!description || description.dataReferenceIndex > dataReferenceCount) return undefined;
    descriptions.push(description);
  }
  return descriptions;
}

function parseIsoSampleEntry(
  sample: BinaryResumeSample,
  entry: IsoBox,
  kind: 'video' | 'audio',
  budget: IsoParseBudget,
): IsoSampleDescription | undefined {
  const bytes = bytesAt(sample, entry.payloadOffset, entry.payloadSize);
  const headerSize = kind === 'video' ? 78 : 28;
  if (!bytes || bytes.length < headerSize) return undefined;
  const dataReferenceIndex = readU16BE(bytes, 6) ?? 0;
  if (dataReferenceIndex === 0) return undefined;

  if (kind === 'video') {
    if ((readU16BE(bytes, 24) ?? 0) === 0 || (readU16BE(bytes, 26) ?? 0) === 0
      || (readU16BE(bytes, 40) ?? 0) === 0) return undefined;
  } else {
    const version = readU16BE(bytes, 8);
    if (version !== 0 || (readU16BE(bytes, 16) ?? 0) === 0 || (readU16BE(bytes, 18) ?? 0) === 0
      || (readU32BE(bytes, 24) ?? 0) >>> 16 === 0) return undefined;
  }

  const children = entry.payloadSize === headerSize
    ? []
    : parseIsoBoxes(sample, entry.payloadOffset + headerSize, entry.payloadOffset + entry.payloadSize, 7, budget);
  if (!children) return undefined;
  if (!validateIsoCodecConfiguration(sample, entry.type, kind, children)) return undefined;
  return { codec: entry.type, dataReferenceIndex };
}

function validateIsoCodecConfiguration(
  sample: BinaryResumeSample,
  codec: string,
  kind: 'video' | 'audio',
  children: readonly IsoBox[],
): boolean {
  const videoConfigs: Readonly<Record<string, string | undefined>> = {
    avc1: 'avcC', avc2: 'avcC', avc3: 'avcC', avc4: 'avcC',
    hvc1: 'hvcC', hev1: 'hvcC', av01: 'av1C', vp08: 'vpcC', vp09: 'vpcC', mp4v: 'esds',
    jpeg: undefined, mjpa: undefined, mjpb: undefined, 'png ': undefined, 'raw ': undefined, yuv2: undefined,
  };
  const audioConfigs: Readonly<Record<string, string | undefined>> = {
    mp4a: 'esds', Opus: 'dOps', alac: 'alac', 'ac-3': 'dac3', 'ec-3': 'dec3', fLaC: 'dfLa',
    lpcm: undefined, sowt: undefined, twos: undefined, 'raw ': undefined,
  };
  const configType = (kind === 'video' ? videoConfigs : audioConfigs)[codec];
  if (!(codec in (kind === 'video' ? videoConfigs : audioConfigs))) return false;
  if (!configType) return true;
  const configs = children.filter((child) => child.type === configType);
  if (configs.length !== 1) return false;
  const bytes = bytesAt(sample, configs[0].payloadOffset, configs[0].payloadSize);
  if (!bytes) return false;
  if (configType === 'avcC') return validateAvcConfiguration(bytes);
  if (configType === 'hvcC') return bytes.length >= 23 && bytes[0] === 1 && bytes[22] > 0;
  if (configType === 'av1C') return bytes.length >= 4 && (bytes[0] & 0x80) !== 0 && (bytes[0] & 0x7f) === 1;
  if (configType === 'vpcC') return bytes.length >= 12 && bytes.some((byte) => byte !== 0);
  if (configType === 'esds') return bytes.length >= 12 && bytes[0] === 0
    && bytes.includes(0x03, 4) && bytes.includes(0x04, 4) && bytes.includes(0x05, 4);
  if (configType === 'dOps') return bytes.length >= 11 && bytes[0] === 0 && bytes[1] > 0;
  return bytes.length >= 8 && bytes.some((byte) => byte !== 0);
}

function validateAvcConfiguration(bytes: Uint8Array): boolean {
  if (bytes.length < 11 || bytes[0] !== 1 || (bytes[5] & 0x1f) === 0) return false;
  let offset = 6;
  const sequenceCount = bytes[5] & 0x1f;
  for (let index = 0; index < sequenceCount; index += 1) {
    const length = readU16BE(bytes, offset);
    if (!length || length > bytes.length - offset - 2) return false;
    offset += 2 + length;
  }
  if (offset >= bytes.length || bytes[offset] === 0) return false;
  const pictureCount = bytes[offset++];
  for (let index = 0; index < pictureCount; index += 1) {
    const length = readU16BE(bytes, offset);
    if (!length || length > bytes.length - offset - 2) return false;
    offset += 2 + length;
  }
  return offset <= bytes.length;
}

function parseIsoTimeToSample(sample: BinaryResumeSample, box: IsoBox): number | undefined {
  const bytes = bytesAt(sample, box.payloadOffset, box.payloadSize);
  if (!bytes || bytes.length < 8 || readU32BE(bytes, 0) !== 0) return undefined;
  const count = readU32BE(bytes, 4);
  if (!count || count > MAX_ISO_TABLE_ENTRIES || bytes.length !== 8 + count * 8) return undefined;
  let samples = 0;
  for (let index = 0; index < count; index += 1) {
    const sampleCount = readU32BE(bytes, 8 + index * 8) ?? 0;
    const delta = readU32BE(bytes, 12 + index * 8) ?? 0;
    if (sampleCount === 0 || delta === 0) return undefined;
    samples += sampleCount;
    if (!Number.isSafeInteger(samples)) return undefined;
  }
  return samples > 0 ? samples : undefined;
}

function parseIsoSampleToChunk(sample: BinaryResumeSample, box: IsoBox): IsoSampleToChunk[] | undefined {
  const bytes = bytesAt(sample, box.payloadOffset, box.payloadSize);
  if (!bytes || bytes.length < 8 || readU32BE(bytes, 0) !== 0) return undefined;
  const count = readU32BE(bytes, 4);
  if (!count || count > MAX_ISO_TABLE_ENTRIES || bytes.length !== 8 + count * 12) return undefined;
  const entries: IsoSampleToChunk[] = [];
  for (let index = 0; index < count; index += 1) {
    const firstChunk = readU32BE(bytes, 8 + index * 12) ?? 0;
    const samplesPerChunk = readU32BE(bytes, 12 + index * 12) ?? 0;
    const descriptionIndex = readU32BE(bytes, 16 + index * 12) ?? 0;
    if (firstChunk === 0 || samplesPerChunk === 0 || descriptionIndex === 0
      || (index === 0 ? firstChunk !== 1 : firstChunk <= entries[index - 1].firstChunk)) return undefined;
    entries.push({ firstChunk, samplesPerChunk, descriptionIndex });
  }
  return entries;
}

function parseIsoSampleSizes(sample: BinaryResumeSample, box: IsoBox): IsoSampleSizes | undefined {
  const bytes = bytesAt(sample, box.payloadOffset, box.payloadSize);
  if (!bytes || bytes.length < 12 || readU32BE(bytes, 0) !== 0) return undefined;
  if (box.type === 'stsz') {
    const fixedSize = readU32BE(bytes, 4) ?? 0;
    const count = readU32BE(bytes, 8) ?? 0;
    if (count === 0 || count > MAX_ISO_TABLE_ENTRIES) return undefined;
    if (fixedSize > 0) return bytes.length === 12 ? { count, fixedSize } : undefined;
    if (bytes.length !== 12 + count * 4) return undefined;
    const sizes = Array.from({ length: count }, (_, index) => readU32BE(bytes, 12 + index * 4) ?? 0);
    return sizes.every((size) => size > 0) ? { count, fixedSize: 0, sizes } : undefined;
  }

  const fieldSize = bytes[7];
  const count = readU32BE(bytes, 8) ?? 0;
  if (count === 0 || count > MAX_ISO_TABLE_ENTRIES || ![4, 8, 16].includes(fieldSize)) return undefined;
  const expectedBytes = Math.ceil((count * fieldSize) / 8);
  if (bytes.length !== 12 + expectedBytes) return undefined;
  const sizes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = fieldSize === 4
      ? (bytes[12 + Math.floor(index / 2)] >> (index % 2 === 0 ? 4 : 0)) & 0x0f
      : fieldSize === 8
        ? bytes[12 + index]
        : readU16BE(bytes, 12 + index * 2) ?? 0;
    if (value === 0) return undefined;
    sizes.push(value);
  }
  return { count, fixedSize: 0, sizes };
}

function parseIsoChunkOffsets(sample: BinaryResumeSample, box: IsoBox): number[] | undefined {
  const bytes = bytesAt(sample, box.payloadOffset, box.payloadSize);
  if (!bytes || bytes.length < 8 || readU32BE(bytes, 0) !== 0) return undefined;
  const count = readU32BE(bytes, 4);
  const width = box.type === 'co64' ? 8 : 4;
  if (!count || count > MAX_ISO_TABLE_ENTRIES || bytes.length !== 8 + count * width) return undefined;
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = width === 8 ? readSafeU64BE(bytes, 8 + index * 8) : readU32BE(bytes, 8 + index * 4);
    if (!offset) return undefined;
    offsets.push(offset);
  }
  return offsets;
}

function validateIsoDurationHeader(sample: BinaryResumeSample, box: IsoBox, type: 'mvhd' | 'tkhd' | 'mdhd'): boolean {
  const bytes = bytesAt(sample, box.payloadOffset, box.payloadSize);
  if (!bytes || bytes.length < 24 || (bytes[0] !== 0 && bytes[0] !== 1)) return false;
  const version = bytes[0];
  if (type === 'tkhd') {
    const trackId = readU32BE(bytes, version === 0 ? 12 : 20) ?? 0;
    const duration = version === 0 ? readU32BE(bytes, 20) : readSafeU64BE(bytes, 28);
    return trackId > 0 && (duration ?? 0) > 0;
  }
  const timescale = readU32BE(bytes, version === 0 ? 12 : 20) ?? 0;
  const duration = version === 0 ? readU32BE(bytes, 16) : readSafeU64BE(bytes, 24);
  return timescale > 0 && (duration ?? 0) > 0;
}

function countIsoBoxes(boxes: readonly IsoBox[], type: string): number {
  return boxes.reduce((count, box) => count + (box.type === type ? 1 : 0), 0);
}

function onlyIsoBox(boxes: readonly IsoBox[], type: string): IsoBox | undefined {
  const matches = boxes.filter((box) => box.type === type);
  return matches.length === 1 ? matches[0] : undefined;
}

function isStructurallyPlausibleZip(sample: BinaryResumeSample): boolean {
  const eocd = findLastSignature(sample.tail, [0x50, 0x4b, 0x05, 0x06]);
  if (eocd < 0 || eocd + 22 > sample.tail.length) return false;
  const eocdAbsolute = sample.tailOffset + eocd;
  const commentLength = readU16LE(sample.tail, eocd + 20) ?? -1;
  if (eocdAbsolute + 22 + commentLength !== sample.size) return false;
  const disk = readU16LE(sample.tail, eocd + 4);
  const centralDisk = readU16LE(sample.tail, eocd + 6);
  const diskEntries = readU16LE(sample.tail, eocd + 8);
  const totalEntries = readU16LE(sample.tail, eocd + 10);
  const centralSize = readU32LE(sample.tail, eocd + 12);
  const centralOffset = readU32LE(sample.tail, eocd + 16);
  if (
    disk !== 0 || centralDisk !== 0 || diskEntries === undefined || totalEntries === undefined
    || diskEntries !== totalEntries || centralSize === undefined || centralOffset === undefined
    || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset + centralSize !== eocdAbsolute
  ) return false;
  if (totalEntries === 0) return centralSize === 0 && centralOffset === 0 && eocdAbsolute === 0;
  const central = bytesAt(sample, centralOffset, centralSize);
  if (!central) return false;
  let offset = 0;
  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (central.length - offset < 46 || !startsWithBytes(central.subarray(offset), [0x50, 0x4b, 0x01, 0x02])) return false;
    const flags = readU16LE(central, offset + 8) ?? 0;
    const method = readU16LE(central, offset + 10);
    const crc = readU32LE(central, offset + 16);
    const compressedSize = readU32LE(central, offset + 20);
    const nameLength = readU16LE(central, offset + 28) ?? 0;
    const extraLength = readU16LE(central, offset + 30) ?? 0;
    const commentLength = readU16LE(central, offset + 32) ?? 0;
    const startDisk = readU16LE(central, offset + 34);
    const localOffset = readU32LE(central, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (
      nameLength === 0 || recordLength > central.length - offset || startDisk !== 0
      || method === undefined || crc === undefined || compressedSize === undefined || compressedSize === 0xffffffff
      || localOffset === undefined || localOffset === 0xffffffff
    ) return false;
    const local = bytesAt(sample, localOffset, 30 + nameLength);
    if (!local || !startsWithBytes(local, [0x50, 0x4b, 0x03, 0x04])) return false;
    const localFlags = readU16LE(local, 6);
    const localMethod = readU16LE(local, 8);
    const localCrc = readU32LE(local, 14);
    const localCompressedSize = readU32LE(local, 18);
    const localNameLength = readU16LE(local, 26) ?? 0;
    const localExtraLength = readU16LE(local, 28) ?? 0;
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength
      || !equalBytes(local.subarray(30, 30 + nameLength), central.subarray(offset + 46, offset + 46 + nameLength))
      || dataOffset > centralOffset || compressedSize > centralOffset - dataOffset) return false;
    if ((flags & 0x08) === 0 && (localCrc !== crc || localCompressedSize !== compressedSize)) return false;
    if (method === 0) {
      const stored = bytesAt(sample, dataOffset, compressedSize);
      if (!stored || pngCrc32(stored) !== crc) return false;
    }
    offset += recordLength;
  }
  return offset === central.length;
}

function bytesAt(sample: BinaryResumeSample, absoluteOffset: number, length: number): Uint8Array | undefined {
  if (absoluteOffset >= 0 && absoluteOffset + length <= sample.head.length) {
    return sample.head.subarray(absoluteOffset, absoluteOffset + length);
  }
  if (absoluteOffset >= sample.tailOffset && absoluteOffset + length <= sample.tailOffset + sample.tail.length) {
    const offset = absoluteOffset - sample.tailOffset;
    return sample.tail.subarray(offset, offset + length);
  }
  const end = absoluteOffset + length;
  if (
    absoluteOffset >= 0 && absoluteOffset < sample.head.length && sample.head.length >= sample.tailOffset
    && end <= sample.tailOffset + sample.tail.length
  ) {
    const joined = new Uint8Array(length);
    const headEnd = Math.min(end, sample.head.length);
    joined.set(sample.head.subarray(absoluteOffset, headEnd));
    const tailStart = Math.max(headEnd, sample.tailOffset);
    if (tailStart > headEnd) return undefined;
    joined.set(sample.tail.subarray(tailStart - sample.tailOffset, end - sample.tailOffset), tailStart - absoluteOffset);
    return joined;
  }
  return undefined;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function isRiffType(bytes: Uint8Array, type: string): boolean {
  return startsWithAscii(bytes, 'RIFF') && bytes.length >= 12 && asciiAt(bytes, 8, 4) === type;
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  return bytes.length >= prefix.length && asciiAt(bytes, 0, prefix.length) === prefix;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return ASCII.decode(bytes.subarray(offset, offset + length));
}

function lowerAscii(bytes: Uint8Array): string {
  return ASCII.decode(bytes).toLowerCase();
}

function findLastSignature(bytes: Uint8Array, signature: readonly number[]): number {
  outer: for (let offset = bytes.length - signature.length; offset >= 0; offset -= 1) {
    for (let index = 0; index < signature.length; index += 1) {
      if (bytes[offset + index] !== signature[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function readU16LE(bytes: Uint8Array, offset: number): number | undefined {
  return offset + 2 <= bytes.length ? bytes[offset] | (bytes[offset + 1] << 8) : undefined;
}

function readU16BE(bytes: Uint8Array, offset: number): number | undefined {
  return offset + 2 <= bytes.length ? (bytes[offset] << 8) | bytes[offset + 1] : undefined;
}

function readU24LE(bytes: Uint8Array, offset: number): number | undefined {
  return offset + 3 <= bytes.length ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) : undefined;
}

function readU24BE(bytes: Uint8Array, offset: number): number | undefined {
  return offset + 3 <= bytes.length ? (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2] : undefined;
}

function readU32LE(bytes: Uint8Array, offset: number): number | undefined {
  return offset + 4 <= bytes.length
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : undefined;
}

function readI32LE(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function readU32BE(bytes: Uint8Array, offset: number): number | undefined {
  return offset + 4 <= bytes.length
    ? ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
    : undefined;
}

function readSafeU64BE(bytes: Uint8Array, offset: number): number | undefined {
  const high = readU32BE(bytes, offset);
  const low = readU32BE(bytes, offset + 4);
  if (high === undefined || low === undefined || high > 0x1fffff) return undefined;
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : undefined;
}

function readSafeU64LE(bytes: Uint8Array, offset: number): number | undefined {
  const low = readU32LE(bytes, offset);
  const high = readU32LE(bytes, offset + 4);
  if (high === undefined || low === undefined || high > 0x1fffff) return undefined;
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : undefined;
}
