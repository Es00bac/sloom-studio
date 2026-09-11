import { afterEach, describe, expect, it } from 'vitest';
import {
  useWorkspaceDialogStore,
  workspaceDialogKey,
} from './workspaceDialogStore';

afterEach(() => {
  useWorkspaceDialogStore.setState({ openDialogs: {} });
});

describe('workspaceDialogStore', () => {
  it('namespaces dialogs by workspace so the same dialog id is independent per workspace', () => {
    expect(workspaceDialogKey('image', 'adjustments')).toBe('image::adjustments');
    expect(workspaceDialogKey('paper', 'adjustments')).not.toBe(
      workspaceDialogKey('image', 'adjustments'),
    );
  });

  it('opens, reports, and closes a dialog', () => {
    const store = useWorkspaceDialogStore.getState();
    expect(store.isDialogOpen('image', 'adjustments')).toBe(false);

    store.openDialog('image', 'adjustments');
    expect(useWorkspaceDialogStore.getState().isDialogOpen('image', 'adjustments')).toBe(true);

    useWorkspaceDialogStore.getState().closeDialog('image', 'adjustments');
    expect(useWorkspaceDialogStore.getState().isDialogOpen('image', 'adjustments')).toBe(false);
  });

  it('toggles a dialog open and closed', () => {
    const { toggleDialog } = useWorkspaceDialogStore.getState();
    toggleDialog('image', 'curves');
    expect(useWorkspaceDialogStore.getState().isDialogOpen('image', 'curves')).toBe(true);
    useWorkspaceDialogStore.getState().toggleDialog('image', 'curves');
    expect(useWorkspaceDialogStore.getState().isDialogOpen('image', 'curves')).toBe(false);
  });

  it('keeps one workspace\'s dialogs independent from another\'s', () => {
    const store = useWorkspaceDialogStore.getState();
    store.openDialog('image', 'adjustments');
    store.openDialog('paper', 'adjustments');
    expect(useWorkspaceDialogStore.getState().isDialogOpen('image', 'adjustments')).toBe(true);
    expect(useWorkspaceDialogStore.getState().isDialogOpen('paper', 'adjustments')).toBe(true);

    useWorkspaceDialogStore.getState().closeDialog('image', 'adjustments');
    expect(useWorkspaceDialogStore.getState().isDialogOpen('image', 'adjustments')).toBe(false);
    expect(useWorkspaceDialogStore.getState().isDialogOpen('paper', 'adjustments')).toBe(true);
  });

  it('closes only the targeted workspace\'s dialogs with closeWorkspaceDialogs', () => {
    const store = useWorkspaceDialogStore.getState();
    store.openDialog('image', 'adjustments');
    store.openDialog('image', 'channels');
    store.openDialog('paper', 'adjustments');

    useWorkspaceDialogStore.getState().closeWorkspaceDialogs('image');
    const state = useWorkspaceDialogStore.getState();
    expect(state.isDialogOpen('image', 'adjustments')).toBe(false);
    expect(state.isDialogOpen('image', 'channels')).toBe(false);
    expect(state.isDialogOpen('paper', 'adjustments')).toBe(true);
  });

  it('is idempotent: opening an open dialog or closing a closed one does not churn state', () => {
    const store = useWorkspaceDialogStore.getState();
    store.openDialog('image', 'adjustments');
    const snapshot = useWorkspaceDialogStore.getState().openDialogs;
    useWorkspaceDialogStore.getState().openDialog('image', 'adjustments');
    expect(useWorkspaceDialogStore.getState().openDialogs).toBe(snapshot);

    useWorkspaceDialogStore.setState({ openDialogs: {} });
    const empty = useWorkspaceDialogStore.getState().openDialogs;
    useWorkspaceDialogStore.getState().closeDialog('image', 'nope');
    expect(useWorkspaceDialogStore.getState().openDialogs).toBe(empty);
  });
});
