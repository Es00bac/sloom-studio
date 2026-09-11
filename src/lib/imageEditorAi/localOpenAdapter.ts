import { useSettingsStore } from '../../store/settingsStore';
import type { GenerativeFillRequest, GenerativeFillResult } from '../imageEditorAi';
import { base64ToBlob, blobToBase64, readBinaryImageResponseBlob, resolveReferenceImageInput } from './blobUtils';
import { buildLocalOpenImageEditRequest } from './requestBuilders';

export async function runLocalOpenInpaint(
  request: GenerativeFillRequest,
): Promise<GenerativeFillResult> {
  const settings = useSettingsStore.getState();
  const endpoint = (
    settings.providerSettings.localOpenImageEndpointUrl || ''
  ).trim();

  if (!endpoint) {
    throw new Error('Local/Open image endpoint not configured. Set it in Settings -> Runtime Options.');
  }

  const auth = (
    settings.providerSettings.localOpenImageAuthHeader || ''
  ).trim();
  const model = request.model
    ?? settings.providerSettings.localOpenImageDefaultModel
    ?? 'Qwen/Qwen-Image-Edit';
  const body = buildLocalOpenImageEditRequest({
    model,
    prompt: request.prompt,
    image: await blobToBase64(request.source),
    mask: await blobToBase64(request.mask),
    referenceImages: await resolveReferenceImages(request.references),
    outputFormat: 'png',
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    headers.Authorization = auth;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: request.abortSignal,
  });

  if (!response.ok) {
    throw new Error(`Local/Open image edit failed (${response.status}): ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    return {
      png: await readBinaryImageResponseBlob(response),
      modelUsed: model,
    };
  }

  const json = (await response.json()) as { image?: string; mimeType?: string; modelUsed?: string; error?: string };
  if (json.error) {
    throw new Error(json.error);
  }
  if (!json.image) {
    throw new Error('Local/Open image edit response missing `image` field.');
  }

  return {
    png: base64ToBlob(json.image, json.mimeType ?? 'image/png'),
    modelUsed: json.modelUsed ?? model,
  };
}

async function resolveReferenceImages(
  references: GenerativeFillRequest['references'],
): Promise<string[]> {
  // The self-hosted endpoint receives base64 image payloads. Browser-local reference URLs
  // (blob:/signal-loom-asset://) must be resolved to bytes in-app — the endpoint can't fetch them.
  const resolved = await Promise.all((references ?? []).map(async (reference) => {
    const input = await resolveReferenceImageInput(reference);
    if (!input) return null;
    if ('httpUrl' in input) return input.httpUrl;
    return blobToBase64(input.blob);
  }));
  return resolved.filter((value): value is string => Boolean(value));
}
