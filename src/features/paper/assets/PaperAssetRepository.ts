import type {
  BinaryAssetId,
  BinaryAssetRecord,
  BinaryAssetRef,
} from '../../../shared/assets/contentAddressedAsset';

export interface PaperAssetRepository {
  put(record: BinaryAssetRecord): Promise<BinaryAssetRef>;
  /**
   * Commit a prepared record set as one repository transaction. Implementations that expose this
   * seam must leave the repository unchanged when any write fails. Callers retain a compensating
   * rollback for repositories supplied by older plugins that only implement `put`.
   */
  putAllAtomic?(records: readonly BinaryAssetRecord[]): Promise<BinaryAssetRef[]>;
  get(id: BinaryAssetId): Promise<BinaryAssetRecord | undefined>;
  has(id: BinaryAssetId): Promise<boolean>;
  delete(id: BinaryAssetId): Promise<void>;
  listRefs(): Promise<BinaryAssetRef[]>;
}

function cloneRecord(record: BinaryAssetRecord): BinaryAssetRecord {
  return {
    ref: { ...record.ref },
    bytes: new Uint8Array(record.bytes),
  };
}

export class MemoryPaperAssetRepository implements PaperAssetRepository {
  private records = new Map<BinaryAssetId, BinaryAssetRecord>();

  async put(record: BinaryAssetRecord): Promise<BinaryAssetRef> {
    this.records.set(record.ref.id, cloneRecord(record));
    return { ...record.ref };
  }

  async putAllAtomic(records: readonly BinaryAssetRecord[]): Promise<BinaryAssetRef[]> {
    const next = new Map(this.records);
    const prepared = records.map(cloneRecord);
    for (const record of prepared) next.set(record.ref.id, record);
    this.records = next;
    return prepared.map(({ ref }) => ({ ...ref }));
  }

  async get(id: BinaryAssetId): Promise<BinaryAssetRecord | undefined> {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  async has(id: BinaryAssetId): Promise<boolean> {
    return this.records.has(id);
  }

  async delete(id: BinaryAssetId): Promise<void> {
    this.records.delete(id);
  }

  async listRefs(): Promise<BinaryAssetRef[]> {
    return [...this.records.values()].map(({ ref }) => ({ ...ref }));
  }
}
