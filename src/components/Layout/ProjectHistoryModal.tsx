import { useMemo, useState } from 'react';
import { Camera, GitBranch, History, Pencil, RotateCcw, Trash2, Undo2, Redo2, X } from 'lucide-react';
import { useConfirmationStore } from '../../store/confirmationStore';
import {
  deleteProjectRevisionRecord,
  describeProjectRevisionChangeSummary,
  type ProjectRevisionRecord,
  renameProjectRevisionRecord,
  stageProjectManualSnapshot,
} from '../../lib/projectHistory';
import {
  buildProjectRevisionBranchDocument,
  buildProjectRevisionRestoreDocument,
} from '../../lib/projectHistoryRestore';import {
  buildCurrentProjectDocument as buildFullProjectDocument,
  buildDirtyImageReplacementConfirmationMessage,
  replaceProjectDocument,
  type DirtyImageReplacementAuthorization,
} from '../../lib/projectDocumentActions';
import { acknowledgePaperProjectSnapshot } from '../../lib/paperLossPrevention';
import { DEFAULT_PROJECT_NAME } from '../../lib/brand';
import {
  isRemoteLanClient,
  saveProjectDocument,
  type FlowProjectDocument,
} from '../../lib/projectLibrary';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { DockableDialog } from '../DockablePanel';
import { useProjectHistoryStore } from '../../store/projectHistoryStore';

interface ProjectHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// A served LAN browser has no durable project store here: the library save deliberately persists
// nothing, so a locally applied history edit would be a false success that disappears on reload.
// Every local history mutation is refused before any state change, with truthful feedback.
const SERVED_LAN_READ_ONLY_NOTE = 'This is a served read-only collaboration session. Revisions can be inspected, but '
  + 'snapshots, renames, deletes, restores, and branches are refused here. Manage this project\'s version history on '
  + 'the host device that owns it.';
const SERVED_LAN_SNAPSHOT_REFUSED_MESSAGE = 'This served collaboration session is read-only and cannot record a new '
  + 'snapshot here. Manage this project\'s version history on the host device that owns it.';
const SERVED_LAN_RENAME_REFUSED_MESSAGE = 'This served collaboration session is read-only and cannot rename revisions '
  + 'here. Manage this project\'s version history on the host device that owns it.';
const SERVED_LAN_DELETE_REFUSED_MESSAGE = 'This served collaboration session is read-only and cannot delete revisions '
  + 'here. Manage this project\'s version history on the host device that owns it.';

export function ProjectHistoryModal({ isOpen, onClose }: ProjectHistoryModalProps) {
  const records = useProjectHistoryStore((state) => state.records);
  const branchedFrom = useProjectHistoryStore((state) => state.branchedFrom);
  const droppedRevisionNote = useProjectHistoryStore((state) => state.droppedRevisionNote);
  const restoreUndo = useProjectHistoryStore((state) => state.restoreUndo);
  const restoreRedo = useProjectHistoryStore((state) => state.restoreRedo);
  const applySection = useProjectHistoryStore((state) => state.applySection);
  const recordRestoreHop = useProjectHistoryStore((state) => state.recordRestoreHop);
  const shiftRestoreUndo = useProjectHistoryStore((state) => state.shiftRestoreUndo);
  const shiftRestoreRedo = useProjectHistoryStore((state) => state.shiftRestoreRedo);
  const pruneRestoreHops = useProjectHistoryStore((state) => state.pruneRestoreHops);

  const [snapshotName, setSnapshotName] = useState('');
  const [busyRevisionId, setBusyRevisionId] = useState<string | undefined>();
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [expandedRevisionId, setExpandedRevisionId] = useState<string | undefined>();
  const [renamingRevisionId, setRenamingRevisionId] = useState<string | undefined>();
  const [renameValue, setRenameValue] = useState('');

  const newestFirst = useMemo(() => [...records].reverse(), [records]);
  const hasNativeBridge = Boolean(getSignalLoomNativeBridge());
  const servedLanReadOnly = isRemoteLanClient();

  if (!isOpen) {
    return null;
  }

  const authorizeDirtyImageReplacement: DirtyImageReplacementAuthorization = async (projection) => (
    useConfirmationStore.getState().requestConfirmation(
      buildDirtyImageReplacementConfirmationMessage(projection),
      'Discard Image Changes?',
    )
  );

  async function saveCurrentProjectBeforeReplacement() {
    try {
      if (isRemoteLanClient()) {
        return {
          status: 'unacknowledged' as const,
          error: 'This served collaboration session is read-only and cannot acknowledge a durable project save.',
        };
      }
      const document = await buildFullProjectDocument({
        name: `${DEFAULT_PROJECT_NAME} recovery`,
      });
      const saved = await saveProjectDocument(document);
      if (!acknowledgePaperProjectSnapshot(saved.paper ?? document.paper)) {
        return {
          status: 'failed' as const,
          error: 'Paper changed while the project was being saved. The newer changes remain open; save again before replacing the project.',
        };
      }
      return { status: 'success' as const };
    } catch (error) {
      return {
        status: 'failed' as const,
        error: error instanceof Error ? error.message : 'The current project could not be saved.',
      };
    }
  }

  async function replaceFromDocument(document: FlowProjectDocument, key: string): Promise<boolean> {
    return replaceProjectDocument(document, {
      key,
      save: saveCurrentProjectBeforeReplacement,
      authorizeDirtyImageReplacement,
    });
  }

  async function handleNewSnapshot() {
    setStatusMessage(undefined);
    if (servedLanReadOnly) {
      // Refuse before building or applying anything: the served browser cannot persist, so a local
      // record would be a false success.
      setStatusMessage(SERVED_LAN_SNAPSHOT_REFUSED_MESSAGE);
      return;
    }
    try {
      const document = await buildFullProjectDocument();
      const staged = stageProjectManualSnapshot(document, snapshotName);
      if (!hasNativeBridge) {
        // Browser/Android: persist the named snapshot immediately so it survives a reload even
        // before the next explicit save. Do not publish it to the visible store until this fallible
        // transaction succeeds, or a failed save would leave a snapshot that disappears on reload.
        const saved = await saveProjectDocument(staged.document);
        applySection(saved.projectHistory ?? staged.document.projectHistory);
      } else {
        // Desktop-native snapshots ride the next explicit staged-and-renamed project save.
        applySection(staged.document.projectHistory);
      }
      setSnapshotName('');
      setStatusMessage(
        hasNativeBridge
          ? `Snapshot "${staged.revision?.name}" recorded. It is stored in the project file on the next save.`
          : `Snapshot "${staged.revision?.name}" saved to the local project library.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to create the named snapshot.');
    }
  }

  function handleRenameStart(record: ProjectRevisionRecord) {
    if (servedLanReadOnly) {
      setStatusMessage(SERVED_LAN_RENAME_REFUSED_MESSAGE);
      return;
    }
    setRenamingRevisionId(record.id);
    setRenameValue(record.name);
    setStatusMessage(undefined);
  }

  async function handleRenameCommit(record: ProjectRevisionRecord) {
    if (isRemoteLanClient()) {
      // Re-check at commit time: the session may have become served after the rename form opened.
      setRenamingRevisionId(undefined);
      setStatusMessage(SERVED_LAN_RENAME_REFUSED_MESSAGE);
      return;
    }
    const renamed = renameProjectRevisionRecord(records, record.id, renameValue);
    setRenamingRevisionId(undefined);
    if (!renamed) return;
    applySection({
      version: 1,
      revisions: renamed,
      ...(branchedFrom ? { branchedFrom } : {}),
    });
    setStatusMessage('Revision renamed. The change is stored in the project file on the next save.');
  }

  async function handleDeleteRevision(record: ProjectRevisionRecord) {
    if (servedLanReadOnly) {
      // Refuse before even asking for destructive confirmation: nothing can be deleted here.
      setStatusMessage(SERVED_LAN_DELETE_REFUSED_MESSAGE);
      return;
    }
    const confirmed = await useConfirmationStore.getState().requestConfirmation(
      `Delete revision "${record.name}" from this project's version history? This does not change the current workspace.`,
      'Delete Revision',
    );
    if (!confirmed) return;
    if (isRemoteLanClient()) {
      // Confirmation is user-paced; the session may become served while the dialog is open.
      // Re-check immediately before mutation so this path cannot report an ephemeral false success.
      setStatusMessage(SERVED_LAN_DELETE_REFUSED_MESSAGE);
      return;
    }
    const next = deleteProjectRevisionRecord(records, record.id);
    if (!next) return;
    applySection({
      version: 1,
      revisions: next,
      ...(branchedFrom ? { branchedFrom } : {}),
    });
    pruneRestoreHops();
    setStatusMessage(`Deleted revision "${record.name}". The change is stored in the project file on the next save.`);
  }

  async function applyRevision(record: ProjectRevisionRecord, key: string): Promise<boolean> {
    const document = await buildFullProjectDocument();
    const restoreDocument = buildProjectRevisionRestoreDocument(document, record);
    return replaceFromDocument(restoreDocument, key);
  }

  async function handleRestore(record: ProjectRevisionRecord) {
    const confirmed = await useConfirmationStore.getState().requestConfirmation(
      `Restore the project to revision "${record.name}"? The current state is captured as a new snapshot first, so you can undo this restore.`,
      'Restore Revision',
    );
    if (!confirmed) return;
    setBusyRevisionId(record.id);
    setStatusMessage(undefined);
    try {
      const document = await buildFullProjectDocument();
      const staged = stageProjectManualSnapshot(document, `Before restoring "${record.name}"`);
      const restoreDocument = buildProjectRevisionRestoreDocument(staged.document, record);
      const replaced = await replaceFromDocument(restoreDocument, `history:restore:${record.id}`);
      if (!replaced) return;
      recordRestoreHop({
        beforeId: staged.revision?.id ?? '',
        afterId: record.id,
        label: `Restore of "${record.name}"`,
      });
      setStatusMessage(`Restored "${record.name}". Use Undo Restore to return to the previous state.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to restore the revision.');
    } finally {
      setBusyRevisionId(undefined);
    }
  }

  async function handleUndoRestore() {
    const hop = shiftRestoreUndo();
    if (!hop) return;
    const record = useProjectHistoryStore.getState().records.find((entry) => entry.id === hop.beforeId);
    if (!record) {
      pruneRestoreHops();
      setStatusMessage('The pre-restore snapshot is no longer available; undo was skipped.');
      return;
    }
    setBusyRevisionId(record.id);
    setStatusMessage(undefined);
    try {
      const replaced = await applyRevision(record, `history:undo-restore:${record.id}`);
      setStatusMessage(replaced ? 'Undid the restore.' : 'Undo restore was canceled.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to undo the restore.');
    } finally {
      setBusyRevisionId(undefined);
    }
  }

  async function handleRedoRestore() {
    const hop = shiftRestoreRedo();
    if (!hop) return;
    const record = useProjectHistoryStore.getState().records.find((entry) => entry.id === hop.afterId);
    if (!record) {
      pruneRestoreHops();
      setStatusMessage('That revision is no longer available; redo was skipped.');
      return;
    }
    setBusyRevisionId(record.id);
    setStatusMessage(undefined);
    try {
      const replaced = await applyRevision(record, `history:redo-restore:${record.id}`);
      setStatusMessage(replaced ? 'Redid the restore.' : 'Redo restore was canceled.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to redo the restore.');
    } finally {
      setBusyRevisionId(undefined);
    }
  }

  async function handleBranch(record: ProjectRevisionRecord) {
    const confirmed = await useConfirmationStore.getState().requestConfirmation(
      `Create a new project branched from revision "${record.name}"? The current project is left unchanged.`,
      'Branch From Revision',
    );
    if (!confirmed) return;
    setBusyRevisionId(record.id);
    setStatusMessage(undefined);
    try {
      const document = await buildFullProjectDocument();
      const branchDocument = buildProjectRevisionBranchDocument(document, record);
      const replaced = await replaceFromDocument(branchDocument, `history:branch:${record.id}`);
      if (!replaced) return;
      if (!hasNativeBridge) {
        // Browser/Android: also persist the branch into the local library under its fresh id.
        await saveProjectDocument(branchDocument);
      }
      setStatusMessage(
        hasNativeBridge
          ? `Branched "${branchDocument.name}" from "${record.name}". Use Save As to choose a new project file.`
          : `Branched "${branchDocument.name}" from "${record.name}" into the local project library.`,
      );
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to branch from the revision.');
    } finally {
      setBusyRevisionId(undefined);
    }
  }

  return (
    <DockableDialog
      defaultFloatingRect={{ x: 120, y: 90, width: 900, height: 620 }}
      dialogId="project-history"
      minSize={{ width: 520, height: 360 }}
      onClose={onClose}
      open={isOpen}
      title="Project History"
      workspaceId="app-dialogs"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#1c1e26]">
        <div className="flex items-center justify-between border-b border-gray-800 bg-[#252830] p-5">
          <div>
            <h2 className="text-xl font-semibold text-gray-100">Project History</h2>
            <p className="mt-1 text-sm text-gray-400">
              Every successful save records a revision automatically. Name snapshots for milestones, then inspect,
              restore, branch, or delete them.
            </p>
          </div>
          <button
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-[#1f222b] px-5 py-3">
          <input
            aria-label="New snapshot name"
            className="min-w-48 flex-1 rounded-xl border border-gray-700/60 bg-[#111217]/70 px-3 py-2 text-sm text-gray-100 outline-none"
            onChange={(event) => setSnapshotName(event.target.value)}
            placeholder="Snapshot name (optional)"
            value={snapshotName}
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleNewSnapshot()}
            type="button"
          >
            <Camera size={14} />
            New Snapshot
          </button>
          <div className="mx-1 h-6 w-px bg-gray-700/60" />
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={restoreUndo.length === 0}
            onClick={() => void handleUndoRestore()}
            type="button"
          >
            <Undo2 size={14} />
            Undo Restore
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={restoreRedo.length === 0}
            onClick={() => void handleRedoRestore()}
            type="button"
          >
            <Redo2 size={14} />
            Redo Restore
          </button>
        </div>

        {servedLanReadOnly ? (
          <div
            className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-100"
            role="note"
          >
            {SERVED_LAN_READ_ONLY_NOTE}
          </div>
        ) : null}
        {droppedRevisionNote ? (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-100">
            {droppedRevisionNote}
          </div>
        ) : null}
        {branchedFrom ? (
          <div className="border-b border-emerald-500/20 bg-emerald-500/5 px-5 py-2 text-xs text-emerald-100">
            This project is a branch of “{branchedFrom.projectName}” revision “{branchedFrom.revisionName}”.
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-3">
            {newestFirst.length > 0 ? (
              newestFirst.map((record) => {
                const isBusy = busyRevisionId === record.id;
                const isRenaming = renamingRevisionId === record.id;
                const isExpanded = expandedRevisionId === record.id;
                return (
                  <div
                    className={`rounded-xl border p-4 ${
                      record.kind === 'manual'
                        ? 'border-cyan-400/25 bg-cyan-500/5'
                        : 'border-gray-700/60 bg-[#111217]/35'
                    }`}
                    key={record.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {isRenaming ? (
                        <form
                          className="flex flex-1 items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleRenameCommit(record);
                          }}
                        >
                          <input
                            autoFocus
                            aria-label={`Rename ${record.name}`}
                            className="flex-1 rounded-lg border border-gray-700/60 bg-[#0d1118] px-2.5 py-1.5 text-sm text-gray-100 outline-none"
                            onChange={(event) => setRenameValue(event.target.value)}
                            value={renameValue}
                          />
                          <button
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                            type="submit"
                          >
                            Save Name
                          </button>
                          <button
                            className="rounded-lg border border-gray-700/60 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:text-white"
                            onClick={() => setRenamingRevisionId(undefined)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-gray-100">{record.name}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                record.kind === 'manual' ? 'bg-cyan-500/15 text-cyan-200' : 'bg-gray-600/30 text-gray-300'
                              }`}
                            >
                              {record.kind === 'manual' ? 'Snapshot' : 'Auto save'}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {new Date(record.createdAt).toLocaleString()}
                            {record.renamedAt ? ' · renamed' : ''}
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                          onClick={() => setExpandedRevisionId(isExpanded ? undefined : record.id)}
                          type="button"
                        >
                          <History size={12} className="mr-1 inline" />
                          {isExpanded ? 'Hide Changes' : 'Inspect'}
                        </button>
                        <button
                          className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                          disabled={isRenaming}
                          onClick={() => handleRenameStart(record)}
                          type="button"
                        >
                          <Pencil size={12} className="mr-1 inline" />
                          Rename
                        </button>
                        <button
                          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 transition-colors hover:border-blue-400/60 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isBusy}
                          onClick={() => void handleRestore(record)}
                          type="button"
                        >
                          <RotateCcw size={12} className="mr-1 inline" />
                          Restore
                        </button>
                        <button
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isBusy}
                          onClick={() => void handleBranch(record)}
                          type="button"
                        >
                          <GitBranch size={12} className="mr-1 inline" />
                          Branch
                        </button>
                        <button
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/15"
                          disabled={isBusy}
                          onClick={() => void handleDeleteRevision(record)}
                          type="button"
                        >
                          <Trash2 size={12} className="mr-1 inline" />
                          Delete
                        </button>
                      </div>
                    </div>
                    {isExpanded ? (
                      <div className="mt-3 rounded-lg border border-gray-700/60 bg-[#0d1118]/70 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Changes since the previous revision
                        </div>
                        <ul className="mt-1 space-y-0.5 text-xs text-gray-300">
                          {describeProjectRevisionChangeSummary(record.summary).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700/60 bg-[#111217]/35 p-4 text-sm text-gray-400">
                No revisions yet. Saving the project records the first revision automatically.
              </div>
            )}
          </div>
        </div>

        {statusMessage ? (
          <div
            className={`border-t px-5 py-3 text-sm ${
              statusMessage.includes('Failed') || statusMessage.includes('cannot')
                ? 'border-red-500/20 bg-red-500/10 text-red-100'
                : 'border-blue-500/20 bg-blue-500/10 text-blue-100'
            }`}
            role="status"
          >
            {statusMessage}
          </div>
        ) : null}
      </div>
    </DockableDialog>
  );
}
