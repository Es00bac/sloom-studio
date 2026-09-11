import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from './PaperAssetRepository';
import { PaperAssetUrlRegistry } from './PaperAssetUrlRegistry';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Paper asset URL registry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes an object URL after the final lease releases', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:paper-asset');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([1]), { mimeType: 'image/png' });
    await repository.put(record);
    const registry = new PaperAssetUrlRegistry(repository);

    const first = await registry.acquire(record.ref);
    const second = await registry.acquire(record.ref);
    expect(first.url).toBe('blob:paper-asset');
    expect(second.url).toBe(first.url);
    expect(create).toHaveBeenCalledTimes(1);
    first.release();
    expect(revoke).not.toHaveBeenCalled();
    second.release();

    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:paper-asset');

    second.release();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('shares one repository read and object URL across concurrent acquires', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:concurrent-paper-asset');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([2]), { mimeType: 'image/png' });
    await repository.put(record);
    const readGate = createDeferred<void>();
    const originalGet = repository.get.bind(repository);
    const get = vi.spyOn(repository, 'get').mockImplementation(async (id) => {
      await readGate.promise;
      return originalGet(id);
    });
    const registry = new PaperAssetUrlRegistry(repository);

    const firstPromise = registry.acquire(record.ref);
    const secondPromise = registry.acquire(record.ref);
    expect(get).toHaveBeenCalledOnce();
    readGate.resolve();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.url).toBe('blob:concurrent-paper-asset');
    expect(second.url).toBe(first.url);
    expect(get).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    first.release();
    expect(revoke).not.toHaveBeenCalled();
    second.release();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:concurrent-paper-asset');
  });

  it('refuses a record whose metadata does not match the declared managed reference', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([3, 4]), { mimeType: 'image/png' });
    await repository.put(record);
    const registry = new PaperAssetUrlRegistry(repository);

    await expect(registry.acquire({ ...record.ref, byteLength: record.ref.byteLength + 1 }))
      .rejects.toThrow(/does not match its document reference/i);
  });

  it('validates every concurrent caller against the shared pending record', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:concurrent-reference-check');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([5, 6]), { mimeType: 'image/png' });
    await repository.put(record);
    const readGate = createDeferred<void>();
    const originalGet = repository.get.bind(repository);
    vi.spyOn(repository, 'get').mockImplementation(async (id) => {
      await readGate.promise;
      return originalGet(id);
    });
    const registry = new PaperAssetUrlRegistry(repository);

    const validLease = registry.acquire(record.ref);
    const mismatchedLease = registry.acquire({ ...record.ref, byteLength: record.ref.byteLength + 1 });
    readGate.resolve();

    await expect(mismatchedLease).rejects.toThrow(/does not match its document reference/i);
    (await validLease).release();
  });
});
