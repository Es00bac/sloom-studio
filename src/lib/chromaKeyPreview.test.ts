import { describe, expect, it } from 'vitest';
import {
  applyChromaKeyToImageData,
  getChromaKeyAlphaScale,
  parseChromaKeyColor,
} from './chromaKeyPreview';

describe('chroma key preview helpers', () => {
  it('makes exact keyed pixels transparent while preserving non-key pixels', () => {
    const imageData = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        0, 255, 0, 255,
        255, 0, 0, 255,
      ]),
    };

    applyChromaKeyToImageData(imageData, {
      enabled: true,
      color: '#00ff00',
      similarityPercent: 20,
      blendPercent: 6,
    });

    expect(Array.from(imageData.data)).toEqual([
      0, 255, 0, 0,
      255, 0, 0, 255,
    ]);
  });

  it('uses blend to feather pixels close to the key color', () => {
    const keyColor = parseChromaKeyColor('#00ff00');
    const alphaScale = getChromaKeyAlphaScale(
      { red: 0, green: 128, blue: 0 },
      keyColor,
      0.25,
      0.40,
    );

    expect(alphaScale).toBeGreaterThan(0);
    expect(alphaScale).toBeLessThan(1);
  });

  it('leaves pixels unchanged when chroma key is disabled', () => {
    const imageData = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 255, 0, 128]),
    };

    applyChromaKeyToImageData(imageData, {
      enabled: false,
      color: '#00ff00',
      similarityPercent: 100,
      blendPercent: 100,
    });

    expect(Array.from(imageData.data)).toEqual([0, 255, 0, 128]);
  });

  it('falls back invalid colors to green', () => {
    expect(parseChromaKeyColor('not-a-color')).toEqual({
      red: 0,
      green: 255,
      blue: 0,
    });
  });
});
