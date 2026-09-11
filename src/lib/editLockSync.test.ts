import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the edit-baton policy/transport layer (#56): the `edit-lock` channel contract the relay and
 * served clients depend on, and the device-dispatching facade. The pure state machine + the relay switch
 * are covered elsewhere (projectEditLock.test); here we drive the *real* state machine, store, and sync
 * log through `editLockSync`, with only the LAN seams (availability / served-fetch) mocked.
 */

// Hoisted so the vi.mock factories can close over this shared, mutable state without a TDZ error.
const h = vi.hoisted(() => ({
  androidAvailable: { value: false },
  served: { value: false },
  device: { value: { id: 'desktop-1', label: 'Desktop browser' } },
  remoteHostFetch: vi.fn(),
  ensureStarted: vi.fn(async (_channel: string) => undefined),
}));

vi.mock('./androidLanServer', () => ({
  isAndroidLanServerAvailable: () => h.androidAvailable.value,
}));
vi.mock('./remoteHostClient', () => ({
  isServedLanSession: () => h.served.value,
  remoteHostFetch: (path: string, init?: unknown) => h.remoteHostFetch(path, init),
}));
vi.mock('./projectSyncClient', () => ({
  ensureProjectSyncChannelStarted: (channel: string) => h.ensureStarted(channel),
}));
vi.mock('./deviceIdentity', () => ({
  getLocalDevice: () => h.device.value,
}));

import { useEditLockStore } from '../store/editLockStore';
import {
  EDIT_LOCK_CHANNEL,
  EDIT_LOCK_HOST_DEVICE_ID,
  getEditLockState,
  resetEditLock,
  type EditLockState,
} from './projectEditLock';
import { clearProjectSyncChannels, getProjectSyncChannel, getProjectSyncVersion, resetProjectSyncLog } from './projectSyncService';
import {
  __resetEditLockSyncForTests,
  forceTakeEditBaton,
  initializeEditLockSync,
  releaseEditBaton,
  takeEditBaton,
  yieldEditBaton,
} from './editLockSync';

const PHONE = { id: EDIT_LOCK_HOST_DEVICE_ID, label: 'Phone' };

beforeEach(() => {
  h.androidAvailable.value = false;
  h.served.value = false;
  h.device.value = { id: 'desktop-1', label: 'Desktop browser' };
  h.remoteHostFetch.mockReset();
  h.ensureStarted.mockReset();
  resetEditLock();
  resetProjectSyncLog();
  clearProjectSyncChannels();
  useEditLockStore.getState().setLock(null);
  __resetEditLockSyncForTests();
});

afterEach(() => {
  __resetEditLockSyncForTests();
});

describe('editLockSync — channel contract', () => {
  it('registers the edit-lock channel whose snapshot is the authoritative baton', () => {
    h.androidAvailable.value = true;
    initializeEditLockSync();

    const channel = getProjectSyncChannel(EDIT_LOCK_CHANNEL);
    expect(channel).toBeTruthy();
    expect(channel!.snapshot()).toEqual(getEditLockState());
  });

  it('applyRemote mirrors the authority broadcast into the client store', () => {
    h.served.value = true;
    initializeEditLockSync();

    const channel = getProjectSyncChannel(EDIT_LOCK_CHANNEL)!;
    const broadcast: EditLockState = {
      holder: PHONE,
      pending: null,
      heldSince: 1,
      expiresAt: 2,
      pendingExpiresAt: 0,
      revision: 7,
    };
    channel.applyRemote(broadcast);

    expect(useEditLockStore.getState().lock).toEqual(broadcast);
  });

  it('seeds the served channel subscriber on init', () => {
    h.served.value = true;
    initializeEditLockSync();
    expect(h.ensureStarted).toHaveBeenCalledWith(EDIT_LOCK_CHANNEL);
  });
});

describe('editLockSync — phone authority facade', () => {
  beforeEach(() => {
    h.androidAvailable.value = true;
    h.device.value = PHONE;
    initializeEditLockSync();
  });

  it('takeEditBaton claims directly, mirrors the store, and records to the sync log', () => {
    const before = getProjectSyncVersion();
    return takeEditBaton().then(() => {
      const lock = useEditLockStore.getState().lock;
      expect(lock?.holder?.id).toBe(EDIT_LOCK_HOST_DEVICE_ID);
      expect(getProjectSyncVersion()).toBeGreaterThan(before);
      // The phone never round-trips through the served-fetch transport.
      expect(h.remoteHostFetch).not.toHaveBeenCalled();
    });
  });

  it('releaseEditBaton frees the baton it holds', async () => {
    await takeEditBaton();
    await releaseEditBaton();
    expect(useEditLockStore.getState().lock?.holder).toBeNull();
  });
});

describe('editLockSync — served client facade', () => {
  function respondWith(state: EditLockState | null) {
    h.remoteHostFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state }),
    });
  }

  beforeEach(() => {
    h.served.value = true;
    h.device.value = { id: 'desktop-1', label: 'Desktop browser' };
    initializeEditLockSync();
  });

  it('takeEditBaton POSTs /lock/claim with this device and applies the returned state', async () => {
    const granted: EditLockState = {
      holder: { id: 'desktop-1', label: 'Desktop browser' },
      pending: null,
      heldSince: 10,
      expiresAt: 40,
      pendingExpiresAt: 0,
      revision: 3,
    };
    respondWith(granted);

    await takeEditBaton();

    expect(h.remoteHostFetch).toHaveBeenCalledTimes(1);
    const [path, init] = h.remoteHostFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe('/lock/claim');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ device: { id: 'desktop-1', label: 'Desktop browser' } });
    expect(useEditLockStore.getState().lock).toEqual(granted);
  });

  it('forceTakeEditBaton hits the /lock/force endpoint', async () => {
    respondWith({
      holder: { id: 'desktop-1', label: 'Desktop browser' },
      pending: null,
      heldSince: 0,
      expiresAt: 0,
      pendingExpiresAt: 0,
      revision: 1,
    });
    await forceTakeEditBaton();
    expect(h.remoteHostFetch.mock.calls[0][0]).toBe('/lock/force');
  });

  it('yieldEditBaton hits the /lock/yield endpoint', async () => {
    respondWith({
      holder: null,
      pending: null,
      heldSince: 0,
      expiresAt: 0,
      pendingExpiresAt: 0,
      revision: 2,
    });
    await yieldEditBaton();
    expect(h.remoteHostFetch.mock.calls[0][0]).toBe('/lock/yield');
  });

  it('a failed lock fetch leaves the store untouched', async () => {
    h.remoteHostFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await takeEditBaton();
    expect(useEditLockStore.getState().lock).toBeNull();
  });
});
