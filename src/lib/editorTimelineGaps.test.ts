import { describe, expect, it } from 'vitest';
import type { EditorVisualClip } from '../types/flow';
import { fillTimelineGap, findTimelineGaps } from './editorTimelineGaps';

function clip(id: string, startMs: number, durationSeconds: number): EditorVisualClip {
  return {
    id,
    sourceNodeId: id,
    sourceKind: 'image',
    trackIndex: 0,
    startMs,
    sourceInMs: 0,
    durationSeconds,
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
  };
}

describe('findTimelineGaps', () => {
  it('finds selectable gaps between clips on one track', () => {
    expect(findTimelineGaps([
      { id: 'a', trackIndex: 0, startSeconds: 0, endSeconds: 5 },
      { id: 'b', trackIndex: 0, startSeconds: 8, endSeconds: 10 },
    ], 0)).toEqual([
      { id: 'gap-0-5.000-8.000', trackIndex: 0, startSeconds: 5, endSeconds: 8, durationSeconds: 3 },
    ]);
  });
});

describe('fillTimelineGap', () => {
  it('moves later clips left by the selected gap duration on that track only', () => {
    const result = fillTimelineGap([
      clip('a', 0, 5),
      clip('b', 8_000, 2),
      { ...clip('c', 8_000, 2), trackIndex: 1 },
    ], { trackIndex: 0, startSeconds: 5, endSeconds: 8, durationSeconds: 3 });

    expect(result.find((item) => item.id === 'b')?.startMs).toBe(5_000);
    expect(result.find((item) => item.id === 'c')?.startMs).toBe(8_000);
  });
});
