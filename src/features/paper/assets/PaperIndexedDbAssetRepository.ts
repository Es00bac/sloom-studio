import type {
  BinaryAssetId,
  BinaryAssetRecord,
  BinaryAssetRef,
} from '../../../shared/assets/contentAddressedAsset';
import type { PaperAssetRepository } from './PaperAssetRepository';

const DATABASE_NAME = 'sloom-paper-assets';
const DATABASE_VERSION = 1;
const ASSET_STORE_NAME = 'assets';

export interface PaperAssetDbRecord {
  ref: BinaryAssetRef;
  bytes: ArrayBuffer;
}

export class PaperAssetStorageUnavailableError extends Error {
  constructor() {
    super('Paper asset storage requires IndexedDB support.');
    this.name = 'PaperAssetStorageUnavailableError';
  }
}

export function encodePaperAssetDbRecord(record: BinaryAssetRecord): PaperAssetDbRecord {
  return {
    ref: { ...record.ref },
    bytes: new Uint8Array(record.bytes).buffer,
  };
}

export function decodePaperAssetDbRecord(record: PaperAssetDbRecord): BinaryAssetRecord {
  return {
    ref: { ...record.ref },
    bytes: new Uint8Array(record.bytes.slice(0)),
  };
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

async function finishRequest<T>(transaction: IDBTransaction, request: IDBRequest<T>): Promise<T> {
  const [result] = await Promise.all([
    waitForRequest(request),
    waitForTransaction(transaction),
  ]);
  return result;
}

export class IndexedDbPaperAssetRepository implements PaperAssetRepository {
  private readonly factory: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(factory: IDBFactory | undefined = globalThis.indexedDB) {
    if (!factory) {
      throw new PaperAssetStorageUnavailableError();
    }
    this.factory = factory;
  }

  async put(record: BinaryAssetRecord): Promise<BinaryAssetRef> {
    const database = await this.getDatabase();
    const transaction = database.transaction(ASSET_STORE_NAME, 'readwrite');
    const request = transaction.objectStore(ASSET_STORE_NAME).put(encodePaperAssetDbRecord(record));
    await finishRequest(transaction, request);
    return { ...record.ref };
  }

  async putAllAtomic(records: readonly BinaryAssetRecord[]): Promise<BinaryAssetRef[]> {
    if (records.length === 0) return [];
    const database = await this.getDatabase();
    const transaction = database.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE_NAME);
    const requests = records.map((record) => store.put(encodePaperAssetDbRecord(record)));
    await Promise.all([
      ...requests.map((request) => waitForRequest(request)),
      waitForTransaction(transaction),
    ]);
    return records.map(({ ref }) => ({ ...ref }));
  }

  async get(id: BinaryAssetId): Promise<BinaryAssetRecord | undefined> {
    const database = await this.getDatabase();
    const transaction = database.transaction(ASSET_STORE_NAME, 'readonly');
    const request = transaction.objectStore(ASSET_STORE_NAME).get(id) as IDBRequest<PaperAssetDbRecord | undefined>;
    const record = await finishRequest(transaction, request);
    return record ? decodePaperAssetDbRecord(record) : undefined;
  }

  async has(id: BinaryAssetId): Promise<boolean> {
    const database = await this.getDatabase();
    const transaction = database.transaction(ASSET_STORE_NAME, 'readonly');
    const request = transaction.objectStore(ASSET_STORE_NAME).getKey(id);
    return (await finishRequest(transaction, request)) !== undefined;
  }

  async delete(id: BinaryAssetId): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction(ASSET_STORE_NAME, 'readwrite');
    const request = transaction.objectStore(ASSET_STORE_NAME).delete(id);
    await finishRequest(transaction, request);
  }

  async listRefs(): Promise<BinaryAssetRef[]> {
    const database = await this.getDatabase();
    const transaction = database.transaction(ASSET_STORE_NAME, 'readonly');
    const request = transaction.objectStore(ASSET_STORE_NAME).getAll() as IDBRequest<PaperAssetDbRecord[]>;
    const records = await finishRequest(transaction, request);
    return records.map(({ ref }) => ({ ...ref }));
  }

  async close(): Promise<void> {
    const databasePromise = this.databasePromise;
    this.databasePromise = undefined;
    if (databasePromise) {
      (await databasePromise).close();
    }
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      const databasePromise = this.openDatabase();
      this.databasePromise = databasePromise;
      void databasePromise.catch(() => {
        if (this.databasePromise === databasePromise) {
          this.databasePromise = undefined;
        }
      });
    }
    return this.databasePromise;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(ASSET_STORE_NAME)) {
          request.result.createObjectStore(ASSET_STORE_NAME, { keyPath: 'ref.id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open the Paper asset database.'));
    });
  }
}
