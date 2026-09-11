/** Projective (homography) rectification core for Perspective Crop. Pure +
 * tested; the crop tool/store render the composite, then warp the user's 4-corner
 * quad to a straight output rectangle. Kept canvas-free for unit testing. */

export interface CropPoint {
  x: number;
  y: number;
}

/** Hard bounds applied before any perspective-crop raster allocation. */
export const PERSPECTIVE_CROP_MAX_OUTPUT_DIMENSION = 16_384;
export const PERSPECTIVE_CROP_MAX_OUTPUT_PIXELS = 64_000_000;

export function isPerspectiveCropOutputAllocationSafe(width: number, height: number): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width >= 1
    && height >= 1
    && width <= PERSPECTIVE_CROP_MAX_OUTPUT_DIMENSION
    && height <= PERSPECTIVE_CROP_MAX_OUTPUT_DIMENSION
    && width <= Math.floor(PERSPECTIVE_CROP_MAX_OUTPUT_PIXELS / height);
}

/** 8 homography coefficients [a,b,c,d,e,f,g,h]; the 9th (i) is fixed at 1. */
export type Homography = readonly [number, number, number, number, number, number, number, number];

/**
 * Solve the homography mapping the four `src` points to the four `dst` points
 * (order: top-left, top-right, bottom-right, bottom-left). Sets up the 8×8 linear
 * system and solves by Gaussian elimination. Returns null if degenerate.
 */
export function solveHomography(src: CropPoint[], dst: CropPoint[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    a.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const solved = solveLinearSystem(a, b);
  if (!solved) return null;
  return solved as unknown as Homography;
}

/** Apply a homography to a point. */
export function applyHomography(h: Homography, x: number, y: number): CropPoint {
  const denom = h[6] * x + h[7] * y + 1;
  if (denom === 0) return { x: 0, y: 0 };
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denom,
    y: (h[3] * x + h[4] * y + h[5]) / denom,
  };
}

/**
 * Rectify `src` pixels into a `dstWidth`×`dstHeight` output by mapping the source
 * `quad` (TL, TR, BR, BL) onto the output rectangle. Inverse-maps each output
 * pixel back into the source with bilinear sampling. Out-of-bounds → transparent.
 */
export function warpPerspectiveToRect(
  src: { data: ArrayLike<number>; width: number; height: number },
  quad: CropPoint[],
  dstWidth: number,
  dstHeight: number,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (!isPerspectiveCropOutputAllocationSafe(dstWidth, dstHeight) || quad.length !== 4) return null;
  // Homography from output-rect corners -> source quad (so we forward-map each
  // output pixel into the source and sample).
  const rectCorners: CropPoint[] = [
    { x: 0, y: 0 },
    { x: dstWidth, y: 0 },
    { x: dstWidth, y: dstHeight },
    { x: 0, y: dstHeight },
  ];
  const h = solveHomography(rectCorners, quad);
  if (!h) return null;

  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  for (let oy = 0; oy < dstHeight; oy += 1) {
    for (let ox = 0; ox < dstWidth; ox += 1) {
      const s = applyHomography(h, ox + 0.5, oy + 0.5);
      sampleBilinear(src, s.x - 0.5, s.y - 0.5, out, (oy * dstWidth + ox) * 4);
    }
  }
  return { data: out, width: dstWidth, height: dstHeight };
}

function sampleBilinear(
  src: { data: ArrayLike<number>; width: number; height: number },
  fx: number,
  fy: number,
  out: Uint8ClampedArray,
  outOffset: number,
): void {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x1 < 0 || y1 < 0 || x0 >= src.width || y0 >= src.height) {
    return; // fully outside -> transparent
  }
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 4; c += 1) {
    const p00 = pixel(src, x0, y0, c);
    const p10 = pixel(src, x1, y0, c);
    const p01 = pixel(src, x0, y1, c);
    const p11 = pixel(src, x1, y1, c);
    const top = p00 + (p10 - p00) * tx;
    const bottom = p01 + (p11 - p01) * tx;
    out[outOffset + c] = Math.round(top + (bottom - top) * ty);
  }
}

function pixel(
  src: { data: ArrayLike<number>; width: number; height: number },
  x: number,
  y: number,
  channel: number,
): number {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
  return src.data[(y * src.width + x) * 4 + channel];
}

/** Gaussian elimination with partial pivoting for an n×n system. */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const pivotValue = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}
