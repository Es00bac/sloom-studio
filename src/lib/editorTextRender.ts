import type { TextClipEffect } from '../types/flow';
import { formatFontFamily } from './formatFontFamily';

export interface TextOverlaySvgOptions {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  effect: TextClipEffect;
  opacityPercent: number;
}

export interface TextObjectBoundsOptions {
  text: string;
  fontSizePx: number;
  effect?: TextClipEffect;
  fontFamily?: string;
}

export interface TextObjectBounds {
  width: number;
  height: number;
}

export interface TextOverlaySvgAsset {
  svg: string;
  bounds: TextObjectBounds;
}

const DEFAULT_TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const FALLBACK_TEXT_WIDTH_FACTOR = 1.16;

export function buildTextOverlaySvg({
  text,
  fontFamily,
  fontSizePx,
  color,
  effect,
  opacityPercent,
}: TextOverlaySvgOptions): string {
  return buildTextOverlaySvgAsset({
    text,
    fontFamily,
    fontSizePx,
    color,
    effect,
    opacityPercent,
  }).svg;
}

export function buildTextOverlaySvgAsset({
  text,
  fontFamily,
  fontSizePx,
  color,
  effect,
  opacityPercent,
}: TextOverlaySvgOptions): TextOverlaySvgAsset {
  const textAlpha = Math.max(0.05, Math.min(1, opacityPercent / 100));
  const effectCss = getTextEffectCss(effect);
  const bounds = measureTextObjectBounds({ text, fontSizePx, effect, fontFamily });
  const safeFontSize = Math.max(8, fontSizePx);

  return {
    bounds,
    svg: `
    <svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
      <foreignObject x="0" y="0" width="${bounds.width}" height="${bounds.height}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;text-align:center;background:transparent;pointer-events:none;">
          <div style="${escapeXmlAttribute(`display:inline-block;white-space:pre;font-family:${formatFontFamily(fontFamily || 'Inter, system-ui, sans-serif')};font-size:${safeFontSize}px;line-height:1.12;font-weight:700;color:${color || '#f3f4f6'};opacity:${textAlpha.toFixed(3)};${effectCss}`)}">
            ${escapeHtml(text || 'Text')}
          </div>
        </div>
      </foreignObject>
    </svg>
  `,
  };
}

export function measureTextObjectBounds({
  text,
  fontSizePx,
  effect = 'none',
  fontFamily = DEFAULT_TEXT_FONT_FAMILY,
}: TextObjectBoundsOptions): TextObjectBounds {
  const safeFontSize = Math.max(8, fontSizePx || 64);
  const lines = (text || 'Text').split('\n');
  const effectPadding = getTextEffectPadding(effect, safeFontSize);
  const lineHeight = safeFontSize * 1.12;
  const maxLineWidth = Math.max(
    safeFontSize,
    ...lines.map((line) => measureTextLineWidth(line || ' ', safeFontSize, fontFamily)),
  );
  const horizontalSafetyPadding = Math.max(safeFontSize * 0.14, maxLineWidth * 0.045);
  const verticalSafetyPadding = safeFontSize * 0.12;
  const width = Math.max(
    safeFontSize,
    maxLineWidth,
  );
  const height = Math.max(safeFontSize, lines.length * lineHeight);

  return {
    width: Math.ceil(width + effectPadding * 2 + horizontalSafetyPadding * 2),
    height: Math.ceil(height + effectPadding * 2 + verticalSafetyPadding * 2),
  };
}

function getTextEffectCss(effect: TextClipEffect): string {
  if (effect === 'shadow') {
    return 'text-shadow: 0 6px 20px rgba(0,0,0,0.65);';
  }

  if (effect === 'glow') {
    return 'text-shadow: 0 0 18px rgba(255,255,255,0.65), 0 0 36px rgba(96,165,250,0.45);';
  }

  if (effect === 'outline') {
    return '-webkit-text-stroke: 2px rgba(0,0,0,0.75); text-shadow: 0 2px 6px rgba(0,0,0,0.5);';
  }

  return '';
}

function getTextEffectPadding(effect: TextClipEffect, fontSizePx: number): number {
  if (effect === 'glow') {
    return Math.ceil(fontSizePx * 0.28);
  }

  if (effect === 'shadow') {
    return Math.ceil(fontSizePx * 0.18);
  }

  if (effect === 'outline') {
    return Math.ceil(fontSizePx * 0.08);
  }

  return 0;
}

function estimateTextLineWidth(line: string, fontSizePx: number): number {
  let units = 0;

  for (const character of line) {
    units += estimateCharacterWidthUnits(character);
  }

  return Math.max(fontSizePx * 0.5, units * fontSizePx);
}

function measureTextLineWidth(line: string, fontSizePx: number, fontFamily: string): number {
  const canvasWidth = measureTextLineWidthWithCanvas(line, fontSizePx, fontFamily);

  if (canvasWidth !== undefined) {
    return canvasWidth;
  }

  return estimateTextLineWidth(line, fontSizePx) * FALLBACK_TEXT_WIDTH_FACTOR;
}

let textMeasureCanvas: HTMLCanvasElement | undefined;

function measureTextLineWidthWithCanvas(
  line: string,
  fontSizePx: number,
  fontFamily: string,
): number | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  textMeasureCanvas ??= document.createElement('canvas');
  const context = textMeasureCanvas.getContext('2d');

  if (!context) {
    return undefined;
  }

  context.font = `700 ${Math.max(8, fontSizePx)}px ${formatFontFamily(fontFamily || DEFAULT_TEXT_FONT_FAMILY)}`;
  const metrics = context.measureText(line || ' ');
  const measuredBounds = Math.abs(metrics.actualBoundingBoxLeft ?? 0) + Math.abs(metrics.actualBoundingBoxRight ?? 0);

  return Math.max(metrics.width, measuredBounds);
}

function estimateCharacterWidthUnits(character: string): number {
  if (character === ' ') {
    return 0.33;
  }

  if ('ilI.,:;!|\'`'.includes(character)) {
    return 0.28;
  }

  if ('mwMW@#%&'.includes(character)) {
    return 0.9;
  }

  if ('ABCDEFGHJKLMNOPQRSTUVWXYZ'.includes(character)) {
    return 0.66;
  }

  if ('0123456789'.includes(character)) {
    return 0.56;
  }

  return 0.52;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
