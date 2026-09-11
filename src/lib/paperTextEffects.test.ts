import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  appendPaperTextEffectTransform,
  buildPaperTextEffectTransform,
  buildPaperTextPaintEffectStyle,
} from './paperTextEffects';

function frame(overrides: Partial<PaperFrame> = {}): PaperFrame {
  return {
    id: 'text-1',
    kind: 'text',
    label: 'Title',
    xMm: 10,
    yMm: 12,
    widthMm: 80,
    heightMm: 30,
    rotationDeg: 0,
    locked: false,
    text: 'Boom',
    fit: 'contain',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    columns: 1,
    typography: {
      fontFamily: 'Impact',
      fontSizePt: 44,
      leadingPt: 42,
      tracking: 1.5,
      align: 'center',
      hyphenate: false,
      color: '#f97316',
      fontWeight: '900',
      fontStyle: 'normal',
    },
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeOpacity: 0,
    strokeWidthMm: 0,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textRotationDeg: 0,
    textVerticalAlign: 'middle',
    zIndex: 0,
    ...overrides,
  };
}

describe('paperTextEffects', () => {
  it('builds paint effects for canvas text from millimeter based values', () => {
    expect(buildPaperTextPaintEffectStyle(frame({
      textStrokeColor: '#111111',
      textStrokeWidthMm: 0.4,
      textShadowColor: 'rgba(0,0,0,0.5)',
      textShadowOffsetXMm: 1,
      textShadowOffsetYMm: 1.5,
      textShadowBlurMm: 0.25,
    }), (mm) => mm * 10)).toEqual({
      WebkitTextStroke: '4px #111111',
      paintOrder: 'stroke fill',
      textShadow: '10px 15px 2.5px rgba(0,0,0,0.5)',
    });
  });

  it('builds transform effects and appends them to existing rotations', () => {
    const styledFrame = frame({
      textSkewXDeg: -8,
      textSkewYDeg: 2,
      textScaleX: 1.18,
      textScaleY: 0.92,
    });

    expect(buildPaperTextEffectTransform(styledFrame)).toBe('skew(-8deg, 2deg) scale(1.18, 0.92)');
    expect(appendPaperTextEffectTransform('rotate(10deg)', styledFrame)).toBe('rotate(10deg) skew(-8deg, 2deg) scale(1.18, 0.92)');
  });
});
