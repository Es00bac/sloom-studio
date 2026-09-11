import type { EditorVisualClip } from '../../../types/flow';

/**
 * Three-point editing core (owner-approved pro-editor quartet, item 3).
 *
 * Pure timeline math so insert/overwrite semantics are unit-testable without React or the
 * workspace's layout plumbing. Callers supply clip BLOCKS — the workspace's already-computed
 * `{ clip, startMs, durationMs }` layout — so effective durations (trims, playback rate, source
 * length) stay the workspace's single source of truth.
 */

export interface SourceMarks {
  inSeconds?: number;
  outSeconds?: number;
}

export interface VisualClipBlock {
  clip: EditorVisualClip;
  startMs: number;
  durationMs: number;
}

/** Normalize I/O marks against the source duration: in < out, clamped, whole-clip fallback. */
export function normalizeSourceMarks(
  marks: SourceMarks,
  sourceDurationSeconds: number,
): { sourceInMs: number; sourceOutMs: number } {
  const durationMs = Math.max(0, Math.round(sourceDurationSeconds * 1000));
  const rawIn = Math.round((marks.inSeconds ?? 0) * 1000);
  const rawOut = Math.round((marks.outSeconds ?? sourceDurationSeconds) * 1000);
  const sourceInMs = Math.max(0, Math.min(rawIn, durationMs));
  const sourceOutMs = Math.max(sourceInMs + 1, Math.min(Math.max(rawOut, sourceInMs + 1), durationMs || sourceInMs + 1));
  return { sourceInMs, sourceOutMs };
}

/**
 * INSERT: everything on the target track at/after the playhead shifts right to make room.
 * Straddling clips must be split by the caller BEFORE the shift (the workspace already owns
 * split-at-playhead); this function then only ever moves whole clips.
 */
export function shiftTrackClipsForInsert(
  clips: readonly EditorVisualClip[],
  trackIndex: number,
  playheadMs: number,
  insertDurationMs: number,
): EditorVisualClip[] {
  return clips.map((clip) =>
    clip.trackIndex === trackIndex && clip.startMs >= playheadMs
      ? { ...clip, startMs: clip.startMs + insertDurationMs }
      : clip,
  );
}

/**
 * OVERWRITE: clear [playheadMs, playheadMs + durationMs) on the target track.
 * - fully covered clip -> removed
 * - clip overlapping the range start -> right side trimmed (trimEndMs grows)
 * - clip overlapping the range end -> left side trimmed (trimStartMs grows, startMs advances)
 * - clip straddling the whole range -> split into a left-trimmed and a right-trimmed copy
 * Trims are expressed in SOURCE time (timeline ms * playbackRate), matching the clip model.
 */
export function overwriteTrackRange(
  blocks: readonly VisualClipBlock[],
  trackIndex: number,
  playheadMs: number,
  durationMs: number,
): { clips: EditorVisualClip[]; removedClipIds: string[] } {
  const rangeStart = playheadMs;
  const rangeEnd = playheadMs + durationMs;
  const removedClipIds: string[] = [];
  const clips: EditorVisualClip[] = [];

  for (const block of blocks) {
    const { clip } = block;
    if (clip.trackIndex !== trackIndex) {
      clips.push(clip);
      continue;
    }
    const blockStart = block.startMs;
    const blockEnd = block.startMs + block.durationMs;
    const rate = Math.max(0.01, clip.playbackRate || 1);

    if (blockEnd <= rangeStart || blockStart >= rangeEnd) {
      clips.push(clip);
      continue;
    }
    if (blockStart >= rangeStart && blockEnd <= rangeEnd) {
      removedClipIds.push(clip.id);
      continue;
    }
    if (blockStart < rangeStart && blockEnd > rangeEnd) {
      // Straddles the whole range: keep the head, clone a tail after the range.
      const headTrimMs = Math.round((blockEnd - rangeStart) * rate);
      const tailTrimMs = Math.round((rangeEnd - blockStart) * rate);
      clips.push({ ...clip, trimEndMs: clip.trimEndMs + headTrimMs });
      clips.push({
        ...clip,
        id: `${clip.id}-owr-${Math.random().toString(36).slice(2, 8)}`,
        startMs: rangeEnd,
        trimStartMs: clip.trimStartMs + tailTrimMs,
      });
      continue;
    }
    if (blockStart < rangeStart) {
      // Overlaps the range start: trim the right side away.
      clips.push({ ...clip, trimEndMs: clip.trimEndMs + Math.round((blockEnd - rangeStart) * rate) });
      continue;
    }
    // Overlaps the range end: trim the left side away and start after the range.
    clips.push({
      ...clip,
      startMs: rangeEnd,
      trimStartMs: clip.trimStartMs + Math.round((rangeEnd - blockStart) * rate),
    });
  }

  return { clips, removedClipIds };
}
