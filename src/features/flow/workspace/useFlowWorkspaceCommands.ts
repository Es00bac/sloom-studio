import { useCallback, useMemo } from 'react';
import { useFlowWorkspaceStore } from '../../../store/flowWorkspaceStore';
import { useTextInputDialogStore } from '../../../store/textInputDialogStore';

export function useFlowWorkspaceCommands() {
  const workspaces = useFlowWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useFlowWorkspaceStore((state) => state.activeWorkspaceId);
  const createWorkspace = useFlowWorkspaceStore((state) => state.createWorkspace);
  const setActiveWorkspaceId = useFlowWorkspaceStore((state) => state.setActiveWorkspaceId);
  const workspaceOptions = useMemo(
    () => workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    [workspaces],
  );

  const handleCreateWorkspace = useCallback(async () => {
    const fallbackName = `Flow ${workspaceOptions.length + 1}`;
    const requestedName = await useTextInputDialogStore.getState().requestTextInput({
      title: 'New Flow workspace',
      message: 'Create a separate Flow canvas for a focused workstream.',
      label: 'Workspace name',
      initialValue: fallbackName,
      placeholder: fallbackName,
      confirmLabel: 'Create',
      cancelLabel: 'Cancel',
    });

    if (requestedName === null) {
      return;
    }

    createWorkspace(requestedName.trim() || fallbackName);
  }, [createWorkspace, workspaceOptions.length]);

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  }, [setActiveWorkspaceId]);

  return {
    activeWorkspaceId,
    handleCreateWorkspace,
    handleSelectWorkspace,
    workspaces: workspaceOptions,
  };
}
