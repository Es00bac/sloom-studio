import { create } from 'zustand';

/**
 * Tracks which named, independent dialogs are open in each workspace.
 *
 * This is the shared "library" behind the Adobe-style independent-dialog
 * pattern: a dialog is hidden by default, a menu command toggles it open, and
 * it renders as a non-modal floating panel (desktop/DeX) or full-screen sheet
 * (phone) via {@link DockableDialog}, with its own close-"x". Keeping the
 * open-state here (rather than as ad-hoc `useState` per workspace) lets menu
 * commands, keyboard shortcuts and the panels all agree on what is open, and
 * lets Image/Paper/Video reuse the exact same mechanism.
 */

/** Stable key for a dialog within a workspace. */
export function workspaceDialogKey(workspaceId: string, dialogId: string): string {
  return `${workspaceId}::${dialogId}`;
}

interface WorkspaceDialogState {
  /** Open dialogs keyed by {@link workspaceDialogKey}; absent/false means closed. */
  openDialogs: Record<string, boolean>;
  openDialog: (workspaceId: string, dialogId: string) => void;
  closeDialog: (workspaceId: string, dialogId: string) => void;
  toggleDialog: (workspaceId: string, dialogId: string) => void;
  /** Close every dialog belonging to a workspace (e.g. when it unmounts). */
  closeWorkspaceDialogs: (workspaceId: string) => void;
  isDialogOpen: (workspaceId: string, dialogId: string) => boolean;
}

export const useWorkspaceDialogStore = create<WorkspaceDialogState>()((set, get) => ({
  openDialogs: {},
  openDialog: (workspaceId, dialogId) => {
    const key = workspaceDialogKey(workspaceId, dialogId);
    if (get().openDialogs[key]) return;
    set((state) => ({ openDialogs: { ...state.openDialogs, [key]: true } }));
  },
  closeDialog: (workspaceId, dialogId) => {
    const key = workspaceDialogKey(workspaceId, dialogId);
    if (!get().openDialogs[key]) return;
    set((state) => {
      const next = { ...state.openDialogs };
      delete next[key];
      return { openDialogs: next };
    });
  },
  toggleDialog: (workspaceId, dialogId) => {
    const key = workspaceDialogKey(workspaceId, dialogId);
    set((state) => {
      const next = { ...state.openDialogs };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return { openDialogs: next };
    });
  },
  closeWorkspaceDialogs: (workspaceId) => {
    const prefix = `${workspaceId}::`;
    const current = get().openDialogs;
    if (!Object.keys(current).some((key) => key.startsWith(prefix))) return;
    set(() => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        if (!key.startsWith(prefix)) next[key] = value;
      }
      return { openDialogs: next };
    });
  },
  isDialogOpen: (workspaceId, dialogId) =>
    get().openDialogs[workspaceDialogKey(workspaceId, dialogId)] ?? false,
}));

/** Reactive selector hook: re-renders when this dialog's open-state changes. */
export function useIsWorkspaceDialogOpen(workspaceId: string, dialogId: string): boolean {
  return useWorkspaceDialogStore(
    (state) => state.openDialogs[workspaceDialogKey(workspaceId, dialogId)] ?? false,
  );
}
