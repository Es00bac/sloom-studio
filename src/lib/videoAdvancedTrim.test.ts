import { describe, expect, it } from 'vitest';
import {
  MAX_ADVANCED_TRIM_TRACKS,
  cancelAdvancedTrimSession,
  commitAdvancedTrimSession,
  createAdvancedTrimSession,
  updateAdvancedTrimSession,
  type AdvancedTrimClip,
  type AdvancedTrimSession,
  type AdvancedTrimTrack,
} from './videoAdvancedTrim';

const tracks: AdvancedTrimTrack[] = [
  { id: 'v1', kind: 'video', locked: false },
  { id: 'a1', kind: 'audio', locked: false },
];

function clip(overrides: Partial<AdvancedTrimClip> & Pick<AdvancedTrimClip, 'id' | 'trackId'>): AdvancedTrimClip {
  const { id, trackId, ...rest } = overrides;
  return {
    id,
    kind: trackId.startsWith('a') ? 'audio' : 'video',
    trackId,
    startMs: 0,
    durationMs: 4_000,
    sourceInMs: 1_000,
    sourceDurationMs: 12_000,
    playbackRate: 1,
    reverse: false,
    ...rest,
  };
}

function active(result: ReturnType<typeof createAdvancedTrimSession>): AdvancedTrimSession {
  if (!result.ok) throw new Error(result.reason);
  return result.session;
}

describe('advanced video trim sessions', () => {
  it('ripple-trims an in point and shifts downstream clips from the original snapshot', () => {
    const clips = [
      clip({ id: 'selected', trackId: 'v1' }),
      clip({ id: 'next', trackId: 'v1', startMs: 4_000, sourceInMs: 0 }),
    ];
    const session = active(createAdvancedTrimSession(clips, tracks, {
      mode: 'ripple',
      edge: 'in',
      primaryClipId: 'selected',
    }));
    const first = updateAdvancedTrimSession(session, 500).session;
    expect(first.previewClips.map((entry) => [entry.id, entry.startMs, entry.durationMs, entry.sourceInMs])).toEqual([
      ['selected', 0, 3_500, 1_500],
      ['next', 3_500, 4_000, 0],
    ]);
    const second = updateAdvancedTrimSession(first, 250).session;
    expect(second.previewClips.map((entry) => [entry.id, entry.startMs, entry.durationMs])).toEqual([
      ['selected', 0, 3_750],
      ['next', 3_750, 4_000],
    ]);
    expect(clips[0].sourceInMs).toBe(1_000);
  });

  it('clamps a ripple out trim to both media handles and minimum duration', () => {
    const clips = [
      clip({ id: 'selected', trackId: 'v1', sourceInMs: 2_000, sourceDurationMs: 7_000 }),
      clip({ id: 'next', trackId: 'v1', startMs: 4_000, sourceInMs: 0 }),
    ];
    const session = active(createAdvancedTrimSession(clips, tracks, {
      mode: 'ripple',
      edge: 'out',
      primaryClipId: 'selected',
      minimumDurationMs: 500,
    }));
    expect(updateAdvancedTrimSession(session, 99_000).session).toMatchObject({
      appliedDeltaMs: 1_000,
      previewClips: [
        { id: 'selected', durationMs: 5_000 },
        { id: 'next', startMs: 5_000 },
      ],
    });
    expect(updateAdvancedTrimSession(session, -99_000).session).toMatchObject({
      appliedDeltaMs: -3_500,
      previewClips: [
        { id: 'selected', durationMs: 500 },
        { id: 'next', startMs: 500 },
      ],
    });
  });

  it('rolls a linked A/V cut and preserves the linked offsets', () => {
    const clips = [
      clip({ id: 'left-v', trackId: 'v1', linkGroupId: 'left' }),
      clip({ id: 'left-a', trackId: 'a1', startMs: 80, linkGroupId: 'left' }),
      clip({ id: 'right-v', trackId: 'v1', startMs: 4_000, sourceInMs: 5_000, linkGroupId: 'right' }),
      clip({ id: 'right-a', trackId: 'a1', startMs: 4_080, sourceInMs: 5_080, linkGroupId: 'right' }),
    ];
    const session = active(createAdvancedTrimSession(clips, tracks, {
      mode: 'roll',
      primaryClipId: 'left-v',
      secondaryClipId: 'right-v',
    }));
    const updated = updateAdvancedTrimSession(session, 500).session;
    expect(updated.previewClips.map((entry) => [entry.id, entry.startMs, entry.durationMs, entry.sourceInMs])).toEqual([
      ['left-v', 0, 4_500, 1_000],
      ['left-a', 80, 4_500, 1_000],
      ['right-v', 4_500, 3_500, 5_500],
      ['right-a', 4_580, 3_500, 5_580],
    ]);
    expect(updated.previewClips[1].startMs - updated.previewClips[0].startMs).toBe(80);
    expect(updated.previewClips[3].startMs - updated.previewClips[2].startMs).toBe(80);
  });

  it('slips linked forward/reverse clips without changing timeline placement', () => {
    const clips = [
      clip({ id: 'v', trackId: 'v1', linkGroupId: 'pair' }),
      clip({
        id: 'a',
        trackId: 'a1',
        startMs: 80,
        sourceInMs: 8_000,
        sourceDurationMs: 12_000,
        reverse: true,
        linkGroupId: 'pair',
      }),
    ];
    const session = active(createAdvancedTrimSession(clips, tracks, {
      mode: 'slip',
      primaryClipId: 'v',
    }));
    const updated = updateAdvancedTrimSession(session, 500).session;
    expect(updated.previewClips).toMatchObject([
      { id: 'v', startMs: 0, durationMs: 4_000, sourceInMs: 1_500 },
      { id: 'a', startMs: 80, durationMs: 4_000, sourceInMs: 7_500 },
    ]);
  });

  it('slides a clip by growing and trimming its adjacent clips', () => {
    const clips = [
      clip({ id: 'left', trackId: 'v1', durationMs: 4_000 }),
      clip({ id: 'selected', trackId: 'v1', startMs: 4_000, sourceInMs: 2_000 }),
      clip({ id: 'right', trackId: 'v1', startMs: 8_000, sourceInMs: 3_000 }),
    ];
    const session = active(createAdvancedTrimSession(clips, tracks, {
      mode: 'slide',
      primaryClipId: 'selected',
      leftNeighborClipId: 'left',
      rightNeighborClipId: 'right',
    }));
    const updated = updateAdvancedTrimSession(session, 750).session;
    expect(updated.previewClips.map((entry) => [entry.id, entry.startMs, entry.durationMs, entry.sourceInMs])).toEqual([
      ['left', 0, 4_750, 1_000],
      ['selected', 4_750, 4_000, 2_000],
      ['right', 8_750, 3_250, 3_750],
    ]);
  });

  it('commits the preview or cancels back to a cloned original exactly once', () => {
    const clips = [clip({ id: 'selected', trackId: 'v1' })];
    const updated = updateAdvancedTrimSession(active(createAdvancedTrimSession(clips, tracks, {
      mode: 'slip',
      primaryClipId: 'selected',
    })), 500).session;
    const committed = commitAdvancedTrimSession(updated);
    expect(committed).toMatchObject({ applied: true, session: { status: 'committed', appliedDeltaMs: 500 } });
    expect(updateAdvancedTrimSession(committed.session, 100)).toMatchObject({
      applied: false,
      reason: 'invalid-session',
    });
    const cancelled = cancelAdvancedTrimSession(updated);
    expect(cancelled.session).toMatchObject({
      status: 'cancelled',
      appliedDeltaMs: 0,
      previewClips: [{ sourceInMs: 1_000 }],
    });
    expect(cancelled.session.previewClips).not.toBe(cancelled.session.originalClips);
  });

  it('rejects locked, non-adjacent, and over-64-track sessions before preview', () => {
    const clips = [
      clip({ id: 'left', trackId: 'v1' }),
      clip({ id: 'right', trackId: 'v1', startMs: 5_000 }),
    ];
    expect(createAdvancedTrimSession(clips, [{ ...tracks[0], locked: true }, tracks[1]], {
      mode: 'slip',
      primaryClipId: 'left',
    })).toEqual({ ok: false, reason: 'locked-track' });
    expect(createAdvancedTrimSession(clips, tracks, {
      mode: 'roll',
      primaryClipId: 'left',
      secondaryClipId: 'right',
    })).toEqual({ ok: false, reason: 'invalid-neighbor' });
    const tooManyTracks = Array.from({ length: MAX_ADVANCED_TRIM_TRACKS + 1 }, (_, index) => ({
      id: `v-${index}`,
      kind: 'video' as const,
      locked: false,
    }));
    expect(createAdvancedTrimSession([], tooManyTracks, {
      mode: 'slip',
      primaryClipId: 'missing',
    })).toEqual({ ok: false, reason: 'too-many-tracks' });
  });
});
