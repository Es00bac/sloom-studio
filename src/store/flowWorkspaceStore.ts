import { create } from 'zustand';
import {
  buildDefaultFlowWorkspace,
  DEFAULT_FLOW_WORKSPACE_NAME,
  findActiveFlowWorkspace,
  type FlowProjectFlowSnapshot,
  type FlowWorkspaceProjectSnapshot,
} from '../lib/flowProjectWorkspaces';
import type { NodeData } from '../types/flow';

export interface FlowRunOwner {
  workspaceId: string;
  workspaceName?: string;
  nodeId: string;
  nodeInstanceId?: string;
  inputRevision?: string;
  runId: string;
}

type FlowRunNodeOwner = Pick<FlowRunOwner, 'nodeId' | 'nodeInstanceId' | 'inputRevision'>;

type ActiveFlowRun = {
  owner: FlowRunOwner;
  nodeOwners: Map<string, FlowRunNodeOwner>;
  abort?: () => void;
};

export interface FlowWorkspaceStoreState {
  activeWorkspaceId: string;
  hydratedWorkspaceId: string;
  workspaces: FlowWorkspaceProjectSnapshot[];
  createWorkspace: (name?: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  duplicateWorkspace: (id: string) => string;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspaceId: (id: string) => void;
  upsertHydratedSnapshot: (snapshot: FlowProjectFlowSnapshot) => void;
  consumePendingWorkspaceSwitch: (hydratedSnapshot: FlowProjectFlowSnapshot) => FlowProjectFlowSnapshot | undefined;
  hydrateProjectSnapshot: (input: {
    workspaces: FlowWorkspaceProjectSnapshot[];
    activeWorkspaceId?: string;
  }) => void;
  exportProjectSnapshot: (activeSnapshot: FlowProjectFlowSnapshot) => FlowWorkspaceProjectSnapshot[];
  getWorkspace: (id: string) => FlowWorkspaceProjectSnapshot | undefined;
  reset: () => void;
  /** Register a Flow run so commits can be validated by runId. */
  registerFlowRun: (owner: FlowRunOwner, options?: { abort?: () => void }) => void;
  /** Add a dependency to the immutable run graph before it can publish runtime state. */
  registerFlowRunNode: (owner: FlowRunOwner, node: FlowRunNodeOwner) => void;
  /** Unregister a Flow run. Only the current runId for the node may remove itself. */
  unregisterFlowRun: (owner: FlowRunOwner) => void;
  /** Get the active runId for a node in a workspace, if any. */
  getActiveFlowRunId: (workspaceId: string, nodeId: string) => string | undefined;
  /** Cancel and invalidate the complete run graph that contains this node. */
  invalidateFlowRunForNode: (workspaceId: string, nodeId: string) => string[];
  /**
   * Check whether the owner is still allowed to commit to the target node.
   * Returns `true` when the workspace/node exist and the instance identity and
   * input revision (for the root node) have not changed.
   */
  isFlowRunOwnerValid: (
    owner: FlowRunOwner,
    nodeId: string,
    options?: {
      getHydratedNodeData?: (nodeId: string) => NodeData | undefined;
    },
  ) => boolean;
  /**
   * Commit a node-data patch to the workspace/run that owns it.
   * Returns `true` when the patch was applied, `false` when the run is stale
   * (workspace/node deleted, node instance changed, input revision changed,
   * or a newer run superseded this one).
   */
  commitFlowRunPatch: (
    owner: FlowRunOwner,
    nodeId: string,
    patch: Partial<NodeData>,
    options?: {
      getHydratedNodeData?: (nodeId: string) => NodeData | undefined;
      applyToHydratedCanvas?: (nodeId: string, patch: Partial<NodeData>) => void;
    },
  ) => boolean;
}

function makeWorkspaceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `flow-workspace-${Date.now()}`;
}

const activeFlowRuns = new Map<string, ActiveFlowRun>();
let workspaceSnapshotGeneration = 0;

/**
 * A project-level replacement can recycle the default workspace id while a
 * provider request is in flight. Flow's hydrated canvas is deliberately kept
 * alive until its replacement arrives, so owner checks also need this epoch to
 * distinguish the old canvas from the newly-created workspace.
 */
export function getFlowWorkspaceSnapshotGeneration(): number {
  return workspaceSnapshotGeneration;
}

function flowRunKey(workspaceId: string, nodeId: string): string {
  return `${workspaceId}:${nodeId}`;
}

function invalidateActiveFlowRun(run: ActiveFlowRun): void {
  for (const [key, candidate] of activeFlowRuns) {
    if (candidate === run) {
      activeFlowRuns.delete(key);
    }
  }
  run.abort?.();
}

function removeActiveFlowRun(run: ActiveFlowRun): void {
  for (const [key, candidate] of activeFlowRuns) {
    if (candidate === run) {
      activeFlowRuns.delete(key);
    }
  }
}

function invalidateFlowRunsForWorkspace(workspaceId: string): void {
  const runs = new Set<ActiveFlowRun>();
  for (const [key, run] of activeFlowRuns) {
    if (key.startsWith(`${workspaceId}:`)) {
      runs.add(run);
    }
  }
  for (const run of runs) {
    invalidateActiveFlowRun(run);
  }
}

function cloneFlowSnapshot<T>(snapshot: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(snapshot);
  }

  return JSON.parse(JSON.stringify(snapshot)) as T;
}

function createBlankFlowSnapshot(): FlowProjectFlowSnapshot {
  return {
    version: 3,
    nodes: [],
    edges: [],
  };
}

function createWorkspaceRecord(name = 'Untitled Flow'): FlowWorkspaceProjectSnapshot {
  const now = Date.now();
  return {
    id: makeWorkspaceId(),
    name: name.trim() || 'Untitled Flow',
    createdAt: now,
    updatedAt: now,
    flow: createBlankFlowSnapshot(),
  };
}

function createInitialState(): Pick<FlowWorkspaceStoreState, 'activeWorkspaceId' | 'hydratedWorkspaceId' | 'workspaces'> {
  const mainWorkspace = buildDefaultFlowWorkspace(createBlankFlowSnapshot());
  return {
    activeWorkspaceId: mainWorkspace.id,
    hydratedWorkspaceId: mainWorkspace.id,
    workspaces: [mainWorkspace],
  };
}

function resolveActiveWorkspaceId(
  workspaces: readonly FlowWorkspaceProjectSnapshot[],
  activeWorkspaceId: string | undefined,
): string {
  return findActiveFlowWorkspace(workspaces, activeWorkspaceId)?.id ?? workspaces[0]?.id ?? 'main';
}

export const useFlowWorkspaceStore = create<FlowWorkspaceStoreState>()((set, get) => ({
  ...createInitialState(),
  createWorkspace: (name = 'Untitled Flow') => {
    const workspace = createWorkspaceRecord(name);
    set((state) => ({
      activeWorkspaceId: workspace.id,
      hydratedWorkspaceId: state.hydratedWorkspaceId,
      workspaces: [...state.workspaces, workspace],
    }));
    return workspace.id;
  },
  renameWorkspace: (id, name) => {
    const nextName = name.trim();
    if (!nextName) {
      return;
    }

    set((state) => ({
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === id
          ? { ...workspace, name: nextName, updatedAt: Date.now() }
          : workspace
      )),
    }));
  },
  duplicateWorkspace: (id) => {
    const existing = get().workspaces.find((workspace) => workspace.id === id);
    if (!existing) {
      return get().createWorkspace(DEFAULT_FLOW_WORKSPACE_NAME);
    }

    const now = Date.now();
    const duplicate: FlowWorkspaceProjectSnapshot = {
      ...existing,
      id: makeWorkspaceId(),
      name: `${existing.name} Copy`,
      createdAt: now,
      updatedAt: now,
      flow: cloneFlowSnapshot(existing.flow),
    };

    set((state) => ({
      activeWorkspaceId: duplicate.id,
      workspaces: [...state.workspaces, duplicate],
    }));

    return duplicate.id;
  },
  deleteWorkspace: (id) => {
    invalidateFlowRunsForWorkspace(id);
    set((state) => {
      const deletedIndex = state.workspaces.findIndex((workspace) => workspace.id === id);
      const remaining = state.workspaces.filter((workspace) => workspace.id !== id);
      if (remaining.length === 0) {
        const replacement = createWorkspaceRecord(DEFAULT_FLOW_WORKSPACE_NAME);
        return {
          activeWorkspaceId: replacement.id,
          // The canvas still belongs to the deleted id until App drains the replacement snapshot.
          hydratedWorkspaceId: state.hydratedWorkspaceId,
          workspaces: [replacement],
        };
      }

      const fallbackWorkspaceId = state.activeWorkspaceId === id
        ? remaining[Math.max(0, Math.min(remaining.length - 1, deletedIndex - 1))]?.id
        : state.activeWorkspaceId;

      return {
        activeWorkspaceId: resolveActiveWorkspaceId(
          remaining,
          fallbackWorkspaceId,
        ),
        // A deleted hydrated workspace becomes a short-lived tombstone owner. Reassigning this id
        // before the serialized switch completes would label the old canvas as the fallback tab.
        hydratedWorkspaceId: state.hydratedWorkspaceId,
        workspaces: remaining,
      };
    });
  },
  setActiveWorkspaceId: (id) => {
    set((state) => ({
      activeWorkspaceId: resolveActiveWorkspaceId(state.workspaces, id),
    }));
  },
  upsertHydratedSnapshot: (snapshot) => {
    set((state) => {
      const hydratedWorkspace = findActiveFlowWorkspace(state.workspaces, state.hydratedWorkspaceId);
      if (!hydratedWorkspace) {
        const mainWorkspace = buildDefaultFlowWorkspace(cloneFlowSnapshot(snapshot));
        return {
          activeWorkspaceId: mainWorkspace.id,
          hydratedWorkspaceId: mainWorkspace.id,
          workspaces: [mainWorkspace],
        };
      }

      return {
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === hydratedWorkspace.id
            ? { ...workspace, flow: cloneFlowSnapshot(snapshot), updatedAt: Date.now() }
            : workspace
        )),
      };
    });
  },
  consumePendingWorkspaceSwitch: (hydratedSnapshot) => {
    const state = get();
    if (state.activeWorkspaceId === state.hydratedWorkspaceId) {
      return undefined;
    }

    const nextWorkspaces = state.workspaces.map((workspace) => (
      workspace.id === state.hydratedWorkspaceId
        ? { ...workspace, flow: cloneFlowSnapshot(hydratedSnapshot), updatedAt: Date.now() }
        : workspace
    ));
    const nextWorkspace = findActiveFlowWorkspace(nextWorkspaces, state.activeWorkspaceId);

    if (!nextWorkspace) {
      return undefined;
    }

    set({
      hydratedWorkspaceId: nextWorkspace.id,
      workspaces: nextWorkspaces,
    });

    return cloneFlowSnapshot(nextWorkspace.flow);
  },
  hydrateProjectSnapshot: ({ workspaces, activeWorkspaceId }) => {
    workspaceSnapshotGeneration += 1;
    for (const run of new Set(activeFlowRuns.values())) {
      invalidateActiveFlowRun(run);
    }
    const nextWorkspaces = workspaces.length > 0
      ? workspaces.map((workspace) => ({ ...workspace, flow: cloneFlowSnapshot(workspace.flow) }))
      : createInitialState().workspaces;
    const resolvedActiveWorkspaceId = resolveActiveWorkspaceId(nextWorkspaces, activeWorkspaceId);

    set({
      activeWorkspaceId: resolvedActiveWorkspaceId,
      hydratedWorkspaceId: resolvedActiveWorkspaceId,
      workspaces: nextWorkspaces,
    });
  },
  exportProjectSnapshot: (activeSnapshot) => {
    const state = get();
    const workspaces = state.workspaces.length > 0 ? state.workspaces : createInitialState().workspaces;
    const hydratedWorkspace = workspaces.find((workspace) => workspace.id === state.hydratedWorkspaceId);

    return workspaces.map((workspace) => ({
      ...workspace,
      flow: cloneFlowSnapshot(
        workspace.id === hydratedWorkspace?.id ? activeSnapshot : workspace.flow,
      ),
    }));
  },
  getWorkspace: (id) => {
    return get().workspaces.find((workspace) => workspace.id === id);
  },
  reset: () => {
    workspaceSnapshotGeneration += 1;
    for (const run of new Set(activeFlowRuns.values())) {
      invalidateActiveFlowRun(run);
    }
    set(createInitialState());
  },
  registerFlowRun: (owner, options) => {
    const key = flowRunKey(owner.workspaceId, owner.nodeId);
    const existing = activeFlowRuns.get(key);
    if (existing) {
      invalidateActiveFlowRun(existing);
    }
    const run: ActiveFlowRun = {
      owner,
      nodeOwners: new Map([[owner.nodeId, {
        nodeId: owner.nodeId,
        nodeInstanceId: owner.nodeInstanceId,
        inputRevision: owner.inputRevision,
      }]]),
      abort: options?.abort,
    };
    activeFlowRuns.set(key, run);
  },
  registerFlowRunNode: (owner, node) => {
    const run = activeFlowRuns.get(flowRunKey(owner.workspaceId, owner.nodeId));
    if (!run || run.owner.runId !== owner.runId) {
      return;
    }
    const existing = run.nodeOwners.get(node.nodeId);
    if (existing) {
      return;
    }
    run.nodeOwners.set(node.nodeId, node);
    activeFlowRuns.set(flowRunKey(owner.workspaceId, node.nodeId), run);
  },
  unregisterFlowRun: (owner) => {
    const run = activeFlowRuns.get(flowRunKey(owner.workspaceId, owner.nodeId));
    if (run?.owner.runId === owner.runId) {
      removeActiveFlowRun(run);
    }
  },
  getActiveFlowRunId: (workspaceId, nodeId) => {
    return activeFlowRuns.get(flowRunKey(workspaceId, nodeId))?.owner.runId;
  },
  invalidateFlowRunForNode: (workspaceId, nodeId) => {
    const run = activeFlowRuns.get(flowRunKey(workspaceId, nodeId));
    if (!run) return [];
    const nodeIds = [...run.nodeOwners.keys()];
    invalidateActiveFlowRun(run);
    return nodeIds;
  },
  isFlowRunOwnerValid: (owner, nodeId, options) => {
    const run = activeFlowRuns.get(flowRunKey(owner.workspaceId, nodeId));
    if (!run || run.owner.runId !== owner.runId) {
      return false;
    }

    const expectedNodeOwner = run.nodeOwners.get(nodeId);
    if (!expectedNodeOwner) return false;

    const state = get();
    const workspace = state.workspaces.find((workspace) => workspace.id === owner.workspaceId);
    if (!workspace) {
      return false;
    }

    const isHydrated = state.hydratedWorkspaceId === owner.workspaceId;
    const node = isHydrated
      ? (() => {
        const data = options?.getHydratedNodeData?.(nodeId);
        return data
          ? ({ id: nodeId, data } as import('../types/flow').AppNode)
          : workspace.flow.nodes.find((node) => node.id === nodeId);
      })()
      : workspace.flow.nodes.find((node) => node.id === nodeId);

    if (!node) {
      return false;
    }

    // Every node in the immutable run graph must still be the exact instance and input
    // revision captured before its execution begins, not merely the root node.
    {
      if (
        expectedNodeOwner.nodeInstanceId !== undefined &&
        node.data.nodeInstanceId !== undefined &&
        expectedNodeOwner.nodeInstanceId !== node.data.nodeInstanceId
      ) {
        return false;
      }

      if (
        expectedNodeOwner.inputRevision !== undefined &&
        node.data.inputRevision !== undefined &&
        expectedNodeOwner.inputRevision !== node.data.inputRevision
      ) {
        return false;
      }
    }

    return true;
  },
  commitFlowRunPatch: (owner, nodeId, patch, options) => {
    if (!get().isFlowRunOwnerValid(owner, nodeId, options)) {
      return false;
    }

    const state = get();
    const workspace = state.workspaces.find((workspace) => workspace.id === owner.workspaceId);
    if (!workspace) {
      return false;
    }

    const isHydrated = state.hydratedWorkspaceId === owner.workspaceId;
    if (isHydrated && options?.applyToHydratedCanvas) {
      options.applyToHydratedCanvas(nodeId, patch);
    } else {
      set((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === owner.workspaceId
            ? {
              ...workspace,
              updatedAt: Date.now(),
              flow: {
                ...workspace.flow,
                nodes: workspace.flow.nodes.map((node) => (
                  node.id === nodeId
                    ? { ...node, data: { ...node.data, ...patch } }
                    : node
                )),
              },
            }
            : workspace
        )),
      }));
    }

    return true;
  },
}));
