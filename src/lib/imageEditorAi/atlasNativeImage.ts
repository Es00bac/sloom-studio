// Native Atlas Cloud image generation/edit for the Image-editor generative-fill path.
// Mirrors the proven flow-execution native Atlas path (upload media → POST
// /model/generateImage → poll), so native Atlas models (e.g. google/nano-banana-2/edit)
// work in the editor instead of being misrouted to OpenAI's images.edit endpoint.

import { fetchProviderResultBlob } from '../remoteMediaFetch';
import { resolveReferenceImageInput } from './blobUtils';
import { ATLAS_IMAGE_DIMENSION_SPECS, type AtlasDimensionSpec } from './atlasImageDimensions.generated';
import { ATLAS_IMAGE_MODEL_PARAMS, type AtlasModelParam } from './atlasImageModelParams.generated';
import { ATLAS_IMAGE_ACCEPTED_FIELDS } from './atlasImageAcceptedFields.generated';

export function normalizeAtlasBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://api.atlascloud.ai/api/v1';
  if (trimmed === 'https://api.atlascloud.ai') return 'https://api.atlascloud.ai/api/v1';
  return trimmed;
}

/** Native Atlas models are vendor-slugged (e.g. `google/nano-banana-2/edit`); `openai/*` and bare ids use the OpenAI-compatible route. */
export function isAtlasNativeImageModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id.includes('/') && !id.startsWith('openai/');
}

// ── Per-model request shape (verified live against Atlas `/models` schemas, 2026-06-22; docs/notes/732) ──
// The source-image field name VARIES per model, and the wrong one is silently ignored (an "edit"
// degrades to text-to-image; references do nothing). References must ride in the SAME array field as
// the source — there is no `reference_images` field on any Atlas model.

/** Models whose schema takes a SINGLE `image` string (everything else takes an `images` array). */
const ATLAS_SINGLE_IMAGE_MODELS = new Set([
  'atlascloud/qwen-image/edit',
  'black-forest-labs/flux-dev', 'black-forest-labs/flux-dev-lora',
  'black-forest-labs/flux-kontext-dev', 'black-forest-labs/flux-kontext-dev-lora',
  'black-forest-labs/flux-schnell',
  'microsoft/mai-image-2.5-flash/edit', 'microsoft/mai-image-2.5/edit',
  'youchuan/v8.1/image-to-image', 'youchuan/v8.1/remove-background', 'youchuan/v8.1/style-transfer',
  'atlascloud/image-upscaler',
  'openai/gpt-image-1/edit',
]);
/** Models whose schema names the array field `image_urls` instead of `images`. */
const ATLAS_IMAGE_URLS_MODELS = new Set([
  'xai/grok-imagine-image-quality/edit', 'xai/grok-imagine-image/edit',
]);
// The ONLY Atlas models whose documented schema accepts a `mask_image` field (verified 2026-06-28 against
// static.atlascloud.ai/model/schema/*). gpt-image-1.5/2/-mini/edit take an `images[]` array with NO mask
// field — they were previously listed here by mistake. Sending a mask to a model that does not document
// the field is stripped by filterAtlasBodyToAcceptedFields anyway, so this set must stay schema-accurate.
/** Models that accept a `mask_image` field. */
const ATLAS_MASK_MODELS = new Set([
  'black-forest-labs/flux-dev', 'black-forest-labs/flux-dev-lora', 'black-forest-labs/flux-schnell',
  'openai/gpt-image-1/edit',
]);
/** Mask models that use an ALPHA mask (transparent = edit region) rather than a white-on-black mask. */
const ATLAS_ALPHA_MASK_MODELS = new Set([
  'openai/gpt-image-1/edit',
]);
/**
 * flux-* "inpaint" accepts `mask_image` in its schema but Atlas IGNORES it (output = source). Only the
 * gpt-image edit models actually honour a mask — so route true generative-fill there.
 */
const ATLAS_MASK_HONORED_MODELS = ATLAS_ALPHA_MASK_MODELS;

export type AtlasSourceField = 'image' | 'images' | 'image_urls';

export function resolveAtlasSourceField(modelId: string): AtlasSourceField {
  const id = modelId.trim().toLowerCase();
  if (ATLAS_SINGLE_IMAGE_MODELS.has(id)) return 'image';
  if (ATLAS_IMAGE_URLS_MODELS.has(id)) return 'image_urls';
  return 'images';
}

export function atlasModelSupportsMask(modelId: string): boolean {
  return ATLAS_MASK_MODELS.has(modelId.trim().toLowerCase());
}

/** True only for models that ACTUALLY honour a mask (gpt-image edits) — use these for generative fill. */
export function atlasModelHonorsMask(modelId: string): boolean {
  return ATLAS_MASK_HONORED_MODELS.has(modelId.trim().toLowerCase());
}

export function atlasMaskKind(modelId: string): 'alpha' | 'white' | null {
  const id = modelId.trim().toLowerCase();
  if (ATLAS_ALPHA_MASK_MODELS.has(id)) return 'alpha';
  if (ATLAS_MASK_MODELS.has(id)) return 'white';
  return null;
}

export function getAtlasDimensionSpec(modelId: string): AtlasDimensionSpec | undefined {
  return ATLAS_IMAGE_DIMENSION_SPECS[modelId.trim()] ?? ATLAS_IMAGE_DIMENSION_SPECS[modelId.trim().toLowerCase()];
}

/**
 * Filter a request body to ONLY the input fields the model's documented schema accepts (plus `model`).
 * Sending undocumented fields makes some models reject the request — e.g. flux-2-pro/edit documents no
 * `num_inference_steps`/`enable_safety_checker`, and including them returned "no image data in response".
 * Unknown models (not in the generated set) pass through unfiltered as a safe fallback.
 */
export function filterAtlasBodyToAcceptedFields(
  body: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  const accepted = ATLAS_IMAGE_ACCEPTED_FIELDS[modelId.trim()]
    ?? ATLAS_IMAGE_ACCEPTED_FIELDS[modelId.trim().toLowerCase()];
  if (!accepted || accepted.length === 0) {
    return body;
  }
  const allow = new Set([...accepted, 'model']);
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (allow.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Whether the model's documented schema accepts a given input field (for gating node controls). */
export function atlasModelAcceptsField(modelId: string, field: string): boolean {
  const accepted = ATLAS_IMAGE_ACCEPTED_FIELDS[modelId.trim()]
    ?? ATLAS_IMAGE_ACCEPTED_FIELDS[modelId.trim().toLowerCase()];
  return accepted ? accepted.includes(field) : true; // unknown model → assume yes (don't hide)
}

/** The documented model-specific input parameters (beyond the dedicated controls) for the node's UI. */
export function getAtlasModelParams(modelId: string): AtlasModelParam[] {
  return ATLAS_IMAGE_MODEL_PARAMS[modelId.trim()] ?? ATLAS_IMAGE_MODEL_PARAMS[modelId.trim().toLowerCase()] ?? [];
}

/**
 * Merge the user's model-specific parameter values into the request body, coerced to each parameter's
 * documented type. Only fields the model actually documents are sent (so nothing extraneous), and only
 * when the user set a value (else the model's own default applies). This is what makes every documented
 * feature — resolution, quality, n, thinking_mode, input_fidelity, web search, … — actually reach the API.
 */
export function applyAtlasModelParams(
  body: Record<string, unknown>,
  modelId: string,
  values: Record<string, unknown> | undefined,
): void {
  if (!values) return;
  for (const spec of getAtlasModelParams(modelId)) {
    const raw = values[spec.name];
    if (raw === undefined || raw === null || raw === '') continue;
    if (spec.type === 'boolean') {
      body[spec.name] = typeof raw === 'boolean' ? raw : raw === 'true';
    } else if (spec.type === 'integer') {
      const n = Math.round(Number(raw));
      if (Number.isFinite(n)) body[spec.name] = n;
    } else if (spec.type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) body[spec.name] = n;
    } else {
      body[spec.name] = String(raw); // enum / string
    }
  }
}

function parseRatio(value: string): number | undefined {
  const m = value.match(/^(\d+(?:\.\d+)?)\s*[:x*]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return h > 0 ? w / h : undefined;
}

function parseSizeEnum(value: string): { w: number; h: number } | undefined {
  const m = value.match(/^(\d+)\s*[x*]\s*(\d+)$/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
}

function clampRound(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value / 8) * 8));
}

function snapAspectRatio(options: string[], aspectRatio: string | undefined, targetRatio: number): string {
  if (options.length === 0) return aspectRatio ?? '1:1';
  if (aspectRatio && options.includes(aspectRatio)) return aspectRatio;
  return options.reduce((bestOpt, opt) => {
    const r = parseRatio(opt);
    if (r === undefined) return bestOpt;
    const bestR = parseRatio(bestOpt);
    if (bestR === undefined) return opt;
    return Math.abs(r - targetRatio) < Math.abs(bestR - targetRatio) ? opt : bestOpt;
  }, options.find((opt) => parseRatio(opt) !== undefined) ?? options[0]);
}

function nearestEnumSize(options: string[], targetRatio: number, targetArea: number): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const opt of options) {
    const dims = parseSizeEnum(opt);
    if (!dims) continue;
    const ratioDelta = Math.abs(dims.w / dims.h - targetRatio);
    const areaDelta = Math.abs(dims.w * dims.h - targetArea) / Math.max(targetArea, 1);
    const score = ratioDelta * 10 + areaDelta; // ratio dominates; area breaks ties
    if (score < bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  return best;
}

/**
 * Build the request-body field(s) that set a native Atlas model's OUTPUT size, using ONLY the field the
 * model's documented schema actually defines (verified against the live Atlas schemas — sending a generic
 * `width`/`height` that the model doesn't document is ignored, e.g. wan-2.7 stayed portrait despite
 * 1920×1080). Mapping:
 *  - documented `width`/`height`        → width/height integers (clamped)
 *  - `aspect_ratio` enum                → aspect_ratio, snapped to the nearest allowed ratio
 *  - free `size`                        → "W*H"/"WxH" string, clamped to the model's min/max
 *  - enum `size`                        → the allowed value nearest the target ratio (then area)
 *  - `size` RESOLUTION TIER ("1K"/"2K") → nothing here (it sets resolution, not aspect; exposed as the
 *                                         model's `size` parameter — these edit models follow the SOURCE
 *                                         image's aspect, there is no API parameter to change it)
 *  - no size field                      → nothing (edit follows the source)
 */
export function resolveAtlasDimensionBody(
  modelId: string,
  target: { width: number; height: number; aspectRatio?: string },
): Record<string, string | number> {
  const spec = getAtlasDimensionSpec(modelId);
  const { width, height, aspectRatio } = target;
  const targetRatio = height > 0 ? width / height : 1;

  if (!spec || spec.field === null || spec.field === undefined) {
    return {};
  }

  if (spec.field === 'wh') {
    const min = spec.min ?? 64;
    const max = spec.max ?? 4096;
    return { width: clampRound(width, min, max), height: clampRound(height, min, max) };
  }

  if (spec.field === 'aspect_ratio') {
    return { aspect_ratio: snapAspectRatio(spec.enum ?? [], aspectRatio, targetRatio) };
  }

  // spec.field is 'size' | 'image_size'.
  if (spec.format === 'tier') {
    // Resolution tier only — no aspect control (output follows the source). Exposed as the model's `size`
    // parameter via the generic param section, so don't emit a conflicting value here.
    return {};
  }

  const sep = spec.format === 'x' ? 'x' : '*';
  if (spec.free) {
    const min = spec.min ?? 256;
    const max = spec.max ?? 2048;
    return { [spec.field]: `${clampRound(width, min, max)}${sep}${clampRound(height, min, max)}` };
  }

  // Enumerated sizes: pick the allowed value closest to the target ratio (then area).
  const size = nearestEnumSize(spec.enum ?? [], targetRatio, width * height);
  return size ? { [spec.field]: size } : {};
}

/**
 * Place the source image + any reference images into the request body under the model's real field.
 * Array-field models receive `[source, ...references]` (up to the model's max, e.g. 14 for nano-banana);
 * singular `image` models take just the source (or the first reference). Returns true if anything applied.
 */
export function applyAtlasImageInputs(
  body: Record<string, unknown>,
  modelId: string,
  inputs: { source?: string; references?: readonly string[] },
): boolean {
  const all = [inputs.source, ...(inputs.references ?? [])].filter((u): u is string => Boolean(u && u.trim()));
  if (all.length === 0) return false;
  const field = resolveAtlasSourceField(modelId);
  if (field === 'image') {
    body.image = all[0];
  } else {
    body[field] = all;
  }
  return true;
}

interface AtlasMediaResponse {
  url?: string;
  download_url?: string;
  data?: { url?: string; download_url?: string };
}

interface AtlasImageResponse {
  id?: string;
  prediction_id?: string;
  status?: string;
  error?: unknown;
  output?: unknown;
  outputs?: unknown;
  image?: unknown;
  images?: unknown;
  result?: unknown;
  data?: {
    id?: string;
    prediction_id?: string;
    status?: string;
    error?: unknown;
    output?: unknown;
    outputs?: unknown;
    image?: unknown;
    images?: unknown;
    result?: unknown;
  };
}

const SUCCESS_STATUSES = ['succeeded', 'success', 'completed', 'complete', 'done', 'ready'];
const FAILURE_STATUSES = ['failed', 'failure', 'error', 'cancelled', 'canceled'];

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

export function extractAtlasOutputUrl(payload: AtlasImageResponse): string | undefined {
  return firstNonEmpty(
    firstString(payload.data?.outputs),
    firstString(payload.data?.output),
    firstString(payload.data?.images),
    firstString(payload.data?.image),
    firstString(payload.data?.result),
    firstString(payload.outputs),
    firstString(payload.output),
    firstString(payload.images),
    firstString(payload.image),
    firstString(payload.result),
  );
}

function extractAtlasPredictionId(payload: AtlasImageResponse): string | undefined {
  return firstNonEmpty(payload.data?.id, payload.data?.prediction_id, payload.id, payload.prediction_id);
}

function extractAtlasStatus(payload: AtlasImageResponse): string | undefined {
  return firstNonEmpty(payload.data?.status, payload.status)?.toLowerCase();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function uploadAtlasBlob(baseUrl: string, apiKey: string, blob: Blob, filename: string, signal?: AbortSignal): Promise<string> {
  const formData = new FormData();
  formData.append('file', new File([blob], filename, { type: blob.type || 'image/png' }));
  const response = await fetch(`${baseUrl}/model/uploadMedia`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Atlas media upload failed (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as AtlasMediaResponse;
  const url = payload.data?.download_url ?? payload.data?.url ?? payload.download_url ?? payload.url;
  if (!url) throw new Error('Atlas media upload did not return a URL.');
  return url;
}

async function pollAtlasResult(baseUrl: string, apiKey: string, predictionId: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    signal?.throwIfAborted?.();
    const response = await fetch(`${baseUrl}/model/prediction/${encodeURIComponent(predictionId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Atlas image polling failed (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as AtlasImageResponse;
    const url = extractAtlasOutputUrl(payload);
    const status = extractAtlasStatus(payload);
    if (status && FAILURE_STATUSES.includes(status)) {
      throw new Error('Atlas image generation failed.');
    }
    if (url && (!status || SUCCESS_STATUSES.includes(status))) {
      return url;
    }
    await sleep(2000);
  }
  throw new Error('Atlas image generation timed out.');
}

export interface AtlasNativeFillInput {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  prompt: string;
  source: Blob;
  mask?: Blob;
  references?: Array<{ image?: Blob; imageUrl?: string }>;
  outputFormat?: string;
  signal?: AbortSignal;
}

export async function runAtlasNativeGenerativeFill(input: AtlasNativeFillInput): Promise<Blob> {
  const { apiKey, baseUrl } = input;
  const outputFormat = input.outputFormat ?? 'png';

  const sourceImage = await uploadAtlasBlob(baseUrl, apiKey, input.source, 'fill-source.png', input.signal);
  const maskImage = input.mask ? await uploadAtlasBlob(baseUrl, apiKey, input.mask, 'fill-mask.png', input.signal) : undefined;
  // References arrive from the editor as browser-local URLs (blob:/data:/signal-loom-asset://) —
  // Atlas's server cannot fetch those, so anything without public bytes must be resolved in-app
  // and re-uploaded. Only real http(s) URLs may ride through as-is.
  const references = (
    await Promise.all(
      (input.references ?? []).map(async (reference, index) => {
        const resolved = await resolveReferenceImageInput(reference, { signal: input.signal });
        if (!resolved) return null;
        if ('httpUrl' in resolved) return resolved.httpUrl;
        return uploadAtlasBlob(baseUrl, apiKey, resolved.blob, `fill-reference-${index + 1}.png`, input.signal);
      }),
    )
  ).filter((url): url is string => Boolean(url));

  const body: Record<string, unknown> = {
    model: input.modelId,
    prompt: input.prompt,
    output_format: outputFormat,
    enable_safety_checker: true,
  };
  // Source + references go under the model's REAL field (images[]/image/image_urls); references ride in
  // the same array (there is no `reference_images` field). Mask only for models that actually accept one.
  applyAtlasImageInputs(body, input.modelId, { source: sourceImage, references });
  if (maskImage && atlasModelSupportsMask(input.modelId)) body.mask_image = maskImage;

  const response = await fetch(`${baseUrl}/model/generateImage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`Atlas image generation failed (${response.status}): ${await response.text()}`);
  }
  const created = (await response.json()) as AtlasImageResponse;
  if (created.error || created.data?.error) {
    throw new Error('Atlas image generation failed.');
  }

  const immediate = extractAtlasOutputUrl(created);
  const predictionId = extractAtlasPredictionId(created);
  const resultUrl = immediate ?? (predictionId ? await pollAtlasResult(baseUrl, apiKey, predictionId, input.signal) : undefined);
  if (!resultUrl) {
    throw new Error('Atlas did not return an image output.');
  }

  const normalized = /^(https?:|blob:|data:)/i.test(resultUrl)
    ? resultUrl
    : `data:image/${outputFormat};base64,${resultUrl}`;
  // Atlas results are signed CDN URLs with no CORS headers. On Android the patched-fetch proxy
  // re-encodes the signed query string and the CDN returns 403, so download through the direct,
  // non-proxied native path (CapacitorHttp.get / Electron net.fetch).
  return fetchProviderResultBlob(normalized, 'Atlas result download failed', input.signal);
}
