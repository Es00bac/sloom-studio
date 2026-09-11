import type { PaperFrame } from '../types/paper';

export type PaperTextPaintEffectStyle = Partial<{
  WebkitTextStroke: string;
  paintOrder: string;
  textShadow: string;
}>;

export function buildPaperTextPaintEffectStyle(
  frame: PaperFrame,
  mmToCssPx: (valueMm: number) => number,
): PaperTextPaintEffectStyle {
  const style: PaperTextPaintEffectStyle = {};

  if (isPositive(frame.textStrokeWidthMm) && frame.textStrokeColor) {
    style.WebkitTextStroke = `${formatCssNumber(mmToCssPx(frame.textStrokeWidthMm))}px ${frame.textStrokeColor}`;
    style.paintOrder = 'stroke fill';
  }

  if (frame.textShadowColor) {
    const offsetX = mmToCssPx(finiteOr(frame.textShadowOffsetXMm, 0));
    const offsetY = mmToCssPx(finiteOr(frame.textShadowOffsetYMm, 0));
    const blur = mmToCssPx(Math.max(0, finiteOr(frame.textShadowBlurMm, 0)));
    style.textShadow = `${formatCssNumber(offsetX)}px ${formatCssNumber(offsetY)}px ${formatCssNumber(blur)}px ${frame.textShadowColor}`;
  }

  return style;
}

export function buildPaperTextEffectTransform(frame: PaperFrame): string | undefined {
  const transforms: string[] = [];
  const skewX = finiteOr(frame.textSkewXDeg, 0);
  const skewY = finiteOr(frame.textSkewYDeg, 0);
  const scaleX = positiveOr(frame.textScaleX, 1);
  const scaleY = positiveOr(frame.textScaleY, 1);

  if (skewX || skewY) {
    transforms.push(`skew(${formatCssNumber(skewX)}deg, ${formatCssNumber(skewY)}deg)`);
  }
  if (scaleX !== 1 || scaleY !== 1) {
    transforms.push(`scale(${formatCssNumber(scaleX)}, ${formatCssNumber(scaleY)})`);
  }

  return transforms.length ? transforms.join(' ') : undefined;
}

export function appendPaperTextEffectTransform(
  baseTransform: string | undefined,
  frame: PaperFrame,
): string | undefined {
  const effectTransform = buildPaperTextEffectTransform(frame);
  return [baseTransform, effectTransform].filter(Boolean).join(' ') || undefined;
}

export function buildPaperTextPaintEffectCssText(frame: PaperFrame): string {
  const style = buildPaperTextPaintEffectStyle(frame, (valueMm) => valueMm);
  return [
    style.WebkitTextStroke ? `-webkit-text-stroke: ${style.WebkitTextStroke.replace('px', 'mm')}` : '',
    style.paintOrder ? `paint-order: ${style.paintOrder}` : '',
    style.textShadow ? `text-shadow: ${style.textShadow.replaceAll('px', 'mm')}` : '',
  ].filter(Boolean).join('; ');
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatCssNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}
