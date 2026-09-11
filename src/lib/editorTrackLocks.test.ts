import { describe, expect, it } from 'vitest';
import { isTrackLocked, normalizeLockedTracks, toggleLockedTrack } from './editorTrackLocks';

describe('editor track locks', () => {
  it('normalizes junk to sorted unique non-negative integers', () => {
    expect(normalizeLockedTracks([2, '1', 2, -1, 1.5, null, 'x'])).toEqual([1, 2]);
    expect(normalizeLockedTracks(undefined)).toEqual([]);
  });

  it('toggles lock state and reports it', () => {
    let locked = toggleLockedTrack([], 1);
    expect(locked).toEqual([1]);
    expect(isTrackLocked(locked, 1)).toBe(true);
    locked = toggleLockedTrack(locked, 0);
    expect(locked).toEqual([0, 1]);
    locked = toggleLockedTrack(locked, 1);
    expect(locked).toEqual([0]);
    expect(isTrackLocked(locked, 1)).toBe(false);
  });
});
