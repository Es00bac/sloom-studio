import { describe, expect, it } from 'vitest';
import type { PaperSwatch } from './paperSwatches';
import { resolvePaperPrintPaint } from './paperPrintPaint';

const processCmyk: PaperSwatch = {
  id: 'process-cmyk',
  name: 'Exact process',
  type: 'process',
  model: 'cmyk',
  rgb: { r: 12, g: 34, b: 56 },
  cmyk: { c: 12, m: 34, y: 56, k: 78 },
};

const spot: PaperSwatch = {
  id: 'spot-red',
  name: 'PANTONE 185 C',
  type: 'spot',
  model: 'cmyk',
  rgb: { r: 228, g: 0, b: 43 },
  cmyk: { c: 0, m: 91, y: 76, k: 0 },
  spotName: 'PANTONE 185 C',
};

const gray: PaperSwatch = {
  id: 'gray-60',
  name: 'Gray 60',
  type: 'process',
  model: 'gray',
  rgb: { r: 102, g: 102, b: 102 },
  grayPercent: 60,
};

describe('resolvePaperPrintPaint', () => {
  it('preserves authored process CMYK without an RGB round trip', () => {
    expect(resolvePaperPrintPaint({ color: '#0c2238', swatchId: processCmyk.id }, [processCmyk])).toEqual({
      kind: 'process-cmyk',
      c: 0.12,
      m: 0.34,
      y: 0.56,
      k: 0.78,
      tint: 1,
    });
  });

  it('keeps a named spot alternate and tint separate from its process channels', () => {
    expect(resolvePaperPrintPaint({ color: '#e4002b', swatchId: spot.id, tint: 0.35 }, [spot])).toEqual({
      kind: 'spot',
      name: 'PANTONE 185 C',
      alternate: { c: 0, m: 0.91, y: 0.76, k: 0 },
      tint: 0.35,
    });
  });

  it('keeps authored gray native and identifies ordinary CSS as managed sRGB', () => {
    expect(resolvePaperPrintPaint({ color: '#666666', swatchId: gray.id, tint: 0.5 }, [gray])).toEqual({
      kind: 'gray', gray: 0.6, tint: 0.5,
    });
    expect(resolvePaperPrintPaint({ color: 'rgb(18, 52, 86)' })).toEqual({
      kind: 'managed-rgb', r: 18 / 255, g: 52 / 255, b: 86 / 255, profile: 'srgb',
    });
  });
});
