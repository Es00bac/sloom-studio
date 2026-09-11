import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDER_SETTINGS } from './providerCatalog';
import type { NativeVertexImageRequest, NativeVertexImageResult } from './nativeApp';
import { estimateImageModelCostUsd } from './imageProviderCapabilities';
import {
  ATLAS_IMAGE_UPSCALE_COST_USD,
  ATLAS_IMAGE_UPSCALER_MODEL_ID,
  runAtlasImageUpscale,
  runStabilityImageUpscale,
  runVertexImagenImageUpscale,
} from './cloudImageUpscale';

function imageResponse(body: string): Response {
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

describe('runStabilityImageUpscale', () => {
  it('posts to the fast upscale endpoint and returns an object URL for the result blob', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-fast');
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const stringUrl = String(url);
      if (stringUrl.startsWith('data:')) {
        return imageResponse('SOURCE');
      }
      expect(stringUrl).toContain('/stable-image/upscale/fast');
      return imageResponse('UPSCALED');
    }) as unknown as typeof fetch;

    const result = await runStabilityImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      mode: 'fast',
      outputFormat: 'png',
      apiKey: 'sk-test',
      fetchImpl,
    });

    expect(result.result).toBe('blob:stability-fast');
    expect(result.mimeType).toBe('image/png');
    const upscaleCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([callUrl]) => String(callUrl).includes('/stable-image/upscale/fast'),
    );
    expect(upscaleCall).toBeTruthy();
    const requestInit = upscaleCall?.[1] as RequestInit;
    expect((requestInit.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(requestInit.body).toBeInstanceOf(FormData);
    expect((requestInit.body as FormData).get('output_format')).toBe('png');
    createObjectURL.mockRestore();
  });

  it('sends the conservative endpoint with a repair prompt in conservative mode', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-conservative');
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const stringUrl = String(url);
      if (stringUrl.startsWith('data:')) {
        return imageResponse('SOURCE');
      }
      expect(stringUrl).toContain('/stable-image/upscale/conservative');
      return imageResponse('UPSCALED');
    }) as unknown as typeof fetch;

    const result = await runStabilityImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      mode: 'conservative',
      outputFormat: 'png',
      apiKey: 'sk-test',
      prompt: 'Repair faithfully for print.',
      fetchImpl,
    });

    expect(result.result).toBe('blob:stability-conservative');
    const upscaleCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([callUrl]) => String(callUrl).includes('/stable-image/upscale/conservative'),
    );
    expect((upscaleCall?.[1] as RequestInit).body).toBeInstanceOf(FormData);
    expect(((upscaleCall?.[1] as RequestInit).body as FormData).get('prompt')).toBe('Repair faithfully for print.');
  });

  it('throws when the Stability API key is missing', async () => {
    await expect(runStabilityImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      mode: 'fast',
      outputFormat: 'png',
      apiKey: '   ',
    })).rejects.toThrow('Stability AI API key is missing. Add it in Settings.');
  });

  it('surfaces the provider error body when the upscale response is not ok', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).startsWith('data:')) {
        return imageResponse('SOURCE');
      }
      return new Response(JSON.stringify({ errors: ['bad'], message: 'insufficient_balance' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await expect(runStabilityImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      mode: 'fast',
      outputFormat: 'png',
      apiKey: 'sk-test',
      errorLabel: 'Stability upscale failed',
      fetchImpl,
    })).rejects.toThrow('insufficient_balance');
  });

  it('uses the run signal while preparing a remote Stability upscale source', async () => {
    const controller = new AbortController();
    const sourceUrl = 'https://assets.example/source.png';
    let observedSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal;
      controller.abort(new DOMException('cancel source preparation', 'AbortError'));
      return Promise.reject(controller.signal.reason);
    }));
    const providerFetch = vi.fn();

    await expect(runStabilityImageUpscale({
      sourceImage: sourceUrl,
      mode: 'fast',
      outputFormat: 'png',
      apiKey: 'sk-test',
      signal: controller.signal,
      fetchImpl: providerFetch as unknown as typeof fetch,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(observedSignal).toBe(controller.signal);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});

describe('runVertexImagenImageUpscale', () => {
  it('calls the imagen upscale model with an x2 factor and returns the generated image', async () => {
    const generateVertexImage = vi.fn(async (request: NativeVertexImageRequest): Promise<NativeVertexImageResult> => {
      expect(request.modelId).toBe('imagen-4.0-upscale-preview');
      expect(request.route).toBe('imagen-predict');
      const parameters = (request.body as { parameters?: Record<string, unknown> }).parameters ?? {};
      expect((parameters as { upscaleConfig?: { upscaleFactor?: string } }).upscaleConfig?.upscaleFactor).toBe('x2');
      return { result: 'data:image/png;base64,dXBzY2FsZWQ=', mimeType: 'image/png', resultType: 'image' };
    });

    const result = await runVertexImagenImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      providerSettings: { ...DEFAULT_PROVIDER_SETTINGS, vertexProjectId: 'proj-1', vertexLocation: 'us-central1' },
      outputFormat: 'png',
      generateVertexImage,
    });

    expect(generateVertexImage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ result: 'data:image/png;base64,dXBzY2FsZWQ=', mimeType: 'image/png' });
  });

  it('throws a configuration error when neither a Vertex project nor a generator is available', async () => {
    await expect(runVertexImagenImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      providerSettings: { ...DEFAULT_PROVIDER_SETTINGS, vertexProjectId: '', vertexLocation: '' },
      outputFormat: 'png',
      generateVertexImage: undefined,
    })).rejects.toThrow(/Vertex Imagen upscaling requires a configured project/);
  });

  it('propagates the Vertex error payload', async () => {
    const generateVertexImage = vi.fn(async (): Promise<NativeVertexImageResult> => ({ error: 'quota exceeded' }));

    await expect(runVertexImagenImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      providerSettings: { ...DEFAULT_PROVIDER_SETTINGS, vertexProjectId: 'proj-1', vertexLocation: 'us-central1' },
      outputFormat: 'png',
      generateVertexImage,
    })).rejects.toThrow('quota exceeded');
  });
});

describe('runAtlasImageUpscale', () => {
  it('uploads the source, posts ONLY the schema-documented fields, and returns an object URL', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-upscaled');
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const stringUrl = String(url);
      if (stringUrl.startsWith('data:')) {
        return imageResponse('SOURCE');
      }
      if (stringUrl.includes('/model/uploadMedia')) {
        return jsonResponse({ data: { download_url: 'https://atlas.example/upload.png' } });
      }
      expect(stringUrl).toBe('https://api.atlascloud.ai/api/v1/model/generateImage');
      return jsonResponse({ data: { status: 'succeeded', outputs: ['https://cdn.example/out.png'] } });
    }) as unknown as typeof fetch;
    const downloadResultBlob = vi.fn(async (url: string) => {
      expect(url).toBe('https://cdn.example/out.png');
      return new Blob(['UPSCALED'], { type: 'image/png' });
    });

    const result = await runAtlasImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      apiKey: 'atlas-key',
      outscale: 2,
      outputFormat: 'png',
      fetchImpl,
      downloadResultBlob,
    });

    expect(result).toEqual({ result: 'blob:atlas-upscaled', mimeType: 'image/png' });
    const generateCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([callUrl]) => String(callUrl).includes('/model/generateImage'),
    );
    expect(generateCall).toBeTruthy();
    const requestInit = generateCall?.[1] as RequestInit;
    expect((requestInit.headers as Record<string, string>).Authorization).toBe('Bearer atlas-key');
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    // Schema-exact: the generated accepted-fields artifact documents ONLY these inputs.
    expect(Object.keys(body).sort()).toEqual(['image', 'model', 'output_format', 'outscale']);
    expect(body).toEqual({
      model: ATLAS_IMAGE_UPSCALER_MODEL_ID,
      image: 'https://atlas.example/upload.png',
      outscale: 2,
      output_format: 'png',
    });
    createObjectURL.mockRestore();
  });

  it('polls the prediction endpoint until the upscale succeeds', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-polled');
    let pollCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const stringUrl = String(url);
      if (stringUrl.startsWith('data:')) {
        return imageResponse('SOURCE');
      }
      if (stringUrl.includes('/model/uploadMedia')) {
        return jsonResponse({ url: 'https://atlas.example/upload.png' });
      }
      if (stringUrl.includes('/model/generateImage')) {
        return jsonResponse({ data: { id: 'pred-1' } });
      }
      expect(stringUrl).toBe('https://api.atlascloud.ai/api/v1/model/prediction/pred-1');
      pollCount += 1;
      return pollCount === 1
        ? jsonResponse({ data: { status: 'processing' } })
        : jsonResponse({ data: { status: 'succeeded', output: 'https://cdn.example/polled.png' } });
    }) as unknown as typeof fetch;

    const result = await runAtlasImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      apiKey: 'atlas-key',
      outputFormat: 'png',
      fetchImpl,
      downloadResultBlob: async () => new Blob(['UPSCALED'], { type: 'image/png' }),
      sleepImpl: async () => {},
    });

    expect(pollCount).toBe(2);
    expect(result.result).toBe('blob:atlas-polled');
  });

  it('clamps outscale into the documented 1-4 range', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:atlas-clamped');
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const stringUrl = String(url);
      if (stringUrl.startsWith('data:')) return imageResponse('SOURCE');
      if (stringUrl.includes('/model/uploadMedia')) {
        return jsonResponse({ url: 'https://atlas.example/upload.png' });
      }
      return jsonResponse({ data: { status: 'succeeded', output: 'https://cdn.example/out.png' } });
    }) as unknown as typeof fetch;

    await runAtlasImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      apiKey: 'atlas-key',
      outscale: 9,
      outputFormat: 'png',
      fetchImpl,
      downloadResultBlob: async () => new Blob(['UPSCALED'], { type: 'image/png' }),
    });

    const generateCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([callUrl]) => String(callUrl).includes('/model/generateImage'),
    );
    const body = JSON.parse(String((generateCall?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.outscale).toBe(4);
  });

  it('throws when the Atlas API key is missing', async () => {
    await expect(runAtlasImageUpscale({
      sourceImage: 'data:image/png;base64,c291cmNl',
      apiKey: '   ',
      outputFormat: 'png',
    })).rejects.toThrow('Atlas API key is missing. Add it in Settings.');
  });

  it('keeps the published cost constant consistent with the generated Atlas catalog', () => {
    const estimate = estimateImageModelCostUsd({
      providerId: 'atlas',
      modelId: ATLAS_IMAGE_UPSCALER_MODEL_ID,
      operation: 'upscale',
      imageCount: 1,
    });
    expect(estimate.costUsd).toBe(ATLAS_IMAGE_UPSCALE_COST_USD);
    expect(estimate.confidence).toBe('published-fixed');
  });
});
