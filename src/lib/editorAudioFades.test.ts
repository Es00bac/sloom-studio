import { describe, expect, it } from 'vitest';
import { applyAudioFade, resolveCrossfadePercents } from './editorAudioFades';

describe('audio fades', () => {
  it('fade-in writes a 0->100 head ramp and preserves later automation', () => {
    const points = applyAudioFade([{ timePercent: 60, valuePercent: 40 }], 'in', 10);
    expect(points).toEqual([
      { timePercent: 0, valuePercent: 0 },
      { timePercent: 10, valuePercent: 100 },
      { timePercent: 60, valuePercent: 40 },
    ]);
  });

  it('fade-out writes a 100->0 tail ramp, dropping points inside the fade region', () => {
    const points = applyAudioFade([{ timePercent: 95, valuePercent: 80 }, { timePercent: 20, valuePercent: 50 }], 'out', 10);
    expect(points).toEqual([
      { timePercent: 20, valuePercent: 50 },
      { timePercent: 90, valuePercent: 100 },
      { timePercent: 100, valuePercent: 0 },
    ]);
  });

  it('clamps the fade to at most 95% of the clip', () => {
    const points = applyAudioFade(undefined, 'in', 200);
    expect(points[1].timePercent).toBe(95);
  });

  it('resolves crossfade percents from an overlap, per-clip', () => {
    // A: 0..10s, B: 8..12s -> 2s overlap = 20% of A, 50% of B
    const result = resolveCrossfadePercents(
      { startSeconds: 0, durationSeconds: 10 },
      { startSeconds: 8, durationSeconds: 4 },
    );
    expect(result).toEqual({ aFadeOutPercent: 20, bFadeInPercent: 50, overlapSeconds: 2 });
    // no overlap -> null
    expect(resolveCrossfadePercents(
      { startSeconds: 0, durationSeconds: 4 },
      { startSeconds: 6, durationSeconds: 4 },
    )).toBeNull();
  });
});
