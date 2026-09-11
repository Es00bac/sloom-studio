import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  applyPaperStyleClipboardPayload,
  copyPaperFrameStyle,
  PAPER_STYLE_CLIPBOARD_FIELDS,
} from './paperStyleClipboard';

function styledFrame(): PaperFrame {
  return {
    id: 'frame-style-source',
    kind: 'speechBubble',
    label: 'Styled Bubble',
    xMm: 12,
    yMm: 18,
    widthMm: 54,
    heightMm: 32,
    rotationDeg: 0,
    locked: false,
    text: 'Hello',
    fit: 'contain',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    imageFlipX: false,
    imageFlipY: false,
    columns: 1,
    typography: {
      fontFamily: 'Impact, sans-serif',
      fontSizePt: 22,
      leadingPt: 20,
      tracking: 45,
      align: 'center',
      hyphenate: false,
      color: '#facc15',
      fontWeight: '900',
      fontStyle: 'italic',
    },
    fillColor: '#ffffff',
    fillOpacity: 0.82,
    fillGradient: { type: 'linear', fromColor: '#fde047', toColor: '#fb7185', angleDeg: 20 },
    strokeColor: '#111827',
    strokeOpacity: 0.9,
    strokeWidthMm: 0.8,
    strokeStyle: 'dashed',
    cornerRadiusMm: 4,
    opacity: 0.75,
    textBoxXPercent: 8,
    textBoxYPercent: 12,
    textBoxWidthPercent: 82,
    textBoxHeightPercent: 72,
    textRotationDeg: 0,
    textVerticalAlign: 'middle',
    textStrokeColor: '#111827',
    textStrokeWidthMm: 0.45,
    textShadowColor: '#7f1d1d',
    textShadowOffsetXMm: 1.2,
    textShadowOffsetYMm: 1.4,
    textShadowBlurMm: 0.2,
    textSkewXDeg: -8,
    textSkewYDeg: 0,
    bubbleShape: 'organic',
    bubbleWarp: 0.2,
    bubblePinchXPercent: 58,
    bubblePinchYPercent: 75,
    bubbleTailWidthPercent: 20,
    bubbleTailCurvePercent: 60,
    vertices: undefined,
    tailXPercent: 72,
    tailYPercent: 92,
    zIndex: 3,
    inherited: false,
  };
}

describe('paper style clipboard', () => {
  it('copies the complete frame, typography, border, opacity, and text-box style payload', () => {
    const payload = copyPaperFrameStyle(styledFrame());

    expect(PAPER_STYLE_CLIPBOARD_FIELDS).toEqual([
      'fillColor',
      'fillOpacity',
      'fillGradient',
      'strokeColor',
      'strokeOpacity',
      'strokeWidthMm',
      'strokeStyle',
      'cornerRadiusMm',
      'opacity',
      'typography',
      'textBoxXPercent',
      'textBoxYPercent',
      'textBoxWidthPercent',
      'textBoxHeightPercent',
      'textVerticalAlign',
    ]);
    expect(payload).toMatchObject({
      fillColor: '#ffffff',
      fillOpacity: 0.82,
      strokeStyle: 'dashed',
      typography: {
        fontFamily: 'Impact, sans-serif',
        fontSizePt: 22,
        fontWeight: '900',
      },
      textBoxXPercent: 8,
      textBoxYPercent: 12,
      textBoxWidthPercent: 82,
      textBoxHeightPercent: 72,
      textVerticalAlign: 'middle',
      textStrokeColor: '#111827',
      textStrokeWidthMm: 0.45,
      textShadowColor: '#7f1d1d',
      textSkewXDeg: -8,
    });
  });

  it('builds a paste patch without copying identity, geometry, content, or source asset', () => {
    const payload = copyPaperFrameStyle(styledFrame());
    const patch = applyPaperStyleClipboardPayload(payload);

    expect(patch).toMatchObject({
      fillColor: '#ffffff',
      fillOpacity: 0.82,
      fillGradient: { type: 'linear', fromColor: '#fde047', toColor: '#fb7185', angleDeg: 20 },
      strokeColor: '#111827',
      strokeOpacity: 0.9,
      strokeWidthMm: 0.8,
      strokeStyle: 'dashed',
      cornerRadiusMm: 4,
      opacity: 0.75,
      textBoxXPercent: 8,
      textBoxYPercent: 12,
      textBoxWidthPercent: 82,
      textBoxHeightPercent: 72,
      textVerticalAlign: 'middle',
      typography: expect.objectContaining({ color: '#facc15', align: 'center' }),
    });
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('label');
    expect(patch).not.toHaveProperty('text');
    expect(patch).not.toHaveProperty('asset');
    expect(patch).not.toHaveProperty('xMm');
    expect(patch).not.toHaveProperty('yMm');
  });
});
