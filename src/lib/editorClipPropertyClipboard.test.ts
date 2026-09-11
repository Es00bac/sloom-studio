import { describe, expect, it } from 'vitest';
import {
  copyVisualClipProperties,
  pasteVisualClipProperties,
} from './editorClipPropertyClipboard';
import type { EditorVisualClip } from '../types/flow';

function createVisualClip(overrides: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    id: 'visual-1',
    sourceNodeId: 'source-1',
    sourceKind: 'image',
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
    durationSeconds: 4,
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
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 64,
    textColor: '#f3f4f6',
    textEffect: 'shadow',
    textBackgroundOpacityPercent: 0,
    ...overrides,
  };
}

describe('copyVisualClipProperties', () => {
  it('captures only the checked transform properties', () => {
    const clipboard = copyVisualClipProperties(
      createVisualClip({
        positionX: 128,
        positionY: -72,
        scalePercent: 135,
        rotationDeg: -12,
        opacityPercent: 35,
      }),
      ['position', 'opacity'],
      'Lower third',
    );

    expect(clipboard).toEqual({
      sourceClipId: 'visual-1',
      sourceLabel: 'Lower third',
      properties: ['position', 'opacity'],
      values: {
        position: { x: 128, y: -72 },
        opacityPercent: 35,
      },
    });
  });
});

describe('pasteVisualClipProperties', () => {
  it('pastes copied properties into the start values of a target clip', () => {
    const clipboard = copyVisualClipProperties(
      createVisualClip({
        positionX: 128,
        positionY: -72,
        scalePercent: 135,
        rotationDeg: -12,
        opacityPercent: 35,
      }),
      ['position', 'scale', 'rotation', 'opacity'],
    );

    const patch = pasteVisualClipProperties(
      createVisualClip({
        opacityPercent: 80,
        opacityAutomationPoints: [
          { timePercent: 0, valuePercent: 80 },
          { timePercent: 50, valuePercent: 55 },
          { timePercent: 100, valuePercent: 80 },
        ],
      }),
      clipboard,
      'start',
    );

    expect(patch.keyframes).toEqual([
      {
        timePercent: 0,
        positionX: 128,
        positionY: -72,
        scalePercent: 135,
        rotationDeg: -12,
        opacityPercent: 35,
      },
      {
        timePercent: 50,
        positionX: 0,
        positionY: 0,
        scalePercent: 100,
        rotationDeg: 0,
        opacityPercent: 55,
      },
      {
        timePercent: 100,
        positionX: 0,
        positionY: 0,
        scalePercent: 100,
        rotationDeg: 0,
        opacityPercent: 80,
      },
    ]);
  });

  it('pastes copied properties into the end values of a target clip', () => {
    const clipboard = copyVisualClipProperties(
      createVisualClip({
        positionX: 128,
        positionY: -72,
        scalePercent: 135,
        rotationDeg: -12,
        opacityPercent: 35,
      }),
      ['position', 'scale', 'rotation', 'opacity'],
    );

    const patch = pasteVisualClipProperties(
      createVisualClip({
        opacityPercent: 80,
        opacityAutomationPoints: [
          { timePercent: 25, valuePercent: 55 },
        ],
      }),
      clipboard,
      'end',
    );

    expect(patch.keyframes).toEqual([
      {
        timePercent: 0,
        positionX: 0,
        positionY: 0,
        scalePercent: 100,
        rotationDeg: 0,
        opacityPercent: 80,
      },
      {
        timePercent: 25,
        positionX: 0,
        positionY: 0,
        scalePercent: 100,
        rotationDeg: 0,
        opacityPercent: 55,
      },
      {
        timePercent: 100,
        positionX: 128,
        positionY: -72,
        scalePercent: 135,
        rotationDeg: -12,
        opacityPercent: 35,
      },
    ]);
  });
});
