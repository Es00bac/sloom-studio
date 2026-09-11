import { describe, expect, it } from 'vitest';

import {
  filterNodeBookmarksForDisplay,
  resolveBookmarkSidebarPresentation,
} from './bookmarkSidebarLayout';

describe('bookmark sidebar layout', () => {
  it('collapses the dockable Bookmarks panel through dock layout chrome', () => {
    expect(resolveBookmarkSidebarPresentation({ dockable: true, sidebarOpen: false })).toEqual({
      contentOpen: true,
      widthClassName: 'w-full',
      toggleAction: 'collapse-dock',
    });
  });

  it('uses internal width toggling only for the legacy overlay sidebar', () => {
    expect(resolveBookmarkSidebarPresentation({ dockable: false, sidebarOpen: true })).toEqual({
      contentOpen: true,
      widthClassName: 'w-[22rem]',
      toggleAction: 'toggle-sidebar',
    });
    expect(resolveBookmarkSidebarPresentation({ dockable: false, sidebarOpen: false })).toEqual({
      contentOpen: false,
      widthClassName: 'w-14',
      toggleAction: 'toggle-sidebar',
    });
  });

  it('filters bookmark search by renamed title and node type', () => {
    const bookmarks = [
      { id: 'image-1', title: 'Cover cleanup', type: 'imageGen' as const },
      { id: 'video-1', title: 'Final render', type: 'videoGen' as const },
      { id: 'text-1', title: 'Caption prompt', type: 'textNode' as const },
    ];

    expect(filterNodeBookmarksForDisplay(bookmarks, 'cover').map((bookmark) => bookmark.id)).toEqual(['image-1']);
    expect(filterNodeBookmarksForDisplay(bookmarks, 'video').map((bookmark) => bookmark.id)).toEqual(['video-1']);
    expect(filterNodeBookmarksForDisplay(bookmarks, '  ').map((bookmark) => bookmark.id)).toEqual([
      'image-1',
      'video-1',
      'text-1',
    ]);
  });
});
