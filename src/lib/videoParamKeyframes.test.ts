import { describe, expect, it } from 'vitest';
import {
  buildVideoParamStableSignatureInput,
  compileVideoParamKeyframeTrackForFfmpeg,
  evaluateVideoParamKeyframeTrack,
  MAX_VIDEO_PARAM_KEYFRAMES_AGGREGATE,
  MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER,
  validateVideoParamKeyframeTracks,
  type VideoParamKeyframe,
  type VideoParamKeyframeTrack,
} from './videoParamKeyframes';

function track(
  parameterId: string,
  keyframes: readonly VideoParamKeyframe[],
  overrides: Partial<VideoParamKeyframeTrack> = {},
): VideoParamKeyframeTrack {
  return {
    version: 1,
    id: `track-${parameterId}`,
    parameterId,
    defaultValue: 0,
    keyframes,
    ...overrides,
  };
}

function keyframe(id: string, timeMs: number, value: number, interpolation: VideoParamKeyframe['interpolation'] = 'linear'): VideoParamKeyframe {
  return { id, timeMs, value, interpolation };
}

describe('professional Video parameter keyframes', () => {
  it('evaluates hold, linear, and cubic-Bezier segments deterministically', () => {
    const holdTrack = track('opacity', [
      keyframe('a', 0, 10, 'hold'),
      keyframe('b', 1_000, 90),
    ]);
    expect(evaluateVideoParamKeyframeTrack(holdTrack, 999)).toBe(10);
    expect(evaluateVideoParamKeyframeTrack(holdTrack, 1_000)).toBe(90);

    const linearTrack = track('gain', [keyframe('a', 0, -10), keyframe('b', 1_000, 10)]);
    expect(evaluateVideoParamKeyframeTrack(linearTrack, 250)).toBe(-5);

    const easedTrack = track('scale', [
      { ...keyframe('a', 0, 0, 'cubic-bezier'), bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
      keyframe('b', 1_000, 100),
    ]);
    const first = evaluateVideoParamKeyframeTrack(easedTrack, 500);
    const second = evaluateVideoParamKeyframeTrack(easedTrack, 500);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(50);
  });

  it('enforces per-parameter and aggregate bounds', () => {
    const tooMany = Array.from({ length: MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER + 1 }, (_, index) =>
      keyframe(`key-${index}`, index, index),
    );
    expect(validateVideoParamKeyframeTracks([track('amount', tooMany)]).errors).toContain(
      `Parameter track 1 exceeds ${MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER.toLocaleString()} keyframes.`,
    );

    const aggregateTracks = Array.from(
      { length: MAX_VIDEO_PARAM_KEYFRAMES_AGGREGATE / MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER + 1 },
      (_, trackIndex) => track(
        `parameter-${trackIndex}`,
        Array.from({ length: MAX_VIDEO_PARAM_KEYFRAMES_PER_PARAMETER }, (__, index) =>
          keyframe(`key-${trackIndex}-${index}`, index, index),
        ),
      ),
    );
    const aggregate = validateVideoParamKeyframeTracks(aggregateTracks);
    expect(aggregate.valid).toBe(false);
    expect(aggregate.keyframeCount).toBeGreaterThan(MAX_VIDEO_PARAM_KEYFRAMES_AGGREGATE);
    expect(aggregate.errors.some((error) => error.includes('aggregate safety limit'))).toBe(true);
  });

  it('compiles bounded FFmpeg expressions and truthfully defers oversized tracks to a sidecar', () => {
    const automated = track('brightness', [
      keyframe('a', 0, 0, 'hold'),
      keyframe('b', 1_000, 1, 'linear'),
      keyframe('c', 2_000, 2),
    ]);
    const descriptor = compileVideoParamKeyframeTrackForFfmpeg(automated);
    expect(descriptor.ok).toBe(true);
    if (descriptor.ok) {
      expect(descriptor.expression).toContain('if(lt(t,1),0');
      expect(descriptor.expression).toContain('clip((t-1)/1,0,1)');
    }

    const oversized = track('blur', Array.from({ length: 129 }, (_, index) => keyframe(`k-${index}`, index, index)));
    expect(compileVideoParamKeyframeTrackForFfmpeg(oversized)).toMatchObject({
      ok: false,
      strategy: 'sendcmd-sidecar-required',
      keyframeCount: 129,
    });
  });

  it('produces stable signature input independent of input track order', () => {
    const alpha = track('alpha', [keyframe('a', 0, 1)]);
    const zoom = track('zoom', [keyframe('z', 0, 100)]);
    expect(JSON.stringify(buildVideoParamStableSignatureInput([zoom, alpha])))
      .toBe(JSON.stringify(buildVideoParamStableSignatureInput([alpha, zoom])));
  });
});
