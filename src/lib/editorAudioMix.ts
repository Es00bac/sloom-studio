const DEFAULT_TRACK_COUNT = 4;

export function normalizeAudioTrackIndexes(value: unknown, trackCount = DEFAULT_TRACK_COUNT): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) =>
    typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < trackCount ? [item] : []
  ))].sort((left, right) => left - right);
}

export function toggleAudioTrackIndex(indexes: readonly number[], trackIndex: number): number[] {
  return indexes.includes(trackIndex)
    ? indexes.filter((index) => index !== trackIndex)
    : [...indexes, trackIndex].sort((left, right) => left - right);
}

export function isAudioTrackAudible(
  trackIndex: number,
  mutedTracks: readonly number[],
  soloTracks: readonly number[],
): boolean {
  if (mutedTracks.includes(trackIndex)) return false;
  return soloTracks.length === 0 || soloTracks.includes(trackIndex);
}

export function audioPercentToDecibels(percent: number): number | undefined {
  if (!Number.isFinite(percent) || percent <= 0) return undefined;
  return 20 * Math.log10(percent / 100);
}

export function formatAudioPercentWithDecibels(percent: number): string {
  const decibels = audioPercentToDecibels(percent);
  return `${Math.round(percent)}% · ${decibels === undefined ? '−∞' : `${decibels >= 0 ? '+' : ''}${decibels.toFixed(1)}`} dB`;
}

export function clampAudioFadeSeconds(value: number, clipDurationSeconds: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) return 0;
  return Math.min(5, clipDurationSeconds / 2, Math.max(0, value));
}

export function resolveAlignedDialogueTrack(input: {
  trackCount?: number;
  lockedTracks: readonly number[];
  originalTrackIndex?: number;
  startSeconds: number;
  durationSeconds: number;
  blocks: ReadonlyArray<{ trackIndex: number; startSeconds: number; endSeconds: number }>;
}): number | undefined {
  const trackCount = input.trackCount ?? DEFAULT_TRACK_COUNT;
  if (
    !Number.isFinite(input.startSeconds)
    || input.startSeconds < 0
    || !Number.isFinite(input.durationSeconds)
    || input.durationSeconds <= 0
  ) {
    return undefined;
  }

  const locked = new Set(normalizeAudioTrackIndexes(input.lockedTracks, trackCount));
  const endSeconds = input.startSeconds + input.durationSeconds;
  return Array.from({ length: trackCount }, (_, trackIndex) => trackIndex).find((trackIndex) => (
    trackIndex !== input.originalTrackIndex
    && !locked.has(trackIndex)
    && input.blocks.every((block) => (
      block.trackIndex !== trackIndex
      || block.endSeconds <= input.startSeconds
      || block.startSeconds >= endSeconds
    ))
  ));
}
