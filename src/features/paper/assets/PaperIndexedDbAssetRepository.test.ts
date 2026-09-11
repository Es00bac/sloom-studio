import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import {
  decodePaperAssetDbRecord,
  encodePaperAssetDbRecord,
  IndexedDbPaperAssetRepository,
  PaperAssetStorageUnavailableError,
} from './PaperIndexedDbAssetRepository';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createControlledTransactionFactory() {
  const requestStarted = createDeferred<void>();
  const operationRequestState = {
    result: 'sha256:test-key' as IDBValidKey,
    error: null as DOMException | null,
    onsuccess: null as IDBRequest<IDBValidKey>['onsuccess'],
    onerror: null as IDBRequest<IDBValidKey>['onerror'],
  };
  const operationRequest = operationRequestState as unknown as IDBRequest<IDBValidKey>;
  const objectStore = {
    put: () => {
      requestStarted.resolve();
      return operationRequest;
    },
  } as unknown as IDBObjectStore;
  const transactionState = {
    error: null as DOMException | null,
    oncomplete: null as IDBTransaction['oncomplete'],
    onerror: null as IDBTransaction['onerror'],
    onabort: null as IDBTransaction['onabort'],
    objectStore: () => objectStore,
  };
  const transaction = transactionState as unknown as IDBTransaction;
  const database = {
    transaction: () => transaction,
  } as unknown as IDBDatabase;
  const openRequestState = {
    result: database,
    error: null as DOMException | null,
    onupgradeneeded: null as IDBOpenDBRequest['onupgradeneeded'],
    onsuccess: null as IDBOpenDBRequest['onsuccess'],
    onerror: null as IDBOpenDBRequest['onerror'],
  };
  const openRequest = openRequestState as unknown as IDBOpenDBRequest;
  const factory = {
    open: () => {
      queueMicrotask(() => {
        openRequestState.onsuccess?.call(openRequest, new Event('success'));
      });
      return openRequest;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    requestStarted: requestStarted.promise,
    succeedRequest: () => {
      operationRequestState.onsuccess?.call(operationRequest, new Event('success'));
    },
    completeTransaction: () => {
      transactionState.oncomplete?.call(transaction, new Event('complete'));
    },
    failTransaction: (eventName: 'abort' | 'error', error: DOMException) => {
      transactionState.error = error;
      if (eventName === 'abort') {
        transactionState.onabort?.call(transaction, new Event('abort'));
      } else {
        transactionState.onerror?.call(transaction, new Event('error'));
      }
    },
  };
}

describe('Paper IndexedDB asset repository', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encodes and decodes database records without sharing mutable storage', async () => {
    const sourceBytes = new Uint8Array([9, 1, 2, 8]);
    const record = await createBinaryAssetRecord(sourceBytes.subarray(1, 3), {
      mimeType: 'image/png',
      fileName: 'panel.png',
    });

    const encoded = encodePaperAssetDbRecord(record);
    expect(encoded.ref).toEqual(record.ref);
    expect(encoded.ref).not.toBe(record.ref);
    expect(encoded.bytes).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(encoded.bytes)).toEqual(new Uint8Array([1, 2]));

    record.bytes[0] = 7;
    record.ref.fileName = 'changed.png';
    expect(new Uint8Array(encoded.bytes)).toEqual(new Uint8Array([1, 2]));
    expect(encoded.ref.fileName).toBe('panel.png');

    const decoded = decodePaperAssetDbRecord(encoded);
    expect(decoded.ref).toEqual(encoded.ref);
    expect(decoded.ref).not.toBe(encoded.ref);
    expect(decoded.bytes).toEqual(new Uint8Array([1, 2]));

    new Uint8Array(encoded.bytes)[1] = 6;
    expect(decoded.bytes).toEqual(new Uint8Array([1, 2]));
  });

  it('throws a typed error when IndexedDB is unavailable', () => {
    vi.stubGlobal('indexedDB', undefined);

    expect(() => new IndexedDbPaperAssetRepository()).toThrow(PaperAssetStorageUnavailableError);
  });

  it('persists records across close and reopen, then deletes them', async () => {
    const factory = new IDBFactory();
    const record = await createBinaryAssetRecord(new Uint8Array([4, 5, 6]), {
      mimeType: 'image/png',
      fileName: 'spread.png',
    });
    const first = new IndexedDbPaperAssetRepository(factory);

    await expect(first.put(record)).resolves.toEqual(record.ref);
    await expect(first.has(record.ref.id)).resolves.toBe(true);
    await expect(first.listRefs()).resolves.toEqual([record.ref]);
    await first.close();

    const reopened = new IndexedDbPaperAssetRepository(factory);
    await expect(reopened.get(record.ref.id)).resolves.toEqual(record);
    await reopened.delete(record.ref.id);
    await expect(reopened.get(record.ref.id)).resolves.toBeUndefined();
    await expect(reopened.has(record.ref.id)).resolves.toBe(false);
    await expect(reopened.listRefs()).resolves.toEqual([]);
    await reopened.close();
  });

  it('does not resolve a write before its transaction completes', async () => {
    const controlled = createControlledTransactionFactory();
    const repository = new IndexedDbPaperAssetRepository(controlled.factory);
    const record = await createBinaryAssetRecord(new Uint8Array([7]), { mimeType: 'image/png' });
    let settled = false;

    const operation = repository.put(record).finally(() => {
      settled = true;
    });
    await controlled.requestStarted;
    controlled.succeedRequest();
    await Promise.resolve();

    expect(settled).toBe(false);
    controlled.completeTransaction();
    await expect(operation).resolves.toEqual(record.ref);
    expect(settled).toBe(true);
  });

  it.each(['abort', 'error'] as const)('rejects a write when its transaction emits %s', async (eventName) => {
    const controlled = createControlledTransactionFactory();
    const repository = new IndexedDbPaperAssetRepository(controlled.factory);
    const record = await createBinaryAssetRecord(new Uint8Array([8]), { mimeType: 'image/png' });
    const operation = repository.put(record);
    await controlled.requestStarted;
    controlled.succeedRequest();
    const transactionError = new DOMException(`controlled ${eventName}`, 'UnknownError');

    controlled.failTransaction(eventName, transactionError);

    await expect(operation).rejects.toBe(transactionError);
  });
});
