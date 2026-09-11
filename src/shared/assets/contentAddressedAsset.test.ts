import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBinaryAssetRecord,
  isBinaryAssetRef,
  verifyBinaryAssetRecord,
} from './contentAddressedAsset';

describe('content-addressed assets', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deduplicates equal bytes regardless of filename', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const a = await createBinaryAssetRecord(bytes, { mimeType: 'image/png', fileName: 'a.png' });
    const b = await createBinaryAssetRecord(bytes, { mimeType: 'image/png', fileName: 'b.png' });
    expect(a.ref.id).toBe(b.ref.id);
    expect(a.ref.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyBinaryAssetRecord(a)).resolves.toBe(true);
  });

  it('detects mutated bytes', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([9, 8, 7]), { mimeType: 'application/octet-stream' });
    await expect(verifyBinaryAssetRecord({ ...record, bytes: new Uint8Array([9, 8, 6]) })).resolves.toBe(false);
  });

  it('creates and verifies records on an insecure LAN origin without SubtleCrypto', async () => {
    vi.stubGlobal('crypto', {});
    const record = await createBinaryAssetRecord(
      new TextEncoder().encode('served Android project asset'),
      { mimeType: 'application/octet-stream', fileName: 'asset.bin' },
    );

    expect(record.ref.sha256).toBe('25a4dd6f6e639a31a14aece8ac7a773f1e6c45c343744b48780000b65743699d');
    await expect(verifyBinaryAssetRecord(record)).resolves.toBe(true);
  });

  it('recognizes only structurally valid binary asset references', () => {
    const sha256 = 'a'.repeat(64);
    const valid = {
      id: `sha256:${sha256}`,
      sha256,
      mimeType: 'application/octet-stream',
      byteLength: 0,
    };

    expect(isBinaryAssetRef(valid)).toBe(true);
    expect(isBinaryAssetRef({ ...valid, id: sha256 })).toBe(false);
    expect(isBinaryAssetRef({ ...valid, id: `sha256:${'A'.repeat(64)}` })).toBe(false);
    expect(isBinaryAssetRef({ ...valid, sha256: 'a'.repeat(63) })).toBe(false);
    expect(isBinaryAssetRef({ ...valid, mimeType: '' })).toBe(false);
    expect(isBinaryAssetRef({ ...valid, byteLength: -1 })).toBe(false);
    expect(isBinaryAssetRef({ ...valid, byteLength: 1.5 })).toBe(false);
  });
});
