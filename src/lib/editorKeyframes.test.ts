import { describe, expect, it } from 'vitest';
import {
  applyVisualClipPatchAtProgress,
  ensureVisualClipHasKeyframes,
  getAdjacentKeyframePercent,
  getAudioKeyframeStateAtProgress,
  getVisualKeyframeStateAtProgress,
  removeAudioKeyframe,
  removeVisualKeyframe,
  upsertAudioKeyframe,
  upsertVisualKeyframe,
  visualKeyframesToOpacityAutomation,
} from './editorKeyframes';
import type { EditorAudioClip, EditorVisualClip } from '../types/flow';

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

function createAudioClip(overrides: Partial<EditorAudioClip> = {}): EditorAudioClip {
  return {
    id: 'audio-1',
    sourceNodeId: 'source-1',
    offsetMs: 0,
    trackIndex: 0,
    volumePercent: 100,
    enabled: true,
    ...overrides,
  };
}

describe('editor visual keyframes', () => {
  it('evaluates legacy start and end transform animation as implicit keyframes', () => {
    const clip = createVisualClip({
      positionX: 0,
      positionY: -20,
      motionEnabled: true,
      endPositionX: 100,
      endPositionY: 20,
      scalePercent: 100,
      scaleMotionEnabled: true,
      endScalePercent: 200,
      rotationDeg: 0,
      rotationMotionEnabled: true,
      endRotationDeg: 90,
      opacityPercent: 100,
      opacityAutomationPoints: [
        { timePercent: 0, valuePercent: 100 },
        { timePercent: 50, valuePercent: 25 },
        { timePercent: 100, valuePercent: 0 },
      ],
    });

    expect(getVisualKeyframeStateAtProgress(clip, 50)).toEqual({
      timePercent: 50,
      positionX: 50,
      positionY: 0,
      scalePercent: 150,
      rotationDeg: 45,
      opacityPercent: 25,
    });
  });

  it('interpolates across explicit middle visual keyframes', () => {
    const clip = createVisualClip({
      keyframes: [
        {
          timePercent: 0,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
        },
        {
          timePercent: 50,
          positionX: 200,
          positionY: 50,
          scalePercent: 300,
          rotationDeg: 180,
          opacityPercent: 20,
        },
        {
          timePercent: 100,
          positionX: 100,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 80,
        },
      ],
    });

    expect(getVisualKeyframeStateAtProgress(clip, 75)).toEqual({
      timePercent: 75,
      positionX: 150,
      positionY: 25,
      scalePercent: 200,
      rotationDeg: 90,
      opacityPercent: 50,
    });
  });

  it('upserts a visual keyframe at the requested progress and keeps opacity automation in sync', () => {
    const clip = createVisualClip({
      positionX: 0,
      motionEnabled: true,
      endPositionX: 100,
      opacityPercent: 100,
      opacityAutomationPoints: [
        { timePercent: 0, valuePercent: 100 },
        { timePercent: 100, valuePercent: 0 },
      ],
    });

    const nextClip = upsertVisualKeyframe(clip, 50);

    expect(nextClip.keyframes?.map((keyframe) => keyframe.timePercent)).toEqual([0, 50, 100]);
    expect(nextClip.keyframes?.[1]).toMatchObject({
      positionX: 50,
      opacityPercent: 50,
    });
    expect(visualKeyframesToOpacityAutomation(nextClip)).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 50, valuePercent: 50 },
      { timePercent: 100, valuePercent: 0 },
    ]);
    expect(nextClip.opacityAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 50, valuePercent: 50 },
      { timePercent: 100, valuePercent: 0 },
    ]);
  });

  it('keeps explicit visual keyframes authoritative over stale start-end animation fields', () => {
    const clip = createVisualClip({
      scalePercent: 100,
      scaleMotionEnabled: true,
      endScalePercent: 300,
      keyframes: [
        {
          timePercent: 0,
          positionX: -560,
          positionY: 494,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 0,
        },
        {
          timePercent: 100,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
        },
      ],
    });

    expect(getVisualKeyframeStateAtProgress(clip, 100)).toMatchObject({
      positionX: 0,
      positionY: 0,
      scalePercent: 100,
      opacityPercent: 100,
    });
  });

  it('applies transform edits to the keyframe at the playhead', () => {
    const clip = createVisualClip({
      keyframes: [
        {
          timePercent: 0,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
        },
        {
          timePercent: 50,
          positionX: 40,
          positionY: 20,
          scalePercent: 140,
          rotationDeg: 0,
          opacityPercent: 100,
        },
        {
          timePercent: 100,
          positionX: 0,
          positionY: 0,
          scalePercent: 200,
          rotationDeg: 0,
          opacityPercent: 100,
        },
      ],
    });

    const nextClip = applyVisualClipPatchAtProgress(clip, 50, { scalePercent: 300, positionX: 80 });

    expect(nextClip.keyframes?.[0]?.scalePercent).toBe(100);
    expect(nextClip.keyframes?.[1]).toMatchObject({
      timePercent: 50,
      positionX: 80,
      scalePercent: 300,
    });
    expect(nextClip.keyframes?.at(-1)?.scalePercent).toBe(200);
  });

  it('creates default start and end keyframes for visual clips without explicit keyframes', () => {
    const clip = createVisualClip({
      scalePercent: 120,
      positionX: 30,
      opacityPercent: 75,
    });

    const nextClip = ensureVisualClipHasKeyframes(clip);

    expect(nextClip.keyframes).toEqual([
      {
        timePercent: 0,
        positionX: 30,
        positionY: 0,
        scalePercent: 120,
        rotationDeg: 0,
        opacityPercent: 75,
      },
      {
        timePercent: 100,
        positionX: 30,
        positionY: 0,
        scalePercent: 120,
        rotationDeg: 0,
        opacityPercent: 75,
      },
    ]);
  });

  it('removes a visual opacity keyframe without reviving it from stale automation points', () => {
    const clip = createVisualClip({
      opacityPercent: 100,
      opacityAutomationPoints: [
        { timePercent: 0, valuePercent: 100 },
        { timePercent: 50, valuePercent: 20 },
        { timePercent: 100, valuePercent: 0 },
      ],
      keyframes: [
        {
          timePercent: 0,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
        },
        {
          timePercent: 50,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 20,
        },
        {
          timePercent: 100,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 0,
        },
      ],
    });

    const nextClip = removeVisualKeyframe(clip, 1);

    expect(nextClip.keyframes?.map((keyframe) => keyframe.timePercent)).toEqual([0, 100]);
    expect(nextClip.opacityAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 100, valuePercent: 0 },
    ]);
  });
});

describe('editor comic tail keyframes', () => {
  it('linearly interpolates tail tip and curve across explicit keyframes', () => {
    const clip = createVisualClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      keyframes: [
        {
          timePercent: 0,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
          tailTipXPercent: 20,
          tailTipYPercent: 90,
          tailCurvePercent: 40,
        },
        {
          timePercent: 100,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
          tailTipXPercent: 60,
          tailTipYPercent: 50,
          tailCurvePercent: 80,
        },
      ],
    });

    const state = getVisualKeyframeStateAtProgress(clip, 50);

    expect(state.tailTipXPercent).toBe(40);
    expect(state.tailTipYPercent).toBe(70);
    expect(state.tailCurvePercent).toBe(60);
  });

  it('falls back to the clip static bezier tail when a keyframe omits tail fields', () => {
    const clip = createVisualClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      comicTailTipXPercent: 33,
      comicTailTipYPercent: 88,
      comicTailCurvePercent: 55,
      keyframes: [
        {
          timePercent: 50,
          positionX: 10,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
        },
      ],
    });

    const state = getVisualKeyframeStateAtProgress(clip, 50);

    expect(state.tailTipXPercent).toBe(33);
    expect(state.tailTipYPercent).toBe(88);
    expect(state.tailCurvePercent).toBe(55);
  });

  it('leaves tail fields undefined for clips without any tail data', () => {
    const state = getVisualKeyframeStateAtProgress(createVisualClip(), 50);

    expect(state.tailTipXPercent).toBeUndefined();
    expect(state.tailTipYPercent).toBeUndefined();
    expect(state.tailCurvePercent).toBeUndefined();
  });

  it('upserts a tail-tip keyframe at the playhead and holds the static tail at the anchors', () => {
    const clip = createVisualClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      comicTailTipXPercent: 20,
      comicTailTipYPercent: 80,
      comicTailCurvePercent: 50,
    });

    const nextClip = upsertVisualKeyframe(clip, 50, { tailTipXPercent: 70 });

    expect(getVisualKeyframeStateAtProgress(nextClip, 50).tailTipXPercent).toBe(70);
    expect(getVisualKeyframeStateAtProgress(nextClip, 0).tailTipXPercent).toBe(20);
    expect(getVisualKeyframeStateAtProgress(nextClip, 100).tailTipXPercent).toBe(20);
  });

  it('routes comic tail clip patches into a keyframe at the playhead', () => {
    // With pre-existing tail keyframes, a mid-clip patch adds a distinct keyframe at the playhead
    // instead of shifting the whole clip's static tail.
    const clip = createVisualClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      keyframes: [
        {
          timePercent: 0,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
          tailTipYPercent: 80,
        },
        {
          timePercent: 100,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
          tailTipYPercent: 80,
        },
      ],
    });

    const nextClip = applyVisualClipPatchAtProgress(clip, 50, { comicTailTipYPercent: 30 });

    expect(getVisualKeyframeStateAtProgress(nextClip, 50).tailTipYPercent).toBe(30);
    expect(getVisualKeyframeStateAtProgress(nextClip, 0).tailTipYPercent).toBe(80);
  });

  it('mirrors the first keyframe tail back onto the clip static tail on sync', () => {
    const clip = createVisualClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      keyframes: [
        {
          timePercent: 0,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
          tailTipXPercent: 25,
          tailTipYPercent: 75,
          tailCurvePercent: 45,
        },
        {
          timePercent: 100,
          positionX: 0,
          positionY: 0,
          scalePercent: 100,
          rotationDeg: 0,
          opacityPercent: 100,
          tailTipXPercent: 65,
          tailTipYPercent: 55,
          tailCurvePercent: 85,
        },
      ],
    });

    const synced = ensureVisualClipHasKeyframes(clip);

    expect(synced.comicTailTipXPercent).toBe(25);
    expect(synced.comicTailTipYPercent).toBe(75);
    expect(synced.comicTailCurvePercent).toBe(45);
  });
});

describe('editor audio keyframes', () => {
  it('evaluates and upserts volume keyframes from the existing volume automation line', () => {
    const clip = createAudioClip({
      volumePercent: 100,
      volumeAutomationPoints: [
        { timePercent: 0, valuePercent: 0 },
        { timePercent: 100, valuePercent: 100 },
      ],
    });

    expect(getAudioKeyframeStateAtProgress(clip, 25)).toEqual({
      timePercent: 25,
      volumePercent: 25,
    });

    const nextClip = upsertAudioKeyframe(clip, 25);

    expect(nextClip.volumeKeyframes).toEqual([
      { timePercent: 0, volumePercent: 0 },
      { timePercent: 25, volumePercent: 25 },
      { timePercent: 100, volumePercent: 100 },
    ]);
    expect(nextClip.volumeAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 0 },
      { timePercent: 25, valuePercent: 25 },
      { timePercent: 100, valuePercent: 100 },
    ]);
  });

  it('removes an audio volume keyframe without reviving it from stale automation points', () => {
    const clip = createAudioClip({
      volumePercent: 100,
      volumeAutomationPoints: [
        { timePercent: 0, valuePercent: 100 },
        { timePercent: 50, valuePercent: 35 },
        { timePercent: 100, valuePercent: 0 },
      ],
      volumeKeyframes: [
        { timePercent: 0, volumePercent: 100 },
        { timePercent: 50, volumePercent: 35 },
        { timePercent: 100, volumePercent: 0 },
      ],
    });

    const nextClip = removeAudioKeyframe(clip, 1);

    expect(nextClip.volumeKeyframes).toEqual([
      { timePercent: 0, volumePercent: 100 },
      { timePercent: 100, volumePercent: 0 },
    ]);
    expect(nextClip.volumeAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 100, valuePercent: 0 },
    ]);
  });
});

describe('keyframe navigation', () => {
  it('finds adjacent keyframes including beginning and end frames', () => {
    expect(getAdjacentKeyframePercent([0, 25, 75, 100], 50, 'previous')).toBe(25);
    expect(getAdjacentKeyframePercent([0, 25, 75, 100], 50, 'next')).toBe(75);
    expect(getAdjacentKeyframePercent([25, 75], 99, 'next')).toBe(100);
    expect(getAdjacentKeyframePercent([25, 75], 1, 'previous')).toBe(0);
  });
});
