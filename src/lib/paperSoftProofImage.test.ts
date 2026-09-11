import { describe, expect, it } from 'vitest';
import { softProofRgba } from './paperSoftProofImage';

// A stand-in proofer that just swaps R↔B, so we can assert the plumbing (channel order + alpha) exactly.
const swapRB = {
  proofRgbBuffer(rgb: Uint8Array, pixelCount: number): Uint8Array {
    const out = new Uint8Array(rgb.length);
    for (let i = 0; i < pixelCount; i += 1) {
      out[i * 3] = rgb[i * 3 + 2];
      out[i * 3 + 1] = rgb[i * 3 + 1];
      out[i * 3 + 2] = rgb[i * 3];
    }
    return out;
  },
};

describe('softProofRgba', () => {
  it('applies the transform to RGB and preserves alpha', () => {
    // two pixels: opaque red, half-transparent green
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const out = softProofRgba(rgba, swapRB);
    expect(Array.from(out)).toEqual([0, 0, 255, 255, 0, 255, 0, 128]);
  });

  it('passes the correct pixel count to the transform', () => {
    let seenCount = -1;
    const spy = {
      proofRgbBuffer(rgb: Uint8Array, pixelCount: number): Uint8Array {
        seenCount = pixelCount;
        return rgb;
      },
    };
    softProofRgba(new Uint8Array(4 * 5), spy); // 5 pixels
    expect(seenCount).toBe(5);
  });

  it('returns an all-alpha-preserving buffer of the same length', () => {
    const rgba = new Uint8Array(4 * 3).fill(200);
    const out = softProofRgba(rgba, { proofRgbBuffer: (rgb) => rgb });
    expect(out).toHaveLength(rgba.length);
    expect(out[3]).toBe(200);
    expect(out[7]).toBe(200);
  });
});
