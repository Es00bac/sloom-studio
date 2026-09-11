/**
 * Pure source/record editing proposals for the professional Video timeline.
 *
 * The normalized model keeps this engine independent from React and from the legacy visual/audio
 * clip property names. Callers adapt clips at the boundary and commit one returned proposal as one
 * history transaction. Source time is the media time shown at a clip's first timeline frame; it
 * decreases for a reversed clip.
 */

export const MAX_SOURCE_RECORD_TRACKS = 64;
export const MAX_SOURCE_RECORD_CLIPS = 100_000;
export const MAX_SOURCE_RECORD_AFFECTED_CLIPS = 2_000;

export type SourceRecordKind = 'video' | 'audio';

export interface SourceRecordTrack {
  id: string;
  kind: SourceRecordKind;
  order: number;
  locked: boolean;
  syncLocked: boolean;
  recordTarget: boolean;
  sourceChannel?: number;
}

export interface SourceRecordClip {
  id: string;
  kind: SourceRecordKind;
  trackId: string;
  startMs: number;
  durationMs: number;
  sourceId: string;
  sourceInMs: number;
  sourceDurationMs?: number;
  playbackRate: number;
  reverse: boolean;
  enabled: boolean;
  linkGroupId?: string;
}

export interface SourceRecordRange {
  inMs: number;
  outMs: number;
}

export type SourceRecordEditReason =
  | 'affected-clips-too-large'
  | 'empty-record-targets'
  | 'invalid-clip'
  | 'invalid-range'
  | 'invalid-source'
  | 'locked-track'
  | 'timeline-too-large'
  | 'too-many-tracks'
  | 'track-kind-mismatch'
  | 'track-not-found';

export interface SourceRecordProposal<TClip extends SourceRecordClip> {
  applied: boolean;
  clips: TClip[];
  affectedClipIds: string[];
  createdClipIds: string[];
  removedClipIds: string[];
  recordTrackIds: string[];
  reason?: SourceRecordEditReason;
}

export interface SourceRecordTargetResult {
  applied: boolean;
  tracks: SourceRecordTrack[];
  reason?: SourceRecordEditReason;
}

export interface SourceRecordEditOptions {
  targetTrackIds?: readonly string[];
  includeLinked?: boolean;
  createId?: (clip: SourceRecordClip, fragmentIndex: number) => string;
  createLinkGroupId?: (linkGroupId: string, splitIndex: number) => string;
}

export interface SourceRecordReplacement {
  targetTrackId: string;
  sourceId: string;
  sourceInMs: number;
  durationMs: number;
  sourceDurationMs?: number;
  playbackRate?: number;
  reverse?: boolean;
  enabled?: boolean;
  linkGroupId?: string;
  createId?: string;
}

export interface SourceRecordReplaceOptions {
  includeLinked?: boolean;
  requireRecordTarget?: boolean;
  createId?: (replacement: SourceRecordReplacement, replacementIndex: number) => string;
}

export interface SourceRecordMatchFrame {
  clipId: string;
  sourceId: string;
  recordTimeMs: number;
  sourceTimeMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  reverse: boolean;
}

export interface SourceRecordMatchResult {
  matched: boolean;
  match?: SourceRecordMatchFrame;
  reason?: 'clip-not-found' | 'record-time-outside-clip' | 'invalid-clip';
}

export interface SourceRecordNavigationResult {
  found: boolean;
  timeMs?: number;
  clipIds: string[];
  reason?: SourceRecordEditReason;
}

export function resolveSourceRecordTargets(
  tracks: readonly SourceRecordTrack[],
): SourceRecordTargetResult {
  if (tracks.length > MAX_SOURCE_RECORD_TRACKS) {
    return { applied: false, tracks: [], reason: 'too-many-tracks' };
  }
  const seen = new Set<string>();
  for (const track of tracks) {
    if (!isValidTrack(track) || seen.has(track.id)) {
      return { applied: false, tracks: [], reason: 'track-not-found' };
    }
    seen.add(track.id);
  }
  const targets = tracks
    .filter((track) => track.recordTarget)
    .map((track) => ({ ...track }))
    .sort(compareTracks);
  return targets.length > 0
    ? { applied: true, tracks: targets }
    : { applied: false, tracks: [], reason: 'empty-record-targets' };
}

export function proposeSourceRecordLift<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  tracks: readonly SourceRecordTrack[],
  range: SourceRecordRange,
  options: SourceRecordEditOptions = {},
): SourceRecordProposal<TClip> {
  const prepared = prepareRangeEdit(clips, tracks, range, options);
  if ('reason' in prepared) return rejected(clips, prepared.reason);
  return removeRanges(clips, prepared.trackById, prepared.rangesByTrack, prepared.recordTrackIds, options);
}

export function proposeSourceRecordExtract<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  tracks: readonly SourceRecordTrack[],
  range: SourceRecordRange,
  options: SourceRecordEditOptions = {},
): SourceRecordProposal<TClip> {
  const prepared = prepareRangeEdit(clips, tracks, range, options);
  if ('reason' in prepared) return rejected(clips, prepared.reason);

  const rippleTrackIds = new Set(prepared.recordTrackIds);
  for (const track of tracks) {
    if (track.syncLocked) rippleTrackIds.add(track.id);
  }
  const linkedGroups = new Set(
    clips
      .filter((clip) => rippleTrackIds.has(clip.trackId)
        && clip.linkGroupId
        && (clip.startMs >= range.outMs || overlaps(clip, range)))
      .map((clip) => clip.linkGroupId as string),
  );
  if (options.includeLinked !== false) {
    for (const clip of clips) {
      if (clip.linkGroupId && linkedGroups.has(clip.linkGroupId)) rippleTrackIds.add(clip.trackId);
    }
  }
  for (const trackId of rippleTrackIds) {
    const track = prepared.trackById.get(trackId);
    if (!track) return rejected(clips, 'track-not-found');
    if (track.locked) return rejected(clips, 'locked-track');
  }

  const lifted = removeRanges(clips, prepared.trackById, prepared.rangesByTrack, prepared.recordTrackIds, options);
  if (!lifted.applied) return lifted;
  const deltaMs = range.outMs - range.inMs;
  const movedIds: string[] = [];
  const moved = lifted.clips.map((clip) => {
    if (!rippleTrackIds.has(clip.trackId) || clip.startMs < range.outMs) return { ...clip };
    movedIds.push(clip.id);
    return { ...clip, startMs: clip.startMs - deltaMs };
  });
  const affected = uniqueStrings([...lifted.affectedClipIds, ...movedIds]);
  if (affected.length > MAX_SOURCE_RECORD_AFFECTED_CLIPS) return rejected(clips, 'affected-clips-too-large');
  return { ...lifted, clips: moved, affectedClipIds: affected };
}

export function proposeSourceRecordReplace<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  tracks: readonly SourceRecordTrack[],
  recordInMs: number,
  replacements: readonly SourceRecordReplacement[],
  options: SourceRecordReplaceOptions = {},
): SourceRecordProposal<TClip> {
  const validated = validateTimeline(clips, tracks);
  if ('reason' in validated) return rejected(clips, validated.reason);
  if (!Number.isFinite(recordInMs) || recordInMs < 0 || replacements.length === 0) {
    return rejected(clips, 'invalid-range');
  }
  const rangesByTrack = new Map<string, SourceRecordRange>();
  const kinds = new Map<string, SourceRecordKind>();
  for (const replacement of replacements) {
    const track = validated.trackById.get(replacement.targetTrackId);
    if (!track) return rejected(clips, 'track-not-found');
    if (track.locked) return rejected(clips, 'locked-track');
    if (options.requireRecordTarget !== false && !track.recordTarget) return rejected(clips, 'empty-record-targets');
    if (!isValidReplacement(replacement)) return rejected(clips, 'invalid-source');
    const previousKind = kinds.get(track.id);
    if (previousKind && previousKind !== track.kind) return rejected(clips, 'track-kind-mismatch');
    if (rangesByTrack.has(track.id)) return rejected(clips, 'track-kind-mismatch');
    kinds.set(track.id, track.kind);
    rangesByTrack.set(track.id, { inMs: recordInMs, outMs: recordInMs + replacement.durationMs });
  }
  expandLinkedRanges(clips, rangesByTrack, options.includeLinked !== false);
  for (const trackId of rangesByTrack.keys()) {
    const track = validated.trackById.get(trackId);
    if (!track) return rejected(clips, 'track-not-found');
    if (track.locked) return rejected(clips, 'locked-track');
  }
  const removed = removeRanges(
    clips,
    validated.trackById,
    rangesByTrack,
    [...rangesByTrack.keys()],
    {},
  );
  if (!removed.applied) return removed;

  const usedIds = new Set(removed.clips.map((clip) => clip.id));
  const inserted: TClip[] = [];
  for (const [index, replacement] of replacements.entries()) {
    const track = validated.trackById.get(replacement.targetTrackId)!;
    const id = uniqueGeneratedId(
      replacement.createId ?? options.createId?.(replacement, index),
      `replace-${replacement.sourceId}-${track.id}`,
      usedIds,
    );
    inserted.push({
      id,
      kind: track.kind,
      trackId: track.id,
      startMs: recordInMs,
      durationMs: replacement.durationMs,
      sourceId: replacement.sourceId,
      sourceInMs: replacement.sourceInMs,
      sourceDurationMs: replacement.sourceDurationMs,
      playbackRate: replacement.playbackRate ?? 1,
      reverse: replacement.reverse ?? false,
      enabled: replacement.enabled ?? true,
      linkGroupId: replacement.linkGroupId,
    } as TClip);
  }
  const affected = uniqueStrings([...removed.affectedClipIds, ...inserted.map((clip) => clip.id)]);
  if (affected.length > MAX_SOURCE_RECORD_AFFECTED_CLIPS) return rejected(clips, 'affected-clips-too-large');
  return {
    applied: true,
    clips: [...removed.clips, ...inserted],
    affectedClipIds: affected,
    createdClipIds: [...removed.createdClipIds, ...inserted.map((clip) => clip.id)],
    removedClipIds: removed.removedClipIds,
    recordTrackIds: [...rangesByTrack.keys()],
  };
}

export function matchSourceRecordFrame<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  clipId: string,
  recordTimeMs: number,
): SourceRecordMatchResult {
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip) return { matched: false, reason: 'clip-not-found' };
  if (!isValidClip(clip)) return { matched: false, reason: 'invalid-clip' };
  if (!Number.isFinite(recordTimeMs) || recordTimeMs < clip.startMs || recordTimeMs > clip.startMs + clip.durationMs) {
    return { matched: false, reason: 'record-time-outside-clip' };
  }
  const sourceTimeMs = sourceTimeAt(clip, recordTimeMs);
  const terminalSourceTime = sourceTimeAt(clip, clip.startMs + clip.durationMs);
  return {
    matched: true,
    match: {
      clipId: clip.id,
      sourceId: clip.sourceId,
      recordTimeMs,
      sourceTimeMs,
      sourceInMs: Math.min(clip.sourceInMs, terminalSourceTime),
      sourceOutMs: Math.max(clip.sourceInMs, terminalSourceTime),
      reverse: clip.reverse,
    },
  };
}

export function findSourceRecordEdit(
  clips: readonly SourceRecordClip[],
  tracks: readonly SourceRecordTrack[],
  fromMs: number,
  direction: 'previous' | 'next',
  targetTrackIds?: readonly string[],
): SourceRecordNavigationResult {
  const validated = validateTimeline(clips, tracks);
  if ('reason' in validated) return { found: false, clipIds: [], reason: validated.reason };
  if (!Number.isFinite(fromMs)) return { found: false, clipIds: [], reason: 'invalid-range' };
  const targets = targetTrackIds?.length
    ? uniqueStrings(targetTrackIds)
    : tracks.filter((track) => track.recordTarget).map((track) => track.id);
  if (targets.length === 0) return { found: false, clipIds: [], reason: 'empty-record-targets' };
  if (targets.some((id) => !validated.trackById.has(id))) {
    return { found: false, clipIds: [], reason: 'track-not-found' };
  }
  const targetSet = new Set(targets);
  const boundaryMap = new Map<number, Set<string>>();
  for (const clip of clips) {
    if (!targetSet.has(clip.trackId)) continue;
    for (const boundary of [clip.startMs, clip.startMs + clip.durationMs]) {
      const ids = boundaryMap.get(boundary) ?? new Set<string>();
      ids.add(clip.id);
      boundaryMap.set(boundary, ids);
    }
  }
  const candidates = [...boundaryMap.keys()].filter((time) => direction === 'next' ? time > fromMs : time < fromMs);
  if (candidates.length === 0) return { found: false, clipIds: [] };
  const timeMs = direction === 'next' ? Math.min(...candidates) : Math.max(...candidates);
  return { found: true, timeMs, clipIds: [...(boundaryMap.get(timeMs) ?? [])] };
}

type PreparedTimeline = { trackById: Map<string, SourceRecordTrack> } | { reason: SourceRecordEditReason };

function validateTimeline<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  tracks: readonly SourceRecordTrack[],
): PreparedTimeline {
  if (tracks.length > MAX_SOURCE_RECORD_TRACKS) return { reason: 'too-many-tracks' };
  if (clips.length > MAX_SOURCE_RECORD_CLIPS) return { reason: 'timeline-too-large' };
  const trackById = new Map<string, SourceRecordTrack>();
  for (const track of tracks) {
    if (!isValidTrack(track) || trackById.has(track.id)) return { reason: 'track-not-found' };
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

type PreparedRange = {
  trackById: Map<string, SourceRecordTrack>;
  rangesByTrack: Map<string, SourceRecordRange>;
  recordTrackIds: string[];
} | { reason: SourceRecordEditReason };

function prepareRangeEdit<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  tracks: readonly SourceRecordTrack[],
  range: SourceRecordRange,
  options: SourceRecordEditOptions,
): PreparedRange {
  const validated = validateTimeline(clips, tracks);
  if ('reason' in validated) return validated;
  if (!isValidRange(range)) return { reason: 'invalid-range' };
  const targetIds = options.targetTrackIds?.length
    ? uniqueStrings(options.targetTrackIds)
    : tracks.filter((track) => track.recordTarget).map((track) => track.id);
  if (targetIds.length === 0) return { reason: 'empty-record-targets' };
  const rangesByTrack = new Map<string, SourceRecordRange>();
  for (const trackId of targetIds) {
    const track = validated.trackById.get(trackId);
    if (!track) return { reason: 'track-not-found' };
    if (track.locked) return { reason: 'locked-track' };
    rangesByTrack.set(trackId, { ...range });
  }
  expandLinkedRanges(clips, rangesByTrack, options.includeLinked !== false);
  for (const trackId of rangesByTrack.keys()) {
    const track = validated.trackById.get(trackId);
    if (!track) return { reason: 'track-not-found' };
    if (track.locked) return { reason: 'locked-track' };
  }
  return { trackById: validated.trackById, rangesByTrack, recordTrackIds: [...rangesByTrack.keys()] };
}

function expandLinkedRanges<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  rangesByTrack: Map<string, SourceRecordRange>,
  includeLinked: boolean,
): void {
  if (!includeLinked) return;
  const linkedRanges = new Map<string, SourceRecordRange>();
  for (const clip of clips) {
    const range = rangesByTrack.get(clip.trackId);
    if (range && clip.linkGroupId && overlaps(clip, range)) linkedRanges.set(clip.linkGroupId, range);
  }
  for (const clip of clips) {
    if (!clip.linkGroupId) continue;
    const range = linkedRanges.get(clip.linkGroupId);
    if (range) rangesByTrack.set(clip.trackId, { ...range });
  }
}

function removeRanges<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  trackById: ReadonlyMap<string, SourceRecordTrack>,
  rangesByTrack: ReadonlyMap<string, SourceRecordRange>,
  recordTrackIds: string[],
  options: Pick<SourceRecordEditOptions, 'createId' | 'createLinkGroupId'>,
): SourceRecordProposal<TClip> {
  for (const trackId of rangesByTrack.keys()) {
    if (trackById.get(trackId)?.locked) return rejected(clips, 'locked-track');
  }
  const usedIds = new Set(clips.map((clip) => clip.id));
  const usedLinkIds = new Set(clips.flatMap((clip) => clip.linkGroupId ? [clip.linkGroupId] : []));
  const rightLinkGroups = new Map<string, string>();
  const result: TClip[] = [];
  const affected: string[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  let fragmentIndex = 0;
  for (const clip of clips) {
    const range = rangesByTrack.get(clip.trackId);
    if (!range || !overlaps(clip, range)) {
      result.push({ ...clip });
      continue;
    }
    affected.push(clip.id);
    const clipEnd = clip.startMs + clip.durationMs;
    const leftDuration = Math.max(0, range.inMs - clip.startMs);
    const rightDuration = Math.max(0, clipEnd - range.outMs);
    if (leftDuration <= 0 && rightDuration <= 0) {
      removed.push(clip.id);
      continue;
    }
    if (leftDuration > 0) result.push({ ...clip, durationMs: leftDuration });
    if (rightDuration > 0) {
      const startsAt = Math.max(range.outMs, clip.startMs);
      if (leftDuration <= 0) {
        result.push({
          ...clip,
          startMs: startsAt,
          durationMs: rightDuration,
          sourceInMs: sourceTimeAt(clip, startsAt),
        });
      } else {
        const id = uniqueGeneratedId(options.createId?.(clip, fragmentIndex), `${clip.id}-right`, usedIds);
        fragmentIndex += 1;
        let linkGroupId = clip.linkGroupId;
        if (linkGroupId) {
          const existing = rightLinkGroups.get(linkGroupId);
          if (existing) linkGroupId = existing;
          else {
            const replacement = uniqueGeneratedId(
              options.createLinkGroupId?.(linkGroupId, rightLinkGroups.size),
              `${linkGroupId}-right`,
              usedLinkIds,
            );
            rightLinkGroups.set(linkGroupId, replacement);
            linkGroupId = replacement;
          }
        }
        const right = {
          ...clip,
          id,
          linkGroupId,
          startMs: startsAt,
          durationMs: rightDuration,
          sourceInMs: sourceTimeAt(clip, startsAt),
        };
        result.push(right);
        created.push(id);
      }
    }
  }
  if (affected.length + created.length > MAX_SOURCE_RECORD_AFFECTED_CLIPS) {
    return rejected(clips, 'affected-clips-too-large');
  }
  return {
    applied: true,
    clips: result,
    affectedClipIds: uniqueStrings([...affected, ...created]),
    createdClipIds: created,
    removedClipIds: removed,
    recordTrackIds,
  };
}

function rejected<TClip extends SourceRecordClip>(
  clips: readonly TClip[],
  reason: SourceRecordEditReason,
): SourceRecordProposal<TClip> {
  return {
    applied: false,
    clips: clips.map((clip) => ({ ...clip })),
    affectedClipIds: [],
    createdClipIds: [],
    removedClipIds: [],
    recordTrackIds: [],
    reason,
  };
}

function isValidTrack(track: SourceRecordTrack): boolean {
  return typeof track.id === 'string' && track.id.length > 0
    && (track.kind === 'video' || track.kind === 'audio')
    && Number.isInteger(track.order) && track.order >= 0;
}

function isValidClip(clip: SourceRecordClip): boolean {
  if (!(typeof clip.id === 'string' && clip.id.length > 0
    && typeof clip.sourceId === 'string' && clip.sourceId.length > 0
    && Number.isFinite(clip.startMs) && clip.startMs >= 0
    && Number.isFinite(clip.durationMs) && clip.durationMs > 0
    && Number.isFinite(clip.sourceInMs) && clip.sourceInMs >= 0
    && Number.isFinite(clip.playbackRate) && clip.playbackRate > 0
    && (clip.sourceDurationMs === undefined || (Number.isFinite(clip.sourceDurationMs) && clip.sourceDurationMs > 0)))) {
    return false;
  }
  if (clip.sourceDurationMs === undefined) return true;
  const sourceEndMs = clip.sourceInMs + clip.durationMs * clip.playbackRate * (clip.reverse ? -1 : 1);
  return clip.sourceInMs <= clip.sourceDurationMs && sourceEndMs >= 0 && sourceEndMs <= clip.sourceDurationMs;
}

function isValidRange(range: SourceRecordRange): boolean {
  return Number.isFinite(range.inMs) && range.inMs >= 0
    && Number.isFinite(range.outMs) && range.outMs > range.inMs;
}

function isValidReplacement(replacement: SourceRecordReplacement): boolean {
  if (!(typeof replacement.sourceId === 'string' && replacement.sourceId.length > 0
    && Number.isFinite(replacement.sourceInMs) && replacement.sourceInMs >= 0
    && Number.isFinite(replacement.durationMs) && replacement.durationMs > 0
    && (replacement.playbackRate === undefined || (Number.isFinite(replacement.playbackRate) && replacement.playbackRate > 0))
    && (replacement.sourceDurationMs === undefined || (Number.isFinite(replacement.sourceDurationMs) && replacement.sourceDurationMs > 0)))) {
    return false;
  }
  if (replacement.sourceDurationMs === undefined) return true;
  const playbackRate = replacement.playbackRate ?? 1;
  const sourceEndMs = replacement.sourceInMs
    + replacement.durationMs * playbackRate * (replacement.reverse ? -1 : 1);
  return replacement.sourceInMs <= replacement.sourceDurationMs
    && sourceEndMs >= 0
    && sourceEndMs <= replacement.sourceDurationMs;
}

function overlaps(clip: SourceRecordClip, range: SourceRecordRange): boolean {
  return clip.startMs < range.outMs && clip.startMs + clip.durationMs > range.inMs;
}

function sourceTimeAt(clip: SourceRecordClip, recordTimeMs: number): number {
  const localMs = Math.max(0, Math.min(clip.durationMs, recordTimeMs - clip.startMs));
  return clip.sourceInMs + localMs * clip.playbackRate * (clip.reverse ? -1 : 1);
}

function compareTracks(left: SourceRecordTrack, right: SourceRecordTrack): number {
  return left.kind.localeCompare(right.kind) || left.order - right.order || left.id.localeCompare(right.id);
}

function uniqueGeneratedId(candidate: string | undefined, fallbackBase: string, used: Set<string>): string {
  const preferred = candidate?.trim();
  if (preferred && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let serial = 1;
  while (used.has(`${fallbackBase}-${serial}`)) serial += 1;
  const id = `${fallbackBase}-${serial}`;
  used.add(id);
  return id;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
