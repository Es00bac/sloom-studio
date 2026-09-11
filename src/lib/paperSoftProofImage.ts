// Pure RGBA soft-proofing. Given a page raster (RGBA, straight-through from a canvas `getImageData`)
// and a soft-proof transform, produce an RGBA image whose colours are replaced by their CMYK-simulated
// equivalents while alpha is preserved. Canvas-free so it unit-tests without a DOM; the browser wrapper
// (`paperSoftProofBrowser.ts`) supplies the rasterize + display steps.

/** The slice of a soft-proof transform this module needs (matches `SoftProofTransform`). */
export interface RgbBufferProofer {
  proofRgbBuffer(rgb: Uint8Array, pixelCount: number): Uint8Array;
}

/**
 * Replace every pixel's RGB with its soft-proofed (CMYK-simulated) RGB, keeping the original alpha.
 * Runs the whole image through the transform in a single lcms2 call.
 */
export function softProofRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  proof: RgbBufferProofer,
): Uint8ClampedArray {
  const pixelCount = Math.floor(rgba.length / 4);
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const proofed = proof.proofRgbBuffer(rgb, pixelCount);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < pixelCount; i += 1) {
    out[i * 4] = proofed[i * 3];
    out[i * 4 + 1] = proofed[i * 3 + 1];
    out[i * 4 + 2] = proofed[i * 3 + 2];
    out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return out;
}
