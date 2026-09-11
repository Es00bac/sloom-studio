import { useEditorStore } from '../../../store/editorStore';
import { usePaperLiveLayoutAgentSession } from './paperLiveLayoutAgentSession';

/**
 * Global progress chip for the live layout agent. Rendered at the app root so a
 * person who switched to another workspace can still see (and pause/stop) the
 * agent editing their Paper document. Hidden whenever no session is active.
 */
export function LiveLayoutAgentStatusChip() {
  const status = usePaperLiveLayoutAgentSession((state) => state.status);
  const turn = usePaperLiveLayoutAgentSession((state) => state.turn);
  const appliedOperations = usePaperLiveLayoutAgentSession((state) => state.appliedOperations);
  const lastEntry = usePaperLiveLayoutAgentSession((state) => state.log[state.log.length - 1]);
  const pause = usePaperLiveLayoutAgentSession((state) => state.pause);
  const resume = usePaperLiveLayoutAgentSession((state) => state.resume);
  const cancel = usePaperLiveLayoutAgentSession((state) => state.cancel);

  if (status !== 'running' && status !== 'paused' && status !== 'blocked') return null;

  const openPaper = () => useEditorStore.getState().setWorkspaceView('paper');

  return (
    <div
      aria-live="polite"
      className="pointer-events-auto fixed bottom-4 right-4 z-[80] w-72 rounded-xl border border-cyan-300/25 bg-[#08111e]/95 p-3 shadow-2xl shadow-black/60 backdrop-blur"
      data-live-layout-agent-chip="true"
    >
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-2 text-left"
          onClick={openPaper}
          title="Open the Paper workspace"
          type="button"
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${status === 'running' ? 'animate-pulse bg-cyan-400' : status === 'paused' ? 'bg-amber-400' : 'bg-rose-400'}`}
          />
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/85">
            Layout agent {status === 'running' ? `· turn ${turn}` : status === 'paused' ? '· paused' : '· needs you'}
          </span>
        </button>
        <div className="flex gap-1">
          {status === 'running' ? (
            <button
              className="rounded border border-cyan-300/25 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100/75 hover:bg-cyan-300/10"
              onClick={pause}
              type="button"
            >
              Pause
            </button>
          ) : null}
          {status === 'paused' ? (
            <button
              className="rounded border border-cyan-300/25 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100/75 hover:bg-cyan-300/10"
              onClick={resume}
              type="button"
            >
              Resume
            </button>
          ) : null}
          <button
            className="rounded border border-rose-300/30 px-1.5 py-0.5 text-[10px] font-semibold text-rose-100/80 hover:bg-rose-300/10"
            onClick={cancel}
            type="button"
          >
            Stop
          </button>
        </div>
      </div>
      <div className="mt-1.5 truncate text-[10px] text-cyan-100/50" title={lastEntry?.text}>
        {appliedOperations} edits applied{lastEntry ? ` — ${lastEntry.text}` : ''}
      </div>
    </div>
  );
}
