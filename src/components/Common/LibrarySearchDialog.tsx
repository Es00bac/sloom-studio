import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getContextMenuPortalTarget, clampContextMenuPosition } from '../../lib/sharedContextMenu';
import { STANDARD_LIBRARY_FUNCTIONS, type StandardLibraryFunction } from '../../lib/standardLibrary';
import { Search } from 'lucide-react';

interface LibrarySearchDialogProps {
  x: number;
  y: number;
  onClose: () => void;
  onSelect: (template: StandardLibraryFunction) => void;
}

const DIALOG_WIDTH = 320;
const DIALOG_HEIGHT = 400;

export function LibrarySearchDialog({ x, y, onClose, onSelect }: LibrarySearchDialogProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const position = useMemo(() => {
    const viewport = {
      width: typeof window === 'undefined' ? 1024 : window.innerWidth,
      height: typeof window === 'undefined' ? 768 : window.innerHeight,
    };
    const size = {
      width: DIALOG_WIDTH,
      height: DIALOG_HEIGHT,
    };

    return clampContextMenuPosition({ x, y }, viewport, size);
  }, [x, y]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return STANDARD_LIBRARY_FUNCTIONS;
    return STANDARD_LIBRARY_FUNCTIONS.filter((func) =>
      func.name.toLowerCase().includes(q) ||
      func.description.toLowerCase().includes(q) ||
      func.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }, [query]);

  const dialog = (
    <div
      className="theme-popover fixed z-[80] overflow-hidden rounded-xl border border-gray-700/80 bg-[#10151f]/98 shadow-2xl backdrop-blur flex flex-col"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left: position.x, top: position.y, width: DIALOG_WIDTH, height: DIALOG_HEIGHT }}
    >
      <div className="flex items-center border-b border-gray-700/60 p-3">
        <Search className="mr-2 h-4 w-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
          placeholder="Search library..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && results.length > 0) {
              onSelect(results[0]);
              onClose();
            }
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {results.map((func) => (
          <button
            key={func.id}
            className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-blue-500/10"
            onClick={() => {
              onSelect(func);
              onClose();
            }}
          >
            <div className="text-sm font-semibold text-gray-100">{func.name}</div>
            <div className="mt-1 text-xs text-gray-400 line-clamp-2">{func.description}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {func.tags.map(tag => (
                <span key={tag} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
        {results.length === 0 && (
          <div className="p-4 text-center text-sm text-gray-500">No matching templates found.</div>
        )}
      </div>
    </div>
  );

  const portalTarget = getContextMenuPortalTarget();
  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}
