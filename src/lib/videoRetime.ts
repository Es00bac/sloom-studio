/** Pure retiming model that can be added beside legacy playbackRate/reversePlayback fields. */

export const VIDEO_RETIME_VERSION = 1 as const;
export const MIN_VIDEO_RETIME_RATE = 1 / 16;
export const MAX_VIDEO_RETIME_RATE = 16;

export type VideoRetimeInterpolation = 'nearest' | 'blend' | 'optical-flow';

export interface VideoConstantRetime {
  version: typeof VIDEO_RETIME_VERSION;
  mode: 'constant';
  rate: number;
  reverse: boolean;
  interpolation: VideoRetimeInterpolation;
}

export interface VideoRetimeCurvePoint {
  timelineMs: number;
  /** Absolute source-media time. Equal adjacent values create a frame hold. */
  sourceMs: number;
  /** UI hint; equality of adjacent source times remains the authoritative hold representation. */
  hold?: boolean;
}

export interface VideoCurveRetime {
  version: typeof VIDEO_RETIME_VERSION;
  mode: 'curve';
  points: VideoRetimeCurvePoint[];
  interpolation: VideoRetimeInterpolation;
}

export type VideoRetimeModel = VideoConstantRetime | VideoCurveRetime;

export interface LegacyClipRetime {
  playbackRate?: number;
  reversePlayback?: boolean;
}

export interface VideoRetimeValidation {
  valid: boolean;
  errors: string[];
  direction: 'forward' | 'reverse' | 'hold';
  timelineDurationMs: number;
}

export interface VideoRetimeSourceBounds {
  sourceInMs: number;
  sourceOutMs: number;
}

export interface CompiledVideoRetimeSegment {
  index: number;
  timelineStartMs: number;
  timelineEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  rate: number;
  reverse: boolean;
  hold: boolean;
}

export interface VideoRetimePreviewQualification {
  requestedInterpolation: VideoRetimeInterpolation;
  previewInterpolation: 'nearest' | 'blend';
  realtimeEligible: boolean;
  exportOnly: boolean;
  badge?: string;
}

export interface FfmpegRetimeVideoSegmentPlan {
  segmentIndex: number;
  durationMs: number;
  filters: string[];
}

export interface FfmpegRetimeAudioBoundary {
  segmentIndex: number;
  timelineStartMs: number;
  timelineEndMs: number;
  state: 'supported' | 'muted';
  filters: string[];
  reason?: 'frame-hold' | 'reverse-audio-requires-pre-render' | 'rate-out-of-supported-range';
}

export interface FfmpegRetimePlan {
  segments: CompiledVideoRetimeSegment[];
  video: FfmpegRetimeVideoSegmentPlan[];
  audio: FfmpegRetimeAudioBoundary[];
  outputDurationMs: number;
  interpolation: VideoRetimeInterpolation;
  requiresExportOpticalFlow: boolean;
  concatSegmentCount: number;
}

export function resolveVideoRetimeModel(
  retime: VideoRetimeModel | undefined,
  legacy: LegacyClipRetime = {},
): VideoRetimeModel {
  if (retime) {
    return retime.mode === 'curve'
      ? { ...retime, points: retime.points.map((point) => ({ ...point })) }
      : { ...retime };
  }
  const legacyRate = Number.isFinite(legacy.playbackRate) ? Math.abs(legacy.playbackRate ?? 1) : 1;
  return {
    version: VIDEO_RETIME_VERSION,
    mode: 'constant',
    rate: Math.max(MIN_VIDEO_RETIME_RATE, Math.min(MAX_VIDEO_RETIME_RATE, legacyRate || 1)),
    reverse: legacy.reversePlayback ?? false,
    interpolation: 'nearest',
  };
}

export function validateVideoRetimeModel(model: VideoRetimeModel): VideoRetimeValidation {
  const errors: string[] = [];
  if (model.mode === 'constant') {
    if (!Number.isFinite(model.rate) || model.rate < MIN_VIDEO_RETIME_RATE || model.rate > MAX_VIDEO_RETIME_RATE) {
      errors.push(`Constant rate must be between ${MIN_VIDEO_RETIME_RATE} and ${MAX_VIDEO_RETIME_RATE}.`);
    }
    return { valid: errors.length === 0, errors, direction: model.reverse ? 'reverse' : 'forward', timelineDurationMs: 0 };
  }
  if (model.points.length < 2) errors.push('A retime curve needs at least two points.');
  if (model.points[0] && Math.abs(model.points[0].timelineMs) > 1e-9) errors.push('A retime curve must start at timeline zero.');
  let direction: VideoRetimeValidation['direction'] = 'hold';
  for (let index = 0; index < model.points.length; index += 1) {
    const point = model.points[index];
    if (!Number.isFinite(point.timelineMs) || point.timelineMs < 0 || !Number.isFinite(point.sourceMs) || point.sourceMs < 0) {
      errors.push(`Curve point ${index} contains an invalid time.`);
    }
    if (index === 0) continue;
    const previous = model.points[index - 1];
    if (point.timelineMs <= previous.timelineMs) errors.push('Curve timeline points must be strictly increasing.');
    const sourceDelta = point.sourceMs - previous.sourceMs;
    const segmentDirection = sourceDelta > 0 ? 'forward' : sourceDelta < 0 ? 'reverse' : 'hold';
    if (segmentDirection !== 'hold') {
      if (direction === 'hold') direction = segmentDirection;
      else if (direction !== segmentDirection) errors.push('A retime curve must be monotonic; direction changes require a clip split.');
    }
    const timelineDelta = point.timelineMs - previous.timelineMs;
    const rate = timelineDelta > 0 ? Math.abs(sourceDelta / timelineDelta) : Number.POSITIVE_INFINITY;
    if (sourceDelta !== 0 && (rate < MIN_VIDEO_RETIME_RATE || rate > MAX_VIDEO_RETIME_RATE)) {
      errors.push(`Curve segment ${index - 1} rate is outside the supported range.`);
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    direction,
    timelineDurationMs: model.points.at(-1)?.timelineMs ?? 0,
  };
}

export function mapVideoTimelineToSourceMs(
  model: VideoRetimeModel,
  timelineMs: number,
  bounds: VideoRetimeSourceBounds,
): number {
  const safeTimelineMs = Math.max(0, timelineMs);
  if (model.mode === 'constant') {
    const mapped = model.reverse
      ? bounds.sourceOutMs - safeTimelineMs * model.rate
      : bounds.sourceInMs + safeTimelineMs * model.rate;
    return Math.max(bounds.sourceInMs, Math.min(bounds.sourceOutMs, mapped));
  }
  const validation = validateVideoRetimeModel(model);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const first = model.points[0];
  const last = model.points.at(-1) ?? first;
  if (!first) return bounds.sourceInMs;
  if (safeTimelineMs <= first.timelineMs) return Math.max(bounds.sourceInMs, Math.min(bounds.sourceOutMs, first.sourceMs));
  if (safeTimelineMs >= last.timelineMs) return Math.max(bounds.sourceInMs, Math.min(bounds.sourceOutMs, last.sourceMs));
  const endIndex = model.points.findIndex((point) => point.timelineMs >= safeTimelineMs);
  const end = model.points[endIndex];
  const start = model.points[endIndex - 1];
  if (!start || !end) return last.sourceMs;
  const progress = (safeTimelineMs - start.timelineMs) / (end.timelineMs - start.timelineMs);
  const mapped = start.sourceMs + (end.sourceMs - start.sourceMs) * progress;
  return Math.max(bounds.sourceInMs, Math.min(bounds.sourceOutMs, mapped));
}

export function compileVideoRetimeSegments(
  model: VideoRetimeModel,
  bounds: VideoRetimeSourceBounds,
): CompiledVideoRetimeSegment[] {
  const validation = validateVideoRetimeModel(model);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  if (bounds.sourceOutMs <= bounds.sourceInMs) throw new Error('Source out must be later than source in.');
  if (model.mode === 'curve' && model.points.some((point) => point.sourceMs < bounds.sourceInMs || point.sourceMs > bounds.sourceOutMs)) {
    throw new Error('Retime curve source points must stay inside the clip source bounds.');
  }
  if (model.mode === 'constant') {
    const sourceDurationMs = bounds.sourceOutMs - bounds.sourceInMs;
    return [{
      index: 0,
      timelineStartMs: 0,
      timelineEndMs: sourceDurationMs / model.rate,
      sourceStartMs: model.reverse ? bounds.sourceOutMs : bounds.sourceInMs,
      sourceEndMs: model.reverse ? bounds.sourceInMs : bounds.sourceOutMs,
      rate: model.rate,
      reverse: model.reverse,
      hold: false,
    }];
  }
  return model.points.slice(0, -1).map((point, index) => {
    const next = model.points[index + 1];
    const sourceDelta = next.sourceMs - point.sourceMs;
    const timelineDelta = next.timelineMs - point.timelineMs;
    return {
      index,
      timelineStartMs: point.timelineMs,
      timelineEndMs: next.timelineMs,
      sourceStartMs: point.sourceMs,
      sourceEndMs: next.sourceMs,
      rate: sourceDelta === 0 ? 0 : Math.abs(sourceDelta / timelineDelta),
      reverse: sourceDelta < 0,
      hold: sourceDelta === 0,
    };
  });
}

export function createVideoFrameHoldRetime(
  sourceFrameMs: number,
  durationMs: number,
  interpolation: VideoRetimeInterpolation = 'nearest',
): VideoCurveRetime {
  if (!Number.isFinite(sourceFrameMs) || sourceFrameMs < 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('Frame holds require a valid source frame and positive duration.');
  }
  return {
    version: VIDEO_RETIME_VERSION,
    mode: 'curve',
    interpolation,
    points: [
      { timelineMs: 0, sourceMs: sourceFrameMs, hold: true },
      { timelineMs: durationMs, sourceMs: sourceFrameMs },
    ],
  };
}

/** Factor > 1 makes the timeline result longer; factor < 1 makes it shorter. */
export function rateStretchVideoRetime(model: VideoRetimeModel, timelineScaleFactor: number): VideoRetimeModel {
  if (!Number.isFinite(timelineScaleFactor) || timelineScaleFactor <= 0) throw new Error('Rate-stretch factor must be positive.');
  if (model.mode === 'constant') {
    const rate = model.rate / timelineScaleFactor;
    if (rate < MIN_VIDEO_RETIME_RATE || rate > MAX_VIDEO_RETIME_RATE) throw new Error('Rate stretch exceeds the supported rate range.');
    return { ...model, rate };
  }
  const stretched: VideoCurveRetime = {
    ...model,
    points: model.points.map((point) => ({ ...point, timelineMs: point.timelineMs * timelineScaleFactor })),
  };
  const validation = validateVideoRetimeModel(stretched);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return stretched;
}

export function qualifyVideoRetimePreview(model: VideoRetimeModel): VideoRetimePreviewQualification {
  if (model.interpolation === 'optical-flow') {
    return {
      requestedInterpolation: model.interpolation,
      previewInterpolation: 'blend',
      realtimeEligible: false,
      exportOnly: true,
      badge: 'Optical flow is export-only; preview uses frame blending.',
    };
  }
  return {
    requestedInterpolation: model.interpolation,
    previewInterpolation: model.interpolation,
    realtimeEligible: true,
    exportOnly: false,
  };
}

function formatSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function buildFfmpegAtempoChain(rate: number): string[] | undefined {
  if (!Number.isFinite(rate) || rate < MIN_VIDEO_RETIME_RATE || rate > MAX_VIDEO_RETIME_RATE) return undefined;
  const filters: string[] = [];
  let remaining = rate;
  while (remaining > 2 + 1e-9) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-9 || filters.length === 0) filters.push(`atempo=${remaining.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`);
  return filters;
}

export function buildFfmpegVideoRetimePlan(
  model: VideoRetimeModel,
  bounds: VideoRetimeSourceBounds,
  frameRate: number,
): FfmpegRetimePlan {
  if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error('A positive frame rate is required.');
  const segments = compileVideoRetimeSegments(model, bounds);
  const opticalFlowFilter = model.interpolation === 'optical-flow'
    ? `minterpolate=fps=${frameRate}:mi_mode=mci`
    : undefined;
  const video = segments.map((segment): FfmpegRetimeVideoSegmentPlan => {
    const durationMs = segment.timelineEndMs - segment.timelineStartMs;
    if (segment.hold) {
      const frameDurationMs = 1000 / frameRate;
      const filters = [
        `trim=start=${formatSeconds(segment.sourceStartMs)}:end=${formatSeconds(segment.sourceStartMs + frameDurationMs)}`,
        `tpad=stop_mode=clone:stop_duration=${formatSeconds(durationMs)}`,
        `trim=duration=${formatSeconds(durationMs)}`,
        'setpts=PTS-STARTPTS',
      ];
      if (opticalFlowFilter) filters.push(opticalFlowFilter);
      return { segmentIndex: segment.index, durationMs, filters };
    }
    const sourceStart = Math.min(segment.sourceStartMs, segment.sourceEndMs);
    const sourceEnd = Math.max(segment.sourceStartMs, segment.sourceEndMs);
    const filters = [
      `trim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)}`,
      ...(segment.reverse ? ['reverse'] : []),
      `setpts=(PTS-STARTPTS)/${segment.rate.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`,
    ];
    if (opticalFlowFilter) filters.push(opticalFlowFilter);
    return { segmentIndex: segment.index, durationMs, filters };
  });
  const audio = segments.map((segment): FfmpegRetimeAudioBoundary => {
    const boundary = {
      segmentIndex: segment.index,
      timelineStartMs: segment.timelineStartMs,
      timelineEndMs: segment.timelineEndMs,
    };
    if (segment.hold) return { ...boundary, state: 'muted', filters: [], reason: 'frame-hold' };
    if (segment.reverse) return { ...boundary, state: 'muted', filters: [], reason: 'reverse-audio-requires-pre-render' };
    const atempo = buildFfmpegAtempoChain(segment.rate);
    if (!atempo) return { ...boundary, state: 'muted', filters: [], reason: 'rate-out-of-supported-range' };
    return {
      ...boundary,
      state: 'supported',
      filters: [
        `atrim=start=${formatSeconds(segment.sourceStartMs)}:end=${formatSeconds(segment.sourceEndMs)}`,
        'asetpts=PTS-STARTPTS',
        ...atempo,
      ],
    };
  });
  return {
    segments,
    video,
    audio,
    outputDurationMs: segments.reduce((total, segment) => total + segment.timelineEndMs - segment.timelineStartMs, 0),
    interpolation: model.interpolation,
    requiresExportOpticalFlow: model.interpolation === 'optical-flow',
    concatSegmentCount: segments.length,
  };
}
