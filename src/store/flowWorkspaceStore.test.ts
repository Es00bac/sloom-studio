import { afterEach, describe, expect, it } from 'vitest';
import { useFlowWorkspaceStore } from './flowWorkspaceStore';

afterEach(() => {
  useFlowWorkspaceStore.getState().reset();
});

describe('flowWorkspaceStore', () => {
  it('creates, renames, duplicates, and deletes serialized Flow workspaces', () => {
    const store = useFlowWorkspaceStore.getState();
    const createdId = store.createWorkspace('Issue 1');

    store.renameWorkspace(createdId, 'Issue 1A');
    const duplicateId = store.duplicateWorkspace(createdId);
    store.deleteWorkspace(duplicateId);

    expect(store.getWorkspace(createdId)?.name).toBe('Issue 1A');
    expect(store.getWorkspace(duplicateId)).toBeUndefined();
    expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe(createdId);
  });

  it('hydrates saved workspaces and exports the active runtime snapshot separately from inactive snapshots', () => {
    const store = useFlowWorkspaceStore.getState();

    store.hydrateProjectSnapshot({
      activeWorkspaceId: 'alt',
      workspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: 1,
          updatedAt: 2,
          flow: {
            version: 3,
            nodes: [{ id: 'main-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
            edges: [],
          },
        },
        {
          id: 'alt',
          name: 'Alt Flow',
          createdAt: 3,
          updatedAt: 4,
          flow: {
            version: 3,
            nodes: [{ id: 'stale-alt-node', type: 'textNode', position: { x: 3, y: 4 }, data: {} }],
            edges: [],
          },
        },
      ],
    });

    const exported = store.exportProjectSnapshot({
      version: 3,
      nodes: [{ id: 'runtime-alt-node', type: 'textNode', position: { x: 5, y: 6 }, data: {} }],
      edges: [],
    });

    expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe('alt');
    expect(exported?.find((workspace) => workspace.id === 'main')?.flow.nodes.map((node) => node.id)).toEqual(['main-node']);
    expect(exported?.find((workspace) => workspace.id === 'alt')?.flow.nodes.map((node) => node.id)).toEqual(['runtime-alt-node']);
  });

  it('serializes the hydrated runtime before loading the next selected workspace snapshot', () => {
    const store = useFlowWorkspaceStore.getState();

    store.hydrateProjectSnapshot({
      activeWorkspaceId: 'main',
      workspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: 1,
          updatedAt: 2,
          flow: {
            version: 3,
            nodes: [{ id: 'stale-main-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
            edges: [],
          },
        },
        {
          id: 'alt',
          name: 'Alt Flow',
          createdAt: 3,
          updatedAt: 4,
          flow: {
            version: 3,
            nodes: [{ id: 'alt-node', type: 'textNode', position: { x: 5, y: 6 }, data: {} }],
            edges: [],
          },
        },
      ],
    });
    store.setActiveWorkspaceId('alt');

    const nextSnapshot = store.consumePendingWorkspaceSwitch({
      version: 3,
      nodes: [{ id: 'runtime-main-node', type: 'textNode', position: { x: 7, y: 8 }, data: {} }],
      edges: [],
    });

    expect(nextSnapshot?.nodes.map((node) => node.id)).toEqual(['alt-node']);
    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe('alt');
    expect(useFlowWorkspaceStore.getState().getWorkspace('main')?.flow.nodes.map((node) => node.id)).toEqual(['runtime-main-node']);
  });

  it('keeps a deleted last workspace as the canvas owner until its fresh replacement is consumed', () => {
    const store = useFlowWorkspaceStore.getState();
    store.hydrateProjectSnapshot({
      activeWorkspaceId: 'only',
      workspaces: [{
        id: 'only',
        name: 'Only',
        createdAt: 1,
        updatedAt: 1,
        flow: {
          version: 3,
          nodes: [{ id: 'stored-only', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        },
      }],
    });

    store.deleteWorkspace('only');
    const afterDelete = useFlowWorkspaceStore.getState();
    const replacementId = afterDelete.activeWorkspaceId;
    expect(replacementId).not.toBe('only');
    expect(afterDelete.hydratedWorkspaceId).toBe('only');
    expect(afterDelete.exportProjectSnapshot({
      version: 3,
      nodes: [{ id: 'runtime-deleted', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })[0]?.flow.nodes).toEqual([]);

    const replacement = afterDelete.consumePendingWorkspaceSwitch({
      version: 3,
      nodes: [{ id: 'runtime-deleted', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    expect(replacement?.nodes).toEqual([]);
    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe(replacementId);
  });
});
