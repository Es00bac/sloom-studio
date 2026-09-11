// BytePlus / ModelArk (ByteDance) image generation — FIRST-PARTY Seedream provider.
//
// Built to the public ModelArk image-generation API shape (POST {base}/images/generations, Bearer auth,
// JSON { model, prompt, size, response_format, watermark: false } -> { data: [{ url } | { b64_json }] }).
import { useSettingsStore } from '../../store/settingsStore';
import type { GenerativeFillRequest, GenerativeFillResult } from '../imageEditorAi';

const DEFAULT_BYTEPLUS_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

/** Always resolves to a usable BytePlus base URL (never empty → never falls back to another host). */
export function normalizeBytePlusBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_BYTEPLUS_BASE_URL;
}

export interface BytePlusImageRequest {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  prompt: string;
  /** e.g. "2K" or a documented exact WxH value. */
  size?: string;
  seed?: number;
  signal?: AbortSignal;
}

interface BytePlusImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string } | string;
}

/** Returns the generated image as an http URL or a `data:` URL, or throws. */
export async function bytePlusGenerateImage(request: BytePlusImageRequest): Promise<string> {
  const body: Record<string, unknown> = {
    model: request.modelId,
    prompt: request.prompt,
    response_format: 'url',
    // ModelArk can add an "AI generated" image watermark by default; Sloom exports clean generated assets.
    watermark: false,
  };
  if (request.size) body.size = request.size;
  if (typeof request.seed === 'number') body.seed = request.seed;

  const response = await fetch(`${request.baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: request.signal,
  });
  if (!response.ok) {
    throw new Error(`BytePlus image generation failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as BytePlusImageResponse;
  if (json.error) {
    throw new Error(typeof json.error === 'string' ? json.error : (json.error.message ?? 'BytePlus image generation failed.'));
  }
  const entry = json.data?.[0];
  if (entry?.b64_json) return `data:image/png;base64,${entry.b64_json}`;
  if (entry?.url) return entry.url;
  throw new Error('BytePlus returned no image data.');
}

/**
 * Generative-fill adapter. The Seedream masked-edit request shape isn't confirmed yet, so for now this
 * runs prompt-driven GENERATION (the Flow image node is the primary BytePlus surface). Wire masked inpaint
 * AND reference images here once the ModelArk edit/i2i API is confirmed with BytePlus.
 *
 * BytePlus is not offered as a Generative Fill Bar provider (no confirmed edit endpoint to route an
 * op to), and every catalog capability for it correctly reports `referenceImages: false` /
 * `maxReferenceImages: 0`, so the editor never lets a user attach references here. If a caller ever
 * supplies them anyway (a future capability change, a direct API caller, etc.), fail loudly instead
 * of silently generating a reference-free image — matching the "silent degrade" bug class fixed for
 * the other adapters in commit 0bae7b2.
 */
export async function runBytePlusImage(request: GenerativeFillRequest): Promise<GenerativeFillResult> {
  const apiKey = useSettingsStore.getState().apiKeys.byteplus?.trim();
  if (!apiKey) {
    throw new Error('BytePlus API key not configured. Set it in Settings → API Keys.');
  }
  if (request.references && request.references.length > 0) {
    throw new Error(
      'BytePlus Seedream has no confirmed reference-image endpoint in Sloom Studio yet; remove the attached references or choose a provider that supports them (Gemini, OpenAI, Atlas, BFL, Stability, or Local/Open).',
    );
  }
  const baseUrl = normalizeBytePlusBaseUrl(useSettingsStore.getState().providerSettings.bytePlusBaseUrl);
  const modelUsed = request.model ?? 'seedream-5-0-260128';
  const urlOrData = await bytePlusGenerateImage({
    apiKey,
    baseUrl,
    modelId: modelUsed,
    prompt: request.prompt,
    signal: request.abortSignal,
  });
  const png = await (await fetch(urlOrData)).blob();
  return { png, modelUsed };
}
