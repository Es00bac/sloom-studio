import { Deflate, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inflateZlibBounded } from './boundedInflate';

const MIB = 1024 * 1024;

describe('inflateZlibBounded', () => {
  it('returns byte-identical output to an unbounded inflate for well-formed streams', () => {
    const payload = new Uint8Array(3 * MIB + 12345);
    for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 31 + (index >> 7)) & 0xff;
    expectChecksum(inflateZlibBounded(zlibSync(payload), 64 * MIB, 'refused'), payload);
    const stored = new Uint8Array(2 * MIB);
    for (let index = 0; index < stored.length; index += 65536) stored[index] = index & 0xff;
    expectChecksum(inflateZlibBounded(zlibSync(stored, { level: 0 }), 64 * MIB, 'refused'), stored);
  });

  it('raises the same refusals as an unbounded inflate for malformed streams', () => {
    const valid = zlibSync(new Uint8Array([1, 2, 3, 4, 5]));
    expect(() => inflateZlibBounded(new Uint8Array(), MIB, 'refused')).toThrow(/invalid zlib data/);
    expect(() => inflateZlibBounded(new Uint8Array([0x78]), MIB, 'refused')).toThrow(/invalid zlib data/);
    expect(() => inflateZlibBounded(new Uint8Array([0x78, 0x00, 1, 2, 3, 4, 5, 6]), MIB, 'refused')).toThrow(/invalid zlib data/);
    expect(() => inflateZlibBounded(new Uint8Array([0x78, 0xbb, 1, 2, 3, 4, 5, 6]), MIB, 'refused')).toThrow(/need dictionary/);
    expect(() => inflateZlibBounded(valid.subarray(0, valid.length - 3), MIB, 'refused')).toThrow(/unexpected EOF/);
  });

  it('refuses the moment cumulative output passes the cap without materializing the expansion', () => {
    const expansion = buildHostileZlibStream(640 * MIB);
    expect(expansion.length).toBeLessThan(2 * MIB);
    expect(() => inflateZlibBounded(expansion, MIB, 'bound exceeded')).toThrow('bound exceeded');
  }, 15_000);

  it('still returns streams that land exactly on the cap', () => {
    const payload = new Uint8Array(MIB);
    expect(inflateZlibBounded(zlibSync(payload), MIB, 'refused')).toEqual(payload);
  });
});

function expectChecksum(actual: Uint8Array, expected: Uint8Array): void {
  const checksum = (bytes: Uint8Array): number => {
    let hash = 2166136261;
    for (let index = 0; index < bytes.length; index += 1) hash = Math.imul(hash ^ bytes[index], 16777619) >>> 0;
    return hash;
  };
  expect(actual.length).toBe(expected.length);
  expect(checksum(actual)).toBe(checksum(expected));
}

/** Builds a zlib stream of `totalBytes` zero bytes without ever allocating the expansion. */
function buildHostileZlibStream(totalBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const deflater = new Deflate((chunk) => {
    if (chunk.length) parts.push(chunk);
  });
  const zeros = new Uint8Array(MIB);
  for (let at = 0; at < totalBytes; at += MIB) deflater.push(zeros, at + MIB >= totalBytes);
  // adler32 of all-zero data: the running sum stays 1, the other accumulates one per byte.
  const accumulated = totalBytes % 65521;
  const trailer = new Uint8Array([0, 1, (accumulated >> 8) & 0xff, accumulated & 0xff]);
  return concatenate([new Uint8Array([0x78, 0x9c]), ...parts, trailer]);
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
