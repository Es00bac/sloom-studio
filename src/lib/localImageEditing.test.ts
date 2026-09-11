import { describe, expect, it } from 'vitest';
import { normalizeImageCropRegion } from './localImageEditing';

describe('normalizeImageCropRegion', () => {
  it('clamps crop percentages to a non-empty pixel region', () => {
    expect(
      normalizeImageCropRegion({
        sourceWidth: 1000,
        sourceHeight: 500,
        cropLeftPercent: 60,
        cropRightPercent: 60,
        cropTopPercent: -10,
        cropBottomPercent: 25,
      }),
    ).toEqual({
      sourceX: 470,
      sourceY: 0,
      sourceWidth: 50,
      sourceHeight: 375,
    });
  });
});
