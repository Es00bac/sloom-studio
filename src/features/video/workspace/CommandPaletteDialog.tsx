import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  searchVideoCommands,
  type VideoCommandContext,
  type VideoCommandId,
  type VideoCommandRemaps,
} from '../../../lib/videoCommandRegistry';

export interface CommandPaletteDialogProps {
  open: boolean;
  context: VideoCommandContext;
  query: string;
  remaps?: VideoCommandRemaps;
  title?: string;
  onQueryChange: (query: string) => void;
  onInvoke: (commandId: VideoCommandId) => void;
  onClose: () => void;
}

export function CommandPaletteDialog({
  open,
  context,
  query,
  remaps,
  title = 'Video Command Palette',
  onQueryChange,
  onInvoke,
  onClose,
}: CommandPaletteDialogProps) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => searchVideoCommands(query, context, remaps, 100),
    [context, query, remaps],
  );

  useEffect(() => setActiveIndex(0), [context, open, query]);
  if (!open) return null;
  const invoke = (index: number) => {
    const command = results[index];
    if (!command) return;
    onInvoke(command.id as VideoCommandId);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(results.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      invoke(activeIndex);
    }
  };

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/65 px-4 pt-[12vh]"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
      role="dialog"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-gray-700 bg-[#0b1017] shadow-2xl">
        <header className="border-b border-gray-700/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <p className="mt-1 text-[10px] text-gray-500">Commands are filtered for the active {context.replace('-', ' ')} context.</p>
        </header>
        <div className="p-3">
          <input
            aria-activedescendant={results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-label="Search Video commands"
            autoFocus
            className="w-full rounded-lg border border-cyan-300/30 bg-[#070b10] px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-200"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command name"
            role="combobox"
            type="search"
            value={query}
          />
          <div className="mt-2 max-h-80 overflow-y-auto" id={listboxId} role="listbox" aria-label="Available Video commands">
            {results.map((entry, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${index === activeIndex ? 'bg-cyan-400/15 text-cyan-50' : 'text-gray-300 hover:bg-white/5'}`}
                id={`${listboxId}-${index}`}
                key={entry.id}
                onClick={() => invoke(index)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{entry.label}</span>
                  <span className="block truncate text-[10px] text-gray-500">{entry.description}</span>
                </span>
                {entry.chord ? <kbd className="rounded border border-gray-600 bg-black/30 px-1.5 py-0.5 text-[10px] text-gray-300">{entry.chord}</kbd> : null}
              </button>
            ))}
            {!results.length ? <p className="px-3 py-6 text-center text-xs text-gray-500" role="status">No commands match this search.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
