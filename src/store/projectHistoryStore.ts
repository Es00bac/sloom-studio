import { create } from 'zustand';
import {
  PROJECT_HISTORY_RESTORE_STACK_LIMIT,
  sanitizeProjectHistorySection,
  type ProjectHistoryBranchProvenance,
  type ProjectHistorySection,
  type ProjectRevisionRecord,
} from '../lib/projectHistory';

/**
 * One restore hop: `beforeId` is the pre-restore revision captured when the restore ran,
 * `afterId` is the revision that was restored. Undo applies `beforeId`; redo re-applies `afterId`.
 */
export interface ProjectRestoreHop {
  beforeId: string;
  afterId: string;
  label: string;
}

export interface ProjectHistoryStateSnapshot {
  records: ProjectRevisionRecord[];
  branchedFrom: ProjectHistoryBranchProvenance | undefined;
  droppedRevisionNote: string | undefined;
}

interface ProjectHistoryState {
  records: ProjectRevisionRecord[];
  branchedFrom: ProjectHistoryBranchProvenance | undefined;
  /** Set when a loaded history section had corrupt or over-budget records removed. */
  droppedRevisionNote: string | undefined;
  restoreUndo: ProjectRestoreHop[];
  restoreRedo: ProjectRestoreHop[];
  /** Replace history from a project open/reset; clears session restore stacks. */
  hydrateFromSection: (section: ProjectHistorySection | undefined) => void;
  /** Adopt the exact section a successful save persisted; keeps session restore stacks. */
  adoptPersistedSection: (section: ProjectHistorySection | undefined) => void;
  /** Apply a local history edit (manual snapshot, rename, delete); keeps session restore stacks. */
  applySection: (section: ProjectHistorySection | undefined) => void;
  captureSnapshot: () => ProjectHistoryStateSnapshot;
  restoreSnapshot: (snapshot: ProjectHistoryStateSnapshot) => void;
  recordRestoreHop: (hop: ProjectRestoreHop) => void;
  /** Pop the newest undo hop onto the redo stack and return it. */
  shiftRestoreUndo: () => ProjectRestoreHop | undefined;
  /** Pop the newest redo hop back onto the undo stack and return it. */
  shiftRestoreRedo: () => ProjectRestoreHop | undefined;
  /** Drop hops whose revisions no longer exist (deleted while on a stack). */
  pruneRestoreHops: () => void;
}

function applySanitizedSection(
  set: (partial: Partial<ProjectHistoryState>) => void,
  section: ProjectHistorySection | undefined,
): void {
  const sanitized = sanitizeProjectHistorySection(section);
  set({
    records: sanitized.section?.revisions ?? [],
    branchedFrom: sanitized.section?.branchedFrom,
    droppedRevisionNote: sanitized.droppedCount > 0
      ? `${sanitized.droppedCount} corrupt or oversized revision${sanitized.droppedCount === 1 ? '' : 's'} were removed from this project's version history.`
      : undefined,
  });
}

export const useProjectHistoryStore = create<ProjectHistoryState>()((set, get) => ({
  records: [],
  branchedFrom: undefined,
  droppedRevisionNote: undefined,
  restoreUndo: [],
  restoreRedo: [],

  hydrateFromSection: (section) => {
    applySanitizedSection(set, section);
    set({ restoreUndo: [], restoreRedo: [] });
  },

  adoptPersistedSection: (section) => {
    applySanitizedSection(set, section);
  },

  applySection: (section) => {
    set({
      records: section?.revisions ?? [],
      branchedFrom: section?.branchedFrom,
    });
  },

  captureSnapshot: () => {
    const { records, branchedFrom, droppedRevisionNote } = get();
    return { records, branchedFrom, droppedRevisionNote };
  },

  restoreSnapshot: (snapshot) => {
    set({
      records: snapshot.records,
      branchedFrom: snapshot.branchedFrom,
      droppedRevisionNote: snapshot.droppedRevisionNote,
    });
  },

  recordRestoreHop: (hop) => {
    set((state) => ({
      restoreUndo: [...state.restoreUndo, hop].slice(-PROJECT_HISTORY_RESTORE_STACK_LIMIT),
      restoreRedo: [],
    }));
  },

  shiftRestoreUndo: () => {
    const state = get();
    const hop = state.restoreUndo[state.restoreUndo.length - 1];
    if (!hop) return undefined;
    set({
      restoreUndo: state.restoreUndo.slice(0, -1),
      restoreRedo: [...state.restoreRedo, hop].slice(-PROJECT_HISTORY_RESTORE_STACK_LIMIT),
    });
    return hop;
  },

  shiftRestoreRedo: () => {
    const state = get();
    const hop = state.restoreRedo[state.restoreRedo.length - 1];
    if (!hop) return undefined;
    set({
      restoreRedo: state.restoreRedo.slice(0, -1),
      restoreUndo: [...state.restoreUndo, hop].slice(-PROJECT_HISTORY_RESTORE_STACK_LIMIT),
    });
    return hop;
  },

  pruneRestoreHops: () => {
    const state = get();
    const ids = new Set(state.records.map((record) => record.id));
    const alive = (hops: ProjectRestoreHop[]) => hops.filter((hop) => ids.has(hop.beforeId) && ids.has(hop.afterId));
    const restoreUndo = alive(state.restoreUndo);
    const restoreRedo = alive(state.restoreRedo);
    if (restoreUndo.length === state.restoreUndo.length && restoreRedo.length === state.restoreRedo.length) return;
    set({ restoreUndo, restoreRedo });
  },
}));
