import { useEffect } from 'react';
import { AlertTriangle, Save, Trash2, X } from 'lucide-react';
import {
  resetPaperLossPrevention,
  usePaperLossPreventionStore,
} from '../../store/paperLossPreventionStore';

export function PaperLossPreventionDialog() {
  const request = usePaperLossPreventionStore((state) => state.activeRequest);
  const cancel = usePaperLossPreventionStore((state) => state.cancel);
  const discard = usePaperLossPreventionStore((state) => state.discard);
  const save = usePaperLossPreventionStore((state) => state.save);

  useEffect(() => () => resetPaperLossPrevention(), []);

  useEffect(() => {
    if (!request) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || request.saving) return;
      event.preventDefault();
      cancel(request.id);
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [cancel, request]);

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <section
        aria-describedby="paper-loss-message"
        aria-labelledby="paper-loss-title"
        aria-modal="true"
        className="theme-popover flex w-full max-w-lg flex-col gap-5 rounded-xl border border-amber-400/25 bg-[#13161f] p-6 shadow-2xl"
        role="alertdialog"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-100" id="paper-loss-title">{request.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-300" id="paper-loss-message">{request.message}</p>
            {request.documentTitles.length > 1 ? (
              <ul className="mt-3 max-h-28 list-disc overflow-y-auto pl-5 text-xs text-gray-400">
                {request.documentTitles.map((title) => <li key={title}>{title}</li>)}
              </ul>
            ) : null}
            {request.error ? (
              <p aria-live="assertive" className="mt-3 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="status">
                {request.error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-800/70 pt-4">
          <button
            autoFocus
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
            disabled={request.saving}
            onClick={() => cancel(request.id)}
            type="button"
          >
            <X aria-hidden="true" size={14} /> Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            disabled={request.saving}
            onClick={() => discard(request.id)}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} /> Discard
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-progress disabled:opacity-60"
            disabled={request.saving}
            onClick={() => void save(request.id)}
            type="button"
          >
            <Save aria-hidden="true" size={14} /> {request.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
