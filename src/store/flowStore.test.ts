import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, NodeChange } from '@xyflow/react';
import { readFileSync } from 'node:fs';
import type { AppNode } from '../types/flow';
import { createDefaultEditorProfessionalWorkflowState } from '../types/videoProduction';
import {
  collectTextInputs as storeCollectTextInputs,
  collectImageMaskInput as storeCollectImageMaskInput,
  collectUpstreamImageInput as storeCollectUpstreamImageInput,
  collectUpstreamImageInputForHandles as storeCollectUpstreamImageInputForHandles,
  collectTextMediaInputs as storeCollectTextMediaInputs,
  canRunNode as storeCanRunNode,
  getExecutionDependencies as storeGetExecutionDependencies,
  buildExecutionContextForNode,
  sanitizePersistedFlowState,
} from './flowStore';
import { resolveFlowNodePorts } from '../lib/flowNodeContracts';
import { validateFlowConnection } from '../lib/flowConnectionContracts';
import {
  collectTextInputs as costCollectTextInputs,
  collectUpstreamImageInput as costCollectUpstreamImageInput,
  collectUpstreamImageInputForHandles as costCollectUpstreamImageInputForHandles,
  canRunNode as costCanRunNode,
} from '../lib/costEstimation';
import { useConfirmationStore } from './confirmationStore';
import { useFlowStore } from './flowStore';
import { useSourceBinStore } from './sourceBinStore';
import { useSettingsStore } from './settingsStore';
import { useProjectUsageStore } from './projectUsageStore';
import * as flowExecution from '../lib/flowExecution';
import { createDefaultFunctionNodeConfig } from '../lib/functionNodes';
import { API_REQUESTER_PERSISTED_CREDENTIAL_MARKER } from '../lib/apiRequesterCredentials';

function createNode(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

function buildNodeMap(nodes: AppNode[]): Map<string, AppNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function buildIncomingMap(edges: Edge[]): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = incoming.get(edge.target) ?? [];
    existing.push(edge.source);
    incoming.set(edge.target, existing);
  }
  return incoming;
}

describe('flow store package and envelope input gathering', () => {
  it('keeps durable named caption outputs in project snapshots without serializing runtime blobs', () => {
    useFlowStore.setState({
      nodes: [createNode('scribe', 'transcriptionNode', {
        namedOutputs: {
          'captions-vtt': {
            result: 'signal-loom-asset://caption-1',
            resultType: 'text',
            assetKind: 'subtitle',
            sourceBinItemId: 'caption-1',
            mimeType: 'text/vtt',
            blob: new Blob(['WEBVTT'], { type: 'text/vtt' }),
          },
        },
      })],
      edges: [],
    });

    const output = useFlowStore.getState().exportProjectFlowSnapshot().nodes[0]?.data.namedOutputs?.['captions-vtt'];
    expect(output).toMatchObject({
      result: 'signal-loom-asset://caption-1',
      assetKind: 'subtitle',
      sourceBinItemId: 'caption-1',
    });
    expect(output?.blob).toBeUndefined();
  });

  it('carries a persisted, validated caption embedding plan into composition execution context', () => {
    const workflow = {
      ...createDefaultEditorProfessionalWorkflowState(),
      captionEmbedding: { enabled: true, trackId: 'english' },
      captionTracks: [{
        id: 'english', name: 'English', language: 'eng', service: 'captions' as const, style: {},
        cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Embedded caption' }],
      }],
    };
    const composition = createNode('composition-1', 'composition', {
      videoFrameRate: 30,
      editorProfessionalWorkflowState: workflow,
      editorExportPresetPlan: { presetId: 'review-h264-1080p' },
    });

    // The normal saved-project sanitizer keeps the semantic caption record; the execution seam
    // must rebuild the exact selected plan after reopen rather than relying on live component state.
    const reopened = sanitizePersistedFlowState({ nodes: [composition], edges: [], bookmarkSidebarOpen: true });
    const restoredComposition = reopened.nodes[0]!;
    const context = buildExecutionContextForNode(restoredComposition, reopened.nodes, reopened.edges);

    expect(context.captionEmbedding).toEqual({
      ok: true,
      value: expect.objectContaining({
        format: 'mov_text', language: 'eng', trackId: 'english', cueCount: 1,
      }),
    });
  });

  it('deduplicates Composition audio migration warnings while sanitizing local persisted state', () => {
    const sanitized = sanitizePersistedFlowState({
      nodes: [createNode('composition-1', 'composition', {
        compositionAudioMigrationWarnings: [
          { handle: 'composition-audio-9', reason: 'overflow', message: 'First local warning.' },
          { handle: 'composition-audio-9', reason: 'overflow', message: 'Duplicate local warning.' },
        ],
      })],
      edges: [],
      bookmarkSidebarOpen: true,
    });

    expect(sanitized.nodes[0].data.compositionAudioMigrationWarnings).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'First local warning.' },
    ]);
  });

  it('persists bounded mixer buses into the execution route after project reopen', () => {
    const restored = sanitizePersistedFlowState({
      nodes: [createNode('composition-1', 'composition', {
        editorProfessionalState: {
          version: 1,
          audioBuses: [
            { id: 'master', name: 'Master', kind: 'master', gainDb: 0, pan: 0, muted: false, solo: false },
            { id: 'dialogue', name: 'Dialogue', kind: 'submix', outputBusId: 'master', gainDb: -4, pan: 0.25, muted: false, solo: false },
          ],
        },
      })],
      edges: [],
    });
    const composition = restored.nodes[0]!;
    const context = buildExecutionContextForNode(composition, restored.nodes, restored.edges);

    expect(context.sequenceAudioMixerBuses).toEqual([
      expect.objectContaining({ id: 'master', pan: 0 }),
      expect.objectContaining({ id: 'dialogue', gainDb: -4, pan: 0.25 }),
    ]);
  });

  it('classifies API Requester as runnable and recursively reaches it from Run Me exactly once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    useConfirmationStore.setState({ requestConfirmation: vi.fn().mockResolvedValue(true) });
    useFlowStore.setState({
      nodes: [
        createNode('request', 'apiFetchNode', {
          url: 'https://example.test/data',
          declaredOutputType: 'text',
        }),
        createNode('run-me', 'runMeNode'),
      ],
      edges: [{ id: 'request-run-me', source: 'request', target: 'run-me' }],
    });
    useFlowStore.getState().hydratePersistedState();

    const request = useFlowStore.getState().nodes.find((node) => node.id === 'request')!;
    expect(storeCanRunNode(request)).toBe(true);
    expect(storeGetExecutionDependencies(
      useFlowStore.getState().nodes.find((node) => node.id === 'run-me')!,
      useFlowStore.getState().edges,
      buildNodeMap(useFlowStore.getState().nodes),
    )).toEqual(['request']);

    await useFlowStore.getState().runNode('run-me');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'request')?.data).toMatchObject({
      result: '{"ok":true}',
      resultType: 'text',
      usage: { source: 'actual', confidence: 'unknown' },
    });
    expect(useSourceBinStore.getState().getAllItems().filter((item) => item.originNodeId === 'request')).toEqual([]);
  });

  it('redacts URL userinfo and credential fields from browser export and Electron project snapshots without overredacting creative fields', () => {
    useFlowStore.setState({
      nodes: [createNode('request', 'apiFetchNode', {
        url: 'https://alice:top-secret@example.test/data?client_secret=client-secret&refresh_token=refresh-secret&colorToken=teal&cameraToken=close-up',
        headers: 'Authorization: Bearer top-secret\nApi-Key: api-key-secret\nX-Client-Secret: client-secret\nX-Trace: safe',
        body: '{"prompt":"keep [redacted] editorial text safe","apiKey":"body-api-secret","nested":{"client_secret":"body-client-secret","refresh_token":"body-refresh-secret"},"colorToken":"teal","cameraToken":"close-up"}',
      })],
      edges: [],
    });

    const exported = useFlowStore.getState().exportFlow();
    const snapshot = useFlowStore.getState().exportProjectFlowSnapshot();
    expect(exported).not.toContain('top-secret');
    expect(exported).not.toContain('api-key-secret');
    expect(exported).not.toContain('client-secret');
    expect(exported).not.toContain('body-api-secret');
    expect(exported).not.toContain('body-client-secret');
    expect(exported).not.toContain('body-refresh-secret');
    expect(exported).not.toContain('refresh-secret');
    expect(snapshot.nodes[0]?.data).toMatchObject({
      headers: `Authorization: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}\nApi-Key: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}\nX-Client-Secret: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}\nX-Trace: safe`,
    });
    const persistedUrl = new URL(String(snapshot.nodes[0]?.data.url));
    expect(persistedUrl.username).toBe(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
    expect(persistedUrl.password).toBe(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
    expect(persistedUrl.searchParams.get('client_secret')).toBe(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
    expect(persistedUrl.searchParams.get('refresh_token')).toBe(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
    expect(persistedUrl.searchParams.get('colorToken')).toBe('teal');
    expect(persistedUrl.searchParams.get('cameraToken')).toBe('close-up');
    expect(snapshot.nodes[0]?.data.body).toContain('"prompt":"keep [redacted] editorial text safe"');
    expect(snapshot.nodes[0]?.data.body).toContain('"colorToken":"teal"');
    expect(snapshot.nodes[0]?.data.body).toContain('"cameraToken":"close-up"');
    expect(snapshot.nodes[0]?.data.body).toContain(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
  });

  it('redacts credential-like form fields while keeping safe persisted request fields intact', () => {
    useFlowStore.setState({
      nodes: [createNode('request', 'apiFetchNode', {
        url: 'https://example.test/data',
        headers: 'X-Trace: safe',
        body: 'prompt=keep+this&api_key=form-secret&clientSecret=client-secret',
      })],
      edges: [],
    });

    const exported = useFlowStore.getState().exportFlow();
    const snapshot = useFlowStore.getState().exportProjectFlowSnapshot();
    expect(exported).not.toContain('form-secret');
    expect(exported).not.toContain('client-secret');
    expect(snapshot.nodes[0]?.data.body).toBe(`prompt=keep+this&api_key=${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}&clientSecret=${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}`);
  });

  it('redacts credential-shaped dynamic model-card values from every project/export path', () => {
    useFlowStore.setState({
      nodes: [createNode('portable-card', 'textNode', {
        modelCardValues: {
          prompt: 'keep this creative prompt',
          api_key: 'dynamic-secret',
          accessToken: 'dynamic-token',
        },
      })],
      edges: [],
    });

    const browserExport = useFlowStore.getState().exportFlow();
    const snapshot = useFlowStore.getState().exportProjectFlowSnapshot();
    expect(browserExport).not.toContain('dynamic-secret');
    expect(browserExport).not.toContain('dynamic-token');
    expect(snapshot.nodes[0].data.modelCardValues).toEqual({
      prompt: 'keep this creative prompt',
      api_key: API_REQUESTER_PERSISTED_CREDENTIAL_MARKER,
      accessToken: API_REQUESTER_PERSISTED_CREDENTIAL_MARKER,
    });
  });

  it('reopens persisted requester credentials fail-closed without retaining executable secrets', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useConfirmationStore.setState({ requestConfirmation: vi.fn().mockResolvedValue(true) });
    useFlowStore.setState({
      nodes: [
        createNode('request', 'apiFetchNode', {
          url: 'https://example.test/data',
          headers: 'Api-Key: browser-and-electron-secret',
          declaredOutputType: 'text',
        }),
        createNode('run-me', 'runMeNode'),
      ],
      edges: [{ id: 'request-run', source: 'request', target: 'run-me' }],
    });

    // Browser export and the Electron project-save snapshot share the persistence projection.
    const browserExport = useFlowStore.getState().exportFlow();
    const electronSnapshot = useFlowStore.getState().exportProjectFlowSnapshot();
    expect(browserExport).not.toContain('browser-and-electron-secret');
    expect(JSON.stringify(electronSnapshot)).not.toContain('browser-and-electron-secret');

    useFlowStore.getState().replaceFlowSnapshot(electronSnapshot);
    await useFlowStore.getState().runNode('run-me');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'request')?.data.error)
      .toContain('Replace each redacted value');
  });

  it('resets stale running state only during hydration while restoring runtime callbacks', () => {
    useFlowStore.setState({
      nodes: [createNode('request', 'apiFetchNode', {
        url: 'https://example.test/data',
        isRunning: true,
      })],
      edges: [],
    });

    useFlowStore.getState().hydratePersistedState();
    const request = useFlowStore.getState().nodes[0]!;
    expect(request.data.isRunning).toBe(false);
    expect(request.data.onRun).toEqual(expect.any(Function));
  });

  it('keeps a live request visibly running, rejects a duplicate click, and exposes cancellation state', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    useConfirmationStore.setState({ requestConfirmation: vi.fn().mockResolvedValue(true) });
    useFlowStore.setState({ nodes: [createNode('request', 'apiFetchNode', {
      url: 'https://example.test/data', declaredOutputType: 'text', provider: 'api-running-test',
    }), createNode('run-me', 'runMeNode')], edges: [{ id: 'request-run', source: 'request', target: 'run-me' }] });
    useFlowStore.getState().hydratePersistedState();

    const first = useFlowStore.getState().runNode('run-me');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'request')?.data.isRunning).toBe(true);
    expect(useFlowStore.getState().nodes[0]?.data.onRun).toEqual(expect.any(Function));

    const second = useFlowStore.getState().runNode('run-me');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    useFlowStore.getState().cancelNodeRun('request');
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'request')?.data.statusMessage).toBe('Cancelling run…');

    resolveFetch?.(new Response('cancelled too late', { status: 200 }));
    await Promise.all([first, second]);
  });

  it('executes a real Function-output diamond once per root run but never reuses the prior root run', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('shared', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    useConfirmationStore.setState({ requestConfirmation: vi.fn().mockResolvedValue(true) });
    const functionA = createDefaultFunctionNodeConfig('Function A');
    const functionB = createDefaultFunctionNodeConfig('Function B');
    functionA.contract.outputPorts[0]!.resultType = 'text';
    functionB.contract.outputPorts[0]!.resultType = 'text';
    useFlowStore.setState({
      nodes: [
        createNode('request', 'apiFetchNode', { url: 'https://example.test/data', declaredOutputType: 'text', provider: 'api-diamond-test' }),
        createNode('function-a', 'functionNode', { functionNode: functionA, result: 'retained Function A output' }),
        createNode('function-b', 'functionNode', { functionNode: functionB, result: 'retained Function B output' }),
        createNode('run-me', 'runMeNode'),
      ],
      edges: [
        { id: 'request-a', source: 'request', target: 'function-a', targetHandle: 'input-flow' },
        { id: 'request-b', source: 'request', target: 'function-b', targetHandle: 'input-flow' },
        { id: 'a-run', source: 'function-a', sourceHandle: 'output-result', target: 'run-me' },
        { id: 'b-run', source: 'function-b', sourceHandle: 'output-result', target: 'run-me' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    await useFlowStore.getState().runNode('run-me');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await useFlowStore.getState().runNode('run-me');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('correctly resolves text and image payloads from an upstream packageNode connected to an imageGen', () => {
    const nodes = [
      createNode('text-1', 'textNode', {
        mode: 'prompt',
        prompt: 'A majestic blue butterfly on a rose',
      }),
      createNode('image-1', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,STYLEIMAGE',
        modelId: 'image-model',
      }),
      createNode('pkg-1', 'packageNode', {
        customTitle: 'Butterfly Preset',
      }),
      createNode('target-gen', 'imageGen', {}),
    ];

    const edges: Edge[] = [
      { id: 'edge-text', source: 'text-1', target: 'pkg-1', targetHandle: 'text' },
      { id: 'edge-image', source: 'image-1', target: 'pkg-1', targetHandle: 'image' },
      { id: 'edge-pkg', source: 'pkg-1', target: 'target-gen', targetHandle: 'image-edit-source' },
    ];

    const nodesById = buildNodeMap(nodes);
    const incoming = buildIncomingMap(edges);

    // 1. Verify flowStore versions
    const storePrompt = storeCollectTextInputs('target-gen', nodesById, incoming, edges);
    const storeImg = storeCollectUpstreamImageInput('target-gen', nodesById, edges);

    expect(storePrompt).toBe('A majestic blue butterfly on a rose');
    expect(storeImg).toBe('data:image/png;base64,STYLEIMAGE');

    // 2. Verify costEstimation versions
    const costPrompt = costCollectTextInputs('target-gen', nodesById, incoming, edges);
    const costImg = costCollectUpstreamImageInput('target-gen', nodesById, edges);

    expect(costPrompt).toBe('A majestic blue butterfly on a rose');
    expect(costImg).toBe('data:image/png;base64,STYLEIMAGE');
  });

  it('extracts both parts of a Doodle package when connected to an Image reference port', () => {
    const nodes = [
      createNode('doodle', 'doodleNode', {
        doodleDescription: 'blue-pencil fox pose',
        doodleSketch: 'data:image/png;base64,DOODLE',
      }),
      createNode('target-gen', 'imageGen'),
    ];
    const edges: Edge[] = [
      { id: 'doodle-reference', source: 'doodle', target: 'target-gen', targetHandle: 'image-reference-1' },
    ];
    const nodesById = buildNodeMap(nodes);
    const incoming = buildIncomingMap(edges);

    expect(storeCollectTextInputs('target-gen', nodesById, incoming, edges)).toContain('blue-pencil fox pose');
    expect(storeCollectUpstreamImageInputForHandles('target-gen', ['image-reference-1'], nodesById, edges))
      .toBe('data:image/png;base64,DOODLE');
    expect(costCollectTextInputs('target-gen', nodesById, incoming, edges)).toContain('blue-pencil fox pose');
    expect(costCollectUpstreamImageInputForHandles('target-gen', ['image-reference-1'], nodesById, edges))
      .toBe('data:image/png;base64,DOODLE');
  });

  it('correctly resolves text and image payloads from an upstream envelope with individual text and image items', () => {
    const nodes = [
      createNode('envelope-1', 'envelope', {
        envelopeItems: [
          {
            id: 'item-text',
            index: 0,
            kind: 'text',
            label: 'Prompt',
            value: 'Detailed cybernetic forest, neon lighting',
          },
          {
            id: 'item-img',
            index: 1,
            kind: 'image',
            label: 'Layout Guide',
            value: 'data:image/png;base64,LAYOUTIMAGE',
          },
        ],
      }),
      createNode('target-gen', 'imageGen', {}),
    ];

    const edges: Edge[] = [
      { id: 'edge-env', source: 'envelope-1', target: 'target-gen', targetHandle: 'image-edit-source' },
    ];

    const nodesById = buildNodeMap(nodes);
    const incoming = buildIncomingMap(edges);

    // 1. Verify flowStore versions
    const storePrompt = storeCollectTextInputs('target-gen', nodesById, incoming, edges);
    const storeImg = storeCollectUpstreamImageInput('target-gen', nodesById, edges);

    expect(storePrompt).toBe('Detailed cybernetic forest, neon lighting');
    expect(storeImg).toBe('data:image/png;base64,LAYOUTIMAGE');

    // 2. Verify costEstimation versions
    const costPrompt = costCollectTextInputs('target-gen', nodesById, incoming, edges);
    const costImg = costCollectUpstreamImageInput('target-gen', nodesById, edges);

    expect(costPrompt).toBe('Detailed cybernetic forest, neon lighting');
    expect(costImg).toBe('data:image/png;base64,LAYOUTIMAGE');
  });

  it('correctly resolves text and image payloads from an upstream envelope containing a package item', () => {
    const nodes = [
      createNode('envelope-1', 'envelope', {
        envelopeItems: [
          {
            id: 'item-package',
            index: 0,
            kind: 'package',
            label: 'Cyber Preset',
            value: 'data:image/png;base64,CYBERIMAGE',
            text: 'Cyberpunk street view, volumetric fog',
          },
        ],
      }),
      createNode('target-gen', 'imageGen', {}),
    ];

    const edges: Edge[] = [
      { id: 'edge-env', source: 'envelope-1', target: 'target-gen', targetHandle: 'image-edit-source' },
    ];

    const nodesById = buildNodeMap(nodes);
    const incoming = buildIncomingMap(edges);

    // 1. Verify flowStore versions
    const storePrompt = storeCollectTextInputs('target-gen', nodesById, incoming, edges);
    const storeImg = storeCollectUpstreamImageInput('target-gen', nodesById, edges);

    expect(storePrompt).toBe('Cyberpunk street view, volumetric fog');
    expect(storeImg).toBe('data:image/png;base64,CYBERIMAGE');

    // 2. Verify costEstimation versions
    const costPrompt = costCollectTextInputs('target-gen', nodesById, incoming, edges);
    const costImg = costCollectUpstreamImageInput('target-gen', nodesById, edges);

    expect(costPrompt).toBe('Cyberpunk street view, volumetric fog');
    expect(costImg).toBe('data:image/png;base64,CYBERIMAGE');
  });

  it('correctly asserts that packageNode and envelope are not executable nodes', () => {
    const pkgNode = createNode('pkg-1', 'packageNode');
    const envNode = createNode('env-1', 'envelope');
    const imgGenNode = createNode('img-1', 'imageGen', { mediaMode: 'generate' });

    expect(storeCanRunNode(pkgNode)).toBe(false);
    expect(storeCanRunNode(envNode)).toBe(false);
    expect(storeCanRunNode(imgGenNode)).toBe(true);

    expect(costCanRunNode(pkgNode)).toBe(false);
    expect(costCanRunNode(envNode)).toBe(false);
    expect(costCanRunNode(imgGenNode)).toBe(true);
  });

  it('resolves every declared direct image output for image and multimodal-text consumers', () => {
    const nodes = [
      createNode('slimg', 'slimgNode', { result: 'data:image/png;base64,SLIMG', resultMimeType: 'image/png' }),
      createNode('editor', 'advancedImageEditor', { result: 'data:image/png;base64,EDITOR' }),
      createNode('function', 'functionNode', { resultType: 'image', result: 'data:image/png;base64,FUNCTION', resultMimeType: 'image/png' }),
      createNode('image-target', 'imageGen'),
      createNode('text-target', 'textNode', { mode: 'generate', provider: 'gemini', modelId: 'gemini-3.5-flash' }),
    ];
    const edges: Edge[] = [
      { id: 'editor-image', source: 'editor', sourceHandle: 'editedImage', target: 'image-target', targetHandle: 'image-edit-source' },
      { id: 'slimg-text', source: 'slimg', target: 'text-target' },
      { id: 'function-text', source: 'function', target: 'text-target' },
    ];
    const nodesById = buildNodeMap(nodes);

    expect(storeCollectUpstreamImageInputForHandles('image-target', ['image-edit-source'], nodesById, edges))
      .toBe('data:image/png;base64,EDITOR');
    expect(storeCollectTextMediaInputs(nodes[4], nodesById, edges).map((input) => input.url)).toEqual([
      'data:image/png;base64,SLIMG',
      'data:image/png;base64,FUNCTION',
    ]);
  });

  it('discovers every runnable upstream dependency without node-type allowlist gaps', () => {
    const nodes = [
      createNode('description', 'textNode', { mode: 'generate' }),
      createNode('reference', 'imageGen', { mediaMode: 'generate' }),
      createNode('package', 'packageNode'),
      createNode('target', 'videoGen', { mediaMode: 'generate' }),
    ];
    const edges: Edge[] = [
      { id: 'description-package', source: 'description', target: 'package', targetHandle: 'text' },
      { id: 'reference-package', source: 'reference', target: 'package', targetHandle: 'image' },
      { id: 'package-target', source: 'package', target: 'target', targetHandle: 'video-reference-1' },
    ];

    expect(storeGetExecutionDependencies(nodes[3], edges, buildNodeMap(nodes)).sort())
      .toEqual(['description', 'reference']);
  });

  it('treats color swatches as textual prompt context instead of image inputs', () => {
    const nodes = [
      createNode('swatch-1', 'colorSwatchNode' as AppNode['type'], {
        colorSwatchColors: ['#0f172a', '#38bdf8'],
        colorSwatchUsageMode: 'theme',
      }),
      createNode('target-gen', 'imageGen', {}),
    ];

    const edges: Edge[] = [
      { id: 'edge-swatch', source: 'swatch-1', target: 'target-gen', targetHandle: 'image-edit-source' },
    ];

    const nodesById = buildNodeMap(nodes);
    const incoming = buildIncomingMap(edges);

    const expectedPrompt =
      'Color swatch: #0F172A, #38BDF8. Follow this palette as the overall mood and theme while allowing supporting neutrals.';

    expect(storeCollectTextInputs('target-gen', nodesById, incoming, edges)).toBe(expectedPrompt);
    expect(costCollectTextInputs('target-gen', nodesById, incoming, edges)).toBe(expectedPrompt);
    expect(storeCollectUpstreamImageInput('target-gen', nodesById, edges)).toBeUndefined();
    expect(costCollectUpstreamImageInput('target-gen', nodesById, edges)).toBeUndefined();
    expect(storeCanRunNode(nodes[0])).toBe(false);
    expect(costCanRunNode(nodes[0])).toBe(false);
  });

  it('uses node-painted masks for mask-aware image nodes when no mask is connected', () => {
    const nodes = [
      createNode('target-gen', 'imageGen', {
        provider: 'stability',
        modelId: 'stable-image-edit-inpaint',
        imageOperation: 'mask-inpaint',
        imagePaintedMaskDataUrl: 'data:image/png;base64,UEFJTlRFRA==',
      }),
    ];

    expect(storeCollectImageMaskInput('target-gen', buildNodeMap(nodes), [])).toBe(
      'data:image/png;base64,UEFJTlRFRA==',
    );
  });

  it('keeps connected masks ahead of node-painted masks', () => {
    const nodes = [
      createNode('mask-source', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,Q09OTkVDVEVE',
      }),
      createNode('target-gen', 'imageGen', {
        provider: 'openai',
        modelId: 'gpt-image-2',
        imagePaintedMaskDataUrl: 'data:image/png;base64,UEFJTlRFRA==',
      }),
    ];
    const edges: Edge[] = [
      { id: 'mask-edge', source: 'mask-source', target: 'target-gen', targetHandle: 'image-mask' },
    ];

    expect(storeCollectImageMaskInput('target-gen', buildNodeMap(nodes), edges)).toBe(
      'data:image/png;base64,Q09OTkVDVEVE',
    );
  });

  it('does not submit node-painted masks for outpaint-only image nodes', () => {
    const nodes = [
      createNode('target-gen', 'imageGen', {
        provider: 'stability',
        modelId: 'stable-image-edit-outpaint',
        imageOperation: 'outpaint',
        imagePaintedMaskDataUrl: 'data:image/png;base64,UEFJTlRFRA==',
      }),
    ];

    expect(storeCollectImageMaskInput('target-gen', buildNodeMap(nodes), [])).toBeUndefined();
  });

  it('treats crop image nodes as runnable image producers for downstream image inputs', () => {
    const nodes = [
      createNode('source-image', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,U09VUkNF',
      }),
      createNode('crop-1', 'cropImageNode' as AppNode['type'], {
        result: 'data:image/png;base64,Q1JPUFBFRA==',
        resultType: 'image',
      }),
      createNode('target-gen', 'imageGen', {}),
    ];
    const edges: Edge[] = [
      { id: 'source-crop', source: 'source-image', target: 'crop-1', targetHandle: 'image' },
      { id: 'crop-target', source: 'crop-1', target: 'target-gen', targetHandle: 'image-edit-source' },
    ];

    expect(storeCanRunNode(nodes[1])).toBe(true);
    expect(costCanRunNode(nodes[1])).toBe(true);
    expect(storeCollectUpstreamImageInput('target-gen', buildNodeMap(nodes), edges)).toBe(
      'data:image/png;base64,Q1JPUFBFRA==',
    );
    expect(costCollectUpstreamImageInput('target-gen', buildNodeMap(nodes), edges)).toBe(
      'data:image/png;base64,Q1JPUFBFRA==',
    );
  });

  it('correctly resolves subject image and reference image inputs for visionVerifyNode', () => {
    const nodes = [
      createNode('subject-img', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,SUBJECT_DATA',
      }),
      createNode('reference-img', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,REFERENCE_DATA',
      }),
      createNode('verify-node', 'visionVerifyNode', {}),
    ];

    const edges: Edge[] = [
      { id: 'edge-sub', source: 'subject-img', target: 'verify-node', targetHandle: 'image' },
      { id: 'edge-ref', source: 'reference-img', target: 'verify-node', targetHandle: 'refImage' },
    ];

    const nodesById = buildNodeMap(nodes);

    // 1. Verify flowStore versions
    const storeSubject = storeCollectUpstreamImageInput('verify-node', nodesById, edges);
    const storeRef = storeCollectUpstreamImageInputForHandles('verify-node', ['refImage'], nodesById, edges);

    expect(storeSubject).toBe('data:image/png;base64,SUBJECT_DATA');
    expect(storeRef).toBe('data:image/png;base64,REFERENCE_DATA');

    // 2. Verify costEstimation versions
    const costSubject = costCollectUpstreamImageInput('verify-node', nodesById, edges);
    const costRef = costCollectUpstreamImageInputForHandles('verify-node', ['refImage'], nodesById, edges);

    expect(costSubject).toBe('data:image/png;base64,SUBJECT_DATA');
    expect(costRef).toBe('data:image/png;base64,REFERENCE_DATA');
  });
});

describe('flow store typed connections', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  });

  it('rejects a newly drawn incompatible edge and explains the target error', () => {
    useFlowStore.setState({
      nodes: [createNode('number', 'numberNode'), createNode('target', 'regexReplaceNode')],
    });

    useFlowStore.getState().onConnect({
      source: 'number',
      sourceHandle: null,
      target: 'target',
      targetHandle: null,
    });

    expect(useFlowStore.getState().edges).toEqual([]);
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'target')?.data.error)
      .toContain('number cannot connect to text');
  });

  it('accepts and annotates a compatible edge', () => {
    useFlowStore.setState({
      nodes: [createNode('text', 'textNode'), createNode('target', 'regexReplaceNode')],
    });

    useFlowStore.getState().onConnect({
      source: 'text',
      sourceHandle: null,
      target: 'target',
      targetHandle: null,
    });

    expect(useFlowStore.getState().edges).toHaveLength(1);
    expect(useFlowStore.getState().edges[0].data).toMatchObject({
      flowContract: { valid: true, carriedType: { kind: 'text' } },
    });
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'target')?.data.error).toBeUndefined();
  });

  it('preserves but marks an incompatible edge loaded from a legacy saved flow', () => {
    useFlowStore.setState({
      nodes: [createNode('text', 'textNode'), createNode('target', 'cropImageNode')],
      edges: [{ id: 'legacy', source: 'text', target: 'target', targetHandle: 'image' }],
    });

    useFlowStore.getState().hydratePersistedState();

    expect(useFlowStore.getState().edges).toHaveLength(1);
    expect(useFlowStore.getState().edges[0]).toMatchObject({
      id: 'legacy',
      data: {
        flowContract: {
          valid: false,
          reason: 'text cannot connect to image or package or envelope<image> or envelope<package> or envelope<mixed>',
        },
      },
    });
  });
});

describe('flow store Composition audio track normalization (FBL-019)', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  });

  it('reopens a saved project with a stale count and an explicit track-3 edge exposing track 3 everywhere', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'e1', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-3' }],
    });

    useFlowStore.getState().hydratePersistedState();

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    // 1) restored node data
    expect(composition.data.compositionAudioTrackCount).toBe(3);
    // 2) contract
    const ports = resolveFlowNodePorts({
      node: composition,
      nodes: useFlowStore.getState().nodes,
      edges: useFlowStore.getState().edges,
    });
    expect(ports.filter((port) => port.direction === 'input' && port.id?.startsWith('composition-audio-')).map((port) => port.id))
      .toEqual(['composition-audio-1', 'composition-audio-2', 'composition-audio-3']);
    // 3) connection validation agrees track 3 is a real target (rejected only because the
    // single allowed connection on that handle is already the existing edge, not because the
    // handle is unrecognized)
    const revalidated = validateFlowConnection(
      { source: 'audio-1', sourceHandle: null, target: 'composition-1', targetHandle: 'composition-audio-3' },
      { nodes: useFlowStore.getState().nodes, edges: useFlowStore.getState().edges },
    );
    expect(revalidated.targetPort).toBeDefined();
    expect(revalidated.reason).not.toContain('is not available on this node');
    // 4) execution consumes track 3 exactly once
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);
    expect(context.audioInputs).toHaveLength(1);
    expect(context.audioInputs?.[0]).toMatchObject({ url: 'https://example.test/a1.mp3' });
  });

  it('normalizes at the supported track-4 boundary', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'e1', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-4' }],
    });

    useFlowStore.getState().hydratePersistedState();

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.compositionAudioTrackCount).toBe(4);
    const ports = resolveFlowNodePorts({
      node: composition,
      nodes: useFlowStore.getState().nodes,
      edges: useFlowStore.getState().edges,
    });
    expect(ports.filter((port) => port.direction === 'input' && port.id?.startsWith('composition-audio-')).map((port) => port.id))
      .toEqual(['composition-audio-1', 'composition-audio-2', 'composition-audio-3', 'composition-audio-4']);
  });

  it('assigns stable non-colliding handles to multiple legacy audio edges across repeated save/reopen while explicit handles stay fixed', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-explicit', 'audioGen', { result: 'https://example.test/explicit.mp3' }),
        createNode('audio-legacy-1', 'audioGen', { result: 'https://example.test/legacy1.mp3' }),
        createNode('audio-legacy-2', 'audioGen', { result: 'https://example.test/legacy2.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'explicit', source: 'audio-explicit', target: 'composition-1', targetHandle: 'composition-audio-2' },
        { id: 'legacy-1', source: 'audio-legacy-1', target: 'composition-1' },
        { id: 'legacy-2', source: 'audio-legacy-2', target: 'composition-1' },
      ],
    });

    useFlowStore.getState().hydratePersistedState();
    const firstEdges = useFlowStore.getState().edges;
    expect(firstEdges.find((edge) => edge.id === 'explicit')?.targetHandle).toBe('composition-audio-2');
    expect(firstEdges.find((edge) => edge.id === 'legacy-1')?.targetHandle).toBe('composition-audio-1');
    expect(firstEdges.find((edge) => edge.id === 'legacy-2')?.targetHandle).toBe('composition-audio-3');

    // Simulate reopening the just-saved project again: re-hydrating from the settled state must
    // be a byte-equivalent no-op (idempotent), not a second round of renumbering.
    useFlowStore.getState().hydratePersistedState();
    expect(useFlowStore.getState().edges).toEqual(firstEdges);
    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.compositionAudioTrackCount).toBe(3);
  });

  it('keeps a larger authored count visible after reopen and after its higher track disconnects', () => {
    useFlowStore.setState({
      nodes: [createNode('composition-1', 'composition', { compositionAudioTrackCount: 4 })],
      edges: [],
    });

    useFlowStore.getState().hydratePersistedState();
    expect(useFlowStore.getState().nodes[0]?.data.compositionAudioTrackCount).toBe(4);

    // Disconnecting (there was never a connected higher track in this case, but re-hydrating a
    // fully-disconnected composition must not shrink the authored count).
    useFlowStore.setState({ edges: [] });
    useFlowStore.getState().hydratePersistedState();
    expect(useFlowStore.getState().nodes[0]?.data.compositionAudioTrackCount).toBe(4);
  });

  it('clamps invalid, zero, fractional, and oversize saved counts deterministically without an update loop', () => {
    useFlowStore.setState({
      nodes: [
        createNode('zero', 'composition', { compositionAudioTrackCount: 0 }),
        createNode('fractional', 'composition', { compositionAudioTrackCount: 2.9 }),
        createNode('oversize', 'composition', { compositionAudioTrackCount: 99 }),
      ],
      edges: [],
    });

    useFlowStore.getState().hydratePersistedState();
    const byId = (id: string) => useFlowStore.getState().nodes.find((node) => node.id === id)!;
    expect(byId('zero').data.compositionAudioTrackCount).toBe(1);
    expect(byId('fractional').data.compositionAudioTrackCount).toBe(2);
    expect(byId('oversize').data.compositionAudioTrackCount).toBe(4);

    const settledNodes = useFlowStore.getState().nodes;
    useFlowStore.getState().hydratePersistedState();
    expect(useFlowStore.getState().nodes).toEqual(settledNodes);
  });

  it('rejects an explicit connection attempt to an out-of-range audio handle instead of hiding it behind the UI/contract', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
    });

    useFlowStore.getState().onConnect({
      source: 'audio-1',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: 'composition-audio-9',
    });

    expect(useFlowStore.getState().edges).toEqual([]);
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.error)
      .toContain('composition-audio-9');
  });

  it('collects per-track offset, volume, and enabled settings in normalized handle order without treating the video source as an audio lane', () => {
    useFlowStore.setState({
      nodes: [
        createNode('video-1', 'videoGen', { result: 'https://example.test/video.mp4' }),
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('audio-2', 'audioGen', { result: 'https://example.test/a2.mp3' }),
        createNode('composition-1', 'composition', {
          compositionAudioTrackCount: 2,
          compositionAudio1OffsetMs: 250,
          compositionAudio1Volume: 40,
          compositionAudio1Enabled: false,
          compositionAudio2OffsetMs: 500,
          compositionAudio2Volume: 80,
          compositionAudio2Enabled: true,
        }),
      ],
      edges: [
        { id: 'video-edge', source: 'video-1', target: 'composition-1', targetHandle: 'composition-video' },
        { id: 'a1', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-1' },
        { id: 'a2', source: 'audio-2', target: 'composition-1', targetHandle: 'composition-audio-2' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.videoInput).toBe('https://example.test/video.mp4');
    expect(context.audioInputs).toEqual([
      { url: 'https://example.test/a1.mp3', sourceNodeId: 'audio-1', delayMs: 250, volumePercent: 40, enabled: false },
      { url: 'https://example.test/a2.mp3', sourceNodeId: 'audio-2', delayMs: 500, volumePercent: 80, enabled: true },
    ]);
  });

  it('accepts a newly drawn connection onto an explicit higher track even though the saved count is stale (FBL-019 gap 1)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', {}),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [],
    });

    useFlowStore.getState().onConnect({
      source: 'audio-1',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: 'composition-audio-3',
    });

    const edges = useFlowStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ target: 'composition-1', targetHandle: 'composition-audio-3' });
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.error).toBeUndefined();
    // The persisted count settles to match the accepted connection, not just the dynamic contract.
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.compositionAudioTrackCount).toBe(3);
  });

  it('accepts a legacy (implicit-handle) connection normalized onto a track beyond the stale saved count (FBL-019 gap 1)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-existing', 'audioGen', {}),
        createNode('audio-new', 'audioGen', {}),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'existing', source: 'audio-existing', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });

    // No explicit targetHandle: normalizeCompositionConnectionTargetHandle assigns the next open
    // lane (track 2) before contract validation runs, even though the authored count is still 1.
    useFlowStore.getState().onConnect({
      source: 'audio-new',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: null,
    });

    const edges = useFlowStore.getState().edges;
    const newEdge = edges.find((edge) => edge.source === 'audio-new');
    expect(newEdge).toMatchObject({ targetHandle: 'composition-audio-2' });
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.error).toBeUndefined();
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.compositionAudioTrackCount).toBe(2);
  });

  it('settles a stale template-authored count against a template edge whose audio source has no media yet (FBL-019 gap 2)', () => {
    useFlowStore.setState({ nodes: [], edges: [] });

    useFlowStore.getState().insertTemplate(
      {
        nodes: [
          { id: 'audio-1', type: 'audioGen', position: { x: 0, y: 0 }, data: {} },
          { id: 'composition-1', type: 'composition', position: { x: 0, y: 0 }, data: { compositionAudioTrackCount: 1 } },
        ],
        edges: [
          { id: 'template-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-3' },
        ],
      },
      { x: 0, y: 0 },
    );

    const composition = useFlowStore.getState().nodes.find((node) => node.type === 'composition')!;
    expect(composition.data.compositionAudioTrackCount).toBe(3);
  });

  it('surfaces a bounded, durable node warning instead of silently dropping a persisted overflow handle on restore, not data.error', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'overflow-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' }],
    });

    useFlowStore.getState().hydratePersistedState();

    // The malformed/overflow edge is still not silently promoted into a real track...
    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'overflow-edge')).toBeUndefined();
    // ...but its rejection must be visible on the node via the durable, typed field, not data.error.
    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.error).toBeUndefined();
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: expect.stringContaining('composition-audio-9') },
    ]);
  });

  it('surfaces a bounded node warning for a dropped overflow handle when restoring a project snapshot, not data.error', () => {
    useFlowStore.setState({ nodes: [], edges: [] });

    useFlowStore.getState().replaceFlowSnapshot({
      version: 3,
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'overflow-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' }],
    });

    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'overflow-edge')).toBeUndefined();
    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.error).toBeUndefined();
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: expect.stringContaining('composition-audio-9') },
    ]);
  });

  it('drops every malformed/overflow persisted audio handle on hydration while keeping valid 1-4 and a legacy null handle intact (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-x', 'audioGen', {}),
        createNode('audio-neg', 'audioGen', {}),
        createNode('audio-frac', 'audioGen', {}),
        createNode('audio-zero', 'audioGen', {}),
        createNode('audio-overflow', 'audioGen', {}),
        createNode('audio-valid', 'audioGen', { result: 'https://example.test/valid.mp3' }),
        createNode('audio-legacy', 'audioGen', { result: 'https://example.test/legacy.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'e-x', source: 'audio-x', target: 'composition-1', targetHandle: 'composition-audio-x' },
        { id: 'e-neg', source: 'audio-neg', target: 'composition-1', targetHandle: 'composition-audio--1' },
        { id: 'e-frac', source: 'audio-frac', target: 'composition-1', targetHandle: 'composition-audio-1.5' },
        { id: 'e-zero', source: 'audio-zero', target: 'composition-1', targetHandle: 'composition-audio-0' },
        { id: 'e-overflow', source: 'audio-overflow', target: 'composition-1', targetHandle: 'composition-audio-9' },
        { id: 'e-valid', source: 'audio-valid', target: 'composition-1', targetHandle: 'composition-audio-1' },
        { id: 'e-legacy', source: 'audio-legacy', target: 'composition-1' },
      ],
    });

    useFlowStore.getState().hydratePersistedState();

    const edges = useFlowStore.getState().edges;
    for (const id of ['e-x', 'e-neg', 'e-frac', 'e-zero', 'e-overflow']) {
      expect(edges.find((edge) => edge.id === id)).toBeUndefined();
    }
    expect(edges.find((edge) => edge.id === 'e-valid')).toMatchObject({ targetHandle: 'composition-audio-1' });
    expect(edges.find((edge) => edge.id === 'e-legacy')).toMatchObject({ targetHandle: 'composition-audio-2' });

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const warnings = composition.data.compositionAudioMigrationWarnings!;
    expect(warnings).toHaveLength(5);
    expect(warnings.map((warning) => warning.reason).sort()).toEqual(['malformed', 'malformed', 'malformed', 'malformed', 'overflow']);
  });

  it('rejects overflow/malformed audio handles from a functionNode audio-producing source at hydration, matching audioGen (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-1', 'functionNode', { result: 'https://example.test/fn.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'fn-overflow', source: 'fn-1', target: 'composition-1', targetHandle: 'composition-audio-9' }],
    });

    useFlowStore.getState().hydratePersistedState();

    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'fn-overflow')).toBeUndefined();
    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: expect.stringContaining('composition-audio-9') },
    ]);
  });

  it('does not let an unrelated successful connection erase a persisted composition audio migration warning (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('audio-2', 'audioGen', {}),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'overflow-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' }],
    });

    useFlowStore.getState().hydratePersistedState();
    const warningsAfterHydrate = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.compositionAudioMigrationWarnings;
    expect(warningsAfterHydrate).toHaveLength(1);

    useFlowStore.getState().onConnect({
      source: 'audio-2',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: 'composition-audio-2',
    });

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.error).toBeUndefined();
    expect(composition.data.compositionAudioMigrationWarnings).toEqual(warningsAfterHydrate);
  });

  it('keeps a composition audio migration warning durable across local export/reopen and does not persist a general runtime error (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'overflow-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' }],
    });

    useFlowStore.getState().hydratePersistedState();

    const exported = JSON.parse(useFlowStore.getState().exportFlow());
    const compositionExport = exported.nodes.find((node: AppNode) => node.id === 'composition-1');
    expect(compositionExport.data.error).toBeUndefined();
    expect(compositionExport.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-9', reason: 'overflow' }),
    ]);
    expect(compositionExport.data.compositionAudioMigrationWarnings[0].message).toContain('composition-audio-9');

    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useFlowStore.getState().replaceFlowSnapshot({ version: 3, nodes: exported.nodes, edges: exported.edges });

    expect(useFlowStore.getState().edges.find((edge) => edge.targetHandle === 'composition-audio-9')).toBeUndefined();
    const reopened = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(reopened.data.compositionAudioMigrationWarnings).toEqual(compositionExport.data.compositionAudioMigrationWarnings);
  });

  it('keeps a composition audio migration warning durable across project/workspace snapshot export and reopen (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', { result: 'https://example.test/a1.mp3' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'overflow-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' }],
    });

    useFlowStore.getState().hydratePersistedState();

    const exported = useFlowStore.getState().exportProjectFlowSnapshot();
    const compositionExport = exported.nodes.find((node) => node.id === 'composition-1')!;
    expect(compositionExport.data.error).toBeUndefined();
    expect(compositionExport.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-9', reason: 'overflow' }),
    ]);

    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useFlowStore.getState().replaceFlowSnapshot(exported);

    const reopened = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(reopened.data.compositionAudioMigrationWarnings).toEqual(compositionExport.data.compositionAudioMigrationWarnings);
  });

  it('surfaces a composition audio migration warning when onEdgesChange adds a persisted overflow edge (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', {}),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [],
    });

    useFlowStore.getState().onEdgesChange([
      { type: 'add', item: { id: 'overflow-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' } },
    ]);

    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'overflow-edge')).toBeUndefined();
    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-9', reason: 'overflow' }),
    ]);
  });

  it('surfaces a composition audio migration warning when onEdgesChange replaces an edge with a malformed handle (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('audio-1', 'audioGen', {}),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [{ id: 'e1', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-1' }],
    });

    useFlowStore.getState().onEdgesChange([
      { type: 'replace', id: 'e1', item: { id: 'e1', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-x' } },
    ]);

    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'e1')).toBeUndefined();
    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-x', reason: 'malformed' }),
    ]);
  });

  it('surfaces a composition audio migration warning when a template ships a malformed persisted audio handle (FBL-019 correction)', () => {
    useFlowStore.setState({ nodes: [], edges: [] });

    useFlowStore.getState().insertTemplate(
      {
        nodes: [
          { id: 'audio-1', type: 'audioGen', position: { x: 0, y: 0 }, data: {} },
          { id: 'composition-1', type: 'composition', position: { x: 0, y: 0 }, data: { compositionAudioTrackCount: 1 } },
        ],
        edges: [
          { id: 'template-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-x' },
        ],
      },
      { x: 0, y: 0 },
    );

    const composition = useFlowStore.getState().nodes.find((node) => node.type === 'composition')!;
    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'template-edge')).toBeUndefined();
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-x', reason: 'malformed' }),
    ]);
  });

  it('surfaces a composition audio migration warning when pasting a clipboard-copied malformed audio edge (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        { ...createNode('audio-1', 'audioGen', {}), selected: true },
        { ...createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }), selected: true },
      ],
      edges: [{ id: 'malformed-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-x', selected: true }],
    });

    expect(useFlowStore.getState().copySelection()).toBe(true);
    expect(useFlowStore.getState().pasteClipboard({ x: 200, y: 200 })).toBe(true);

    const pastedComposition = useFlowStore.getState().nodes.find((node) => node.type === 'composition' && node.id !== 'composition-1')!;
    expect(useFlowStore.getState().edges.some((edge) => edge.target === pastedComposition.id)).toBe(false);
    expect(pastedComposition.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-x', reason: 'malformed' }),
    ]);
  });

  it('supplies a Function node whose effective result type is audio as the composition-audio-1 execution source (independent review correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-audio-1', 'functionNode', {
          resultType: 'audio',
          result: 'https://example.test/fn-audio.mp3',
          functionNode: createDefaultFunctionNodeConfig('Narration Function'),
        }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'e1', source: 'fn-audio-1', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.audioInputs).toHaveLength(1);
    expect(context.audioInputs?.[0]).toMatchObject({
      url: 'https://example.test/fn-audio.mp3',
      sourceNodeId: 'fn-audio-1',
    });
  });

  it('does not feed a wrong-family Function result (video) into the composition-audio-1 execution input (independent review correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-video-1', 'functionNode', {
          resultType: 'video',
          result: 'https://example.test/fn-video.mp4',
          functionNode: createDefaultFunctionNodeConfig('Video Function'),
        }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'e1', source: 'fn-video-1', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.audioInputs).toEqual([]);
  });

  it('supplies a correct-family Function result to the Composition video input (ultimate review correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-video-1', 'functionNode', {
          resultType: 'video',
          result: 'https://example.test/fn-video.mp4',
          functionNode: createDefaultFunctionNodeConfig('Rendered Function Video'),
        }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'e1', source: 'fn-video-1', target: 'composition-1', targetHandle: 'composition-video' },
      ],
    });

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.videoInput).toBe('https://example.test/fn-video.mp4');
  });

  it('does not feed a wrong-family Function audio result into the Composition video input (ultimate review correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-audio-1', 'functionNode', {
          resultType: 'audio',
          result: 'https://example.test/fn-audio.mp3',
          functionNode: createDefaultFunctionNodeConfig('Wrong-family Audio Function'),
        }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'e1', source: 'fn-audio-1', target: 'composition-1', targetHandle: 'composition-video' },
      ],
    });

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.videoInput).toBeUndefined();
  });

  it('supplies Function audio routed through a Portal to the Composition audio input (ultimate review correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-audio-1', 'functionNode', {
          resultType: 'audio',
          result: 'https://example.test/portal-function.mp3',
          functionNode: createDefaultFunctionNodeConfig('Portal Narration'),
        }),
        createNode('portal-entry', 'portal', { portalRole: 'entry', portalPairId: 'pair-1' }),
        createNode('portal-exit', 'portal', { portalRole: 'exit', portalPairId: 'pair-1' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'into-portal', source: 'fn-audio-1', target: 'portal-entry' },
        { id: 'out-of-portal', source: 'portal-exit', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.audioInputs?.[0]).toMatchObject({
      url: 'https://example.test/portal-function.mp3',
      sourceNodeId: 'fn-audio-1',
    });
  });

  it('does not feed Function audio from an inactive Fork output into Composition (ultimate review correction)', () => {
    useFlowStore.setState({
      nodes: [
        createNode('fn-audio-1', 'functionNode', {
          resultType: 'audio',
          result: 'https://example.test/inactive-function.mp3',
          functionNode: createDefaultFunctionNodeConfig('Inactive Fork Narration'),
        }),
        createNode('fork-1', 'forkSwitchNode', { selectedOutput: 'A' }),
        createNode('composition-1', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [
        { id: 'into-fork', source: 'fn-audio-1', target: 'fork-1', targetHandle: 'input' },
        { id: 'inactive-output', source: 'fork-1', sourceHandle: 'B', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });

    const composition = useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')!;
    const context = buildExecutionContextForNode(composition, useFlowStore.getState().nodes, useFlowStore.getState().edges);

    expect(context.audioInputs).toEqual([]);
  });
});

describe('flow store Boolean loop persistence', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      nativeSyncStatus: { state: 'idle' },
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([true, false])('serializes loop envelope %s but retains a Boolean node attempt', async (decision) => {
    vi.spyOn(flowExecution, 'executeNodeRequest').mockResolvedValue({
      result: decision,
      resultType: 'boolean',
      statusMessage: `Verified: ${decision ? 'TRUE' : 'FALSE'}`,
    });
    vi.spyOn(flowExecution, 'hashExecutionParameters').mockResolvedValue(`boolean-${decision}`);
    useFlowStore.setState({
      nodes: [
        createNode('decision', 'valueNode', { valueKind: 'boolean', value: decision }),
        createNode('decisions', 'list'),
        createNode('verify', 'functionNode', {
          functionNode: {
            title: 'Boolean loop sink',
            contract: {
              inputPorts: [{ id: 'decision-input', key: 'decision', label: 'Decision', resultType: 'any', required: true, order: 0 }],
              outputPorts: [{ id: 'decision-output', key: 'decision', label: 'Decision', resultType: 'boolean', required: true, order: 0 }],
            },
            graph: { nodes: [], edges: [] },
            inputBindings: [],
            outputBindings: [],
          },
        }),
      ],
      edges: [
        { id: 'decision-list', source: 'decision', target: 'decisions', targetHandle: 'list-item-0' },
        { id: 'list-verify', source: 'decisions', target: 'verify', targetHandle: 'decision-input' },
      ],
    });

    await useFlowStore.getState().runNode('verify');

    const verify = useFlowStore.getState().nodes.find((node) => node.id === 'verify')!;
    expect(verify.data).toMatchObject({ result: decision, resultType: 'boolean' });
    expect(verify.data.resultHistory?.[0]).toMatchObject({ result: decision, resultType: 'boolean' });
    expect(verify.data.envelopeItems?.[0]).toMatchObject({ value: String(decision), kind: 'boolean' });
  });
});

describe('Function multi-result persistence', () => {
  const originalApiKeys = useSettingsStore.getState().apiKeys;
  const originalProviderSettings = useSettingsStore.getState().providerSettings;

  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      nativeSyncStatus: { state: 'idle' },
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
    useProjectUsageStore.getState().restoreSnapshot(undefined);
    useSettingsStore.setState({
      apiKeys: { ...originalApiKeys, atlas: 'atlas-key' },
      providerSettings: {
        ...originalProviderSettings,
        atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        batchMaxRetries: 0,
      },
    });
  });

  afterEach(() => {
    useSettingsStore.setState({ apiKeys: originalApiKeys, providerSettings: originalProviderSettings });
    useProjectUsageStore.getState().restoreSnapshot(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stores each Function additional result once and attributes its provider usage once', async () => {
    const config = createDefaultFunctionNodeConfig('Atlas pair');
    config.contract.outputPorts = [{
      id: 'image-output', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0,
    }];
    config.graph = {
      version: 1,
      nodes: [
        createNode('atlas-prompt', 'textNode', { mode: 'prompt', prompt: 'two source-bin images' }),
        createNode('atlas-image', 'imageGen', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' }),
      ],
      edges: [{ id: 'atlas-prompt-to-image', source: 'atlas-prompt', target: 'atlas-image' }],
    };
    config.outputBindings = [{
      ...config.outputBindings[0], targetOutputPortId: 'image-output', sourceNodeId: 'atlas-image', resultType: 'image',
    }];
    useFlowStore.setState({ nodes: [createNode('function', 'functionNode', { functionNode: config })] });

    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('data:image/png;base64,UFJJTUFSWQ==')
      .mockReturnValueOnce('data:image/webp;base64,QURESVRJT05BTA==');
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/model/generateImage')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { outputs: [
          'https://cdn.atlascloud.ai/primary.png',
          'https://cdn.atlascloud.ai/additional.webp',
        ] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response(new Blob(['image'], {
        type: requestUrl.endsWith('.webp') ? 'image/webp' : 'image/png',
      }), { status: 200, headers: { 'content-type': requestUrl.endsWith('.webp') ? 'image/webp' : 'image/png' } }));
    }));

    await useFlowStore.getState().runNode('function');

    const items = useSourceBinStore.getState().getAllItems();
    const functionNode = useFlowStore.getState().nodes.find((node) => node.id === 'function');
    const ledger = useProjectUsageStore.getState().ledger.entries;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.mimeType).sort()).toEqual(['image/png', 'image/webp']);
    expect(items.every((item) => item.isGenerated === true && item.professional?.origin === 'generated')).toBe(true);
    expect(functionNode?.data.functionOutputs?.['image-output']).toMatchObject({
      resultType: 'image',
      mimeType: 'image/png',
      additionalResults: [{ mimeType: 'image/webp' }],
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      nodeId: 'atlas-image',
      provider: 'atlas',
      modelId: 'black-forest-labs/flux-schnell',
      imageCount: 2,
    });
  });
});

describe('Transcription named-output persistence', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      nativeSyncStatus: { state: 'idle' },
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
    useConfirmationStore.setState({ requestConfirmation: vi.fn().mockResolvedValue(true) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes VTT and SRT once and stores their durable Source Bin identities on the node', async () => {
    const vttBlob = new Blob(['WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n'], { type: 'text/vtt' });
    const srtBlob = new Blob(['1\n00:00:00,000 --> 00:00:01,000\nHello\n'], { type: 'application/x-subrip' });
    vi.spyOn(flowExecution, 'executeNodeRequest').mockResolvedValue({
      result: 'Hello',
      resultType: 'text',
      statusMessage: 'Transcribed',
      namedOutputs: {
        'transcript-text': { result: 'Hello', resultType: 'text' },
        'captions-vtt': { result: 'blob:vtt', resultType: 'text', assetKind: 'subtitle', mimeType: 'text/vtt', fileName: 'captions.vtt', blob: vttBlob },
        'captions-srt': { result: 'blob:srt', resultType: 'text', assetKind: 'subtitle', mimeType: 'application/x-subrip', fileName: 'captions.srt', blob: srtBlob },
      },
    });
    vi.spyOn(flowExecution, 'hashExecutionParameters').mockResolvedValue('scribe-run');
    useFlowStore.setState({
      nodes: [
        createNode('audio', 'audioGen', { mediaMode: 'import', sourceAssetUrl: 'data:audio/wav;base64,UklGRg==', sourceAssetMimeType: 'audio/wav' }),
        createNode('scribe', 'transcriptionNode'),
      ],
      edges: [{ id: 'audio-scribe', source: 'audio', target: 'scribe', targetHandle: 'media' }],
    });

    await useFlowStore.getState().runNode('scribe');

    const items = useSourceBinStore.getState().getAllItems();
    const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === 'scribe');
    expect(items.map((item) => item.kind)).toEqual(['subtitle', 'subtitle']);
    expect(items.map((item) => item.mimeType).sort()).toEqual(['application/x-subrip', 'text/vtt']);
    expect(items.every((item) => item.isGenerated === true && item.professional?.origin === 'generated')).toBe(true);
    expect(node?.data.namedOutputs?.['captions-vtt']?.sourceBinItemId).toBe(items.find((item) => item.mimeType === 'text/vtt')?.id);
    expect(node?.data.namedOutputs?.['captions-srt']?.sourceBinItemId).toBe(items.find((item) => item.mimeType === 'application/x-subrip')?.id);
  });
});

describe('flow store async confirmations', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [],
      edges: [],
      bookmarkSidebarOpen: true,
    });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      nativeSyncStatus: { state: 'idle' },
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
    useConfirmationStore.setState({ activeRequest: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the themed confirmation store instead of native confirm when node deletion would orphan generated assets', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(false);
    useConfirmationStore.setState({ requestConfirmation });
    const nativeConfirm = vi.fn(() => {
      throw new Error('Flow deletion should not use window.confirm');
    });
    vi.stubGlobal('window', { confirm: nativeConfirm });

    useFlowStore.setState({
      nodes: [createNode('image-node', 'imageGen', { result: 'data:image/png;base64,AAAA' })],
    });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'generated-asset',
          label: 'Generated image',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,AAAA',
          originNodeId: 'image-node',
          createdAt: 2,
          isGenerated: true,
        }],
      }],
    });

    await useFlowStore.getState().onNodesChange([
      { type: 'remove', id: 'image-node' } as NodeChange<AppNode>,
    ]);

    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.stringContaining('orphan 1 generated asset'),
      'Generated Asset Cleanup',
    );
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(1);
  });

  it('uses the themed confirmation store when selected nodes are deleted by keyboard or menu commands', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true);
    useConfirmationStore.setState({ requestConfirmation });

    useFlowStore.setState({
      nodes: [{
        ...createNode('image-node', 'imageGen', {
        result: 'data:image/png;base64,AAAA',
        }),
        selected: true,
      }],
    });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'generated-asset',
          label: 'Generated image',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,AAAA',
          originNodeId: 'image-node',
          createdAt: 2,
          isGenerated: true,
        }],
      }],
    });

    const deleted = await useFlowStore.getState().deleteSelection();

    expect(deleted).toBe(true);
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.stringContaining('orphan 1 generated asset'),
      'Generated Asset Cleanup',
    );
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);
  });

  it('does not reintroduce native confirm in Flow store guardrails', () => {
    const source = readFileSync(new URL('./flowStore.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('window.confirm');
  });
});
