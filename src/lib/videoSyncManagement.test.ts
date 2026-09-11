import { describe, expect, it } from 'vitest';
import {
  applyVideoSyncRepairs,
  createVideoSyncManagementState,
  diagnoseVideoSync,
  groupVideoClipsForSync,
  linkVideoClips,
  proposeVideoSyncRepair,
  ungroupVideoSyncGroups,
  unlinkVideoClips,
  type VideoSyncManagedClip,
} from './videoSyncManagement';

const clips: VideoSyncManagedClip[] = [
  { id: 'video', trackId: 'v1', startMs: 1_000, sourceInMs: 200 },
  { id: 'audio', trackId: 'a1', startMs: 1_000, sourceInMs: 200 },
];

describe('Video sync management', () => {
  it('links and unlinks atomically while respecting track locks', () => {
    const linked = linkVideoClips(clips, ['video', 'audio'], 'link-1', { lockedTrackIds: new Set() });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.clips.map((clip) => clip.linkGroupId)).toEqual(['link-1', 'link-1']);
    const unlinked = unlinkVideoClips(linked.clips, ['video', 'audio'], { lockedTrackIds: new Set(['a1']) });
    expect(unlinked).toMatchObject({ ok: false, errors: [{ code: 'track-locked', trackIds: ['a1'] }] });
    expect(unlinked.clips.map((clip) => clip.linkGroupId)).toEqual(['link-1', 'link-1']);
  });

  it('creates revision-keyed diagnostics and move/slip repair proposals', () => {
    const grouped = groupVideoClipsForSync({
      clips, clipIds: ['video', 'audio'], groupId: 'sync-1', revisionKey: 'rev-1',
      state: createVideoSyncManagementState(), locks: { lockedTrackIds: new Set() }, anchorClipId: 'video',
    });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const drifted = grouped.clips.map((clip) => clip.id === 'audio' ? { ...clip, startMs: 1_050 } : clip);
    const report = diagnoseVideoSync(drifted, grouped.state, 'rev-2');
    expect(report).toMatchObject({ revisionKey: 'rev-2', outOfSyncCount: 1 });
    expect(report.diagnostics.find((item) => item.clipId === 'audio')).toMatchObject({ status: 'out-of-sync', driftMs: 50 });

    const move = proposeVideoSyncRepair(report, drifted, 'audio', 'move-to-sync');
    const slip = proposeVideoSyncRepair(report, drifted, 'audio', 'slip-to-sync');
    expect(move).toMatchObject({ fromStartMs: 1_050, toStartMs: 1_000, deltaMs: -50 });
    expect(slip).toMatchObject({ fromSourceInMs: 200, toSourceInMs: 250, deltaMs: 50 });
    if (!move) return;
    const repaired = applyVideoSyncRepairs({ clips: drifted, proposals: [move], currentRevisionKey: 'rev-2', locks: { lockedTrackIds: new Set() } });
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(diagnoseVideoSync(repaired.clips, grouped.state, 'rev-3').outOfSyncCount).toBe(0);
  });

  it('rejects stale or locked repairs and locked ungrouping without partial mutation', () => {
    const grouped = groupVideoClipsForSync({
      clips, clipIds: ['video', 'audio'], groupId: 'sync-1', revisionKey: 'rev-1',
      state: createVideoSyncManagementState(), locks: { lockedTrackIds: new Set() },
    });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const drifted = grouped.clips.map((clip) => clip.id === 'audio' ? { ...clip, startMs: 1_025 } : clip);
    const proposal = proposeVideoSyncRepair(diagnoseVideoSync(drifted, grouped.state, 'rev-2'), drifted, 'audio', 'move-to-sync');
    expect(proposal).toBeDefined();
    if (!proposal) return;
    expect(applyVideoSyncRepairs({ clips: drifted, proposals: [proposal], currentRevisionKey: 'rev-3', locks: { lockedTrackIds: new Set() } })).toMatchObject({ ok: false });
    expect(applyVideoSyncRepairs({ clips: drifted, proposals: [proposal], currentRevisionKey: 'rev-2', locks: { lockedTrackIds: new Set(['a1']) } })).toMatchObject({ ok: false, errors: [{ code: 'track-locked' }] });
    expect(ungroupVideoSyncGroups({ clips: grouped.clips, groupIds: ['sync-1'], state: grouped.state, locks: { lockedTrackIds: new Set(['a1']) } })).toMatchObject({ ok: false });
  });
});
