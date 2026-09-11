// Print-native paint resolution. Authored process/gray/spot swatches stay in their authored model;
// screen RGB remains explicitly managed RGB until the selected output profile converts it at export time.

import type { PaperSwatch } from './paperSwatches';
import { parseHexColor } from './paperSwatches';

export type PaperPrintPaint =
  | { kind: 'process-cmyk'; c: number; m: number; y: number; k: number; tint: number }
  | { kind: 'gray'; gray: number; tint: number }
  | { kind: 'spot'; name: string; alternate: { c: number; m: number; y: number; k: number }; tint: number }
  | { kind: 'managed-rgb'; r: number; g: number; b: number; profile: 'srgb' };

/** Structural source accepted from frame fills/strokes and deterministic text-composition paint sources. */
export interface PaperPrintPaintInput {
  color?: string;
  swatchId?: string;
  /** A 0..1 tint. Frame opacity belongs to node graphics state, not this ink tint. */
  tint?: number;
}

function clampUnit(value: number | undefined, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseCssSrgb(color: string | undefined): { r: number; g: number; b: number } | undefined {
  const normalized = color?.trim() ?? '';
  if (!normalized || normalized.toLowerCase() === 'transparent') return undefined;
  const hex = parseHexColor(normalized);
  if (hex) return hex;

  const rgb = /^rgb\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:,|\s)\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:,|\s)\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*\)$/i.exec(normalized);
  if (!rgb) return undefined;
  return { r: clampByte(Number(rgb[1])), g: clampByte(Number(rgb[2])), b: clampByte(Number(rgb[3])) };
}

function applyRgbTint(rgb: { r: number; g: number; b: number }, tint: number): { r: number; g: number; b: number } {
  return {
    r: clampByte(255 + (rgb.r - 255) * tint),
    g: clampByte(255 + (rgb.g - 255) * tint),
    b: clampByte(255 + (rgb.b - 255) * tint),
  };
}

function cmykChannels(cmyk: NonNullable<PaperSwatch['cmyk']>): { c: number; m: number; y: number; k: number } {
  return {
    c: clampUnit(cmyk.c / 100),
    m: clampUnit(cmyk.m / 100),
    y: clampUnit(cmyk.y / 100),
    k: clampUnit(cmyk.k / 100),
  };
}

/**
 * Resolve a durable Paper paint without converting authored press values through RGB. `undefined` means the
 * source is transparent or cannot be represented as deterministic sRGB/native ink and must be flattened or
 * blocked by production preflight rather than guessed.
 */
export function resolvePaperPrintPaint(
  source: PaperPrintPaintInput,
  swatches: readonly PaperSwatch[] = [],
): PaperPrintPaint | undefined {
  const tint = clampUnit(source.tint);
  const swatch = source.swatchId ? swatches.find((candidate) => candidate.id === source.swatchId) : undefined;
  if (swatch) {
    if (swatch.type === 'spot') {
      if (!swatch.cmyk) return undefined;
      return {
        kind: 'spot',
        name: swatch.spotName?.trim() || swatch.name,
        alternate: cmykChannels(swatch.cmyk),
        tint,
      };
    }
    if (swatch.model === 'cmyk' && swatch.cmyk) {
      return { kind: 'process-cmyk', ...cmykChannels(swatch.cmyk), tint };
    }
    if (swatch.model === 'gray' && swatch.grayPercent !== undefined) {
      return { kind: 'gray', gray: clampUnit(swatch.grayPercent / 100), tint };
    }
    const rgb = applyRgbTint(swatch.rgb, tint);
    return { kind: 'managed-rgb', r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255, profile: 'srgb' };
  }

  const rgb = parseCssSrgb(source.color);
  if (!rgb) return undefined;
  const tinted = applyRgbTint(rgb, tint);
  return { kind: 'managed-rgb', r: tinted.r / 255, g: tinted.g / 255, b: tinted.b / 255, profile: 'srgb' };
}

/** Total authored process ink, in 0..4 units. Spot alternates are used only for TAC reporting. */
export function paperPrintPaintTotalInk(paint: PaperPrintPaint): number | undefined {
  if (paint.kind === 'process-cmyk') return (paint.c + paint.m + paint.y + paint.k) * paint.tint;
  if (paint.kind === 'spot') {
    return (paint.alternate.c + paint.alternate.m + paint.alternate.y + paint.alternate.k) * paint.tint;
  }
  if (paint.kind === 'gray') return paint.gray * paint.tint;
  return undefined;
}
