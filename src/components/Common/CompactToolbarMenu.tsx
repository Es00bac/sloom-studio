import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface CompactToolbarMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  shortcut?: string;
}

interface CompactToolbarMenuProps {
  ariaLabel?: string;
  compact?: boolean;
  icon: ReactNode;
  items: CompactToolbarMenuItem[];
  label: string;
  placement?: 'below' | 'right';
}

const MENU_WIDTH_PX = 248;

/**
 * A small, viewport-safe disclosure menu for dense workspace toolbars.
 * It deliberately renders into a portal so docked panels and clipped titlebars cannot hide it.
 */
export function CompactToolbarMenu({
  ariaLabel,
  compact = false,
  icon,
  items,
  label,
  placement = 'below',
}: CompactToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const updatePosition = () => setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition, { passive: true });
    window.addEventListener('scroll', updatePosition, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !anchorRect) return;
    queueMicrotask(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)')
        ?.focus();
    });
  }, [anchorRect, open]);

  const viewportWidth = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const maxMenuHeight = Math.min(viewportHeight * 0.7, 512);
  const belowLeft = anchorRect
    ? Math.max(8, Math.min(anchorRect.left, viewportWidth - MENU_WIDTH_PX - 8))
    : 8;
  const rightLeft = anchorRect
    ? anchorRect.right + 6 + MENU_WIDTH_PX <= viewportWidth - 8
      ? anchorRect.right + 6
      : Math.max(8, anchorRect.left - MENU_WIDTH_PX - 6)
    : 8;
  const left = placement === 'right' ? rightLeft : belowLeft;
  const top = anchorRect
    ? placement === 'right'
      ? Math.max(8, Math.min(anchorRect.top, viewportHeight - maxMenuHeight - 8))
      : Math.max(8, Math.min(anchorRect.bottom + 6, viewportHeight - maxMenuHeight - 8))
    : 8;

  return (
    <>
      <button
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel ?? label}
        className={`inline-flex h-8 shrink-0 items-center justify-center border text-[11px] font-semibold transition-colors ${
          compact ? 'w-8 rounded-none px-0' : 'gap-1.5 rounded-md px-2'
        } ${
          open
            ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
            : 'border-cyan-300/15 bg-[#101a29]/70 text-cyan-100/75 hover:border-cyan-300/40 hover:text-white'
        }`}
        data-compact-toolbar-menu={label}
        onClick={() => {
          setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
          setOpen((current) => !current);
        }}
        title={label}
        type="button"
      >
        {icon}
        {!compact ? <span className="hidden min-[1280px]:inline">{label}</span> : null}
        {!compact ? <ChevronDown aria-hidden="true" size={11} /> : null}
      </button>
      {open && anchorRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              aria-label={ariaLabel ?? label}
              className="fixed z-[9999] max-h-[min(70vh,32rem)] w-[248px] overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#0b1320]/98 p-1.5 text-white shadow-2xl shadow-black/50 backdrop-blur-xl"
              data-compact-toolbar-menu-popup={label}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
                )];
                if (options.length === 0) return;
                event.preventDefault();
                const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : event.key === 'ArrowUp'
                      ? (currentIndex <= 0 ? options.length - 1 : currentIndex - 1)
                      : (currentIndex + 1) % options.length;
                options[nextIndex]?.focus();
              }}
              role="menu"
              style={{ left, top }}
            >
              {items.map((item) => (
                <div className={item.separatorBefore ? 'mt-1.5 border-t border-cyan-300/10 pt-1.5' : undefined} key={item.id}>
                  <button
                    aria-checked={item.active}
                    aria-disabled={item.disabled}
                    className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                      item.disabled
                        ? 'cursor-not-allowed text-cyan-100/25'
                        : 'text-cyan-50/80 hover:bg-cyan-400/12 hover:text-white'
                    }`}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect();
                      setOpen(false);
                      buttonRef.current?.focus();
                    }}
                    role={item.active === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    type="button"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-cyan-300">
                      {item.active ? <Check aria-hidden="true" size={13} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {item.shortcut ? <span className="text-[10px] text-cyan-100/35">{item.shortcut}</span> : null}
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
