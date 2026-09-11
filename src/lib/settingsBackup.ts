/**
 * Portable, passphrase-encrypted settings backup.
 *
 * This is the opt-in "export / import my keys & credentials" feature — a safety net the user can keep
 * off-device in case the app's local data is lost (reinstall, profile wipe, moving to a new machine).
 *
 * It deliberately does NOT reuse the at-rest cipher in `secretCipher.ts`: that one is *device-bound*
 * (OS keychain / a non-extractable WebCrypto key in IndexedDB), so its envelopes can only be decrypted
 * on the same machine — useless for a backup whose whole point is surviving the loss of that machine.
 * Instead the backup is sealed with a key derived from a user passphrase (PBKDF2 → AES-GCM), so it can
 * be restored anywhere the user re-enters that passphrase. The plaintext keys never leave the device
 * except inside this encrypted blob, and only when the user explicitly exports it.
 */

export const SETTINGS_BACKUP_FORMAT = 'signal-loom-settings-backup';
export const SETTINGS_BACKUP_VERSION = 1;

// PBKDF2 work factor. A balance between brute-force resistance and not freezing a phone WebView for
// seconds on every import. Stored in the envelope so future exports can raise it without breaking old
// backups.
const PBKDF2_ITERATIONS = 250_000;
const PBKDF2_HASH = 'SHA-256';
const AES_IV_BYTES = 12;
const PBKDF2_SALT_BYTES = 16;

export type SettingsBackupErrorCode =
  | 'unsupported' // no WebCrypto in this runtime
  | 'weak-passphrase' // empty / whitespace passphrase
  | 'invalid-format' // not a Sloom Studio settings backup
  | 'unsupported-version' // newer backup than this build understands
  | 'decrypt-failed'; // wrong passphrase or corrupted blob

export class SettingsBackupError extends Error {
  readonly code: SettingsBackupErrorCode;
  constructor(code: SettingsBackupErrorCode, message: string) {
    super(message);
    this.name = 'SettingsBackupError';
    this.code = code;
  }
}

export interface SettingsBackupEnvelope {
  format: typeof SETTINGS_BACKUP_FORMAT;
  version: number;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: typeof PBKDF2_HASH; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  ciphertext: string;
}

/** Whether the encrypted backup can be produced/read in this runtime (needs WebCrypto subtle). */
export function isSettingsBackupSupported(): boolean {
  try {
    return typeof globalThis.crypto?.subtle?.deriveKey === 'function'
      && typeof globalThis.crypto?.subtle?.encrypt === 'function';
  } catch {
    return false;
  }
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

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  // Copy the salt into a fresh ArrayBuffer-backed view so the stricter BufferSource typing accepts it.
  const saltBuffer = new Uint8Array(salt.length);
  saltBuffer.set(salt);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: PBKDF2_HASH, salt: saltBuffer, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Seal a plaintext string (the serialized settings) into a portable, passphrase-locked envelope. */
export async function encryptSettingsBackup(plaintext: string, passphrase: string): Promise<string> {
  if (!isSettingsBackupSupported()) {
    throw new SettingsBackupError('unsupported', 'Encrypted backups are not supported in this environment.');
  }
  if (!passphrase.trim()) {
    throw new SettingsBackupError('weak-passphrase', 'A passphrase is required to encrypt the backup.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const envelope: SettingsBackupEnvelope = {
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: PBKDF2_HASH, iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(ciphertext),
  };
  return JSON.stringify(envelope, null, 2);
}

/** Validate that a string is a well-formed Sloom Studio settings backup envelope. */
export function parseSettingsBackupEnvelope(text: string): SettingsBackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsBackupError('invalid-format', 'This file is not a Sloom Studio settings backup.');
  }
  if (
    typeof parsed !== 'object' || parsed === null
    || (parsed as { format?: unknown }).format !== SETTINGS_BACKUP_FORMAT
  ) {
    throw new SettingsBackupError('invalid-format', 'This file is not a Sloom Studio settings backup.');
  }
  const envelope = parsed as SettingsBackupEnvelope;
  if (typeof envelope.version !== 'number' || envelope.version > SETTINGS_BACKUP_VERSION) {
    throw new SettingsBackupError(
      'unsupported-version',
      'This backup was made by a newer version of Sloom Studio. Update the app, then import again.',
    );
  }
  if (
    !envelope.kdf || envelope.kdf.name !== 'PBKDF2' || typeof envelope.kdf.salt !== 'string'
    || typeof envelope.kdf.iterations !== 'number'
    || !envelope.cipher || envelope.cipher.name !== 'AES-GCM' || typeof envelope.cipher.iv !== 'string'
    || typeof envelope.ciphertext !== 'string'
  ) {
    throw new SettingsBackupError('invalid-format', 'This settings backup is missing required fields.');
  }
  return envelope;
}

/** Unseal an envelope with the passphrase, returning the original plaintext (the serialized settings). */
export async function decryptSettingsBackup(envelopeText: string, passphrase: string): Promise<string> {
  if (!isSettingsBackupSupported()) {
    throw new SettingsBackupError('unsupported', 'Encrypted backups are not supported in this environment.');
  }
  if (!passphrase.trim()) {
    throw new SettingsBackupError('weak-passphrase', 'Enter the passphrase used to create this backup.');
  }
  const envelope = parseSettingsBackupEnvelope(envelopeText);
  const salt = base64ToBytes(envelope.kdf.salt);
  const ivBytes = base64ToBytes(envelope.cipher.iv);
  const iv = new Uint8Array(ivBytes.length);
  iv.set(ivBytes);
  const ciphertextBytes = base64ToBytes(envelope.ciphertext);
  const ciphertext = new Uint8Array(ciphertextBytes.length);
  ciphertext.set(ciphertextBytes);
  try {
    const key = await deriveAesKey(passphrase, salt, envelope.kdf.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM auth-tag failure: almost always a wrong passphrase, occasionally a corrupted file.
    throw new SettingsBackupError('decrypt-failed', 'Could not decrypt the backup — check the passphrase.');
  }
}
