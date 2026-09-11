import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchDownstreamMediaBlob,
  fetchProviderResultBlob,
  fetchRemoteMediaAsDataUrl,
} from './remoteMediaFetch';

const ATLAS_URL = 'https://atlas-media.oss-us-west-1.aliyuncs.com/flux/generated.png';

describe('fetchRemoteMediaAsDataUrl', () => {
  it('returns undefined for non-http(s) inputs', async () => {
    const result = await fetchRemoteMediaAsDataUrl('data:image/png;base64,AAAA', {});
    expect(result).toBeUndefined();
  });

  it('returns undefined when no native download path is available (plain web/dev)', async () => {
    const result = await fetchRemoteMediaAsDataUrl(ATLAS_URL, {});
    expect(result).toBeUndefined();
  });

  it('inlines Android CapacitorHttp bytes as a data URL (bypasses CORS + force-download)', async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      data: 'iVBORw0KGgoAAAANSUhEUg',
      headers: { 'Content-Type': 'image/png; charset=utf-8' },
    });

    const result = await fetchRemoteMediaAsDataUrl(ATLAS_URL, {
      isAndroidNative: true,
      capacitorHttp: { get },
    });

    expect(get).toHaveBeenCalledWith({ url: ATLAS_URL, responseType: 'blob' });
    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
      mimeType: 'image/png',
    });
  });

  it('does not use CapacitorHttp when the platform is not Android-native', async () => {
    const get = vi.fn();
    const result = await fetchRemoteMediaAsDataUrl(ATLAS_URL, {
      isAndroidNative: false,
      capacitorHttp: { get },
    });

    expect(get).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('inlines Electron main-process bytes as a data URL', async () => {
    const electronDownload = vi.fn().mockResolvedValue({ base64: 'QUJD', mimeType: 'image/webp' });

    const result = await fetchRemoteMediaAsDataUrl(ATLAS_URL, { electronDownload });

    expect(electronDownload).toHaveBeenCalledWith(ATLAS_URL);
    expect(result).toEqual({ dataUrl: 'data:image/webp;base64,QUJD', mimeType: 'image/webp' });
  });

  it('cancels an in-flight Electron download once and never accepts its late bytes', async () => {
    let resolveDownload!: (value: { base64: string; mimeType: string }) => void;
    const electronDownload = vi.fn((_url: string, _cancellationId?: string) => new Promise<{
      base64: string;
      mimeType: string;
    }>((resolve) => {
      resolveDownload = resolve;
    }));
    const electronCancelDownload = vi.fn().mockResolvedValue({ cancelled: true });
    const controller = new AbortController();

    const pending = fetchRemoteMediaAsDataUrl(ATLAS_URL, {
      electronDownload,
      electronCancelDownload,
    }, controller.signal);
    await vi.waitFor(() => expect(electronDownload).toHaveBeenCalledOnce());
    const cancellationId = electronDownload.mock.calls[0][1];
    expect(cancellationId).toMatch(/^flow-media-/);

    controller.abort();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(electronCancelDownload).toHaveBeenCalledOnce();
    expect(electronCancelDownload).toHaveBeenCalledWith(cancellationId);

    resolveDownload({ base64: 'TEFURQ==', mimeType: 'image/png' });
    await Promise.resolve();
    expect(electronCancelDownload).toHaveBeenCalledOnce();
  });

  it('falls through to CapacitorHttp when the Electron downloader reports an error', async () => {
    const electronDownload = vi.fn().mockResolvedValue({ error: 'HTTP 500' });
    const get = vi.fn().mockResolvedValue({
      status: 200,
      data: 'QkJC',
      headers: { 'content-type': 'image/jpeg' },
    });

    const result = await fetchRemoteMediaAsDataUrl(ATLAS_URL, {
      electronDownload,
      isAndroidNative: true,
      capacitorHttp: { get },
    });

    expect(result).toEqual({ dataUrl: 'data:image/jpeg;base64,QkJC', mimeType: 'image/jpeg' });
  });

  it('returns undefined when CapacitorHttp throws', async () => {
    const get = vi.fn().mockRejectedValue(new Error('native failure'));
    const result = await fetchRemoteMediaAsDataUrl(ATLAS_URL, {
      isAndroidNative: true,
      capacitorHttp: { get },
    });

    expect(result).toBeUndefined();
  });
});

describe('fetchProviderResultBlob', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the renderer fetch blob when the download succeeds (desktop / permissive CORS)', async () => {
    const blob = new Blob(['hello'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob }));

    const result = await fetchProviderResultBlob(`${ATLAS_URL}?Signature=x`, 'X failed');

    expect(result).toBe(blob);
  });

  it('falls back to the direct native download when the proxied fetch returns 403 (Android signed-CDN fix)', async () => {
    // On Android the patched-fetch proxy mangles the signed URL → 403; the helper must then pull
    // the bytes through the direct native path instead of throwing.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob() }));
    const get = vi.fn().mockResolvedValue({ status: 200, data: 'AAAA', headers: { 'content-type': 'image/png' } });

    const result = await fetchProviderResultBlob(
      `${ATLAS_URL}?Signature=abc&Expires=1`,
      'Atlas result download failed',
      undefined,
      { isAndroidNative: true, capacitorHttp: { get } },
    );

    expect(get).toHaveBeenCalled();
    expect(result.type).toBe('image/png');
    expect(result.size).toBe(3); // "AAAA" base64 decodes to 3 bytes
  });

  it('throws the labelled error when neither the renderer fetch nor a native path can download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(
      fetchProviderResultBlob(`${ATLAS_URL}?Signature=z`, 'Boom', undefined, {}),
    ).rejects.toThrow('Boom');
  });
});

describe('fetchDownstreamMediaBlob (AUD-029)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a bounded renderer response with the expected media MIME family', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['PNG'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '3' },
    })));

    const result = await fetchDownstreamMediaBlob(ATLAS_URL, {
      kind: 'image',
      errorLabel: 'Image reference failed',
      runtime: {},
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.blob.size).toBe(3);
  });

  it('validates inline data and blob URLs through the same bounded MIME-family gate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob(['PNG'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))
      .mockResolvedValueOnce(new Response('<html>not an image</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const inline = await fetchDownstreamMediaBlob('data:image/png;base64,UE5H', {
      kind: 'image', errorLabel: 'Image reference failed', runtime: {},
    });
    const localBlob = await fetchDownstreamMediaBlob('blob:valid-image', {
      kind: 'image', errorLabel: 'Image reference failed', runtime: {},
    });

    expect(await inline.blob.text()).toBe('PNG');
    expect(localBlob.mimeType).toBe('image/png');
    await expect(fetchDownstreamMediaBlob('data:text/html;base64,PGh0bWw+', {
      kind: 'image', errorLabel: 'Image reference failed', runtime: {},
    })).rejects.toThrow(/text\/html; expected image media/i);
    await expect(fetchDownstreamMediaBlob('blob:wrong-family', {
      kind: 'image', errorLabel: 'Image reference failed', runtime: {},
    })).rejects.toThrow(/text\/html; expected image media/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses native bytes after a renderer transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('renderer transport unavailable')));
    const electronDownload = vi.fn().mockResolvedValue({ base64: 'V0VCUA==', mimeType: 'image/webp' });

    const result = await fetchDownstreamMediaBlob(ATLAS_URL, {
      kind: 'image',
      errorLabel: 'Image reference failed',
      runtime: { electronDownload },
    });

    expect(electronDownload).toHaveBeenCalledWith(ATLAS_URL);
    expect(result.mimeType).toBe('image/webp');
    expect(await result.blob.text()).toBe('WEBP');
  });

  it('rejects a non-2xx renderer response when native transport cannot provide media', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', {
      status: 410,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(fetchDownstreamMediaBlob(`${ATLAS_URL}?signed=secret`, {
      kind: 'image',
      errorLabel: 'Image reference failed',
      runtime: {},
    })).rejects.toThrow(/Image reference failed .*HTTP 410.*native download was unavailable/i);
  });

  it('rejects an expired HTML response instead of encoding it as media', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>expired</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(fetchDownstreamMediaBlob(ATLAS_URL, {
      kind: 'video',
      errorLabel: 'Video reference failed',
      runtime: {},
    })).rejects.toThrow(/text\/html; expected video media/i);
  });

  it('rejects native non-2xx completion after renderer failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('renderer transport unavailable')));
    const get = vi.fn().mockResolvedValue({
      status: 403,
      data: 'bm90LW1lZGlh',
      headers: { 'content-type': 'image/png' },
    });

    await expect(fetchDownstreamMediaBlob(ATLAS_URL, {
      kind: 'image',
      errorLabel: 'Image reference failed',
      runtime: { isAndroidNative: true, capacitorHttp: { get } },
    })).rejects.toThrow(/renderer transport unavailable.*Android native download returned HTTP 403/i);
    expect(get).toHaveBeenCalledOnce();
  });

  it('preserves actionable native status while redacting signed transport details', async () => {
    const signedUrl = `${ATLAS_URL}?Signature=renderer-secret#fragment-secret`;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(
      `Failed to fetch ${signedUrl}; token=renderer-token; Bearer renderer-bearer`,
    )));
    const electronDownload = vi.fn().mockResolvedValue({
      error: `HTTP 403 for ${signedUrl}; access_token=native-token`,
    });

    let message = '';
    try {
      await fetchDownstreamMediaBlob(signedUrl, {
        kind: 'image', errorLabel: 'Image reference failed', runtime: { electronDownload },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('HTTP 403');
    expect(message).toContain('atlas-media.oss-us-west-1.aliyuncs.com/flux/generated.png');
    expect(message).toContain('token=[redacted]');
    expect(message).not.toMatch(/renderer-secret|fragment-secret|renderer-token|renderer-bearer|native-token/);
    expect(message).not.toContain('?Signature=');
    expect(message).not.toContain('#fragment');
  });

  it('redacts complete Basic and Bearer values without erasing ordinary diagnostic words', async () => {
    const basicCredential = 'dXNlcjpwYXNzd29yZA==';
    const bearerCredential = 'mixed-Bearer_token.42';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(
      `Renderer HTTP 429. AUTHORIZATION :   bAsIc ${basicCredential},\n` +
      'ordinary basic renderer diagnostics remain readable; a bearer of news remains readable.',
    )));
    const electronDownload = vi.fn().mockResolvedValue({
      error: `Native HTTP 403; authorization=  BeArEr ${bearerCredential};\n` +
        `detached: BASIC ${basicCredential}, detached: bEaReR ${bearerCredential}.`,
    });

    let message = '';
    try {
      await fetchDownstreamMediaBlob(ATLAS_URL, {
        kind: 'image', errorLabel: 'Image reference failed', runtime: { electronDownload },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Renderer HTTP 429');
    expect(message).toContain('Native HTTP 403');
    expect(message).toContain('ordinary basic renderer diagnostics remain readable');
    expect(message).toContain('a bearer of news remains readable');
    expect(message).not.toContain(basicCredential);
    expect(message).not.toContain(bearerCredential);
    expect(message).not.toMatch(/authorization\s*[:=]\s*(?:basic|bearer)/i);
    expect(message.match(/\[redacted\]/g)).toHaveLength(4);
  });

  it('redacts alphabetic-only detached Bearer values at diagnostic boundaries without broad prose loss', async () => {
    const alphabeticBearer = 'abcdefghijklmnop';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(
      `Renderer HTTP 401;\nBearer ${alphabeticBearer}; ` +
      'basic renderer remains readable; bearer of news remains readable; Bearer short.',
    )));
    const electronDownload = vi.fn().mockResolvedValue({
      error: `Native HTTP 403, bEaReR ${alphabeticBearer}\n` +
        `Authorization: BeArEr ${alphabeticBearer}; short ordinary words stay readable.`,
    });

    let message = '';
    try {
      await fetchDownstreamMediaBlob(ATLAS_URL, {
        kind: 'image', errorLabel: 'Image reference failed', runtime: { electronDownload },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Renderer HTTP 401');
    expect(message).toContain('Native HTTP 403');
    expect(message).toContain('basic renderer remains readable');
    expect(message).toContain('bearer of news remains readable');
    expect(message).toContain('Bearer short');
    expect(message).toContain('short ordinary words stay readable');
    expect(message).not.toContain(alphabeticBearer);
    expect(message).not.toMatch(/authorization\s*:\s*bearer/i);
    expect(message.match(/\[redacted\]/g)).toHaveLength(3);
  });

  it('rejects a native response with the wrong media MIME family', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('renderer transport unavailable')));
    const electronDownload = vi.fn().mockResolvedValue({
      base64: 'eyJlcnJvciI6ImV4cGlyZWQifQ==',
      mimeType: 'application/json',
    });

    await expect(fetchDownstreamMediaBlob(ATLAS_URL, {
      kind: 'audio',
      errorLabel: 'Audio reference failed',
      runtime: { electronDownload },
    })).rejects.toThrow(/application\/json; expected audio media/i);
  });

  it('rejects declared and actual payloads above the configured byte bound', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('X', {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '5' },
      }))
      .mockResolvedValueOnce(new Response(new Blob(['12345'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDownstreamMediaBlob('blob:declared', {
      kind: 'image', errorLabel: 'Image reference failed', maxBytes: 4, runtime: {},
    })).rejects.toThrow(/declared more than the 4-byte/i);
    await expect(fetchDownstreamMediaBlob('blob:actual', {
      kind: 'image', errorLabel: 'Image reference failed', maxBytes: 4, runtime: {},
    })).rejects.toThrow(/returned 5 bytes, above the 4-byte/i);
  });

  it('preserves cancellation while the renderer read is pending and never starts native fallback', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    const electronDownload = vi.fn();
    const controller = new AbortController();

    const pending = fetchDownstreamMediaBlob(ATLAS_URL, {
      kind: 'image',
      errorLabel: 'Image reference failed',
      runtime: { electronDownload },
    }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(electronDownload).not.toHaveBeenCalled();
    resolveFetch(new Response(new Blob(['late'], { type: 'image/png' })));
  });
});
