import { describe, expect, it } from 'vitest';
import {
  MAX_TIMELINE_RULER_TICKS,
  buildTimelineRulerTicks,
  formatEditorTimecode,
  formatTimelineRulerLabel,
  getTimelineMaxZoomPercent,
  isLongFormSequence,
  resolveTimelineViewportRange,
  timelineRangeIntersects,
} from './videoLongFormTimeline';

describe('video long-form timeline', () => {
  it('keeps a two-hour ruler bounded at fit and maximum zoom', () => {
    expect(buildTimelineRulerTicks(2 * 60 * 60, 100).length).toBeLessThanOrEqual(MAX_TIMELINE_RULER_TICKS);
    expect(buildTimelineRulerTicks(2 * 60 * 60, getTimelineMaxZoomPercent(2 * 60 * 60)).length).toBeLessThanOrEqual(MAX_TIMELINE_RULER_TICKS);
  });

  it('allows a two-hour timeline to zoom to a ten-second working window', () => {
    expect(getTimelineMaxZoomPercent(2 * 60 * 60)).toBe(72_000);
    expect((2 * 60 * 60) * (100 / getTimelineMaxZoomPercent(2 * 60 * 60))).toBe(10);
  });

  it('formats production timecode beyond one hour', () => {
    expect(formatEditorTimecode(3_661.5, 30)).toBe('01:01:01:15');
    expect(formatTimelineRulerLabel(3_661, 7_200)).toBe('01:01:01');
  });

  it('detects long-form sequences without treating short work as long-form', () => {
    expect(isLongFormSequence(29 * 60)).toBe(false);
    expect(isLongFormSequence(30 * 60)).toBe(true);
  });

  it('overscans the visible timeline and culls distant clips', () => {
    const range = resolveTimelineViewportRange({
      clientWidth: 1_000,
      durationSeconds: 7_200,
      scrollLeft: 40_000,
      scrollWidth: 80_000,
    });

    expect(range.startSeconds).toBeLessThan(3_600);
    expect(range.endSeconds).toBeGreaterThan(3_600);
    expect(timelineRangeIntersects(3_590, 20, range)).toBe(true);
    expect(timelineRangeIntersects(60, 10, range)).toBe(false);
  });
});
