import { describe, expect, it } from 'vitest';
import {
  computeStageFrameDrawPlan,
  mapBlendModeToCanvasComposite,
  resolveActiveStageFrameClips,
  resolveComicTailSample,
  resolveDissolveOffsetSeconds,
  type StageFrameTimelineClip,
} from './stageFrameCompositor';
import type { ComposeSequenceVisualClip } from './mediaComposition';
import { buildPrimaryColorCorrectionPatch } from './videoPrimaryColor';

function buildClip(overrides: Partial<ComposeSequenceVisualClip> = {}): ComposeSequenceVisualClip {
  return {
    id: overrides.id ?? 'clip-1',
    sourceNodeId: 'node-1',
    sourceKind: 'image',
    trackIndex: 0,
    startMs: 0,
    assetUrl: 'data:image/png;base64,AAAA',
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
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 0,
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 64,
    textColor: '#f3f4f6',
    textEffect: 'none',
    textBackgroundOpacityPercent: 0,
    ...overrides,
  };
}

function buildTimelineClip(overrides: Partial<ComposeSequenceVisualClip> & { clipDurationSeconds: number; sourceWidth?: number; sourceHeight?: number }): StageFrameTimelineClip {
  const { clipDurationSeconds, sourceWidth = 1920, sourceHeight = 1080, ...clipOverrides } = overrides;
  return {
    clip: buildClip(clipOverrides),
    clipDurationSeconds,
    sourceWidth,
    sourceHeight,
    sourceDurationSeconds: 0,
  };
}

describe('resolveActiveStageFrameClips', () => {
  it('selects only clips whose [startMs, startMs+duration] window contains timeSeconds', () => {
    const clips: StageFrameTimelineClip[] = [
      buildTimelineClip({ id: 'a', startMs: 0, clipDurationSeconds: 2 }),
      buildTimelineClip({ id: 'b', startMs: 3000, clipDurationSeconds: 2 }),
    ];

    expect(resolveActiveStageFrameClips(clips, 1).map((entry) => entry.clip.id)).toEqual(['a']);
    expect(resolveActiveStageFrameClips(clips, 2.5)).toEqual([]);
    expect(resolveActiveStageFrameClips(clips, 3.5).map((entry) => entry.clip.id)).toEqual(['b']);
  });

  it('computes localTimeSeconds and progressPercent relative to the clip\'s own start', () => {
    const clips = [buildTimelineClip({ id: 'a', startMs: 1000, clipDurationSeconds: 4 })];
    const [active] = resolveActiveStageFrameClips(clips, 2);

    expect(active.localTimeSeconds).toBeCloseTo(1, 5);
    expect(active.progressPercent).toBeCloseTo(25, 5);
  });

  it('sorts active clips by trackIndex then startMs (stage z-order)', () => {
    const clips = [
      buildTimelineClip({ id: 'top', startMs: 0, trackIndex: 2, clipDurationSeconds: 5 }),
      buildTimelineClip({ id: 'bottom', startMs: 0, trackIndex: 0, clipDurationSeconds: 5 }),
      buildTimelineClip({ id: 'middle-later', startMs: 1000, trackIndex: 1, clipDurationSeconds: 5 }),
      buildTimelineClip({ id: 'middle-earlier', startMs: 0, trackIndex: 1, clipDurationSeconds: 5 }),
    ];

    expect(resolveActiveStageFrameClips(clips, 2).map((entry) => entry.clip.id)).toEqual([
      'bottom', 'middle-earlier', 'middle-later', 'top',
    ]);
  });

  it('pulls an incoming crossfade clip in early by the transition overlap, matching the Edit Stage', () => {
    const outgoing = buildTimelineClip({
      id: 'outgoing', startMs: 0, trackIndex: 0, clipDurationSeconds: 2,
      transitionOut: 'fade', transitionDurationMs: 500,
    });
    const incoming = buildTimelineClip({
      id: 'incoming', startMs: 2000, trackIndex: 0, clipDurationSeconds: 2,
      transitionIn: 'fade', transitionDurationMs: 500,
    });

    // At t=1.7s (300ms before the nominal edit point at 2s), the incoming clip should ALREADY be on
    // stage (its effective start is 2.0 - 0.5 = 1.5s) so the two crossfade against each other.
    const activeIds = resolveActiveStageFrameClips([outgoing, incoming], 1.7).map((entry) => entry.clip.id);
    expect(activeIds).toEqual(['outgoing', 'incoming']);
  });

  it('does NOT pull a clip in early when the adjacent clip is not an outgoing fade on the same track', () => {
    // `other-track` legitimately occupies its own [0, 2] window regardless of any dissolve logic —
    // the point of this test is that `incoming` (transitionIn: fade, starting at 2000ms) must NOT
    // be pulled in early to t=1.7 just because SOME other fade-out clip exists on a different track.
    const other = buildTimelineClip({ id: 'other-track', startMs: 0, trackIndex: 5, clipDurationSeconds: 2, transitionOut: 'fade', transitionDurationMs: 500 });
    const incoming = buildTimelineClip({ id: 'incoming', startMs: 2000, trackIndex: 0, clipDurationSeconds: 2, transitionIn: 'fade', transitionDurationMs: 500 });

    const activeIds = resolveActiveStageFrameClips([other, incoming], 1.7).map((entry) => entry.clip.id);
    expect(activeIds).toContain('other-track');
    expect(activeIds).not.toContain('incoming');
  });

  it('is a pure function of its inputs (same call, same result, independent of call order)', () => {
    const clips = [
      buildTimelineClip({ id: 'a', startMs: 0, clipDurationSeconds: 2 }),
      buildTimelineClip({ id: 'b', startMs: 1500, clipDurationSeconds: 2 }),
    ];

    const first = resolveActiveStageFrameClips(clips, 1.6);
    const second = resolveActiveStageFrameClips(clips, 1.6);
    expect(second).toEqual(first);
  });
});

describe('primary colour execution', () => {
  it('carries the saved primary effect projection into the stage-frame Canvas plan', () => {
    const primary = buildPrimaryColorCorrectionPatch([], undefined, {
      exposureStops: 1,
      contrast: 20,
      saturation: 130,
    });
    const [active] = resolveActiveStageFrameClips([
      buildTimelineClip({ filterStack: primary.filterStack, clipDurationSeconds: 2 }),
    ], 1);
    const plan = computeStageFrameDrawPlan(active, { width: 1280, height: 720 });

    expect(plan.effect.cssFilter).toBe('brightness(1.1) contrast(1.2) saturate(1.3)');
    expect(plan.effect.ffmpegFilters).toEqual(expect.arrayContaining([
      'eq=brightness=0.1000',
      'eq=contrast=1.2000',
      'eq=saturation=1.3000',
    ]));
  });
});

describe('professional mask execution', () => {
  it('carries a saved one-mask plan into the shared stage preview/export draw plan', () => {
    const [active] = resolveActiveStageFrameClips([
      buildTimelineClip({
        clipDurationSeconds: 2,
        professional: {
          masks: [{
            id: 'mask-1', kind: 'rectangle', points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }],
            featherPercent: 0, opacityPercent: 75, inverted: false,
          }],
        },
      }),
    ], 1);
    const plan = computeStageFrameDrawPlan(active, { width: 1280, height: 720 });

    expect(plan.effect.maskExecution.status).toBe('ready');
    if (plan.effect.maskExecution.status === 'ready') {
      expect(plan.effect.maskExecution.model.shapes[0]).toMatchObject({ kind: 'rect', opacity: 0.75 });
    }
  });

  it('resolves tracked mask geometry at the active stage time', () => {
    const [active] = resolveActiveStageFrameClips([
      buildTimelineClip({
        clipDurationSeconds: 2,
        professional: { masks: [{
          id: 'tracked', kind: 'rectangle', points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }],
          featherPercent: 0, opacityPercent: 100, inverted: false,
          tracking: { status: 'ready', keyframes: [{ timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 }, { timeMs: 2_000, offsetX: 0.1, offsetY: 0, scale: 1 }] },
        }] },
      }),
    ], 1);
    const plan = computeStageFrameDrawPlan(active, { width: 1280, height: 720 });

    expect(plan.effect.maskExecution.status).toBe('ready');
    if (plan.effect.maskExecution.status === 'ready') {
      const shape = plan.effect.maskExecution.model.shapes[0];
      expect(shape?.kind).toBe('rect');
      if (shape?.kind === 'rect') {
        expect(shape.x).toBeCloseTo(0.15, 8);
        expect(shape.y).toBeCloseTo(0.2, 8);
      }
    }
  });

  it('marks persisted stabilization unsupported before the stage preview paints it as ordinary media', () => {
    const [active] = resolveActiveStageFrameClips([
      buildTimelineClip({
        clipDurationSeconds: 2,
        professional: { stabilization: { enabled: true, strengthPercent: 50, cropMode: 'auto-scale' } },
      }),
    ], 1);
    const plan = computeStageFrameDrawPlan(active, { width: 1280, height: 720 });

    expect(plan.effect.maskExecution).toEqual({
      status: 'unsupported',
      reason: 'Stabilization is saved setup only; this renderer has no bounded stabilization analysis artifact.',
    });
  });
});

describe('resolveDissolveOffsetSeconds', () => {
  it('returns 0 when the clip has no incoming fade', () => {
    const clip = buildTimelineClip({ id: 'a', startMs: 1000, clipDurationSeconds: 2, transitionIn: 'none' });
    expect(resolveDissolveOffsetSeconds(clip, [clip])).toBe(0);
  });

  it('returns the transition duration (capped at half the clip length) when there is a matching outgoing fade', () => {
    const outgoing = buildTimelineClip({ id: 'out', startMs: 0, trackIndex: 0, clipDurationSeconds: 4, transitionOut: 'fade', transitionDurationMs: 800 });
    const incoming = buildTimelineClip({ id: 'in', startMs: 4000, trackIndex: 0, clipDurationSeconds: 4, transitionIn: 'fade', transitionDurationMs: 800 });

    expect(resolveDissolveOffsetSeconds(incoming, [outgoing, incoming])).toBeCloseTo(0.8, 5);
  });

  it('caps the overlap at half the incoming clip\'s own duration', () => {
    const outgoing = buildTimelineClip({ id: 'out', startMs: 0, trackIndex: 0, clipDurationSeconds: 4, transitionOut: 'fade', transitionDurationMs: 5000 });
    const incoming = buildTimelineClip({ id: 'in', startMs: 4000, trackIndex: 0, clipDurationSeconds: 1, transitionIn: 'fade', transitionDurationMs: 5000 });

    expect(resolveDissolveOffsetSeconds(incoming, [outgoing, incoming])).toBeCloseTo(0.5, 5);
  });
});

describe('mapBlendModeToCanvasComposite', () => {
  it('maps "normal" to source-over', () => {
    expect(mapBlendModeToCanvasComposite('normal')).toBe('source-over');
  });

  it('passes every other CSS blend-mode keyword through unchanged (identity mapping, not a translation table)', () => {
    const modes = [
      'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
      'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    ];

    for (const mode of modes) {
      expect(mapBlendModeToCanvasComposite(mode)).toBe(mode);
    }
  });
});

describe('resolveComicTailSample', () => {
  it('returns no override for a legacy comic clip with only the static polar tail (angle/length)', () => {
    const clip = buildClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      comicTailAngleDeg: 115,
      comicTailLengthPx: 90,
    });

    const sample = resolveComicTailSample(clip, 50);

    expect(sample).toEqual({ tipXPercent: undefined, tipYPercent: undefined, curvePercent: undefined });
  });

  it('resolves the static bezier tail at every progress when the clip has no keyframes', () => {
    const clip = buildClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      comicTailTipXPercent: 72,
      comicTailTipYPercent: 116,
      comicTailCurvePercent: 50,
    });

    expect(resolveComicTailSample(clip, 0)).toEqual({ tipXPercent: 72, tipYPercent: 116, curvePercent: 50 });
    expect(resolveComicTailSample(clip, 100)).toEqual({ tipXPercent: 72, tipYPercent: 116, curvePercent: 50 });
  });

  it('animates the tail per frame between two tail keyframes, independent of the bubble body', () => {
    const clip = buildClip({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      comicTailTipXPercent: 20,
      comicTailTipYPercent: 20,
      comicTailCurvePercent: 30,
      keyframes: [
        { timePercent: 0, positionX: 0, positionY: 0, scalePercent: 100, rotationDeg: 0, opacityPercent: 100, tailTipXPercent: 20, tailTipYPercent: 20, tailCurvePercent: 30 },
        { timePercent: 100, positionX: 0, positionY: 0, scalePercent: 100, rotationDeg: 0, opacityPercent: 100, tailTipXPercent: 80, tailTipYPercent: 40, tailCurvePercent: 70 },
      ],
    });

    // Exactly the mechanism docs/notes/830 names as the fix for the legacy export's "tail baked to
    // the start pose" limitation: sampling per frame (not just at t=0/t=100) proves interpolation,
    // not just pass-through of a keyframe's own stored value.
    expect(resolveComicTailSample(clip, 0)).toEqual({ tipXPercent: 20, tipYPercent: 20, curvePercent: 30 });
    expect(resolveComicTailSample(clip, 50)).toEqual({ tipXPercent: 50, tipYPercent: 30, curvePercent: 50 });
    expect(resolveComicTailSample(clip, 100)).toEqual({ tipXPercent: 80, tipYPercent: 40, curvePercent: 70 });
  });
});
