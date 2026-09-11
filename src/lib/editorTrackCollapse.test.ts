import { describe, expect, it } from 'vitest';
import { isTrackCollapsed, normalizeCollapsedTracks, toggleCollapsedTrack } from './editorTrackCollapse';

describe('editor track collapse', () => {
  it('normalizes junk to sorted unique non-negative integers', () => {
    expect(normalizeCollapsedTracks([2, '1', 2, -1, 1.5, null, 'x'])).toEqual([1, 2]);
    expect(normalizeCollapsedTracks(undefined)).toEqual([]);
  });

  it('toggles collapse state and reports it', () => {
    let collapsed = toggleCollapsedTrack([], 1);
    expect(collapsed).toEqual([1]);
    expect(isTrackCollapsed(collapsed, 1)).toBe(true);
    collapsed = toggleCollapsedTrack(collapsed, 0);
    expect(collapsed).toEqual([0, 1]);
    collapsed = toggleCollapsedTrack(collapsed, 1);
    expect(collapsed).toEqual([0]);
    expect(isTrackCollapsed(collapsed, 1)).toBe(false);
  });
});
