import {
  loadImportedAssetForBoundedRead,
  materializeBoundedStoredAssetUrl,
  releaseBoundedStoredAssetUrl,
} from './assetStore';
import { sampleBase64DataUrl } from './boundedDataUrl';
import { cancelResponseBody } from './boundedResponse';
import {
  BINARY_RESUME_SAMPLE_BYTES,
  MAX_BINARY_RESUME_BYTES,
  binaryMimeMatches,
  sniffBinaryResumeSample,
  type BinaryResumeKind,
  type BinaryResumeSample,
} from './binaryResumeSniffer';
import { resultTypeForSourceKind } from './flowNodeResultRestore';
import { inferMimeTypeFromFile } from './mediaFormatRegistry';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { ResultType } from '../types/flow';

export interface ValidatedSourceBinResume {
  item: SourceBinLibraryItem;
  kind: ResultType;
  value: string;
  mimeType: string;
  /** Identity of the bounded content that validation actually checked. */
  proof: string;
  release?: () => void;
}

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;
const DIRECT_SAMPLE_TIMEOUT_MS = 15_000;
interface SampledBinary {
  sample: BinaryResumeSample;
  mimeType?: string;
  validator?: string;
}

export interface SourceBinResumeValidationOptions {
  maxBinaryBytes?: number;
  sampleBytes?: number;
  materializeStoredAsset?: boolean;
}

interface SourceBinResumeLimits {
  maxBinaryBytes: number;
  sampleBytes: number;
}

export async function validateSourceBinResumeItem(
  item: SourceBinLibraryItem,
  expectedKind: ResultType,
  signal?: AbortSignal,
  options: SourceBinResumeValidationOptions = {},
): Promise<ValidatedSourceBinResume | undefined> {
  throwIfAborted(signal);
  const limits = normalizeLimits(options);
  if (!limits) return undefined;
  const kind = resultTypeForSourceKind(item.kind);
  if (!kind || kind !== expectedKind || !item.id.trim()) return undefined;

  if (kind === 'text') {
    const text = item.text;
    if (typeof text !== 'string' || text.trim().length === 0) return undefined;
    const mimeType = item.mimeType?.trim() || 'text/plain';
    return { item, kind, value: text, mimeType, proof: `text:${mimeType}:${text}` };
  }
  if (!isAssetResultKind(kind)) return undefined;

  const assetId = normalizeAssetId(item.assetId);
  if (item.assetId !== undefined && !assetId) return undefined;

  const direct = await validateAssetUrl(item, kind, assetId, limits, signal);
  if (direct) return { item, kind, value: direct.value, mimeType: direct.mimeType, proof: direct.proof };
  if (!assetId) return undefined;

  return validateStoredAsset(item, kind, assetId, limits, signal, options.materializeStoredAsset !== false);
}

async function validateStoredAsset(
  item: SourceBinLibraryItem,
  kind: BinaryResumeKind,
  assetId: string,
  limits: SourceBinResumeLimits,
  signal?: AbortSignal,
  materialize = true,
): Promise<ValidatedSourceBinResume | undefined> {
  const storedAsset = await withAbort(
    loadImportedAssetForBoundedRead(
      assetId,
      limits.maxBinaryBytes,
      limits.sampleBytes,
      signal,
    ).catch((error) => {
      if (signal?.aborted) throw error;
      return undefined;
    }),
    signal,
  );
  if (!storedAsset || storedAsset.size <= 0 || storedAsset.size > limits.maxBinaryBytes) return undefined;

  const blobSample = storedAsset.sample ?? (storedAsset.blob
    ? await sampleBlob(storedAsset.blob, limits, signal)
    : undefined);
  if (storedAsset.blob && !blobSample) return undefined;
  const storedData = storedAsset.dataUrl
    ? sampleDataUrl(storedAsset.dataUrl, limits)
    : undefined;
  if (storedAsset.dataUrl && !storedData) return undefined;
  if (!blobSample && !storedData) return undefined;
  if (blobSample && storedData && !samplesEqual(blobSample, storedData.sample)) return undefined;

  const sample = blobSample ?? storedData!.sample;
  if (sample.size !== storedAsset.size) return undefined;
  const detectedMimeType = validateSample(sample, kind, collectItemClaims(item, [
    storedAsset.mimeType,
    storedAsset.blob?.type,
    storedAsset.sample?.mimeType,
    storedData?.mimeType,
    inferMimeTypeFromFile(storedAsset.name),
  ]));
  if (!detectedMimeType) return undefined;

  if (!materialize) {
    return {
      item,
      kind,
      value: `signal-loom-asset://asset/${encodeURIComponent(storedAsset.id)}`,
      mimeType: detectedMimeType,
      proof: sampleProof(sample),
    };
  }

  throwIfAborted(signal);
  const materialized = storedAsset.materialize
    ? await withAbort(storedAsset.materialize(), signal)
    : { dataUrl: storedAsset.dataUrl, blob: storedAsset.blob };
  if (!materialized) return undefined;
  const materializedAsset = { ...storedAsset, ...materialized };
  const value = materializeBoundedStoredAssetUrl(materializedAsset);
  if (!value) return undefined;
  const release = materialized.blob
    ? once(() => releaseBoundedStoredAssetUrl(storedAsset.id, value))
    : undefined;
  try {
    throwIfAborted(signal);
    return { item, kind, value, mimeType: detectedMimeType, proof: sampleProof(sample), release };
  } catch (error) {
    release?.();
    throw error;
  }
}

async function validateAssetUrl(
  item: SourceBinLibraryItem,
  kind: BinaryResumeKind,
  assetId: string | undefined,
  limits: SourceBinResumeLimits,
  signal?: AbortSignal,
): Promise<{ value: string; mimeType: string; proof: string } | undefined> {
  const value = item.assetUrl?.trim();
  if (!value) return undefined;

  if (value.startsWith('data:')) {
    const sampled = sampleDataUrl(value, limits);
    if (!sampled) return undefined;
    const mimeType = validateSample(sampled.sample, kind, collectItemClaims(item, [sampled.mimeType]));
    return mimeType ? { value, mimeType, proof: sampleProof(sampled.sample) } : undefined;
  }

  if (value.startsWith('signal-loom-asset:')) {
    if (!validateNativeAssetUrl(item, value, assetId)) return undefined;
  } else if (value.startsWith('capacitor:') || value.startsWith('file:') || value.includes('_capacitor_file_')) {
    if (!hasNativeLocation(item) || !isValidUrl(value)) return undefined;
  } else if (!value.startsWith('blob:') && !value.startsWith('http://') && !value.startsWith('https://')) {
    return undefined;
  }

  const sampled = await fetchBinarySample(value, kind, limits, signal);
  if (!sampled) return undefined;
  const mimeType = validateSample(sampled.sample, kind, collectItemClaims(item, [
    sampled.mimeType,
    inferMimeTypeFromFile(urlPath(value)),
  ]));
  return mimeType ? { value, mimeType, proof: sampleProof(sampled.sample, sampled.validator) } : undefined;
}

function sampleProof(sample: BinaryResumeSample, validator?: string): string {
  // Keep the exact bounded sample rather than a lossy hash. The proof is of
  // the bytes validation inspected, plus an HTTP validator when available.
  const encode = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${validator ?? ''}:${sample.size}:${sample.tailOffset}:${encode(sample.head)}:${encode(sample.tail)}`;
}

function validateSample(
  sample: BinaryResumeSample,
  kind: BinaryResumeKind,
  claims: readonly string[],
): string | undefined {
  const detectedMimeType = sniffBinaryResumeSample(sample, kind);
  return detectedMimeType && claims.every((claim) => binaryMimeMatches(detectedMimeType, claim))
    ? detectedMimeType
    : undefined;
}

function collectItemClaims(item: SourceBinLibraryItem, extra: readonly (string | undefined)[]): string[] {
  return [
    item.mimeType,
    inferMimeTypeFromFile(item.scratchFileName),
    inferMimeTypeFromFile(item.nativeFilePath),
    ...extra,
  ].flatMap((claim) => {
    const normalized = normalizeMimeType(claim);
    return normalized && normalized !== 'application/octet-stream' ? [normalized] : [];
  });
}

function sampleDataUrl(value: string, limits: SourceBinResumeLimits): SampledBinary | undefined {
  const sampled = sampleBase64DataUrl(value, limits.maxBinaryBytes, limits.sampleBytes);
  return sampled ? {
    mimeType: sampled.mimeType,
    sample: {
      head: sampled.head,
      tail: sampled.tail,
      size: sampled.size,
      tailOffset: sampled.tailOffset,
    },
  } : undefined;
}

async function sampleBlob(
  blob: Blob,
  limits: SourceBinResumeLimits,
  signal?: AbortSignal,
): Promise<BinaryResumeSample | undefined> {
  if (blob.size <= 0 || blob.size > limits.maxBinaryBytes) return undefined;
  throwIfAborted(signal);
  const headLength = Math.min(blob.size, limits.sampleBytes);
  const tailOffset = Math.max(0, blob.size - limits.sampleBytes);
  const [headBuffer, tailBuffer] = await withAbort(Promise.all([
    blobArrayBuffer(blob.slice(0, headLength)),
    blobArrayBuffer(blob.slice(tailOffset)),
  ]), signal);
  throwIfAborted(signal);
  return {
    head: new Uint8Array(headBuffer),
    tail: new Uint8Array(tailBuffer),
    size: blob.size,
    tailOffset,
  };
}

async function fetchBinarySample(
  value: string,
  kind: BinaryResumeKind,
  limits: SourceBinResumeLimits,
  signal?: AbortSignal,
): Promise<SampledBinary | undefined> {
  const first = await fetchBoundedRange(value, `bytes=0-${limits.sampleBytes - 1}`, limits, signal);
  if (!first || first.start !== 0) return undefined;
  if (first.totalSize !== undefined && first.totalSize > limits.maxBinaryBytes) return undefined;

  const size = first.complete ? first.bytes.length : first.totalSize;
  if (!size || size <= 0) return undefined;
  let tail = first.complete ? first.bytes : new Uint8Array();
  let tailOffset = first.complete ? 0 : size;

  const needsTail = !first.complete && (
    kind === 'package'
    || looksLikeIsoBmff(first.bytes)
    || looksLikeJpeg(first.bytes)
  );
  if (needsTail) {
    const last = await fetchBoundedRange(value, `bytes=-${limits.sampleBytes}`, limits, signal);
    if (
      !last
      || last.totalSize !== size
      || last.start <= 0
      || last.start + last.bytes.length !== size
      || last.mimeType !== first.mimeType
      || last.validator !== first.validator
    ) return undefined;
    tail = last.bytes;
    tailOffset = last.start;
  }

  return {
    mimeType: first.mimeType,
    validator: first.validator,
    sample: { head: first.bytes, tail, size, tailOffset },
  };
}

interface BoundedRange {
  bytes: Uint8Array;
  complete: boolean;
  start: number;
  totalSize?: number;
  mimeType?: string;
  validator?: string;
}

async function fetchBoundedRange(
  value: string,
  range: string,
  limits: SourceBinResumeLimits,
  signal?: AbortSignal,
): Promise<BoundedRange | undefined> {
  try {
    throwIfAborted(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), DIRECT_SAMPLE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(value, { signal: controller.signal, headers: { Range: range } });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      return undefined;
    }
    const contentRange = parseContentRange(response.headers.get('content-range'));
    const contentLength = parseNonNegativeInteger(response.headers.get('content-length'));
    if ((response.status === 206 && !contentRange) || (response.status !== 206 && contentRange)) {
      await cancelResponseBody(response);
      return undefined;
    }
    const rangeLength = contentRange ? contentRange.end - contentRange.start + 1 : undefined;
    if (
      (rangeLength !== undefined && rangeLength > limits.sampleBytes)
      || (rangeLength !== undefined && contentLength !== undefined && contentLength !== rangeLength)
    ) {
      await cancelResponseBody(response);
      return undefined;
    }
    const totalSize = contentRange?.total ?? (response.status === 200 ? contentLength : undefined);
    if (totalSize !== undefined && totalSize > limits.maxBinaryBytes) {
      await cancelResponseBody(response);
      return undefined;
    }
    const read = await readResponsePrefix(response, limits.sampleBytes, signal);
    if (!read || read.bytes.length === 0) return undefined;
    if (rangeLength !== undefined && read.bytes.length !== rangeLength) return undefined;
    if (response.status === 200 && contentLength !== undefined) {
      const expectedReadLength = Math.min(contentLength, limits.sampleBytes);
      if (read.bytes.length !== expectedReadLength) return undefined;
    }
    const complete = response.status === 200
      ? contentLength !== undefined
        ? contentLength <= limits.sampleBytes && read.bytes.length === contentLength
        : read.done
      : Boolean(contentRange && contentRange.start === 0 && contentRange.end + 1 === contentRange.total
        && read.bytes.length === contentRange.total);
    return {
      bytes: read.bytes,
      complete,
      start: contentRange?.start ?? 0,
      totalSize: complete ? read.bytes.length : totalSize,
      mimeType: normalizeMimeType(response.headers.get('content-type') ?? undefined),
      validator: responseValidator(response),
    };
  } catch {
    if (signal?.aborted) throw abortError();
    return undefined;
  }
}

function responseValidator(response: Response): string | undefined {
  const etag = response.headers.get('etag')?.trim();
  if (etag && !etag.startsWith('W/')) return `etag:${etag}`;
  const lastModified = response.headers.get('last-modified')?.trim();
  return lastModified ? `last-modified:${lastModified}` : undefined;
}

async function readResponsePrefix(
  response: Response,
  sampleBytes: number,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; done: boolean } | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  let done = false;
  try {
    while (length < sampleBytes) {
      throwIfAborted(signal);
      const read = await readWithDeadline(reader, signal, DIRECT_SAMPLE_TIMEOUT_MS);
      if (read.done) {
        done = true;
        break;
      }
      if (!read.value) continue;
      const remaining = sampleBytes - length;
      chunks.push(read.value.subarray(0, remaining));
      length += Math.min(read.value.length, remaining);
      if (read.value.length > remaining) break;
    }
  } finally {
    if (!done) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Cancellation cleanup must not replace the primary validation/timeout outcome.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A broken reader must not replace the primary validation/timeout outcome.
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, done };
}

function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('Direct asset sample read timed out.'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => { finish(); resolve(result); },
      (error) => { finish(); reject(error); },
    );
  });
}

function validateNativeAssetUrl(item: SourceBinLibraryItem, value: string, assetId: string | undefined): boolean {
  try {
    const url = new URL(value);
    const location = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim();
    if (!location) return false;
    if (url.hostname === 'asset') {
      const urlAssetId = normalizeAssetId(location);
      return Boolean(urlAssetId && (!assetId || assetId === urlAssetId) && (assetId || hasNativeLocation(item)));
    }
    if (url.hostname === 'file') return hasNativeLocation(item);
  } catch {
    return false;
  }
  return false;
}

function samplesEqual(left: BinaryResumeSample, right: BinaryResumeSample): boolean {
  return left.size === right.size
    && bytesEqual(left.head, right.head)
    && bytesEqual(left.tail, right.tail);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function looksLikeIsoBmff(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
}

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total)
    && start >= 0 && end >= start && end < total
    ? { start, end, total }
    : undefined;
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (!/^\d+$/.test(value ?? '')) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeAssetId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && ASSET_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeMimeType(value: string | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0].trim().toLowerCase();
  return normalized || undefined;
}

function normalizeLimits(options: SourceBinResumeValidationOptions): SourceBinResumeLimits | undefined {
  const maxBinaryBytes = options.maxBinaryBytes ?? MAX_BINARY_RESUME_BYTES;
  const sampleBytes = options.sampleBytes ?? BINARY_RESUME_SAMPLE_BYTES;
  if (
    !Number.isSafeInteger(maxBinaryBytes)
    || maxBinaryBytes <= 0
    || maxBinaryBytes > MAX_BINARY_RESUME_BYTES
    || !Number.isSafeInteger(sampleBytes)
    || sampleBytes <= 0
    || sampleBytes > BINARY_RESUME_SAMPLE_BYTES
  ) return undefined;
  return { maxBinaryBytes, sampleBytes: Math.min(sampleBytes, maxBinaryBytes) };
}

function urlPath(value: string): string | undefined {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return undefined;
  }
}

function hasNativeLocation(item: SourceBinLibraryItem): boolean {
  return Boolean(item.nativeFilePath?.trim() || item.scratchFileName?.trim());
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.pathname || url.hostname);
  } catch {
    return false;
  }
}

function isAssetResultKind(kind: ResultType): kind is BinaryResumeKind {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'package';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the resumed asset.'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('The resumed asset did not produce binary bytes.'));
    };
    reader.readAsArrayBuffer(blob);
  });
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

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}
