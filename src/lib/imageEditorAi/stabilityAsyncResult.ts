/**
 * Stability's v2beta async edit endpoints (currently Replace Background & Relight) return `{id}`
 * instead of image bytes; the finished image must be fetched from /v2beta/results/{id}.
 * Stability documents a polling rate limit of one request every 10 seconds — respect it.
 */

import { HttpStatusError, NonRetryableError } from '../exponentialBackoff';

interface StabilityAsyncCreatePayload {
  id?: string;
  errors?: string[];
  name?: string;
  message?: string;
}

export function extractStabilityGenerationId(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const id = (payload as StabilityAsyncCreatePayload).id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }

  return undefined;
}

export async function fetchStabilityAsyncResultBlob(input: {
  apiKey: string;
  generationId: string;
  signal?: AbortSignal;
  onStatus?: (statusMessage: string) => void;
  pollIntervalMs?: number;
  maxAttempts?: number;
}): Promise<Blob> {
  const pollIntervalMs = input.pollIntervalMs ?? 10_000;
  const maxAttempts = input.maxAttempts ?? 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (input.signal?.aborted) {
      throw new DOMException('The run was cancelled.', 'AbortError');
    }

    const response = await fetch(
      `https://api.stability.ai/v2beta/results/${encodeURIComponent(input.generationId)}`,
      {
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          Accept: 'image/*',
        },
        signal: input.signal,
      },
    );

    // 202 = still generating; anything else non-OK is a real failure.
    if (response.status === 202) {
      input.onStatus?.(`Stability edit is still in progress… ${attempt + 1} check${attempt === 0 ? '' : 's'} so far`);
      await sleep(pollIntervalMs);
      continue;
    }

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new HttpStatusError(
        response.status,
        detail ? `Stability async result polling failed: ${detail}` : 'Stability async result polling failed',
      );
    }

    return response.blob();
  }

  throw new NonRetryableError('Stability async edit timed out waiting for the finished image.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
