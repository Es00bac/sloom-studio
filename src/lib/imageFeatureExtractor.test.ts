import { describe, expect, it } from 'vitest';
import { summarizeImagePixels } from './imageFeatureExtractor';

describe('summarizeImagePixels', () => {
  it('reports dimensions, aspect ratio, and the alpha-weighted average color', () => {
    expect(summarizeImagePixels({
      width: 2,
      height: 1,
      rgba: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
      mimeType: 'image/png',
    })).toEqual({
      width: 2,
      height: 1,
      aspectRatio: 2,
      orientation: 'landscape',
      averageColor: '#800080',
      mimeType: 'image/png',
    });
  });

  it('ignores fully transparent pixels', () => {
    expect(summarizeImagePixels({
      width: 1,
      height: 2,
      rgba: new Uint8ClampedArray([
        0, 255, 0, 0,
        10, 20, 30, 255,
      ]),
    }).averageColor).toBe('#0A141E');
  });
});
