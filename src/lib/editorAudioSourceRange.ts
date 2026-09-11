import type { EditorAudioClip, EditorAudioKeyframe, TimelineAutomationPoint } from '../types/flow';
import { normalizeAutomationPoints } from './clipAutomation';
import { normalizeAudioKeyframes } from './editorKeyframes';

export const MIN_EDITOR_AUDIO_CLIP_DURATION_MS = 10;

export interface ResolvedEditorAudioSourceRange {
  sourceInMs: number;
  sourceOutMs: number;
  durationMs: number;
}

export function resolveEditorAudioSourceRangeMs(
  clip: Pick<EditorAudioClip, 'sourceInMs' | 'sourceOutMs'>,
  sourceDurationSeconds: number,
): ResolvedEditorAudioSourceRange {
  const sourceDurationMs = Math.max(0, Math.round((Number.isFinite(sourceDurationSeconds) ? sourceDurationSeconds : 0) * 1_000));
  if (sourceDurationMs <= 0) return { sourceInMs: 0, sourceOutMs: 0, durationMs: 0 };

  const minimum = Math.min(MIN_EDITOR_AUDIO_CLIP_DURATION_MS, sourceDurationMs);
  const sourceInMs = clampInteger(clip.sourceInMs ?? 0, 0, Math.max(0, sourceDurationMs - minimum));
  const sourceOutMs = clampInteger(
    clip.sourceOutMs ?? sourceDurationMs,
    sourceInMs + minimum,
    sourceDurationMs,
  );
  return { sourceInMs, sourceOutMs, durationMs: sourceOutMs - sourceInMs };
}

export function trimEditorAudioClipEdge(
  clip: EditorAudioClip,
  edge: 'start' | 'end',
  deltaSeconds: number,
  sourceDurationSeconds: number,
): EditorAudioClip {
  const sourceDurationMs = Math.max(0, Math.round(sourceDurationSeconds * 1_000));
  const range = resolveEditorAudioSourceRangeMs(clip, sourceDurationSeconds);
  if (range.durationMs <= 0 || !Number.isFinite(deltaSeconds)) return clip;

  const deltaMs = Math.round(deltaSeconds * 1_000);
  if (edge === 'start') {
    const minimumSourceInMs = Math.max(0, range.sourceInMs - Math.max(0, clip.offsetMs));
    const nextSourceInMs = clampInteger(
      range.sourceInMs + deltaMs,
      minimumSourceInMs,
      range.sourceOutMs - MIN_EDITOR_AUDIO_CLIP_DURATION_MS,
    );
    const appliedDeltaMs = nextSourceInMs - range.sourceInMs;
    const nextDurationSeconds = (range.sourceOutMs - nextSourceInMs) / 1_000;
    return {
      ...clip,
      offsetMs: Math.max(0, clip.offsetMs + appliedDeltaMs),
      sourceInMs: nextSourceInMs,
      sourceOutMs: range.sourceOutMs,
      fadeInSeconds: clampFade(clip.fadeInSeconds, nextDurationSeconds),
      fadeOutSeconds: clampFade(clip.fadeOutSeconds, nextDurationSeconds),
    };
  }

  const nextSourceOutMs = clampInteger(
    range.sourceOutMs + deltaMs,
    range.sourceInMs + MIN_EDITOR_AUDIO_CLIP_DURATION_MS,
    sourceDurationMs,
  );
  const nextDurationSeconds = (nextSourceOutMs - range.sourceInMs) / 1_000;
  return {
    ...clip,
    sourceInMs: range.sourceInMs,
    sourceOutMs: nextSourceOutMs,
    fadeInSeconds: clampFade(clip.fadeInSeconds, nextDurationSeconds),
    fadeOutSeconds: clampFade(clip.fadeOutSeconds, nextDurationSeconds),
  };
}

export function splitEditorAudioClipAtTimelineSeconds(
  clip: EditorAudioClip,
  sourceDurationSeconds: number,
  timelineSeconds: number,
  idFactory: (side: 'left' | 'right') => string = defaultSplitId,
): [EditorAudioClip, EditorAudioClip] | undefined {
  const range = resolveEditorAudioSourceRangeMs(clip, sourceDurationSeconds);
  const localSplitMs = Math.round(timelineSeconds * 1_000) - clip.offsetMs;
  if (
    range.durationMs <= 0
    || localSplitMs < MIN_EDITOR_AUDIO_CLIP_DURATION_MS
    || localSplitMs > range.durationMs - MIN_EDITOR_AUDIO_CLIP_DURATION_MS
  ) {
    return undefined;
  }

  const cutPercent = (localSplitMs / range.durationMs) * 100;
  const cutSourceMs = range.sourceInMs + localSplitMs;
  const leftDurationSeconds = localSplitMs / 1_000;
  const rightDurationSeconds = (range.durationMs - localSplitMs) / 1_000;
  const effectiveFadeInSeconds = clampFade(clip.fadeInSeconds, range.durationMs / 1_000);
  const effectiveFadeOutSeconds = clampFade(clip.fadeOutSeconds, range.durationMs / 1_000);
  // A local fade is anchored to the outer edge of a clip. Splitting inside one would change
  // its curve at the new edit point, so refuse that edit instead of pretending it is lossless.
  if (
    leftDurationSeconds < effectiveFadeInSeconds
    || rightDurationSeconds < effectiveFadeOutSeconds
  ) {
    return undefined;
  }
  const [leftAutomation, rightAutomation] = splitAutomationPoints(
    normalizeAutomationPoints(clip.volumeAutomationPoints, clip.volumePercent),
    cutPercent,
  );
  const hasExplicitKeyframes = Boolean(clip.volumeKeyframes?.length);
  const [leftKeyframes, rightKeyframes] = hasExplicitKeyframes
    ? splitAudioKeyframes(normalizeAudioKeyframes(clip), cutPercent)
    : [undefined, undefined];
  const left: EditorAudioClip = {
    ...clip,
    id: idFactory('left'),
    sourceInMs: range.sourceInMs,
    sourceOutMs: cutSourceMs,
    volumeAutomationPoints: leftKeyframes ? keyframesToAutomation(leftKeyframes) : leftAutomation,
    volumeKeyframes: leftKeyframes,
    fadeInSeconds: clampFade(clip.fadeInSeconds, leftDurationSeconds),
    fadeOutSeconds: 0,
  };
  const right: EditorAudioClip = {
    ...clip,
    id: idFactory('right'),
    offsetMs: clip.offsetMs + localSplitMs,
    sourceInMs: cutSourceMs,
    sourceOutMs: range.sourceOutMs,
    volumeAutomationPoints: rightKeyframes ? keyframesToAutomation(rightKeyframes) : rightAutomation,
    volumeKeyframes: rightKeyframes,
    fadeInSeconds: 0,
    fadeOutSeconds: clampFade(clip.fadeOutSeconds, rightDurationSeconds),
  };
  return [left, right];
}

function splitAutomationPoints(
  points: TimelineAutomationPoint[],
  cutPercent: number,
): [TimelineAutomationPoint[], TimelineAutomationPoint[]] {
  const cutValue = automationValueAt(points, cutPercent);
  const left = [
    ...points.filter((point) => point.timePercent < cutPercent),
    { timePercent: cutPercent, valuePercent: cutValue },
  ].map((point) => ({
    timePercent: (point.timePercent / cutPercent) * 100,
    valuePercent: point.valuePercent,
  }));
  const right = [
    { timePercent: cutPercent, valuePercent: cutValue },
    ...points.filter((point) => point.timePercent > cutPercent),
  ].map((point) => ({
    timePercent: ((point.timePercent - cutPercent) / (100 - cutPercent)) * 100,
    valuePercent: point.valuePercent,
  }));
  return [normalizeAutomationPoints(left, cutValue), normalizeAutomationPoints(right, cutValue)];
}

function splitAudioKeyframes(
  keyframes: EditorAudioKeyframe[],
  cutPercent: number,
): [EditorAudioKeyframe[], EditorAudioKeyframe[]] {
  const points = keyframes.map((keyframe) => ({
    timePercent: keyframe.timePercent,
    valuePercent: keyframe.volumePercent,
  }));
  const [left, right] = splitAutomationPoints(points, cutPercent);
  return [
    left.map((point) => ({ timePercent: point.timePercent, volumePercent: point.valuePercent })),
    right.map((point) => ({ timePercent: point.timePercent, volumePercent: point.valuePercent })),
  ];
}

function automationValueAt(points: TimelineAutomationPoint[], targetPercent: number): number {
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (targetPercent <= right.timePercent) {
      const span = Math.max(0.0001, right.timePercent - left.timePercent);
      const progress = (targetPercent - left.timePercent) / span;
      return left.valuePercent + (right.valuePercent - left.valuePercent) * progress;
    }
  }
  return points.at(-1)?.valuePercent ?? 100;
}

function keyframesToAutomation(keyframes: EditorAudioKeyframe[]): TimelineAutomationPoint[] {
  return keyframes.map((keyframe) => ({
    timePercent: keyframe.timePercent,
    valuePercent: keyframe.volumePercent,
  }));
}

function clampFade(value: number | undefined, durationSeconds: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return 0;
  return Math.min(5, durationSeconds / 2, value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const safeMaximum = Math.max(minimum, maximum);
  return Math.min(safeMaximum, Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum)));
}

function defaultSplitId(side: 'left' | 'right'): string {
  return `audio-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
