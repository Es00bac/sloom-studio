import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { executeNodeRequest, resolveProviderStartPolicyKey } from './flowExecution';
import {
  getProviderLimiter,
  providerLimiters,
  type ProviderStartPolicyKey,
} from './providerRateLimiter';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER_SETTINGS,
} from './providerCatalog';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
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

function routeNode(type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return {
    id: `${type}-${String(data.provider ?? data.mode ?? 'default')}`,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: '',
    openai: '',
    huggingface: '',
    elevenlabs: '',
    atlas: 'atlas-key',
    byteplus: 'byteplus-key',
  },
  defaultModels: DEFAULT_MODELS,
  providerSettings: {
    ...DEFAULT_PROVIDER_SETTINGS,
    batchMaxRetries: 0,
  },
};

const context = {
  prompt: 'a deterministic lighthouse study',
  config: { ...DEFAULT_EXECUTION_CONFIG, imageOutputFormat: 'png' as const },
};

describe('Flow provider start scheduling', () => {
  const originalDelays = new Map<string, number>();

  beforeEach(() => {
    vi.useFakeTimers();
    for (const policy of ['atlas', 'byteplus', 'default']) {
      const limiter = getProviderLimiter(policy);
      originalDelays.set(policy, limiter.minDelayMs);
      limiter.minDelayMs = 0;
    }
  });

  afterEach(() => {
    for (const [policy, delay] of originalDelays) getProviderLimiter(policy).minDelayMs = delay;
    originalDelays.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps every supported execution route to a registered independent direct or proxy policy', () => {
    const proxySettings: RuntimeSettingsSnapshot = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        backendProxyEnabled: true,
        backendProxyBaseUrl: 'https://proxy.example.test',
      },
    };

    const routes: Array<{
      label: string;
      node: AppNode;
      direct: ProviderStartPolicyKey;
      proxyConfigured: ProviderStartPolicyKey;
    }> = [
      { label: 'prompt text', node: routeNode('textNode', { mode: 'prompt', prompt: 'local text' }), direct: 'local', proxyConfigured: 'local' },
      { label: 'legacy prompt text default', node: routeNode('textNode', { prompt: 'local text' }), direct: 'local', proxyConfigured: 'local' },
      { label: 'generated text default', node: routeNode('textNode', { mode: 'generate' }), direct: 'gemini', proxyConfigured: 'backend-proxy:gemini' },
      ...(['gemini', 'openai', 'huggingface'] as const).map((provider) => ({
        label: `generated text ${provider}`,
        node: routeNode('textNode', { mode: 'generate', provider }),
        direct: provider,
        proxyConfigured: `backend-proxy:${provider}` as ProviderStartPolicyKey,
      })),
      { label: 'image default', node: routeNode('imageGen'), direct: 'gemini', proxyConfigured: 'backend-proxy:gemini' },
      ...(['gemini', 'openai', 'huggingface', 'bfl', 'stability', 'localOpen', 'android', 'atlas', 'byteplus'] as const).map((provider) => ({
        label: `image ${provider}`,
        node: routeNode('imageGen', { provider }),
        direct: provider,
        proxyConfigured: provider === 'android' ? 'android' as const : `backend-proxy:${provider}` as ProviderStartPolicyKey,
      })),
      { label: 'video default', node: routeNode('videoGen'), direct: 'gemini', proxyConfigured: 'backend-proxy:gemini' },
      ...(['gemini', 'huggingface', 'atlas'] as const).map((provider) => ({
        label: `video ${provider}`,
        node: routeNode('videoGen', { provider }),
        direct: provider,
        proxyConfigured: `backend-proxy:${provider}` as ProviderStartPolicyKey,
      })),
      { label: 'audio default', node: routeNode('audioGen'), direct: 'elevenlabs', proxyConfigured: 'backend-proxy:elevenlabs' },
      ...(['gemini', 'elevenlabs', 'huggingface'] as const).map((provider) => ({
        label: `audio ${provider}`,
        node: routeNode('audioGen', { provider }),
        direct: provider,
        proxyConfigured: `backend-proxy:${provider}` as ProviderStartPolicyKey,
      })),
      { label: 'Vision Verify', node: routeNode('visionVerifyNode'), direct: 'gemini', proxyConfigured: 'backend-proxy:gemini' },
      { label: 'local crop', node: routeNode('cropImageNode'), direct: 'local', proxyConfigured: 'local' },
    ];

    const usedPolicies = new Set<ProviderStartPolicyKey>();
    for (const route of routes) {
      for (const [mode, runtimeSettings, expected] of [
        ['direct', settings, route.direct],
        ['proxy configured', proxySettings, route.proxyConfigured],
      ] as const) {
        const actual = resolveProviderStartPolicyKey(route.node, runtimeSettings);
        expect(actual, `${route.label} (${mode})`).toBe(expected);
        expect(providerLimiters[expected], `${route.label} (${mode}) has no registered policy`).toBeDefined();
        expect(getProviderLimiter(actual), `${route.label} (${mode}) fell through to default`).toBe(providerLimiters[expected]);
        expect(getProviderLimiter(actual), `${route.label} (${mode}) shares default`).not.toBe(providerLimiters.default);
        usedPolicies.add(expected);
      }
    }

    const usedLimiters = [...usedPolicies].map((policy) => providerLimiters[policy]);
    expect(new Set(usedLimiters).size).toBe(usedPolicies.size);
    expect(usedPolicies).toContain('backend-proxy:localOpen');
    expect(usedPolicies).not.toContain('backend-proxy:local' as ProviderStartPolicyKey);
    expect(usedPolicies).not.toContain('backend-proxy:android' as ProviderStartPolicyKey);
  });

  it('keeps prompt pass-through and Android generation on this device when proxy mode is configured', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === 'http://192.168.1.42:8788/v1/capabilities') {
        return jsonResponse({
          ok: true,
          models: [{ id: 'local-dream-active' }],
          upscalers: [],
        });
      }
      if (url === 'http://192.168.1.42:8788/v1/generate') {
        return jsonResponse({
          dataUrl: 'data:image/png;base64,QU5EUk9JRA==',
          mimeType: 'image/png',
          modelUsed: 'local-dream-active',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const proxySettings: RuntimeSettingsSnapshot = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        backendProxyEnabled: true,
        backendProxyBaseUrl: 'https://proxy.example.test',
        androidAcceleratorBaseUrl: 'http://192.168.1.42:8788',
        androidAcceleratorAuthToken: 'pair-token',
      },
    };

    await expect(executeNodeRequest(
      routeNode('textNode', { mode: 'prompt', prompt: 'local text' }),
      { ...context, prompt: '' },
      proxySettings,
    )).resolves.toMatchObject({ result: 'local text', resultType: 'text' });
    await expect(executeNodeRequest(
      imageNode('android', 'local-dream-active'),
      context,
      proxySettings,
    )).resolves.toMatchObject({
      result: 'data:image/png;base64,QU5EUk9JRA==',
      resultType: 'image',
    });

    expect(requestedUrls).toEqual([
      'http://192.168.1.42:8788/v1/capabilities',
      'http://192.168.1.42:8788/v1/generate',
    ]);
    expect(requestedUrls).not.toContain('https://proxy.example.test/api/flow/execute-node');
  });

  it('routes Local/Open through its registered proxy policy when proxy mode is configured', async () => {
    let submittedBody: BodyInit | null | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url !== 'https://proxy.example.test/api/flow/execute-node') {
        throw new Error(`Unexpected request: ${url}`);
      }
      submittedBody = init?.body;
      return jsonResponse({
        result: 'data:image/png;base64,TE9DQUwtT1BFTg==',
        resultType: 'image',
        statusMessage: 'Edited through configured proxy',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const proxySettings: RuntimeSettingsSnapshot = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        backendProxyEnabled: true,
        backendProxyBaseUrl: 'https://proxy.example.test',
        localOpenImageEndpointUrl: 'http://127.0.0.1:9000/v1/edit',
      },
    };

    await expect(executeNodeRequest(
      imageNode('localOpen', 'Qwen/Qwen-Image-Edit'),
      context,
      proxySettings,
    )).resolves.toMatchObject({
      result: 'data:image/png;base64,TE9DQUwtT1BFTg==',
      resultType: 'image',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(submittedBody)) as {
      node: { data: { provider: string } };
      settings: { providerSettings: Record<string, unknown> };
    };
    expect(requestBody.node.data.provider).toBe('localOpen');
    expect(requestBody.settings.providerSettings.localOpenImageEndpointUrl).toBe('http://127.0.0.1:9000/v1/edit');
  });

  it('does not let a polling Atlas job serialize an unrelated BytePlus start', async () => {
    const atlasPoll = deferred<Response>();
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/model/generateImage')) {
        return jsonResponse({ data: { id: 'atlas-polling-job' } });
      }
      if (url.includes('/model/prediction/atlas-polling-job')) {
        return atlasPoll.promise;
      }
      if (url.endsWith('/images/generations')) {
        return jsonResponse({ data: [{ b64_json: 'QllURVBMVVM=' }] });
      }
      throw new Error(`Unexpected fake provider request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const atlas = executeNodeRequest(
      imageNode('atlas', 'black-forest-labs/flux-schnell'),
      context,
      settings,
    );
    atlas.catch(() => undefined);
    for (let turn = 0; turn < 20 && !requestedUrls.some((url) => url.includes('/model/prediction/')); turn += 1) {
      await Promise.resolve();
    }
    expect(requestedUrls.some((url) => url.includes('/model/prediction/atlas-polling-job'))).toBe(true);

    const byteplus = executeNodeRequest(
      imageNode('byteplus', 'seedream-5-0-260128'),
      context,
      settings,
    );
    await expect(byteplus).resolves.toMatchObject({
      result: 'data:image/png;base64,QllURVBMVVM=',
      resultType: 'image',
    });
    expect(requestedUrls.some((url) => url.endsWith('/images/generations'))).toBe(true);

    atlasPoll.resolve(jsonResponse({
      data: {
        status: 'succeeded',
        outputs: ['data:image/png;base64,QVRMQVM='],
      },
    }));
    await expect(atlas).resolves.toMatchObject({ resultType: 'image' });
  });
});
