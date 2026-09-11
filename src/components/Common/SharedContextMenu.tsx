import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  estimateContextMenuHeight,
  getContextMenuMaxHeight,
  getContextMenuMaxWidth,
  getContextMenuPortalTarget,
  normalizeContextMenuItems,
  resolveContextMenuLayout,
  type SharedContextMenuItem,
  type ContextMenuSize,
} from '../../lib/sharedContextMenu';

interface SharedContextMenuProps {
  ariaLabel?: string;
  title?: string;
  x: number;
  y: number;
  items: SharedContextMenuItem[];
  onClose?: () => void;
}

const MENU_WIDTH = 256;
const MENU_ITEM_HEIGHT = 36;
const MENU_HEADER_HEIGHT = 34;

export function SharedContextMenu({
  ariaLabel = 'Context menu',
  title = 'Actions',
  x,
  y,
  items,
  onClose,
}: SharedContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [measuredSize, setMeasuredSize] = useState<ContextMenuSize>();
  const visibleItems = useMemo(() => normalizeContextMenuItems(items), [items]);
  const viewport = useMemo(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }), []);
  const maxHeight = useMemo(() => getContextMenuMaxHeight(viewport), [viewport]);
  const menuWidth = useMemo(() => Math.min(MENU_WIDTH, getContextMenuMaxWidth(viewport)), [viewport]);
  const estimatedHeight = useMemo(
    () =>
      estimateContextMenuHeight(visibleItems, {
        headerHeight: MENU_HEADER_HEIGHT,
        itemHeight: MENU_ITEM_HEIGHT,
        maxHeight,
        paddingY: 16,
      }),
    [maxHeight, visibleItems],
  );
  const layout = useMemo(
    () =>
      resolveContextMenuLayout({
        point: { x, y },
        viewport,
        menuWidth,
        estimatedHeight,
        maxHeight,
        headerHeight: MENU_HEADER_HEIGHT,
        measuredSize,
      }),
    [estimatedHeight, maxHeight, measuredSize, menuWidth, viewport, x, y],
  );

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) {
      return;
    }

    const { height, width } = node.getBoundingClientRect();
    const nextSize = {
      width: Math.ceil(width),
      height: Math.ceil(height),
    };

    setMeasuredSize((current) => {
      if (current && current.width === nextSize.width && current.height === nextSize.height) {
        return current;
      }

      return nextSize;
    });
  }, [estimatedHeight, visibleItems]);

  if (visibleItems.length === 0) {
    return null;
  }

  const menu = (
    <div
      aria-label={ariaLabel}
      className="theme-popover fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-gray-700/80 bg-[#10151f]/98 shadow-2xl backdrop-blur"
      ref={menuRef}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      style={{
        left: layout.position.x,
        maxHeight: layout.maxHeight,
        top: layout.position.y,
        width: layout.menuSize.width,
      }}
    >
      <div className="theme-header shrink-0 border-b border-gray-700/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
        {title}
      </div>
      <div className="min-h-0 overflow-y-auto p-2" style={{ maxHeight: layout.contentMaxHeight, overflowY: 'auto' }}>
        {visibleItems.map((item) => (
          <ContextMenuItem item={item} key={item.id} onClose={onClose} />
        ))}
      </div>
    </div>
  );
  const portalTarget = getContextMenuPortalTarget();

  return portalTarget ? createPortal(menu, portalTarget) : menu;
}

function ContextMenuItem({
  item,
  onClose,
}: {
  item: SharedContextMenuItem;
  onClose?: () => void;
}) {
  if (item.children && item.children.length > 0) {
    return (
      <details className="group" data-context-submenu="true" open>
        <summary className="flex cursor-pointer list-none items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-cyan-100 transition-colors hover:bg-blue-500/10 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="ml-3 text-[10px] uppercase tracking-[0.16em] text-cyan-100/45">{item.children.length}</span>
        </summary>
        <div className="mb-1 ml-3 border-l border-cyan-300/10 pl-2">
          {item.children.map((child) => (
            <ContextMenuItem item={child} key={child.id} onClose={onClose} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <button
      aria-disabled={item.disabled}
      className={`theme-button flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        item.disabled
          ? 'cursor-not-allowed text-gray-500'
          : item.tone === 'danger'
            ? 'theme-danger text-red-100 hover:bg-red-500/15'
            : 'text-gray-100 hover:bg-blue-500/10'
      }`}
      disabled={item.disabled}
      onClick={() => {
        item.action?.();
        onClose?.();
      }}
      role="menuitem"
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut ? (
        <span className="theme-muted-text ml-5 shrink-0 text-xs text-gray-400">{item.shortcut}</span>
      ) : null}
    </button>
  );
}
