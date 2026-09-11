// Direct-REST Vertex AI execution for runtimes WITHOUT the Electron bridge
// (Android/iOS standalone; any bridgeless session with a service-account key).
//
// This is a faithful TypeScript port of the bridge handlers in
// electron/main.mjs (generateVertexImage/Text/Video): identical endpoint
// construction, response extraction, error wording, and result shapes
// (NativeVertex*Result), so flowExecution can use either path interchangeably.
// The only difference is auth: instead of shelling out to gcloud, the access
// token is minted from the user's service-account JSON via WebCrypto
// (vertexServiceAccountAuth — the same flow "Test connection" already proves
// on mobile). On Android, fetch is CapacitorHttp-patched, so these calls run
// as native HTTP with no CORS constraints.
import type {
  NativeVertexImageRequest,
  NativeVertexImageResult,
  NativeVertexTextRequest,
  NativeVertexTextResult,
  NativeVertexVideoRequest,
  NativeVertexVideoResult,
} from './nativeApp';
import type { ProviderSettings } from '../types/flow';
import { getVertexCredentialAccessToken, type MintAccessTokenDeps } from './vertex/vertexServiceAccountAuth';
import { blobToDataUrl, readBinaryImageResponseBlob } from './imageEditorAi/blobUtils';
import { NonRetryableError } from './exponentialBackoff';
import { abortableSleep, createAbortError, isAbortError, raceWithAbort, throwIfAborted } from './abortSignals';

export interface VertexDirectRestDeps extends MintAccessTokenDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/** Direct REST is available whenever a service-account or authorized-user ADC JSON is configured. */
export function isVertexDirectRestAvailable(providerSettings: ProviderSettings): boolean {
  return Boolean(providerSettings.vertexServiceAccountJson?.trim());
}

function sanitizeVertexPathSegment(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NonRetryableError(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new NonRetryableError(`${label} contains unsupported characters.`);
  }
  return trimmed;
}

function sanitizeVertexApiVersion(value: string | undefined): 'v1' | 'v1beta1' | 'v1alpha' {
  return value === 'v1beta1' || value === 'v1alpha' ? value : 'v1';
}

function buildVertexRegionalHost(location: string): string {
  return location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
}

function buildImageEndpoint(request: NativeVertexImageRequest) {
  const projectId = sanitizeVertexPathSegment(request.projectId, 'Vertex project ID');
  const location = sanitizeVertexPathSegment(request.location || 'global', 'Vertex location');
  const modelId = sanitizeVertexPathSegment(request.modelId, 'Vertex model ID');
  const method = request.route === 'imagen-predict'
    ? 'predict'
    : request.route === 'gemini-generate-content'
      ? 'generateContent'
      : undefined;
  if (!method) {
    throw new NonRetryableError('Unsupported Vertex image route.');
  }
  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:${method}`,
    projectId,
    modelId,
  };
}

function buildTextEndpoint(request: NativeVertexTextRequest) {
  const projectId = sanitizeVertexPathSegment(request.projectId, 'Vertex project ID');
  const location = sanitizeVertexPathSegment(request.location || 'global', 'Vertex location');
  const modelId = sanitizeVertexPathSegment(request.modelId, 'Vertex model ID');
  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`,
    projectId,
    modelId,
  };
}

function buildVideoEndpoint(request: NativeVertexVideoRequest) {
  const projectId = sanitizeVertexPathSegment(request.projectId, 'Vertex project ID');
  const location = sanitizeVertexPathSegment(request.location || 'us-central1', 'Vertex location');
  const modelId = sanitizeVertexPathSegment(request.modelId, 'Vertex model ID');
  const route = request.route === 'gemini-generate-content'
    ? 'gemini-generate-content'
    : request.route === 'veo-predict-long-running'
      ? 'veo-predict-long-running'
      : undefined;
  if (!route) {
    throw new NonRetryableError('Unsupported Vertex video route.');
  }
  const apiVersion = route === 'gemini-generate-content'
    ? sanitizeVertexApiVersion(request.apiVersion || 'v1beta1')
    : 'v1';
  const modelPath = `projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`;
  const baseUrl = `https://${buildVertexRegionalHost(location)}/${apiVersion}/${modelPath}`;
  const method = route === 'gemini-generate-content' ? 'generateContent' : 'predictLongRunning';
  return {
    url: `${baseUrl}:${method}`,
    fetchOperationUrl: `${baseUrl}:fetchPredictOperation`,
    projectId,
    modelId,
    route,
  };
}

function resolveQuotaProjectId(
  request: { auth?: { quotaProjectId?: string } },
  endpointProjectId: string,
): string {
  const quotaProjectId = request.auth?.quotaProjectId;
  if (typeof quotaProjectId === 'string' && quotaProjectId.trim()) {
    return sanitizeVertexPathSegment(quotaProjectId, 'Vertex quota project ID');
  }
  return endpointProjectId;
}

async function getDirectAccessToken(
  providerSettings: ProviderSettings,
  deps: VertexDirectRestDeps,
): Promise<string> {
  const raw = providerSettings.vertexServiceAccountJson?.trim();
  if (!raw) {
    throw new NonRetryableError(
      'Vertex AI on this device needs an ADC credential JSON file. Import one in Settings > Providers > Vertex AI, then use "Test connection".',
    );
  }
  const minted = await getVertexCredentialAccessToken(raw, deps);
  return minted.accessToken;
}

function buildVertexErrorMessage(status: number, payload: unknown, label: string): string {
  const apiMessage = (payload as { error?: { message?: unknown } } | undefined)?.error?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) {
    return `Vertex AI ${label} failed (${status}): ${apiMessage}`;
  }
  return `Vertex AI ${label} failed (${status}).`;
}

interface ExtractedInlineImage {
  mimeType: string;
  data: string;
}

function extractVertexGeneratedImage(response: unknown): ExtractedInlineImage | undefined {
  const body = response as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
    predictions?: Array<Record<string, unknown>>;
  };
  for (const candidate of body?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      const inlineData = (part.inlineData ?? part.inline_data) as
        | { data?: unknown; mimeType?: unknown }
        | undefined;
      if (typeof inlineData?.data === 'string' && inlineData.data) {
        return {
          mimeType: typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png',
          data: inlineData.data,
        };
      }
    }
  }
  for (const prediction of body?.predictions ?? []) {
    const image = prediction.image as Record<string, unknown> | undefined;
    const data = prediction.bytesBase64Encoded
      ?? prediction.bytes_base64_encoded
      ?? image?.bytesBase64Encoded
      ?? image?.bytes_base64_encoded;
    if (typeof data === 'string' && data) {
      const mimeType = prediction.mimeType ?? image?.mimeType;
      return {
        mimeType: typeof mimeType === 'string' ? mimeType : 'image/png',
        data,
      };
    }
  }
  return undefined;
}

function extractVertexGeneratedText(response: unknown): string {
  const body = response as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  };
  const textParts: string[] = [];
  for (const candidate of body?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        textParts.push(part.text);
      }
    }
  }
  return textParts.join('\n').trim();
}

interface ExtractedVideo {
  mimeType: string;
  data?: string;
  gcsUri?: string;
  uri?: string;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function getVertexVideoPayload(value: unknown): ExtractedVideo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const data = stringOrUndefined(record.bytesBase64Encoded)
    ?? stringOrUndefined(record.bytes_base64_encoded)
    ?? stringOrUndefined(record.encodedVideo)
    ?? stringOrUndefined(record.videoBytes)
    ?? stringOrUndefined(record.video_bytes);
  const mimeType = stringOrUndefined(record.mimeType)
    ?? stringOrUndefined(record.mime_type)
    ?? stringOrUndefined(record.encoding)
    ?? 'video/mp4';
  const gcsUri = stringOrUndefined(record.gcsUri) ?? stringOrUndefined(record.gcs_uri);
  const uri = stringOrUndefined(record.uri);
  if (!data && !gcsUri && !uri) {
    return undefined;
  }
  return { mimeType, ...(data ? { data } : {}), ...(gcsUri ? { gcsUri } : {}), ...(uri ? { uri } : {}) };
}

function extractVertexGeneratedVideo(response: unknown): ExtractedVideo | undefined {
  const envelope = response as { response?: unknown } | undefined;
  const responseBody = (envelope?.response ?? response) as {
    videos?: unknown[];
    generateVideoResponse?: { generatedSamples?: Array<{ video?: unknown }> };
  };
  for (const video of responseBody?.videos ?? []) {
    const extracted = getVertexVideoPayload(video);
    if (extracted) return extracted;
  }
  for (const sample of responseBody?.generateVideoResponse?.generatedSamples ?? []) {
    const extracted = getVertexVideoPayload((sample as { video?: unknown })?.video ?? sample);
    if (extracted) return extracted;
  }
  return undefined;
}

function vertexGcsUriToDownloadUrl(gcsUri: string): string | undefined {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gcsUri);
  if (!match) {
    return undefined;
  }
  const [, bucket, objectName] = match;
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
}

const VIDEO_POLL_ATTEMPTS = 45;
const VIDEO_POLL_INTERVAL_MS = 10_000;

export async function generateVertexImageDirect(
  request: NativeVertexImageRequest,
  providerSettings: ProviderSettings,
  deps: VertexDirectRestDeps = {},
): Promise<NativeVertexImageResult> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  try {
    throwIfAborted(deps.signal);
    const endpoint = buildImageEndpoint(request);
    const token = await getDirectAccessToken(providerSettings, deps);
    throwIfAborted(deps.signal);
    const quotaProjectId = resolveQuotaProjectId(request, endpoint.projectId);
    const response = await doFetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify(request.body),
      signal: deps.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: buildVertexErrorMessage(response.status, payload, 'image generation') };
    }
    const image = extractVertexGeneratedImage(payload);
    if (!image) {
      return { error: 'Vertex AI returned no image data.' };
    }
    return {
      result: `data:${image.mimeType};base64,${image.data}`,
      resultType: 'image',
      mimeType: image.mimeType,
      statusMessage: `Generated with ${endpoint.modelId}`,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (deps.signal?.aborted) throw createAbortError();
    return { error: error instanceof Error ? error.message : 'Vertex AI image generation failed.' };
  }
}

export async function generateVertexTextDirect(
  request: NativeVertexTextRequest,
  providerSettings: ProviderSettings,
  deps: VertexDirectRestDeps = {},
): Promise<NativeVertexTextResult> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  try {
    throwIfAborted(deps.signal);
    const endpoint = buildTextEndpoint(request);
    const token = await getDirectAccessToken(providerSettings, deps);
    throwIfAborted(deps.signal);
    const quotaProjectId = resolveQuotaProjectId(request, endpoint.projectId);
    const response = await doFetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify(request.body),
      signal: deps.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: buildVertexErrorMessage(response.status, payload, 'text generation') };
    }
    const text = extractVertexGeneratedText(payload);
    if (!text) {
      return { error: 'Vertex AI returned no text content.' };
    }
    return { text, statusMessage: `Generated with ${endpoint.modelId}` };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (deps.signal?.aborted) throw createAbortError();
    return { error: error instanceof Error ? error.message : 'Vertex AI text generation failed.' };
  }
}

async function pollVertexVideoOperation(input: {
  fetchOperationUrl: string;
  operation: Record<string, unknown>;
  token: string;
  quotaProjectId: string;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<unknown> {
  let currentOperation = input.operation as {
    error?: { message?: string };
    done?: boolean;
    name?: string;
  };
  for (let attempt = 0; attempt < VIDEO_POLL_ATTEMPTS; attempt += 1) {
    if (currentOperation?.error) {
      throw new Error(currentOperation.error.message || 'Vertex AI video operation failed.');
    }
    if (currentOperation?.done) {
      return currentOperation;
    }
    if (!currentOperation?.name) {
      throw new Error('Vertex AI video generation started without an operation name.');
    }
    await input.sleep(VIDEO_POLL_INTERVAL_MS);
    const response = await input.doFetch(input.fetchOperationUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': input.quotaProjectId,
      },
      body: JSON.stringify({ operationName: currentOperation.name }),
      signal: input.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(buildVertexErrorMessage(response.status, payload, 'video operation poll'));
    }
    currentOperation = payload as typeof currentOperation;
  }
  throw new Error('Vertex AI video generation timed out while polling the operation.');
}

async function materializeVertexVideoDirect(input: {
  video: ExtractedVideo;
  token: string;
  quotaProjectId: string;
  doFetch: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ result: string; mimeType: string }> {
  if (input.video.data) {
    return {
      result: `data:${input.video.mimeType};base64,${input.video.data}`,
      mimeType: input.video.mimeType,
    };
  }
  const url = input.video.gcsUri ? vertexGcsUriToDownloadUrl(input.video.gcsUri) : input.video.uri;
  if (!url) {
    throw new Error('Vertex AI returned a video reference that Sloom Studio could not download.');
  }
  const response = await input.doFetch(url, {
    headers: {
      Authorization: `Bearer ${input.token}`,
      'x-goog-user-project': input.quotaProjectId,
    },
    signal: input.signal,
  });
  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(payload.trim() || `Vertex AI video download failed (${response.status}).`);
  }
  const mimeType = response.headers.get('content-type') || input.video.mimeType || 'video/mp4';
  // readBinaryImageResponseBlob content-detects the base64-wrapped bodies the
  // CapacitorHttp fetch patch produces on Android, and passes real bytes through.
  const blob = await readBinaryImageResponseBlob(response, mimeType);
  return { result: await blobToDataUrl(blob), mimeType: blob.type || mimeType };
}

export async function generateVertexVideoDirect(
  request: NativeVertexVideoRequest,
  providerSettings: ProviderSettings,
  deps: VertexDirectRestDeps = {},
): Promise<NativeVertexVideoResult> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep
    ? (ms: number) => raceWithAbort(deps.sleep!(ms), deps.signal)
    : (ms: number) => abortableSleep(ms, deps.signal);
  try {
    throwIfAborted(deps.signal);
    const endpoint = buildVideoEndpoint(request);
    const token = await getDirectAccessToken(providerSettings, deps);
    throwIfAborted(deps.signal);
    const quotaProjectId = resolveQuotaProjectId(request, endpoint.projectId);
    const initialResponse = await doFetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify(request.body),
      signal: deps.signal,
    });
    const initialPayload = await initialResponse.json().catch(() => ({}));
    if (!initialResponse.ok) {
      return { error: buildVertexErrorMessage(initialResponse.status, initialPayload, 'video generation') };
    }
    const finalPayload = endpoint.route === 'veo-predict-long-running'
      ? await pollVertexVideoOperation({
          fetchOperationUrl: endpoint.fetchOperationUrl,
          operation: initialPayload as Record<string, unknown>,
          token,
          quotaProjectId,
          doFetch,
          sleep,
          signal: deps.signal,
        })
      : initialPayload;
    const video = extractVertexGeneratedVideo(finalPayload);
    if (!video) {
      return { error: 'Vertex AI returned no video data.' };
    }
    const materialized = await materializeVertexVideoDirect({ video, token, quotaProjectId, doFetch, signal: deps.signal });
    return {
      result: materialized.result,
      resultType: 'video',
      mimeType: materialized.mimeType,
      statusMessage: `Generated with ${endpoint.modelId}`,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (deps.signal?.aborted) throw createAbortError();
    return { error: error instanceof Error ? error.message : 'Vertex AI video generation failed.' };
  }
}
