/** Bounded feature-length timeline overview, work-area, and zoom model. */

export const MAX_VIDEO_NAVIGATION_DURATION_MS = 12 * 60 * 60 * 1_000;
export const MAX_VIDEO_NAVIGATION_TRACKS = 64;
export const MAX_VIDEO_NAVIGATION_CLIPS = 100_000;
export const MAX_VIDEO_MINIMAP_BUCKETS = 2_048;
export const DEFAULT_VIDEO_MINIMAP_BUCKETS = 512;

export interface VideoTimelineRange {
  startMs: number;
  endMs: number;
}

export interface VideoMinimapClip {
  id: string;
  trackIndex: number;
  startMs: number;
  durationMs: number;
  kind: 'video' | 'audio';
  enabled?: boolean;
}

export interface VideoMinimapBucket {
  index: number;
  startMs: number;
  endMs: number;
  videoClipCount: number;
  audioClipCount: number;
  clipCount: number;
  density: number;
}

export interface VideoTimelineNavigationModel {
  durationMs: number;
  trackCount: number;
  clipCount: number;
  bucketDurationMs: number;
  peakClipCount: number;
  buckets: VideoMinimapBucket[];
  viewport: VideoTimelineRange;
  workArea?: VideoTimelineRange;
}

export type VideoTimelineNavigationReason =
  | 'duration-too-large'
  | 'invalid-clip'
  | 'invalid-duration'
  | 'invalid-range'
  | 'timeline-too-large'
  | 'too-many-tracks';

export type VideoTimelineNavigationResult =
  | { ok: true; model: VideoTimelineNavigationModel }
  | { ok: false; reason: VideoTimelineNavigationReason };

export interface BuildVideoTimelineNavigationOptions {
  durationMs: number;
  trackCount: number;
  clips: readonly VideoMinimapClip[];
  viewport?: VideoTimelineRange;
  workArea?: VideoTimelineRange;
  bucketCount?: number;
}

export function buildVideoTimelineNavigationModel(
  options: BuildVideoTimelineNavigationOptions,
): VideoTimelineNavigationResult {
  if (!finitePositive(options.durationMs)) return { ok: false, reason: 'invalid-duration' };
  if (options.durationMs > MAX_VIDEO_NAVIGATION_DURATION_MS) return { ok: false, reason: 'duration-too-large' };
  if (!Number.isInteger(options.trackCount) || options.trackCount < 0) return { ok: false, reason: 'too-many-tracks' };
  if (options.trackCount > MAX_VIDEO_NAVIGATION_TRACKS) return { ok: false, reason: 'too-many-tracks' };
  if (options.clips.length > MAX_VIDEO_NAVIGATION_CLIPS) return { ok: false, reason: 'timeline-too-large' };
  const bucketCount = clampInteger(options.bucketCount ?? DEFAULT_VIDEO_MINIMAP_BUCKETS, 1, MAX_VIDEO_MINIMAP_BUCKETS);
  const bucketDurationMs = options.durationMs / bucketCount;
  const videoDiff = new Int32Array(bucketCount + 1);
  const audioDiff = new Int32Array(bucketCount + 1);
  for (const clip of options.clips) {
    if (!validClip(clip, options.trackCount)) return { ok: false, reason: 'invalid-clip' };
    if (clip.enabled === false || clip.startMs >= options.durationMs) continue;
    const clippedEndMs = Math.min(options.durationMs, clip.startMs + clip.durationMs);
    if (clippedEndMs <= 0) continue;
    const firstBucket = clampInteger(Math.floor(Math.max(0, clip.startMs) / bucketDurationMs), 0, bucketCount - 1);
    // Timeline ranges are half-open. `ceil(end / bucketDuration) - 1` keeps a clip ending
    // exactly on a bucket boundary out of the following bucket without fragile float epsilons.
    const lastBucket = clampInteger(Math.ceil(Math.max(0, clippedEndMs) / bucketDurationMs) - 1, 0, bucketCount - 1);
    const diff = clip.kind === 'video' ? videoDiff : audioDiff;
    diff[firstBucket] += 1;
    diff[lastBucket + 1] -= 1;
  }
  const counts: Array<{ video: number; audio: number }> = [];
  let video = 0;
  let audio = 0;
  let peakClipCount = 0;
  for (let index = 0; index < bucketCount; index += 1) {
    video += videoDiff[index];
    audio += audioDiff[index];
    peakClipCount = Math.max(peakClipCount, video + audio);
    counts.push({ video, audio });
  }
  const buckets = counts.map((count, index): VideoMinimapBucket => {
    const clipCount = count.video + count.audio;
    return {
      index,
      startMs: index * bucketDurationMs,
      endMs: Math.min(options.durationMs, (index + 1) * bucketDurationMs),
      videoClipCount: count.video,
      audioClipCount: count.audio,
      clipCount,
      density: peakClipCount > 0 ? clipCount / peakClipCount : 0,
    };
  });
  const viewport = normalizeTimelineRange(
    options.viewport ?? { startMs: 0, endMs: Math.min(options.durationMs, Math.max(1_000, options.durationMs / 10)) },
    options.durationMs,
  );
  if (!viewport) return { ok: false, reason: 'invalid-range' };
  const workArea = options.workArea ? normalizeTimelineRange(options.workArea, options.durationMs) : undefined;
  if (options.workArea && !workArea) return { ok: false, reason: 'invalid-range' };
  return {
    ok: true,
    model: {
      durationMs: options.durationMs,
      trackCount: options.trackCount,
      clipCount: options.clips.length,
      bucketDurationMs,
      peakClipCount,
      buckets,
      viewport,
      ...(workArea ? { workArea } : {}),
    },
  };
}

export function normalizeTimelineRange(range: VideoTimelineRange, durationMs: number): VideoTimelineRange | undefined {
  if (!finitePositive(durationMs) || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.endMs <= range.startMs) {
    return undefined;
  }
  const span = Math.min(durationMs, range.endMs - range.startMs);
  const startMs = clamp(range.startMs, 0, Math.max(0, durationMs - span));
  return { startMs, endMs: startMs + span };
}

export function setVideoTimelineWorkArea(
  model: VideoTimelineNavigationModel,
  workArea: VideoTimelineRange | undefined,
): VideoTimelineNavigationResult {
  const normalized = workArea ? normalizeTimelineRange(workArea, model.durationMs) : undefined;
  if (workArea && !normalized) return { ok: false, reason: 'invalid-range' };
  return {
    ok: true,
    model: {
      ...cloneModel(model),
      ...(normalized ? { workArea: normalized } : { workArea: undefined }),
    },
  };
}

export function moveVideoTimelineViewport(
  model: VideoTimelineNavigationModel,
  deltaMs: number,
): VideoTimelineNavigationResult {
  if (!Number.isFinite(deltaMs)) return { ok: false, reason: 'invalid-range' };
  const span = model.viewport.endMs - model.viewport.startMs;
  const startMs = clamp(model.viewport.startMs + deltaMs, 0, Math.max(0, model.durationMs - span));
  return { ok: true, model: { ...cloneModel(model), viewport: { startMs, endMs: startMs + span } } };
}

export function dragVideoTimelineViewportByRatio(
  model: VideoTimelineNavigationModel,
  deltaRatio: number,
): VideoTimelineNavigationResult {
  return moveVideoTimelineViewport(model, deltaRatio * model.durationMs);
}

export function zoomVideoTimelineViewport(
  model: VideoTimelineNavigationModel,
  input: { factor: number; anchorMs?: number; minimumSpanMs?: number },
): VideoTimelineNavigationResult {
  if (!finitePositive(input.factor)) return { ok: false, reason: 'invalid-range' };
  const current = model.viewport;
  const currentSpan = current.endMs - current.startMs;
  const minimumSpanMs = finitePositive(input.minimumSpanMs) ? Math.min(model.durationMs, input.minimumSpanMs) : 1;
  const nextSpan = clamp(currentSpan / input.factor, minimumSpanMs, model.durationMs);
  const anchorMs = clamp(input.anchorMs ?? (current.startMs + current.endMs) / 2, 0, model.durationMs);
  const anchorRatio = currentSpan > 0 ? clamp((anchorMs - current.startMs) / currentSpan, 0, 1) : 0.5;
  const startMs = clamp(anchorMs - nextSpan * anchorRatio, 0, Math.max(0, model.durationMs - nextSpan));
  return { ok: true, model: { ...cloneModel(model), viewport: { startMs, endMs: startMs + nextSpan } } };
}

export function fitVideoTimelineViewport(
  model: VideoTimelineNavigationModel,
  range: VideoTimelineRange,
  paddingRatio = 0.08,
): VideoTimelineNavigationResult {
  const normalized = normalizeTimelineRange(range, model.durationMs);
  if (!normalized || !Number.isFinite(paddingRatio) || paddingRatio < 0) return { ok: false, reason: 'invalid-range' };
  const paddingMs = (normalized.endMs - normalized.startMs) * Math.min(1, paddingRatio);
  const viewport = normalizeTimelineRange({
    startMs: normalized.startMs - paddingMs,
    endMs: normalized.endMs + paddingMs,
  }, model.durationMs);
  if (!viewport) return { ok: false, reason: 'invalid-range' };
  return { ok: true, model: { ...cloneModel(model), viewport } };
}

export function seekVideoTimelineViewport(
  model: VideoTimelineNavigationModel,
  timeMs: number,
): VideoTimelineNavigationResult {
  if (!Number.isFinite(timeMs)) return { ok: false, reason: 'invalid-range' };
  const span = model.viewport.endMs - model.viewport.startMs;
  const center = clamp(timeMs, 0, model.durationMs);
  const startMs = clamp(center - span / 2, 0, Math.max(0, model.durationMs - span));
  return { ok: true, model: { ...cloneModel(model), viewport: { startMs, endMs: startMs + span } } };
}

export function timelineMillisecondsToRatio(timeMs: number, durationMs: number): number {
  if (!finitePositive(durationMs) || !Number.isFinite(timeMs)) return 0;
  return clamp(timeMs / durationMs, 0, 1);
}

export function timelineRatioToMilliseconds(ratio: number, durationMs: number): number {
  if (!finitePositive(durationMs) || !Number.isFinite(ratio)) return 0;
  return clamp(ratio, 0, 1) * durationMs;
}

function validClip(clip: VideoMinimapClip, trackCount: number): boolean {
  return Boolean(clip.id)
    && Number.isInteger(clip.trackIndex)
    && clip.trackIndex >= 0
    && clip.trackIndex < trackCount
    && Number.isFinite(clip.startMs)
    && clip.startMs >= 0
    && finitePositive(clip.durationMs)
    && (clip.kind === 'video' || clip.kind === 'audio');
}

function cloneModel(model: VideoTimelineNavigationModel): VideoTimelineNavigationModel {
  return {
    ...model,
    buckets: model.buckets.map((bucket) => ({ ...bucket })),
    viewport: { ...model.viewport },
    ...(model.workArea ? { workArea: { ...model.workArea } } : {}),
  };
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(Number.isFinite(value) ? value : minimum)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
