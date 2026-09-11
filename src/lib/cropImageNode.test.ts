import { describe, expect, it } from 'vitest';
import {
  buildCropPreviewOverlayRect,
  buildCropSourceRect,
  normalizeCropPercent,
  resolveCropImageNodeSettings,
} from './cropImageNode';

describe('crop image node helpers', () => {
  it('normalizes crop percentages into a usable bounded crop box', () => {
    expect(normalizeCropPercent(-5, 0)).toBe(0);
    expect(normalizeCropPercent(120, 100)).toBe(100);
    expect(normalizeCropPercent(Number.NaN, 25)).toBe(25);
  });

  it('resolves invalid node crop settings to a centered square crop', () => {
    expect(resolveCropImageNodeSettings({})).toEqual({
      xPercent: 10,
      yPercent: 10,
      widthPercent: 80,
      heightPercent: 80,
    });
  });

  it('converts normalized percentages to pixel crop rectangles', () => {
    expect(buildCropSourceRect(1000, 500, {
      xPercent: 10,
      yPercent: 20,
      widthPercent: 50,
      heightPercent: 40,
    })).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 200,
    });
  });

  it('keeps crop rectangles inside the source image', () => {
    expect(buildCropSourceRect(320, 240, {
      xPercent: 75,
      yPercent: 70,
      widthPercent: 60,
      heightPercent: 60,
    })).toEqual({
      x: 240,
      y: 168,
      width: 80,
      height: 72,
    });
  });

  it('maps the source crop rectangle onto the rendered preview image bounds', () => {
    expect(buildCropPreviewOverlayRect(
      1024,
      768,
      256,
      192,
      {
        xPercent: 15,
        yPercent: 10,
        widthPercent: 70,
        heightPercent: 70,
      },
    )).toEqual({
      left: 38.5,
      top: 19.25,
      width: 179.25,
      height: 134.5,
    });
  });
});
