import type { NodeBookmark } from './nodeBookmarks';
import { getNodeTypeLabel } from './nodeBookmarks';

export interface BookmarkSidebarPresentationInput {
  dockable: boolean;
  sidebarOpen: boolean;
}

export interface BookmarkSidebarPresentation {
  contentOpen: boolean;
  widthClassName: 'w-full' | 'w-[22rem]' | 'w-14';
  toggleAction: 'collapse-dock' | 'toggle-sidebar';
}

export function resolveBookmarkSidebarPresentation(
  input: BookmarkSidebarPresentationInput,
): BookmarkSidebarPresentation {
  if (input.dockable) {
    return {
      contentOpen: true,
      widthClassName: 'w-full',
      toggleAction: 'collapse-dock',
    };
  }

  return {
    contentOpen: input.sidebarOpen,
    widthClassName: input.sidebarOpen ? 'w-[22rem]' : 'w-14',
    toggleAction: 'toggle-sidebar',
  };
}

export function filterNodeBookmarksForDisplay(
  bookmarks: readonly NodeBookmark[],
  query: string,
): NodeBookmark[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [...bookmarks];
  }

  return bookmarks.filter((bookmark) => (
    `${bookmark.title} ${getNodeTypeLabel(bookmark.type)}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}
