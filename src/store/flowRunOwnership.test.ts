import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode } from '../types/flow';
import type { FlowRunOwner } from './flowWorkspaceStore';

const { mockExecuteNodeRequest } = vi.hoisted(() => ({
  mockExecuteNodeRequest: vi.fn(),
}));

vi.mock('../lib/flowExecution', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/flowExecution')>();
  return {
    ...original,
    executeNodeRequest: (...args: Parameters<typeof original.executeNodeRequest>) =>
      mockExecuteNodeRequest(...args),
  };
});

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createControllableRunPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  let called = false;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const getPromise = () => {
    called = true;
    return promise;
  };
  const waitForCall = async () => {
    while (!called) {
      await new Promise<void>((res) => { setTimeout(res, 0); });
    }
    // Yield once more so the caller has registered its await handler.
    await new Promise<void>((res) => { setTimeout(res, 0); });
  };
  return { resolve, reject, getPromise, waitForCall };
}

let useFlowStore: Awaited<typeof import('./flowStore')>['useFlowStore'];
let useFlowWorkspaceStore: Awaited<typeof import('./flowWorkspaceStore')>['useFlowWorkspaceStore'];
let useProjectUsageStore: Awaited<typeof import('./projectUsageStore')>['useProjectUsageStore'];
let useSourceBinStore: Awaited<typeof import('./sourceBinStore')>['useSourceBinStore'];
let useConfirmationStore: Awaited<typeof import('./confirmationStore')>['useConfirmationStore'];



function resetStores() {
  window.localStorage.clear();
  useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  useFlowWorkspaceStore.setState(
    {
      activeWorkspaceId: 'main',
      hydratedWorkspaceId: 'main',
      workspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          flow: { version: 3, nodes: [], edges: [] },
        },
      ],
    },
    false,
  );
  useSourceBinStore.setState(
    {
      bins: [
        { id: 'default', name: 'Source Library', collapsed: false, createdAt: Date.now(), items: [] },
      ],
      dismissedSourceKeys: [],
    },
    false,
  );
  useProjectUsageStore.getState().restoreSnapshot(undefined);
  useConfirmationStore.setState({ requestConfirmation: vi.fn().mockResolvedValue(true) });
  mockExecuteNodeRequest.mockReset();
}

function findNodeInWorkspace(
  workspaceId: string,
  nodeId: string,
): AppNode | undefined {
  const workspace = useFlowWorkspaceStore.getState().getWorkspace(workspaceId);
  return workspace?.flow.nodes.find((node) => node.id === nodeId);
}

function findNodeInHydratedCanvas(nodeId: string): AppNode | undefined {
  return useFlowStore.getState().nodes.find((node) => node.id === nodeId);
}

function switchToWorkspace(targetWorkspaceId: string) {
  const currentSnapshot = useFlowStore.getState().exportProjectFlowSnapshot();
  useFlowWorkspaceStore.getState().setActiveWorkspaceId(targetWorkspaceId);
  const nextSnapshot = useFlowWorkspaceStore.getState().consumePendingWorkspaceSwitch(currentSnapshot);
  if (nextSnapshot) {
    useFlowStore.getState().replaceFlowSnapshot(nextSnapshot);
  }
}

function makeTextResult(overrides: { result?: string; usage?: { costUsd: number } } = {}) {
  return {
    result: overrides.result ?? 'generated text',
    resultType: 'text' as const,
    statusMessage: 'Done',
    usage: overrides.usage ?? { source: 'actual', confidence: 'fixed', costUsd: 0.01 },
  };
}

function makeImageResult(overrides: { usage?: { costUsd: number } } = {}) {
  return {
    result: 'data:image/png;base64,FAKEIMAGE',
    resultType: 'image' as const,
    mimeType: 'image/png',
    statusMessage: 'Generated',
    usage: overrides.usage ?? { source: 'actual', confidence: 'fixed', costUsd: 0.02 },
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: makeMemoryStorage(),
  });

  ({ useFlowStore } = await import('./flowStore'));
  ({ useFlowWorkspaceStore } = await import('./flowWorkspaceStore'));
  ({ useProjectUsageStore } = await import('./projectUsageStore'));
  ({ useSourceBinStore } = await import('./sourceBinStore'));
  ({ useConfirmationStore } = await import('./confirmationStore'));

  resetStores();
});

afterEach(() => {
  resetStores();
  vi.unstubAllGlobals();
});

describe('Flow run ownership (AUD-002)', () => {
  it('invalidates the active same-workspace graph before replacing its snapshot', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeImageResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'old graph',
    });
    const original = findNodeInHydratedCanvas(nodeId)!;

    const run = useFlowStore.getState().runNode(nodeId);
    useFlowStore.getState().replaceFlowSnapshot({
      version: 3,
      nodes: [{
        ...original,
        data: {
          ...original.data,
          nodeInstanceId: 'replacement-instance',
          inputRevision: 'replacement-revision',
          isRunning: false,
          statusMessage: undefined,
          result: undefined,
          resultType: undefined,
        },
      }],
      edges: [],
    });

    resolve(makeImageResult());
    await run;

    const replacement = findNodeInHydratedCanvas(nodeId);
    expect(replacement?.data.nodeInstanceId).toBe('replacement-instance');
    expect(replacement?.data.result).toBeUndefined();
    expect(replacement?.data.statusMessage).toBeUndefined();
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);
  });

  it('commits a delayed result to the original workspace after switching to a duplicate', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);

    const workspaceBId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceAId);
    switchToWorkspace(workspaceBId);

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();

    resolve(makeTextResult({ result: 'result-for-A' }));
    await runPromise;

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();
    expect(findNodeInWorkspace(workspaceAId, nodeId)?.data.result).toBe('result-for-A');
    expect(findNodeInWorkspace(workspaceBId, nodeId)?.data.result).toBeUndefined();

    const entries = useProjectUsageStore.getState().ledger.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.flowWorkspaceId).toBe(workspaceAId);
    expect(mockExecuteNodeRequest).toHaveBeenCalledTimes(1);
  });

  it('records incurred usage when a post-dispatch edit makes completion stale', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();

    // Change execution-relevant input before switching away.
    useFlowStore.getState().updateNodeData(nodeId, 'prompt', 'edited prompt');

    const workspaceBId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceAId);
    switchToWorkspace(workspaceBId);

    runControl.resolve(makeTextResult());
    await runPromise;

    expect(findNodeInWorkspace(workspaceAId, nodeId)?.data.result).toBeUndefined();
    expect(findNodeInWorkspace(workspaceBId, nodeId)?.data.result).toBeUndefined();
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.flowWorkspaceId).toBe(workspaceAId);
  });

  it('drops stale completion when the node was deleted and recreated with the same id', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const originalNode = findNodeInHydratedCanvas(nodeId)!;
    const originalRevision = originalNode.data.inputRevision;
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);

    // Delete the original node and recreate one with the same id but a fresh instance identity.
    useFlowStore.setState((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
    }));
    const recreatedNode: AppNode = {
      ...originalNode,
      data: {
        ...originalNode.data,
        nodeInstanceId: 'recreated-instance-id',
        inputRevision: originalRevision,
        result: undefined,
        isRunning: false,
      },
    };
    useFlowStore.setState((state) => ({
      nodes: [...state.nodes, recreatedNode],
    }));

    const workspaceBId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceAId);
    switchToWorkspace(workspaceBId);

    resolve(makeTextResult());
    await runPromise;

    expect(findNodeInWorkspace(workspaceAId, nodeId)?.data.result).toBeUndefined();
    expect(findNodeInWorkspace(workspaceBId, nodeId)?.data.result).toBeUndefined();
  });

  it('keeps result in the active hydrated canvas when the owner is still active', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });

    const runPromise = useFlowStore.getState().runNode(nodeId);
    resolve(makeTextResult({ result: 'active-result' }));
    await runPromise;

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBe('active-result');
  });

  it('survives switch-away and switch-back with the result intact', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);

    const workspaceBId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceAId);
    switchToWorkspace(workspaceBId);

    resolve(makeTextResult({ result: 'result-after-switchback' }));
    await runPromise;

    switchToWorkspace(workspaceAId);

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBe('result-after-switchback');
  });

  it('records usage and Source Bin results against the starting workspace and run', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeImageResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    // Any runnable node returning an asset result will create a Source Bin item.
    // Using a single generate-mode textNode keeps the workspace switch from racing
    // with dependency recursion while still proving origin workspace/run identity.
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'a cat',
    });

    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
    const runPromise = useFlowStore.getState().runNode(nodeId);

    const workspaceBId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceAId);
    switchToWorkspace(workspaceBId);

    resolve(makeImageResult());
    await runPromise;

    const items = useSourceBinStore.getState().getAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.originNodeId).toBe(nodeId);
    expect(items[0]?.originWorkspaceId).toBe(workspaceAId);
    expect(items[0]?.originRunId).toBeTruthy();

    const entries = useProjectUsageStore.getState().ledger.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.flowWorkspaceId).toBe(workspaceAId);
    expect(entries[0]?.nodeId).toBe(nodeId);
  });

  it('commits failure state and preserves partial usage to the owning workspace', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();

    const workspaceBId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceAId);
    switchToWorkspace(workspaceBId);

    const error = Object.assign(new Error('Provider failed'), {
      usage: { source: 'actual', confidence: 'fixed', costUsd: 0.005 },
    });
    runControl.reject(error);
    await runPromise;

    const nodeA = findNodeInWorkspace(workspaceAId, nodeId);
    expect(nodeA?.data.error).toBe('Provider failed');
    expect(nodeA?.data.isRunning).toBe(false);

    const entries = useProjectUsageStore.getState().ledger.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.flowWorkspaceId).toBe(workspaceAId);
    expect(entries[0]?.costUsd).toBe(0.005);
  });

  it('commits cancellation to the owning workspace and stops isRunning', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });

    const runPromise = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();
    useFlowStore.getState().cancelNodeRun(nodeId);

    runControl.reject(new DOMException('The run was cancelled.', 'AbortError'));
    await runPromise;

    const node = findNodeInHydratedCanvas(nodeId);
    expect(node?.data.statusMessage).toBe('Run cancelled.');
    expect(node?.data.isRunning).toBe(false);
    expect(node?.data.error).toBeUndefined();
  });

  it('rejects commits from a superseded runId when a newer run starts', async () => {
    const owner: FlowRunOwner = {
      workspaceId: 'ws-a',
      nodeId: 'node-1',
      nodeInstanceId: 'instance-1',
      inputRevision: 'rev-1',
      runId: 'run-1',
    };
    const newerOwner: FlowRunOwner = {
      ...owner,
      runId: 'run-2',
    };

    useFlowWorkspaceStore.setState(
      {
        activeWorkspaceId: 'ws-a',
        hydratedWorkspaceId: 'ws-a',
        workspaces: [
          {
            id: 'ws-a',
            name: 'A',
            createdAt: 1,
            updatedAt: 1,
            flow: {
              version: 3,
              nodes: [
                {
                  id: 'node-1',
                  type: 'textNode',
                  position: { x: 0, y: 0 },
                  data: {
                    nodeInstanceId: 'instance-1',
                    inputRevision: 'rev-1',
                  },
                } as AppNode,
              ],
              edges: [],
            },
          },
        ],
      },
      false,
    );

    const workspaceStore = useFlowWorkspaceStore.getState();
    workspaceStore.registerFlowRun(owner);
    workspaceStore.registerFlowRun(newerOwner);

    expect(
      workspaceStore.commitFlowRunPatch(owner, 'node-1', { result: 'stale' }),
    ).toBe(false);
    expect(
      workspaceStore.commitFlowRunPatch(newerOwner, 'node-1', { result: 'fresh' }),
    ).toBe(true);

    expect(findNodeInWorkspace('ws-a', 'node-1')?.data.result).toBe('fresh');
  });

  it('drops an older runId commit that resolves after a newer runId commit', async () => {
    const owner: FlowRunOwner = {
      workspaceId: 'ws-a',
      nodeId: 'node-1',
      nodeInstanceId: 'instance-1',
      inputRevision: 'rev-1',
      runId: 'run-1',
    };
    const newerOwner: FlowRunOwner = {
      ...owner,
      runId: 'run-2',
    };

    useFlowWorkspaceStore.setState(
      {
        activeWorkspaceId: 'ws-a',
        hydratedWorkspaceId: 'ws-a',
        workspaces: [
          {
            id: 'ws-a',
            name: 'A',
            createdAt: 1,
            updatedAt: 1,
            flow: {
              version: 3,
              nodes: [
                {
                  id: 'node-1',
                  type: 'textNode',
                  position: { x: 0, y: 0 },
                  data: {
                    nodeInstanceId: 'instance-1',
                    inputRevision: 'rev-1',
                  },
                } as AppNode,
              ],
              edges: [],
            },
          },
        ],
      },
      false,
    );

    const workspaceStore = useFlowWorkspaceStore.getState();
    workspaceStore.registerFlowRun(owner);
    workspaceStore.registerFlowRun(newerOwner);

    // Newer run resolves first.
    expect(
      workspaceStore.commitFlowRunPatch(newerOwner, 'node-1', { result: 'fresh' }),
    ).toBe(true);

    // Older run resolves out of order and must be ignored.
    expect(
      workspaceStore.commitFlowRunPatch(owner, 'node-1', { result: 'stale' }),
    ).toBe(false);

    expect(findNodeInWorkspace('ws-a', 'node-1')?.data.result).toBe('fresh');
  });

  it('does not overwrite an unrelated workspace when the owner workspace is deleted', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);

    const workspaceBId = useFlowWorkspaceStore.getState().createWorkspace('B');
    switchToWorkspace(workspaceBId);
    useFlowWorkspaceStore.getState().deleteWorkspace(workspaceAId);

    resolve(makeTextResult({ result: 'orphan-result' }));
    await runPromise;

    expect(findNodeInWorkspace(workspaceBId, nodeId)).toBeUndefined();
    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();
  });

  it('commits to the owner after rename/reorder because the workspace id is unchanged', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'hello',
    });
    const workspaceAId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;

    const runPromise = useFlowStore.getState().runNode(nodeId);

    useFlowWorkspaceStore.getState().renameWorkspace(workspaceAId, 'Renamed A');
    const workspaceBId = useFlowWorkspaceStore.getState().createWorkspace('B');
    switchToWorkspace(workspaceBId);

    resolve(makeTextResult({ result: 'renamed-result' }));
    await runPromise;

    expect(findNodeInWorkspace(workspaceAId, nodeId)?.data.result).toBe('renamed-result');
    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();
  });

  it('keeps an already-running node running when a duplicate workspace is hydrated', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());

    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'hello',
    });
    const workspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
    const firstRun = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();

    // Project snapshots retain runtime run state while a workspace is duplicated.
    useFlowWorkspaceStore.getState().upsertHydratedSnapshot(useFlowStore.getState().exportProjectFlowSnapshot());
    const duplicateId = useFlowWorkspaceStore.getState().duplicateWorkspace(workspaceId);
    switchToWorkspace(duplicateId);

    expect(findNodeInHydratedCanvas(nodeId)?.data.isRunning).toBe(true);
    await useFlowStore.getState().runNode(nodeId);
    expect(mockExecuteNodeRequest).toHaveBeenCalledTimes(1);

    runControl.reject(new DOMException('The run was cancelled.', 'AbortError'));
    await firstRun;
  });

  it('records an incurred success cost once but drops stale result and Source output after a mid-run edit', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeImageResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'before',
    });

    const run = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();
    useFlowStore.getState().updateNodeData(nodeId, 'prompt', 'after');
    runControl.resolve(makeImageResult({ usage: { costUsd: 0.02 } }));
    await run;

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.costUsd).toBe(0.02);
  });

  it('records ordered generation and paid-upscale attributions exactly once for the immutable owner', async () => {
    const runControl = createControllableRunPromise<void>();
    mockExecuteNodeRequest.mockImplementation(async (executedNode: AppNode, ...args: unknown[]) => {
      await runControl.getPromise();
      const options = args[3] as {
        onInternalUsage?: (entry: { node: AppNode; usage: { source: 'actual'; confidence: 'fixed'; provider: string; modelId: string; costUsd: number; imageCount: number } }) => void;
      } | undefined;
      const generation = {
        node: { ...executedNode, type: 'imageGen' as const, data: { ...executedNode.data, provider: 'stability', modelId: 'stable-image-core' } } as AppNode,
        usage: { source: 'actual' as const, confidence: 'fixed' as const, provider: 'stability', modelId: 'stable-image-core', costUsd: 0.03, imageCount: 1 },
      };
      const upscale = {
        node: { ...generation.node, data: { ...generation.node.data, imageOperation: 'upscale', modelId: 'stable-image-upscale-fast' } } as AppNode,
        usage: { source: 'actual' as const, confidence: 'fixed' as const, provider: 'stability', modelId: 'stable-image-upscale-fast', costUsd: 0.02, imageCount: 1 },
      };
      options?.onInternalUsage?.(generation);
      options?.onInternalUsage?.(upscale);
      return {
        ...makeImageResult({ usage: { costUsd: 0.05 } }),
        usageAttributions: [generation, upscale],
      };
    });
    const ownerWorkspaceId = useFlowWorkspaceStore.getState().activeWorkspaceId;
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'before',
    });

    const run = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();
    useFlowStore.getState().updateNodeData(nodeId, 'prompt', 'edited while paid work was in flight');
    runControl.resolve();
    await run;

    const entries = useProjectUsageStore.getState().ledger.entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => ({
      workspaceId: entry.flowWorkspaceId,
      operation: entry.operation,
      provider: entry.provider,
      modelId: entry.modelId,
      costUsd: entry.costUsd,
    }))).toEqual([
      {
        workspaceId: ownerWorkspaceId, operation: 'image-generation', provider: 'stability',
        modelId: 'stable-image-core', costUsd: 0.03,
      },
      {
        workspaceId: ownerWorkspaceId, operation: 'upscale', provider: 'stability',
        modelId: 'stable-image-upscale-fast', costUsd: 0.02,
      },
    ]);
  });

  it('records an incurred provider error cost once even when the stale error cannot publish', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'before',
    });

    const run = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();
    useFlowStore.getState().updateNodeData(nodeId, 'prompt', 'after');
    runControl.reject(Object.assign(new Error('paid provider error'), {
      usage: { source: 'actual', confidence: 'fixed', costUsd: 0.03 },
    }));
    await run;

    expect(findNodeInHydratedCanvas(nodeId)?.data.error).toBeUndefined();
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.costUsd).toBe(0.03);
  });

  it('records one accepted ElevenLabs attempt when post-acceptance materialization fails', async () => {
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'elevenlabs', modelId: 'eleven_multilingual_v2', prompt: 'narration',
    });
    mockExecuteNodeRequest.mockRejectedValue(Object.assign(
      new Error('accepted response byte read failed'),
      {
        usage: {
          source: 'actual',
          confidence: 'fixed',
          provider: 'elevenlabs',
          modelId: 'eleven_multilingual_v2',
          characters: 9,
          costUsd: 0.002,
        },
      },
    ));

    await useFlowStore.getState().runNode(nodeId);

    expect(mockExecuteNodeRequest).toHaveBeenCalledTimes(1);
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]).toMatchObject({
      nodeId,
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      characters: 9,
      costUsd: 0.002,
    });
  });

  it('does not resubmit and keeps one usage entry when accepted media persistence fails', async () => {
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'elevenlabs', modelId: 'eleven_multilingual_v2', prompt: 'narration',
    });
    mockExecuteNodeRequest.mockResolvedValue({
      result: 'blob:accepted-elevenlabs-audio',
      resultType: 'audio',
      blob: new Blob(['accepted audio'], { type: 'audio/mpeg' }),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      statusMessage: 'Generated',
      usage: {
        source: 'actual',
        confidence: 'fixed',
        provider: 'elevenlabs',
        modelId: 'eleven_multilingual_v2',
        characters: 9,
        costUsd: 0.002,
      },
    });
    const originalAddAssetItem = useSourceBinStore.getState().addAssetItem;
    useSourceBinStore.setState({
      addAssetItem: vi.fn().mockRejectedValue(new Error('Source persistence failed')),
    });

    try {
      await useFlowStore.getState().runNode(nodeId);
    } finally {
      useSourceBinStore.setState({ addAssetItem: originalAddAssetItem });
    }

    expect(mockExecuteNodeRequest).toHaveBeenCalledTimes(1);
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]).toMatchObject({
      nodeId,
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      characters: 9,
      costUsd: 0.002,
    });
    expect(findNodeInHydratedCanvas(nodeId)?.data.error).toBe('Source persistence failed');
  });

  it('removes a Source item when ownership goes stale during Source persistence', async () => {
    const { promise, resolve } = deferred<ReturnType<typeof makeImageResult>>();
    mockExecuteNodeRequest.mockReturnValue(promise);
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'before',
    });
    const originalAdd = useSourceBinStore.getState().addAssetItem;
    useSourceBinStore.setState({
      addAssetItem: vi.fn(async (item, targetBinId, options) => {
        const added = await originalAdd(item, targetBinId, options);
        useFlowStore.getState().updateNodeData(nodeId, 'prompt', 'edited while writing Source');
        return added;
      }),
    });

    const run = useFlowStore.getState().runNode(nodeId);
    resolve(makeImageResult());
    await run;

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
  });

  it('cancels an active non-root dependency through its immutable run graph', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());
    const dependencyId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'dependency',
    });
    const rootId = useFlowStore.getState().addNode('textNode', { x: 400, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'root',
    });
    useFlowStore.setState({
      edges: [{ id: 'dependency-root', source: dependencyId, target: rootId }],
    });

    const run = useFlowStore.getState().runNode(rootId);
    await runControl.waitForCall();
    useFlowStore.getState().cancelNodeRun(dependencyId);
    expect((mockExecuteNodeRequest.mock.calls[0]?.[4] as { signal?: AbortSignal })?.signal?.aborted).toBe(true);

    runControl.reject(new DOMException('The run was cancelled.', 'AbortError'));
    await run;
    expect(findNodeInHydratedCanvas(dependencyId)?.data.isRunning).toBe(false);
    expect(findNodeInHydratedCanvas(rootId)?.data.isRunning).toBe(false);
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(0);
  });

  it('does not invent an actual usage record when provider execution fails before reporting usage', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'fail before success',
    });

    const run = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();
    runControl.reject(new Error('Provider rejected before completion'));
    await run;

    expect(findNodeInHydratedCanvas(nodeId)?.data.error).toBe('Provider rejected before completion');
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(0);
  });

  it('invalidates a reset run graph so a recycled default workspace cannot accept a zombie result', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'hello',
    });
    const run = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();

    useFlowWorkspaceStore.getState().reset();
    runControl.resolve(makeTextResult({ result: 'zombie' }));
    await run;

    expect(findNodeInHydratedCanvas(nodeId)?.data.result).toBeUndefined();
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
  });

  it('D: reset and hydration while final confirmation is pending cannot dispatch stale provider work after approval', async () => {
    let approve!: (value: boolean) => void;
    useConfirmationStore.setState({ requestConfirmation: vi.fn(() => new Promise<boolean>((resolve) => { approve = resolve; })) });
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'confirm then reset',
    });

    const run = useFlowStore.getState().runNode(nodeId);
    await vi.waitFor(() => expect(useConfirmationStore.getState().requestConfirmation).toHaveBeenCalledTimes(1));
    useFlowWorkspaceStore.getState().reset();
    approve(true);
    await run;

    expect(mockExecuteNodeRequest).not.toHaveBeenCalled();
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(0);
  });

  it('E: editing a later planned diamond branch while the shared dependency is in flight prevents that old branch dispatch', async () => {
    const sharedRun = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    let shared = '';
    mockExecuteNodeRequest.mockImplementation((node: AppNode) => (
      node.id === shared ? sharedRun.getPromise() : Promise.resolve(makeTextResult({ result: node.id }))
    ));
    shared = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, { mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'shared' });
    const left = useFlowStore.getState().addNode('textNode', { x: 200, y: 0 }, { mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'left' });
    const right = useFlowStore.getState().addNode('textNode', { x: 200, y: 120 }, { mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'right' });
    const root = useFlowStore.getState().addNode('textNode', { x: 400, y: 0 }, { mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'root' });
    useFlowStore.setState({ edges: [
      { id: 'shared-left', source: shared, target: left }, { id: 'shared-right', source: shared, target: right },
      { id: 'left-root', source: left, target: root }, { id: 'right-root', source: right, target: root },
    ] });

    const run = useFlowStore.getState().runNode(root);
    await sharedRun.waitForCall();
    useFlowStore.getState().updateNodeData(right, 'prompt', 'edited later branch');
    sharedRun.resolve(makeTextResult({ result: 'shared result' }));
    await run;

    expect(mockExecuteNodeRequest.mock.calls.map(([node]) => (node as AppNode).id)).toEqual([shared]);
  });

  it('aborts the exact active graph when its node is deleted', async () => {
    const runControl = createControllableRunPromise<ReturnType<typeof makeTextResult>>();
    mockExecuteNodeRequest.mockImplementation(() => runControl.getPromise());
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'delete me',
    });

    const run = useFlowStore.getState().runNode(nodeId);
    await runControl.waitForCall();
    await useFlowStore.getState().onNodesChange([{ id: nodeId, type: 'remove' }]);

    expect((mockExecuteNodeRequest.mock.calls[0]?.[4] as { signal?: AbortSignal })?.signal?.aborted).toBe(true);
    runControl.reject(new DOMException('The run was cancelled.', 'AbortError'));
    await run;
    expect(findNodeInHydratedCanvas(nodeId)).toBeUndefined();
  });

  it('gives quick-create portals, connected nodes, groups, and collapsed functions fresh identities', () => {
    const identity = (id: string | undefined) => findNodeInHydratedCanvas(id ?? '')?.data.nodeInstanceId;
    const sourceId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 });
    useFlowStore.getState().addConnectedNode(sourceId, 'portal');
    useFlowStore.getState().addConnectedNode(sourceId, 'textNode');
    useFlowStore.setState((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: node.id === sourceId })),
    }));
    const groupId = useFlowStore.getState().createGroupFromSelection();
    const groupIdentity = identity(groupId);
    const functionId = useFlowStore.getState().collapseSelectionToFunction();

    expect(useFlowStore.getState().nodes.every((node) => node.data.nodeInstanceId && node.data.inputRevision)).toBe(true);
    expect(groupIdentity).toBeTruthy();
    expect(identity(functionId)).toBeTruthy();
  });

  it.each([
    ['scalar', 'textNode'],
    ['vector', 'imageGen'],
    ['Function', 'functionNode'],
  ] as const)('executes the shared D dependency once per %s diamond root run and again for the next root run', async (_path, type) => {
    const createNode = (label: string) => useFlowStore.getState().addNode(type, { x: 0, y: 0 }, (
      type === 'textNode'
        ? { mode: 'generate', provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: label }
        : type === 'imageGen'
          ? { mediaMode: 'generate', provider: 'openai', modelId: 'gpt-image-1', prompt: label }
          : {}
    ));
    const d = createNode('D');
    const b = createNode('B');
    const c = createNode('C');
    const a = createNode('A');
    const edge = (id: string, source: string, target: string, targetHandle?: string) => (
      type === 'functionNode'
        ? { id, source, target, sourceHandle: 'output-result', targetHandle }
        : { id, source, target, targetHandle }
    );
    useFlowStore.setState({
      edges: [
        edge('d-b', d, b, type === 'imageGen' ? 'image-edit-source' : type === 'functionNode' ? 'input-flow' : undefined),
        edge('d-c', d, c, type === 'imageGen' ? 'image-edit-source' : type === 'functionNode' ? 'input-flow' : undefined),
        edge('b-a', b, a, type === 'imageGen' ? 'image-edit-source' : type === 'functionNode' ? 'input-flow' : undefined),
        edge('c-a', c, a, type === 'imageGen' ? 'image-reference-1' : type === 'functionNode' ? 'input-constant' : undefined),
      ],
    });
    mockExecuteNodeRequest.mockImplementation((node: AppNode) => (
      type === 'imageGen'
        ? makeImageResult()
        : makeTextResult({ result: node.id })
    ));

    await useFlowStore.getState().runNode(a);
    await useFlowStore.getState().runNode(a);

    const executedIds = mockExecuteNodeRequest.mock.calls.map(([node]) => (node as AppNode).id);
    expect(executedIds.filter((id) => id === d)).toHaveLength(2);
    expect(executedIds).toHaveLength(8);
    if (type === 'imageGen') {
      expect(useSourceBinStore.getState().getAllItems().filter((item) => item.originNodeId === d)).toHaveLength(2);
    }
  });
});
