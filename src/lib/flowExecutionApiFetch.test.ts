import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { API_REQUESTER_PERSISTED_CREDENTIAL_MARKER } from './apiRequesterCredentials';

const settings = {
  providerSettings: {
    backendProxyEnabled: false,
    batchMaxRetries: 0,
    batchRetryBaseDelayMs: 1,
  },
} as RuntimeSettingsSnapshot;

function requestNode(declaredOutputType?: 'text' | 'json', data: Record<string, unknown> = {}): AppNode {
  return {
    id: 'request',
    type: 'apiFetchNode',
    position: { x: 0, y: 0 },
    data: { url: 'https://example.test/data', declaredOutputType, ...data },
  } as AppNode;
}

describe('API Requester declared output execution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses declared JSON even when the server omits its content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));

    const result = await executeNodeRequest(
      requestNode('json'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    expect(result.resultType).toBe('json');
    expect(result.result).toBe('{"ok":true}');
  });

  it('rejects a response that violates a declared JSON output without coercing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    await expect(executeNodeRequest(
      requestNode('json'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    )).rejects.toThrow('declared JSON output');
  });

  it('keeps declared text as text even when the response is JSON-labelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const result = await executeNodeRequest(
      requestNode('text'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    expect(result.resultType).toBe('text');
    expect(result.result).toBe('{"ok":true}');
  });

  it('detects JSON MIME types case-insensitively and without parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'Application/JSON; Charset=UTF-8' },
    })));

    const result = await executeNodeRequest(
      requestNode(undefined),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    expect(result).toMatchObject({ result: '{"ok":true}', resultType: 'json', mimeType: 'application/json' });
  });

  it('preserves POST body and headers while recording unknown external usage honestly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('accepted', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNodeRequest(
      requestNode('text', {
        method: 'POST',
        headers: 'Authorization: Bearer top-secret\nX-Trace: trace-1',
        body: '{"input":"hello"}',
      }),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/data', expect.objectContaining({
      method: 'POST',
      body: '{"input":"hello"}',
      headers: expect.any(Headers),
    }));
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('authorization')).toBe('Bearer top-secret');
    expect(requestHeaders.get('x-trace')).toBe('trace-1');
    expect(result.usage).toMatchObject({ source: 'actual', confidence: 'unknown', provider: 'api-requester' });
  });

  it('omits GET bodies, preserves write-method bodies, and applies custom headers case-insensitively', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      await executeNodeRequest(requestNode('text', {
        method,
        headers: 'content-type: text/plain\nX-Trace: trace-1',
        body: 'safe body',
      }), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings);
    }

    const getInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(getInit.body).toBeUndefined();
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect((call[1] as RequestInit).body).toBe('safe body');
    }
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('content-type')).toBe('text/plain');
      expect([...headers.keys()].filter((name) => name === 'content-type')).toHaveLength(1);
    }
  });

  it('rejects credential-bearing URLs, binary payloads, and oversized responses before producing output', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      requestNode('text', { url: 'https://example.test/data?api_key=top-secret' }),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    )).rejects.toThrow('credentials in request headers');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }));
    await expect(executeNodeRequest(requestNode('text'), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings))
      .rejects.toThrow('only accepts text or JSON');

    fetchMock.mockResolvedValueOnce(new Response('ignored', {
      status: 200,
      headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
    }));
    await expect(executeNodeRequest(requestNode('text'), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings))
      .rejects.toThrow('5 MB safety limit');
  });

  it('does not retry permanent status errors or leak server-reflected credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Bearer top-secret', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(requestNode('text'), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, {
      ...settings,
      providerSettings: { ...settings.providerSettings, batchMaxRetries: 3 },
    })).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PUT', 'DELETE'] as const)('submits %s only once when retry settings allow replays', async (method) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('first submission failed', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(requestNode('text', { method, body: '{"prompt":"safe"}' }), {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG,
    }, {
      ...settings,
      providerSettings: { ...settings.providerSettings, batchMaxRetries: 2 },
    })).rejects.toThrow('HTTP 500');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires replacement of credentials redacted by persistence before it can submit again', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(requestNode('text', {
      headers: `Api-Key: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}`,
      body: `{"prompt":"safe","client_secret":"${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}"}`,
    }), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings)).rejects.toThrow('Replace each redacted value');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not treat ordinary editorial [redacted] text as a persisted credential marker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('accepted', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(requestNode('text', {
      headers: 'X-Trace: [redacted] storyboard note',
      body: '{"prompt":"keep [redacted] in the shot list","colorToken":"[redacted]"}',
    }), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings)).resolves.toMatchObject({ result: 'accepted' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation through to fetch and preserves AbortError for the store owner', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      controller.abort();
      return Promise.reject(new DOMException('cancelled', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      requestNode('text'),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
      settings,
      undefined,
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles a mid-read abort, cancels its reader once, and releases the lock', async () => {
    const controller = new AbortController();
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: { getReader: () => reader },
    } as unknown as Response));

    const run = executeNodeRequest(requestNode('text', { provider: 'api-stream-test' }), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings,
      undefined, { signal: controller.signal });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    controller.abort();

    await expect(Promise.race([
      run.then(() => 'completed', (error: unknown) => error instanceof DOMException ? error.name : 'other-error'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ])).resolves.toBe('AbortError');
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('settles a hostile read/cancel abort promptly without double publication or late unhandled rejection', async () => {
    const controller = new AbortController();
    let resolveRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
    let rejectCancel: ((reason?: unknown) => void) | undefined;
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => { resolveRead = resolve; })),
      cancel: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectCancel = reject; })),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: { getReader: () => reader },
    } as unknown as Response));

    const run = executeNodeRequest(requestNode('text'), { prompt: '', config: DEFAULT_EXECUTION_CONFIG }, settings,
      undefined, { signal: controller.signal });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    controller.abort();

    await expect(Promise.race([
      run.then(() => 'completed', (error: unknown) => error instanceof DOMException ? error.name : 'other-error'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ])).resolves.toBe('AbortError');
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);

    resolveRead?.({ done: false, value: new TextEncoder().encode('late response') });
    rejectCancel?.(new Error('late cancel failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
