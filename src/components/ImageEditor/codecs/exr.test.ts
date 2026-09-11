import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeExr, encodeExr } from './exr';
describe('EXR codec', () => {
  it('round-trips FLOAT scanline RGBA including a 4.0 highlight', () => { const data = new Float32Array([4, -1, 0.5, 1]); expect(decodeExr(encodeExr({ width: 1, height: 1, depth: 'f32', data })).data).toEqual(data); });
  it('round-trips HALF values within half precision', () => { const decoded = decodeExr(encodeExr({ width: 1, height: 1, depth: 'f16', data: new Float32Array([4, -0.25, 0.5, 1]) })); expect([...decoded.data]).toEqual([4, -0.25, 0.5, 1]); });
  it('refuses truncated and hostile headers', () => { expect(() => decodeExr(new Uint8Array([1, 2]))).toThrow(/truncated/i); const bad = encodeExr({ width: 1, height: 1, depth: 'f32', data: new Float32Array(4) }); bad[8] = 0; expect(() => decodeExr(bad)).toThrow(/requires|unterminated|offset/i); });
  it('refuses unsupported UINT/deep-style channel records explicitly', () => { const malformed = encodeExr({ width: 1, height: 1, depth: 'f32', data: new Float32Array(4) }); malformed[24] = 0xff; expect(() => decodeExr(malformed)).toThrow(/channel|requires/i); });
  it.each(['none', 'rle', 'zip1', 'zip16'])('decodes externally generated FFmpeg %s EXR fixture', (mode) => { const decoded = decodeExr(new Uint8Array(readFileSync(`/tmp/orion-exr-fixtures/${mode}.exr`))); expect(decoded).toMatchObject({ width: 2, height: 1, depth: 'f32' }); expect(decoded.data[0]).toBeGreaterThan(0.99); });
});
