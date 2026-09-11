import { describe, expect, it } from 'vitest';
import { alignPaperFrames, distributePaperFrames, type PaperAlignFrame } from './paperAlignDistribute';

const frames: PaperAlignFrame[] = [
  { id: 'a', xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 },
  { id: 'b', xMm: 25, yMm: 5, widthMm: 20, heightMm: 10 },
  { id: 'c', xMm: 50, yMm: 0, widthMm: 10, heightMm: 20 },
];

describe('alignPaperFrames', () => {
  it('aligns to the selection left/right/horizontal-centre', () => {
    expect([...alignPaperFrames(frames, 'left').values()].map((p) => p.xMm)).toEqual([0, 0, 0]);
    expect([...alignPaperFrames(frames, 'right').values()].map((p) => p.xMm)).toEqual([50, 40, 50]);
    expect([...alignPaperFrames(frames, 'centerX').values()].map((p) => p.xMm)).toEqual([25, 20, 25]);
  });

  it('aligns to the selection top/bottom/vertical-centre', () => {
    expect([...alignPaperFrames(frames, 'top').values()].map((p) => p.yMm)).toEqual([0, 0, 0]);
    expect([...alignPaperFrames(frames, 'bottom').values()].map((p) => p.yMm)).toEqual([10, 10, 0]);
    expect([...alignPaperFrames(frames, 'centerY').values()].map((p) => p.yMm)).toEqual([5, 5, 0]);
  });

  it('needs at least two frames', () => {
    expect(alignPaperFrames([frames[0]], 'left').size).toBe(0);
  });
});

describe('distributePaperFrames', () => {
  it('equalises the gaps along the horizontal axis, keeping the ends fixed', () => {
    const patches = distributePaperFrames(frames, 'horizontal');
    // a (first) and c (last) stay put; b moves so gaps are equal (10mm each).
    expect(patches.has('a')).toBe(false);
    expect(patches.has('c')).toBe(false);
    expect(patches.get('b')?.xMm).toBe(20);
  });

  it('needs at least three frames', () => {
    expect(distributePaperFrames(frames.slice(0, 2), 'horizontal').size).toBe(0);
  });
});
