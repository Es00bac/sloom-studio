import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CMYK_MAX_PROFILE_BYTES,
  createImageCmykBuffer,
  createImageCmykaReseparationTransform,
  createImageCmykaToDisplayTransform,
  createImageGamutCheckTransform,
  createImageRgbToCmykaTransform,
  validateImageCmykProfile,
} from './iccTransforms';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

describe('Image ICC transform foundation', () => {
  it('uses Little-CMS for FOGRA39 RGB16 to CMYKA conversion and preserves alpha', async () => {
    const transform = await createImageRgbToCmykaTransform(fogra39, 'u16');
    try {
      const output = transform.transform(new Uint16Array([
        65_535, 0, 0, 32_768,
        65_535, 65_535, 65_535, 65_535,
        0, 0, 0, 65_535,
      ]), 3);
      expect(Array.from(output.slice(0, 5))).toMatchObject([0, expect.any(Number), expect.any(Number), 0, 128]);
      expect(output[1]).toBeGreaterThanOrEqual(240);
      expect(output[2]).toBeGreaterThanOrEqual(240);
      expect(Array.from(output.slice(5, 10))).toEqual([0, 0, 0, 0, 255]);
      expect(output[13]).toBeGreaterThanOrEqual(220);
      expect(output[14]).toBe(255);
      expect(transform.transformImage(new Uint16Array([
        65_535, 0, 0, 32_768,
        65_535, 65_535, 65_535, 65_535,
        0, 0, 0, 65_535,
      ]), 3, 1)).toEqual(output);
    } finally {
      transform.dispose();
    }
  });

  it('returns an alpha-preserving CMYK to display-sRGB transform and rejects use after disposal', async () => {
    const toInk = await createImageRgbToCmykaTransform(fogra39, 'u8');
    const toDisplay = await createImageCmykaToDisplayTransform(fogra39);
    try {
      const ink = toInk.transform(new Uint8Array([255, 0, 0, 37]), 1);
      const display = toDisplay.transform(ink, 1);
      expect(display).toHaveLength(4);
      expect(display[3]).toBe(37);
      expect(display[0]).toBeGreaterThan(display[1]);
      expect(toDisplay.transformImage(ink, 1, 1)).toEqual(display);
    } finally {
      toInk.dispose();
      toDisplay.dispose();
    }
    expect(() => toDisplay.transform(new Uint8Array([0, 0, 0, 0, 0]), 1)).toThrow(/disposed/i);
  });

  it('validates only bounded CMYK printer profiles and fails closed before opening hostile bytes', async () => {
    await expect(validateImageCmykProfile(fogra39)).resolves.toMatchObject({ colorSpace: 'CMYK', name: expect.any(String) });
    await expect(validateImageCmykProfile(new Uint8Array(IMAGE_CMYK_MAX_PROFILE_BYTES + 1))).rejects.toThrow(/2 MiB/i);
    const rgbHeader = fogra39.slice();
    rgbHeader.set([0x52, 0x47, 0x42, 0x20], 16);
    await expect(validateImageCmykProfile(rgbHeader)).rejects.toThrow(/CMYK/i);
  });

  it('makes the interim native CMYK buffer shape explicit and non-forgeable', () => {
    expect(createImageCmykBuffer(2, 1, new Uint8Array(10))).toMatchObject({ model: 'cmyk', depth: 'u8', width: 2, height: 1 });
    expect(() => createImageCmykBuffer(2, 1, new Uint8Array(8))).toThrow(/interleaved/i);
  });

  it('re-separates explicit CMYKA buffers and flags saturated colours with the real proofing alarm', async () => {
    const toInk = await createImageRgbToCmykaTransform(fogra39, 'u8');
    const reSeparation = await createImageCmykaReseparationTransform(fogra39, fogra39);
    const gamut = await createImageGamutCheckTransform(fogra39);
    try {
      const ink = toInk.transform(new Uint8Array([0, 255, 0, 255]), 1);
      const reSeparated = reSeparation.transform(ink, 1);
      expect(reSeparated).toHaveLength(5);
      expect(reSeparated[4]).toBe(255);
      const gamutInput = new Uint8Array([
        0, 255, 0, 255,
        255, 255, 255, 255,
        0, 255, 0, 0,
      ]);
      expect(gamut.check(gamutInput, 3)).toEqual([true, false, false]);
      expect(gamut.checkImage(gamutInput, 3, 1)).toEqual([true, false, false]);
      expect(reSeparation.transformImage(ink, 1, 1)).toEqual(reSeparated);
    } finally {
      toInk.dispose();
      reSeparation.dispose();
      gamut.dispose();
    }
  });
});
