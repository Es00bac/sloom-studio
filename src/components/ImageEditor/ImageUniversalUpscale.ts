import {
  isAndroidAcceleratorConfigured,
  normalizeAndroidAcceleratorBaseUrl,
  runAndroidAcceleratorUpscale,
  type AndroidAcceleratorImageResult,
  type AndroidAcceleratorUpscaleInput,
} from '../../lib/androidAccelerator';
import {
  isAndroidNativeImageUpscalerAvailable,
  runAndroidNativeImageUpscale,
  type AndroidImageParityRuntimeInput,
  type AndroidNativeImageUpscaleInput,
  type AndroidNativeImageUpscaleResult,
} from '../../lib/androidNativeImageUpscaler';
import {
  isLocalCpuUpscalerConfigured,
  type LocalCpuUpscalerImageResult,
  type LocalCpuUpscalerInput,
} from '../../lib/localCpuUpscaler';
import { DEFAULT_PROVIDER_SETTINGS } from '../../lib/providerCatalog';
import {
  describeUniversalImageUpscaleReadiness,
  describeUniversalImageUpscaleWorkflow,
  type UniversalImageUpscalePrintTargetInput,
  type UniversalImageUpscaleReadinessDescriptor,
  type UniversalImageUpscaleWorkflowSourceKind,
} from '../../lib/universalImageUpscale';
import {
  runAtlasImageUpscale,
  runStabilityImageUpscale,
  runVertexImagenImageUpscale,
} from '../../lib/cloudImageUpscale';
import type { ApiKeys, ImageOutputFormat, ProviderSettings } from '../../types/flow';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { resizeImageDocumentPixels, scaleImageDocumentToPercent } from './ImageDocumentGeometry';
import { imageDocumentToDataUrl } from './ImageDocumentExport';
import { bitmapFromImageSource } from './LayerBitmap';
import { imageDocumentHasPhysicalTiltmarkSurface } from './tiltmark/ImageTiltmarkLayer';
import { imageCmykDocumentUsesNativeAuthority } from './cmyk/ImageCmykDocument';

export type UniversalImageUpscaleProvider =
  | 'android-accelerator'
  | 'android-native'
  | 'local-ai-cpu'
  | 'stability-fast'
  | 'stability-conservative'
  | 'vertex-imagen'
  | 'atlas-image-upscaler'
  | 'browser';

/** The paid cloud upscalers the Image editor can run when explicitly selected. */
export type UniversalImageUpscaleCloudProvider =
  | 'stability-fast'
  | 'stability-conservative'
  | 'vertex-imagen'
  | 'atlas-image-upscaler';

export function isUniversalImageUpscaleCloudProvider(
  provider: UniversalImageUpscaleProvider | undefined,
): provider is UniversalImageUpscaleCloudProvider {
  return provider === 'stability-fast'
    || provider === 'stability-conservative'
    || provider === 'vertex-imagen'
    || provider === 'atlas-image-upscaler';
}

export interface UniversalImageUpscaleRuntimeMetadata {
  kind: 'accelerated' | 'bitmap-fallback' | 'remote-accelerator' | 'local-ai-cpu' | 'browser-resize' | 'cloud' | 'unknown';
  accelerator?: string;
  backend?: string;
  modelUsed?: string;
  warnings: string[];
}

export interface UniversalImageUpscaleResult {
  document: ImageDocument;
  provider: UniversalImageUpscaleProvider;
  estimatedCostUsd: number;
  statusMessage: string;
  runtime?: UniversalImageUpscaleRuntimeMetadata;
}

export interface UniversalImageUpscaleInput {
  doc: ImageDocument;
  providerSettings: ProviderSettings;
  scalePercent?: number;
  /**
   * Explicitly-selected upscale provider. When set to a paid cloud provider the
   * cloud route runs (opt-in only — the on-device/local chain never spends on its
   * own). Local/Android/browser providers still resolve via the silent chain.
   */
  provider?: UniversalImageUpscaleProvider;
  /** Stability/Atlas API key holders; required for their cloud routes. */
  apiKeys?: Pick<ApiKeys, 'stability' | 'atlas'>;
  /** Output image format for cloud upscalers (defaults to png). */
  outputFormat?: ImageOutputFormat;
  /** Optional prompt used only by the Stability Conservative repair pass. */
  prompt?: string;
  androidUpscale?: (input: AndroidAcceleratorUpscaleInput) => Promise<AndroidAcceleratorImageResult>;
  androidNativeUpscale?: (input: AndroidNativeImageUpscaleInput) => Promise<AndroidNativeImageUpscaleResult>;
  isAndroidNativeUpscalerAvailable?: boolean;
  localAiCpuUpscale?: (input: LocalCpuUpscalerInput) => Promise<LocalCpuUpscalerImageResult>;
  stabilityUpscale?: typeof runStabilityImageUpscale;
  vertexImagenUpscale?: typeof runVertexImagenImageUpscale;
  atlasUpscale?: typeof runAtlasImageUpscale;
  documentToDataUrl?: (doc: ImageDocument) => Promise<string>;
  dataUrlToBitmap?: (dataUrl: string) => Promise<LayerBitmap>;
}

export interface ImageDocumentUniversalUpscaleReadinessInput {
  doc: ImageDocument;
  providerSettings: Partial<ProviderSettings>;
  apiKeys?: Pick<ApiKeys, 'stability'>;
  sourceKind?: UniversalImageUpscaleWorkflowSourceKind;
  targetWidthPx?: number;
  targetHeightPx?: number;
  scalePercent?: number;
  printTarget?: UniversalImageUpscalePrintTargetInput;
  isAndroidNativeUpscalerAvailable?: boolean;
  onDeviceRuntime?: AndroidImageParityRuntimeInput;
}

export function describeImageDocumentUniversalUpscaleReadiness(
  input: ImageDocumentUniversalUpscaleReadinessInput,
): UniversalImageUpscaleReadinessDescriptor {
  return describeUniversalImageUpscaleReadiness({
    providerSettings: {
      ...DEFAULT_PROVIDER_SETTINGS,
      ...input.providerSettings,
    },
    apiKeys: input.apiKeys,
    sourceKind: input.sourceKind,
    sourceWidthPx: input.doc.width,
    sourceHeightPx: input.doc.height,
    targetWidthPx: input.targetWidthPx,
    targetHeightPx: input.targetHeightPx,
    scalePercent: input.scalePercent,
    printTarget: input.printTarget,
    androidNativeAvailable: input.isAndroidNativeUpscalerAvailable,
    onDeviceRuntime: input.onDeviceRuntime,
  });
}

export async function upscaleImageDocumentUniversal(input: UniversalImageUpscaleInput): Promise<UniversalImageUpscaleResult> {
  if (imageCmykDocumentUsesNativeAuthority(input.doc)) {
    throw new Error('Upscale 2x is refused for native CMYK until CMYKA-native resampling is implemented; no RGB proxy was generated.');
  }
  if (imageDocumentHasPhysicalTiltmarkSurface(input.doc)) {
    throw new Error(
      'Convert editable Tiltmark surfaces to Raster before upscaling; a physical substrate field cannot be resampled without losing its retained simulation.',
    );
  }
  const scalePercent = input.scalePercent ?? 200;
  const target = scaleImageDocumentToPercent(input.doc, scalePercent);

  if (isUniversalImageUpscaleCloudProvider(input.provider)) {
    return upscaleImageDocumentWithCloudProvider(input, input.provider, target);
  }

  if (isAndroidAcceleratorConfigured(input.providerSettings)) {
    const documentToDataUrl = input.documentToDataUrl ?? imageDocumentToDataUrl;
    const dataUrlToBitmap = input.dataUrlToBitmap ?? bitmapFromDataUrl;
    const sourceDataUrl = await documentToDataUrl(input.doc);
    const androidResult = await (input.androidUpscale ?? runAndroidAcceleratorUpscale)({
      baseUrl: normalizeAndroidAcceleratorBaseUrl(input.providerSettings.androidAcceleratorBaseUrl),
      authToken: input.providerSettings.androidAcceleratorAuthToken,
      sourceDataUrl,
      targetWidthPx: target.width,
      targetHeightPx: target.height,
      upscalerId: input.providerSettings.androidAcceleratorDefaultUpscaler ?? 'upscaler_realistic',
      outputFormat: 'png',
    });
    const bitmap = await dataUrlToBitmap(androidResult.dataUrl);
    const runtime = buildUniversalUpscaleRuntimeMetadata('android-accelerator', androidResult);
    return {
      document: replaceDocumentWithSingleUpscaledLayer(input.doc, bitmap, target.width, target.height, {
        idSuffix: 'phone-upscale',
        metadataSourceFormat: 'android-accelerator-upscale',
        statusLabel: 'Phone AI',
        sourceWarnings: buildUpscaleLayerWarnings(input.doc, runtime, 'Android accelerator'),
      }),
      provider: 'android-accelerator',
      estimatedCostUsd: 0,
      statusMessage: `Upscaled "${input.doc.title}" to ${target.width} x ${target.height}px with Android accelerator.`,
      ...(runtime ? { runtime } : {}),
    };
  }

  if (input.isAndroidNativeUpscalerAvailable ?? isAndroidNativeImageUpscalerAvailable()) {
    const documentToDataUrl = input.documentToDataUrl ?? imageDocumentToDataUrl;
    const dataUrlToBitmap = input.dataUrlToBitmap ?? bitmapFromDataUrl;
    const sourceDataUrl = await documentToDataUrl(input.doc);
    const androidResult = await (input.androidNativeUpscale ?? runAndroidNativeImageUpscale)({
      sourceDataUrl,
      targetWidthPx: target.width,
      targetHeightPx: target.height,
      outputFormat: 'png',
    });
    const bitmap = await dataUrlToBitmap(androidResult.dataUrl);
    const runtime = buildUniversalUpscaleRuntimeMetadata('android-native', androidResult);

    return {
      document: replaceDocumentWithSingleUpscaledLayer(input.doc, bitmap, target.width, target.height, {
        idSuffix: 'android-native-upscale',
        metadataSourceFormat: 'android-native-upscale',
        statusLabel: 'Android native',
        sourceWarnings: buildUpscaleLayerWarnings(input.doc, runtime, 'Android native'),
      }),
      provider: 'android-native',
      estimatedCostUsd: 0,
      statusMessage: buildAndroidNativeStatusMessage(input.doc.title, target.width, target.height, runtime),
      ...(runtime ? { runtime } : {}),
    };
  }

  if (isLocalCpuUpscalerConfigured(input.providerSettings)) {
    if (!input.localAiCpuUpscale) {
      throw new Error('Local Vulkan AI upscaler is not available.');
    }

    const documentToDataUrl = input.documentToDataUrl ?? imageDocumentToDataUrl;
    const dataUrlToBitmap = input.dataUrlToBitmap ?? bitmapFromDataUrl;
    const sourceDataUrl = await documentToDataUrl(input.doc);
    const localResult = await input.localAiCpuUpscale({
      baseUrl: input.providerSettings.localAiCpuEndpointUrl ?? '',
      authHeader: input.providerSettings.localAiCpuAuthHeader,
      sourceDataUrl,
      targetWidthPx: target.width,
      targetHeightPx: target.height,
      model: input.providerSettings.localAiCpuModel ?? 'realesrgan-4x',
      outputFormat: 'png',
    });
    const bitmap = await dataUrlToBitmap(localResult.dataUrl);

    return {
      document: replaceDocumentWithSingleUpscaledLayer(input.doc, bitmap, target.width, target.height, {
        idSuffix: 'vulkan-upscale',
        metadataSourceFormat: 'Real-ESRGAN Vulkan',
        statusLabel: 'Local Vulkan AI',
      }),
      provider: 'local-ai-cpu',
      estimatedCostUsd: 0,
      statusMessage: `Upscaled "${input.doc.title}" to ${target.width} x ${target.height}px with the local Vulkan AI upscaler.`,
    };
  }

  const document = resizeImageDocumentPixels(input.doc, target.width, target.height);

  return {
    document,
    provider: 'browser',
    estimatedCostUsd: 0,
    statusMessage: `Resized "${input.doc.title}" to ${target.width} x ${target.height}px locally.`,
  };
}

async function upscaleImageDocumentWithCloudProvider(
  input: UniversalImageUpscaleInput,
  provider: UniversalImageUpscaleCloudProvider,
  target: { width: number; height: number },
): Promise<UniversalImageUpscaleResult> {
  const documentToDataUrl = input.documentToDataUrl ?? imageDocumentToDataUrl;
  const dataUrlToBitmap = input.dataUrlToBitmap ?? bitmapFromDataUrl;
  const outputFormat = input.outputFormat ?? 'png';
  const workflow = describeUniversalImageUpscaleWorkflow(provider);
  const sourceDataUrl = await documentToDataUrl(input.doc);

  const cloud = provider === 'vertex-imagen'
    ? await (input.vertexImagenUpscale ?? runVertexImagenImageUpscale)({
        sourceImage: sourceDataUrl,
        providerSettings: input.providerSettings,
        outputFormat,
      })
    : provider === 'atlas-image-upscaler'
      ? await (input.atlasUpscale ?? runAtlasImageUpscale)({
          sourceImage: sourceDataUrl,
          apiKey: (input.apiKeys?.atlas ?? '').trim(),
          baseUrl: input.providerSettings.atlasBaseUrl,
          // The documented `outscale` multiplier (1–4) derived from the requested scale (200% → 2).
          outscale: Math.min(4, Math.max(1, (input.scalePercent ?? 200) / 100)),
          outputFormat,
        })
      : await (input.stabilityUpscale ?? runStabilityImageUpscale)({
          sourceImage: sourceDataUrl,
          mode: provider === 'stability-conservative' ? 'conservative' : 'fast',
          outputFormat,
          apiKey: (input.apiKeys?.stability ?? '').trim(),
          prompt: input.prompt,
        });

  const bitmap = await dataUrlToBitmap(cloud.result);
  const width = readBitmapDimension(bitmap, 'width', target.width);
  const height = readBitmapDimension(bitmap, 'height', target.height);
  const warnings: string[] = [];
  if (input.doc.layers.length > 1) {
    warnings.push('The AI upscaler operates on the flattened visible image; undo restores the original layers.');
  }
  warnings.push(`${workflow.methodLabel} is a paid cloud upscaler; provider cost ${workflow.costLabel}.`);

  return {
    document: replaceDocumentWithSingleUpscaledLayer(input.doc, bitmap, width, height, {
      idSuffix: 'cloud-upscale',
      metadataSourceFormat: `${provider}-upscale`,
      statusLabel: workflow.methodLabel,
      sourceWarnings: warnings,
    }),
    provider,
    estimatedCostUsd: workflow.costUsd ?? 0,
    statusMessage: `Upscaled "${input.doc.title}" to ${width} x ${height}px with ${workflow.methodLabel} (${workflow.costLabel}).`,
    runtime: {
      kind: 'cloud',
      modelUsed: workflow.methodLabel,
      warnings,
    },
  };
}

function readBitmapDimension(bitmap: LayerBitmap, key: 'width' | 'height', fallback: number): number {
  const value = (bitmap as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export function describeUniversalImageUpscaleProvider(provider: UniversalImageUpscaleProvider): string {
  if (provider === 'android-accelerator') {
    return 'Android accelerator: NPU/GPU upscaler';
  }
  if (provider === 'android-native') {
    return 'Android native image upscaler';
  }
  if (provider === 'local-ai-cpu') {
    return 'Local Vulkan AI upscaler';
  }
  if (isUniversalImageUpscaleCloudProvider(provider)) {
    return describeUniversalImageUpscaleWorkflow(provider).methodLabel;
  }
  return 'Local image resize';
}

function replaceDocumentWithSingleUpscaledLayer(
  doc: ImageDocument,
  bitmap: LayerBitmap,
  width: number,
  height: number,
  options?: {
    idSuffix?: string;
    metadataSourceFormat?: string;
    statusLabel?: string;
    sourceWarnings?: string[];
  },
): ImageDocument {
  const statusLabel = options?.statusLabel ?? 'AI';
  const layerId = `${options?.idSuffix ?? 'local-upscale'}-${doc.id}`;
  const metadataSourceFormat = options?.metadataSourceFormat ?? 'upscaled';
  const layer: ImageLayer = {
    id: layerId,
    name: `${statusLabel} upscale`,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 1,
    mask: null,
    metadata: {
      sourceFormat: metadataSourceFormat,
      sourceWarnings: options?.sourceWarnings,
    },
  };

  return {
    ...doc,
    width,
    height,
    layers: [layer],
    activeLayerId: layerId,
    hasSelection: false,
    selectionVersion: doc.selectionVersion + (doc.hasSelection ? 1 : 0),
    dirty: true,
  };
}

async function bitmapFromDataUrl(dataUrl: string): Promise<LayerBitmap> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Failed to load upscaled image: ${response.status} ${response.statusText}`);
  }
  const imageBitmap = await createImageBitmap(await response.blob());
  try {
    return await bitmapFromImageSource(imageBitmap);
  } finally {
    imageBitmap.close();
  }
}

function buildUniversalUpscaleRuntimeMetadata(
  provider: UniversalImageUpscaleProvider,
  result: {
    accelerator?: string;
    backend?: string;
    modelUsed?: string;
    warnings?: string[];
  },
): UniversalImageUpscaleRuntimeMetadata | undefined {
  const accelerator = result.accelerator?.trim();
  const backend = result.backend?.trim();
  const modelUsed = result.modelUsed?.trim();
  const warnings = result.warnings?.filter((warning) => warning.trim().length > 0) ?? [];
  if (!accelerator && !backend && !modelUsed && warnings.length === 0) {
    return undefined;
  }

  const combined = `${accelerator ?? ''} ${backend ?? ''}`.toLowerCase();
  const kind = provider === 'android-accelerator'
    ? 'remote-accelerator'
    : combined.includes('bitmap')
      ? 'bitmap-fallback'
      : combined.includes('qnn') || combined.includes('nnapi') || combined.includes('local-dream')
        ? 'accelerated'
        : 'unknown';

  return {
    kind,
    ...(accelerator ? { accelerator } : {}),
    ...(backend ? { backend } : {}),
    ...(modelUsed ? { modelUsed } : {}),
    warnings,
  };
}

function buildUpscaleLayerWarnings(
  doc: ImageDocument,
  runtime: UniversalImageUpscaleRuntimeMetadata | undefined,
  runtimeLabel: 'Android accelerator' | 'Android native',
): string[] | undefined {
  const warnings: string[] = [];
  if (doc.layers.length > 1) {
    warnings.push('The AI upscaler operates on the flattened visible image; undo restores the original layers.');
  }
  if (runtime) {
    const runtimeSummary = runtimeLabel === 'Android native'
      ? buildAndroidNativeRuntimeWarning(runtime)
      : buildAndroidAcceleratorRuntimeWarning(runtime);
    if (runtimeSummary) {
      warnings.push(runtimeSummary);
    }
    if (runtime.modelUsed) {
      warnings.push(`${runtimeLabel} model: ${runtime.modelUsed}.`);
    }
    warnings.push(...runtime.warnings);
  }
  return warnings.length > 0 ? warnings : undefined;
}

function buildAndroidNativeStatusMessage(
  title: string,
  width: number,
  height: number,
  runtime?: UniversalImageUpscaleRuntimeMetadata,
): string {
  const suffix = runtime?.kind === 'accelerated' && runtime.backend
    ? ` via ${describeRuntimeAcceleratorLabel(runtime)} (${runtime.backend}).`
    : '.';
  return `Upscaled "${title}" to ${width} x ${height}px with Android native image upscaler${suffix}`;
}

function buildAndroidNativeRuntimeWarning(runtime: UniversalImageUpscaleRuntimeMetadata): string | undefined {
  if (runtime.kind === 'accelerated') {
    return `Android native runtime: ${describeRuntimeAcceleratorLabel(runtime)} via ${runtime.backend ?? 'native backend'}.`;
  }
  if (runtime.kind === 'bitmap-fallback') {
    return `Android native runtime: bitmap fallback via ${runtime.backend ?? 'android-bitmap'}.`;
  }
  if (runtime.accelerator || runtime.backend) {
    return `Android native runtime: ${runtime.accelerator ?? runtime.backend ?? 'unknown runtime'}.`;
  }
  return undefined;
}

function buildAndroidAcceleratorRuntimeWarning(runtime: UniversalImageUpscaleRuntimeMetadata): string | undefined {
  if (runtime.accelerator && runtime.backend) {
    return `Android accelerator runtime: ${runtime.accelerator} via ${runtime.backend}.`;
  }
  if (runtime.accelerator) {
    return `Android accelerator runtime: ${runtime.accelerator}.`;
  }
  if (runtime.backend) {
    return `Android accelerator runtime: ${runtime.backend}.`;
  }
  return undefined;
}

function describeRuntimeAcceleratorLabel(runtime: UniversalImageUpscaleRuntimeMetadata): string {
  const combined = `${runtime.accelerator ?? ''} ${runtime.backend ?? ''}`.toLowerCase();
  if (combined.includes('qnn')) return 'QNN';
  if (combined.includes('nnapi')) return 'NNAPI';
  if (combined.includes('bitmap')) return 'bitmap fallback';
  return runtime.accelerator ?? runtime.backend ?? 'unknown runtime';
}
