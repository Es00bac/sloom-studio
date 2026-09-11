import { describe, expect, it } from 'vitest';
import {
  addTimelineSnapPoint,
  normalizeTimelineSnapPoints,
  resolveTimelineSnapSeconds,
} from './editorTimelineSnap';

describe('editor timeline snapping', () => {
  it('normalizes custom snap points into sorted unique timeline seconds', () => {
    expect(normalizeTimelineSnapPoints([4, -1, 1.23456, 4.0004, Number.NaN, Infinity])).toEqual([1.235, 4]);
  });

  it('snaps near custom snap points without shift', () => {
    expect(resolveTimelineSnapSeconds(4.08, { snapPoints: [4], shiftKey: false })).toBe(4);
    expect(resolveTimelineSnapSeconds(4.4, { snapPoints: [4], shiftKey: false })).toBe(4.4);
  });

  it('snaps to whole seconds while shift is held', () => {
    expect(resolveTimelineSnapSeconds(4.6, { snapPoints: [4], shiftKey: true })).toBe(5);
  });

  it('adds snap points from ruler clicks and honors shift second snapping', () => {
    expect(addTimelineSnapPoint([], 3.6, true)).toEqual([4]);
    expect(addTimelineSnapPoint([4], 4.0002, false)).toEqual([4]);
  });
});
