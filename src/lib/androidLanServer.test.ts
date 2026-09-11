import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { value: 'android' },
  start: vi.fn(async (options: { port?: number }) => ({
    running: true,
    port: options.port ?? 8723,
    ip: '10.0.0.5',
    url: `http://10.0.0.5:${options.port ?? 8723}/`,
  })),
  stop: vi.fn(async () => ({ running: false, port: 0, ip: '10.0.0.5', url: null })),
  status: vi.fn(async () => ({ running: true, port: 8723, ip: '10.0.0.5', url: 'http://10.0.0.5:8723/' })),
  addListener: vi.fn(async () => ({ remove: vi.fn() })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform.value },
  registerPlugin: () => ({
    start: mocks.start, stop: mocks.stop, status: mocks.status, addListener: mocks.addListener,
  }),
}));

import {
  getAndroidLanServerStatus,
  initializeLanServerProxy,
  isAndroidLanServerAvailable,
  resolveLanRequest,
  SIGNAL_LOOM_LAN_SERVER_DEFAULT_PORT,
  startAndroidLanServer,
  stopAndroidLanServer,
} from './androidLanServer';
import { claimLock, resetEditLock } from './projectEditLock';
import {
  clearProjectSyncChannels,
  getHostProjectSyncAsset,
  getProjectSyncEventsSince,
  recordProjectSyncChange,
  registerProjectSyncChannel,
  resetProjectSyncLog,
  type ProjectSyncChannel,
} from './projectSyncService';

describe('androidLanServer', () => {
  afterEach(() => {
    mocks.platform.value = 'android';
    mocks.start.mockClear();
    mocks.stop.mockClear();
  });

  it('reports availability only on the native Android platform', () => {
    mocks.platform.value = 'android';
    expect(isAndroidLanServerAvailable()).toBe(true);
    mocks.platform.value = 'web';
    expect(isAndroidLanServerAvailable()).toBe(false);
  });

  it('starts the LAN server on the default port and returns the desktop URL', async () => {
    const status = await startAndroidLanServer();
    expect(mocks.start).toHaveBeenCalledWith({
      port: SIGNAL_LOOM_LAN_SERVER_DEFAULT_PORT,
      pin: '',
    });
    expect(status?.url).toBe(`http://10.0.0.5:${SIGNAL_LOOM_LAN_SERVER_DEFAULT_PORT}/`);
  });

  it('no-ops off Android without touching the plugin', async () => {
    mocks.platform.value = 'web';
    expect(await startAndroidLanServer()).toBeNull();
    expect(await getAndroidLanServerStatus()).toBeNull();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('stops the LAN server', async () => {
    const status = await stopAndroidLanServer();
    expect(mocks.stop).toHaveBeenCalled();
    expect(status?.running).toBe(false);
  });

  it('reassembles and validates a chunked layered-Image asset before storing it', async () => {
    const putAsset = vi.fn(async () => undefined);
    initializeLanServerProxy({ putAsset });
    const dataUrl = 'data:application/x-sloom-slimg;base64,QUJD';
    const uploadId = 'upload-1';
    const base = '/__loom/api/asset-upload/large-slimg';

    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/begin`,
      body: JSON.stringify({
        uploadId,
        name: 'drawing.slimg',
        mimeType: 'application/x-sloom-slimg',
        totalLength: dataUrl.length,
        chunkCount: 2,
        createdAt: 123,
      }),
    })).resolves.toMatchObject({ ok: true });
    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/chunk/0`,
      body: JSON.stringify({ uploadId, chunk: dataUrl.slice(0, 20) }),
    })).resolves.toMatchObject({ ok: true, received: 1 });
    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/chunk/1`,
      body: JSON.stringify({ uploadId, chunk: dataUrl.slice(20) }),
    })).resolves.toMatchObject({ ok: true, received: 2 });
    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/commit`,
      body: JSON.stringify({ uploadId }),
    })).resolves.toMatchObject({ ok: true, byteLength: 3 });
    // A response can vanish after IndexedDB commits. The client's retry must receive the retained
    // acknowledgement instead of turning the completed handoff into an apparent failure.
    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/commit`,
      body: JSON.stringify({ uploadId }),
    })).resolves.toMatchObject({ ok: true, duplicate: true, byteLength: 3 });
    expect(putAsset).toHaveBeenCalledWith('large-slimg', {
      id: 'large-slimg',
      name: 'drawing.slimg',
      mimeType: 'application/x-sloom-slimg',
      dataUrl,
      createdAt: 123,
    });
    expect(putAsset).toHaveBeenCalledTimes(1);
  });

  it('only acknowledges a direct Source Library asset after validating and storing it', async () => {
    const putAsset = vi.fn(async () => undefined);
    initializeLanServerProxy({ putAsset });
    const path = '/__loom/api/asset/direct-slimg';
    const record = {
      id: 'direct-slimg',
      name: 'drawing.slimg',
      mimeType: 'application/x-sloom-slimg',
      dataUrl: 'data:application/x-sloom-slimg;base64,QUJD',
      createdAt: 123,
    };

    await expect(resolveLanRequest({ method: 'PUT', path, body: JSON.stringify(record) }))
      .resolves.toEqual({ ok: true });
    expect(putAsset).toHaveBeenCalledWith('direct-slimg', record);

    await expect(resolveLanRequest({ method: 'PUT', path, body: '{bad json' }))
      .resolves.toEqual({ ok: false, error: 'invalid-source-asset' });
    await expect(resolveLanRequest({
      method: 'PUT',
      path,
      body: JSON.stringify({ ...record, id: 'wrong-id' }),
    })).resolves.toEqual({ ok: false, error: 'invalid-source-asset' });
    expect(putAsset).toHaveBeenCalledTimes(1);
  });

  it('reassembles project pixel assets through the bounded background-safe chunk route', async () => {
    const dataUrl = 'data:image/png;base64,QUJD';
    const uploadId = 'project-upload-1';
    const base = '/__loom/api/project/image/asset-upload/layer%401';

    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/begin`,
      body: JSON.stringify({ uploadId, totalLength: dataUrl.length, chunkCount: 2 }),
    })).resolves.toEqual({ ok: true });
    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/chunk/0`,
      body: JSON.stringify({ uploadId, chunk: dataUrl.slice(0, 12) }),
    })).resolves.toMatchObject({ ok: true, received: 1 });
    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/chunk/1`,
      body: JSON.stringify({ uploadId, chunk: dataUrl.slice(12) }),
    })).resolves.toMatchObject({ ok: true, received: 2 });
    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/commit`, body: JSON.stringify({ uploadId }),
    })).resolves.toMatchObject({ ok: true, byteLength: 3 });
    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/commit`, body: JSON.stringify({ uploadId }),
    })).resolves.toMatchObject({ ok: true, duplicate: true, byteLength: 3 });
    expect(getHostProjectSyncAsset('image', 'layer@1')).toBe(dataUrl);
  });

  it('serves bounded asset metadata separately from the asset payload', async () => {
    const getAssetMetadata = vi.fn(async () => ({
      id: 'asset-1', name: 'clip.mp4', mimeType: 'video/mp4', size: 123, createdAt: 1,
    }));
    initializeLanServerProxy({ getAssetMetadata });
    await expect(resolveLanRequest({
      method: 'GET', path: '/__loom/api/asset-metadata/asset-1',
    })).resolves.toMatchObject({ size: 123, mimeType: 'video/mp4' });
    expect(getAssetMetadata).toHaveBeenCalledWith('asset-1');
  });

  it('does not positively acknowledge a malformed Source Library mutation', async () => {
    await expect(resolveLanRequest({
      method: 'POST', path: '/__loom/api/source-library/mutate', body: '{bad json',
    })).resolves.toMatchObject({ ok: false, error: 'invalid-source-library-change' });
  });

  it('requires and forwards the explicit bound, sample window, and identity for asset bytes', async () => {
    const getAsset = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,QUJD' }));
    const getAssetSample = vi.fn(async () => ({ headBase64: 'QUJD', tailBase64: 'QUJD' }));
    initializeLanServerProxy({ getAsset, getAssetSample });

    await expect(resolveLanRequest({
      method: 'GET', path: '/__loom/api/asset/asset-1',
    })).resolves.toBeNull();
    expect(getAsset).not.toHaveBeenCalled();

    const query = 'maxBytes=8&sampleBytes=4&transportIdentity=revision-1';
    await expect(resolveLanRequest({
      method: 'GET', path: `/__loom/api/asset-sample/asset-1?${query}`,
    })).resolves.toMatchObject({ headBase64: 'QUJD' });
    await expect(resolveLanRequest({
      method: 'GET', path: `/__loom/api/asset/asset-1?${query}`,
    })).resolves.toMatchObject({ dataUrl: 'data:image/png;base64,QUJD' });
    expect(getAssetSample).toHaveBeenCalledWith('asset-1', {
      maxBytes: 8, sampleBytes: 4, transportIdentity: 'revision-1',
    });
    expect(getAsset).toHaveBeenCalledWith('asset-1', {
      maxBytes: 8, sampleBytes: 4, transportIdentity: 'revision-1',
    });
  });

  it('requires the same metadata, sample, and full lifecycle for universal source assets', async () => {
    const getSourceAssetMetadata = vi.fn(async () => ({
      id: 'source-1', name: 'clip.mp4', mimeType: 'video/mp4', size: 123, createdAt: 1,
      transportRevision: 'source-revision', transportIdentity: 'sha256:source-identity',
    }));
    const getSourceAssetSample = vi.fn(async () => ({ headBase64: 'QUJD', tailBase64: 'QUJD' }));
    const getSourceAsset = vi.fn(async () => ({ dataUrl: 'data:video/mp4;base64,QUJD' }));
    initializeLanServerProxy({ getSourceAssetMetadata, getSourceAssetSample, getSourceAsset });

    await expect(resolveLanRequest({
      method: 'GET', path: '/__loom/api/source-asset/source-1',
    })).resolves.toBeNull();
    expect(getSourceAsset).not.toHaveBeenCalled();

    await expect(resolveLanRequest({
      method: 'GET', path: '/__loom/api/source-asset-metadata/source-1',
    })).resolves.toMatchObject({ size: 123, mimeType: 'video/mp4' });
    const query = 'maxBytes=256&sampleBytes=64&transportIdentity=sha256%3Asource-identity';
    await expect(resolveLanRequest({
      method: 'GET', path: `/__loom/api/source-asset-sample/source-1?${query}`,
    })).resolves.toMatchObject({ headBase64: 'QUJD' });
    await expect(resolveLanRequest({
      method: 'GET', path: `/__loom/api/source-asset/source-1?${query}`,
    })).resolves.toMatchObject({ dataUrl: 'data:video/mp4;base64,QUJD' });
    expect(getSourceAssetSample).toHaveBeenCalledWith('source-1', {
      maxBytes: 256, sampleBytes: 64, transportIdentity: 'sha256:source-identity',
    });
    expect(getSourceAsset).toHaveBeenCalledWith('source-1', {
      maxBytes: 256, sampleBytes: 64, transportIdentity: 'sha256:source-identity',
    });
  });

  it('accepts a project-channel asset inventory before the content-addressed uploads', async () => {
    const base = '/__loom/api/project/paper';
    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/assets`,
      body: JSON.stringify({ assetIds: ['sha256:one', 'sha256:two'] }),
    })).resolves.toEqual({ ok: true });
    await expect(resolveLanRequest({
      method: 'PUT',
      path: `${base}/asset/sha256%3Aone`,
      body: JSON.stringify({ asset: 'data:application/octet-stream;base64,AQ==' }),
    })).resolves.toEqual({ ok: true });
    await expect(resolveLanRequest({
      method: 'GET', path: `${base}/asset/sha256%3Aone`,
    })).resolves.toEqual({ asset: 'data:application/octet-stream;base64,AQ==' });

    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/assets`, body: JSON.stringify({ assetIds: ['ok', 2] }),
    })).resolves.toMatchObject({ ok: false });
    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/asset/sha256%3Abad`, body: JSON.stringify({ asset: 'not-a-data-url' }),
    })).resolves.toEqual({ ok: false, error: 'invalid-project-sync-asset' });
    await expect(resolveLanRequest({
      method: 'PUT', path: `${base}/asset/sha256%3Abad`, body: '{broken',
    })).resolves.toEqual({ ok: false, error: 'invalid-project-sync-asset' });
  });

  it('multiplexes every workspace over one global project event poll', async () => {
    resetProjectSyncLog();
    recordProjectSyncChange('flow', { op: 'flow-live' });
    recordProjectSyncChange('video', { op: 'video-live' });

    await expect(resolveLanRequest({
      method: 'GET', path: '/__loom/api/project/events?since=0',
    })).resolves.toEqual({
      version: 2,
      gap: false,
      events: [
        { version: 1, channel: 'flow', change: { op: 'flow-live' } },
        { version: 2, channel: 'video', change: { op: 'video-live' } },
      ],
    });
    resetProjectSyncLog();
  });

  it('cursors an asynchronous channel snapshot before changes committed while it is being built', async () => {
    resetProjectSyncLog();
    let finishSnapshot!: () => void;
    registerProjectSyncChannel({
      id: 'slow-snapshot',
      applyRemote: () => true,
      snapshot: () => new Promise<{ op: string }>((resolve) => {
        finishSnapshot = () => resolve({ op: 'seed' });
      }),
    });

    const response = resolveLanRequest({
      method: 'GET', path: '/__loom/api/project/slow-snapshot/snapshot',
    });
    recordProjectSyncChange('slow-snapshot', { op: 'arrived-during-seed' });
    finishSnapshot();

    await expect(response).resolves.toEqual({ snapshot: { op: 'seed' }, version: 0 });
    clearProjectSyncChannels();
    resetProjectSyncLog();
  });
});

describe('androidLanServer — simultaneous project collaborators', () => {
  const BASE = '/__loom/api';
  const DESKTOP = { id: 'desktop-1', label: 'Desktop browser' };
  const PHONE = { id: '__loom_host__', label: 'Phone' };
  let applied: unknown[] = [];

  function registerCaptureChannel(id = 'flow'): void {
    applied = [];
    const channel: ProjectSyncChannel<unknown> = {
      id,
      applyRemote(change) {
        applied.push(change);
        return true;
      },
      snapshot: () => null,
    };
    registerProjectSyncChannel(channel);
  }

  function mutate(channel: string, change: unknown, authenticatedDeviceId?: string): Promise<unknown> {
    return resolveLanRequest({
      method: 'POST',
      path: `${BASE}/project/${channel}/mutate`,
      body: JSON.stringify(change),
      authenticatedDeviceId,
    });
  }

  function mutateWithId(channel: string, change: unknown, mutationId: string): Promise<unknown> {
    return resolveLanRequest({
      method: 'POST',
      path: `${BASE}/project/${channel}/mutate?mutation=${mutationId}`,
      body: JSON.stringify(change),
      authenticatedDeviceId: DESKTOP.id,
    });
  }

  afterEach(() => {
    resetEditLock();
    resetProjectSyncLog();
    clearProjectSyncChannels();
  });

  it('applies a mutate when the baton is unmanaged (no holder)', async () => {
    registerCaptureChannel();
    const res = (await mutate('flow', { op: 1 }, DESKTOP.id)) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(applied).toEqual([{ op: 1 }]);
  });

  it('does not publish a channel change that the authority did not apply', async () => {
    const channel: ProjectSyncChannel<unknown> = {
      id: 'paper',
      applyRemote: () => false,
      snapshot: () => null,
    };
    registerProjectSyncChannel(channel);

    await expect(mutate('paper', { schemaVersion: 99 }, DESKTOP.id)).resolves.toMatchObject({
      ok: false,
      error: 'change-not-applied',
      version: 0,
    });
    expect(getProjectSyncEventsSince(0, 'paper')).toEqual([]);
  });

  it('applies a mutate from the device named by the legacy presence baton', async () => {
    registerCaptureChannel();
    claimLock(DESKTOP);
    const res = (await mutate('flow', { op: 2 }, DESKTOP.id)) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(applied).toEqual([{ op: 2 }]);
  });

  it('applies a peer mutation while the phone is also editing', async () => {
    registerCaptureChannel();
    claimLock(PHONE);
    const res = (await mutate('flow', { op: 3 }, DESKTOP.id)) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(applied).toEqual([{ op: 3 }]);
  });

  it('does not require a legacy baton actor id for a current mutation', async () => {
    registerCaptureChannel();
    claimLock(PHONE);
    const res = (await mutate('flow', { op: 4 })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(applied).toEqual([{ op: 4 }]);
  });

  it('refuses forged host and peer actor claims before the team-review reducer, ignoring the URL query', async () => {
    registerCaptureChannel('team-review');
    await expect(resolveLanRequest({
      method: 'POST',
      path: `${BASE}/project/team-review/mutate?device=${PHONE.id}`,
      body: JSON.stringify({ actorId: PHONE.id, type: 'join' }),
      authenticatedDeviceId: DESKTOP.id,
    })).resolves.toMatchObject({
      ok: false,
      error: 'identity-mismatch',
    });
    await expect(mutate('team-review', { actorId: 'other-member', type: 'join' }, DESKTOP.id)).resolves.toMatchObject({
      ok: false,
      error: 'identity-mismatch',
    });
    await expect(mutate('team-review', { actorId: DESKTOP.id, type: 'join' })).resolves.toMatchObject({
      ok: false,
      error: 'identity-mismatch',
    });
    expect(applied).toEqual([]);
  });

  it('preserves a bound device through retry/replay without trusting a rotated URL actor', async () => {
    registerCaptureChannel('team-review');
    const first = await resolveLanRequest({
      method: 'POST',
      path: `${BASE}/project/team-review/mutate?mutation=team-retry-1&device=${PHONE.id}`,
      body: JSON.stringify({ actorId: DESKTOP.id, type: 'join' }),
      authenticatedDeviceId: DESKTOP.id,
    }) as { ok: boolean; version: number };
    const replay = await resolveLanRequest({
      method: 'POST',
      path: `${BASE}/project/team-review/mutate?mutation=team-retry-1&device=other-member`,
      body: JSON.stringify({ actorId: DESKTOP.id, type: 'join' }),
      authenticatedDeviceId: DESKTOP.id,
    }) as { ok: boolean; duplicate: boolean; version: number };

    expect(first.ok).toBe(true);
    expect(replay).toMatchObject({ ok: true, duplicate: true, version: first.version });
    expect(applied).toEqual([{ actorId: DESKTOP.id, type: 'join' }]);
  });

  it('acknowledges a lost-response retry without applying or logging the mutation twice', async () => {
    registerCaptureChannel();
    const first = await mutateWithId('flow', { op: 'once' }, 'retry-safe-1') as { version: number };
    const retry = await mutateWithId('flow', { op: 'once' }, 'retry-safe-1') as {
      ok: boolean; duplicate: boolean; version: number;
    };

    expect(first.version).toBeGreaterThan(0);
    expect(retry).toMatchObject({ ok: true, duplicate: true, version: first.version });
    expect(applied).toEqual([{ op: 'once' }]);
    expect(getProjectSyncEventsSince(0, 'flow')).toHaveLength(1);
  });

  it('rejects malformed mutations and channels that are not registered', async () => {
    await expect(resolveLanRequest({
      method: 'POST', path: `${BASE}/project/missing/mutate`, body: JSON.stringify({ op: 1 }),
    })).resolves.toMatchObject({ ok: false, error: 'unknown-channel' });
    registerCaptureChannel();
    await expect(resolveLanRequest({
      method: 'POST', path: `${BASE}/project/flow/mutate`, body: '{bad json',
    })).resolves.toMatchObject({ ok: false, error: 'invalid-change' });
  });
});
