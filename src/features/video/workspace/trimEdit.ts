import type { EditorVisualClip } from '../../../types/flow';
import type { VisualClipBlock } from './threePointEdit';

/**
 * Ripple + roll trim math (owner-approved pro-editor quartet, item 4 — the last one).
 *
 * Playhead-driven (keyboard-first, like the JKL transport): Q ripples the selected clip's IN edge
 * to the playhead, W ripples its OUT edge, E rolls the nearest cut on its lane to the playhead.
 * Pure functions over the workspace's `{ clip, startMs, durationMs }` blocks; trims are stored in
 * SOURCE time (timeline ms x playbackRate), matching the clip model everywhere else.
 */

const MIN_CLIP_DURATION_MS = 40;

function rateOf(clip: EditorVisualClip): number {
  return Math.max(0.01, clip.playbackRate || 1);
}

/**
 * Ripple-trim one edge of a clip to `targetMs` (timeline time). The clip's start stays anchored;
 * content is trimmed/extended on that edge and every later clip on the lane shifts by the length
 * change so the cut after it stays tight. Returns null when the target is a no-op or impossible
 * (no media left to extend into, or the clip would collapse).
 */
export function rippleTrimClipToTarget(
  blocks: readonly VisualClipBlock[],
  clipId: string,
  edge: 'in' | 'out',
  targetMs: number,
): EditorVisualClip[] | null {
  const block = blocks.find((candidate) => candidate.clip.id === clipId);
  if (!block) return null;
  const { clip } = block;
  const rate = rateOf(clip);
  const blockEnd = block.startMs + block.durationMs;

  // Positive delta = the clip gets SHORTER by delta timeline-ms on that edge.
  const delta = edge === 'in' ? targetMs - block.startMs : blockEnd - targetMs;
  if (delta === 0) return null;

  const trimField = edge === 'in' ? clip.trimStartMs : clip.trimEndMs;
  const nextTrim = trimField + Math.round(delta * rate);
  if (nextTrim < 0) return null; // extending past the available media
  if (block.durationMs - delta < MIN_CLIP_DURATION_MS) return null; // collapsing the clip

  return blocks.map(({ clip: candidate }) => {
    if (candidate.id === clipId) {
      return edge === 'in'
        ? { ...candidate, trimStartMs: nextTrim }
        : { ...candidate, trimEndMs: nextTrim };
    }
    if (candidate.trackIndex === clip.trackIndex && candidate.startMs > block.startMs) {
      return { ...candidate, startMs: Math.max(0, candidate.startMs - delta) };
    }
    return candidate;
  });
}

/** The cut point between two adjacent clips on a lane nearest to `nearMs`, if any. */
export function findNearestEditPoint(
  blocks: readonly VisualClipBlock[],
  trackIndex: number,
  nearMs: number,
  toleranceMs = Number.POSITIVE_INFINITY,
): { leftClipId: string; rightClipId: string; cutMs: number } | null {
  const lane = blocks
    .filter((block) => block.clip.trackIndex === trackIndex)
    .sort((a, b) => a.startMs - b.startMs);
  let best: { leftClipId: string; rightClipId: string; cutMs: number } | null = null;
  for (let index = 0; index < lane.length - 1; index += 1) {
    const left = lane[index];
    const right = lane[index + 1];
    const leftEnd = left.startMs + left.durationMs;
    if (Math.abs(leftEnd - right.startMs) > 1) continue; // not a tight cut
    const cutMs = right.startMs;
    if (best === null || Math.abs(cutMs - nearMs) < Math.abs(best.cutMs - nearMs)) {
      best = { leftClipId: left.clip.id, rightClipId: right.clip.id, cutMs };
    }
  }
  if (best && Math.abs(best.cutMs - nearMs) > toleranceMs) return null;
  return best;
}

/**
 * Roll the cut between two adjacent clips to `targetMs`: the left clip's tail and the right
 * clip's head move together, total lane length unchanged. Clamped by both clips' available media
 * and minimum durations; returns null when nothing can move.
 */
export function rollEditPointToTarget(
  blocks: readonly VisualClipBlock[],
  leftClipId: string,
  rightClipId: string,
  targetMs: number,
): EditorVisualClip[] | null {
  const left = blocks.find((candidate) => candidate.clip.id === leftClipId);
  const right = blocks.find((candidate) => candidate.clip.id === rightClipId);
  if (!left || !right) return null;
  const cutMs = right.startMs;
  const leftRate = rateOf(left.clip);
  const rightRate = rateOf(right.clip);

  // delta > 0 rolls the cut right: left extends (consumes its tail media), right's head trims.
  let delta = targetMs - cutMs;
  const maxExtendLeft = Math.floor(left.clip.trimEndMs / leftRate);
  const maxShortenRight = right.durationMs - MIN_CLIP_DURATION_MS;
  const maxExtendRight = Math.floor(right.clip.trimStartMs / rightRate);
  const maxShortenLeft = left.durationMs - MIN_CLIP_DURATION_MS;
  const upper = Math.min(maxExtendLeft, maxShortenRight);
  const lower = -Math.min(maxExtendRight, maxShortenLeft);
  delta = Math.max(lower, Math.min(upper, delta));
  if (delta === 0) return null;

  return blocks.map(({ clip: candidate }) => {
    if (candidate.id === leftClipId) {
      return { ...candidate, trimEndMs: candidate.trimEndMs - Math.round(delta * leftRate) };
    }
    if (candidate.id === rightClipId) {
      return {
        ...candidate,
        startMs: cutMs + delta,
        trimStartMs: candidate.trimStartMs + Math.round(delta * rightRate),
      };
    }
    return candidate;
  });
}
