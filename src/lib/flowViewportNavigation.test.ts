import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import {
  buildNodeCenterViewportRequest,
  shouldJumpToBookmarkFromConnectorDrag,
} from './flowViewportNavigation';

function node(partial: Partial<AppNode> & Pick<AppNode, 'id'>): AppNode {
  return {
    id: partial.id,
    type: partial.type ?? 'imageGen',
    position: partial.position ?? { x: 100, y: 200 },
    data: partial.data ?? {},
    width: partial.width,
    height: partial.height,
    measured: partial.measured,
  } as AppNode;
}

describe('flow viewport navigation', () => {
  it('keeps the current zoom when centering portal exits or bookmarks', () => {
    expect(buildNodeCenterViewportRequest(node({
      id: 'target',
      position: { x: 40, y: 80 },
      measured: { width: 300, height: 120 },
    }), 1.75, 350)).toEqual({
      x: 190,
      y: 140,
      options: { duration: 350, zoom: 1.75 },
    });
  });

  it('only jumps to a bookmark while an active connector drag is over a new bookmark card', () => {
    expect(shouldJumpToBookmarkFromConnectorDrag({
      active: true,
      bookmarkNodeId: 'node-2',
      lastBookmarkNodeId: 'node-1',
    })).toBe(true);
    expect(shouldJumpToBookmarkFromConnectorDrag({
      active: true,
      bookmarkNodeId: 'node-2',
      lastBookmarkNodeId: 'node-2',
    })).toBe(false);
    expect(shouldJumpToBookmarkFromConnectorDrag({
      active: false,
      bookmarkNodeId: 'node-2',
      lastBookmarkNodeId: undefined,
    })).toBe(false);
  });
});
