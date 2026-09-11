import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest, type ExecutionContext } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG, DEFAULT_PROVIDER_SETTINGS } from './providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'gemini-key',
    openai: '',
    atlas: '',
    huggingface: '',
    elevenlabs: '',
    bfl: 'bfl-key',
    stability: 'stability-key',
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
      stability: 'stable-image-core',
      localOpen: 'Qwen/Qwen-Image-Edit',
      android: 'local-dream-active',
      byteplus: 'seedream-5-0-260128',
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
    ...DEFAULT_PROVIDER_SETTINGS,
    geminiCredentialMode: 'api-key',
    batchMaxRetries: 0,
  },
};

function node(id: string, type: AppNode['type'], data: AppNode['data']): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function context(patch: Partial<ExecutionContext> = {}): ExecutionContext {
  return { prompt: 'inspect the connected media', config: DEFAULT_EXECUTION_CONFIG, ...patch };
}

function imageResponse(body = 'PNG'): Response {
  return new Response(new Blob([body], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

describe('Flow media preparation cancellation ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const remoteMediaUrl = 'https://assets.example/connected-media.png';
  const routes: Array<{
    label: string;
    node: AppNode;
    context: ExecutionContext;
    settings?: RuntimeSettingsSnapshot;
  }> = [
    {
      label: 'Vision verification',
      node: node('vision', 'visionVerifyNode', { modelId: 'gemini-3.5-flash' }),
      context: context({ editImageInput: remoteMediaUrl }),
    },
    {
      label: 'Gemini text media',
      node: node('text', 'textNode', { mode: 'generate', provider: 'gemini', modelId: 'gemini-3.5-flash' }),
      context: context({ textMediaInputs: [{ url: remoteMediaUrl, kind: 'image', mimeType: 'image/png' }] }),
    },
    {
      label: 'Gemini image edit',
      node: node('gemini-image', 'imageGen', { provider: 'gemini', modelId: 'gemini-3-pro-image-preview' }),
      context: context({ editImageInput: remoteMediaUrl }),
    },
    {
      label: 'BFL image edit',
      node: node('bfl-image', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
      context: context({ editImageInput: remoteMediaUrl }),
    },
  ];

  it.each(routes)('passes the same run signal through $label preparation', async (route) => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal;
      controller.abort(new DOMException(`cancel ${route.label}`, 'AbortError'));
      return Promise.reject(controller.signal.reason);
    }));

    await expect(executeNodeRequest(
      route.node,
      route.context,
      route.settings ?? settings,
      undefined,
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(observedSignal).toBe(controller.signal);
  });

  it('passes the same signal into configured-upscale dimension preparation', async () => {
    const controller = new AbortController();
    const attributed = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generated-before-upscale');
    let observedSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'blob:generated-before-upscale') {
        observedSignal = init?.signal;
        controller.abort(new DOMException('cancel configured upscale preparation', 'AbortError'));
        return Promise.reject(controller.signal.reason);
      }
      return Promise.resolve(imageResponse('GENERATED'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      node('configured-upscale', 'imageGen', {
        provider: 'stability',
        modelId: 'stable-image-core',
        imageAutoUpscale: true,
      }),
      context(),
      {
        ...settings,
        providerSettings: {
          ...settings.providerSettings,
          paperPrintUpscaleMethod: 'auto',
          localAiCpuEndpointUrl: 'http://127.0.0.1:8788',
        },
      },
      undefined,
      { signal: controller.signal, onInternalUsage: attributed },
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(observedSignal).toBe(controller.signal);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/upscale'))).toHaveLength(0);
    expect(attributed).not.toHaveBeenCalled();
  });

  it('stops after a non-abortable media blob decode boundary before BFL submission', async () => {
    const controller = new AbortController();
    let resolveBlob: ((blob: Blob) => void) | undefined;
    let submitCount = 0;
    const fetchMock = vi.fn((url: string | URL | Request) => {
      if (String(url) === remoteMediaUrl) {
        return Promise.resolve({
          ok: true,
          blob: () => new Promise<Blob>((resolve) => {
            resolveBlob = resolve;
          }),
        } as Response);
      }
      submitCount += 1;
      return Promise.resolve(new Response(JSON.stringify({
        polling_url: 'https://api.bfl.ai/v1/get_result?id=late',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = executeNodeRequest(
      node('bfl-boundary', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
      context({ editImageInput: remoteMediaUrl }),
      settings,
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(resolveBlob).toBeTypeOf('function'), { timeout: 4_000 });
    controller.abort(new DOMException('cancel during blob decode', 'AbortError'));
    resolveBlob?.(new Blob(['SOURCE'], { type: 'image/png' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(submitCount).toBe(0);
  });
});
