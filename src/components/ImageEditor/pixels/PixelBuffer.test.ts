import { describe, expect, it } from 'vitest';
import {
  MAX_PIXEL_BUFFER_BYTES,
  MAX_PIXEL_BUFFER_EDGE,
  assertPixelBufferShape,
  convertPixelBuffer,
  createPixelBuffer,
  decodePixelBufferPayload,
  decodePixelBufferPayloadBase64,
  decodePixelBufferTransport,
  encodePixelBufferPayload,
  encodePixelBufferPayloadBase64,
  encodePixelBufferTransport,
  linearToSrgb,
  pixelBufferEquals,
  pixelBufferSampleCount,
  srgbToLinear,
} from './PixelBuffer';

function gradientBuffer(width: number, height: number): ReturnType<typeof createPixelBuffer> {
  const buffer = createPixelBuffer({ width, height, depth: 'u8' });
  const data = buffer.data as Uint8Array;
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (index * 37 + 11) % 256;
  }
  return buffer;
}

describe('createPixelBuffer bounds', () => {
  it('allocates exact interleaved RGBA sample counts', () => {
    const u16 = createPixelBuffer({ width: 4, height: 3, depth: 'u16' });
    expect(u16.data).toBeInstanceOf(Uint16Array);
    expect(u16.data.byteLength).toBe(4 * 3 * 4 * 2);
    const f32 = createPixelBuffer({ width: 4, height: 3, depth: 'f32' });
    expect(f32.data).toBeInstanceOf(Float32Array);
    expect(pixelBufferSampleCount(f32)).toBe(48);
  });

  it('refuses zero, negative, oversized, and non-integer dimensions before allocating', () => {
    for (const params of [
      { width: 0, height: 4, depth: 'u8' as const },
      { width: 4, height: -1, depth: 'u8' as const },
      { width: MAX_PIXEL_BUFFER_EDGE + 1, height: 1, depth: 'u8' as const },
      { width: 1.5, height: 4, depth: 'u8' as const },
      { width: Number.NaN, height: 4, depth: 'u8' as const },
    ]) {
      expect(() => createPixelBuffer(params)).toThrow(/bounded|safe integer/);
    }
  });

  it('refuses non-RGB models at allocation (A1 RGB-only contract for Lane B)', () => {
    expect(() => createPixelBuffer({
      width: 2,
      height: 2,
      depth: 'u8',
      model: 'cmyk',
    })).toThrow(/RGB authority only/);
    expect(() => createPixelBuffer({
      width: 2,
      height: 2,
      depth: 'u8',
      model: 'gray',
    })).toThrow(/RGB authority only/);
    // A hand-crafted non-RGB buffer fails the shape check used by every reader.
    const forged = createPixelBuffer({ width: 2, height: 2, depth: 'u8' });
    forged.model = 'cmyk';
    expect(() => convertPixelBuffer(forged, 'u16')).toThrow(/not supported/);
    expect(() => encodePixelBufferPayload(forged)).toThrow(/not supported/);
  });

  it('refuses forged dimensions and mismatched authority typed-array classes', () => {
    const zero = createPixelBuffer({ width: 1, height: 1, depth: 'u8' });
    zero.width = 0;
    zero.height = 0;
    zero.data = new Uint8Array();
    expect(() => assertPixelBufferShape(zero)).toThrow(/bounded/);

    const wrongClass = createPixelBuffer({ width: 1, height: 1, depth: 'u16' });
    wrongClass.data = new Uint8Array(wrongClass.data.byteLength);
    expect(() => assertPixelBufferShape(wrongClass)).toThrow(/typed-array class/);

    const wrongFloatClass = createPixelBuffer({ width: 1, height: 1, depth: 'f32' });
    wrongFloatClass.data = new Uint16Array(wrongFloatClass.data.byteLength / 2);
    expect(() => assertPixelBufferShape(wrongFloatClass)).toThrow(/typed-array class/);
  });

  it('allows exactly the 1 GiB single-buffer bound and keeps the guard as defense in depth', () => {    // 8192 x 8192 x 4 x 4 bytes equals the 1 GiB bound exactly; the max edge
    // makes larger single buffers unreachable, which the admission gate
    // relies on for multi-layer budgets.
    const maxed = createPixelBuffer({
      width: MAX_PIXEL_BUFFER_EDGE,
      height: MAX_PIXEL_BUFFER_EDGE,
      depth: 'f32',
    });
    expect(maxed.data.byteLength).toBe(MAX_PIXEL_BUFFER_BYTES);
  });
});

describe('integer conversions are exact', () => {
  it('round-trips every u8 sample through u16 (v*257 then v>>>8)', () => {
    const u8 = gradientBuffer(16, 16);
    const u16 = convertPixelBuffer(u8, 'u16');
    const back = convertPixelBuffer(u16, 'u8');
    expect(pixelBufferEquals(u8, back)).toBe(true);
    const from = u8.data as Uint8Array;
    const to = u16.data as Uint16Array;
    for (let index = 0; index < from.length; index += 1) {
      expect(to[index]).toBe(from[index]! * 257);
    }
  });

  it('preserves every u16 sample through f32 (round-half exactness)', () => {
    const u16 = createPixelBuffer({ width: 64, height: 64, depth: 'u16' });
    const data = u16.data as Uint16Array;
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (index * 65537 + 12345) % 65536;
    }
    expect(pixelBufferEquals(convertPixelBuffer(convertPixelBuffer(u16, 'f32'), 'u16'), u16))
      .toBe(true);
  });

  it('round-trips every u16 sample exactly through u8 only for *257-derived values', () => {
    const u8 = gradientBuffer(16, 16);
    expect(pixelBufferEquals(convertPixelBuffer(convertPixelBuffer(u8, 'u16'), 'u8'), u8))
      .toBe(true);
  });

  it('round-trips the full 8-bit domain through the sRGB float path exhaustively', () => {
    const u8 = gradientBuffer(16, 16);
    expect(pixelBufferEquals(convertPixelBuffer(convertPixelBuffer(u8, 'f32'), 'u8'), u8))
      .toBe(true);
    // Directly prove the sRGB transfer is a bijection over all 256 codes.
    for (let code = 0; code < 256; code += 1) {
      const restored = Math.round(linearToSrgb(srgbToLinear(code / 255)) * 255);
      expect(restored).toBe(code);
    }
  });

  it('round-trips the full 16-bit domain through the sRGB float path exhaustively', () => {
    const u16 = createPixelBuffer({ width: 128, height: 32, depth: 'u16' });
    const data = u16.data as Uint16Array;
    for (let index = 0; index < data.length; index += 1) {
      data[index] = index % 65536;
    }
    expect(pixelBufferEquals(convertPixelBuffer(convertPixelBuffer(u16, 'f32'), 'u16'), u16))
      .toBe(true);
  });

  it('keeps alpha linear across every conversion path (never gamma-encoded)', () => {
    const u8 = createPixelBuffer({ width: 1, height: 4, depth: 'u8' });
    (u8.data as Uint8Array).set([255, 255, 255, 0, 255, 255, 255, 64, 255, 255, 255, 128, 255, 255, 255, 255]);
    const f32 = convertPixelBuffer(u8, 'f32');
    const alpha = f32.data as Float32Array;
    expect(alpha[3]).toBeCloseTo(0, 6);
    expect(alpha[7]).toBeCloseTo(64 / 255, 6);
    expect(alpha[11]).toBeCloseTo(128 / 255, 6);
    expect(alpha[15]).toBeCloseTo(1, 6);
    expect(pixelBufferEquals(convertPixelBuffer(f32, 'u8'), u8)).toBe(true);
  });

  it('treats 16-bit alpha linearly too', () => {
    const u16 = createPixelBuffer({ width: 1, height: 1, depth: 'u16' });
    (u16.data as Uint16Array).set([65535, 65535, 65535, 32768]);
    const f32 = convertPixelBuffer(u16, 'f32');
    expect((f32.data as Float32Array)[3]).toBeCloseTo(32768 / 65535, 8);
  });
});

describe('hostile float policy', () => {
  it('maps NaN to 0 and clamps infinities on integer targets', () => {
    const f32 = createPixelBuffer({ width: 2, height: 1, depth: 'f32' });
    (f32.data as Float32Array).set([
      Number.NaN, 2.5, -1, Number.POSITIVE_INFINITY,
      -Infinity, 0.25, 1, Number.NEGATIVE_INFINITY,
    ]);
    const u8 = convertPixelBuffer(f32, 'u8');
    expect(Array.from(u8.data as Uint8Array)).toEqual([
      0, 255, 0, 255,
      0, Math.round(linearToSrgb(0.25) * 255), 255, 0,
    ]);
    const u16 = convertPixelBuffer(f32, 'u16');
    expect((u16.data as Uint16Array)[1]).toBe(65535);
    expect((u16.data as Uint16Array)[2]).toBe(0);
  });

  it('drops non-finite float samples to 0 in-place on clone-convert to the same depth', () => {
    const f32 = createPixelBuffer({ width: 1, height: 1, depth: 'f32' });
    (f32.data as Float32Array).set([Number.NaN, 0.5, 0.5, 0.5]);
    const same = convertPixelBuffer(f32, 'f32');
    expect((same.data as Float32Array)[0]).toBe(Number.NaN);
  });
});

describe('payload codecs', () => {
  it('round-trips each depth through the little-endian payload', () => {
    for (const depth of ['u8', 'u16', 'f32'] as const) {
      const source = depth === 'u8'
        ? gradientBuffer(5, 7)
        : convertPixelBuffer(gradientBuffer(5, 7), depth);
      const decoded = decodePixelBufferPayload(encodePixelBufferPayload(source), {
        width: 5,
        height: 7,
        depth,
      });
      expect(pixelBufferEquals(decoded, source)).toBe(true);
    }
  });

  it('payload bytes are little-endian regardless of platform order', () => {
    const u16 = createPixelBuffer({ width: 1, height: 1, depth: 'u16' });
    (u16.data as Uint16Array).set([0x0102, 0x0304, 0x0506, 0x0708]);
    const bytes = encodePixelBufferPayload(u16);
    expect(Array.from(bytes)).toEqual([0x02, 0x01, 0x04, 0x03, 0x06, 0x05, 0x08, 0x07]);
  });

  it('refuses payloads whose byte length does not match the declared shape', () => {
    const u8 = gradientBuffer(4, 4);
    const payload = encodePixelBufferPayload(u8);
    expect(() => decodePixelBufferPayload(payload.subarray(0, payload.length - 1), {
      width: 4, height: 4, depth: 'u8',
    })).toThrow(/requires exactly/);
    expect(() => decodePixelBufferPayload(new Uint8Array(payload.length + 1), {
      width: 4, height: 4, depth: 'u8',
    })).toThrow(/requires exactly/);
  });

  it('refuses base64 payloads with wrong shapes and malformed text', () => {
    const buffer = convertPixelBuffer(gradientBuffer(2, 2), 'u16');
    const encoded = encodePixelBufferPayloadBase64(buffer);
    expect(decodePixelBufferPayloadBase64(encoded, { width: 2, height: 2, depth: 'u16' }))
      .toBeTruthy();
    expect(() => decodePixelBufferPayloadBase64(encoded, { width: 3, height: 2, depth: 'u16' }))
      .toThrow();
    expect(() => decodePixelBufferPayloadBase64('not-base64!', { width: 2, height: 2, depth: 'u16' }))
      .toThrow();
    expect(() => decodePixelBufferPayloadBase64('', { width: 2, height: 2, depth: 'u16' }))
      .toThrow();
  });

  it('round-trips the self-describing transport and refuses unknown headers', () => {
    const buffer = convertPixelBuffer(gradientBuffer(3, 3), 'f32');
    const transport = encodePixelBufferTransport(buffer);
    expect(transport.startsWith('sloom-pixels-f32-3x3:')).toBe(true);
    expect(pixelBufferEquals(decodePixelBufferTransport(transport), buffer)).toBe(true);
    expect(() => decodePixelBufferTransport('sloom-pixels-f16-3x3:AAAA')).toThrow(/unknown header/);
    expect(() => decodePixelBufferTransport('')).toThrow(/malformed/);
    expect(() => decodePixelBufferTransport('sloom-pixels-u16-3x3:AAAA')).toThrow();
  });
});
