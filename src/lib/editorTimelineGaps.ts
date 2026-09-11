import type { EditorVisualClip } from '../types/flow';

export interface TimelineGap {
  id?: string;
  trackIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface TimelineGapBlock {
  id: string;
  trackIndex: number;
  startSeconds: number;
  endSeconds: number;
}

export function findTimelineGaps(blocks: TimelineGapBlock[], trackIndex: number): Required<TimelineGap>[] {
  const sorted = blocks
    .filter((block) => block.trackIndex === trackIndex)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
  const gaps: Required<TimelineGap>[] = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const currentEnd = sorted[index]?.endSeconds ?? 0;
    const nextStart = sorted[index + 1]?.startSeconds ?? currentEnd;

    if (nextStart - currentEnd <= 0.001) {
      continue;
    }

    gaps.push({
      id: `gap-${trackIndex}-${currentEnd.toFixed(3)}-${nextStart.toFixed(3)}`,
      trackIndex,
      startSeconds: currentEnd,
      endSeconds: nextStart,
      durationSeconds: nextStart - currentEnd,
    });
  }

  return gaps;
}

export function fillTimelineGap(clips: EditorVisualClip[], gap: TimelineGap): EditorVisualClip[] {
  const deltaMs = Math.round(gap.durationSeconds * 1000);
  const gapEndMs = Math.round(gap.endSeconds * 1000);

  return clips.map((clip) => {
    if (clip.trackIndex !== gap.trackIndex || clip.startMs < gapEndMs) {
      return clip;
    }

    return {
      ...clip,
      startMs: Math.max(0, clip.startMs - deltaMs),
    };
  });
}
