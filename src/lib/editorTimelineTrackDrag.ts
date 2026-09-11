/**
 * Cross-track clip dragging for the Video sequencer (Phase 2D, gap audit 828/833): a clip block
 * dragged vertically onto a different track row should be able to change lanes, not just slide in
 * time. This module holds the pure math only — DOM rect collection and the pointer-event wiring
 * live in `VideoWorkspace.tsx`, which is the only caller.
 */

/** A single timeline lane's viewport rect, tagged with the track it represents. */
export interface TimelineLaneRect {
  trackIndex: number;
  top: number;
  bottom: number;
}

/**
 * Hit-tests a pointer's viewport Y coordinate against a set of stacked timeline lane rects to
 * decide which track a cross-track clip drag is currently hovering over.
 *
 * Returns `null` only when no rects are available (e.g. the DOM query came up empty — nothing to
 * hit-test against, so the caller should fall back to "no track change"). Otherwise a track is
 * always resolved: a pointer that strays above the top lane or below the bottom lane clamps to the
 * nearest one, matching common NLE drag feel (you don't need pixel-perfect aim to reach the
 * top/bottom track).
 */
export function resolveTimelineDropTrackIndex(
  pointerClientY: number,
  laneRects: readonly TimelineLaneRect[],
): number | null {
  if (laneRects.length === 0) {
    return null;
  }

  const sorted = [...laneRects].sort((a, b) => a.top - b.top);
  const contained = sorted.find((rect) => pointerClientY >= rect.top && pointerClientY < rect.bottom);

  if (contained) {
    return contained.trackIndex;
  }

  return pointerClientY < sorted[0].top
    ? sorted[0].trackIndex
    : sorted[sorted.length - 1].trackIndex;
}

/**
 * Pure trackIndex-patch builder for a cross-track clip drop. Resolves what trackIndex a clip
 * should end up with after a drag:
 * - No requested track (still dragging horizontally only) or the same track as today → unchanged.
 * - A different, unlocked track → the requested track.
 * - A different, locked track → rejected; the clip stays on its current track (same "leave the
 *   clip where it was" contract as every other locked-track guard in this file).
 */
export function resolveClipTrackIndexPatch(
  currentTrackIndex: number,
  requestedTrackIndex: number | undefined,
  isTrackLocked: (trackIndex: number) => boolean,
): number {
  if (requestedTrackIndex === undefined || requestedTrackIndex === currentTrackIndex) {
    return currentTrackIndex;
  }

  return isTrackLocked(requestedTrackIndex) ? currentTrackIndex : requestedTrackIndex;
}
