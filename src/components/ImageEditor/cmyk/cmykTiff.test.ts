import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createImageCmykBuffer } from '../../../lib/iccTransforms';
import { createImportedImageCmykProfile, resolveBundledImageCmykProfile } from './cmykProfiles';
import { decodeImageCmykTiff, describeImageCmykOutputPolicy, encodeImageCmykTiff } from './cmykTiff';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const profile = resolveBundledImageCmykProfile('fogra39');
const buffer = () => createImageCmykBuffer(2, 1, new Uint8Array([
  10, 20, 30, 40, 255,
  50, 60, 70, 80, 128,
]));

function tagOffset(bytes: Uint8Array, tagId: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagCount = view.getUint16(8, true);
  for (let index = 0; index < tagCount; index += 1) {
    const offset = 10 + index * 12;
    if (view.getUint16(offset, true) === tagId) return offset;
  }
  throw new Error(`Missing TIFF tag ${tagId}.`);
}

describe('CMYKA TIFF pure module', () => {
  it('writes and reopens a bounded DeviceCMYK TIFF with exact profile and unassociated alpha', () => {
    const output = encodeImageCmykTiff(buffer(), profile, fogra39);
    expect(output).toMatchObject({ format: 'tiff', width: 2, height: 1, samplesPerPixel: 5 });
    const decoded = decodeImageCmykTiff(output.bytes);
    expect(decoded.warnings).toEqual([]);
    expect(decoded.profileBytes).toEqual(fogra39);
    expect(decoded.buffer).toMatchObject({ model: 'cmyk', depth: 'u8', width: 2, height: 1 });
    expect(decoded.buffer.data).toEqual(buffer().data);
  });

  it('refuses CMYK JPEG rather than relabelling a browser RGB JPEG as process color', () => {
    expect(describeImageCmykOutputPolicy('tiff')).toMatchObject({ status: 'supported' });
    expect(describeImageCmykOutputPolicy('jpeg')).toMatchObject({ status: 'refused', reason: expect.stringMatching(/browser JPEG/i) });
  });

  it('fails closed on hostile TIFF geometry, sample shape, and invalid profiles', () => {
    const output = encodeImageCmykTiff(buffer(), profile, fogra39);
    const badSamples = output.bytes.slice();
    new DataView(badSamples.buffer).setUint16(8 + 2 + 6 * 12 + 8, 3, true);
    expect(() => decodeImageCmykTiff(badSamples)).toThrow(/four CMYK/i);
    expect(() => encodeImageCmykTiff(buffer(), profile, new Uint8Array(127))).toThrow(/ICC/i);
    expect(() => createImportedImageCmykProfile({ assetId: 'icc', sha256: 'x'.repeat(64), label: 'broken' })).toThrow(/invalid/i);
  });

  it('keeps a missing embedded profile as an explicit importer decision rather than silently substituting one', () => {
    const output = encodeImageCmykTiff(buffer(), profile, fogra39);
    const withoutProfile = output.bytes.slice();
    const view = new DataView(withoutProfile.buffer);
    const tagCount = view.getUint16(8, true);
    for (let index = 0; index < tagCount; index += 1) {
      const offset = 10 + index * 12;
      if (view.getUint16(offset, true) === 34675) view.setUint16(offset, 0, true);
    }
    expect(decodeImageCmykTiff(withoutProfile).warnings[0]).toMatch(/no embedded ICC/i);
  });

  it('refuses a contradictory alpha declaration on a four-ink DeviceCMYK image', () => {
    const contradictory = encodeImageCmykTiff(buffer(), profile, fogra39).bytes.slice();
    const view = new DataView(contradictory.buffer);
    const samples = tagOffset(contradictory, 277);
    const bits = tagOffset(contradictory, 258);
    const stripByteCount = tagOffset(contradictory, 279);
    view.setUint16(samples + 8, 4, true);
    view.setUint32(bits + 4, 4, true);
    view.setUint32(stripByteCount + 8, 8, true);
    expect(() => decodeImageCmykTiff(contradictory)).toThrow(/must not declare an alpha/i);
  });
});
