import type { GenerativeFillRequest, GenerativeFillResult } from '../imageEditorAi';
import { useSettingsStore } from '../../store/settingsStore';
import { readBinaryImageResponseBlob } from './blobUtils';

/**
 * Generic HTTP inpaint adapter. Posts JSON to a user-configurable endpoint
 * with `image` (base64), `mask` (base64), and `prompt`. Expects the response
 * body to be either an image binary or `{ image: <base64> }` JSON.
 */
export async function runGenericHttpInpaint(
  request: GenerativeFillRequest,
): Promise<GenerativeFillResult> {
  const settings = useSettingsStore.getState();
  const endpoint = (settings.providerSettings.genericImageEndpointUrl || '').trim();

  if (!endpoint) {
    throw new Error(
      `Generic HTTP endpoint not configured. Set it in Settings -> Runtime Options.`,
    );
  }
  const auth = (settings.providerSettings.genericImageAuthHeader || '').trim();

  const sourceBase64 = await blobToBase64(request.source);
  const maskBase64 = await blobToBase64(request.mask);

  const body = JSON.stringify({
    prompt: request.prompt,
    image: sourceBase64,
    mask: maskBase64,
    model: request.model,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) headers.Authorization = auth;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
    signal: request.abortSignal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Generic inpaint endpoint failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    return { png: await readBinaryImageResponseBlob(response), modelUsed: request.model ?? 'generic' };
  }

  const json = (await response.json()) as { image?: string };
  if (!json.image) {
    throw new Error('Generic endpoint response missing `image` field.');
  }
  const bytes = Uint8Array.from(atob(json.image), (c) => c.charCodeAt(0));
  return {
    png: new Blob([bytes as BlobPart], { type: 'image/png' }),
    modelUsed: request.model ?? 'generic',
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
