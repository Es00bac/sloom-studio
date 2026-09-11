import { describe, expect, it } from 'vitest';
import {
  estimateElevenLabsTtsCostUsd,
  estimateExecutionPlan,
  estimateGeminiTextCostUsd,
  estimateGeminiVideoCostUsd,
  estimateGenerativeFillCostUsd,
} from './costEstimation';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { createDefaultFunctionNodeConfig } from './functionNodes';

function createNode(id: string, type: AppNode['type'], data: AppNode['data'] = {}): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    openai: '',
    atlas: '',
    gemini: 'key',
    huggingface: '',
    elevenlabs: '',
    bfl: '',
    stability: '',
  },
  defaultModels: {
    text: {
      gemini: 'gemini-2.5-flash',
      openai: 'gpt-4o-mini',
      huggingface: 'hf-text',
    },
    image: {
      gemini: 'gemini-2.5-flash-image',
      openai: 'gpt-image-1',
      atlas: 'gpt-image-2',
      huggingface: 'hf-image',
      bfl: 'flux-2-pro',
      stability: 'stable-image-edit-inpaint',
      localOpen: 'Qwen/Qwen-Image-Edit',
      android: 'local-dream-active',
      byteplus: 'seedream-4.5',
    },
    video: {
      gemini: 'veo-3.1-fast-generate-preview',
      huggingface: 'hf-video',
      atlas: 'google/veo3.1/text-to-video',
    },
    audio: {
      gemini: 'gemini-2.5-flash-preview-tts',
      elevenlabs: 'eleven_multilingual_v2',
      huggingface: 'hf-audio',
    },
  },
  providerSettings: {
    openaiBaseUrl: '',
    elevenlabsVoiceId: '',
    renderBackendPreference: 'browser',
    exportCompositorPreference: 'stage',
    localNativeRenderUrl: '',
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
    localOpenImageEndpointUrl: '',
    localOpenImageAuthHeader: '',
    localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
    batchMaxRetries: 10,
    batchRetryBaseDelayMs: 30000, androidLanServerEnabled: false, androidLanServerPin: "",
  },
};

describe('estimateGeminiTextCostUsd', () => {
  it('estimates Gemini 2.5 Flash text cost from input and output tokens', () => {
    expect(
      estimateGeminiTextCostUsd('gemini-2.5-flash', {
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ).toBeCloseTo(0.00155, 6);
  });

  it('estimates Gemini 3 Flash text cost from input and output tokens', () => {
    expect(
      estimateGeminiTextCostUsd('gemini-3-flash-preview', {
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ).toBeCloseTo(0.002, 6);
  });
});

describe('estimateGeminiVideoCostUsd', () => {
  it('estimates Veo 3.1 Fast 720p cost from duration', () => {
    expect(estimateGeminiVideoCostUsd('veo-3.1-fast-generate-preview', 4, '720p')).toBeCloseTo(0.6, 6);
  });

  it('normalizes legacy Veo aliases before estimating cost', () => {
    expect(estimateGeminiVideoCostUsd('veo-3.1-fast', 4, '720p')).toBeCloseTo(0.6, 6);
  });
});

describe('estimateGenerativeFillCostUsd', () => {
  it('estimates Atlas GPT Image 2 similarly to OpenAI-compatible image models', () => {
    expect(
      estimateGenerativeFillCostUsd('atlas', 'gpt-image-2', 1, 'Portrait of a cyberpunk city'),
    ).toBe(
      estimateGenerativeFillCostUsd('openai', 'gpt-image-2', 1, 'Portrait of a cyberpunk city'),
    );
  });

  it('infers Stability erase operation cost from model id', () => {
    expect(estimateGenerativeFillCostUsd('stability', 'stable-image-edit-erase')).toBe(0.05);
  });

  it('infers Stability search-replace and relight costs from model ids', () => {
    expect(estimateGenerativeFillCostUsd('stability', 'stable-image-edit-search-replace')).toBe(0.05);
    expect(estimateGenerativeFillCostUsd('stability', 'stable-image-edit-replace-background-relight')).toBe(0.08);
  });

  it('infers Stability outpaint cost from model id', () => {
    expect(estimateGenerativeFillCostUsd('stability', 'stable-image-edit-outpaint')).toBe(0.04);
  });
});

describe('estimateElevenLabsTtsCostUsd', () => {
  it('estimates Multilingual v2 and Eleven v3 cost from characters', () => {
    expect(estimateElevenLabsTtsCostUsd('eleven_multilingual_v2', 1200)).toBeCloseTo(0.12, 6);
    expect(estimateElevenLabsTtsCostUsd('eleven_v3', 1200)).toBeCloseTo(0.12, 6);
  });
});

describe('estimateExecutionPlan', () => {
  it('estimates the union of resolved Function output subgraphs and excludes unreachable providers', () => {
    const config = createDefaultFunctionNodeConfig('Costed output union');
    config.contract.outputPorts = [
      { id: 'image-output', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0 },
      { id: 'text-output', key: 'text', label: 'Text', resultType: 'text', required: true, order: 1 },
    ];
    config.graph = {
      version: 1,
      nodes: [
        createNode('image-prompt', 'textNode', { mode: 'prompt', prompt: 'image prompt' }),
        createNode('image-provider', 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
        createNode('text-prompt', 'textNode', { mode: 'prompt', prompt: 'text prompt' }),
        createNode('text-provider', 'textNode', { mode: 'generate', provider: 'gemini', modelId: 'gemini-2.5-flash' }),
        createNode('unreachable-provider', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
      ],
      edges: [
        { id: 'image-edge', source: 'image-prompt', target: 'image-provider' },
        { id: 'text-edge', source: 'text-prompt', target: 'text-provider' },
      ],
    };
    config.outputBindings = [
      { ...config.outputBindings[0], targetOutputPortId: 'image-output', sourceNodeId: 'image-provider', resultType: 'image' },
      { ...config.outputBindings[0], id: 'text-binding', targetOutputPortId: 'text-output', sourceNodeId: 'text-provider', resultType: 'text' },
    ];

    const estimate = estimateExecutionPlan(
      'function',
      [createNode('function', 'functionNode', { functionNode: config })],
      [],
      settings,
    );
    const telemetry = estimate.telemetries[0]?.telemetry;

    expect(telemetry?.costUsd).toBeGreaterThanOrEqual(0.03);
    expect(telemetry?.notes?.join(' ')).toContain('2 reachable internal provider calls');
    expect(telemetry?.notes?.join(' ')).not.toContain('3 reachable');
  });

  it('treats virtual nodes as aliases of their linked source when estimating downstream runs', () => {
    const nodes = [
      createNode('text-1', 'textNode', {
        mode: 'prompt',
        prompt: 'A gold robot walking through fog',
      }),
      createNode('virtual-1', 'virtual'),
      createNode('image-1', 'imageGen', {
        provider: 'gemini',
        modelId: 'gemini-2.5-flash-image',
      }),
    ];

    const estimate = estimateExecutionPlan(
      'image-1',
      nodes,
      [
        { id: 'edge-1', source: 'text-1', target: 'virtual-1' },
        { id: 'edge-2', source: 'virtual-1', target: 'image-1' },
      ],
      settings,
    );

    expect(estimate.nodeIds).toEqual(['text-1', 'image-1']);
    expect(estimate.rollup.imageCount).toBe(1);
  });

  it('uses registered cloud image model prices for BFL and Stability image nodes', () => {
    const nodes = [
      createNode('text-1', 'textNode', {
        mode: 'prompt',
        prompt: 'A gold robot walking through fog',
      }),
      createNode('source-image', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,SOURCE',
      }),
      createNode('bfl-image', 'imageGen', {
        provider: 'bfl',
        modelId: 'flux-2-pro',
      }),
      createNode('stability-edit', 'imageGen', {
        provider: 'stability',
        modelId: 'stable-image-edit-search-replace',
        imageSearchPrompt: 'mug',
      }),
    ];

    const bflEstimate = estimateExecutionPlan(
      'bfl-image',
      nodes,
      [
        { id: 'edge-text-bfl', source: 'text-1', target: 'bfl-image' },
      ],
      settings,
    );
    const estimate = estimateExecutionPlan(
      'stability-edit',
      nodes,
      [
        { id: 'edge-text-bfl', source: 'text-1', target: 'bfl-image' },
        { id: 'edge-source-stability', source: 'source-image', target: 'stability-edit', targetHandle: 'image-edit-source' },
        { id: 'edge-text-stability', source: 'text-1', target: 'stability-edit' },
      ],
      settings,
    );

    expect(bflEstimate.telemetries.find((entry) => entry.nodeId === 'bfl-image')?.telemetry).toMatchObject({
      provider: 'bfl',
      modelId: 'flux-2-pro',
      costUsd: 0.03,
      imageCount: 1,
    });
    expect(estimate.telemetries.find((entry) => entry.nodeId === 'stability-edit')?.telemetry).toMatchObject({
      provider: 'stability',
      modelId: 'stable-image-edit-search-replace',
      costUsd: 0.05,
      imageCount: 1,
    });
  });

  it('labels Local/Open image model estimates as provider-defined instead of free', () => {
    const nodes = [
      createNode('text-1', 'textNode', {
        mode: 'prompt',
        prompt: 'Change the shop sign to OPEN LATE',
      }),
      createNode('source-image', 'imageGen', {
        mediaMode: 'import',
        sourceAssetUrl: 'data:image/png;base64,SOURCE',
      }),
      createNode('local-open-edit', 'imageGen', {
        provider: 'localOpen',
        modelId: 'Qwen/Qwen-Image-Edit',
      }),
    ];

    const estimate = estimateExecutionPlan(
      'local-open-edit',
      nodes,
      [
        { id: 'edge-text', source: 'text-1', target: 'local-open-edit' },
        { id: 'edge-source', source: 'source-image', target: 'local-open-edit', targetHandle: 'image-edit-source' },
      ],
      settings,
    );

    expect(estimate.telemetries.find((entry) => entry.nodeId === 'local-open-edit')?.telemetry).toMatchObject({
      provider: 'localOpen',
      modelId: 'Qwen/Qwen-Image-Edit',
      costUsd: undefined,
      imageCount: 1,
    });
    expect(estimate.rollup.unknownCostCount).toBe(1);
  });

  it('adds paid configured auto-upscale cost to Flow image generation estimates', () => {
    const estimate = estimateExecutionPlan(
      'image-1',
      [
        createNode('text-1', 'textNode', {
          mode: 'prompt',
          prompt: 'A gold robot walking through fog',
        }),
        createNode('image-1', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          imageAutoUpscale: true,
        }),
      ],
      [{ id: 'edge-text', source: 'text-1', target: 'image-1' }],
      {
        ...settings,
        apiKeys: { ...settings.apiKeys, stability: 'stability-key' },
        providerSettings: {
          ...settings.providerSettings,
          paperPrintUpscaleMethod: 'stability-fast',
        },
      },
    );

    expect(estimate.telemetries.find((entry) => entry.nodeId === 'image-1')?.telemetry).toMatchObject({
      provider: 'stability',
      modelId: 'stable-image-core',
      costUsd: 0.05,
      imageCount: 1,
    });
  });

  it('does not add provider spend for Android configured auto-upscale estimates', () => {
    const estimate = estimateExecutionPlan(
      'image-1',
      [
        createNode('text-1', 'textNode', {
          mode: 'prompt',
          prompt: 'A gold robot walking through fog',
        }),
        createNode('image-1', 'imageGen', {
          provider: 'stability',
          modelId: 'stable-image-core',
          imageAutoUpscale: true,
        }),
      ],
      [{ id: 'edge-text', source: 'text-1', target: 'image-1' }],
      {
        ...settings,
        apiKeys: { ...settings.apiKeys, stability: 'stability-key' },
        providerSettings: {
          ...settings.providerSettings,
          androidAcceleratorBaseUrl: 'http://192.168.1.42:8788',
          paperPrintUpscaleMethod: 'auto',
        },
      },
    );

    expect(estimate.telemetries.find((entry) => entry.nodeId === 'image-1')?.telemetry).toMatchObject({
      provider: 'stability',
      modelId: 'stable-image-core',
      costUsd: 0.03,
      imageCount: 1,
    });
  });
});
