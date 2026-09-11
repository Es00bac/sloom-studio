/** Pure transient interaction sessions for professional Video timeline tools. */

import {
  cancelAdvancedTrimSession,
  commitAdvancedTrimSession,
  createAdvancedTrimSession,
  updateAdvancedTrimSession,
  type AdvancedTrimClip,
  type AdvancedTrimMode,
  type AdvancedTrimSession,
  type AdvancedTrimSessionOptions,
  type AdvancedTrimTrack,
} from './videoAdvancedTrim';

export const MAX_VIDEO_TOOL_SESSION_TRACKS = 64;
export const MAX_VIDEO_TOOL_SESSION_CLIPS = 100_000;
export const MAX_VIDEO_TOOL_SESSION_SELECTION = 2_000;
export const MAX_VIDEO_RATE_STRETCH_DURATION_MS = 12 * 60 * 60 * 1_000;

export type VideoTimelineToolMode =
  | 'select'
  | 'marquee'
  | 'range'
  | 'track-forward'
  | 'track-back'
  | 'ripple'
  | 'roll'
  | 'slip'
  | 'slide'
  | 'rate-stretch';

export type VideoTimelineToolSessionStatus = 'active' | 'committed' | 'cancelled';
export type VideoSelectionToolMode = Extract<VideoTimelineToolMode, 'select' | 'marquee' | 'range' | 'track-forward' | 'track-back'>;
export type VideoSelectionBehavior = 'replace' | 'add' | 'toggle';

export interface VideoTimelineToolClip {
  id: string;
  trackId: string;
  startMs: number;
  durationMs: number;
  linkGroupId?: string;
}

export interface VideoSelectionToolSession {
  kind: 'selection';
  mode: VideoSelectionToolMode;
  status: VideoTimelineToolSessionStatus;
  behavior: VideoSelectionBehavior;
  anchorMs: number;
  currentMs: number;
  targetTrackIds: string[];
  originalSelectedClipIds: string[];
  previewSelectedClipIds: string[];
  hitClipId?: string;
  includeLinked: boolean;
}

export interface BeginVideoSelectionToolSessionOptions {
  mode: VideoSelectionToolMode;
  anchorMs: number;
  targetTrackIds?: readonly string[];
  selectedClipIds?: readonly string[];
  hitClipId?: string;
  behavior?: VideoSelectionBehavior;
  includeLinked?: boolean;
}

export interface UpdateVideoSelectionToolSessionOptions {
  currentMs: number;
  targetTrackIds?: readonly string[];
}

export type VideoTimelineToolSessionReason =
  | 'clip-not-found'
  | 'invalid-duration'
  | 'invalid-frame-rate'
  | 'invalid-session'
  | 'locked-track'
  | 'selection-too-large'
  | 'timeline-too-large'
  | 'too-many-tracks';

export type VideoSelectionToolSessionResult =
  | { ok: true; session: VideoSelectionToolSession }
  | { ok: false; reason: VideoTimelineToolSessionReason };

export interface VideoTrimToolSession<TClip extends AdvancedTrimClip = AdvancedTrimClip> {
  kind: 'trim';
  mode: AdvancedTrimMode;
  status: VideoTimelineToolSessionStatus;
  framesPerSecond: number;
  trim: AdvancedTrimSession<TClip>;
}

export type VideoTrimToolSessionResult<TClip extends AdvancedTrimClip = AdvancedTrimClip> =
  | { ok: true; session: VideoTrimToolSession<TClip> }
  | { ok: false; reason: string };

export interface VideoRateStretchClip extends VideoTimelineToolClip {
  playbackRate: number;
}

export interface VideoRateStretchSession<TClip extends VideoRateStretchClip = VideoRateStretchClip> {
  kind: 'rate-stretch';
  mode: 'rate-stretch';
  status: VideoTimelineToolSessionStatus;
  primaryClipId: string;
  requestedDurationMs: number;
  appliedDurationMs: number;
  minimumDurationMs: number;
  maximumDurationMs: number;
  originalClips: TClip[];
  previewClips: TClip[];
  affectedClipIds: string[];
}

export type VideoTimelineToolSession<TClip extends AdvancedTrimClip & VideoRateStretchClip = AdvancedTrimClip & VideoRateStretchClip> =
  | VideoSelectionToolSession
  | VideoTrimToolSession<TClip>
  | VideoRateStretchSession<TClip>;

export function beginVideoSelectionToolSession(
  clips: readonly VideoTimelineToolClip[],
  options: BeginVideoSelectionToolSessionOptions,
): VideoSelectionToolSessionResult {
  const validation = validateSelectionTimeline(clips);
  if (validation) return { ok: false, reason: validation };
  if (!finiteNonNegative(options.anchorMs)) return { ok: false, reason: 'invalid-session' };
  const original = uniqueBounded(options.selectedClipIds ?? []);
  if (!original) return { ok: false, reason: 'selection-too-large' };
  const trackIds = uniqueStrings(options.targetTrackIds ?? []);
  if (trackIds.length > MAX_VIDEO_TOOL_SESSION_TRACKS) return { ok: false, reason: 'too-many-tracks' };
  const session: VideoSelectionToolSession = {
    kind: 'selection',
    mode: options.mode,
    status: 'active',
    behavior: options.behavior ?? 'replace',
    anchorMs: options.anchorMs,
    currentMs: options.anchorMs,
    targetTrackIds: trackIds,
    originalSelectedClipIds: original,
    previewSelectedClipIds: [...original],
    ...(options.hitClipId ? { hitClipId: options.hitClipId } : {}),
    includeLinked: options.includeLinked !== false,
  };
  return updateSelectionPreview(clips, session);
}

export function updateVideoSelectionToolSession(
  clips: readonly VideoTimelineToolClip[],
  session: VideoSelectionToolSession,
  update: UpdateVideoSelectionToolSessionOptions,
): VideoSelectionToolSessionResult {
  if (session.status !== 'active' || !finiteNonNegative(update.currentMs)) {
    return { ok: false, reason: 'invalid-session' };
  }
  const targetTrackIds = update.targetTrackIds === undefined
    ? session.targetTrackIds
    : uniqueStrings(update.targetTrackIds);
  if (targetTrackIds.length > MAX_VIDEO_TOOL_SESSION_TRACKS) return { ok: false, reason: 'too-many-tracks' };
  return updateSelectionPreview(clips, {
    ...cloneSelectionSession(session),
    currentMs: update.currentMs,
    targetTrackIds,
  });
}

export function commitVideoSelectionToolSession(session: VideoSelectionToolSession): VideoSelectionToolSessionResult {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  return { ok: true, session: { ...cloneSelectionSession(session), status: 'committed' } };
}

export function cancelVideoSelectionToolSession(session: VideoSelectionToolSession): VideoSelectionToolSessionResult {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  return {
    ok: true,
    session: {
      ...cloneSelectionSession(session),
      status: 'cancelled',
      previewSelectedClipIds: [...session.originalSelectedClipIds],
    },
  };
}

export function beginVideoTrimToolSession<TClip extends AdvancedTrimClip>(
  clips: readonly TClip[],
  tracks: readonly AdvancedTrimTrack[],
  options: AdvancedTrimSessionOptions & { framesPerSecond: number },
): VideoTrimToolSessionResult<TClip> {
  if (!finitePositive(options.framesPerSecond)) return { ok: false, reason: 'invalid-frame-rate' };
  const result = createAdvancedTrimSession(clips, tracks, options);
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    session: {
      kind: 'trim',
      mode: options.mode,
      status: 'active',
      framesPerSecond: options.framesPerSecond,
      trim: result.session,
    },
  };
}

export function updateVideoTrimToolSession<TClip extends AdvancedTrimClip>(
  session: VideoTrimToolSession<TClip>,
  deltaMs: number,
): VideoTrimToolSessionResult<TClip> {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  const result = updateAdvancedTrimSession(session.trim, deltaMs);
  if (!result.applied) return { ok: false, reason: result.reason ?? 'invalid-session' };
  return { ok: true, session: { ...cloneTrimSession(session), trim: result.session } };
}

export function updateVideoTrimToolSessionFromDrag<TClip extends AdvancedTrimClip>(
  session: VideoTrimToolSession<TClip>,
  input: { originClientX: number; currentClientX: number; millisecondsPerPixel: number; quantizeFrames?: boolean },
): VideoTrimToolSessionResult<TClip> {
  if (![input.originClientX, input.currentClientX, input.millisecondsPerPixel].every(Number.isFinite)
    || input.millisecondsPerPixel <= 0) return { ok: false, reason: 'invalid-session' };
  const rawDeltaMs = (input.currentClientX - input.originClientX) * input.millisecondsPerPixel;
  return updateVideoTrimToolSession(
    session,
    input.quantizeFrames === false ? rawDeltaMs : quantizeToFrames(rawDeltaMs, session.framesPerSecond),
  );
}

export function updateVideoTrimToolSessionNumeric<TClip extends AdvancedTrimClip>(
  session: VideoTrimToolSession<TClip>,
  input: { value: number; unit: 'frames' | 'milliseconds' },
): VideoTrimToolSessionResult<TClip> {
  if (!Number.isFinite(input.value)) return { ok: false, reason: 'invalid-session' };
  const deltaMs = input.unit === 'frames'
    ? (input.value * 1_000) / session.framesPerSecond
    : input.value;
  return updateVideoTrimToolSession(session, deltaMs);
}

export function commitVideoTrimToolSession<TClip extends AdvancedTrimClip>(
  session: VideoTrimToolSession<TClip>,
): VideoTrimToolSessionResult<TClip> {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  const result = commitAdvancedTrimSession(session.trim);
  if (!result.applied) return { ok: false, reason: result.reason ?? 'invalid-session' };
  return { ok: true, session: { ...cloneTrimSession(session), status: 'committed', trim: result.session } };
}

export function cancelVideoTrimToolSession<TClip extends AdvancedTrimClip>(
  session: VideoTrimToolSession<TClip>,
): VideoTrimToolSessionResult<TClip> {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  const result = cancelAdvancedTrimSession(session.trim);
  if (!result.applied) return { ok: false, reason: result.reason ?? 'invalid-session' };
  return { ok: true, session: { ...cloneTrimSession(session), status: 'cancelled', trim: result.session } };
}

export function beginVideoRateStretchSession<TClip extends VideoRateStretchClip>(
  clips: readonly TClip[],
  primaryClipId: string,
  options: {
    lockedTrackIds?: readonly string[];
    includeLinked?: boolean;
    minimumDurationMs?: number;
    maximumDurationMs?: number;
  } = {},
): { ok: true; session: VideoRateStretchSession<TClip> } | { ok: false; reason: VideoTimelineToolSessionReason } {
  const validation = validateSelectionTimeline(clips);
  if (validation) return { ok: false, reason: validation };
  const primary = clips.find((clip) => clip.id === primaryClipId);
  if (!primary) return { ok: false, reason: 'clip-not-found' };
  if (!finitePositive(primary.playbackRate)) return { ok: false, reason: 'invalid-duration' };
  const members = options.includeLinked !== false && primary.linkGroupId
    ? clips.filter((clip) => clip.linkGroupId === primary.linkGroupId)
    : [primary];
  const locked = new Set(options.lockedTrackIds ?? []);
  if (members.some((clip) => locked.has(clip.trackId))) return { ok: false, reason: 'locked-track' };
  if (members.length > MAX_VIDEO_TOOL_SESSION_SELECTION) return { ok: false, reason: 'selection-too-large' };
  const minimumDurationMs = finitePositive(options.minimumDurationMs) ? Math.max(1, options.minimumDurationMs!) : 1;
  const maximumDurationMs = finitePositive(options.maximumDurationMs)
    ? Math.min(MAX_VIDEO_RATE_STRETCH_DURATION_MS, options.maximumDurationMs!)
    : MAX_VIDEO_RATE_STRETCH_DURATION_MS;
  if (minimumDurationMs > maximumDurationMs) return { ok: false, reason: 'invalid-duration' };
  const originals = members.map(cloneClip);
  return {
    ok: true,
    session: {
      kind: 'rate-stretch',
      mode: 'rate-stretch',
      status: 'active',
      primaryClipId,
      requestedDurationMs: primary.durationMs,
      appliedDurationMs: primary.durationMs,
      minimumDurationMs,
      maximumDurationMs,
      originalClips: originals,
      previewClips: originals.map(cloneClip),
      affectedClipIds: originals.map((clip) => clip.id),
    },
  };
}

export function updateVideoRateStretchSession<TClip extends VideoRateStretchClip>(
  session: VideoRateStretchSession<TClip>,
  requestedDurationMs: number,
): { ok: true; session: VideoRateStretchSession<TClip> } | { ok: false; reason: VideoTimelineToolSessionReason } {
  if (session.status !== 'active' || !finitePositive(requestedDurationMs)) return { ok: false, reason: 'invalid-session' };
  const primary = session.originalClips.find((clip) => clip.id === session.primaryClipId);
  if (!primary) return { ok: false, reason: 'clip-not-found' };
  const appliedDurationMs = clamp(requestedDurationMs, session.minimumDurationMs, session.maximumDurationMs);
  const scale = appliedDurationMs / primary.durationMs;
  const previewClips = session.originalClips.map((clip) => ({
    ...clip,
    durationMs: Math.max(1, Math.round(clip.durationMs * scale)),
    playbackRate: clip.playbackRate / scale,
  }));
  if (previewClips.some((clip) => !finitePositive(clip.playbackRate) || clip.playbackRate < 0.01 || clip.playbackRate > 100)) {
    return { ok: false, reason: 'invalid-duration' };
  }
  return {
    ok: true,
    session: {
      ...cloneRateStretchSession(session),
      requestedDurationMs,
      appliedDurationMs,
      previewClips,
    },
  };
}

export function commitVideoRateStretchSession<TClip extends VideoRateStretchClip>(
  session: VideoRateStretchSession<TClip>,
): { ok: true; session: VideoRateStretchSession<TClip> } | { ok: false; reason: VideoTimelineToolSessionReason } {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  return { ok: true, session: { ...cloneRateStretchSession(session), status: 'committed' } };
}

export function cancelVideoRateStretchSession<TClip extends VideoRateStretchClip>(
  session: VideoRateStretchSession<TClip>,
): { ok: true; session: VideoRateStretchSession<TClip> } | { ok: false; reason: VideoTimelineToolSessionReason } {
  if (session.status !== 'active') return { ok: false, reason: 'invalid-session' };
  return {
    ok: true,
    session: {
      ...cloneRateStretchSession(session),
      status: 'cancelled',
      requestedDurationMs: session.originalClips.find((clip) => clip.id === session.primaryClipId)?.durationMs ?? 0,
      appliedDurationMs: session.originalClips.find((clip) => clip.id === session.primaryClipId)?.durationMs ?? 0,
      previewClips: session.originalClips.map(cloneClip),
    },
  };
}

function updateSelectionPreview(
  clips: readonly VideoTimelineToolClip[],
  session: VideoSelectionToolSession,
): VideoSelectionToolSessionResult {
  const candidates = resolveSelectionCandidates(clips, session);
  const expanded = expandLinkedSelection(clips, candidates, session.includeLinked);
  const next = applySelectionBehavior(session.originalSelectedClipIds, expanded, session.behavior);
  if (next.length > MAX_VIDEO_TOOL_SESSION_SELECTION) return { ok: false, reason: 'selection-too-large' };
  return { ok: true, session: { ...cloneSelectionSession(session), previewSelectedClipIds: next } };
}

function resolveSelectionCandidates(
  clips: readonly VideoTimelineToolClip[],
  session: VideoSelectionToolSession,
): string[] {
  if (session.mode === 'select') return session.hitClipId ? [session.hitClipId] : [];
  const tracks = new Set(session.targetTrackIds);
  const onTargetTrack = (clip: VideoTimelineToolClip) => tracks.size === 0 || tracks.has(clip.trackId);
  if (session.mode === 'track-forward') {
    return clips.filter((clip) => onTargetTrack(clip) && clip.startMs + clip.durationMs > session.anchorMs).map((clip) => clip.id);
  }
  if (session.mode === 'track-back') {
    return clips.filter((clip) => onTargetTrack(clip) && clip.startMs < session.anchorMs).map((clip) => clip.id);
  }
  const start = Math.min(session.anchorMs, session.currentMs);
  const end = Math.max(session.anchorMs, session.currentMs);
  return clips.filter((clip) => onTargetTrack(clip) && clip.startMs < end && clip.startMs + clip.durationMs > start).map((clip) => clip.id);
}

function expandLinkedSelection(
  clips: readonly VideoTimelineToolClip[],
  candidateIds: readonly string[],
  includeLinked: boolean,
): string[] {
  const ids = new Set(candidateIds);
  if (!includeLinked) return [...ids];
  const groups = new Set(clips.filter((clip) => ids.has(clip.id)).map((clip) => clip.linkGroupId).filter(isString));
  for (const clip of clips) if (clip.linkGroupId && groups.has(clip.linkGroupId)) ids.add(clip.id);
  return [...ids];
}

function applySelectionBehavior(
  originalIds: readonly string[],
  candidateIds: readonly string[],
  behavior: VideoSelectionBehavior,
): string[] {
  if (behavior === 'replace') return uniqueStrings(candidateIds);
  const result = new Set(originalIds);
  for (const id of candidateIds) {
    if (behavior === 'toggle' && result.has(id)) result.delete(id);
    else result.add(id);
  }
  return [...result];
}

function validateSelectionTimeline(clips: readonly VideoTimelineToolClip[]): VideoTimelineToolSessionReason | undefined {
  if (clips.length > MAX_VIDEO_TOOL_SESSION_CLIPS) return 'timeline-too-large';
  const tracks = new Set<string>();
  for (const clip of clips) {
    if (!clip.id || !clip.trackId || !finiteNonNegative(clip.startMs) || !finitePositive(clip.durationMs)) return 'invalid-duration';
    tracks.add(clip.trackId);
  }
  return tracks.size > MAX_VIDEO_TOOL_SESSION_TRACKS ? 'too-many-tracks' : undefined;
}

function cloneSelectionSession(session: VideoSelectionToolSession): VideoSelectionToolSession {
  return {
    ...session,
    targetTrackIds: [...session.targetTrackIds],
    originalSelectedClipIds: [...session.originalSelectedClipIds],
    previewSelectedClipIds: [...session.previewSelectedClipIds],
  };
}

function cloneTrimSession<TClip extends AdvancedTrimClip>(session: VideoTrimToolSession<TClip>): VideoTrimToolSession<TClip> {
  return {
    ...session,
    trim: {
      ...session.trim,
      originalClips: session.trim.originalClips.map(cloneClip),
      previewClips: session.trim.previewClips.map(cloneClip),
      affectedClipIds: [...session.trim.affectedClipIds],
      participants: {
        primaryIds: [...session.trim.participants.primaryIds],
        secondaryIds: [...session.trim.participants.secondaryIds],
        leftNeighborIds: [...session.trim.participants.leftNeighborIds],
        rightNeighborIds: [...session.trim.participants.rightNeighborIds],
      },
    },
  };
}

function cloneRateStretchSession<TClip extends VideoRateStretchClip>(session: VideoRateStretchSession<TClip>): VideoRateStretchSession<TClip> {
  return {
    ...session,
    originalClips: session.originalClips.map(cloneClip),
    previewClips: session.previewClips.map(cloneClip),
    affectedClipIds: [...session.affectedClipIds],
  };
}

function uniqueBounded(values: readonly string[]): string[] | undefined {
  const unique = uniqueStrings(values);
  return unique.length <= MAX_VIDEO_TOOL_SESSION_SELECTION ? unique : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(isString))];
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function cloneClip<TClip>(clip: TClip): TClip {
  return { ...clip };
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function quantizeToFrames(deltaMs: number, framesPerSecond: number): number {
  return Math.round((deltaMs * framesPerSecond) / 1_000) * (1_000 / framesPerSecond);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
