import { describe, expect, it, vi } from 'vitest';
import type { ProviderPackV1 } from './providerPackContracts';
import {
  executeProviderPackCard,
  modelCardOutputHandle,
  previewProviderPackRequest,
} from './providerPackExecution';

describe('generic provider-pack execution engines', () => {
  it('executes synchronous JSON HTTP and extracts a primary JSON Pointer', async () => {
    const pack = executionPack();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/v1/generate');
      expect(init?.redirect).toBe('manual');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'hello' });
      return jsonResponse({ result: { text: 'world' } });
    }) as unknown as typeof fetch;

    const result = await executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
    });
    expect(result).toMatchObject({ result: 'world', resultType: 'text' });
  });

  it('publishes every declared JSON output through its named output handle', async () => {
    const pack = executionPack();
    pack.cards[0].outputs.push({
      id: 'metadata-output',
      label: 'Metadata',
      semanticRole: 'metadata-output',
      resultType: 'json',
      cardinality: 'one',
      operationIds: ['generate'],
    });
    pack.cards[0].operations[0].outputIds.push('metadata-output');
    pack.cards[0].operations[0].outputExtractions?.push({
      outputId: 'metadata-output',
      kind: 'json-pointer',
      pointer: '/result/metadata',
    });
    const fetchImpl = vi.fn(async () => jsonResponse({
      result: {
        text: 'world',
        metadata: { language: 'en', confidence: 0.98 },
      },
    })) as unknown as typeof fetch;

    const result = await executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
    });

    expect(result.namedOutputs?.[modelCardOutputHandle('text-output')]).toMatchObject({
      result: 'world',
      resultType: 'text',
    });
    expect(result.namedOutputs?.[modelCardOutputHandle('metadata-output')]).toMatchObject({
      result: JSON.stringify({ language: 'en', confidence: 0.98 }),
      resultType: 'json',
    });
  });

  it('streams server-sent text using a declarative extraction path', async () => {
    const pack = executionPack('sse');
    pack.cards[0].operations[0].outputExtractions = [{
      outputId: 'text-output',
      kind: 'sse-text',
      pointer: '/delta',
    }];
    const fetchImpl = vi.fn(async () => new Response(
      'data: {"delta":"Hello "}\n\ndata: {"delta":"world"}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )) as unknown as typeof fetch;

    const result = await executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
    });
    expect(result).toMatchObject({ result: 'Hello world', resultType: 'text' });
  });

  it('supports multipart media inputs without placing bytes in request previews', async () => {
    const pack = executionPack();
    pack.transports[0].bodyKind = 'multipart';
    pack.cards[0].fields[0] = {
      ...pack.cards[0].fields[0],
      id: 'source',
      label: 'Source',
      apiPath: 'source',
      semanticRole: 'source-image',
      valueType: 'image',
      encoding: 'multipart',
      control: 'media',
    };
    pack.cards[0].operations[0] = {
      ...pack.cards[0].operations[0],
      requiredFieldIds: ['source'],
      visibleFieldIds: ['source'],
      inputPortFieldIds: ['source'],
      requestBindings: [{ fieldId: 'source', requestPath: 'source', encoding: 'multipart' }],
    };
    const source = 'data:image/png;base64,iVBORw0KGgo=';
    const preview = await previewProviderPackRequest({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { source },
    });
    expect(preview.text).toContain('[image/png');
    expect(preview.text).not.toContain('iVBORw0KGgo');

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get('source')).toBeInstanceOf(Blob);
      return jsonResponse({ result: { text: 'received' } });
    }) as unknown as typeof fetch;
    await expect(executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { source },
      fetchImpl,
    })).resolves.toMatchObject({ result: 'received' });
  });

  it('supports raw binary bodies and binary responses', async () => {
    const pack = executionPack();
    pack.transports[0].bodyKind = 'raw';
    pack.cards[0].operations[0].requestBindings = [{
      fieldId: 'prompt',
      requestPath: 'body',
      encoding: 'raw',
    }];
    pack.cards[0].outputs[0] = {
      ...pack.cards[0].outputs[0],
      semanticRole: 'audio-output',
      resultType: 'audio',
    };
    pack.cards[0].operations[0].outputExtractions = [{
      outputId: 'text-output',
      kind: 'binary',
      defaultMimeType: 'audio/wav',
    }];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBe('hello');
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { 'content-type': 'audio/wav' },
      });
    }) as unknown as typeof fetch;
    const result = await executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
    });
    expect(result).toMatchObject({ resultType: 'audio', mimeType: 'audio/wav', extension: 'wav' });
    expect(result.blob?.size).toBe(4);
  });

  it('submits, polls, and materializes asynchronous jobs without resubmitting', async () => {
    const pack = executionPack('submit-poll');
    pack.transports[0].poll = {
      statusPath: '/jobs/{id}',
      idPointer: '/id',
      resultPath: '/jobs/{id}/result',
      statePointer: '/state',
      pendingValues: ['queued'],
      successValues: ['done'],
      failureValues: ['failed'],
      cancelPath: '/jobs/{id}/cancel',
      intervalMs: 250,
      timeoutMs: 5_000,
    };
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/generate')) return jsonResponse({ id: 'job-1' });
      if (url.endsWith('/jobs/job-1') && calls.filter((call) => call.endsWith('/jobs/job-1')).length === 1) {
        return jsonResponse({ state: 'queued' });
      }
      if (url.endsWith('/jobs/job-1')) return jsonResponse({ state: 'done' });
      return jsonResponse({ result: { text: 'finished' } });
    }) as unknown as typeof fetch;

    const result = await executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
    });
    expect(result.result).toBe('finished');
    expect(calls.filter((call) => call.endsWith('/v1/generate'))).toHaveLength(1);
  });

  it('cancels an accepted asynchronous provider job without resubmitting it', async () => {
    const pack = executionPack('submit-poll');
    pack.transports[0].poll = {
      statusPath: '/jobs/{id}',
      idPointer: '/id',
      resultPath: '/jobs/{id}/result',
      statePointer: '/state',
      pendingValues: ['queued'],
      successValues: ['done'],
      failureValues: ['failed'],
      cancelPath: '/jobs/{id}/cancel',
      intervalMs: 250,
      timeoutMs: 5_000,
    };
    const controller = new AbortController();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/generate')) return jsonResponse({ id: 'job-cancel' });
      if (url.endsWith('/jobs/job-cancel')) {
        controller.abort();
        return jsonResponse({ state: 'queued' });
      }
      if (url.endsWith('/jobs/job-cancel/cancel')) return jsonResponse({ cancelled: true });
      throw new Error(`Unexpected request ${url}`);
    }) as unknown as typeof fetch;

    await expect(executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.filter((call) => call.endsWith('/v1/generate'))).toHaveLength(1);
    expect(calls).toContain('https://api.example.test/jobs/job-cancel/cancel');
  });

  it('times out a job at the declarative total deadline', async () => {
    vi.useFakeTimers();
    try {
      const pack = executionPack('submit-poll');
      pack.transports[0].poll = {
        statusPath: '/jobs/{id}',
        idPointer: '/id',
        resultPath: '/jobs/{id}/result',
        statePointer: '/state',
        pendingValues: ['queued'],
        successValues: ['done'],
        failureValues: ['failed'],
        intervalMs: 250,
        timeoutMs: 1_000,
      };
      const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/v1/generate')
          ? jsonResponse({ id: 'job-timeout' })
          : jsonResponse({ state: 'queued' })
      );
      const fetchImpl = fetchMock as unknown as typeof fetch;
      const pending = executeProviderPackCard({
        pack,
        card: pack.cards[0],
        operationId: 'generate',
        values: { prompt: 'hello' },
        fetchImpl,
      });
      const assertion = expect(pending).rejects.toThrow(/exceeded its 1 second timeout/i);
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/v1/generate')))
        .toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks redirects and does not follow credentials to another origin', async () => {
    const pack = executionPack();
    const fetchImpl = vi.fn(async () => new Response('', {
      status: 302,
      headers: { Location: 'https://attacker.example/steal' },
    })) as unknown as typeof fetch;
    await expect(executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl,
    })).rejects.toThrow(/redirect was blocked/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces missing required inputs and malformed primary outputs plainly', async () => {
    const pack = executionPack();
    await expect(executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: {},
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })).rejects.toThrow('Prompt is required');

    await expect(executeProviderPackCard({
      pack,
      card: pack.cards[0],
      operationId: 'generate',
      values: { prompt: 'hello' },
      fetchImpl: (async () => jsonResponse({ wrong: true })) as typeof fetch,
    })).rejects.toThrow(/did not contain/);
  });
});

function executionPack(kind: 'http' | 'sse' | 'submit-poll' = 'http'): ProviderPackV1 {
  return {
    schemaVersion: 1,
    packId: 'test.execution',
    version: '1.0.0',
    displayName: 'Execution test',
    provider: { name: 'Example' },
    approvedOrigins: [{ origin: 'https://api.example.test' }],
    credentialSlots: [],
    discovery: [],
    optionCatalogs: [],
    transports: [{
      id: 'route',
      label: 'Route',
      kind,
      approvedOrigin: 'https://api.example.test',
      method: 'POST',
      endpointPath: '/v1/generate',
      bodyKind: 'json',
    }],
    cards: [{
      schemaVersion: 1,
      id: 'model:test',
      modelId: 'test',
      displayName: 'Test',
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
        encoding: 'json',
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
        transportProfileId: 'route',
        requiredFieldIds: ['prompt'],
        visibleFieldIds: ['prompt'],
        inputPortFieldIds: ['prompt'],
        outputIds: ['text-output'],
        requestBindings: [{ fieldId: 'prompt', requestPath: 'prompt', encoding: 'json' }],
        outputExtractions: [{ outputId: 'text-output', kind: 'json-pointer', pointer: '/result/text' }],
      }],
      evidence: [],
      confidence: 'manual',
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}
