import { IDBFactory } from 'fake-indexeddb';
import { sha256 } from '@noble/hashes/sha2.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remote: false,
  remoteHostFetch: vi.fn(),
  lanHandlers: {} as Record<string, (...args: never[]) => unknown>,
}));

vi.mock('./projectLibrary', () => ({
  isRemoteLanClient: () => mocks.remote,
}));

vi.mock('./remoteHostClient', () => ({
  isServedLanSession: () => mocks.remote,
  remoteHostFetch: mocks.remoteHostFetch,
}));

vi.mock('./androidLanServer', () => ({
  initializeLanServerProxy: (handlers: Record<string, (...args: never[]) => unknown>) => {
    Object.assign(mocks.lanHandlers, handlers);
  },
}));

import {
  deleteImportedAsset,
  inspectStoredAssetForBoundedRead,
  loadImportedAssetForBoundedRead,
  loadRemoteSourceAssetForBoundedRead,
  materializeBoundedStoredAssetUrl,
  materializeStoredAssetPayload,
  persistAssetRecord,
  releaseBoundedStoredAssetUrl,
  type StoredAssetRecord,
} from './assetStore';

const originalIndexedDb = globalThis.indexedDB;
const originalWindow = globalThis.window;

function jsonResponse(value: unknown, contentLength?: number): Response {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: contentLength === undefined ? {} : { 'content-length': String(contentLength) },
  });
}

function metadata(overrides: Record<string, unknown> = {}) {
  const core = {
    id: 'asset-lan-1',
    name: 'cached.png',
    mimeType: 'image/png',
    size: 3,
    createdAt: 1,
    transportRevision: 'revision-1',
  };
  return {
    ...core,
    contentDigest: contentDigest(new TextEncoder().encode('ABC')),
    transportIdentity: transportIdentity(core),
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-lan-1',
    name: 'cached.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,QUJD',
    byteLength: 3,
    createdAt: 1,
    transportRevision: 'revision-1',
    ...overrides,
  };
}

function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-lan-1',
    size: 3,
    mimeType: 'image/png',
    transportIdentity: metadata().transportIdentity,
    headBase64: 'QUJD',
    tailBase64: 'QUJD',
    tailOffset: 0,
    ...overrides,
  };
}

function transportIdentity(
  value: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    createdAt: number;
    transportRevision?: string;
  },
): string {
  const digest = contentDigest(new TextEncoder().encode('ABC'));
  const input = `${value.id}\u0000${value.name}\u0000${value.mimeType}\u0000${value.size}\u0000${value.createdAt}\u0000${value.transportRevision ?? 'revision-1'}\u0000${digest}`;
  return contentDigest(new TextEncoder().encode(input));
}

function contentDigest(bytes: Uint8Array): string {
  return `sha256:${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

beforeAll(() => {
  const indexedDB = new IDBFactory();
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: indexedDB,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { indexedDB },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: originalIndexedDb,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

beforeEach(() => {
  mocks.remote = false;
  mocks.remoteHostFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('materializeStoredAssetPayload', () => {
  it('keeps legacy data-url records readable', () => {
    const record: StoredAssetRecord = {
      id: 'asset-1',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      dataUrl: 'data:video/mp4;base64,AAA',
      createdAt: 1,
    };

    expect(materializeStoredAssetPayload(record, () => 'blob:unused')).toEqual({
      id: 'asset-1',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      dataUrl: 'data:video/mp4;base64,AAA',
    });
  });

  it('uses object URLs for blob-backed records so large media is not held as base64 strings', () => {
    const record: StoredAssetRecord = {
      id: 'asset-1',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      blob: new Blob(['video-bytes'], { type: 'video/mp4' }),
      createdAt: 1,
    };

    expect(materializeStoredAssetPayload(record, () => 'blob:clip-object-url')).toEqual({
      id: 'asset-1',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      dataUrl: 'blob:clip-object-url',
    });
  });
});

describe('bounded stored asset access', () => {
  it('rejects a data-url-only record from decoded length before any decoder or reader runs', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const record: StoredAssetRecord = {
      id: 'asset-data-only',
      name: 'cached.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,QUJDREVGR0hJ',
      createdAt: 1,
    };

    expect(inspectStoredAssetForBoundedRead(record, 8)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ['invalid alphabet', 'data:image/png;base64,QUJD$A=='],
    ['interior padding', 'data:image/png;base64,QU=JDQ=='],
    ['too much padding', 'data:image/png;base64,QQ==='],
    ['non-canonical padded bits', 'data:image/png;base64,QR=='],
  ])('rejects malformed base64 metadata without decoding: %s', (_label, dataUrl) => {
    expect(inspectStoredAssetForBoundedRead({
      id: 'asset-malformed',
      name: 'cached.png',
      mimeType: 'image/png',
      dataUrl,
      createdAt: 1,
    }, 32)).toBeUndefined();
  });

  it('accepts bounded ASCII whitespace and exact padding while preserving the original data URL', () => {
    const dataUrl = 'data:image/png;base64, Q U J D\nR A = = ';
    const inspected = inspectStoredAssetForBoundedRead({
      id: 'asset-whitespace',
      name: 'cached.png',
      mimeType: 'image/png',
      dataUrl,
      byteLength: 4,
      createdAt: 1,
    }, 4);

    expect(inspected).toMatchObject({ size: 4, dataUrl });
  });

  it('fails closed on stale declared length and Blob/data-url disagreement', () => {
    const blob = new Blob(['ABCD'], { type: 'image/png' });
    expect(inspectStoredAssetForBoundedRead({
      id: 'asset-stale',
      name: 'cached.png',
      mimeType: 'image/png',
      blob,
      byteLength: 3,
      createdAt: 1,
    }, 8)).toBeUndefined();
    expect(inspectStoredAssetForBoundedRead({
      id: 'asset-disagree',
      name: 'cached.png',
      mimeType: 'image/png',
      blob,
      dataUrl: 'data:image/png;base64,QUJD',
      createdAt: 1,
    }, 8)).toBeUndefined();
  });

  it('rejects an over-limit Blob from declared size without slicing or reading it', () => {
    const slice = vi.fn();
    const blob = { size: 9, type: 'image/png', slice } as unknown as Blob;
    expect(inspectStoredAssetForBoundedRead({
      id: 'asset-large-blob',
      name: 'cached.png',
      mimeType: 'image/png',
      blob,
      createdAt: 1,
    }, 8)).toBeUndefined();
    expect(slice).not.toHaveBeenCalled();
  });

  it('hands accepted Blob-backed assets off through one object URL without FileReader', () => {
    const blob = new Blob(['ABCD'], { type: 'image/png' });
    const inspected = inspectStoredAssetForBoundedRead({
      id: 'asset-blob',
      name: 'cached.png',
      mimeType: 'image/png',
      blob,
      byteLength: 4,
      createdAt: 1,
    }, 4);
    const createObjectUrl = vi.fn(() => 'blob:bounded-handoff');

    expect(inspected).toBeDefined();
    expect(materializeBoundedStoredAssetUrl(inspected!, createObjectUrl)).toBe('blob:bounded-handoff');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
  });

  it('reuses one owned URL for distinct IndexedDB Blob identities of the same durable asset', () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:durable-asset')
      .mockReturnValueOnce('blob:unexpected-duplicate');
    const first = inspectStoredAssetForBoundedRead({
      id: 'asset-durable', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['ABCD'], { type: 'image/png' }), byteLength: 4, createdAt: 7,
    }, 8)!;
    const second = inspectStoredAssetForBoundedRead({
      id: 'asset-durable', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['ABCD'], { type: 'image/png' }), byteLength: 4, createdAt: 7,
    }, 8)!;

    const firstUrl = materializeBoundedStoredAssetUrl(first)!;
    const secondUrl = materializeBoundedStoredAssetUrl(second)!;
    expect(firstUrl).toBe('blob:durable-asset');
    expect(secondUrl).toBe('blob:durable-asset');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    releaseBoundedStoredAssetUrl(first.id, firstUrl);
    releaseBoundedStoredAssetUrl(second.id, secondUrl);
    createObjectUrl.mockRestore();
  });

  it('defers replacement revocation until every consumer releases, then revokes exactly once', async () => {
    const module = await import('./assetStore') as typeof import('./assetStore') & {
      releaseBoundedStoredAssetUrl?: (id: string, url: string) => void;
    };
    expect(module.releaseBoundedStoredAssetUrl).toBeTypeOf('function');

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:generation-one')
      .mockReturnValueOnce('blob:generation-two');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const first = inspectStoredAssetForBoundedRead({
      id: 'asset-replaced', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['OLD!'], { type: 'image/png' }), byteLength: 4, createdAt: 1,
    }, 8)!;
    const replacement = inspectStoredAssetForBoundedRead({
      id: 'asset-replaced', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['NEW!'], { type: 'image/png' }), byteLength: 4, createdAt: 2,
    }, 8)!;

    const firstUrl = materializeBoundedStoredAssetUrl(first);
    expect(materializeBoundedStoredAssetUrl(first)).toBe(firstUrl);
    const replacementUrl = materializeBoundedStoredAssetUrl(replacement);
    expect(replacementUrl).toBe('blob:generation-two');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith(firstUrl);

    module.releaseBoundedStoredAssetUrl!('asset-replaced', firstUrl!);
    expect(revokeObjectUrl).not.toHaveBeenCalledWith(firstUrl);
    module.releaseBoundedStoredAssetUrl!('asset-replaced', firstUrl!);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(firstUrl);

    module.releaseBoundedStoredAssetUrl!('asset-replaced', replacementUrl!);
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('retires a deleted asset URL without revoking before its consumer releases', async () => {
    const module = await import('./assetStore') as typeof import('./assetStore') & {
      releaseBoundedStoredAssetUrl?: (id: string, url: string) => void;
    };
    expect(module.releaseBoundedStoredAssetUrl).toBeTypeOf('function');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:delete-owned');
    const record: StoredAssetRecord = {
      id: 'asset-delete-owned', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['ABCD'], { type: 'image/png' }), byteLength: 4, createdAt: 1,
    };
    await persistAssetRecord(record);
    const asset = inspectStoredAssetForBoundedRead(record, 8)!;
    const url = materializeBoundedStoredAssetUrl(asset)!;

    await deleteImportedAsset(record.id);
    expect(revokeObjectUrl).not.toHaveBeenCalledWith(url);
    module.releaseBoundedStoredAssetUrl!(record.id, url);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(url);
    revokeObjectUrl.mockRestore();
  });

  it('retires every cached generation on store reset and waits for active consumers', async () => {
    const module = await import('./assetStore');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reset-owned');
    const asset = inspectStoredAssetForBoundedRead({
      id: 'asset-reset-owned', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['ABCD'], { type: 'image/png' }), byteLength: 4, createdAt: 1,
    }, 8)!;
    const url = materializeBoundedStoredAssetUrl(asset)!;

    module.resetImportedAssetObjectUrls();
    expect(revokeObjectUrl).not.toHaveBeenCalledWith(url);
    module.releaseBoundedStoredAssetUrl(asset.id, url);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(url);
    revokeObjectUrl.mockRestore();
  });
});

describe('bounded LAN asset transport', () => {
  it('rejects universal source metadata above the decoded ceiling before sample or full materialization', async () => {
    mocks.remote = true;
    const oversized = metadata({ size: 9 });
    const response = jsonResponse(oversized, JSON.stringify(oversized).length);
    mocks.remoteHostFetch.mockResolvedValueOnce(response);

    await expect(loadRemoteSourceAssetForBoundedRead('source-too-large', 8, 4)).resolves.toBeUndefined();
    expect(mocks.remoteHostFetch).toHaveBeenCalledTimes(1);
    expect(mocks.remoteHostFetch).toHaveBeenCalledWith(
      '/source-asset-metadata/source-too-large',
      expect.any(Object),
    );
  });

  it('accepts a fixed-length identity-bound sample before materializing the fixed-length payload', async () => {
    mocks.remote = true;
    const core = { id: 'asset-lan-1', name: 'cached.png', mimeType: 'image/png', size: 3, createdAt: 1 };
    const identity = transportIdentity(core);
    const metadataValue = metadata({ transportIdentity: identity });
    const sampleValue = samplePayload({ transportIdentity: identity });
    const responses = [
      jsonResponse(metadataValue, JSON.stringify(metadataValue).length),
      jsonResponse(sampleValue, JSON.stringify(sampleValue).length),
      jsonResponse(payload(), JSON.stringify(payload()).length),
    ];
    const jsonSpies = responses.map((response) => vi.spyOn(response, 'json'));
    mocks.remoteHostFetch
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1])
      .mockResolvedValueOnce(responses[2]);

    const asset = await loadImportedAssetForBoundedRead('asset-lan-1', 8, 4);
    expect(asset?.sample).toMatchObject({ size: 3, tailOffset: 0 });
    await expect(asset?.materialize?.()).resolves.toMatchObject({
      dataUrl: 'data:image/png;base64,QUJD',
    });
    for (const jsonSpy of jsonSpies) expect(jsonSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['oversized', 536_870_913],
    ['lying', 1],
    ['missing', undefined],
  ])('rejects an %s payload Content-Length without response.json()', async (_label, payloadLength) => {
    mocks.remote = true;
    const metadataResponse = jsonResponse(metadata(), JSON.stringify(metadata()).length);
    const sampleResponse = jsonResponse(samplePayload(), JSON.stringify(samplePayload()).length);
    const payloadResponse = jsonResponse(payload(), payloadLength);
    const metadataJson = vi.spyOn(metadataResponse, 'json');
    const payloadJson = vi.spyOn(payloadResponse, 'json');
    mocks.remoteHostFetch
      .mockResolvedValueOnce(metadataResponse)
      .mockResolvedValueOnce(sampleResponse)
      .mockResolvedValueOnce(payloadResponse);

    const asset = await loadImportedAssetForBoundedRead('asset-lan-1', 8);
    expect(asset).toBeDefined();
    await expect(asset?.materialize?.()).resolves.toBeUndefined();
    expect(metadataJson).not.toHaveBeenCalled();
    expect(payloadJson).not.toHaveBeenCalled();
  });

  it('rejects chunked JSON and cancels its body without invoking response.json()', async () => {
    mocks.remote = true;
    const metadataResponse = jsonResponse(metadata(), JSON.stringify(metadata()).length);
    const sampleResponse = jsonResponse(samplePayload(), JSON.stringify(samplePayload()).length);
    const cancel = vi.fn().mockResolvedValue(undefined);
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        if (closeTimer) clearTimeout(closeTimer);
        return cancel();
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(payload())));
        closeTimer = setTimeout(() => controller.close(), 50);
      },
    });
    const payloadResponse = new Response(body);
    const payloadJson = vi.spyOn(payloadResponse, 'json');
    mocks.remoteHostFetch
      .mockResolvedValueOnce(metadataResponse)
      .mockResolvedValueOnce(sampleResponse)
      .mockResolvedValueOnce(payloadResponse);

    const asset = await loadImportedAssetForBoundedRead('asset-lan-1', 8);
    expect(asset).toBeDefined();
    await expect(asset?.materialize?.()).resolves.toBeUndefined();
    expect(payloadJson).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('fails closed on malformed bounded JSON without response.json()', async () => {
    mocks.remote = true;
    const malformed = '{"id":"asset-lan-1","dataUrl":';
    const metadataResponse = jsonResponse(metadata(), JSON.stringify(metadata()).length);
    const sampleResponse = jsonResponse(samplePayload(), JSON.stringify(samplePayload()).length);
    const payloadResponse = new Response(malformed, {
      headers: { 'content-length': String(malformed.length) },
    });
    const payloadJson = vi.spyOn(payloadResponse, 'json');
    mocks.remoteHostFetch
      .mockResolvedValueOnce(metadataResponse)
      .mockResolvedValueOnce(sampleResponse)
      .mockResolvedValueOnce(payloadResponse);

    const asset = await loadImportedAssetForBoundedRead('asset-lan-1', 8);
    expect(asset).toBeDefined();
    await expect(asset?.materialize?.()).resolves.toBeUndefined();
    expect(payloadJson).not.toHaveBeenCalled();
  });

  it('rejects metadata/sample size and identity races before requesting the payload', async () => {
    mocks.remote = true;
    const metadataResponse = jsonResponse(metadata(), JSON.stringify(metadata()).length);
    const racedSample = samplePayload({ size: 4, transportIdentity: 'revision-raced' });
    const sampleResponse = jsonResponse(racedSample, JSON.stringify(racedSample).length);
    mocks.remoteHostFetch
      .mockResolvedValueOnce(metadataResponse)
      .mockResolvedValueOnce(sampleResponse);

    await expect(loadImportedAssetForBoundedRead('asset-lan-1', 8, 4)).resolves.toBeUndefined();
    expect(mocks.remoteHostFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a bounded payload identity race without response.json()', async () => {
    mocks.remote = true;
    const metadataResponse = jsonResponse(metadata(), JSON.stringify(metadata()).length);
    const sampleResponse = jsonResponse(samplePayload(), JSON.stringify(samplePayload()).length);
    const racedPayload = payload({ createdAt: 2 });
    const payloadResponse = jsonResponse(racedPayload, JSON.stringify(racedPayload).length);
    const payloadJson = vi.spyOn(payloadResponse, 'json');
    mocks.remoteHostFetch
      .mockResolvedValueOnce(metadataResponse)
      .mockResolvedValueOnce(sampleResponse)
      .mockResolvedValueOnce(payloadResponse);

    const asset = await loadImportedAssetForBoundedRead('asset-lan-1', 8, 4);
    await expect(asset?.materialize?.()).resolves.toBeUndefined();
    expect(payloadJson).not.toHaveBeenCalled();
  });

  it('honors a pre-aborted LAN read before requesting or materializing a payload', async () => {
    mocks.remote = true;
    const controller = new AbortController();
    controller.abort();
    const boundedRead = loadImportedAssetForBoundedRead as unknown as (
      id: string,
      maxBytes: number,
      sampleBytes: number,
      signal: AbortSignal,
    ) => Promise<unknown>;

    await expect(boundedRead('asset-lan-1', 8, 4, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.remoteHostFetch).not.toHaveBeenCalled();
  });

  it('cancels an in-flight bounded payload exactly once on abort', async () => {
    mocks.remote = true;
    const controller = new AbortController();
    const metadataResponse = jsonResponse(metadata(), JSON.stringify(metadata()).length);
    const sampleResponse = jsonResponse(samplePayload(), JSON.stringify(samplePayload()).length);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const declaredPayload = JSON.stringify(payload());
    const payloadResponse = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode(declaredPayload.slice(0, 1)));
      },
    }), { headers: { 'content-length': String(declaredPayload.length) } });
    mocks.remoteHostFetch
      .mockResolvedValueOnce(metadataResponse)
      .mockResolvedValueOnce(sampleResponse)
      .mockResolvedValueOnce(payloadResponse);

    const asset = await loadImportedAssetForBoundedRead('asset-lan-1', 8, 4, controller.signal);
    const materialization = asset?.materialize?.();
    controller.abort();
    await expect(materialization).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('makes the native payload handler reject a metadata race before FileReader materialization', async () => {
    const readAsDataUrl = vi.fn();
    class GuardedFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() {
        readAsDataUrl();
        this.result = 'data:image/png;base64,TkVXIQ==';
        this.onload?.({} as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', GuardedFileReader);
    const getAsset = mocks.lanHandlers.getAsset as unknown as (
      id: string,
      request: { maxBytes: number; sampleBytes: number; transportIdentity: string },
    ) => Promise<unknown>;
    expect(getAsset).toBeTypeOf('function');
    await persistAssetRecord({
      id: 'asset-host-race', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['NEW!'], { type: 'image/png' }), byteLength: 4, createdAt: 2,
    });

    await expect(getAsset('asset-host-race', {
      maxBytes: 8,
      sampleBytes: 4,
      transportIdentity: 'asset-host-race:1:4:old',
    })).resolves.toBeUndefined();
    expect(readAsDataUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('bounds, hashes, and samples the native Blob before streaming one accepted data-URL materialization', async () => {
    const readAsDataUrl = vi.fn();
    class CountingFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() {
        readAsDataUrl();
        this.result = 'data:image/png;base64,QUJDRA==';
        this.onload?.({} as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', CountingFileReader);
    const id = 'asset-host-sampled';
    await persistAssetRecord({
      id, name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['ABCD'], { type: 'image/png' }), byteLength: 4, createdAt: 3,
    });
    const getMetadata = mocks.lanHandlers.getAssetMetadata as unknown as (id: string) => Promise<ReturnType<typeof metadata>>;
    const getSample = mocks.lanHandlers.getAssetSample as unknown as (
      id: string,
      request: { maxBytes: number; sampleBytes: number; transportIdentity: string },
    ) => Promise<{ headBase64: string; tailBase64: string } | undefined>;
    const getAsset = mocks.lanHandlers.getAsset as unknown as (
      id: string,
      request: { maxBytes: number; sampleBytes: number; transportIdentity: string },
    ) => Promise<StoredAssetRecord | undefined>;
    const hostMetadata = await getMetadata(id);
    const request = {
      maxBytes: 4,
      sampleBytes: 2,
      transportIdentity: hostMetadata.transportIdentity as string,
    };

    await expect(getSample(id, request)).resolves.toMatchObject({
      headBase64: 'QUI=', tailBase64: 'Q0Q=',
    });
    expect(readAsDataUrl).not.toHaveBeenCalled();
    await expect(getAsset(id, request)).resolves.toMatchObject({
      dataUrl: 'data:image/png;base64,QUJDRA==', byteLength: 4,
    });
    expect(readAsDataUrl).not.toHaveBeenCalled();
  });

  it('rejects a native Blob over the caller ceiling before FileReader materialization', async () => {
    const readAsDataUrl = vi.fn();
    vi.stubGlobal('FileReader', class { readAsDataURL = readAsDataUrl; });
    const id = 'asset-host-over-limit';
    await persistAssetRecord({
      id, name: 'cached.png', mimeType: 'image/png',
      blob: new Blob(['ABCD'], { type: 'image/png' }), byteLength: 4, createdAt: 4,
    });
    const getAsset = mocks.lanHandlers.getAsset as unknown as (
      id: string,
      request: { maxBytes: number; sampleBytes: number; transportIdentity: string },
    ) => Promise<unknown>;

    await expect(getAsset(id, {
      maxBytes: 3, sampleBytes: 2, transportIdentity: 'untrusted',
    })).resolves.toBeUndefined();
    expect(readAsDataUrl).not.toHaveBeenCalled();
  });

  it('rejects a same-metadata byte replacement before FileReader materialization', async () => {
    const readAsDataUrl = vi.fn();
    vi.stubGlobal('FileReader', class { readAsDataURL = readAsDataUrl; });
    const id = 'asset-host-byte-race';
    const common = { id, name: 'cached.png', mimeType: 'image/png', byteLength: 4, createdAt: 5 };
    await persistAssetRecord({
      ...common,
      blob: new Blob(['ABCD'], { type: 'image/png' }),
    });
    const getMetadata = mocks.lanHandlers.getAssetMetadata as unknown as (
      id: string,
    ) => Promise<{ transportIdentity: string }>;
    const originalMetadata = await getMetadata(id);
    await persistAssetRecord({
      ...common,
      blob: new Blob(['WXYZ'], { type: 'image/png' }),
    });
    const getAsset = mocks.lanHandlers.getAsset as unknown as (
      id: string,
      request: { maxBytes: number; sampleBytes: number; transportIdentity: string },
    ) => Promise<unknown>;

    await expect(getAsset(id, {
      maxBytes: 4,
      sampleBytes: 2,
      transportIdentity: originalMetadata.transportIdentity,
    })).resolves.toBeUndefined();
    expect(readAsDataUrl).not.toHaveBeenCalled();
  });

  it('rejects a same-size middle-byte replacement with unchanged metadata and transport revision', async () => {
    const readAsDataUrl = vi.fn();
    vi.stubGlobal('FileReader', class {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() {
        readAsDataUrl();
        this.result = 'data:image/png;base64,QUJD';
        this.onload?.({} as ProgressEvent<FileReader>);
      }
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000017');
    const id = 'asset-host-middle-byte-race';
    const size = (2 * 256 * 1024) + 1;
    const original = new Uint8Array(size).fill(0x41);
    const replacement = original.slice();
    replacement[256 * 1024] = 0x42;
    const common = { id, name: 'cached.png', mimeType: 'image/png', byteLength: size, createdAt: 17 };
    await persistAssetRecord({ ...common, blob: new Blob([original], { type: 'image/png' }) });
    const getMetadata = mocks.lanHandlers.getAssetMetadata as unknown as (
      id: string,
    ) => Promise<{ transportIdentity: string }>;
    const originalMetadata = await getMetadata(id);

    await persistAssetRecord({ ...common, blob: new Blob([replacement], { type: 'image/png' }) });
    const getAsset = mocks.lanHandlers.getAsset as unknown as (
      id: string,
      request: { maxBytes: number; sampleBytes: number; transportIdentity: string },
    ) => Promise<unknown>;

    await expect(getAsset(id, {
      maxBytes: size,
      sampleBytes: 64,
      transportIdentity: originalMetadata.transportIdentity,
    })).resolves.toBeUndefined();
    expect(readAsDataUrl).not.toHaveBeenCalled();
  });
});
