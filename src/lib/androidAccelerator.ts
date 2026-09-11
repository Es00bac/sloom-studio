import type { ProviderSettings } from '../types/flow';
import { blobToDataUrl } from './imageEditorAi/blobUtils';

export interface AndroidAcceleratorModelInfo {
  id: string;
  name?: string;
  kind?: 'txt2img' | 'img2img' | 'inpaint' | 'upscale' | string;
  accelerator?: 'qnn-htp' | 'gpu' | 'cpu' | string;
  maxWidth?: number;
  maxHeight?: number;
  notes?: string[];
}

export interface AndroidAcceleratorUpscalerInfo {
  id: string;
  name?: string;
  scale?: number;
  accelerator?: 'qnn-htp' | 'gpu' | 'cpu' | string;
  downloaded?: boolean;
  bridgeModeAvailable?: boolean;
  notes?: string[];
}

export interface AndroidAcceleratorStatus {
  ok: boolean;
  deviceName?: string;
  port?: number;
  accelerator?: 'qnn-htp' | 'gpu' | 'cpu' | string;
  mode?: string;
  models: AndroidAcceleratorModelInfo[];
  upscalers: AndroidAcceleratorUpscalerInfo[];
  jobStatus?: AndroidAcceleratorJobStatus;
  version?: string;
  warnings?: string[];
}

export interface AndroidAcceleratorJobStatus {
  active?: boolean;
  activeJobs?: number;
  completedJobs?: number;
  failedJobs?: number;
  operation?: string;
  modelId?: string;
  sourceWidthPx?: number;
  sourceHeightPx?: number;
  targetWidthPx?: number;
  targetHeightPx?: number;
  outputWidthPx?: number;
  outputHeightPx?: number;
  durationMs?: number;
  message?: string;
}

export interface AndroidAcceleratorImageResult {
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | string;
  modelUsed?: string;
  width?: number;
  height?: number;
  seed?: number;
  accelerator?: string;
  warnings?: string[];
}

export interface AndroidUpscalerAvailability {
  available: boolean;
  reason?: string;
}

export interface AndroidModelAvailability {
  available: boolean;
  reason?: string;
}

export interface AndroidAcceleratorSetupSummary {
  mode: 'integrated' | 'bridge' | 'unknown';
  title: string;
  detail: string;
  readyForGeneration: boolean;
  readyForUpscale: boolean;
  warnings: string[];
}

export interface AndroidAcceleratorRequestBase {
  baseUrl: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
}

export interface AndroidAcceleratorUpscaleInput extends AndroidAcceleratorRequestBase {
  sourceDataUrl: string;
  targetWidthPx: number;
  targetHeightPx: number;
  upscalerId?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

export interface AndroidAcceleratorRetryEvent {
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export interface AndroidAcceleratorRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  onRetry?: (event: AndroidAcceleratorRetryEvent) => void;
}

export interface AndroidAcceleratorGenerateInput extends AndroidAcceleratorRequestBase {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
}

export function normalizeAndroidAcceleratorBaseUrl(value: string | undefined): string {
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

export function isAndroidAcceleratorConfigured(
  settings: Pick<ProviderSettings, 'androidAcceleratorBaseUrl'>,
): boolean {
  return normalizeAndroidAcceleratorBaseUrl(settings.androidAcceleratorBaseUrl).length > 0;
}

export async function getAndroidAcceleratorStatus(input: AndroidAcceleratorRequestBase): Promise<AndroidAcceleratorStatus> {
  const response = await requestAndroidAccelerator(input, '/v1/capabilities', {
    method: 'GET',
  });
  const json = await readAndroidAcceleratorJson<Partial<AndroidAcceleratorStatus>>(response);
  return {
    ok: Boolean(json.ok),
    deviceName: json.deviceName,
    port: typeof json.port === 'number' ? json.port : undefined,
    accelerator: json.accelerator,
    mode: typeof json.mode === 'string' ? json.mode : undefined,
    models: Array.isArray(json.models) ? json.models : [],
    upscalers: Array.isArray(json.upscalers) ? json.upscalers : [],
    jobStatus: typeof json.jobStatus === 'object' && json.jobStatus !== null
      ? json.jobStatus as AndroidAcceleratorJobStatus
      : undefined,
    version: json.version,
    warnings: Array.isArray(json.warnings) ? json.warnings : undefined,
  };
}

export function summarizeAndroidAcceleratorStatus(status: AndroidAcceleratorStatus): AndroidAcceleratorSetupSummary {
  const integrated = status.mode === 'local-dream-integrated' || status.version?.includes('localdream');
  const bridge = !integrated && status.models.some((model) => model.id === 'local-dream-active');
  const mode: AndroidAcceleratorSetupSummary['mode'] = integrated ? 'integrated' : bridge ? 'bridge' : 'unknown';
  const readyForGeneration = status.models.length > 0;
  const readyForUpscale = status.upscalers.some((upscaler) => upscaler.downloaded || upscaler.bridgeModeAvailable);
  const warnings = [...(status.warnings ?? [])];
  const port = status.port ? `:${status.port}` : '';

  if (!readyForGeneration) {
    warnings.push(integrated
      ? 'The one-app Sloom Studio Android build needs at least one downloaded model inside that app before generation or backend-started upscaling can run.'
      : 'No Android image model is currently available.');
  }
  if (!readyForUpscale) {
    warnings.push('No Android upscaler is currently available. Download an upscaler on the phone before selecting Android print upscaling.');
  }

  const modeLabel = mode === 'integrated'
    ? 'one-app Sloom Studio Android'
    : mode === 'bridge'
      ? 'standalone companion bridge'
      : 'Android accelerator';
  const title = `${status.deviceName ?? 'Android device'} online via ${modeLabel}${status.port ? ` (${status.port})` : ''}`;
  const detail = `${status.models.length} model${status.models.length === 1 ? '' : 's'}, ${status.upscalers.length} upscaler${status.upscalers.length === 1 ? '' : 's'} (${status.accelerator ?? 'accelerator unknown'}). ${readyForUpscale ? 'Upscaling is available.' : 'Upscaling is not ready.'} ${readyForGeneration ? 'Generation is available.' : 'Generation is not ready.'}${port ? ` Listening at ${status.deviceName ?? 'device'}${port}.` : ''}`;

  return {
    mode,
    title,
    detail,
    readyForGeneration,
    readyForUpscale,
    warnings,
  };
}

export async function runAndroidAcceleratorUpscale(
  input: AndroidAcceleratorUpscaleInput,
): Promise<AndroidAcceleratorImageResult> {
  const upscalerId = input.upscalerId?.trim() || 'upscaler_realistic';
  await assertAndroidUpscalerReady(input, upscalerId);
  const body: Record<string, string | number> = {
    image: input.sourceDataUrl,
    targetWidthPx: Math.max(1, Math.round(input.targetWidthPx)),
    targetHeightPx: Math.max(1, Math.round(input.targetHeightPx)),
    upscalerId,
    outputFormat: input.outputFormat ?? 'png',
  };
  if (typeof input.quality === 'number' && Number.isFinite(input.quality)) {
    body.quality = Math.min(1, Math.max(0.05, input.quality));
  }

  const response = await requestAndroidAccelerator(input, '/v1/upscale', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return readAndroidAcceleratorImageResult(response);
}

export async function runAndroidAcceleratorUpscaleWithRetry(
  input: AndroidAcceleratorUpscaleInput,
  options: AndroidAcceleratorRetryOptions = {},
): Promise<AndroidAcceleratorImageResult> {
  const maxAttempts = Math.max(1, Math.round(options.maxAttempts ?? 3));
  const delayMs = Math.max(0, Math.round(options.delayMs ?? 1500));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runAndroidAcceleratorUpscale(input);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableAndroidAcceleratorError(error)) {
        throw error;
      }
      options.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error,
      });
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function isRetryableAndroidAcceleratorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/not configured|pairing token|unauthorized|forbidden|\b40[013]\b/i.test(message)) {
    return false;
  }
  if (/not downloaded|no downloaded|missing json image|invalid upscale json|response missing image data/i.test(message)) {
    return false;
  }
  if (/request failed \((408|409|425|429|500|502|503|504)\)/i.test(message)) {
    return true;
  }
  return /failed to fetch|network|timeout|timed out|connection|empty reply|backend.*not.*ready|not reachable|temporarily|socket|econnreset|econnrefused/i.test(message);
}

async function assertAndroidUpscalerReady(
  input: AndroidAcceleratorRequestBase,
  upscalerId: string,
): Promise<void> {
  const status = await getAndroidAcceleratorStatus(input).catch(() => undefined);
  const availability = resolveAndroidUpscalerAvailability(status, upscalerId);
  if (availability.available) {
    return;
  }

  throw new Error(availability.reason ?? `Android upscaler "${upscalerId}" is not available.`);
}

export function resolveAndroidUpscalerAvailability(
  status: Pick<AndroidAcceleratorStatus, 'upscalers' | 'warnings'> | undefined,
  upscalerId: string,
): AndroidUpscalerAvailability {
  if (!status) {
    return { available: true };
  }

  const upscaler = status.upscalers.find((candidate) => candidate.id === upscalerId);
  if (!upscaler || upscaler.downloaded || upscaler.bridgeModeAvailable) {
    return { available: true };
  }

  const warning = status.warnings?.length ? ` ${status.warnings.join(' ')}` : '';
  return {
    available: false,
    reason: `Android upscaler "${upscalerId}" is not available. Open Local Dream on the phone, choose/download the upscaler or model it uses, and wait for the bridge status to become reachable before retrying.${warning}`,
  };
}

export async function runAndroidAcceleratorGenerate(
  input: AndroidAcceleratorGenerateInput,
): Promise<AndroidAcceleratorImageResult> {
  const modelId = input.modelId?.trim() || 'local-dream-active';
  await assertAndroidModelReady(input, modelId);
  const body = {
    modelId,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    width: Math.max(64, Math.round(input.width)),
    height: Math.max(64, Math.round(input.height)),
    steps: input.steps,
    cfgScale: input.cfgScale,
    seed: input.seed,
    outputFormat: input.outputFormat ?? 'png',
  };
  const response = await requestAndroidAccelerator(input, '/v1/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return readAndroidAcceleratorImageResult(response);
}

async function assertAndroidModelReady(
  input: AndroidAcceleratorRequestBase,
  modelId: string,
): Promise<void> {
  const status = await getAndroidAcceleratorStatus(input).catch(() => undefined);
  const availability = resolveAndroidModelAvailability(status, modelId);
  if (availability.available) {
    return;
  }

  throw new Error(availability.reason ?? `Android image model "${modelId}" is not available.`);
}

export function resolveAndroidModelAvailability(
  status: Pick<AndroidAcceleratorStatus, 'models' | 'warnings'> | undefined,
  modelId: string,
): AndroidModelAvailability {
  if (!status) {
    return { available: true };
  }

  const selectedModelId = modelId.trim() || 'local-dream-active';
  if (status.models.some((candidate) => candidate.id === selectedModelId)) {
    return { available: true };
  }

  const warning = status.warnings?.length ? ` ${status.warnings.join(' ')}` : '';
  return {
    available: false,
    reason: `Android image model "${selectedModelId}" is not available. Open Local Dream on the phone, tap a downloaded NPU model, and wait for the Sloom Studio companion bridge status to become reachable before retrying.${warning}`,
  };
}

async function requestAndroidAccelerator(
  input: AndroidAcceleratorRequestBase,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const baseUrl = normalizeAndroidAcceleratorBaseUrl(input.baseUrl);
  if (!baseUrl) {
    const rawUrl = (input.baseUrl ?? '').trim();
    throw new Error(
      `Android accelerator URL is not usable: "${rawUrl}". ` +
      'Use a LAN URL like "http://192.168.1.42:8788" or a port-only fallback ":8788" for local loopback.',
    );
  }

  const requestPath = path.trim() === '' ? '' : path.replace(/^\/+/, '');
  const apiPath = requestPath ? `/${requestPath}` : '';
  const base = baseUrl.replace(/\/+$/, '');
  const endpoint = `${base}${apiPath}`.replace(/\/v1\/v1\//i, '/v1/');

  const fetcher = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    ...normalizeHeaders(init.headers),
    ...buildAndroidAcceleratorAuthHeaders(input.authToken),
  };
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      ...init,
      headers,
      signal: input.abortSignal,
    });
  } catch (error) {
    if (error instanceof Error && /failed to fetch/i.test(error.message)) {
      throw new Error(
        `Could not connect to Android accelerator at "${baseUrl}". ` +
        'Confirm the phone server is running, the device is on the same LAN, and the pairing token is current.',
      );
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Android accelerator request failed (${response.status}): ${await response.text()}`);
  }

  return response;
}

function buildAndroidAcceleratorAuthHeaders(authToken: string | undefined): Record<string, string> {
  const token = authToken?.trim();
  if (!token) return {};
  return {
    Authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`,
    'X-Signal-Loom-Auth': token,
  };
}

function normalizeHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function readAndroidAcceleratorImageResult(response: Response): Promise<AndroidAcceleratorImageResult> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    const blob = await response.blob();
    return {
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || contentType || 'image/png',
      width: numberHeader(response, 'x-output-width'),
      height: numberHeader(response, 'x-output-height'),
      accelerator: response.headers.get('x-accelerator') ?? undefined,
    };
  }

  const json = await readAndroidAcceleratorJson<{
    image?: string;
    dataUrl?: string;
    mimeType?: string;
    modelUsed?: string;
    width?: number;
    height?: number;
    seed?: number;
    accelerator?: string;
    warnings?: string[];
    error?: string;
  }>(response);
  if (json.error) {
    throw new Error(json.error);
  }
  const mimeType = json.mimeType ?? 'image/png';
  const dataUrl = json.dataUrl ?? (json.image ? `data:${mimeType};base64,${json.image}` : '');
  if (!dataUrl) {
    throw new Error('Android accelerator response missing image data.');
  }

  return {
    dataUrl,
    mimeType,
    modelUsed: json.modelUsed,
    width: json.width,
    height: json.height,
    seed: json.seed,
    accelerator: json.accelerator,
    warnings: Array.isArray(json.warnings) ? json.warnings : undefined,
  };
}

async function readAndroidAcceleratorJson<TValue>(response: Response): Promise<TValue> {
  try {
    return await response.json() as TValue;
  } catch (error) {
    throw new Error(`Android accelerator returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberHeader(response: Response, header: string): number | undefined {
  const value = response.headers.get(header);
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
