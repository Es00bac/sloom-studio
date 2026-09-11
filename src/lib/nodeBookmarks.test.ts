import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import {
  collectNodeBookmarks,
  getNodeTypeLabel,
  resolveNodeBookmarkRename,
  resolveNodeDisplayTitle,
} from './nodeBookmarks';

function createNode(id: string, type: AppNode['type'], customTitle?: string): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { customTitle },
  } as AppNode;
}

describe('node bookmarks', () => {
  it('uses the custom title when present and falls back to the default title otherwise', () => {
    expect(resolveNodeDisplayTitle('Image Generation', '  Hero image  ')).toBe('Hero image');
    expect(resolveNodeDisplayTitle('Image Generation', '')).toBe('Image Generation');
    expect(resolveNodeDisplayTitle('Image Generation', undefined)).toBe('Image Generation');
  });

  it('collects only renamed nodes into bookmark entries', () => {
    const bookmarks = collectNodeBookmarks([
      createNode('text-1', 'textNode', 'Scene prompt'),
      createNode('image-1', 'imageGen'),
      createNode('video-1', 'videoGen', 'Hero clip'),
    ]);

    expect(bookmarks).toEqual([
      { id: 'text-1', title: 'Scene prompt', type: 'textNode' },
      { id: 'video-1', title: 'Hero clip', type: 'videoGen' },
    ]);
  });

  it('normalizes node bookmark rename submissions into a store patch and sidebar intent', () => {
    expect(resolveNodeBookmarkRename('  Hero image  ')).toEqual({
      patch: { customTitle: 'Hero image' },
      shouldOpenBookmarkSidebar: true,
    });

    expect(resolveNodeBookmarkRename('   ')).toEqual({
      patch: { customTitle: undefined },
      shouldOpenBookmarkSidebar: false,
    });

    expect(resolveNodeBookmarkRename(null)).toBeUndefined();
  });

  it('uses concrete labels for primitive and consistency helper nodes', () => {
    expect(getNodeTypeLabel('numberNode')).toBe('Number');
    expect(getNodeTypeLabel('colorSwatchNode')).toBe('Color Palette');
  });
});
