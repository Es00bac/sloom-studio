import { useSettingsStore } from '../../store/settingsStore';
import type { GenerativeFillRequest, GenerativeFillResult } from '../imageEditorAi';
import { fetchProviderResultBlob } from '../remoteMediaFetch';
import { blobToDataUrl, dataUrlToBlob, resolveReferenceImageInput } from './blobUtils';
import { buildBflFlux2Request } from './requestBuilders';

const DEFAULT_MODEL = 'flux-2-pro';

interface BflCreateResponse {
  id?: string;
  polling_url?: string;
  error?: string | { message?: string };
}

interface BflPollResponse {
  status?: string;
  result?: {
    sample?: string;
  };
  error?: string | { message?: string };
}

export async function runBflInpaint(
  request: GenerativeFillRequest,
): Promise<GenerativeFillResult> {
  const apiKey = useSettingsStore.getState().apiKeys.bfl;
  if (!apiKey) {
    throw new Error('Black Forest Labs API key not configured. Set it in Settings -> API Keys.');
  }

  const model = request.model ?? DEFAULT_MODEL;
  const sourceImage = await blobToDataUrl(request.source);
  const referenceImages = await resolveReferenceImages(request.references);
  const built = buildBflFlux2Request({
    modelId: model,
    prompt: request.prompt,
    sourceImage,
    referenceImages,
    operation: 'image-edit',
  });

  const response = await fetch(built.endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'x-key': apiKey,
    },
    body: JSON.stringify(built.body),
    signal: request.abortSignal,
  });

  if (!response.ok) {
    throw new Error(`BFL image edit failed (${response.status}): ${await response.text()}`);
  }

  const created = (await response.json()) as BflCreateResponse;
  if (created.error) {
    throw new Error(extractBflError(created.error));
  }
  if (!created.polling_url) {
    throw new Error('BFL image edit did not return a polling URL.');
  }

  const resultUrl = await pollBflResult(created.polling_url, apiKey, request.abortSignal);
  const png = resultUrl.startsWith('data:')
    ? dataUrlToBlob(resultUrl, 'image/png')
    : await fetchBflResultBlob(resultUrl, request.abortSignal);

  return {
    png,
    modelUsed: model,
    approximateCostUsd: built.estimatedCostUsd,
  };
}

async function pollBflResult(
  pollingUrl: string,
  apiKey: string,
  abortSignal: AbortSignal | undefined,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    abortSignal?.throwIfAborted();
    const response = await fetch(pollingUrl, {
      headers: {
        accept: 'application/json',
        'x-key': apiKey,
      },
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`BFL polling failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as BflPollResponse;
    if (payload.status === 'Ready' && payload.result?.sample) {
      return payload.result.sample;
    }
    if (payload.status === 'Error' || payload.status === 'Failed' || payload.error) {
      throw new Error(extractBflError(payload.error ?? payload.status));
    }

    await sleep(750, abortSignal);
  }

  throw new Error('BFL image edit timed out after 90 seconds.');
}

async function fetchBflResultBlob(resultUrl: string, abortSignal: AbortSignal | undefined): Promise<Blob> {
  // BFL delivery URLs (delivery.bfl.ai) are signed and CORS-less; on Android the patched-fetch
  // proxy mangles the signature → 403. Download through the direct, non-proxied native path.
  return fetchProviderResultBlob(resultUrl, 'BFL result download failed', abortSignal);
}

function extractBflError(error: BflCreateResponse['error'] | BflPollResponse['error']): string {
  if (!error) {
    return 'BFL image edit failed.';
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message ?? 'BFL image edit failed.';
}

function sleep(ms: number, abortSignal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    abortSignal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function resolveReferenceImages(
  references: GenerativeFillRequest['references'],
): Promise<string[]> {
  // BFL takes input_image_N as base64 data URLs. Editor references arrive as browser-local URLs
  // (blob:/signal-loom-asset://) that api.bfl.ai can never fetch — resolve them to bytes in-app;
  // only public http(s) URLs may pass through.
  const resolved = await Promise.all((references ?? []).map(async (reference) => {
    const input = await resolveReferenceImageInput(reference);
    if (!input) return null;
    if ('httpUrl' in input) return input.httpUrl;
    return blobToDataUrl(input.blob);
  }));
  return resolved.filter((value): value is string => Boolean(value));
}
