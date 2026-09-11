import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSoftProofTransform, ICC_DISPOSED_RESOURCE_ERROR } from './paperIccEngine';

// Real redistribution-cleared FOGRA39 (ISO Coated v2) CMYK profile bundled in public/icc/.
const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

function dist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

describe('createSoftProofTransform (real lcms2 soft proof)', () => {
  it('desaturates an out-of-gamut sRGB blue to what CMYK can actually print', async () => {
    const proof = await createSoftProofTransform(fogra39, { intent: 'relative' });
    try {
      const blue = { r: 0, g: 0, b: 255 };
      const proofed = proof.proofRgb(blue);
      // sRGB blue is well outside a coated-offset gamut, so the soft proof must visibly change it…
      expect(dist(proofed, blue)).toBeGreaterThan(15);
      // …by bringing it into gamut (less pure: the blue primary can't stay pinned at 255/0/0).
      expect(proofed.b).toBeLessThan(255);
      expect(proofed.r + proofed.g).toBeGreaterThan(10);
    } finally {
      proof.dispose();
    }
  });

  it('keeps a neutral gray roughly neutral', async () => {
    const proof = await createSoftProofTransform(fogra39);
    try {
      const g = proof.proofRgb({ r: 128, g: 128, b: 128 });
      // Channels stay close together — no strong colour cast on a neutral.
      const spread = Math.max(g.r, g.g, g.b) - Math.min(g.r, g.g, g.b);
      expect(spread).toBeLessThan(24);
    } finally {
      proof.dispose();
    }
  });

  it('maps media white to display white without paper simulation', async () => {
    const proof = await createSoftProofTransform(fogra39, { simulatePaperWhite: false });
    try {
      const white = proof.proofRgb({ r: 255, g: 255, b: 255 });
      expect(white.r).toBeGreaterThanOrEqual(250);
      expect(white.g).toBeGreaterThanOrEqual(250);
      expect(white.b).toBeGreaterThanOrEqual(250);
    } finally {
      proof.dispose();
    }
  });

  it('tints white toward the stock when simulating paper color', async () => {
    const proof = await createSoftProofTransform(fogra39, { simulatePaperWhite: true });
    try {
      const white = proof.proofRgb({ r: 255, g: 255, b: 255 });
      // Absolute-colorimetric paper simulation pulls white off pure white (coated stock is slightly warm).
      expect(dist(white, { r: 255, g: 255, b: 255 })).toBeGreaterThan(2);
      expect(Math.min(white.r, white.g, white.b)).toBeLessThan(255);
    } finally {
      proof.dispose();
    }
  });

  it('soft-proofs a whole RGB buffer in one call', async () => {
    const proof = await createSoftProofTransform(fogra39);
    try {
      const pixels = new Uint8Array([0, 0, 255, 255, 255, 255]); // blue, white
      const out = proof.proofRgbBuffer(pixels, 2);
      expect(out).toHaveLength(6);
      // The blue pixel changed; the white pixel stayed ~white.
      expect(dist({ r: out[0], g: out[1], b: out[2] }, { r: 0, g: 0, b: 255 })).toBeGreaterThan(15);
      expect(out[3]).toBeGreaterThanOrEqual(250);
    } finally {
      proof.dispose();
    }
  });

  it('rejects a non-CMYK profile', async () => {
    await expect(createSoftProofTransform(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('rejects every soft-proof operation after disposal before re-entering lcms', async () => {
    const proof = await createSoftProofTransform(fogra39);
    proof.dispose();

    expect(() => proof.proofRgb({ r: 1, g: 2, b: 3 })).toThrow(ICC_DISPOSED_RESOURCE_ERROR);
    expect(() => proof.proofRgbBuffer(new Uint8Array([1, 2, 3]), 1)).toThrow(ICC_DISPOSED_RESOURCE_ERROR);
  });
});
