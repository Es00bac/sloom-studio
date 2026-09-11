import { describe, expect, it } from 'vitest';
import {
  VIDEO_RETIME_VERSION,
  buildFfmpegAtempoChain,
  buildFfmpegVideoRetimePlan,
  compileVideoRetimeSegments,
  createVideoFrameHoldRetime,
  mapVideoTimelineToSourceMs,
  qualifyVideoRetimePreview,
  rateStretchVideoRetime,
  resolveVideoRetimeModel,
  validateVideoRetimeModel,
  type VideoCurveRetime,
} from './videoRetime';

describe('video retime', () => {
  it('coexists with legacy playbackRate/reversePlayback through an additive fallback', () => {
    expect(resolveVideoRetimeModel(undefined, { playbackRate: 2, reversePlayback: true })).toEqual({
      version: VIDEO_RETIME_VERSION,
      mode: 'constant',
      rate: 2,
      reverse: true,
      interpolation: 'nearest',
    });
    const curve = createVideoFrameHoldRetime(1_500, 2_000);
    expect(resolveVideoRetimeModel(curve, { playbackRate: 8 })).toEqual(curve);
    expect(resolveVideoRetimeModel(curve, { playbackRate: 8 })).not.toBe(curve);
  });

  it('maps constant forward and reverse time with source-bound clamping', () => {
    const forward = resolveVideoRetimeModel(undefined, { playbackRate: 2 });
    const reverse = resolveVideoRetimeModel(undefined, { playbackRate: 2, reversePlayback: true });
    const bounds = { sourceInMs: 1_000, sourceOutMs: 6_000 };
    expect(mapVideoTimelineToSourceMs(forward, 500, bounds)).toBe(2_000);
    expect(mapVideoTimelineToSourceMs(forward, 10_000, bounds)).toBe(6_000);
    expect(mapVideoTimelineToSourceMs(reverse, 500, bounds)).toBe(5_000);
    expect(mapVideoTimelineToSourceMs(reverse, 10_000, bounds)).toBe(1_000);
  });

  it('validates monotonic curves and preserves a property-style monotonic mapping invariant', () => {
    const curve: VideoCurveRetime = {
      version: 1,
      mode: 'curve',
      interpolation: 'blend',
      points: [
        { timelineMs: 0, sourceMs: 100 },
        { timelineMs: 1_000, sourceMs: 600 },
        { timelineMs: 2_000, sourceMs: 600, hold: true },
        { timelineMs: 3_000, sourceMs: 2_600 },
      ],
    };
    expect(validateVideoRetimeModel(curve)).toMatchObject({ valid: true, direction: 'forward', timelineDurationMs: 3_000 });
    const mapped = Array.from({ length: 301 }, (_, index) => mapVideoTimelineToSourceMs(curve, index * 10, { sourceInMs: 0, sourceOutMs: 5_000 }));
    for (let index = 1; index < mapped.length; index += 1) expect(mapped[index]).toBeGreaterThanOrEqual(mapped[index - 1] ?? 0);
    const invalid: VideoCurveRetime = { ...curve, points: [...curve.points, { timelineMs: 4_000, sourceMs: 50 }] };
    expect(validateVideoRetimeModel(invalid)).toMatchObject({ valid: false });
    expect(validateVideoRetimeModel(invalid).errors.join(' ')).toContain('monotonic');
  });

  it('maps frame holds and compiles them into zero-rate timeline segments', () => {
    const hold = createVideoFrameHoldRetime(2_250, 3_000);
    expect([0, 500, 2_999, 4_000].map((time) => mapVideoTimelineToSourceMs(hold, time, { sourceInMs: 0, sourceOutMs: 10_000 })))
      .toEqual([2_250, 2_250, 2_250, 2_250]);
    expect(compileVideoRetimeSegments(hold, { sourceInMs: 0, sourceOutMs: 10_000 })).toEqual([
      expect.objectContaining({ timelineStartMs: 0, timelineEndMs: 3_000, rate: 0, hold: true, reverse: false }),
    ]);
  });

  it('rate-stretches constant and curve models without changing their source mapping endpoints', () => {
    const constant = resolveVideoRetimeModel(undefined, { playbackRate: 2 });
    expect(rateStretchVideoRetime(constant, 2)).toMatchObject({ rate: 1 });
    const curve: VideoCurveRetime = {
      version: 1, mode: 'curve', interpolation: 'nearest',
      points: [{ timelineMs: 0, sourceMs: 10 }, { timelineMs: 1_000, sourceMs: 1_010 }],
    };
    const stretched = rateStretchVideoRetime(curve, 3) as VideoCurveRetime;
    expect(stretched.points).toEqual([{ timelineMs: 0, sourceMs: 10 }, { timelineMs: 3_000, sourceMs: 1_010 }]);
    expect(curve.points[1]?.timelineMs).toBe(1_000);
  });

  it('qualifies optical flow as export-only and includes minterpolate in the FFmpeg plan', () => {
    const curve: VideoCurveRetime = {
      version: 1, mode: 'curve', interpolation: 'optical-flow',
      points: [{ timelineMs: 0, sourceMs: 0 }, { timelineMs: 2_000, sourceMs: 1_000 }],
    };
    expect(qualifyVideoRetimePreview(curve)).toMatchObject({
      requestedInterpolation: 'optical-flow', previewInterpolation: 'blend', realtimeEligible: false, exportOnly: true,
    });
    const plan = buildFfmpegVideoRetimePlan(curve, { sourceInMs: 0, sourceOutMs: 2_000 }, 30);
    expect(plan.requiresExportOpticalFlow).toBe(true);
    expect(plan.video[0]?.filters.join(',')).toContain('minterpolate=fps=30');
  });

  it('builds bounded atempo chains and explicit muted audio boundaries', () => {
    expect(buildFfmpegAtempoChain(8)).toEqual(['atempo=2', 'atempo=2', 'atempo=2']);
    expect(buildFfmpegAtempoChain(0.125)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.5']);
    expect(buildFfmpegAtempoChain(32)).toBeUndefined();
    const holdPlan = buildFfmpegVideoRetimePlan(createVideoFrameHoldRetime(100, 500), { sourceInMs: 0, sourceOutMs: 1_000 }, 24);
    expect(holdPlan.audio).toEqual([expect.objectContaining({ state: 'muted', reason: 'frame-hold', timelineStartMs: 0, timelineEndMs: 500 })]);
    const reversePlan = buildFfmpegVideoRetimePlan(resolveVideoRetimeModel(undefined, { reversePlayback: true }), { sourceInMs: 0, sourceOutMs: 1_000 }, 24);
    expect(reversePlan.audio[0]).toMatchObject({ state: 'muted', reason: 'reverse-audio-requires-pre-render' });
  });

  it('keeps supported variable-rate audio boundaries duration-aligned with video segments', () => {
    const curve: VideoCurveRetime = {
      version: 1, mode: 'curve', interpolation: 'blend',
      points: [
        { timelineMs: 0, sourceMs: 0 },
        { timelineMs: 2_000, sourceMs: 1_000 },
        { timelineMs: 3_000, sourceMs: 3_000 },
      ],
    };
    const plan = buildFfmpegVideoRetimePlan(curve, { sourceInMs: 0, sourceOutMs: 3_000 }, 30);
    expect(plan.segments.map((segment) => segment.rate)).toEqual([0.5, 2]);
    expect(plan.video.reduce((sum, segment) => sum + segment.durationMs, 0)).toBe(plan.outputDurationMs);
    expect(plan.audio.every((boundary) => boundary.state === 'supported')).toBe(true);
    expect(plan.audio.map((boundary) => boundary.timelineEndMs - boundary.timelineStartMs)).toEqual(plan.video.map((segment) => segment.durationMs));
    expect(plan.outputDurationMs).toBe(3_000);
  });
});
