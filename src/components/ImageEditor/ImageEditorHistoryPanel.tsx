import { Circle, History, Play, Redo2, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useDockExpandToContent } from '../DockablePanel/dockExpandContext';
import type { ImageDocument } from '../../types/imageEditor';
import {
  addImageDocumentSnapshot,
  applyImageDocumentSelectionState,
  captureImageDocumentSelectionState,
  createImageDocumentSnapshot,
  deleteImageDocumentSnapshot,
  disposeImageDocumentSnapshotsRemoved,
  renameImageDocumentSnapshot,
  restoreImageDocumentSnapshot,
} from './ImageSnapshots';
import { SnapshotsControls } from './ImageEditorLayersPanelControls';
import { buildImageHistoryStateEntries } from './ImageEditorHistory';
import { ImageBatchFolderRunnerPanel } from './ImageBatchFolderRunnerPanel';
import {
  buildImageQuickActionMacroPlaybackDiagnostics,
  getImageQuickActionLabel,
  playImageQuickActionMacro,
  playImageQuickActionMacroAcrossOpenDocuments,
} from './ImageQuickActionMacros';
import { jumpToHistoryUndoCount, redo, undo } from './undoRedoApply';

const EMPTY_HISTORY_STACK = Object.freeze([]) as ReadonlyArray<never>;

export function ImageEditorHistoryPanel() {
  const expandToContent = useDockExpandToContent();
  const doc = useImageEditorStore((state) => state.documents.find((candidate) => candidate.id === state.activeDocId) ?? null);
  const pushOperation = useImageEditorStore((state) => state.pushOperation);
  const clearHistory = useImageEditorStore((state) => state.clearHistory);
  const undoStacks = useImageEditorStore((state) => state.undoStacks);
  const redoStacks = useImageEditorStore((state) => state.redoStacks);
  const quickActionMacros = useImageEditorStore((state) => state.quickActionMacros);
  const activeQuickActionRecording = useImageEditorStore((state) => state.activeQuickActionRecording);
  const startQuickActionRecording = useImageEditorStore((state) => state.startQuickActionRecording);
  const saveQuickActionRecording = useImageEditorStore((state) => state.saveQuickActionRecording);
  const cancelQuickActionRecording = useImageEditorStore((state) => state.cancelQuickActionRecording);
  const renameQuickActionMacro = useImageEditorStore((state) => state.renameQuickActionMacro);
  const deleteQuickActionMacro = useImageEditorStore((state) => state.deleteQuickActionMacro);
  const undoStack = doc ? undoStacks[doc.id] ?? EMPTY_HISTORY_STACK : EMPTY_HISTORY_STACK;
  const redoStack = doc ? redoStacks[doc.id] ?? EMPTY_HISTORY_STACK : EMPTY_HISTORY_STACK;
  const [renamingMacroId, setRenamingMacroId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [batchSummary, setBatchSummary] = useState<string | null>(null);

  const entries = useMemo(
    () => buildImageHistoryStateEntries(undoStack, redoStack),
    [redoStack, undoStack],
  );

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center bg-[#1a1b23] p-3 text-xs text-cyan-100/40">
        No document open
      </div>
    );
  }

  const currentUndoCount = undoStack.length;

  const commitDocumentState = (nextDoc: ImageDocument, beforeDoc = captureImageDocumentSelectionState(doc)) => {
    const retainedAfter = captureImageDocumentSelectionState(nextDoc);
    pushOperation({
      kind: 'documentState',
      docId: doc.id,
      before: beforeDoc,
      after: retainedAfter,
    });
    disposeImageDocumentSnapshotsRemoved(doc, nextDoc);
    const liveNext = applyImageDocumentSelectionState(retainedAfter);
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((candidate) => (candidate.id === doc.id ? liveNext : candidate)),
    }));
  };

  return (
    <div className={`flex min-h-0 flex-col bg-[#1a1b23] ${expandToContent ? '' : 'h-full'}`}>
      <div className="border-b border-cyan-300/10 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/65">
            <History size={12} />
            <span>History</span>
          </div>
          <div className="text-[10px] text-cyan-100/35">
            {undoStack.length + redoStack.length} state{undoStack.length + redoStack.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          <button
            aria-label="Undo last history state"
            className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            disabled={undoStack.length === 0}
            onClick={() => undo(doc.id)}
            type="button"
          >
            <span className="inline-flex items-center gap-1">
              <RotateCcw size={11} />
              Undo
            </span>
          </button>
          <button
            aria-label="Redo next history state"
            className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            disabled={redoStack.length === 0}
            onClick={() => redo(doc.id)}
            type="button"
          >
            <span className="inline-flex items-center gap-1">
              <Redo2 size={11} />
              Redo
            </span>
          </button>
          <button
            aria-label="Clear history stacks"
            className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-rose-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            disabled={undoStack.length === 0 && redoStack.length === 0}
            onClick={() => clearHistory(doc.id)}
            type="button"
          >
            <span className="inline-flex items-center gap-1">
              <Trash2 size={11} />
              Clear
            </span>
          </button>
        </div>
      </div>

      <div className={`min-h-0 flex-1 p-2 ${expandToContent ? '' : 'overflow-y-auto'}`}>
        <div className="space-y-1">
          {entries.map((entry) => {
            const active = entry.targetUndoCount === currentUndoCount;
            const future = entry.status === 'future';
            const className = active
              ? 'border-cyan-300/35 bg-cyan-400/15 text-cyan-50'
              : future
                ? 'border-cyan-300/10 bg-[#10131b] text-cyan-100/35 hover:border-cyan-300/20 hover:text-cyan-100/70'
                : 'border-cyan-300/10 bg-[#10131b] text-cyan-100/55 hover:border-cyan-300/25 hover:text-white';

            return active ? (
              <div
                className={`rounded border px-2 py-1.5 text-[11px] ${className}`}
                data-image-history-state={entry.status}
                key={entry.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{entry.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/50">Current State</span>
                </div>
              </div>
            ) : (
              <button
                aria-label={`Restore history state ${entry.label}`}
                className={`block w-full rounded border px-2 py-1.5 text-left text-[11px] ${className}`}
                data-image-history-state={entry.status}
                key={entry.id}
                onClick={() => jumpToHistoryUndoCount(doc.id, entry.targetUndoCount)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{entry.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">
                    {future ? 'Future' : 'History'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <SnapshotsControls
          doc={doc}
          onDelete={(snapshotId) => commitDocumentState(deleteImageDocumentSnapshot(doc, snapshotId, { deferDisposal: true }))}
          onNew={(name) => commitDocumentState(addImageDocumentSnapshot(
            doc,
            createImageDocumentSnapshot(doc, name),
            { deferDisposal: true },
          ))}
          onRename={(snapshotId, name) => {
            const nextDoc = renameImageDocumentSnapshot(doc, snapshotId, name);
            if (nextDoc !== doc) commitDocumentState(nextDoc);
          }}
          onRestore={(snapshotId) => {
            const beforeDoc = captureImageDocumentSelectionState(doc);
            commitDocumentState(restoreImageDocumentSnapshot(doc, snapshotId), beforeDoc);
          }}
        />

        <div className="mt-3 border-t border-cyan-300/10 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/65">
              Actions
            </div>
            <div className="text-[10px] text-cyan-100/35">
              {quickActionMacros.length} saved
            </div>
          </div>

          {activeQuickActionRecording ? (
            <div className="mt-2 rounded border border-cyan-400/20 bg-cyan-400/10 p-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-50">
                <Circle size={10} className="fill-current text-cyan-300" />
                Recording
              </div>
              <div className="mt-1 text-[10px] text-cyan-100/55">
                {activeQuickActionRecording.steps.length} step{activeQuickActionRecording.steps.length === 1 ? '' : 's'}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  aria-label="Save recorded quick action set"
                  className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={activeQuickActionRecording.steps.length === 0}
                  onClick={() => saveQuickActionRecording()}
                  type="button"
                >
                  <span className="inline-flex items-center gap-1">
                    <Save size={11} />
                    Save
                  </span>
                </button>
                <button
                  aria-label="Cancel recorded quick action set"
                  className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-rose-300/30 hover:text-white"
                  onClick={() => cancelQuickActionRecording()}
                  type="button"
                >
                  <span className="inline-flex items-center gap-1">
                    <X size={11} />
                    Cancel
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <button
              aria-label="Start recording quick action set"
              className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-cyan-300/30 hover:text-white"
              onClick={() => startQuickActionRecording()}
              type="button"
            >
              Record Action
            </button>
          )}

          <div className="mt-2 space-y-1">
            {quickActionMacros.length === 0 ? (
              <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/35">
                No saved actions
              </div>
            ) : (
              quickActionMacros.map((macro) => (
                <div
                  className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5"
                  key={macro.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-cyan-50">{macro.name}</div>
                      <div className="truncate text-[10px] text-cyan-100/40">
                        {macro.steps.map((step) => getImageQuickActionLabel(step.actionId)).join(' • ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        aria-label={`Play quick action set ${macro.name}`}
                        className="rounded border border-cyan-300/10 bg-[#141824] px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:text-white"
                        onClick={() => {
                          playImageQuickActionMacro(macro.id);
                          setBatchSummary(null);
                        }}
                        type="button"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Play size={10} />
                          Play
                        </span>
                      </button>
                      <button
                        aria-label={`Play quick action set ${macro.name} on all open image documents`}
                        className="rounded border border-cyan-300/10 bg-[#141824] px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:text-white"
                        onClick={() => {
                          const diagnostics = buildImageQuickActionMacroPlaybackDiagnostics({
                            macro,
                            documents: useImageEditorStore.getState().documents,
                            activeDocId: useImageEditorStore.getState().activeDocId,
                          });
                          const result = playImageQuickActionMacroAcrossOpenDocuments(macro.id);
                          setBatchSummary(
                            result
                              ? `Applied to ${result.successCount} of ${result.requestedCount} open images. This button targets only open documents; use Folder batch below for explicit local-folder output. Use ${diagnostics.automationBoundary.requiredWorkspace === 'image-automation' ? 'Image Automation, not Flow' : 'the automation workspace'}.`
                              : null,
                          );
                        }}
                        type="button"
                      >
                        Batch
                      </button>
                      <button
                        aria-label={`Rename quick action set ${macro.name}`}
                        className="rounded border border-cyan-300/10 bg-[#141824] px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:text-white"
                        onClick={() => {
                          setRenamingMacroId(macro.id);
                          setRenameDraft(macro.name);
                          setBatchSummary(null);
                        }}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`Delete quick action set ${macro.name}`}
                        className="rounded border border-cyan-300/10 bg-[#141824] px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-rose-300/30 hover:text-white"
                        onClick={() => {
                          deleteQuickActionMacro(macro.id);
                          setBatchSummary(null);
                        }}
                        type="button"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Trash2 size={10} />
                          Delete
                        </span>
                      </button>
                    </div>
                  </div>
                  {renamingMacroId === macro.id ? (
                    <div className="mt-2 flex items-center gap-1">
                      <input
                        aria-label="Quick action set name"
                        className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#0f1420] px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-300/30"
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onInput={(event) => setRenameDraft((event.target as HTMLInputElement).value)}
                        type="text"
                        value={renameDraft}
                      />
                      <button
                        aria-label="Save quick action set name"
                        className="rounded border border-cyan-300/10 bg-[#141824] px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:text-white"
                        onClick={() => {
                          renameQuickActionMacro(macro.id, renameDraft);
                          setRenamingMacroId(null);
                        }}
                        type="button"
                      >
                        Save
                      </button>
                      <button
                        aria-label="Cancel quick action set rename"
                        className="rounded border border-cyan-300/10 bg-[#141824] px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-rose-300/30 hover:text-white"
                        onClick={() => {
                          setRenamingMacroId(null);
                          setRenameDraft('');
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          {batchSummary ? (
            <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/55">
              {batchSummary}
            </div>
          ) : null}
          <ImageBatchFolderRunnerPanel />
        </div>
      </div>
    </div>
  );
}
