import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_RECORD_TRACKS,
  findSourceRecordEdit,
  matchSourceRecordFrame,
  proposeSourceRecordExtract,
  proposeSourceRecordLift,
  proposeSourceRecordReplace,
  resolveSourceRecordTargets,
  type SourceRecordClip,
  type SourceRecordTrack,
} from './videoSourceRecordEditing';

const tracks: SourceRecordTrack[] = [
  { id: 'v1', kind: 'video', order: 0, locked: false, syncLocked: true, recordTarget: true, sourceChannel: 0 },
  { id: 'v2', kind: 'video', order: 1, locked: false, syncLocked: false, recordTarget: false },
  { id: 'a1', kind: 'audio', order: 0, locked: false, syncLocked: true, recordTarget: true, sourceChannel: 1 },
];

function clip(overrides: Partial<SourceRecordClip> & Pick<SourceRecordClip, 'id' | 'trackId'>): SourceRecordClip {
  const { id, trackId, ...rest } = overrides;
  return {
    id,
    kind: trackId.startsWith('a') ? 'audio' : 'video',
    trackId,
    startMs: 0,
    durationMs: 10_000,
    sourceId: 'source-1',
    sourceInMs: 1_000,
    sourceDurationMs: 30_000,
    playbackRate: 1,
    reverse: false,
    enabled: true,
    ...rest,
  };
}

describe('video source/record editing', () => {
  it('resolves bounded record targets in media/order order', () => {
    const result = resolveSourceRecordTargets([tracks[2], tracks[1], tracks[0]]);
    expect(result.applied).toBe(true);
    expect(result.tracks.map((track) => track.id)).toEqual(['a1', 'v1']);

    const overLimit = Array.from({ length: MAX_SOURCE_RECORD_TRACKS + 1 }, (_, index) => ({
      ...tracks[0],
      id: `v-${index}`,
      order: index,
    }));
    expect(resolveSourceRecordTargets(overLimit)).toMatchObject({ applied: false, reason: 'too-many-tracks' });
  });

  it('lifts a range and splits linked visual/audio clips with aligned fresh groups', () => {
    const source = [
      clip({ id: 'video', trackId: 'v1', linkGroupId: 'pair' }),
      clip({ id: 'audio', trackId: 'a1', linkGroupId: 'pair', startMs: 80, sourceInMs: 1_080 }),
      clip({ id: 'untouched', trackId: 'v2', startMs: 20_000 }),
    ];
    const result = proposeSourceRecordLift(source, tracks, { inMs: 3_000, outMs: 5_000 }, {
      targetTrackIds: ['v1'],
    });
    expect(result.applied).toBe(true);
    expect(result.clips.map((entry) => [entry.id, entry.trackId, entry.startMs, entry.durationMs, entry.sourceInMs])).toEqual([
      ['video', 'v1', 0, 3_000, 1_000],
      ['video-right-1', 'v1', 5_000, 5_000, 6_000],
      ['audio', 'a1', 80, 2_920, 1_080],
      ['audio-right-1', 'a1', 5_000, 5_080, 6_000],
      ['untouched', 'v2', 20_000, 10_000, 1_000],
    ]);
    const right = result.clips.filter((entry) => entry.id.endsWith('right-1'));
    expect(right[0].linkGroupId).toBe(right[1].linkGroupId);
    expect(right[0].linkGroupId).not.toBe('pair');
    expect(source).toHaveLength(3);
  });

  it('extracts the range and ripples record/sync-locked tracks while preserving unrelated lanes', () => {
    const source = [
      clip({ id: 'v-before', trackId: 'v1', durationMs: 2_000 }),
      clip({ id: 'v-after', trackId: 'v1', startMs: 5_000, durationMs: 1_000 }),
      clip({ id: 'a-after', trackId: 'a1', startMs: 5_080, durationMs: 1_000 }),
      clip({ id: 'v2-after', trackId: 'v2', startMs: 5_000, durationMs: 1_000 }),
    ];
    const result = proposeSourceRecordExtract(source, tracks, { inMs: 2_000, outMs: 4_000 }, {
      targetTrackIds: ['v1'],
    });
    expect(result.applied).toBe(true);
    expect(result.clips.map((entry) => [entry.id, entry.startMs])).toEqual([
      ['v-before', 0],
      ['v-after', 3_000],
      ['a-after', 3_080],
      ['v2-after', 5_000],
    ]);
  });

  it('rejects linked and sync-lock edits atomically when any affected track is locked', () => {
    const lockedAudio = tracks.map((track) => track.id === 'a1' ? { ...track, locked: true } : track);
    const linked = [
      clip({ id: 'v', trackId: 'v1', linkGroupId: 'pair' }),
      clip({ id: 'a', trackId: 'a1', linkGroupId: 'pair' }),
    ];
    expect(proposeSourceRecordLift(linked, lockedAudio, { inMs: 1_000, outMs: 2_000 }, {
      targetTrackIds: ['v1'],
    })).toMatchObject({ applied: false, reason: 'locked-track', clips: linked });
    expect(proposeSourceRecordExtract([clip({ id: 'later', trackId: 'v1', startMs: 4_000 })], lockedAudio, {
      inMs: 1_000,
      outMs: 2_000,
    }, { targetTrackIds: ['v1'] })).toMatchObject({ applied: false, reason: 'locked-track' });
  });

  it('replaces across armed visual/audio targets without disturbing material outside the record ranges', () => {
    const source = [
      clip({ id: 'old-v', trackId: 'v1', durationMs: 8_000 }),
      clip({ id: 'old-a', trackId: 'a1', durationMs: 8_000 }),
      clip({ id: 'overlay', trackId: 'v2', durationMs: 8_000 }),
    ];
    const result = proposeSourceRecordReplace(source, tracks, 2_000, [
      { targetTrackId: 'v1', sourceId: 'take-2-video', sourceInMs: 500, durationMs: 2_000, linkGroupId: 'new-pair' },
      { targetTrackId: 'a1', sourceId: 'take-2-audio', sourceInMs: 700, durationMs: 2_000, linkGroupId: 'new-pair' },
    ]);
    expect(result.applied).toBe(true);
    expect(result.clips.filter((entry) => entry.sourceId.startsWith('take-2')).map((entry) => [entry.kind, entry.startMs])).toEqual([
      ['video', 2_000],
      ['audio', 2_000],
    ]);
    expect(result.clips.find((entry) => entry.id === 'overlay')).toMatchObject({ startMs: 0, durationMs: 8_000 });
    expect(result.createdClipIds).toEqual(expect.arrayContaining([
      'old-v-right-1',
      'old-a-right-1',
      'replace-take-2-video-v1-1',
      'replace-take-2-audio-a1-1',
    ]));
  });

  it('matches forward and reverse source frames at a record time', () => {
    const forward = clip({ id: 'forward', trackId: 'v1', startMs: 1_000, sourceInMs: 5_000, playbackRate: 2 });
    const reverse = clip({ id: 'reverse', trackId: 'v1', startMs: 1_000, sourceInMs: 20_000, playbackRate: 0.5, reverse: true });
    expect(matchSourceRecordFrame([forward], 'forward', 2_500).match?.sourceTimeMs).toBe(8_000);
    expect(matchSourceRecordFrame([reverse], 'reverse', 3_000).match?.sourceTimeMs).toBe(19_000);
    expect(matchSourceRecordFrame([forward], 'forward', 99_000)).toMatchObject({
      matched: false,
      reason: 'record-time-outside-clip',
    });
  });

  it('navigates previous/next edit boundaries on record targets only', () => {
    const source = [
      clip({ id: 'first', trackId: 'v1', startMs: 1_000, durationMs: 2_000 }),
      clip({ id: 'second', trackId: 'a1', startMs: 4_000, durationMs: 2_000 }),
      clip({ id: 'ignored', trackId: 'v2', startMs: 3_500, durationMs: 100 }),
    ];
    expect(findSourceRecordEdit(source, tracks, 3_200, 'next')).toEqual({
      found: true,
      timeMs: 4_000,
      clipIds: ['second'],
    });
    expect(findSourceRecordEdit(source, tracks, 3_200, 'previous')).toEqual({
      found: true,
      timeMs: 3_000,
      clipIds: ['first'],
    });
  });
});
