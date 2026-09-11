import { useMemo, useState } from 'react';
import { Bookmark, Check, ChevronLeft, ChevronRight, LocateFixed, Pencil, Search, Trash2, X } from 'lucide-react';
import {
  filterNodeBookmarksForDisplay,
  resolveBookmarkSidebarPresentation,
} from '../../lib/bookmarkSidebarLayout';
import { collectNodeBookmarks, getNodeTypeLabel } from '../../lib/nodeBookmarks';
import { getNodeTheme } from '../../lib/nodeTheme';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { useFlowStore } from '../../store/flowStore';

interface FlowBookmarkSidebarProps {
  onCenterNode: (nodeId: string) => void;
  dockable?: boolean;
}

export function FlowBookmarkSidebar({ onCenterNode, dockable = false }: FlowBookmarkSidebarProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const renameNodeBookmark = useFlowStore((state) => state.renameNodeBookmark);
  const clearNodeBookmark = useFlowStore((state) => state.clearNodeBookmark);
  const collapsePanel = useDockablePanelStore((state) => state.collapsePanel);
  const bookmarks = collectNodeBookmarks(nodes);
  const [isOpen, setOpen] = useBookmarkSidebarState();
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [bookmarkSearchQuery, setBookmarkSearchQuery] = useState('');
  const visibleBookmarks = useMemo(
    () => filterNodeBookmarksForDisplay(bookmarks, bookmarkSearchQuery),
    [bookmarks, bookmarkSearchQuery],
  );

  const startEditing = (id: string, title: string) => {
    setEditingBookmarkId(id);
    setEditingTitle(title);
  };

  const saveEditing = () => {
    if (!editingBookmarkId) {
      return;
    }

    renameNodeBookmark(editingBookmarkId, editingTitle);
    setEditingBookmarkId(null);
    setEditingTitle('');
  };

  const cancelEditing = () => {
    setEditingBookmarkId(null);
    setEditingTitle('');
  };

  const sidebarPresentation = resolveBookmarkSidebarPresentation({ dockable, sidebarOpen: isOpen });
  const handleToggleSidebar = () => {
    if (sidebarPresentation.toggleAction === 'collapse-dock') {
      collapsePanel('flow', 'bookmarks');
      return;
    }
    setOpen(!isOpen);
  };
  const sidebarWidthClassName = sidebarPresentation.widthClassName;
  const sidebarPlacementClassName = dockable
    ? 'flex h-full rounded-none border-0 shadow-none backdrop-blur-0'
    : 'absolute bottom-24 right-4 top-20 z-20 flex rounded-2xl border border-gray-700/60 shadow-2xl backdrop-blur';

  return (
    <aside
      className={`${sidebarPlacementClassName} ${sidebarWidthClassName} overflow-hidden bg-[#10151f]/95 transition-[width] duration-200`}
    >
      {sidebarPresentation.contentOpen ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-gray-700/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fuchsia-200/80">
                  Node Bookmarks
                </div>
              </div>
              <div className="rounded-full border border-gray-700/60 bg-[#111217]/60 px-3 py-1 text-xs text-gray-300">
                {bookmarks.length}
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-md border border-gray-700/60 bg-[#0b1018] px-2.5 py-2 text-xs text-gray-300 focus-within:border-fuchsia-300/60">
              <Search size={14} className="shrink-0 text-fuchsia-200/70" />
              <input
                aria-label="Search node bookmarks"
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
                onChange={(event) => setBookmarkSearchQuery(event.target.value)}
                placeholder="Search bookmarks"
                value={bookmarkSearchQuery}
              />
              {bookmarkSearchQuery ? (
                <button
                  aria-label="Clear bookmark search"
                  className="rounded-md p-1 text-gray-500 transition-colors hover:text-white"
                  onClick={() => setBookmarkSearchQuery('')}
                  type="button"
                >
                  <X size={13} />
                </button>
              ) : null}
            </label>
            {bookmarkSearchQuery.trim() ? (
              <div className="mt-2 text-[11px] text-gray-500">
                Showing {visibleBookmarks.length} of {bookmarks.length}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {visibleBookmarks.length > 0 ? (
                visibleBookmarks.map((bookmark) => {
                  const theme = getNodeTheme(bookmark.type);
                  const isEditing = editingBookmarkId === bookmark.id;

                  return (
                    <div
                      className="rounded-xl border border-gray-700/60 bg-[#111217]/45 p-2 transition-colors hover:border-gray-500 hover:bg-[#171d27]"
                      data-flow-bookmark-node-id={bookmark.id}
                      key={bookmark.id}
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            autoFocus
                            className="w-full rounded-lg border border-fuchsia-300/35 bg-[#080d14] px-2.5 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-fuchsia-300/70"
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                saveEditing();
                              }

                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelEditing();
                              }
                            }}
                            value={editingTitle}
                          />
                          <div className="flex items-center justify-between gap-2">
                            <button
                              className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-300/35 bg-fuchsia-400/15 px-2.5 py-1.5 text-xs font-semibold text-fuchsia-50 transition-colors hover:border-fuchsia-200/70"
                              onClick={saveEditing}
                              type="button"
                            >
                              <Check size={13} />
                              Save
                            </button>
                            <div className="flex items-center gap-1.5">
                              <button
                                aria-label="Remove bookmark"
                                className="rounded-lg border border-gray-700/70 bg-[#111217]/50 p-1.5 text-gray-400 transition-colors hover:border-red-300/50 hover:text-red-100"
                                onClick={() => {
                                  clearNodeBookmark(bookmark.id);
                                  cancelEditing();
                                }}
                                type="button"
                              >
                                <Trash2 size={13} />
                              </button>
                              <button
                                aria-label="Cancel rename"
                                className="rounded-lg border border-gray-700/70 bg-[#111217]/50 p-1.5 text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
                                onClick={cancelEditing}
                                type="button"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <button
                            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-1 text-left transition-colors hover:bg-white/5"
                            onClick={() => onCenterNode(bookmark.id)}
                            type="button"
                          >
                            <span
                              className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10"
                              style={{ backgroundColor: `${theme.accentColor}22`, color: theme.accentColor }}
                            >
                              <LocateFixed size={15} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-gray-100">{bookmark.title}</span>
                              <span className="mt-1 block text-[11px] uppercase tracking-[0.16em] text-gray-500">
                                {getNodeTypeLabel(bookmark.type)}
                              </span>
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-1 pt-1">
                            <button
                              aria-label={`Rename ${bookmark.title}`}
                              className="rounded-lg border border-gray-700/70 bg-[#111217]/50 p-1.5 text-gray-400 transition-colors hover:border-fuchsia-300/50 hover:text-fuchsia-100"
                              onClick={() => startEditing(bookmark.id, bookmark.title)}
                              title="Rename bookmark"
                              type="button"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              aria-label={`Remove ${bookmark.title}`}
                              className="rounded-lg border border-gray-700/70 bg-[#111217]/50 p-1.5 text-gray-400 transition-colors hover:border-red-300/50 hover:text-red-100"
                              onClick={() => clearNodeBookmark(bookmark.id)}
                              title="Remove bookmark"
                              type="button"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-gray-700/60 bg-[#111217]/35 p-4 text-sm text-gray-400">
                  {bookmarks.length > 0
                    ? 'No bookmarks match that search.'
                    : 'No bookmarks yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <button
        aria-label={sidebarPresentation.contentOpen ? 'Collapse node bookmarks' : 'Open node bookmarks'}
        className="flex w-14 shrink-0 flex-col items-center gap-3 border-l border-gray-700/60 bg-[#0d1118] py-4 text-gray-300 transition-colors hover:text-white"
        onClick={handleToggleSidebar}
        title="Bookmarks appear when you give a node a custom name from its context menu."
        type="button"
      >
        <Bookmark size={18} />
        {sidebarPresentation.contentOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </aside>
  );
}

function useBookmarkSidebarState(): [boolean, (nextOpen: boolean) => void] {
  const isOpen = useFlowStore((state) => state.bookmarkSidebarOpen);
  const setOpen = useFlowStore((state) => state.setBookmarkSidebarOpen);

  return [isOpen, setOpen];
}
