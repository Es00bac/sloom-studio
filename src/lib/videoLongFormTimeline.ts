export const LONG_FORM_SEQUENCE_SECONDS = 30 * 60;
export const MAX_TIMELINE_ZOOM_PERCENT = 6_400;
export const ABSOLUTE_MAX_TIMELINE_ZOOM_PERCENT = 1_000_000;
export const MAX_TIMELINE_RULER_TICKS = 360;
export const MAX_ZOOM_VISIBLE_TIMELINE_SECONDS = 10;

const NICE_RULER_INTERVALS_SECONDS = [
  1 / 30,
  0.1,
  0.25,
  0.5,
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  300,
  600,
  900,
  1_800,
  3_600,
] as const;

export interface TimelineViewportRange {
  startSeconds: number;
  endSeconds: number;
}

export function getTimelineMaxZoomPercent(durationSeconds: number): number {
  const safeDuration = Math.max(1, Number.isFinite(durationSeconds) ? durationSeconds : 1);
  const detailZoom = Math.ceil(safeDuration / MAX_ZOOM_VISIBLE_TIMELINE_SECONDS) * 100;
  return Math.min(
    ABSOLUTE_MAX_TIMELINE_ZOOM_PERCENT,
    Math.max(MAX_TIMELINE_ZOOM_PERCENT, detailZoom),
  );
}

export function clampTimelineZoomPercent(percent: number, durationSeconds?: number): number {
  if (!Number.isFinite(percent)) return 100;
  const maxZoom = durationSeconds === undefined
    ? MAX_TIMELINE_ZOOM_PERCENT
    : getTimelineMaxZoomPercent(durationSeconds);
  return Math.max(100, Math.min(maxZoom, Math.round(percent)));
}

export function buildTimelineRulerTicks(
  durationSeconds: number,
  zoomPercent: number,
): number[] {
  const safeDuration = Math.max(1, Number.isFinite(durationSeconds) ? durationSeconds : 1);
  const safeZoom = clampTimelineZoomPercent(zoomPercent, safeDuration);
  const visibleDuration = safeDuration * (100 / safeZoom);
  const desiredInterval = Math.max(
    visibleDuration / 12,
    safeDuration / MAX_TIMELINE_RULER_TICKS,
  );
  const interval = NICE_RULER_INTERVALS_SECONDS.find((candidate) => candidate >= desiredInterval)
    ?? Math.ceil(desiredInterval / 3_600) * 3_600;
  const tickCount = Math.min(MAX_TIMELINE_RULER_TICKS, Math.floor(safeDuration / interval) + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => Number((index * interval).toFixed(6)));
  const lastTick = ticks.at(-1) ?? 0;

  if (safeDuration - lastTick > Math.max(0.001, interval * 0.2) && ticks.length < MAX_TIMELINE_RULER_TICKS) {
    ticks.push(safeDuration);
  }

  return ticks;
}

export function formatEditorTimecode(seconds: number, frameRate = 30): string {
  const safeFrameRate = Math.max(1, Math.round(Number.isFinite(frameRate) ? frameRate : 30));
  const totalFrames = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * safeFrameRate));
  const frames = totalFrames % safeFrameRate;
  const totalSeconds = Math.floor(totalFrames / safeFrameRate);
  const displaySeconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return [hours, minutes, displaySeconds, frames]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function formatTimelineRulerLabel(seconds: number, durationSeconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalSeconds = Math.floor(safeSeconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const displaySeconds = totalSeconds % 60;

  if (durationSeconds >= 3_600) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;
  }
  if (durationSeconds >= 60) {
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;
  }
  return `${Number(safeSeconds.toFixed(safeSeconds < 1 ? 2 : 1))}s`;
}

export function isLongFormSequence(durationSeconds: number): boolean {
  return Number.isFinite(durationSeconds) && durationSeconds >= LONG_FORM_SEQUENCE_SECONDS;
}

export function resolveTimelineViewportRange({
  clientWidth,
  durationSeconds,
  scrollLeft,
  scrollWidth,
}: {
  clientWidth: number;
  durationSeconds: number;
  scrollLeft: number;
  scrollWidth: number;
}): TimelineViewportRange {
  const safeDuration = Math.max(1, durationSeconds);
  const safeScrollWidth = Math.max(1, scrollWidth);
  const visibleStart = Math.max(0, (Math.max(0, scrollLeft) / safeScrollWidth) * safeDuration);
  const visibleDuration = Math.max(1, (Math.max(1, clientWidth) / safeScrollWidth) * safeDuration);
  const overscan = Math.max(2, visibleDuration * 0.75);

  return {
    startSeconds: Math.max(0, visibleStart - overscan),
    endSeconds: Math.min(safeDuration, visibleStart + visibleDuration + overscan),
  };
}

export function timelineRangeIntersects(
  startSeconds: number,
  durationSeconds: number,
  range: TimelineViewportRange | undefined,
): boolean {
  if (!range) return true;
  const endSeconds = startSeconds + Math.max(0, durationSeconds);
  return endSeconds >= range.startSeconds && startSeconds <= range.endSeconds;
}
