import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_MINIMAP_BUCKETS,
  MAX_VIDEO_NAVIGATION_DURATION_MS,
  buildVideoTimelineNavigationModel,
  dragVideoTimelineViewportByRatio,
  fitVideoTimelineViewport,
  seekVideoTimelineViewport,
  setVideoTimelineWorkArea,
  timelineMillisecondsToRatio,
  timelineRatioToMilliseconds,
  zoomVideoTimelineViewport,
} from './videoTimelineNavigation';

describe('feature-length Video timeline navigation', () => {
  it('builds a bounded density overview with O(clips + buckets) range accumulation', () => {
    const result = buildVideoTimelineNavigationModel({
      durationMs: 12_000,
      trackCount: 2,
      bucketCount: 4,
      viewport: { startMs: 3_000, endMs: 6_000 },
      clips: [
        { id: 'v-wide', trackIndex: 0, startMs: 0, durationMs: 9_000, kind: 'video' },
        { id: 'a-middle', trackIndex: 1, startMs: 3_000, durationMs: 3_000, kind: 'audio' },
        { id: 'disabled', trackIndex: 1, startMs: 0, durationMs: 12_000, kind: 'audio', enabled: false },
      ],
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.model.buckets.map((bucket) => [bucket.videoClipCount, bucket.audioClipCount])).toEqual([
      [1, 0], [1, 1], [1, 0], [0, 0],
    ]);
    expect(result.model.peakClipCount).toBe(2);
    expect(result.model.buckets[1].density).toBe(1);
  });

  it('caps buckets and rejects timelines beyond the declared 12h/64-track bounds', () => {
    const capped = buildVideoTimelineNavigationModel({
      durationMs: 1_000,
      trackCount: 1,
      bucketCount: MAX_VIDEO_MINIMAP_BUCKETS + 500,
      clips: [],
    });
    expect(capped).toMatchObject({ ok: true });
    if (capped.ok) expect(capped.model.buckets).toHaveLength(MAX_VIDEO_MINIMAP_BUCKETS);
    expect(buildVideoTimelineNavigationModel({
      durationMs: MAX_VIDEO_NAVIGATION_DURATION_MS + 1, trackCount: 1, clips: [],
    })).toEqual({ ok: false, reason: 'duration-too-large' });
    expect(buildVideoTimelineNavigationModel({ durationMs: 1_000, trackCount: 65, clips: [] })).toEqual({ ok: false, reason: 'too-many-tracks' });
  });

  it('moves, seeks, zooms, and fits without escaping the sequence', () => {
    const result = buildVideoTimelineNavigationModel({
      durationMs: 100_000, trackCount: 1, clips: [], viewport: { startMs: 20_000, endMs: 40_000 },
    });
    if (!result.ok) throw new Error(result.reason);
    const dragged = dragVideoTimelineViewportByRatio(result.model, 0.9);
    expect(dragged).toMatchObject({ ok: true, model: { viewport: { startMs: 80_000, endMs: 100_000 } } });
    const zoomed = zoomVideoTimelineViewport(result.model, { factor: 2, anchorMs: 30_000 });
    expect(zoomed).toMatchObject({ ok: true, model: { viewport: { startMs: 25_000, endMs: 35_000 } } });
    expect(seekVideoTimelineViewport(result.model, 0)).toMatchObject({ ok: true, model: { viewport: { startMs: 0, endMs: 20_000 } } });
    expect(fitVideoTimelineViewport(result.model, { startMs: 40_000, endMs: 50_000 }, 0.1)).toMatchObject({
      ok: true, model: { viewport: { startMs: 39_000, endMs: 51_000 } },
    });
  });

  it('stores and clears a normalized work area and converts minimap coordinates', () => {
    const result = buildVideoTimelineNavigationModel({ durationMs: 100_000, trackCount: 1, clips: [] });
    if (!result.ok) throw new Error(result.reason);
    const set = setVideoTimelineWorkArea(result.model, { startMs: 90_000, endMs: 110_000 });
    expect(set).toMatchObject({ ok: true, model: { workArea: { startMs: 80_000, endMs: 100_000 } } });
    if (!set.ok) throw new Error(set.reason);
    expect(setVideoTimelineWorkArea(set.model, undefined)).toMatchObject({ ok: true, model: { workArea: undefined } });
    expect(timelineMillisecondsToRatio(25_000, 100_000)).toBe(0.25);
    expect(timelineRatioToMilliseconds(0.25, 100_000)).toBe(25_000);
  });
});
