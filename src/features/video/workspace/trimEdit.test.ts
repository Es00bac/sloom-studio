import { describe, expect, it } from 'vitest';
import { createEditorVisualClip } from '../../../lib/manualEditorState';
import { findNearestEditPoint, rippleTrimClipToTarget, rollEditPointToTarget } from './trimEdit';
import type { VisualClipBlock } from './threePointEdit';

function clip(id: string, trackIndex: number, startMs: number, extra: Record<string, unknown> = {}) {
  return { ...createEditorVisualClip('node', 'video', { trackIndex, startMs }), id, ...extra };
}

function block(c: ReturnType<typeof clip>, durationMs: number): VisualClipBlock {
  return { clip: c, startMs: c.startMs, durationMs };
}

describe('ripple trim', () => {
  it('shortening the OUT edge trims in source time and pulls later clips left', () => {
    const a = clip('a', 0, 0);
    const b = clip('b', 0, 4000);
    const result = rippleTrimClipToTarget([block(a, 4000), block(b, 3000)], 'a', 'out', 3000)!;
    expect(result.find((c) => c.id === 'a')?.trimEndMs).toBe(1000);
    expect(result.find((c) => c.id === 'b')?.startMs).toBe(3000);
  });

  it('extending the OUT edge consumes existing tail trim and pushes later clips right', () => {
    const a = clip('a', 0, 0, { trimEndMs: 2000 });
    const b = clip('b', 0, 4000);
    const result = rippleTrimClipToTarget([block(a, 4000), block(b, 3000)], 'a', 'out', 5000)!;
    expect(result.find((c) => c.id === 'a')?.trimEndMs).toBe(1000);
    expect(result.find((c) => c.id === 'b')?.startMs).toBe(5000);
  });

  it('refuses to extend past available media or collapse the clip', () => {
    const a = clip('a', 0, 0); // no tail trim to consume
    const b = clip('b', 0, 4000);
    expect(rippleTrimClipToTarget([block(a, 4000), block(b, 3000)], 'a', 'out', 5000)).toBeNull();
    expect(rippleTrimClipToTarget([block(a, 4000), block(b, 3000)], 'a', 'out', 10)).toBeNull();
  });

  it('IN edge trim respects playbackRate and leaves other lanes alone', () => {
    const a = clip('a', 0, 1000, { playbackRate: 2 });
    const b = clip('b', 0, 5000);
    const other = clip('c', 1, 5000);
    const result = rippleTrimClipToTarget([block(a, 4000), block(b, 2000), block(other, 2000)], 'a', 'in', 2000)!;
    expect(result.find((c) => c.id === 'a')?.trimStartMs).toBe(2000); // 1000ms timeline x 2 rate
    expect(result.find((c) => c.id === 'b')?.startMs).toBe(4000);
    expect(result.find((c) => c.id === 'c')?.startMs).toBe(5000);
  });
});

describe('roll edit point', () => {
  it('finds the nearest tight cut on the lane', () => {
    const a = clip('a', 0, 0);
    const b = clip('b', 0, 4000);
    const c = clip('c', 0, 9000); // gap before c — not a tight cut
    const found = findNearestEditPoint([block(a, 4000), block(b, 3000), block(c, 1000)], 0, 3500);
    expect(found).toEqual({ leftClipId: 'a', rightClipId: 'b', cutMs: 4000 });
  });

  it('rolls the cut right: left extends from its tail trim, right head trims, lane length constant', () => {
    const a = clip('a', 0, 0, { trimEndMs: 3000 });
    const b = clip('b', 0, 4000);
    const result = rollEditPointToTarget([block(a, 4000), block(b, 4000)], 'a', 'b', 5000)!;
    const left = result.find((c) => c.id === 'a')!;
    const right = result.find((c) => c.id === 'b')!;
    expect(left.trimEndMs).toBe(2000);
    expect(right.startMs).toBe(5000);
    expect(right.trimStartMs).toBe(1000);
  });

  it('clamps the roll to available media on both sides', () => {
    const a = clip('a', 0, 0, { trimEndMs: 500 }); // left can extend only 0.5s
    const b = clip('b', 0, 4000);
    const result = rollEditPointToTarget([block(a, 4000), block(b, 4000)], 'a', 'b', 7000)!;
    expect(result.find((c) => c.id === 'b')?.startMs).toBe(4500);
  });

  it('returns null when nothing can move', () => {
    const a = clip('a', 0, 0); // no tail media
    const b = clip('b', 0, 4000, { trimStartMs: 0 }); // no head media for reverse either... roll right impossible
    expect(rollEditPointToTarget([block(a, 4000), block(b, 4000)], 'a', 'b', 4000)).toBeNull();
  });
});
