import { describe, expect, it } from 'vitest';
import {
  buildCardOccluderClipPath,
  collectFlowCardRects,
  flowCardRect,
  flowEdgeAttachedClipId,
  roundedRectPath,
} from './flowCardOcclusion';

function node(x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) {
  return {
    internals: { positionAbsolute: { x, y } },
    measured: { height, width },
    ...extra,
  };
}

describe('flowCardOcclusion', () => {
  it('turns measured cards into slightly outset rectangles', () => {
    expect(flowCardRect(node(10, 20, 260, 140))).toEqual({
      height: 142,
      width: 262,
      x: 9,
      y: 19,
    });
  });

  it('ignores cards that cannot occlude a wire', () => {
    expect(flowCardRect(null)).toBeNull();
    expect(flowCardRect(node(0, 0, 260, 140, { hidden: true }))).toBeNull();
    // Not measured yet: a zero-size rect would clip nothing but still cost work.
    expect(flowCardRect({ internals: { positionAbsolute: { x: 0, y: 0 } }, measured: {} })).toBeNull();
    expect(flowCardRect({ measured: { height: 10, width: 10 } })).toBeNull();
  });

  it('collects only the cards that are on screen', () => {
    const rects = collectFlowCardRects([
      node(0, 0, 260, 140),
      node(400, 0, 260, 140, { hidden: true }),
      node(800, 0, 260, 140),
    ]);

    expect(rects.map((rect) => rect.x)).toEqual([-1, 799]);
  });

  it('builds an even-odd clip that keeps everything except the card silhouettes', () => {
    const plane = buildCardOccluderClipPath([]);
    expect(plane).toBe('M -1000000 -1000000 H 1000000 V 1000000 H -1000000 Z');

    const withCard = buildCardOccluderClipPath([{ height: 100, width: 200, x: 10, y: 20 }]);
    expect(withCard.startsWith(plane)).toBe(true);
    expect(withCard).toContain('M 22 20');
  });

  it('clamps the corner radius on small cards', () => {
    expect(roundedRectPath({ height: 4, width: 4, x: 0, y: 0 })).toContain('A 2 2');
    expect(roundedRectPath({ height: 4, width: 4, x: 0, y: 0 }, 0)).toBe('M 0 0 H 4 V 4 H 0 Z');
  });

  it('derives a dom-safe clip id per edge', () => {
    expect(flowEdgeAttachedClipId('node:1->node/2')).toBe('sl-flow-edge-cards-node-1--node-2');
  });
});
