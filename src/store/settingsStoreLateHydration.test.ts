import './test-setup-window';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AUD-015 residual — late hydration must never clobber a newer local mutation. The encrypted
 * settings storage reads + decrypts the persisted blob asynchronously, so a hydration that
 * started BEFORE a local license-identity mutation can still be holding the old blob when the
 * mutation lands. When that stale decrypt finally resolves, the persist merge must not restore
 * the superseded identity over the newer local one — and the persistence layer must converge on
 * the newer mutation, not on the stale snapshot.
 *
 * These tests drive the real store/persist boundary: decrypts and verifier calls are held open
 * with deferred promises so the interleavings are deterministic, never timer-based.
 */

const VALID_KEY = 'SLOOM-valid-test-key';
const ACTIVATED_KEY = 'SLOOM-activated-test-key';
const IMPORTED_KEY = 'SLOOM-imported-test-key';
const SETTINGS_STORAGE_KEY = 'flow-settings-storage';

interface DeferredVerification {
  key: string;
  resolve: (verdict: unknown) => void;
  reject: (error: unknown) => void;
}

const verifierControl = vi.hoisted(() => ({
  pending: [] as DeferredVerificationHoisted[],
  calls: [] as string[],
}));

// vi.hoisted runs before the type declarations above are usable at runtime; keep the hoisted
// shape structural so the mock factory can push into it.
interface DeferredVerificationHoisted {
  key: string;
  resolve: (verdict: unknown) => void;
  reject: (error: unknown) => void;
}

vi.mock('../lib/licenseKey', () => ({
  verifyLicenseKey: (key: string) =>
    new Promise((resolve, reject) => {
      verifierControl.calls.push(key);
      verifierControl.pending.push({ key, resolve, reject });
    }),
  describeLicenseEdition: () => 'Community edition',
}));

const cipherControl = vi.hoisted(() => ({
  pending: [] as Array<{
    envelope: string;
    resolve: (plain: string | null) => void;
    reject: (error: unknown) => void;
  }>,
}));

vi.mock('../lib/secretCipher', () => ({
  isEncryptedSecretEnvelope: (value: unknown): boolean =>
    typeof value === 'string' && value.startsWith('enc:'),
  decryptSecret: (envelope: string) => {
    // Per-key operation envelopes are independent durable facts; only hold the profile cache
    // whose delayed decrypt is the subject of this suite.
    if (envelope.startsWith('enc:{"clock"')) return Promise.resolve(envelope.slice('enc:'.length));
    return new Promise<string | null>((resolve, reject) => {
      cipherControl.pending.push({ envelope, resolve, reject });
    });
  },
  encryptSecret: async (plain: string) => `enc:${plain}`,
  isSecretEncryptionActive: () => true,
}));

vi.mock('../lib/settingsBackup', () => ({
  isSettingsBackupSupported: () => true,
  encryptSettingsBackup: async (plaintext: string) => plaintext,
  decryptSettingsBackup: async (envelopeText: string) => envelopeText,
  SettingsBackupError: class SettingsBackupError extends Error {
    kind: string;

    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  },
}));

function licensedVerdict(): unknown {
  return { licensed: true, email: 'buyer@example.com', edition: 'commercial' };
}

function legacyBackupWithLicense(licenseKey: string): string {
  return JSON.stringify({
    apiKeys: {},
    defaultModels: {},
    providerSettings: {},
    interfaceThemeId: 'default',
    keyboardShortcuts: {},
    gamepadBindings: {},
    customBrushPresets: [],
    customCropPresets: [],
    licenseKey,
  });
}

function seedPersistedSettings(state: Record<string, unknown>): void {
  // This helper models replacing the entire durable profile from outside the adapter. Reset its
  // ownership sidecars too; production adapter writes always stamp/advance all three together.
  window.localStorage.removeItem(`${SETTINGS_STORAGE_KEY}:write-version`);
  window.localStorage.removeItem(`${SETTINGS_STORAGE_KEY}:committed-write-version`);
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, `enc:${JSON.stringify({ state, version: 0 })}`);
}

/** Wait for at least one in-flight decrypt and take ownership of the oldest one. */
async function takePendingDecrypt(): Promise<{
  envelope: string;
  resolve: (plain: string | null) => void;
  reject: (error: unknown) => void;
}> {
  await vi.waitFor(() => {
    expect(cipherControl.pending.length).toBeGreaterThan(0);
  });
  return cipherControl.pending.splice(0, 1)[0];
}

/** Resolve every queued decryption with its own stored plaintext. */
function resolveDecrypt(entry: { envelope: string; resolve: (plain: string | null) => void }): void {
  entry.resolve(entry.envelope.slice('enc:'.length));
}

/** Wait for a deferred verification of `key` to appear and take ownership of it. */
async function takeVerification(key: string): Promise<DeferredVerification> {
  let taken: DeferredVerification | undefined;
  await vi.waitFor(() => {
    const index = verifierControl.pending.findIndex((entry) => entry.key === key);
    expect(index).toBeGreaterThanOrEqual(0);
    taken = verifierControl.pending.splice(index, 1)[0];
  });
  if (!taken) {
    throw new Error(`no pending verification for ${key}`);
  }
  return taken;
}

/** Drain queued microtask chains so settled async work finishes applying. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await Promise.resolve();
  }
}

/** Read the persisted state slice out of the encrypted storage envelope. */
function readPersistedState(): Record<string, unknown> {
  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  expect(raw).toBeTruthy();
  expect(raw!.startsWith('enc:')).toBe(true);
  return (JSON.parse(raw!.slice('enc:'.length)) as { state: Record<string, unknown> }).state;
}

type SettingsStoreModule = typeof import('./settingsStore');
type LicenseGatesModule = typeof import('../lib/licenseGates');

async function importFreshModules(): Promise<{
  settings: SettingsStoreModule;
  gates: LicenseGatesModule;
}> {
  const settings = await import('./settingsStore');
  const gates = await import('../lib/licenseGates');
  return { settings, gates };
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  cipherControl.pending.length = 0;
  verifierControl.pending.length = 0;
  verifierControl.calls.length = 0;
});

describe('late hydration versus local mutation (AUD-015 residual)', () => {
  it('a late hydration never restores a locally removed license key', async () => {
    seedPersistedSettings({ licenseKey: VALID_KEY });
    const { settings, gates } = await importFreshModules();
    const { useSettingsStore } = settings;

    // The initial hydration has read the old blob; its decrypt is deliberately still pending.
    const staleDecrypt = await takePendingDecrypt();

    // The user removes the key while the old snapshot is in flight: fail closed immediately.
    useSettingsStore.getState().removeLicenseKey();
    expect(useSettingsStore.getState().licenseKey).toBe('');
    expect(useSettingsStore.getState().license.licensed).toBe(false);
    expect(gates.isCommercialExportUnlocked()).toBe(false);

    // The stale decrypt lands now; the late merge must not resurrect the removed identity.
    resolveDecrypt(staleDecrypt);
    await settings.waitForSettingsHydration();
    await settle();

    expect(useSettingsStore.getState().settingsHydrated).toBe(true);
    expect(useSettingsStore.getState().licenseKey).toBe('');
    expect(useSettingsStore.getState().license.licensed).toBe(false);
    expect(gates.isCommercialExportUnlocked()).toBe(false);

    // Bounded verifier work: nothing may (re-)verify the removed key after the removal.
    expect(verifierControl.calls).toEqual([]);
    expect(verifierControl.pending).toEqual([]);

    // Persistence converges on the newer removal, not on the stale snapshot.
    await vi.waitFor(() => {
      expect(readPersistedState().licenseKey).toBe('');
    });
  });

  it('a local activation during an in-flight hydration is never clobbered by the stale blob', async () => {
    seedPersistedSettings({ licenseKey: VALID_KEY });
    const { settings, gates } = await importFreshModules();
    const { useSettingsStore } = settings;

    const staleDecrypt = await takePendingDecrypt();

    // The user activates a new key while the old snapshot's decrypt is still pending.
    const activation = useSettingsStore.getState().setLicenseKey(ACTIVATED_KEY);
    (await takeVerification(ACTIVATED_KEY)).resolve(licensedVerdict());
    await activation;
    expect(useSettingsStore.getState().licenseKey).toBe(ACTIVATED_KEY);
    expect(useSettingsStore.getState().license.licensed).toBe(true);

    // The stale snapshot lands: it must neither restore the old key nor drop the activation.
    resolveDecrypt(staleDecrypt);
    await settings.waitForSettingsHydration();

    // Transition window: the kept key is canonically re-verified, and the gates stay locked
    // until that verification grants the entitlement again.
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().license.licensed).toBe(false);
    });
    expect(useSettingsStore.getState().licenseKey).toBe(ACTIVATED_KEY);
    expect(gates.isCommercialExportUnlocked()).toBe(false);

    (await takeVerification(ACTIVATED_KEY)).resolve(licensedVerdict());
    await settle();

    expect(useSettingsStore.getState().licenseKey).toBe(ACTIVATED_KEY);
    expect(useSettingsStore.getState().license.licensed).toBe(true);
    expect(gates.isCommercialExportUnlocked()).toBe(true);

    // Bounded verifier work: the kept key verifies at most twice (direct activation plus the
    // one canonical post-rehydrate re-verification); the superseded key is never verified.
    expect(verifierControl.calls.filter((key) => key === VALID_KEY)).toEqual([]);
    expect(
      verifierControl.calls.filter((key) => key === ACTIVATED_KEY).length,
    ).toBeLessThanOrEqual(2);
    expect(verifierControl.pending).toEqual([]);

    // Persistence converges on the activation.
    await vi.waitFor(() => {
      expect(readPersistedState().licenseKey).toBe(ACTIVATED_KEY);
    });
  });

  it('a backup import during an in-flight hydration keeps the imported identity', async () => {
    seedPersistedSettings({ licenseKey: VALID_KEY });
    const { settings } = await importFreshModules();
    const { useSettingsStore } = settings;

    const staleDecrypt = await takePendingDecrypt();

    let importSettled = false;
    const importPromise = useSettingsStore
      .getState()
      .importSettingsBackup(legacyBackupWithLicense(IMPORTED_KEY), 'passphrase')
      .then(() => {
        importSettled = true;
      });

    // The import applies fail-closed; its canonical verification sequences after hydration.
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().licenseKey).toBe(IMPORTED_KEY);
    });
    expect(useSettingsStore.getState().license.licensed).toBe(false);

    // The stale snapshot lands: the imported identity is the newer fact and must survive.
    resolveDecrypt(staleDecrypt);
    await settle();
    expect(useSettingsStore.getState().licenseKey).toBe(IMPORTED_KEY);

    const importedVerification = await takeVerification(IMPORTED_KEY);
    expect(importSettled).toBe(false);
    importedVerification.resolve(licensedVerdict());
    await importPromise;

    expect(useSettingsStore.getState().licenseKey).toBe(IMPORTED_KEY);
    expect(useSettingsStore.getState().license.licensed).toBe(true);
    expect(verifierControl.calls.filter((key) => key === VALID_KEY)).toEqual([]);
    expect(verifierControl.pending).toEqual([]);

    await vi.waitFor(() => {
      expect(readPersistedState().licenseKey).toBe(IMPORTED_KEY);
    });
  });

  it('a newer rehydrate does not revive a local removal', async () => {
    seedPersistedSettings({ licenseKey: VALID_KEY });
    const { settings, gates } = await importFreshModules();
    const { useSettingsStore } = settings;
    resolveDecrypt(await takePendingDecrypt());
    await settings.waitForSettingsHydration();
    useSettingsStore.getState().removeLicenseKey();
    const first = useSettingsStore.persist.rehydrate();
    resolveDecrypt(await takePendingDecrypt());
    await first;
    expect(useSettingsStore.getState().licenseKey).toBe('');
    expect(useSettingsStore.getState().license.licensed).toBe(false);
    expect(gates.isCommercialExportUnlocked()).toBe(false);
  });

  it('a failed read leaves a later local API-key operation durable', async () => {
    seedPersistedSettings({ apiKeys: { openai: 'sk-unreadable-old-key' } });
    const { settings } = await importFreshModules();
    const { useSettingsStore } = settings;

    // A storage/decryption failure must not leave the failed read armed indefinitely.
    (await takePendingDecrypt()).reject(new Error('storage temporarily unavailable'));
    await settings.waitForSettingsHydration();
    expect(useSettingsStore.getState().apiKeys.openai).toBe('');

    useSettingsStore.getState().setApiKey('openai', 'sk-local-after-failure');
    await vi.waitFor(() => {
      expect(readPersistedState().apiKeys).toMatchObject({ openai: 'sk-local-after-failure' });
    });

    // A raw compatibility cache is not an authority over per-key operation records.
    seedPersistedSettings({ apiKeys: { openai: '' } });
    const recovery = useSettingsStore.persist.rehydrate();
    resolveDecrypt(await takePendingDecrypt());
    await recovery;

    expect(useSettingsStore.getState().apiKeys.openai).toBe('sk-local-after-failure');
  });

  it('fails closed in memory when durable storage is unavailable, without poisoning later reads', async () => {
    const storage = window.localStorage;
    const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      const { settings, gates } = await importFreshModules();
      await settings.waitForSettingsHydration();

      settings.useSettingsStore.getState().setApiKey('openai', 'sk-memory-only');
      settings.useSettingsStore.getState().removeLicenseKey();
      await settle();

      expect(settings.useSettingsStore.getState().apiKeys.openai).toBe('sk-memory-only');
      expect(settings.useSettingsStore.getState().license.licensed).toBe(false);
      expect(gates.isCommercialExportUnlocked()).toBe(false);
    } finally {
      storageGetter.mockRestore();
    }

    // No fallback write may appear as plaintext after the backing store comes back.
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(`${SETTINGS_STORAGE_KEY}:write-version`)).toBeNull();
  });
});
