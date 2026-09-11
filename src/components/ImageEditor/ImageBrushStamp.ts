/**
 * Brush-tip stamp cache.
 *
 * The hot path for soft round brushes used to build a fresh `createRadialGradient` + two
 * colour stops for EVERY dab (see the old `paintBrushDab`). On a fast stroke that is dozens of
 * gradient allocations per frame — pure GC churn, worst on mobile/Adreno WebView.
 *
 * Instead we render the soft tip ONCE into a small offscreen "stamp" (canonical radius) and
 * `drawImage` it per dab, scaled/rotated/elongated to the dab. The stamp only rebuilds when the
 * colour or hardness bucket changes, so a normal constant-colour stroke builds a single stamp
 * and then every dab is a cheap blit. Pressure/tilt/velocity still drive size/roundness/alpha at
 * draw time, so all dynamics are preserved.
 *
 * Only soft, round, non-erasing dabs use a stamp — hard round (solid fill) and square tips are
 * already cheap and stay on the direct path, and the erase path keeps its existing hard edge.
 *
 * The pure helpers (key, quantisation, eligibility) are canvas-free and unit-tested; the actual
 * canvas rendering is verified live (real GPU) per the project's pure-core convention.
 */
import type { LayerBitmap } from '../../types/imageEditor';
import type { BrushDab } from './ImageBrushEngine';

/** Canonical stamp radius in px. 128 → a 256px disc: crisp downscaled for small brushes, and a
 * soft gradient hides the mild upscale blur for the rarer very-large soft brushes. */
export const STAMP_CANONICAL_RADIUS = 128;

/** Hardness below this still gets a soft (gradient) edge; at/above it the dab is a solid fill. */
export const STAMP_SOFT_HARDNESS_MAX = 0.98;

/** Hardness is bucketed so continuous pressure-driven hardness doesn't thrash the cache. */
const STAMP_HARDNESS_STEP = 0.05;

/** LRU bound. Constant-colour strokes use 1 entry; colour-dynamic strokes evict gracefully. */
const MAX_BRUSH_STAMPS = 24;

/** Quantise hardness to a stable bucket in [0, 1] so near-identical dabs reuse one stamp. */
export function quantizeStampHardness(hardness: number): number {
  const safe = Number.isFinite(hardness) ? Math.min(1, Math.max(0, hardness)) : 0;
  return Math.round(safe / STAMP_HARDNESS_STEP) * STAMP_HARDNESS_STEP;
}

/**
 * A dab is stamp-eligible only when it is a soft, round, additive dab. Hard round dabs are a cheap
 * solid fill, square tips are a cheap fillRect, and erasing (destination-out) keeps its existing
 * hard-edged behaviour — all of those stay on the direct path.
 */
export function shouldUseBrushStamp(
  dab: Pick<BrushDab, 'hardness' | 'tipShape'>,
  compositeOperation: GlobalCompositeOperation,
): boolean {
  return (
    dab.tipShape === 'round' &&
    compositeOperation !== 'destination-out' &&
    dab.hardness < STAMP_SOFT_HARDNESS_MAX
  );
}

/** Cache key for a stamp: a stamp is fully defined by its colour and (bucketed) hardness. */
export function brushStampCacheKey(color: string, hardnessBucket: number): string {
  return `${color}|${hardnessBucket.toFixed(3)}`;
}

interface StampCacheEntry {
  key: string;
  canvas: LayerBitmap;
}

const stampCache: StampCacheEntry[] = [];

type StampCanvasFactory = (size: number) => LayerBitmap | null;

const defaultStampFactory: StampCanvasFactory = (size) => {
  if (typeof OffscreenCanvas === 'undefined') return null;
  return new OffscreenCanvas(size, size);
};

/**
 * Returns a cached soft-tip stamp (a radial-gradient disc baked in `color`) at the canonical
 * radius, or null if offscreen canvases are unavailable (caller then uses the direct gradient
 * path). The hardness must already be bucketed via {@link quantizeStampHardness}.
 */
export function getBrushStamp(
  color: string,
  hardnessBucket: number,
  factory: StampCanvasFactory = defaultStampFactory,
): LayerBitmap | null {
  const key = brushStampCacheKey(color, hardnessBucket);
  const existingIndex = stampCache.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    const [entry] = stampCache.splice(existingIndex, 1);
    stampCache.push(entry); // move-to-front (most-recently-used at the end)
    return entry.canvas;
  }

  const size = STAMP_CANONICAL_RADIUS * 2;
  const canvas = factory(size);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;

  const center = STAMP_CANONICAL_RADIUS;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(center, center, STAMP_CANONICAL_RADIUS, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(
    center,
    center,
    Math.max(0, STAMP_CANONICAL_RADIUS * hardnessBucket),
    center,
    center,
    STAMP_CANONICAL_RADIUS,
  );
  gradient.addColorStop(0, colorWithAlpha(color, 1));
  gradient.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fill();

  stampCache.push({ key, canvas });
  if (stampCache.length > MAX_BRUSH_STAMPS) stampCache.shift(); // evict least-recently-used
  return canvas;
}

/** Test/memory hook: drop all cached stamps. */
export function clearBrushStampCache(): void {
  stampCache.length = 0;
}

/** Current cache size — exposed for tests. */
export function brushStampCacheSize(): number {
  return stampCache.length;
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const value = hex[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
