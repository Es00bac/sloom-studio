import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

// Capture the baseURL the OpenAI SDK client is constructed with, so we can prove Atlas OpenAI-compatible
// models (gpt-image) never get pointed at api.openai.com (which would send the Atlas key to OpenAI).
const openAiCapture = vi.hoisted(() => ({
  baseURL: undefined as string | undefined,
  generateArgs: undefined as Record<string, unknown> | undefined,
  editArgs: undefined as Record<string, unknown> | undefined,
}));
vi.mock('openai', () => ({
  default: class {
    constructor(opts: { baseURL?: string }) { openAiCapture.baseURL = opts.baseURL; }
    images = {
      generate: async (args: Record<string, unknown>) => {
        openAiCapture.generateArgs = args;
        return { data: [{ b64_json: 'aW1n' }] };
      },
      edit: async (args: Record<string, unknown>) => {
        openAiCapture.editArgs = args;
        return { data: [{ b64_json: 'aW1n' }] };
      },
    };
  },
}));

const baseSettings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: '',
    openai: '',
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
    localOpenImageAuthHeader: 'Bearer local-token',
    localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
    batchMaxRetries: 10,
    batchRetryBaseDelayMs: 30000, androidLanServerEnabled: false, androidLanServerPin: "",
  },
};

function createImageNode(
  provider: AppNode['data']['provider'],
  modelId: string,
  data: AppNode['data'] = {},
): AppNode {
  return {
    id: 'image-1',
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: {
      provider,
      modelId,
      ...data,
    },
  } as AppNode;
}

function imageResponse(body = 'PNG'): Response {
  return new Response(new Blob([body], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('executeNodeRequest advanced image providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends BytePlus exact model IDs and custom dimensions with the documented size field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'QllURVBMVVM=' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('byteplus', 'seedream-5-0-260128', {
        imageWidth: 2048,
        imageHeight: 1152,
        imageSeed: 42,
      }),
      {
        prompt: 'cinematic alpine observatory',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, byteplus: 'byteplus-key' },
      },
    );

    expect(result.result).toBe('data:image/png;base64,QllURVBMVVM=');
    expect(result.usage).toEqual({
      source: 'actual',
      confidence: 'unknown',
      provider: 'byteplus',
      modelId: 'seedream-5-0-260128',
      imageCount: 1,
      notes: [expect.stringContaining('did not report numeric usage')],
    });
    expect(result.usage).not.toHaveProperty('costUsd');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: 'seedream-5-0-260128',
      prompt: 'cinematic alpine observatory',
      size: '2048x1152',
      seed: 42,
    });
    expect(body).not.toHaveProperty('image_size');
  });

  it('submits and polls BFL FLUX.2 image edits with source and reference images', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 'bfl-job',
        polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-job',
        cost: 4.5,
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'Ready',
        result: { sample: 'data:image/png;base64,QkZM' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('bfl', 'flux-2-pro', {
        imageExactColor: '#0057ff',
        imageTextEditPrompt: 'replace the sign text with OPEN LATE',
        imageSeed: 77,
      }),
      {
        prompt: 'Update the storefront.',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        editReferenceImageInputs: ['data:image/png;base64,UkVG'],
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', imageOutputFormat: 'webp' },
      },
      baseSettings,
    );

    expect(result.result).toBe('data:image/png;base64,QkZM');
    expect(result.usage).toMatchObject({
      provider: 'bfl',
      modelId: 'flux-2-pro',
      costUsd: 0.045,
      imageCount: 1,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.bfl.ai/v1/flux-2-pro', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-key': 'bfl-key' }),
    }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      input_image: 'data:image/png;base64,U09VUkNF',
      input_image_2: 'data:image/png;base64,UkVG',
      width: 1376,
      height: 768,
      output_format: 'webp',
      seed: 77,
    });
    expect(body.prompt).toContain('Update the storefront.');
    expect(body.prompt).toContain('#0057ff');
    expect(body.prompt).toContain('OPEN LATE');
  });

  it('materializes a remote BFL edit image through the native fallback before submission', async () => {
    const remoteSource = 'https://cdn.example/source.png?temporary=hidden';
    const downloadRemoteMedia = vi.fn().mockResolvedValue({
      base64: 'U09VUkNF',
      mimeType: 'image/png',
    });
    vi.stubGlobal('window', { signalLoomNative: { downloadRemoteMedia } });
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url === remoteSource) throw new TypeError('renderer transport unavailable');
      if (url === 'https://api.bfl.ai/v1/flux-2-pro') {
        return jsonResponse({
          id: 'bfl-remote-job',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-remote-job',
          cost: 4.5,
        });
      }
      return jsonResponse({
        status: 'Ready',
        result: { sample: 'data:image/png;base64,QkZM' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createImageNode('bfl', 'flux-2-pro'),
      {
        prompt: 'Update the storefront.',
        editImageInput: remoteSource,
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' },
      },
      baseSettings,
    );

    expect(downloadRemoteMedia).toHaveBeenCalledWith(remoteSource);
    const providerCall = fetchMock.mock.calls.find(([input]) => String(input) === 'https://api.bfl.ai/v1/flux-2-pro');
    const body = JSON.parse(String(providerCall?.[1]?.body));
    expect(body.input_image).toBe('data:image/png;base64,U09VUkNF');
    expect(JSON.stringify(body)).not.toContain(remoteSource);
  });

  it('runs Stability text-to-image through the Core generation endpoint', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-core');
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('CORE'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-core'),
      {
        prompt: 'storybook castle at sunrise',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '3:2', imageOutputFormat: 'webp' },
      },
      baseSettings,
    );

    expect(result.result).toBe('blob:stability-core');
    expect(createObjectURL).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stability.ai/v2beta/stable-image/generate/core',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer stability-key',
          Accept: 'image/*',
        }),
      }),
    );

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toBe('storybook castle at sunrise');
    expect(body.get('aspect_ratio')).toBe('3:2');
    expect(body.get('output_format')).toBe('webp');
    expect(result.usage).toMatchObject({ provider: 'stability', costUsd: 0.03 });
  });

  it('auto-upscales generated Flow images with the configured paid upscaler and combined cost telemetry', async () => {
    const attributed: Array<{ node: AppNode; usage: NonNullable<Awaited<ReturnType<typeof executeNodeRequest>>['usage']> }> = [];
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:stability-core')
      .mockReturnValueOnce('blob:stability-upscaled');
    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (String(url) === 'blob:stability-core') {
        return imageResponse('CORE');
      }
      return imageResponse(String(url).includes('/stable-image/upscale/fast') ? 'UPSCALED' : 'CORE');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-core', {
        imageAutoUpscale: true,
      }),
      {
        prompt: 'storybook castle at sunrise',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '3:2', imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        providerSettings: {
          ...baseSettings.providerSettings,
          paperPrintUpscaleMethod: 'stability-fast',
        },
      },
      undefined,
      { onInternalUsage: (entry) => attributed.push(entry) },
    );

    expect(result.result).toBe('blob:stability-upscaled');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stable-image/upscale/fast'))).toBe(true);
    expect(result.statusMessage).toContain('auto-upscaled');
    expect(result.usage).toMatchObject({
      provider: 'stability',
      modelId: 'stable-image-core',
      costUsd: 0.05,
      imageCount: 1,
    });
    expect(result.usageAttributions).toHaveLength(2);
    expect(attributed.map(({ node, usage }) => ({
      operation: node.data.imageOperation,
      provider: usage.provider,
      modelId: usage.modelId,
      costUsd: usage.costUsd,
    }))).toEqual([
      { operation: undefined, provider: 'stability', modelId: 'stable-image-core', costUsd: 0.03 },
      { operation: 'upscale', provider: 'stability', modelId: 'stable-image-upscale-fast', costUsd: 0.02 },
    ]);
  });

  it('still retries transient direct-path provider failures after the !canRun classifier change (K3)', async () => {
    const attributed = vi.fn();
    // Regression guard: classifying the auto-upscale !canRun error as NonRetryableError
    // must not broadly disable retries for genuine transient provider/network failures.
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:stability-core')
      .mockReturnValueOnce('blob:stability-upscaled');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('transient Stability network blip'))
      .mockImplementation(async (url: RequestInfo | URL) => {
        const stringUrl = String(url);
        if (stringUrl === 'blob:stability-core' || stringUrl.includes('/stable-image/generate/core')) {
          return imageResponse('CORE');
        }
        if (stringUrl === 'blob:stability-upscaled' || stringUrl.includes('/stable-image/upscale/fast')) {
          return imageResponse('UPSCALED');
        }
        throw new Error(`unexpected fetch: ${stringUrl}`);
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-core', {
        imageAutoUpscale: true,
      }),
      {
        prompt: 'storybook castle at sunrise',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '3:2', imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        providerSettings: {
          ...baseSettings.providerSettings,
          paperPrintUpscaleMethod: 'stability-fast',
          batchMaxRetries: 2,
          batchRetryBaseDelayMs: 1,
        },
      },
      undefined,
      { onInternalUsage: attributed },
    );

    const generateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/stable-image/generate/core'),
    );
    expect(generateCalls).toHaveLength(2);
    expect(result.statusMessage).toContain('auto-upscaled');
    expect(attributed).toHaveBeenCalledTimes(2);
    expect(attributed.mock.calls.map(([entry]) => entry.usage.modelId)).toEqual([
      'stable-image-core',
      'stable-image-upscale-fast',
    ]);
  });

  it('does not repeat an accepted configured Stability upscale when response materialization retries', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:stability-before-upscale')
      .mockReturnValueOnce('blob:stability-after-upscale');
    const acceptedBlob = vi.fn()
      .mockRejectedValueOnce(new TypeError('transient response body read failure'))
      .mockResolvedValueOnce(new Blob(['UPSCALED'], { type: 'image/png' }));
    const acceptedResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      clone: () => ({ blob: acceptedBlob }),
    } as unknown as Response;
    let upscalePosts = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/stable-image/upscale/fast')) {
        upscalePosts += 1;
        return acceptedResponse;
      }
      return imageResponse(requestUrl.startsWith('blob:') ? 'SOURCE' : 'GENERATED');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-core', { imageAutoUpscale: true }),
      { prompt: 'one paid upscale only', config: DEFAULT_EXECUTION_CONFIG },
      {
        ...baseSettings,
        providerSettings: {
          ...baseSettings.providerSettings,
          paperPrintUpscaleMethod: 'stability-fast',
          batchMaxRetries: 1,
          batchRetryBaseDelayMs: 0,
        },
      },
    );

    expect(result.result).toBe('blob:stability-after-upscale');
    expect(upscalePosts).toBe(1);
    expect(acceptedBlob).toHaveBeenCalledTimes(2);
  });

  it('auto-upscales generated Flow images with the configured legacy local route', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:stability-core')
      .mockReturnValueOnce('blob:stability-upscaled');
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const stringUrl = String(url);
      if (stringUrl.startsWith('blob:')) {
        return imageResponse('CORE');
      }
      if (stringUrl.includes('/v1/upscale')) {
        return imageResponse('UPSCALED');
      }
      if (stringUrl.includes('/stable-image/generate/core')) {
        return imageResponse('CORE');
      }
      return imageResponse('CORE');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-core', {
        imageAutoUpscale: true,
      }),
      {
        prompt: 'storybook castle at sunrise',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '3:2', imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        providerSettings: {
          ...baseSettings.providerSettings,
          paperPrintUpscaleMethod: 'auto',
          localAiCpuEndpointUrl: 'http://127.0.0.1:8788',
          localAiCpuModel: 'realesrgan-4x',
        },
      },
    );

    expect(result.result).toBe('data:image/png;base64,VVBTQ0FMRUQ=');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const upscaleCall = fetchMock.mock.calls.find(([requestUrl]) => String(requestUrl).includes('/v1/upscale'));
    expect(upscaleCall).toBeTruthy();
    expect(result.statusMessage).toContain('auto-upscaled');
    expect(result.usage).toMatchObject({
      provider: 'stability',
      modelId: 'stable-image-core',
      costUsd: 0.03,
      imageCount: 1,
    });
  });

  it('runs Stability search-and-replace edits with source image and search prompt', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-edit');
    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (String(url).startsWith('data:')) {
        return imageResponse('SOURCE');
      }

      return imageResponse('EDIT');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-edit-search-replace', {
        imageSearchPrompt: 'red mug',
      }),
      {
        prompt: 'replace it with a blue ceramic mug',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      baseSettings,
    );

    expect(result.result).toBe('blob:stability-edit');
    expect(createObjectURL).toHaveBeenCalled();
    const apiCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/stable-image/edit/search-and-replace'),
    );
    expect(apiCall).toBeTruthy();
    const body = apiCall?.[1]?.body as FormData;
    expect(body.get('prompt')).toBe('replace it with a blue ceramic mug');
    expect(body.get('search_prompt')).toBe('red mug');
    expect(body.get('image')).toBeInstanceOf(File);
    expect(result.usage).toMatchObject({ provider: 'stability', costUsd: 0.05 });
  });

  it('runs Stability erase edits with source image, erase mask, and the dedicated endpoint', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-erase');
    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (String(url).startsWith('data:')) {
        return imageResponse('SOURCE');
      }

      return imageResponse('EDIT');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-edit-erase', {
        imageOperation: 'erase',
      }),
      {
        prompt: 'remove the person from the lower-left corner',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        editMaskImageInput: 'data:image/png;base64,TU9HUw==',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      baseSettings,
    );

    expect(result.result).toBe('blob:stability-erase');
    expect(createObjectURL).toHaveBeenCalled();
    const apiCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/stable-image/edit/erase'),
    );
    expect(apiCall).toBeTruthy();
    const body = apiCall?.[1]?.body as FormData;
    // Erase is prompt-less (image + mask only) — an upstream prompt must never ride along.
    expect(body.get('prompt')).toBeNull();
    expect(body.get('output_format')).toBe('png');
    expect(body.get('image')).toBeInstanceOf(File);
    expect(body.get('mask')).toBeInstanceOf(File);
    expect(result.usage).toMatchObject({ provider: 'stability', costUsd: 0.05 });
  });

  it('sends output_format, low moderation, and quality to first-party OpenAI gpt-image generation', async () => {
    openAiCapture.generateArgs = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:openai-gen');
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('IMG')));

    const result = await executeNodeRequest(
      createImageNode('openai', 'gpt-image-2', { imageQuality: 'high' }),
      {
        prompt: 'a hero shot of a walnut desk organizer',
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'webp' },
      },
      { ...baseSettings, apiKeys: { ...baseSettings.apiKeys, openai: 'sk-openai' } },
    );

    // The node's format select used to be silently ignored for OpenAI — the result was labeled png
    // regardless. Now the format rides on the request and the returned data URL is typed to match.
    expect(openAiCapture.generateArgs).toMatchObject({
      model: 'gpt-image-2',
      output_format: 'webp',
      moderation: 'low',
      quality: 'high',
    });
    expect(typeof result.result).toBe('string');
    if (typeof result.result !== 'string') {
      throw new Error('Image execution returned a non-media value.');
    }
    expect(result.result.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('sends source + reference images as an image array to OpenAI images.edit', async () => {
    openAiCapture.editArgs = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:openai-edit');
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('IMG')));

    await executeNodeRequest(
      createImageNode('openai', 'gpt-image-2'),
      {
        prompt: 'place the character from the reference into the scene',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        editReferenceImageInputs: [
          'data:image/png;base64,UkVGMQ==',
          'data:image/png;base64,UkVGMg==',
        ],
        config: DEFAULT_EXECUTION_CONFIG,
      },
      { ...baseSettings, apiKeys: { ...baseSettings.apiKeys, openai: 'sk-openai' } },
    );

    // gpt-image edits accept up to 16 input images; references used to be hard-rejected.
    const editArgs = openAiCapture.editArgs as Record<string, unknown> | undefined;
    const image = editArgs?.image as File[];
    expect(Array.isArray(image)).toBe(true);
    expect(image).toHaveLength(3);
    expect(editArgs).toMatchObject({ model: 'gpt-image-2', output_format: 'png' });
  });

  it('keeps the Atlas OpenAI-compatible route on the single-image contract without gpt-image extras', async () => {
    openAiCapture.editArgs = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-edit');
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('IMG')));

    await executeNodeRequest(
      createImageNode('atlas', 'openai/gpt-image-2/edit'),
      {
        prompt: 'swap the sign text',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        providerSettings: { ...baseSettings.providerSettings, atlasBaseUrl: 'https://api.atlascloud.ai/api/v1' },
      },
    );

    const atlasEditArgs = openAiCapture.editArgs as Record<string, unknown> | undefined;
    expect(atlasEditArgs?.image).toBeInstanceOf(File);
    expect(atlasEditArgs?.output_format).toBeUndefined();
    expect(atlasEditArgs?.moderation).toBeUndefined();
  });

  it('runs Stability replace-background-relight as an async job: subject_image, background_prompt, results polling', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-relight');
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const urlString = String(url);
      if (urlString.startsWith('data:')) {
        return imageResponse('SOURCE');
      }
      if (urlString.includes('/stable-image/edit/replace-background-and-relight')) {
        return jsonResponse({ id: 'gen-123' });
      }
      if (urlString.includes('/v2beta/results/gen-123')) {
        return imageResponse('RELIT');
      }
      throw new Error(`Unexpected fetch: ${urlString}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-edit-replace-background-relight', {}),
      {
        prompt: 'sunlit scandinavian studio, soft window light',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      baseSettings,
    );

    expect(result.result).toBe('blob:stability-relight');
    expect(createObjectURL).toHaveBeenCalled();
    const submit = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/stable-image/edit/replace-background-and-relight'),
    );
    expect(submit).toBeTruthy();
    const body = submit?.[1]?.body as FormData;
    // The async endpoint names the source `subject_image` and the prompt `background_prompt`;
    // the old `image` + `prompt` shape was rejected outright.
    expect(body.get('subject_image')).toBeInstanceOf(File);
    expect(body.get('image')).toBeNull();
    expect(body.get('background_prompt')).toBe('sunlit scandinavian studio, soft window light');
    expect(body.get('prompt')).toBeNull();
    const poll = fetchMock.mock.calls.find(([url]) => String(url).includes('/v2beta/results/gen-123'));
    expect(poll).toBeTruthy();
    expect(result.usage).toMatchObject({ provider: 'stability', costUsd: 0.08 });
  });

  it('runs Stability Fast Upscale through the upscale endpoint with exact pricing', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-upscale');
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(url).startsWith('data:')) {
        return imageResponse('SOURCE');
      }

      return imageResponse('UPSCALED');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('stability', 'stable-image-upscale-fast', {
        imageOperation: 'upscale',
      }),
      {
        prompt: 'Upscale faithfully for print.',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' },
      },
      baseSettings,
    );

    expect(result.result).toBe('blob:stability-upscale');
    expect(createObjectURL).toHaveBeenCalled();
    const apiCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/stable-image/upscale/fast'),
    );
    expect(apiCall).toBeTruthy();
    const body = apiCall?.[1]?.body as FormData;
    expect(body.get('output_format')).toBe('png');
    expect(body.get('image')).toBeInstanceOf(File);
    expect(result.usage).toMatchObject({
      provider: 'stability',
      modelId: 'stable-image-upscale-fast',
      costUsd: 0.02,
      confidence: 'fixed',
    });
  });

  it('runs Stability Conservative Upscale with prompt and creativity controls', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(url).startsWith('data:')) {
        return imageResponse('SOURCE');
      }

      return imageResponse('UPSCALED');
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-conservative-upscale');
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createImageNode('stability', 'stable-image-upscale-conservative', {
        imageOperation: 'upscale',
        imageCreativity: 0.2,
      }),
      {
        prompt: 'Preserve line art and readable lettering.',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'webp' },
      },
      baseSettings,
    );

    const apiCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/stable-image/upscale/conservative'),
    );
    expect(apiCall).toBeTruthy();
    const body = apiCall?.[1]?.body as FormData;
    expect(body.get('output_format')).toBe('webp');
    expect(body.get('prompt')).toBe('Preserve line art and readable lettering.');
    expect(body.get('creativity')).toBe('0.2');
  });

  it('routes Atlas Cloud native text-to-image models through generateImage and prediction polling', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-generated');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'atlas-job' } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          status: 'succeeded',
          outputs: ['https://cdn.atlascloud.ai/generated.png'],
        },
      }))
      .mockResolvedValueOnce(imageResponse('ATLAS'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('atlas', 'black-forest-labs/flux-schnell', {
        imageSeed: 77,
        imageGuidanceScale: 2.5,
        imageSafetyCheckerEnabled: false,
      }),
      {
        prompt: 'cinematic desert observatory at sunrise',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', steps: 20, imageOutputFormat: 'webp' },
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        providerSettings: {
          ...baseSettings.providerSettings,
          atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        },
      },
    );

    expect(result.result).toBe('blob:atlas-generated');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(result.usage).toMatchObject({
      provider: 'atlas',
      modelId: 'black-forest-labs/flux-schnell',
      costUsd: 0.003,
      imageCount: 1,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.atlascloud.ai/api/v1/model/generateImage', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer atlas-key',
        'Content-Type': 'application/json',
      }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.atlascloud.ai/api/v1/model/prediction/atlas-job', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer atlas-key' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://cdn.atlascloud.ai/generated.png');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: 'black-forest-labs/flux-schnell',
      prompt: 'cinematic desert observatory at sunrise',
      // flux-schnell documents a free-range `size` ("W*H") — only that is sent (no undocumented width/height).
      size: '1376*768',
      seed: 77,
      enable_safety_checker: false,
    });
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
    // flux-schnell's schema has no num_inference_steps/guidance_scale/output_format — the body filter drops
    // these undocumented fields so the model never rejects the request.
    expect(body.num_inference_steps).toBeUndefined();
    expect(body.guidance_scale).toBeUndefined();
    expect(body.output_format).toBeUndefined();
  });

  it('sends custom width/height (overriding the aspect-ratio preset) for size-capable Atlas models', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'atlas-job' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'succeeded', outputs: ['https://cdn.atlascloud.ai/generated.png'] } }))
      .mockResolvedValueOnce(imageResponse('ATLAS'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-generated');

    await executeNodeRequest(
      createImageNode('atlas', 'black-forest-labs/flux-schnell', {
        imageWidth: 1024,
        imageHeight: 1536,
      }),
      {
        prompt: 'portrait poster',
        // 16:9 preset would be 1376×768; the custom size must win.
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9' },
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        providerSettings: { ...baseSettings.providerSettings, atlasBaseUrl: 'https://api.atlascloud.ai/api/v1' },
      },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    // Custom W×H flow through as the model's documented `size` string (free-range).
    expect(body.size).toBe('1024*1536');
    expect(body.width).toBeUndefined();
  });

  it('routes Atlas OpenAI-compatible models (gpt-image) to the Atlas endpoint even when atlasBaseUrl is unset — never api.openai.com', async () => {
    openAiCapture.baseURL = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-gpt');

    await executeNodeRequest(
      createImageNode('atlas', 'gpt-image-2'),
      { prompt: 'a test render', config: { ...DEFAULT_EXECUTION_CONFIG } },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        // atlasBaseUrl intentionally EMPTY (the default). The Atlas key must still hit Atlas, so the SDK
        // must be constructed with the Atlas base URL — not fall back to the OpenAI default endpoint.
        providerSettings: { ...baseSettings.providerSettings, atlasBaseUrl: '' },
      },
    );

    expect(openAiCapture.baseURL).toBe('https://api.atlascloud.ai/api/v1');
    expect(openAiCapture.baseURL).not.toContain('openai');
  });

  it('falls back to the remote URL when the result CDN blocks the download (CORS) so the image still appears', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'atlas-job' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'succeeded', outputs: ['https://cdn.atlascloud.ai/generated.png'] } }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')); // CDN download is CORS-blocked under webSecurity
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('atlas', 'black-forest-labs/flux-schnell'),
      { prompt: 'neon alley', config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9' } },
      { ...baseSettings, apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' } },
    );

    expect(result.resultType).toBe('image');
    // The generated image still appears (via the remote URL) instead of vanishing.
    expect(result.result).toBe('https://cdn.atlascloud.ai/generated.png');
  });

  it('downloads Atlas Cloud native remote outputs before returning the Flow image result', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-downloaded-result');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'atlas-job' } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          status: 'succeeded',
          outputs: ['https://cdn.atlascloud.ai/generated.png'],
        },
      }))
      .mockResolvedValueOnce(imageResponse('ATLAS'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('atlas', 'black-forest-labs/flux-schnell'),
      {
        prompt: 'cyberpunk mage raising a luminous compiler sigil',
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        providerSettings: {
          ...baseSettings.providerSettings,
          atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        },
      },
    );

    expect(result.result).toBe('blob:atlas-downloaded-result');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://cdn.atlascloud.ai/generated.png');
  });

  it('uploads the source image and builds a singular-`image` Atlas edit request (qwen edit has no mask field)', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-edit');
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const stringUrl = String(url);
      if (stringUrl.includes('/model/uploadMedia')) {
        return jsonResponse({ data: { download_url: 'https://static.atlascloud.ai/source.png' } });
      }
      if (stringUrl.includes('/model/generateImage')) {
        return jsonResponse({ data: { id: 'atlas-edit-job' } });
      }
      if (stringUrl.includes('/model/prediction/atlas-edit-job')) {
        return jsonResponse({ data: { status: 'completed', output: 'https://cdn.atlascloud.ai/edit.png' } });
      }
      if (stringUrl === 'https://cdn.atlascloud.ai/edit.png') {
        return imageResponse('EDIT');
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('atlas', 'atlascloud/qwen-image/edit', {
        imageTextEditPrompt: 'replace the sign text with OPEN LATE',
        imageEditStrength: 0.65,
      }),
      {
        prompt: 'Modify the storefront without changing the person.',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        providerSettings: {
          ...baseSettings.providerSettings,
          atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        },
      },
    );

    expect(result.result).toBe('blob:atlas-edit');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(result.usage).toMatchObject({
      provider: 'atlas',
      modelId: 'atlascloud/qwen-image/edit',
      costUsd: 0.032,
      imageCount: 1,
    });
    // Only the source is uploaded — qwen edit has no mask field, so no second (mask) upload.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/model/uploadMedia'))).toHaveLength(1);
    const generateCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/model/generateImage'));
    expect(generateCall).toBeTruthy();
    const body = JSON.parse(String(generateCall?.[1]?.body));
    // qwen-image/edit takes a singular `image` field, not an `images` array, and no mask_image.
    expect(body).toMatchObject({
      model: 'atlascloud/qwen-image/edit',
      image: 'https://static.atlascloud.ai/source.png',
    });
    // Its schema documents no strength/output_format — the body filter drops them so it isn't rejected.
    expect(body.strength).toBeUndefined();
    expect(body.output_format).toBeUndefined();
    expect(body.mask_image).toBeUndefined();
    expect(body.images).toBeUndefined();
    expect(body.reference_images).toBeUndefined();
    expect(body.prompt).toContain('Modify the storefront without changing the person.');
    expect(body.prompt).toContain('OPEN LATE');
  });

  it('feeds the source + reference images into the `images` array for array-field Atlas edit models', async () => {
    // The core character-consistency fix: array-field models (e.g. nano-banana-2/edit) must receive
    // [source, ...references] under `images` — NOT a singular `image` or a (nonexistent) `reference_images`
    // field. Sending the wrong field made Atlas silently ignore the source/references (docs/notes/732).
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-ref');
    let uploadCount = 0;
    const uploadUrls = [
      'https://static.atlascloud.ai/source.png',
      'https://static.atlascloud.ai/ref-1.png',
      'https://static.atlascloud.ai/ref-2.png',
    ];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const stringUrl = String(url);
      if (stringUrl.includes('/model/uploadMedia')) {
        const next = uploadUrls[uploadCount] ?? `https://static.atlascloud.ai/extra-${uploadCount}.png`;
        uploadCount += 1;
        return jsonResponse({ data: { download_url: next } });
      }
      if (stringUrl.includes('/model/generateImage')) {
        return jsonResponse({ data: { id: 'atlas-ref-job' } });
      }
      if (stringUrl.includes('/model/prediction/atlas-ref-job')) {
        return jsonResponse({ data: { status: 'completed', output: 'https://cdn.atlascloud.ai/ref.png' } });
      }
      if (stringUrl === 'https://cdn.atlascloud.ai/ref.png') {
        return imageResponse('REF');
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('atlas', 'google/nano-banana-2/edit'),
      {
        prompt: 'Place the same character at a desk reading a book.',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        editReferenceImageInputs: [
          'data:image/png;base64,UkVGMQ==',
          'data:image/png;base64,UkVGMg==',
        ],
        config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' },
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, atlas: 'atlas-key' },
        providerSettings: {
          ...baseSettings.providerSettings,
          atlasBaseUrl: 'https://api.atlascloud.ai/api/v1',
        },
      },
    );

    expect(result.result).toBe('blob:atlas-ref');
    const generateCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/model/generateImage'));
    const body = JSON.parse(String(generateCall?.[1]?.body));
    expect(body.images).toEqual([
      'https://static.atlascloud.ai/source.png',
      'https://static.atlascloud.ai/ref-1.png',
      'https://static.atlascloud.ai/ref-2.png',
    ]);
    expect(body.image).toBeUndefined();
    expect(body.reference_images).toBeUndefined();
  });

  it('posts Local/Open image edits to the configured endpoint with auth and mask data', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-open');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      image: 'TE9DQUw=',
      mimeType: 'image/png',
      modelUsed: 'Qwen/Qwen-Image-Edit',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      createImageNode('localOpen', 'Qwen/Qwen-Image-Edit'),
      {
        prompt: 'change the poster title to MIDNIGHT SHOW',
        editImageInput: 'data:image/png;base64,U09VUkNF',
        editMaskImageInput: 'data:image/png;base64,TUFTSw==',
        editReferenceImageInputs: ['data:image/png;base64,UkVG'],
        config: DEFAULT_EXECUTION_CONFIG,
      },
      baseSettings,
    );

    expect(result.result).toBe('blob:local-open');
    expect(createObjectURL).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8188/signal-loom-image-edit', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer local-token',
      },
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: 'Qwen/Qwen-Image-Edit',
      prompt: 'change the poster title to MIDNIGHT SHOW',
      image: 'U09VUkNF',
      mask: 'TUFTSw==',
      referenceImages: ['UkVG'],
      outputFormat: 'png',
    });
    expect(result.usage).toMatchObject({
      provider: 'localOpen',
      confidence: 'unknown',
    });
  });

  it.each([
    { provider: 'bfl', modelId: 'flux-2-pro', data: {} },
    { provider: 'stability', modelId: 'stable-image-edit-search-replace', data: { imageSearchPrompt: 'subject' } },
    { provider: 'openai', modelId: 'gpt-image-2', data: {} },
    { provider: 'gemini', modelId: 'gemini-3-pro-image-preview', data: {} },
  ] as const)('rejects wrong-family inline media before $provider provider submission', async ({ provider, modelId, data }) => {
    openAiCapture.editArgs = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      createImageNode(provider, modelId, data),
      {
        prompt: 'Edit the connected image.',
        editImageInput: 'data:text/html;base64,PGh0bWw+ZXhwaXJlZDwvaHRtbD4=',
        config: DEFAULT_EXECUTION_CONFIG,
      },
      {
        ...baseSettings,
        apiKeys: { ...baseSettings.apiKeys, openai: 'openai-key', gemini: 'gemini-key' },
        providerSettings: { ...baseSettings.providerSettings, batchMaxRetries: 0 },
      },
    )).rejects.toThrow(/text\/html; expected image media/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(openAiCapture.editArgs).toBeUndefined();
  });
});
