import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, Save, Trash2, X } from 'lucide-react';
import type { ImageDocumentCloseDecision } from './ImageDocumentClose';

export interface ImageDocumentCloseDialogProps {
  documentTitle: string;
  busy: boolean;
  onDecision: (decision: ImageDocumentCloseDecision) => void;
}

export function ImageDocumentCloseDialog({
  documentTitle,
  busy,
  onDecision,
}: ImageDocumentCloseDialogProps) {
  const titleId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      event.stopPropagation();
      onDecision('cancel');
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [busy, onDecision]);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
    >
      <div className="theme-popover w-full max-w-md rounded-xl border border-amber-500/25 bg-[#13161f] p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-gray-100" id={titleId}>
              Save changes to “{documentTitle}”?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-300">
              Save keeps the editable layered document. Discard permanently removes it and its undo history.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-gray-800/60 pt-4">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => onDecision('cancel')}
            ref={cancelButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            disabled={busy}
            onClick={() => onDecision('discard')}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            Discard
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-50"
            disabled={busy}
            onClick={() => onDecision('save')}
            type="button"
          >
            <Save aria-hidden="true" size={14} />
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
