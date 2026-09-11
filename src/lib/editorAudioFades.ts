import type { TimelineAutomationPoint } from '../types/flow';

/**
 * Audio fade / crossfade helpers (gap audit 808, rank 72). Fades are expressed as the clip's
 * existing volume AUTOMATION (timePercent/valuePercent of the clip), so they render through the
 * already-shipped automation path — no new render code, no parity risk.
 */

function sortPoints(points: TimelineAutomationPoint[]): TimelineAutomationPoint[] {
  return points.sort((a, b) => a.timePercent - b.timePercent);
}

/**
 * Write a fade onto existing automation. Fade-in replaces everything before `fadePercent` with a
 * 0 -> 100 ramp; fade-out replaces everything after `100 - fadePercent` with a 100 -> 0 ramp.
 * Points outside the fade region are preserved.
 */
export function applyAudioFade(
  points: readonly TimelineAutomationPoint[] | undefined,
  direction: 'in' | 'out',
  fadePercent: number,
): TimelineAutomationPoint[] {
  const clamped = Math.max(1, Math.min(95, fadePercent));
  const existing = (points ?? []).filter((point) =>
    direction === 'in' ? point.timePercent > clamped : point.timePercent < 100 - clamped,
  );

  if (direction === 'in') {
    return sortPoints([
      { timePercent: 0, valuePercent: 0 },
      { timePercent: clamped, valuePercent: 100 },
      ...existing,
    ]);
  }
  return sortPoints([
    ...existing,
    { timePercent: 100 - clamped, valuePercent: 100 },
    { timePercent: 100, valuePercent: 0 },
  ]);
}

/**
 * For two clips on the same lane where B starts before A ends, the overlap window as fade
 * percents of each clip (A fades out across it, B fades in across it). Null when they don't
 * overlap or a clip has no length.
 */
export function resolveCrossfadePercents(
  a: { startSeconds: number; durationSeconds: number },
  b: { startSeconds: number; durationSeconds: number },
): { aFadeOutPercent: number; bFadeInPercent: number; overlapSeconds: number } | null {
  if (a.durationSeconds <= 0 || b.durationSeconds <= 0) return null;
  const aEnd = a.startSeconds + a.durationSeconds;
  const overlapSeconds = Math.min(aEnd, b.startSeconds + b.durationSeconds) - Math.max(a.startSeconds, b.startSeconds);
  if (overlapSeconds <= 0.01) return null;
  return {
    aFadeOutPercent: Math.min(95, (overlapSeconds / a.durationSeconds) * 100),
    bFadeInPercent: Math.min(95, (overlapSeconds / b.durationSeconds) * 100),
    overlapSeconds,
  };
}
