import type { PaperParagraphBorderEdge, PaperParagraphBorders, PaperRichParagraph, PaperTextRun, PaperTextVertAlign } from '../types/paper';

// Inline rich text for Paper text frames. `PaperFrame.richText` (when present) is the authoritative content;
// `PaperFrame.text` is kept as its flattened plaintext so search/threading/legacy export keep working. These
// helpers are pure (no React / no canvas) so the same normalization + flattening feed the renderer, the
// editor, the docx importer, and the PDF/X exporter.

const VERT_ALIGNS: PaperTextVertAlign[] = ['baseline', 'super', 'sub'];

/** The style fields of a run (everything except its text), compared to merge adjacent identical runs. */
const RUN_STYLE_KEYS: Array<keyof PaperTextRun> = [
  'fontFamily', 'fontSizePt', 'leadingPt', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings',
  'fontKerning', 'underline', 'strike',
  'color', 'highlight', 'tracking', 'smallCaps', 'numericStyle', 'textOrientation', 'emphasis', 'vertAlign', 'link',
];

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function cleanNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
}

/** Coerce one untrusted run into a clean PaperTextRun (text always a string; style fields optional). */
function normalizeRun(input: unknown): PaperTextRun {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const run: PaperTextRun = { text: typeof raw.text === 'string' ? raw.text : '' };
  const fontFamily = cleanString(raw.fontFamily);
  if (fontFamily) run.fontFamily = fontFamily;
  const fontSizePt = cleanNumber(raw.fontSizePt, 1, 1600);
  if (fontSizePt != null) run.fontSizePt = fontSizePt;
  const leadingPt = cleanNumber(raw.leadingPt, 1, 3200);
  if (leadingPt != null) run.leadingPt = leadingPt;
  const fontWeight = cleanString(raw.fontWeight);
  if (fontWeight) run.fontWeight = fontWeight;
  if (raw.fontStyle === 'italic' || raw.fontStyle === 'normal'
    || (typeof raw.fontStyle === 'string' && /^oblique(?:\s+-?(?:\d+(?:\.\d+)?|\.\d+)deg)?$/i.test(raw.fontStyle.trim()))) {
    run.fontStyle = raw.fontStyle.trim().toLowerCase() as PaperTextRun['fontStyle'];
  }
  const fontStretch = cleanString(raw.fontStretch);
  if (fontStretch) run.fontStretch = fontStretch;
  if (raw.fontVariationSettings && typeof raw.fontVariationSettings === 'object' && !Array.isArray(raw.fontVariationSettings)) {
    const entries = Object.entries(raw.fontVariationSettings as Record<string, unknown>)
      .filter((entry): entry is [string, number] => /^[ -~]{4}$/.test(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > 0) run.fontVariationSettings = Object.fromEntries(entries);
  }
  if (raw.fontKerning === 'auto' || raw.fontKerning === 'normal' || raw.fontKerning === 'none') run.fontKerning = raw.fontKerning;
  if (raw.underline === true) run.underline = true;
  if (raw.strike === true) run.strike = true;
  const color = cleanString(raw.color);
  if (color) run.color = color;
  const highlight = cleanString(raw.highlight);
  if (highlight) run.highlight = highlight;
  const tracking = cleanNumber(raw.tracking, -200, 2000);
  if (tracking != null) run.tracking = tracking;
  if (typeof raw.smallCaps === 'boolean') run.smallCaps = raw.smallCaps;
  if (raw.numericStyle === 'normal' || raw.numericStyle === 'oldstyle' || raw.numericStyle === 'lining' || raw.numericStyle === 'tabular') {
    run.numericStyle = raw.numericStyle;
  }
  if (raw.textOrientation === 'mixed' || raw.textOrientation === 'upright') run.textOrientation = raw.textOrientation;
  if (raw.emphasis === 'none' || raw.emphasis === 'dot' || raw.emphasis === 'open-dot' || raw.emphasis === 'sesame' || raw.emphasis === 'circle') {
    run.emphasis = raw.emphasis;
  }
  if (typeof raw.vertAlign === 'string' && VERT_ALIGNS.includes(raw.vertAlign as PaperTextVertAlign) && raw.vertAlign !== 'baseline') {
    run.vertAlign = raw.vertAlign as PaperTextVertAlign;
  }
  const link = cleanString(raw.link);
  if (link) run.link = link;
  return run;
}

/** Coerce one untrusted border edge into a clean edge, or undefined if it carries no real weight. */
function normalizeBorderEdge(input: unknown): PaperParagraphBorderEdge | undefined {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const color = cleanString(raw.color);
  const widthPt = cleanNumber(raw.widthPt, 0, 96);
  if (!color || widthPt == null || widthPt <= 0) return undefined;
  return { color, widthPt };
}

/** Coerce untrusted paragraph borders, keeping only edges that actually paint. */
function normalizeBorders(input: unknown): PaperParagraphBorders | undefined {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const borders: PaperParagraphBorders = {};
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    const clean = normalizeBorderEdge(raw[edge]);
    if (clean) borders[edge] = clean;
  }
  const paddingPt = cleanNumber(raw.paddingPt, 0, 96);
  if (paddingPt != null && paddingPt > 0) borders.paddingPt = paddingPt;
  return borders.top || borders.left || borders.bottom || borders.right ? borders : undefined;
}

/** True when two runs carry the same styling (ignoring their text), so they can be concatenated. */
export function paperRunsShareStyle(a: PaperTextRun, b: PaperTextRun): boolean {
  return RUN_STYLE_KEYS.every((key) => a[key] === b[key]);
}

/** Merge consecutive runs that share styling — keeps richText compact after edits/imports. */
function mergeAdjacentRuns(runs: PaperTextRun[]): PaperTextRun[] {
  const merged: PaperTextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && paperRunsShareStyle(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged.length ? merged : [{ text: '' }];
}

/**
 * Coerce untrusted input (freshly-parsed JSON, importer output) into clean rich text, or `undefined` when
 * there is no real content — so a frame never gets stuck in rich mode with nothing in it (it falls back to
 * the plain `text` path). Empty paragraphs are preserved (they are meaningful blank lines).
 */
export function normalizePaperRichText(input: unknown): PaperRichParagraph[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const paragraphs: PaperRichParagraph[] = [];
  for (const item of input) {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const rawRuns = Array.isArray(raw.runs) ? raw.runs : [];
    const runs = mergeAdjacentRuns(rawRuns.map(normalizeRun));
    const paragraph: PaperRichParagraph = { runs };
    if (raw.align === 'left' || raw.align === 'center' || raw.align === 'right' || raw.align === 'justify') paragraph.align = raw.align;
    if (raw.alignLast === 'auto' || raw.alignLast === 'left' || raw.alignLast === 'center' || raw.alignLast === 'right' || raw.alignLast === 'justify') {
      paragraph.alignLast = raw.alignLast;
    }
    const leading = cleanNumber(raw.leadingPt, 1, 3200);
    if (leading != null) paragraph.leadingPt = leading;
    if (typeof raw.hyphenate === 'boolean') paragraph.hyphenate = raw.hyphenate;
    if (raw.lineBreak === 'auto' || raw.lineBreak === 'balance' || raw.lineBreak === 'pretty') paragraph.lineBreak = raw.lineBreak;
    if (typeof raw.lineBreakStrict === 'boolean') paragraph.lineBreakStrict = raw.lineBreakStrict;
    const indent = cleanNumber(raw.firstLineIndentMm, -200, 200);
    if (indent != null) paragraph.firstLineIndentMm = indent;
    const before = cleanNumber(raw.spaceBeforeMm, 0, 200);
    if (before != null) paragraph.spaceBeforeMm = before;
    const after = cleanNumber(raw.spaceAfterMm, 0, 200);
    if (after != null) paragraph.spaceAfterMm = after;
    const dropCap = cleanNumber(raw.dropCapLines, 0, 8);
    if (dropCap != null && dropCap >= 2) paragraph.dropCapLines = Math.round(dropCap);
    const marker = cleanString(raw.listMarker);
    if (marker) paragraph.listMarker = marker;
    const shading = cleanString(raw.shading);
    if (shading) paragraph.shading = shading;
    const borders = normalizeBorders(raw.borders);
    if (borders) paragraph.borders = borders;
    const leftIndent = cleanNumber(raw.leftIndentMm, 0, 400);
    if (leftIndent != null && leftIndent > 0) paragraph.leftIndentMm = leftIndent;
    const rightIndent = cleanNumber(raw.rightIndentMm, 0, 400);
    if (rightIndent != null && rightIndent > 0) paragraph.rightIndentMm = rightIndent;
    const hanging = cleanNumber(raw.hangingIndentMm, 0, 400);
    if (hanging != null && hanging > 0) paragraph.hangingIndentMm = hanging;
    paragraphs.push(paragraph);
  }
  // No real text anywhere → treat as empty (use the plain-text path instead of an empty rich shell).
  const hasText = paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.length > 0));
  if (!hasText) return undefined;
  return paragraphs;
}

export interface PaperRichTextSourceCoordinates {
  text: string;
  /** Exact half-open ranges of only the separators inserted between structural paragraphs. */
  structuralDelimiters: Array<{ start: number; end: number }>;
}

/**
 * Flatten rich text and retain the provenance of every structural paragraph separator. Newline bytes inside
 * runs are deliberately absent from `structuralDelimiters`, even when they are adjacent to an inserted `\n`.
 */
export function flattenPaperRichTextSource(
  paragraphs: PaperRichParagraph[] | undefined,
): PaperRichTextSourceCoordinates {
  if (!paragraphs || !paragraphs.length) return { text: '', structuralDelimiters: [] };
  const structuralDelimiters: PaperRichTextSourceCoordinates['structuralDelimiters'] = [];
  const parts: string[] = [];
  let cursor = 0;
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      structuralDelimiters.push({ start: cursor, end: cursor + 1 });
      parts.push('\n');
      cursor += 1;
    }
    if (paragraph.listMarker) {
      const prefix = `${paragraph.listMarker}\t`;
      parts.push(prefix);
      cursor += prefix.length;
    }
    for (const run of paragraph.runs) {
      parts.push(run.text);
      cursor += run.text.length;
    }
  });
  return { text: parts.join(''), structuralDelimiters };
}

/** Flatten rich text to plaintext: runs concatenated, paragraphs joined by newlines. Mirrors what the user sees. */
export function flattenPaperRichText(paragraphs: PaperRichParagraph[] | undefined): string {
  return flattenPaperRichTextSource(paragraphs).text;
}

/** Build single-run rich paragraphs from plaintext (one paragraph per line) — used when a plain frame is
 * promoted to rich, or to seed the editor. */
export function paperRichTextFromPlainText(text: string): PaperRichParagraph[] {
  return (text ?? '').split('\n').map((line) => ({ runs: [{ text: line }] }));
}

export function paperRichTextIsEmpty(paragraphs: PaperRichParagraph[] | undefined): boolean {
  return !paragraphs || !paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.length > 0));
}

/** A derived, render-only paragraph fragment. Ownership prevents paragraph-start/end decoration from being
 * replayed when one source paragraph continues through another text frame. These fields are never serialized. */
export interface PaperRichParagraphFragment extends PaperRichParagraph {
  ownsParagraphStart: boolean;
  ownsParagraphEnd: boolean;
}

export function isPaperRichParagraphFragment(
  paragraph: PaperRichParagraph,
): paragraph is PaperRichParagraphFragment {
  return typeof (paragraph as Partial<PaperRichParagraphFragment>).ownsParagraphStart === 'boolean'
    && typeof (paragraph as Partial<PaperRichParagraphFragment>).ownsParagraphEnd === 'boolean';
}

/**
 * Slice rich text to the character range [startOffset, endOffset) measured in the SAME coordinate space as
 * `flattenPaperRichText(paragraphs)`: runs concatenated, list paragraphs prefixed with `${listMarker}\t`, and
 * paragraphs joined by a single '\n'. Returns a NEW, independent set of paragraphs (the source is never mutated
 * or fragmented) covering exactly that window, preserving paragraph- and run-level styling, links, run/paragraph
 * ids, and blank lines. The list marker is kept only when the slice owns the item's start (so a bullet that began
 * in an earlier frame is not re-emitted mid-item). The invariant, for any range the thread-flow engine produces
 * (word/paragraph-aligned), is:
 *   flattenPaperRichText(slicePaperRichTextRange(p, s, e)) === flattenPaperRichText(p).slice(s, e)
 * Used to render each threaded frame's contiguous rich slice from the authoritative head richText — see
 * paperThreadFlow.computePaperThreadSlices. An empty range yields `[]`; a range past the end reaches the end.
 */
export function slicePaperRichTextRange(
  paragraphs: PaperRichParagraph[],
  startOffset: number,
  endOffset: number,
): PaperRichParagraphFragment[] {
  const flat = flattenPaperRichText(paragraphs);
  const start = Math.max(0, Math.min(flat.length, Math.min(startOffset, endOffset)));
  const end = Math.max(start, Math.min(flat.length, endOffset));
  if (end <= start) return [];

  const layouts: Array<{
    paragraph: PaperRichParagraph;
    start: number;
    end: number;
    markerPrefixLength: number;
    source: string;
  }> = [];
  let cursor = 0;
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) cursor += 1; // the '\n' that flattenPaperRichText inserts between paragraphs
    const markerPrefixLength = paragraph.listMarker ? paragraph.listMarker.length + 1 : 0;
    const source = (paragraph.listMarker ? `${paragraph.listMarker}\t` : '')
      + paragraph.runs.map((run) => run.text).join('');
    layouts.push({ paragraph, start: cursor, end: cursor + source.length, markerPrefixLength, source });
    cursor += source.length;
  });

  // Select fragments by the original structural paragraph spans, not by splitting the flattened substring.
  // A newline authored inside a run remains ordinary run text; only the one-character gaps between these
  // layouts are structural delimiters represented by the array join in flattenPaperRichText. Inclusive boundary
  // selection keeps delimiter-only, initial/terminal, and consecutive blank-paragraph ranges representable.
  let firstParagraphIndex = layouts.findIndex((layout) => start <= layout.end);
  if (firstParagraphIndex < 0) firstParagraphIndex = layouts.length - 1;
  let lastParagraphIndex = layouts.findIndex((layout) => end <= layout.end);
  if (lastParagraphIndex < 0) lastParagraphIndex = layouts.length - 1;

  return layouts.slice(firstParagraphIndex, lastParagraphIndex + 1).map((layout) => {
    const paragraph = layout.paragraph;
    const localStart = Math.max(0, Math.min(layout.source.length, start - layout.start));
    const localEnd = Math.max(localStart, Math.min(layout.source.length, end - layout.start));

    // A caller range can begin or end inside surrounding whitespace. Whitespace alone before the first owned
    // glyph or after the last owned glyph does not transfer paragraph-start/end geometry to another frame.
    const ownsParagraphStart = localStart === 0 || layout.source.slice(0, localStart).trim() === '';
    const ownsParagraphEnd = localEnd >= layout.source.length || layout.source.slice(localEnd).trim() === '';
    const sliced: PaperRichParagraphFragment = {
      ...paragraph,
      ...(paragraph.borders ? {
        borders: {
          ...paragraph.borders,
          ...(paragraph.borders.top ? { top: { ...paragraph.borders.top } } : {}),
          ...(paragraph.borders.left ? { left: { ...paragraph.borders.left } } : {}),
          ...(paragraph.borders.bottom ? { bottom: { ...paragraph.borders.bottom } } : {}),
          ...(paragraph.borders.right ? { right: { ...paragraph.borders.right } } : {}),
        },
      } : {}),
      runs: [],
      ownsParagraphStart,
      ownsParagraphEnd,
    };
    // Start-only semantics belong to the fragment that owns the true paragraph start. Retain continuing
    // geometry (alignment, leading, left/right indent, shading, side borders) in every fragment.
    if (!ownsParagraphStart) {
      delete sliced.listMarker;
      delete sliced.dropCapLines;
      delete sliced.firstLineIndentMm;
      delete sliced.hangingIndentMm;
      delete sliced.spaceBeforeMm;
      if (sliced.borders?.top) {
        const { top: _top, ...continuingBorders } = sliced.borders;
        sliced.borders = continuingBorders;
      }
    }
    // End-only semantics must not paint early at an inter-frame fragment boundary.
    if (!ownsParagraphEnd) {
      delete sliced.spaceAfterMm;
      if (sliced.borders?.bottom) {
        const { bottom: _bottom, ...continuingBorders } = sliced.borders;
        sliced.borders = continuingBorders;
      }
    }

    const markerFullyOwned = layout.markerPrefixLength > 0
      && localStart === 0
      && localEnd >= layout.markerPrefixLength;
    if (paragraph.listMarker && !markerFullyOwned) delete sliced.listMarker;

    const markerFragment = !markerFullyOwned && localStart < layout.markerPrefixLength
      ? layout.source.slice(localStart, Math.min(localEnd, layout.markerPrefixLength))
      : '';
    if (markerFragment) sliced.runs.push({ ...(paragraph.runs[0] ?? { text: '' }), text: markerFragment });

    const contentStart = layout.markerPrefixLength;
    const from = Math.max(localStart, contentStart) - contentStart;
    const to = Math.max(from, localEnd - contentStart);
    let runCursor = 0;
    for (const run of paragraph.runs) {
      const runStart = runCursor;
      const runEnd = runStart + run.text.length;
      runCursor = runEnd;
      const localFrom = Math.max(from, runStart);
      const localTo = Math.min(to, runEnd);
      if (localTo > localFrom) {
        sliced.runs.push({ ...run, text: run.text.slice(localFrom - runStart, localTo - runStart) });
      }
    }
    if (sliced.runs.length === 0) sliced.runs = [{ ...(paragraph.runs[0] ?? { text: '' }), text: '' }];
    return sliced;
  });
}

/**
 * True when rich text carries NOTHING beyond plain text — a single paragraph with no paragraph-level
 * formatting and runs with no style overrides — so the frame's single `typography` fully represents it.
 * The PDF/X single-style vector/outline export path is only correct for such frames; anything richer (a bold
 * word, a font swap, a shaded/indented/drop-cap paragraph) would be drawn in ONE style and lose its runs, so
 * those frames must fall back to raster (where the HTML print render draws every run correctly).
 */
export function paperRichTextIsUniform(paragraphs: PaperRichParagraph[] | undefined): boolean {
  if (!paragraphs || paragraphs.length === 0) return true;
  if (paragraphs.length > 1) return false;
  const p = paragraphs[0];
  if (p.listMarker || p.shading || p.borders || p.align || p.alignLast || p.leadingPt != null) return false;
  if (p.hyphenate != null || p.lineBreak || p.lineBreakStrict != null) return false;
  if (p.dropCapLines || p.leftIndentMm || p.rightIndentMm || p.hangingIndentMm || p.firstLineIndentMm) return false;
  if (p.spaceBeforeMm || p.spaceAfterMm) return false;
  return p.runs.every((run) => RUN_STYLE_KEYS.every((key) => run[key] === undefined));
}
