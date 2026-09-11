// Shared cloud image-upscale execution — the single source of truth for the
// Stability AI, Vertex Imagen, and Atlas Cloud upscalers used by the Flow
// auto-upscale (flowExecution.ts `runConfiguredFlowImageUpscale`) and the Image
// editor's universal upscale (ImageUniversalUpscale.ts). The Stability/Vertex
// routes are extracted verbatim from the original Flow configured-upscale
// branch so behaviour is byte-identical: same request builders, endpoints,
// error wording, and result URLs. The Atlas route mirrors the proven native
// Atlas execution path and the model's generated schema artifacts (see below).
//
// All routes are PAID. Callers must gate them on configured credentials
// (Stability/Atlas API key / Vertex project + bridge-or-service-account) and
// surface a cost label before running — these helpers never spend on their own.
import type { ImageOutputFormat, ProviderSettings } from '../types/flow';
import { buildStabilityUpscaleRequest } from './imageEditorAi/requestBuilders';
import { getVertexProjectConfig } from './vertexProviderSettings';
import { getSignalLoomNativeBridge } from './nativeApp';
import type { NativeVertexImageRequest, NativeVertexImageResult } from './nativeApp';
import { generateVertexImageDirect, isVertexDirectRestAvailable } from './vertexDirectRest';
import {
  buildVertexImagenUpscaleRequestBody,
  dataUrlToVertexInlineImage,
  VERTEX_IMAGEN_UPSCALE_MODEL_ID,
  type VertexImagenUpscaleFactor,
} from './vertexImageRequests';
import { blobToDataUrl } from './imageEditorAi/blobUtils';
import {
  extractAtlasOutputUrl,
  filterAtlasBodyToAcceptedFields,
  normalizeAtlasBaseUrl,
} from './imageEditorAi/atlasNativeImage';
import { fetchProviderResultBlob } from './remoteMediaFetch';
import { throwIfAborted } from './abortSignals';

export interface CloudImageUpscaleOutput {
  result: string;
  mimeType?: string;
}

export type StabilityImageUpscaleMode = 'fast' | 'conservative';

export interface StabilityImageUpscaleInput {
  sourceImage: string;
  mode: StabilityImageUpscaleMode;
  outputFormat: ImageOutputFormat;
  apiKey: string;
  /** Conservative mode only: optional prompt to guide the repair pass. */
  prompt?: string;
  /** Conservative mode only: optional 0–1 creativity control. */
  creativity?: number;
  sourceFilename?: string;
  errorLabel?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Run a Stability AI cloud upscale (fast or conservative). Faithful port of the
 * Flow configured-upscale Stability branch: builds the request via
 * `buildStabilityUpscaleRequest`, POSTs multipart form data, and returns an
 * object URL for the returned image blob.
 */
export async function runStabilityImageUpscale(
  input: StabilityImageUpscaleInput,
): Promise<CloudImageUpscaleOutput> {
  const response = await submitStabilityImageUpscale(input);
  return materializeStabilityImageUpscaleResponse(response, input.outputFormat, input.signal);
}

/** Submit the paid Stability upscale and stop exactly at the accepted HTTP response. */
export async function submitStabilityImageUpscale(
  input: StabilityImageUpscaleInput,
): Promise<Response> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error('Stability AI API key is missing. Add it in Settings.');
  }

  const built = buildStabilityUpscaleRequest({
    mode: input.mode,
    prompt: input.mode === 'conservative' ? input.prompt : undefined,
    creativity: input.mode === 'conservative' ? input.creativity : undefined,
    outputFormat: input.outputFormat,
  });

  const formData = new FormData();
  Object.entries(built.fields).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
  formData.append(
    'image',
    await dataUrlToUpscaleFile(input.sourceImage, input.sourceFilename ?? 'image-upscale-source.png', input.signal),
  );

  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch(built.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
    },
    body: formData,
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(await extractCloudUpscaleErrorBody(response, input.errorLabel ?? 'Stability image upscale failed'));
  }

  return response;
}

/** Materialize an already accepted Stability response without issuing another POST. */
export async function materializeStabilityImageUpscaleResponse(
  response: Response,
  outputFormat: ImageOutputFormat,
  signal?: AbortSignal,
): Promise<CloudImageUpscaleOutput> {
  throwIfAborted(signal);
  const materializationResponse = typeof response.clone === 'function'
    ? response.clone()
    : response;
  const blob = await materializationResponse.blob();
  throwIfAborted(signal);
  return {
    result: URL.createObjectURL(blob),
    mimeType: blob.type || `image/${outputFormat}`,
  };
}

export interface VertexImagenImageUpscaleInput {
  sourceImage: string;
  providerSettings: ProviderSettings;
  outputFormat: ImageOutputFormat;
  /** Vertex Imagen upscale factor; defaults to x2 to match the Flow behaviour. */
  upscaleFactor?: VertexImagenUpscaleFactor;
  /**
   * Optional resolved Vertex image generator (bridge or direct REST). Callers
   * that already resolve one (Flow) pass it so behaviour is provably identical;
   * omit it to let this module resolve the shared bridge-or-service-account path.
   */
  generateVertexImage?: (request: NativeVertexImageRequest, signal?: AbortSignal) => Promise<NativeVertexImageResult>;
  /** Optional source normalizer (blob/remote → data URL); defaults to a shared one. */
  normalizeSourceImage?: (imageInput: string) => Promise<string>;
  signal?: AbortSignal;
}

/**
 * Run a Vertex Imagen cloud upscale. Faithful port of the Flow configured-upscale
 * Vertex branch: resolves the project config + image generator, then calls the
 * `imagen-4.0-upscale-preview` model with a `buildVertexImagenUpscaleRequestBody`.
 */
export async function runVertexImagenImageUpscale(
  input: VertexImagenImageUpscaleInput,
): Promise<CloudImageUpscaleOutput> {
  const vertexConfig = getVertexProjectConfig(input.providerSettings);
  const generateVertexImage = input.generateVertexImage ?? resolveVertexImageGenerator(input.providerSettings);

  if (!vertexConfig.projectId || !generateVertexImage) {
    throw new Error(
      'Vertex Imagen upscaling requires a configured project plus the desktop Vertex bridge or a service-account key (Settings > Providers > Vertex AI).',
    );
  }

  const normalizeSourceImage = input.normalizeSourceImage ?? normalizeCloudUpscaleImageInput;
  const result = await generateVertexImage({
    projectId: vertexConfig.projectId,
    location: vertexConfig.location,
    auth: vertexConfig.auth,
    modelId: VERTEX_IMAGEN_UPSCALE_MODEL_ID,
    route: 'imagen-predict',
    body: buildVertexImagenUpscaleRequestBody({
      image: dataUrlToVertexInlineImage(await normalizeSourceImage(input.sourceImage)),
      outputMimeType: input.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
      upscaleFactor: input.upscaleFactor ?? 'x2',
    }),
  }, input.signal);

  if (result.error) {
    throw new Error(result.error);
  }
  if (!result.result) {
    throw new Error('Vertex Imagen did not return an upscaled image payload.');
  }

  return {
    result: result.result,
    mimeType: result.mimeType,
  };
}

// ── Atlas Cloud dedicated upscaler ──────────────────────────────────────────
// Ground truth (in-repo generated schema artifacts, pulled from the live Atlas
// catalog 2026-06-28):
//  - accepted input fields: `model, image, outscale, output_format`
//    (atlasImageAcceptedFields.generated.ts) — NO prompt, NO safety fields.
//  - single `image` string source field (ATLAS_SINGLE_IMAGE_MODELS,
//    atlasNativeImage.ts) — not `images[]`.
//  - `outscale`: number, min 1, max 4, default 1
//    (atlasImageModelParams.generated.ts).
//  - no dimension field (atlasImageDimensions.generated.ts: field null) —
//    output size = source × outscale.
//  - native route (vendor-slugged, not `openai/*`): upload media →
//    POST /model/generateImage → poll /model/prediction/{id}, exactly like the
//    proven flow-execution / generative-fill Atlas paths.

export const ATLAS_IMAGE_UPSCALER_MODEL_ID = 'atlascloud/image-upscaler';
/**
 * Published Atlas price for atlascloud/image-upscaler ($0.01/edit,
 * published-fixed in atlasImageCatalog.generated.ts) — kept consistent with
 * `estimateImageModelCostUsd` by a unit test.
 */
export const ATLAS_IMAGE_UPSCALE_COST_USD = 0.01;

const ATLAS_SUCCESS_STATUSES = ['succeeded', 'success', 'completed', 'complete', 'done', 'ready'];
const ATLAS_FAILURE_STATUSES = ['failed', 'failure', 'error', 'cancelled', 'canceled'];

export interface AtlasImageUpscaleInput {
  sourceImage: string;
  apiKey: string;
  baseUrl?: string;
  /** Documented `outscale` multiplier (number 1–4); defaults to 2 for the standard 2x upscale. */
  outscale?: number;
  outputFormat: ImageOutputFormat;
  fetchImpl?: typeof fetch;
  /** Result download override (default handles Atlas's signed no-CORS CDN URLs). */
  downloadResultBlob?: (url: string) => Promise<Blob>;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Run the dedicated Atlas Cloud image upscaler (`atlascloud/image-upscaler`).
 * Mirrors the proven native-Atlas execution path (upload media →
 * POST /model/generateImage → poll) and sends ONLY the fields the model's
 * documented schema accepts, enforced via `filterAtlasBodyToAcceptedFields`.
 */
export async function runAtlasImageUpscale(input: AtlasImageUpscaleInput): Promise<CloudImageUpscaleOutput> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error('Atlas API key is missing. Add it in Settings.');
  }

  const doFetch = input.fetchImpl ?? fetch;
  const sleepImpl = input.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const baseUrl = normalizeAtlasBaseUrl(input.baseUrl);
  const outscale = Math.min(4, Math.max(1, Number.isFinite(input.outscale ?? 2) ? (input.outscale ?? 2) : 2));
  const image = await uploadAtlasUpscaleSource(doFetch, baseUrl, apiKey, input.sourceImage);

  // Schema-exact body: `model, image, outscale, output_format` and nothing else.
  const body = filterAtlasBodyToAcceptedFields({
    model: ATLAS_IMAGE_UPSCALER_MODEL_ID,
    image,
    outscale,
    output_format: input.outputFormat,
  }, ATLAS_IMAGE_UPSCALER_MODEL_ID);

  const response = await doFetch(`${baseUrl}/model/generateImage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await extractCloudUpscaleErrorBody(response, 'Atlas image upscale failed'));
  }

  const created = (await response.json()) as AtlasUpscaleResponse;
  if (created.error || created.data?.error) {
    throw new Error('Atlas image upscale failed.');
  }

  const immediate = extractAtlasOutputUrl(created);
  const predictionId = created.data?.id ?? created.data?.prediction_id ?? created.id ?? created.prediction_id;
  const resultUrl = immediate
    ?? (predictionId ? await pollAtlasUpscaleResult(doFetch, sleepImpl, baseUrl, apiKey, predictionId) : undefined);
  if (!resultUrl) {
    throw new Error('Atlas did not return an upscaled image output.');
  }

  const normalized = /^(https?:|blob:|data:)/i.test(resultUrl)
    ? resultUrl
    : `data:image/${input.outputFormat};base64,${resultUrl}`;
  // Atlas results are signed CDN URLs without CORS headers — download through
  // the direct native path (Electron net.fetch / CapacitorHttp), like the
  // generative-fill Atlas path does.
  const downloadResultBlob = input.downloadResultBlob
    ?? ((url: string) => fetchProviderResultBlob(url, 'Atlas upscale result download failed'));
  const blob = await downloadResultBlob(normalized);
  return {
    result: URL.createObjectURL(blob),
    mimeType: blob.type || `image/${input.outputFormat}`,
  };
}

interface AtlasUpscaleResponse {
  id?: string;
  prediction_id?: string;
  status?: string;
  error?: unknown;
  data?: {
    id?: string;
    prediction_id?: string;
    status?: string;
    error?: unknown;
  };
}

async function uploadAtlasUpscaleSource(
  doFetch: typeof fetch,
  baseUrl: string,
  apiKey: string,
  sourceImage: string,
): Promise<string> {
  if (/^https?:\/\//i.test(sourceImage)) {
    return sourceImage;
  }

  const sourceResponse = await doFetch(sourceImage);
  const sourceBlob = await sourceResponse.blob();
  const formData = new FormData();
  formData.append('file', new File([sourceBlob], 'image-upscale-source.png', { type: sourceBlob.type || 'image/png' }));
  const response = await doFetch(`${baseUrl}/model/uploadMedia`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await extractCloudUpscaleErrorBody(response, 'Atlas media upload failed'));
  }

  const payload = (await response.json()) as {
    url?: string;
    download_url?: string;
    data?: { url?: string; download_url?: string };
  };
  const uploadedUrl = payload.data?.download_url ?? payload.data?.url ?? payload.download_url ?? payload.url;
  if (!uploadedUrl) {
    throw new Error('Atlas media upload did not return a URL.');
  }
  return uploadedUrl;
}

async function pollAtlasUpscaleResult(
  doFetch: typeof fetch,
  sleepImpl: (ms: number) => Promise<void>,
  baseUrl: string,
  apiKey: string,
  predictionId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await doFetch(`${baseUrl}/model/prediction/${encodeURIComponent(predictionId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(await extractCloudUpscaleErrorBody(response, 'Atlas image upscale polling failed'));
    }
    const payload = (await response.json()) as AtlasUpscaleResponse;
    const url = extractAtlasOutputUrl(payload);
    const status = (payload.data?.status ?? payload.status)?.toLowerCase();
    if (status && ATLAS_FAILURE_STATUSES.includes(status)) {
      throw new Error('Atlas image upscale failed.');
    }
    if (url && (!status || ATLAS_SUCCESS_STATUSES.includes(status))) {
      return url;
    }
    await sleepImpl(2000);
  }
  throw new Error('Atlas image upscale timed out.');
}

/**
 * Resolve a Vertex image generator: prefer the Electron bridge (gcloud auth),
 * fall back to direct REST with the user's service-account key. Mirrors the Flow
 * resolver so the Image editor gets the same bridgeless mobile path.
 */
export function resolveVertexImageGenerator(
  providerSettings: ProviderSettings,
): ((request: NativeVertexImageRequest) => Promise<NativeVertexImageResult>) | undefined {
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.generateVertexImage) {
    return bridge.generateVertexImage;
  }
  if (isVertexDirectRestAvailable(providerSettings)) {
    return (request: NativeVertexImageRequest) => generateVertexImageDirect(request, providerSettings);
  }
  return undefined;
}

async function dataUrlToUpscaleFile(dataUrl: string, filename: string, signal?: AbortSignal): Promise<File> {
  throwIfAborted(signal);
  const response = await fetch(dataUrl, { signal });
  const blob = await response.blob();
  throwIfAborted(signal);
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

async function normalizeCloudUpscaleImageInput(imageInput: string): Promise<string> {
  if (imageInput.startsWith('data:')) {
    return imageInput;
  }
  const response = await fetch(imageInput);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

async function extractCloudUpscaleErrorBody(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string };
    return payload.error?.message ?? payload.message ?? `${fallback} (${response.status})`;
  }

  const text = await response.text();
  return text || `${fallback} (${response.status})`;
}
