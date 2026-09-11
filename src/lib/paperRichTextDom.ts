import type { PaperManagedFontFace, PaperParagraphBorderEdge, PaperParagraphBorders, PaperRichParagraph, PaperTextRun, PaperTypography } from '../types/paper';
import {
  effectivePaperRunTypography,
  PAPER_MANAGED_FONT_BLOCKED_FAMILY,
  paperFontObliqueAngleFromCss,
  paperFontStretchFromCss,
  paperFontStyleDescriptor,
  paperFontStyleFromCss,
  paperManagedFontFamilyAlias,
  paperManagedFontFamilyForLivePaint,
} from './paperExactManagedFonts';
import { paperFontVariationSettingsEqual } from './paperManagedFonts';
import { normalizePaperRichText } from './paperRichText';

const MM_TO_PX = 3.7795;

// Bridge between Paper's rich-text model and a contentEditable DOM. `richTextToEditorHtml` builds the initial
// editor markup (pure/testable); `serializeRichEditor` reads an edited contentEditable back into runs using
// computed styles (browser-only). The editor is UNCONTROLLED — set innerHTML once, serialise on commit — so
// React never fights the user's caret.

const PT_TO_PX = 1.333;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Canonical CSS text for exact variable-font coordinates ("normal" when empty). */
export function paperFontVariationSettingsToCss(value: Record<string, number> | undefined): string {
  const entries = Object.entries(value ?? {}).filter(([tag, coordinate]) => /^[ -~]{4}$/.test(tag) && Number.isFinite(coordinate));
  if (!entries.length) return 'normal';
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, coordinate]) => `"${tag}" ${coordinate}`)
    .join(', ');
}

/** Parse a computed/inline font-variation-settings value back into exact coordinates. */
export function paperFontVariationSettingsFromCss(value: string | null | undefined): Record<string, number> | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'normal') return undefined;
  const output: Record<string, number> = {};
  for (const match of trimmed.matchAll(/["']([ -~]{4})["']\s+(-?(?:\d+(?:\.\d+)?|\.\d+))/g)) {
    output[match[1]] = Number(match[2]);
  }
  return Object.keys(output).length ? output : undefined;
}

/** Inline CSS for one run — only the properties it overrides (the editor container carries the defaults). */
export function runInlineCss(run: PaperTextRun, zoom: number): string {
  const parts: string[] = [];
  if (run.fontFamily) parts.push(`font-family:${run.fontFamily}`);
  if (run.fontWeight) parts.push(`font-weight:${run.fontWeight}`);
  if (run.fontStyle) parts.push(`font-style:${run.fontStyle}`);
  if (run.fontStretch) parts.push(`font-stretch:${run.fontStretch}`);
  if (run.fontVariationSettings) parts.push(`font-variation-settings:${paperFontVariationSettingsToCss(run.fontVariationSettings)}`);
  if (run.fontKerning) parts.push(`font-kerning:${run.fontKerning}`);
  if (run.color) parts.push(`color:${run.color}`);
  if (run.highlight) parts.push(`background-color:${run.highlight}`);
  if (run.tracking != null) parts.push(`letter-spacing:${run.tracking / 1000}em`);
  if (run.smallCaps) parts.push('font-variant-caps:small-caps');
  if (run.numericStyle === 'oldstyle') parts.push('font-variant-numeric:oldstyle-nums');
  if (run.numericStyle === 'lining') parts.push('font-variant-numeric:lining-nums');
  if (run.numericStyle === 'tabular') parts.push('font-variant-numeric:tabular-nums');
  if (run.textOrientation) parts.push(`text-orientation:${run.textOrientation}`);
  if (run.emphasis === 'dot') parts.push('text-emphasis:filled dot');
  if (run.emphasis === 'open-dot') parts.push('text-emphasis:open dot');
  if (run.emphasis === 'sesame') parts.push('text-emphasis:filled sesame');
  if (run.emphasis === 'circle') parts.push('text-emphasis:filled circle');
  if (run.emphasis === 'none') parts.push('text-emphasis:none');
  if (run.leadingPt != null) parts.push(`line-height:${(run.leadingPt * PT_TO_PX * zoom).toFixed(2)}px`);
  const decorations: string[] = [];
  if (run.underline) decorations.push('underline');
  if (run.strike) decorations.push('line-through');
  if (decorations.length) parts.push(`text-decoration:${decorations.join(' ')}`);
  if (run.vertAlign === 'super' || run.vertAlign === 'sub') {
    parts.push(`vertical-align:${run.vertAlign}`);
    parts.push(`font-size:${run.fontSizePt ? `${(run.fontSizePt * PT_TO_PX * zoom).toFixed(2)}px` : '0.7em'}`);
  } else if (run.fontSizePt) {
    parts.push(`font-size:${(run.fontSizePt * PT_TO_PX * zoom).toFixed(2)}px`);
  }
  return parts.join(';');
}

function borderEdgeCss(edge: PaperParagraphBorderEdge | undefined, zoom: number): string | undefined {
  return edge ? `${(edge.widthPt * PT_TO_PX * zoom).toFixed(2)}px solid ${edge.color}` : undefined;
}

function paragraphInlineCss(paragraph: PaperRichParagraph, zoom: number, richParagraphGapPt = 0): string {
  const parts: string[] = [];
  if (paragraph.align) parts.push(`text-align:${paragraph.align}`);
  if (paragraph.alignLast) parts.push(`text-align-last:${paragraph.alignLast}`);
  if (paragraph.leadingPt != null) parts.push(`line-height:${(paragraph.leadingPt * PT_TO_PX * zoom).toFixed(2)}px`);
  if (paragraph.hyphenate != null) parts.push(`hyphens:${paragraph.hyphenate ? 'auto' : 'manual'}`);
  if (paragraph.lineBreak && paragraph.lineBreak !== 'auto') parts.push(`text-wrap-style:${paragraph.lineBreak}`);
  if (paragraph.lineBreakStrict != null) parts.push(`line-break:${paragraph.lineBreakStrict ? 'strict' : 'auto'}`);
  if (paragraph.spaceBeforeMm) parts.push(`margin-top:${(paragraph.spaceBeforeMm * MM_TO_PX * zoom).toFixed(2)}px`);
  const spaceAfterPx = (paragraph.spaceAfterMm ?? 0) * MM_TO_PX * zoom + richParagraphGapPt * PT_TO_PX * zoom;
  if (spaceAfterPx) parts.push(`margin-bottom:${spaceAfterPx.toFixed(2)}px`);
  const leftPx = Math.max(0, paragraph.leftIndentMm ?? 0) * MM_TO_PX * zoom;
  const rightPx = Math.max(0, paragraph.rightIndentMm ?? 0) * MM_TO_PX * zoom;
  const hangPx = Math.max(0, paragraph.hangingIndentMm ?? 0) * MM_TO_PX * zoom;
  const borderPad = paragraph.borders?.paddingPt ? paragraph.borders.paddingPt * PT_TO_PX * zoom : paragraph.borders ? 2 * zoom : 0;
  if (paragraph.listMarker) {
    const pad = 4.5 * MM_TO_PX * zoom;
    parts.push(`padding-left:${(leftPx + pad + borderPad).toFixed(2)}px`, `text-indent:-${pad.toFixed(2)}px`);
  } else if (hangPx > 0) {
    parts.push(`padding-left:${(leftPx + borderPad).toFixed(2)}px`, `text-indent:-${hangPx.toFixed(2)}px`);
  } else {
    if (leftPx || borderPad) parts.push(`padding-left:${(leftPx + borderPad).toFixed(2)}px`);
    if (paragraph.firstLineIndentMm) parts.push(`text-indent:${(paragraph.firstLineIndentMm * MM_TO_PX * zoom).toFixed(2)}px each-line`);
  }
  if (borderPad || rightPx) parts.push(`padding-right:${(borderPad + rightPx).toFixed(2)}px`);
  if (borderPad) parts.push(`padding-top:${borderPad.toFixed(2)}px`, `padding-bottom:${borderPad.toFixed(2)}px`);
  if (paragraph.shading) parts.push(`background-color:${paragraph.shading}`);
  const b = paragraph.borders;
  if (b?.top) parts.push(`border-top:${borderEdgeCss(b.top, zoom)}`);
  if (b?.left) parts.push(`border-left:${borderEdgeCss(b.left, zoom)}`);
  if (b?.bottom) parts.push(`border-bottom:${borderEdgeCss(b.bottom, zoom)}`);
  if (b?.right) parts.push(`border-right:${borderEdgeCss(b.right, zoom)}`);
  return parts.join(';');
}

/** Paragraph-level attributes encoded as `data-*` on the block so an edit round-trips them (computed style
 * only carries run styling; align/indent/spacing/dropcap/shading/borders would otherwise be lost). */
function paragraphDataAttrs(paragraph: PaperRichParagraph): string {
  const attrs: string[] = [];
  const push = (key: string, value: string | number | undefined): void => {
    if (value !== undefined && value !== '') attrs.push(`data-${key}="${escapeHtml(String(value))}"`);
  };
  push('align', paragraph.align);
  push('al', paragraph.alignLast);
  push('lead', paragraph.leadingPt);
  if (paragraph.hyphenate != null) push('hyph', paragraph.hyphenate ? '1' : '0');
  push('lb', paragraph.lineBreak);
  if (paragraph.lineBreakStrict != null) push('lbs', paragraph.lineBreakStrict ? '1' : '0');
  push('sb', paragraph.spaceBeforeMm);
  push('sa', paragraph.spaceAfterMm);
  push('fi', paragraph.firstLineIndentMm);
  push('li', paragraph.leftIndentMm);
  push('ri', paragraph.rightIndentMm);
  push('hi', paragraph.hangingIndentMm);
  push('dc', paragraph.dropCapLines);
  push('shade', paragraph.shading);
  if (paragraph.borders) push('borders', JSON.stringify(paragraph.borders));
  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

/** Read paragraph-level attributes back off a block element's `data-*` set (the inverse of paragraphDataAttrs). */
function paragraphAttrsFromElement(el: HTMLElement): Partial<PaperRichParagraph> {
  const d = el.dataset;
  const p: Partial<PaperRichParagraph> = {};
  const num = (value: string | undefined): number | undefined => {
    if (value == null) return undefined;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  };
  if (d.align === 'left' || d.align === 'center' || d.align === 'right' || d.align === 'justify') p.align = d.align;
  if (d.al === 'auto' || d.al === 'left' || d.al === 'center' || d.al === 'right' || d.al === 'justify') p.alignLast = d.al;
  const lead = num(d.lead); if (lead != null) p.leadingPt = lead;
  if (d.hyph === '1' || d.hyph === '0') p.hyphenate = d.hyph === '1';
  if (d.lb === 'auto' || d.lb === 'balance' || d.lb === 'pretty') p.lineBreak = d.lb;
  if (d.lbs === '1' || d.lbs === '0') p.lineBreakStrict = d.lbs === '1';
  const sb = num(d.sb); if (sb != null) p.spaceBeforeMm = sb;
  const sa = num(d.sa); if (sa != null) p.spaceAfterMm = sa;
  const fi = num(d.fi); if (fi != null) p.firstLineIndentMm = fi;
  const li = num(d.li); if (li != null) p.leftIndentMm = li;
  const ri = num(d.ri); if (ri != null) p.rightIndentMm = ri;
  const hi = num(d.hi); if (hi != null) p.hangingIndentMm = hi;
  const dc = num(d.dc); if (dc != null) p.dropCapLines = dc;
  if (d.shade) p.shading = d.shade;
  if (d.borders) {
    try {
      const parsed = JSON.parse(d.borders) as PaperParagraphBorders;
      if (parsed && typeof parsed === 'object') p.borders = parsed;
    } catch {
      // ignore malformed borders JSON
    }
  }
  return p;
}

export interface RichEditorManagedPaintContext {
  /** Frame typography the runs inherit from, so per-run exact faces resolve with the correct descriptor. */
  typography: PaperTypography;
  /** Document managed faces; a managed run paints its VERIFIED alias (or the blocked family), never the human name. */
  managedFonts: readonly PaperManagedFontFace[] | undefined;
}

/**
 * Editor paint identity for an effective typography whose family is managed: the CSS family to paint is the
 * registered exact alias (or the blocked sentinel), while `data-paper-font-family` keeps the durable human
 * family and `data-paper-font-style` keeps an authored oblique descriptor that computed styles cannot
 * round-trip in every engine. Returns undefined when the effective family is not managed.
 */
export function managedEditorPaintForTypography(
  effective: PaperTypography,
  managedFonts: readonly PaperManagedFontFace[] | undefined,
): { paintFamily: string; sourceFamily: string } | undefined {
  if (!managedFonts?.length) return undefined;
  const paintFamily = paperManagedFontFamilyForLivePaint(effective, managedFonts);
  if (!paintFamily) return undefined;
  return { paintFamily, sourceFamily: effective.fontFamily };
}

function managedRunEditorPaint(run: PaperTextRun, context: RichEditorManagedPaintContext | undefined): { paintFamily: string; sourceFamily: string } | undefined {
  if (!context) return undefined;
  return managedEditorPaintForTypography(effectivePaperRunTypography(context.typography, run), context.managedFonts);
}

function authoredObliqueDescriptor(fontStyle: string | undefined): string | undefined {
  return fontStyle && paperFontStyleFromCss(fontStyle) === 'oblique'
    ? paperFontStyleDescriptor('oblique', paperFontObliqueAngleFromCss(fontStyle))
    : undefined;
}

/** Build the contentEditable's initial HTML: one block per paragraph, one styled span per run. List markers
 * render as a non-editable prefix so they survive editing and round-trip back to `listMarker`. */
export function richTextToEditorHtml(paragraphs: PaperRichParagraph[], zoom: number, managedPaint?: RichEditorManagedPaintContext): string {
  if (!paragraphs.length) return '<div><br></div>';
  return paragraphs
    .map((paragraph, paragraphIndex) => {
      const runsHtml = paragraph.runs.length && paragraph.runs.some((run) => run.text)
        ? paragraph.runs
            .map((run) => {
              const managed = managedRunEditorPaint(run, managedPaint);
              const css = runInlineCss(run, zoom);
              const paintCss = managed
                ? [`font-family:${managed.paintFamily}`, ...css.split(';').filter((part) => part && !part.startsWith('font-family:'))].join(';')
                : css;
              const oblique = authoredObliqueDescriptor(run.fontStyle);
              const attrs = [
                paintCss ? ` style="${escapeHtml(paintCss)}"` : '',
                managed ? ` data-paper-font-family="${escapeHtml(managed.sourceFamily)}"` : '',
                oblique ? ` data-paper-font-style="${escapeHtml(oblique)}"` : '',
                run.leadingPt != null ? ` data-paper-leading="${run.leadingPt}"` : '',
              ].join('');
              const text = escapeHtml(run.text).replace(/ {2,}/g, (match) => '\u00a0'.repeat(match.length));
              const span = `<span${attrs}>${text}</span>`;
              return run.link ? `<a href="${escapeHtml(run.link)}">${span}</a>` : span;
            })
            .join('')
        : '<br>';
      const marker = paragraph.listMarker
        ? `<span contenteditable="false" data-paper-marker="${escapeHtml(paragraph.listMarker)}">${escapeHtml(paragraph.listMarker)}\u2003</span>`
        : '';
      // Presentation-only inherited separation: the serializer reads authored spacing from data-sa, so this
      // margin never gets baked into the document when the user opens and closes the editor.
      const richParagraphGapPt = paragraphIndex < paragraphs.length - 1
        ? managedPaint?.typography.leadingPt ?? 0
        : 0;
      const css = paragraphInlineCss(paragraph, zoom, richParagraphGapPt);
      const data = paragraphDataAttrs(paragraph);
      return `<div${css ? ` style="${css}"` : ''}${data}>${marker}${runsHtml}</div>`;
    })
    .join('');
}

/** rgb(a)/hex CSS colour → #rrggbb, or undefined if it can't be parsed. */
export function cssColorToHex(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const rgb = /^rgba?\(([^)]+)\)/i.exec(trimmed);
  if (!rgb) return undefined;
  const channels = rgb[1].split(',').map((part) => parseFloat(part.trim()));
  const [r, g, b, a] = channels;
  if ([r, g, b].some((channel) => !Number.isFinite(channel))) return undefined;
  if (a === 0) return undefined; // fully transparent → no colour
  return `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

export interface RichEditorBase {
  colorHex: string;
  fontFamily: string;
  fontSizePx: number;
  leadingPx?: number;
  fontWeight?: string;
  fontStyle?: PaperTypography['fontStyle'];
  fontStretch?: string;
  fontVariationSettings?: Record<string, number>;
  fontKerning?: 'auto' | 'normal' | 'none';
  tracking?: number;
  smallCaps?: boolean;
  numericStyle?: 'normal' | 'oldstyle' | 'lining' | 'tabular';
  textOrientation?: 'mixed' | 'upright';
  emphasis?: 'none' | 'dot' | 'open-dot' | 'sesame' | 'circle';
  /** Managed faces let serialization map a painted exact alias back to its durable human family. */
  managedFonts?: readonly PaperManagedFontFace[];
  zoom: number;
}

/**
 * Build the conversion base for one rich-editor session. The DOM is seeded in pixel units when the session
 * opens, so it must also be serialized against that same opening scale even when the canvas zoom changes.
 */
export function createRichEditorBase(typography: PaperTypography, openingZoom: number, managedFonts?: readonly PaperManagedFontFace[]): RichEditorBase {
  return {
    colorHex: (typography.color || '#111827').toLowerCase(),
    fontFamily: typography.fontFamily,
    fontSizePx: typography.fontSizePt * PT_TO_PX * openingZoom,
    leadingPx: typography.leadingPt * PT_TO_PX * openingZoom,
    fontWeight: typography.fontWeight,
    fontStyle: typography.fontStyle,
    fontStretch: typography.fontStretch,
    fontVariationSettings: typography.fontVariationSettings,
    fontKerning: typography.fontKerning,
    tracking: typography.tracking,
    smallCaps: typography.smallCaps,
    numericStyle: typography.numericStyle,
    textOrientation: typography.textOrientation,
    emphasis: typography.emphasis,
    managedFonts,
    zoom: openingZoom,
  };
}

function richEditorSpanData(root: HTMLElement, parent: HTMLElement | null, attribute: string): string | undefined {
  const owner = parent?.closest(`[${attribute}]`);
  return owner && root.contains(owner) ? owner.getAttribute(attribute) ?? undefined : undefined;
}

function normalizedFontFamily(value: string): string {
  return value.split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, '')).join(', ');
}

function numericStyleFromCss(value: string): RichEditorBase['numericStyle'] {
  if (value.includes('oldstyle-nums')) return 'oldstyle';
  if (value.includes('lining-nums')) return 'lining';
  if (value.includes('tabular-nums')) return 'tabular';
  return 'normal';
}

function emphasisFromCss(value: string): RichEditorBase['emphasis'] {
  if (!value || value === 'none') return 'none';
  if (value.includes('sesame')) return 'sesame';
  if (value.includes('circle')) return 'circle';
  if (value.includes('open') && value.includes('dot')) return 'open-dot';
  if (value.includes('dot')) return 'dot';
  return 'none';
}

/** Canonical descriptor ('normal' | 'italic' | 'oblique <angle>deg') for run/base font-style comparison. */
function canonicalFontStyleDescriptor(value: string | undefined): string {
  const style = paperFontStyleFromCss(value);
  return paperFontStyleDescriptor(style, paperFontObliqueAngleFromCss(value));
}

/** Turn one text node's effective computed style into a run carrying only what differs from the base. */
function runFromComputedStyle(
  text: string,
  style: CSSStyleDeclaration,
  base: RichEditorBase,
  readSpanData: (attribute: string) => string | undefined,
): PaperTextRun {
  const run: PaperTextRun = { text };
  const weight = /^\d+$/.test(style.fontWeight) ? style.fontWeight : style.fontWeight === 'bold' ? '700' : '400';
  if (weight !== (base.fontWeight ?? '400')) run.fontWeight = weight;
  // Computed font-style loses the exact authored oblique angle in some engines (and drops `oblique <angle>`
  // entirely in jsdom); the span's data-paper-font-style mirror carries the durable descriptor. Computed
  // 'italic'/'normal' still wins so an execCommand italic inside an oblique span serializes what it paints.
  let fontStyleCss: string | undefined = style.fontStyle || undefined;
  if (!fontStyleCss || paperFontStyleFromCss(fontStyleCss) === 'oblique') {
    const authored = readSpanData('data-paper-font-style');
    if (authored && (!fontStyleCss || paperFontStyleFromCss(authored) === 'oblique')) fontStyleCss = authored;
  }
  const fontStyle = canonicalFontStyleDescriptor(fontStyleCss);
  if (fontStyle !== canonicalFontStyleDescriptor(base.fontStyle)) run.fontStyle = fontStyle as PaperTextRun['fontStyle'];
  const stretchCss = style.fontStretch || style.getPropertyValue('font-stretch');
  if (stretchCss) {
    const stretchPercent = paperFontStretchFromCss(stretchCss);
    if (stretchPercent !== paperFontStretchFromCss(base.fontStretch)) run.fontStretch = `${stretchPercent}%`;
  }
  const variation = paperFontVariationSettingsFromCss(style.getPropertyValue('font-variation-settings'));
  if (variation && !paperFontVariationSettingsEqual(variation, base.fontVariationSettings)) {
    run.fontVariationSettings = variation;
  }
  const fontKerning = style.fontKerning === 'none' || style.fontKerning === 'normal' ? style.fontKerning : 'auto';
  if (fontKerning !== (base.fontKerning ?? 'auto')) run.fontKerning = fontKerning;
  const decoration = style.textDecorationLine || style.textDecoration || '';
  if (decoration.includes('underline')) run.underline = true;
  if (decoration.includes('line-through')) run.strike = true;
  if (style.verticalAlign === 'super') run.vertAlign = 'super';
  else if (style.verticalAlign === 'sub') run.vertAlign = 'sub';
  const smallCaps = style.fontVariantCaps === 'small-caps';
  if (smallCaps !== Boolean(base.smallCaps)) run.smallCaps = smallCaps;
  const hex = cssColorToHex(style.color);
  if (hex && hex !== base.colorHex.toLowerCase()) run.color = hex;
  const highlight = cssColorToHex(style.backgroundColor);
  if (highlight) run.highlight = highlight;
  // A painted managed ALIAS maps back to its durable human family; the alias itself must never persist
  // into the document model. An alias that no longer resolves (face removed) and the blocked sentinel
  // recover the authored human family from the span's data-paper-font-family mirror instead.
  const rawFamily = style.fontFamily ? normalizedFontFamily(style.fontFamily) : '';
  const aliasOwner = rawFamily ? base.managedFonts?.find((face) => paperManagedFontFamilyAlias(face) === rawFamily) : undefined;
  let family = aliasOwner ? aliasOwner.familyName : rawFamily;
  if (!aliasOwner && (rawFamily === PAPER_MANAGED_FONT_BLOCKED_FAMILY || rawFamily.startsWith('sloom-managed-'))) {
    family = readSpanData('data-paper-font-family') ?? '';
  }
  if (family && family !== normalizedFontFamily(base.fontFamily)) {
    run.fontFamily = family;
  }
  const px = parseFloat(style.fontSize);
  if (Number.isFinite(px) && Math.abs(px - base.fontSizePx) > 0.5 && run.vertAlign == null) {
    run.fontSizePt = px / (PT_TO_PX * (base.zoom || 1));
  }
  const lineHeightPx = parseFloat(style.lineHeight);
  const authoredLeadingPt = parseFloat(readSpanData('data-paper-leading') ?? '');
  const paragraphLeadingPt = parseFloat(readSpanData('data-lead') ?? '');
  const inheritedLeadingPx = Number.isFinite(paragraphLeadingPt) && paragraphLeadingPt > 0
    ? paragraphLeadingPt * PT_TO_PX * (base.zoom || 1)
    : base.leadingPx;
  if (Number.isFinite(authoredLeadingPt) && authoredLeadingPt > 0) {
    run.leadingPt = authoredLeadingPt;
  } else if (Number.isFinite(lineHeightPx) && (inheritedLeadingPx == null || Math.abs(lineHeightPx - inheritedLeadingPx) > 0.5)) {
    run.leadingPt = lineHeightPx / (PT_TO_PX * (base.zoom || 1));
  }
  const letterSpacing = style.letterSpacing.trim();
  let tracking = 0;
  if (letterSpacing && letterSpacing !== 'normal') {
    const amount = parseFloat(letterSpacing);
    if (Number.isFinite(amount)) tracking = letterSpacing.endsWith('em') ? amount * 1000 : (amount / Math.max(1, px)) * 1000;
  }
  if (Math.abs(tracking - (base.tracking ?? 0)) > 0.5) run.tracking = Math.round(tracking);
  const numericStyle = numericStyleFromCss(style.fontVariantNumeric);
  if (numericStyle !== (base.numericStyle ?? 'normal')) run.numericStyle = numericStyle;
  const textOrientation = style.textOrientation === 'upright' ? 'upright' : 'mixed';
  if (textOrientation !== (base.textOrientation ?? 'mixed')) run.textOrientation = textOrientation;
  const emphasis = emphasisFromCss(style.getPropertyValue('text-emphasis') || style.getPropertyValue('-webkit-text-emphasis'));
  if (emphasis !== (base.emphasis ?? 'none')) run.emphasis = emphasis;
  return run;
}

/** Resolve one live editor text node back to its durable effective typography, including managed aliases. */
export function effectiveRichEditorTextNodeTypography(
  root: HTMLElement,
  node: Text,
  typography: PaperTypography,
  base: RichEditorBase,
): PaperTypography {
  const parent = node.parentElement;
  if (!parent) return typography;
  const run = runFromComputedStyle(
    node.data,
    getComputedStyle(parent),
    base,
    (attribute) => richEditorSpanData(root, parent, attribute),
  );
  return effectivePaperRunTypography(typography, run);
}

/**
 * Read the effective typography of every text run touched by a retained DOM range. This is deliberately
 * read-only: callers can authenticate all requested managed faces before applying any live DOM mutation.
 */
export function collectEffectiveRichEditorSelectionTypographies(
  root: HTMLElement,
  range: Range | null,
  typography: PaperTypography,
  base: RichEditorBase,
): PaperTypography[] {
  if (!range || !root.contains(range.commonAncestorContainer)) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const selected: PaperTypography[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    const marker = node.parentElement?.closest('[data-paper-marker]');
    let touched = false;
    if (!marker) {
      if (range.collapsed) {
        touched = node === range.startContainer || node.parentElement?.contains(range.startContainer) === true;
      } else {
        try { touched = range.intersectsNode(node); } catch { touched = false; }
      }
    }
    if (touched) selected.push(effectiveRichEditorTextNodeTypography(root, node, typography, base));
    node = walker.nextNode() as Text | null;
  }
  return selected;
}

/**
 * Read an edited contentEditable back into rich paragraphs. Block children (DIV/P/LI) are paragraphs, `<br>`
 * splits a paragraph, list items carry a marker, and every text node's run style comes from its computed
 * style (so it captures execCommand's bold/italic/underline AND our inline spans identically).
 */
export function serializeRichEditor(root: HTMLElement, base: RichEditorBase): PaperRichParagraph[] {
  const paragraphs: PaperRichParagraph[] = [];
  let current: PaperTextRun[] | null = null;
  const startParagraph = (attrs?: Partial<PaperRichParagraph>): void => {
    current = [];
    paragraphs.push({ ...(attrs ?? {}), runs: current });
  };
  const addTextNode = (node: Text): void => {
    const text = node.textContent ?? '';
    if (!text) return;
    if (!current) startParagraph();
    const parent = node.parentElement;
    const style = parent ? getComputedStyle(parent) : null;
    const readSpanData = (attribute: string): string | undefined => richEditorSpanData(root, parent, attribute);
    const run: PaperTextRun = style ? runFromComputedStyle(text, style, base, readSpanData) : { text };
    const link = parent?.closest('a[href]')?.getAttribute('href');
    if (link) run.link = link;
    current!.push(run);
  };
  const walkInline = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) addTextNode(child as Text);
      else if (child.nodeName === 'BR') startParagraph();
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as HTMLElement).dataset?.paperMarker != null) return; // skip the non-editable list marker
        walkInline(child);
      }
    });
  };
  const walkBlocks = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) addTextNode(child as Text);
      else if (child.nodeName === 'BR') startParagraph();
      else if (child.nodeName === 'DIV' || child.nodeName === 'P') {
        const el = child as HTMLElement;
        const attrs = paragraphAttrsFromElement(el);
        const marker = el.querySelector(':scope > [data-paper-marker]')?.getAttribute('data-paper-marker') ?? undefined;
        if (marker) attrs.listMarker = marker;
        startParagraph(attrs);
        const editableChildren = Array.from(el.childNodes).filter((node) =>
          !(node instanceof HTMLElement && node.dataset.paperMarker != null));
        const isBlankPlaceholder = editableChildren.length === 1 && editableChildren[0].nodeName === 'BR';
        if (!isBlankPlaceholder) walkInline(el);
      } else if (child.nodeName === 'UL' || child.nodeName === 'OL') {
        (child as HTMLElement).querySelectorAll(':scope > li').forEach((li, index) => {
          startParagraph({ listMarker: child.nodeName === 'OL' ? `${index + 1}.` : '•' });
          walkInline(li);
        });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!current) startParagraph();
        walkInline(child);
      }
    });
  };
  walkBlocks(root);
  return normalizePaperRichText(paragraphs) ?? [{ runs: [{ text: root.textContent ?? '' }] }];
}
