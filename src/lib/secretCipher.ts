import { getSignalLoomNativeBridge } from './nativeApp';

/**
 * At-rest encryption for the locally persisted settings blob (which holds the bring-your-own-key API
 * tokens). Device-bound, no master password:
 *
 *  - Electron desktop: the OS keychain via `safeStorage` (DPAPI / macOS Keychain / libsecret-kwallet),
 *    called over IPC. Strongest — decryption is bound to the OS user account.
 *  - Web + Android WebView: WebCrypto AES-GCM with a NON-extractable AES key kept in IndexedDB. JS can
 *    never read the raw key bytes, and the localStorage value becomes opaque ciphertext, so copying the
 *    browser profile / app-data no longer leaks the keys.
 *  - Last resort (no crypto at all, e.g. a non-DOM test runner): plaintext passthrough.
 *
 * Values carry a short version tag so `decryptSecret` routes to the right backend and legacy plaintext
 * is detected for one-time migration.
 */

const SAFE_PREFIX = 'sl-safe1:'; // Electron safeStorage; base64(ciphertext) follows
const WEB_PREFIX = 'sl-web1:'; // WebCrypto AES-GCM; base64(iv ‖ ciphertext) follows
const KEY_DB_NAME = 'signal-loom-secrets';
const KEY_STORE_NAME = 'keys';
const KEY_ID = 'settings-key-v1';
const AES_IV_BYTES = 12;

export type SecretStorageMedium = 'os-keychain' | 'webcrypto' | 'none';

/** True when a stored value is one of our encrypted envelopes (vs legacy plaintext). */
export function isEncryptedSecretEnvelope(value: string): boolean {
  return value.startsWith(SAFE_PREFIX) || value.startsWith(WEB_PREFIX);
}

function hasWebCrypto(): boolean {
  try {
    return typeof globalThis.crypto?.subtle?.encrypt === 'function'
      && typeof globalThis.indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

// Medium detection: WebCrypto availability is synchronous; the keychain check is an async IPC round
// trip, so we start with the WebCrypto floor and upgrade to 'os-keychain' once the bridge confirms.
let cachedMedium: SecretStorageMedium = hasWebCrypto() ? 'webcrypto' : 'none';
let electronChecked = false;

async function refreshKeychainMedium(): Promise<void> {
  if (electronChecked) return;
  electronChecked = true;
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.secretAvailable) return;
  try {
    if (await bridge.secretAvailable()) cachedMedium = 'os-keychain';
  } catch {
    // keep the WebCrypto floor
  }
}
void refreshKeychainMedium();

/** Best-known encryption medium (cached; upgrades to 'os-keychain' shortly after launch on desktop). */
export function getSecretEncryptionMedium(): SecretStorageMedium {
  return cachedMedium;
}

/** Whether persisted secrets are encrypted at rest in this runtime. */
export function isSecretEncryptionActive(): boolean {
  return cachedMedium !== 'none';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE_NAME)) {
        request.result.createObjectStore(KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

let webKeyPromise: Promise<CryptoKey> | null = null;
async function getWebKey(): Promise<CryptoKey> {
  if (!webKeyPromise) {
    webKeyPromise = (async () => {
      const db = await openKeyDb();
      try {
        const existing = await idbRequest(
          db.transaction(KEY_STORE_NAME, 'readonly').objectStore(KEY_STORE_NAME).get(KEY_ID),
        );
        if (existing) return existing as CryptoKey;
        // extractable=false: the raw key can never be exported by JS, only used to en/decrypt.
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const writeTx = db.transaction(KEY_STORE_NAME, 'readwrite');
        await idbRequest(writeTx.objectStore(KEY_STORE_NAME).put(key, KEY_ID));
        return key;
      } finally {
        db.close();
      }
    })().catch((error) => {
      webKeyPromise = null; // allow a retry on the next call
      throw error;
    });
  }
  return webKeyPromise;
}

async function webEncrypt(plaintext: string): Promise<string> {
  const key = await getWebKey();
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return WEB_PREFIX + bytesToBase64(packed);
}

async function webDecrypt(envelope: string): Promise<string | null> {
  try {
    const key = await getWebKey();
    const packed = base64ToBytes(envelope.slice(WEB_PREFIX.length));
    // Copy into fresh ArrayBuffer-backed views (subarray widens to ArrayBufferLike, which the
    // stricter BufferSource typing rejects).
    const iv = new Uint8Array(AES_IV_BYTES);
    iv.set(packed.subarray(0, AES_IV_BYTES));
    const ciphertext = new Uint8Array(Math.max(0, packed.length - AES_IV_BYTES));
    ciphertext.set(packed.subarray(AES_IV_BYTES));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/** Encrypt a string for at-rest storage, tagged so it can be routed back on read. */
export async function encryptSecret(plaintext: string): Promise<string> {
  await refreshKeychainMedium();
  if (cachedMedium === 'os-keychain') {
    const bridge = getSignalLoomNativeBridge();
    try {
      const encoded = await bridge?.secretEncrypt?.(plaintext);
      if (typeof encoded === 'string' && encoded) return SAFE_PREFIX + encoded;
    } catch {
      // fall through to WebCrypto
    }
  }
  if (hasWebCrypto()) {
    try {
      return await webEncrypt(plaintext);
    } catch {
      // fall through to plaintext
    }
  }
  return plaintext; // no cipher available — store as-is (best we can do)
}

/** Decrypt a stored value. Returns null when the envelope can't be decrypted (e.g. moved machine). */
export async function decryptSecret(envelope: string): Promise<string | null> {
  if (envelope.startsWith(SAFE_PREFIX)) {
    const bridge = getSignalLoomNativeBridge();
    try {
      const plaintext = await bridge?.secretDecrypt?.(envelope.slice(SAFE_PREFIX.length));
      return typeof plaintext === 'string' ? plaintext : null;
    } catch {
      return null;
    }
  }
  if (envelope.startsWith(WEB_PREFIX)) return webDecrypt(envelope);
  return null;
}
