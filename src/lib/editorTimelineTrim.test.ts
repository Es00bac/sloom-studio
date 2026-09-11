import { describe, expect, it } from 'vitest';
import type { EditorVisualClip } from '../types/flow';
import {
  getSelectedVisualClipCutTarget,
  splitVisualClipNonDestructively,
  trimVisualClipEdge,
  snapTimelineSeconds,
} from './editorTimelineTrim';
import { resolveVisualClipDuration } from './manualEditorTimeline';

function videoClip(overrides: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    id: 'clip-1',
    sourceNodeId: 'source-video',
    sourceKind: 'video',
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
    sourceOutMs: 30_000,
    durationSeconds: undefined,
    trimStartMs: 0,
    trimEndMs: 0,
    playbackRate: 1,
    reversePlayback: false,
    fitMode: 'contain',
    scalePercent: 100,
    scaleMotionEnabled: false,
    endScalePercent: 100,
    opacityPercent: 100,
    rotationDeg: 0,
    rotationMotionEnabled: false,
    endRotationDeg: 0,
    flipHorizontal: false,
    flipVertical: false,
    positionX: 0,
    positionY: 0,
    motionEnabled: false,
    endPositionX: 0,
    endPositionY: 0,
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: [],
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 500,
    textFontFamily: 'Inter',
    textSizePx: 64,
    textColor: '#ffffff',
    textEffect: 'none',
    textBackgroundOpacityPercent: 0,
    ...overrides,
  };
}

describe('splitVisualClipNonDestructively', () => {
  it('keeps both sides pointed at the same master source', () => {
    const [left, right] = splitVisualClipNonDestructively(videoClip(), 10, 30);

    expect(left.sourceNodeId).toBe('source-video');
    expect(right.sourceNodeId).toBe('source-video');
    expect(left.sourceInMs).toBe(0);
    expect(left.sourceOutMs).toBe(10_000);
    expect(right.sourceInMs).toBe(10_000);
    expect(right.sourceOutMs).toBe(30_000);
    expect(right.startMs).toBe(10_000);
  });

  it('splits a comic as a still clip and keeps both resolved halves on the timeline', () => {
    const comic = videoClip({
      sourceKind: 'comic',
      startMs: 2_000,
      sourceOutMs: undefined,
      durationSeconds: 4,
    });
    const [left, right] = splitVisualClipNonDestructively(comic, 4, 4);

    expect(left.durationSeconds).toBe(2);
    expect(right.durationSeconds).toBe(2);
    expect(left.startMs).toBe(2_000);
    expect(right.startMs).toBe(4_000);
    expect(resolveVisualClipDuration(left, new Map(), {})).toBe(2);
    expect(resolveVisualClipDuration(right, new Map(), {})).toBe(2);
  });
});

describe('getSelectedVisualClipCutTarget', () => {
  it('targets the selected clip at the playhead instead of requiring a pointer split time', () => {
    const clips = [
      videoClip({ id: 'unselected', startMs: 0, sourceOutMs: 30_000 }),
      videoClip({ id: 'selected', startMs: 5_000, sourceOutMs: 30_000 }),
    ];
    const target = getSelectedVisualClipCutTarget({
      clips,
      selectedClipId: 'selected',
      playheadSeconds: 12,
      resolveDurationSeconds: () => 20,
    });

    expect(target).toEqual({
      clipId: 'selected',
      splitSeconds: 12,
    });
  });

  it('does not cut when the playhead is outside the selected clip body', () => {
    const clips = [videoClip({ id: 'selected', startMs: 5_000, sourceOutMs: 30_000 })];

    expect(getSelectedVisualClipCutTarget({
      clips,
      selectedClipId: 'selected',
      playheadSeconds: 4.9,
      resolveDurationSeconds: () => 20,
    })).toBeUndefined();
    expect(getSelectedVisualClipCutTarget({
      clips,
      selectedClipId: 'selected',
      playheadSeconds: 5.05,
      resolveDurationSeconds: () => 20,
    })).toBeUndefined();
  });
});

describe('trimVisualClipEdge', () => {
  it('extends a left edge back toward hidden source when available', () => {
    const clip = videoClip({ startMs: 10_000, sourceInMs: 10_000, sourceOutMs: 20_000 });
    const next = trimVisualClipEdge(clip, {
      edge: 'start',
      deltaSeconds: -4,
      sourceDurationSeconds: 30,
      shiftKey: false,
    });

    expect(next.startMs).toBe(6_000);
    expect(next.sourceInMs).toBe(6_000);
    expect(next.sourceOutMs).toBe(20_000);
  });

  it('trims a comic as a still clip and preserves its resolved duration', () => {
    const next = trimVisualClipEdge(
      videoClip({ sourceKind: 'comic', startMs: 2_000, sourceOutMs: undefined, durationSeconds: 4 }),
      {
        edge: 'end',
        deltaSeconds: 2,
        sourceDurationSeconds: 4,
        shiftKey: false,
      },
    );

    expect(next.durationSeconds).toBe(6);
    expect(resolveVisualClipDuration(next, new Map(), {})).toBe(6);
  });

  it('snaps edge drags to one-second intervals while Shift is held', () => {
    expect(snapTimelineSeconds(3.49, true)).toBe(3);
    expect(snapTimelineSeconds(3.5, true)).toBe(4);
    expect(snapTimelineSeconds(3.49, false)).toBe(3.49);
  });
});
