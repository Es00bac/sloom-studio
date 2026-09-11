import { describe, expect, it, vi } from 'vitest';
import {
  discoverProvider,
  parseSampleRequest,
} from './providerDiscovery';

describe('provider discovery', () => {
  it('uses a native well-known Sloom manifest first', async () => {
    const manifest = minimalManifest();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.example.test/.well-known/sloom-provider.json');
      return jsonResponse(manifest);
    }) as unknown as typeof fetch;

    const result = await discoverProvider({
      baseEndpoint: 'https://api.example.test/v1',
      authentication: { type: 'bearer', value: 'secret' },
      fetchImpl,
    });

    expect(result.models[0]).toMatchObject({
      confidence: 'provider-verified',
      source: 'sloom-manifest',
    });
    expect(result.redactedRequestPreview).not.toContain('secret');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches advertised cross-origin schemas without credentials', async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const openapi = {
      openapi: '3.1.0',
      paths: {
        '/v1/images': {
          post: {
            operationId: 'create-image',
            summary: 'Create image',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['prompt'],
                    properties: { prompt: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get('authorization') ?? undefined });
      if (url.endsWith('/.well-known/sloom-provider.json')) return new Response('', { status: 404 });
      if (url === 'https://api.example.test/v1') {
        return new Response('', {
          headers: { Link: '<https://schemas.example.test/openapi.json>; rel="service-desc"' },
        });
      }
      return jsonResponse(openapi);
    }) as unknown as typeof fetch;

    const result = await discoverProvider({
      baseEndpoint: 'https://api.example.test/v1',
      authentication: { type: 'bearer', value: 'origin-secret' },
      fetchImpl,
    });

    expect(result.models[0].source).toBe('advertised-schema');
    expect(calls.find((call) => call.url.includes('schemas.example.test'))?.authorization).toBeUndefined();
    expect(calls.filter((call) => call.url.includes('api.example.test')).every((call) =>
      call.authorization === 'Bearer origin-secret'
    )).toBe(true);
  });

  it('creates operation-specific OpenAPI routes with their exact HTTP methods', async () => {
    const schema = {
      openapi: '3.0.3',
      paths: {
        '/v1/generate': {
          post: { operationId: 'generate', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { prompt: { type: 'string' } } } } } } },
        },
        '/v1/status': {
          get: { operationId: 'status' },
        },
      },
    };
    const result = await discoverProvider({
      baseEndpoint: 'https://custom.example.test',
      schemaText: JSON.stringify(schema),
      authentication: { type: 'none' },
      fetchImpl: emptyDiscoveryFetch,
    });

    expect(result.models).toHaveLength(2);
    const routes = new Map(result.pack.transports.map((route) => [route.endpointPath, route.method]));
    expect(routes.get('/v1/generate')).toBe('POST');
    expect(routes.get('/v1/status')).toBe('GET');
    expect(new Set(result.pack.cards.flatMap((card) => card.operations.map((operation) => operation.transportProfileId))).size)
      .toBe(2);
  });

  it('discovers model-ID-only providers and clearly marks the cards inferred', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return jsonResponse({ data: [{ id: 'artisan-image-v1' }, { id: 'story-text-v1' }] });
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const result = await discoverProvider({
      baseEndpoint: 'https://models.example.test',
      authentication: { type: 'none' },
      fetchImpl,
    });
    expect(result.models.map((model) => model.confidence)).toEqual(['inferred', 'inferred']);
    expect(result.models.map((model) => model.source)).toEqual(['model-list', 'model-list']);
  });

  it('parses cURL as text, redacts secrets, rejects shell syntax, and never invokes a shell', () => {
    const parsed = parseSampleRequest(
      `curl -X POST https://api.example.test/v1/images -H "Authorization: Bearer secret" -d '{"prompt":"cat","api_key":"secret"}'`,
    );
    expect(parsed).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/v1/images',
    });
    expect(parsed.redactedPreview).not.toContain('Bearer secret');
    expect(parsed.redactedPreview).not.toContain('"api_key": "secret"');
    expect(() => parseSampleRequest('curl https://api.example.test/$(whoami)')).toThrow(/shell execution/i);
    expect(() => parseSampleRequest('curl https://api.example.test -d @/etc/passwd')).toThrow(/local files/i);
  });

  it('returns an understandable manual draft when metadata is incomplete', async () => {
    const result = await discoverProvider({
      baseEndpoint: 'https://empty.example.test',
      authentication: { type: 'none' },
      fetchImpl: emptyDiscoveryFetch,
    });
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ source: 'manual', confidence: 'manual' });
    expect(result.pack.cards[0].status).toBe('draft');
    expect(result.attempts.at(-1)).toMatchObject({ step: 'Manual definition', status: 'used' });
  });
});

const emptyDiscoveryFetch = (async () => new Response('', { status: 404 })) as typeof fetch;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function minimalManifest() {
  return {
    schemaVersion: 1,
    packId: 'example.native',
    version: '1.0.0',
    displayName: 'Native example',
    provider: { name: 'Example' },
    approvedOrigins: [{ origin: 'https://api.example.test' }],
    credentialSlots: [],
    discovery: [],
    optionCatalogs: [],
    transports: [{
      id: 'http',
      label: 'HTTP',
      kind: 'http',
      approvedOrigin: 'https://api.example.test',
      method: 'POST',
      endpointPath: '/v1/generate',
      bodyKind: 'json',
    }],
    cards: [{
      schemaVersion: 1,
      id: 'model:example',
      modelId: 'example',
      displayName: 'Example',
      modalities: ['text'],
      fields: [{
        id: 'prompt',
        label: 'Prompt',
        apiPath: 'prompt',
        semanticRole: 'prompt',
        valueType: 'string',
        cardinality: 'one',
        required: true,
        connectable: true,
        operationIds: ['generate'],
        control: 'prompt',
      }],
      outputs: [{
        id: 'text-output',
        label: 'Text',
        semanticRole: 'text-output',
        resultType: 'text',
        primary: true,
        cardinality: 'one',
        operationIds: ['generate'],
      }],
      operations: [{
        id: 'generate',
        label: 'Generate',
        transportProfileId: 'http',
        requiredFieldIds: ['prompt'],
        visibleFieldIds: ['prompt'],
        inputPortFieldIds: ['prompt'],
        outputIds: ['text-output'],
        outputExtractions: [{ outputId: 'text-output', kind: 'json-pointer', pointer: '/text' }],
      }],
      evidence: [],
      confidence: 'provider-verified',
      status: 'ready-untested',
      layout: {
        schemaVersion: 1,
        id: 'layout',
        width: 390,
        minWidth: 260,
        maxWidth: 1040,
        fitTarget: '1080p',
        heightBudget: 900,
        containers: [{ id: 'main', kind: 'grid', order: 0, columns: 1 }],
        elements: [{ id: 'prompt', fieldId: 'prompt', containerId: 'main', order: 0, height: 42 }],
      },
    }],
  };
}
