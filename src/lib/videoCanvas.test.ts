import { describe, expect, it } from 'vitest';
import { getAspectRatioValue, getVideoCanvasDimensions } from './videoCanvas';

describe('getAspectRatioValue', () => {
  it('returns a numeric aspect ratio for editor layout calculations', () => {
    expect(getAspectRatioValue('16:9')).toBeCloseTo(16 / 9);
    expect(getAspectRatioValue('9:16')).toBeCloseTo(9 / 16);
    expect(getAspectRatioValue('1:1')).toBe(1);
    expect(getAspectRatioValue('4:3')).toBeCloseTo(4 / 3);
    expect(getAspectRatioValue('3:4')).toBeCloseTo(3 / 4);
    expect(getAspectRatioValue('21:9')).toBeCloseTo(21 / 9);
  });
});

describe('getVideoCanvasDimensions', () => {
  it('returns standard landscape sizes', () => {
    expect(getVideoCanvasDimensions('16:9', '720p')).toEqual({ width: 1280, height: 720 });
    expect(getVideoCanvasDimensions('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
  });

  it('returns flipped portrait sizes for vertical video', () => {
    expect(getVideoCanvasDimensions('9:16', '720p')).toEqual({ width: 720, height: 1280 });
    expect(getVideoCanvasDimensions('9:16', '4k')).toEqual({ width: 2160, height: 3840 });
  });

  it('returns square sizes for 1:1 output', () => {
    expect(getVideoCanvasDimensions('1:1', '720p')).toEqual({ width: 720, height: 720 });
    expect(getVideoCanvasDimensions('1:1', '1080p')).toEqual({ width: 1080, height: 1080 });
  });
});
