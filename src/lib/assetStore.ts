import { initializeLanServerProxy } from './androidLanServer';
import { sha256 } from '@noble/hashes/sha2.js';
import { analyzeBase64DataUrl, sampleBase64DataUrl, visitBase64DataUrlBytes } from './boundedDataUrl';
import { readBoundedJsonResponse } from './boundedResponse';
import { BINARY_RESUME_SAMPLE_BYTES, MAX_BINARY_RESUME_BYTES } from './binaryResumeSniffer';
import { isRemoteLanClient } from './projectLibrary';
import { isServedLanSession, remoteHostFetch } from './remoteHostClient';

const DB_NAME = 'flow-local-assets';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export interface StoredAssetRecord {
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  blob?: Blob;
  byteLength?: number;
  transportRevision?: string;
  createdAt: number;
}

export interface StoredAssetPayload {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  /** Releases an owned Blob URL. Data-URL payloads do not need a lease. */
  release?: () => void;
}

export interface StoredAssetBlobPayload {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface BoundedStoredAssetPayload {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  transportRevision?: string;
  contentDigest?: string;
  dataUrl?: string;
  blob?: Blob;
  sample?: BoundedStoredAssetSample;
  materialize?: () => Promise<BoundedStoredAssetMaterialization | undefined>;
}

export interface StoredAssetMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  transportRevision: string;
  contentDigest: string;
  transportIdentity: string;
}

export interface BoundedStoredAssetSample {
  head: Uint8Array;
  tail: Uint8Array;
  size: number;
  tailOffset: number;
  mimeType?: string;
}

export interface BoundedStoredAssetMaterialization {
  dataUrl?: string;
  blob?: Blob;
}

export interface BoundedAssetTransportRequest {
  maxBytes: number;
  sampleBytes: number;
  transportIdentity: string;
}

export interface SerializedBoundedAssetSample {
  id: string;
  size: number;
  mimeType: string;
  transportIdentity: string;
  headBase64: string;
  tailBase64: string;
  tailOffset: number;
}

interface SaveDataUrlAssetInput {
  name: string;
  mimeType: string;
  dataUrl: string;
}

let cachedDatabasePromise: Promise<IDBDatabase> | null = null;
const MAX_METADATA_RESPONSE_BYTES = 8 * 1024;
const MAX_TRANSPORT_OVERHEAD_BYTES = 16 * 1024;
const ASSET_TRANSPORT_TIMEOUT_MS = 15_000;
const ASSET_STREAM_CHUNK_BYTES = 768 * 1024;

function openDatabase(): Promise<IDBDatabase> {
  if (cachedDatabasePromise) {
    return cachedDatabasePromise;
  }

  cachedDatabasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cachedDatabasePromise = null;
      reject(new Error('Timeout opening local asset database.'));
    }, 3000);

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      clearTimeout(timeoutId);
      cachedDatabasePromise = null;
      reject(request.error ?? new Error('Failed to open the local asset database.'));
    };

    request.onblocked = () => {
      clearTimeout(timeoutId);
      console.warn('IndexedDB database open is blocked.');
      cachedDatabasePromise = null;
      reject(new Error('IndexedDB database open is blocked by another connection.'));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      clearTimeout(timeoutId);
      resolve(request.result);
    };
  });

  return cachedDatabasePromise;
}

// Phone host: expose an identity-bound metadata -> bounded sample -> payload contract. Blob-backed
// payloads are converted to data URLs only after the caller's ceiling and metadata identity still
// match. Phase B uploads remain append-by-id and never touch projects.
initializeLanServerProxy({
  getAsset: loadImportedAssetTransportRecord,
  getAssetSample: loadImportedAssetTransportSample,
  getAssetMetadata: loadImportedAssetMetadata,
  putAsset: async (id, record) => {
    const stored = record as StoredAssetRecord;
    if (!stored || (!stored.dataUrl && !stored.blob)) return;
    await persistAssetRecord({ ...stored, id, createdAt: stored.createdAt ?? Date.now() });
  },
});

export async function persistAssetRecord(record: StoredAssetRecord): Promise<StoredAssetPayload> {
  // On a served (read-only mirror) session there is no write-back to the phone yet (Phase A), so any
  // asset created in the session persists to this browser's own origin storage instead.
  const database = await openDatabase();

  const storedRecord: StoredAssetRecord = {
    ...record,
    transportRevision: globalThis.crypto?.randomUUID?.() ?? `revision-${Date.now()}-${Math.random()}`,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Failed to persist the selected asset locally.'));

    store.put(storedRecord);
  });

  retireBoundedStoredAssetUrls(storedRecord.id);

  const payload = await materializeOwnedStoredAssetPayload(storedRecord);

  if (!payload) {
    throw new Error('Failed to materialize the selected asset after saving it locally.');
  }

  return payload;
}

export async function saveImportedAsset(file: File): Promise<StoredAssetPayload> {
  const id = globalThis.crypto?.randomUUID?.() ?? `asset-${Date.now()}`;

  return persistAssetRecord({
    id,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
    byteLength: file.size,
    createdAt: Date.now(),
  });
}

export async function saveDataUrlAsset(input: SaveDataUrlAssetInput): Promise<StoredAssetPayload> {
  const id = globalThis.crypto?.randomUUID?.() ?? `asset-${Date.now()}`;
  const blob = await dataUrlToBlob(input.dataUrl, input.mimeType);

  return persistAssetRecord({
    id,
    name: input.name,
    mimeType: input.mimeType || 'application/octet-stream',
    blob,
    byteLength: blob.size,
    createdAt: Date.now(),
  });
}

export async function loadImportedAsset(id: string): Promise<StoredAssetPayload | undefined> {
  const record = await loadImportedAssetRecord(id);

  if (!record) {
    return undefined;
  }

  return materializeOwnedStoredAssetPayload(record);
}

export async function loadImportedAssetAsDataUrl(id: string): Promise<StoredAssetPayload | undefined> {
  const record = await loadImportedAssetRecord(id);

  if (!record) {
    return undefined;
  }

  if (record.dataUrl) {
    return {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      dataUrl: record.dataUrl,
    };
  }

  if (!record.blob) {
    return undefined;
  }

  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    dataUrl: await blobToDataUrl(record.blob, MAX_BINARY_RESUME_BYTES),
  };
}

/**
 * Resolve an imported asset's bytes to a data URL, with a served-LAN-session fallback to the phone host.
 *
 * On the phone (authority), and on a standalone desktop/web session, the asset lives in this origin's
 * IndexedDB, so the local lookup wins. On a *served* browser session the Flow sync strips the inline
 * `sourceAssetUrl` from every node before shipping it (the multi-MB data URL would bloat every op),
 * sending only the stable `sourceAssetId` — so the bytes never entered this browser's store. When the
 * local lookup misses in a served session we fetch them from the host's `GET /asset/:id` endpoint (the
 * same id space `saveImportedAsset` writes, the same byte path the source library already rides) and
 * cache them into this origin so subsequent reads — and React re-renders — are local and synchronous.
 */
export async function resolveImportedAssetDataUrl(id: string): Promise<string | undefined> {
  if (!id) {
    return undefined;
  }

  const local = await loadImportedAssetAsDataUrl(id).catch(() => undefined);
  if (local?.dataUrl) {
    return local.dataUrl;
  }

  if (!isServedLanSession()) {
    return undefined;
  }

  try {
    const asset = await loadImportedAssetForBoundedRead(
      id,
      MAX_BINARY_RESUME_BYTES,
      BINARY_RESUME_SAMPLE_BYTES,
    );
    const materialized = await asset?.materialize?.();
    if (!asset || !materialized?.dataUrl) return undefined;

    // Cache into this origin so the next read is local; best-effort, since a quota miss must not block display.
    await persistAssetRecord({
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      dataUrl: materialized.dataUrl,
      byteLength: asset.size,
      createdAt: asset.createdAt,
    }).catch(() => undefined);

    return materialized.dataUrl;
  } catch {
    return undefined;
  }
}

export async function loadImportedAssetBlob(id: string): Promise<StoredAssetBlobPayload | undefined> {
  const record = await loadImportedAssetRecord(id);

  if (!record) {
    return undefined;
  }

  if (record.blob) {
    return {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      blob: record.blob,
    };
  }

  if (!record.dataUrl) {
    return undefined;
  }

  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    blob: await dataUrlToBlob(record.dataUrl, record.mimeType),
  };
}

export function inspectStoredAssetForBoundedRead(
  record: StoredAssetRecord,
  maxBytes: number,
): BoundedStoredAssetPayload | undefined {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return undefined;
  const dataUrlAnalysis = record.dataUrl ? analyzeBase64DataUrl(record.dataUrl, maxBytes) : undefined;
  if (record.dataUrl && !dataUrlAnalysis) return undefined;

  const blobSize = record.blob?.size;
  if (blobSize !== undefined && (!Number.isSafeInteger(blobSize) || blobSize <= 0 || blobSize > maxBytes)) {
    return undefined;
  }
  const size = blobSize ?? dataUrlAnalysis?.size;
  if (size === undefined) return undefined;
  if (dataUrlAnalysis && dataUrlAnalysis.size !== size) return undefined;
  if (record.byteLength !== undefined && record.byteLength !== size) return undefined;

  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size,
    createdAt: record.createdAt,
    transportRevision: record.transportRevision,
    dataUrl: record.dataUrl,
    blob: record.blob,
  };
}

export async function loadImportedAssetForBoundedRead(
  id: string,
  maxBytes: number,
  sampleBytes = BINARY_RESUME_SAMPLE_BYTES,
  signal?: AbortSignal,
): Promise<BoundedStoredAssetPayload | undefined> {
  throwIfAborted(signal);
  if (!isValidBoundedReadLimits(maxBytes, sampleBytes)) return undefined;
  const boundedSampleBytes = Math.min(maxBytes, sampleBytes);

  if (isRemoteLanClient()) {
    const remoteAsset = await loadRemoteBoundedAssetForRead(
      'asset', id, maxBytes, boundedSampleBytes, signal,
    ).catch(() => {
      if (signal?.aborted) throw abortError();
      return undefined;
    });
    if (remoteAsset) return remoteAsset;
  }

  const record = await loadLocalImportedAssetRecord(id);
  const asset = record ? inspectStoredAssetForBoundedRead(record, maxBytes) : undefined;
  if (!asset) return undefined;
  const sample = await sampleBoundedStoredAsset(asset, boundedSampleBytes, signal);
  if (!sample) return undefined;
  const contentDigest = await digestBoundedStoredAsset(asset, signal);
  if (!contentDigest) return undefined;
  return {
    ...asset,
    contentDigest,
    sample,
    materialize: async () => ({ dataUrl: asset.dataUrl, blob: asset.blob }),
  };
}

export async function loadRemoteSourceAssetForBoundedRead(
  id: string,
  maxBytes: number,
  sampleBytes = BINARY_RESUME_SAMPLE_BYTES,
  signal?: AbortSignal,
): Promise<BoundedStoredAssetPayload | undefined> {
  throwIfAborted(signal);
  if (!isValidBoundedReadLimits(maxBytes, sampleBytes)) return undefined;
  return loadRemoteBoundedAssetForRead('source-asset', id, maxBytes, Math.min(maxBytes, sampleBytes), signal);
}

export function materializeBoundedStoredAssetUrl(
  asset: BoundedStoredAssetPayload,
  createObjectUrl?: (blob: Blob) => string,
): string | undefined {
  if (!asset.blob) return asset.dataUrl;
  if (createObjectUrl) return createObjectUrl(asset.blob);
  const identity = boundedStoredAssetIdentity(asset);
  const existing = boundedBlobObjectUrls.get(asset.id)?.find((entry) => (
    !entry.retired && entry.identity === identity
  ));
  if (existing) {
    existing.refCount += 1;
    return existing.url;
  }
  retireBoundedStoredAssetUrls(asset.id);
  const objectUrl = URL.createObjectURL(asset.blob);
  const entries = boundedBlobObjectUrls.get(asset.id) ?? [];
  entries.push({ identity, url: objectUrl, refCount: 1, retired: false, revoked: false });
  boundedBlobObjectUrls.set(asset.id, entries);
  return objectUrl;
}

export function releaseBoundedStoredAssetUrl(id: string, url: string): void {
  const entries = boundedBlobObjectUrls.get(id);
  const entry = entries?.find((candidate) => candidate.url === url);
  if (!entry || entry.revoked || entry.refCount <= 0) return;
  entry.refCount -= 1;
  if (entry.refCount === 0) revokeBoundedStoredAssetEntry(id, entry);
}

export function resetImportedAssetObjectUrls(): void {
  for (const id of [...boundedBlobObjectUrls.keys()]) retireBoundedStoredAssetUrls(id);
}

export async function deleteImportedAsset(id: string): Promise<void> {
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Failed to delete the stored local asset.'));

    store.delete(id);
  });
  retireBoundedStoredAssetUrls(id);
}

export function materializeStoredAssetPayload(
  record: StoredAssetRecord,
  createObjectUrl?: (blob: Blob) => string,
): StoredAssetPayload | undefined {
  if (record.dataUrl) {
    return {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      dataUrl: record.dataUrl,
    };
  }

  if (!record.blob) {
    return undefined;
  }

  if (createObjectUrl) return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    dataUrl: createObjectUrl(record.blob),
  };

  const asset = inspectStoredAssetForBoundedRead(record, MAX_BINARY_RESUME_BYTES);
  if (!asset) return undefined;
  const dataUrl = materializeBoundedStoredAssetUrl(asset);
  if (!dataUrl) return undefined;
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    dataUrl,
    release: once(() => releaseBoundedStoredAssetUrl(record.id, dataUrl)),
  };
}

async function materializeOwnedStoredAssetPayload(
  record: StoredAssetRecord,
): Promise<StoredAssetPayload | undefined> {
  if (record.dataUrl) return materializeStoredAssetPayload(record);
  if (!record.blob) return undefined;
  const asset = inspectStoredAssetForBoundedRead(record, MAX_BINARY_RESUME_BYTES);
  if (!asset) return undefined;
  const contentDigest = await digestBoundedStoredAsset(asset);
  if (!contentDigest) return undefined;
  const ownedAsset = { ...asset, contentDigest };
  const dataUrl = materializeBoundedStoredAssetUrl(ownedAsset);
  if (!dataUrl) return undefined;
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    dataUrl,
    release: once(() => releaseBoundedStoredAssetUrl(record.id, dataUrl)),
  };
}

export async function loadImportedAssetRecord(id: string): Promise<StoredAssetRecord | undefined> {
  if (isRemoteLanClient()) {
    // Resolve from the phone host first (authenticated); fall back to this browser's own storage for
    // any asset that was imported locally within the served session.
    try {
      const remoteRecord = await loadRemoteImportedAssetRecord(id);
      if (remoteRecord) return remoteRecord;
    } catch {
      // fall through to local storage
    }
  }

  return loadLocalImportedAssetRecord(id);
}

interface BoundedBlobObjectUrlEntry {
  identity: string;
  url: string;
  refCount: number;
  retired: boolean;
  revoked: boolean;
}

const boundedBlobObjectUrls = new Map<string, BoundedBlobObjectUrlEntry[]>();

async function loadLocalImportedAssetRecord(id: string): Promise<StoredAssetRecord | undefined> {
  const database = await openDatabase();
  const result = await new Promise<StoredAssetRecord | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as StoredAssetRecord | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to load the stored local asset.'));
  });

  return result;
}

async function loadRemoteImportedAssetRecord(id: string): Promise<StoredAssetRecord | undefined> {
  const asset = await loadImportedAssetForBoundedRead(
    id,
    MAX_BINARY_RESUME_BYTES,
    BINARY_RESUME_SAMPLE_BYTES,
  );
  const materialized = await asset?.materialize?.();
  if (!asset || !materialized) return undefined;
  return {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    dataUrl: materialized.dataUrl,
    blob: materialized.blob,
    byteLength: asset.size,
    createdAt: asset.createdAt,
    transportRevision: asset.transportRevision,
  };
}

async function loadRemoteImportedAssetMetadata(
  id: string,
  route: 'asset' | 'source-asset' = 'asset',
  signal?: AbortSignal,
): Promise<StoredAssetMetadata | undefined> {
  throwIfAborted(signal);
  const res = await remoteHostFetch(`/${route}-metadata/${encodeURIComponent(id)}`, {
    signal,
    timeoutMs: ASSET_TRANSPORT_TIMEOUT_MS,
  });
  if (!res) return undefined;
  return parseStoredAssetMetadata(await readBoundedJsonResponse(res, MAX_METADATA_RESPONSE_BYTES, signal));
}

async function loadImportedAssetMetadata(id: string): Promise<StoredAssetMetadata | undefined> {
  const record = await loadLocalImportedAssetRecord(id);
  return record ? createStoredAssetTransportMetadata(record) : undefined;
}

async function loadImportedAssetTransportRecord(
  id: string,
  request?: BoundedAssetTransportRequest,
): Promise<StoredAssetRecord | undefined> {
  if (!request || !isValidTransportRequest(request)) return undefined;
  const record = await loadLocalImportedAssetRecord(id);
  return record ? createStoredAssetTransportRecord(record, request) : undefined;
}

async function loadImportedAssetTransportSample(
  id: string,
  request?: BoundedAssetTransportRequest,
): Promise<SerializedBoundedAssetSample | undefined> {
  if (!request || !isValidTransportRequest(request)) return undefined;
  const record = await loadLocalImportedAssetRecord(id);
  return record ? createStoredAssetTransportSample(record, request) : undefined;
}

export async function createStoredAssetTransportMetadata(
  record: StoredAssetRecord,
): Promise<StoredAssetMetadata | undefined> {
  const asset = inspectStoredAssetForBoundedRead(record, MAX_BINARY_RESUME_BYTES);
  if (!asset) return undefined;
  const contentDigest = await digestBoundedStoredAsset(asset);
  return contentDigest ? storedAssetMetadata(asset, contentDigest) : undefined;
}

export async function createStoredAssetTransportRecord(
  record: StoredAssetRecord,
  request: BoundedAssetTransportRequest,
): Promise<StoredAssetRecord | undefined> {
  if (!isValidTransportRequest(request)) return undefined;
  const asset = inspectStoredAssetForBoundedRead(record, request.maxBytes);
  if (!asset) return undefined;
  const contentDigest = await digestBoundedStoredAsset(asset);
  if (!contentDigest || storedAssetMetadata(asset, contentDigest).transportIdentity !== request.transportIdentity) {
    return undefined;
  }
  const dataUrl = asset.dataUrl ?? (asset.blob ? await blobToDataUrl(asset.blob, request.maxBytes) : undefined);
  return dataUrl ? {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    dataUrl,
    byteLength: asset.size,
    createdAt: asset.createdAt,
    transportRevision: asset.transportRevision,
  } : undefined;
}

export async function createStoredAssetTransportSample(
  record: StoredAssetRecord,
  request: BoundedAssetTransportRequest,
): Promise<SerializedBoundedAssetSample | undefined> {
  if (!isValidTransportRequest(request)) return undefined;
  const asset = record ? inspectStoredAssetForBoundedRead(record, request.maxBytes) : undefined;
  if (!asset) return undefined;
  const sample = await sampleBoundedStoredAsset(asset, request.sampleBytes);
  if (!sample) return undefined;
  const contentDigest = await digestBoundedStoredAsset(asset);
  if (!contentDigest) return undefined;
  const metadata = storedAssetMetadata(asset, contentDigest);
  if (metadata.transportIdentity !== request.transportIdentity) return undefined;
  return {
    id: asset.id,
    size: asset.size,
    mimeType: sample.mimeType ?? asset.mimeType,
    transportIdentity: metadata.transportIdentity,
    headBase64: bytesToBase64(sample.head),
    tailBase64: bytesToBase64(sample.tail),
    tailOffset: sample.tailOffset,
  };
}

function storedAssetMetadata(
  asset: BoundedStoredAssetPayload,
  contentDigest: string,
): StoredAssetMetadata {
  const core = {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    createdAt: asset.createdAt,
    transportRevision: asset.transportRevision ?? 'legacy',
    contentDigest,
  };
  return { ...core, transportIdentity: storedAssetTransportIdentity(core) };
}

function parseStoredAssetMetadata(value: unknown): StoredAssetMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<StoredAssetMetadata>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.mimeType === 'string'
    && Number.isSafeInteger(candidate.size)
    && Number.isSafeInteger(candidate.createdAt)
    && typeof candidate.transportRevision === 'string'
    && candidate.transportRevision.length > 0
    && candidate.transportRevision.length <= 256
    && typeof candidate.contentDigest === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(candidate.contentDigest)
    && typeof candidate.transportIdentity === 'string'
    && candidate.transportIdentity.length > 0
    && candidate.transportIdentity.length <= 256
    ? candidate as StoredAssetMetadata
    : undefined;
}

function storedAssetMetadataMatches(
  metadata: StoredAssetMetadata,
  asset: BoundedStoredAssetPayload,
): boolean {
  return metadata.id === asset.id
    && metadata.name === asset.name
    && metadata.mimeType === asset.mimeType
    && metadata.size === asset.size
    && metadata.createdAt === asset.createdAt
    && metadata.transportRevision === (asset.transportRevision ?? 'legacy');
}

async function loadRemoteImportedAssetSample(
  id: string,
  metadata: StoredAssetMetadata,
  request: BoundedAssetTransportRequest,
  route: 'asset' | 'source-asset' = 'asset',
  signal?: AbortSignal,
): Promise<BoundedStoredAssetSample | undefined> {
  throwIfAborted(signal);
  const res = await remoteHostFetch(assetTransportPath(`${route}-sample`, id, request), {
    signal,
    timeoutMs: ASSET_TRANSPORT_TIMEOUT_MS,
  });
  if (!res) return undefined;
  const value = await readBoundedJsonResponse(res, maxSampleResponseBytes(request.sampleBytes), signal);
  const sample = parseSerializedBoundedAssetSample(value, request.sampleBytes);
  return sample
    && sample.id === metadata.id
    && sample.sample.size === metadata.size
    && sample.mimeType === metadata.mimeType
    && sample.transportIdentity === metadata.transportIdentity
    ? sample.sample
    : undefined;
}

async function loadRemoteImportedAssetMaterialization(
  id: string,
  metadata: StoredAssetMetadata,
  request: BoundedAssetTransportRequest,
  expectedSample: BoundedStoredAssetSample,
  route: 'asset' | 'source-asset' = 'asset',
  signal?: AbortSignal,
): Promise<BoundedStoredAssetMaterialization | undefined> {
  throwIfAborted(signal);
  const res = await remoteHostFetch(assetTransportPath(route, id, request), {
    signal,
    timeoutMs: ASSET_TRANSPORT_TIMEOUT_MS,
  });
  if (!res) return undefined;
  const value = await readBoundedJsonResponse(res, maxPayloadResponseBytes(metadata.size), signal);
  if (!value || typeof value !== 'object') return undefined;
  const remoteAsset = inspectStoredAssetForBoundedRead(value as StoredAssetRecord, request.maxBytes);
  if (!remoteAsset || !storedAssetMetadataMatches(metadata, remoteAsset)) return undefined;
  const contentDigest = await digestBoundedStoredAsset(remoteAsset, signal);
  if (!contentDigest || contentDigest !== metadata.contentDigest) return undefined;
  const actualSample = await sampleBoundedStoredAsset(remoteAsset, request.sampleBytes, signal);
  if (!actualSample || !boundedSamplesEqual(expectedSample, actualSample)) return undefined;
  throwIfAborted(signal);
  return { dataUrl: remoteAsset.dataUrl, blob: remoteAsset.blob };
}

function assetTransportPath(
  route: 'asset' | 'asset-sample' | 'source-asset' | 'source-asset-sample',
  id: string,
  request: BoundedAssetTransportRequest,
): string {
  const query = new URLSearchParams({
    maxBytes: String(request.maxBytes),
    sampleBytes: String(request.sampleBytes),
    transportIdentity: request.transportIdentity,
  });
  return `/${route}/${encodeURIComponent(id)}?${query.toString()}`;
}

async function loadRemoteBoundedAssetForRead(
  route: 'asset' | 'source-asset',
  id: string,
  maxBytes: number,
  sampleBytes: number,
  signal?: AbortSignal,
): Promise<BoundedStoredAssetPayload | undefined> {
  const metadata = await loadRemoteImportedAssetMetadata(id, route, signal);
  if (!metadata || metadata.size <= 0 || metadata.size > maxBytes) return undefined;
  const request = {
    maxBytes,
    sampleBytes,
    transportIdentity: metadata.transportIdentity,
  } satisfies BoundedAssetTransportRequest;
  const sample = await loadRemoteImportedAssetSample(id, metadata, request, route, signal);
  if (!sample) return undefined;
  return {
    id: metadata.id,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    createdAt: metadata.createdAt,
    transportRevision: metadata.transportRevision,
    contentDigest: metadata.contentDigest,
    sample,
    materialize: () => loadRemoteImportedAssetMaterialization(
      id, metadata, request, sample, route, signal,
    ),
  };
}

function parseSerializedBoundedAssetSample(
  value: unknown,
  sampleBytes: number,
): ({ id: string; mimeType: string; transportIdentity: string; sample: BoundedStoredAssetSample }) | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SerializedBoundedAssetSample>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.mimeType !== 'string'
    || typeof candidate.transportIdentity !== 'string'
    || typeof candidate.headBase64 !== 'string'
    || typeof candidate.tailBase64 !== 'string'
    || !Number.isSafeInteger(candidate.size)
    || !Number.isSafeInteger(candidate.tailOffset)
  ) return undefined;
  const head = base64ToBytes(candidate.headBase64, sampleBytes);
  const tail = base64ToBytes(candidate.tailBase64, sampleBytes);
  const size = candidate.size as number;
  const tailOffset = candidate.tailOffset as number;
  if (!head || !tail || size <= 0 || head.length > size || tail.length > size) return undefined;
  if (tailOffset < 0 || tailOffset + tail.length !== size) return undefined;
  return {
    id: candidate.id,
    mimeType: candidate.mimeType,
    transportIdentity: candidate.transportIdentity,
    sample: { head, tail, size, tailOffset, mimeType: candidate.mimeType },
  };
}

async function sampleBoundedStoredAsset(
  asset: BoundedStoredAssetPayload,
  sampleBytes: number,
  signal?: AbortSignal,
): Promise<BoundedStoredAssetSample | undefined> {
  throwIfAborted(signal);
  const dataUrlSample = asset.dataUrl
    ? sampleBase64DataUrl(asset.dataUrl, asset.size, sampleBytes)
    : undefined;
  if (asset.dataUrl && (!dataUrlSample || dataUrlSample.size !== asset.size)) return undefined;

  let blobSample: BoundedStoredAssetSample | undefined;
  if (asset.blob) {
    const headLength = Math.min(asset.size, sampleBytes);
    const tailOffset = Math.max(0, asset.size - sampleBytes);
    const [head, tail] = await Promise.all([
      readBlobSlice(asset.blob, 0, headLength, signal),
      readBlobSlice(asset.blob, tailOffset, asset.size, signal),
    ]);
    blobSample = { head, tail, size: asset.size, tailOffset, mimeType: asset.blob.type || undefined };
  }
  throwIfAborted(signal);

  const normalizedDataUrlSample = dataUrlSample ? {
    head: dataUrlSample.head,
    tail: dataUrlSample.tail,
    size: dataUrlSample.size,
    tailOffset: dataUrlSample.tailOffset,
    mimeType: dataUrlSample.mimeType,
  } : undefined;
  if (blobSample && normalizedDataUrlSample && !boundedSamplesEqual(blobSample, normalizedDataUrlSample)) {
    return undefined;
  }
  return blobSample ?? normalizedDataUrlSample;
}

async function readBlobSlice(
  blob: Blob,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const buffer = await withAbort(blobArrayBuffer(blob.slice(start, end)), signal);
  throwIfAborted(signal);
  return new Uint8Array(buffer);
}

function boundedSamplesEqual(left: BoundedStoredAssetSample, right: BoundedStoredAssetSample): boolean {
  return left.size === right.size
    && left.tailOffset === right.tailOffset
    && bytesEqual(left.head, right.head)
    && bytesEqual(left.tail, right.tail);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function storedAssetTransportIdentity(
  asset: Omit<StoredAssetMetadata, 'transportIdentity'>,
): string {
  const input = `${asset.id}\u0000${asset.name}\u0000${asset.mimeType}\u0000${asset.size}\u0000${asset.createdAt}\u0000${asset.transportRevision}\u0000${asset.contentDigest}`;
  return `sha256:${sha256Hex(sha256(new TextEncoder().encode(input)))}`;
}

function maxPayloadResponseBytes(size: number): number {
  const encodedBytes = 4 * Math.ceil(size / 3);
  return Math.min(Number.MAX_SAFE_INTEGER, encodedBytes + MAX_TRANSPORT_OVERHEAD_BYTES);
}

function maxSampleResponseBytes(sampleBytes: number): number {
  return (8 * Math.ceil(sampleBytes / 3)) + MAX_TRANSPORT_OVERHEAD_BYTES;
}

function isValidBoundedReadLimits(maxBytes: number, sampleBytes: number): boolean {
  return Number.isSafeInteger(maxBytes)
    && maxBytes > 0
    && maxBytes <= MAX_BINARY_RESUME_BYTES
    && Number.isSafeInteger(sampleBytes)
    && sampleBytes > 0
    && sampleBytes <= BINARY_RESUME_SAMPLE_BYTES;
}

function isValidTransportRequest(value: BoundedAssetTransportRequest): boolean {
  return isValidBoundedReadLimits(value.maxBytes, value.sampleBytes)
    && value.sampleBytes <= value.maxBytes
    && typeof value.transportIdentity === 'string'
    && value.transportIdentity.length > 0
    && value.transportIdentity.length <= 256;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string, maxBytes: number): Uint8Array | undefined {
  if (value.length > 4 * Math.ceil(maxBytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined;
  try {
    const decoded = atob(value);
    if (decoded.length > maxBytes) return undefined;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function boundedStoredAssetIdentity(asset: BoundedStoredAssetPayload): string {
  return `${asset.createdAt}\u0000${asset.size}\u0000${asset.name}\u0000${asset.mimeType}\u0000${asset.transportRevision ?? 'legacy'}\u0000${asset.contentDigest ?? 'unknown'}`;
}

function retireBoundedStoredAssetUrls(id: string): void {
  const entries = boundedBlobObjectUrls.get(id);
  if (!entries) return;
  for (const entry of [...entries]) {
    entry.retired = true;
    if (entry.refCount === 0) revokeBoundedStoredAssetEntry(id, entry);
  }
}

function revokeBoundedStoredAssetEntry(id: string, entry: BoundedBlobObjectUrlEntry): void {
  if (entry.revoked) return;
  entry.revoked = true;
  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    // Object URL cleanup is best effort; the entry is still evicted exactly once.
  }
  const remaining = boundedBlobObjectUrls.get(id)?.filter((candidate) => candidate !== entry) ?? [];
  if (remaining.length > 0) boundedBlobObjectUrls.set(id, remaining);
  else boundedBlobObjectUrls.delete(id);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException('The run was cancelled.', 'AbortError');
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function dataUrlToBlob(dataUrl: string, fallbackMimeType: string): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  const analysis = visitBase64DataUrlBytes(dataUrl, MAX_BINARY_RESUME_BYTES, (bytes) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    chunks.push(copy.buffer);
  });
  if (!analysis) throw new Error('The asset data URL is malformed or exceeds the decoded byte limit.');
  return new Blob(chunks, { type: analysis.mimeType || fallbackMimeType });
}

async function blobToDataUrl(blob: Blob, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (blob.size <= 0 || blob.size > maxBytes) throw new Error('The asset exceeds the decoded byte limit.');
  const parts: string[] = [];
  for (let offset = 0; offset < blob.size; offset += ASSET_STREAM_CHUNK_BYTES) {
    throwIfAborted(signal);
    const bytes = new Uint8Array(await withAbort(
      blobArrayBuffer(blob.slice(offset, Math.min(blob.size, offset + ASSET_STREAM_CHUNK_BYTES))),
      signal,
    ));
    parts.push(bytesToBase64(bytes));
  }
  throwIfAborted(signal);
  return `data:${blob.type || 'application/octet-stream'};base64,${parts.join('')}`;
}

async function digestBoundedStoredAsset(
  asset: BoundedStoredAssetPayload,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const digests: string[] = [];
  if (asset.dataUrl) {
    const hash = sha256.create();
    const analysis = visitBase64DataUrlBytes(asset.dataUrl, asset.size, (bytes) => {
      throwIfAborted(signal);
      hash.update(bytes);
    });
    if (!analysis || analysis.size !== asset.size) return undefined;
    digests.push(`sha256:${sha256Hex(hash.digest())}`);
  }
  if (asset.blob) {
    const hash = sha256.create();
    for (let offset = 0; offset < asset.size; offset += ASSET_STREAM_CHUNK_BYTES) {
      throwIfAborted(signal);
      const buffer = await withAbort(blobArrayBuffer(asset.blob.slice(
        offset,
        Math.min(asset.size, offset + ASSET_STREAM_CHUNK_BYTES),
      )), signal);
      hash.update(new Uint8Array(buffer));
    }
    digests.push(`sha256:${sha256Hex(hash.digest())}`);
  }
  if (digests.length === 0 || digests.some((digest) => digest !== digests[0])) return undefined;
  return digests[0];
}

function sha256Hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the asset blob.'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('The asset blob did not produce binary bytes.'));
    };
    reader.readAsArrayBuffer(blob);
  });
}
