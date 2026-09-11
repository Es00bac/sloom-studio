import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

const baseSettings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: '',
    openai: '',
    atlas: '',
    huggingface: '',
    elevenlabs: '',
    bfl: '',
    stability: '',
  },
  defaultModels: {
    text: {
      gemini: 'gemini-3-flash-preview',
      openai: 'gpt-4.1-mini',
      huggingface: 'Qwen/Qwen3-4B-Instruct-2507',
    },
    image: {
      gemini: 'gemini-3-pro-image-preview',
      openai: 'gpt-image-1',
      atlas: 'gpt-image-2',
      huggingface: 'black-forest-labs/FLUX.1-dev',
      bfl: 'flux-2-pro',
      stability: 'stable-image-edit-inpaint',
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
    geminiCredentialMode: 'vertex-adc',
    vertexAuthMode: 'gcloud-user',
    vertexProjectId: 'gen-lang-client-0529114074',
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
    batchRetryBaseDelayMs: 30000, 
    androidLanServerEnabled: false, 
    androidLanServerPin: "",
  },
};

function createImageNode(modelId: string, data: AppNode['data'] = {}): AppNode {
  return {
    id: 'image-1',
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: {
      provider: 'gemini',
      modelId,
      ...data,
    },
  };
}

describe('executeNodeRequest Vertex image routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the Electron native Vertex bridge for Gemini image models in Vertex ADC mode', async () => {
    const generateVertexImage = vi.fn().mockResolvedValue({
      result: 'data:image/png;base64,VERTEX',
      resultType: 'image',
      statusMessage: 'Generated with gemini-3-pro-image-preview',
      mimeType: 'image/png',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexImage } });

    const result = await executeNodeRequest(
      createImageNode('gemini-3-pro-image-preview'),
      {
        prompt: 'A clean comic panel.',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9' },
      },
      baseSettings,
    );

    expect(result.result).toBe('data:image/png;base64,VERTEX');
    expect(generateVertexImage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'gen-lang-client-0529114074',
      location: 'global',
      modelId: 'gemini-3-pro-image-preview',
      route: 'gemini-generate-content',
    }));
    expect(generateVertexImage.mock.calls[0][0].body).toMatchObject({
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
        },
      },
    });
  });

  it('threads the node imageResolutionTier through to the Vertex imageConfig imageSize', async () => {
    const generateVertexImage = vi.fn().mockResolvedValue({
      result: 'data:image/png;base64,VERTEX',
      resultType: 'image',
      statusMessage: 'Generated with gemini-3-pro-image-preview',
      mimeType: 'image/png',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexImage } });

    await executeNodeRequest(
      createImageNode('gemini-3-pro-image-preview', { imageResolutionTier: '2K' }),
      {
        prompt: 'A poster-resolution panel.',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9' },
      },
      baseSettings,
    );

    expect(generateVertexImage.mock.calls[0][0].body).toMatchObject({
      generationConfig: {
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '2K',
        },
      },
    });
  });

  it('uses the Vertex predict route for Imagen 4 models', async () => {
    const generateVertexImage = vi.fn().mockResolvedValue({
      result: 'data:image/png;base64,IMAGEN',
      resultType: 'image',
      statusMessage: 'Generated with imagen-4.0-fast-generate-001',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexImage } });

    await executeNodeRequest(
      createImageNode('imagen-4.0-fast-generate-001'),
      {
        prompt: 'A text-free exterior shot.',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '4:3' },
      },
      baseSettings,
    );

    expect(generateVertexImage).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'imagen-4.0-fast-generate-001',
      route: 'imagen-predict',
      body: {
        instances: [{ prompt: 'A text-free exterior shot.' }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '4:3',
        },
      },
    }));
  });

  it('rejects Imagen models outside Vertex ADC mode with a setup-focused error', async () => {
    await expect(
      executeNodeRequest(
        createImageNode('imagen-4.0-generate-001'),
        {
          prompt: 'A clean panel.',
          config: DEFAULT_EXECUTION_CONFIG,
        },
        {
          ...baseSettings,
          providerSettings: {
            ...baseSettings.providerSettings,
            geminiCredentialMode: 'api-key',
          },
        },
      ),
    ).rejects.toThrow('Imagen models require Vertex AI mode');
  });
});
