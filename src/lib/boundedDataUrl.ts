export interface Base64DataUrlAnalysis {
  mimeType: string;
  size: number;
  payloadStart: number;
  encodedLength: number;
  virtualPadding: number;
}

export interface Base64DataUrlSample extends Base64DataUrlAnalysis {
  head: Uint8Array;
  tail: Uint8Array;
  tailOffset: number;
}

export type Base64DataUrlByteVisitor = (bytes: Uint8Array) => void;

const MAX_DATA_URL_METADATA_CHARACTERS = 1024;
const BASE64_MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export function analyzeBase64DataUrl(
  value: string,
  maxBytes: number,
): Base64DataUrlAnalysis | undefined {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || value.length < 7) return undefined;
  if (value.slice(0, 5).toLowerCase() !== 'data:') return undefined;

  const comma = value.indexOf(',', 5);
  if (comma < 0 || comma - 5 > MAX_DATA_URL_METADATA_CHARACTERS) return undefined;
  const metadata = value.slice(5, comma).split(';');
  if (metadata.length < 2 || metadata.at(-1)?.trim().toLowerCase() !== 'base64') return undefined;
  const mimeType = metadata[0]?.trim().toLowerCase();
  if (!mimeType || !BASE64_MIME_PATTERN.test(mimeType)) return undefined;

  const payloadStart = comma + 1;
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  const maxWhitespace = Math.min(8 * 1024 * 1024, Math.ceil(maxEncodedLength / 20) + 4096);
  let whitespace = 0;
  let encodedLength = 0;
  let dataCharacters = 0;
  let padding = 0;
  let sawPadding = false;
  let lastSextet = 0;

  for (let index = payloadStart; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isAsciiWhitespace(code)) {
      whitespace += 1;
      if (whitespace > maxWhitespace) return undefined;
      continue;
    }

    encodedLength += 1;
    if (encodedLength > maxEncodedLength) return undefined;
    if (code === 0x3d) {
      sawPadding = true;
      padding += 1;
      if (padding > 2) return undefined;
      continue;
    }

    const sextet = base64Sextet(code);
    if (sextet < 0 || sawPadding) return undefined;
    dataCharacters += 1;
    lastSextet = sextet;
  }

  if (dataCharacters === 0) return undefined;
  const remainder = encodedLength % 4;
  if (padding > 0) {
    if (remainder !== 0 || dataCharacters % 4 !== 4 - padding) return undefined;
  } else if (remainder === 1) {
    return undefined;
  }

  const virtualPadding = padding > 0 ? 0 : (4 - remainder) % 4;
  const effectivePadding = padding + virtualPadding;
  if ((effectivePadding === 2 && (lastSextet & 0x0f) !== 0)
    || (effectivePadding === 1 && (lastSextet & 0x03) !== 0)) {
    return undefined;
  }

  const paddedLength = encodedLength + virtualPadding;
  const size = (paddedLength / 4) * 3 - effectivePadding;
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) return undefined;

  return { mimeType, size, payloadStart, encodedLength, virtualPadding };
}

export function sampleBase64DataUrl(
  value: string,
  maxBytes: number,
  sampleBytes: number,
): Base64DataUrlSample | undefined {
  if (!Number.isSafeInteger(sampleBytes) || sampleBytes <= 0) return undefined;
  const analysis = analyzeBase64DataUrl(value, maxBytes);
  if (!analysis) return undefined;

  const paddedLength = analysis.encodedLength + analysis.virtualPadding;
  const sampleCharacters = Math.ceil(sampleBytes / 3) * 4;
  const headEnd = Math.min(analysis.encodedLength, sampleCharacters);
  const tailStart = Math.max(0, paddedLength - sampleCharacters) & ~3;
  const headEncoded = collectBase64Characters(value, analysis.payloadStart, 0, headEnd)
    + (headEnd === analysis.encodedLength ? '='.repeat(analysis.virtualPadding) : '');
  const tailEncoded = collectBase64Characters(
    value,
    analysis.payloadStart,
    Math.min(tailStart, analysis.encodedLength),
    analysis.encodedLength,
  ) + '='.repeat(analysis.virtualPadding);

  try {
    const headDecoded = decodeBase64(headEncoded);
    const tailDecoded = decodeBase64(tailEncoded);
    const head = headDecoded.subarray(0, Math.min(analysis.size, sampleBytes));
    const tailLength = Math.min(analysis.size, sampleBytes);
    const tail = tailDecoded.subarray(tailDecoded.length - tailLength);
    return {
      ...analysis,
      head,
      tail,
      tailOffset: analysis.size - tail.length,
    };
  } catch {
    return undefined;
  }
}

/**
 * Decode a validated base64 data URL in fixed-size pieces. The caller never receives an allocation
 * proportional to the whole asset; only the already-existing URL and one bounded decode window are
 * live at a time.
 */
export function visitBase64DataUrlBytes(
  value: string,
  maxBytes: number,
  visitor: Base64DataUrlByteVisitor,
): Base64DataUrlAnalysis | undefined {
  const analysis = analyzeBase64DataUrl(value, maxBytes);
  if (!analysis) return undefined;

  const encodedChunkCharacters = 64 * 1024;
  let encoded = '';
  let decodedBytes = 0;
  try {
    for (let index = analysis.payloadStart; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (isAsciiWhitespace(code)) continue;
      encoded += value[index];
      if (encoded.length >= encodedChunkCharacters) {
        const completeLength = encoded.length - (encoded.length % 4);
        if (completeLength > 0) {
          const bytes = decodeBase64(encoded.slice(0, completeLength));
          decodedBytes += bytes.length;
          if (decodedBytes > analysis.size) return undefined;
          visitor(bytes);
          encoded = encoded.slice(completeLength);
        }
      }
    }

    if (encoded.length > 0 || analysis.virtualPadding > 0) {
      const bytes = decodeBase64(encoded + '='.repeat(analysis.virtualPadding));
      decodedBytes += bytes.length;
      if (decodedBytes > analysis.size) return undefined;
      if (bytes.length > 0) visitor(bytes);
    }
  } catch {
    return undefined;
  }

  return decodedBytes === analysis.size ? analysis : undefined;
}

function collectBase64Characters(
  value: string,
  payloadStart: number,
  logicalStart: number,
  logicalEnd: number,
): string {
  const codes = new Uint8Array(Math.max(0, logicalEnd - logicalStart));
  let logicalIndex = 0;
  let outputIndex = 0;
  for (let index = payloadStart; index < value.length && logicalIndex < logicalEnd; index += 1) {
    const code = value.charCodeAt(index);
    if (isAsciiWhitespace(code)) continue;
    if (logicalIndex >= logicalStart) codes[outputIndex++] = code;
    logicalIndex += 1;
  }
  return asciiBytesToString(codes.subarray(0, outputIndex));
}

function asciiBytesToString(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return value;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

function base64Sextet(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}
