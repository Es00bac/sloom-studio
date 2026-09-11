import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerBitmap } from '../../types/imageEditor';
import type { BrushDab } from './ImageBrushEngine';
import {
  STAMP_CANONICAL_RADIUS,
  brushStampCacheKey,
  brushStampCacheSize,
  clearBrushStampCache,
  getBrushStamp,
  quantizeStampHardness,
  shouldUseBrushStamp,
} from './ImageBrushStamp';

function dab(patch: Partial<BrushDab>): Pick<BrushDab, 'hardness' | 'tipShape'> {
  return { hardness: 0.5, tipShape: 'round', ...patch };
}

/** Minimal fake offscreen canvas whose 2D context records nothing — we only test caching/identity. */
function fakeCanvasFactory(): (size: number) => LayerBitmap {
  return (size: number) => {
    const ctx = {
      clearRect() {},
      beginPath() {},
      arc() {},
      createRadialGradient() {
        return { addColorStop() {} };
      },
      fill() {},
      set fillStyle(_v: unknown) {},
    };
    return { width: size, height: size, getContext: () => ctx } as unknown as LayerBitmap;
  };
}

beforeEach(() => {
  clearBrushStampCache();
});

describe('quantizeStampHardness', () => {
  it('buckets to the nearest 0.05 and clamps to [0,1]', () => {
    expect(quantizeStampHardness(0.51)).toBeCloseTo(0.5, 5);
    expect(quantizeStampHardness(0.53)).toBeCloseTo(0.55, 5);
    expect(quantizeStampHardness(-1)).toBe(0);
    expect(quantizeStampHardness(2)).toBe(1);
    expect(quantizeStampHardness(Number.NaN)).toBe(0);
  });
});

describe('shouldUseBrushStamp', () => {
  it('is true only for soft, round, additive dabs', () => {
    expect(shouldUseBrushStamp(dab({ hardness: 0.5, tipShape: 'round' }), 'source-over')).toBe(true);
  });
  it('is false for square tips, hard round, and erasing', () => {
    expect(shouldUseBrushStamp(dab({ tipShape: 'square' }), 'source-over')).toBe(false);
    expect(shouldUseBrushStamp(dab({ hardness: 0.99 }), 'source-over')).toBe(false);
    expect(shouldUseBrushStamp(dab({ hardness: 0.5 }), 'destination-out')).toBe(false);
  });
});

describe('brushStampCacheKey', () => {
  it('is colour + bucketed hardness', () => {
    expect(brushStampCacheKey('#ff0000', 0.5)).toBe('#ff0000|0.500');
  });
});

describe('getBrushStamp cache', () => {
  it('builds once per (colour,hardness) and reuses the same canvas', () => {
    const factory = vi.fn(fakeCanvasFactory());
    const first = getBrushStamp('#ffffff', 0.5, factory);
    const second = getBrushStamp('#ffffff', 0.5, factory);
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first?.width).toBe(STAMP_CANONICAL_RADIUS * 2);
  });

  it('caches distinct keys separately and bounds the cache (LRU eviction)', () => {
    const factory = fakeCanvasFactory();
    for (let i = 0; i < 40; i += 1) {
      getBrushStamp(`#0000${i.toString(16).padStart(2, '0')}`, 0.5, factory);
    }
    expect(brushStampCacheSize()).toBeLessThanOrEqual(24);
  });

  it('returns null when no offscreen canvas is available (caller falls back)', () => {
    expect(getBrushStamp('#ffffff', 0.5, () => null)).toBeNull();
  });
});
