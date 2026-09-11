import type { PaperDocument, PaperFrame, PaperFramePatch, PaperStabilityPrintUpscaleEvidence } from '../types/paper';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { paperPixelsFromMm } from './paperDocument';
import { buildPaperFrameAssetFromSourceItem, hasPaperAssetReference } from './paperAssetReferences';
import type { VertexImagenOutputMimeType, VertexImagenUpscaleFactor } from './vertexImageRequests';
import type { PaperPrintUpscaleMethod, UsageTelemetry } from '../types/flow';

export const PAPER_PRINT_UPSCALE_MAX_EDGE_PX = 8192;
export const VERTEX_IMAGEN_UPSCALE_MAX_OUTPUT_PIXELS = 17_000_000;
export const STABILITY_FAST_UPSCALE_COST_USD = 0.02;
export const STABILITY_CONSERVATIVE_UPSCALE_COST_USD = 0.4;

const VERTEX_IMAGEN_UPSCALE_FACTORS: Array<{ value: VertexImagenUpscaleFactor; scale: number }> = [
  { value: 'x2', scale: 2 },
  { value: 'x3', scale: 3 },
  { value: 'x4', scale: 4 },
];

export interface PaperPrintUpscaleTarget {
  sourceWidthPx: number;
  sourceHeightPx: number;
  targetWidthPx: number;
  targetHeightPx: number;
  scaleFactor: number;
  needsUpscale: boolean;
  capped: boolean;
}

export interface PaperPrintUpscaleResult extends PaperPrintUpscaleTarget {
  dataUrl: string;
  mimeType: VertexImagenOutputMimeType;
  provider: Exclude<PaperPrintUpscaleBusyProvider, 'preparing'>;
  upscaleFactor?: VertexImagenUpscaleFactor;
  estimatedCostUsd?: number;
}

export interface PaperPrintVertexUpscaleRequest extends PaperPrintUpscaleTarget {
  sourceDataUrl: string;
  sourceMimeType: VertexImagenOutputMimeType;
  upscaleFactor: VertexImagenUpscaleFactor;
}

export interface PaperPrintVertexUpscaleResult {
  dataUrl: string;
  mimeType?: VertexImagenOutputMimeType;
}

export interface PaperPrintLocalAiUpscaleRequest extends PaperPrintUpscaleTarget {
  sourceDataUrl: string;
  prompt?: string;
}

export interface PaperPrintLocalAiUpscaleResult {
  dataUrl: string;
  mimeType?: VertexImagenOutputMimeType;
}

export interface PaperPrintAndroidAcceleratorUpscaleRequest extends PaperPrintUpscaleTarget {
  sourceDataUrl: string;
  upscalerId?: string;
}

export interface PaperPrintAndroidAcceleratorUpscaleResult {
  dataUrl: string;
  mimeType?: VertexImagenOutputMimeType;
}

export interface PaperPrintAndroidNativeUpscaleRequest extends PaperPrintUpscaleTarget {
  sourceDataUrl: string;
}

export interface PaperPrintAndroidNativeUpscaleResult {
  dataUrl: string;
  mimeType?: VertexImagenOutputMimeType;
}

export type PaperPrintUpscaleBusyProvider =
  | 'browser'
  | 'preparing'
  | 'vertex-imagen'
  | 'stability-fast'
  | 'stability-conservative'
  | 'android-accelerator'
  | 'android-native'
  | 'local-ai-cpu';

export interface PaperPrintUpscalePlan {
  method: PaperPrintUpscaleMethod;
  provider: Exclude<PaperPrintUpscaleBusyProvider, 'preparing'>;
  canRun: boolean;
  unavailableReason?: string;
  estimatedCostUsd?: number;
  costLabel: string;
  usesLocalFinalFit: boolean;
  vertexUpscaleFactor?: VertexImagenUpscaleFactor;
  notes: string[];
}

export function buildPaperPrintUpscaleUsageTelemetry(
  plan: Pick<PaperPrintUpscalePlan, 'provider' | 'estimatedCostUsd' | 'notes'>,
): UsageTelemetry {
  const { provider, modelId } = paperPrintUpscaleProviderTelemetryLabel(plan.provider);
  return {
    source: 'actual',
    confidence: plan.estimatedCostUsd === undefined
      ? provider === 'vertex'
        ? 'unknown'
        : 'fixed'
      : 'fixed',
    provider,
    modelId,
    imageCount: 1,
    costUsd: plan.estimatedCostUsd,
    notes: plan.notes,
  };
}

export interface PaperPrintUpscaleFrameJob {
  pageId: string;
  frameId: string;
  frame: PaperFrame;
}

export interface PaperPrintUpscaleProgressInput {
  current: number;
  total: number;
  label: string;
  provider: PaperPrintUpscaleBusyProvider;
  upscaleFactor?: VertexImagenUpscaleFactor;
  targetWidthPx?: number;
  targetHeightPx?: number;
  dpi?: number;
}

export function resolvePaperPrintUpscaleTarget(
  document: Pick<PaperDocument, 'page'>,
  frame: Pick<PaperFrame, 'fit' | 'widthMm' | 'heightMm' | 'imageScale'> & Partial<Pick<PaperFrame, 'imageOffsetXPercent' | 'imageOffsetYPercent'>>,
  source: {
    widthPx: number;
    heightPx: number;
    maxEdgePx?: number;
  },
): PaperPrintUpscaleTarget {
  const sourceWidthPx = positiveInteger(source.widthPx);
  const sourceHeightPx = positiveInteger(source.heightPx);
  const sourceAspect = sourceWidthPx / sourceHeightPx;
  const frameAspect = positiveNumber(frame.widthMm) / positiveNumber(frame.heightMm);
  const frameWidthPx = paperPixelsFromMm(positiveNumber(frame.widthMm), document.page.dpi);
  const frameHeightPx = paperPixelsFromMm(positiveNumber(frame.heightMm), document.page.dpi);
  const imageScale = Math.max(
    0.05,
    typeof frame.imageScale === 'number' && Number.isFinite(frame.imageScale)
      ? frame.imageScale
      : 1,
  );
  const imageOffsetXPercent = typeof frame.imageOffsetXPercent === 'number' && Number.isFinite(frame.imageOffsetXPercent)
    ? frame.imageOffsetXPercent
    : 0;
  const imageOffsetYPercent = typeof frame.imageOffsetYPercent === 'number' && Number.isFinite(frame.imageOffsetYPercent)
    ? frame.imageOffsetYPercent
    : 0;
  const rendered = resolveRenderedPaperImagePx({
    frameWidthPx,
    frameHeightPx,
    frameAspect,
    sourceAspect,
    fit: frame.fit,
    scale: imageScale,
  });

  let targetWidthPx = frameWidthPx * imageScale;
  let targetHeightPx = frameHeightPx * imageScale;

  if (frame.fit === 'cover') {
    if (sourceAspect >= frameAspect) {
      targetHeightPx = frameHeightPx * imageScale;
      targetWidthPx = targetHeightPx * sourceAspect;
    } else {
      targetWidthPx = frameWidthPx * imageScale;
      targetHeightPx = targetWidthPx / sourceAspect;
    }
  } else if (frame.fit === 'contain') {
    if (sourceAspect >= frameAspect) {
      targetWidthPx = frameWidthPx * imageScale;
      targetHeightPx = targetWidthPx / sourceAspect;
    } else {
      targetHeightPx = frameHeightPx * imageScale;
      targetWidthPx = targetHeightPx * sourceAspect;
    }
  }

  const visibleCropScale = resolvePaperImageVisibleCropScale({
    frameWidthPx,
    frameHeightPx,
    renderedWidthPx: rendered.widthPx,
    renderedHeightPx: rendered.heightPx,
    sourceAspect,
    frameAspect,
    fit: frame.fit,
    scale: imageScale,
    imageOffsetXPercent,
    imageOffsetYPercent,
  });
  if (Math.abs(imageOffsetXPercent) > 0.0001 || Math.abs(imageOffsetYPercent) > 0.0001) {
    targetWidthPx *= visibleCropScale.width;
    targetHeightPx *= visibleCropScale.height;
  }

  const cappedTarget = capDimensions({
    widthPx: Math.ceil(targetWidthPx),
    heightPx: Math.ceil(targetHeightPx),
    maxEdgePx: source.maxEdgePx ?? PAPER_PRINT_UPSCALE_MAX_EDGE_PX,
  });
  const scaleFactor = Math.max(
    cappedTarget.widthPx / sourceWidthPx,
    cappedTarget.heightPx / sourceHeightPx,
    1,
  );

  return {
    sourceWidthPx,
    sourceHeightPx,
    targetWidthPx: Math.max(sourceWidthPx, cappedTarget.widthPx),
    targetHeightPx: Math.max(sourceHeightPx, cappedTarget.heightPx),
    scaleFactor: Number(scaleFactor.toFixed(3)),
    needsUpscale: cappedTarget.widthPx > sourceWidthPx || cappedTarget.heightPx > sourceHeightPx,
    capped: cappedTarget.capped,
  };
}

export async function upscalePaperImageForPrint(input: {
  document: Pick<PaperDocument, 'page'>;
  frame: Pick<PaperFrame, 'fit' | 'widthMm' | 'heightMm' | 'imageScale'> & Partial<Pick<PaperFrame, 'imageOffsetXPercent' | 'imageOffsetYPercent'>>;
  src: string;
  method?: PaperPrintUpscaleMethod;
  maxEdgePx?: number;
  vertexUpscale?: (request: PaperPrintVertexUpscaleRequest) => Promise<PaperPrintVertexUpscaleResult>;
  androidAcceleratorUpscale?: (request: PaperPrintAndroidAcceleratorUpscaleRequest) => Promise<PaperPrintAndroidAcceleratorUpscaleResult>;
  androidNativeUpscale?: (request: PaperPrintAndroidNativeUpscaleRequest) => Promise<PaperPrintAndroidNativeUpscaleResult>;
  localAiUpscale?: (request: PaperPrintLocalAiUpscaleRequest) => Promise<PaperPrintLocalAiUpscaleResult>;
  onProviderResolved?: (provider: PaperPrintUpscaleBusyProvider, upscaleFactor?: VertexImagenUpscaleFactor) => void;
}): Promise<PaperPrintUpscaleResult> {
  const image = await loadImageElement(input.src);
  const target = resolvePaperPrintUpscaleTarget(input.document, input.frame, {
    widthPx: image.naturalWidth,
    heightPx: image.naturalHeight,
    maxEdgePx: input.maxEdgePx,
  });

  if (!target.needsUpscale) {
    return {
      ...target,
      dataUrl: imageToPngDataUrl(image, target.sourceWidthPx, target.sourceHeightPx),
      mimeType: 'image/png',
      provider: 'browser',
      estimatedCostUsd: 0,
    };
  }

  const plan = resolvePaperPrintUpscalePlan({
    method: input.method,
    target,
    // Stability uses the managed binary pipeline in paperStabilityUpscale.ts. It must never return
    // through this Data URL-based helper, which locally fits provider output and would misreport PPI.
    stabilityAvailable: false,
    vertexAvailable: Boolean(input.vertexUpscale),
    androidAcceleratorAvailable: Boolean(input.androidAcceleratorUpscale),
    androidNativeAvailable: Boolean(input.androidNativeUpscale),
    localAiAvailable: Boolean(input.localAiUpscale),
  });

  if (!plan.canRun) {
    throw new Error(plan.unavailableReason ?? 'The selected Paper print upscaler is not available.');
  }

  if (input.vertexUpscale && plan.provider === 'vertex-imagen') {
    const useSquareVertexSource = target.sourceWidthPx !== target.sourceHeightPx;
    const squarePadSourcePx = useSquareVertexSource
      ? Math.max(target.sourceWidthPx, target.sourceHeightPx)
      : undefined;
    const vertexUpscaleFactor = resolveVertexImagenUpscaleFactor(
      target,
      { squarePadSource: useSquareVertexSource },
    );
    const vertexSource = resolveVertexUpscaleSource(input.src, image, {
      squarePadSourcePx,
    });

    if (!vertexUpscaleFactor) {
      throw new Error('Vertex Imagen cannot satisfy this image size within its output pixel limit.');
    }

    input.onProviderResolved?.('vertex-imagen', vertexUpscaleFactor);
    const vertexResult = await input.vertexUpscale({
      ...target,
      sourceDataUrl: vertexSource.dataUrl,
      sourceMimeType: vertexSource.mimeType,
      upscaleFactor: vertexUpscaleFactor,
    });
    const maybePreCroppedDataUrl = squarePadSourcePx
      ? await cropDataUrlToCenteredAspectDataUrl(vertexResult.dataUrl, target.sourceWidthPx, target.sourceHeightPx)
      : vertexResult.dataUrl;
    const fittedDataUrl = await fitProviderResultToTargetDataUrl(
      maybePreCroppedDataUrl,
      target.targetWidthPx,
      target.targetHeightPx,
    );

    return {
      ...target,
      dataUrl: fittedDataUrl,
      mimeType: 'image/png',
      provider: 'vertex-imagen',
      upscaleFactor: vertexUpscaleFactor,
      estimatedCostUsd: plan.estimatedCostUsd,
    };
  }

  if (input.androidAcceleratorUpscale && plan.provider === 'android-accelerator') {
    const source = resolveProviderUpscaleSource(input.src, image);
    input.onProviderResolved?.('android-accelerator');
    const androidResult = await input.androidAcceleratorUpscale({
      ...target,
      sourceDataUrl: source.dataUrl,
    });
    const fittedDataUrl = await fitProviderResultToTargetDataUrl(
      androidResult.dataUrl,
      target.targetWidthPx,
      target.targetHeightPx,
    );

    return {
      ...target,
      dataUrl: fittedDataUrl,
      mimeType: 'image/png',
      provider: 'android-accelerator',
      estimatedCostUsd: 0,
    };
  }

  if (input.androidNativeUpscale && plan.provider === 'android-native') {
    const source = resolveProviderUpscaleSource(input.src, image);
    input.onProviderResolved?.('android-native');
    const androidResult = await input.androidNativeUpscale({
      ...target,
      sourceDataUrl: source.dataUrl,
    });
    const fittedDataUrl = await fitProviderResultToTargetDataUrl(
      androidResult.dataUrl,
      target.targetWidthPx,
      target.targetHeightPx,
    );

    return {
      ...target,
      dataUrl: fittedDataUrl,
      mimeType: 'image/png',
      provider: 'android-native',
      estimatedCostUsd: 0,
    };
  }

  if (input.localAiUpscale && plan.provider === 'local-ai-cpu') {
    const source = resolveProviderUpscaleSource(input.src, image);
    input.onProviderResolved?.('local-ai-cpu');
    const localResult = await input.localAiUpscale({
      ...target,
      sourceDataUrl: source.dataUrl,
    });
    const fittedDataUrl = await fitProviderResultToTargetDataUrl(
      localResult.dataUrl,
      target.targetWidthPx,
      target.targetHeightPx,
    );

    return {
      ...target,
      dataUrl: fittedDataUrl,
      mimeType: 'image/png',
      provider: 'local-ai-cpu',
      estimatedCostUsd: 0,
    };
  }

  input.onProviderResolved?.('browser');

  return {
    ...target,
    dataUrl: steppedUpscaleToPngDataUrl(image, target.targetWidthPx, target.targetHeightPx),
    mimeType: 'image/png',
    provider: 'browser',
    estimatedCostUsd: 0,
  };
}

export function resolvePaperPrintUpscalePlan(input: {
  method: PaperPrintUpscaleMethod | undefined;
  target: PaperPrintUpscaleTarget;
  stabilityAvailable: boolean;
  vertexAvailable: boolean;
  localAiAvailable?: boolean;
  androidAcceleratorAvailable?: boolean;
  androidNativeAvailable?: boolean;
}): PaperPrintUpscalePlan {
  const method = input.method ?? 'auto';
  const noCost = estimatePaperPrintUpscaleCostUsd(method, 1);

  if (!input.target.needsUpscale) {
    return {
      method,
      provider: 'browser',
      canRun: true,
      estimatedCostUsd: 0,
      costLabel: 'Free',
      usesLocalFinalFit: false,
      notes: ['The placed image already meets the current print target.'],
    };
  }

  if (method === 'auto') {
    if (input.androidAcceleratorAvailable) {
      return {
        method,
        provider: 'android-accelerator',
        canRun: true,
        estimatedCostUsd: 0,
        costLabel: 'Free after setup',
        usesLocalFinalFit: true,
        notes: [
          'Auto will use the paired Android accelerator over the local network because it has no provider spend.',
          'Sloom Studio will still do an exact local fit to the document DPI after the NPU/GPU AI pass.',
        ],
      };
    }

    if (input.androidNativeAvailable) {
      return {
        method,
        provider: 'android-native',
        canRun: true,
        estimatedCostUsd: 0,
        costLabel: 'Free',
        usesLocalFinalFit: true,
        notes: [
          'Auto will use the Android app native image upscaler because it has no provider spend.',
          'Sloom Studio will still do an exact local fit to the document DPI after the Android result returns.',
        ],
      };
    }

    if (input.localAiAvailable) {
      return {
        method,
        provider: 'local-ai-cpu',
        canRun: true,
        estimatedCostUsd: 0,
        costLabel: 'Free after setup',
        usesLocalFinalFit: true,
        notes: [
          'Auto will use the configured local Vulkan AI upscaler because it has no cloud spend.',
          'Sloom Studio will still do an exact local fit to the document DPI after the AI pass.',
        ],
      };
    }

    if (input.stabilityAvailable) {
      return stabilityPlan('auto', 'stability-fast', true);
    }

    const vertexUpscaleFactor = input.vertexAvailable
      ? resolveVertexImagenUpscaleFactor(input.target, { squarePadSource: true })
      : undefined;
    if (vertexUpscaleFactor) {
      return vertexPlan('auto', true, vertexUpscaleFactor);
    }

    return {
      method,
      provider: 'browser',
      canRun: true,
      estimatedCostUsd: 0,
      costLabel: 'Free',
      usesLocalFinalFit: false,
      notes: ['Auto will use local browser scaling because no configured cloud print upscaler is available.'],
    };
  }

  if (method === 'stability-fast') {
    return stabilityPlan(method, 'stability-fast', input.stabilityAvailable);
  }

  if (method === 'stability-conservative') {
    return stabilityPlan(method, 'stability-conservative', input.stabilityAvailable);
  }

  if (method === 'vertex-imagen') {
    const vertexUpscaleFactor = input.vertexAvailable
      ? resolveVertexImagenUpscaleFactor(input.target, { squarePadSource: true })
      : undefined;
    return vertexPlan(method, Boolean(vertexUpscaleFactor), vertexUpscaleFactor, input.vertexAvailable
      ? 'Vertex Imagen cannot satisfy this image size without exceeding its output pixel limit.'
      : 'Vertex Imagen is not configured in the desktop app.');
  }

  if (method === 'android-accelerator') {
    return {
      method,
      provider: 'android-accelerator',
      canRun: Boolean(input.androidAcceleratorAvailable),
      unavailableReason: input.androidAcceleratorAvailable ? undefined : 'Android accelerator is not configured. Pair the phone and set its LAN URL in Settings.',
      estimatedCostUsd: 0,
      costLabel: 'Free after setup',
      usesLocalFinalFit: true,
      notes: [
        'Runs the AI upscale on a paired Android device with an NPU/GPU-capable companion service.',
        'Sloom Studio will still do an exact local fit to the document DPI after the Android result returns.',
      ],
    };
  }

  if (method === 'local-ai-cpu') {
    return {
      method,
      provider: 'local-ai-cpu',
      canRun: Boolean(input.localAiAvailable),
      unavailableReason: input.localAiAvailable ? undefined : 'External local AI upscaler endpoint is not configured.',
      estimatedCostUsd: 0,
      costLabel: 'Free after setup',
      usesLocalFinalFit: true,
      notes: [
        'Runs through the user-configured compatible local endpoint; Sloom Studio does not install or manage that service.',
        'Sloom Studio will still do an exact local fit to the document DPI after the AI pass.',
      ],
    };
  }

  return {
    method,
    provider: 'browser',
    canRun: true,
    estimatedCostUsd: noCost,
    costLabel: 'Free',
    usesLocalFinalFit: false,
    notes: ['Uses browser canvas scaling with no cloud spend.'],
  };
}

export function estimatePaperPrintUpscaleCostUsd(
  method: PaperPrintUpscaleMethod | Exclude<PaperPrintUpscaleBusyProvider, 'preparing'> | undefined,
  imageCount = 1,
): number | undefined {
  const count = Math.max(1, Math.floor(imageCount));
  if (method === 'stability-fast') {
    return roundUsd(STABILITY_FAST_UPSCALE_COST_USD * count);
  }

  if (method === 'stability-conservative') {
    return roundUsd(STABILITY_CONSERVATIVE_UPSCALE_COST_USD * count);
  }

  if (method === 'local-browser' || method === 'browser' || method === 'local-ai-cpu' || method === 'android-accelerator' || method === 'android-native') {
    return 0;
  }

  return undefined;
}

export function resolveVertexImagenUpscaleFactor(
  target: Pick<PaperPrintUpscaleTarget, 'sourceWidthPx' | 'sourceHeightPx' | 'targetWidthPx' | 'targetHeightPx' | 'needsUpscale'>,
  options?: {
    squarePadSource?: boolean;
  },
): VertexImagenUpscaleFactor | undefined {
  if (!target.needsUpscale) {
    return undefined;
  }

  const sourceIsNotSquare = target.sourceWidthPx !== target.sourceHeightPx;
  const squarePadSourcePx = options?.squarePadSource && sourceIsNotSquare
    ? Math.max(target.sourceWidthPx, target.sourceHeightPx)
    : undefined;
  const sourceWidthPx = squarePadSourcePx ?? target.sourceWidthPx;
  const sourceHeightPx = squarePadSourcePx ?? target.sourceHeightPx;

  const requiredScale = Math.max(
    target.targetWidthPx / sourceWidthPx,
    target.targetHeightPx / sourceHeightPx,
  );

  const factor = VERTEX_IMAGEN_UPSCALE_FACTORS.find((candidate) => (
    candidate.scale >= requiredScale
    && sourceWidthPx * candidate.scale * sourceHeightPx * candidate.scale <= VERTEX_IMAGEN_UPSCALE_MAX_OUTPUT_PIXELS
  ));

  return factor?.value;
}

export function vertexImagenUpscaleFactorToNumber(factor: VertexImagenUpscaleFactor): number {
  return VERTEX_IMAGEN_UPSCALE_FACTORS.find((candidate) => candidate.value === factor)?.scale ?? 1;
}

export function describePaperPrintUpscaleBusyProvider(
  provider: PaperPrintUpscaleBusyProvider,
  upscaleFactor?: VertexImagenUpscaleFactor,
): string {
  if (provider === 'vertex-imagen') {
    return `Cloud upscaler: Vertex Imagen${upscaleFactor ? ` ${upscaleFactor}` : ''}`;
  }

  if (provider === 'browser') {
    return 'Local print upscaler';
  }

  if (provider === 'stability-fast') {
    return 'Cloud upscaler: Stability Fast';
  }

  if (provider === 'stability-conservative') {
    return 'Cloud upscaler: Stability Conservative';
  }

  if (provider === 'android-accelerator') {
    return 'Android accelerator: NPU/GPU upscaler';
  }

  if (provider === 'android-native') {
    return 'Android native image upscaler';
  }

  if (provider === 'local-ai-cpu') {
    return 'External local AI endpoint';
  }

  return 'Preparing print upscaler';
}

export function shouldUseVertexImagenPrintUpscale(
  method: PaperPrintUpscaleMethod | undefined,
  isVertexAvailable: boolean,
): boolean {
  if (!isVertexAvailable) {
    return false;
  }

  return method === undefined || method === 'auto' || method === 'vertex-imagen';
}

export function buildPaperPrintUpscaledFramePatch(
  frame: Pick<PaperFrame,
    'fit'
    | 'imageScale'
    | 'imageOffsetXPercent'
    | 'imageOffsetYPercent'
    | 'imageRotationDeg'
    | 'imageFlipX'
    | 'imageFlipY'
  >,
  item: {
    id: string;
    label: string;
    assetUrl?: string;
    mimeType?: string;
  },
  result: Pick<PaperPrintUpscaleResult, 'targetWidthPx' | 'targetHeightPx'>,
): PaperFramePatch {
  return {
    asset: {
      ...buildPaperFrameAssetFromSourceItem({ ...item, kind: 'image' }),
      pixelWidth: result.targetWidthPx,
      pixelHeight: result.targetHeightPx,
    },
    fit: frame.fit,
    imageScale: frame.imageScale,
    imageOffsetXPercent: frame.imageOffsetXPercent,
    imageOffsetYPercent: frame.imageOffsetYPercent,
    imageRotationDeg: frame.imageRotationDeg,
    imageFlipX: frame.imageFlipX,
    imageFlipY: frame.imageFlipY,
  };
}

/** Applies a binary Stability result without creating a source-bin data URL or changing visible placement. */
export function buildPaperManagedPrintUpscaledFramePatch(
  frame: Pick<PaperFrame,
    'asset'
    | 'fit'
    | 'imageScale'
    | 'imageOffsetXPercent'
    | 'imageOffsetYPercent'
    | 'imageRotationDeg'
    | 'imageFlipX'
    | 'imageFlipY'
  >,
  result: {
    asset: BinaryAssetRef;
    providerWidthPx: number;
    providerHeightPx: number;
  } & Omit<PaperStabilityPrintUpscaleEvidence, 'provider' | 'providerWidthPx' | 'providerHeightPx'>,
): PaperFramePatch {
  return {
    asset: {
      label: frame.asset?.label ?? 'Stability upscaled image',
      kind: 'image',
      locator: { kind: 'managed', ref: result.asset },
      mimeType: result.asset.mimeType,
      pixelWidth: Math.round(result.providerWidthPx),
      pixelHeight: Math.round(result.providerHeightPx),
      printUpscale: {
        provider: 'stability',
        mode: result.mode,
        providerWidthPx: Math.round(result.providerWidthPx),
        providerHeightPx: Math.round(result.providerHeightPx),
        effectivePpi: Math.floor(result.effectivePpi),
        requiredPpi: Math.ceil(result.requiredPpi),
        printReady: result.printReady,
      },
    },
    fit: frame.fit,
    imageScale: frame.imageScale,
    imageOffsetXPercent: frame.imageOffsetXPercent,
    imageOffsetYPercent: frame.imageOffsetYPercent,
    imageRotationDeg: frame.imageRotationDeg,
    imageFlipX: frame.imageFlipX,
    imageFlipY: frame.imageFlipY,
  };
}

export function collectPaperPrintUpscaleFrameJobs(
  document: Pick<PaperDocument, 'page' | 'pages'>,
  sourceItems: Pick<SourceBinLibraryItem, 'id' | 'originNodeId' | 'sourceKey' | 'pixelWidth' | 'pixelHeight'>[] = [],
): PaperPrintUpscaleFrameJob[] {
  const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]));
  const jobs: PaperPrintUpscaleFrameJob[] = [];

  for (const page of document.pages) {
    for (const frame of page.frames) {
      if (!hasPaperAssetReference(frame.asset) || frame.asset?.kind !== 'image') {
        continue;
      }

      if (isPaperPrintUpscaleSkippable(frame)) {
        continue;
      }

      const sourceItem = frame.asset.sourceBinItemId
        ? sourceItemById.get(frame.asset.sourceBinItemId)
        : undefined;
      if (isPaperFramePrintReady(document, frame, sourceItem)) {
        continue;
      }

      jobs.push({
        pageId: page.id,
        frameId: frame.id,
        frame,
      });
    }
  }

  return jobs;
}

export function isPaperPrintUpscaledSourceItem(
  item: Pick<SourceBinLibraryItem, 'originNodeId' | 'sourceKey'> | undefined,
): boolean {
  return item?.originNodeId === 'paper-print-upscale'
    || item?.sourceKey?.startsWith('paper-print-upscale:') === true;
}

export function isPaperFramePrintReady(
  document: Pick<PaperDocument, 'page'>,
  frame: Pick<PaperFrame, 'asset' | 'fit' | 'widthMm' | 'heightMm' | 'imageScale' | 'kind'> & Partial<Pick<PaperFrame, 'imageOffsetXPercent' | 'imageOffsetYPercent' | 'comicSfxDesign'>>,
  sourceItem?: Pick<SourceBinLibraryItem, 'pixelWidth' | 'pixelHeight'>,
): boolean {
  if (isPaperPrintUpscaleSkippable(frame)) {
    return true;
  }

  if (!hasPaperAssetReference(frame.asset) || frame.asset?.kind !== 'image') {
    return false;
  }

  const widthPx = frame.asset.pixelWidth ?? sourceItem?.pixelWidth;
  const heightPx = frame.asset.pixelHeight ?? sourceItem?.pixelHeight;
  if (!isPositivePixelDimension(widthPx) || !isPositivePixelDimension(heightPx)) {
    return false;
  }

  const strictPrintDocument = document.page.dpi >= 300
    ? document
    : { ...document, page: { ...document.page, dpi: 300 } };
  return !resolvePaperPrintUpscaleTarget(strictPrintDocument, frame, {
    widthPx,
    heightPx,
  }).needsUpscale;
}

export function isPaperPrintUpscaleSkippable(
  frame: Pick<PaperFrame, 'kind' | 'comicSfxDesign'>,
): boolean {
  return frame.kind === 'image' && Boolean(frame.comicSfxDesign);
}

export function formatPaperPrintUpscaleProgress(input: PaperPrintUpscaleProgressInput): string {
  const current = Math.max(1, Math.round(input.current));
  const total = Math.max(current, Math.round(input.total));
  const provider = describePaperPrintUpscaleBusyProvider(input.provider, input.upscaleFactor);
  const target = isPositivePixelDimension(input.targetWidthPx) && isPositivePixelDimension(input.targetHeightPx)
    ? ` -> ${Math.round(input.targetWidthPx)} x ${Math.round(input.targetHeightPx)}px${isPositivePixelDimension(input.dpi) ? ` @ ${Math.round(input.dpi)} DPI` : ''}`
    : '';

  return `${current}/${total} ${input.label}: ${provider}${target}`;
}

function steppedUpscaleToPngDataUrl(
  image: HTMLImageElement | HTMLCanvasElement,
  targetWidthPx: number,
  targetHeightPx: number,
): string {
  let source: HTMLCanvasElement | HTMLImageElement = image;
  let currentWidth = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  let currentHeight = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  let ownedCanvas: HTMLCanvasElement | undefined;

  if (image instanceof HTMLCanvasElement) {
    currentWidth = image.width;
    currentHeight = image.height;
  }

  while (currentWidth !== targetWidthPx || currentHeight !== targetHeightPx) {
    const nextWidth = Math.min(targetWidthPx, Math.max(currentWidth + 1, Math.ceil(currentWidth * 1.5)));
    const nextHeight = Math.min(targetHeightPx, Math.max(currentHeight + 1, Math.ceil(currentHeight * 1.5)));
    ownedCanvas = drawScaledImage(source, nextWidth, nextHeight);
    source = ownedCanvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  return (ownedCanvas ?? drawScaledImage(source, targetWidthPx, targetHeightPx)).toDataURL('image/png');
}

function imageToPngDataUrl(image: HTMLImageElement, widthPx: number, heightPx: number): string {
  return drawScaledImage(image, widthPx, heightPx).toDataURL('image/png');
}

function drawScaledImage(source: CanvasImageSource, widthPx: number, heightPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Paper image upscale needs a 2D canvas context.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, widthPx, heightPx);
  return canvas;
}

async function fitProviderResultToTargetDataUrl(
  dataUrl: string,
  targetWidthPx: number,
  targetHeightPx: number,
): Promise<string> {
  const image = await loadImageElement(dataUrl);
  const crop = resolveCenteredCoverCropRect({
    sourceWidthPx: image.naturalWidth,
    sourceHeightPx: image.naturalHeight,
    targetWidthPx,
    targetHeightPx,
  });
  const fittedSource = crop.xPx === 0 && crop.yPx === 0
    && crop.widthPx === image.naturalWidth
    && crop.heightPx === image.naturalHeight
      ? image
      : cropCanvasToSourceRect(image, crop);

  return steppedUpscaleToPngDataUrl(fittedSource, targetWidthPx, targetHeightPx);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image for print upscaling.'));
    image.src = src;
  });
}

function cropCanvasToSourceRect(
  source: CanvasImageSource,
  crop: { xPx: number; yPx: number; widthPx: number; heightPx: number },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = crop.widthPx;
  canvas.height = crop.heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Paper image upscale needs a 2D canvas context.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, crop.xPx, crop.yPx, crop.widthPx, crop.heightPx, 0, 0, crop.widthPx, crop.heightPx);
  return canvas;
}

function cropDataUrlToCenteredAspectDataUrl(
  dataUrl: string,
  targetWidthPx: number,
  targetHeightPx: number,
): Promise<string> {
  return loadImageElement(dataUrl).then((image) => {
    const crop = resolveCenteredCoverCropRect({
      sourceWidthPx: image.naturalWidth,
      sourceHeightPx: image.naturalHeight,
      targetWidthPx,
      targetHeightPx,
    });
    if (crop.xPx === 0 && crop.yPx === 0 && crop.widthPx === image.naturalWidth && crop.heightPx === image.naturalHeight) {
      return dataUrl;
    }

    return cropCanvasToSourceRect(image, crop).toDataURL('image/png');
  });
}

function resolveCenteredCoverCropRect(input: {
  sourceWidthPx: number;
  sourceHeightPx: number;
  targetWidthPx: number;
  targetHeightPx: number;
}): { xPx: number; yPx: number; widthPx: number; heightPx: number } {
  const sourceWidthPx = Math.max(1, Math.round(input.sourceWidthPx));
  const sourceHeightPx = Math.max(1, Math.round(input.sourceHeightPx));
  const targetWidthPx = Math.max(1, Math.round(input.targetWidthPx));
  const targetHeightPx = Math.max(1, Math.round(input.targetHeightPx));
  const sourceAspect = sourceWidthPx / sourceHeightPx;
  const targetAspect = targetWidthPx / targetHeightPx;

  if (sourceWidthPx === targetWidthPx && sourceHeightPx === targetHeightPx) {
    return {
      xPx: 0,
      yPx: 0,
      widthPx: sourceWidthPx,
      heightPx: sourceHeightPx,
    };
  }

  if (Math.abs(sourceAspect - targetAspect) < Number.EPSILON) {
    return {
      xPx: 0,
      yPx: 0,
      widthPx: sourceWidthPx,
      heightPx: sourceHeightPx,
    };
  }

  if (sourceAspect > targetAspect) {
    const widthPx = Math.max(1, Math.round(sourceHeightPx * targetAspect));
    const xPx = Math.max(0, Math.floor((sourceWidthPx - widthPx) / 2));
    return {
      xPx,
      yPx: 0,
      widthPx: Math.max(1, Math.min(sourceWidthPx - xPx, widthPx)),
      heightPx: sourceHeightPx,
    };
  }

  const heightPx = Math.max(1, Math.round(sourceWidthPx / targetAspect));
  const yPx = Math.max(0, Math.floor((sourceHeightPx - heightPx) / 2));
  return {
    xPx: 0,
    yPx,
    widthPx: sourceWidthPx,
    heightPx: Math.max(1, Math.min(sourceHeightPx - yPx, heightPx)),
  };
}

function stabilityPlan(
  method: PaperPrintUpscaleMethod,
  provider: 'stability-fast' | 'stability-conservative',
  isAvailable: boolean,
): PaperPrintUpscalePlan {
  const estimatedCostUsd = estimatePaperPrintUpscaleCostUsd(provider, 1);
  const credits = provider === 'stability-fast' ? '2 credits' : '40 credits';
  const label = provider === 'stability-fast' ? 'Stability Fast' : 'Stability Conservative';
  return {
    method,
    provider,
    canRun: isAvailable,
    unavailableReason: isAvailable ? undefined : 'Stability AI API key is not configured.',
    estimatedCostUsd,
    costLabel: estimatedCostUsd === undefined ? credits : `$${estimatedCostUsd.toFixed(2)} (${credits})`,
    usesLocalFinalFit: false,
    notes: [
      `${label} stores the provider-returned binary dimensions without local interpolation or crop fitting.`,
      'Paper reports achieved placed PPI and blocks strict output when the provider result remains below the print requirement.',
    ],
  };
}

function vertexPlan(
  method: PaperPrintUpscaleMethod,
  canRun: boolean,
  vertexUpscaleFactor?: VertexImagenUpscaleFactor,
  unavailableReason?: string,
): PaperPrintUpscalePlan {
  return {
    method,
    provider: 'vertex-imagen',
    canRun,
    unavailableReason: canRun ? undefined : unavailableReason,
    estimatedCostUsd: undefined,
    costLabel: 'Google Cloud billed',
    usesLocalFinalFit: true,
    vertexUpscaleFactor,
    notes: [
      'Vertex Imagen performs the AI upscale using the smallest available factor that can satisfy the print target.',
      'Sloom Studio locally resizes the provider result to the exact document-DPI pixel target before replacing the frame asset.',
    ],
  };
}

function paperPrintUpscaleProviderTelemetryLabel(
  provider: Exclude<PaperPrintUpscaleBusyProvider, 'preparing'>,
): { provider: string; modelId: string } {
  switch (provider) {
    case 'stability-fast':
      return { provider: 'stability', modelId: 'stable-image-upscale-fast' };
    case 'stability-conservative':
      return { provider: 'stability', modelId: 'stable-image-upscale-conservative' };
    case 'vertex-imagen':
      return { provider: 'vertex', modelId: 'imagen-4.0-upscale-preview' };
    case 'android-accelerator':
      return { provider: 'android-accelerator', modelId: 'signal-loom-android-upscaler' };
    case 'android-native':
      return { provider: 'android-native', modelId: 'signal-loom-android-native-bitmap' };
    case 'local-ai-cpu':
      return { provider: 'local', modelId: 'realesrgan-ncnn-vulkan' };
    case 'browser':
      return { provider: 'local', modelId: 'browser-canvas-upscale' };
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function capDimensions(input: { widthPx: number; heightPx: number; maxEdgePx: number }): { widthPx: number; heightPx: number; capped: boolean } {
  const maxEdgePx = Math.max(1, Math.floor(input.maxEdgePx));
  const longest = Math.max(input.widthPx, input.heightPx);
  if (longest <= maxEdgePx) {
    return {
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      capped: false,
    };
  }

  const scale = maxEdgePx / longest;
  return {
    widthPx: Math.max(1, Math.floor(input.widthPx * scale)),
    heightPx: Math.max(1, Math.floor(input.heightPx * scale)),
    capped: true,
  };
}

function resolvePaperImageVisibleCropScale(input: {
  frameWidthPx: number;
  frameHeightPx: number;
  renderedWidthPx: number;
  renderedHeightPx: number;
  sourceAspect: number;
  frameAspect: number;
  fit: PaperFrame['fit'];
  scale: number;
  imageOffsetXPercent: number;
  imageOffsetYPercent: number;
}): { width: number; height: number } {
  const visible = resolvePaperImageVisibleAreaPx({
    frameWidthPx: input.frameWidthPx,
    frameHeightPx: input.frameHeightPx,
    imageWidthPx: input.renderedWidthPx,
    imageHeightPx: input.renderedHeightPx,
    imageOffsetXPercent: input.imageOffsetXPercent,
    imageOffsetYPercent: input.imageOffsetYPercent,
  });

  return {
    width: resolvePaperImageCropScale(input.renderedWidthPx, visible.widthPx),
    height: resolvePaperImageCropScale(input.renderedHeightPx, visible.heightPx),
  };
}

function resolveRenderedPaperImagePx(input: {
  frameWidthPx: number;
  frameHeightPx: number;
  frameAspect: number;
  sourceAspect: number;
  fit: PaperFrame['fit'];
  scale: number;
}): { widthPx: number; heightPx: number } {
  let widthPx = input.frameWidthPx * input.scale;
  let heightPx = input.frameHeightPx * input.scale;

  if (input.fit === 'cover') {
    if (input.sourceAspect >= input.frameAspect) {
      heightPx = input.frameHeightPx * input.scale;
      widthPx = heightPx * input.sourceAspect;
    } else {
      widthPx = input.frameWidthPx * input.scale;
      heightPx = widthPx / input.sourceAspect;
    }
  } else if (input.fit === 'contain') {
    if (input.sourceAspect >= input.frameAspect) {
      widthPx = input.frameWidthPx * input.scale;
      heightPx = widthPx / input.sourceAspect;
    } else {
      heightPx = input.frameHeightPx * input.scale;
      widthPx = heightPx * input.sourceAspect;
    }
  }

  return {
    widthPx: Math.max(0.0001, widthPx),
    heightPx: Math.max(0.0001, heightPx),
  };
}

function resolvePaperImageVisibleAreaPx(input: {
  frameWidthPx: number;
  frameHeightPx: number;
  imageWidthPx: number;
  imageHeightPx: number;
  imageOffsetXPercent: number;
  imageOffsetYPercent: number;
}): { widthPx: number; heightPx: number } {
  const left = input.frameWidthPx * (0.5 + input.imageOffsetXPercent / 100) - (input.imageWidthPx / 2);
  const top = input.frameHeightPx * (0.5 + input.imageOffsetYPercent / 100) - (input.imageHeightPx / 2);

  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleRight = Math.min(input.frameWidthPx, left + input.imageWidthPx);
  const visibleBottom = Math.min(input.frameHeightPx, top + input.imageHeightPx);

  return {
    widthPx: Math.max(0, visibleRight - visibleLeft),
    heightPx: Math.max(0, visibleBottom - visibleTop),
  };
}

function resolvePaperImageCropScale(framePx: number, visiblePx: number): number {
  if (framePx <= 0 || visiblePx <= 0) {
    return 1;
  }
  if (visiblePx >= framePx) {
    return 1;
  }
  return Math.min(100, framePx / visiblePx);
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
}

function isPositivePixelDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function positiveNumber(value: number): number {
  return Math.max(0.001, Number.isFinite(value) ? value : 1);
}

function resolveVertexUpscaleSource(
  dataUrl: string,
  image: HTMLImageElement,
  options?: { squarePadSourcePx?: number },
): { dataUrl: string; mimeType: VertexImagenOutputMimeType } {
  return resolveProviderUpscaleSource(dataUrl, image, options);
}

function resolveProviderUpscaleSource(
  dataUrl: string,
  image: HTMLImageElement,
  options?: { squarePadSourcePx?: number },
): {
  dataUrl: string;
  mimeType: VertexImagenOutputMimeType;
  squarePadSourcePx?: number;
} {
  const mimeType = readDataUrlMimeType(dataUrl);
  const sourceDataUrl = mimeType === 'image/jpeg' || mimeType === 'image/png'
    ? dataUrl
    : imageToPngDataUrl(image, image.naturalWidth, image.naturalHeight);

  const isSquarePadRequest = options?.squarePadSourcePx !== undefined && image.naturalWidth !== image.naturalHeight;
  const squarePadSourcePx = isSquarePadRequest ? options!.squarePadSourcePx : undefined;
  if (!isSquarePadRequest) {
    return {
      dataUrl: sourceDataUrl,
      mimeType: mimeType === 'image/jpeg' || mimeType === 'image/png' ? mimeType : 'image/png',
      ...(squarePadSourcePx ? { squarePadSourcePx } : {}),
    };
  }

  const squareCanvas = document.createElement('canvas');
  squareCanvas.width = options!.squarePadSourcePx!;
  squareCanvas.height = options!.squarePadSourcePx!;
  const context = squareCanvas.getContext('2d');
  if (!context) {
    throw new Error('Paper image upscale needs a 2D canvas context.');
  }
  const scale = options!.squarePadSourcePx! / Math.max(image.naturalWidth, image.naturalHeight);
  const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const x = Math.max(0, Math.floor((options!.squarePadSourcePx! - drawWidth) / 2));
  const y = Math.max(0, Math.floor((options!.squarePadSourcePx! - drawHeight) / 2));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, x, y, drawWidth, drawHeight);

  return {
    dataUrl: squareCanvas.toDataURL('image/png'),
    mimeType: 'image/png',
    squarePadSourcePx,
  };
}

function readDataUrlMimeType(dataUrl: string): string | undefined {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  return match?.[1];
}
