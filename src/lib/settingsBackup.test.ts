import { describe, expect, it } from 'vitest';
import {
  decryptSettingsBackup,
  encryptSettingsBackup,
  isSettingsBackupSupported,
  parseSettingsBackupEnvelope,
  SETTINGS_BACKUP_FORMAT,
  SETTINGS_BACKUP_VERSION,
  SettingsBackupError,
} from './settingsBackup';

const PAYLOAD = JSON.stringify({ apiKeys: { openai: 'sk-secret-123', atlas: 'atlas-tok' }, theme: 'midnight' });
const PASSPHRASE = 'correct horse battery staple';

describe('settingsBackup', () => {
  it('is supported in this runtime (WebCrypto present)', () => {
    expect(isSettingsBackupSupported()).toBe(true);
  });

  it('round-trips a payload through encrypt → decrypt with the right passphrase', async () => {
    const blob = await encryptSettingsBackup(PAYLOAD, PASSPHRASE);
    const restored = await decryptSettingsBackup(blob, PASSPHRASE);
    expect(restored).toBe(PAYLOAD);
  });

  it('produces a versioned, self-describing envelope and never leaks plaintext', async () => {
    const blob = await encryptSettingsBackup(PAYLOAD, PASSPHRASE);
    const envelope = parseSettingsBackupEnvelope(blob);
    expect(envelope.format).toBe(SETTINGS_BACKUP_FORMAT);
    expect(envelope.version).toBe(SETTINGS_BACKUP_VERSION);
    expect(envelope.kdf.name).toBe('PBKDF2');
    expect(envelope.cipher.name).toBe('AES-GCM');
    expect(blob).not.toContain('sk-secret-123');
    expect(blob).not.toContain('atlas-tok');
  });

  it('uses a fresh salt + IV per export, so two backups of the same data differ', async () => {
    const a = await encryptSettingsBackup(PAYLOAD, PASSPHRASE);
    const b = await encryptSettingsBackup(PAYLOAD, PASSPHRASE);
    expect(a).not.toBe(b);
    expect(parseSettingsBackupEnvelope(a).kdf.salt).not.toBe(parseSettingsBackupEnvelope(b).kdf.salt);
    expect(parseSettingsBackupEnvelope(a).cipher.iv).not.toBe(parseSettingsBackupEnvelope(b).cipher.iv);
  });

  it('rejects the wrong passphrase with a decrypt-failed error', async () => {
    const blob = await encryptSettingsBackup(PAYLOAD, PASSPHRASE);
    await expect(decryptSettingsBackup(blob, 'wrong passphrase')).rejects.toMatchObject({
      code: 'decrypt-failed',
    });
  });

  it('refuses to encrypt with an empty passphrase', async () => {
    await expect(encryptSettingsBackup(PAYLOAD, '   ')).rejects.toMatchObject({ code: 'weak-passphrase' });
  });

  it('rejects a non-backup file as invalid-format', () => {
    expect(() => parseSettingsBackupEnvelope('{"hello":"world"}')).toThrow(SettingsBackupError);
    try {
      parseSettingsBackupEnvelope('not json at all');
    } catch (error) {
      expect((error as SettingsBackupError).code).toBe('invalid-format');
    }
  });

  it('rejects a backup from a newer format version', () => {
    const future = JSON.stringify({
      format: SETTINGS_BACKUP_FORMAT,
      version: SETTINGS_BACKUP_VERSION + 1,
      createdAt: new Date().toISOString(),
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1, salt: 'AA==' },
      cipher: { name: 'AES-GCM', iv: 'AA==' },
      ciphertext: 'AA==',
    });
    try {
      parseSettingsBackupEnvelope(future);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as SettingsBackupError).code).toBe('unsupported-version');
    }
  });
});
