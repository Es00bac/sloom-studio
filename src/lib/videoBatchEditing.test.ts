import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_BATCH_SELECTION,
  createVideoBatchSelection,
  proposeVideoBatchDelete,
  proposeVideoBatchDuplicate,
  proposeVideoBatchEnabled,
  proposeVideoBatchMove,
  proposeVideoBatchTrackShift,
  type VideoBatchClip,
  type VideoBatchTrack,
} from './videoBatchEditing';

const tracks: VideoBatchTrack[] = [
  { kind: 'video', trackIndex: 0, locked: false },
  { kind: 'video', trackIndex: 1, locked: false },
  { kind: 'audio', trackIndex: 0, locked: false },
  { kind: 'audio', trackIndex: 1, locked: false },
];

function clip(overrides: Partial<VideoBatchClip> & Pick<VideoBatchClip, 'id'>): VideoBatchClip {
  const { id, ...rest } = overrides;
  return {
    id,
    kind: 'video',
    trackIndex: 0,
    startMs: 1_000,
    durationMs: 500,
    enabled: true,
    ...rest,
  };
}

describe('video batch editing', () => {
  it('normalizes a selection, expands linked A/V, and reports missing IDs', () => {
    const clips = [
      clip({ id: 'v', linkGroupId: 'av' }),
      clip({ id: 'a', kind: 'audio', linkGroupId: 'av', startMs: 1_080 }),
      clip({ id: 'other' }),
    ];
    const result = createVideoBatchSelection(clips, ['v', 'missing'], { anchorClipId: 'v' });
    expect(result).toEqual({
      applied: true,
      selection: { clipIds: ['v', 'a'], anchorClipId: 'v' },
      missingClipIds: ['missing'],
    });
  });

  it('rejects rather than partially selecting more than 2,000 clips', () => {
    const clips = Array.from({ length: MAX_VIDEO_BATCH_SELECTION + 1 }, (_, index) => clip({ id: `c-${index}` }));
    expect(createVideoBatchSelection(clips, clips.map((entry) => entry.id))).toMatchObject({
      applied: false,
      reason: 'selection-too-large',
      selection: { clipIds: [] },
    });
  });

  it('moves linked clips atomically in time while preserving their relative offset', () => {
    const clips = [
      clip({ id: 'v', linkGroupId: 'av' }),
      clip({ id: 'a', kind: 'audio', linkGroupId: 'av', startMs: 1_080 }),
      clip({ id: 'other', startMs: 5_000 }),
    ];
    const result = proposeVideoBatchMove(clips, tracks, ['v'], { deltaMs: 250 });
    expect(result.applied).toBe(true);
    expect(result.clips.map((entry) => [entry.id, entry.startMs])).toEqual([
      ['v', 1_250],
      ['a', 1_330],
      ['other', 5_000],
    ]);
    expect(clips[0].startMs).toBe(1_000);
  });

  it('shifts each linked member within its own media-kind track family', () => {
    const clips = [
      clip({ id: 'v', linkGroupId: 'av' }),
      clip({ id: 'a', kind: 'audio', linkGroupId: 'av' }),
    ];
    const result = proposeVideoBatchTrackShift(clips, tracks, ['v'], 1);
    expect(result.clips.map((entry) => [entry.kind, entry.trackIndex])).toEqual([
      ['video', 1],
      ['audio', 1],
    ]);
  });

  it('rejects a whole edit when a source or destination track is locked', () => {
    const clips = [
      clip({ id: 'v', linkGroupId: 'av' }),
      clip({ id: 'a', kind: 'audio', linkGroupId: 'av' }),
    ];
    const locked = tracks.map((track) => track.kind === 'audio' && track.trackIndex === 0
      ? { ...track, locked: true }
      : track);
    expect(proposeVideoBatchDelete(clips, locked, ['v'])).toMatchObject({
      applied: false,
      reason: 'locked-track',
    });
    expect(proposeVideoBatchDuplicate([clips[1]], locked, ['a'], { trackShift: 1 })).toMatchObject({
      applied: false,
      reason: 'locked-track',
    });
    const destinationLocked = tracks.map((track) => track.kind === 'video' && track.trackIndex === 1
      ? { ...track, locked: true }
      : track);
    expect(proposeVideoBatchTrackShift([clips[0]], destinationLocked, ['v'], 1)).toMatchObject({
      applied: false,
      reason: 'locked-track',
    });
  });

  it('deletes and enables selected clips without changing input objects', () => {
    const clips = [clip({ id: 'one' }), clip({ id: 'two', enabled: false })];
    const enabled = proposeVideoBatchEnabled(clips, tracks, ['two'], true);
    expect(enabled.clips.find((entry) => entry.id === 'two')?.enabled).toBe(true);
    expect(clips[1].enabled).toBe(false);
    expect(proposeVideoBatchDelete(clips, tracks, ['one']).clips.map((entry) => entry.id)).toEqual(['two']);
  });

  it('duplicates linked clips with fresh clip and link-group identities', () => {
    const clips = [
      clip({ id: 'v', linkGroupId: 'av' }),
      clip({ id: 'a', kind: 'audio', linkGroupId: 'av', startMs: 1_080 }),
    ];
    const result = proposeVideoBatchDuplicate(clips, tracks, ['v'], { deltaMs: 2_000 });
    expect(result.applied).toBe(true);
    expect(result.createdClipIds).toEqual(['v-copy-1', 'a-copy-1']);
    const duplicates = result.clips.slice(2);
    expect(duplicates.map((entry) => entry.startMs)).toEqual([3_000, 3_080]);
    expect(duplicates[0].linkGroupId).toBe(duplicates[1].linkGroupId);
    expect(duplicates[0].linkGroupId).not.toBe('av');
    expect(result.selectedClipIds).toEqual(result.createdClipIds);
  });

  it('rejects negative-time and missing-track proposals atomically', () => {
    const clips = [clip({ id: 'v', startMs: 100 })];
    expect(proposeVideoBatchMove(clips, tracks, ['v'], { deltaMs: -101 })).toMatchObject({
      applied: false,
      reason: 'invalid-time',
    });
    expect(proposeVideoBatchTrackShift(clips, tracks, ['v'], 4)).toMatchObject({
      applied: false,
      reason: 'track-not-found',
    });
  });
});
