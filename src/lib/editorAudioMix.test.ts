import { describe, expect, it } from 'vitest';
import {
  audioPercentToDecibels,
  clampAudioFadeSeconds,
  formatAudioPercentWithDecibels,
  isAudioTrackAudible,
  normalizeAudioTrackIndexes,
  resolveAlignedDialogueTrack,
  toggleAudioTrackIndex,
} from './editorAudioMix';

describe('video audio mix essentials', () => {
  it('applies standard mute-wins and any-solo track semantics', () => {
    expect(isAudioTrackAudible(0, [], [])).toBe(true);
    expect(isAudioTrackAudible(0, [0], [0])).toBe(false);
    expect(isAudioTrackAudible(0, [], [1])).toBe(false);
    expect(isAudioTrackAudible(1, [], [1])).toBe(true);
  });

  it('normalizes and toggles persisted track sets', () => {
    expect(normalizeAudioTrackIndexes([3, 1, 1, -1, 8, '2'])).toEqual([1, 3]);
    expect(toggleAudioTrackIndex([1, 3], 1)).toEqual([3]);
    expect(toggleAudioTrackIndex([1], 2)).toEqual([1, 2]);
  });

  it('reports compatible percent gain as decibels and bounds fades', () => {
    expect(audioPercentToDecibels(100)).toBeCloseTo(0);
    expect(audioPercentToDecibels(50)).toBeCloseTo(-6.0206);
    expect(formatAudioPercentWithDecibels(0)).toBe('0% · −∞ dB');
    expect(clampAudioFadeSeconds(4, 6)).toBe(3);
    expect(clampAudioFadeSeconds(9, 30)).toBe(5);
  });

  it('places repaired dialogue only on an unlocked, non-overlapping lane separate from the original', () => {
    expect(resolveAlignedDialogueTrack({
      lockedTracks: [1],
      originalTrackIndex: 0,
      startSeconds: 2,
      durationSeconds: 5,
      blocks: [
        { trackIndex: 2, startSeconds: 6, endSeconds: 10 },
        { trackIndex: 3, startSeconds: 10, endSeconds: 12 },
      ],
    })).toBe(3);

    expect(resolveAlignedDialogueTrack({
      trackCount: 2,
      lockedTracks: [1],
      originalTrackIndex: 0,
      startSeconds: 2,
      durationSeconds: 5,
      blocks: [],
    })).toBeUndefined();
  });
});
