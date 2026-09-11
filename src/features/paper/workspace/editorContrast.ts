/**
 * Pure colour-contrast helpers for the in-canvas text-edit surface (the contentEditable overlay used by
 * `PaperEditableText` / `PaperRichEditableText` / `PaperBubbleText`'s editing branch in PaperWorkspace.tsx).
 *
 * Root cause this exists to fix: the editing surface used to paint a hardcoded near-opaque white box behind
 * the caret regardless of the frame's own colours. A frame styled with light typography (e.g. white sidebar
 * text on a transparent fill) went invisible while editing — white text on a white editing box. The editor
 * now defaults to a transparent surface (so it shows the frame's real, already-composited fill/page colour
 * underneath), and only when that real pairing is too low-contrast to read does it fall back to a computed
 * ink/paper backdrop. This module is the pure decision logic for that fallback — no DOM, no React, no
 * document mutation. It never changes the document's actual colours; it only decides what the *editor chrome*
 * should look like while typing.
 */

/** WCAG "large text" contrast floor. The editor renders at a comfortably large size, so this — not the
 *  stricter 4.5:1 body-text minimum — is the readability bar used to decide when a backdrop is needed. */
export const EDITOR_READABLE_CONTRAST_RATIO = 3;

/** Backdrop painted behind light text. Matches the document's own default ink colour (see
 *  DEFAULT_PAPER_TYPOGRAPHY.color in src/lib/paperDocument.ts) so it reads as "paper UI", not an alien colour. */
export const EDITOR_INK_BACKDROP = '#111827';

/** Backdrop painted behind dark text. Matches the document's own default page colour (see
 *  DEFAULT_PAPER_BACKGROUND.color in src/lib/paperDocument.ts). */
export const EDITOR_PAPER_BACKDROP = '#ffffff';

export interface EditorBackdropInput {
  /** The frame's effective text colour (frame.typography.color). */
  textColor: string;
  /** The frame's own fill colour (frame.fillColor) — may be the literal string 'transparent'. */
  fillColor: string;
  /** The frame's fill opacity (frame.fillOpacity), 0..1. */
  fillOpacity: number;
  /** The page/document background colour the frame sits on (doc.background, resolved to CSS). */
  pageBackground: string;
}

export interface EditorBackdropDecision {
  /** frame.fillColor at fillOpacity, composited over pageBackground — what the editor shows with no backdrop. */
  effectiveBackground: string;
  /** WCAG contrast ratio (1..21) between textColor and effectiveBackground. */
  contrastRatio: number;
  /** True when contrastRatio is below the readability floor and the editor needs its own backdrop. */
  needsBackdrop: boolean;
  /** The colour to paint behind the text when needsBackdrop is true; undefined otherwise. */
  backdropColor?: string;
}

interface Rgba { r: number; g: number; b: number; a: number }

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Parse a CSS colour string down to RGBA. Handles the shapes this app actually produces (#rrggbb, #rgb,
 * rgb()/rgba(), and the literal 'transparent'). Anything else (a named CSS colour, a gradient string like
 * `linear-gradient(...)` from paperDocumentBackgroundCss) falls back to an opaque mid-grey — that keeps the
 * contrast maths finite and roughly conservative rather than throwing or silently mis-scoring a real colour.
 */
function parseCssColor(color: string): Rgba {
  const trimmed = color.trim();
  if (trimmed.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex6 = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex6) {
    const n = Number.parseInt(hex6[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }

  const hex3 = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (hex3) {
    const [rHex, gHex, bHex] = hex3[1].split('');
    return {
      r: Number.parseInt(rHex + rHex, 16),
      g: Number.parseInt(gHex + gHex, 16),
      b: Number.parseInt(bHex + bHex, 16),
      a: 1,
    };
  }

  const rgbFn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(trimmed);
  if (rgbFn) {
    return {
      r: clamp01(Number(rgbFn[1]) / 255) * 255,
      g: clamp01(Number(rgbFn[2]) / 255) * 255,
      b: clamp01(Number(rgbFn[3]) / 255) * 255,
      a: rgbFn[4] !== undefined ? clamp01(Number(rgbFn[4])) : 1,
    };
  }

  return { r: 128, g: 128, b: 128, a: 1 };
}

function toRgbString({ r, g, b }: Rgba): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Composite `fillColor` at `fillOpacity` over `pageBackground` (assumed opaque) and return a solid CSS colour.
 * This mirrors what the browser already does for real when the editor surface is transparent (the frame's fill
 * paints over the page background naturally); it exists here so the *contrast decision* can be made without a
 * DOM to measure.
 */
export function compositeEffectiveBackground(fillColor: string, fillOpacity: number, pageBackground: string): string {
  const fill = parseCssColor(fillColor);
  const alpha = clamp01(fill.a * clamp01(fillOpacity));
  if (alpha <= 0) return pageBackground;
  if (alpha >= 1) return fillColor;
  const base = parseCssColor(pageBackground);
  return toRgbString({
    r: fill.r * alpha + base.r * (1 - alpha),
    g: fill.g * alpha + base.g * (1 - alpha),
    b: fill.b * alpha + base.b * (1 - alpha),
    a: 1,
  });
}

function srgbChannelToLinear(channel255: number): number {
  const c = clamp01(channel255 / 255);
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black, 1 = white) for a CSS colour string. Alpha is ignored — callers are
 *  expected to pass already-composited-to-opaque colours (see compositeEffectiveBackground). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseCssColor(color);
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

/** WCAG contrast ratio (1..21) between two CSS colours. */
export function contrastRatio(colorA: string, colorB: string): number {
  const lumA = relativeLuminance(colorA);
  const lumB = relativeLuminance(colorB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Decide whether the in-canvas text-edit surface needs a backdrop of its own to stay readable, given the
 * frame's real, effective colours. Never mutates or reports document colours — this is editor-chrome-only
 * decision logic; the caller is responsible for only ever applying the result to the transient editing overlay.
 */
export function resolveEditorBackdrop(input: EditorBackdropInput): EditorBackdropDecision {
  const effectiveBackground = compositeEffectiveBackground(input.fillColor, input.fillOpacity, input.pageBackground);
  const ratio = contrastRatio(input.textColor, effectiveBackground);

  if (ratio >= EDITOR_READABLE_CONTRAST_RATIO) {
    return { effectiveBackground, contrastRatio: ratio, needsBackdrop: false };
  }

  // Low contrast: fall back to whichever canonical backdrop actually reads better against this exact text
  // colour. In the overwhelming majority of cases that resolves to "dark ink behind light text, light paper
  // behind dark text" — but measuring both candidates (rather than assuming from textColor's luminance alone)
  // keeps odd mid-tone/saturated colours (e.g. a mid-brightness amber) readable too.
  const contrastWithInk = contrastRatio(input.textColor, EDITOR_INK_BACKDROP);
  const contrastWithPaper = contrastRatio(input.textColor, EDITOR_PAPER_BACKDROP);
  const backdropColor = contrastWithInk >= contrastWithPaper ? EDITOR_INK_BACKDROP : EDITOR_PAPER_BACKDROP;

  return { effectiveBackground, contrastRatio: ratio, needsBackdrop: true, backdropColor };
}
