import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { executeNodeRequest } from './flowExecution';
import { withExponentialBackoff } from './exponentialBackoff';
import { getProviderLimiter } from './providerRateLimiter';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER_SETTINGS,
} from './providerCatalog';

/**
 * Cancellation contract for every provider transport reachable from Flow (AUD-008).
 *
 * Each test holds one provider phase open, cancels, and asserts the exact call counts —
 * proving the run stops issuing provider work rather than merely discarding its result.
 */

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'gemini-key',
    openai: 'openai-key',
    huggingface: 'hf-key',
    elevenlabs: 'xi-key',
    atlas: 'atlas-key',
    bfl: 'bfl-key',
    stability: 'stability-key',
    byteplus: 'byteplus-key',
  },
  defaultModels: DEFAULT_MODELS,
  providerSettings: {
    ...DEFAULT_PROVIDER_SETTINGS,
    geminiCredentialMode: 'api-key',
    elevenlabsVoiceId: 'default-voice',
    batchMaxRetries: 2,
    batchRetryBaseDelayMs: 10,
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imageNode(provider: string, modelId: string): AppNode {
  return {
    id: `${provider}-image`,
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: { provider, modelId },
  } as AppNode;
}

function imageContext() {
  return {
    prompt: 'a deterministic lighthouse study',
    config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' as const },
  };
}

function geminiVideoNode(): AppNode {
  return {
    id: 'gemini-video',
    type: 'videoGen',
    position: { x: 0, y: 0 },
    data: { provider: 'gemini', modelId: 'veo-3.1-generate-preview' },
  } as AppNode;
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

async function driveFakeTimersUntilSettled(promise: Promise<unknown>, maxTurns = 250): Promise<void> {
  let settled = false;
  void promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  for (let turn = 0; turn < maxTurns && !settled; turn += 1) {
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
  }

  if (!settled) {
    throw new Error(`Provider promise did not settle after ${maxTurns} fake-timer turns.`);
  }
}

/** The abort shape every transport must surface, so a cancel is never mistaken for a fault. */
const abortErrorShape = { name: 'AbortError' };

describe('Flow provider cancellation', () => {
  const limiterDelays = new Map<string, number>();

  beforeEach(() => {
    vi.useFakeTimers();
    for (const provider of ['atlas', 'bfl', 'gemini', 'stability', 'openai', 'huggingface', 'elevenlabs', 'default']) {
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

  describe('cancel before submit', () => {
    it('rejects an already-cancelled Atlas run with an AbortError and never submits', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();
      controller.abort();

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an already-cancelled retryable text run with an AbortError, not a generic failure', async () => {
      // The retry wrapper must not repackage a cancellation as a plain Error: the store
      // cannot tell that apart from a provider fault, so Cancel surfaces as a broken run.
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();
      controller.abort();

      const promise = executeNodeRequest(
        {
          id: 'text',
          type: 'textNode',
          position: { x: 0, y: 0 },
          data: { provider: 'openai', modelId: 'gpt-4.1-mini', mode: 'generate' },
        } as AppNode,
        { prompt: 'write a haiku', config: DEFAULT_EXECUTION_CONFIG },
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Atlas', () => {
    it('stops polling an accepted prediction the moment the run is cancelled', async () => {
      const controller = new AbortController();
      let pollCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/model/generateImage')) {
          return jsonResponse({ data: { id: 'atlas-job' } });
        }
        if (url.includes('/model/prediction/atlas-job')) {
          pollCalls += 1;
          if (pollCalls === 2) {
            controller.abort();
          }
          return jsonResponse({ data: { status: 'processing' } });
        }
        throw new Error(`Unexpected fake Atlas request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      // Far more than the 2s poll interval: an unabortable poll loop keeps going here.
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(pollCalls).toBe(2);
    });

    it('passes the run signal to the paid submit request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/model/generateImage')) {
          return jsonResponse({ data: { outputs: ['data:image/png;base64,QVRMQVM='] } });
        }
        throw new Error(`Unexpected fake Atlas request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      await driveFakeTimersUntilSettled(promise);
      await promise;

      const submit = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/model/generateImage'));
      expect((submit?.[1] as RequestInit | undefined)?.signal).toBe(controller.signal);
    });

    it('stops before downloading a finished image when the run is cancelled', async () => {
      const controller = new AbortController();
      let downloadCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/model/generateImage')) {
          controller.abort();
          return jsonResponse({ data: { outputs: ['https://cdn.example/atlas.png'] } });
        }
        if (url === 'https://cdn.example/atlas.png') {
          downloadCalls += 1;
          return new Response(new Blob(['IMAGE'], { type: 'image/png' }));
        }
        throw new Error(`Unexpected fake Atlas request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(downloadCalls).toBe(0);
    });
  });

  describe('BFL', () => {
    it('stops polling an accepted job the moment the run is cancelled', async () => {
      const controller = new AbortController();
      let pollCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://api.bfl.ai/v1/flux-2-pro') {
          return jsonResponse({
            id: 'bfl-job',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-job',
            cost: 4,
          });
        }
        if (url.includes('get_result?id=bfl-job')) {
          pollCalls += 1;
          if (pollCalls === 2) {
            controller.abort();
          }
          return jsonResponse({ status: 'Pending' });
        }
        throw new Error(`Unexpected fake BFL request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('bfl', 'flux-2-pro'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(pollCalls).toBe(2);
    });

    it('submits exactly once and never re-submits after a cancel', async () => {
      const controller = new AbortController();
      let submitCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://api.bfl.ai/v1/flux-2-pro') {
          submitCalls += 1;
          return jsonResponse({
            id: 'bfl-job',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-job',
            cost: 4,
          });
        }
        if (url.includes('get_result?id=bfl-job')) {
          controller.abort();
          return jsonResponse({ status: 'Pending' });
        }
        throw new Error(`Unexpected fake BFL request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('bfl', 'flux-2-pro'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(submitCalls).toBe(1);
    });
  });

  describe('Gemini video', () => {
    it('stops polling an accepted operation the moment the run is cancelled', async () => {
      const controller = new AbortController();
      let pollCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes(':predictLongRunning') && init?.method === 'POST') {
          return jsonResponse({ name: 'operations/gemini-job' });
        }
        if (url.endsWith('/operations/gemini-job')) {
          pollCalls += 1;
          if (pollCalls === 2) {
            controller.abort();
          }
          return jsonResponse({ name: 'operations/gemini-job', done: false });
        }
        throw new Error(`Unexpected fake Gemini request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        geminiVideoNode(),
        videoContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      // The Gemini poll interval is 10s; give it several intervals of room.
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(pollCalls).toBe(2);
    });

    it('does not download or materialize a finished video after a cancel', async () => {
      const controller = new AbortController();
      let downloadCalls = 0;
      const createObjectUrl = vi.fn(() => 'blob:gemini-video');
      vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectUrl);
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes(':predictLongRunning') && init?.method === 'POST') {
          controller.abort();
          return jsonResponse({
            name: 'operations/gemini-job',
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [{ video: { uri: 'https://cdn.example/gemini.mp4' } }],
              },
            },
          });
        }
        if (url === 'https://cdn.example/gemini.mp4') {
          downloadCalls += 1;
          return new Response(new Blob(['VIDEO'], { type: 'video/mp4' }));
        }
        throw new Error(`Unexpected fake Gemini request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        geminiVideoNode(),
        videoContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(downloadCalls).toBe(0);
      expect(createObjectUrl).not.toHaveBeenCalled();
    });
  });

  describe('API Requester', () => {
    it('passes the run signal to the outbound request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        {
          id: 'request',
          type: 'apiFetchNode',
          position: { x: 0, y: 0 },
          data: { url: 'https://example.test/data', declaredOutputType: 'json' },
        } as AppNode,
        { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
        settings,
        undefined,
        { signal: controller.signal },
      );
      await driveFakeTimersUntilSettled(promise);
      await promise;

      expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBe(controller.signal);
    });
  });

  describe('direct fetch providers and proxy', () => {
    it.each([
      {
        label: 'BytePlus image',
        node: imageNode('byteplus', 'seedream-4.5'),
        context: imageContext(),
        settings,
      },
      {
        label: 'ElevenLabs audio',
        node: {
          id: 'elevenlabs-audio',
          type: 'audioGen',
          position: { x: 0, y: 0 },
          data: { provider: 'elevenlabs', modelId: 'eleven_multilingual_v2', voiceId: 'voice-1' },
        } as AppNode,
        context: { prompt: 'read this', config: DEFAULT_EXECUTION_CONFIG },
        settings,
      },
    ])('passes the exact run signal to $label submit', async ({ node, context, settings: providerSettings }) => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => node.type === 'audioGen'
        ? new Response(new Blob(['AUDIO'], { type: 'audio/mpeg' }))
        : jsonResponse({ data: [{ b64_json: 'SU1H' }] }));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');

      await executeNodeRequest(node, context, providerSettings, undefined, { signal: controller.signal });

      expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBe(controller.signal);
    });

    it('passes the exact run signal through Local/Open preparation and submit', async () => {
      const controller = new AbortController();
      const endpoint = 'https://local.example/v1/edit';
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input) === endpoint
        ? new Response(new Blob(['IMAGE'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } })
        : new Response(new Blob(['SOURCE'], { type: 'image/png' })));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-image');

      await executeNodeRequest(
        imageNode('localOpen', 'Qwen/Qwen-Image-Edit'),
        { ...imageContext(), editImageInput: 'data:image/png;base64,U09VUkNF' },
        {
          ...settings,
          providerSettings: { ...settings.providerSettings, localOpenImageEndpointUrl: endpoint },
        },
        undefined,
        { signal: controller.signal },
      );

      for (const [, init] of fetchMock.mock.calls) {
        expect((init as RequestInit | undefined)?.signal).toBe(controller.signal);
      }
    });

    it('passes the exact signal to the backend proxy and never returns its stale result after abort', async () => {
      const controller = new AbortController();
      let resolveProxy: (response: Response) => void = () => undefined;
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        resolveProxy = resolve;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }));
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('openai', 'gpt-image-1'),
        imageContext(),
        {
          ...settings,
          providerSettings: {
            ...settings.providerSettings,
            backendProxyEnabled: true,
            backendProxyBaseUrl: 'https://proxy.example',
          },
        },
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      for (let turn = 0; turn < 20 && fetchMock.mock.calls.length === 0; turn += 1) await Promise.resolve();
      controller.abort();
      resolveProxy(jsonResponse({ result: 'stale', resultType: 'image', statusMessage: 'late' }));

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBe(controller.signal);
    });

    it('short-circuits a cancelled Function node before it can route a stale output', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(executeNodeRequest(
        {
          id: 'function',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: { result: 'stale', resultType: 'text' },
        } as AppNode,
        { prompt: 'new input', config: DEFAULT_EXECUTION_CONFIG },
        settings,
        undefined,
        { signal: controller.signal },
      )).rejects.toMatchObject(abortErrorShape);
    });
  });

  describe('retry backoff', () => {
    it('surfaces a cancel during the backoff wait as an AbortError without another attempt', async () => {
      const controller = new AbortController();
      let attempts = 0;
      const promise = withExponentialBackoff({
        operation: async () => {
          attempts += 1;
          throw new Error('temporary outage');
        },
        maxRetries: 5,
        baseDelayMs: 10_000,
        abortSignal: controller.signal,
      });
      promise.catch(() => undefined);

      // Let the first attempt fail and the run settle into its backoff wait.
      for (let turn = 0; turn < 20 && attempts === 0; turn += 1) {
        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
      }
      const attemptsBeforeCancel = attempts;
      controller.abort();
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(attempts).toBe(attemptsBeforeCancel);
    });
  });

  describe('rate limiter', () => {
    it('never issues a paid submit for a run cancelled while queued behind another node', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async () => jsonResponse({ data: { outputs: ['data:image/png;base64,QVRMQVM='] } }));
      vi.stubGlobal('fetch', fetchMock);

      const limiter = getProviderLimiter('atlas');
      // Hold the limiter so the run is still queued when Cancel arrives.
      let releaseHolder: () => void = () => undefined;
      let holderStarted = false;
      const holder = limiter.acquire(() => new Promise<void>((resolve) => {
        holderStarted = true;
        releaseHolder = resolve;
      }));
      for (let turn = 0; turn < 20 && !holderStarted; turn += 1) {
        await Promise.resolve();
      }
      expect(holderStarted).toBe(true);

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);

      controller.abort();
      releaseHolder();
      await holder;
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('repeated cancel', () => {
    it('settles once with an AbortError when Cancel is pressed several times', async () => {
      const controller = new AbortController();
      let pollCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/model/generateImage')) {
          return jsonResponse({ data: { id: 'atlas-job' } });
        }
        if (url.includes('/model/prediction/atlas-job')) {
          pollCalls += 1;
          if (pollCalls === 1) {
            controller.abort();
            controller.abort();
            controller.abort();
          }
          return jsonResponse({ data: { status: 'processing' } });
        }
        throw new Error(`Unexpected fake Atlas request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toMatchObject(abortErrorShape);
      expect(pollCalls).toBe(1);
    });
  });

  describe('listener hygiene', () => {
    it('does not accumulate abort listeners across a long poll loop', async () => {
      const controller = new AbortController();
      const addSpy = vi.spyOn(controller.signal, 'addEventListener');
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
      let pollCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/model/generateImage')) {
          return jsonResponse({ data: { id: 'atlas-job' } });
        }
        if (url.includes('/model/prediction/atlas-job')) {
          pollCalls += 1;
          return pollCalls >= 8
            ? jsonResponse({ data: { status: 'succeeded', outputs: ['data:image/png;base64,QVRMQVM='] } })
            : jsonResponse({ data: { status: 'processing' } });
        }
        throw new Error(`Unexpected fake Atlas request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('atlas', 'black-forest-labs/flux-schnell'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      await driveFakeTimersUntilSettled(promise);
      await promise;

      // Every listener a completed poll loop attached must have been detached again.
      expect(removeSpy.mock.calls.length).toBeGreaterThanOrEqual(addSpy.mock.calls.length);
    });
  });

  describe('non-abort errors', () => {
    it('still reports a genuine provider failure as itself, not as a cancellation', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'invalid request body' } }, 400));
      vi.stubGlobal('fetch', fetchMock);

      const promise = executeNodeRequest(
        imageNode('bfl', 'flux-2-pro'),
        imageContext(),
        settings,
        undefined,
        { signal: controller.signal },
      );
      promise.catch(() => undefined);
      await driveFakeTimersUntilSettled(promise);

      await expect(promise).rejects.toThrow('invalid request body');
      expect(controller.signal.aborted).toBe(false);
    });
  });
});
