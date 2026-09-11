import { describe, expect, it } from 'vitest';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from './PaperAssetRepository';

describe('Paper asset repository', () => {
  it('stores one immutable record per content hash', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([1, 2]), { mimeType: 'image/png' });

    await repository.put(record);
    await repository.put(record);

    expect(await repository.listRefs()).toEqual([record.ref]);
    expect((await repository.get(record.ref.id))?.bytes).toEqual(record.bytes);
  });

  it('isolates stored records and returned values from mutation', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([3, 4]), {
      mimeType: 'image/png',
      fileName: 'page.png',
    });
    const id = record.ref.id;
    await repository.put(record);

    record.bytes[0] = 9;
    record.ref.fileName = 'changed.png';
    const firstRead = await repository.get(id);
    expect(firstRead?.bytes).toEqual(new Uint8Array([3, 4]));
    expect(firstRead?.ref.fileName).toBe('page.png');

    if (!firstRead) {
      throw new Error('Expected the stored record to exist.');
    }
    firstRead.bytes[1] = 8;
    firstRead.ref.fileName = 'returned-value.png';

    expect((await repository.get(id))?.bytes).toEqual(new Uint8Array([3, 4]));
    expect((await repository.listRefs())[0]?.fileName).toBe('page.png');
    expect(await repository.has(id)).toBe(true);
    await repository.delete(id);
    expect(await repository.has(id)).toBe(false);
  });

  it('returns a ref detached from both the caller and stored record', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([5, 6]), {
      mimeType: 'image/png',
      fileName: 'original.png',
    });

    const returnedRef = await repository.put(record);

    expect(returnedRef).toEqual(record.ref);
    expect(returnedRef).not.toBe(record.ref);
    returnedRef.fileName = 'returned.png';
    expect(record.ref.fileName).toBe('original.png');
    expect((await repository.listRefs())[0]?.fileName).toBe('original.png');
  });
});
