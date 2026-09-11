import { describe, expect, it } from 'vitest';
import { resolveClipTrackIndexPatch, resolveTimelineDropTrackIndex } from './editorTimelineTrackDrag';

describe('resolveTimelineDropTrackIndex', () => {
  const laneRects = [
    { trackIndex: 0, top: 0, bottom: 40 },
    { trackIndex: 1, top: 40, bottom: 80 },
    { trackIndex: 2, top: 80, bottom: 120 },
    { trackIndex: 3, top: 120, bottom: 160 },
  ];

  it('returns null when there are no lane rects to hit-test against', () => {
    expect(resolveTimelineDropTrackIndex(50, [])).toBeNull();
  });

  it('resolves the track whose rect contains the pointer', () => {
    expect(resolveTimelineDropTrackIndex(10, laneRects)).toBe(0);
    expect(resolveTimelineDropTrackIndex(45, laneRects)).toBe(1);
    expect(resolveTimelineDropTrackIndex(119, laneRects)).toBe(2);
  });

  it('is exact at rect boundaries (top inclusive, bottom exclusive)', () => {
    expect(resolveTimelineDropTrackIndex(40, laneRects)).toBe(1);
    expect(resolveTimelineDropTrackIndex(80, laneRects)).toBe(2);
  });

  it('clamps to the top lane when the pointer strays above the stack', () => {
    expect(resolveTimelineDropTrackIndex(-30, laneRects)).toBe(0);
  });

  it('clamps to the bottom lane when the pointer strays below the stack', () => {
    expect(resolveTimelineDropTrackIndex(500, laneRects)).toBe(3);
  });

  it('does not require the rects to already be sorted by position', () => {
    const shuffled = [laneRects[2], laneRects[0], laneRects[3], laneRects[1]];
    expect(resolveTimelineDropTrackIndex(90, shuffled)).toBe(2);
  });

  it('handles a single-lane stack', () => {
    expect(resolveTimelineDropTrackIndex(-500, [{ trackIndex: 2, top: 0, bottom: 40 }])).toBe(2);
    expect(resolveTimelineDropTrackIndex(500, [{ trackIndex: 2, top: 0, bottom: 40 }])).toBe(2);
  });
});

describe('resolveClipTrackIndexPatch', () => {
  const neverLocked = () => false;

  it('keeps the current track when no track was requested (horizontal-only drag)', () => {
    expect(resolveClipTrackIndexPatch(1, undefined, neverLocked)).toBe(1);
  });

  it('keeps the current track when the requested track is the same track', () => {
    expect(resolveClipTrackIndexPatch(2, 2, neverLocked)).toBe(2);
  });

  it('moves to the requested track when it is unlocked', () => {
    expect(resolveClipTrackIndexPatch(0, 3, neverLocked)).toBe(3);
  });

  it('rejects the move and keeps the current track when the requested track is locked', () => {
    const isLocked = (trackIndex: number) => trackIndex === 3;
    expect(resolveClipTrackIndexPatch(0, 3, isLocked)).toBe(0);
  });

  it('only consults the lock predicate for an actual track change', () => {
    let calls = 0;
    const isLocked = () => { calls += 1; return true; };
    resolveClipTrackIndexPatch(1, 1, isLocked);
    resolveClipTrackIndexPatch(1, undefined, isLocked);
    expect(calls).toBe(0);
  });
});
