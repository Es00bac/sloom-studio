import React from 'react';
import { createPortal } from 'react-dom';
import { Menu } from 'lucide-react';
import type { AppMenuGroup } from '../../lib/appMenuModel';
import type { NativeMenuCommand } from '../../lib/nativeApp';

interface AppClassicMenuBarProps {
  groups: AppMenuGroup[];
  /** Dispatch a menu command through the existing app command bus. */
  onCommand: (command: NativeMenuCommand) => void;
  /** Collapse back to the single ☰ button presentation. */
  onSwitchToCompact: () => void;
}

const MIN_DROPDOWN_WIDTH = 224; // matches min-w-56

/**
 * A classic horizontal menu bar (File / Edit / View / …) rendered from the same shared
 * {@link AppMenuGroup} data as the compact ☰ menu and the native Electron menu. Each top-level label
 * opens only its own group's dropdown; once any menu is open, hovering a sibling label switches to it
 * (standard desktop menu-bar behavior). This is a pure renderer — it does no GPU work, so it sidesteps
 * the XWayland-vs-GPU conflict the KDE global menu runs into.
 */
export const AppClassicMenuBar: React.FC<AppClassicMenuBarProps> = ({
  groups,
  onCommand,
  onSwitchToCompact,
}) => {
  const [openGroupId, setOpenGroupId] = React.useState<string | null>(null);
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!openGroupId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (barRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpenGroupId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenGroupId(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openGroupId]);

  const openGroup = (groupId: string, button: HTMLButtonElement) => {
    setAnchorRect(button.getBoundingClientRect());
    setOpenGroupId(groupId);
  };

  const activeGroup = groups.find((group) => group.id === openGroupId) ?? null;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const dropdownLeft = anchorRect
    ? Math.max(8, Math.min(anchorRect.left, viewportWidth - MIN_DROPDOWN_WIDTH - 8))
    : 0;

  return (
    <div
      ref={barRef}
      className="theme-topbar relative z-[70] flex shrink-0 items-center gap-0.5 border-b px-2 py-0.5 shadow-[0_6px_18px_rgba(0,0,0,0.18)]"
      data-app-classic-menu-bar="true"
      role="menubar"
    >
      {groups.map((group) => {
        const isOpen = openGroupId === group.id;
        return (
          <button
            key={group.id}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            className={`rounded px-2.5 py-1 text-[13px] font-medium transition-colors ${
              isOpen
                ? 'bg-cyan-400/15 text-white'
                : 'text-cyan-100/75 hover:bg-cyan-400/10 hover:text-white'
            }`}
            data-menu-group={group.id}
            onClick={(event) => {
              if (isOpen) {
                setOpenGroupId(null);
              } else {
                openGroup(group.id, event.currentTarget);
              }
            }}
            onMouseEnter={(event) => {
              // Classic behavior: once a menu is open, hovering another label switches to it.
              if (openGroupId && !isOpen) openGroup(group.id, event.currentTarget);
            }}
            role="menuitem"
            type="button"
          >
            {group.label}
          </button>
        );
      })}

      <button
        aria-label="Switch to compact menu"
        className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-cyan-100/45 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
        data-app-menu-style-switch="compact"
        onClick={onSwitchToCompact}
        title="Switch to the compact ☰ menu"
        type="button"
      >
        <Menu size={14} />
      </button>

      {activeGroup && anchorRect
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[200] max-h-[72vh] min-w-56 overflow-y-auto rounded-md border border-cyan-300/20 bg-[#0d1725] py-1 shadow-2xl shadow-black/40"
              data-menu-group-dropdown={activeGroup.id}
              role="menu"
              style={{ top: anchorRect.bottom + 4, left: dropdownLeft }}
            >
              {activeGroup.items.length === 0 ? (
                <div className="px-3 py-1.5 text-sm text-cyan-100/35">No items</div>
              ) : (
                activeGroup.items.map((item) => (
                  <button
                    key={item.command}
                    className="flex w-full items-center justify-between gap-5 px-3 py-1.5 text-left text-sm text-cyan-50/80 transition-colors hover:bg-cyan-400/10 hover:text-white"
                    onClick={() => {
                      onCommand(item.command);
                      setOpenGroupId(null);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>{item.label}</span>
                    {item.shortcut ? (
                      <span className="text-xs text-cyan-100/35">{item.shortcut}</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
