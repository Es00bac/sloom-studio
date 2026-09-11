import type { EditorVisualClip } from '../types/flow';
import { resolveVisualClipSourceRangeMs } from './editorTimelineSourceRange';

export type TimelineClipFrameEdge = 'first' | 'last';

const EDGE_FRAME_SAFETY_SECONDS = 0.05;

export function getTimelineClipFrameExportTimeSeconds(
  clip: EditorVisualClip,
  sourceDurationSeconds: number,
  edge: TimelineClipFrameEdge,
): number {
  const sourceRange = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds);
  const sourceStartSeconds = sourceRange.sourceInMs / 1000;
  const sourceEndSeconds = Math.max(sourceStartSeconds, sourceRange.sourceOutMs / 1000);
  const visibleSourceDurationSeconds = Math.max(0, sourceEndSeconds - sourceStartSeconds);
  const safetyOffsetSeconds = Math.min(
    EDGE_FRAME_SAFETY_SECONDS,
    visibleSourceDurationSeconds > 0 ? visibleSourceDurationSeconds / 10 : 0,
  );
  const lastFrameSeconds = Math.max(sourceStartSeconds, sourceEndSeconds - safetyOffsetSeconds);
  const targetSeconds = edge === 'first'
    ? clip.reversePlayback ? lastFrameSeconds : sourceStartSeconds
    : clip.reversePlayback ? sourceStartSeconds : lastFrameSeconds;

  return roundFrameTime(targetSeconds);
}

export function buildTimelineClipFrameExportLabel(
  sourceLabel: string,
  edge: TimelineClipFrameEdge,
): string {
  const baseLabel = sourceLabel.trim().replace(/\.[^./\\]+$/, '') || 'timeline clip';
  return `${baseLabel} ${edge} frame`;
}

function roundFrameTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}
