/**
 * Paper AI frame-fix (owner request, task #32): right-click a comic/layout frame whose art has a
 * problem, point the model at CORRECT sibling frames on the same page as references, describe
 * what should be true and what is wrong, and let an edit-capable image model repaint the frame —
 * optionally only inside a marquee sub-region. Reuses the Image editor's generative-fill engine
 * (runGenerativeFill) end to end; the result comes home through the Source Library →
 * placeSourceAssetAt, the same battle-tested path as linked image edits.
 *
 * This module is the pure, canvas-free core: prompt assembly, sibling-reference collection, and
 * marquee-rect math. Rasterization (mask PNGs) lives with the dialog, which owns a canvas.
 */
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperFrame, PaperPage } from '../types/paper';
import type { GenerativeFillReferenceInput } from './imageEditorAi';
import { hasPaperAssetReference, resolvePaperFrameAssetUrl } from './paperAssetReferences';

export interface FrameFixSiblingCandidate {
  frameId: string;
  label: string;
  /** Data/blob URL of the sibling's placed art. */
  imageUrl: string;
}

/** Frames on the same page that carry image art the model can treat as correct examples. */
export function collectFrameFixSiblingCandidates(
  page: Pick<PaperPage, 'frames'>,
  targetFrameId: string,
  sourceItems: readonly Pick<SourceBinLibraryItem, 'id' | 'assetUrl'>[] = [],
): FrameFixSiblingCandidate[] {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  return page.frames.flatMap((frame) => {
    if (frame.id === targetFrameId) {
      return [];
    }
    const src = resolvePaperFrameAssetUrl(
      frame.asset,
      frame.asset?.sourceBinItemId ? sourceById.get(frame.asset.sourceBinItemId) : undefined,
    );
    if (!src || frame.asset?.kind !== 'image') {
      return [];
    }
    return [{
      frameId: frame.id,
      label: frame.label || frame.asset.label || frame.id,
      imageUrl: src,
    }];
  });
}

export interface FrameFixPromptInput {
  /** What the frame SHOULD look like (drawn from the correct siblings). */
  correctDescription: string;
  /** What is wrong in this frame. */
  incorrectDescription: string;
  referenceCount: number;
}

export function buildFrameFixPrompt({
  correctDescription,
  incorrectDescription,
  referenceCount,
}: FrameFixPromptInput): string {
  const lines: string[] = [];

  if (referenceCount > 0) {
    lines.push(
      `The ${referenceCount === 1 ? 'attached reference image shows' : `${referenceCount} attached reference images show`} `
      + 'the CORRECT appearance of this character/scene from sibling panels of the same comic page. '
      + 'Match their style, character design, colors, and proportions exactly.',
    );
  }

  const correct = correctDescription.trim();
  if (correct) {
    lines.push(`Correct appearance: ${correct}`);
  }

  const incorrect = incorrectDescription.trim();
  if (incorrect) {
    lines.push(`Fix this problem: ${incorrect}`);
  }

  lines.push('Preserve everything else in the panel unchanged — composition, framing, and line style stay as they are.');

  return lines.join('\n');
}

/** Marquee sub-selection in percent of the frame's art, normalized and clamped. */
export interface FrameFixMarqueeRect {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

/** Normalize a drag (any corner order, out-of-bounds) into a clamped marquee; null when degenerate. */
export function normalizeFrameFixMarquee(
  start: { xPercent: number; yPercent: number },
  end: { xPercent: number; yPercent: number },
): FrameFixMarqueeRect | null {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const x1 = clamp(Math.min(start.xPercent, end.xPercent));
  const y1 = clamp(Math.min(start.yPercent, end.yPercent));
  const x2 = clamp(Math.max(start.xPercent, end.xPercent));
  const y2 = clamp(Math.max(start.yPercent, end.yPercent));
  const widthPercent = x2 - x1;
  const heightPercent = y2 - y1;

  if (widthPercent < 1 || heightPercent < 1) {
    return null;
  }

  return { xPercent: x1, yPercent: y1, widthPercent, heightPercent };
}

/** The references array runGenerativeFill expects, with per-sibling framing text baked in. */
export function buildFrameFixReferences(
  selected: FrameFixSiblingCandidate[],
): GenerativeFillReferenceInput[] {
  return selected.map((candidate, index) => ({
    id: candidate.frameId,
    label: candidate.label,
    description: `Correct example ${index + 1} (sibling panel "${candidate.label}") — match this appearance.`,
    imageUrl: candidate.imageUrl,
  }));
}

/** A frame qualifies for AI fix when it carries raster image art the model can edit. */
export function canFrameBeAiFixed(frame: Pick<PaperFrame, 'asset'> | undefined): boolean {
  return Boolean(hasPaperAssetReference(frame?.asset) && frame?.asset?.kind === 'image');
}
