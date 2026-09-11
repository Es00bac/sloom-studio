import type { BinaryAssetId, BinaryAssetRef } from '../../../shared/assets/contentAddressedAsset';
import type { PaperAssetRepository } from './PaperAssetRepository';

export interface PaperAssetUrlLease {
  url: string;
  release(): void;
}

interface PaperAssetUrlEntry {
  ref: BinaryAssetRef;
  url: string;
  leases: number;
}

export class PaperAssetUrlRegistry {
  private readonly entries = new Map<BinaryAssetId, PaperAssetUrlEntry>();
  private readonly pendingEntries = new Map<BinaryAssetId, Promise<PaperAssetUrlEntry>>();
  private readonly repository: PaperAssetRepository;

  constructor(repository: PaperAssetRepository) {
    this.repository = repository;
  }

  async acquire(ref: BinaryAssetRef): Promise<PaperAssetUrlLease> {
    const entry = await this.getOrCreateEntry(ref);
    const id = ref.id;
    entry.leases += 1;
    let released = false;

    return {
      url: entry.url,
      release: () => {
        if (released || this.entries.get(id) !== entry) {
          return;
        }
        released = true;
        entry.leases -= 1;
        if (entry.leases === 0) {
          this.entries.delete(id);
          URL.revokeObjectURL(entry.url);
        }
      },
    };
  }

  private async getOrCreateEntry(ref: BinaryAssetRef): Promise<PaperAssetUrlEntry> {
    const id = ref.id;
    const existing = this.entries.get(id);
    if (existing) {
      assertMatchingAssetRef(existing.ref, ref);
      return existing;
    }

    const pending = this.pendingEntries.get(id) ?? this.createEntry(ref);
    this.pendingEntries.set(id, pending);
    try {
      const entry = await pending;
      assertMatchingAssetRef(entry.ref, ref);
      return entry;
    } finally {
      if (this.pendingEntries.get(id) === pending) {
        this.pendingEntries.delete(id);
      }
    }
  }

  private async createEntry(ref: BinaryAssetRef): Promise<PaperAssetUrlEntry> {
    const record = await this.repository.get(ref.id);
    if (!record) {
      throw new Error(`Paper asset not found: ${ref.id}`);
    }
    assertMatchingAssetRef(record.ref, ref);

    const entry = {
      ref: { ...record.ref },
      url: URL.createObjectURL(new Blob([new Uint8Array(record.bytes)], { type: record.ref.mimeType })),
      leases: 0,
    };
    this.entries.set(ref.id, entry);
    return entry;
  }
}

function assertMatchingAssetRef(record: BinaryAssetRef, declared: BinaryAssetRef): void {
  if (
    record.id !== declared.id
    || record.sha256 !== declared.sha256
    || record.mimeType !== declared.mimeType
    || record.byteLength !== declared.byteLength
  ) {
    throw new Error(`Paper asset ${declared.id} does not match its document reference.`);
  }
}
