import type { PaperFrame, PaperRichParagraph, PaperTypography } from '../types/paper';
import { resolvePaperTextColumns } from './paperColumns';
import {
  flattenPaperRichTextSource,
  slicePaperRichTextRange,
  type PaperRichParagraphFragment,
} from './paperRichText';
import {
  flowPaperText,
  type PaperTextFlowSourceMetrics,
  type PaperTextFlowStyleSpan,
  type PaperTextFlowTypeSpec,
  type PaperTextMeasurer,
} from './paperTextFlow';
import { getPaperTextThreadFrames, isPaperTextThreadFrame } from './paperTextThreads';
import { resolveExclusionsForTextFrame } from './paperTextWrap';

export interface PaperThreadSlice {
  sourceText: string;
  /** Authoritative half-open [sourceStart, sourceEnd) window of this slice within the head story string. */
  sourceStart: number;
  sourceEnd: number;
  /**
   * The contiguous RICH slice of the head's richText that flows into this frame — present only when the thread's
   * head carries richText. Preserves paragraph/run styling, links, list markers and blank lines; derived by
   * slicing the head's authoritative richText at [sourceStart, sourceEnd). Undefined for plain-text threads.
   */
  richText?: PaperRichParagraphFragment[];
  isOverset: boolean;
  isHead: boolean;
}

/**
 * Project thread-owned stories onto their destination frames for non-interactive output consumers.
 * The document remains authoritative: this returns shallow frame copies and never writes slices back.
 */
export function resolvePaperThreadedFrames(
  frames: PaperFrame[],
  measure: PaperTextMeasurer,
  paddingMm = 0,
): PaperFrame[] {
  const slices = computePaperThreadSlices(frames, measure, paddingMm);
  if (slices.size === 0) return frames;
  return frames.map((frame) => {
    const slice = slices.get(frame.id);
    if (!slice) return frame;
    return {
      ...frame,
      text: slice.sourceText,
      richText: slice.richText?.length ? slice.richText : undefined,
    };
  });
}

export function paperTypographyToTextFlowSpec(typography: PaperTypography): PaperTextFlowTypeSpec {
  return {
    fontFamily: typography.fontFamily,
    fontSizePt: typography.fontSizePt,
    leadingPt: typography.leadingPt,
    tracking: typography.tracking,
    align: typography.align,
    fontWeight: typography.fontWeight,
    fontStyle: typography.fontStyle,
    fontStretch: typography.fontStretch,
    fontVariationSettings: typography.fontVariationSettings,
    fontKerning: typography.fontKerning,
    firstLineIndentMm: typography.firstLineIndentMm,
    spaceBeforeMm: typography.spaceBeforeMm,
    spaceAfterMm: typography.spaceAfterMm,
    dropCapLines: typography.dropCapLines,
    vertical: typography.writingMode === 'vertical-rl',
  };
}

const PT_TO_MM = 25.4 / 72;

/** Source-coordinate metrics for rich flow. Run overrides remain partial so unset values inherit the typography
 * of the destination frame, not the head. List prefixes are protected as one marker+tab source atom. */
function paperRichTextFlowMetrics(
  paragraphs: readonly PaperRichParagraph[],
  structuralDelimiters: NonNullable<PaperTextFlowSourceMetrics['structuralDelimiters']>,
): PaperTextFlowSourceMetrics {
  const protectedSpans: NonNullable<PaperTextFlowSourceMetrics['protectedSpans']> = [];
  const styleSpans: PaperTextFlowStyleSpan[] = [];
  const paragraphMetrics: NonNullable<PaperTextFlowSourceMetrics['paragraphs']> = [];
  let cursor = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraphIndex > 0) cursor += 1;
    const start = cursor;
    if (paragraph.listMarker) {
      const end = cursor + paragraph.listMarker.length + 1;
      protectedSpans.push({ start: cursor, end });
      cursor = end;
    }
    const contentStart = cursor;
    for (const run of paragraph.runs) {
      const runStart = cursor;
      cursor += run.text.length;
      if (cursor <= runStart) continue;
      const typeSpec: PaperTextFlowStyleSpan['typeSpec'] = {};
      if (run.fontFamily) typeSpec.fontFamily = run.fontFamily;
      if (run.fontSizePt != null) typeSpec.fontSizePt = run.fontSizePt;
      if (run.leadingPt != null) typeSpec.leadingPt = run.leadingPt;
      if (run.tracking != null) typeSpec.tracking = run.tracking;
      if (run.fontWeight) typeSpec.fontWeight = run.fontWeight;
      if (run.fontStyle) typeSpec.fontStyle = run.fontStyle;
      if (run.fontStretch) typeSpec.fontStretch = run.fontStretch;
      if (run.fontVariationSettings) typeSpec.fontVariationSettings = { ...run.fontVariationSettings };
      if (run.fontKerning) typeSpec.fontKerning = run.fontKerning;
      styleSpans.push({ start: runStart, end: cursor, typeSpec });
    }
    paragraphMetrics.push({
      start,
      end: cursor,
      contentStart,
      align: paragraph.align,
      leadingPt: paragraph.leadingPt,
      firstLineIndentMm: paragraph.firstLineIndentMm,
      leftIndentMm: paragraph.leftIndentMm,
      rightIndentMm: paragraph.rightIndentMm,
      hangingIndentMm: paragraph.hangingIndentMm,
      listMarkerIndentMm: paragraph.listMarker ? 4.5 : undefined,
      spaceBeforeMm: paragraph.spaceBeforeMm,
      spaceAfterMm: paragraph.spaceAfterMm,
      borderPaddingMm: paragraph.borders ? (paragraph.borders.paddingPt ?? 1.5) * PT_TO_MM : undefined,
      dropCapLines: paragraph.dropCapLines,
    });
  });

  return { protectedSpans, styleSpans, paragraphs: paragraphMetrics, structuralDelimiters };
}

/**
 * For every multi-frame text thread on the page, compute the contiguous slice of the thread's story
 * (stored on the head frame) that flows into each member frame, plus whether the final frame still
 * has overset text. Non-threaded and single-frame threads are omitted (they render their own text).
 */
export function computePaperThreadSlices(
  frames: PaperFrame[],
  measure: PaperTextMeasurer,
  paddingMm = 0,
): Map<string, PaperThreadSlice> {
  const result = new Map<string, PaperThreadSlice>();
  const threadIds = new Set(
    frames.filter(isPaperTextThreadFrame).map((frame) => frame.threadId as string),
  );

  for (const threadId of threadIds) {
    const members = getPaperTextThreadFrames(frames, threadId);
    if (members.length < 2) {
      continue;
    }

    const head = members[0];
    const headRichText = head.richText && head.richText.length > 0 ? head.richText : undefined;
    // When the head is rich, flow over the flatten of its authoritative richText so the offsets index the exact
    // string the rich slicer flattens — keeping displayText and the rich slice perfectly consistent. Otherwise
    // flow the head's plain text while retaining every authored plain-source byte in frame/overset ownership.
    const richSource = headRichText ? flattenPaperRichTextSource(headRichText) : undefined;
    const story = richSource?.text ?? (head.text ?? '');
    const richMetrics = headRichText && richSource
      ? paperRichTextFlowMetrics(headRichText, richSource.structuralDelimiters)
      : undefined;

    const flow = flowPaperText(
      story,
      paperTypographyToTextFlowSpec(head.typography),
      members.map((frame) => ({
        id: frame.id,
        columns: resolvePaperTextColumns(frame, paddingMm),
        exclusions: resolveExclusionsForTextFrame(frame, frames),
        typeSpec: paperTypographyToTextFlowSpec(frame.typography),
      })),
      measure,
      [],
      richMetrics,
    );

    flow.frames.forEach((frameResult, index) => {
      const slice: PaperThreadSlice = {
        sourceText: frameResult.sourceText,
        sourceStart: frameResult.sourceStart,
        sourceEnd: frameResult.sourceEnd,
        isOverset: index === flow.frames.length - 1 && !flow.fits,
        isHead: index === 0,
      };
      if (headRichText) {
        slice.richText = slicePaperRichTextRange(headRichText, frameResult.sourceStart, frameResult.sourceEnd);
      }
      result.set(frameResult.frameId, slice);
    });
  }

  return result;
}
