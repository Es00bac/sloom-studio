/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBinaryMask, generateFeatheredMask } from './maskGeneration';

describe('maskGeneration', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        height,
        width,
      }),
      putImageData: vi.fn(),
    }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mask');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a binary mask data URL for a selection', () => {
    const width = 10;
    const height = 10;
    const selectionData = new Uint8ClampedArray(width * height * 4);
    // Fill center 4x4 as selected
    for (let y = 3; y < 7; y++) {
      for (let x = 3; x < 7; x++) {
        const i = (y * width + x) * 4;
        selectionData[i + 3] = 255;
      }
    }
    const result = generateBinaryMask(selectionData, width, height);
    expect(result).toContain('data:image/png;base64,');
  });

  it('generates a feathered mask data URL', () => {
    const width = 20;
    const height = 20;
    const selectionData = new Uint8ClampedArray(width * height * 4);
    for (let y = 7; y < 13; y++) {
      for (let x = 7; x < 13; x++) {
        const i = (y * width + x) * 4;
        selectionData[i + 3] = 255;
      }
    }
    const result = generateFeatheredMask(selectionData, width, height, 3);
    expect(result).toContain('data:image/png;base64,');
  });
});
