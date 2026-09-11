import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_TRACKS_V2,
  addVideoTrackV2,
  buildVideoSourcePatchPlanV2,
  deleteLinkedTimelineClipsV2,
  deleteVideoTrackV2,
  legacyTrackId,
  linkTimelineClipsV2,
  migrateLegacyTracksToV2,
  moveLinkedTimelineClipsV2,
  projectTracksToLegacy,
  renameVideoTrackV2,
  reorderVideoTrackV2,
  rippleTimelineClipsV2,
  setVideoTrackSourcePatchV2,
  type LinkedTimelineClipV2,
} from './videoTrackModelV2';

describe('video track model V2', () => {
  it('migrates legacy four-track state to stable IDs and projects the first four per kind', () => {
    const model = migrateLegacyTracksToV2({
      videoTrackCount: 6,
      audioTrackCount: 5,
      lockedVideoTrackIndexes: [2],
      syncLockedAudioTrackIndexes: [0, 3],
      armedVideoTrackIndexes: [1],
    });
    expect(model.version).toBe(2);
    expect(model.tracks).toHaveLength(11);
    expect(model.tracks.find((track) => track.id === legacyTrackId('video', 2))?.locked).toBe(true);
    expect(model.tracks.find((track) => track.id === legacyTrackId('video', 1))).toMatchObject({
      targetArmed: true,
      sourcePatch: { sourceChannel: 1, enabled: true },
    });
    const projection = projectTracksToLegacy(model);
    expect(projection.videoTrackIds).toEqual(['legacy-video-1', 'legacy-video-2', 'legacy-video-3', 'legacy-video-4']);
    expect(projection.audioTrackIds).toEqual(['legacy-audio-1', 'legacy-audio-2', 'legacy-audio-3', 'legacy-audio-4']);
    expect(projection.truncatedTrackIds).toEqual(['legacy-video-5', 'legacy-video-6', 'legacy-audio-5']);
  });

  it('adds, renames, reorders, and deletes tracks without mutating prior snapshots', () => {
    const original = migrateLegacyTracksToV2({ videoTrackCount: 2, audioTrackCount: 1 });
    const snapshot = structuredClone(original);
    const added = addVideoTrackV2(original, 'video', { id: 'video-broll', name: 'B-roll' });
    const renamed = renameVideoTrackV2(added, 'video-broll', '  Inserts  ');
    const reordered = reorderVideoTrackV2(renamed, 'video-broll', 0);
    const deleted = deleteVideoTrackV2(reordered, 'legacy-video-1');
    expect(original).toEqual(snapshot);
    expect(reordered.tracks.find((track) => track.id === 'video-broll')).toMatchObject({ name: 'Inserts', order: 0 });
    expect(deleted.tracks.filter((track) => track.kind === 'video').map((track) => track.order).sort()).toEqual([0, 1]);
  });

  it('keeps every reorder a stable permutation with dense per-kind orders', () => {
    let model = migrateLegacyTracksToV2({ videoTrackCount: 12, audioTrackCount: 8 });
    const originalIds = model.tracks.map((track) => track.id).sort();
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const videos = model.tracks.filter((track) => track.kind === 'video');
      const id = videos[(iteration * 7) % videos.length]?.id ?? '';
      model = reorderVideoTrackV2(model, id, (iteration * 11) % videos.length);
      expect(model.tracks.map((track) => track.id).sort()).toEqual(originalIds);
      expect(model.tracks.filter((track) => track.kind === 'video').map((track) => track.order).sort((a, b) => a - b))
        .toEqual(Array.from({ length: 12 }, (_, index) => index));
    }
  });

  it('enforces the 64-track sequence bound', () => {
    const full = migrateLegacyTracksToV2({ videoTrackCount: MAX_VIDEO_TRACKS_V2, audioTrackCount: 10 });
    expect(full.tracks).toHaveLength(MAX_VIDEO_TRACKS_V2);
    expect(() => addVideoTrackV2(full, 'audio')).toThrow('at most 64 tracks');
  });

  it('builds source patch routing only from armed and enabled tracks', () => {
    let model = migrateLegacyTracksToV2({ videoTrackCount: 1, audioTrackCount: 1, armedVideoTrackIndexes: [0] });
    model = setVideoTrackSourcePatchV2(model, 'legacy-audio-1', { sourceChannel: 7, enabled: true });
    model = {
      ...model,
      tracks: model.tracks.map((track) => track.id === 'legacy-audio-1' ? { ...track, targetArmed: true } : track),
    };
    expect(buildVideoSourcePatchPlanV2(model)).toEqual([
      { trackId: 'legacy-audio-1', kind: 'audio', sourceChannel: 7 },
      { trackId: 'legacy-video-1', kind: 'video', sourceChannel: 0 },
    ]);
  });

  it('moves and deletes linked A/V clips atomically while preserving sync offsets', () => {
    const model = migrateLegacyTracksToV2({ videoTrackCount: 2, audioTrackCount: 2 });
    const input: LinkedTimelineClipV2[] = [
      { id: 'v', trackId: 'legacy-video-1', startMs: 1_000, durationMs: 2_000 },
      { id: 'a', trackId: 'legacy-audio-1', startMs: 1_080, durationMs: 2_000 },
      { id: 'other', trackId: 'legacy-video-2', startMs: 5_000, durationMs: 1_000 },
    ];
    const linked = linkTimelineClipsV2(input, ['v', 'a'], 'av-1');
    expect(linked.find((clip) => clip.id === 'a')?.linkSyncOffsetMs).toBe(80);
    const moved = moveLinkedTimelineClipsV2(model, linked, 'v', 500, 'legacy-video-2');
    expect(moved.applied).toBe(true);
    expect(moved.clips.find((clip) => clip.id === 'v')).toMatchObject({ startMs: 1_500, trackId: 'legacy-video-2' });
    expect(moved.clips.find((clip) => clip.id === 'a')).toMatchObject({ startMs: 1_580, trackId: 'legacy-audio-1' });
    expect(linked.find((clip) => clip.id === 'v')?.startMs).toBe(1_000);
    expect(deleteLinkedTimelineClipsV2(model, moved.clips, 'a').clips.map((clip) => clip.id)).toEqual(['other']);
  });

  it('rejects an entire linked edit when any member track is locked', () => {
    const base = migrateLegacyTracksToV2({ videoTrackCount: 1, audioTrackCount: 1, lockedAudioTrackIndexes: [0] });
    const linked = linkTimelineClipsV2([
      { id: 'v', trackId: 'legacy-video-1', startMs: 100, durationMs: 100 },
      { id: 'a', trackId: 'legacy-audio-1', startMs: 100, durationMs: 100 },
    ], ['v', 'a'], 'locked-pair');
    const result = moveLinkedTimelineClipsV2(base, linked, 'v', 20);
    expect(result).toMatchObject({ applied: false, reason: 'track-locked', affectedClipIds: [] });
    expect(result.clips).toEqual(linked);
  });

  it('ripples the target plus sync-locked tracks but protects locked tracks', () => {
    let model = migrateLegacyTracksToV2({ videoTrackCount: 2, audioTrackCount: 1, syncLockedAudioTrackIndexes: [0] });
    const clips: LinkedTimelineClipV2[] = [
      { id: 'v1', trackId: 'legacy-video-1', startMs: 1_000, durationMs: 100 },
      { id: 'v2', trackId: 'legacy-video-2', startMs: 1_000, durationMs: 100 },
      { id: 'a1', trackId: 'legacy-audio-1', startMs: 1_000, durationMs: 100 },
    ];
    const result = rippleTimelineClipsV2(model, clips, 'legacy-video-1', 500, 250);
    expect(result.clips.map((clip) => [clip.id, clip.startMs])).toEqual([['v1', 1_250], ['v2', 1_000], ['a1', 1_250]]);
    model = { ...model, tracks: model.tracks.map((track) => track.id === 'legacy-audio-1' ? { ...track, locked: true } : track) };
    expect(rippleTimelineClipsV2(model, clips, 'legacy-video-1', 500, 250)).toMatchObject({ applied: false, reason: 'track-locked' });
  });
});
