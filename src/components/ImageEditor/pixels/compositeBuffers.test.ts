import { describe, expect, it, vi } from 'vitest';
import type { BlendMode, PixelBuffer } from '../../../types/imageEditor';
import { convertPixelBuffer, createPixelBuffer, pixelBufferEquals } from './PixelBuffer';
import { blendRgb, blendRgba8 } from './blendKernels';
import {
  assertNativeCompositeTargetDimensions,
  compositePixelBuffersForTarget,
  compositePixelBuffers,
  NativeCompositeRefusal,
  type NativeCompositeLayer,
} from './compositeBuffers';

const ALL_MODES: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

function pixel(depth: 'u8' | 'u16' | 'f32', values: readonly number[], width = 1, height = 1): PixelBuffer {
  const result = createPixelBuffer({ width, height, depth });
  (result.data as Uint8Array | Uint16Array | Float32Array).set(values);
  return result;
}

function layer(pixels: PixelBuffer, overrides: Partial<NativeCompositeLayer> = {}): NativeCompositeLayer {
  return { pixels, ...overrides };
}

describe('native PixelBuffer compositor', () => {
  it('composites every reviewed mode with the exact translucent-alpha equation', () => {
    const backdrop = { r: 0.8, g: 0.2, b: 0.4 };
    const source = { r: 0.1, g: 0.7, b: 0.9 };
    for (const mode of ALL_MODES) {
      const base = pixel('f32', [backdrop.r, backdrop.g, backdrop.b, 0.25]);
      const top = pixel('f32', [source.r, source.g, source.b, 0.5]);
      const result = compositePixelBuffers([layer(base), layer(top, { blendMode: mode })]);
      const expected = blendRgb(mode, backdrop, source, 0.25, 0.5);
      const data = result.data as Float32Array;
      expect(data[0]).toBeCloseTo(expected.color.r, 5);
      expect(data[1]).toBeCloseTo(expected.color.g, 5);
      expect(data[2]).toBeCloseTo(expected.color.b, 5);
      expect(data[3]).toBeCloseTo(expected.alpha, 5);
    }
  });

  it('keeps u16 authority precision and does not mutate input layers', () => {
    const base = pixel('u16', [1001, 30003, 50005, 65535]);
    const top = pixel('u16', [32769, 45001, 12347, 32768]);
    const beforeBase = convertPixelBuffer(base, 'u16');
    const beforeTop = convertPixelBuffer(top, 'u16');
    const result = compositePixelBuffers([layer(base), layer(top, { opacity: 0.75, blendMode: 'multiply' })]);
    expect(result.depth).toBe('u16');
    expect(pixelBufferEquals(base, beforeBase)).toBe(true);
    expect(pixelBufferEquals(top, beforeTop)).toBe(true);
    expect(Array.from(result.data as Uint16Array).some((value) => value > 255 && value < 65535)).toBe(true);
  });

  it('preserves finite f32 highlights through normal source-over', () => {
    const result = compositePixelBuffers([layer(pixel('f32', [4, 2, 0.5, 1]))]);
    expect(Array.from(result.data as Float32Array)).toEqual([4, 2, 0.5, 1]);
  });

  it('keeps ordinary u8 output within the reviewed Canvas parity contract', () => {
    const backdrop = { r: 80, g: 140, b: 210, a: 255 };
    const source = { r: 190, g: 40, b: 120, a: 255 };
    for (const mode of ALL_MODES) {
      const result = compositePixelBuffers([
        layer(pixel('u8', [backdrop.r, backdrop.g, backdrop.b, backdrop.a])),
        layer(pixel('u8', [source.r, source.g, source.b, source.a]), { blendMode: mode }),
      ]);
      expect(Array.from(result.data as Uint8Array)).toEqual([
        blendRgba8(mode, backdrop, source).r,
        blendRgba8(mode, backdrop, source).g,
        blendRgba8(mode, backdrop, source).b,
        255,
      ]);
    }
  });

  it('applies u8 mask coverage and visibility before changing no source state', () => {
    const source = pixel('u16', [65535, 0, 0, 65535]);
    const mask = pixel('u8', [0, 0, 0, 128]);
    const result = compositePixelBuffers([layer(source, { mask })]);
    expect((result.data as Uint16Array)[0]).toBe(65535);
    expect((result.data as Uint16Array)[3]).toBeCloseTo(65535 * 128 / 255, -1);
    const hidden = compositePixelBuffers([layer(source, { visible: false })]);
    expect(Array.from(hidden.data as Uint16Array)).toEqual([0, 0, 0, 0]);
  });

  it('refuses unsupported state, mismatched dimensions/depth, invalid masks, and hostile budget before allocation', () => {
    const u16 = pixel('u16', [1, 2, 3, 65535]);
    const f32 = pixel('f32', [1, 2, 3, 1]);
    const hostile = (mutator: (entry: NativeCompositeLayer) => void): void => {
      const entry = layer(u16);
      mutator(entry);
      expect(() => compositePixelBuffers([entry])).toThrow(NativeCompositeRefusal);
    };
    hostile((entry) => { entry.hasTransform = true; });
    hostile((entry) => { entry.hasEffects = true; });
    hostile((entry) => { entry.hasAdjustment = true; });
    expect(() => compositePixelBuffers([layer(u16), layer(f32)])).toThrow(/depth/);
    expect(() => compositePixelBuffers([layer(u16), layer(pixel('u16', [1, 2, 3, 4], 2, 1))])).toThrow(/dimensions/);
    const wrongMask = layer(f32);
    expect(() => compositePixelBuffers([layer(u16, { mask: wrongMask.pixels })])).toThrow(/masks/);
    expect(() => compositePixelBuffers([layer(u16)], { budgetBytes: 1 })).toThrow(/resource bound/);
  });

  it('refuses persisted unknown blend modes before kernel entry without mutating authority', () => {
    const source = pixel('f32', [0.25, 0.5, 0.75, 1]);
    const before = convertPixelBuffer(source, 'f32');
    const hostile = layer(source, { blendMode: 'future-mode' as BlendMode });
    expect(() => compositePixelBuffers([hostile])).toThrow(/unknown/);
    expect(pixelBufferEquals(source, before)).toBe(true);
  });

  it('refuses an authority/target surface dimension mismatch before a display write', () => {
    const authority = pixel('u16', [1, 2, 3, 65535], 1, 1);
    expect(() => assertNativeCompositeTargetDimensions(authority, 2, 1))
      .toThrow(/does not match target surface.*before putImageData/);
  });

  it('validates scaled target dimensions before invoking the full native composite', () => {
    const authority = pixel('f32', [0.25, 0.5, 0.75, 1], 2, 1);
    const composite = vi.fn(() => authority);

    expect(() => compositePixelBuffersForTarget([
      layer(authority),
    ], 1, 1, {}, composite)).toThrow(/does not match target surface/);
    expect(composite).not.toHaveBeenCalled();
  });
});
