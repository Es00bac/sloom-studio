import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command, CornerDownLeft, Search } from 'lucide-react';
import {
  filterCommandPaletteEntries,
  type CommandPaletteEntry,
} from '../../lib/commandPalette';
import { getContextMenuPortalTarget } from '../../lib/sharedContextMenu';
import { useI18n } from '../../lib/useI18n';

interface CommandPaletteProps {
  entries: CommandPaletteEntry[];
  open: boolean;
  onClose: () => void;
  onRun: (entry: CommandPaletteEntry) => void;
}

export function CommandPalette({ entries, open, onClose, onRun }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(
    () => filterCommandPaletteEntries(entries, query),
    [entries, query],
  );
  const safeActiveIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) {
    return null;
  }

  const closePalette = () => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  };

  const runEntry = (entry: CommandPaletteEntry) => {
    if (entry.disabled) return;
    setQuery('');
    setActiveIndex(0);
    onRun(entry);
  };

  const dialog = (
    <div
      aria-label="Command palette"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/45 px-4 pt-24 backdrop-blur-sm"
      onClick={closePalette}
      role="dialog"
    >
      <div
        className="theme-popover flex max-h-[min(620px,calc(100vh-8rem))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-cyan-300/25 bg-[#08111d]/98 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closePalette();
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (
              results.length === 0 ? 0 : (current + 1) % results.length
            ));
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => (
              results.length === 0 ? 0 : (current - 1 + results.length) % results.length
            ));
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const entry = results[safeActiveIndex];
            if (entry) runEntry(entry);
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-cyan-300/15 px-4 py-3">
          <Command className="h-4 w-4 shrink-0 text-cyan-200/80" />
          <input
            ref={inputRef}
            aria-label={t('palette.search')}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-cyan-50 outline-none placeholder:text-cyan-100/35"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={t('palette.search')}
            value={query}
          />
          <Search className="h-4 w-4 shrink-0 text-cyan-100/35" />
        </div>

        <div className="flex-1 overflow-y-auto p-2" role="listbox">
          {results.map((entry, index) => {
            const active = index === safeActiveIndex;
            return (
              <button
                aria-selected={active}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'bg-cyan-300/15 text-white'
                    : 'text-cyan-50/80 hover:bg-cyan-300/10 hover:text-white'
                } ${entry.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
                disabled={entry.disabled}
                key={entry.id}
                onClick={() => runEntry(entry)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{entry.label}</span>
                    <span className="shrink-0 rounded border border-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-cyan-100/45">
                      {entry.group}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-cyan-100/45">
                    {entry.description}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-cyan-100/45">
                  {entry.shortcut ? (
                    <span className="rounded border border-cyan-300/15 bg-black/20 px-2 py-1 font-mono text-[11px]">
                      {entry.shortcut}
                    </span>
                  ) : null}
                  {active && !entry.disabled ? <CornerDownLeft size={14} /> : null}
                </span>
              </button>
            );
          })}
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-cyan-100/45">
              {t('palette.noResults')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const portalTarget = getContextMenuPortalTarget();
  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}
