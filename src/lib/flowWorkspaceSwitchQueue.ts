import type { FlowProjectFlowSnapshot } from './flowProjectWorkspaces';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';

export interface FlowWorkspaceSwitchQueueDependencies {
  exportHydratedSnapshot: () => FlowProjectFlowSnapshot;
  replaceHydratedSnapshot: (snapshot: FlowProjectFlowSnapshot) => void;
  restoreImportedAssets: () => Promise<void>;
  onRestoreError?: (error: unknown, workspaceId: string) => void;
}

export interface FlowWorkspaceSwitchQueue {
  requestDrain: () => void;
  ensureWorkspaceHydrated: (workspaceId: string, timeoutMs?: number) => Promise<boolean>;
  dispose: () => void;
}

interface WorkspaceWaiter {
  workspaceId: string;
  resolve: (hydrated: boolean) => void;
  timer: ReturnType<typeof globalThis.setTimeout>;
}

const DEFAULT_WORKSPACE_HYDRATION_TIMEOUT_MS = 2_500;

/**
 * Serializes Flow canvas replacement with its asset restoration. Selection remains newest-wins:
 * callers may keep changing activeWorkspaceId while one restore is running, and completion drains
 * directly to the latest surviving workspace instead of publishing an intermediate canvas.
 */
export function createFlowWorkspaceSwitchQueue(
  dependencies: FlowWorkspaceSwitchQueueDependencies,
): FlowWorkspaceSwitchQueue {
  let disposed = false;
  let restoreInFlight = false;
  const failedWorkspaces = new Set<string>();
  const waiters = new Set<WorkspaceWaiter>();

  const settleWaiter = (waiter: WorkspaceWaiter, hydrated: boolean) => {
    if (!waiters.delete(waiter)) return;
    globalThis.clearTimeout(waiter.timer);
    waiter.resolve(hydrated);
  };

  const settleInvalidWaiters = (activeWorkspaceId: string) => {
    const state = useFlowWorkspaceStore.getState();
    for (const waiter of waiters) {
      if (waiter.workspaceId !== activeWorkspaceId || !state.getWorkspace(waiter.workspaceId)) {
        settleWaiter(waiter, false);
      }
    }
  };

  const reportRestoreError = (error: unknown, workspaceId: string) => {
    try {
      dependencies.onRestoreError?.(error, workspaceId);
    } catch {
      // Reporting must not strand the queue or turn a handled restore failure into a rejection.
    }
  };

  const drain = () => {
    if (disposed || restoreInFlight) return;
    const state = useFlowWorkspaceStore.getState();
    settleInvalidWaiters(state.activeWorkspaceId);

    if (state.activeWorkspaceId === state.hydratedWorkspaceId) {
      const hydrated = !failedWorkspaces.has(state.activeWorkspaceId);
      for (const waiter of waiters) {
        if (waiter.workspaceId === state.activeWorkspaceId) settleWaiter(waiter, hydrated);
      }
      return;
    }

    let nextSnapshot: FlowProjectFlowSnapshot | undefined;
    try {
      nextSnapshot = state.consumePendingWorkspaceSwitch(dependencies.exportHydratedSnapshot());
    } catch (error) {
      reportRestoreError(error, state.activeWorkspaceId);
      for (const waiter of waiters) {
        if (waiter.workspaceId === state.activeWorkspaceId) settleWaiter(waiter, false);
      }
      return;
    }
    if (!nextSnapshot) {
      for (const waiter of waiters) {
        if (waiter.workspaceId === state.activeWorkspaceId) settleWaiter(waiter, false);
      }
      return;
    }

    const targetWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
    restoreInFlight = true;
    try {
      dependencies.replaceHydratedSnapshot(nextSnapshot);
    } catch (error) {
      restoreInFlight = false;
      failedWorkspaces.add(targetWorkspaceId);
      reportRestoreError(error, targetWorkspaceId);
      queueMicrotask(drain);
      return;
    }

    void Promise.resolve()
      .then(() => dependencies.restoreImportedAssets())
      .then(
        () => { failedWorkspaces.delete(targetWorkspaceId); },
        (error) => {
          failedWorkspaces.add(targetWorkspaceId);
          reportRestoreError(error, targetWorkspaceId);
        },
      )
      .finally(() => {
        restoreInFlight = false;
        if (!disposed) drain();
      });
  };

  const requestDrain = () => {
    if (disposed) return;
    const activeWorkspaceId = useFlowWorkspaceStore.getState().activeWorkspaceId;
    settleInvalidWaiters(activeWorkspaceId);
    drain();
  };

  const ensureWorkspaceHydrated = (
    workspaceId: string,
    timeoutMs = DEFAULT_WORKSPACE_HYDRATION_TIMEOUT_MS,
  ): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    const state = useFlowWorkspaceStore.getState();
    if (!state.getWorkspace(workspaceId)) return Promise.resolve(false);
    if (state.activeWorkspaceId !== workspaceId) state.setActiveWorkspaceId(workspaceId);
    const latest = useFlowWorkspaceStore.getState();
    settleInvalidWaiters(latest.activeWorkspaceId);
    if (
      !restoreInFlight
      && latest.activeWorkspaceId === workspaceId
      && latest.hydratedWorkspaceId === workspaceId
    ) {
      return Promise.resolve(!failedWorkspaces.has(workspaceId));
    }

    const completion = new Promise<boolean>((resolve) => {
      const waiter: WorkspaceWaiter = {
        workspaceId,
        resolve,
        timer: globalThis.setTimeout(() => settleWaiter(waiter, false), timeoutMs),
      };
      waiters.add(waiter);
    });
    drain();
    return completion;
  };

  const dispose = () => {
    disposed = true;
    for (const waiter of waiters) settleWaiter(waiter, false);
  };

  return { requestDrain, ensureWorkspaceHydrated, dispose };
}
