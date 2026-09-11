import type { BlendMode } from '../../../types/imageEditor';

/**
 * MH-009 A3 opening increment: per-channel float blend kernels on [0, 1] with
 * straight (non-premultiplied) alpha, following the PDF 1.7 / Photoshop
 * blend-mode specification so the u8 Canvas2D compositor parity claim holds
 * within 1/255.
 *
 * Separable kernels blend each channel independently. The four non-separable
 * component modes (hue, saturation, color, luminosity) operate on RGB triples
 * through the specification's SetLum/SetSat helpers.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type SeparableBlendMode = Exclude<BlendMode, 'hue' | 'saturation' | 'color' | 'luminosity'>;
export type ComponentBlendMode = Extract<BlendMode, 'hue' | 'saturation' | 'color' | 'luminosity'>;

const SEPARABLE_MODES: readonly SeparableBlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
];
const COMPONENT_MODES: readonly ComponentBlendMode[] = ['hue', 'saturation', 'color', 'luminosity'];

export function isSeparableBlendMode(mode: BlendMode): mode is SeparableBlendMode {
  return (SEPARABLE_MODES as readonly string[]).includes(mode);
}

export function isComponentBlendMode(mode: BlendMode): mode is ComponentBlendMode {
  return (COMPONENT_MODES as readonly string[]).includes(mode);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Per-channel separable kernel. Inputs and output are clamped to [0, 1]. */
export function separableBlend(mode: SeparableBlendMode, backdrop: number, source: number): number {
  const b = clamp01(backdrop);
  const s = clamp01(source);
  switch (mode) {
    case 'normal': return s;
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return hardLight(s, b);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'color-dodge':
      // PDF 7.2.4: the backdrop is dodged toward white by the source.
      if (b <= 0) return 0;
      if (s >= 1) return 1;
      return Math.min(1, b / (1 - s));
    case 'color-burn':
      if (b >= 1) return 1;
      if (s <= 0) return 0;
      return 1 - Math.min(1, (1 - b) / s);
    case 'hard-light': return hardLight(b, s);
    case 'soft-light': return softLight(b, s);
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
  }
}

function hardLight(backdrop: number, source: number): number {
  return source <= 0.5
    ? multiply(backdrop, 2 * source)
    : screen(backdrop, 2 * source - 1);
}

function multiply(backdrop: number, source: number): number {
  return backdrop * source;
}

function screen(backdrop: number, source: number): number {
  return backdrop + source - backdrop * source;
}

function softLight(backdrop: number, source: number): number {
  if (source <= 0.5) {
    return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
  }
  const d = backdrop <= 0.25
    ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
    : Math.sqrt(backdrop);
  return backdrop + (2 * source - 1) * (d - backdrop);
}

/** Blend two straight-alpha colors; output alpha per source-over. */
export function blendRgb(
  mode: BlendMode,
  backdrop: Rgb,
  source: Rgb,
  backdropAlpha: number,
  sourceAlpha: number,
): { color: Rgb; alpha: number } {
  const ab = clamp01(backdropAlpha);
  const as = clamp01(sourceAlpha);
  const backdropColor = {
    r: clamp01(backdrop.r),
    g: clamp01(backdrop.g),
    b: clamp01(backdrop.b),
  };
  const sourceColor = {
    r: clamp01(source.r),
    g: clamp01(source.g),
    b: clamp01(source.b),
  };
  const blended = isComponentBlendMode(mode)
    ? componentBlend(mode, backdropColor, sourceColor)
    : {
        r: separableBlend(mode, backdropColor.r, sourceColor.r),
        g: separableBlend(mode, backdropColor.g, sourceColor.g),
        b: separableBlend(mode, backdropColor.b, sourceColor.b),
      };
  const alphaOut = as + ab * (1 - as);
  // PDF 1.7 §7.2.4 performs source-over in premultiplied form. The backdrop
  // color and blend result are both weighted by backdrop alpha, then the
  // straight color is recovered by dividing by the output alpha. The prior
  // equation only happened to be correct for an opaque backdrop.
  if (alphaOut <= 0) return { color: { r: 0, g: 0, b: 0 }, alpha: 0 };
  const color = {
    r: ((1 - as) * ab * backdropColor.r + as * (1 - ab) * sourceColor.r + as * ab * blended.r) / alphaOut,
    g: ((1 - as) * ab * backdropColor.g + as * (1 - ab) * sourceColor.g + as * ab * blended.g) / alphaOut,
    b: ((1 - as) * ab * backdropColor.b + as * (1 - ab) * sourceColor.b + as * ab * blended.b) / alphaOut,
  };
  return { color, alpha: alphaOut };
}

// ---------------------------------------------------------------------------
// Non-separable component modes (PDF 1.7 7.2.4).
// ---------------------------------------------------------------------------

export function luminosity(c: Rgb): number {
  return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
}

function clipColor(c: Rgb): Rgb {
  const l = luminosity(c);
  const n = Math.min(c.r, c.g, c.b);
  const x = Math.max(c.r, c.g, c.b);
  let { r, g, b } = c;
  if (n < 0) {
    r = l + (r - l) * l / (l - n);
    g = l + (g - l) * l / (l - n);
    b = l + (b - l) * l / (l - n);
  }
  if (x > 1) {
    r = l + (r - l) * (1 - l) / (x - l);
    g = l + (g - l) * (1 - l) / (x - l);
    b = l + (b - l) * (1 - l) / (x - l);
  }
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

function setLum(c: Rgb, l: number): Rgb {
  const d = l - luminosity(c);
  return clipColor({ r: c.r + d, g: c.g + d, b: c.b + d });
}

function saturation(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
}

function setSat(c: Rgb, s: number): Rgb {
  const entries: Array<[number, 'r' | 'g' | 'b']> = [
    [c.r, 'r'], [c.g, 'g'], [c.b, 'b'],
  ];
  entries.sort((left, right) => left[0] - right[0]);
  const [, minKey] = entries[0]!;
  const [, midKey] = entries[1]!;
  const [, maxKey] = entries[2]!;
  const out: Rgb = { r: c.r, g: c.g, b: c.b };
  if (entries[2]![0] > entries[0]![0]) {
    out[midKey] = (entries[1]![0] - entries[0]![0]) * s / (entries[2]![0] - entries[0]![0]);
    out[maxKey] = s;
  } else {
    out[midKey] = 0;
    out[maxKey] = 0;
  }
  out[minKey] = 0;
  return out;
}

export function componentBlend(mode: ComponentBlendMode, backdrop: Rgb, source: Rgb): Rgb {
  switch (mode) {
    case 'hue': return setLum(setSat(source, saturation(backdrop)), luminosity(backdrop));
    case 'saturation': return setLum(setSat(backdrop, saturation(source)), luminosity(backdrop));
    case 'color': return setLum(source, luminosity(backdrop));
    case 'luminosity': return setLum(backdrop, luminosity(source));
  }
}

/**
 * Composite an RGBA straight-alpha pixel pair at 8-bit precision with the
 * same equation as the float path. Used by the parity harness and later by
 * A3's u8 display derivative; inputs/outputs are 0..255 integers.
 */
export function blendRgba8(
  mode: BlendMode,
  backdrop: { r: number; g: number; b: number; a: number },
  source: { r: number; g: number; b: number; a: number },
): { r: number; g: number; b: number; a: number } {
  const round = (value: number): number => Math.round(clamp01(value) * 255);
  const result = blendRgb(
    mode,
    { r: backdrop.r / 255, g: backdrop.g / 255, b: backdrop.b / 255 },
    { r: source.r / 255, g: source.g / 255, b: source.b / 255 },
    backdrop.a / 255,
    source.a / 255,
  );
  return {
    r: round(result.color.r),
    g: round(result.color.g),
    b: round(result.color.b),
    a: round(result.alpha),
  };
}
