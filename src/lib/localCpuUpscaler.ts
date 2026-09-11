import type { ProviderSettings } from '../types/flow';
import { blobToDataUrl } from './imageEditorAi/blobUtils';

export interface LocalCpuUpscalerImageResult {
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  modelUsed?: string;
}

export interface LocalCpuUpscalerRequestBase {
  baseUrl: string;
  authHeader?: string;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
}

export interface LocalCpuUpscalerInput extends LocalCpuUpscalerRequestBase {
  sourceDataUrl: string;
  targetWidthPx: number;
  targetHeightPx: number;
  model?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

export function normalizeLocalCpuUpscalerBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }

  const preparedInput = trimmed
    .replace(/\/+$/, '')
    .replace(/^\s+|\s+$/g, '');
  if (!preparedInput) return '';

  const hasScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(preparedInput);

  let normalizedInput = preparedInput;
  if (preparedInput.startsWith('//')) {
    normalizedInput = `http:${preparedInput}`;
  } else if (!hasScheme) {
    if (preparedInput.startsWith(':')) {
      normalizedInput = `127.0.0.1${preparedInput}`;
    } else if (/^\d{1,5}$/.test(preparedInput)) {
      normalizedInput = `127.0.0.1:${preparedInput}`;
    }
    normalizedInput = `http://${normalizedInput}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return '';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return '';
  }

  if (!parsed.hostname) {
    return '';
  }

  const segments = parsed.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  let normalizedPath = '';
  if (segments.length > 0) {
    const tail = segments[segments.length - 1]?.toLowerCase();
    const preTail = segments[segments.length - 2]?.toLowerCase();
    if (segments.length >= 2 && preTail === 'v1' && ['capabilities', 'upscale', 'generate'].includes(tail)) {
      segments.length -= 2;
    } else if (tail === 'v1') {
      segments.length -= 1;
    }
    normalizedPath = segments.length > 0 ? `/${segments.join('/')}` : '';
  }

  return `${parsed.protocol}//${parsed.host}${normalizedPath}`;
}

export function isLocalCpuUpscalerConfigured(settings: Pick<ProviderSettings, 'localAiCpuEndpointUrl'>): boolean {
  return normalizeLocalCpuUpscalerBaseUrl(settings.localAiCpuEndpointUrl).length > 0;
}

export async function runLocalCpuUpscaler(input: LocalCpuUpscalerInput): Promise<LocalCpuUpscalerImageResult> {
  const baseUrl = normalizeLocalCpuUpscalerBaseUrl(input.baseUrl);
  if (!baseUrl) {
    const rawUrl = (input.baseUrl ?? '').trim();
    throw new Error(
      `Local AI upscaler URL is not usable: "${rawUrl}". ` +
      'Use a LAN URL like "http://127.0.0.1:8788" or a port-only fallback ":8788".',
    );
  }

  const requestBody = {
    image: input.sourceDataUrl,
    targetWidthPx: Math.max(1, Math.round(input.targetWidthPx)),
    targetHeightPx: Math.max(1, Math.round(input.targetHeightPx)),
    model: input.model?.trim() || 'realesrgan-4x',
    outputFormat: input.outputFormat ?? 'png',
  };
  if (typeof input.quality === 'number' && Number.isFinite(input.quality)) {
    (requestBody as { quality?: number }).quality = Math.min(1, Math.max(0.05, input.quality));
  }

  const endpoint = `${baseUrl}/v1/upscale`;
  const fetcher = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.authHeader?.trim() ? { Authorization: input.authHeader.trim() } : {}),
      },
      body: JSON.stringify(requestBody),
      signal: input.abortSignal,
    });
  } catch (error) {
    if (error instanceof Error && /failed to fetch/i.test(error.message)) {
      throw new Error(
        `Could not connect to Local AI upscaler at "${baseUrl}". ` +
        'Confirm the local upscaler service is running and reachable.',
      );
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Local AI upscaler request failed (${response.status}): ${await response.text()}`);
  }

  return readLocalCpuUpscalerImageResult(response);
}

async function readLocalCpuUpscalerImageResult(response: Response): Promise<LocalCpuUpscalerImageResult> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    const blob = await response.blob();
    return {
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || contentType || 'image/png',
      width: numberHeader(response, 'x-output-width'),
      height: numberHeader(response, 'x-output-height'),
    };
  }

  const json = await readLocalCpuUpscalerJson<{
    image?: string;
    dataUrl?: string;
    mimeType?: string;
    modelUsed?: string;
    width?: number;
    height?: number;
    error?: string;
  }>(response);
  if (json.error) {
    throw new Error(json.error);
  }
  const mimeType = json.mimeType ?? 'image/png';
  const dataUrl = json.dataUrl ?? (json.image ? `data:${mimeType};base64,${json.image}` : '');
  if (!dataUrl) {
    throw new Error('Local AI upscaler response missing image data.');
  }
  return {
    dataUrl,
    mimeType,
    modelUsed: json.modelUsed,
    width: json.width,
    height: json.height,
  };
}

async function readLocalCpuUpscalerJson<TValue>(response: Response): Promise<TValue> {
  try {
    return await response.json() as TValue;
  } catch (error) {
    throw new Error(`Local AI upscaler returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberHeader(response: Response, header: string): number | undefined {
  const value = response.headers.get(header);
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
