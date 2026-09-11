import { sha256 } from '@noble/hashes/sha2.js';

/**
 * SHA-256 for integrity and content identity in every renderer context.
 *
 * LAN-served browsers run on an ordinary HTTP origin, where Firefox and Chromium intentionally
 * withhold Web Crypto's `SubtleCrypto`. Integrity hashing is not secret-key cryptography and must
 * remain available there, so this uses the audited synchronous implementation already shipped for
 * project-container verification and the asset store.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
