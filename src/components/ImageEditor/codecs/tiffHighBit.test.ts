import { describe, expect, it } from 'vitest';
import { decodeHighBitTiff, encodeHighBitTiff } from './tiffHighBit';

describe('high-bit TIFF codec', () => {
  it('round-trips 16-bit RGBA samples bit-exactly', () => {
    const data = new Uint16Array([0, 1, 257, 65535, 4660, 43981, 32768, 2]);
    expect(decodeHighBitTiff(encodeHighBitTiff({ width: 2, height: 1, depth: 'u16', data }).slice()).data).toEqual(data);
  });
  it('round-trips 32-bit float highlights and negatives bit-exactly', () => {
    const data = new Float32Array([4, -0.25, Number.NaN, Number.POSITIVE_INFINITY]);
    const decoded = decodeHighBitTiff(encodeHighBitTiff({ width: 1, height: 1, depth: 'f32', data }));
    expect(decoded.depth).toBe('f32'); expect(Object.is((decoded.data as Float32Array)[0], 4)).toBe(true); expect((decoded.data as Float32Array)[1]).toBe(-0.25); expect(Number.isNaN((decoded.data as Float32Array)[2])).toBe(true); expect((decoded.data as Float32Array)[3]).toBe(Infinity);
  });
  it('refuses hostile headers and incomplete strips', () => {
    expect(() => decodeHighBitTiff(new Uint8Array([0x49, 0x49]))).toThrow(/truncated/i);
    const valid = encodeHighBitTiff({ width: 1, height: 1, depth: 'u16', data: new Uint16Array(4) });
    expect(() => decodeHighBitTiff(valid.slice(0, -1))).toThrow(/offset|strip/i);
  });
});
