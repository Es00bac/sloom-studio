const DEFAULT_SNAP_THRESHOLD_SECONDS = 0.12;
const SNAP_POINT_PRECISION = 1000;

export interface ResolveTimelineSnapOptions {
  snapPoints?: number[];
  shiftKey: boolean;
  thresholdSeconds?: number;
  maxSeconds?: number;
}

export function normalizeTimelineSnapPoints(points: unknown): number[] {
  if (!Array.isArray(points)) {
    return [];
  }

  const normalized = points
    .filter((point): point is number => Number.isFinite(point) && point >= 0)
    .map(roundSnapPointSeconds)
    .sort((left, right) => left - right);

  return normalized.filter((point, index) => index === 0 || point !== normalized[index - 1]);
}

export function addTimelineSnapPoint(
  points: unknown,
  seconds: number,
  shiftKey: boolean,
  maxSeconds = Number.POSITIVE_INFINITY,
): number[] {
  const value = resolveTimelineSnapSeconds(seconds, {
    snapPoints: [],
    shiftKey,
    maxSeconds,
  });

  return normalizeTimelineSnapPoints([...normalizeTimelineSnapPoints(points), value]);
}

export function resolveTimelineSnapSeconds(
  seconds: number,
  options: ResolveTimelineSnapOptions,
): number {
  const boundedSeconds = clampTimelineSeconds(seconds, options.maxSeconds);

  if (options.shiftKey) {
    return clampTimelineSeconds(Math.round(boundedSeconds), options.maxSeconds);
  }

  const thresholdSeconds = options.thresholdSeconds ?? DEFAULT_SNAP_THRESHOLD_SECONDS;
  const nearestPoint = normalizeTimelineSnapPoints(options.snapPoints).reduce<{
    point: number;
    distance: number;
  } | null>((nearest, point) => {
    const distance = Math.abs(point - boundedSeconds);

    if (distance > thresholdSeconds || (nearest && nearest.distance <= distance)) {
      return nearest;
    }

    return { point, distance };
  }, null);

  return nearestPoint ? nearestPoint.point : boundedSeconds;
}

function roundSnapPointSeconds(value: number): number {
  return Math.round(value * SNAP_POINT_PRECISION) / SNAP_POINT_PRECISION;
}

function clampTimelineSeconds(value: number, maxSeconds = Number.POSITIVE_INFINITY): number {
  const finiteValue = Number.isFinite(value) ? value : 0;
  const finiteMax = Number.isFinite(maxSeconds) ? Math.max(0, maxSeconds) : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(finiteMax, finiteValue));
}
