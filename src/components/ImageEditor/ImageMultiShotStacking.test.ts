import { describe, expect, it } from 'vitest';
import {
  ImageMultiShotCancelledError,
  mergeHdrExposure,
  runImageMultiShotStack,
  stackFocus,
  stitchPanorama,
  type ImageMultiShotPixels,
  type ImageMultiShotSource,
} from './ImageMultiShotStacking';

function pixels(width: number, height: number, painter: (x: number, y: number) => [number, number, number, number]): ImageMultiShotPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    data.set(painter(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

function source(id: string, image: ImageMultiShotPixels): ImageMultiShotSource {
  return { id, title: id, pixels: image, bitDepth: 8 };
}

function value(image: ImageMultiShotPixels, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4];
}

describe('ImageMultiShotStacking', () => {
  it('uses exposure weights rather than a blind source average for HDR', () => {
    const dark = source('dark', pixels(4, 4, () => [0, 0, 0, 255]));
    const useful = source('useful', pixels(4, 4, () => [64, 64, 64, 255]));
    const clipped = source('clipped', pixels(4, 4, () => [255, 255, 255, 255]));
    const result = mergeHdrExposure([dark, useful, clipped]);
    // Arithmetic averaging is 106. The usable mid-dark exposure receives a far larger weight.
    expect(value(result.pixels, 1, 1)).toBeLessThan(90);
    expect(result.description).toContain('weighted');
  });

  it('estimates overlap and feather-blends a translated panorama instead of concatenating', () => {
    const scene = (x: number, y: number) => ((x * 37 + y * 19 + (x % 3) * 41) % 220) + 20;
    const left = source('left', pixels(48, 28, (x, y) => {
      const v = scene(x, y);
      return [v, v, v, 255];
    }));
    // This frame starts six scene pixels later than the first frame.
    const right = source('right', pixels(48, 28, (x, y) => {
      const v = scene(x + 6, y);
      return [v, v, v, 255];
    }));
    const result = stitchPanorama([left, right]);
    expect(result.pixels.width).toBe(54);
    expect(result.alignment?.[0]?.x).toBe(6);
    expect(result.alignment?.[0]?.overlap).toBeGreaterThan(0.8);
    expect(value(result.pixels, 52, 10)).toBe(scene(52, 10));
  });

  it('accumulates three-frame leftward panorama placement without losing the outer span', () => {
    const scene = (x: number, y: number) => ((x * 37 + y * 19 + (x % 5) * 29 + (y % 3) * 17) % 220) + 20;
    const frame = (id: string, originX: number) => source(id, pixels(72, 40, (x, y) => {
      const v = scene(x + originX, y);
      return [v, v, v, 255];
    }));
    const result = stitchPanorama([frame('right', 12), frame('middle', 6), frame('left', 0)]);

    expect(result.pixels.width).toBe(84);
    expect(result.pixels.height).toBe(40);
    expect(result.alignment?.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: -6, y: 0 },
      { x: -6, y: 0 },
    ]);
    expect(value(result.pixels, 1, 17)).toBe(scene(1, 17));
    expect(value(result.pixels, 82, 17)).toBe(scene(82, 17));
  });

  it('accumulates both axes across a three-frame drifting panorama', () => {
    const scene = (x: number, y: number) => ((x * 31 + y * 23 + (x % 7) * 13 + (y % 5) * 11) % 220) + 20;
    const frame = (id: string, originX: number, originY: number) => source(id, pixels(72, 40, (x, y) => {
      const v = scene(x + originX, y + originY);
      return [v, v, v, 255];
    }));
    const result = stitchPanorama([
      frame('top-left', 0, 0),
      frame('middle', 6, 6),
      frame('bottom-right', 12, 12),
    ]);

    expect(result.pixels.width).toBe(84);
    expect(result.pixels.height).toBe(52);
    expect(result.alignment?.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 6, y: 6 },
      { x: 12, y: 12 },
    ]);
    expect(value(result.pixels, 1, 1)).toBe(scene(1, 1));
    expect(value(result.pixels, 82, 50)).toBe(scene(82, 50));
  });

  it('selects sharp regions locally for a focus stack instead of selecting one whole frame', () => {
    const softLeftSharpRight = source('left-focus', pixels(12, 12, (x, y) => {
      const edge = x < 6 ? 128 : ((x + y) % 2 ? 255 : 0);
      return [edge, edge, edge, 255];
    }));
    const sharpLeftSoftRight = source('right-focus', pixels(12, 12, (x, y) => {
      const edge = x < 6 ? ((x + y) % 2 ? 230 : 20) : 128;
      return [edge, edge, edge, 255];
    }));
    const result = stackFocus([softLeftSharpRight, sharpLeftSoftRight]);
    expect(value(result.pixels, 3, 5)).toBe(value(sharpLeftSoftRight.pixels, 3, 5));
    expect(value(result.pixels, 8, 5)).toBe(value(softLeftSharpRight.pixels, 8, 5));
  });

  it('refuses unsupported precision and cancellation before any result is created', () => {
    const image = pixels(8, 8, () => [30, 40, 50, 255]);
    expect(() => runImageMultiShotStack('hdr', [source('a', image), { ...source('b', image), bitDepth: 16 }]))
      .toThrow('8-bit RGB');
    const controller = new AbortController();
    controller.abort();
    expect(() => runImageMultiShotStack('focus', [source('a', image), source('b', image)], controller.signal))
      .toThrow(ImageMultiShotCancelledError);
  });
});
