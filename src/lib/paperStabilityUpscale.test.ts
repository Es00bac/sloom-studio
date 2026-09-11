import { describe, expect, it, vi } from 'vitest';
import { createBinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import {
  assessUpscaleResolution,
  createPaperStabilityUpscaleCoordinator,
  planPaperStabilityUpscale,
  runPaperStabilityUpscale,
  validatePaperStabilityOptions,
  type PaperStabilityImageCodec,
} from './paperStabilityUpscale';

const placement = {
  placedWidthIn: 8.5,
  placedHeightIn: 11,
  requiredPpi: 300,
  requiredPixels: { width: 3300, height: 2200 },
};

function imageMeta(widthPx: number, heightPx: number, mimeType = 'image/png') {
  return { widthPx, heightPx, mimeType };
}

function codec(output = { widthPx: 2449, heightPx: 1633 }): PaperStabilityImageCodec {
  return {
    prepare: vi.fn(async ({ targetWidthPx, targetHeightPx }) => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/png',
      widthPx: targetWidthPx,
      heightPx: targetHeightPx,
    })),
    inspect: vi.fn(async () => output),
  };
}

async function sourceRecord() {
  return createBinaryAssetRecord(new Uint8Array([8, 6, 7, 5, 3, 0, 9]), {
    mimeType: 'image/png',
    fileName: 'source.png',
  });
}

function successResponse(): Response {
  return new Response(new Uint8Array([4, 3, 2, 1]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

describe('Paper Stability upscale', () => {
  it('normalizes Fast input within every documented limit without changing aspect', () => {
    const plan = planPaperStabilityUpscale({
      mode: 'fast',
      source: imageMeta(3000, 2000),
      placement,
    });

    expect(plan.request.widthPx).toBeLessThanOrEqual(1536);
    expect(plan.request.heightPx).toBeLessThanOrEqual(1536);
    expect(plan.request.widthPx * plan.request.heightPx).toBeLessThanOrEqual(1_048_576);
    expect(plan.request.widthPx / plan.request.heightPx).toBeCloseTo(1.5, 2);
  });

  it('rejects Conservative creativity outside 0.2 through 0.5', () => {
    expect(() => validatePaperStabilityOptions({
      mode: 'conservative',
      prompt: 'comic line art',
      creativity: 0.1,
    })).toThrow(/0\.2.*0\.5/);
  });

  it('does not call a 4 MP result print-ready when placed PPI is below target', () => {
    const result = assessUpscaleResolution({
      outputWidthPx: 2449,
      outputHeightPx: 1633,
      placedWidthIn: 8.5,
      placedHeightIn: 11,
      requiredPpi: 300,
    });

    expect(result.printReady).toBe(false);
    expect(result.effectivePpi).toBeLessThan(300);
  });

  it('stores returned provider bytes as a managed asset and reports achieved dimensions', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => successResponse());

    const result = await runPaperStabilityUpscale({
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' },
      repository,
      codec: codec(),
      fetchImpl,
    });

    expect(result.asset.id).toMatch(/^sha256:/);
    expect(result.providerWidthPx).toBe(2449);
    expect(result.providerHeightPx).toBe(1633);
    expect(result.printReady).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/data:|blob:/i);
    await expect(repository.get(result.asset.id)).resolves.toEqual(expect.objectContaining({
      bytes: new Uint8Array([4, 3, 2, 1]),
    }));
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ Accept: 'image/*' }) });
  });

  it('uses the HTML canvas binary-preparation fallback when OffscreenCanvas is unavailable', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: (callback: BlobCallback) => callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
    };
    const bitmap = { width: 2449, height: 1633, close: vi.fn() };
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    try {
      await runPaperStabilityUpscale({
        apiKey: 'test-key',
        source,
        sourceDimensions: imageMeta(3000, 2000),
        placement,
        options: { mode: 'fast' },
        repository,
        fetchImpl: (async () => successResponse()) as typeof fetch,
      });
      expect(drawImage).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([400, 403, 413, 422, 429, 500])('does not store or mutate output on Stability %i failures', async (status) => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();

    await expect(runPaperStabilityUpscale({
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' },
      repository,
      codec: codec(),
      fetchImpl: (async () => new Response('provider failure', { status })) as typeof fetch,
    })).rejects.toMatchObject({ status });
    await expect(repository.listRefs()).resolves.toEqual([]);
  });

  it('rejects an unsupported provider response MIME before storing bytes', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();

    await expect(runPaperStabilityUpscale({
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' },
      repository,
      codec: codec(),
      fetchImpl: (async () => new Response('not an image', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE_MIME' });
    await expect(repository.listRefs()).resolves.toEqual([]);
  });

  it('rejects unusable provider dimensions before storing bytes', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();

    await expect(runPaperStabilityUpscale({
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' },
      repository,
      codec: codec({ widthPx: 0, heightPx: 1633 }),
      fetchImpl: (async () => successResponse()) as typeof fetch,
    })).rejects.toMatchObject({ code: 'INVALID_DIMENSIONS' });
    await expect(repository.listRefs()).resolves.toEqual([]);
  });

  it('deduplicates concurrent runs for the same source and normalized provider request', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();
    const fetchImpl = vi.fn(async () => successResponse());
    const coordinator = createPaperStabilityUpscaleCoordinator();
    const input = {
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' as const },
      repository,
      codec: codec({ widthPx: 1320, heightPx: 880 }),
      fetchImpl: fetchImpl as typeof fetch,
    };

    const [first, second] = await Promise.all([coordinator.run(input), coordinator.run(input)]);

    expect(first.asset.id).toBe(second.asset.id);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(repository.listRefs()).resolves.toHaveLength(1);
  });

  it('does not store output when the request is canceled', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();

    await expect(runPaperStabilityUpscale({
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' },
      repository,
      codec: codec(),
      fetchImpl: (async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }) as typeof fetch,
    })).rejects.toMatchObject({ code: 'CANCELED' });
    await expect(repository.listRefs()).resolves.toEqual([]);
  });

  it('does not store output when the provider request times out', async () => {
    const repository = new MemoryPaperAssetRepository();
    const source = await sourceRecord();

    await expect(runPaperStabilityUpscale({
      apiKey: 'test-key',
      source,
      sourceDimensions: imageMeta(3000, 2000),
      placement,
      options: { mode: 'fast' },
      repository,
      codec: codec(),
      fetchImpl: (async () => {
        throw new Error('request timeout');
      }) as typeof fetch,
    })).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
    await expect(repository.listRefs()).resolves.toEqual([]);
  });
});
