import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { executeNodeRequest } from './flowExecution';
import { getProviderLimiter } from './providerRateLimiter';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER_SETTINGS,
} from './providerCatalog';

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'gemini-key',
    openai: '',
    huggingface: '',
    elevenlabs: '',
    atlas: 'atlas-key',
    bfl: 'bfl-key',
    stability: 'stability-key',
  },
  defaultModels: DEFAULT_MODELS,
  providerSettings: {
    ...DEFAULT_PROVIDER_SETTINGS,
    geminiCredentialMode: 'api-key',
    batchMaxRetries: 2,
    batchRetryBaseDelayMs: 10,
  },
};

function imageNode(provider: 'atlas' | 'bfl' | 'stability', modelId: string): AppNode {
  return {
    id: `${provider}-image`,
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: { provider, modelId },
  } as AppNode;
}

function geminiVideoNode(): AppNode {
  return {
    id: 'gemini-video',
    type: 'videoGen',
    position: { x: 0, y: 0 },
    data: { provider: 'gemini', modelId: 'veo-3.1-generate-preview' },
  } as AppNode;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imageContext() {
  return {
    prompt: 'a deterministic lighthouse study',
    config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' as const },
  };
}

function videoContext() {
  return {
    prompt: 'a deterministic lighthouse flyover',
    config: {
      ...DEFAULT_EXECUTION_CONFIG,
      aspectRatio: '16:9' as const,
      durationSeconds: 8,
      videoResolution: '720p' as const,
    },
  };
}

describe('paid asynchronous provider retry boundaries', () => {
  const limiterDelays = new Map<string, number>();

  beforeEach(() => {
    vi.useFakeTimers();
    for (const provider of ['atlas', 'bfl', 'gemini', 'stability']) {
      const limiter = getProviderLimiter(provider);
      limiterDelays.set(provider, limiter.minDelayMs);
      limiter.minDelayMs = 0;
    }
  });

  afterEach(() => {
    for (const [provider, delay] of limiterDelays) {
      getProviderLimiter(provider).minDelayMs = delay;
    }
    limiterDelays.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('re-polls an Atlas prediction after HTTP 429 without creating another paid job', async () => {
    let pollCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/model/generateImage')) {
        return jsonResponse({ data: { id: 'atlas-existing-prediction' } });
      }
      if (url.includes('/model/prediction/atlas-existing-prediction')) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ message: 'temporary poll rate limit' }, 429)
          : jsonResponse({
              data: {
                status: 'succeeded',
                outputs: ['data:image/png;base64,QVRMQVM='],
              },
            });
      }
      throw new Error(`Unexpected fake Atlas request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = executeNodeRequest(
      imageNode('atlas', 'black-forest-labs/flux-schnell'),
      imageContext(),
      settings,
    );
    resultPromise.catch(() => undefined);
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({
      result: 'data:image/png;base64,QVRMQVM=',
      resultType: 'image',
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/model/generateImage'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/model/prediction/'))).toHaveLength(2);
  });

  it('resumes a BFL polling URL after a transient fault without creating another paid job', async () => {
    let pollCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.bfl.ai/v1/flux-2-pro') {
        return jsonResponse({
          id: 'bfl-existing-job',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-existing-job',
          cost: 4,
        });
      }
      if (url.includes('get_result?id=bfl-existing-job')) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ message: 'temporary poll outage' }, 503)
          : jsonResponse({
              status: 'Ready',
              result: { sample: 'data:image/png;base64,QkZM' },
            });
      }
      throw new Error(`Unexpected fake BFL request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = executeNodeRequest(
      imageNode('bfl', 'flux-2-pro'),
      imageContext(),
      settings,
    );
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toMatchObject({
      result: 'data:image/png;base64,QkZM',
      resultType: 'image',
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://api.bfl.ai/v1/flux-2-pro')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('get_result?id='))).toHaveLength(2);
  });

  it('resumes a Stability generation ID after a transient result fault without creating another paid job', async () => {
    vi.useRealTimers();
    let pollCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('data:')) {
        return new Response(new Blob(['SOURCE'], { type: 'image/png' }));
      }
      if (url.includes('/stable-image/edit/replace-background-and-relight')) {
        return jsonResponse({ id: 'stability-existing-job' });
      }
      if (url.includes('/v2beta/results/stability-existing-job')) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ message: 'temporary result outage' }, 503)
          : new Response(new Blob(['RESULT'], { type: 'image/png' }));
      }
      throw new Error(`Unexpected fake Stability request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stability-image');

    const result = await executeNodeRequest(
      imageNode('stability', 'stable-image-edit-replace-background-relight'),
      {
        ...imageContext(),
        editImageInput: 'data:image/png;base64,U09VUkNF',
      },
      settings,
    );

    expect(result).toMatchObject({
      result: 'blob:stability-image',
      resultType: 'image',
    });
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/stable-image/edit/replace-background-and-relight'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/v2beta/results/stability-existing-job'))).toHaveLength(2);
  });

  it('resumes a Gemini operation name after a transient poll fault without submitting again', async () => {
    let pollCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(':predictLongRunning') && init?.method === 'POST') {
        return jsonResponse({ name: 'operations/gemini-existing-job' });
      }
      if (url.endsWith('/operations/gemini-existing-job')) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ error: { message: 'temporary poll outage' } }, 503)
          : jsonResponse({
              name: 'operations/gemini-existing-job',
              done: true,
              response: {
                generateVideoResponse: {
                  generatedSamples: [{ video: { uri: 'https://cdn.example/gemini.mp4' } }],
                },
              },
            });
      }
      if (url === 'https://cdn.example/gemini.mp4') {
        return new Response(new Blob(['VIDEO'], { type: 'video/mp4' }));
      }
      throw new Error(`Unexpected fake Gemini request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gemini-video');

    const resultPromise = executeNodeRequest(geminiVideoNode(), videoContext(), settings);
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(resultPromise).resolves.toMatchObject({ result: 'blob:gemini-video', resultType: 'video' });
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).includes(':predictLongRunning') && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/operations/gemini-existing-job'))).toHaveLength(2);
  });

  it('retries Gemini result materialization by URI without submitting the completed job again', async () => {
    let downloadCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(':predictLongRunning') && init?.method === 'POST') {
        return jsonResponse({
          name: 'operations/gemini-completed-job',
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { uri: 'https://cdn.example/completed.mp4' } }],
            },
          },
        });
      }
      if (url === 'https://cdn.example/completed.mp4') {
        downloadCalls += 1;
        return downloadCalls === 1
          ? jsonResponse({ message: 'temporary download outage' }, 503)
          : new Response(new Blob(['VIDEO'], { type: 'video/mp4' }));
      }
      throw new Error(`Unexpected fake Gemini request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gemini-video');

    const resultPromise = executeNodeRequest(geminiVideoNode(), videoContext(), settings);
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({ result: 'blob:gemini-video', resultType: 'video' });
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).includes(':predictLongRunning') && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
    expect(downloadCalls).toBe(2);
  });

  it('fails a JSON-bodied HTTP 400 create response immediately', async () => {
    const onStatus = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'invalid request body' } }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = executeNodeRequest(
      imageNode('bfl', 'flux-2-pro'),
      imageContext(),
      { ...settings, providerSettings: { ...settings.providerSettings, batchMaxRetries: 1 } },
      onStatus,
    );
    resultPromise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).rejects.toThrow('invalid request body');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls.map(([message]) => String(message)).some((message) => message.includes('Retrying'))).toBe(false);
  });

  it('fails permanent missing-prompt validation without entering retry', async () => {
    const onStatus = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = executeNodeRequest(
      imageNode('bfl', 'flux-2-pro'),
      { ...imageContext(), prompt: '' },
      { ...settings, providerSettings: { ...settings.providerSettings, batchMaxRetries: 1 } },
      onStatus,
    );
    resultPromise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).rejects.toThrow('Image nodes need an upstream text prompt');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });
});
