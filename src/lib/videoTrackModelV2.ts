/**
 * Integration-ready track domain for the Video workspace.  The legacy editor stores a numeric
 * `trackIndex` on clips; V2 deliberately uses stable IDs and provides an explicit four-per-kind
 * projection so the UI can migrate incrementally without changing persisted clips in one jump.
 */

export const VIDEO_TRACK_MODEL_V2_VERSION = 2 as const;
export const MAX_VIDEO_TRACKS_V2 = 64;
export const LEGACY_TRACKS_PER_KIND = 4;

export type VideoTrackKindV2 = 'video' | 'audio';

export interface VideoTrackSourcePatchV2 {
  sourceChannel: number;
  enabled: boolean;
}

export interface VideoTrackV2 {
  id: string;
  kind: VideoTrackKindV2;
  order: number;
  name: string;
  heightPx: number;
  locked: boolean;
  syncLock: boolean;
  targetArmed: boolean;
  sourcePatch?: VideoTrackSourcePatchV2;
}

export interface VideoTrackModelV2 {
  version: typeof VIDEO_TRACK_MODEL_V2_VERSION;
  tracks: VideoTrackV2[];
}

export interface LegacyTrackState {
  videoTrackCount?: number;
  audioTrackCount?: number;
  lockedVideoTrackIndexes?: readonly number[];
  lockedAudioTrackIndexes?: readonly number[];
  syncLockedVideoTrackIndexes?: readonly number[];
  syncLockedAudioTrackIndexes?: readonly number[];
  armedVideoTrackIndexes?: readonly number[];
  armedAudioTrackIndexes?: readonly number[];
}

export interface LegacyTrackProjection {
  videoTrackIds: string[];
  audioTrackIds: string[];
  trackIndexById: Record<string, number>;
  truncatedTrackIds: string[];
}

export interface LinkedTimelineClipV2 {
  id: string;
  trackId: string;
  startMs: number;
  durationMs: number;
  sourceInMs?: number;
  linkGroupId?: string;
  /** Difference from the link group's anchor start. Preserved when a linked group moves. */
  linkSyncOffsetMs?: number;
}

export interface TrackEditResult<TClip extends LinkedTimelineClipV2> {
  clips: TClip[];
  applied: boolean;
  affectedClipIds: string[];
  reason?: 'clip-not-found' | 'track-not-found' | 'track-locked' | 'kind-mismatch' | 'invalid-time';
}

function clampTrackCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return LEGACY_TRACKS_PER_KIND;
  return Math.max(0, Math.min(MAX_VIDEO_TRACKS_V2, Math.floor(value ?? LEGACY_TRACKS_PER_KIND)));
}

function indexSet(values: readonly number[] | undefined): Set<number> {
  return new Set((values ?? []).filter((value) => Number.isInteger(value) && value >= 0));
}

function defaultTrackName(kind: VideoTrackKindV2, order: number): string {
  return `${kind === 'video' ? 'Video' : 'Audio'} ${order + 1}`;
}

export function legacyTrackId(kind: VideoTrackKindV2, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Legacy track index must be a non-negative integer.');
  return `legacy-${kind}-${index + 1}`;
}

export function migrateLegacyTracksToV2(state: LegacyTrackState = {}): VideoTrackModelV2 {
  let videoCount = clampTrackCount(state.videoTrackCount);
  let audioCount = clampTrackCount(state.audioTrackCount);
  if (videoCount + audioCount > MAX_VIDEO_TRACKS_V2) {
    audioCount = Math.max(0, MAX_VIDEO_TRACKS_V2 - videoCount);
  }

  const lockedVideo = indexSet(state.lockedVideoTrackIndexes);
  const lockedAudio = indexSet(state.lockedAudioTrackIndexes);
  const syncVideo = indexSet(state.syncLockedVideoTrackIndexes);
  const syncAudio = indexSet(state.syncLockedAudioTrackIndexes);
  const armedVideo = indexSet(state.armedVideoTrackIndexes);
  const armedAudio = indexSet(state.armedAudioTrackIndexes);
  const tracks: VideoTrackV2[] = [];

  for (let index = 0; index < videoCount; index += 1) {
    tracks.push({
      id: legacyTrackId('video', index),
      kind: 'video',
      order: index,
      name: defaultTrackName('video', index),
      heightPx: 72,
      locked: lockedVideo.has(index),
      syncLock: syncVideo.has(index),
      targetArmed: armedVideo.has(index),
      sourcePatch: { sourceChannel: index, enabled: armedVideo.has(index) },
    });
  }
  for (let index = 0; index < audioCount; index += 1) {
    tracks.push({
      id: legacyTrackId('audio', index),
      kind: 'audio',
      order: index,
      name: defaultTrackName('audio', index),
      heightPx: 56,
      locked: lockedAudio.has(index),
      syncLock: syncAudio.has(index),
      targetArmed: armedAudio.has(index),
      sourcePatch: { sourceChannel: index, enabled: armedAudio.has(index) },
    });
  }
  return { version: VIDEO_TRACK_MODEL_V2_VERSION, tracks };
}

function sortedKindTracks(model: VideoTrackModelV2, kind: VideoTrackKindV2): VideoTrackV2[] {
  return model.tracks
    .filter((track) => track.kind === kind)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function projectTracksToLegacy(
  model: VideoTrackModelV2,
  limitPerKind = LEGACY_TRACKS_PER_KIND,
): LegacyTrackProjection {
  const safeLimit = Math.max(0, Math.floor(limitPerKind));
  const videos = sortedKindTracks(model, 'video');
  const audios = sortedKindTracks(model, 'audio');
  const videoTrackIds = videos.slice(0, safeLimit).map((track) => track.id);
  const audioTrackIds = audios.slice(0, safeLimit).map((track) => track.id);
  const trackIndexById: Record<string, number> = {};
  videoTrackIds.forEach((id, index) => { trackIndexById[id] = index; });
  audioTrackIds.forEach((id, index) => { trackIndexById[id] = index; });
  return {
    videoTrackIds,
    audioTrackIds,
    trackIndexById,
    truncatedTrackIds: [...videos.slice(safeLimit), ...audios.slice(safeLimit)].map((track) => track.id),
  };
}

function normalizeOrders(tracks: readonly VideoTrackV2[]): VideoTrackV2[] {
  const orderById = new Map<string, number>();
  (['video', 'audio'] as const).forEach((kind) => {
    tracks
      .filter((track) => track.kind === kind)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .forEach((track, index) => orderById.set(track.id, index));
  });
  return tracks.map((track) => ({ ...track, order: orderById.get(track.id) ?? track.order }));
}

function nextTrackId(model: VideoTrackModelV2, kind: VideoTrackKindV2): string {
  const used = new Set(model.tracks.map((track) => track.id));
  let suffix = 1;
  while (used.has(`${kind}-${suffix}`)) suffix += 1;
  return `${kind}-${suffix}`;
}

export function addVideoTrackV2(
  model: VideoTrackModelV2,
  kind: VideoTrackKindV2,
  input: Partial<Omit<VideoTrackV2, 'kind' | 'order'>> = {},
): VideoTrackModelV2 {
  if (model.tracks.length >= MAX_VIDEO_TRACKS_V2) throw new Error(`A sequence supports at most ${MAX_VIDEO_TRACKS_V2} tracks.`);
  const kindCount = model.tracks.filter((track) => track.kind === kind).length;
  const id = input.id?.trim() || nextTrackId(model, kind);
  if (model.tracks.some((track) => track.id === id)) throw new Error(`Track ID already exists: ${id}`);
  const track: VideoTrackV2 = {
    id,
    kind,
    order: kindCount,
    name: input.name?.trim() || defaultTrackName(kind, kindCount),
    heightPx: Number.isFinite(input.heightPx) ? Math.max(28, Math.min(240, input.heightPx ?? 64)) : kind === 'video' ? 72 : 56,
    locked: input.locked ?? false,
    syncLock: input.syncLock ?? true,
    targetArmed: input.targetArmed ?? false,
    sourcePatch: input.sourcePatch ? { ...input.sourcePatch } : undefined,
  };
  return { ...model, tracks: [...model.tracks.map((existing) => ({ ...existing })), track] };
}

export function deleteVideoTrackV2(model: VideoTrackModelV2, trackId: string): VideoTrackModelV2 {
  if (!model.tracks.some((track) => track.id === trackId)) return model;
  return { ...model, tracks: normalizeOrders(model.tracks.filter((track) => track.id !== trackId)) };
}

export function reorderVideoTrackV2(
  model: VideoTrackModelV2,
  trackId: string,
  targetOrder: number,
): VideoTrackModelV2 {
  const track = model.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return model;
  const sameKind = sortedKindTracks(model, track.kind).filter((candidate) => candidate.id !== trackId);
  const safeOrder = Math.max(0, Math.min(sameKind.length, Math.floor(targetOrder)));
  sameKind.splice(safeOrder, 0, track);
  const orderById = new Map(sameKind.map((candidate, index) => [candidate.id, index]));
  return {
    ...model,
    tracks: model.tracks.map((candidate) => ({ ...candidate, order: candidate.kind === track.kind ? orderById.get(candidate.id) ?? candidate.order : candidate.order })),
  };
}

export function renameVideoTrackV2(model: VideoTrackModelV2, trackId: string, name: string): VideoTrackModelV2 {
  const cleanName = name.trim().slice(0, 80);
  if (!cleanName) return model;
  let found = false;
  const tracks = model.tracks.map((track) => {
    if (track.id !== trackId) return track;
    found = true;
    return { ...track, name: cleanName };
  });
  return found ? { ...model, tracks } : model;
}

export function setVideoTrackSourcePatchV2(
  model: VideoTrackModelV2,
  trackId: string,
  sourcePatch: VideoTrackSourcePatchV2 | undefined,
): VideoTrackModelV2 {
  return {
    ...model,
    tracks: model.tracks.map((track) => track.id === trackId
      ? { ...track, sourcePatch: sourcePatch ? { ...sourcePatch } : undefined }
      : track),
  };
}

export function buildVideoSourcePatchPlanV2(model: VideoTrackModelV2): Array<{
  trackId: string;
  kind: VideoTrackKindV2;
  sourceChannel: number;
}> {
  return model.tracks
    .filter((track) => track.targetArmed && track.sourcePatch?.enabled)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.order - right.order)
    .map((track) => ({ trackId: track.id, kind: track.kind, sourceChannel: track.sourcePatch?.sourceChannel ?? 0 }));
}

export function linkTimelineClipsV2<TClip extends LinkedTimelineClipV2>(
  clips: readonly TClip[],
  clipIds: readonly string[],
  linkGroupId: string,
): TClip[] {
  const selected = new Set(clipIds);
  const members = clips.filter((clip) => selected.has(clip.id));
  if (members.length < 2 || !linkGroupId.trim()) return clips.map((clip) => ({ ...clip }));
  const anchorMs = Math.min(...members.map((clip) => clip.startMs));
  return clips.map((clip) => selected.has(clip.id)
    ? { ...clip, linkGroupId, linkSyncOffsetMs: clip.startMs - anchorMs }
    : { ...clip });
}

function affectedLinkedIds<TClip extends LinkedTimelineClipV2>(clips: readonly TClip[], clipId: string): Set<string> {
  const primary = clips.find((clip) => clip.id === clipId);
  if (!primary) return new Set();
  if (!primary.linkGroupId) return new Set([clipId]);
  return new Set(clips.filter((clip) => clip.linkGroupId === primary.linkGroupId).map((clip) => clip.id));
}

function rejected<TClip extends LinkedTimelineClipV2>(clips: readonly TClip[], reason: TrackEditResult<TClip>['reason']): TrackEditResult<TClip> {
  return { clips: clips.map((clip) => ({ ...clip })), applied: false, affectedClipIds: [], reason };
}

export function moveLinkedTimelineClipsV2<TClip extends LinkedTimelineClipV2>(
  model: VideoTrackModelV2,
  clips: readonly TClip[],
  clipId: string,
  deltaMs: number,
  destinationTrackId?: string,
): TrackEditResult<TClip> {
  if (!Number.isFinite(deltaMs)) return rejected(clips, 'invalid-time');
  const primary = clips.find((clip) => clip.id === clipId);
  if (!primary) return rejected(clips, 'clip-not-found');
  const primaryTrack = model.tracks.find((track) => track.id === primary.trackId);
  if (!primaryTrack) return rejected(clips, 'track-not-found');
  const affected = affectedLinkedIds(clips, clipId);
  const affectedClips = clips.filter((clip) => affected.has(clip.id));
  if (affectedClips.some((clip) => model.tracks.find((track) => track.id === clip.trackId)?.locked)) {
    return rejected(clips, 'track-locked');
  }
  if (destinationTrackId) {
    const destination = model.tracks.find((track) => track.id === destinationTrackId);
    if (!destination) return rejected(clips, 'track-not-found');
    if (destination.locked) return rejected(clips, 'track-locked');
    if (destination.kind !== primaryTrack.kind) return rejected(clips, 'kind-mismatch');
  }
  if (affectedClips.some((clip) => clip.startMs + deltaMs < 0)) return rejected(clips, 'invalid-time');
  const moved = clips.map((clip) => {
    if (!affected.has(clip.id)) return { ...clip };
    return {
      ...clip,
      startMs: clip.startMs + deltaMs,
      trackId: clip.id === clipId && destinationTrackId ? destinationTrackId : clip.trackId,
    };
  });
  return { clips: moved, applied: true, affectedClipIds: [...affected].sort() };
}

export function deleteLinkedTimelineClipsV2<TClip extends LinkedTimelineClipV2>(
  model: VideoTrackModelV2,
  clips: readonly TClip[],
  clipId: string,
): TrackEditResult<TClip> {
  const affected = affectedLinkedIds(clips, clipId);
  if (affected.size === 0) return rejected(clips, 'clip-not-found');
  if (clips.some((clip) => affected.has(clip.id) && model.tracks.find((track) => track.id === clip.trackId)?.locked)) {
    return rejected(clips, 'track-locked');
  }
  return {
    clips: clips.filter((clip) => !affected.has(clip.id)).map((clip) => ({ ...clip })),
    applied: true,
    affectedClipIds: [...affected].sort(),
  };
}

/** Ripple all clips at/after an edit point on the edited track plus sync-locked tracks. */
export function rippleTimelineClipsV2<TClip extends LinkedTimelineClipV2>(
  model: VideoTrackModelV2,
  clips: readonly TClip[],
  trackId: string,
  editPointMs: number,
  deltaMs: number,
): TrackEditResult<TClip> {
  const track = model.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return rejected(clips, 'track-not-found');
  if (!Number.isFinite(editPointMs) || !Number.isFinite(deltaMs) || editPointMs < 0) return rejected(clips, 'invalid-time');
  const rippleTrackIds = new Set(model.tracks
    .filter((candidate) => candidate.id === trackId || candidate.syncLock)
    .map((candidate) => candidate.id));
  const initiallyAffected = new Set(clips
    .filter((clip) => rippleTrackIds.has(clip.trackId) && clip.startMs >= editPointMs)
    .map((clip) => clip.id));
  for (const clip of clips) {
    if (clip.linkGroupId && initiallyAffected.has(clip.id)) {
      clips.filter((candidate) => candidate.linkGroupId === clip.linkGroupId).forEach((candidate) => initiallyAffected.add(candidate.id));
    }
  }
  const affectedClips = clips.filter((clip) => initiallyAffected.has(clip.id));
  if (affectedClips.some((clip) => model.tracks.find((candidate) => candidate.id === clip.trackId)?.locked)) {
    return rejected(clips, 'track-locked');
  }
  if (affectedClips.some((clip) => clip.startMs + deltaMs < 0)) return rejected(clips, 'invalid-time');
  return {
    clips: clips.map((clip) => initiallyAffected.has(clip.id) ? { ...clip, startMs: clip.startMs + deltaMs } : { ...clip }),
    applied: true,
    affectedClipIds: [...initiallyAffected].sort(),
  };
}
