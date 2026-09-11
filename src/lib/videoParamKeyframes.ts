/**
 * Provider- and renderer-neutral numeric parameter automation for professional Video effects.
 * The model is deliberately pure: callers persist it beside clip/effect state and decide which
 * preview or render parameter consumes the evaluated value.
 */

import type { ProfessionalNumericParameterTrack } from '../types/videoProfessional';

export const VIDEO_PARAM_KEYFRAME_VERSION = 1 as const;
export const MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER = 1_000;
export const MAX_VIDEO_PARAM_KEYFRAMES_AGGREGATE = 100_000;
export const MAX_VIDEO_PARAM_TRACKS = 100_000;
export const MAX_VIDEO_PARAM_TIME_MS = 12 * 60 * 60 * 1_000;
export const MAX_VIDEO_PARAM_FFMPEG_EXPRESSION_KEYFRAMES = 128;

export type VideoParamInterpolation = 'hold' | 'linear' | 'cubic-bezier';

export interface VideoParamCubicBezier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface VideoParamKeyframe {
  id: string;
  timeMs: number;
  value: number;
  /** Interpolation from this keyframe to the next one. Ignored on the last keyframe. */
  interpolation: VideoParamInterpolation;
  bezier?: VideoParamCubicBezier;
}

export interface VideoParamKeyframeTrack {
  version: typeof VIDEO_PARAM_KEYFRAME_VERSION;
  id: string;
  parameterId: string;
  label?: string;
  unit?: string;
  defaultValue: number;
  minValue?: number;
  maxValue?: number;
  keyframes: readonly VideoParamKeyframe[];
}

export interface VideoParamKeyframeValidation {
  valid: boolean;
  errors: readonly string[];
  trackCount: number;
  keyframeCount: number;
}

export interface VideoParamFfmpegExpressionDescriptor {
  ok: true;
  parameterId: string;
  strategy: 'expression';
  variable: 't';
  expression: string;
  keyframeCount: number;
  cubicApproximationSubdivisions: number;
  note: string;
}

export interface VideoParamFfmpegSidecarDescriptor {
  ok: false;
  parameterId: string;
  strategy: 'sendcmd-sidecar-required';
  keyframeCount: number;
  reason: string;
}

export type VideoParamFfmpegDescriptor =
  | VideoParamFfmpegExpressionDescriptor
  | VideoParamFfmpegSidecarDescriptor;

export interface VideoParamStableSignatureInput {
  version: typeof VIDEO_PARAM_KEYFRAME_VERSION;
  tracks: ReadonlyArray<{
    id: string;
    parameterId: string;
    defaultValue: number;
    minValue: number | null;
    maxValue: number | null;
    keyframes: ReadonlyArray<{
      id: string;
      timeMs: number;
      value: number;
      interpolation: VideoParamInterpolation;
      bezier: readonly [number, number, number, number] | null;
    }>;
  }>;
}

export function validateVideoParamKeyframeTracks(
  tracks: readonly VideoParamKeyframeTrack[],
): VideoParamKeyframeValidation {
  const errors: string[] = [];
  if (tracks.length > MAX_VIDEO_PARAM_TRACKS) {
    errors.push(`Parameter automation exceeds the ${MAX_VIDEO_PARAM_TRACKS.toLocaleString()}-track safety limit.`);
  }
  const trackIds = new Set<string>();
  const parameterIds = new Set<string>();
  let keyframeCount = 0;

  for (const [trackIndex, track] of tracks.entries()) {
    const prefix = `Parameter track ${trackIndex + 1}`;
    if (track.version !== VIDEO_PARAM_KEYFRAME_VERSION) errors.push(`${prefix} has an unsupported version.`);
    if (!track.id.trim()) errors.push(`${prefix} needs an id.`);
    else if (trackIds.has(track.id)) errors.push(`Duplicate parameter track id '${track.id}'.`);
    trackIds.add(track.id);
    if (!track.parameterId.trim()) errors.push(`${prefix} needs a parameter id.`);
    else if (parameterIds.has(track.parameterId)) errors.push(`Duplicate automated parameter '${track.parameterId}'.`);
    parameterIds.add(track.parameterId);
    if (!Number.isFinite(track.defaultValue)) errors.push(`${prefix} has an invalid default value.`);
    if (track.minValue !== undefined && !Number.isFinite(track.minValue)) errors.push(`${prefix} has an invalid minimum.`);
    if (track.maxValue !== undefined && !Number.isFinite(track.maxValue)) errors.push(`${prefix} has an invalid maximum.`);
    if (track.minValue !== undefined && track.maxValue !== undefined && track.minValue > track.maxValue) {
      errors.push(`${prefix} has a minimum greater than its maximum.`);
    }
    if (track.keyframes.length > MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER) {
      errors.push(`${prefix} exceeds ${MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER.toLocaleString()} keyframes.`);
    }
    keyframeCount += track.keyframes.length;
    const ids = new Set<string>();
    let previousTime = -1;
    for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
      const keyframePrefix = `${prefix}, keyframe ${keyframeIndex + 1}`;
      if (!keyframe.id.trim()) errors.push(`${keyframePrefix} needs an id.`);
      else if (ids.has(keyframe.id)) errors.push(`${prefix} has duplicate keyframe id '${keyframe.id}'.`);
      ids.add(keyframe.id);
      if (!Number.isFinite(keyframe.timeMs) || keyframe.timeMs < 0 || keyframe.timeMs > MAX_VIDEO_PARAM_TIME_MS) {
        errors.push(`${keyframePrefix} has an invalid time.`);
      }
      if (keyframe.timeMs <= previousTime) errors.push(`${prefix} keyframe times must be strictly increasing.`);
      previousTime = keyframe.timeMs;
      if (!Number.isFinite(keyframe.value)) errors.push(`${keyframePrefix} has an invalid value.`);
      if (track.minValue !== undefined && keyframe.value < track.minValue) errors.push(`${keyframePrefix} is below the track minimum.`);
      if (track.maxValue !== undefined && keyframe.value > track.maxValue) errors.push(`${keyframePrefix} is above the track maximum.`);
      if (!isInterpolation(keyframe.interpolation)) errors.push(`${keyframePrefix} has an unsupported interpolation.`);
      if (keyframe.interpolation === 'cubic-bezier') {
        if (!keyframe.bezier || !isValidBezier(keyframe.bezier)) {
          errors.push(`${keyframePrefix} needs finite cubic-Bezier controls with x values from 0 through 1.`);
        }
      }
    }
  }

  if (keyframeCount > MAX_VIDEO_PARAM_KEYFRAMES_AGGREGATE) {
    errors.push(`Parameter automation exceeds the ${MAX_VIDEO_PARAM_KEYFRAMES_AGGREGATE.toLocaleString()}-keyframe aggregate safety limit.`);
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    trackCount: tracks.length,
    keyframeCount,
  };
}

export function evaluateVideoParamKeyframeTrack(
  track: VideoParamKeyframeTrack,
  timeMs: number,
): number {
  assertValidTracks([track]);
  const keyframes = track.keyframes;
  if (keyframes.length === 0) return clampToTrack(track.defaultValue, track);
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const first = keyframes[0]!;
  if (time <= first.timeMs) return clampToTrack(first.value, track);

  for (let index = 1; index < keyframes.length; index += 1) {
    const start = keyframes[index - 1]!;
    const end = keyframes[index]!;
    if (time > end.timeMs) continue;
    if (time === end.timeMs) return clampToTrack(end.value, track);
    const progress = (time - start.timeMs) / (end.timeMs - start.timeMs);
    const eased = interpolateProgress(start, progress);
    return clampToTrack(start.value + (end.value - start.value) * eased, track);
  }
  return clampToTrack(keyframes.at(-1)!.value, track);
}

export function evaluateVideoParamKeyframeTracks(
  tracks: readonly VideoParamKeyframeTrack[],
  timeMs: number,
): Readonly<Record<string, number>> {
  assertValidTracks(tracks);
  return Object.freeze(Object.fromEntries(
    [...tracks]
      .sort((left, right) => left.parameterId.localeCompare(right.parameterId) || left.id.localeCompare(right.id))
      .map((track) => [track.parameterId, evaluateVideoParamKeyframeTrack(track, timeMs)]),
  ));
}

/** Converts persisted clip automation into the renderer-neutral evaluator/compiler contract. */
export function videoParamTrackFromProfessional(
  track: ProfessionalNumericParameterTrack,
  options: { defaultValue: number; minValue?: number; maxValue?: number },
): VideoParamKeyframeTrack {
  return {
    version: VIDEO_PARAM_KEYFRAME_VERSION,
    id: track.id,
    parameterId: track.parameter,
    defaultValue: options.defaultValue,
    minValue: options.minValue,
    maxValue: options.maxValue,
    keyframes: track.keyframes.map((keyframe) => ({
      id: keyframe.id,
      timeMs: keyframe.timeMs,
      value: keyframe.value,
      interpolation: keyframe.interpolation === 'bezier' ? 'cubic-bezier' : keyframe.interpolation,
      bezier: keyframe.bezier ? {
        x1: keyframe.bezier.outX,
        y1: keyframe.bezier.outY,
        x2: keyframe.bezier.inX,
        y2: keyframe.bezier.inY,
      } : undefined,
    })),
  };
}

export function evaluateProfessionalVideoParameter(
  tracks: readonly ProfessionalNumericParameterTrack[] | undefined,
  parameterId: string,
  timeMs: number,
  options: { defaultValue: number; minValue?: number; maxValue?: number },
): number {
  const track = tracks?.find((candidate) => candidate.parameter === parameterId);
  return track
    ? evaluateVideoParamKeyframeTrack(videoParamTrackFromProfessional(track, options), timeMs)
    : options.defaultValue;
}

export function compileVideoParamKeyframeTrackForFfmpeg(
  track: VideoParamKeyframeTrack,
  options: { cubicApproximationSubdivisions?: number } = {},
): VideoParamFfmpegDescriptor {
  assertValidTracks([track]);
  if (track.keyframes.length > MAX_VIDEO_PARAM_FFMPEG_EXPRESSION_KEYFRAMES) {
    return {
      ok: false,
      parameterId: track.parameterId,
      strategy: 'sendcmd-sidecar-required',
      keyframeCount: track.keyframes.length,
      reason: `FFmpeg expressions are limited to ${MAX_VIDEO_PARAM_FFMPEG_EXPRESSION_KEYFRAMES} keyframes; compile this track into a bounded sendcmd sidecar instead.`,
    };
  }
  const subdivisions = clampInteger(options.cubicApproximationSubdivisions ?? 12, 4, 32);
  const keyframes = track.keyframes;
  if (keyframes.length === 0) {
    return expressionDescriptor(track, formatNumber(clampToTrack(track.defaultValue, track)), subdivisions);
  }
  if (keyframes.length === 1) {
    return expressionDescriptor(track, formatNumber(clampToTrack(keyframes[0]!.value, track)), subdivisions);
  }

  const intervals: FfmpegInterval[] = [];
  for (let index = 1; index < keyframes.length; index += 1) {
    const start = keyframes[index - 1]!;
    const end = keyframes[index]!;
    if (start.interpolation !== 'cubic-bezier') {
      intervals.push({
        startSeconds: start.timeMs / 1_000,
        endSeconds: end.timeMs / 1_000,
        startValue: start.value,
        endValue: end.value,
        hold: start.interpolation === 'hold',
      });
      continue;
    }
    for (let sample = 1; sample <= subdivisions; sample += 1) {
      const previousProgress = (sample - 1) / subdivisions;
      const progress = sample / subdivisions;
      intervals.push({
        startSeconds: (start.timeMs + (end.timeMs - start.timeMs) * previousProgress) / 1_000,
        endSeconds: (start.timeMs + (end.timeMs - start.timeMs) * progress) / 1_000,
        startValue: start.value + (end.value - start.value) * solveBezierY(start.bezier!, previousProgress),
        endValue: start.value + (end.value - start.value) * solveBezierY(start.bezier!, progress),
        hold: false,
      });
    }
  }

  let expression = formatNumber(clampToTrack(keyframes.at(-1)!.value, track));
  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    const interval = intervals[index]!;
    const startValue = clampToTrack(interval.startValue, track);
    const endValue = clampToTrack(interval.endValue, track);
    if (interval.hold) {
      expression = `if(lt(t,${formatNumber(interval.endSeconds)}),${formatNumber(startValue)},${expression})`;
    } else {
      const duration = Math.max(0.000001, interval.endSeconds - interval.startSeconds);
      const progress = `clip((t-${formatNumber(interval.startSeconds)})/${formatNumber(duration)},0,1)`;
      const value = `${formatNumber(startValue)}+(${formatNumber(endValue - startValue)})*${progress}`;
      expression = `if(lte(t,${formatNumber(interval.endSeconds)}),${value},${expression})`;
    }
  }
  return expressionDescriptor(track, expression, subdivisions);
}

export function buildVideoParamStableSignatureInput(
  tracks: readonly VideoParamKeyframeTrack[],
): VideoParamStableSignatureInput {
  assertValidTracks(tracks);
  return Object.freeze({
    version: VIDEO_PARAM_KEYFRAME_VERSION,
    tracks: [...tracks]
      .sort((left, right) => left.parameterId.localeCompare(right.parameterId) || left.id.localeCompare(right.id))
      .map((track) => Object.freeze({
        id: track.id,
        parameterId: track.parameterId,
        defaultValue: track.defaultValue,
        minValue: track.minValue ?? null,
        maxValue: track.maxValue ?? null,
        keyframes: track.keyframes.map((keyframe) => Object.freeze({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          value: keyframe.value,
          interpolation: keyframe.interpolation,
          bezier: keyframe.bezier
            ? Object.freeze([keyframe.bezier.x1, keyframe.bezier.y1, keyframe.bezier.x2, keyframe.bezier.y2] as const)
            : null,
        })),
      })),
  });
}

interface FfmpegInterval {
  startSeconds: number;
  endSeconds: number;
  startValue: number;
  endValue: number;
  hold: boolean;
}

function expressionDescriptor(
  track: VideoParamKeyframeTrack,
  expression: string,
  cubicApproximationSubdivisions: number,
): VideoParamFfmpegExpressionDescriptor {
  return {
    ok: true,
    parameterId: track.parameterId,
    strategy: 'expression',
    variable: 't',
    expression,
    keyframeCount: track.keyframes.length,
    cubicApproximationSubdivisions,
    note: 'Hold and linear segments are exact. Cubic-Bezier segments use deterministic bounded piecewise-linear sampling for FFmpeg expression compatibility.',
  };
}

function interpolateProgress(start: VideoParamKeyframe, progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  if (start.interpolation === 'hold') return 0;
  if (start.interpolation === 'linear') return clamped;
  return solveBezierY(start.bezier!, clamped);
}

function solveBezierY(bezier: VideoParamCubicBezier, x: number): number {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const candidate = (lower + upper) / 2;
    if (cubicCoordinate(candidate, bezier.x1, bezier.x2) < x) lower = candidate;
    else upper = candidate;
  }
  return cubicCoordinate((lower + upper) / 2, bezier.y1, bezier.y2);
}

function cubicCoordinate(time: number, control1: number, control2: number): number {
  const inverse = 1 - time;
  return 3 * inverse * inverse * time * control1 + 3 * inverse * time * time * control2 + time * time * time;
}

function isInterpolation(value: unknown): value is VideoParamInterpolation {
  return value === 'hold' || value === 'linear' || value === 'cubic-bezier';
}

function isValidBezier(value: VideoParamCubicBezier): boolean {
  return [value.x1, value.y1, value.x2, value.y2].every(Number.isFinite)
    && value.x1 >= 0 && value.x1 <= 1
    && value.x2 >= 0 && value.x2 <= 1
    && Math.abs(value.y1) <= 10
    && Math.abs(value.y2) <= 10;
}

function clampToTrack(value: number, track: Pick<VideoParamKeyframeTrack, 'minValue' | 'maxValue'>): number {
  return Math.max(track.minValue ?? Number.NEGATIVE_INFINITY, Math.min(track.maxValue ?? Number.POSITIVE_INFINITY, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(Number.isFinite(value) ? value : minimum)));
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  return value.toFixed(8).replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}

function assertValidTracks(tracks: readonly VideoParamKeyframeTrack[]): void {
  const validation = validateVideoParamKeyframeTracks(tracks);
  if (!validation.valid) throw new Error(validation.errors[0] ?? 'Invalid parameter automation.');
}
