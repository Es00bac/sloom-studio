import type { EditorVisualClip } from '../types/flow';

export type TimelineClipEdge = 'start' | 'end';

export interface TrimVisualClipEdgeInput {
  edge: TimelineClipEdge;
  deltaSeconds: number;
  sourceDurationSeconds: number;
  shiftKey: boolean;
}

const MIN_CLIP_MS = 250;
const DEFAULT_SPLIT_EDGE_GUARD_SECONDS = 0.1;

export interface SelectedVisualClipCutTargetInput {
  clips: EditorVisualClip[];
  selectedClipId?: string;
  playheadSeconds: number;
  resolveDurationSeconds: (clip: EditorVisualClip) => number;
  edgeGuardSeconds?: number;
}

export function snapTimelineSeconds(value: number, shiftKey: boolean): number {
  return shiftKey ? Math.round(value) : value;
}

export function getSelectedVisualClipCutTarget({
  clips,
  selectedClipId,
  playheadSeconds,
  resolveDurationSeconds,
  edgeGuardSeconds = DEFAULT_SPLIT_EDGE_GUARD_SECONDS,
}: SelectedVisualClipCutTargetInput): { clipId: string; splitSeconds: number } | undefined {
  const selectedClip = selectedClipId
    ? clips.find((clip) => clip.id === selectedClipId)
    : undefined;

  if (!selectedClip) {
    return undefined;
  }

  const clipStartSeconds = selectedClip.startMs / 1000;
  const clipDurationSeconds = Math.max(0, resolveDurationSeconds(selectedClip));
  const clipEndSeconds = clipStartSeconds + clipDurationSeconds;

  if (
    playheadSeconds <= clipStartSeconds + edgeGuardSeconds ||
    playheadSeconds >= clipEndSeconds - edgeGuardSeconds
  ) {
    return undefined;
  }

  return {
    clipId: selectedClip.id,
    splitSeconds: playheadSeconds,
  };
}

export function splitVisualClipNonDestructively(
  clip: EditorVisualClip,
  splitSeconds: number,
  sourceDurationSeconds: number,
): [EditorVisualClip, EditorVisualClip] {
  const sourceDurationMs = Math.max(MIN_CLIP_MS, Math.round(sourceDurationSeconds * 1000));
  const clipStartSeconds = clip.startMs / 1000;
  const splitOffsetMs = Math.round(
    Math.max(0, splitSeconds - clipStartSeconds) * 1000 * Math.max(0.25, clip.playbackRate),
  );
  const sourceInMs = getClipSourceInMs(clip);
  const sourceOutMs = getClipSourceOutMs(clip, sourceDurationSeconds);
  const splitSourceMs = clamp(sourceInMs + splitOffsetMs, sourceInMs + MIN_CLIP_MS, sourceOutMs - MIN_CLIP_MS);
  const firstDurationSeconds = Math.max(0.25, (splitSourceMs - sourceInMs) / 1000 / Math.max(0.25, clip.playbackRate));
  const secondDurationSeconds = Math.max(0.25, (sourceOutMs - splitSourceMs) / 1000 / Math.max(0.25, clip.playbackRate));

  return [
    {
      ...clip,
      sourceInMs,
      sourceOutMs: splitSourceMs,
      trimStartMs: sourceInMs,
      trimEndMs: Math.max(0, sourceDurationMs - splitSourceMs),
      durationSeconds: isStillVisualClip(clip) ? firstDurationSeconds : clip.durationSeconds,
      transitionOut: 'none',
    },
    {
      ...clip,
      id: createDerivedClipId(clip.id),
      startMs: Math.round(splitSeconds * 1000),
      sourceInMs: splitSourceMs,
      sourceOutMs,
      trimStartMs: splitSourceMs,
      trimEndMs: Math.max(0, sourceDurationMs - sourceOutMs),
      durationSeconds: isStillVisualClip(clip) ? secondDurationSeconds : clip.durationSeconds,
      transitionIn: 'none',
    },
  ];
}

export function trimVisualClipEdge(
  clip: EditorVisualClip,
  input: TrimVisualClipEdgeInput,
): EditorVisualClip {
  const sourceDurationMs = Math.max(MIN_CLIP_MS, Math.round(input.sourceDurationSeconds * 1000));
  const deltaMs = Math.round(
    snapTimelineSeconds(input.deltaSeconds, input.shiftKey) * 1000 * Math.max(0.25, clip.playbackRate),
  );

  if (isStillVisualClip(clip)) {
    return trimStillClipEdge(clip, input.edge, deltaMs);
  }

  const sourceInMs = getClipSourceInMs(clip);
  const sourceOutMs = getClipSourceOutMs(clip, input.sourceDurationSeconds);

  if (input.edge === 'start') {
    const nextSourceInMs = clamp(sourceInMs + deltaMs, 0, sourceOutMs - MIN_CLIP_MS);
    const timelineDeltaMs = Math.round((nextSourceInMs - sourceInMs) / Math.max(0.25, clip.playbackRate));
    return {
      ...clip,
      startMs: Math.max(0, clip.startMs + timelineDeltaMs),
      sourceInMs: nextSourceInMs,
      trimStartMs: nextSourceInMs,
    };
  }

  const nextSourceOutMs = clamp(sourceOutMs + deltaMs, sourceInMs + MIN_CLIP_MS, sourceDurationMs);
  return {
    ...clip,
    sourceOutMs: nextSourceOutMs,
    trimEndMs: Math.max(0, sourceDurationMs - nextSourceOutMs),
  };
}

function trimStillClipEdge(clip: EditorVisualClip, edge: TimelineClipEdge, deltaMs: number): EditorVisualClip {
  const currentDurationMs = Math.round((clip.durationSeconds ?? 4) * 1000);

  if (edge === 'start') {
    const nextDurationMs = Math.max(MIN_CLIP_MS, currentDurationMs - deltaMs);
    const appliedDeltaMs = currentDurationMs - nextDurationMs;
    return {
      ...clip,
      startMs: Math.max(0, clip.startMs + appliedDeltaMs),
      durationSeconds: nextDurationMs / 1000,
    };
  }

  return {
    ...clip,
    durationSeconds: Math.max(MIN_CLIP_MS, currentDurationMs + deltaMs) / 1000,
  };
}

function getClipSourceInMs(clip: EditorVisualClip): number {
  return Math.max(0, clip.sourceOutMs === undefined ? (clip.trimStartMs ?? 0) : (clip.sourceInMs ?? clip.trimStartMs ?? 0));
}

function getClipSourceOutMs(clip: EditorVisualClip, sourceDurationSeconds: number): number {
  const sourceDurationMs = Math.max(MIN_CLIP_MS, Math.round(sourceDurationSeconds * 1000));
  return clamp(
    clip.sourceOutMs ?? sourceDurationMs - Math.max(0, clip.trimEndMs),
    getClipSourceInMs(clip) + MIN_CLIP_MS,
    sourceDurationMs,
  );
}

function isStillVisualClip(clip: EditorVisualClip): boolean {
  return clip.sourceKind === 'image' || clip.sourceKind === 'text' || clip.sourceKind === 'shape' || clip.sourceKind === 'comic';
}

function createDerivedClipId(id: string): string {
  return `${id}-split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
