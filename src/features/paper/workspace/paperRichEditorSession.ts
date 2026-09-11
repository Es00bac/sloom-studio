import {
  collectEffectiveRichEditorSelectionTypographies,
  createRichEditorBase,
  effectiveRichEditorTextNodeTypography,
  managedEditorPaintForTypography,
  paperFontVariationSettingsToCss,
  type RichEditorManagedPaintContext,
} from '../../../lib/paperRichTextDom';
import {
  paperFontObliqueAngleFromCss,
  paperFontStyleDescriptor,
  paperFontStyleFromCss,
  requestedExactPaperManagedFacesForTypographyPatch,
} from '../../../lib/paperExactManagedFonts';
import type { PaperManagedFontFace, PaperRichParagraph, PaperTypography } from '../../../types/paper';
import {
  changedRichTypographyPatch,
  synchronizeRichTextWithTypographyChange,
  type RichTypographyKey,
  type RichTypographyPatch,
} from './richTextTransforms';

const PT_TO_PX = 1.333;
const MM_TO_PX = 3.7795;

export interface PaperRichEditorApplyResult {
  richText: PaperRichParagraph[];
  text: string;
}

/**
 * One operation-scoped authority follows an asynchronous Inspector edit through the live editor.
 * It is intentionally structural so the bundled-font browser can supply its irreversible selection
 * authority without coupling this editor-session module to a React component.
 */
export interface PaperRichEditorCommitAuthority {
  isCurrent: () => boolean;
}

export interface PaperRichEditorCommitContext {
  authority?: PaperRichEditorCommitAuthority;
  /** Transient exact faces authenticated by the initiating operation but not yet durably committed. */
  managedFonts?: readonly PaperManagedFontFace[];
}

export interface PaperRichEditorSession {
  /**
   * A promise is returned when the edit selects an exact managed face: the live editor must authenticate
   * the registered face before painting or committing it, and a rejection means the edit was refused with
   * no DOM or document change.
   */
  applyTypography: (
    previous: PaperTypography,
    next: PaperTypography,
    context?: PaperRichEditorCommitContext,
  ) => PaperRichEditorApplyResult | null | Promise<PaperRichEditorApplyResult | null>;
}

const sessions = new Map<string, PaperRichEditorSession>();

export function registerPaperRichEditorSession(frameId: string, session: PaperRichEditorSession): () => void {
  sessions.set(frameId, session);
  return () => {
    if (sessions.get(frameId) === session) sessions.delete(frameId);
  };
}

export function applyTypographyToActiveRichEditor(
  frameId: string,
  previous: PaperTypography,
  next: PaperTypography,
  context?: PaperRichEditorCommitContext,
): PaperRichEditorApplyResult | null | Promise<PaperRichEditorApplyResult | null> {
  if (context?.authority && !context.authority.isCurrent()) return null;
  return sessions.get(frameId)?.applyTypography(previous, next, context) ?? null;
}

export interface PaperRichEditorTypographyUpdate {
  typography: PaperTypography;
  text?: string;
  richText: PaperRichParagraph[] | undefined;
}

/**
 * Preserve the frame-level typography alongside any retained rich-editor transaction. Some properties, such
 * as writingMode, belong to the frame rather than a run or paragraph; dropping this half of the transaction
 * makes an active selection appear to accept vertical writing while silently retaining the old direction.
 * Returns a promise when the active editor must first authenticate an exact managed face; a rejected promise
 * means the whole update was refused and nothing may be committed.
 */
export function resolvePaperRichEditorTypographyUpdate(
  frameId: string,
  previous: PaperTypography,
  next: PaperTypography,
  currentRichText: PaperRichParagraph[] | undefined,
  context?: PaperRichEditorCommitContext,
): PaperRichEditorTypographyUpdate | Promise<PaperRichEditorTypographyUpdate> {
  const fallback = (): PaperRichEditorTypographyUpdate => ({
    typography: next,
    richText: synchronizeRichTextWithTypographyChange(currentRichText, previous, next),
  });
  const live = applyTypographyToActiveRichEditor(frameId, previous, next, context);
  if (live && typeof (live as Promise<PaperRichEditorApplyResult | null>).then === 'function') {
    return (live as Promise<PaperRichEditorApplyResult | null>).then((result) => (result
      ? { typography: next, text: result.text, richText: result.richText }
      : fallback()));
  }
  const applied = live as PaperRichEditorApplyResult | null;
  if (applied) return { typography: next, text: applied.text, richText: applied.richText };
  return fallback();
}

const CHARACTER_KEYS = new Set<RichTypographyKey>([
  'fontFamily', 'fontSizePt', 'leadingPt', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings',
  'fontKerning', 'color', 'tracking', 'smallCaps',
  'numericStyle', 'textOrientation', 'emphasis',
]);

/** Typography keys that change which exact managed face the text requests. */
export const FACE_SELECTING_TYPOGRAPHY_KEYS = [
  'fontFamily', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings',
] as const satisfies readonly RichTypographyKey[];

const PARAGRAPH_KEYS = new Set<RichTypographyKey>([
  'align', 'alignLast', 'leadingPt', 'hyphenate', 'lineBreak', 'lineBreakStrict', 'firstLineIndentMm',
  'spaceBeforeMm', 'spaceAfterMm', 'dropCapLines',
]);

function emphasisCss(value: PaperTypography['emphasis']): string {
  if (value === 'dot') return 'filled dot';
  if (value === 'open-dot') return 'open dot';
  if (value === 'sesame') return 'filled sesame';
  if (value === 'circle') return 'filled circle';
  return 'none';
}

function numericCss(value: PaperTypography['numericStyle']): string {
  if (value === 'oldstyle') return 'oldstyle-nums';
  if (value === 'lining') return 'lining-nums';
  if (value === 'tabular') return 'tabular-nums';
  return 'normal';
}

function boundaryOffset(root: HTMLElement, container: Node, offset: number): number {
  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(container, offset);
  return probe.toString().length;
}

/** Wrap each selected text-node slice independently. Unlike Range.surroundContents this remains valid when a
 * selection crosses paragraphs, links, or existing style spans. The returned range covers exactly the same
 * visible text after the DOM is split. */
function wrapSelectedText(root: HTMLElement, range: Range, styleSpan: (span: HTMLSpanElement, selected: Text) => void): Range | null {
  const start = boundaryOffset(root, range.startContainer, range.startOffset);
  const end = boundaryOffset(root, range.endContainer, range.endOffset);
  if (end <= start) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Array<{ node: Text; start: number; end: number }> = [];
  let cursor = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + length;
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(length, end - nodeStart);
    if (localEnd > localStart && !node.parentElement?.closest('[data-paper-marker]')) {
      targets.push({ node, start: localStart, end: localEnd });
    }
    cursor = nodeEnd;
    node = walker.nextNode() as Text | null;
  }
  if (!targets.length) return null;

  let first: HTMLSpanElement | null = null;
  let last: HTMLSpanElement | null = null;
  for (const target of targets) {
    let selected = target.node;
    if (target.start > 0) selected = selected.splitText(target.start);
    const selectedLength = target.end - target.start;
    if (selectedLength < selected.data.length) selected.splitText(selectedLength);
    const span = document.createElement('span');
    styleSpan(span, selected);
    selected.parentNode?.insertBefore(span, selected);
    span.appendChild(selected);
    first ??= span;
    last = span;
  }

  if (!first || !last) return null;
  const next = document.createRange();
  next.setStartBefore(first);
  next.setEndAfter(last);
  return next;
}

function applyCharacterPatch(
  editor: HTMLElement,
  range: Range,
  patch: Partial<PaperTypography>,
  zoom: number,
  managedPaint?: RichEditorManagedPaintContext,
): Range | null {
  const touchesFace = FACE_SELECTING_TYPOGRAPHY_KEYS.some((key) => key in patch);
  const base = managedPaint
    ? createRichEditorBase(managedPaint.typography, zoom, managedPaint.managedFonts)
    : undefined;
  return wrapSelectedText(editor, range, (span, selected) => {
    // Resolve from this selected run before wrapping it. A selection may span multiple managed families;
    // each slice must retain its own family while changing only the requested face descriptor.
    const effective = managedPaint && base
      ? effectiveRichEditorTextNodeTypography(editor, selected, managedPaint.typography, base)
      : undefined;
    const managed = managedPaint && touchesFace && effective
      ? managedEditorPaintForTypography({ ...effective, ...patch }, managedPaint.managedFonts)
      : undefined;
    if (managed) {
      span.style.fontFamily = managed.paintFamily;
      span.dataset.paperFontFamily = managed.sourceFamily;
    } else if ('fontFamily' in patch) {
      span.style.fontFamily = patch.fontFamily ?? '';
    }
    if ('fontSizePt' in patch) span.style.fontSize = `${((patch.fontSizePt ?? 0) * PT_TO_PX * zoom).toFixed(2)}px`;
    if ('leadingPt' in patch) {
      span.style.lineHeight = `${((patch.leadingPt ?? 0) * PT_TO_PX * zoom).toFixed(2)}px`;
      setData(span, 'paperLeading', patch.leadingPt);
    }
    if ('fontWeight' in patch) span.style.fontWeight = patch.fontWeight ?? '400';
    if ('fontStyle' in patch) {
      const value = patch.fontStyle ?? 'normal';
      span.style.fontStyle = value;
      // Mirror an authored oblique descriptor: computed styles drop `oblique <angle>` in some engines.
      if (paperFontStyleFromCss(value) === 'oblique') {
        span.dataset.paperFontStyle = paperFontStyleDescriptor('oblique', paperFontObliqueAngleFromCss(value));
      } else {
        delete span.dataset.paperFontStyle;
      }
    }
    if ('fontStretch' in patch) span.style.fontStretch = patch.fontStretch ?? '';
    if ('fontVariationSettings' in patch) span.style.setProperty('font-variation-settings', paperFontVariationSettingsToCss(patch.fontVariationSettings));
    if ('fontKerning' in patch) span.style.fontKerning = patch.fontKerning ?? 'auto';
    if ('color' in patch) span.style.color = patch.color ?? '';
    if ('tracking' in patch) span.style.letterSpacing = `${(patch.tracking ?? 0) / 1000}em`;
    if ('smallCaps' in patch) span.style.fontVariantCaps = patch.smallCaps ? 'small-caps' : 'normal';
    if ('numericStyle' in patch) span.style.fontVariantNumeric = numericCss(patch.numericStyle);
    if ('textOrientation' in patch) span.style.textOrientation = patch.textOrientation ?? 'mixed';
    if ('emphasis' in patch) span.style.setProperty('text-emphasis', emphasisCss(patch.emphasis));
  });
}

export interface RunPaperRichEditorCommandOptions {
  editor: HTMLElement;
  range: Range | null;
  typography: PaperTypography;
  zoom: number;
  managedFonts: readonly PaperManagedFontFace[];
  command: string;
  value?: string;
  isCommandActive: (command: string) => boolean;
  authenticateFace: (face: PaperManagedFontFace) => Promise<unknown>;
  executeFacePatch?: (patch: Partial<PaperTypography>) => void;
  executeCollapsedManagedCommand?: (face: PaperManagedFontFace, patch: Partial<PaperTypography>) => void;
  executeCommand: (command: string, value?: string) => void;
}

/**
 * Authenticate every exact face selected by Bold/Italic before execCommand may touch the DOM. Rejection or
 * face-resolution failure exits before executeCommand, so both toolbar and keyboard callers are atomic.
 */
export async function runPaperRichEditorCommand(options: RunPaperRichEditorCommandOptions): Promise<void> {
  const { command } = options;
  const patch: Partial<PaperTypography> | undefined = command === 'bold'
    ? { fontWeight: options.isCommandActive(command) ? '400' : '700' }
    : command === 'italic'
      ? { fontStyle: options.isCommandActive(command) ? 'normal' : 'italic' }
      : undefined;
  if (patch) {
    const base = createRichEditorBase(options.typography, options.zoom, options.managedFonts);
    const selected = collectEffectiveRichEditorSelectionTypographies(
      options.editor,
      options.range,
      options.typography,
      base,
    );
    const typographies = selected.length ? selected : [options.typography];
    const faces = requestedExactPaperManagedFacesForTypographyPatch(typographies, patch, options.managedFonts);
    await Promise.all(faces.map((face) => options.authenticateFace(face)));
    if (faces.length > 0 && options.executeFacePatch && !options.range?.collapsed) {
      options.executeFacePatch(patch);
      return;
    }
    if (faces.length === 1 && options.executeCollapsedManagedCommand && options.range?.collapsed) {
      options.executeCollapsedManagedCommand(faces[0], patch);
      return;
    }
  }
  options.executeCommand(command, options.value);
}

function blocksTouchedByRange(editor: HTMLElement, range: Range): HTMLElement[] {
  const blocks = Array.from(editor.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && (child.nodeName === 'DIV' || child.nodeName === 'P' || child.nodeName === 'LI'));
  const touched = blocks.filter((block) => {
    try { return range.intersectsNode(block); } catch { return false; }
  });
  if (touched.length) return touched;
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== editor) node = node.parentNode;
  return node instanceof HTMLElement ? [node] : [];
}

function setData(el: HTMLElement, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined) delete el.dataset[key];
  else el.dataset[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
}

function applyParagraphPatch(editor: HTMLElement, range: Range, patch: Partial<PaperTypography>, zoom: number): boolean {
  const blocks = blocksTouchedByRange(editor, range);
  for (const el of blocks) {
    if ('align' in patch) { setData(el, 'align', patch.align); el.style.textAlign = patch.align ?? 'left'; }
    if ('alignLast' in patch) { setData(el, 'al', patch.alignLast); el.style.textAlignLast = patch.alignLast ?? 'auto'; }
    if ('leadingPt' in patch) {
      setData(el, 'lead', patch.leadingPt);
      el.style.lineHeight = `${((patch.leadingPt ?? 0) * PT_TO_PX * zoom).toFixed(2)}px`;
    }
    if ('hyphenate' in patch) { setData(el, 'hyph', patch.hyphenate); el.style.hyphens = patch.hyphenate ? 'auto' : 'manual'; }
    if ('lineBreak' in patch) {
      setData(el, 'lb', patch.lineBreak);
      el.style.setProperty('text-wrap-style', patch.lineBreak && patch.lineBreak !== 'auto' ? patch.lineBreak : 'auto');
    }
    if ('lineBreakStrict' in patch) {
      setData(el, 'lbs', patch.lineBreakStrict);
      el.style.lineBreak = patch.lineBreakStrict ? 'strict' : 'auto';
    }
    if ('firstLineIndentMm' in patch) {
      setData(el, 'fi', patch.firstLineIndentMm);
      el.style.textIndent = `${((patch.firstLineIndentMm ?? 0) * MM_TO_PX * zoom).toFixed(2)}px`;
    }
    if ('spaceBeforeMm' in patch) {
      setData(el, 'sb', patch.spaceBeforeMm);
      el.style.marginTop = `${((patch.spaceBeforeMm ?? 0) * MM_TO_PX * zoom).toFixed(2)}px`;
    }
    if ('spaceAfterMm' in patch) {
      setData(el, 'sa', patch.spaceAfterMm);
      el.style.marginBottom = `${((patch.spaceAfterMm ?? 0) * MM_TO_PX * zoom).toFixed(2)}px`;
    }
    if ('dropCapLines' in patch) {
      const lines = Math.max(0, Math.round(patch.dropCapLines ?? 0));
      setData(el, 'dc', lines || undefined);
      el.classList.toggle('paper-dropcap', lines >= 2);
      if (lines >= 2) el.style.setProperty('--sl-dropcap-lines', String(lines));
      else el.style.removeProperty('--sl-dropcap-lines');
    }
  }
  return blocks.length > 0;
}

export interface ApplyTypographyToDomSelectionResult {
  range: Range;
  applied: boolean;
}

export function applyTypographyPatchToDomSelection(
  editor: HTMLElement,
  savedRange: Range | null,
  patch: Partial<RichTypographyPatch>,
  zoom: number,
  managedPaint?: RichEditorManagedPaintContext,
): ApplyTypographyToDomSelectionResult | null {
  if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) return null;
  const changedKeys = Object.keys(patch) as RichTypographyKey[];
  if (!changedKeys.length) return null;

  const characterKeys = changedKeys.filter((key) => CHARACTER_KEYS.has(key));
  // Leading is a paragraph property at a caret, but a highlighted range authors an explicit run override.
  const paragraphKeys = changedKeys.filter((key) => PARAGRAPH_KEYS.has(key) && !(key === 'leadingPt' && !savedRange.collapsed));
  const hasCharacters = characterKeys.length > 0;
  const hasParagraphs = paragraphKeys.length > 0;
  if (savedRange.collapsed && hasCharacters && !hasParagraphs) return null;

  let range = savedRange.cloneRange();
  let applied = false;
  if (hasCharacters && !range.collapsed) {
    const characterPatch = Object.fromEntries(characterKeys.map((key) => [key, patch[key]]));
    const nextRange = applyCharacterPatch(editor, range, characterPatch, zoom, managedPaint);
    if (nextRange) { range = nextRange; applied = true; }
  }
  if (hasParagraphs) {
    const paragraphPatch = Object.fromEntries(paragraphKeys.map((key) => [key, patch[key]]));
    applied = applyParagraphPatch(editor, range, paragraphPatch, zoom) || applied;
  }
  return applied ? { range, applied } : null;
}

/** Apply one Inspector/advanced-toolbar typography edit to the retained editor range. Character properties
 * require highlighted text; paragraph properties also work at a caret and target its current paragraph. */
export function applyTypographyToDomSelection(
  editor: HTMLElement,
  savedRange: Range | null,
  previous: PaperTypography,
  next: PaperTypography,
  zoom: number,
  managedPaint?: RichEditorManagedPaintContext,
): ApplyTypographyToDomSelectionResult | null {
  const patch = changedRichTypographyPatch(previous, next);
  return applyTypographyPatchToDomSelection(editor, savedRange, patch, zoom, managedPaint);
}
