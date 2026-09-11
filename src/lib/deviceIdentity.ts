import { isAndroidLanServerAvailable } from './androidLanServer';
import { EDIT_LOCK_HOST_DEVICE_ID, type EditLockDevice } from './projectEditLock';

/**
 * Stable per-device identity for the cross-device edit baton (memory: cross-device-sync-baton-model).
 * The baton recognises a device across reloads by this id; the label is what the *other* device shows
 * in its "Editing on …" banner.
 *
 *  - The **phone host** edits under the reserved {@link EDIT_LOCK_HOST_DEVICE_ID}, so its own UI and any
 *    served client always have distinct identities even before the client has persisted one.
 *  - A **served desktop browser** / **installed desktop app** gets a random id persisted in localStorage.
 */

const DEVICE_ID_STORAGE_KEY = 'signal-loom-device-id';
const DEVICE_PAIRING_PROOF_STORAGE_KEY = 'signal-loom-device-pairing-proof';

let cachedId: string | null = null;
let cachedPairingProof: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the time+random fallback
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable id for THIS device. The phone uses the reserved host id; clients persist a random one. */
export function getLocalDeviceId(): string {
  if (cachedId) return cachedId;
  if (isAndroidLanServerAvailable()) {
    cachedId = EDIT_LOCK_HOST_DEVICE_ID;
    return cachedId;
  }
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
    const fresh = randomId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
    cachedId = fresh;
    return fresh;
  } catch {
    // storage unavailable — an in-memory id still works for this session
    cachedId = randomId();
    return cachedId;
  }
}

/**
 * Browser-held proof used only during PIN pairing. The Android host never sends this value: it owns
 * the reserved host identity locally. The phone server records the proof once and later derives the
 * device from the bearer token rather than trusting an operation's actor id or URL query.
 */
export function getLocalDevicePairingBinding(): { deviceId: string; deviceProof: string } {
  const deviceId = getLocalDeviceId();
  if (isAndroidLanServerAvailable()) return { deviceId, deviceProof: '' };
  if (cachedPairingProof) return { deviceId, deviceProof: cachedPairingProof };
  try {
    const stored = window.localStorage.getItem(DEVICE_PAIRING_PROOF_STORAGE_KEY);
    if (stored) {
      cachedPairingProof = stored;
      return { deviceId, deviceProof: stored };
    }
    const fresh = randomId();
    window.localStorage.setItem(DEVICE_PAIRING_PROOF_STORAGE_KEY, fresh);
    cachedPairingProof = fresh;
    return { deviceId, deviceProof: fresh };
  } catch {
    cachedPairingProof = randomId();
    return { deviceId, deviceProof: cachedPairingProof };
  }
}

/**
 * A lost browser proof cannot reclaim an existing principal. Rotate to a fresh identity and pair
 * again; old bearer sessions remain bound to their original device server-side.
 */
export function rotateLocalDevicePairingBinding(): { deviceId: string; deviceProof: string } {
  if (isAndroidLanServerAvailable()) return getLocalDevicePairingBinding();
  const deviceId = randomId();
  const deviceProof = randomId();
  cachedId = deviceId;
  cachedPairingProof = deviceProof;
  try {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    window.localStorage.setItem(DEVICE_PAIRING_PROOF_STORAGE_KEY, deviceProof);
  } catch {
    // The in-memory rotated identity still cannot impersonate the previous registered identity.
  }
  return { deviceId, deviceProof };
}

function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.signalLoomNative);
}

/** Human label the other device shows for this one in the baton/read-only UI. */
export function getLocalDeviceLabel(): string {
  if (isAndroidLanServerAvailable()) return 'Phone';
  if (isElectronRuntime()) return 'Desktop app';
  return 'Desktop browser';
}

/** This device's identity for the edit baton. */
export function getLocalDevice(): EditLockDevice {
  return { id: getLocalDeviceId(), label: getLocalDeviceLabel() };
}
