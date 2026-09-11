import { describe, expect, it, vi } from 'vitest';
import { createBinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { resolvePaperStabilitySource } from './paperStabilitySource';

describe('resolvePaperStabilitySource', () => {
  it('uses a verified managed record without fetching or materializing a URL', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    await repository.put(record);
    const fetchImpl = vi.fn();

    const resolved = await resolvePaperStabilitySource({
      asset: {
        label: 'Managed art',
        kind: 'image',
        locator: { kind: 'managed', ref: record.ref },
        pixelWidth: 1200,
        pixelHeight: 800,
      },
      repository,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(resolved.source).toEqual(record);
    expect(resolved.sourceDimensions).toEqual({ widthPx: 1200, heightPx: 800, mimeType: 'image/png' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(resolved)).not.toMatch(/data:|blob:/i);
  });

  it('creates an in-memory content-addressed source record from a runtime URL', async () => {
    const repository = new MemoryPaperAssetRepository();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    }));

    const resolved = await resolvePaperStabilitySource({
      asset: {
        sourceBinItemId: 'source-art',
        label: 'Source art',
        kind: 'image',
        pixelWidth: 900,
        pixelHeight: 600,
      },
      sourceItem: { id: 'source-art', assetUrl: 'https://example.test/source.webp', mimeType: 'image/webp', pixelWidth: 900, pixelHeight: 600 },
      repository,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(resolved.source.ref.mimeType).toBe('image/webp');
    expect(resolved.source.bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(resolved.sourceDimensions).toEqual({ widthPx: 900, heightPx: 600, mimeType: 'image/webp' });
    await expect(repository.listRefs()).resolves.toEqual([]);
  });

  it('fails closed when a managed reference does not match the stored bytes', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    await repository.put(record);

    await expect(resolvePaperStabilitySource({
      asset: {
        label: 'Tampered art',
        kind: 'image',
        locator: { kind: 'managed', ref: { ...record.ref, byteLength: 99 } },
        pixelWidth: 1200,
        pixelHeight: 800,
      },
      repository,
    })).rejects.toThrow(/does not match/i);
  });

  it('requires known source pixels before a paid request can be planned', async () => {
    const repository = new MemoryPaperAssetRepository();

    await expect(resolvePaperStabilitySource({
      asset: { sourceBinItemId: 'source-art', label: 'Unknown art', kind: 'image' },
      sourceItem: { id: 'source-art', assetUrl: 'https://example.test/source.png' },
      repository,
      fetchImpl: (async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })) as typeof fetch,
    })).rejects.toThrow(/pixel dimensions/i);
  });
});
