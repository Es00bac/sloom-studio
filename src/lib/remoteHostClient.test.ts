// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';

const lanMocks = vi.hoisted(() => ({
  publisher: null as ((change: unknown) => void) | null,
}));

// The phone-host detection must never mistake a normal web visitor for a served LAN session.
// Capture the publisher seam so large desktop-to-phone handoff transport can be exercised.
vi.mock('./androidLanServer', () => ({
  isAndroidLanServerAvailable: () => false,
  initializeLanServerProxy: () => {},
  setServedMutationPublisher: (publisher: (change: unknown) => void) => {
    lanMocks.publisher = publisher;
  },
}));

const projectSyncMocks = vi.hoisted(() => ({
  startAll: vi.fn(),
  stopAll: vi.fn(),
}));
vi.mock('./projectSyncClient', () => ({
  startAllRegisteredProjectChannels: projectSyncMocks.startAll,
  stopAllProjectSyncChannels: projectSyncMocks.stopAll,
}));

// The seed must hydrate the freshly-restored bins so a served client's native-file thumbnails resolve
// through the host endpoint (restoreProjectSnapshot leaves their unreachable phone-local assetUrl and
// does NOT hydrate). Mock the (lazily imported) source-bin store so the seed's calls are observable.
vi.mock('../store/sourceBinStore', () => {
  const restoreProjectSnapshot = vi.fn().mockResolvedValue(undefined);
  const hydrateAssets = vi.fn().mockResolvedValue(undefined);
  return {
    useSourceBinStore: {
      getState: () => ({ restoreProjectSnapshot, hydrateAssets }),
    },
  };
});

interface MockResponseInit {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: unknown;
}

function mockResponse({ ok, status, contentType, body }: MockResponseInit) {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? contentType ?? null : null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const TOKEN_STORAGE_KEY = 'signal-loom-remote-host-token';

/** jsdom here has no working localStorage; provide an in-memory Storage the module can read/write. */
function stubMemoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

async function loadFreshModule() {
  vi.resetModules();
  return import('./remoteHostClient');
}

function sha256Identity(value: string): string {
  return `sha256:${Array.from(sha256(new TextEncoder().encode(value)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function fixedJsonResponse(value: unknown): Response {
  const body = JSON.stringify(value);
  return new Response(body, { headers: { 'content-length': String(body.length), 'content-type': 'application/json' } });
}

function sourceSeedResponse() {
  return mockResponse({
    ok: true,
    contentType: 'application/json',
    body: { version: 0, snapshot: null },
  });
}

beforeEach(() => {
  projectSyncMocks.startAll.mockClear();
  projectSyncMocks.stopAll.mockClear();
  lanMocks.publisher = null;
});

describe('remoteHostClient served-session detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not flag a served session when the host answers HTML (a static web host like sloom.studio)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockResponse({ ok: true, contentType: 'text/html', body: '<!doctype html>' })),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.isServedLanSession()).toBe(false);
  });

  it('does not flag a served session when JSON lacks the Sloom Studio identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockResponse({ ok: true, contentType: 'application/json', body: { name: 'Something Else' } })),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.isServedLanSession()).toBe(false);
  });

  it('flags a served session only when /health returns the Sloom Studio JSON identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/health')) {
          return mockResponse({
            ok: true,
            contentType: 'application/json',
            body: { name: 'Sloom Studio', authRequired: false },
          });
        }
        // source-library seed probe — return empty so the store import is skipped in this unit test
        return mockResponse({ ok: false });
      }),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.isServedLanSession()).toBe(true);
    expect(mod.getRemoteHostCollaborationMode()).toBe('baton');
    expect(mod.isSimultaneousProjectSyncSession()).toBe(false);
  });

  it('adopts an explicitly advertised simultaneous collaboration session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true,
          contentType: 'application/json',
          body: { name: 'Sloom Studio', authRequired: false, collaborationMode: 'simultaneous' },
        });
      }
      return mockResponse({ ok: false });
    }));
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.getRemoteHostCollaborationMode()).toBe('simultaneous');
    expect(mod.isSimultaneousProjectSyncSession()).toBe(true);
  });

  it('does not flag a served session on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.isServedLanSession()).toBe(false);
  });
});

describe('remoteHostClient seed hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates assets after restoring the seed snapshot (so served thumbnails resolve via the host)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/health')) {
          return mockResponse({
            ok: true,
            contentType: 'application/json',
            body: { name: 'Sloom Studio', authRequired: false },
          });
        }
        if (url.includes('/source-library') && !url.includes('/events')) {
          // A native-file-backed item: its assetUrl is an unreachable phone-local capacitor URL until
          // hydrateAssets re-resolves it through the host's /source-asset endpoint.
          return mockResponse({
            ok: true,
            contentType: 'application/json',
            body: {
              version: 1,
              snapshot: {
                bins: [{ id: 'b1', name: 'Source Library', items: [{ id: 'native-1', kind: 'image' }] }],
                dismissedSourceKeys: [],
              },
            },
          });
        }
        // The long-poll subscriber never starts here (no token in the open-host path), so /events is unused.
        return mockResponse({ ok: false });
      }),
    );

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();

    const store = (await import('../store/sourceBinStore')).useSourceBinStore.getState();
    expect(store.restoreProjectSnapshot).toHaveBeenCalledTimes(1);
    expect(store.hydrateAssets).toHaveBeenCalledTimes(1);
    // Hydration must run AFTER the restore (the restore seeds the unreachable URLs; hydrate fixes them).
    const restoreOrder = (store.restoreProjectSnapshot as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const hydrateOrder = (store.hydrateAssets as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(hydrateOrder).toBeGreaterThan(restoreOrder);
  });

  it('publishes Source Library edits to an open host that does not require a token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true,
          contentType: 'application/json',
          body: { name: 'Sloom Studio', authRequired: false, collaborationMode: 'simultaneous' },
        });
      }
      if (url.includes('/source-library') && !url.includes('/events') && init?.method !== 'POST') {
        return sourceSeedResponse();
      }
      if (url.includes('/source-library/events')) return mockResponse({ ok: false, status: 503 });
      return mockResponse({ ok: true, contentType: 'application/json', body: { ok: true } });
    }));

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    lanMocks.publisher?.({
      type: 'source-bin-item-renamed',
      itemId: 'phone-sketch',
      label: 'Desktop title',
    });

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/source-library/mutate'))).toBe(true);
    });
    const mutation = calls.find((call) => call.url.endsWith('/source-library/mutate'));
    expect(mutation?.init?.method).toBe('POST');
  });
});

describe('remoteHostClient universal source-asset transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses bounded metadata/sample/full reads without Response.json()', async () => {
    const digest = sha256Identity('ABC');
    const core = {
      id: 'source-1', name: 'phone.png', mimeType: 'image/png', size: 3, createdAt: 1,
      transportRevision: 'source-v1', contentDigest: digest,
    };
    const identity = sha256Identity(`${core.id}\u0000${core.name}\u0000${core.mimeType}\u0000${core.size}\u0000${core.createdAt}\u0000${core.transportRevision}\u0000${core.contentDigest}`);
    const metadataResponse = fixedJsonResponse({ ...core, transportIdentity: identity });
    const sampleResponse = fixedJsonResponse({
      id: core.id, size: 3, mimeType: core.mimeType, transportIdentity: identity,
      headBase64: 'QUJD', tailBase64: 'QUJD', tailOffset: 0,
    });
    const fullResponse = fixedJsonResponse({
      id: core.id, name: core.name, mimeType: core.mimeType,
      dataUrl: 'data:image/png;base64,QUJD', byteLength: 3, createdAt: 1,
      transportRevision: core.transportRevision,
    });
    const jsonSpies = [metadataResponse, sampleResponse, fullResponse].map((response) => vi.spyOn(response, 'json'));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: false },
        });
      }
      if (url.includes('/source-library')) return mockResponse({ ok: false });
      if (url.includes('/source-asset-metadata/')) return metadataResponse;
      if (url.includes('/source-asset-sample/')) return sampleResponse;
      if (url.includes('/source-asset/')) return fullResponse;
      return mockResponse({ ok: false });
    }));

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    await expect(mod.fetchRemoteHostSourceAssetDataUrl('source-1'))
      .resolves.toBe('data:image/png;base64,QUJD');
    for (const jsonSpy of jsonSpies) expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('cancels a non-OK universal metadata body without waiting for stalled cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const rejected = new Response(new ReadableStream<Uint8Array>({ cancel, pull() {} }), { status: 503 });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: false },
        });
      }
      if (url.includes('/source-library')) return mockResponse({ ok: false });
      if (url.includes('/source-asset-metadata/')) return rejected;
      return mockResponse({ ok: false });
    }));

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    await expect(mod.fetchRemoteHostSourceAssetDataUrl('source-rejected')).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('remoteHostClient pairing (security without HTTPS)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves an auth-required host unpaired when no token is stored', async () => {
    stubMemoryStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/health')
          ? mockResponse({ ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: true } })
          : mockResponse({ ok: false }),
      ),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();

    expect(mod.isServedLanSession()).toBe(true);
    expect(mod.isRemoteHostAuthRequired()).toBe(true);
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');
  });

  it('exchanges a correct PIN for a session token and flips to paired', async () => {
    const storage = stubMemoryStorage();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/health')) {
          return mockResponse({ ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: true } });
        }
        if (url.endsWith('/pair')) {
          return mockResponse({ ok: true, contentType: 'application/json', body: { token: 'tok-abc' } });
        }
        if (url.includes('/source-library') && !url.includes('/events')) return sourceSeedResponse();
        return mockResponse({ ok: false });
      }),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');

    const result = await mod.pairServedSession('123456');
    expect(result).toEqual({ ok: true });
    expect(mod.getRemoteHostPairingState()).toBe('paired');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('tok-abc');

    const pairCall = calls.find((call) => call.url.endsWith('/pair'));
    expect(pairCall?.init?.method).toBe('POST');
    expect(JSON.parse(String(pairCall?.init?.body))).toEqual(expect.objectContaining({
      pin: '123456',
      deviceId: expect.stringMatching(/^[A-Za-z0-9._:-]+$/),
      deviceProof: expect.stringMatching(/^[A-Za-z0-9._:-]+$/),
    }));
  });

  it('rotates a refused local pairing identity instead of reclaiming an existing member', async () => {
    stubMemoryStorage();
    const pairBodies: Array<{ pin: string; deviceId: string; deviceProof: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) {
        return mockResponse({ ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: true } });
      }
      if (url.endsWith('/pair')) {
        pairBodies.push(JSON.parse(String(init?.body)));
        return pairBodies.length === 1
          ? mockResponse({ ok: false, status: 403, contentType: 'application/json', body: { error: 'device-binding-refused' } })
          : mockResponse({ ok: true, contentType: 'application/json', body: { token: 'rotated-token' } });
      }
      if (url.includes('/source-library') && !url.includes('/events')) return sourceSeedResponse();
      return mockResponse({ ok: false });
    }));

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    await expect(mod.pairServedSession('123456')).resolves.toEqual({ ok: true });

    expect(pairBodies).toHaveLength(2);
    expect(pairBodies[1]).toEqual(expect.objectContaining({ pin: '123456' }));
    expect(pairBodies[1]?.deviceId).not.toBe(pairBodies[0]?.deviceId);
    expect(pairBodies[1]?.deviceProof).not.toBe(pairBodies[0]?.deviceProof);
  });

  it('reports a friendly error and stays unpaired on a wrong PIN', async () => {
    const storage = stubMemoryStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/health')) {
          return mockResponse({ ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: true } });
        }
        if (url.endsWith('/pair')) {
          return mockResponse({ ok: false, status: 401, contentType: 'application/json', body: {} });
        }
        return mockResponse({ ok: false });
      }),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();

    const result = await mod.pairServedSession('000000');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/match/i);
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('does not report a paired session when the phone-owned project seed fails', async () => {
    const storage = stubMemoryStorage();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true,
          contentType: 'application/json',
          body: { name: 'Sloom Studio', authRequired: true },
        });
      }
      if (url.endsWith('/pair')) {
        return mockResponse({ ok: true, contentType: 'application/json', body: { token: 'seed-failed-token' } });
      }
      return mockResponse({ ok: false, status: 503 });
    }));

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    const result = await mod.pairServedSession('123456');

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/could not be loaded/i);
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('attaches the bearer token on API calls and unpairs on a 401', async () => {
    const storage = stubMemoryStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'stored-tok');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/health')) {
          return mockResponse({ ok: true, contentType: 'application/json', body: { name: 'Sloom Studio', authRequired: true } });
        }
        if (url.endsWith('/projects')) {
          return mockResponse({ ok: false, status: 401 });
        }
        if (url.endsWith('/pair')) {
          return mockResponse({ ok: true, contentType: 'application/json', body: { token: 'repaired-tok' } });
        }
        if (url.includes('/source-library') && !url.includes('/events')) return sourceSeedResponse();
        return mockResponse({ ok: false });
      }),
    );
    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    expect(mod.getRemoteHostPairingState()).toBe('paired');

    const res = await mod.remoteHostFetch('/projects');
    expect(res?.status).toBe(401);

    const projectsCall = calls.find((call) => call.url.endsWith('/projects'));
    const headers = projectsCall?.init?.headers as Headers | undefined;
    expect(headers?.get('Authorization')).toBe('Bearer stored-tok');

    // A 401 invalidates the token: the session drops back to unpaired and forgets it.
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();

    await expect(mod.pairServedSession('123456')).resolves.toEqual({ ok: true });
    expect(mod.getRemoteHostPairingState()).toBe('paired');
  });
});

describe('remoteHostClient installed-desktop phone session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the restricted proxy, activates authority only after health proof, and keeps the token out of renderer storage', async () => {
    const storage = stubMemoryStorage();
    const order: string[] = [];
    const bridge = {
      configureRemotePhoneHost: vi.fn(async () => {
        order.push('configure');
        return {
          ok: true,
          hostBaseUrl: 'http://192.168.1.42:8723',
          proxyApiBase: 'signal-loom-phone://host/__loom/api',
          generation: 7,
        };
      }),
      activateRemotePhoneHost: vi.fn(async (request: { generation: number }) => {
        order.push('activate');
        return { ok: true, generation: request.generation };
      }),
      markRemotePhoneHostSeeded: vi.fn(async () => ({ ok: true })),
      disconnectRemotePhoneHost: vi.fn(async (_request: { generation: number }) => ({ ok: true, localSaveSuspended: true })),
    };
    vi.stubGlobal('signalLoomNative', bridge);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        order.push('health');
        return mockResponse({
          ok: true,
          contentType: 'application/json',
          body: { name: 'Sloom Studio', authRequired: true },
        });
      }
      if (url.endsWith('/pair')) {
        return mockResponse({ ok: true, contentType: 'application/json', body: { ok: true } });
      }
      if (url.includes('/source-library') && !url.includes('/events')) return sourceSeedResponse();
      return mockResponse({ ok: false });
    }));

    const mod = await loadFreshModule();
    await expect(mod.connectNativePhoneHost('192.168.1.42')).resolves.toEqual({ ok: true });
    expect(order).toEqual(['configure', 'health', 'activate']);
    expect(mod.isNativePhoneHostSession()).toBe(true);
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');

    await expect(mod.pairServedSession('123456')).resolves.toEqual({ ok: true });
    expect(mod.getRemoteHostPairingState()).toBe('paired');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect([...Array(storage.length)].map((_, index) => storage.key(index)))
      .not.toContain(expect.stringContaining('token'));

    await mod.remoteHostFetch('/projects');
    const projectsCall = calls.find((call) => call.url.endsWith('/projects'));
    expect((projectsCall?.init?.headers as Headers).has('Authorization')).toBe(false);
    expect((projectsCall?.init?.headers as Headers).get('X-Signal-Loom-Phone-Generation')).toBe('7');

    const { useEditLockStore } = await import('../store/editLockStore');
    useEditLockStore.getState().setLock({
      revision: 1,
      holder: { id: 'phone', label: 'Phone' },
      pending: null,
      heldSince: 1,
      expiresAt: Date.now() + 60_000,
      pendingExpiresAt: 0,
    });
    await expect(mod.disconnectNativePhoneHost()).resolves.toEqual({ ok: true, localSaveSuspended: true });
    expect(bridge.disconnectRemotePhoneHost).toHaveBeenLastCalledWith({ generation: 7 });
    expect(mod.isServedLanSession()).toBe(false);
    expect(useEditLockStore.getState().lock).toBeNull();
  });

  it('does not activate save suspension when the configured endpoint fails identity proof', async () => {
    const bridge = {
      configureRemotePhoneHost: vi.fn(async () => ({
        ok: true,
        hostBaseUrl: 'http://192.168.1.42:8723',
        proxyApiBase: 'signal-loom-phone://host/__loom/api',
        generation: 11,
      })),
      activateRemotePhoneHost: vi.fn(async (request: { generation: number }) => ({ ok: true, generation: request.generation })),
      disconnectRemotePhoneHost: vi.fn(async (_request: { generation: number }) => ({ ok: true, localSaveSuspended: false })),
    };
    vi.stubGlobal('signalLoomNative', bridge);
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({
      ok: true,
      contentType: 'application/json',
      body: { name: 'Not Sloom Studio' },
    })));

    const mod = await loadFreshModule();
    const result = await mod.connectNativePhoneHost('192.168.1.42');
    expect(result.ok).toBe(false);
    expect(bridge.activateRemotePhoneHost).not.toHaveBeenCalled();
    expect(bridge.disconnectRemotePhoneHost).toHaveBeenCalledWith({ generation: 11 });
  });

  it('does not let a stale concurrent connect disconnect the winning host generation', async () => {
    stubMemoryStorage();
    let resolveFirstHealth!: (response: ReturnType<typeof mockResponse>) => void;
    const firstHealth = new Promise<ReturnType<typeof mockResponse>>((resolve) => {
      resolveFirstHealth = resolve;
    });
    let generation = 0;
    const bridge = {
      configureRemotePhoneHost: vi.fn(async (request: { baseUrl: string }) => {
        generation += 1;
        return {
          ok: true,
          hostBaseUrl: `http://${request.baseUrl}:8723`,
          proxyApiBase: 'signal-loom-phone://host/__loom/api',
          generation,
        };
      }),
      activateRemotePhoneHost: vi.fn(async (request: { generation: number }) => ({
        ok: true,
        generation: request.generation,
      })),
      disconnectRemotePhoneHost: vi.fn(async () => ({ ok: false, stale: true })),
    };
    vi.stubGlobal('signalLoomNative', bridge);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/health')) return mockResponse({ ok: false });
      const requestGeneration = new Headers(init?.headers).get('X-Signal-Loom-Phone-Generation');
      if (requestGeneration === '1') return await firstHealth;
      return mockResponse({
        ok: true,
        contentType: 'application/json',
        body: { name: 'Sloom Studio', authRequired: true },
      });
    }));

    const mod = await loadFreshModule();
    const first = mod.connectNativePhoneHost('192.168.1.41');
    await vi.waitFor(() => expect(bridge.configureRemotePhoneHost).toHaveBeenCalledTimes(1));
    const second = mod.connectNativePhoneHost('192.168.1.42');
    await expect(second).resolves.toEqual({ ok: true });
    resolveFirstHealth(mockResponse({ ok: false, status: 409 }));
    await expect(first).resolves.toEqual(expect.objectContaining({ ok: false }));

    expect(bridge.disconnectRemotePhoneHost).toHaveBeenCalledWith({ generation: 1 });
    expect(mod.isServedLanSession()).toBe(true);
    expect(mod.isNativePhoneHostSession()).toBe(true);
    expect(mod.getRemoteHostPairingState()).toBe('unpaired');
  });

  it('ignores a delayed 401 from a disconnected generation after a new phone session pairs', async () => {
    stubMemoryStorage();
    let generation = 20;
    let resolveOldRequest!: (response: ReturnType<typeof mockResponse>) => void;
    const oldRequest = new Promise<ReturnType<typeof mockResponse>>((resolve) => {
      resolveOldRequest = resolve;
    });
    let projectsRequests = 0;
    const bridge = {
      configureRemotePhoneHost: vi.fn(async (request: { baseUrl: string }) => ({
        ok: true,
        hostBaseUrl: `http://${request.baseUrl}:8723`,
        proxyApiBase: 'signal-loom-phone://host/__loom/api',
        generation: ++generation,
      })),
      activateRemotePhoneHost: vi.fn(async (request: { generation: number }) => ({
        ok: true,
        generation: request.generation,
      })),
      markRemotePhoneHostSeeded: vi.fn(async () => ({ ok: true })),
      disconnectRemotePhoneHost: vi.fn(async () => ({ ok: true, localSaveSuspended: false })),
    };
    vi.stubGlobal('signalLoomNative', bridge);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true,
          contentType: 'application/json',
          body: { name: 'Sloom Studio', authRequired: true },
        });
      }
      if (url.endsWith('/pair')) {
        return mockResponse({ ok: true, contentType: 'application/json', body: { ok: true } });
      }
      if (url.includes('/source-library') && !url.includes('/events')) return sourceSeedResponse();
      if (url.endsWith('/projects')) {
        projectsRequests += 1;
        if (projectsRequests === 1) return await oldRequest;
      }
      return mockResponse({ ok: false });
    }));

    const mod = await loadFreshModule();
    await expect(mod.connectNativePhoneHost('192.168.1.41')).resolves.toEqual({ ok: true });
    await expect(mod.pairServedSession('111111')).resolves.toEqual({ ok: true });
    const staleFetch = mod.remoteHostFetch('/projects');

    await mod.disconnectNativePhoneHost();
    await expect(mod.connectNativePhoneHost('192.168.1.42')).resolves.toEqual({ ok: true });
    await expect(mod.pairServedSession('222222')).resolves.toEqual({ ok: true });
    expect(mod.getRemoteHostPairingState()).toBe('paired');

    resolveOldRequest(mockResponse({ ok: false, status: 401 }));
    await staleFetch;
    expect(mod.getRemoteHostPairingState()).toBe('paired');
    expect(mod.isServedLanSession()).toBe(true);
  });

  it('commits a layered Image handoff above 12 MiB in bounded chunks before publishing its card', async () => {
    const storage = stubMemoryStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        return mockResponse({
          ok: true,
          contentType: 'application/json',
          body: { name: 'Sloom Studio', authRequired: true, collaborationMode: 'simultaneous' },
        });
      }
      if (url.includes('/source-library') && !url.includes('/events') && init?.method !== 'POST') {
        return sourceSeedResponse();
      }
      if (url.includes('/source-library/events')) return mockResponse({ ok: false, status: 503 });
      return mockResponse({ ok: true, contentType: 'application/json', body: { ok: true } });
    }));

    const mod = await loadFreshModule();
    await mod.initializeRemoteHostSession();
    const assetStore = await import('./assetStore');
    const dataUrl = `data:application/x-sloom-slimg;base64,${'A'.repeat(12 * 1024 * 1024)}`;
    vi.spyOn(assetStore, 'loadImportedAssetAsDataUrl').mockResolvedValue({
      id: 'large-slimg',
      name: 'drawing.slimg',
      mimeType: 'application/x-sloom-slimg',
      dataUrl,
    });

    lanMocks.publisher?.({
      type: 'source-bin-items-added',
      items: [{
        id: 'handoff-item',
        label: 'Drawing — continue on another device',
        kind: 'image',
        mimeType: 'application/x-sloom-slimg',
        assetId: 'large-slimg',
        createdAt: 1,
      }],
    });

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/source-library/mutate'))).toBe(true);
    });
    const beginIndex = calls.findIndex((call) => call.url.includes('/asset-upload/large-slimg/begin'));
    const chunkCalls = calls.filter((call) => call.url.includes('/asset-upload/large-slimg/chunk/'));
    const commitIndex = calls.findIndex((call) => call.url.includes('/asset-upload/large-slimg/commit'));
    const mutateIndex = calls.findIndex((call) => call.url.endsWith('/source-library/mutate'));
    expect(beginIndex).toBeGreaterThan(-1);
    expect(chunkCalls.length).toBeGreaterThan(1);
    expect(commitIndex).toBeGreaterThan(beginIndex);
    expect(mutateIndex).toBeGreaterThan(commitIndex);
    expect(calls.some((call) => call.url.endsWith('/asset/large-slimg'))).toBe(false);
    for (const call of chunkCalls) {
      const body = JSON.parse(String(call.init?.body)) as { chunk: string };
      expect(body.chunk.length).toBeLessThanOrEqual(512 * 1024);
    }
  });
});
