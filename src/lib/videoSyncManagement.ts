/** Pure, revision-aware link and sync-group decisions for Video timeline clips. */

export const MAX_VIDEO_SYNC_OPERATION_CLIPS = 2_000;
export const MAX_VIDEO_SYNC_GROUPS = 20_000;
export const VIDEO_SYNC_TOLERANCE_MS = 1;

export interface VideoSyncManagedClip {
  id: string;
  trackId: string;
  startMs: number;
  sourceInMs: number;
  linkGroupId?: string;
  syncGroupId?: string;
}

export interface VideoSyncGroupMember {
  clipId: string;
  /** (timeline offset - source offset) against the anchor when the group was created. */
  expectedDeltaMs: number;
}

export interface VideoSyncGroup {
  id: string;
  anchorClipId: string;
  createdRevisionKey: string;
  members: VideoSyncGroupMember[];
}

export interface VideoSyncManagementState {
  groups: VideoSyncGroup[];
}

export interface VideoSyncLockContext {
  lockedTrackIds: ReadonlySet<string>;
}

export type VideoSyncMutationError =
  | { code: 'operation-limit'; message: string; limit: number }
  | { code: 'clip-not-found'; message: string; clipIds: string[] }
  | { code: 'track-locked'; message: string; trackIds: string[] }
  | { code: 'group-not-found'; message: string; groupIds: string[] }
  | { code: 'too-few-clips'; message: string };

export type VideoSyncClipMutationResult =
  | { ok: true; clips: VideoSyncManagedClip[]; affectedClipIds: string[] }
  | { ok: false; clips: VideoSyncManagedClip[]; errors: VideoSyncMutationError[] };

export type VideoSyncGroupMutationResult =
  | { ok: true; clips: VideoSyncManagedClip[]; state: VideoSyncManagementState; affectedClipIds: string[] }
  | { ok: false; clips: VideoSyncManagedClip[]; state: VideoSyncManagementState; errors: VideoSyncMutationError[] };

export interface VideoSyncDiagnostic {
  groupId: string;
  clipId: string;
  anchorClipId: string;
  driftMs: number;
  status: 'in-sync' | 'out-of-sync' | 'missing';
}

export interface VideoSyncDiagnosticReport {
  revisionKey: string;
  diagnostics: VideoSyncDiagnostic[];
  outOfSyncCount: number;
}

export type VideoSyncRepairProposal =
  | {
    kind: 'move-to-sync';
    revisionKey: string;
    groupId: string;
    clipId: string;
    fromStartMs: number;
    toStartMs: number;
    deltaMs: number;
  }
  | {
    kind: 'slip-to-sync';
    revisionKey: string;
    groupId: string;
    clipId: string;
    fromSourceInMs: number;
    toSourceInMs: number;
    deltaMs: number;
  };

export type VideoSyncRepairResult =
  | { ok: true; clips: VideoSyncManagedClip[]; affectedClipIds: string[] }
  | { ok: false; clips: VideoSyncManagedClip[]; errors: VideoSyncMutationError[] };

export function createVideoSyncManagementState(): VideoSyncManagementState {
  return { groups: [] };
}

export function linkVideoClips(
  clips: readonly VideoSyncManagedClip[],
  clipIds: readonly string[],
  linkGroupId: string,
  locks: VideoSyncLockContext,
): VideoSyncClipMutationResult {
  const validation = validateAtomicClipMutation(clips, clipIds, locks, 2);
  if (!validation.ok) return { ok: false, clips: cloneClips(clips), errors: validation.errors };
  const cleanGroupId = requiredText(linkGroupId, 'linkGroupId');
  const wanted = new Set(validation.clipIds);
  return {
    ok: true,
    clips: clips.map((clip) => wanted.has(clip.id) ? { ...clip, linkGroupId: cleanGroupId } : { ...clip }),
    affectedClipIds: validation.clipIds,
  };
}

export function unlinkVideoClips(
  clips: readonly VideoSyncManagedClip[],
  clipIds: readonly string[],
  locks: VideoSyncLockContext,
): VideoSyncClipMutationResult {
  const validation = validateAtomicClipMutation(clips, clipIds, locks, 1);
  if (!validation.ok) return { ok: false, clips: cloneClips(clips), errors: validation.errors };
  const wanted = new Set(validation.clipIds);
  return {
    ok: true,
    clips: clips.map((clip) => {
      if (!wanted.has(clip.id)) return { ...clip };
      const { linkGroupId: _removed, ...rest } = clip;
      return rest;
    }),
    affectedClipIds: validation.clipIds,
  };
}

export function groupVideoClipsForSync(input: {
  clips: readonly VideoSyncManagedClip[];
  clipIds: readonly string[];
  groupId: string;
  revisionKey: string;
  state: VideoSyncManagementState;
  locks: VideoSyncLockContext;
  anchorClipId?: string;
}): VideoSyncGroupMutationResult {
  const validation = validateAtomicClipMutation(input.clips, input.clipIds, input.locks, 2);
  if (!validation.ok) {
    return { ok: false, clips: cloneClips(input.clips), state: cloneState(input.state), errors: validation.errors };
  }
  const groupId = requiredText(input.groupId, 'groupId');
  const revisionKey = requiredText(input.revisionKey, 'revisionKey');
  const selected = validation.clipIds.map((id) => input.clips.find((clip) => clip.id === id))
    .filter((clip): clip is VideoSyncManagedClip => clip !== undefined);
  const anchor = selected.find((clip) => clip.id === input.anchorClipId) ?? selected[0];
  if (!anchor) {
    return {
      ok: false,
      clips: cloneClips(input.clips),
      state: cloneState(input.state),
      errors: [{ code: 'too-few-clips', message: 'A sync group requires at least two clips.' }],
    };
  }
  const group: VideoSyncGroup = {
    id: groupId,
    anchorClipId: anchor.id,
    createdRevisionKey: revisionKey,
    members: selected.map((clip) => ({
      clipId: clip.id,
      expectedDeltaMs: calculateRelativeSyncDelta(clip, anchor),
    })),
  };
  const groups = [
    ...input.state.groups.filter((candidate) => candidate.id !== groupId),
    group,
  ].slice(-MAX_VIDEO_SYNC_GROUPS);
  const wanted = new Set(validation.clipIds);
  return {
    ok: true,
    clips: input.clips.map((clip) => wanted.has(clip.id) ? { ...clip, syncGroupId: groupId } : { ...clip }),
    state: { groups },
    affectedClipIds: validation.clipIds,
  };
}

export function ungroupVideoSyncGroups(input: {
  clips: readonly VideoSyncManagedClip[];
  groupIds: readonly string[];
  state: VideoSyncManagementState;
  locks: VideoSyncLockContext;
}): VideoSyncGroupMutationResult {
  const groupIds = dedupeStrings(input.groupIds);
  const groupsById = new Map(input.state.groups.map((group) => [group.id, group]));
  const missingGroupIds = groupIds.filter((id) => !groupsById.has(id));
  if (missingGroupIds.length > 0) {
    return {
      ok: false,
      clips: cloneClips(input.clips),
      state: cloneState(input.state),
      errors: [{ code: 'group-not-found', message: 'Some sync groups no longer exist.', groupIds: missingGroupIds }],
    };
  }
  const clipIds = dedupeStrings(groupIds.flatMap((id) => groupsById.get(id)?.members.map((member) => member.clipId) ?? []));
  const validation = validateAtomicClipMutation(input.clips, clipIds, input.locks, 1);
  if (!validation.ok) {
    return { ok: false, clips: cloneClips(input.clips), state: cloneState(input.state), errors: validation.errors };
  }
  const groupSet = new Set(groupIds);
  return {
    ok: true,
    clips: input.clips.map((clip) => {
      if (!clip.syncGroupId || !groupSet.has(clip.syncGroupId)) return { ...clip };
      const { syncGroupId: _removed, ...rest } = clip;
      return rest;
    }),
    state: { groups: input.state.groups.filter((group) => !groupSet.has(group.id)).map(cloneGroup) },
    affectedClipIds: validation.clipIds,
  };
}

export function diagnoseVideoSync(
  clips: readonly VideoSyncManagedClip[],
  state: VideoSyncManagementState,
  revisionKey: string,
): VideoSyncDiagnosticReport {
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const diagnostics: VideoSyncDiagnostic[] = [];
  for (const group of [...state.groups].sort((left, right) => left.id.localeCompare(right.id))) {
    const anchor = clipsById.get(group.anchorClipId);
    for (const member of group.members) {
      const clip = clipsById.get(member.clipId);
      if (!anchor || !clip) {
        diagnostics.push({
          groupId: group.id,
          clipId: member.clipId,
          anchorClipId: group.anchorClipId,
          driftMs: 0,
          status: 'missing',
        });
        continue;
      }
      const driftMs = Math.round(calculateRelativeSyncDelta(clip, anchor) - member.expectedDeltaMs);
      diagnostics.push({
        groupId: group.id,
        clipId: clip.id,
        anchorClipId: anchor.id,
        driftMs,
        status: Math.abs(driftMs) <= VIDEO_SYNC_TOLERANCE_MS ? 'in-sync' : 'out-of-sync',
      });
    }
  }
  return {
    revisionKey: requiredText(revisionKey, 'revisionKey'),
    diagnostics,
    outOfSyncCount: diagnostics.filter((diagnostic) => diagnostic.status === 'out-of-sync').length,
  };
}

export function proposeVideoSyncRepair(
  report: VideoSyncDiagnosticReport,
  clips: readonly VideoSyncManagedClip[],
  clipId: string,
  kind: VideoSyncRepairProposal['kind'],
): VideoSyncRepairProposal | undefined {
  const diagnostic = report.diagnostics.find((candidate) => candidate.clipId === clipId && candidate.status === 'out-of-sync');
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (!diagnostic || !clip) return undefined;
  if (kind === 'move-to-sync') {
    return {
      kind,
      revisionKey: report.revisionKey,
      groupId: diagnostic.groupId,
      clipId,
      fromStartMs: clip.startMs,
      toStartMs: Math.max(0, clip.startMs - diagnostic.driftMs),
      deltaMs: -diagnostic.driftMs,
    };
  }
  return {
    kind,
    revisionKey: report.revisionKey,
    groupId: diagnostic.groupId,
    clipId,
    fromSourceInMs: clip.sourceInMs,
    toSourceInMs: Math.max(0, clip.sourceInMs + diagnostic.driftMs),
    deltaMs: diagnostic.driftMs,
  };
}

export function applyVideoSyncRepairs(input: {
  clips: readonly VideoSyncManagedClip[];
  proposals: readonly VideoSyncRepairProposal[];
  currentRevisionKey: string;
  locks: VideoSyncLockContext;
}): VideoSyncRepairResult {
  const proposals = dedupeProposals(input.proposals);
  const stale = proposals.filter((proposal) => proposal.revisionKey !== input.currentRevisionKey);
  if (stale.length > 0) {
    return {
      ok: false,
      clips: cloneClips(input.clips),
      errors: [{ code: 'clip-not-found', message: 'Sync proposals are stale for the current sequence revision.', clipIds: stale.map((proposal) => proposal.clipId) }],
    };
  }
  const validation = validateAtomicClipMutation(input.clips, proposals.map((proposal) => proposal.clipId), input.locks, 1);
  if (!validation.ok) return { ok: false, clips: cloneClips(input.clips), errors: validation.errors };
  const proposalByClipId = new Map(proposals.map((proposal) => [proposal.clipId, proposal]));
  return {
    ok: true,
    clips: input.clips.map((clip) => {
      const proposal = proposalByClipId.get(clip.id);
      if (!proposal) return { ...clip };
      return proposal.kind === 'move-to-sync'
        ? { ...clip, startMs: proposal.toStartMs }
        : { ...clip, sourceInMs: proposal.toSourceInMs };
    }),
    affectedClipIds: validation.clipIds,
  };
}

type AtomicValidation =
  | { ok: true; clipIds: string[] }
  | { ok: false; errors: VideoSyncMutationError[] };

function validateAtomicClipMutation(
  clips: readonly VideoSyncManagedClip[],
  clipIds: readonly string[],
  locks: VideoSyncLockContext,
  minimumCount: number,
): AtomicValidation {
  const ids = dedupeStringsInOrder(clipIds);
  if (ids.length > MAX_VIDEO_SYNC_OPERATION_CLIPS) {
    return { ok: false, errors: [{ code: 'operation-limit', message: `A sync operation supports at most ${MAX_VIDEO_SYNC_OPERATION_CLIPS} clips.`, limit: MAX_VIDEO_SYNC_OPERATION_CLIPS }] };
  }
  if (ids.length < minimumCount) {
    return { ok: false, errors: [{ code: 'too-few-clips', message: `Select at least ${minimumCount} clip${minimumCount === 1 ? '' : 's'}.` }] };
  }
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const missing = ids.filter((id) => !clipsById.has(id));
  const lockedTracks = dedupeStrings(ids.flatMap((id) => {
    const trackId = clipsById.get(id)?.trackId;
    return trackId && locks.lockedTrackIds.has(trackId) ? [trackId] : [];
  }));
  const errors: VideoSyncMutationError[] = [];
  if (missing.length > 0) errors.push({ code: 'clip-not-found', message: 'Some selected clips no longer exist.', clipIds: missing });
  if (lockedTracks.length > 0) errors.push({ code: 'track-locked', message: 'The operation would modify a locked track.', trackIds: lockedTracks });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, clipIds: ids };
}

function calculateRelativeSyncDelta(clip: VideoSyncManagedClip, anchor: VideoSyncManagedClip): number {
  return (clip.startMs - anchor.startMs) - (clip.sourceInMs - anchor.sourceInMs);
}

function dedupeProposals(proposals: readonly VideoSyncRepairProposal[]): VideoSyncRepairProposal[] {
  const byClipId = new Map<string, VideoSyncRepairProposal>();
  for (const proposal of proposals.slice(0, MAX_VIDEO_SYNC_OPERATION_CLIPS)) byClipId.set(proposal.clipId, proposal);
  return [...byClipId.values()].sort((left, right) => left.clipId.localeCompare(right.clipId));
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function dedupeStringsInOrder(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cloneClips(clips: readonly VideoSyncManagedClip[]): VideoSyncManagedClip[] {
  return clips.map((clip) => ({ ...clip }));
}

function cloneGroup(group: VideoSyncGroup): VideoSyncGroup {
  return { ...group, members: group.members.map((member) => ({ ...member })) };
}

function cloneState(state: VideoSyncManagementState): VideoSyncManagementState {
  return { groups: state.groups.map(cloneGroup) };
}

function requiredText(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${field} is required.`);
  return clean;
}
