import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  preflightBoundedZip,
  unzipBoundedZipSync,
  validateInflatedBoundedZip,
  type BoundedZipLimits,
} from './boundedZip';

const TEST_LIMITS: BoundedZipLimits = {
  archiveLabel: 'TEST',
  maxEntries: 8,
  maxEntryUncompressedBytes: 1_024,
  maxTotalUncompressedBytes: 2_048,
  maxCompressionRatio: 20,
};

function copy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  throw new Error(`Missing signature ${signature.toString(16)}`);
}

describe('bounded ZIP decompression', () => {
  it('preflights, inflates, and reconciles an ordinary archive', () => {
    const bytes = zipSync({
      'word/document.xml': strToU8('<document>Hello</document>'),
      'word/styles.xml': strToU8('<styles/>'),
    }, { level: 0 });

    expect(unzipBoundedZipSync(bytes, TEST_LIMITS)).toMatchObject({
      'word/document.xml': expect.any(Uint8Array),
      'word/styles.xml': expect.any(Uint8Array),
    });
  });

  it('rejects entry-count, per-entry, total-expanded, and ratio limits before inflation', () => {
    const twoEntries = zipSync({ a: strToU8('a'), b: strToU8('b') }, { level: 0 });
    expect(() => preflightBoundedZip(twoEntries, { ...TEST_LIMITS, maxEntries: 1 }))
      .toThrow(/exceeds 1 entries/i);

    const largeEntry = zipSync({ a: strToU8('abcd') }, { level: 0 });
    expect(() => preflightBoundedZip(largeEntry, { ...TEST_LIMITS, maxEntryUncompressedBytes: 3 }))
      .toThrow(/entry exceeds 3 bytes/i);

    const largeTotal = zipSync({ a: strToU8('abc'), b: strToU8('def') }, { level: 0 });
    expect(() => preflightBoundedZip(largeTotal, { ...TEST_LIMITS, maxTotalUncompressedBytes: 5 }))
      .toThrow(/expanded size exceeds 5 bytes/i);

    const highRatio = zipSync({ a: strToU8('A'.repeat(1_000)) }, { level: 9 });
    expect(() => preflightBoundedZip(highRatio, TEST_LIMITS))
      .toThrow(/suspicious compression ratio/i);
  });

  it('rejects encrypted flags and ZIP64 sentinels', () => {
    const encrypted = copy(zipSync({ a: strToU8('a') }, { level: 0 }));
    const encryptedView = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    const centralOffset = findSignature(encrypted, 0x02014b50);
    encryptedView.setUint16(centralOffset + 8, encryptedView.getUint16(centralOffset + 8, true) | 0x1, true);
    expect(() => preflightBoundedZip(encrypted, TEST_LIMITS)).toThrow(/encrypted archives/i);

    const zip64 = copy(zipSync({ a: strToU8('a') }, { level: 0 }));
    const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
    zip64View.setUint32(findSignature(zip64, 0x02014b50) + 24, 0xffffffff, true);
    expect(() => preflightBoundedZip(zip64, TEST_LIMITS)).toThrow(/ZIP64 archives/i);
  });

  it('rejects unsafe and case-folded duplicate paths', () => {
    expect(() => preflightBoundedZip(
      zipSync({ '../outside.xml': strToU8('x') }, { level: 0 }),
      TEST_LIMITS,
    )).toThrow(/unsafe path/i);

    expect(() => preflightBoundedZip(zipSync({
      'Word/document.xml': strToU8('first'),
      'word/document.xml': strToU8('second'),
    }, { level: 0 }), TEST_LIMITS)).toThrow(/duplicate path/i);
  });

  it('rejects local headers that disagree with the central directory', () => {
    const bytes = copy(zipSync({ 'word/document.xml': strToU8('content') }, { level: 0 }));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const localOffset = findSignature(bytes, 0x04034b50);
    view.setUint32(localOffset + 22, view.getUint32(localOffset + 22, true) + 1, true);

    expect(() => preflightBoundedZip(bytes, TEST_LIMITS)).toThrow(/local header.*disagrees/i);
  });

  it('checks actual inflated sizes against the preflight manifest', () => {
    const bytes = zipSync({ 'word/document.xml': strToU8('declared') }, { level: 0 });
    const preflight = preflightBoundedZip(bytes, TEST_LIMITS);

    expect(() => validateInflatedBoundedZip(
      { 'word/document.xml': strToU8('short') },
      preflight,
      TEST_LIMITS,
    )).toThrow(/inflated size.*does not match/i);
  });

  it('stops streamed DEFLATE output when forged headers declare a tiny size', () => {
    const actualBytes = 4 * 1024 * 1024;
    const forgedDeclaredBytes = 32;
    const bytes = copy(zipSync({
      'word/document.xml': strToU8('A'.repeat(actualBytes)),
    }, { level: 9 }));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const localOffset = findSignature(bytes, 0x04034b50);
    const centralOffset = findSignature(bytes, 0x02014b50);

    // Keep the compressed payload, CRC, and record boundaries intact, but forge
    // both trusted-looking size fields. A whole-member inflater would process
    // all 4 MiB before reconciling the 32-byte declaration. The bounded stream
    // must abort on its first over-limit emitted chunk instead.
    view.setUint32(localOffset + 22, forgedDeclaredBytes, true);
    view.setUint32(centralOffset + 24, forgedDeclaredBytes, true);

    const permissiveLimits: BoundedZipLimits = {
      ...TEST_LIMITS,
      maxCompressionRatio: 1_000,
    };
    expect(preflightBoundedZip(bytes, permissiveLimits).entries[0]?.uncompressedBytes)
      .toBe(forgedDeclaredBytes);
    expect(() => unzipBoundedZipSync(bytes, permissiveLimits))
      .toThrow(/inflated size.*exceeds its directory declaration/i);
  });

  it('checks CRCs for stored and DEFLATE entries', () => {
    for (const level of [0, 9] as const) {
      const bytes = copy(zipSync({ a: strToU8('content') }, { level }));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const localOffset = findSignature(bytes, 0x04034b50);
      const centralOffset = findSignature(bytes, 0x02014b50);
      const forgedCrc = view.getUint32(centralOffset + 16, true) ^ 0xffffffff;
      view.setUint32(localOffset + 14, forgedCrc, true);
      view.setUint32(centralOffset + 16, forgedCrc, true);

      expect(() => unzipBoundedZipSync(bytes, TEST_LIMITS)).toThrow(/CRC check/i);
    }
  });
});
