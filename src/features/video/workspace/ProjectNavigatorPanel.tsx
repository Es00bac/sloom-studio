import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, FolderPlus, Pencil, Pin, Trash2, X } from 'lucide-react';
import {
  MAX_VIDEO_NAVIGATOR_SEQUENCES,
  validateVideoSequenceDelete,
  type VideoSequenceNavigatorModel,
  type VideoSequenceNavigatorSequence,
} from '../../../lib/videoSequenceNavigator';

export type ProjectNavigatorCommand =
  | { kind: 'activate-sequence'; sequenceId: string }
  | { kind: 'open-tab'; sequenceId: string }
  | { kind: 'close-tab'; sequenceId: string }
  | { kind: 'toggle-tab-pin'; sequenceId: string; pinned: boolean }
  | { kind: 'create-bin'; name: string }
  | { kind: 'toggle-bin'; binId: string; collapsed: boolean }
  | { kind: 'move-to-bin'; sequenceId: string; binId?: string }
  | { kind: 'duplicate-sequence'; sequenceId: string; suggestedName: string }
  | { kind: 'rename-sequence'; sequenceId: string; name: string }
  | { kind: 'delete-sequence'; sequenceId: string };

export interface ProjectNavigatorPanelProps {
  model: VideoSequenceNavigatorModel;
  onCommand: (command: ProjectNavigatorCommand) => void;
  className?: string;
}

const buttonClassName = 'rounded border border-gray-700 bg-[#111823] px-2 py-1 text-[11px] text-gray-200 hover:border-cyan-400/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40';
const inputClassName = 'min-w-0 flex-1 rounded border border-gray-700 bg-[#090e15] px-2 py-1 text-[11px] text-gray-100 outline-none focus:border-cyan-300/60';

export function ProjectNavigatorPanel({ model, onCommand, className = '' }: ProjectNavigatorPanelProps) {
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | undefined>(model.activeSequenceId ?? model.sequences[0]?.id);
  const [newBinName, setNewBinName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedSequence = model.sequences.find((sequence) => sequence.id === selectedSequenceId);
  const deletion = selectedSequence ? validateVideoSequenceDelete(model, selectedSequence.id) : undefined;
  const grouped = useMemo(() => {
    const byBin = new Map<string | undefined, VideoSequenceNavigatorSequence[]>();
    for (const sequence of model.sequences) {
      const values = byBin.get(sequence.binId) ?? [];
      values.push(sequence);
      byBin.set(sequence.binId, values);
    }
    for (const sequences of byBin.values()) sequences.sort((left, right) => left.name.localeCompare(right.name));
    return byBin;
  }, [model.sequences]);

  const chooseSequence = (sequenceId: string) => {
    setSelectedSequenceId(sequenceId);
    setConfirmDelete(false);
    setRenaming(false);
    onCommand({ kind: 'activate-sequence', sequenceId });
  };

  return (
    <section aria-label="Project navigator" className={`flex min-h-0 flex-col rounded-lg border border-gray-800 bg-[#0b111a] text-gray-100 ${className}`}>
      <header className="border-b border-gray-800 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-200">Project Navigator</h2>
            <p className="mt-0.5 text-[10px] text-gray-500">Sequences, bins, tabs, and saved views · metadata only</p>
          </div>
          <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">{model.sequences.length}/{MAX_VIDEO_NAVIGATOR_SEQUENCES}</span>
        </div>
      </header>

      <div aria-label="Open sequence tabs" role="tablist" className="flex gap-1 overflow-x-auto border-b border-gray-800 p-2">
        {model.tabs.length === 0 ? <span className="px-1 text-[10px] text-gray-500">No open sequences</span> : null}
        {model.tabs.map((tab) => {
          const sequence = model.sequences.find((candidate) => candidate.id === tab.sequenceId);
          if (!sequence) return null;
          const active = model.activeSequenceId === sequence.id;
          return (
            <div key={sequence.id} className={`flex shrink-0 items-center rounded border ${active ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-gray-700 bg-[#111823]'}`}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                onClick={() => chooseSequence(sequence.id)}
              >
                {sequence.name}
              </button>
              <button
                type="button"
                aria-label={`${tab.pinned ? 'Unpin' : 'Pin'} ${sequence.name}`}
                className="p-1 text-gray-400 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                onClick={() => onCommand({ kind: 'toggle-tab-pin', sequenceId: sequence.id, pinned: !tab.pinned })}
              >
                <Pin aria-hidden="true" className="h-3 w-3" fill={tab.pinned ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                aria-label={`Close ${sequence.name}`}
                disabled={tab.pinned}
                className="p-1 text-gray-400 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-30"
                onClick={() => onCommand({ kind: 'close-tab', sequenceId: sequence.id })}
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <form
        aria-label="Create sequence bin"
        className="flex gap-1 border-b border-gray-800 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newBinName.trim();
          if (!name) return;
          onCommand({ kind: 'create-bin', name });
          setNewBinName('');
        }}
      >
        <input className={inputClassName} aria-label="New bin name" value={newBinName} maxLength={160} onChange={(event) => setNewBinName(event.target.value)} placeholder="New sequence bin" />
        <button type="submit" className={buttonClassName} disabled={!newBinName.trim()}><FolderPlus aria-hidden="true" className="mr-1 inline h-3 w-3" />Add bin</button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <SequenceGroup
          label="Unfiled"
          sequences={grouped.get(undefined) ?? []}
          activeSequenceId={model.activeSequenceId}
          selectedSequenceId={selectedSequenceId}
          onChoose={chooseSequence}
          onOpen={(sequenceId) => onCommand({ kind: 'open-tab', sequenceId })}
        />
        {model.bins.map((bin) => (
          <div key={bin.id} className="mt-2">
            <button
              type="button"
              aria-expanded={!bin.collapsed}
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold text-gray-300 hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={() => onCommand({ kind: 'toggle-bin', binId: bin.id, collapsed: !bin.collapsed })}
            >
              {bin.collapsed ? <ChevronRight aria-hidden="true" className="h-3 w-3" /> : <ChevronDown aria-hidden="true" className="h-3 w-3" />}
              {bin.name} <span className="font-normal text-gray-500">({grouped.get(bin.id)?.length ?? 0})</span>
            </button>
            {!bin.collapsed ? (
              <SequenceGroup
                sequences={grouped.get(bin.id) ?? []}
                activeSequenceId={model.activeSequenceId}
                selectedSequenceId={selectedSequenceId}
                onChoose={chooseSequence}
                onOpen={(sequenceId) => onCommand({ kind: 'open-tab', sequenceId })}
              />
            ) : null}
          </div>
        ))}
      </div>

      <footer className="border-t border-gray-800 p-2">
        {!selectedSequence ? <p className="text-[10px] text-gray-500">Select a sequence to manage it.</p> : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold">{selectedSequence.name}</p>
                <p className="text-[10px] text-gray-500">{formatDuration(selectedSequence.durationMs)} · {selectedSequence.frameRate.toFixed(3).replace(/\.000$/u, '')} fps</p>
              </div>
              <select
                aria-label="Move selected sequence to bin"
                className="max-w-36 rounded border border-gray-700 bg-[#090e15] px-1 py-1 text-[10px]"
                value={selectedSequence.binId ?? ''}
                onChange={(event) => onCommand({ kind: 'move-to-bin', sequenceId: selectedSequence.id, binId: event.target.value || undefined })}
              >
                <option value="">Unfiled</option>
                {model.bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.name}</option>)}
              </select>
            </div>
            {renaming ? (
              <form className="flex gap-1" aria-label="Rename sequence" onSubmit={(event) => {
                event.preventDefault();
                const name = renameValue.trim();
                if (!name) return;
                onCommand({ kind: 'rename-sequence', sequenceId: selectedSequence.id, name });
                setRenaming(false);
              }}>
                <input autoFocus aria-label="Sequence name" className={inputClassName} value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} />
                <button type="submit" className={buttonClassName} disabled={!renameValue.trim()}>Save</button>
                <button type="button" className={buttonClassName} onClick={() => setRenaming(false)}>Cancel</button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1">
                <button type="button" className={buttonClassName} onClick={() => { setRenameValue(selectedSequence.name); setRenaming(true); }}><Pencil aria-hidden="true" className="mr-1 inline h-3 w-3" />Rename</button>
                <button type="button" className={buttonClassName} onClick={() => onCommand({ kind: 'duplicate-sequence', sequenceId: selectedSequence.id, suggestedName: `${selectedSequence.name} Copy` })}><Copy aria-hidden="true" className="mr-1 inline h-3 w-3" />Duplicate</button>
                <button type="button" className={buttonClassName} onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden="true" className="mr-1 inline h-3 w-3" />Delete…</button>
              </div>
            )}
            {confirmDelete && deletion ? (
              <div role="alert" className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-100">
                {deletion.canDelete ? (
                  <>
                    <p>Delete “{selectedSequence.name}”? Its media sources remain in the project library.</p>
                    <div className="mt-1 flex gap-1">
                      <button type="button" className={buttonClassName} onClick={() => { onCommand({ kind: 'delete-sequence', sequenceId: selectedSequence.id }); setConfirmDelete(false); }}>Confirm delete</button>
                      <button type="button" className={buttonClassName} onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>Deletion is blocked by {deletion.blockers.length} project dependenc{deletion.blockers.length === 1 ? 'y' : 'ies'}.</p>
                    <ul className="mt-1 list-disc pl-4">{deletion.blockers.slice(0, 5).map((blocker) => <li key={blocker.id}>{blocker.label}</li>)}</ul>
                    <button type="button" className={`${buttonClassName} mt-1`} onClick={() => setConfirmDelete(false)}>Close</button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
      </footer>
    </section>
  );
}

function SequenceGroup({
  label,
  sequences,
  activeSequenceId,
  selectedSequenceId,
  onChoose,
  onOpen,
}: {
  label?: string;
  sequences: readonly VideoSequenceNavigatorSequence[];
  activeSequenceId?: string;
  selectedSequenceId?: string;
  onChoose: (sequenceId: string) => void;
  onOpen: (sequenceId: string) => void;
}) {
  if (sequences.length === 0 && !label) return <p className="pl-5 text-[10px] text-gray-600">Empty bin</p>;
  return (
    <div role="list" aria-label={label ? `${label} sequences` : undefined}>
      {label ? <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p> : null}
      {sequences.map((sequence) => (
        <div key={sequence.id} role="listitem" className="flex items-center gap-1">
          <button
            type="button"
            aria-current={activeSequenceId === sequence.id ? 'page' : undefined}
            className={`min-w-0 flex-1 rounded px-2 py-1 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${selectedSequenceId === sequence.id ? 'bg-cyan-400/10 text-cyan-100' : 'text-gray-300 hover:bg-gray-800/60'}`}
            onClick={() => onChoose(sequence.id)}
          >
            <span className="block truncate">{sequence.name}</span>
          </button>
          <button type="button" className="rounded p-1 text-[10px] text-gray-500 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" aria-label={`Open ${sequence.name} in tab`} onClick={() => onOpen(sequence.id)}>Open</button>
        </div>
      ))}
    </div>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
