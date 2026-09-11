import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

const omniCapture = vi.hoisted(() => ({
  create: vi.fn(async (_request: Record<string, unknown>) => ({
    id: 'interaction-1',
    status: 'completed',
    outputs: [{ type: 'video', mime_type: 'video/mp4', data: 'T01OSQ==' }],
  })),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create: omniCapture.create };
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

function createVideoNode(modelId: string): AppNode {
  return {
    id: 'video-1',
    type: 'videoGen',
    position: { x: 0, y: 0 },
    data: {
      provider: 'gemini',
      modelId,
    },
  };
}

describe('executeNodeRequest Vertex video routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the Electron native Vertex bridge for Veo in Vertex ADC mode', async () => {
    const generateVertexVideo = vi.fn().mockResolvedValue({
      result: 'data:video/mp4;base64,VERTEX',
      resultType: 'video',
      statusMessage: 'Generated with veo-3.1-generate-001',
      mimeType: 'video/mp4',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexVideo } });

    const result = await executeNodeRequest(
      createVideoNode('veo-3.1-generate-001'),
      {
        prompt: 'A cinematic establishing shot.',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 6, videoResolution: '720p' },
      },
      baseSettings,
    );

    expect(result.result).toBe('data:video/mp4;base64,VERTEX');
    expect(generateVertexVideo).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-38890c01-de5b-44c9-be4',
      location: 'us-central1',
      modelId: 'veo-3.1-generate-001',
      route: 'veo-predict-long-running',
    }));
    expect(generateVertexVideo.mock.calls[0][0].body).toMatchObject({
      instances: [{ prompt: 'A cinematic establishing shot.' }],
      parameters: {
        aspectRatio: '16:9',
        durationSeconds: 6,
        resolution: '720p',
      },
    });
  });

  it('materializes a remote extension video before the Vertex Veo bridge request', async () => {
    const remoteVideo = 'https://cdn.example/extension.mp4?temporary=hidden';
    const generateVertexVideo = vi.fn().mockResolvedValue({
      result: 'data:video/mp4;base64,VERTEX',
      resultType: 'video',
      statusMessage: 'Generated with veo-3.1-generate-001',
      mimeType: 'video/mp4',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexVideo } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Blob(['VIDEO'], { type: 'video/mp4' }),
      { status: 200, headers: { 'content-type': 'video/mp4' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createVideoNode('veo-3.1-generate-001'),
      {
        prompt: 'Continue the motion.',
        extensionVideoInput: remoteVideo,
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 8, videoResolution: '720p' },
      },
      baseSettings,
    );

    expect(fetchMock).toHaveBeenCalledWith(remoteVideo, { signal: undefined });
    expect(generateVertexVideo.mock.calls[0][0].body.instances[0].video).toEqual({
      bytesBase64Encoded: 'VklERU8=',
      mimeType: 'video/mp4',
    });
    expect(JSON.stringify(generateVertexVideo.mock.calls[0][0].body)).not.toContain(remoteVideo);
  });

  it('preserves a Gemini preview ID in Vertex mode and fails with an actionable route warning', async () => {
    const generateVertexVideo = vi.fn().mockResolvedValue({
      result: 'data:video/mp4;base64,VERTEX',
      resultType: 'video',
      statusMessage: 'Generated with veo-3.1-generate-001',
      mimeType: 'video/mp4',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexVideo } });

    await expect(
      executeNodeRequest(
        createVideoNode('veo-3.1-generate-preview'),
        {
          prompt: 'A cinematic establishing shot.',
          config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 6, videoResolution: '720p' },
        },
        {
          ...baseSettings,
          providerSettings: {
            ...baseSettings.providerSettings,
            vertexLocation: 'global',
          },
        },
      ),
    ).rejects.toThrow('Gemini Developer API model ID');

    expect(generateVertexVideo).not.toHaveBeenCalled();
  });

  it('fails closed in Vertex mode when the Vertex video bridge is unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('window', { signalLoomNative: {} });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      executeNodeRequest(
        createVideoNode('veo-3.1-generate-001'),
        {
          prompt: 'A cinematic establishing shot.',
          config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 6, videoResolution: '720p' },
        },
        baseSettings,
      ),
    ).rejects.toThrow('Vertex AI video requires');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes Gemini Omni video through Vertex generateContent without using the Gemini API key path', async () => {
    const generateVertexVideo = vi.fn().mockResolvedValue({
      result: 'data:video/mp4;base64,OMNI',
      resultType: 'video',
      statusMessage: 'Generated with gemini-omni-flash-preview',
      mimeType: 'video/mp4',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexVideo } });

    await executeNodeRequest(
      createVideoNode('gemini-omni-flash'),
      {
        prompt: 'Make the character turn and wave.',
        startImageInput: 'data:image/png;base64,U1RBUlQ=',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 8, videoResolution: '720p' },
      },
      baseSettings,
    );

    expect(generateVertexVideo).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gemini-omni-flash-preview',
      route: 'gemini-generate-content',
      apiVersion: 'v1beta1',
    }));
    expect(generateVertexVideo.mock.calls[0][0].body).toMatchObject({
      generationConfig: {
        responseModalities: ['VIDEO'],
      },
    });
    expect(generateVertexVideo.mock.calls[0][0].body.contents[0].parts).toContainEqual({
      text: 'Make the character turn and wave.',
    });
  });

  it('blocks Omni end-frame interpolation before either credential route sends a request', async () => {
    const generateVertexVideo = vi.fn();
    vi.stubGlobal('window', { signalLoomNative: { generateVertexVideo } });

    await expect(
      executeNodeRequest(
        createVideoNode('gemini-omni-flash-preview'),
        {
          prompt: 'Interpolate these frames.',
          startImageInput: 'data:image/png;base64,U1RBUlQ=',
          endImageInput: 'data:image/png;base64,RU5E',
          config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 5, videoResolution: '720p' },
        },
        baseSettings,
      ),
    ).rejects.toThrow('does not support first/last-frame interpolation');

    expect(generateVertexVideo).not.toHaveBeenCalled();
  });

  it('routes Gemini Omni API-key generation through the Interactions API contract', async () => {
    omniCapture.create.mockClear();

    const result = await executeNodeRequest(
      createVideoNode('gemini-omni-flash-preview'),
      {
        prompt: 'One unbroken shot of a character waving.',
        startImageInput: 'data:image/png;base64,U1RBUlQ=',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '9:16', durationSeconds: 5, videoResolution: '720p' },
      },
      {
        ...baseSettings,
        providerSettings: {
          ...baseSettings.providerSettings,
          geminiCredentialMode: 'api-key',
        },
      },
    );

    expect(result.resultType).toBe('video');
    expect(omniCapture.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-omni-flash-preview',
      response_format: { type: 'video', aspect_ratio: '9:16' },
      generation_config: {
        video_config: { task: 'image_to_video', duration: 5 },
      },
    }));
    expect(omniCapture.create.mock.calls[0][0].input).toEqual(expect.arrayContaining([
      { type: 'text', text: 'One unbroken shot of a character waving.' },
      expect.objectContaining({ type: 'image', data: 'U1RBUlQ=', mime_type: 'image/png' }),
    ]));
  });
});
