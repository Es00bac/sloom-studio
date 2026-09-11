import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { executeNodeRequest } from './flowExecution';
import { getProviderLimiter } from './providerRateLimiter';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER_SETTINGS,
} from './providerCatalog';

const sdkCapture = vi.hoisted(() => ({
  googleRequests: [] as Array<{ request: Record<string, unknown>; options?: { signal?: AbortSignal } }>,
  hfOptions: [] as Array<{ signal?: AbortSignal } | undefined>,
  openAiBaseUrl: undefined as string | undefined,
  openAiOptions: [] as Array<{ signal?: AbortSignal } | undefined>,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (request: Record<string, unknown>) => {
        sdkCapture.googleRequests.push({ request });
        const config = request.config as { responseModalities?: string[] } | undefined;
        if (config?.responseModalities?.includes('IMAGE')) {
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'SU1H' } }] } }] };
        }
        if (config?.responseModalities?.includes('AUDIO')) {
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }] } }] };
        }
        return { text: 'true\nThe image matches.', usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 } };
      },
    };
    interactions = {
      create: async (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
        sdkCapture.googleRequests.push({ request, options });
        return { output_audio: { type: 'audio', data: 'AAAA', mime_type: 'audio/pcm' } };
      },
    };
  },
}));

vi.mock('openai', () => ({
  default: class {
    constructor(options: { baseURL?: string }) {
      sdkCapture.openAiBaseUrl = options.baseURL;
    }
    chat = {
      completions: {
        create: async (_request: unknown, options?: { signal?: AbortSignal }) => {
          sdkCapture.openAiOptions.push(options);
          return { choices: [{ message: { content: 'direct text' } }] };
        },
      },
    };
    images = {
      generate: async (_request: unknown, options?: { signal?: AbortSignal }) => {
        sdkCapture.openAiOptions.push(options);
        return { data: [{ b64_json: 'SU1H' }] };
      },
      edit: async (_request: unknown, options?: { signal?: AbortSignal }) => {
        sdkCapture.openAiOptions.push(options);
        return { data: [{ b64_json: 'SU1H' }] };
      },
    };
  },
}));

vi.mock('@huggingface/inference', () => ({
  HfInference: class {
    chatCompletion = async (_request: unknown, options?: { signal?: AbortSignal }) => {
      sdkCapture.hfOptions.push(options);
      return { choices: [{ message: { content: 'hf text' } }] };
    };
    textToImage = async (_request: unknown, options?: { signal?: AbortSignal }) => {
      sdkCapture.hfOptions.push(options);
      return new Blob(['IMG'], { type: 'image/png' });
    };
    textToVideo = async (_request: unknown, options?: { signal?: AbortSignal }) => {
      sdkCapture.hfOptions.push(options);
      return new Blob(['VIDEO'], { type: 'video/mp4' });
    };
    textToSpeech = async (_request: unknown, options?: { signal?: AbortSignal }) => {
      sdkCapture.hfOptions.push(options);
      return new Blob(['AUDIO'], { type: 'audio/wav' });
    };
  },
}));

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'gemini-key',
    openai: 'openai-key',
    huggingface: 'hf-key',
    elevenlabs: 'xi-key',
    atlas: 'atlas-key',
  },
  defaultModels: DEFAULT_MODELS,
  providerSettings: {
    ...DEFAULT_PROVIDER_SETTINGS,
    geminiCredentialMode: 'api-key',
    openaiBaseUrl: 'https://custom-openai.example/v1',
    batchMaxRetries: 0,
  },
};

function node(type: AppNode['type'], provider: string, modelId: string, data: AppNode['data'] = {}): AppNode {
  return {
    id: `${provider}-${type}`,
    type,
    position: { x: 0, y: 0 },
    data: { provider, modelId, ...data },
  } as AppNode;
}

describe('direct provider SDK AbortSignal propagation', () => {
  const limiterDelays = new Map<string, number>();

  beforeEach(() => {
    sdkCapture.googleRequests.length = 0;
    sdkCapture.hfOptions.length = 0;
    sdkCapture.openAiOptions.length = 0;
    sdkCapture.openAiBaseUrl = undefined;
    for (const provider of ['gemini', 'openai', 'huggingface']) {
      const limiter = getProviderLimiter(provider);
      limiterDelays.set(provider, limiter.minDelayMs);
      limiter.minDelayMs = 0;
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:provider-result');
  });

  afterEach(() => {
    for (const [provider, delay] of limiterDelays) getProviderLimiter(provider).minDelayMs = delay;
    limiterDelays.clear();
    vi.restoreAllMocks();
  });

  it('passes the exact signal to Gemini direct text and Vision Verify configs', async () => {
    const controller = new AbortController();
    const directText = await executeNodeRequest(
      node('textNode', 'gemini', 'gemini-3.5-flash', { mode: 'generate' }),
      { prompt: 'summarize', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    );
    await executeNodeRequest(
      node('visionVerifyNode', 'gemini', 'gemini-3.5-flash'),
      { prompt: 'verify', editImageInput: 'data:image/png;base64,SU1H', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    );

    expect(sdkCapture.googleRequests).toHaveLength(2);
    for (const { request } of sdkCapture.googleRequests) {
      expect((request.config as { abortSignal?: AbortSignal }).abortSignal).toBe(controller.signal);
    }
    expect(directText.usage).toMatchObject({
      source: 'actual',
      confidence: 'measured',
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      inputTokens: 1,
      totalTokens: 2,
    });
    expect(directText.usage).not.toHaveProperty('outputTokens');
  });

  it('passes the exact signal to Gemini image and audio generation configs', async () => {
    const controller = new AbortController();
    await executeNodeRequest(
      node('imageGen', 'gemini', 'gemini-3-pro-image-preview'),
      { prompt: 'lighthouse', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    );
    await executeNodeRequest(
      node('audioGen', 'gemini', 'gemini-2.5-flash-preview-tts', { audioGenerationMode: 'speech' }),
      { prompt: 'hello', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    );

    expect(sdkCapture.googleRequests).toHaveLength(2);
    for (const { request } of sdkCapture.googleRequests) {
      expect((request.config as { abortSignal?: AbortSignal }).abortSignal).toBe(controller.signal);
    }
  });

  it('passes the exact signal to OpenAI text and image requests on the configured custom endpoint', async () => {
    const controller = new AbortController();
    const directText = await executeNodeRequest(
      node('textNode', 'openai', 'gpt-4.1-mini', { mode: 'generate' }),
      { prompt: 'write', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    );
    await executeNodeRequest(
      node('imageGen', 'openai', 'gpt-image-1'),
      { prompt: 'paint', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    );

    expect(sdkCapture.openAiBaseUrl).toBe('https://custom-openai.example/v1');
    expect(sdkCapture.openAiOptions).toEqual([
      { signal: controller.signal },
      { signal: controller.signal },
    ]);
    expect(directText.usage).toEqual({
      source: 'actual',
      confidence: 'unknown',
      provider: 'openai',
      modelId: 'gpt-4.1-mini',
      notes: [expect.stringContaining('did not report numeric usage')],
    });
  });

  it.each([
    ['textNode', 'Qwen/Qwen3-4B-Instruct-2507'],
    ['imageGen', 'black-forest-labs/FLUX.1-dev'],
    ['videoGen', 'Wan-AI/Wan2.2-T2V-A14B'],
    ['audioGen', 'hexgrad/Kokoro-82M'],
  ] as const)('passes the exact signal to Hugging Face %s', async (type, modelId) => {
    const controller = new AbortController();
    const result = await executeNodeRequest(
      node(type, 'huggingface', modelId, type === 'textNode' ? { mode: 'generate' } : {}),
      {
        prompt: 'generate',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      settings,
      undefined,
      { signal: controller.signal },
    );

    expect(sdkCapture.hfOptions.at(-1)).toEqual({ signal: controller.signal });
    expect(result.usage).toEqual({
      source: 'actual',
      confidence: 'unknown',
      provider: 'huggingface',
      modelId,
      ...(type === 'imageGen' ? { imageCount: 1 } : {}),
      notes: [expect.stringContaining('did not report numeric usage')],
    });
    expect(result.usage).not.toHaveProperty('costUsd');
    expect(result.usage).not.toHaveProperty('inputTokens');
    expect(result.usage).not.toHaveProperty('outputTokens');
  });
});
