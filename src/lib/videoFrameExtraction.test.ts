import { describe, expect, it } from 'vitest';
import { fitFrameCaptureDimensions } from './videoFrameExtraction';

describe('fitFrameCaptureDimensions', () => {
  it('keeps original dimensions when no bounds are provided', () => {
    expect(fitFrameCaptureDimensions(3840, 2160)).toEqual({ width: 3840, height: 2160 });
  });

  it('bounds large landscape frames without changing aspect ratio', () => {
    expect(fitFrameCaptureDimensions(3840, 2160, { maxWidth: 192, maxHeight: 108 })).toEqual({
      width: 192,
      height: 108,
    });
  });

  it('bounds portrait frames by height without changing aspect ratio', () => {
    expect(fitFrameCaptureDimensions(1080, 1920, { maxWidth: 192, maxHeight: 108 })).toEqual({
      width: 61,
      height: 108,
    });
  });
});
