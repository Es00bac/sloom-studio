import { describe, expect, it } from 'vitest';
import { buildNativeWindowPageCrop } from './native-paper-pdf-parity-lib.mjs';

describe('native Paper PDF parity helpers', () => {
  it('crops the native window capture from the focused page viewport offset', () => {
    const crop = buildNativeWindowPageCrop({
      focus: {
        pageRect: {
          x: 582.6,
          y: 64.3,
          width: 510.2,
          height: 780.3,
        },
        viewport: {
          width: 1320,
          height: 860,
        },
      },
      screenshot: {
        width: 2640,
        height: 1720,
      },
    });

    expect(crop).toEqual({
      width: 1020,
      height: 1561,
      x: 1165,
      y: 129,
      argument: '1020x1561+1165+129',
    });
  });

  it('preserves the old origin crop when a focused page has no explicit offset', () => {
    const crop = buildNativeWindowPageCrop({
      focus: {
        pageRect: {
          width: 510.2,
          height: 780.3,
        },
        viewport: {
          width: 1320,
          height: 860,
        },
      },
      screenshot: {
        width: 1320,
        height: 860,
      },
    });

    expect(crop).toEqual({
      width: 510,
      height: 780,
      x: 0,
      y: 0,
      argument: '510x780+0+0',
    });
  });
});
