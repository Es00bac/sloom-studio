import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { buildListItemTargetHandle } from '../lib/listNodes';

const executionCapture = vi.hoisted(() => ({
  executeNodeRequest: vi.fn(),
  hashExecutionParameters: vi.fn(async (_data: unknown, context: { prompt?: string }) => `hash-${context.prompt ?? ''}`),
}));

vi.mock('../lib/flowExecution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/flowExecution')>()),
  executeNodeRequest: executionCapture.executeNodeRequest,
  hashExecutionParameters: executionCapture.hashExecutionParameters,
}));

// List expansion is tested here at the execution/cancellation boundary. The
// graph-contract diagnostics have their own matrix and otherwise reject the
// intentionally minimal fixture before run ownership is established.
vi.mock('../lib/flowDiagnostics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/flowDiagnostics')>()),
  getBlockingFlowDiagnostics: vi.fn(() => []),
}));

import { useConfirmationStore } from './confirmationStore';
import { useFlowStore } from './flowStore';
import { useProjectUsageStore } from './projectUsageStore';
import { useSourceBinStore } from './sourceBinStore';
import { useFlowWorkspaceStore } from './flowWorkspaceStore';

function node(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

function deferredExecution() {
  let resolve!: (value: {
    result: string;
    resultType: 'text';
    statusMessage: string;
    usage: { provider: 'openai'; modelId: string; inputTokens: number; outputTokens: number };
  }) => void;
  const promise = new Promise<Parameters<typeof resolve>[0]>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Flow store cancellation ownership', () => {
  beforeEach(() => {
    executionCapture.executeNodeRequest.mockReset();
    executionCapture.hashExecutionParameters.mockClear();
    useConfirmationStore.setState({
      activeRequest: null,
      requestConfirmation: vi.fn().mockResolvedValue(true),
    });
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
    });
    useProjectUsageStore.getState().restoreSnapshot();
  });

  it('cancels a Loop envelope after one submit while recording incurred usage to its original owner', async () => {
    const deferred = deferredExecution();
    executionCapture.executeNodeRequest.mockImplementation((...args: unknown[]) => {
      const options = args[4] as { signal?: AbortSignal };
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return deferred.promise;
    });
    useFlowStore.setState({
      nodes: [
        node('prompt-one', 'textNode', { mode: 'prompt', prompt: 'first prompt' }),
        node('prompt-two', 'textNode', { mode: 'prompt', prompt: 'second prompt' }),
        node('loop-source', 'list'),
        node('loop-target', 'textNode', {
          mode: 'generate',
          provider: 'openai',
          modelId: 'gpt-4.1-mini',
        }),
      ],
      edges: [
        { ...edge('list-one', 'prompt-one', 'loop-source'), targetHandle: buildListItemTargetHandle(0) },
        { ...edge('list-two', 'prompt-two', 'loop-source'), targetHandle: buildListItemTargetHandle(1) },
        edge('loop-edge', 'loop-source', 'loop-target'),
      ],
    });

    const ownerWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
    const run = useFlowStore.getState().runNode('loop-target');
    await vi.waitFor(() => expect(executionCapture.executeNodeRequest).toHaveBeenCalledOnce());
    const signal = executionCapture.executeNodeRequest.mock.calls[0][4].signal as AbortSignal;

    useFlowStore.getState().cancelNodeRun('loop-target');
    expect(signal.aborted).toBe(true);
    deferred.resolve({
      result: 'late first result',
      resultType: 'text',
      statusMessage: 'late',
      usage: { provider: 'openai', modelId: 'gpt-4.1-mini', inputTokens: 1, outputTokens: 1 },
    });
    await run;

    expect(executionCapture.executeNodeRequest).toHaveBeenCalledOnce();
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.flowWorkspaceId).toBe(ownerWorkspaceId);
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'loop-target')?.data).toMatchObject({
      isRunning: false,
      statusMessage: 'Run cancelled.',
    });
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'loop-target')?.data.result).toBeUndefined();
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'loop-target')?.data.usage).toBeUndefined();
  });

  it('lets RunMe own and cancel its upstream provider request without accepting a late result', async () => {
    const deferred = deferredExecution();
    executionCapture.executeNodeRequest.mockImplementation(() => deferred.promise);
    useFlowStore.setState({
      nodes: [
        node('prompt', 'textNode', { mode: 'prompt', prompt: 'run me prompt' }),
        node('generator', 'textNode', {
          mode: 'generate',
          provider: 'openai',
          modelId: 'gpt-4.1-mini',
        }),
        node('run-me', 'runMeNode'),
      ],
      edges: [
        edge('prompt-edge', 'prompt', 'generator'),
        edge('run-edge', 'generator', 'run-me'),
      ],
    });

    const ownerWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
    const run = useFlowStore.getState().runNode('run-me');
    await vi.waitFor(() => expect(executionCapture.executeNodeRequest).toHaveBeenCalledOnce());
    const signal = executionCapture.executeNodeRequest.mock.calls[0][4].signal as AbortSignal;
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'run-me')?.data.isRunning).toBe(true);

    useFlowStore.getState().cancelNodeRun('run-me');
    expect(signal.aborted).toBe(true);
    deferred.resolve({
      result: 'late upstream result',
      resultType: 'text',
      statusMessage: 'late',
      usage: { provider: 'openai', modelId: 'gpt-4.1-mini', inputTokens: 1, outputTokens: 1 },
    });
    await run;

    expect(executionCapture.executeNodeRequest).toHaveBeenCalledOnce();
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.flowWorkspaceId).toBe(ownerWorkspaceId);
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'generator')?.data.result).toBeUndefined();
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'generator')?.data.usage).toBeUndefined();
    expect(useFlowStore.getState().nodes.find(({ id }) => id === 'run-me')?.data).toMatchObject({
      isRunning: false,
      statusMessage: 'Run cancelled.',
    });
  });
});
