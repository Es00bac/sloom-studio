import type { BrushDab, Rect } from './backend';

export interface SmudgeKernelParams extends Pick<BrushDab, 'from' | 'to' | 'size' | 'strength'> {
  rect: Rect;
}

export interface NeighborhoodKernelParams {
  to: { x: number; y: number };
  size: number;
  strength: number;
  rect: Rect;
}

// The blur/sharpen neighbourhood averages a disc per pixel, and the disc radius used to be the FULL
// brush size — making each dab O(size⁴): ~258ms at size 60, ~4 SECONDS at size 120, i.e. a hard
// freeze. A per-pixel averaging radius the size of the whole brush is also far more blur than a brush
// footprint implies. Capping the averaging radius keeps blur strong but bounds the dab to O(size²·k).
const MAX_NEIGHBORHOOD_RADIUS = 16;

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function mixByte(a: number, b: number, t: number): number {
  return clampByte(a + (b - a) * t);
}

function sharpenByte(value: number, blurred: number, strength: number): number {
  return clampByte(value + (value - blurred) * strength);
}

/** Clamp-edge sample of one channel from an ImageData (used by smudge's drag offset). */
function sample(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return data[(cy * width + cx) * 4 + channel] ?? 0;
}

/**
 * Sample-and-blend smudge: pulls the colour from the drag origin (`from`) into pixels near `to`,
 * reading from `source` (the stroke-start snapshot) so writes never feed back. Uniform strength
 * within a hard disc of radius (size-1)/2, integer-centered, matching the existing tool. Bounded to `rect`.
 */
export function smudgeRegion(target: ImageData, source: ImageData, params: SmudgeKernelParams): void {
  const { width, height } = target;
  const radius = Math.max(0, (params.size - 1) / 2);
  const t = clamp01(params.strength);
  const targetCx = Math.round(params.to.x);
  const targetCy = Math.round(params.to.y);
  const dx = Math.round(params.from.x) - targetCx;
  const dy = Math.round(params.from.y) - targetCy;
  const rect = params.rect;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (x < 0 || x >= width) continue;
      if (Math.hypot(x - targetCx, y - targetCy) > radius + 0.001) continue;
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const origin = sample(source.data, source.width, source.height, x + dx, y + dy, c);
        target.data[offset + c] = mixByte(target.data[offset + c] ?? 0, origin, t);
      }
    }
  }
}

/** Blur neighbourhood op: averages `source` in a disc of radius max(1, ceil(size)), blended by strength. */
export function blurRegion(target: ImageData, source: ImageData, params: NeighborhoodKernelParams): void {
  applyNeighborhood(target, source, params, (orig, avg, strength) => mixByte(orig, avg, strength), true);
}

/** Sharpen (unsharp mask) neighbourhood op: orig + (orig - blurred) * strength; alpha untouched. */
export function sharpenRegion(target: ImageData, source: ImageData, params: NeighborhoodKernelParams): void {
  applyNeighborhood(target, source, params, (orig, avg, strength) => sharpenByte(orig, avg, strength), false);
}

function applyNeighborhood(
  target: ImageData,
  source: ImageData,
  params: NeighborhoodKernelParams,
  combine: (orig: number, avg: number, strength: number) => number,
  includeAlpha: boolean,
): void {
  const { width, height } = target;
  const brushRadius = Math.max(0, (params.size - 1) / 2);
  const r = Math.max(1, Math.min(Math.ceil(params.size), MAX_NEIGHBORHOOD_RADIUS));
  const strength = clamp01(params.strength);
  const targetCx = Math.round(params.to.x);
  const targetCy = Math.round(params.to.y);
  const rect = params.rect;
  const x0 = rect.x;
  const y0 = rect.y;
  const rw = rect.width;
  const rh = rect.height;
  if (rw <= 0 || rh <= 0) return;

  // Separable running-sum box blur over `source`, bounded to the dab rect. This is O(region)
  // regardless of `r` — the previous per-pixel disc average was O(region·r²) (≈O(size⁴)), which
  // froze the app for seconds on a large brush. Edge pixels are clamp-extended. Two passes: a
  // horizontal box sum into `hbuf`, then a vertical running sum producing the box average we blend.
  const sw = source.width;
  const sh = source.height;
  const sdata = source.data;
  const win = 2 * r + 1;
  const area = win * win;
  const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v >= hi ? hi - 1 : v);

  const hRows = rh + 2 * r;
  const hbuf = new Float64Array(hRows * rw * 4);
  for (let ry = 0; ry < hRows; ry += 1) {
    const sy = clamp(y0 - r + ry, sh);
    const rowBase = sy * sw;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let wx = -r; wx <= r; wx += 1) {
      const o = (rowBase + clamp(x0 + wx, sw)) * 4;
      sr += sdata[o];
      sg += sdata[o + 1];
      sb += sdata[o + 2];
      sa += sdata[o + 3];
    }
    const outBase = ry * rw * 4;
    for (let rx = 0; rx < rw; rx += 1) {
      const hi = outBase + rx * 4;
      hbuf[hi] = sr;
      hbuf[hi + 1] = sg;
      hbuf[hi + 2] = sb;
      hbuf[hi + 3] = sa;
      const ro = (rowBase + clamp(x0 + rx - r, sw)) * 4;
      const ao = (rowBase + clamp(x0 + rx + r + 1, sw)) * 4;
      sr += sdata[ao] - sdata[ro];
      sg += sdata[ao + 1] - sdata[ro + 1];
      sb += sdata[ao + 2] - sdata[ro + 2];
      sa += sdata[ao + 3] - sdata[ro + 3];
    }
  }

  for (let ox = 0; ox < rw; ox += 1) {
    const x = x0 + ox;
    if (x < 0 || x >= width) continue;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let k = 0; k <= 2 * r; k += 1) {
      const hi = (k * rw + ox) * 4;
      sr += hbuf[hi];
      sg += hbuf[hi + 1];
      sb += hbuf[hi + 2];
      sa += hbuf[hi + 3];
    }
    for (let oy = 0; oy < rh; oy += 1) {
      const y = y0 + oy;
      if (
        y >= 0 &&
        y < height &&
        Math.hypot(x - targetCx, y - targetCy) <= brushRadius + 0.001
      ) {
        const offset = (y * width + x) * 4;
        target.data[offset] = combine(target.data[offset] ?? 0, sr / area, strength);
        target.data[offset + 1] = combine(target.data[offset + 1] ?? 0, sg / area, strength);
        target.data[offset + 2] = combine(target.data[offset + 2] ?? 0, sb / area, strength);
        if (includeAlpha) {
          target.data[offset + 3] = combine(target.data[offset + 3] ?? 0, sa / area, strength);
        }
      }
      if (oy + 1 < rh) {
        const rhi = (oy * rw + ox) * 4;
        const ahi = ((oy + 2 * r + 1) * rw + ox) * 4;
        sr += hbuf[ahi] - hbuf[rhi];
        sg += hbuf[ahi + 1] - hbuf[rhi + 1];
        sb += hbuf[ahi + 2] - hbuf[rhi + 2];
        sa += hbuf[ahi + 3] - hbuf[rhi + 3];
      }
    }
  }
}
