import { describe, expect, it } from 'vitest';
import {
  buildTimelineClipFrameExportLabel,
  getTimelineClipFrameExportTimeSeconds,
} from './timelineClipFrameExport';
import type { EditorVisualClip } from '../types/flow';

function createVideoClip(overrides: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    id: 'visual-1',
    sourceNodeId: 'video-1',
    sourceKind: 'video',
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
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
    textContent: undefined,
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 64,
    textColor: '#f3f4f6',
    textEffect: 'shadow',
    textBackgroundOpacityPercent: 0,
    ...overrides,
  };
}

describe('getTimelineClipFrameExportTimeSeconds', () => {
  it('uses the visible trim range when exporting first and last frames', () => {
    const clip = createVideoClip({
      trimStartMs: 2000,
      trimEndMs: 3000,
    });

    expect(getTimelineClipFrameExportTimeSeconds(clip, 12, 'first')).toBe(2);
    expect(getTimelineClipFrameExportTimeSeconds(clip, 12, 'last')).toBe(8.95);
  });

  it('swaps first and last frame targets for reversed clips', () => {
    const clip = createVideoClip({
      trimStartMs: 1500,
      trimEndMs: 500,
      reversePlayback: true,
    });

    expect(getTimelineClipFrameExportTimeSeconds(clip, 10, 'first')).toBe(9.45);
    expect(getTimelineClipFrameExportTimeSeconds(clip, 10, 'last')).toBe(1.5);
  });
});

describe('buildTimelineClipFrameExportLabel', () => {
  it('builds a readable source-bin label for exported timeline stills', () => {
    expect(buildTimelineClipFrameExportLabel('Kitchen take.mp4', 'first')).toBe('Kitchen take first frame');
    expect(buildTimelineClipFrameExportLabel('Kitchen take.mp4', 'last')).toBe('Kitchen take last frame');
  });
});
