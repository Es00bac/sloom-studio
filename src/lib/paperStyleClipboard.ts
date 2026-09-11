import type { PaperFrame, PaperFramePatch } from '../types/paper';

export const PAPER_STYLE_CLIPBOARD_FIELDS = [
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
] as const;

export interface PaperStyleClipboardPayload {
  fillColor: PaperFrame['fillColor'];
  fillOpacity: PaperFrame['fillOpacity'];
  fillGradient: PaperFrame['fillGradient'];
  strokeColor: PaperFrame['strokeColor'];
  strokeOpacity: PaperFrame['strokeOpacity'];
  strokeWidthMm: PaperFrame['strokeWidthMm'];
  strokeStyle: PaperFrame['strokeStyle'];
  cornerRadiusMm: PaperFrame['cornerRadiusMm'];
  opacity: PaperFrame['opacity'];
  typography: PaperFrame['typography'];
  textBoxXPercent: PaperFrame['textBoxXPercent'];
  textBoxYPercent: PaperFrame['textBoxYPercent'];
  textBoxWidthPercent: PaperFrame['textBoxWidthPercent'];
  textBoxHeightPercent: PaperFrame['textBoxHeightPercent'];
  textVerticalAlign: PaperFrame['textVerticalAlign'];
  textStrokeColor?: PaperFrame['textStrokeColor'];
  textStrokeWidthMm?: PaperFrame['textStrokeWidthMm'];
  textShadowColor?: PaperFrame['textShadowColor'];
  textShadowOffsetXMm?: PaperFrame['textShadowOffsetXMm'];
  textShadowOffsetYMm?: PaperFrame['textShadowOffsetYMm'];
  textShadowBlurMm?: PaperFrame['textShadowBlurMm'];
  textSkewXDeg?: PaperFrame['textSkewXDeg'];
  textSkewYDeg?: PaperFrame['textSkewYDeg'];
  textScaleX?: PaperFrame['textScaleX'];
  textScaleY?: PaperFrame['textScaleY'];
}

export function copyPaperFrameStyle(frame: PaperFrame): PaperStyleClipboardPayload {
  return {
    fillColor: frame.fillColor,
    fillOpacity: frame.fillOpacity,
    fillGradient: frame.fillGradient ? { ...frame.fillGradient } : undefined,
    strokeColor: frame.strokeColor,
    strokeOpacity: frame.strokeOpacity,
    strokeWidthMm: frame.strokeWidthMm,
    strokeStyle: frame.strokeStyle,
    cornerRadiusMm: frame.cornerRadiusMm,
    opacity: frame.opacity,
    typography: { ...frame.typography },
    textBoxXPercent: frame.textBoxXPercent,
    textBoxYPercent: frame.textBoxYPercent,
    textBoxWidthPercent: frame.textBoxWidthPercent,
    textBoxHeightPercent: frame.textBoxHeightPercent,
    textVerticalAlign: frame.textVerticalAlign,
    textStrokeColor: frame.textStrokeColor,
    textStrokeWidthMm: frame.textStrokeWidthMm,
    textShadowColor: frame.textShadowColor,
    textShadowOffsetXMm: frame.textShadowOffsetXMm,
    textShadowOffsetYMm: frame.textShadowOffsetYMm,
    textShadowBlurMm: frame.textShadowBlurMm,
    textSkewXDeg: frame.textSkewXDeg,
    textSkewYDeg: frame.textSkewYDeg,
    textScaleX: frame.textScaleX,
    textScaleY: frame.textScaleY,
  };
}

export function applyPaperStyleClipboardPayload(payload: PaperStyleClipboardPayload): PaperFramePatch {
  return {
    fillColor: payload.fillColor,
    fillOpacity: payload.fillOpacity,
    fillGradient: payload.fillGradient ? { ...payload.fillGradient } : undefined,
    strokeColor: payload.strokeColor,
    strokeOpacity: payload.strokeOpacity,
    strokeWidthMm: payload.strokeWidthMm,
    strokeStyle: payload.strokeStyle,
    cornerRadiusMm: payload.cornerRadiusMm,
    opacity: payload.opacity,
    typography: { ...payload.typography },
    textBoxXPercent: payload.textBoxXPercent,
    textBoxYPercent: payload.textBoxYPercent,
    textBoxWidthPercent: payload.textBoxWidthPercent,
    textBoxHeightPercent: payload.textBoxHeightPercent,
    textVerticalAlign: payload.textVerticalAlign,
    textStrokeColor: payload.textStrokeColor,
    textStrokeWidthMm: payload.textStrokeWidthMm,
    textShadowColor: payload.textShadowColor,
    textShadowOffsetXMm: payload.textShadowOffsetXMm,
    textShadowOffsetYMm: payload.textShadowOffsetYMm,
    textShadowBlurMm: payload.textShadowBlurMm,
    textSkewXDeg: payload.textSkewXDeg,
    textSkewYDeg: payload.textSkewYDeg,
    textScaleX: payload.textScaleX,
    textScaleY: payload.textScaleY,
  };
}
