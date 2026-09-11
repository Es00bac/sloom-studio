export interface VisualClipSourceRangeMs {
  sourceInMs: number;
  sourceOutMs: number;
  durationMs: number;
}

export interface VisualClipSourceRangeInput {
  sourceInMs?: number;
  sourceOutMs?: number;
  trimStartMs?: number;
  trimEndMs?: number;
}

export function resolveVisualClipSourceRangeMs(
  clip: VisualClipSourceRangeInput,
  sourceDurationSeconds: number,
): VisualClipSourceRangeMs {
  const sourceDurationMs = normalizeFiniteMs(sourceDurationSeconds * 1000);
  const hasExplicitOut = typeof clip.sourceOutMs === 'number';
  const sourceInMs = normalizeFiniteMs(hasExplicitOut ? (clip.sourceInMs ?? clip.trimStartMs ?? 0) : (clip.trimStartMs ?? 0));
  const trimEndMs = normalizeFiniteMs(clip.trimEndMs ?? 0);
  const fallbackSourceOutMs = sourceDurationMs > 0 ? Math.max(0, sourceDurationMs - trimEndMs) : sourceInMs;
  const sourceOutMs = normalizeFiniteMs(clip.sourceOutMs ?? fallbackSourceOutMs);
  const upperBoundMs = Math.max(sourceDurationMs, sourceInMs, sourceOutMs);
  const boundedSourceInMs = clamp(sourceInMs, 0, upperBoundMs);
  const boundedSourceOutMs = clamp(sourceOutMs, boundedSourceInMs, upperBoundMs);

  return {
    sourceInMs: boundedSourceInMs,
    sourceOutMs: boundedSourceOutMs,
    durationMs: Math.max(0, boundedSourceOutMs - boundedSourceInMs),
  };
}

function normalizeFiniteMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
