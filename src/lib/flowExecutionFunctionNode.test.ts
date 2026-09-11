import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { executeNodeRequest } from './flowExecution';
import { buildCollapsedFunctionNode, createDefaultFunctionNodeConfig } from './functionNodes';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { buildNodeExecutionContext, flowFunctionNodeExecutionRuntime } from '../store/flowStore';
import type { AppNode, RuntimeSettingsSnapshot, UsageTelemetry } from '../types/flow';

// Collapsed functions execute internal text providers through the same dynamic import the
// canvas uses; capture the OpenAI chat call so tests can serve fresh internal text.
const openAiTextCapture = vi.hoisted(() => ({
  create: undefined as undefined | ((args: Record<string, unknown>) => Promise<unknown>),
  calls: [] as Array<Record<string, unknown>>,
}));
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async (args: Record<string, unknown>) => {
          openAiTextCapture.calls.push(args);
          if (!openAiTextCapture.create) {
            throw new Error('Test did not expect an OpenAI text call.');
          }
          return openAiTextCapture.create(args);
        },
      },
    };
  },
}));

const baseSettings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: '',
    openai: 'openai-key',
    atlas: '',
    huggingface: '',
    elevenlabs: '',
    bfl: 'bfl-key',
    stability: 'stability-key',
  },
  defaultModels: {
    text: {
      gemini: 'gemini-3-flash-preview',
      openai: 'gpt-4.1-mini',
      huggingface: 'Qwen/Qwen3-4B-Instruct-2507',
    },
    image: {
      gemini: 'gemini-3-pro-image-preview',
      openai: 'gpt-image-2',
      atlas: 'gpt-image-2',
      huggingface: 'black-forest-labs/FLUX.1-dev',
      bfl: 'flux-2-pro',
      stability: 'stable-image-core',
      localOpen: 'Qwen/Qwen-Image-Edit',
      android: 'local-dream-active',
      byteplus: 'seedream-4.5',
    },
    video: {
      gemini: 'veo-3.1-generate-preview',
      huggingface: 'Wan-AI/Wan2.2-T2V-A14B',
      atlas: 'google/veo3.1/text-to-video',
    },
    audio: {
      gemini: 'gemini-3.1-flash-tts-preview',
      elevenlabs: 'eleven_multilingual_v2',
      huggingface: 'hexgrad/Kokoro-82M',
    },
  },
  providerSettings: {
    openaiBaseUrl: '',
    elevenlabsVoiceId: '',
    renderBackendPreference: 'auto',
    exportCompositorPreference: 'stage',
    localNativeRenderUrl: 'http://127.0.0.1:41736',
    backendProxyEnabled: false,
    backendProxyBaseUrl: '',
    geminiCredentialMode: 'api-key',
    vertexAuthMode: 'gcloud-user',
    vertexProjectId: '',
    vertexLocation: 'global',
    vertexQuotaProjectId: '',
    vertexEnvironmentVariables: '',
    vertexServiceAccountJson: '',
    paperPrintUpscaleMethod: 'auto',
    paperPdfRasterPreset: 'balanced-jpeg',
    localOpenImageEndpointUrl: 'http://127.0.0.1:8188/signal-loom-image-edit',
    localOpenImageAuthHeader: '',
    localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
    batchMaxRetries: 10,
    batchRetryBaseDelayMs: 30000,
    androidLanServerEnabled: false,
    androidLanServerPin: '',
  },
};

const FROZEN_INTERNAL_IMAGE = 'data:image/png;base64,FROZENCOLLAPSETIMERESULT';

function node(id: string, type: AppNode['type'], data: AppNode['data'] = {}): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

function imageResponse(body: string): Response {
  return new Response(new Blob([body], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function functionNodeFor(config: ReturnType<typeof createDefaultFunctionNodeConfig>, id = 'fn-under-test'): AppNode {
  return node(id, 'functionNode', { functionNode: config });
}

/**
 * Collapse a selection through the production collapse path and hand back everything a
 * test needs to run the resulting function node through the real outer graph.
 */
function collapseFixture(nodes: AppNode[], edges: Edge[], title: string) {
  const collapsed = buildCollapsedFunctionNode({
    nodes,
    edges,
    createId: (prefix) => `${prefix}-1`,
    title,
  });

  if (!collapsed) {
    throw new Error(`Test fixture failed to collapse "${title}".`);
  }

  const config = collapsed.functionNode.data.functionNode;
  const inputPort = config?.contract.inputPorts[0];
  if (!config || !inputPort) {
    throw new Error(`Collapsed function "${title}" is missing its contract input port.`);
  }

  return {
    functionNode: collapsed.functionNode,
    config,
    inputPort,
    outerNodes: collapsed.nextNodes,
    outerEdges: collapsed.nextEdges,
  };
}

/**
 * Build the function node's ExecutionContext exactly the way runNode does — through the
 * store's real context builder over the post-collapse outer graph — after editing an
 * external prompt node to a new bound input.
 */
function buildOuterContextWithChangedInput(
  fixture: ReturnType<typeof collapseFixture>,
  promptNodeId: string,
  changedInput: string,
) {
  const outerNodes = fixture.outerNodes.map((entry) =>
    entry.id === promptNodeId
      ? { ...entry, data: { ...entry.data, prompt: changedInput } }
      : entry,
  );

  return buildNodeExecutionContext(fixture.functionNode, outerNodes, fixture.outerEdges);
}

/** External prompt → selected Stability image node with a result frozen at collapse time. */
function collapsePromptToImageFunction() {
  return collapseFixture(
    [
      node('prompt-src', 'textNode', { mode: 'prompt', prompt: 'a quiet harbor at dawn', resultType: 'text' }),
      {
        ...node('image-inside', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          result: FROZEN_INTERNAL_IMAGE,
          resultType: 'image',
        }),
        selected: true,
      },
      node('outside-view', 'sourceBin', {}),
    ],
    [
      { id: 'e-prompt', source: 'prompt-src', target: 'image-inside', sourceHandle: null, targetHandle: null },
      { id: 'e-out', source: 'image-inside', target: 'outside-view', sourceHandle: null, targetHandle: null },
    ],
    'Prompt to image',
  );
}

/** External prompt → selected OpenAI text node → selected Stability image node. */
function collapseTextThenImageFunction() {
  return collapseFixture(
    [
      node('prompt-src', 'textNode', { mode: 'prompt', prompt: 'a weathered lighthouse', resultType: 'text' }),
      {
        ...node('text-inside', 'textNode', {
          mode: 'generate',
          provider: 'openai',
          modelId: 'gpt-4.1-mini',
          prompt: '',
          result: 'stale internal text frozen at collapse',
          resultType: 'text',
        }),
        selected: true,
      },
      {
        ...node('image-inside', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          result: FROZEN_INTERNAL_IMAGE,
          resultType: 'image',
        }),
        selected: true,
      },
      node('outside-view', 'sourceBin', {}),
    ],
    [
      { id: 'e-prompt', source: 'prompt-src', target: 'text-inside', sourceHandle: null, targetHandle: null },
      { id: 'e-mid', source: 'text-inside', target: 'image-inside', sourceHandle: null, targetHandle: null },
      { id: 'e-out', source: 'image-inside', target: 'outside-view', sourceHandle: null, targetHandle: null },
    ],
    'Text then image',
  );
}

describe('executeNodeRequest collapsed reusable functions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    openAiTextCapture.create = undefined;
    openAiTextCapture.calls = [];
  });

  it('executes the internal provider subgraph with the current bound input instead of a frozen stored result', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:function-fresh-image');
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('FRESH'));
    vi.stubGlobal('fetch', fetchMock);

    const fixture = collapsePromptToImageFunction();
    const changedInput = 'a crimson fox leaping through snow';
    const context = buildOuterContextWithChangedInput(fixture, 'prompt-src', changedInput);
    expect(context.functionInputs?.[fixture.inputPort.id]).toBe(changedInput);

    const execution = await executeNodeRequest(
      fixture.functionNode,
      context,
      baseSettings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.stability.ai/v2beta/stable-image/generate/core');
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toBe(changedInput);

    expect(execution.result).toBe('blob:function-fresh-image');
    expect(execution.result).not.toBe(FROZEN_INTERNAL_IMAGE);
    expect(execution.resultType).toBe('image');
    expect(execution.usage).toMatchObject({ source: 'actual', costUsd: 0.03 });
    expect(execution.usage?.notes?.join(' ')).not.toContain('without provider spend');
  });

  it('resolves constant bindings and transforms before preparing the internal graph', async () => {
    const config = createDefaultFunctionNodeConfig('Constant input');
    config.contract.inputPorts = [{ id: 'input-marker-marker', key: 'subject', label: 'Subject', resultType: 'text', required: true, order: 0 }];
    config.inputBindings = [{
      id: 'constant-subject',
      targetInputPortId: 'input-marker-marker',
      source: { mode: 'constant', valueType: 'string', value: 'fox' },
      transforms: [{ id: 'prefix', kind: 'prefix', text: 'painted ' }],
      resultType: 'text',
      missing: { strategy: 'error' },
    }];
    config.graph = { version: 1, nodes: [node('marker', 'functionInputNode', { functionPortKey: 'subject' })], edges: [] };
    config.outputBindings[0] = { ...config.outputBindings[0], sourceNodeId: 'marker', resultType: 'text' };

    const execution = await executeNodeRequest(functionNodeFor(config), {
      prompt: 'ignored', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });

    expect(execution.result).toBe('painted fox');
  });

  it('retains each declared named output instead of aliasing the first result', async () => {
    const config = createDefaultFunctionNodeConfig('Two outputs');
    config.contract.outputPorts = [
      { id: 'first-output', key: 'first', label: 'First', resultType: 'text', required: true, order: 0 },
      { id: 'second-output', key: 'second', label: 'Second', resultType: 'text', required: true, order: 1 },
    ];
    config.graph = { version: 1, nodes: [
      node('first', 'textNode', { mode: 'prompt', prompt: 'FIRST' }),
      node('second', 'textNode', { mode: 'prompt', prompt: 'SECOND' }),
    ], edges: [] };
    config.outputBindings = [
      { ...config.outputBindings[0], targetOutputPortId: 'first-output', sourceNodeId: 'first', resultType: 'text' },
      { ...config.outputBindings[0], id: 'second-binding', targetOutputPortId: 'second-output', sourceNodeId: 'second', resultType: 'text' },
    ];

    const execution = await executeNodeRequest(functionNodeFor(config), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });

    expect(execution.result).toBe('FIRST');
    expect(execution.functionOutputs?.['second-output']?.result).toBe('SECOND');
  });

  it('routes Function outputs by source node and source handle while preserving no-handle defaults', async () => {
    const config = createDefaultFunctionNodeConfig('Editor image and mask');
    config.contract.outputPorts = [
      { id: 'image-output', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0 },
      { id: 'mask-output', key: 'mask', label: 'Mask', resultType: 'image', required: true, order: 1 },
    ];
    config.graph = {
      version: 1,
      nodes: [node('editor', 'advancedImageEditor', {
        result: 'data:image/png;base64,REVGQVVMVA==',
        maskOutput: 'data:image/png;base64,TUFTSw==',
      })],
      edges: [],
    };
    config.outputBindings = [
      {
        ...config.outputBindings[0],
        targetOutputPortId: 'image-output',
        sourceNodeId: 'editor',
        sourceHandle: undefined,
        resultType: 'image',
      },
      {
        ...config.outputBindings[0],
        id: 'mask-output-binding',
        targetOutputPortId: 'mask-output',
        sourceNodeId: 'editor',
        sourceHandle: 'maskOutput',
        resultType: 'image',
      },
    ];

    const execution = await executeNodeRequest(functionNodeFor(config), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings);

    expect(execution.result).toBe('data:image/png;base64,REVGQVVMVA==');
    expect(execution.functionOutputs?.['image-output']?.result).toBe('data:image/png;base64,REVGQVVMVA==');
    expect(execution.functionOutputs?.['mask-output']?.result).toBe('data:image/png;base64,TUFTSw==');
  });

  it('preserves source-handle identity through a nested Function output', async () => {
    const inner = createDefaultFunctionNodeConfig('Inner editor outputs');
    inner.contract.outputPorts = [
      { id: 'inner-image', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0 },
      { id: 'inner-mask', key: 'mask', label: 'Mask', resultType: 'image', required: true, order: 1 },
    ];
    inner.graph = {
      version: 1,
      nodes: [node('inner-editor', 'advancedImageEditor', {
        result: 'data:image/png;base64,SU5ORVItSU1BR0U=',
        maskOutput: 'data:image/png;base64,SU5ORVItTUFTSw==',
      })],
      edges: [],
    };
    inner.outputBindings = [
      { ...inner.outputBindings[0], targetOutputPortId: 'inner-image', sourceNodeId: 'inner-editor', resultType: 'image' },
      {
        ...inner.outputBindings[0],
        id: 'inner-mask-binding',
        targetOutputPortId: 'inner-mask',
        sourceNodeId: 'inner-editor',
        sourceHandle: 'maskOutput',
        resultType: 'image',
      },
    ];

    const outer = createDefaultFunctionNodeConfig('Outer nested mask');
    outer.contract.outputPorts = [
      { id: 'outer-mask', key: 'mask', label: 'Mask', resultType: 'image', required: true, order: 0 },
    ];
    outer.graph = {
      version: 1,
      nodes: [functionNodeFor(inner, 'inner-function')],
      edges: [],
    };
    outer.outputBindings = [{
      ...outer.outputBindings[0],
      targetOutputPortId: 'outer-mask',
      sourceNodeId: 'inner-function',
      sourceHandle: 'inner-mask',
      resultType: 'image',
    }];

    const execution = await executeNodeRequest(functionNodeFor(outer, 'outer-function'), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });

    expect(execution.result).toBe('data:image/png;base64,SU5ORVItTUFTSw==');
    expect(execution.functionOutputs?.['outer-mask']?.result).toBe('data:image/png;base64,SU5ORVItTUFTSw==');
  });

  it('rejects the gate\'s unknown Stability output handle before the paid request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('MUST-NOT-RUN'));
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Invalid paid output handle');
    config.graph = {
      version: 1,
      nodes: [
        node('prompt', 'textNode', { mode: 'prompt', prompt: 'a paid fox' }),
        node('paid', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          result: FROZEN_INTERNAL_IMAGE,
        }),
      ],
      edges: [{ id: 'prompt-paid', source: 'prompt', target: 'paid' }],
    };
    config.outputBindings[0] = {
      ...config.outputBindings[0],
      sourceNodeId: 'paid',
      sourceHandle: 'not-a-real-output',
      resultType: 'image',
    };

    await expect(executeNodeRequest(functionNodeFor(config), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime }))
      .rejects.toMatchObject({
        name: 'NonRetryableError',
        message: expect.stringMatching(/source handle "not-a-real-output".*paid/i),
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown nested Function output handle before any inner provider call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('MUST-NOT-RUN'));
    vi.stubGlobal('fetch', fetchMock);

    const inner = createDefaultFunctionNodeConfig('Paid inner output');
    inner.contract.outputPorts = [{
      id: 'inner-image', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0,
    }];
    inner.graph = {
      version: 1,
      nodes: [
        node('inner-prompt', 'textNode', { mode: 'prompt', prompt: 'an inner fox' }),
        node('inner-paid', 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
      ],
      edges: [{ id: 'inner-prompt-paid', source: 'inner-prompt', target: 'inner-paid' }],
    };
    inner.outputBindings = [{
      ...inner.outputBindings[0],
      targetOutputPortId: 'inner-image',
      sourceNodeId: 'inner-paid',
      resultType: 'image',
    }];

    const outer = createDefaultFunctionNodeConfig('Invalid nested handle');
    outer.graph = { version: 1, nodes: [functionNodeFor(inner, 'inner-function')], edges: [] };
    outer.outputBindings[0] = {
      ...outer.outputBindings[0],
      sourceNodeId: 'inner-function',
      sourceHandle: 'not-an-inner-output',
      resultType: 'image',
    };

    await expect(executeNodeRequest(functionNodeFor(outer, 'outer-function'), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime }))
      .rejects.toMatchObject({
        name: 'NonRetryableError',
        message: expect.stringMatching(/source handle "not-an-inner-output".*inner-function/i),
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a provider-backed nested secondary output with its distinct metadata exactly once', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:nested-secondary-image');
    const calls = { submit: 0, download: 0 };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/model/generateImage')) {
        calls.submit += 1;
        return jsonResponse({ data: { outputs: ['https://cdn.atlascloud.ai/nested-secondary.png'] } });
      }
      calls.download += 1;
      return imageResponse('NESTED-SECONDARY');
    });
    vi.stubGlobal('fetch', fetchMock);

    const inner = createDefaultFunctionNodeConfig('Local primary and paid secondary');
    inner.contract.outputPorts = [
      { id: 'inner-text', key: 'text', label: 'Text', resultType: 'text', required: true, order: 0 },
      { id: 'inner-image', key: 'image', label: 'Image', resultType: 'image', required: true, order: 1 },
    ];
    inner.graph = {
      version: 1,
      nodes: [
        node('inner-local', 'textNode', { mode: 'prompt', prompt: 'INNER PRIMARY' }),
        node('inner-prompt', 'textNode', { mode: 'prompt', prompt: 'an exact secondary fox' }),
        node('inner-paid', 'imageGen', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' }),
      ],
      edges: [{ id: 'inner-prompt-paid', source: 'inner-prompt', target: 'inner-paid' }],
    };
    inner.outputBindings = [
      { ...inner.outputBindings[0], targetOutputPortId: 'inner-text', sourceNodeId: 'inner-local', resultType: 'text' },
      {
        ...inner.outputBindings[0],
        id: 'inner-image-binding',
        targetOutputPortId: 'inner-image',
        sourceNodeId: 'inner-paid',
        resultType: 'image',
      },
    ];

    const outer = createDefaultFunctionNodeConfig('Outer secondary image');
    outer.contract.outputPorts = [{
      id: 'outer-image', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0,
    }];
    outer.graph = { version: 1, nodes: [functionNodeFor(inner, 'inner-function')], edges: [] };
    outer.outputBindings = [{
      ...outer.outputBindings[0],
      targetOutputPortId: 'outer-image',
      sourceNodeId: 'inner-function',
      sourceHandle: 'inner-image',
      resultType: 'image',
    }];

    const execution = await executeNodeRequest(functionNodeFor(outer, 'outer-function'), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, {
      ...baseSettings,
      apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
      providerSettings: {
        ...baseSettings.providerSettings,
        atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        batchMaxRetries: 0,
      },
    }, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });

    expect(calls).toEqual({ submit: 1, download: 1 });
    expect(execution.result).toBe('blob:nested-secondary-image');
    expect(execution.result).not.toBe('INNER PRIMARY');
    expect(execution.mimeType).toBe('image/png');
    expect(execution.functionOutputs?.['outer-image']).toMatchObject({
      result: 'blob:nested-secondary-image',
      resultType: 'image',
      mimeType: 'image/png',
    });
    expect(execution.usageAttributions).toHaveLength(1);
  });

  it('keeps absent and persisted empty source handles on the canonical default output', async () => {
    for (const [id, sourceHandle] of [['absent', undefined], ['empty', '']] as const) {
      vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce(`blob:${id}-default-image`);
      const fetchMock = vi.fn().mockResolvedValue(imageResponse(id));
      vi.stubGlobal('fetch', fetchMock);
      const config = createDefaultFunctionNodeConfig(`${id} default handle`);
      config.graph = {
        version: 1,
        nodes: [
          node(`${id}-prompt`, 'textNode', { mode: 'prompt', prompt: `${id} fox` }),
          node(`${id}-paid`, 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
        ],
        edges: [{ id: `${id}-edge`, source: `${id}-prompt`, target: `${id}-paid` }],
      };
      config.outputBindings[0] = {
        ...config.outputBindings[0],
        sourceNodeId: `${id}-paid`,
        sourceHandle,
        resultType: 'image',
      };

      const execution = await executeNodeRequest(functionNodeFor(config, `${id}-function`), {
        prompt: '', config: DEFAULT_EXECUTION_CONFIG,
      }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(execution.result).toBe(`blob:${id}-default-image`);
    }
  });

  it('does not repair malformed persisted handle casing into a paid named output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('MUST-NOT-RUN'));
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Malformed named casing');
    config.graph = {
      version: 1,
      nodes: [
        node('prompt', 'textNode', { mode: 'prompt', prompt: 'a masked fox' }),
        node('paid', 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
        node('editor', 'advancedImageEditor', {
          result: 'data:image/png;base64,REVGQVVMVA==',
          maskOutput: 'data:image/png;base64,TUFTSw==',
        }),
      ],
      edges: [
        { id: 'prompt-paid', source: 'prompt', target: 'paid' },
        { id: 'paid-editor', source: 'paid', target: 'editor', targetHandle: 'sourceImage' },
      ],
    };
    config.outputBindings[0] = {
      ...config.outputBindings[0],
      sourceNodeId: 'editor',
      sourceHandle: 'MaskOutput',
      resultType: 'image',
    };

    await expect(executeNodeRequest(functionNodeFor(config), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime }))
      .rejects.toMatchObject({
        name: 'NonRetryableError',
        message: expect.stringMatching(/source handle "MaskOutput".*editor/i),
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('executes every advertised output subtree once: two providers, different types, exact submission counts', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:multi-output-image');
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('FRESH-MULTI'));
    vi.stubGlobal('fetch', fetchMock);
    openAiTextCapture.create = async () => ({
      choices: [{ message: { content: 'fresh openai text' } }],
      usage: { prompt_tokens: 7, completion_tokens: 11 },
    });

    const config = createDefaultFunctionNodeConfig('Two provider outputs');
    config.contract.outputPorts = [
      { id: 'image-output', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0 },
      { id: 'text-output', key: 'text', label: 'Text', resultType: 'text', required: true, order: 1 },
    ];
    config.graph = {
      version: 1,
      nodes: [
        node('img-prompt', 'textNode', { mode: 'prompt', prompt: 'paint a fox', resultType: 'text' }),
        node('img-src', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          result: FROZEN_INTERNAL_IMAGE,
          resultType: 'image',
        }),
        node('text-prompt', 'textNode', { mode: 'prompt', prompt: 'describe a fox', resultType: 'text' }),
        node('text-src', 'textNode', {
          mode: 'generate',
          provider: 'openai',
          modelId: 'gpt-4.1-mini',
          result: 'stale internal text frozen at collapse',
          resultType: 'text',
        }),
      ],
      edges: [
        { id: 'e-img', source: 'img-prompt', target: 'img-src', sourceHandle: null, targetHandle: null },
        { id: 'e-text', source: 'text-prompt', target: 'text-src', sourceHandle: null, targetHandle: null },
      ],
    };
    config.outputBindings = [
      { ...config.outputBindings[0], targetOutputPortId: 'image-output', sourceNodeId: 'img-src', resultType: 'image' },
      { ...config.outputBindings[0], id: 'text-output-binding', targetOutputPortId: 'text-output', sourceNodeId: 'text-src', resultType: 'text' },
    ];

    const execution = await executeNodeRequest(functionNodeFor(config, 'fn-two-providers'), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });

    // Exactly one submission per provider-backed internal node — no skips, no repeats.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.stability.ai/v2beta/stable-image/generate/core');
    expect(openAiTextCapture.calls).toHaveLength(1);

    expect(execution.result).toBe('blob:multi-output-image');
    expect(execution.resultType).toBe('image');
    expect(execution.functionOutputs?.['image-output']).toMatchObject({
      result: 'blob:multi-output-image',
      resultType: 'image',
    });
    expect(execution.functionOutputs?.['text-output']).toMatchObject({
      result: 'fresh openai text',
      resultType: 'text',
    });
    expect(execution.usage?.costUsd).toBeUndefined();
    expect(execution.usage).toMatchObject({ source: 'actual', inputTokens: 7, outputTokens: 11 });
  });

  it('never serves stale persisted data on a provider-backed second output behind a local first output', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:second-output-fresh');
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('FRESH-SECOND'));
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Local first, provider second');
    config.contract.outputPorts = [
      { id: 'text-output', key: 'text', label: 'Text', resultType: 'text', required: true, order: 0 },
      { id: 'image-output', key: 'image', label: 'Image', resultType: 'image', required: true, order: 1 },
    ];
    config.graph = {
      version: 1,
      nodes: [
        node('local-src', 'textNode', { mode: 'prompt', prompt: 'LOCAL VALUE', resultType: 'text' }),
        node('img-prompt', 'textNode', { mode: 'prompt', prompt: 'a fresh harbor', resultType: 'text' }),
        node('img-src', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          result: FROZEN_INTERNAL_IMAGE,
          resultType: 'image',
        }),
      ],
      edges: [
        { id: 'e-img', source: 'img-prompt', target: 'img-src', sourceHandle: null, targetHandle: null },
      ],
    };
    config.outputBindings = [
      { ...config.outputBindings[0], targetOutputPortId: 'text-output', sourceNodeId: 'local-src', resultType: 'text' },
      { ...config.outputBindings[0], id: 'image-output-binding', targetOutputPortId: 'image-output', sourceNodeId: 'img-src', resultType: 'image' },
    ];

    const execution = await executeNodeRequest(functionNodeFor(config, 'fn-local-then-provider'), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, baseSettings, undefined, { functionRuntime: flowFunctionNodeExecutionRuntime });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toBe('a fresh harbor');

    expect(execution.result).toBe('LOCAL VALUE');
    expect(execution.resultType).toBe('text');
    expect(execution.functionOutputs?.['text-output']?.result).toBe('LOCAL VALUE');
    expect(execution.functionOutputs?.['image-output']?.result).toBe('blob:second-output-fresh');
    expect(execution.functionOutputs?.['image-output']?.result).not.toBe(FROZEN_INTERNAL_IMAGE);
    expect(execution.usage).toMatchObject({ source: 'actual', costUsd: 0.03 });
    expect(execution.usage?.notes?.join(' ')).not.toContain('without provider spend');
  });

  it('retains provider additional media, MIME, and internal usage on a named Function output', async () => {
    const config = createDefaultFunctionNodeConfig('Atlas image pair');
    config.contract.outputPorts = [{
      id: 'image-output', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0,
    }];
    config.graph = {
      version: 1,
      nodes: [
        node('atlas-prompt', 'textNode', { mode: 'prompt', prompt: 'two exact images' }),
        node('atlas-image', 'imageGen', {
          provider: 'atlas',
          modelId: 'black-forest-labs/flux-schnell',
        }),
      ],
      edges: [{ id: 'atlas-prompt-to-image', source: 'atlas-prompt', target: 'atlas-image' }],
    };
    config.outputBindings = [{
      ...config.outputBindings[0], targetOutputPortId: 'image-output', sourceNodeId: 'atlas-image', resultType: 'image',
    }];

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:function-atlas-primary')
      .mockReturnValueOnce('blob:function-atlas-additional');
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/model/generateImage')) {
        return Promise.resolve(jsonResponse({ data: { outputs: [
          'https://cdn.atlascloud.ai/primary.png',
          'https://cdn.atlascloud.ai/additional.webp',
        ] } }));
      }
      if (requestUrl.endsWith('/primary.png')) {
        return Promise.resolve(new Response(new Blob(['PRIMARY'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }));
      }
      return Promise.resolve(new Response(new Blob(['ADDITIONAL'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const attributed: Array<{ node: AppNode; usage: UsageTelemetry }> = [];

    const execution = await executeNodeRequest(functionNodeFor(config), {
      prompt: 'two exact images', config: DEFAULT_EXECUTION_CONFIG,
    }, {
      ...baseSettings,
      apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
      providerSettings: {
        ...baseSettings.providerSettings,
        atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        batchMaxRetries: 0,
      },
    }, undefined, {
      functionRuntime: flowFunctionNodeExecutionRuntime,
      onInternalUsage: (entry) => attributed.push(entry),
    });

    const output = execution.functionOutputs?.['image-output'];
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(execution).toMatchObject({
      result: 'blob:function-atlas-primary',
      resultType: 'image',
      mimeType: 'image/png',
      additionalResults: [{ result: 'blob:function-atlas-additional', mimeType: 'image/webp' }],
    });
    expect(output).toMatchObject({
      result: 'blob:function-atlas-primary',
      resultType: 'image',
      mimeType: 'image/png',
      additionalResults: [{ result: 'blob:function-atlas-additional', mimeType: 'image/webp' }],
    });
    expect(execution.usageAttributions).toHaveLength(1);
    expect(attributed).toHaveLength(1);
    expect(attributed[0]).toMatchObject({
      node: { id: 'atlas-image', type: 'imageGen' },
      usage: { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', imageCount: 2 },
    });
  });

  it('passes the outer abort signal to an in-flight internal Stability request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const fixture = collapsePromptToImageFunction();
    const pending = executeNodeRequest(fixture.functionNode, buildOuterContextWithChangedInput(fixture, 'prompt-src', 'cancel me'), baseSettings, undefined, {
      functionRuntime: flowFunctionNodeExecutionRuntime,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('retries Atlas polling after acceptance without repeating the paid submission', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-after-poll-retry');
    const calls = { submit: 0, poll: 0, download: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith('/model/generateImage')) {
        calls.submit += 1;
        return jsonResponse({ data: { id: 'accepted-job' } });
      }
      if (value.includes('/model/prediction/accepted-job')) {
        calls.poll += 1;
        return calls.poll === 1
          ? new Response('temporary poll outage', { status: 500 })
          : jsonResponse({ data: { status: 'completed', outputs: ['https://cdn.example/fresh.png'] } });
      }
      calls.download += 1;
      return imageResponse('ATLAS-FRESH');
    }));

    const config = createDefaultFunctionNodeConfig('Accepted Atlas job');
    config.graph = {
      version: 1,
      nodes: [
        node('prompt', 'textNode', { mode: 'prompt', prompt: 'fox' }),
        node('atlas', 'imageGen', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' }),
      ],
      edges: [{ id: 'prompt-atlas', source: 'prompt', target: 'atlas' }],
    };
    config.outputBindings[0].sourceNodeId = 'atlas';
    const settings = {
      ...baseSettings,
      apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
      providerSettings: { ...baseSettings.providerSettings, batchMaxRetries: 1, batchRetryBaseDelayMs: 0 },
    };

    const execution = await executeNodeRequest(
      functionNodeFor(config, 'fn-atlas-retry'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    expect(execution.result).toBe('blob:atlas-after-poll-retry');
    expect(calls).toEqual({ submit: 1, poll: 2, download: 1 });
  });

  it('retries Atlas materialization after acceptance without repeating the paid submission', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-after-download-retry');
    const calls = { submit: 0, download: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/model/generateImage')) {
        calls.submit += 1;
        return jsonResponse({ data: { outputs: ['https://cdn.example/retry.png'] } });
      }
      calls.download += 1;
      return calls.download === 1
        ? new Response('temporary CDN outage', { status: 500 })
        : imageResponse('ATLAS-FRESH');
    }));
    const config = createDefaultFunctionNodeConfig('Accepted Atlas materialization');
    config.graph = {
      version: 1,
      nodes: [node('prompt', 'textNode', { mode: 'prompt', prompt: 'fox' }), node('atlas', 'imageGen', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' })],
      edges: [{ id: 'prompt-atlas', source: 'prompt', target: 'atlas' }],
    };
    config.outputBindings[0].sourceNodeId = 'atlas';
    const settings = {
      ...baseSettings,
      apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
      providerSettings: { ...baseSettings.providerSettings, batchMaxRetries: 1, batchRetryBaseDelayMs: 0 },
    };

    const execution = await executeNodeRequest(
      functionNodeFor(config, 'fn-atlas-materialize-retry'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    expect(execution.result).toBe('blob:atlas-after-download-retry');
    expect(calls).toEqual({ submit: 1, download: 2 });
  });

  it('cancels during accepted Atlas polling without resubmitting or materializing', async () => {
    const controller = new AbortController();
    const calls = { submit: 0, poll: 0, download: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/model/generateImage')) {
        calls.submit += 1;
        return jsonResponse({ data: { id: 'cancelled-job' } });
      }
      if (value.includes('/model/prediction/cancelled-job')) {
        calls.poll += 1;
        controller.abort(new DOMException('cancel polling', 'AbortError'));
        throw init?.signal?.reason ?? new DOMException('cancel polling', 'AbortError');
      }
      calls.download += 1;
      return imageResponse('UNEXPECTED');
    }));

    const config = createDefaultFunctionNodeConfig('Cancel Atlas polling');
    config.graph = {
      version: 1,
      nodes: [node('prompt', 'textNode', { mode: 'prompt', prompt: 'fox' }), node('atlas', 'imageGen', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' })],
      edges: [{ id: 'prompt-atlas', source: 'prompt', target: 'atlas' }],
    };
    config.outputBindings[0].sourceNodeId = 'atlas';
    const settings = { ...baseSettings, apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' } };

    await expect(executeNodeRequest(
      functionNodeFor(config, 'fn-atlas-cancel-poll'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual({ submit: 1, poll: 1, download: 0 });
  });

  it('cancels during materialization without repeating the accepted Atlas submission', async () => {
    const controller = new AbortController();
    const calls = { submit: 0, poll: 0, download: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/model/generateImage')) {
        calls.submit += 1;
        return jsonResponse({ data: { outputs: ['https://cdn.example/cancel.png'] } });
      }
      calls.download += 1;
      controller.abort(new DOMException('cancel download', 'AbortError'));
      throw init?.signal?.reason ?? new DOMException('cancel download', 'AbortError');
    }));

    const config = createDefaultFunctionNodeConfig('Cancel Atlas materialization');
    config.graph = {
      version: 1,
      nodes: [node('prompt', 'textNode', { mode: 'prompt', prompt: 'fox' }), node('atlas', 'imageGen', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' })],
      edges: [{ id: 'prompt-atlas', source: 'prompt', target: 'atlas' }],
    };
    config.outputBindings[0].sourceNodeId = 'atlas';
    const settings = { ...baseSettings, apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' } };

    await expect(executeNodeRequest(
      functionNodeFor(config, 'fn-atlas-cancel-download'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual({ submit: 1, poll: 0, download: 1 });
  });

  it('feeds fresh internal provider outputs downstream and aggregates usage across the chain', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:function-chain-image');
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('CHAIN'));
    vi.stubGlobal('fetch', fetchMock);
    const freshInternalText = 'a moonlit lighthouse above black cliffs, oil painting';
    openAiTextCapture.create = async () => ({
      choices: [{ message: { content: freshInternalText } }],
      usage: { prompt_tokens: 12, completion_tokens: 24 },
    });

    const fixture = collapseTextThenImageFunction();
    const changedInput = 'a weathered lighthouse at dusk';
    const context = buildOuterContextWithChangedInput(fixture, 'prompt-src', changedInput);

    const execution = await executeNodeRequest(
      fixture.functionNode,
      context,
      baseSettings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    // The internal text node saw the CURRENT external prompt, not its frozen result.
    expect(openAiTextCapture.calls).toHaveLength(1);
    expect(JSON.stringify(openAiTextCapture.calls[0].messages)).toContain(changedInput);

    // The internal image node consumed the FRESH internal text, not any stored value.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toBe(freshInternalText);

    expect(execution.result).toBe('blob:function-chain-image');
    expect(execution.statusMessage).toMatch(/Executed .*: 2 provider nodes across 2 internal nodes/);
    expect(execution.usage?.costUsd).toBeUndefined();
    expect(execution.usage).toMatchObject({ source: 'actual', inputTokens: 12, outputTokens: 24 });
    expect(execution.usage?.notes?.join(' ')).toContain('Executed 2 internal provider nodes');
  });

  it('aborts between internal provider steps and never issues the downstream provider request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('NEVER'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    openAiTextCapture.create = async () => {
      controller.abort();
      return {
        choices: [{ message: { content: 'text that arrives as the run is cancelled' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      };
    };

    const fixture = collapseTextThenImageFunction();
    const context = buildOuterContextWithChangedInput(fixture, 'prompt-src', 'a lighthouse mid-cancellation');

    await expect(
      executeNodeRequest(fixture.functionNode, context, baseSettings, undefined, {
        functionRuntime: flowFunctionNodeExecutionRuntime,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(openAiTextCapture.calls).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves an empty internal graph through the synchronous path with zero provider spend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Empty branch');
    const execution = await executeNodeRequest(
      functionNodeFor(config),
      { prompt: 'anything', config: DEFAULT_EXECUTION_CONFIG },
      baseSettings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    expect(execution.result).toBe('');
    expect(execution.statusMessage).toBe('Resolved Empty branch from 0 internal nodes');
    expect(execution.usage).toMatchObject({ costUsd: 0 });
    expect(execution.usage?.notes?.join(' ')).toContain('without provider spend');
    expect(fetchMock).not.toHaveBeenCalled();

    const noBinding = createDefaultFunctionNodeConfig('No output');
    noBinding.outputBindings = [];
    const missingBinding = await executeNodeRequest(
      functionNodeFor(noBinding, 'fn-no-binding'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      baseSettings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );
    expect(missingBinding.statusMessage).toBe('Function did not expose an output binding.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a malformed graph whose output source is missing without crashing or spending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Ghost output');
    config.graph = {
      version: 1,
      nodes: [node('lonely', 'textNode', { mode: 'prompt', prompt: 'orphaned' })],
      edges: [],
    };
    config.outputBindings[0].sourceNodeId = 'ghost-node';

    const execution = await executeNodeRequest(
      functionNodeFor(config, 'fn-ghost'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      baseSettings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    expect(execution.result).toBe('');
    expect(execution.usage?.notes?.join(' ')).toContain('without provider spend');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades gracefully when a persisted function graph has malformed internal edges', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Malformed wiring');
    config.graph = {
      version: 1,
      nodes: [node('inner-prompt', 'textNode', { mode: 'prompt', prompt: 'still readable', resultType: 'text' })],
      // Persisted configs from older saves can lose their wiring array; execution must
      // treat that as an unwired graph, not crash.
      edges: undefined as unknown as Edge[],
    };
    config.outputBindings[0].sourceNodeId = 'inner-prompt';

    const execution = await executeNodeRequest(
      functionNodeFor(config, 'fn-malformed-edges'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      baseSettings,
      undefined,
      { functionRuntime: flowFunctionNodeExecutionRuntime },
    );

    expect(execution.result).toBe('still readable');
    expect(execution.usage?.notes?.join(' ')).toContain('without provider spend');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed internal graph whose provider nodes form a dependency cycle', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Cycle');
    config.graph = {
      version: 1,
      nodes: [
        node('img-a', 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
        node('img-b', 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
      ],
      edges: [
        { id: 'e-ab', source: 'img-a', target: 'img-b', sourceHandle: null, targetHandle: null },
        { id: 'e-ba', source: 'img-b', target: 'img-a', sourceHandle: null, targetHandle: null },
      ],
    };
    config.outputBindings[0].sourceNodeId = 'img-b';

    await expect(
      executeNodeRequest(
        functionNodeFor(config, 'fn-cycle'),
        { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
        baseSettings,
        undefined,
        { functionRuntime: flowFunctionNodeExecutionRuntime },
      ),
    ).rejects.toThrow(/dependency cycle/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('executes a non-provider synchronous internal graph without the flow runtime and binds the current input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const fixture = collapseFixture(
      [
        node('prompt-src', 'textNode', { mode: 'prompt', prompt: 'Ensign Rell', resultType: 'text' }),
        {
          ...node('template-inside', 'stringTemplateNode', { template: 'Greetings, {A}!' }),
          selected: true,
        },
        node('outside-view', 'sourceBin', {}),
      ],
      [
        { id: 'e-in', source: 'prompt-src', target: 'template-inside', sourceHandle: null, targetHandle: 'A' },
        { id: 'e-out', source: 'template-inside', target: 'outside-view', sourceHandle: null, targetHandle: null },
      ],
      'Greeting template',
    );
    const context = buildOuterContextWithChangedInput(fixture, 'prompt-src', 'Captain Mara');

    const execution = await executeNodeRequest(fixture.functionNode, context, baseSettings);

    expect(execution.result).toBe('Greetings, Captain Mara!');
    expect(execution.resultType).toBe('text');
    expect(execution.usage).toMatchObject({ costUsd: 0 });
    expect(execution.usage?.notes?.join(' ')).toContain('without provider spend');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the internal graph needs providers but no flow runtime was supplied', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const fixture = collapsePromptToImageFunction();
    const context = buildOuterContextWithChangedInput(fixture, 'prompt-src', 'a harbor no runtime can paint');

    await expect(
      executeNodeRequest(fixture.functionNode, context, baseSettings),
    ).rejects.toThrow(/provider-backed internal node/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a function whose internal graph recursively contains itself', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = createDefaultFunctionNodeConfig('Self reference');
    config.graph = {
      version: 1,
      nodes: [node('fn-self', 'functionNode', { functionNode: createDefaultFunctionNodeConfig('Inner') })],
      edges: [],
    };
    config.outputBindings[0].sourceNodeId = 'fn-self';

    await expect(
      executeNodeRequest(
        functionNodeFor(config, 'fn-self'),
        { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
        baseSettings,
        undefined,
        { functionRuntime: flowFunctionNodeExecutionRuntime },
      ),
    ).rejects.toThrow(/recursively contains itself/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
