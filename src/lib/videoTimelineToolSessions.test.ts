import { describe, expect, it } from 'vitest';
import type { AdvancedTrimClip, AdvancedTrimTrack } from './videoAdvancedTrim';
import {
  beginVideoRateStretchSession,
  beginVideoSelectionToolSession,
  beginVideoTrimToolSession,
  cancelVideoRateStretchSession,
  cancelVideoSelectionToolSession,
  commitVideoTrimToolSession,
  updateVideoRateStretchSession,
  updateVideoSelectionToolSession,
  updateVideoTrimToolSessionFromDrag,
  updateVideoTrimToolSessionNumeric,
  type VideoRateStretchClip,
  type VideoTimelineToolClip,
} from './videoTimelineToolSessions';

const selectionClips: VideoTimelineToolClip[] = [
  { id: 'v-left', trackId: 'v1', startMs: 0, durationMs: 1_000, linkGroupId: 'pair-left' },
  { id: 'a-left', trackId: 'a1', startMs: 0, durationMs: 1_000, linkGroupId: 'pair-left' },
  { id: 'v-right', trackId: 'v1', startMs: 1_000, durationMs: 1_000 },
  { id: 'a-right', trackId: 'a1', startMs: 1_000, durationMs: 1_000 },
];

const trimTracks: AdvancedTrimTrack[] = [
  { id: 'v1', kind: 'video', locked: false },
  { id: 'a1', kind: 'audio', locked: false },
];

function trimClip(id: string, trackId: string, startMs: number, linkGroupId?: string): AdvancedTrimClip {
  return {
    id,
    kind: trackId.startsWith('a') ? 'audio' : 'video',
    trackId,
    startMs,
    durationMs: 1_000,
    sourceInMs: 2_000,
    sourceDurationMs: 10_000,
    playbackRate: 1,
    reverse: false,
    ...(linkGroupId ? { linkGroupId } : {}),
  };
}

describe('Video timeline tool sessions', () => {
  it('supports direct, marquee, range, and directional track selections with linked expansion', () => {
    const direct = beginVideoSelectionToolSession(selectionClips, {
      mode: 'select', anchorMs: 100, hitClipId: 'v-left', selectedClipIds: [],
    });
    expect(direct).toMatchObject({ ok: true, session: { previewSelectedClipIds: ['v-left', 'a-left'] } });

    const marquee = beginVideoSelectionToolSession(selectionClips, {
      mode: 'marquee', anchorMs: 750, targetTrackIds: ['v1'], selectedClipIds: [],
    });
    if (!marquee.ok) throw new Error(marquee.reason);
    expect(updateVideoSelectionToolSession(selectionClips, marquee.session, { currentMs: 1_250 })).toMatchObject({
      ok: true,
      session: { previewSelectedClipIds: ['v-left', 'v-right', 'a-left'] },
    });

    expect(beginVideoSelectionToolSession(selectionClips, {
      mode: 'range', anchorMs: 0, targetTrackIds: ['a1'], selectedClipIds: [],
    })).toMatchObject({ ok: true });
    expect(beginVideoSelectionToolSession(selectionClips, {
      mode: 'track-forward', anchorMs: 1_000, targetTrackIds: ['v1'], selectedClipIds: [], includeLinked: false,
    })).toMatchObject({ ok: true, session: { previewSelectedClipIds: ['v-right'] } });
    expect(beginVideoSelectionToolSession(selectionClips, {
      mode: 'track-back', anchorMs: 1_000, targetTrackIds: ['v1'], selectedClipIds: [], includeLinked: false,
    })).toMatchObject({ ok: true, session: { previewSelectedClipIds: ['v-left'] } });
  });

  it('cancels selection to its original immutable selection', () => {
    const begun = beginVideoSelectionToolSession(selectionClips, {
      mode: 'select', anchorMs: 100, hitClipId: 'v-left', selectedClipIds: ['v-right'], behavior: 'replace',
    });
    if (!begun.ok) throw new Error(begun.reason);
    const cancelled = cancelVideoSelectionToolSession(begun.session);
    expect(cancelled).toMatchObject({ ok: true, session: { status: 'cancelled', previewSelectedClipIds: ['v-right'] } });
  });

  it('adapts drag and numeric frame deltas around the finite linked trim engine', () => {
    const clips = [
      trimClip('v', 'v1', 0, 'pair'),
      trimClip('a', 'a1', 40, 'pair'),
    ];
    const begun = beginVideoTrimToolSession(clips, trimTracks, {
      mode: 'slip', primaryClipId: 'v', framesPerSecond: 25,
    });
    if (!begun.ok) throw new Error(begun.reason);
    const dragged = updateVideoTrimToolSessionFromDrag(begun.session, {
      originClientX: 100, currentClientX: 110, millisecondsPerPixel: 5,
    });
    expect(dragged).toMatchObject({ ok: true, session: { trim: { appliedDeltaMs: 40 } } });
    if (!dragged.ok) throw new Error(dragged.reason);
    const numeric = updateVideoTrimToolSessionNumeric(dragged.session, { value: 3, unit: 'frames' });
    expect(numeric).toMatchObject({ ok: true, session: { trim: { appliedDeltaMs: 120 } } });
    if (!numeric.ok) throw new Error(numeric.reason);
    expect(numeric.session.trim.previewClips.map((clip) => clip.sourceInMs)).toEqual([2_120, 2_120]);
    expect(commitVideoTrimToolSession(numeric.session)).toMatchObject({ ok: true, session: { status: 'committed', trim: { status: 'committed' } } });
  });

  it('rate-stretches linked clips with clamps and cancellation', () => {
    const clips: VideoRateStretchClip[] = [
      { id: 'v', trackId: 'v1', startMs: 0, durationMs: 2_000, playbackRate: 1, linkGroupId: 'pair' },
      { id: 'a', trackId: 'a1', startMs: 40, durationMs: 2_000, playbackRate: 1, linkGroupId: 'pair' },
    ];
    const begun = beginVideoRateStretchSession(clips, 'v', { maximumDurationMs: 8_000 });
    if (!begun.ok) throw new Error(begun.reason);
    const updated = updateVideoRateStretchSession(begun.session, 4_000);
    expect(updated).toMatchObject({
      ok: true,
      session: { appliedDurationMs: 4_000, previewClips: [{ durationMs: 4_000, playbackRate: 0.5 }, { durationMs: 4_000, playbackRate: 0.5 }] },
    });
    if (!updated.ok) throw new Error(updated.reason);
    expect(cancelVideoRateStretchSession(updated.session)).toMatchObject({
      ok: true,
      session: { status: 'cancelled', previewClips: [{ durationMs: 2_000, playbackRate: 1 }, { durationMs: 2_000, playbackRate: 1 }] },
    });
  });

  it('rejects locked rate-stretch groups and invalid trim timebases', () => {
    const clips: VideoRateStretchClip[] = [
      { id: 'v', trackId: 'v1', startMs: 0, durationMs: 2_000, playbackRate: 1, linkGroupId: 'pair' },
      { id: 'a', trackId: 'a1', startMs: 0, durationMs: 2_000, playbackRate: 1, linkGroupId: 'pair' },
    ];
    expect(beginVideoRateStretchSession(clips, 'v', { lockedTrackIds: ['a1'] })).toEqual({ ok: false, reason: 'locked-track' });
    expect(beginVideoTrimToolSession([], trimTracks, { mode: 'slip', primaryClipId: 'missing', framesPerSecond: 0 })).toEqual({ ok: false, reason: 'invalid-frame-rate' });
  });
});
