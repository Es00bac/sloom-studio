/**
 * Per-track lock state for the Video sequencer (gap audit 808, rank 66). Stored on the
 * composition as arrays of locked track indexes. A locked lane rejects every edit: pointer
 * interactions are disabled wholesale at the lane, and keyboard/action paths guard by index.
 */

export function normalizeLockedTracks(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const entry of value) {
    // strict coercion: Number(null) === 0 would silently lock track 0
    const index = typeof entry === 'number'
      ? entry
      : typeof entry === 'string' && entry.trim() !== ''
        ? Number(entry)
        : Number.NaN;
    if (Number.isInteger(index) && index >= 0) seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}

export function toggleLockedTrack(locked: readonly number[], trackIndex: number): number[] {
  return locked.includes(trackIndex)
    ? locked.filter((index) => index !== trackIndex)
    : [...locked, trackIndex].sort((a, b) => a - b);
}

export function isTrackLocked(locked: readonly number[], trackIndex: number): boolean {
  return locked.includes(trackIndex);
}
