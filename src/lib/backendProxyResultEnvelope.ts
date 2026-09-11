import type { ResultType, UsageTelemetry, UsageTelemetryConfidence, UsageTelemetrySource } from '../types/flow';
import { NonRetryableError } from './exponentialBackoff';

/**
 * Versioned, serializable result-envelope contract for backend-proxy node execution (AUD-013).
 *
 * The proxy service is external — this repository ships no server implementation — so, exactly like
 * the outbound request DTO (see backendProxy.ts), this module IS the client-side half of the
 * contract: the only shape the client will reconstruct into a runtime `ExecutionResult`. Direct
 * execution can yield a primary result, a result type, a status, usage telemetry, MIME type,
 * extension, file name, JSON-safe output metadata, an optional binary Blob, and ordered additional
 * results. A proxied result is semantically equivalent only if every one of those survives, so the
 * envelope transports all of them explicitly and validates each before any expensive allocation.
 *
 * This VERSION is intentionally DISTINCT from the request-settings DTO version
 * (`BACKEND_PROXY_EXECUTION_SETTINGS_VERSION`): the outbound request shape and the inbound result
 * shape evolve independently and must not share a version counter.
 */
export const BACKEND_PROXY_RESULT_ENVELOPE_VERSION = 1;

/** Base64 is the only supported binary encoding. Declared alongside the bytes so the wire is self-describing. */
export interface BackendProxyResultBinary {
  encoding: 'base64';
  /** MIME type the reconstructed Blob must carry. */
  mimeType: string;
  /** Declared decoded byte length; validated against the actual base64 payload before allocation. */
  byteLength: number;
  /** Base64 (standard alphabet, padded) of the raw bytes. */
  data: string;
}

/**
 * The canonical wire shape a proxy must emit. Fields are FLAT (not nested under a container) so the
 * envelope is a strict superset of the historical unversioned response, and `envelopeVersion` is the
 * single unambiguous discriminator between the versioned and legacy contracts.
 *
 * `result` and `binary` may coexist, matching direct execution semantics (a local composition returns
 * both a primary media URL in `result` and the same asset's raw bytes as a `Blob`): when both are
 * present they describe the SAME primary asset — `result` is the usable value/URL, `binary` is that
 * asset's explicit byte representation. `binary` is never an object URL or a filesystem path.
 */
export interface BackendProxyResultEnvelope {
  envelopeVersion: typeof BACKEND_PROXY_RESULT_ENVELOPE_VERSION;
  result: string | boolean;
  resultType: ResultType;
  statusMessage?: string;
  usage?: UsageTelemetry;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  binary?: BackendProxyResultBinary;
  additionalResults?: Array<{ result: string; mimeType?: string }>;
  /** A processed provider error. When present the run is terminal — see decode. */
  error?: string;
}

/**
 * The reconstructed runtime shape. Structurally the store/envelope consumer's `ExecutionResult`:
 * `result` is the typed value (a real Boolean for Boolean ports, a string/URL otherwise), `blob` is
 * the reconstructed Blob when `binary` was supplied, and `additionalResults` preserves order.
 */
export interface DecodedBackendProxyResult {
  result: string | boolean;
  resultType: ResultType;
  statusMessage: string;
  usage?: UsageTelemetry;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  blob?: Blob;
  additionalResults?: Array<{ result: string; mimeType?: string }>;
}

/** Named, testable bounds enforced BEFORE expensive allocation/decoding. Injectable so tests can probe exact edges. */
export interface BackendProxyResultEnvelopeLimits {
  /** Maximum decoded bytes for a reconstructed Blob. Checked against the DECLARED length first, before decoding. */
  maxDecodedBinaryBytes: number;
  /** Maximum length of the base64 payload string, checked before it is decoded. */
  maxEncodedBinaryLength: number;
  /** Maximum number of ordered additional results. */
  maxAdditionalResults: number;
  /** Maximum length of the primary result string (a data/HTTPS URL for an asset). */
  maxResultValueLength: number;
  /**
   * Maximum length of any auxiliary (additional) result string. Deliberately smaller than the primary
   * cap: additional results are siblings, and `maxAdditionalResults × maxAdditionalResultValueLength`
   * is what dominates the reconciled overall wire cap ({@link MAX_BACKEND_PROXY_RESULT_WIRE_BYTES}).
   */
  maxAdditionalResultValueLength: number;
  maxStatusMessageLength: number;
  maxMimeTypeLength: number;
  maxExtensionLength: number;
  maxFileNameLength: number;
  /** Maximum object/array nesting depth for output metadata. */
  maxMetadataDepth: number;
  /** Maximum serialized (JSON) size of output metadata. */
  maxMetadataSerializedBytes: number;
  maxUsageNotes: number;
  maxNoteLength: number;
  /** Maximum length of a bounded usage string field (provider, modelId). */
  maxUsageStringLength: number;
}

export const DEFAULT_BACKEND_PROXY_RESULT_ENVELOPE_LIMITS: BackendProxyResultEnvelopeLimits = {
  maxDecodedBinaryBytes: 64 * 1024 * 1024,
  maxEncodedBinaryLength: Math.ceil((64 * 1024 * 1024) / 3) * 4,
  // Reconciled with MAX_BACKEND_PROXY_RESULT_WIRE_BYTES below: 16 additional siblings × 16 MiB each is
  // the dominant term, kept firmly sub-gigabyte. A single large primary asset still gets its own 96 MiB.
  maxAdditionalResults: 16,
  maxResultValueLength: 96 * 1024 * 1024,
  maxAdditionalResultValueLength: 16 * 1024 * 1024,
  maxStatusMessageLength: 8192,
  maxMimeTypeLength: 255,
  maxExtensionLength: 32,
  maxFileNameLength: 1024,
  maxMetadataDepth: 32,
  maxMetadataSerializedBytes: 1024 * 1024,
  maxUsageNotes: 128,
  maxNoteLength: 8192,
  maxUsageStringLength: 256,
};

/**
 * One named overall wire cap for a proxy result response, DERIVED from the field/count maxima so the
 * two can never drift: the streaming reader on the proxy route (see flowExecution.ts) rejects any wire
 * body larger than this BEFORE it is JSON-parsed. It is reconciled with the per-field/count bounds —
 * the sum of every field's maximum plus a fixed structural allowance — so those bounds cannot, even in
 * aggregate, describe a multi-gigabyte envelope. With the defaults this resolves to well under 512 MiB.
 */
function computeMaxWireBytes(limits: BackendProxyResultEnvelopeLimits): number {
  // JSON keys, punctuation, and the small scalar fields (status, MIME, extension, file name).
  const STRUCTURAL_OVERHEAD_BYTES = 256 * 1024;
  return (
    limits.maxResultValueLength
    + limits.maxEncodedBinaryLength
    + limits.maxAdditionalResults * limits.maxAdditionalResultValueLength
    + limits.maxMetadataSerializedBytes
    + STRUCTURAL_OVERHEAD_BYTES
  );
}

export const MAX_BACKEND_PROXY_RESULT_WIRE_BYTES = computeMaxWireBytes(DEFAULT_BACKEND_PROXY_RESULT_ENVELOPE_LIMITS);

const VALID_RESULT_TYPES = new Set<ResultType>([
  'text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope',
]);

/** Result types whose primary value is a media asset the store persists to the Source Library. */
const ASSET_RESULT_TYPES = new Set<ResultType>(['image', 'video', 'audio', 'package']);

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/** Assets must resolve to bytes the client already holds: data URLs or HTTPS(S). Never object URLs or file paths. */
const ASSET_URL_PATTERN = /^(?:data:|https?:)/i;

const USAGE_SOURCES = new Set<UsageTelemetrySource>(['estimate', 'actual']);
const USAGE_CONFIDENCES = new Set<UsageTelemetryConfidence>(['measured', 'heuristic', 'fixed', 'unknown']);
/** Count/token fields that must be non-negative integers (fractional tokens/images are never legitimate). */
const USAGE_INTEGER_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'characters', 'imageCount'] as const;
/** Cost/duration fields that must be finite and non-negative but may be fractional. */
const USAGE_DECIMAL_FIELDS = ['costUsd', 'durationSeconds'] as const;
/** The complete allowlist of usage keys; anything else fails closed rather than being cast through. */
const USAGE_ALLOWED_KEYS = new Set<string>([
  'source', 'confidence', 'provider', 'modelId', 'notes',
  ...USAGE_INTEGER_FIELDS, ...USAGE_DECIMAL_FIELDS,
]);

function fail(message: string): never {
  throw new NonRetryableError(message);
}

/** Media type token of a MIME string, normalized for equality: lower-cased, trimmed, parameters dropped. */
function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

/** Parse a base64 `data:` URL into its media type and raw payload, or null if it is not base64 data URL. */
function parseBase64DataUrl(url: string): { mimeType: string; data: string } | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const header = url.slice('data:'.length, comma);
  const parts = header.split(';');
  if (!parts.some((part) => part.trim().toLowerCase() === 'base64')) return null;
  return { mimeType: parts[0] || 'text/plain', data: url.slice(comma + 1) };
}

/** The MIME top-level type each asset result type is constrained to; null for non-asset result types. */
function assetMediaFamily(resultType: ResultType): 'image' | 'video' | 'audio' | 'application' | null {
  switch (resultType) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    // A package is a file container/archive (application/zip and the like); it is application-typed.
    case 'package': return 'application';
    default: return null;
  }
}

/** Top-level type token of a normalized MIME ("image/png" → "image"). */
function mimeTopType(normalizedMime: string): string {
  const slash = normalizedMime.indexOf('/');
  return slash < 0 ? normalizedMime : normalizedMime.slice(0, slash);
}

/** Media type declared by ANY `data:` URL (base64 or not); null when `url` is not a data URL. */
function dataUrlMimeType(url: string): string | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  const header = comma < 0 ? url.slice('data:'.length) : url.slice('data:'.length, comma);
  const mediaType = header.split(';')[0].trim();
  return mediaType || 'text/plain';
}

/**
 * Enforce that an asset value stays within its declared media family. A `data:` URL exposes an
 * inspectable MIME that is authoritative: it must sit in `family`, and any supplied MIME must agree
 * with it exactly. An HTTP(S) URL has no inspectable MIME, so a supplied MIME (when present) must sit
 * in `family`; with none, the declared result type governs — the direct executors only emit
 * same-family HTTP assets, which are unprovable but never heterogeneous.
 */
function enforceAssetMediaFamily(url: string, suppliedMimeType: string | undefined, family: string, field: string): void {
  const dataMimeRaw = dataUrlMimeType(url);
  if (dataMimeRaw !== null) {
    const dataMime = normalizeMimeType(dataMimeRaw);
    if (mimeTopType(dataMime) !== family) {
      fail(`Backend proxy result envelope ${field} data-URL MIME (${dataMime}) is not a ${family} asset.`);
    }
    if (suppliedMimeType !== undefined && normalizeMimeType(suppliedMimeType) !== dataMime) {
      fail(`Backend proxy result envelope ${field} MIME disagrees with its data URL.`);
    }
    return;
  }
  if (suppliedMimeType !== undefined && mimeTopType(normalizeMimeType(suppliedMimeType)) !== family) {
    fail(`Backend proxy result envelope ${field} MIME (${suppliedMimeType}) is not a ${family} asset.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const source = typeof Buffer !== 'undefined'
    ? Buffer.from(data, 'base64')
    : Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  // Copy into a fresh, non-shared ArrayBuffer so the bytes are a valid BlobPart.
  const bytes = new Uint8Array(source.length);
  bytes.set(source);
  return bytes;
}

/** Decoded length of a validated (charset-checked, length % 4 === 0) base64 string, computed without decoding. */
function decodedBase64Length(data: string): number {
  if (data.length === 0) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    fail(`Backend proxy result envelope has a non-string ${field}.`);
  }
  if (value.length > maxLength) {
    fail(`Backend proxy result envelope ${field} exceeds the ${maxLength}-character limit.`);
  }
  return value;
}

function requireOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field, maxLength);
}

function requireAssetUrl(value: unknown, field: string, maxLength: number): string {
  const url = requireString(value, field, maxLength);
  if (!url) {
    fail(`Backend proxy result envelope ${field} is empty.`);
  }
  if (!ASSET_URL_PATTERN.test(url)) {
    fail(`Backend proxy result envelope ${field} must be a data or HTTP(S) URL, not an object URL or file path.`);
  }
  return url;
}

function validatePrimaryResult(
  result: unknown,
  resultType: ResultType,
  limits: BackendProxyResultEnvelopeLimits,
): string | boolean {
  if (resultType === 'boolean') {
    if (typeof result !== 'boolean') {
      fail('Backend proxy result envelope declares a Boolean result type but the value is not a literal Boolean.');
    }
    return result;
  }
  if (ASSET_RESULT_TYPES.has(resultType)) {
    return requireAssetUrl(result, 'result', limits.maxResultValueLength);
  }
  // text / number / json / list / envelope carry string payloads.
  return requireString(result, 'result', limits.maxResultValueLength);
}

/**
 * Rebuild usage telemetry as an allowlisted, fully validated object. The raw value is NEVER cast
 * through: unknown keys fail closed, the two enums are required and checked, provider/modelId are
 * bounded strings, cost/duration must be finite and non-negative, and count/token fields must be
 * non-negative integers. A legitimate zero survives (the guards reject `< 0`, not `=== 0`).
 */
function validateUsage(value: unknown, limits: BackendProxyResultEnvelopeLimits): UsageTelemetry | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail('Backend proxy result envelope usage is not an object.');
  }

  for (const key of Object.keys(value)) {
    if (!USAGE_ALLOWED_KEYS.has(key)) {
      fail(`Backend proxy result envelope usage has an unsupported field "${key}".`);
    }
  }

  if (typeof value.source !== 'string' || !USAGE_SOURCES.has(value.source as UsageTelemetrySource)) {
    fail('Backend proxy result envelope usage.source must be "estimate" or "actual".');
  }
  if (typeof value.confidence !== 'string' || !USAGE_CONFIDENCES.has(value.confidence as UsageTelemetryConfidence)) {
    fail('Backend proxy result envelope usage.confidence must be one of measured/heuristic/fixed/unknown.');
  }

  const usage: UsageTelemetry = {
    source: value.source as UsageTelemetrySource,
    confidence: value.confidence as UsageTelemetryConfidence,
  };

  for (const field of ['provider', 'modelId'] as const) {
    const entry = value[field];
    if (entry !== undefined) {
      if (typeof entry !== 'string') {
        fail(`Backend proxy result envelope usage.${field} must be a string.`);
      }
      if (entry.length > limits.maxUsageStringLength) {
        fail(`Backend proxy result envelope usage.${field} exceeds the ${limits.maxUsageStringLength}-character limit.`);
      }
      usage[field] = entry;
    }
  }

  for (const field of USAGE_DECIMAL_FIELDS) {
    const entry = value[field];
    if (entry !== undefined) {
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) {
        fail(`Backend proxy result envelope usage.${field} must be a finite, non-negative number.`);
      }
      usage[field] = entry;
    }
  }

  for (const field of USAGE_INTEGER_FIELDS) {
    const entry = value[field];
    if (entry !== undefined) {
      if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) {
        fail(`Backend proxy result envelope usage.${field} must be a non-negative integer.`);
      }
      usage[field] = entry;
    }
  }

  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.length > limits.maxUsageNotes) {
      fail('Backend proxy result envelope usage.notes must be an array within the note-count limit.');
    }
    for (const note of value.notes) {
      if (typeof note !== 'string' || note.length > limits.maxNoteLength) {
        fail('Backend proxy result envelope usage.notes must contain only bounded strings.');
      }
    }
    usage.notes = [...(value.notes as string[])];
  }

  return usage;
}

function validateJsonSafe(value: unknown, depth: number, limits: BackendProxyResultEnvelopeLimits): void {
  // Leaf primitives never add nesting; only containers count toward the depth budget.
  if (value === null) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      fail('Backend proxy result envelope metadata contains a non-finite number.');
    }
    return;
  }
  if (depth > limits.maxMetadataDepth) {
    fail(`Backend proxy result envelope metadata nests deeper than the ${limits.maxMetadataDepth}-level limit.`);
  }
  if (Array.isArray(value)) {
    for (const entry of value) validateJsonSafe(entry, depth + 1, limits);
    return;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) validateJsonSafe(entry, depth + 1, limits);
    return;
  }
  fail('Backend proxy result envelope metadata contains a value that is not JSON-safe.');
}

function validateOutputMetadata(
  value: unknown,
  limits: BackendProxyResultEnvelopeLimits,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail('Backend proxy result envelope outputMetadata must be a JSON object.');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('Backend proxy result envelope outputMetadata is not serializable.');
  }
  if (serialized.length > limits.maxMetadataSerializedBytes) {
    fail(`Backend proxy result envelope outputMetadata exceeds the ${limits.maxMetadataSerializedBytes}-byte limit.`);
  }
  validateJsonSafe(value, 1, limits);
  return value;
}

/** A validated binary block: the reconstructed Blob plus the bytes decoded ONCE, reused for primary binding. */
interface ReconstructedBinary {
  blob: Blob;
  bytes: Uint8Array;
  mimeType: string;
}

function reconstructBinary(value: unknown, limits: BackendProxyResultEnvelopeLimits): ReconstructedBinary {
  if (!isRecord(value)) {
    fail('Backend proxy result envelope binary must be an object.');
  }
  if (value.encoding !== 'base64') {
    fail('Backend proxy result envelope binary must declare base64 encoding.');
  }
  const mimeType = requireString(value.mimeType, 'binary.mimeType', limits.maxMimeTypeLength);
  if (!mimeType) {
    fail('Backend proxy result envelope binary.mimeType is empty.');
  }
  const { byteLength, data } = value;
  if (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength < 0) {
    fail('Backend proxy result envelope binary.byteLength must be a non-negative integer.');
  }
  // Bound on the DECLARED length first: an oversize claim is rejected before any buffer is allocated.
  if (byteLength > limits.maxDecodedBinaryBytes) {
    fail(`Backend proxy result envelope binary.byteLength exceeds the ${limits.maxDecodedBinaryBytes}-byte limit.`);
  }
  if (typeof data !== 'string') {
    fail('Backend proxy result envelope binary.data must be a base64 string.');
  }
  if (data.length > limits.maxEncodedBinaryLength) {
    fail(`Backend proxy result envelope binary.data exceeds the ${limits.maxEncodedBinaryLength}-character limit.`);
  }
  if (data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) {
    fail('Backend proxy result envelope binary.data is not valid base64.');
  }
  if (decodedBase64Length(data) !== byteLength) {
    fail('Backend proxy result envelope binary.byteLength disagrees with the base64 payload.');
  }
  const bytes = base64ToBytes(data);
  if (bytes.byteLength !== byteLength) {
    fail('Backend proxy result envelope binary decoded to an unexpected byte length.');
  }
  return { blob: new Blob([bytes], { type: mimeType }), bytes, mimeType };
}

/**
 * Bind the primary `result` to its companion `binary`: they describe the SAME asset, so a versioned
 * envelope that ships both must prove it. When a binary exists the primary must be an asset-typed,
 * base64 `data:` URL whose media type and bytes match the binary exactly — an HTTP(S) primary is
 * unprovable against local bytes and is rejected. Any supplied top-level MIME must agree too.
 */
function bindPrimaryResultToBinary(
  result: string | boolean,
  resultType: ResultType,
  topLevelMimeType: string | undefined,
  binary: ReconstructedBinary,
  limits: BackendProxyResultEnvelopeLimits,
): void {
  if (!ASSET_RESULT_TYPES.has(resultType)) {
    fail('Backend proxy result envelope binary requires an asset result type (image, video, audio, or package).');
  }
  if (typeof result !== 'string') {
    fail('Backend proxy result envelope binary requires a data-URL primary result.');
  }
  const parsed = parseBase64DataUrl(result);
  if (!parsed) {
    fail('Backend proxy result envelope with a binary requires the primary result to be a base64 data URL, not an HTTP(S) URL.');
  }
  const binaryMime = normalizeMimeType(binary.mimeType);
  if (normalizeMimeType(parsed.mimeType) !== binaryMime) {
    fail('Backend proxy result envelope primary data-URL MIME disagrees with the binary MIME.');
  }
  if (topLevelMimeType !== undefined && normalizeMimeType(topLevelMimeType) !== binaryMime) {
    fail('Backend proxy result envelope top-level MIME disagrees with the binary MIME.');
  }
  const payload = parsed.data;
  if (payload.length > limits.maxEncodedBinaryLength) {
    fail(`Backend proxy result envelope primary data-URL payload exceeds the ${limits.maxEncodedBinaryLength}-character limit.`);
  }
  if (payload.length % 4 !== 0 || !BASE64_PATTERN.test(payload)) {
    fail('Backend proxy result envelope primary data-URL payload is not valid base64.');
  }
  if (decodedBase64Length(payload) !== binary.bytes.byteLength) {
    fail('Backend proxy result envelope primary data-URL byte length disagrees with the binary.');
  }
  const primaryBytes = base64ToBytes(payload);
  if (primaryBytes.byteLength !== binary.bytes.byteLength) {
    fail('Backend proxy result envelope primary data-URL decoded to an unexpected byte length.');
  }
  for (let index = 0; index < primaryBytes.length; index += 1) {
    if (primaryBytes[index] !== binary.bytes[index]) {
      fail('Backend proxy result envelope primary result bytes disagree with the binary.');
    }
  }
}

/**
 * Gate an asset-typed primary value, its supplied top-level MIME, and (when present) the binary MIME
 * to the declared result family. Shared by the versioned and legacy decoders; non-asset result types
 * have no family and are left untouched (their string payloads are validated elsewhere).
 */
function enforcePrimaryAssetFamily(
  resultType: ResultType,
  result: string | boolean,
  topLevelMimeType: string | undefined,
  binary: ReconstructedBinary | undefined,
): void {
  const family = assetMediaFamily(resultType);
  if (family === null) return;
  if (typeof result === 'string') {
    enforceAssetMediaFamily(result, topLevelMimeType, family, 'result');
  }
  if (binary !== undefined && mimeTopType(normalizeMimeType(binary.mimeType)) !== family) {
    fail(`Backend proxy result envelope binary MIME (${binary.mimeType}) is not a ${family} asset.`);
  }
}

function validateAdditionalResults(
  value: unknown,
  resultType: ResultType,
  limits: BackendProxyResultEnvelopeLimits,
): Array<{ result: string; mimeType?: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    fail('Backend proxy result envelope additionalResults must be an array.');
  }
  const family = assetMediaFamily(resultType);
  if (family === null) {
    // The direct executors only emit sibling outputs for asset result types; a non-asset result
    // (text/number/boolean/json/list/envelope) carrying asset siblings is not a shape any produce.
    fail('Backend proxy result envelope additionalResults require an asset result type (image, video, audio, or package).');
  }
  if (value.length > limits.maxAdditionalResults) {
    fail(`Backend proxy result envelope additionalResults exceeds the ${limits.maxAdditionalResults}-item limit.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      fail(`Backend proxy result envelope additionalResults[${index}] must be an object.`);
    }
    const result = requireAssetUrl(entry.result, `additionalResults[${index}].result`, limits.maxAdditionalResultValueLength);
    const mimeType = requireOptionalString(entry.mimeType, `additionalResults[${index}].mimeType`, limits.maxMimeTypeLength);
    // Every sibling must stay in the parent's media family so heterogeneous media can never be
    // persisted under the parent kind.
    enforceAssetMediaFamily(result, mimeType, family, `additionalResults[${index}].result`);
    return mimeType === undefined ? { result } : { result, mimeType };
  });
}

function readResultType(value: unknown): ResultType {
  if (typeof value !== 'string' || !VALID_RESULT_TYPES.has(value as ResultType)) {
    fail('Backend proxy result envelope has an invalid result type.');
  }
  return value as ResultType;
}

/**
 * Decode a VERSIONED envelope. The caller has already confirmed `envelopeVersion` is the supported
 * version. A processed provider error is terminal here: it is surfaced as a non-retryable failure so
 * the run is not resubmitted, and any tempting result/binary/additional fields alongside it are ignored.
 */
function decodeVersionedEnvelope(
  payload: Record<string, unknown>,
  limits: BackendProxyResultEnvelopeLimits,
): DecodedBackendProxyResult {
  if (payload.error !== undefined && payload.error !== null && payload.error !== '') {
    fail(`Backend proxy reported a provider error: ${String(payload.error)}`);
  }

  const resultType = readResultType(payload.resultType);
  const result = validatePrimaryResult(payload.result, resultType, limits);
  const statusMessage = requireOptionalString(payload.statusMessage, 'statusMessage', limits.maxStatusMessageLength)
    ?? 'Generated through backend proxy';
  const usage = validateUsage(payload.usage, limits);
  const declaredMimeType = requireOptionalString(payload.mimeType, 'mimeType', limits.maxMimeTypeLength);
  const extension = requireOptionalString(payload.extension, 'extension', limits.maxExtensionLength);
  const fileName = requireOptionalString(payload.fileName, 'fileName', limits.maxFileNameLength);
  const outputMetadata = validateOutputMetadata(payload.outputMetadata, limits);
  const binary = payload.binary === undefined ? undefined : reconstructBinary(payload.binary, limits);
  const additionalResults = validateAdditionalResults(payload.additionalResults, resultType, limits);

  // One canonical family contract: the primary value, any supplied top-level MIME, the binary MIME, and
  // every additional sibling (checked as they were validated) must all sit in the family the declared
  // result type constrains — exactly the same-family shape the direct executors emit.
  enforcePrimaryAssetFamily(resultType, result, declaredMimeType, binary);

  let mimeType = declaredMimeType;
  let blob: Blob | undefined;
  if (binary !== undefined) {
    bindPrimaryResultToBinary(result, resultType, declaredMimeType, binary, limits);
    blob = binary.blob;
    // Derive the runtime MIME from the (validated, matching) binary when the top level omitted it.
    if (mimeType === undefined) mimeType = binary.mimeType;
  }

  return {
    result,
    resultType,
    statusMessage,
    ...(usage !== undefined ? { usage } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(extension !== undefined ? { extension } : {}),
    ...(fileName !== undefined ? { fileName } : {}),
    ...(outputMetadata !== undefined ? { outputMetadata } : {}),
    ...(blob !== undefined ? { blob } : {}),
    ...(additionalResults !== undefined ? { additionalResults } : {}),
  };
}

/**
 * Narrow adapter for LEGACY unversioned responses. It honors only the historical single-asset fields
 * and PROVES an unversioned payload cannot claim the versioned-only Blob or multi-result capabilities:
 * a legacy payload carrying `binary` or `additionalResults` is rejected with an actionable version
 * message rather than being silently reinterpreted. This keeps exactly two disambiguated shapes —
 * `envelopeVersion` present (versioned) versus absent (legacy) — never an ambiguous third.
 */
function decodeLegacyEnvelope(
  payload: Record<string, unknown>,
  limits: BackendProxyResultEnvelopeLimits,
): DecodedBackendProxyResult {
  if (Object.prototype.hasOwnProperty.call(payload, 'binary')) {
    fail('Backend proxy sent binary data without a result envelope version. Upgrade the proxy to emit a versioned result envelope.');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'additionalResults')) {
    fail('Backend proxy sent additional results without a result envelope version. Upgrade the proxy to emit a versioned result envelope.');
  }
  if (payload.error !== undefined && payload.error !== null && payload.error !== '') {
    fail(`Backend proxy reported a provider error: ${String(payload.error)}`);
  }

  const resultType = readResultType(payload.resultType);
  const result = validatePrimaryResult(payload.result, resultType, limits);
  const statusMessage = requireOptionalString(payload.statusMessage, 'statusMessage', limits.maxStatusMessageLength)
    ?? 'Generated through backend proxy';
  const usage = validateUsage(payload.usage, limits);
  const mimeType = requireOptionalString(payload.mimeType, 'mimeType', limits.maxMimeTypeLength);
  const extension = requireOptionalString(payload.extension, 'extension', limits.maxExtensionLength);
  const fileName = requireOptionalString(payload.fileName, 'fileName', limits.maxFileNameLength);
  const outputMetadata = validateOutputMetadata(payload.outputMetadata, limits);

  // Legacy single-asset payloads carry no binary/additionalResults (rejected above), but the primary
  // value and any supplied MIME must still stay within the declared result family.
  enforcePrimaryAssetFamily(resultType, result, mimeType, undefined);

  return {
    result,
    resultType,
    statusMessage,
    ...(usage !== undefined ? { usage } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(extension !== undefined ? { extension } : {}),
    ...(fileName !== undefined ? { fileName } : {}),
    ...(outputMetadata !== undefined ? { outputMetadata } : {}),
  };
}

/**
 * Validate an already-JSON-parsed proxy result payload and reconstruct the runtime result, or throw a
 * clear non-retryable error. The response has already been received (HTTP 200), so every failure here
 * is a PROCESSED terminal response: the caller must never resubmit the provider job because decoding failed.
 */
export function decodeBackendProxyResultEnvelope(
  payload: unknown,
  limits: BackendProxyResultEnvelopeLimits = DEFAULT_BACKEND_PROXY_RESULT_ENVELOPE_LIMITS,
): DecodedBackendProxyResult {
  if (!isRecord(payload)) {
    fail('Backend proxy returned an invalid execution payload.');
  }

  const version = payload.envelopeVersion;
  if (version === undefined) {
    return decodeLegacyEnvelope(payload, limits);
  }
  if (version !== BACKEND_PROXY_RESULT_ENVELOPE_VERSION) {
    fail(`Backend proxy returned an unsupported result envelope version (${String(version)}). Expected ${BACKEND_PROXY_RESULT_ENVELOPE_VERSION}.`);
  }
  return decodeVersionedEnvelope(payload, limits);
}

/**
 * Canonical serialization of a runtime result into the versioned wire envelope — the exact shape an
 * implementing proxy must emit, and the inverse of {@link decodeBackendProxyResultEnvelope}. It is a
 * pure serialization utility (no routing, no provider calls), used to prove direct-vs-proxy parity by
 * round-tripping a real `ExecutionResult`. A Blob is transported explicitly as declared-length base64.
 */
export async function encodeBackendProxyResultEnvelope(input: {
  result: string | boolean;
  resultType: ResultType;
  statusMessage?: string;
  usage?: UsageTelemetry;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  blob?: Blob;
  additionalResults?: Array<{ result: string; mimeType?: string }>;
}): Promise<BackendProxyResultEnvelope> {
  const envelope: BackendProxyResultEnvelope = {
    envelopeVersion: BACKEND_PROXY_RESULT_ENVELOPE_VERSION,
    result: input.result,
    resultType: input.resultType,
  };
  if (input.statusMessage !== undefined) envelope.statusMessage = input.statusMessage;
  if (input.usage !== undefined) envelope.usage = input.usage;
  if (input.mimeType !== undefined) envelope.mimeType = input.mimeType;
  if (input.extension !== undefined) envelope.extension = input.extension;
  if (input.fileName !== undefined) envelope.fileName = input.fileName;
  if (input.outputMetadata !== undefined) envelope.outputMetadata = input.outputMetadata;
  if (input.additionalResults !== undefined) envelope.additionalResults = input.additionalResults;
  if (input.blob !== undefined) {
    const bytes = new Uint8Array(await input.blob.arrayBuffer());
    envelope.binary = {
      encoding: 'base64',
      mimeType: input.blob.type,
      byteLength: bytes.byteLength,
      data: bytesToBase64(bytes),
    };
  }
  return envelope;
}
