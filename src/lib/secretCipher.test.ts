import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  getSecretEncryptionMedium,
  isEncryptedSecretEnvelope,
  isSecretEncryptionActive,
} from './secretCipher';

// The real AES-GCM / safeStorage round-trips are exercised against a browser + Electron (they need
// WebCrypto+IndexedDB / the OS keychain). Here we lock the pure logic and the safe degradation path.
describe('secretCipher', () => {
  it('detects encrypted envelopes vs legacy plaintext', () => {
    expect(isEncryptedSecretEnvelope('sl-web1:abc')).toBe(true);
    expect(isEncryptedSecretEnvelope('sl-safe1:abc')).toBe(true);
    expect(isEncryptedSecretEnvelope('{"apiKeys":{}}')).toBe(false);
    expect(isEncryptedSecretEnvelope('')).toBe(false);
  });

  it('degrades to a plaintext passthrough when no crypto backend is available (node runner)', async () => {
    // No WebCrypto+IndexedDB and no Electron bridge in the test runner.
    expect(getSecretEncryptionMedium()).toBe('none');
    expect(isSecretEncryptionActive()).toBe(false);
    const plaintext = '{"apiKeys":{"openai":"sk-x"}}';
    expect(await encryptSecret(plaintext)).toBe(plaintext);
    expect(await decryptSecret('not-an-envelope')).toBeNull();
  });
});
