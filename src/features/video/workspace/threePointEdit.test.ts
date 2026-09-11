import { describe, expect, it } from 'vitest';
import { createEditorVisualClip } from '../../../lib/manualEditorState';
import { normalizeSourceMarks, overwriteTrackRange, shiftTrackClipsForInsert, type VisualClipBlock } from './threePointEdit';

function clip(id: string, trackIndex: number, startMs: number, extra: Record<string, unknown> = {}) {
  return { ...createEditorVisualClip('node', 'video', { trackIndex, startMs }), id, ...extra };
}

function block(c: ReturnType<typeof clip>, durationMs: number): VisualClipBlock {
  return { clip: c, startMs: c.startMs, durationMs };
}

describe('three-point edit math', () => {
  it('normalizes I/O marks: clamps, orders, whole-clip fallback', () => {
    expect(normalizeSourceMarks({ inSeconds: 2, outSeconds: 5 }, 10)).toEqual({ sourceInMs: 2000, sourceOutMs: 5000 });
    expect(normalizeSourceMarks({}, 10)).toEqual({ sourceInMs: 0, sourceOutMs: 10000 });
    // out before in -> out is pushed past in
    expect(normalizeSourceMarks({ inSeconds: 6, outSeconds: 3 }, 10).sourceOutMs).toBe(6001);
    // marks beyond the source clamp to it
    expect(normalizeSourceMarks({ inSeconds: -2, outSeconds: 99 }, 10)).toEqual({ sourceInMs: 0, sourceOutMs: 10000 });
  });

  it('insert shifts only the target track at/after the playhead', () => {
    const a = clip('a', 0, 0);
    const b = clip('b', 0, 4000);
    const other = clip('c', 1, 4000);
    const shifted = shiftTrackClipsForInsert([a, b, other], 0, 2000, 3000);
    expect(shifted.find((c) => c.id === 'a')?.startMs).toBe(0);
    expect(shifted.find((c) => c.id === 'b')?.startMs).toBe(7000);
    expect(shifted.find((c) => c.id === 'c')?.startMs).toBe(4000);
  });

  it('overwrite removes fully covered clips and trims edge overlaps in source time', () => {
    const a = clip('a', 0, 0);        // 0..4s — overlaps range start
    const b = clip('b', 0, 4000);     // 4..6s — fully covered
    const c = clip('c', 0, 6000);     // 6..10s — overlaps range end
    const blocks = [block(a, 4000), block(b, 2000), block(c, 4000)];
    const { clips, removedClipIds } = overwriteTrackRange(blocks, 0, 3000, 4000); // clear 3..7s
    expect(removedClipIds).toEqual(['b']);
    const left = clips.find((x) => x.id === 'a')!;
    expect(left.trimEndMs).toBe(1000);          // lost 3..4s of timeline = 1000ms source at rate 1
    const right = clips.find((x) => x.id === 'c')!;
    expect(right.startMs).toBe(7000);           // pushed past the range
    expect(right.trimStartMs).toBe(1000);       // lost 6..7s
  });

  it('overwrite splits a clip that straddles the whole range', () => {
    const a = clip('a', 0, 0);
    const { clips } = overwriteTrackRange([block(a, 10000)], 0, 3000, 4000); // clear 3..7s of 0..10s
    expect(clips).toHaveLength(2);
    const head = clips[0];
    const tail = clips[1];
    expect(head.trimEndMs).toBe(7000);          // head keeps 0..3s (loses 3..10 = 7000ms source)
    expect(tail.startMs).toBe(7000);
    expect(tail.trimStartMs).toBe(7000);        // tail keeps 7..10s
    expect(tail.id).not.toBe(head.id);
  });

  it('overwrite respects playbackRate when converting timeline loss to source trims', () => {
    const a = clip('a', 0, 0, { playbackRate: 2 });
    const { clips } = overwriteTrackRange([block(a, 4000)], 0, 3000, 4000); // lose 3..4s timeline at 2x
    expect(clips[0].trimEndMs).toBe(2000);      // 1000ms timeline * 2x rate = 2000ms source
  });

  it('overwrite leaves other tracks untouched', () => {
    const a = clip('a', 1, 3000);
    const { clips, removedClipIds } = overwriteTrackRange([block(a, 2000)], 0, 3000, 4000);
    expect(removedClipIds).toEqual([]);
    expect(clips[0]).toBe(a);
  });
});
