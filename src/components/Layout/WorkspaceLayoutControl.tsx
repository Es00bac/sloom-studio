import { Check, LayoutTemplate, RotateCcw, Save, Trash2, X } from 'lucide-react';
import React from 'react';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import type { WorkspaceView } from '../../types/flow';

interface WorkspaceLayoutControlProps {
  workspaceView: WorkspaceView;
}

const WORKSPACE_IDS: Record<WorkspaceView, string> = {
  flow: 'flow',
  editor: 'video',
  image: 'image',
  paper: 'paper',
};

const WORKSPACE_LABELS: Record<WorkspaceView, string> = {
  flow: 'Flow',
  editor: 'Video',
  image: 'Image',
  paper: 'Paper',
};

export function WorkspaceLayoutControl({ workspaceView }: WorkspaceLayoutControlProps) {
  const workspaceId = WORKSPACE_IDS[workspaceView];
  const workspaceLabel = WORKSPACE_LABELS[workspaceView];
  const savedLayouts = useDockablePanelStore((state) => state.savedLayouts);
  const saveCurrentLayout = useDockablePanelStore((state) => state.saveCurrentLayout);
  const applySavedLayout = useDockablePanelStore((state) => state.applySavedLayout);
  const deleteSavedLayout = useDockablePanelStore((state) => state.deleteSavedLayout);
  const resetWorkspacePanels = useDockablePanelStore((state) => state.resetWorkspacePanels);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [appliedId, setAppliedId] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const workspaceLayouts = React.useMemo(
    () => savedLayouts.filter((layout) => layout.workspaceId === workspaceId),
    [savedLayouts, workspaceId],
  );

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  React.useEffect(() => {
    setOpen(false);
    setName('');
    setAppliedId(null);
  }, [workspaceId]);

  const save = () => {
    const id = saveCurrentLayout(workspaceId, name);
    setAppliedId(id);
    setName('');
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-2 rounded-full px-2.5 py-2 text-sm transition-colors ${
          open ? 'bg-cyan-400/15 text-white' : 'text-cyan-100/75 hover:bg-cyan-400/10 hover:text-white'
        }`}
        onClick={() => setOpen((value) => !value)}
        title={`Save or restore ${workspaceLabel} workspace layouts`}
        type="button"
      >
        <LayoutTemplate aria-hidden size={16} />
        <span className="hidden min-[2200px]:inline">Layout</span>
      </button>

      {open ? (
        <div
          aria-label={`${workspaceLabel} workspace layouts`}
          className="theme-popover absolute right-0 top-[calc(100%+0.55rem)] z-[220] w-80 rounded-xl border border-cyan-300/20 bg-[#0b1523]/98 p-3 text-cyan-50 shadow-2xl shadow-black/50 backdrop-blur-xl"
          role="dialog"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{workspaceLabel} layouts</h2>
              <p className="mt-0.5 text-[11px] text-cyan-100/45">
                Panel positions, sizes, docking, and visibility.
              </p>
            </div>
            <button
              aria-label="Close workspace layouts"
              className="rounded p-1 text-cyan-100/45 hover:bg-cyan-400/10 hover:text-white"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X aria-hidden size={15} />
            </button>
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <input
              aria-label="Layout name"
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-cyan-300/15 bg-black/20 px-2.5 py-2 text-sm outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/45"
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              placeholder={`My ${workspaceLabel} layout`}
              value={name}
            />
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-50 hover:bg-cyan-400/20"
              title="Save the current panel arrangement"
              type="submit"
            >
              <Save aria-hidden size={14} />
              Save
            </button>
          </form>

          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {workspaceLayouts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-cyan-300/15 px-3 py-4 text-center text-xs text-cyan-100/40">
                No saved layouts
              </div>
            ) : workspaceLayouts.map((layout) => (
              <div
                className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-cyan-300/10 hover:bg-cyan-400/5"
                key={layout.id}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-cyan-50/80 hover:text-white"
                  onClick={() => {
                    applySavedLayout(layout.id);
                    setAppliedId(layout.id);
                  }}
                  title={`Apply ${layout.name}`}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">{layout.name}</span>
                  {appliedId === layout.id ? <Check aria-label="Applied" size={14} className="text-emerald-300" /> : null}
                </button>
                <button
                  aria-label={`Delete ${layout.name}`}
                  className="rounded p-1 text-cyan-100/30 opacity-60 hover:bg-rose-400/10 hover:text-rose-200 group-hover:opacity-100"
                  onClick={() => {
                    deleteSavedLayout(layout.id);
                    if (appliedId === layout.id) setAppliedId(null);
                  }}
                  title={`Delete ${layout.name}`}
                  type="button"
                >
                  <Trash2 aria-hidden size={13} />
                </button>
              </div>
            ))}
          </div>

          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/15 px-3 py-2 text-xs font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:bg-cyan-400/5 hover:text-white"
            onClick={() => {
              resetWorkspacePanels(workspaceId);
              setAppliedId(null);
            }}
            title={`Restore the default ${workspaceLabel} panel arrangement`}
            type="button"
          >
            <RotateCcw aria-hidden size={13} />
            Restore default
          </button>
        </div>
      ) : null}
    </div>
  );
}
