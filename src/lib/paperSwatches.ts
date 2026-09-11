// Pure color/swatch core for the Paper workspace. Screen rendering stays RGB; CMYK/spot swatches are
// converted for preview with the same naive device formula the Image editor uses
// (`buildRgbCmykSeparationPreview` in ImageColorModes.ts), so Paper and Image agree. True ICC
// separations are a later phase; this core powers the swatch catalog, tints, and ink-limit preflight.

export interface PaperRgb {
  r: number;
  g: number;
  b: number;
}

export interface PaperCmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export type PaperSwatchModel = 'rgb' | 'cmyk' | 'gray';
export type PaperSwatchType = 'process' | 'spot';

export interface PaperSwatch {
  id: string;
  name: string;
  type: PaperSwatchType;
  model: PaperSwatchModel;
  /** Canonical screen-RGB hint (always present); the model's own channels win for preview. */
  rgb: PaperRgb;
  cmyk?: PaperCmyk;
  grayPercent?: number;
  spotName?: string;
}

/** A color is either a raw CSS string or a reference to a document swatch (with an optional tint). */
export type PaperColorRef = string | { swatchId: string; tintPercent?: number };

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function rgbToCmyk(rgb: PaperRgb): PaperCmyk {
  const r = clampByte(rgb.r) / 255;
  const g = clampByte(rgb.g) / 255;
  const b = clampByte(rgb.b) / 255;
  const k = 1 - Math.max(r, g, b);

  if (k >= 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }

  const scale = 1 - k;
  return {
    c: Math.round(((1 - r - k) / scale) * 100),
    m: Math.round(((1 - g - k) / scale) * 100),
    y: Math.round(((1 - b - k) / scale) * 100),
    k: Math.round(k * 100),
  };
}

export function cmykToRgb(cmyk: PaperCmyk): PaperRgb {
  const c = clampPercent(cmyk.c) / 100;
  const m = clampPercent(cmyk.m) / 100;
  const y = clampPercent(cmyk.y) / 100;
  const k = clampPercent(cmyk.k) / 100;
  const scale = 1 - k;
  return {
    r: clampByte((1 - c) * scale * 255),
    g: clampByte((1 - m) * scale * 255),
    b: clampByte((1 - y) * scale * 255),
  };
}

export function grayToRgb(grayPercent: number): PaperRgb {
  const value = clampByte((1 - clampPercent(grayPercent) / 100) * 255);
  return { r: value, g: value, b: value };
}

/** Total ink coverage (C+M+Y+K) — drives the print-production ink-limit preflight. */
export function totalInkPercent(cmyk: PaperCmyk): number {
  return clampPercent(cmyk.c) + clampPercent(cmyk.m) + clampPercent(cmyk.y) + clampPercent(cmyk.k);
}

/** The authoritative on-screen RGB for a swatch, derived from its own model's channels. */
export function swatchScreenRgb(swatch: PaperSwatch): PaperRgb {
  if (swatch.model === 'cmyk' && swatch.cmyk) {
    return cmykToRgb(swatch.cmyk);
  }
  if (swatch.model === 'gray' && swatch.grayPercent !== undefined) {
    return grayToRgb(swatch.grayPercent);
  }
  return { r: clampByte(swatch.rgb.r), g: clampByte(swatch.rgb.g), b: clampByte(swatch.rgb.b) };
}

/** Mix an RGB color from paper white toward full ink by `tintPercent` (100 = full color, 0 = paper). */
export function applyTint(rgb: PaperRgb, tintPercent: number): PaperRgb {
  const t = clampPercent(tintPercent) / 100;
  return {
    r: clampByte(255 + (rgb.r - 255) * t),
    g: clampByte(255 + (rgb.g - 255) * t),
    b: clampByte(255 + (rgb.b - 255) * t),
  };
}

export function rgbToCss(rgb: PaperRgb): string {
  return `rgb(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)})`;
}

/** Parse a `#rgb`/`#rrggbb` hex string to RGB (for CMYK readouts of an existing colour). */
export function parseHexColor(value: string): PaperRgb | undefined {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return undefined;
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function resolveSwatchCssColor(swatch: PaperSwatch, tintPercent = 100): string {
  return rgbToCss(applyTint(swatchScreenRgb(swatch), tintPercent));
}
