// Paper-grade text typesetting for Video text/comic clips, in the px/percent units of
// `EditorTextTypography` (src/types/flow.ts) rather than Paper's mm/pt (src/types/paper.ts,
// src/lib/paperTextFlow.ts). Framework-free and measurement-agnostic like `flowPaperText` — the
// caller injects a measurer (a real canvas measurer in the app, a deterministic fake in tests).
//
// REUSE STRATEGY: `flowPaperText` is reused for what it already does well — tokenizing text into
// words/paragraph-breaks and greedily packing them into a column via the injected measurer. It is
// NOT reused for alignment: `flowPaperText`'s `alignLineX` has no `justify` branch, and its per-line
// x is relative to a caller-supplied box, which doesn't fit the common "auto-width title card" case
// (no real box — the box IS the content, sized to the widest line). So this module calls
// `flowPaperText` with an effectively-unbounded column when no `maxWidthPx` is given (so it only
// breaks on explicit "\n", matching a free-floating title/caption), reads back the wrapped line
// strings + natural widths, and re-derives alignment (including justify word-gap stretch) itself in
// px against the real content width (the box width when bounded, else the widest natural line).
//
// A unit bridge makes the mm/pt engine carry raw px values without lossy conversion: `flowPaperText`
// only ever converts `leadingPt`/`fontSizePt*1.2` through its internal `ptToMm` (mm = pt * 25.4/72);
// every other field (column x/y/width/height, the measured widths returned by the injected
// measurer) passes straight through unconverted. By (a) always supplying an explicit `leadingPt`
// pre-scaled by `PX_TO_PT` so `ptToMm` yields back our desired px leading, and (b) never relying on
// the `fontSizePt*1.2` fallback, every other "mm" value in this module IS a px value — no separate
// unit ever leaks out through the public API.
//
// Arc/curved text (`arcPercent`) isn't a layout concern for `flowPaperText` (wrapping is unaffected)
// — it's a per-glyph placement concern applied at render time, so it's a separate pure function,
// `computeArcTextGlyphs`, called by the renderer once per already-wrapped line.

import { flowPaperText, type PaperTextFlowTypeSpec, type PaperTextMeasurer } from './paperTextFlow';
import { formatFontFamily } from './formatFontFamily';
import { bundledFontFaceRuntimeFamilyName } from './bundledFontLibrary';
import type { ManagedBundledFontFaceIssue, ManagedBundledFontFaceReference } from '../types/managedFont';

/** Resolved font description a measurer needs — mirrors the subset of canvas `font` + tracking. */
export interface VideoTextFont {
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  fontStretchPercent?: number;
  fontKerning: 'auto' | 'normal' | 'none';
  letterSpacingPx: number;
}

/** Width in px of a rendered text fragment at the given font (including any letter-spacing). */
export type VideoTextMeasurer = (text: string, font: VideoTextFont) => number;

export type VideoTextAlign = 'left' | 'center' | 'right' | 'justify';

/** The layout-relevant subset of `EditorTextTypography` (stroke/shadow/arc are paint-time concerns,
 *  applied by the renderer after layout — see `computeArcTextGlyphs` for arc). */
export interface VideoTextTypesetting {
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
  fontKerning?: 'auto' | 'normal' | 'none';
  lineHeightPercent?: number;
  letterSpacingPx?: number;
  textAlign?: VideoTextAlign;
}

export interface VideoTextLayoutOptions {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  typography?: VideoTextTypesetting;
  /** Wrap width in px. Omit (or non-finite/<=0) for auto-width: text only breaks on explicit "\n",
   *  and the content box is sized to the widest resulting line (a free-floating title/caption).
   *  Provide a finite value for a real text box (e.g. a comic bubble body) that should word-wrap. */
  maxWidthPx?: number;
}

export interface VideoTextLayoutWord {
  text: string;
  /** x offset from the line's own left edge (0 = `xPx` of the owning line). */
  xPx: number;
  widthPx: number;
}

export interface VideoTextLayoutLine {
  text: string;
  /** Left edge of the line's text, already aligned within the content box. */
  xPx: number;
  /** Top of the line within the content box (0 = first line's top). */
  yPx: number;
  /** Natural (unjustified) width of the line's text. */
  widthPx: number;
  /** Present only for a justified line with 2+ words: per-word x offsets (relative to `xPx`, i.e.
   *  relative to the line's own left edge, which is 0 for justified lines) that stretch the line to
   *  fill the content width. Absent lines should be drawn as a single run at `xPx`. */
  words?: VideoTextLayoutWord[];
  isLastLine: boolean;
}

export interface VideoTextLayoutResult {
  lines: VideoTextLayoutLine[];
  lineHeightPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  fontKerning: 'auto' | 'normal' | 'none';
  fontStretchPercent: number;
  letterSpacingPx: number;
  textAlign: VideoTextAlign;
}

export interface VideoTextArcGlyph {
  char: string;
  /** x offset from the line's horizontal center. */
  xPx: number;
  /** y offset from the line's own baseline (0 = the center glyph's baseline). */
  yPx: number;
  rotationDeg: number;
}

const PT_TO_MM = 25.4 / 72;
/** Inverse of `flowPaperText`'s internal `ptToMm` — pre-scaling a px value by this factor makes
 *  `ptToMm(value)` yield that px value back unchanged (see module doc "unit bridge"). */
const PX_TO_PT = 1 / PT_TO_MM;
/** Large-but-finite stand-in for "no boundary", so an unbounded layout only breaks on explicit "\n"
 *  (a single word wider than this would still wrap, but no real caption approaches this width). */
const UNBOUNDED_EXTENT_PX = 1_000_000;

const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FONT_STYLE: 'normal' | 'italic' = 'normal';
const DEFAULT_FONT_KERNING: 'auto' | 'normal' | 'none' = 'auto';
const DEFAULT_LINE_HEIGHT_PERCENT = 120;
const DEFAULT_LETTER_SPACING_PX = 0;
const DEFAULT_TEXT_ALIGN: VideoTextAlign = 'center';

/** Curvature range for `arcPercent` ±100 — kept well under a half-circle so curved text stays
 *  legible (glyphs never rotate past readable, and don't overlap at the ends). */
const MAX_ARC_SWEEP_RADIANS = Math.PI * 0.6;

function resolveTypesetting(typography: VideoTextTypesetting | undefined): {
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  fontStretchPercent: number;
  fontKerning: 'auto' | 'normal' | 'none';
  lineHeightPercent: number;
  letterSpacingPx: number;
  textAlign: VideoTextAlign;
} {
  return {
    fontWeight: typography?.managedFace?.weight ?? typography?.fontWeight ?? DEFAULT_FONT_WEIGHT,
    fontStyle: typography?.managedFace?.style ?? typography?.fontStyle ?? DEFAULT_FONT_STYLE,
    fontStretchPercent: typography?.managedFace?.stretchPercent ?? 100,
    fontKerning: typography?.fontKerning ?? DEFAULT_FONT_KERNING,
    lineHeightPercent: typography?.lineHeightPercent ?? DEFAULT_LINE_HEIGHT_PERCENT,
    letterSpacingPx: typography?.letterSpacingPx ?? DEFAULT_LETTER_SPACING_PX,
    textAlign: typography?.textAlign ?? DEFAULT_TEXT_ALIGN,
  };
}

/**
 * Lays out text (line-breaking, leading, tracking, alignment incl. justify) in px, reusing
 * `flowPaperText` for tokenizing/greedy-fill wrap. Pure — the measurer is injected. See the module
 * doc for why alignment is re-derived here rather than taken from `flowPaperText` directly.
 */
export function layoutVideoText(
  options: VideoTextLayoutOptions,
  measure: VideoTextMeasurer,
): VideoTextLayoutResult {
  if (options.typography?.managedFaceIssue) {
    throw new Error(`${options.typography.managedFaceIssue.message} Video text measurement is blocked.`);
  }
  const { fontWeight, fontStyle, fontKerning, fontStretchPercent, lineHeightPercent, letterSpacingPx, textAlign } = resolveTypesetting(options.typography);
  const fontSizePx = Math.max(1, options.fontSizePx);
  const lineHeightPx = fontSizePx * (lineHeightPercent / 100);
  const font: VideoTextFont = {
    fontFamily: options.typography?.managedFace
      ? bundledFontFaceRuntimeFamilyName(options.typography.managedFace)
      : options.fontFamily,
    fontSizePx,
    fontWeight,
    fontStyle,
    fontStretchPercent,
    fontKerning,
    letterSpacingPx,
  };

  const bounded = typeof options.maxWidthPx === 'number' && Number.isFinite(options.maxWidthPx) && options.maxWidthPx > 0;
  const wrapWidthPx = bounded ? (options.maxWidthPx as number) : UNBOUNDED_EXTENT_PX;

  const spec: PaperTextFlowTypeSpec = {
    fontFamily: font.fontFamily,
    // Unit bridge: carries a raw px value straight through (see module doc). Never scaled unless
    // the `leadingPt<=0` fallback fires, which it never does here (we always pass an explicit,
    // positive `leadingPt`).
    fontSizePt: fontSizePx,
    leadingPt: lineHeightPx * PX_TO_PT,
    tracking: letterSpacingPx,
    // Alignment is recomputed below against the true content width; `flowPaperText` only needs a
    // left-anchored box to report natural line widths.
    align: 'left',
    fontWeight: String(fontWeight),
    fontStyle,
  };

  const paperMeasure: PaperTextMeasurer = (text) => measure(text, font);

  const result = flowPaperText(
    options.text ?? '',
    spec,
    [{
      id: 'video-text',
      columns: [{ xMm: 0, yMm: 0, widthMm: wrapWidthPx, heightMm: UNBOUNDED_EXTENT_PX }],
    }],
    paperMeasure,
  );

  const rawLines = result.frames[0]?.lines ?? [];
  const contentWidthPx = bounded
    ? wrapWidthPx
    : rawLines.reduce((max, line) => Math.max(max, line.widthMm), 0);
  const lastIndex = rawLines.length - 1;

  const lines: VideoTextLayoutLine[] = rawLines.map((line, index) => {
    const isLastLine = index === lastIndex;
    const yPx = index * lineHeightPx;

    if (textAlign === 'justify' && bounded && !isLastLine) {
      const words = line.text.split(' ').filter((word) => word.length > 0);

      if (words.length > 1) {
        const wordWidths = words.map((word) => measure(word, font));
        const wordsWidthPx = wordWidths.reduce((sum, width) => sum + width, 0);
        const gapPx = (contentWidthPx - wordsWidthPx) / (words.length - 1);
        let cursor = 0;
        const wordLayout: VideoTextLayoutWord[] = words.map((word, wordIndex) => {
          const widthPx = wordWidths[wordIndex];
          const entry: VideoTextLayoutWord = { text: word, xPx: cursor, widthPx };
          cursor += widthPx + gapPx;
          return entry;
        });

        return {
          text: line.text,
          xPx: 0,
          yPx,
          widthPx: contentWidthPx,
          words: wordLayout,
          isLastLine,
        };
      }
    }

    const naturalWidthPx = line.widthMm;
    const xPx = textAlign === 'right'
      ? contentWidthPx - naturalWidthPx
      : textAlign === 'center'
        ? (contentWidthPx - naturalWidthPx) / 2
        : 0; // left, and justify's single-word/last-line fallback

    return { text: line.text, xPx, yPx, widthPx: naturalWidthPx, isLastLine };
  });

  return {
    lines,
    lineHeightPx,
    contentWidthPx,
    contentHeightPx: lines.length > 0 ? lines.length * lineHeightPx : 0,
    fontWeight,
    fontStyle,
    fontStretchPercent,
    fontKerning,
    letterSpacingPx,
    textAlign,
  };
}

/**
 * Per-character glyph placement for arc/curved text (`EditorTextTypography.arcPercent`, -100..100).
 * Positive bows the middle of the text higher than its ends (as if following the top of a circle);
 * negative bows the middle lower than its ends. 0 (or a near-zero sweep) returns a straight run
 * (all `yPx`/`rotationDeg` 0) so callers can use this unconditionally without branching on arcPercent.
 * Pure — `measureChar` is injected (typically per-character calls into the same canvas measurer used
 * for layout).
 */
export function computeArcTextGlyphs(
  text: string,
  totalWidthPx: number,
  arcPercent: number | undefined,
  measureChar: (char: string) => number,
): VideoTextArcGlyph[] {
  const chars = Array.from(text);
  if (chars.length === 0) {
    return [];
  }

  const widths = chars.map((char) => Math.max(0, measureChar(char)));
  const naturalWidthPx = widths.reduce((sum, width) => sum + width, 0);
  const widthPx = totalWidthPx > 0 ? totalWidthPx : naturalWidthPx;

  const clampedPercent = Math.max(-100, Math.min(100, arcPercent ?? 0));
  const sweep = (Math.abs(clampedPercent) / 100) * MAX_ARC_SWEEP_RADIANS;
  const direction = clampedPercent >= 0 ? 1 : -1;

  if (sweep < 1e-6 || widthPx <= 0) {
    let cursor = -widthPx / 2;
    return chars.map((char, index) => {
      const charWidth = widths[index];
      const glyph: VideoTextArcGlyph = { char, xPx: cursor + charWidth / 2, yPx: 0, rotationDeg: 0 };
      cursor += charWidth;
      return glyph;
    });
  }

  const radius = widthPx / sweep;
  let cursor = 0;

  return chars.map((char, index) => {
    const charWidth = widths[index];
    const centerOffsetPx = cursor + charWidth / 2;
    cursor += charWidth;
    const t = (centerOffsetPx / widthPx) * 2 - 1; // -1..1, 0 = text center
    const phi = (t * sweep) / 2;

    return {
      char,
      xPx: radius * Math.sin(phi),
      yPx: direction * radius * (1 - Math.cos(phi)),
      rotationDeg: (direction * phi * 180) / Math.PI,
    };
  });
}

/**
 * A `VideoTextMeasurer` backed by a shared 2D canvas context, in native px (unlike Paper's
 * `createPaperCanvasMeasurer`, which returns mm). Honors letter-spacing via the modern
 * `CanvasRenderingContext2D.letterSpacing` when available, else adds it manually. Falls back to a
 * rough average-character estimate where no canvas is available (headless / SSR), matching Paper's
 * measurer fallback strategy.
 */
export function createVideoTextCanvasMeasurer(): VideoTextMeasurer {
  let context: CanvasRenderingContext2D | null | undefined;

  const getContext = (): CanvasRenderingContext2D | null => {
    if (context !== undefined) {
      return context;
    }
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    return context;
  };

  return (text, font) => {
    const trackingPx = Math.max(0, text.length - 1) * font.letterSpacingPx;
    const ctx = getContext();

    if (!ctx) {
      return text.length * font.fontSizePx * 0.5 + trackingPx;
    }

    const stylePrefix = font.fontStyle === 'normal' ? '' : `${font.fontStyle} `;
    ctx.font = `${stylePrefix}${font.fontWeight} ${font.fontSizePx}px ${formatFontFamily(font.fontFamily)}`;
    ctx.fontKerning = font.fontKerning;
    if ('fontStretch' in ctx) {
      (ctx as unknown as { fontStretch: string }).fontStretch = resolveVideoCanvasFontStretch(font.fontStretchPercent);
    }

    // Cast onto a type that genuinely declares the (newer, not-yet-in-lib.dom) `letterSpacing`
    // property as optional, rather than narrowing the strictly-typed `ctx` via `'x' in ctx` — the
    // latter trips a TS control-flow quirk (narrows the post-if type to `never`) when the checked
    // property doesn't exist on the declared type at all.
    const ctxWithLetterSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if (typeof ctxWithLetterSpacing.letterSpacing === 'string') {
      ctxWithLetterSpacing.letterSpacing = `${font.letterSpacingPx}px`;
      return ctx.measureText(text).width;
    }

    return ctx.measureText(text).width + trackingPx;
  };
}

export function resolveVideoCanvasFontStretch(percent = 100): string {
  const value = Number.isFinite(percent) ? percent : 100;
  if (value < 56.25) return 'ultra-condensed';
  if (value < 68.75) return 'extra-condensed';
  if (value < 81.25) return 'condensed';
  if (value < 93.75) return 'semi-condensed';
  if (value < 106.25) return 'normal';
  if (value < 118.75) return 'semi-expanded';
  if (value < 137.5) return 'expanded';
  if (value < 175) return 'extra-expanded';
  return 'ultra-expanded';
}
