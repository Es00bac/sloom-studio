import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode } from '../types/flow';
import { createDefaultFunctionNodeConfig } from '../lib/functionNodes';

const executionHarness = vi.hoisted(() => ({
  override: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
  executeNodeRequest: vi.fn(),
}));

vi.mock('../lib/flowExecution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/flowExecution')>();
  executionHarness.executeNodeRequest.mockImplementation((...args: unknown[]) => (
    executionHarness.override
      ? executionHarness.override(...args)
      : (actual.executeNodeRequest as (...actualArgs: unknown[]) => Promise<unknown>)(...args)
  ));
  return { ...actual, executeNodeRequest: executionHarness.executeNodeRequest };
});

import { executeNodeRequest } from '../lib/flowExecution';
import { withExponentialBackoff } from '../lib/exponentialBackoff';
import { DEFAULT_EXECUTION_CONFIG, DEFAULT_MODELS, DEFAULT_PROVIDER_SETTINGS } from '../lib/providerCatalog';
import { useConfirmationStore } from './confirmationStore';
import { useFlowStore } from './flowStore';
import { useFlowWorkspaceStore } from './flowWorkspaceStore';
import { useProjectUsageStore } from './projectUsageStore';
import { useSourceBinStore } from './sourceBinStore';

function node(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const originalAddAssetItem = useSourceBinStore.getState().addAssetItem;

describe('combined Flow runtime reconciliation', () => {
  beforeEach(() => {
    executionHarness.override = undefined;
    executionHarness.executeNodeRequest.mockClear();
    useFlowWorkspaceStore.getState().reset();
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useConfirmationStore.setState({
      activeRequest: null,
      requestConfirmation: vi.fn().mockResolvedValue(true),
    });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
      addAssetItem: originalAddAssetItem,
    });
    useProjectUsageStore.getState().restoreSnapshot();
  });

  afterEach(() => {
    executionHarness.override = undefined;
    useSourceBinStore.setState({ addAssetItem: originalAddAssetItem });
    vi.unstubAllGlobals();
  });

  it('runs one Requester inside a reusable Function diamond per root, coalesces duplicate roots, and runs fresh after save/reopen', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('shared response', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const functionA = createDefaultFunctionNodeConfig('Function A');
    const functionB = createDefaultFunctionNodeConfig('Function B');
    functionA.contract.outputPorts[0]!.resultType = 'text';
    functionB.contract.outputPorts[0]!.resultType = 'text';
    useFlowStore.setState({
      nodes: [
        node('request', 'apiFetchNode', {
          url: 'https://example.test/data',
          method: 'PUT',
          headers: 'Content-Type: text/plain',
          body: 'safe request body',
          declaredOutputType: 'text',
        }),
        node('function-a', 'functionNode', { functionNode: functionA, result: 'retained A' }),
        node('function-b', 'functionNode', { functionNode: functionB, result: 'retained B' }),
        node('run-me', 'runMeNode'),
      ],
      edges: [
        { id: 'request-a', source: 'request', target: 'function-a', targetHandle: 'input-flow' },
        { id: 'request-b', source: 'request', target: 'function-b', targetHandle: 'input-flow' },
        { id: 'a-root', source: 'function-a', sourceHandle: 'output-result', target: 'run-me' },
        { id: 'b-root', source: 'function-b', sourceHandle: 'output-result', target: 'run-me' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    const firstRoot = useFlowStore.getState().runNode('run-me');
    const duplicateRoot = useFlowStore.getState().runNode('run-me');
    expect(duplicateRoot).toBe(firstRoot);
    await Promise.all([firstRoot, duplicateRoot]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await useFlowStore.getState().runNode('run-me');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const saved = useFlowStore.getState().exportProjectFlowSnapshot();
    const savedRequester = saved.nodes.find((entry) => entry.id === 'request')!;
    expect(savedRequester.data).toMatchObject({
      url: 'https://example.test/data',
      method: 'PUT',
      headers: 'Content-Type: text/plain',
      body: 'safe request body',
    });
    expect(savedRequester.data.result).toBeUndefined();
    expect(savedRequester.data.resultHistory).toBeUndefined();

    useFlowStore.getState().replaceFlowSnapshot(saved);
    await useFlowStore.getState().runNode('run-me');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'PUT', body: 'safe request body' });
  });

  it('cancels a pending Requester stream and a retry delay without a second settlement or attempt', async () => {
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    const streamCancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markReadStarted();
        return new Promise<void>(() => undefined);
      },
      cancel() {
        streamCancel();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })));
    const streamController = new AbortController();
    const streamedRequest = executeNodeRequest(
      node('stream-request', 'apiFetchNode', {
        url: 'https://example.test/stream',
        declaredOutputType: 'text',
      }),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      {
        apiKeys: { openai: '', gemini: '', huggingface: '', elevenlabs: '' },
        defaultModels: DEFAULT_MODELS,
        providerSettings: DEFAULT_PROVIDER_SETTINGS,
      },
      undefined,
      { signal: streamController.signal },
    );
    streamedRequest.catch(() => undefined);
    await readStarted;
    streamController.abort();
    await expect(streamedRequest).rejects.toMatchObject({ name: 'AbortError' });
    expect(streamCancel).toHaveBeenCalledTimes(1);

    const delayController = new AbortController();
    let attempts = 0;
    const delayedRetry = withExponentialBackoff({
      operation: async () => {
        attempts += 1;
        throw new Error('retryable poll fault');
      },
      maxRetries: 3,
      baseDelayMs: 60_000,
      abortSignal: delayController.signal,
      onRetry: () => delayController.abort(),
    });
    await expect(delayedRetry).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it('invalidates a settling Requester on same-workspace replacement and permits a fresh replacement run', async () => {
    const firstResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValue(new Response('fresh response', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    useFlowStore.setState({
      nodes: [node('request', 'apiFetchNode', {
        url: 'https://example.test/replace',
        declaredOutputType: 'text',
      })],
      edges: [],
    });
    useFlowStore.getState().hydratePersistedState();

    const staleRun = useFlowStore.getState().runNode('request');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const replacement = useFlowStore.getState().exportProjectFlowSnapshot();
    useFlowStore.getState().replaceFlowSnapshot(replacement);
    firstResponse.resolve(new Response('late response', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    await staleRun;

    expect(useFlowStore.getState().nodes.find((entry) => entry.id === 'request')?.data.result).toBeUndefined();
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);
    await useFlowStore.getState().runNode('request');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useFlowStore.getState().nodes.find((entry) => entry.id === 'request')?.data.result).toBe('fresh response');
  });

  it('rolls back only the stale run Source item while recording its incurred usage once', async () => {
    executionHarness.override = async () => ({
      result: 'data:image/png;base64,U1RBTEU=',
      resultType: 'image',
      mimeType: 'image/png',
      statusMessage: 'late image',
      usage: { source: 'actual', confidence: 'fixed', costUsd: 0.04 },
    });
    const unrelated = await originalAddAssetItem({
      label: 'Unrelated run item',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,T1RIRVI=',
      originNodeId: 'other-node',
      originWorkspaceId: 'other-workspace',
      originRunId: 'other-run',
    });
    const nodeId = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      prompt: 'before',
    });
    useSourceBinStore.setState({
      addAssetItem: vi.fn(async (item, targetBinId, options) => {
        const added = await originalAddAssetItem(item, targetBinId, options);
        useFlowStore.getState().updateNodeData(nodeId, 'prompt', 'edited during Source publication');
        return added;
      }),
    });

    await useFlowStore.getState().runNode(nodeId);

    expect(useFlowStore.getState().nodes.find((entry) => entry.id === nodeId)?.data.result).toBeUndefined();
    expect(useSourceBinStore.getState().getAllItems().map((item) => item.id)).toEqual([unrelated.id]);
    expect(useProjectUsageStore.getState().ledger.entries).toHaveLength(1);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.costUsd).toBe(0.04);
  });
});
