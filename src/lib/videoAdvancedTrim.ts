/** Finite, UI-independent advanced trim sessions for a normalized professional Video timeline. */

export const MAX_ADVANCED_TRIM_TRACKS = 64;
export const MAX_ADVANCED_TRIM_CLIPS = 100_000;
export const MAX_ADVANCED_TRIM_AFFECTED_CLIPS = 2_000;

export type AdvancedTrimKind = 'video' | 'audio';
export type AdvancedTrimMode = 'ripple' | 'roll' | 'slip' | 'slide';
export type AdvancedTrimEdge = 'in' | 'out';
export type AdvancedTrimStatus = 'active' | 'committed' | 'cancelled';

export interface AdvancedTrimTrack {
  id: string;
  kind: AdvancedTrimKind;
  locked: boolean;
}

export interface AdvancedTrimClip {
  id: string;
  kind: AdvancedTrimKind;
  trackId: string;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  sourceDurationMs: number;
  playbackRate: number;
  reverse: boolean;
  linkGroupId?: string;
}

export type AdvancedTrimReason =
  | 'affected-clips-too-large'
  | 'clip-not-found'
  | 'invalid-clip'
  | 'invalid-neighbor'
  | 'invalid-session'
  | 'locked-track'
  | 'timeline-too-large'
  | 'too-many-tracks'
  | 'track-kind-mismatch'
  | 'track-not-found';

export interface AdvancedTrimSessionOptions {
  mode: AdvancedTrimMode;
  primaryClipId: string;
  edge?: AdvancedTrimEdge;
  secondaryClipId?: string;
  leftNeighborClipId?: string;
  rightNeighborClipId?: string;
  includeLinked?: boolean;
  minimumDurationMs?: number;
}

interface AdvancedTrimParticipants {
  primaryIds: string[];
  secondaryIds: string[];
  leftNeighborIds: string[];
  rightNeighborIds: string[];
}

export interface AdvancedTrimSession<TClip extends AdvancedTrimClip = AdvancedTrimClip> {
  status: AdvancedTrimStatus;
  mode: AdvancedTrimMode;
  edge?: AdvancedTrimEdge;
  requestedDeltaMs: number;
  appliedDeltaMs: number;
  minimumDeltaMs: number;
  maximumDeltaMs: number;
  minimumDurationMs: number;
  originalClips: TClip[];
  previewClips: TClip[];
  affectedClipIds: string[];
  participants: AdvancedTrimParticipants;
}

export type AdvancedTrimSessionResult<TClip extends AdvancedTrimClip = AdvancedTrimClip> =
  | { ok: true; session: AdvancedTrimSession<TClip> }
  | { ok: false; reason: AdvancedTrimReason };

export interface AdvancedTrimTransitionResult<TClip extends AdvancedTrimClip = AdvancedTrimClip> {
  applied: boolean;
  session: AdvancedTrimSession<TClip>;
  reason?: AdvancedTrimReason;
}

export function createAdvancedTrimSession<TClip extends AdvancedTrimClip>(
  clips: readonly TClip[],
  tracks: readonly AdvancedTrimTrack[],
  options: AdvancedTrimSessionOptions,
): AdvancedTrimSessionResult<TClip> {
  const validated = validateTimeline(clips, tracks);
  if ('reason' in validated) return { ok: false, reason: validated.reason };
  const minimumDurationMs = Number.isFinite(options.minimumDurationMs)
    ? Math.max(1, Math.round(options.minimumDurationMs!))
    : 1;
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const primary = clipById.get(options.primaryClipId);
  if (!primary) return { ok: false, reason: 'clip-not-found' };
  const includeLinked = options.includeLinked !== false;
  const primaryIds = expandGroupIds(clips, primary, includeLinked);
  const participants: AdvancedTrimParticipants = {
    primaryIds,
    secondaryIds: [],
    leftNeighborIds: [],
    rightNeighborIds: [],
  };

  if (options.mode === 'ripple') {
    if (options.edge !== 'in' && options.edge !== 'out') return { ok: false, reason: 'invalid-session' };
  } else if (options.mode === 'roll') {
    const secondary = options.secondaryClipId ? clipById.get(options.secondaryClipId) : undefined;
    if (!secondary) return { ok: false, reason: 'invalid-neighbor' };
    participants.secondaryIds = expandGroupIds(clips, secondary, includeLinked);
    if (!areGroupNeighbors(clips, participants.primaryIds, participants.secondaryIds, 'right')) {
      return { ok: false, reason: 'invalid-neighbor' };
    }
  } else if (options.mode === 'slide') {
    const left = options.leftNeighborClipId ? clipById.get(options.leftNeighborClipId) : undefined;
    const right = options.rightNeighborClipId ? clipById.get(options.rightNeighborClipId) : undefined;
    if (!left || !right) return { ok: false, reason: 'invalid-neighbor' };
    participants.leftNeighborIds = expandGroupIds(clips, left, includeLinked);
    participants.rightNeighborIds = expandGroupIds(clips, right, includeLinked);
    if (!areGroupNeighbors(clips, participants.leftNeighborIds, participants.primaryIds, 'right')
      || !areGroupNeighbors(clips, participants.primaryIds, participants.rightNeighborIds, 'right')) {
      return { ok: false, reason: 'invalid-neighbor' };
    }
  }

  const directlyAffected = new Set([
    ...participants.primaryIds,
    ...participants.secondaryIds,
    ...participants.leftNeighborIds,
    ...participants.rightNeighborIds,
  ]);
  for (const clipId of directlyAffected) {
    const clip = clipById.get(clipId);
    if (!clip) return { ok: false, reason: 'clip-not-found' };
    if (validated.trackById.get(clip.trackId)?.locked) return { ok: false, reason: 'locked-track' };
  }

  const limits = calculateLimits(clips, options, participants, minimumDurationMs);
  if (!limits) return { ok: false, reason: 'invalid-session' };
  const originals = clips.map(cloneClip);
  const session: AdvancedTrimSession<TClip> = {
    status: 'active',
    mode: options.mode,
    edge: options.edge,
    requestedDeltaMs: 0,
    appliedDeltaMs: 0,
    minimumDeltaMs: limits.minimum,
    maximumDeltaMs: limits.maximum,
    minimumDurationMs,
    originalClips: originals,
    previewClips: originals.map(cloneClip),
    affectedClipIds: [],
    participants,
  };
  return { ok: true, session };
}

export function updateAdvancedTrimSession<TClip extends AdvancedTrimClip>(
  session: AdvancedTrimSession<TClip>,
  deltaMs: number,
): AdvancedTrimTransitionResult<TClip> {
  if (session.status !== 'active' || !Number.isFinite(deltaMs)) {
    return { applied: false, session: cloneSession(session), reason: 'invalid-session' };
  }
  const appliedDeltaMs = clamp(deltaMs, session.minimumDeltaMs, session.maximumDeltaMs);
  const preview = applyTrim(session, appliedDeltaMs);
  const affectedClipIds = session.originalClips
    .filter((clip, index) => JSON.stringify(clip) !== JSON.stringify(preview[index]))
    .map((clip) => clip.id);
  if (affectedClipIds.length > MAX_ADVANCED_TRIM_AFFECTED_CLIPS) {
    return { applied: false, session: cloneSession(session), reason: 'affected-clips-too-large' };
  }
  return {
    applied: true,
    session: {
      ...cloneSession(session),
      requestedDeltaMs: deltaMs,
      appliedDeltaMs,
      previewClips: preview,
      affectedClipIds,
    },
  };
}

export function commitAdvancedTrimSession<TClip extends AdvancedTrimClip>(
  session: AdvancedTrimSession<TClip>,
): AdvancedTrimTransitionResult<TClip> {
  if (session.status !== 'active') {
    return { applied: false, session: cloneSession(session), reason: 'invalid-session' };
  }
  return { applied: true, session: { ...cloneSession(session), status: 'committed' } };
}

export function cancelAdvancedTrimSession<TClip extends AdvancedTrimClip>(
  session: AdvancedTrimSession<TClip>,
): AdvancedTrimTransitionResult<TClip> {
  if (session.status !== 'active') {
    return { applied: false, session: cloneSession(session), reason: 'invalid-session' };
  }
  const originals = session.originalClips.map(cloneClip);
  return {
    applied: true,
    session: {
      ...cloneSession(session),
      status: 'cancelled',
      requestedDeltaMs: 0,
      appliedDeltaMs: 0,
      previewClips: originals,
      affectedClipIds: [],
    },
  };
}

function applyTrim<TClip extends AdvancedTrimClip>(session: AdvancedTrimSession<TClip>, deltaMs: number): TClip[] {
  const clips = session.originalClips.map(cloneClip);
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const primary = session.participants.primaryIds.map((id) => clipById.get(id)!).filter(Boolean);
  const secondary = session.participants.secondaryIds.map((id) => clipById.get(id)!).filter(Boolean);
  const leftNeighbors = session.participants.leftNeighborIds.map((id) => clipById.get(id)!).filter(Boolean);
  const rightNeighbors = session.participants.rightNeighborIds.map((id) => clipById.get(id)!).filter(Boolean);

  if (session.mode === 'ripple') {
    const primaryIds = new Set(session.participants.primaryIds);
    for (const selected of primary) {
      const boundary = session.edge === 'in' ? selected.startMs : selected.startMs + selected.durationMs;
      if (session.edge === 'in') {
        selected.sourceInMs = advanceSource(selected, deltaMs);
        selected.durationMs -= deltaMs;
      } else {
        selected.durationMs += deltaMs;
      }
      for (const clip of clips) {
        if (primaryIds.has(clip.id) || clip.trackId !== selected.trackId || clip.startMs < boundary) continue;
        clip.startMs += session.edge === 'in' ? -deltaMs : deltaMs;
      }
    }
  } else if (session.mode === 'roll') {
    for (const clip of primary) clip.durationMs += deltaMs;
    for (const clip of secondary) {
      clip.startMs += deltaMs;
      clip.durationMs -= deltaMs;
      clip.sourceInMs = advanceSource(clip, deltaMs);
    }
  } else if (session.mode === 'slip') {
    for (const clip of primary) clip.sourceInMs = advanceSource(clip, deltaMs);
  } else {
    for (const clip of primary) clip.startMs += deltaMs;
    for (const clip of leftNeighbors) clip.durationMs += deltaMs;
    for (const clip of rightNeighbors) {
      clip.startMs += deltaMs;
      clip.durationMs -= deltaMs;
      clip.sourceInMs = advanceSource(clip, deltaMs);
    }
  }
  return clips;
}

function calculateLimits<TClip extends AdvancedTrimClip>(
  clips: readonly TClip[],
  options: AdvancedTrimSessionOptions,
  participants: AdvancedTrimParticipants,
  minimumDurationMs: number,
): { minimum: number; maximum: number } | null {
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const primary = participants.primaryIds.map((id) => clipById.get(id)!).filter(Boolean);
  const secondary = participants.secondaryIds.map((id) => clipById.get(id)!).filter(Boolean);
  const left = participants.leftNeighborIds.map((id) => clipById.get(id)!).filter(Boolean);
  const right = participants.rightNeighborIds.map((id) => clipById.get(id)!).filter(Boolean);
  let minimum = Number.NEGATIVE_INFINITY;
  let maximum = Number.POSITIVE_INFINITY;

  if (options.mode === 'ripple' && options.edge === 'in') {
    for (const clip of primary) {
      minimum = Math.max(minimum, -headHandleMs(clip));
      maximum = Math.min(maximum, clip.durationMs - minimumDurationMs);
    }
  } else if (options.mode === 'ripple') {
    for (const clip of primary) {
      minimum = Math.max(minimum, -(clip.durationMs - minimumDurationMs));
      maximum = Math.min(maximum, tailHandleMs(clip));
    }
  } else if (options.mode === 'roll') {
    for (const clip of primary) {
      minimum = Math.max(minimum, -(clip.durationMs - minimumDurationMs));
      maximum = Math.min(maximum, tailHandleMs(clip));
    }
    for (const clip of secondary) {
      minimum = Math.max(minimum, -headHandleMs(clip));
      maximum = Math.min(maximum, clip.durationMs - minimumDurationMs);
    }
  } else if (options.mode === 'slip') {
    for (const clip of primary) {
      const limits = sourceShiftLimits(clip);
      minimum = Math.max(minimum, limits.minimum);
      maximum = Math.min(maximum, limits.maximum);
    }
  } else {
    for (const clip of primary) minimum = Math.max(minimum, -clip.startMs);
    for (const clip of left) {
      minimum = Math.max(minimum, -(clip.durationMs - minimumDurationMs));
      maximum = Math.min(maximum, tailHandleMs(clip));
    }
    for (const clip of right) {
      minimum = Math.max(minimum, -headHandleMs(clip));
      maximum = Math.min(maximum, clip.durationMs - minimumDurationMs);
    }
  }
  if (!Number.isFinite(minimum)) minimum = 0;
  if (!Number.isFinite(maximum)) maximum = 0;
  return minimum <= maximum ? { minimum, maximum } : null;
}

function validateTimeline<TClip extends AdvancedTrimClip>(
  clips: readonly TClip[],
  tracks: readonly AdvancedTrimTrack[],
): { trackById: Map<string, AdvancedTrimTrack> } | { reason: AdvancedTrimReason } {
  if (tracks.length > MAX_ADVANCED_TRIM_TRACKS) return { reason: 'too-many-tracks' };
  if (clips.length > MAX_ADVANCED_TRIM_CLIPS) return { reason: 'timeline-too-large' };
  const trackById = new Map<string, AdvancedTrimTrack>();
  for (const track of tracks) {
    if (!track.id || (track.kind !== 'video' && track.kind !== 'audio') || trackById.has(track.id)) {
      return { reason: 'track-not-found' };
    }
    trackById.set(track.id, track);
  }
  for (const clip of clips) {
    const track = trackById.get(clip.trackId);
    if (!isValidClip(clip)) return { reason: 'invalid-clip' };
    if (!track) return { reason: 'track-not-found' };
    if (track.kind !== clip.kind) return { reason: 'track-kind-mismatch' };
  }
  return { trackById };
}

function isValidClip(clip: AdvancedTrimClip): boolean {
  if (!clip.id || !clip.trackId
    || !Number.isFinite(clip.startMs) || clip.startMs < 0
    || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0
    || !Number.isFinite(clip.sourceInMs) || clip.sourceInMs < 0
    || !Number.isFinite(clip.sourceDurationMs) || clip.sourceDurationMs <= 0
    || !Number.isFinite(clip.playbackRate) || clip.playbackRate <= 0) return false;
  const end = advanceSource(clip, clip.durationMs);
  return end >= 0 && end <= clip.sourceDurationMs && clip.sourceInMs <= clip.sourceDurationMs;
}

function expandGroupIds<TClip extends AdvancedTrimClip>(
  clips: readonly TClip[],
  anchor: TClip,
  includeLinked: boolean,
): string[] {
  if (!includeLinked || !anchor.linkGroupId) return [anchor.id];
  return clips.filter((clip) => clip.linkGroupId === anchor.linkGroupId).map((clip) => clip.id);
}

function areGroupNeighbors<TClip extends AdvancedTrimClip>(
  clips: readonly TClip[],
  leftIds: readonly string[],
  rightIds: readonly string[],
  direction: 'right',
): boolean {
  void direction;
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const leftByTrack = new Map(leftIds.map((id) => {
    const clip = clipById.get(id)!;
    return [clip.trackId, clip] as const;
  }));
  const rightByTrack = new Map(rightIds.map((id) => {
    const clip = clipById.get(id)!;
    return [clip.trackId, clip] as const;
  }));
  if (leftByTrack.size !== rightByTrack.size) return false;
  for (const [trackId, left] of leftByTrack) {
    const right = rightByTrack.get(trackId);
    if (!right || Math.abs(left.startMs + left.durationMs - right.startMs) > 0.001) return false;
  }
  return true;
}

function advanceSource(clip: AdvancedTrimClip, timelineDeltaMs: number): number {
  return clip.sourceInMs + timelineDeltaMs * clip.playbackRate * (clip.reverse ? -1 : 1);
}

function headHandleMs(clip: AdvancedTrimClip): number {
  return (clip.reverse ? clip.sourceDurationMs - clip.sourceInMs : clip.sourceInMs) / clip.playbackRate;
}

function tailHandleMs(clip: AdvancedTrimClip): number {
  const sourceEnd = advanceSource(clip, clip.durationMs);
  return (clip.reverse ? sourceEnd : clip.sourceDurationMs - sourceEnd) / clip.playbackRate;
}

function sourceShiftLimits(clip: AdvancedTrimClip): { minimum: number; maximum: number } {
  const sourceEnd = advanceSource(clip, clip.durationMs);
  if (!clip.reverse) {
    return {
      minimum: -clip.sourceInMs / clip.playbackRate,
      maximum: (clip.sourceDurationMs - sourceEnd) / clip.playbackRate,
    };
  }
  return {
    minimum: -(clip.sourceDurationMs - clip.sourceInMs) / clip.playbackRate,
    maximum: sourceEnd / clip.playbackRate,
  };
}

function cloneClip<TClip extends AdvancedTrimClip>(clip: TClip): TClip {
  return { ...clip };
}

function cloneSession<TClip extends AdvancedTrimClip>(session: AdvancedTrimSession<TClip>): AdvancedTrimSession<TClip> {
  return {
    ...session,
    originalClips: session.originalClips.map(cloneClip),
    previewClips: session.previewClips.map(cloneClip),
    affectedClipIds: [...session.affectedClipIds],
    participants: {
      primaryIds: [...session.participants.primaryIds],
      secondaryIds: [...session.participants.secondaryIds],
      leftNeighborIds: [...session.participants.leftNeighborIds],
      rightNeighborIds: [...session.participants.rightNeighborIds],
    },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
