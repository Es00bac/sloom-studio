/**
 * Per-track collapse state for the Video sequencer. Stored on the composition as arrays of
 * collapsed track indexes. A collapsed lane renders as a minimal strip (label + a slim bar per
 * clip) instead of the full waveform/label/automation view, and disables pointer editing on the
 * lane body — but unlike a locked lane, it is not dimmed or desaturated; it is just minimized.
 */

export function normalizeCollapsedTracks(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const entry of value) {
    // strict coercion: Number(null) === 0 would silently collapse track 0
    const index = typeof entry === 'number'
      ? entry
      : typeof entry === 'string' && entry.trim() !== ''
        ? Number(entry)
        : Number.NaN;
    if (Number.isInteger(index) && index >= 0) seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}

export function toggleCollapsedTrack(collapsed: readonly number[], trackIndex: number): number[] {
  return collapsed.includes(trackIndex)
    ? collapsed.filter((index) => index !== trackIndex)
    : [...collapsed, trackIndex].sort((a, b) => a - b);
}

export function isTrackCollapsed(collapsed: readonly number[], trackIndex: number): boolean {
  return collapsed.includes(trackIndex);
}
