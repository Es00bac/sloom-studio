import type { TimelineAutomationPoint } from '../types/flow';

export function normalizeAutomationPoints(
  points: TimelineAutomationPoint[] | undefined,
  defaultValuePercent: number,
  maxValuePercent = 100,
): TimelineAutomationPoint[] {
  const clampedDefault = clampPercent(defaultValuePercent, maxValuePercent);
  const normalized = (points ?? [])
    .filter(
      (point) =>
        Number.isFinite(point.timePercent) &&
        Number.isFinite(point.valuePercent),
    )
    .map((point) => ({
      timePercent: clamp(point.timePercent, 0, 100),
      valuePercent: clamp(point.valuePercent, 0, maxValuePercent),
    }))
    .sort((left, right) => left.timePercent - right.timePercent);

  const deduped: TimelineAutomationPoint[] = [];

  for (const point of normalized) {
    const existingIndex = deduped.findIndex(
      (candidate) => Math.abs(candidate.timePercent - point.timePercent) < 0.001,
    );

    if (existingIndex >= 0) {
      deduped[existingIndex] = point;
    } else {
      deduped.push(point);
    }
  }

  if (deduped.length === 0) {
    return [
      { timePercent: 0, valuePercent: clampedDefault },
      { timePercent: 100, valuePercent: clampedDefault },
    ];
  }

  if (deduped[0].timePercent > 0) {
    deduped.unshift({
      timePercent: 0,
      valuePercent: clampedDefault,
    });
  } else {
    deduped[0] = {
      timePercent: 0,
      valuePercent: deduped[0].valuePercent,
    };
  }

  const lastPoint = deduped[deduped.length - 1];

  if (lastPoint.timePercent < 100) {
    deduped.push({
      timePercent: 100,
      valuePercent: clampedDefault,
    });
  } else {
    deduped[deduped.length - 1] = {
      timePercent: 100,
      valuePercent: lastPoint.valuePercent,
    };
  }

  return deduped;
}

export function getAutomationValueAtLocalTime(
  points: TimelineAutomationPoint[] | undefined,
  localTimeSeconds: number,
  durationSeconds: number,
  defaultValuePercent: number,
  maxValuePercent = 100,
): number {
  const safeDurationSeconds = Math.max(0.001, durationSeconds);
  const progressPercent = clamp((localTimeSeconds / safeDurationSeconds) * 100, 0, 100);
  return getAutomationValueAtProgress(points, progressPercent, defaultValuePercent, maxValuePercent);
}

export function getAutomationValueAtProgress(
  points: TimelineAutomationPoint[] | undefined,
  progressPercent: number,
  defaultValuePercent: number,
  maxValuePercent = 100,
): number {
  const normalized = normalizeAutomationPoints(points, defaultValuePercent, maxValuePercent);
  const progress = clamp(progressPercent, 0, 100);

  for (let index = 1; index < normalized.length; index += 1) {
    const start = normalized[index - 1];
    const end = normalized[index];

    if (progress <= end.timePercent) {
      if (Math.abs(end.timePercent - start.timePercent) < 0.001) {
        return end.valuePercent;
      }

      const ratio = (progress - start.timePercent) / (end.timePercent - start.timePercent);
      return start.valuePercent + (end.valuePercent - start.valuePercent) * ratio;
    }
  }

  return normalized[normalized.length - 1]?.valuePercent ?? clampPercent(defaultValuePercent, maxValuePercent);
}

export function buildAutomationExpression(
  points: TimelineAutomationPoint[] | undefined,
  durationSeconds: number,
  defaultValuePercent: number,
  variableName = 'T',
  maxValuePercent = 100,
): string {
  const normalized = normalizeAutomationPoints(points, defaultValuePercent, maxValuePercent);

  if (normalized.length === 0 || durationSeconds <= 0) {
    return formatUnitValue(defaultValuePercent, maxValuePercent);
  }

  const segments = normalized.map((point) => ({
    timeSeconds: (point.timePercent / 100) * durationSeconds,
    value: clamp(point.valuePercent / maxValuePercent, 0, 1),
  }));

  let expression = formatUnitValue(segments[segments.length - 1].value * maxValuePercent, maxValuePercent);

  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const start = segments[index];
    const end = segments[index + 1];

    const segmentExpression =
      Math.abs(end.timeSeconds - start.timeSeconds) < 0.0001
        ? formatUnitValue(end.value * maxValuePercent, maxValuePercent)
        : `(${start.value.toFixed(4)})+((${end.value.toFixed(4)})-(${start.value.toFixed(4)}))*min(max(((${variableName})-${start.timeSeconds.toFixed(4)})/${Math.max(0.0001, end.timeSeconds - start.timeSeconds).toFixed(4)},0),1)`;

    expression = `if(lte(${variableName},${end.timeSeconds.toFixed(4)}),${segmentExpression},${expression})`;
  }

  return expression;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampPercent(value: number, maxValuePercent: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, maxValuePercent);
}

function formatUnitValue(valuePercent: number, maxValuePercent: number): string {
  return clamp(valuePercent / maxValuePercent, 0, 1).toFixed(4);
}
