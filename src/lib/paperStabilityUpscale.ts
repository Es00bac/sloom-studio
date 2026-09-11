import {
  createBinaryAssetRecord,
  verifyBinaryAssetRecord,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { buildStabilityUpscaleRequest } from './imageEditorAi/requestBuilders';

export type PaperStabilityUpscaleMode = 'fast' | 'conservative';

export interface PaperStabilityImageMetadata {
  widthPx: number;
  heightPx: number;
  mimeType: string;
}

export interface PaperImagePlacementRequirement {
  placedWidthIn: number;
  placedHeightIn: number;
  requiredPpi: number;
  /** The visible placement footprint after fit/crop math, used to choose a Fast request input. */
  requiredPixels?: { width: number; height: number };
}

export interface PaperStabilityOptions {
  mode: PaperStabilityUpscaleMode;
  prompt?: string;
  creativity?: number;
}

export interface PaperStabilityUpscalePlan {
  mode: PaperStabilityUpscaleMode;
  request: {
    widthPx: number;
    heightPx: number;
    pixelCount: number;
    mimeType: 'image/png';
  };
  expectedOutputPixels?: { width: number; height: number };
  estimatedCostUsd: number;
}

export interface PaperStabilityImageCodec {
  prepare(input: {
    source: BinaryAssetRecord;
    sourceDimensions: PaperStabilityImageMetadata;
    targetWidthPx: number;
    targetHeightPx: number;
  }): Promise<PaperStabilityImageMetadata & { bytes: Uint8Array }>;
  inspect(bytes: Uint8Array, mimeType: string): Promise<Pick<PaperStabilityImageMetadata, 'widthPx' | 'heightPx'>>;
}

export interface PaperStabilityUpscaleResult {
  asset: BinaryAssetRef;
  providerWidthPx: number;
  providerHeightPx: number;
  effectivePpi: number;
  requiredPpi: number;
  printReady: boolean;
  mode: PaperStabilityUpscaleMode;
  estimatedCostUsd: number;
  plan: PaperStabilityUpscalePlan;
}

export interface RunPaperStabilityUpscaleInput {
  apiKey: string;
  source: BinaryAssetRecord;
  sourceDimensions: PaperStabilityImageMetadata;
  placement: PaperImagePlacementRequirement;
  options: PaperStabilityOptions;
  repository: PaperAssetRepository;
  codec?: PaperStabilityImageCodec;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class PaperStabilityUpscaleError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'PaperStabilityUpscaleError';
    this.code = code;
    this.status = status;
  }
}

const FAST_LIMITS = {
  minSide: 32,
  maxSide: 1536,
  minPixels: 1024,
  maxPixels: 1_048_576,
} as const;

const CONSERVATIVE_LIMITS = {
  minSide: 64,
  maxSide: Number.POSITIVE_INFINITY,
  minPixels: 4096,
  maxPixels: 9_437_184,
  maxAspect: 2.5,
} as const;

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PaperStabilityUpscaleError('INVALID_DIMENSIONS', `${name} must be a positive finite number.`);
  }
  return value;
}

function normalizedMimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function outputRequirement(placement: PaperImagePlacementRequirement): { width: number; height: number } {
  const requiredPpi = finitePositive(placement.requiredPpi, 'requiredPpi');
  const placedWidthIn = finitePositive(placement.placedWidthIn, 'placedWidthIn');
  const placedHeightIn = finitePositive(placement.placedHeightIn, 'placedHeightIn');
  return {
    width: Math.max(1, Math.ceil(placement.requiredPixels?.width ?? placedWidthIn * requiredPpi)),
    height: Math.max(1, Math.ceil(placement.requiredPixels?.height ?? placedHeightIn * requiredPpi)),
  };
}

function normalizeDimensions(
  source: Pick<PaperStabilityImageMetadata, 'widthPx' | 'heightPx'>,
  desiredScale: number,
  limits: typeof FAST_LIMITS | typeof CONSERVATIVE_LIMITS,
): { widthPx: number; heightPx: number } {
  const sourceWidth = finitePositive(source.widthPx, 'source width');
  const sourceHeight = finitePositive(source.heightPx, 'source height');
  const sourcePixels = sourceWidth * sourceHeight;
  const minScale = Math.max(
    limits.minSide / sourceWidth,
    limits.minSide / sourceHeight,
    Math.sqrt(limits.minPixels / sourcePixels),
  );
  const maxScale = Math.min(
    limits.maxSide / sourceWidth,
    limits.maxSide / sourceHeight,
    Math.sqrt(limits.maxPixels / sourcePixels),
  );
  if (minScale > maxScale + Number.EPSILON) {
    throw new PaperStabilityUpscaleError('UNSUPPORTED_ASPECT', 'This image aspect cannot satisfy the provider input limits without cropping.');
  }

  let scale = Math.max(minScale, Math.min(maxScale, desiredScale));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const widthPx = Math.max(1, Math.round(sourceWidth * scale));
    const heightPx = Math.max(1, Math.round(sourceHeight * scale));
    const pixels = widthPx * heightPx;
    const tooSmall = widthPx < limits.minSide || heightPx < limits.minSide || pixels < limits.minPixels;
    const tooLarge = widthPx > limits.maxSide || heightPx > limits.maxSide || pixels > limits.maxPixels;
    if (!tooSmall && !tooLarge) return { widthPx, heightPx };

    if (tooLarge) {
      scale *= Math.min(
        limits.maxSide / widthPx,
        limits.maxSide / heightPx,
        Math.sqrt(limits.maxPixels / pixels),
      );
    } else {
      scale *= Math.max(
        limits.minSide / widthPx,
        limits.minSide / heightPx,
        Math.sqrt(limits.minPixels / pixels),
      );
    }
  }
  throw new PaperStabilityUpscaleError('INVALID_DIMENSIONS', 'Could not normalize image dimensions within provider limits.');
}

function validatePlanDimensions(mode: PaperStabilityUpscaleMode, dimensions: { widthPx: number; heightPx: number }): void {
  const limits = mode === 'fast' ? FAST_LIMITS : CONSERVATIVE_LIMITS;
  const { widthPx, heightPx } = dimensions;
  const pixels = widthPx * heightPx;
  if (
    widthPx < limits.minSide || heightPx < limits.minSide
    || widthPx > limits.maxSide || heightPx > limits.maxSide
    || pixels < limits.minPixels || pixels > limits.maxPixels
  ) {
    throw new PaperStabilityUpscaleError('INVALID_DIMENSIONS', `${mode} input dimensions are outside the documented provider limits.`);
  }
  if (mode === 'conservative') {
    const aspect = Math.max(widthPx / heightPx, heightPx / widthPx);
    if (aspect > CONSERVATIVE_LIMITS.maxAspect + 0.000001) {
      throw new PaperStabilityUpscaleError('UNSUPPORTED_ASPECT', 'Conservative upscale accepts aspect ratios only between 1:2.5 and 2.5:1.');
    }
  }
}

export function validatePaperStabilityOptions(options: PaperStabilityOptions): Required<PaperStabilityOptions> {
  if (options.mode !== 'fast' && options.mode !== 'conservative') {
    throw new PaperStabilityUpscaleError('INVALID_MODE', 'Choose Stability Fast or Stability Conservative.');
  }
  if (options.mode === 'fast') {
    return { mode: 'fast', prompt: '', creativity: 0 };
  }
  const prompt = options.prompt?.trim() ?? '';
  if (!prompt) {
    throw new PaperStabilityUpscaleError('MISSING_PROMPT', 'Stability Conservative requires a non-empty prompt.');
  }
  if (prompt.length > 10_000) {
    throw new PaperStabilityUpscaleError('PROMPT_TOO_LONG', 'Stability Conservative prompts cannot exceed 10,000 characters.');
  }
  const creativity = options.creativity ?? 0.35;
  if (!Number.isFinite(creativity) || creativity < 0.2 || creativity > 0.5) {
    throw new PaperStabilityUpscaleError('INVALID_CREATIVITY', 'Stability Conservative creativity must be between 0.2 and 0.5.');
  }
  return { mode: 'conservative', prompt, creativity };
}

export function planPaperStabilityUpscale(input: {
  mode: PaperStabilityUpscaleMode;
  source: PaperStabilityImageMetadata;
  placement: PaperImagePlacementRequirement;
  prompt?: string;
  creativity?: number;
}): PaperStabilityUpscalePlan {
  const options = validatePaperStabilityOptions({
    mode: input.mode,
    prompt: input.prompt,
    creativity: input.creativity,
  });
  const sourceWidth = finitePositive(input.source.widthPx, 'source width');
  const sourceHeight = finitePositive(input.source.heightPx, 'source height');
  const sourceMimeType = normalizedMimeType(input.source.mimeType);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(sourceMimeType)) {
    throw new PaperStabilityUpscaleError('UNSUPPORTED_SOURCE_MIME', 'Stability upscale requires PNG, JPEG, or WebP source artwork.');
  }

  const requirement = outputRequirement(input.placement);
  const sourceAspect = sourceWidth / sourceHeight;
  if (options.mode === 'conservative' && Math.max(sourceAspect, 1 / sourceAspect) > CONSERVATIVE_LIMITS.maxAspect + 0.000001) {
    throw new PaperStabilityUpscaleError('UNSUPPORTED_ASPECT', 'Conservative upscale accepts aspect ratios only between 1:2.5 and 2.5:1.');
  }
  const desiredScale = options.mode === 'fast'
    ? Math.max(requirement.width / 4 / sourceWidth, requirement.height / 4 / sourceHeight)
    : 1;
  const normalized = normalizeDimensions(
    { widthPx: sourceWidth, heightPx: sourceHeight },
    desiredScale,
    options.mode === 'fast' ? FAST_LIMITS : CONSERVATIVE_LIMITS,
  );
  validatePlanDimensions(options.mode, normalized);
  const estimatedCostUsd = options.mode === 'fast' ? 0.02 : 0.4;
  return {
    mode: options.mode,
    request: {
      ...normalized,
      pixelCount: normalized.widthPx * normalized.heightPx,
      mimeType: 'image/png',
    },
    ...(options.mode === 'fast' ? {
      expectedOutputPixels: { width: normalized.widthPx * 4, height: normalized.heightPx * 4 },
    } : {}),
    estimatedCostUsd,
  };
}

export function assessUpscaleResolution(input: {
  outputWidthPx: number;
  outputHeightPx: number;
  placedWidthIn: number;
  placedHeightIn: number;
  requiredPpi: number;
}): { effectivePpi: number; requiredPpi: number; printReady: boolean } {
  const effectivePpi = Math.floor(Math.min(
    finitePositive(input.outputWidthPx, 'output width') / finitePositive(input.placedWidthIn, 'placedWidthIn'),
    finitePositive(input.outputHeightPx, 'output height') / finitePositive(input.placedHeightIn, 'placedHeightIn'),
  ));
  const requiredPpi = Math.ceil(finitePositive(input.requiredPpi, 'requiredPpi'));
  return { effectivePpi, requiredPpi, printReady: effectivePpi >= requiredPpi };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function providerFailure(status: number): PaperStabilityUpscaleError {
  const reason: Record<number, string> = {
    400: 'Stability rejected the image or request parameters.',
    403: 'Stability rejected this image through provider moderation.',
    413: 'Stability rejected this image because the request is too large.',
    422: 'Stability could not process this otherwise valid image.',
    429: 'Stability rate-limited this request. Wait before trying again.',
    500: 'Stability reported a server error. Try again later.',
  };
  return new PaperStabilityUpscaleError('PROVIDER_REJECTED', reason[status] ?? `Stability upscale failed with HTTP ${status}.`, status);
}

async function browserImageCodecPrepare(input: {
  source: BinaryAssetRecord;
  sourceDimensions: PaperStabilityImageMetadata;
  targetWidthPx: number;
  targetHeightPx: number;
}): Promise<PaperStabilityImageMetadata & { bytes: Uint8Array }> {
  if (typeof createImageBitmap !== 'function') {
    throw new PaperStabilityUpscaleError('IMAGE_CODEC_UNAVAILABLE', 'This runtime cannot prepare image bytes for Stability upscale.');
  }
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(input.source.bytes)], { type: input.sourceDimensions.mimeType }));
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(input.targetWidthPx, input.targetHeightPx)
      : typeof document !== 'undefined'
        ? Object.assign(document.createElement('canvas'), { width: input.targetWidthPx, height: input.targetHeightPx })
        : undefined;
    if (!canvas) {
      throw new PaperStabilityUpscaleError('IMAGE_CODEC_UNAVAILABLE', 'This runtime cannot prepare image bytes for Stability upscale.');
    }
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new PaperStabilityUpscaleError('IMAGE_CODEC_UNAVAILABLE', 'Could not create a 2D image preparation surface.');
    context.drawImage(bitmap, 0, 0, input.targetWidthPx, input.targetHeightPx);
    const blob = typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob(
        (value: Blob | null) => value ? resolve(value) : reject(new Error('Could not encode Stability input.')),
        'image/png',
      ));
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: 'image/png',
      widthPx: input.targetWidthPx,
      heightPx: input.targetHeightPx,
    };
  } finally {
    bitmap.close();
  }
}

async function browserImageCodecInspect(bytes: Uint8Array, mimeType: string): Promise<{ widthPx: number; heightPx: number }> {
  if (typeof createImageBitmap !== 'function') {
    throw new PaperStabilityUpscaleError('IMAGE_CODEC_UNAVAILABLE', 'This runtime cannot inspect Stability output dimensions.');
  }
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  try {
    return { widthPx: bitmap.width, heightPx: bitmap.height };
  } finally {
    bitmap.close();
  }
}

const browserImageCodec: PaperStabilityImageCodec = {
  prepare: browserImageCodecPrepare,
  inspect: browserImageCodecInspect,
};

export async function runPaperStabilityUpscale(input: RunPaperStabilityUpscaleInput): Promise<PaperStabilityUpscaleResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new PaperStabilityUpscaleError('MISSING_API_KEY', 'Stability AI API key is not configured. Add it in Settings before upscaling.');
  }
  if (!(await verifyBinaryAssetRecord(input.source))) {
    throw new PaperStabilityUpscaleError('SOURCE_INTEGRITY', 'The selected Paper source bytes do not match their content-addressed record.');
  }
  const options = validatePaperStabilityOptions(input.options);
  const plan = planPaperStabilityUpscale({
    mode: options.mode,
    source: input.sourceDimensions,
    placement: input.placement,
    prompt: options.prompt,
    creativity: options.creativity,
  });
  const codec = input.codec ?? browserImageCodec;
  const prepared = await codec.prepare({
    source: input.source,
    sourceDimensions: input.sourceDimensions,
    targetWidthPx: plan.request.widthPx,
    targetHeightPx: plan.request.heightPx,
  });
  const preparedMimeType = normalizedMimeType(prepared.mimeType);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(preparedMimeType)) {
    throw new PaperStabilityUpscaleError('UNSUPPORTED_SOURCE_MIME', 'Image preparation did not produce PNG, JPEG, or WebP bytes.');
  }
  validatePlanDimensions(options.mode, prepared);

  const built = buildStabilityUpscaleRequest({
    mode: options.mode,
    outputFormat: 'png',
    ...(options.mode === 'conservative' ? { prompt: options.prompt, creativity: options.creativity } : {}),
  });
  const formData = new FormData();
  formData.append('image', new Blob([new Uint8Array(prepared.bytes)], { type: preparedMimeType }), input.source.ref.fileName ?? 'paper-stability-source.png');
  for (const [key, value] of Object.entries(built.fields)) {
    formData.append(key, String(value));
  }

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(built.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'image/*' },
      body: formData,
      signal: input.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new PaperStabilityUpscaleError('CANCELED', 'Stability upscale was canceled.');
    }
    throw new PaperStabilityUpscaleError('NETWORK_FAILED', 'Could not reach Stability for this upscale.');
  }
  if (!response.ok) throw providerFailure(response.status);

  const mimeType = normalizedMimeType(response.headers.get('content-type') ?? undefined);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new PaperStabilityUpscaleError('INVALID_RESPONSE_MIME', 'Stability returned an unsupported output format.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) {
    throw new PaperStabilityUpscaleError('EMPTY_RESPONSE', 'Stability returned an empty image response.');
  }
  const dimensions = await codec.inspect(bytes, mimeType);
  finitePositive(dimensions.widthPx, 'provider output width');
  finitePositive(dimensions.heightPx, 'provider output height');
  const record = await createBinaryAssetRecord(bytes, {
    mimeType,
    fileName: `paper-stability-${options.mode}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)}`,
  });
  const asset = await input.repository.put(record);
  const resolution = assessUpscaleResolution({
    outputWidthPx: dimensions.widthPx,
    outputHeightPx: dimensions.heightPx,
    placedWidthIn: input.placement.placedWidthIn,
    placedHeightIn: input.placement.placedHeightIn,
    requiredPpi: input.placement.requiredPpi,
  });
  return {
    asset,
    providerWidthPx: Math.round(dimensions.widthPx),
    providerHeightPx: Math.round(dimensions.heightPx),
    ...resolution,
    mode: options.mode,
    estimatedCostUsd: built.estimatedCostUsd ?? plan.estimatedCostUsd,
    plan,
  };
}

export interface PaperStabilityUpscaleCoordinator {
  run(input: RunPaperStabilityUpscaleInput): Promise<PaperStabilityUpscaleResult>;
}

/** Shares identical paid work within one Paper action without retaining API keys or image bytes in the key. */
export function createPaperStabilityUpscaleCoordinator(): PaperStabilityUpscaleCoordinator {
  const runs = new Map<string, Promise<PaperStabilityUpscaleResult>>();
  return {
    run(input) {
      const plan = planPaperStabilityUpscale({
        mode: input.options.mode,
        source: input.sourceDimensions,
        placement: input.placement,
        prompt: input.options.prompt,
        creativity: input.options.creativity,
      });
      const key = JSON.stringify({
        source: input.source.ref.id,
        mode: plan.mode,
        widthPx: plan.request.widthPx,
        heightPx: plan.request.heightPx,
        prompt: input.options.mode === 'conservative' ? input.options.prompt?.trim() ?? '' : '',
        creativity: input.options.mode === 'conservative' ? input.options.creativity ?? 0.35 : undefined,
      });
      const existing = runs.get(key);
      if (existing) return existing;
      const run = runPaperStabilityUpscale(input).catch((error) => {
        runs.delete(key);
        throw error;
      });
      runs.set(key, run);
      return run;
    },
  };
}
