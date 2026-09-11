import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateVertexImageDirect,
  generateVertexTextDirect,
  generateVertexVideoDirect,
  isVertexDirectRestAvailable,
} from './vertexDirectRest';
import type { ProviderSettings } from '../types/flow';

vi.mock('./vertex/vertexServiceAccountAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('./vertex/vertexServiceAccountAuth')>();
  return {
    ...original,
    getVertexCredentialAccessToken: vi.fn(async () => ({
      accessToken: 'test-token',
      expiresAt: Date.now() + 3_600_000,
    })),
  };
});

const settings = {
  vertexServiceAccountJson: '{"type":"service_account"}',
} as ProviderSettings;

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

describe('isVertexDirectRestAvailable', () => {
  it('requires a service-account key', () => {
    expect(isVertexDirectRestAvailable({ vertexServiceAccountJson: '' } as ProviderSettings)).toBe(false);
    expect(isVertexDirectRestAvailable({ vertexServiceAccountJson: '  ' } as ProviderSettings)).toBe(false);
    expect(isVertexDirectRestAvailable(settings)).toBe(true);
  });
});

describe('generateVertexImageDirect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the gemini route with the minted token and extracts inlineData', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }],
    }));
    const result = await generateVertexImageDirect(
      {
        projectId: 'proj-1',
        location: 'global',
        modelId: 'gemini-3-pro-image-preview',
        route: 'gemini-generate-content',
        body: { contents: [] },
      },
      settings,
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe('data:image/png;base64,QUJD');
    expect(result.mimeType).toBe('image/png');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/publishers/google/models/gemini-3-pro-image-preview:generateContent',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['x-goog-user-project']).toBe('proj-1');
  });

  it('uses :predict for imagen and reads predictions bytes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      predictions: [{ bytesBase64Encoded: 'REVG', mimeType: 'image/jpeg' }],
    }));
    const result = await generateVertexImageDirect(
      {
        projectId: 'proj-1',
        location: 'us-central1',
        modelId: 'imagen-4.0',
        route: 'imagen-predict',
        body: { instances: [] },
      },
      settings,
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result.result).toBe('data:image/jpeg;base64,REVG');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(':predict');
  });

  it('honours a quota project override from request auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      predictions: [{ bytesBase64Encoded: 'REVG' }],
    }));
    await generateVertexImageDirect(
      {
        projectId: 'proj-1',
        location: 'global',
        modelId: 'imagen-4.0',
        route: 'imagen-predict',
        auth: { mode: 'gcloud-user', quotaProjectId: 'billing-proj' },
        body: {},
      },
      settings,
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers['x-goog-user-project']).toBe('billing-proj');
  });

  it('surfaces API error messages instead of throwing', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'quota exceeded' } }, false, 429));
    const result = await generateVertexImageDirect(
      {
        projectId: 'proj-1',
        location: 'global',
        modelId: 'imagen-4.0',
        route: 'imagen-predict',
        body: {},
      },
      settings,
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.result).toBeUndefined();
    expect(result.error).toBe('Vertex AI image generation failed (429): quota exceeded');
  });

  it('fails without a service-account key', async () => {
    const result = await generateVertexImageDirect(
      {
        projectId: 'proj-1',
        location: 'global',
        modelId: 'imagen-4.0',
        route: 'imagen-predict',
        body: {},
      },
      { vertexServiceAccountJson: '' } as ProviderSettings,
      { fetch: vi.fn() as unknown as typeof fetch },
    );
    expect(result.error).toContain('ADC credential JSON');
  });
});

describe('generateVertexTextDirect', () => {
  it('joins candidate text parts', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: 'Hello' }, { text: 'world' }] } }],
    }));
    const result = await generateVertexTextDirect(
      { projectId: 'proj-1', location: 'global', modelId: 'gemini-3-pro', body: {} },
      settings,
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.error).toBeUndefined();
    expect(result.text).toBe('Hello\nworld');
  });
});

describe('generateVertexVideoDirect', () => {
  it('polls the long-running Veo operation and returns inline video bytes', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith(':predictLongRunning')) {
        return jsonResponse({ name: 'operations/op-1' });
      }
      return jsonResponse({
        name: 'operations/op-1',
        done: true,
        response: { videos: [{ bytesBase64Encoded: 'VklE', mimeType: 'video/mp4' }] },
      });
    });

    const result = await generateVertexVideoDirect(
      {
        projectId: 'proj-1',
        location: 'us-central1',
        modelId: 'veo-3.1',
        route: 'veo-predict-long-running',
        body: { instances: [] },
      },
      settings,
      { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe('data:video/mp4;base64,VklE');
    expect(calls[0].url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1:predictLongRunning',
    );
    expect(calls[1].url).toContain(':fetchPredictOperation');
    expect(calls[1].body).toContain('operations/op-1');
  });

  it('propagates operation errors as result errors', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      name: 'operations/op-1',
      error: { message: 'safety block' },
    }));
    const result = await generateVertexVideoDirect(
      {
        projectId: 'proj-1',
        location: 'us-central1',
        modelId: 'veo-3.1',
        route: 'veo-predict-long-running',
        body: {},
      },
      settings,
      { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} },
    );
    expect(result.error).toBe('safety block');
  });
});
