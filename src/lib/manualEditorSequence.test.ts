import { describe, expect, it } from 'vitest';
import { buildManualEditorVisualSequenceClip } from './manualEditorSequence';
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

describe('buildManualEditorVisualSequenceClip', () => {
  it('preserves opacity automation points for the render sequence', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip({
        opacityPercent: 80,
        opacityAutomationPoints: [
          { timePercent: 0, valuePercent: 0 },
          { timePercent: 35, valuePercent: 100 },
          { timePercent: 70, valuePercent: 20 },
          { timePercent: 100, valuePercent: 80 },
        ],
      }),
      {
        assetUrl: 'data:image/png;base64,abc',
        aspectRatio: '16:9',
      },
    );

    expect(sequenceClip.opacityAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 0 },
      { timePercent: 35, valuePercent: 100 },
      { timePercent: 70, valuePercent: 20 },
      { timePercent: 100, valuePercent: 80 },
    ]);
  });

  it('carries the source mimeType through so the export pipeline can detect an animated GIF', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip(),
      {
        assetUrl: 'blob:http://localhost/gif-asset',
        mimeType: 'image/gif',
      },
    );

    expect(sequenceClip.mimeType).toBe('image/gif');
  });

  it('carries an authorized native backing path for zero-copy desktop render', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip({ sourceKind: 'video' }),
      {
        assetUrl: 'signal-loom-asset://file/A001',
        nativeFilePath: '/media/camera/A001.mov',
        mimeType: 'video/quicktime',
      },
    );

    expect(sequenceClip.nativeFilePath).toBe('/media/camera/A001.mov');
  });

  it('leaves mimeType undefined when the source item carries none', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip(),
      { assetUrl: 'data:image/png;base64,abc' },
    );

    expect(sequenceClip.mimeType).toBeUndefined();
  });

  it('carries professional parameter interpolation into the render sequence', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip({
        professional: {
          parameterKeyframes: [{
            id: 'opacity',
            parameter: 'opacity',
            durationMs: 4_000,
            keyframes: [
              { id: 'a', timeMs: 0, value: 10, interpolation: 'hold' },
              { id: 'b', timeMs: 2_000, value: 90, interpolation: 'bezier', bezier: { outX: 0.2, outY: 0.1, inX: 0.8, inY: 0.9 } },
            ],
          }],
        },
      }),
      { assetUrl: 'data:image/png;base64,abc' },
    );

    expect(sequenceClip.professional?.parameterKeyframes?.[0]?.durationMs).toBe(4_000);
    expect(sequenceClip.professional?.parameterKeyframes?.[0]?.keyframes[1]?.interpolation).toBe('bezier');
  });

  it('preserves the runtime identity and nested/adjustment state for the authoritative render route', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip({
        id: 'nested-adjustment-clip',
        professional: { nestedSequenceId: 'nested-a', adjustmentLayer: true },
      }),
      { assetUrl: 'data:image/png;base64,abc' },
    );

    expect(sequenceClip).toMatchObject({
      id: 'nested-adjustment-clip',
      professional: { nestedSequenceId: 'nested-a', adjustmentLayer: true },
    });
  });

  it('retains authored mask geometry through the manual render sequence', () => {
    const sequenceClip = buildManualEditorVisualSequenceClip(
      createVisualClip({
        professional: {
          masks: [{
            id: 'mask-1', kind: 'ellipse', points: [{ x: 0.2, y: 0.25 }, { x: 0.8, y: 0.75 }],
            featherPercent: 10, opacityPercent: 100, inverted: false,
          }],
        },
      }),
      { assetUrl: 'data:image/png;base64,abc' },
    );

    expect(sequenceClip.professional?.masks).toEqual([expect.objectContaining({ id: 'mask-1', kind: 'ellipse' })]);
    expect(sequenceClip.professional?.masks?.[0]?.points).toEqual([{ x: 0.2, y: 0.25 }, { x: 0.8, y: 0.75 }]);
  });
});
