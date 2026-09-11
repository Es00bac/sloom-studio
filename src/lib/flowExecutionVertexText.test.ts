import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { getProviderLimiter } from './providerRateLimiter';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

// Gemini TTS has no Vertex execution path, so (unlike text/image/video) it must run through the
// Gemini API key even in vertex-adc mode. Capture the SDK construction to prove which key ran.
const genAiCapture = vi.hoisted(() => ({
  apiKey: undefined as string | undefined,
  requests: [] as Array<Record<string, unknown>>,
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models: { generateContent: (request: Record<string, unknown>) => Promise<unknown> };
    interactions: { create: (request: Record<string, unknown>) => Promise<unknown> };
    constructor(opts: { apiKey?: string }) {
      genAiCapture.apiKey = opts.apiKey;
      this.models = {
        generateContent: async (request: Record<string, unknown>) => {
          genAiCapture.requests.push(request);
          return {
            candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm' } }] } }],
          };
        },
      };
      this.interactions = {
        create: async (request: Record<string, unknown>) => {
          genAiCapture.requests.push(request);
          return { output_audio: { type: 'audio', data: 'AAAA', mime_type: 'audio/pcm' } };
        },
      };
    }
  },
}));

const baseSettings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'DO_NOT_USE_GEMINI_API_KEY',
    openai: '',
    atlas: '',
    huggingface: '',
    elevenlabs: '',
    bfl: '',
    stability: '',
  },
  defaultModels: {
    text: {
      gemini: 'gemini-3.5-flash',
      openai: 'gpt-4.1-mini',
      huggingface: 'Qwen/Qwen3-4B-Instruct-2507',
    },
    image: {
      gemini: 'gemini-3-pro-image-preview',
      openai: 'gpt-image-2',
      atlas: 'gpt-image-2',
      huggingface: 'black-forest-labs/FLUX.1-dev',
      bfl: 'flux-2-pro',
      stability: 'stable-image-edit-inpaint',
      localOpen: 'Qwen/Qwen-Image-Edit',
      android: 'local-dream-active',
      byteplus: 'seedream-4.5',
    },
    video: {
      gemini: 'veo-3.1-generate-001',
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
    geminiCredentialMode: 'vertex-adc',
    vertexAuthMode: 'gcloud-adc',
    vertexProjectId: 'project-38890c01-de5b-44c9-be4',
    vertexLocation: 'us-central1',
    vertexQuotaProjectId: '',
    vertexEnvironmentVariables: '',
    vertexServiceAccountJson: '',
    paperPrintUpscaleMethod: 'auto',
    paperPdfRasterPreset: 'balanced-jpeg',
    localOpenImageEndpointUrl: '',
    localOpenImageAuthHeader: '',
    localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
    batchMaxRetries: 10,
    batchRetryBaseDelayMs: 30000,
    androidLanServerEnabled: false,
    androidLanServerPin: '',
  },
};

describe('executeNodeRequest Vertex text routing', () => {
  afterEach(() => {
    getProviderLimiter('gemini').minDelayMs = 1500;
    vi.unstubAllGlobals();
  });

  it('uses the Electron native Vertex bridge for Gemini text in Vertex ADC mode', async () => {
    const generateVertexText = vi.fn().mockResolvedValue({
      text: 'Vertex text response',
      statusMessage: 'Generated with gemini-3.5-flash',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexText } });

    const node: AppNode = {
      id: 'text-1',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: {
        mode: 'generate',
        provider: 'gemini',
        modelId: 'gemini-3.5-flash',
        systemPrompt: 'Answer tersely.',
      },
    };

    const result = await executeNodeRequest(
      node,
      {
        prompt: 'Describe the panel.',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      baseSettings,
    );

    expect(result.result).toBe('Vertex text response');
    expect(result.usage).toEqual({
      source: 'actual',
      confidence: 'unknown',
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      notes: [expect.stringContaining('did not report numeric usage')],
    });
    expect(generateVertexText).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-38890c01-de5b-44c9-be4',
      location: 'us-central1',
      modelId: 'gemini-3.5-flash',
    }));
    expect(generateVertexText.mock.calls[0][0].body).toMatchObject({
      contents: [{
        role: 'user',
        parts: [{ text: 'Describe the panel.' }],
      }],
      systemInstruction: {
        parts: [{ text: 'Answer tersely.' }],
      },
    });
  });

  it('cancels the native Vertex request once and rejects a late bridge result', async () => {
    getProviderLimiter('gemini').minDelayMs = 0;
    let resolveVertex!: (value: { text: string; statusMessage: string }) => void;
    const generateVertexText = vi.fn((_request: Record<string, unknown>) => new Promise<{ text: string; statusMessage: string }>((resolve) => {
      resolveVertex = resolve;
    }));
    const cancelVertexGeneration = vi.fn().mockResolvedValue({ cancelled: true });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexText, cancelVertexGeneration } });
    const controller = new AbortController();
    const node: AppNode = {
      id: 'text-cancel',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: { mode: 'generate', provider: 'gemini', modelId: 'gemini-3.5-flash' },
    };

    const pending = executeNodeRequest(
      node,
      { prompt: 'Hold this request.', config: DEFAULT_EXECUTION_CONFIG },
      baseSettings,
      undefined,
      { signal: controller.signal },
    );
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(generateVertexText).toHaveBeenCalledOnce());
    const cancellationId = generateVertexText.mock.calls[0][0].cancellationId;
    expect(cancellationId).toMatch(/^flow-vertex-/);

    controller.abort();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelVertexGeneration).toHaveBeenCalledOnce();
    expect(cancelVertexGeneration).toHaveBeenCalledWith(cancellationId);

    resolveVertex({ text: 'late stale result', statusMessage: 'late' });
    await Promise.resolve();
    expect(cancelVertexGeneration).toHaveBeenCalledOnce();
  });

  it('runs Gemini TTS through the API key even when Vertex mode is selected', async () => {
    // Vertex serves text/image/video but NOT the TTS models; the audio provider dropdown already
    // gates Google audio on the API key, so with a key present TTS must run — not hard-throw on
    // the credential mode (the old behavior made every listed Gemini TTS run fail by default).
    vi.stubGlobal('window', { signalLoomNative: {} });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gemini-tts');
    genAiCapture.apiKey = undefined;
    genAiCapture.requests = [];

    const node: AppNode = {
      id: 'audio-1',
      type: 'audioGen',
      position: { x: 0, y: 0 },
      data: {
        provider: 'gemini',
        modelId: 'gemini-3.1-flash-tts-preview',
      },
    };

    const result = await executeNodeRequest(
      node,
      {
        prompt: 'Narrate this line.',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      baseSettings,
    );

    expect(result.resultType).toBe('audio');
    expect(genAiCapture.apiKey).toBe('DO_NOT_USE_GEMINI_API_KEY');
    expect(genAiCapture.requests[0]).toMatchObject({
      model: 'gemini-3.1-flash-tts-preview',
      input: expect.stringContaining('Narrate this line.'),
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Kore' }] },
    });
  });

  it('fails Gemini TTS with a key-focused error when no API key is configured', async () => {
    vi.stubGlobal('window', { signalLoomNative: {} });

    const node: AppNode = {
      id: 'audio-1',
      type: 'audioGen',
      position: { x: 0, y: 0 },
      data: {
        provider: 'gemini',
        modelId: 'gemini-3.1-flash-tts-preview',
      },
    };

    await expect(
      executeNodeRequest(
        node,
        {
          prompt: 'Narrate this line.',
          config: DEFAULT_EXECUTION_CONFIG,
        },
        { ...baseSettings, apiKeys: { ...baseSettings.apiKeys, gemini: '' } },
      ),
    ).rejects.toThrow('Gemini TTS requires a Gemini API key');
  });
});
