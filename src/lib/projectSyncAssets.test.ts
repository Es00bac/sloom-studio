import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  android: { value: false },
  served: { value: false },
  fetch: vi.fn(),
}));

vi.mock('./androidLanServer', () => ({
  isAndroidLanServerAvailable: () => h.android.value,
}));
vi.mock('./remoteHostClient', () => ({
  isServedLanSession: () => h.served.value,
  remoteHostFetch: (...args: unknown[]) => h.fetch(...args),
}));

import {
  commitVerifiedProjectSyncAssets,
  getProjectSyncAsset,
  prepareVerifiedProjectSyncAssets,
  putProjectSyncAsset,
  putVerifiedProjectSyncAsset,
} from './projectSyncAssets';
import { getHostProjectSyncAsset, resetProjectSyncLog } from './projectSyncService';

beforeEach(() => {
  h.android.value = false;
  h.served.value = false;
  h.fetch.mockReset();
  resetProjectSyncLog();
});

describe('putVerifiedProjectSyncAsset', () => {
  it('records directly on the authority and reports success', async () => {
    h.android.value = true;
    await expect(putVerifiedProjectSyncAsset('paper', 'sha256:abc', 'data:application/octet-stream;base64,AQ=='))
      .resolves.toBe(true);
    expect(getHostProjectSyncAsset('paper', 'sha256:abc')).toBe('data:application/octet-stream;base64,AQ==');
  });

  it('requires a served authority acknowledgement', async () => {
    h.served.value = true;
    h.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false });
    await expect(putVerifiedProjectSyncAsset('paper', 'one', 'data:application/octet-stream;base64,AQ=='))
      .resolves.toBe(true);
    await expect(putVerifiedProjectSyncAsset('paper', 'two', 'data:application/octet-stream;base64,Ag=='))
      .resolves.toBe(false);
  });

  it('chunks large Image/Paper assets before publishing their content-addressed pointer', async () => {
    h.served.value = true;
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const dataUrl = `data:image/png;base64,${'A'.repeat(512 * 1024 + 16)}`;

    await expect(putVerifiedProjectSyncAsset('image', 'layer@large', dataUrl)).resolves.toBe(true);

    const urls = h.fetch.mock.calls.map(([path]) => String(path));
    expect(urls[0]).toContain('/project/image/asset-upload/layer%40large/begin');
    expect(urls.filter((url) => url.includes('/chunk/'))).toHaveLength(2);
    expect(urls.at(-1)).toContain('/project/image/asset-upload/layer%40large/commit');
    expect(urls.some((url) => url === '/project/image/asset/layer%40large')).toBe(false);
    for (const [, options] of h.fetch.mock.calls.filter(([path]) => String(path).includes('/chunk/'))) {
      const body = JSON.parse(String((options as { body?: string }).body)) as { chunk: string };
      expect(body.chunk.length).toBeLessThanOrEqual(512 * 1024);
    }
  });

  it('fails closed off-session and when transport rejects', async () => {
    await expect(putVerifiedProjectSyncAsset('paper', 'one', 'data:application/octet-stream;base64,AQ=='))
      .resolves.toBe(false);
    h.served.value = true;
    h.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(putVerifiedProjectSyncAsset('paper', 'one', 'data:application/octet-stream;base64,AQ=='))
      .resolves.toBe(false);
  });
});

describe('prepareVerifiedProjectSyncAssets', () => {
  it('pins the complete authority inventory before byte publication', async () => {
    h.android.value = true;
    await expect(prepareVerifiedProjectSyncAssets('paper', ['one', 'two'])).resolves.toBe(true);
    // A subsequently inserted pinned member remains normally fetchable.
    await putVerifiedProjectSyncAsset('paper', 'one', 'data:application/octet-stream;base64,AQ==');
    expect(getHostProjectSyncAsset('paper', 'one')).toBe('data:application/octet-stream;base64,AQ==');
  });

  it('requires served acknowledgement and fails closed off-session', async () => {
    await expect(prepareVerifiedProjectSyncAssets('paper', [])).resolves.toBe(false);
    h.served.value = true;
    h.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false });
    await expect(prepareVerifiedProjectSyncAssets('paper', ['one'])).resolves.toBe(true);
    await expect(prepareVerifiedProjectSyncAssets('paper', ['two'])).resolves.toBe(false);
  });

  it('does not treat an HTTP-200 structured authority rejection as an upload acknowledgement', async () => {
    h.served.value = true;
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'invalid-project-sync-asset' }) });
    await expect(prepareVerifiedProjectSyncAssets('paper', ['one'])).resolves.toBe(false);
  });

  it('does not infer acknowledgement from a bare HTTP 200 response', async () => {
    h.served.value = true;
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(prepareVerifiedProjectSyncAssets('paper', ['one'])).resolves.toBe(false);
  });
});

describe('Android served-client authority precedence', () => {
  it('uses the paired remote authority instead of the Android device host cache', async () => {
    h.android.value = true;
    h.served.value = true;
    h.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ asset: 'data:image/png;base64,REMOTE' }) })
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await expect(getProjectSyncAsset('image', 'layer@2:remote')).resolves
      .toBe('data:image/png;base64,REMOTE');
    await expect(prepareVerifiedProjectSyncAssets('image', ['layer@2:remote'])).resolves.toBe(true);
    await expect(putProjectSyncAsset('image', 'layer@3:local', 'data:image/png;base64,LOCAL'))
      .resolves.toBe(true);
    await expect(commitVerifiedProjectSyncAssets('image', ['layer@3:local'])).resolves.toBe(true);

    expect(h.fetch).toHaveBeenCalledWith(
      '/project/image/asset/layer%402%3Aremote',
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
    expect(h.fetch.mock.calls.some(([path]) => String(path) === '/project/image/assets')).toBe(true);
    expect(h.fetch.mock.calls.some(([path]) => String(path) === '/project/image/asset/layer%403%3Alocal'))
      .toBe(true);
    expect(getHostProjectSyncAsset('image', 'layer@3:local')).toBeNull();
  });
});
