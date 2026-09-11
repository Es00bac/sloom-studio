/**
 * Pure rich-text run/paragraph transforms for the Paper workspace's text-formatting actions (bold/italic/
 * underline toggles, bullet-list toggle, font-size stepping). Operates entirely on the `PaperRichParagraph[]`
 * data model plus a plain character-offset range — no DOM, no React — so every case (split at a boundary,
 * cross-paragraph ranges, toggle-off detection, run merging, idempotence) is directly unit-testable.
 *
 * Character-range convention: `start`/`end` are offsets into `flattenPaperRichText(paragraphs)` — the same
 * string the app already uses for search/threading/legacy export (runs concatenated per paragraph, prefixed
 * by `"listMarker\t"` when the paragraph is bulleted, paragraphs joined by `"\n"`). A caller with a live DOM
 * selection is responsible for mapping it into this offset space before calling any transform here — see the
 * commit that introduced this file for why that specific mapping is not wired up to a live editor in this pass.
 */
import { flattenPaperRichText, paperRichTextFromPlainText, paperRunsShareStyle } from '../../../lib/paperRichText';
import type { PaperRichParagraph, PaperTextRun, PaperTypography } from '../../../types/paper';

export interface PaperTextRange {
  /** Inclusive start offset into the paragraphs' flattened text. */
  start: number;
  /** Exclusive end offset into the paragraphs' flattened text. */
  end: number;
}

/** The togglable subset of run styling this feature authors (bold/italic/underline). */
export type ToggleableRunStyle = Partial<Pick<PaperTextRun, 'fontWeight' | 'fontStyle' | 'underline'>>;

export interface RunStyleTogglePatch {
  /** Applied when some part of the range doesn't already carry this style. */
  on: ToggleableRunStyle;
  /** Applied when the WHOLE range already carries `on` — so the same button/shortcut turns it back off. */
  off: ToggleableRunStyle;
}

export const BOLD_TOGGLE_PATCH: RunStyleTogglePatch = { on: { fontWeight: '700' }, off: { fontWeight: '400' } };
export const ITALIC_TOGGLE_PATCH: RunStyleTogglePatch = { on: { fontStyle: 'italic' }, off: { fontStyle: 'normal' } };
export const UNDERLINE_TOGGLE_PATCH: RunStyleTogglePatch = { on: { underline: true }, off: { underline: undefined } };

export const MIN_RUN_FONT_SIZE_PT = 4;
export const MAX_RUN_FONT_SIZE_PT = 96;

const BULLET_MARKER = '•';
const BULLET_HANGING_INDENT_MM = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ParagraphSpan {
  /** Offset of this paragraph's first character (its list-marker prefix, if any, else its first run) in the
   *  flattened text. */
  start: number;
  /** Offset one past this paragraph's last character (before the joining "\n", if any). */
  end: number;
  /** Where this paragraph's actual run text starts, after any "marker\t" prefix — which belongs to no run and
   *  is never split/patched by a run-level transform. */
  textStart: number;
}

/** Compute each paragraph's span in flattenPaperRichText's offset space, without building the string itself. */
function paragraphSpans(paragraphs: PaperRichParagraph[]): ParagraphSpan[] {
  const spans: ParagraphSpan[] = [];
  let offset = 0;
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) offset += 1; // the "\n" joining this paragraph to the previous one
    const start = offset;
    const markerLength = paragraph.listMarker ? paragraph.listMarker.length + 1 : 0; // "marker" + "\t"
    const textStart = start + markerLength;
    const textLength = paragraph.runs.reduce((sum, run) => sum + run.text.length, 0);
    offset = textStart + textLength;
    spans.push({ start, end: offset, textStart });
  });
  return spans;
}

/** Merge consecutive runs that share styling — mirrors src/lib/paperRichText.ts's own (unexported) helper of
 *  the same purpose, reusing its exported `paperRunsShareStyle` comparator so "same style" means one thing. */
function mergeAdjacentRuns(runs: PaperTextRun[]): PaperTextRun[] {
  const merged: PaperTextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && paperRunsShareStyle(last, run)) {
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
    } else {
      merged.push({ ...run });
    }
  }
  return merged.length ? merged : [{ text: '' }];
}

function normalizeRange(range: PaperTextRange): { start: number; end: number } {
  return { start: Math.max(0, Math.min(range.start, range.end)), end: Math.max(0, Math.max(range.start, range.end)) };
}

/**
 * Walk every run whose span intersects `range`, splitting a run at the range boundary when the overlap is
 * partial so only the intersecting slice is patched, then merging adjacent same-style runs back together.
 * `patchRun` receives the (possibly split-off) overlapping run slice and returns its replacement; runs and
 * paragraphs entirely outside the range are returned untouched (same object references, even). A zero-length
 * range (a caret with no selection) is a no-op — this library authors selections, not "format the next
 * keystroke" pending state.
 */
function mapRunsInRange(
  paragraphs: PaperRichParagraph[],
  range: PaperTextRange,
  patchRun: (run: PaperTextRun) => PaperTextRun,
): PaperRichParagraph[] {
  const { start, end } = normalizeRange(range);
  if (end <= start) return paragraphs;

  const spans = paragraphSpans(paragraphs);
  return paragraphs.map((paragraph, index) => {
    const span = spans[index];
    if (end <= span.textStart || start >= span.end) return paragraph; // no overlap with this paragraph's text

    let cursor = span.textStart;
    const nextRuns: PaperTextRun[] = [];
    for (const run of paragraph.runs) {
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      cursor = runEnd;
      const overlapStart = Math.max(runStart, start);
      const overlapEnd = Math.min(runEnd, end);
      if (overlapEnd <= overlapStart) {
        nextRuns.push(run);
        continue;
      }
      const beforeText = run.text.slice(0, overlapStart - runStart);
      const overlapText = run.text.slice(overlapStart - runStart, overlapEnd - runStart);
      const afterText = run.text.slice(overlapEnd - runStart);
      if (beforeText) nextRuns.push({ ...run, text: beforeText });
      nextRuns.push(patchRun({ ...run, text: overlapText }));
      if (afterText) nextRuns.push({ ...run, text: afterText });
    }
    return { ...paragraph, runs: mergeAdjacentRuns(nextRuns) };
  });
}

/** True when every run intersecting `range` already carries every field/value in `style` (used to decide
 *  whether a toggle should turn a style ON across the whole range, or OFF because it's already fully applied). */
function isRangeFullyStyled(paragraphs: PaperRichParagraph[], range: PaperTextRange, style: ToggleableRunStyle): boolean {
  const { start, end } = normalizeRange(range);
  if (end <= start) return false;

  const spans = paragraphSpans(paragraphs);
  const keys = Object.keys(style) as Array<keyof ToggleableRunStyle>;
  let touchedAnyRun = false;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const span = spans[index];
    if (end <= span.textStart || start >= span.end) continue;

    let cursor = span.textStart;
    for (const run of paragraphs[index].runs) {
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      cursor = runEnd;
      const overlapStart = Math.max(runStart, start);
      const overlapEnd = Math.min(runEnd, end);
      if (overlapEnd <= overlapStart) continue;
      touchedAnyRun = true;
      if (!keys.every((key) => run[key] === style[key])) return false;
    }
  }
  return touchedAnyRun;
}

/**
 * Toggle a run style (bold/italic/underline) across a character range: if the WHOLE range already carries
 * `patch.on`, applies `patch.off` (turning it back off); otherwise applies `patch.on` to the whole range
 * (matching standard word-processor Bold/Italic/Underline button behaviour — mixed or unstyled selections
 * always resolve to "on"). Splits/merges runs as needed; never touches run text, so flattening the result is
 * always byte-identical to flattening the input.
 */
export function toggleRunStyle(
  paragraphs: PaperRichParagraph[],
  range: PaperTextRange,
  patch: RunStyleTogglePatch,
): PaperRichParagraph[] {
  const applied = isRangeFullyStyled(paragraphs, range, patch.on) ? patch.off : patch.on;
  return mapRunsInRange(paragraphs, range, (run) => ({ ...run, ...applied }));
}

/**
 * Step every run's font size across a character range by `deltaPt` (typically +1/-1), clamped to
 * [MIN_RUN_FONT_SIZE_PT, MAX_RUN_FONT_SIZE_PT]. A run with no explicit `fontSizePt` (inheriting the frame's
 * typography) is first materialized from `frameFontSizePt` before stepping, so "A+" on an unset run grows it
 * from what it's actually displaying, not from zero.
 */
export function stepFontSize(
  paragraphs: PaperRichParagraph[],
  range: PaperTextRange,
  deltaPt: number,
  frameFontSizePt: number,
): PaperRichParagraph[] {
  return mapRunsInRange(paragraphs, range, (run) => ({
    ...run,
    fontSizePt: clamp((run.fontSizePt ?? frameFontSizePt) + deltaPt, MIN_RUN_FONT_SIZE_PT, MAX_RUN_FONT_SIZE_PT),
  }));
}

/**
 * Toggle a "•" bullet + hanging indent on/off for the given paragraph indexes: if every targeted paragraph is
 * already bulleted, un-bullets all of them; otherwise bullets all of them (same all-or-nothing convention as
 * toggleRunStyle). Unlike the run-style toggles, this DOES change flattenPaperRichText's output — the bullet
 * marker is a real, meaningful content prefix (`"•\t"` per flattenPaperRichText), not styling.
 */
export function toggleParagraphBullet(paragraphs: PaperRichParagraph[], paragraphIndexes: number[]): PaperRichParagraph[] {
  const targets = new Set(paragraphIndexes.filter((index) => index >= 0 && index < paragraphs.length));
  if (targets.size === 0) return paragraphs;

  const allAlreadyBulleted = [...targets].every((index) => paragraphs[index].listMarker === BULLET_MARKER);

  return paragraphs.map((paragraph, index) => {
    if (!targets.has(index)) return paragraph;
    return allAlreadyBulleted
      ? { ...paragraph, listMarker: undefined, hangingIndentMm: undefined }
      : { ...paragraph, listMarker: BULLET_MARKER, hangingIndentMm: BULLET_HANGING_INDENT_MM };
  });
}

/**
 * Plain-text frames have no richText yet — lift them into single-run-per-line rich paragraphs (via
 * paperRichTextFromPlainText) before any transform runs, so formatting can be authored on ANY text/caption
 * frame, not only ones already promoted to rich text. A no-op when richText already has content.
 */
export function ensureRichTextForTransform(
  richText: PaperRichParagraph[] | undefined,
  plainText: string,
): PaperRichParagraph[] {
  return richText && richText.length ? richText : paperRichTextFromPlainText(plainText);
}

const RUN_TYPOGRAPHY_KEYS = [
  'fontFamily', 'fontSizePt', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings',
  'fontKerning', 'color', 'tracking',
  'smallCaps', 'numericStyle', 'textOrientation', 'emphasis',
] as const satisfies ReadonlyArray<keyof PaperTypography & keyof PaperTextRun>;

const PARAGRAPH_TYPOGRAPHY_KEYS = [
  'align', 'alignLast', 'leadingPt', 'hyphenate', 'lineBreak', 'lineBreakStrict', 'firstLineIndentMm',
  'spaceBeforeMm', 'spaceAfterMm', 'dropCapLines',
] as const satisfies ReadonlyArray<keyof PaperTypography & keyof PaperRichParagraph>;

/** Typography fields that can be represented by retained run/paragraph overrides. Writing direction remains
 * frame-level because it changes the containing flow, not a character range. */
export const RICH_TYPOGRAPHY_KEYS = [
  'fontFamily', 'fontSizePt', 'leadingPt', 'fontWeight', 'fontStyle', 'fontStretch',
  'fontVariationSettings', 'fontKerning', 'color', 'tracking',
  'smallCaps', 'numericStyle', 'textOrientation', 'emphasis', 'align', 'alignLast', 'hyphenate', 'lineBreak',
  'lineBreakStrict', 'firstLineIndentMm', 'spaceBeforeMm', 'spaceAfterMm', 'dropCapLines',
] as const;
export type RichTypographyKey = (typeof RICH_TYPOGRAPHY_KEYS)[number];
export type RichTypographyPatch = Pick<PaperTypography, RichTypographyKey>;

/** Return only rich-capable fields that actually changed. This distinction is important: copying the entire
 * frame typography into every run when only leading changed would silently destroy mixed fonts and colours. */
export function changedRichTypographyPatch(
  previous: PaperTypography,
  next: PaperTypography,
): Partial<RichTypographyPatch> {
  const patch: Partial<RichTypographyPatch> = {};
  for (const key of RICH_TYPOGRAPHY_KEYS) {
    if (previous[key] !== next[key]) Object.assign(patch, { [key]: next[key] });
  }
  return patch;
}

/** Apply a deliberate typography patch to all retained rich runs and paragraphs. Only properties present in
 * `patch` are authored, including explicit `false`, `0`, and `undefined`; every other mixed style survives. */
export function applyTypographyPatchToRichText(
  richText: PaperRichParagraph[] | undefined,
  patch: Partial<RichTypographyPatch>,
): PaperRichParagraph[] | undefined {
  if (!richText?.length || Object.keys(patch).length === 0) return richText;
  const has = (key: RichTypographyKey): boolean => Object.prototype.hasOwnProperty.call(patch, key);
  return richText.map((paragraph) => {
    const nextParagraph: PaperRichParagraph = { ...paragraph };
    for (const key of PARAGRAPH_TYPOGRAPHY_KEYS) {
      if (has(key)) Object.assign(nextParagraph, { [key]: patch[key] });
    }
    nextParagraph.runs = paragraph.runs.map((run) => {
      const nextRun: PaperTextRun = { ...run };
      for (const key of RUN_TYPOGRAPHY_KEYS) {
        if (has(key)) Object.assign(nextRun, { [key]: patch[key] });
      }
      return nextRun;
    });
    return nextParagraph;
  });
}

/** Synchronize a frame typography edit through retained rich overrides without disturbing unrelated styles. */
export function synchronizeRichTextWithTypographyChange(
  richText: PaperRichParagraph[] | undefined,
  previous: PaperTypography,
  next: PaperTypography,
): PaperRichParagraph[] | undefined {
  return applyTypographyPatchToRichText(richText, changedRichTypographyPatch(previous, next));
}

/** Backwards-compatible focused helper used by older callers/tests. */
export function applyFontFamilyToRichText(
  richText: PaperRichParagraph[] | undefined,
  fontFamily: string,
): PaperRichParagraph[] | undefined {
  return applyTypographyPatchToRichText(richText, { fontFamily });
}

export interface RichEditorCommitDecision {
  /** False when nothing actually changed from what the editor started with — the caller should cancel/no-op
   *  rather than commit anything (so entering edit mode and blurring without touching anything is a true no-op). */
  changed: boolean;
  /** The flattened plain text to commit — meaningful only when `changed` is true. */
  text: string;
  /**
   * The richText to persist, or `undefined` to commit as plain text (the frame stays/becomes plain). A frame
   * that was already rich always keeps committing as rich (no demotion logic); a frame that started plain only
   * gets PROMOTED to rich when the edited content carries real formatting (see hasRealFormatting) — typing new
   * plain text, including MULTI-LINE plain text, with no formatting applied keeps it plain.
   */
  richText?: PaperRichParagraph[];
}

/** Mirrors src/lib/paperRichText.ts's private (unexported) RUN_STYLE_KEYS list — the run-level fields that
 *  count as a real style override, kept in sync by hand since it isn't exported for reuse. */
const RUN_FORMATTING_KEYS: Array<keyof PaperTextRun> = [
  'fontFamily', 'fontSizePt', 'leadingPt', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings',
  'fontKerning', 'underline', 'strike',
  'color', 'highlight', 'tracking', 'smallCaps', 'numericStyle', 'textOrientation', 'emphasis', 'vertAlign', 'link',
];

/**
 * True when ANY paragraph carries real formatting: a list marker, a paragraph-level layout override (align/
 * shading/borders/indents/spacing/drop-cap), or any run-level style override. Deliberately does NOT flag
 * multi-paragraph content by itself — unlike src/lib/paperRichText.ts's paperRichTextIsUniform, whose job is a
 * different question ("can this collapse to one frame-level typography for PDF/X vector text", where >1
 * paragraph alone already answers no) — this function exists so a plain MULTI-LINE caption with zero actual
 * formatting doesn't get promoted to rich storage just for having line breaks.
 */
function hasRealFormatting(paragraphs: PaperRichParagraph[]): boolean {
  return paragraphs.some((paragraph) => {
    if (paragraph.listMarker || paragraph.align || paragraph.alignLast || paragraph.shading || paragraph.borders) return true;
    if (paragraph.leadingPt != null || paragraph.hyphenate != null || paragraph.lineBreak || paragraph.lineBreakStrict != null) return true;
    if (paragraph.dropCapLines || paragraph.leftIndentMm || paragraph.rightIndentMm || paragraph.hangingIndentMm || paragraph.firstLineIndentMm) return true;
    if (paragraph.spaceBeforeMm || paragraph.spaceAfterMm) return true;
    return paragraph.runs.some((run) => RUN_FORMATTING_KEYS.some((key) => run[key] !== undefined));
  });
}

/**
 * Decide what a rich-editor session should commit, given the richText it serialized from the live DOM at
 * commit time. Pure and DOM-free — the caller (PaperRichEditableText's commit()) is responsible for producing
 * `editedRichText` (via serializeRichEditor) and calling onCommit/onCancel per this decision. This is the
 * plain-frame-promotion policy from the "make the floating bar available on plain frames" feature: promotion
 * happens on the first REAL formatting action (including a bullet toggle), never merely from entering edit
 * mode or editing plain text — even multi-line plain text.
 */
export function resolveRichEditorCommit(
  editedRichText: PaperRichParagraph[],
  priorRichText: PaperRichParagraph[] | undefined,
  plainText: string,
): RichEditorCommitDecision {
  const wasAlreadyRich = Boolean(priorRichText && priorRichText.length > 0);
  const baseline = wasAlreadyRich ? priorRichText! : ensureRichTextForTransform(undefined, plainText);
  const text = flattenPaperRichText(editedRichText);

  if (JSON.stringify(editedRichText) === JSON.stringify(baseline)) {
    return { changed: false, text };
  }
  if (!wasAlreadyRich && !hasRealFormatting(editedRichText)) {
    return { changed: true, text };
  }
  return { changed: true, text, richText: editedRichText };
}

export { flattenPaperRichText };
