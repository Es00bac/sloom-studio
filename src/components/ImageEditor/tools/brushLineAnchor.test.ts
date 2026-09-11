import { afterEach, describe, expect, it } from 'vitest';
import {
  brushStraightLineStart,
  clearBrushStrokeAnchor,
  recordBrushStrokeAnchor,
} from './brushLineAnchor';

const NO_SHIFT = { shift: false } as const;
const SHIFT = { shift: true } as const;

afterEach(() => {
  clearBrushStrokeAnchor();
});

describe('brushStraightLineStart', () => {
  it('returns null when there is no recorded anchor', () => {
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toBeNull();
  });

  it('returns null when Shift is not held, even with a recorded anchor', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 10, y: 20 });
    expect(brushStraightLineStart('brush', 'doc-1', NO_SHIFT)).toBeNull();
  });

  it('returns the recorded end point for a Shift+down on the same document', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 10, y: 20 });
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toEqual({ x: 10, y: 20 });
  });

  it('does not draw a line across a different document', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 10, y: 20 });
    expect(brushStraightLineStart('brush', 'doc-2', SHIFT)).toBeNull();
  });

  it('keeps each tool anchor independent', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 1, y: 2 });
    recordBrushStrokeAnchor('eraser', 'doc-1', { x: 3, y: 4 });
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toEqual({ x: 1, y: 2 });
    expect(brushStraightLineStart('eraser', 'doc-1', SHIFT)).toEqual({ x: 3, y: 4 });
    expect(brushStraightLineStart('cloneStamp', 'doc-1', SHIFT)).toBeNull();
  });

  it('chains: re-recording the anchor moves the line start to the latest end', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 10, y: 20 });
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toEqual({ x: 10, y: 20 });
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 30, y: 40 });
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toEqual({ x: 30, y: 40 });
  });

  it('returns a copy so callers cannot mutate the stored anchor', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 10, y: 20 });
    const first = brushStraightLineStart('brush', 'doc-1', SHIFT);
    expect(first).toEqual({ x: 10, y: 20 });
    first!.x = 999;
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toEqual({ x: 10, y: 20 });
  });

  it('snapshots the recorded point so later mutation of the source does not leak in', () => {
    const end = { x: 5, y: 6 };
    recordBrushStrokeAnchor('brush', 'doc-1', end);
    end.x = 100;
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toEqual({ x: 5, y: 6 });
  });

  it('clearBrushStrokeAnchor(toolKey) forgets only that tool', () => {
    recordBrushStrokeAnchor('brush', 'doc-1', { x: 1, y: 2 });
    recordBrushStrokeAnchor('eraser', 'doc-1', { x: 3, y: 4 });
    clearBrushStrokeAnchor('brush');
    expect(brushStraightLineStart('brush', 'doc-1', SHIFT)).toBeNull();
    expect(brushStraightLineStart('eraser', 'doc-1', SHIFT)).toEqual({ x: 3, y: 4 });
  });
});
