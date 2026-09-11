/**
 * Pure geometry helpers backing two Paper-workspace features that both hinge on "does this frame's rendered
 * content exceed its box": the editor-only overset indicator (a corner badge on frames whose laid-out text
 * clips, InDesign-style) and the "Fit Frame to Text" context-menu action (grows a clipping frame's height to
 * match its content). Both take plain numbers measured elsewhere (real DOM scrollHeight/clientHeight — see
 * PaperWorkspace.tsx's usePaperFrameContentOverset and fitFrameToTextAction) so the decisions here unit-test
 * without a DOM.
 */

/** Tolerance (in the same unit as the two sizes being compared, normally CSS px) for subpixel rounding jitter
 *  before a content/box size difference counts as real overflow. */
export const DEFAULT_FRAME_OVERSET_EPSILON_PX = 1;

/**
 * Does a frame's rendered content overflow its own box? `contentSize` is the content's natural, unclipped
 * extent (e.g. an element's `scrollHeight`); `boxSize` is the frame's fixed, visible extent (e.g. that same
 * element's `clientHeight`). Both must be the same unit and axis (this module is axis-agnostic — callers use
 * it for height, but it works identically for width).
 */
export function isFrameContentOverset(
  contentSize: number,
  boxSize: number,
  epsilon: number = DEFAULT_FRAME_OVERSET_EPSILON_PX,
): boolean {
  return contentSize - boxSize > epsilon;
}

export interface FitToTextFrameHeightInput {
  /** Measured natural height of the frame's content box (already includes that box's own CSS padding), in
   *  document mm — i.e. a DOM `scrollHeight` (px) already converted to mm at the current zoom. */
  contentBoxHeightMm: number;
  /**
   * Percentage (1..100) of the frame's own height the text box occupies — `resolvePaperTextBox(frame)
   * .heightPercent` (100 for plain text/caption frames, which have no inset and so pass straight through;
   * a bubble's inset, when this is reused for bubble kinds in future, shrinks it below 100).
   */
  textBoxHeightPercent: number;
  /** The frame's current heightMm — the result never goes below this ("Fit" only grows, never shrinks). */
  currentHeightMm: number;
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Convert a measured content height back into the frame heightMm needed to contain it without clipping,
 * respecting the textBox*Percent inset (see resolvePaperTextBox in src/lib/paperLayoutTools.ts): if the text
 * box occupies only `textBoxHeightPercent`% of the frame, the frame must be taller than the content alone by
 * that same factor so the inset proportions are preserved. Never returns less than `currentHeightMm` — this
 * is a "fit"/grow operation, not a shrink-to-fit one.
 */
export function computeFitToTextFrameHeightMm(input: FitToTextFrameHeightInput): number {
  const percent = Math.min(100, Math.max(1, input.textBoxHeightPercent)) / 100;
  const requiredHeightMm = input.contentBoxHeightMm / percent;
  return roundMm(Math.max(input.currentHeightMm, requiredHeightMm));
}
