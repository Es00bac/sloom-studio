/** Edge-detection core for the Magnetic Lasso. Pure + tested; the interactive
 * lasso tool builds the field from the composite bitmap then snaps anchor points
 * toward strong edges. Keeping the math here (no canvas) makes it unit-testable. */

export interface MagneticPoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Sobel gradient-magnitude field from packed RGBA, normalized to 0..1 (1 = the
 * strongest edge in the image). Border pixels are 0. Alpha is ignored — colour
 * luminance drives edge strength.
 */
export function buildEdgeMagnitudeField(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  const gray = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    gray[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }

  const mag = new Float32Array(count);
  let max = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1] -
        (gray[i - width - 1] + 2 * gray[i - 1] + gray[i + width - 1]);
      const gy =
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1] -
        (gray[i - width - 1] + 2 * gray[i - width] + gray[i - width + 1]);
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > max) {
        max = m;
      }
    }
  }

  if (max > 0) {
    for (let i = 0; i < count; i += 1) {
      mag[i] /= max;
    }
  }
  return mag;
}

/**
 * Snap a point toward the strongest edge pixel within a circular `radius`,
 * ignoring edges weaker than `contrastThreshold` (0..1). Magnitude dominates;
 * proximity breaks ties so a flat region leaves the point essentially put. If no
 * pixel clears the threshold, the (clamped, rounded) original point is returned.
 */
export function snapToStrongestEdge(
  field: Float32Array,
  width: number,
  height: number,
  point: MagneticPoint,
  radius: number,
  contrastThreshold = 0,
): MagneticPoint {
  const cx = Math.round(point.x);
  const cy = Math.round(point.y);
  const r = Math.max(0, Math.floor(radius));
  let bestX = clamp(cx, 0, width - 1);
  let bestY = clamp(cy, 0, height - 1);
  let bestScore = -1;

  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r) {
        continue;
      }
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }
      const m = field[y * width + x];
      if (m < contrastThreshold || m <= 0) {
        continue;
      }
      // Prefer a strong edge that remains near the pointer. A raw magnitude-only maximum can
      // pull every anchor across a nearby boundary onto one unrelated dominant edge; normalized
      // proximity preserves local contour following while still favouring stronger edges nearby.
      const distance = Math.hypot(dx, dy);
      const proximity = Math.max(0, 1 - distance / (r + 1));
      const score = m * proximity;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { x: bestX, y: bestY };
}
