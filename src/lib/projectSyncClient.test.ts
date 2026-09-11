import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the generic served-client loop (task #51) against a mocked LAN transport + a fake channel,
 * so the seed → subscribe → publish path is verified without a phone: the seed applies the snapshot op,
 * the subscriber applies each event op through the channel, publish POSTs to the right route, and a
 * second start is idempotent.
 */

// Hoisted so the vi.mock factories (which run during import, before normal `let`s initialize) can
// safely close over this shared state without a temporal-dead-zone error.
const h = vi.hoisted(() => ({
  served: { value: true },
  epoch: { value: 1 },
  fetchMock: vi.fn<(path: string, init?: { method?: string; body?: string }) => Promise<unknown>>(),
  publisher: { current: null as ((channel: string, change: unknown) => Promise<boolean>) | null },
}));

vi.mock('./remoteHostClient', () => ({
  isServedLanSession: () => h.served.value,
  getRemoteHostSessionEpoch: () => h.epoch.value,
  remoteHostFetch: (path: string, init?: { method?: string; body?: string }) => h.fetchMock(path, init),
}));

vi.mock('./androidLanServer', () => ({
  setServedProjectMutationPublisher: (pub: ((channel: string, change: unknown) => Promise<boolean>) | null) => {
    h.publisher.current = pub;
  },
}));

const fetchMock = h.fetchMock;
const setServed = (value: boolean) => {
  h.served.value = value;
};

import {
  clearProjectSyncChannels,
  registerProjectSyncChannel,
  type ProjectSyncChannel,
} from './projectSyncService';
import {
  __resetProjectSyncClientForTests,
  ensureProjectSyncChannelStarted,
  stopAllProjectSyncChannels,
} from './projectSyncClient';

const jsonRes = (body: unknown) => ({ ok: true, json: async () => body });

function fakeChannel(applied: unknown[]): ProjectSyncChannel {
  return {
    id: 'fake',
    applyRemote: (change) => {
      applied.push(change);
      return true;
    },
    snapshot: () => ({ kind: 'snap' }),
  };
}

beforeEach(() => {
  setServed(true);
  h.epoch.value += 1;
  fetchMock.mockReset();
  clearProjectSyncChannels();
  __resetProjectSyncClientForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('projectSyncClient', () => {
  it('seeds from the snapshot then applies each tailed event op', async () => {
    const applied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(applied));

    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) {
        return Promise.resolve(jsonRes({ snapshot: { op: 'seed' }, version: 3 }));
      }
      if (path.includes('/events')) {
        setServed(false); // end the long-poll loop after delivering this batch
        return Promise.resolve(
          jsonRes({ version: 5, events: [{ version: 4, channel: 'fake', change: { op: 'live' } }] }),
        );
      }
      return Promise.resolve(null);
    });

    await ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(applied).toHaveLength(2));

    expect(applied[0]).toEqual({ op: 'seed' }); // snapshot seed
    expect(applied[1]).toEqual({ op: 'live' }); // tailed event
    // The events long-poll carried the cursor from the seed version.
    expect(fetchMock.mock.calls.some(([p]) => p === '/project/events?since=3')).toBe(true);
  });

  it('falls back to the pre-multiplex per-channel event route on an older phone', async () => {
    const applied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(applied));
    let legacyPolls = 0;
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/snapshot')) return Promise.resolve(jsonRes({ snapshot: { op: 'seed' }, version: 3 }));
      if (path === '/project/events?since=3') {
        return Promise.resolve({ ok: false, status: 404, json: async () => null });
      }
      if (path === '/project/fake/events?since=3') {
        legacyPolls += 1;
        setServed(false);
        return Promise.resolve(jsonRes({
          version: 4,
          events: [{ version: 4, channel: 'fake', change: { op: 'legacy-live' } }],
        }));
      }
      return Promise.resolve(null);
    });

    await ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(legacyPolls).toBe(1));
    await vi.waitFor(() => expect(applied).toEqual([{ op: 'seed' }, { op: 'legacy-live' }]));
  });

  it('is idempotent: a second start does not re-seed', async () => {
    const applied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(applied));
    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) return Promise.resolve(jsonRes({ snapshot: { op: 'seed' }, version: 1 }));
      setServed(false);
      return Promise.resolve(jsonRes({ version: 1, events: [] }));
    });

    await ensureProjectSyncChannelStarted('fake');
    await ensureProjectSyncChannelStarted('fake');

    const snapshotCalls = fetchMock.mock.calls.filter(([p]) => p.includes('/snapshot'));
    expect(snapshotCalls).toHaveLength(1);
  });

  it('re-seeds a channel after the served session is restarted', async () => {
    const applied: unknown[] = [];
    let snapshotCalls = 0;
    registerProjectSyncChannel(fakeChannel(applied));
    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) {
        snapshotCalls += 1;
        return Promise.resolve(jsonRes({ snapshot: { op: `seed-${snapshotCalls}` }, version: snapshotCalls }));
      }
      setServed(false);
      return Promise.resolve(jsonRes({ version: snapshotCalls, events: [] }));
    });

    await ensureProjectSyncChannelStarted('fake');
    stopAllProjectSyncChannels();
    setServed(true);
    await ensureProjectSyncChannelStarted('fake');

    expect(snapshotCalls).toBe(2);
    expect(applied).toEqual([{ op: 'seed-1' }, { op: 'seed-2' }]);
  });

  it('re-seeds instead of applying a truncated event tail when the authority reports a version gap', async () => {
    const applied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(applied));
    let snapshotCalls = 0;
    let eventCalls = 0;
    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) {
        snapshotCalls += 1;
        return Promise.resolve(jsonRes({
          snapshot: { op: snapshotCalls === 1 ? 'initial-seed' : 'repair-seed' },
          version: snapshotCalls === 1 ? 3 : 600,
        }));
      }
      eventCalls += 1;
      if (eventCalls === 1) {
        return Promise.resolve(jsonRes({
          version: 600,
          gap: true,
          events: [{ version: 89, channel: 'fake', change: { op: 'must-not-apply' } }],
        }));
      }
      setServed(false);
      return Promise.resolve(jsonRes({ version: 600, gap: false, events: [] }));
    });

    await ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(snapshotCalls).toBe(2));
    await vi.waitFor(() => expect(eventCalls).toBeGreaterThanOrEqual(2));

    expect(applied).toEqual([{ op: 'initial-seed' }, { op: 'repair-seed' }]);
    expect(fetchMock.mock.calls.some(([path]) => path === '/project/events?since=600')).toBe(true);
  });

  it('ignores a foreign-channel event even if a malformed relay includes it in the batch', async () => {
    const applied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(applied));
    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) return Promise.resolve(jsonRes({ snapshot: { op: 'seed' }, version: 1 }));
      setServed(false);
      return Promise.resolve(jsonRes({
        version: 2,
        events: [{ version: 2, channel: 'paper', change: { op: 'foreign' } }],
      }));
    });

    await ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.includes('/events'))).toBe(true));
    expect(applied).toEqual([{ op: 'seed' }]);
  });

  it('buffers a channel event that arrives while that channel snapshot is still in flight', async () => {
    const firstApplied: unknown[] = [];
    const slowApplied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(firstApplied));
    registerProjectSyncChannel({
      ...fakeChannel(slowApplied),
      id: 'slow',
    });
    let resolveEvents!: (response: unknown) => void;
    let resolveSlowSeed!: (response: unknown) => void;
    fetchMock.mockImplementation((path: string) => {
      if (path === '/project/fake/snapshot') {
        return Promise.resolve(jsonRes({ snapshot: { op: 'first-seed' }, version: 1 }));
      }
      if (path === '/project/slow/snapshot') {
        return new Promise((resolve) => { resolveSlowSeed = resolve; });
      }
      if (path === '/project/events?since=1') {
        return new Promise((resolve) => { resolveEvents = resolve; });
      }
      return Promise.resolve(jsonRes({ version: 2, events: [] }));
    });

    await ensureProjectSyncChannelStarted('fake');
    const slowStart = ensureProjectSyncChannelStarted('slow');
    await vi.waitFor(() => expect(resolveEvents).toBeTypeOf('function'));
    await vi.waitFor(() => expect(resolveSlowSeed).toBeTypeOf('function'));
    resolveEvents(jsonRes({
      version: 2,
      events: [{ version: 2, channel: 'slow', change: { op: 'live-during-seed' } }],
    }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/project/events?since=2')).toBe(true));
    setServed(false);
    resolveSlowSeed(jsonRes({ snapshot: { op: 'slow-seed' }, version: 1 }));
    await slowStart;

    expect(slowApplied).toEqual([{ op: 'slow-seed' }, { op: 'live-during-seed' }]);
  });

  it('releases a channel after a seed apply throws so a later start can retry cleanly', async () => {
    const applied: unknown[] = [];
    let shouldThrow = true;
    registerProjectSyncChannel({
      ...fakeChannel(applied),
      applyRemote(change) {
        if (shouldThrow) {
          shouldThrow = false;
          throw new Error('bad seed');
        }
        applied.push(change);
        return true;
      },
    });
    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) return Promise.resolve(jsonRes({ snapshot: { op: 'seed' }, version: 1 }));
      setServed(false);
      return Promise.resolve(jsonRes({ version: 1, events: [] }));
    });

    await ensureProjectSyncChannelStarted('fake');
    await ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(applied).toEqual([{ op: 'seed' }]));
    expect(fetchMock.mock.calls.filter(([path]) => path.includes('/snapshot'))).toHaveLength(2);
  });

  it('repairs from a seed when applying a tailed event throws and keeps the subscriber alive', async () => {
    const applied: unknown[] = [];
    let snapshots = 0;
    let eventPolls = 0;
    registerProjectSyncChannel({
      ...fakeChannel(applied),
      applyRemote(change) {
        if ((change as { op?: string }).op === 'bad-live') throw new Error('rejected event');
        applied.push(change);
        return true;
      },
    });
    fetchMock.mockImplementation((path: string) => {
      if (path.includes('/snapshot')) {
        snapshots += 1;
        return Promise.resolve(jsonRes({
          snapshot: { op: snapshots === 1 ? 'initial-seed' : 'repair-seed' },
          version: snapshots === 1 ? 1 : 3,
        }));
      }
      eventPolls += 1;
      if (eventPolls === 1) {
        return Promise.resolve(jsonRes({
          version: 2,
          events: [{ version: 2, channel: 'fake', change: { op: 'bad-live' } }],
        }));
      }
      setServed(false);
      return Promise.resolve(jsonRes({ version: 3, events: [] }));
    });

    await ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(snapshots).toBe(2));
    await vi.waitFor(() => expect(eventPolls).toBeGreaterThanOrEqual(2));
    expect(applied).toEqual([{ op: 'initial-seed' }, { op: 'repair-seed' }]);
  });

  it('does nothing off a served session', async () => {
    setServed(false);
    registerProjectSyncChannel(fakeChannel([]));
    await ensureProjectSyncChannelStarted('fake');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards a delayed seed from a phone session that has already been replaced', async () => {
    const applied: unknown[] = [];
    registerProjectSyncChannel(fakeChannel(applied));
    let resolveSeed!: (response: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveSeed = resolve; }));

    const starting = ensureProjectSyncChannelStarted('fake');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    h.epoch.value += 1;
    resolveSeed(jsonRes({ snapshot: { op: 'stale-phone-seed' }, version: 1 }));
    await starting;

    expect(applied).toEqual([]);
  });

  it('publishes a local op without a client-asserted device id', async () => {
    expect(h.publisher.current).toBeTypeOf('function');
    fetchMock.mockResolvedValue(jsonRes({ ok: true }));

    await expect(h.publisher.current?.('fake', { op: 'push' })).resolves.toBe(true);

    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toMatch(/^\/project\/fake\/mutate\?mutation=[A-Za-z0-9._%:-]+$/);
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ op: 'push' }),
      timeoutMs: 15_000,
    }));
  });

  it('reports a rejected mutation and does not publish off a served session', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false }) });
    await expect(h.publisher.current?.('fake', { op: 'rejected' })).resolves.toBe(false);

    fetchMock.mockReset();
    setServed(false);
    await expect(h.publisher.current?.('fake', { op: 'push' })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serializes same-channel mutations so later Flow operations cannot overtake earlier ones', async () => {
    let resolveFirst!: (response: unknown) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));

    const first = h.publisher.current?.('flow', { op: 1 });
    const second = h.publisher.current?.('flow', { op: 2 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFirst(jsonRes({ ok: true }));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ op: 1 }),
      JSON.stringify({ op: 2 }),
    ]);
  });

  it('does not send a queued mutation to a replacement phone session', async () => {
    let resolveFirst!: (response: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const first = h.publisher.current?.('flow', { op: 'phone-a-1' });
    const staleQueued = h.publisher.current?.('flow', { op: 'phone-a-2' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    h.epoch.value += 1;
    resolveFirst(jsonRes({ ok: true }));

    await expect(first).resolves.toBe(true);
    await expect(staleQueued).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent mutation after a transient transport failure', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error('wifi dropped'))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const published = h.publisher.current?.('video', { op: 'retry' });
    await vi.advanceTimersByTimeAsync(250);
    await expect(published).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestPaths = fetchMock.mock.calls.map(([path]) => path);
    expect(requestPaths[0]).toBe(requestPaths[1]); // the idempotency key is stable across retries
  });
});
