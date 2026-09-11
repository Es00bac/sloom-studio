import { Capacitor } from '@capacitor/core';
import { getSignalLoomNativeBridge } from './nativeApp';
import { createAbortError, isAbortError, raceWithAbort, throwIfAborted } from './abortSignals';
import { analyzeBase64DataUrl } from './boundedDataUrl';
import { MAX_BINARY_RESUME_BYTES } from './binaryResumeSniffer';

export interface RemoteMediaBytes {
  dataUrl: string;
  mimeType?: string;
}

interface CapacitorHttpResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}

interface CapacitorHttpPlugin {
  get(options: { url: string; responseType?: string }): Promise<CapacitorHttpResponse>;
}

export type ElectronRemoteMediaDownloader = (
  url: string,
  cancellationId?: string,
) => Promise<{ base64?: string; mimeType?: string; error?: string } | null>;

export interface RemoteMediaFetchRuntime {
  isAndroidNative?: boolean;
  capacitorHttp?: CapacitorHttpPlugin;
  electronDownload?: ElectronRemoteMediaDownloader;
  electronCancelDownload?: (cancellationId: string) => Promise<{ cancelled?: boolean }>;
}

export type DownstreamMediaKind = 'image' | 'video' | 'audio' | 'document';

export interface DownstreamMediaFetchOptions {
  kind: DownstreamMediaKind;
  errorLabel: string;
  maxBytes?: number;
  /** Deterministic native transport override for tests; production resolves the active bridge. */
  runtime?: RemoteMediaFetchRuntime;
}

export interface DownstreamMediaBlob {
  blob: Blob;
  mimeType: string;
}

interface NativeRemoteMediaAttempt {
  media?: RemoteMediaBytes;
  failure?: string;
}

let nativeDownloadSequence = 0;

function createNativeDownloadCancellationId(): string {
  nativeDownloadSequence += 1;
  return `flow-media-${Date.now()}-${nativeDownloadSequence}`;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }

  return undefined;
}

function normalizeMimeType(value: string | undefined, fallback = 'application/octet-stream'): string {
  const trimmed = value?.split(';', 1)[0]?.trim();
  return trimmed || fallback;
}

function resolveDefaultRuntime(): RemoteMediaFetchRuntime {
  let isAndroidNative = false;
  let capacitorHttp: CapacitorHttpPlugin | undefined;

  try {
    isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins;
    capacitorHttp = plugins?.CapacitorHttp as CapacitorHttpPlugin | undefined;
  } catch {
    isAndroidNative = false;
    capacitorHttp = undefined;
  }

  const bridge = getSignalLoomNativeBridge();
  const electronDownload = bridge?.downloadRemoteMedia;
  const electronCancelDownload = bridge?.cancelRemoteMediaDownload;

  return { isAndroidNative, capacitorHttp, electronDownload, electronCancelDownload };
}

/**
 * Download a remote media URL through a path that is NOT subject to the
 * renderer's CORS policy and that ignores `Content-Disposition: attachment`,
 * returning an inline data URL the renderer can display and persist.
 *
 * Provider result CDNs (Atlas `atlas-media.*.aliyuncs.com` / `static.atlascloud.ai`,
 * BFL `delivery.bfl.ai`, …) send no CORS headers AND force-download, so a
 * renderer `fetch()` is blocked *and* an `<img src>` of the raw URL refuses to
 * render. The Electron main process (`net.fetch`) and the Android
 * `CapacitorHttp` plugin are not CORS-bound and return the raw bytes.
 *
 * Returns `undefined` when no native download path is available (plain web/dev),
 * so callers can fall back to their own behaviour.
 */
export async function fetchRemoteMediaAsDataUrl(
  url: string,
  runtime: RemoteMediaFetchRuntime = resolveDefaultRuntime(),
  signal?: AbortSignal,
): Promise<RemoteMediaBytes | undefined> {
  return (await fetchRemoteMediaNativeAttempt(url, runtime, signal)).media;
}

function base64DataUrlToBlob(dataUrl: string, fallbackMimeType = 'application/octet-stream'): Blob {
  const comma = dataUrl.indexOf(',');
  const mimeType = comma > 5 ? dataUrl.slice(5, comma).split(';', 1)[0] || fallbackMimeType : fallbackMimeType;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes as BlobPart], { type: mimeType });
}

function responseHeader(response: Response, name: string): string | undefined {
  return response.headers?.get(name) ?? undefined;
}

function normalizedStrictMimeType(value: string | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function isExpectedDownstreamMimeType(kind: DownstreamMediaKind, mimeType: string): boolean {
  if (kind === 'document') {
    return mimeType.startsWith('text/') || [
      'application/json',
      'application/pdf',
      'application/rtf',
      'application/xml',
    ].includes(mimeType);
  }
  return mimeType.startsWith(`${kind}/`);
}

function remoteMediaIdentity(url: string): string {
  if (/^data:/i.test(url)) {
    return url.slice(0, Math.min(url.indexOf(',') + 1 || 32, 96));
  }
  if (/^blob:/i.test(url)) return 'local blob URL';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 160 ? `${parsed.pathname.slice(0, 157)}…` : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return 'unrecognized media URL';
  }
}

function sanitizedUrlIdentity(value: string): string {
  const trailing = value.match(/[),.;!?]+$/)?.[0] ?? '';
  const candidate = trailing ? value.slice(0, -trailing.length) : value;
  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${trailing}`;
  } catch {
    return `remote URL${trailing}`;
  }
}

function looksLikeDetachedCredential(scheme: string, payload: string): boolean {
  const candidate = payload.replace(/[)\].!?]+$/, '');
  if (scheme.toLowerCase() === 'basic') {
    return candidate.length >= 12
      && candidate.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(candidate);
  }
  return candidate.length >= 8 && (
    /[0-9._~+/-]/.test(candidate)
    || (candidate.length >= 12 && /^[A-Za-z]+$/.test(candidate))
  );
}

function redactAuthorizationCredentials(value: string): string {
  const labeled = value.replace(
    /(\bauthorization\b[ \t]*[:=][ \t]*)(?:basic|bearer)\b[ \t]+[^\s,;]+/gi,
    '$1[redacted]',
  );
  return labeled.replace(
    /(^|[\r\n,;:.!?([={])([ \t]*)(basic|bearer)\b[ \t]+([^\s,;]+)/gim,
    (match, boundary: string, spacing: string, scheme: string, payload: string) =>
      looksLikeDetachedCredential(scheme, payload)
      ? `${boundary}${spacing}[redacted]`
      : match,
  );
}

function sanitizeFailureSummary(error: unknown): string {
  const raw = error instanceof Error
    ? error.message || error.name
    : typeof error === 'string'
      ? error
      : 'unknown failure';
  const sanitized = redactAuthorizationCredentials(raw
    .replace(/data:[^\s<>"']+/gi, 'data URL')
    .replace(/blob:[^\s<>"']+/gi, 'local blob URL')
    .replace(/https?:\/\/[^\s<>"']+/gi, sanitizedUrlIdentity))
    .replace(/((?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|password|secret|signature|signed|token)\s*[:=]\s*)[^\s,;&]+/gi, '$1[redacted]')
    .replace(/\b(?:sk|pk|eyJ)[A-Za-z0-9._-]{16,}\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .trim()
    .replace(/\s+/g, ' ');
  return sanitized.slice(0, 240) || (error instanceof Error ? error.name : 'unknown failure');
}

async function fetchRemoteMediaNativeAttempt(
  url: string,
  runtime: RemoteMediaFetchRuntime = resolveDefaultRuntime(),
  signal?: AbortSignal,
): Promise<NativeRemoteMediaAttempt> {
  throwIfAborted(signal);
  if (!/^https?:\/\//i.test(url)) {
    return { failure: 'native download supports only remote HTTP media' };
  }

  const failures: string[] = [];
  if (runtime.electronDownload) {
    const cancellationId = signal && runtime.electronCancelDownload
      ? createNativeDownloadCancellationId()
      : undefined;
    let cancellationSent = false;
    const cancelNativeDownload = () => {
      if (!cancellationId || cancellationSent) return;
      cancellationSent = true;
      void runtime.electronCancelDownload?.(cancellationId).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancelNativeDownload, { once: true });
    try {
      const result = await raceWithAbort(
        cancellationId
          ? runtime.electronDownload(url, cancellationId)
          : runtime.electronDownload(url),
        signal,
      );
      if (result?.base64 && !result.error) {
        const mimeType = normalizeMimeType(result.mimeType);
        return { media: { dataUrl: `data:${mimeType};base64,${result.base64}`, mimeType } };
      }
      failures.push(result?.error
        ? `Electron native download reported ${sanitizeFailureSummary(result.error)}`
        : 'Electron native download returned no media bytes');
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (signal?.aborted) throw createAbortError();
      failures.push(`Electron native download failed: ${sanitizeFailureSummary(error)}`);
    } finally {
      signal?.removeEventListener('abort', cancelNativeDownload);
    }
  }

  if (runtime.isAndroidNative && runtime.capacitorHttp) {
    try {
      const response = await raceWithAbort(runtime.capacitorHttp.get({ url, responseType: 'blob' }), signal);
      if (response.status < 200 || response.status >= 300) {
        failures.push(`Android native download returned HTTP ${response.status}`);
      } else if (typeof response.data !== 'string' || response.data.length === 0) {
        failures.push('Android native download returned no media bytes');
      } else {
        const mimeType = normalizeMimeType(headerValue(response.headers, 'content-type'));
        return { media: { dataUrl: `data:${mimeType};base64,${response.data}`, mimeType } };
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (signal?.aborted) throw createAbortError();
      failures.push(`Android native download failed: ${sanitizeFailureSummary(error)}`);
    }
  }

  return { failure: failures.join('; ') || 'native download was unavailable' };
}

function assertBoundedMediaBlob(
  blob: Blob,
  claimedMimeType: string | undefined,
  options: Required<Pick<DownstreamMediaFetchOptions, 'kind' | 'errorLabel' | 'maxBytes'>>,
  source: string,
): DownstreamMediaBlob {
  if (blob.size <= 0) {
    throw new Error(`${source} returned no media bytes.`);
  }
  if (blob.size > options.maxBytes) {
    throw new Error(`${source} returned ${blob.size} bytes, above the ${options.maxBytes}-byte downstream limit.`);
  }
  const mimeType = normalizedStrictMimeType(claimedMimeType) ?? normalizedStrictMimeType(blob.type);
  if (!mimeType || !isExpectedDownstreamMimeType(options.kind, mimeType)) {
    throw new Error(`${source} returned ${mimeType ?? 'no MIME type'}; expected ${options.kind} media.`);
  }
  return {
    blob: normalizedStrictMimeType(blob.type) === mimeType ? blob : new Blob([blob], { type: mimeType }),
    mimeType,
  };
}

async function readBoundedRendererMedia(
  response: Response,
  options: Required<Pick<DownstreamMediaFetchOptions, 'kind' | 'errorLabel' | 'maxBytes'>>,
  signal?: AbortSignal,
): Promise<DownstreamMediaBlob> {
  if (!response.ok) {
    throw new Error(`renderer download returned HTTP ${response.status}.`);
  }
  const declaredLength = responseHeader(response, 'content-length');
  if (declaredLength && /^\d+$/.test(declaredLength.trim())) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > options.maxBytes) {
      throw new Error(`renderer download declared more than the ${options.maxBytes}-byte downstream limit.`);
    }
  }
  const claimedMimeType = responseHeader(response, 'content-type');
  const blob = await raceWithAbort(response.blob(), signal);
  throwIfAborted(signal);
  return assertBoundedMediaBlob(blob, claimedMimeType, options, 'renderer download');
}

/**
 * Materialize one upstream Flow media URL for a downstream provider input. Renderer fetch is used
 * when possible; http(s) transport/MIME/status failures then receive the established Electron or
 * Android native fallback. No raw remote URL, non-media response, or oversized payload crosses the
 * provider boundary.
 */
export async function fetchDownstreamMediaBlob(
  url: string,
  options: DownstreamMediaFetchOptions,
  signal?: AbortSignal,
): Promise<DownstreamMediaBlob> {
  throwIfAborted(signal);
  const maxBytes = options.maxBytes ?? MAX_BINARY_RESUME_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BINARY_RESUME_BYTES) {
    throw new Error(`${options.errorLabel}: invalid downstream media byte limit.`);
  }
  const strictOptions = { kind: options.kind, errorLabel: options.errorLabel, maxBytes };

  if (/^data:/i.test(url) && /;base64,/i.test(url.slice(0, Math.min(url.length, 1_024)))) {
    const analysis = analyzeBase64DataUrl(url, maxBytes);
    if (!analysis) {
      throw new Error(`${options.errorLabel} (${remoteMediaIdentity(url)}): inline media is invalid or exceeds the ${maxBytes}-byte downstream limit.`);
    }
    return assertBoundedMediaBlob(
      base64DataUrlToBlob(url, analysis.mimeType),
      analysis.mimeType,
      strictOptions,
      'inline media',
    );
  }

  let rendererFailure = 'renderer download was unavailable';

  try {
    const response = await raceWithAbort(fetch(url, { signal }), signal);
    return await readBoundedRendererMedia(response, strictOptions, signal);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw isAbortError(error) ? error : createAbortError();
    }
    rendererFailure = sanitizeFailureSummary(error);
  }

  let nativeFailure = 'native download was unavailable';
  if (/^https?:\/\//i.test(url)) {
    try {
      const attempt = options.runtime
        ? await fetchRemoteMediaNativeAttempt(url, options.runtime, signal)
        : await fetchRemoteMediaNativeAttempt(url, undefined, signal);
      throwIfAborted(signal);
      const native = attempt.media;
      if (native) {
        const analysis = analyzeBase64DataUrl(native.dataUrl, maxBytes);
        if (!analysis) {
          throw new Error(`native download returned invalid or oversized base64 media.`);
        }
        const blob = base64DataUrlToBlob(native.dataUrl, native.mimeType);
        return assertBoundedMediaBlob(blob, native.mimeType ?? analysis.mimeType, strictOptions, 'native download');
      }
      nativeFailure = attempt.failure ?? nativeFailure;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw isAbortError(error) ? error : createAbortError();
      }
      nativeFailure = sanitizeFailureSummary(error);
    }
  }

  throw new Error(
    `${options.errorLabel} (${remoteMediaIdentity(url)}): ${rendererFailure}; ${nativeFailure}.`,
  );
}

/**
 * Download a provider *result* image as a Blob through a path that survives the Android WebView.
 *
 * Provider result CDNs (Atlas `aliyuncs`/`static.atlascloud.ai`, BFL `delivery.bfl.ai`, …) serve
 * **signed** URLs and send no CORS headers. A renderer `fetch()` works on desktop (Electron
 * bypasses CORS), but on Android — where CapacitorHttp patches `fetch` and routes GETs through a
 * proxy URL — the signed query string gets re-encoded and the CDN rejects it (**HTTP 403**).
 * `fetchRemoteMediaAsDataUrl` pulls the bytes through a direct, non-proxied native GET
 * (`CapacitorHttp.get` / Electron `net.fetch`) that preserves the URL untouched. This mirrors
 * flowExecution's `materializeRemoteMediaResult` for the Image-editor adapters.
 */
export async function fetchProviderResultBlob(
  url: string,
  errorLabel: string,
  signal?: AbortSignal,
  runtime?: RemoteMediaFetchRuntime,
): Promise<Blob> {
  if (/^(blob:|data:)/i.test(url)) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`${errorLabel} (${response.status}).`);
    }
    return response.blob();
  }

  // Try the renderer fetch first — succeeds on desktop and on permissive-CORS web. On Android this
  // hits the CapacitorHttp proxy and a signed CDN URL comes back 403; we then fall through.
  try {
    const response = await fetch(url, { signal });
    if (response.ok) {
      return await response.blob();
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (signal?.aborted) throw createAbortError();
    // CORS / network error — fall through to the native path.
  }

  const native = runtime ? await fetchRemoteMediaAsDataUrl(url, runtime, signal) : await fetchRemoteMediaAsDataUrl(url, undefined, signal);
  if (native) {
    return base64DataUrlToBlob(native.dataUrl, native.mimeType);
  }

  throw new Error(`${errorLabel}.`);
}
