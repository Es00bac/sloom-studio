import type { PixelBuffer, PixelDepth } from '../../../types/imageEditor';

/**
 * Canvas-free pixel authority core for MH-009 Lane A (A1).
 *
 * Encoding contract (binding for the lane):
 * - u8/u16 buffers hold display-referred sRGB-encoded color samples (like
 *   Photoshop 8/16-bit documents); alpha is straight linear coverage.
 * - f32 buffers hold linear scene-referred color samples; alpha stays
 *   straight linear coverage in [0, 1].
 * - Color channels cross the integer/float boundary through the sRGB transfer
 *   function; alpha never does (it is scaled, not gamma-encoded).
 * - u8↔u16 is exact integer math (v*257 / v>>>8).
 * - Interleaved RGBA, 4 channels, straight (non-premultiplied) alpha.
 */

export const PIXEL_BUFFER_CHANNELS = 4 as const;

/** Hard single-buffer allocation bound: 1 GiB of sample data. */
export const MAX_PIXEL_BUFFER_BYTES = 1024 * 1024 * 1024;

/** Matches the project-wide .slimg maximum document edge. */
export const MAX_PIXEL_BUFFER_EDGE = 8192;

export function pixelDepthBytesPerSample(depth: PixelDepth): 1 | 2 | 4 {
  switch (depth) {
    case 'u8': return 1;
    case 'u16': return 2;
    case 'f32': return 4;
  }
}

/** sRGB piecewise transfer: display-encoded [0,1] -> linear [0,1]. */
export function srgbToLinear(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : Math.pow((encoded + 0.055) / 1.055, 2.4);
}

/** sRGB piecewise transfer: linear [0,1] -> display-encoded [0,1]. */
export function linearToSrgb(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

export interface CreatePixelBufferParams {
  width: number;
  height: number;
  depth: PixelDepth;
  model?: PixelBuffer['model'];
}

/** Allocate a zeroed bounded PixelBuffer. Refuses hostile dimensions before any allocation. */
export function createPixelBuffer(params: CreatePixelBufferParams): PixelBuffer {
  const { width, height, depth } = params;
  // A1 contract (stated to Lane B): RGB RGBA authority only. The broader
  // `PixelColorModel` enum is reserved for a later model-aware B2 extension;
  // anything else must never be allocated, serialized, or read as RGBA.
  const model = params.model ?? 'rgb';
  if (model !== 'rgb') {
    throw new Error(
      `PixelBuffer color model "${model}" is reserved for a later extension; A1 allocates RGB authority only.`,
    );
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > MAX_PIXEL_BUFFER_EDGE || height > MAX_PIXEL_BUFFER_EDGE) {
    throw new Error(
      `PixelBuffer dimensions ${width}x${height} are outside the bounded 1..${MAX_PIXEL_BUFFER_EDGE} range.`,
    );
  }
  const bytesPerSample = pixelDepthBytesPerSample(depth);
  const totalBytes = width * height * PIXEL_BUFFER_CHANNELS * bytesPerSample;
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PIXEL_BUFFER_BYTES) {
    throw new Error(
      `PixelBuffer allocation of ${totalBytes} bytes exceeds the ${MAX_PIXEL_BUFFER_BYTES}-byte single-buffer bound.`,
    );
  }
  return {
    width,
    height,
    model,
    depth,
    data: depth === 'u8'
      ? new Uint8Array(totalBytes)
      : depth === 'u16'
        ? new Uint16Array(totalBytes / 2)
        : new Float32Array(totalBytes / 4),
  } as PixelBuffer;
}

export function pixelBufferSampleCount(buffer: PixelBuffer): number {
  return buffer.width * buffer.height * PIXEL_BUFFER_CHANNELS;
}

export function assertPixelBufferShape(buffer: PixelBuffer): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new Error('PixelBuffer is missing.');
  }
  if (buffer.model !== 'rgb') {
    throw new Error(`PixelBuffer color model ${String(buffer.model)} is not supported yet.`);
  }
  if (!Number.isSafeInteger(buffer.width) || !Number.isSafeInteger(buffer.height)
    || buffer.width < 1 || buffer.height < 1
    || buffer.width > MAX_PIXEL_BUFFER_EDGE || buffer.height > MAX_PIXEL_BUFFER_EDGE) {
    throw new Error(
      `PixelBuffer dimensions ${String(buffer.width)}x${String(buffer.height)} are outside the bounded 1..${MAX_PIXEL_BUFFER_EDGE} range.`,
    );
  }
  const typedArray = buffer.data;
  const dataTypeMatches = buffer.depth === 'u8'
    ? typedArray instanceof Uint8Array
    : buffer.depth === 'u16'
      ? typedArray instanceof Uint16Array
      : buffer.depth === 'f32'
        ? typedArray instanceof Float32Array
        : false;
  if (!dataTypeMatches) {
    throw new Error(`PixelBuffer ${buffer.depth} authority must use its matching typed-array class.`);
  }
  const expected = pixelBufferSampleCount(buffer);
  const expectedBytes = expected * pixelDepthBytesPerSample(buffer.depth);
  if (buffer.data.byteLength !== expectedBytes) {
    throw new Error(
      `PixelBuffer data byte length ${buffer.data.byteLength} does not match its ${buffer.width}x${buffer.height} ${buffer.depth} shape (${expectedBytes} bytes).`,
    );
  }
}

/** Structural clone with fresh typed-array storage. */
export function clonePixelBuffer(buffer: PixelBuffer): PixelBuffer {
  return {
    width: buffer.width,
    height: buffer.height,
    model: buffer.model,
    depth: buffer.depth,
    data: buffer.depth === 'u8'
      ? new Uint8Array(buffer.data as Uint8Array)
      : buffer.depth === 'u16'
        ? new Uint16Array(buffer.data as Uint16Array)
        : new Float32Array(buffer.data as Float32Array),
  } as PixelBuffer;
}

/** Bit-exact sample equality after a shape check. */
export function pixelBufferEquals(left: PixelBuffer, right: PixelBuffer): boolean {
  assertPixelBufferShape(left);
  assertPixelBufferShape(right);
  if (left.width !== right.width || left.height !== right.height
    || left.depth !== right.depth || left.model !== right.model) {
    return false;
  }
  if (left.data.byteLength !== right.data.byteLength) return false;
  const a = new Uint8Array(left.data.buffer, left.data.byteOffset, left.data.byteLength);
  const b = new Uint8Array(right.data.buffer, right.data.byteOffset, right.data.byteLength);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function roundToIntegerSample(value: number, maxSample: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= maxSample) return maxSample;
  return Math.min(maxSample, Math.round(value));
}

/**
 * Exact integer path between the two integer depths. v*257 / v>>>8 round-trip
 * every byte, so this conversion never touches the transfer function.
 */
function convertIntegerToInteger(source: PixelBuffer, target: PixelBuffer): void {
  const targetData = target.data as Uint8Array | Uint16Array;
  if (source.depth === 'u8') {
    const from = source.data as Uint8Array;
    const to = targetData as Uint16Array;
    for (let index = 0; index < from.length; index += 1) to[index] = from[index]! * 257;
  } else {
    const from = source.data as Uint16Array;
    const to = targetData as Uint8Array;
    for (let index = 0; index < from.length; index += 1) to[index] = from[index]! >>> 8;
  }
}

/**
 * Convert between any two depths. Integer targets quantize with round-half-up
 * after clamping; NaN maps to 0 and ±Infinity clamps to the range (the lane's
 * hostile-float policy).
 */
export function convertPixelBuffer(buffer: PixelBuffer, targetDepth: PixelDepth): PixelBuffer {
  assertPixelBufferShape(buffer);
  if (buffer.depth === targetDepth) return clonePixelBuffer(buffer);
  const target = createPixelBuffer({
    width: buffer.width,
    height: buffer.height,
    depth: targetDepth,
    model: buffer.model,
  });
  if ((buffer.depth === 'u8' || buffer.depth === 'u16')
    && (targetDepth === 'u8' || targetDepth === 'u16')) {
    convertIntegerToInteger(buffer, target);
    return target;
  }

  const count = pixelBufferSampleCount(buffer);
  const sourceMax = buffer.depth === 'u8' ? 255 : 65535;
  const targetMax = targetDepth === 'u8' ? 255 : 65535;
  // Color channels are sRGB-encoded in integer buffers and linear in f32.
  // Channel index 3 (alpha) is linear coverage in every depth, so it scales
  // but never passes through the transfer function.
  const source = buffer.data;
  const targetData = target.data as Float32Array | Uint8Array | Uint16Array;
  for (let index = 0; index < count; index += 1) {
    const isAlpha = index % 4 === 3;
    const sourceValue = source[index] as number;
    if (targetDepth === 'f32') {
      const out = targetData as Float32Array;
      out[index] = isAlpha
        ? (sourceValue as number) / sourceMax
        : srgbToLinear((sourceValue as number) / sourceMax);
    } else {
      // Hostile-float policy: NaN drops to 0; ±Infinity clamps to the range.
      const finite = Number.isFinite(sourceValue) ? sourceValue : (sourceValue > 0 ? 1 : 0);
      const display = isAlpha ? finite : linearToSrgb(finite);
      (targetData as Uint8Array | Uint16Array)[index] =
        roundToIntegerSample(display * targetMax, targetMax);
    }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Bounded wire payloads (raw little-endian interleaved samples).
// ---------------------------------------------------------------------------

export interface PixelBufferPayloadExpectation {
  width: number;
  height: number;
  depth: PixelDepth;
  model?: PixelBuffer['model'];
}

/** Serialize to raw little-endian interleaved sample bytes. */
export function encodePixelBufferPayload(buffer: PixelBuffer): Uint8Array {
  assertPixelBufferShape(buffer);
  const bytes = new Uint8Array(buffer.data.byteLength);
  const view = new DataView(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength);
  if (buffer.depth === 'u8') {
    bytes.set(new Uint8Array(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength));
  } else if (buffer.depth === 'u16') {
    const out = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.byteLength; offset += 2) {
      out.setUint16(offset, view.getUint16(offset, true), true);
    }
  } else {
    const out = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.byteLength; offset += 4) {
      out.setFloat32(offset, view.getFloat32(offset, true), true);
    }
  }
  return bytes;
}

/** Parse bounded little-endian payload bytes. Refuses any length/shape mismatch before allocating pixel data. */
export function decodePixelBufferPayload(
  bytes: Uint8Array,
  expected: PixelBufferPayloadExpectation,
): PixelBuffer {
  const buffer = createPixelBuffer(expected);
  const requiredBytes = buffer.data.byteLength;
  if (!bytes || bytes.byteLength !== requiredBytes) {
    throw new Error(
      `PixelBuffer payload is ${bytes?.byteLength ?? 0} bytes but its ${expected.width}x${expected.height} ${expected.depth} shape requires exactly ${requiredBytes}.`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (expected.depth === 'u8') {
    (buffer.data as Uint8Array).set(bytes);
  } else if (expected.depth === 'u16') {
    const out = buffer.data as Uint16Array;
    for (let index = 0; index < out.length; index += 1) {
      out[index] = view.getUint16(index * 2, true);
    }
  } else {
    const out = buffer.data as Float32Array;
    for (let index = 0; index < out.length; index += 1) {
      out[index] = view.getFloat32(index * 4, true);
    }
  }
  return buffer;
}

const BASE64_CHUNK = 0x8000;

/** Chunked base64 of the canonical payload so large layers never blow the call stack. */
export function encodePixelBufferPayloadBase64(buffer: PixelBuffer): string {
  const bytes = encodePixelBufferPayload(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** Decode a bounded base64 payload. Refuses malformed base64 and any shape mismatch. */
export function decodePixelBufferPayloadBase64(
  value: string,
  expected: PixelBufferPayloadExpectation,
): PixelBuffer {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw new Error('PixelBuffer payload base64 is malformed.');
  }
  const decodedByteLength = Math.floor(value.length * 3 / 4)
    - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  const requiredBytes = expected.width * expected.height * PIXEL_BUFFER_CHANNELS
    * pixelDepthBytesPerSample(expected.depth);
  if (decodedByteLength !== requiredBytes) {
    throw new Error(
      `PixelBuffer payload decodes to ${decodedByteLength} bytes but its declared shape requires ${requiredBytes}.`,
    );
  }
  const bytes = new Uint8Array(decodedByteLength);
  const binary = atob(value);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return decodePixelBufferPayload(bytes, expected);
}

// ---------------------------------------------------------------------------
// Self-describing project transport ("sloom-pixels-<depth>-<w>x<h>:<base64>").
// ---------------------------------------------------------------------------

const TRANSPORT_PREFIX = /^sloom-pixels-(u8|u16|f32)-(\d{1,5})x(\d{1,5}):/;

/** Self-describing base64 transport used by .sloom projects and the embedded native archive. */
export function encodePixelBufferTransport(buffer: PixelBuffer): string {
  return `sloom-pixels-${buffer.depth}-${buffer.width}x${buffer.height}:`
    + encodePixelBufferPayloadBase64(buffer);
}

/** Parse the self-describing transport. Refuses unknown headers and any shape violation. */
export function decodePixelBufferTransport(value: string): PixelBuffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('PixelBuffer transport payload is malformed.');
  }
  const match = TRANSPORT_PREFIX.exec(value.slice(0, 64));
  if (!match) {
    throw new Error('PixelBuffer transport payload has an unknown header.');
  }
  return decodePixelBufferPayloadBase64(value.slice(match[0].length), {
    width: Number.parseInt(match[2]!, 10),
    height: Number.parseInt(match[3]!, 10),
    depth: match[1] as PixelDepth,
  });
}
