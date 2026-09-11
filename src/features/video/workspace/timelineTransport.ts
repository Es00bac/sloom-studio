/**
 * JKL shuttle transport for the Video timeline (owner-approved pro-editor quartet, item 1).
 *
 * Pure state helpers live here so the shuttle semantics are unit-testable without React:
 * - L taps: 1x -> 2x -> 4x -> 8x forward; from reverse or pause, first tap = 1x forward.
 * - J taps: mirror of L in reverse (-1x -> -2x -> -4x -> -8x).
 * - K / pause: rate 0.
 * - Space: toggles between 0 and 1x forward (resuming forward regardless of prior direction —
 *   matching the common NLE expectation that space always means "play").
 */

export const SHUTTLE_RATE_STEPS = [1, 2, 4, 8] as const;

export function stepShuttleRate(currentRate: number, direction: 1 | -1): number {
  const sameDirection = direction > 0 ? currentRate > 0 : currentRate < 0;
  if (!sameDirection) {
    return direction;
  }
  const magnitude = Math.abs(currentRate);
  const next = SHUTTLE_RATE_STEPS.find((step) => step > magnitude) ?? SHUTTLE_RATE_STEPS[SHUTTLE_RATE_STEPS.length - 1];
  return next * direction;
}

export function toggleShuttlePlay(currentRate: number): number {
  return currentRate === 0 ? 1 : 0;
}

/**
 * Advance the playhead by one animation frame. Returns the clamped next position and whether the
 * transport should stop (hit either end of the sequence).
 */
export function advanceShuttleCursor(
  currentSeconds: number,
  rate: number,
  deltaMs: number,
  maxSeconds: number,
): { nextSeconds: number; stopped: boolean } {
  const proposed = currentSeconds + rate * (deltaMs / 1000);
  if (proposed <= 0) {
    return { nextSeconds: 0, stopped: rate < 0 };
  }
  if (proposed >= maxSeconds) {
    return { nextSeconds: maxSeconds, stopped: rate > 0 };
  }
  return { nextSeconds: proposed, stopped: false };
}
