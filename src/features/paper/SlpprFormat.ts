import type { BinaryAssetRecord } from '../../shared/assets/contentAddressedAsset';
import { unpackContainer } from '../../shared/files/SignalLoomContainer';
import {
  packValidatedAssetContainer,
  unpackValidatedAssetContainer,
} from '../../shared/files/ValidatedAssetContainer';
import type { PaperDocument } from '../../types/paper';
import {
  collectReachablePaperAssetIds,
  migrateLegacyPaperBinaryFields,
  type LegacySlpprAssetPayload,
} from './assets/PaperDocumentAssets';
import type { PaperAssetRepository } from './assets/PaperAssetRepository';

export const SLPPR_FORMAT = 'signal-loom-paper';
export const SLPPR_FORMAT_VERSION = 2;

function assertSlpprIdentity(format: string, kind: string): void {
  if (format !== SLPPR_FORMAT || kind !== 'paper') {
    throw new Error(`Not a .slppr container: ${format}`);
  }
}

function unsupportedVersion(version: number): Error {
  return new Error(`Unsupported .slppr format version ${version}.`);
}

async function collectRequiredRecords(
  document: PaperDocument,
  repository: PaperAssetRepository,
): Promise<BinaryAssetRecord[]> {
  return Promise.all(collectReachablePaperAssetIds(document).map(async (id) => {
    const record = await repository.get(id);
    if (!record) throw new Error(`Paper document is missing required asset ${id}.`);
    return record;
  }));
}

function legacyPayloads(assets: ReadonlyMap<string, Uint8Array>): Map<string, LegacySlpprAssetPayload> {
  return new Map([...assets].map(([id, bytes]) => [id, { bytes: new Uint8Array(bytes) }]));
}

async function deserializeVersionOne(
  bytes: Uint8Array,
  repository: PaperAssetRepository,
  strictError: unknown,
): Promise<PaperDocument> {
  let legacy: ReturnType<typeof unpackContainer>;
  try {
    legacy = unpackContainer(bytes);
  } catch {
    throw strictError;
  }

  assertSlpprIdentity(legacy.manifest.format, legacy.manifest.kind);
  if (legacy.manifest.formatVersion !== 1) {
    throw unsupportedVersion(legacy.manifest.formatVersion);
  }

  return migrateLegacyPaperBinaryFields(
    legacy.manifest.document as PaperDocument,
    repository,
    { legacySlpprAssets: legacyPayloads(legacy.assets) },
  );
}

function cloneRecord(record: BinaryAssetRecord): BinaryAssetRecord {
  return {
    ref: { ...record.ref },
    bytes: new Uint8Array(record.bytes),
  };
}

function sameRef(left: BinaryAssetRecord['ref'], right: BinaryAssetRecord['ref']): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength;
}

function sameRecord(left: BinaryAssetRecord | undefined, right: BinaryAssetRecord | undefined): boolean {
  if (!left || !right) return left === right;
  if (!sameRef(left.ref, right.ref) || left.bytes.length !== right.bytes.length) return false;
  return left.bytes.every((byte, index) => byte === right.bytes[index]);
}

/**
 * Overlay used while a standalone package is decoded. Legacy migration and v2 extraction can write
 * records, but those bytes must not become live until the caller still owns the Paper workspace.
 */
class StagedPaperAssetRepository implements PaperAssetRepository {
  private readonly records = new Map<string, BinaryAssetRecord>();
  private readonly base: PaperAssetRepository;

  constructor(base: PaperAssetRepository) {
    this.base = base;
  }

  async put(record: BinaryAssetRecord) {
    const cloned = cloneRecord(record);
    this.records.set(cloned.ref.id, cloned);
    return { ...cloned.ref };
  }

  async putAllAtomic(records: readonly BinaryAssetRecord[]) {
    return Promise.all(records.map((record) => this.put(record)));
  }

  async get(id: BinaryAssetRecord['ref']['id']) {
    const staged = this.records.get(id);
    return staged ? cloneRecord(staged) : this.base.get(id);
  }

  async has(id: BinaryAssetRecord['ref']['id']) {
    return this.records.has(id) || this.base.has(id);
  }

  async delete(id: BinaryAssetRecord['ref']['id']) {
    this.records.delete(id);
  }

  async listRefs() {
    const refs = new Map((await this.base.listRefs()).map((ref) => [ref.id, { ...ref }]));
    for (const record of this.records.values()) refs.set(record.ref.id, { ...record.ref });
    return [...refs.values()];
  }

  stagedRecords(): BinaryAssetRecord[] {
    return [...this.records.values()].map(cloneRecord);
  }
}

export interface PreparedSlpprDocument {
  document: PaperDocument;
  /** Atomically publish package records, retaining an exact compensating baseline until finalize. */
  commitAssets(): Promise<void>;
  /** Restore the exact pre-open records after a stale/rejected Paper commit. */
  rollbackAssets(): Promise<void>;
  /** Settle a successful Paper commit so later cleanup cannot remove its managed records. */
  finalize(): void;
}

async function decodeSlppr(
  bytes: Uint8Array,
  repository: PaperAssetRepository,
): Promise<PaperDocument> {
  let opened: Awaited<ReturnType<typeof unpackValidatedAssetContainer<PaperDocument>>>;
  try {
    opened = await unpackValidatedAssetContainer<PaperDocument>(bytes);
  } catch (strictError) {
    return deserializeVersionOne(bytes, repository, strictError);
  }

  assertSlpprIdentity(opened.manifest.format, opened.manifest.kind);
  if (opened.manifest.formatVersion !== SLPPR_FORMAT_VERSION) {
    throw unsupportedVersion(opened.manifest.formatVersion);
  }

  for (const record of opened.assets.values()) {
    await repository.put(record);
  }
  await collectRequiredRecords(opened.manifest.document, repository);
  return migrateLegacyPaperBinaryFields(opened.manifest.document, repository);
}

/**
 * Decode and validate a standalone package without publishing any managed record. The returned
 * transaction lets the caller couple asset publication to its own exact Paper/baton authority.
 */
export async function prepareSlpprDocument(
  bytes: Uint8Array,
  repository: PaperAssetRepository,
): Promise<PreparedSlpprDocument> {
  const stagedRepository = new StagedPaperAssetRepository(repository);
  const document = await decodeSlppr(bytes, stagedRepository);
  const records = stagedRepository.stagedRecords();
  let previous: Array<BinaryAssetRecord | undefined> | undefined;
  let committed = false;
  let finalized = false;
  let rollbackPromise: Promise<void> | undefined;

  const restorePrevious = async (): Promise<void> => {
    if (!committed || finalized || !previous) return;
    const replacements = previous.filter((record): record is BinaryAssetRecord => Boolean(record));
    if (replacements.length) {
      if (repository.putAllAtomic) await repository.putAllAtomic(replacements);
      else for (const record of replacements) await repository.put(record);
    }
    for (let index = 0; index < records.length; index += 1) {
      if (!previous[index]) await repository.delete(records[index].ref.id);
    }
    const restored = await Promise.all(records.map(({ ref }) => repository.get(ref.id)));
    if (restored.some((record, index) => !sameRecord(record, previous?.[index]))) {
      throw new Error('Standalone Paper asset rollback could not restore the pre-open repository.');
    }
    committed = false;
  };

  return {
    document,
    commitAssets: async () => {
      if (finalized) throw new Error('This standalone Paper asset transaction is already settled.');
      if (committed) return;
      previous = await Promise.all(records.map(({ ref }) => repository.get(ref.id)));
      try {
        if (repository.putAllAtomic) {
          const stored = await repository.putAllAtomic(records);
          if (stored.length !== records.length
            || stored.some((ref, index) => !sameRef(ref, records[index].ref))) {
            throw new Error('Paper asset repository returned a mismatched atomic commit result.');
          }
        } else {
          for (const record of records) {
            const stored = await repository.put(record);
            if (!sameRef(stored, record.ref)) {
              throw new Error('Paper asset repository returned a mismatched commit result.');
            }
          }
        }
        committed = true;
      } catch (error) {
        committed = true;
        await restorePrevious();
        throw error;
      }
    },
    rollbackAssets: () => {
      rollbackPromise ??= restorePrevious();
      return rollbackPromise;
    },
    finalize: () => {
      if (!committed) throw new Error('Standalone Paper assets must commit before finalization.');
      finalized = true;
      previous = undefined;
    },
  };
}

export async function serializeSlppr(
  document: PaperDocument,
  repository: PaperAssetRepository,
): Promise<Uint8Array> {
  const managedDocument = await migrateLegacyPaperBinaryFields(document, repository);
  const records = await collectRequiredRecords(managedDocument, repository);
  return packValidatedAssetContainer({
    format: SLPPR_FORMAT,
    formatVersion: SLPPR_FORMAT_VERSION,
    kind: 'paper',
    document: managedDocument,
    assets: records.map(({ ref }) => ref),
  }, records);
}

export async function deserializeSlppr(
  bytes: Uint8Array,
  repository: PaperAssetRepository,
): Promise<PaperDocument> {
  const prepared = await prepareSlpprDocument(bytes, repository);
  try {
    await prepared.commitAssets();
    prepared.finalize();
    return prepared.document;
  } catch (error) {
    await prepared.rollbackAssets();
    throw error;
  }
}
