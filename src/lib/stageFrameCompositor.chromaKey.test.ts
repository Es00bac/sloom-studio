import { describe, expect, it } from 'vitest';
import { applyChromaKeyToImageData } from './chromaKeyPreview';
import { applyChromaKeyToCanvasSource } from './stageFrameCompositor';

describe('stage-frame chroma-key parity', () => {
  it('applies the same keyed alpha to a compositor canvas as the preview helper', () => {
    const source = new Uint8ClampedArray([
      0, 255, 0, 255,
      0, 180, 0, 255,
      255, 0, 0, 255,
    ]);
    const expected = { width: 3, height: 1, data: new Uint8ClampedArray(source) };
    const imageData = { width: 3, height: 1, data: new Uint8ClampedArray(source) };
    const context = {
      getImageData: () => imageData,
      putImageData: (next: typeof imageData) => Object.assign(imageData, next),
    };
    const canvas = {
      width: 3,
      height: 1,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const settings = {
      enabled: true,
      color: '#00ff00',
      similarityPercent: 20,
      blendPercent: 40,
    };

    applyChromaKeyToImageData(expected, settings);
    applyChromaKeyToCanvasSource(canvas, settings);

    expect(Array.from(imageData.data)).toEqual(Array.from(expected.data));
  });
});
