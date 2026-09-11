import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import type { ApiKeys, ImageProvider, ProviderSettings } from '../../types/flow';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import { bitmapFromImageSource, createBitmap } from './LayerBitmap';
import { maskToCanvas, type SelectionMask } from './SelectionMask';
import {
  cropSelectionToBounds,
  normalizeGenerativeFillPlacementBounds,
  type GenerativeFillPlacementBounds,
} from './GenerativeFillGeometry';

const GENERATED_FILL_SOURCE_WARNING =
  'Generated fill is not linked to a durable Source Library item until saved or sent to another workspace.';

export type GenerativeFillHandoffTarget = 'flow' | 'video' | 'paper';
export type GenerativeEditOperation = 'selected-region-edit' | 'outpaint' | 'reference-edit' | 'upscale';
export type GenerativeEditReferenceKind = 'image-url' | 'source-library-item' | 'description';
export type GenerativeEditUpscaleRoute = 'android-accelerator' | 'android-native' | 'local-ai-cpu' | 'cloud' | 'browser';
export type GenerativeEditReadinessBlockerCode =
  | 'missing-selection'
  | 'empty-selection'
  | 'missing-prompt'
  | 'missing-reference-input'
  | 'unsupported-provider'
  | 'unsupported-operation'
  | 'missing-provider-credential'
  | 'missing-local-route'
  | 'source-print-resolution-excluded'
  | 'comic-sfx-print-resolution-excluded';
export type GenerativeEditUnsupportedPhotoshopState =
  | 'photoshop-generative-fill-native-layer'
  | 'photoshop-firefly-variation-stack'
  | 'photoshop-contextual-taskbar-history'
  | 'photoshop-cloud-credit-meter'
  | 'photoshop-prompt-safety-review';
export type GenerativeEditExecutionMode =
  | 'cloud-provider'
  | 'local-endpoint'
  | 'android-runtime'
  | 'browser-fallback'
  | 'unsupported';
export type GenerativeEditRuntimeWarningCode =
  | 'not-photoshop-native-ai'
  | 'external-cloud-provider'
  | 'local-runtime-not-configured'
  | 'browser-fallback-not-ai';

export interface GenerativeEditReferenceInput {
  id: string;
  kind: GenerativeEditReferenceKind;
  label?: string;
  value?: string | null;
}

export interface GenerativeEditReferenceSlotDescriptor {
  slotIndex: number;
  id: string;
  kind: GenerativeEditReferenceKind;
  label: string;
  dispatchRole: 'image-reference' | 'text-reference';
  ready: boolean;
  valueState: 'provided' | 'missing';
  valueKind: 'url' | 'source-library-item' | 'description';
  summary: string;
  blockerCode: Extract<GenerativeEditReadinessBlockerCode, 'missing-reference-input'> | null;
}

export interface GenerativeEditReadinessInput {
  doc: ImageDocument;
  operation: GenerativeEditOperation;
  provider: ImageProvider | 'none';
  modelId?: string | null;
  prompt?: string | null;
  selection?: SelectionMask | null;
  referenceInputs?: GenerativeEditReferenceInput[];
  apiKeys?: Partial<ApiKeys>;
  providerSettings?: Partial<ProviderSettings>;
  requestedUpscaleRoute?: GenerativeEditUpscaleRoute;
  isAndroidNativeUpscalerAvailable?: boolean;
  alreadyPrintResolution?: boolean;
  targetDpi?: number;
  sourceKind?: 'document' | 'selected-layer' | 'comic-sfx-layer';
}

export interface GenerativeEditSelectionReadiness {
  required: boolean;
  present: boolean;
  empty: boolean;
  width: number;
  height: number;
  selectedPixels: number;
  coverage: number;
  bounds: GenerativeFillPlacementBounds | null;
  ready: boolean;
}

export interface GenerativeEditReferenceReadiness {
  required: boolean;
  providedCount: number;
  readyCount: number;
  ready: boolean;
  inputs: Array<{
    id: string;
    kind: GenerativeEditReferenceKind;
    label: string;
    ready: boolean;
    reason: string;
  }>;
}

export interface GenerativeEditProviderCapabilityDescriptor {
  provider: ImageProvider | 'none';
  modelId: string;
  displayName: string;
  routeKind: 'cloud' | 'local' | 'android' | 'browser' | 'unsupported';
  supportsSelectedRegion: boolean;
  supportsReferenceInputs: boolean;
  supportsOutpaint: boolean;
  supportsUpscale: boolean;
  credentialRequirement: 'api-key' | 'endpoint' | 'android-route' | 'none' | 'unsupported';
  cost: {
    estimatedUsd: number | null;
    label: string;
    unit: 'per-edit' | 'per-megapixel' | 'local';
  };
  capabilityNotes: string[];
}

export interface GenerativeEditUpscaleRouteStatus {
  route: GenerativeEditUpscaleRoute;
  available: boolean;
  label: string;
  costLabel: string;
  blockers: GenerativeEditReadinessBlockerCode[];
  caveats: string[];
}

export interface GenerativeEditReadinessBlocker {
  code: GenerativeEditReadinessBlockerCode;
  message: string;
}

export interface GenerativeEditReadinessDescriptor {
  descriptorId: 'generative-edit-readiness:v1';
  documentId: string;
  operation: GenerativeEditOperation;
  provider: GenerativeEditProviderCapabilityDescriptor;
  selectedRegion: GenerativeEditSelectionReadiness;
  references: GenerativeEditReferenceReadiness;
  referenceSlots: GenerativeEditReferenceSlotDescriptor[];
  referenceSlotSignature: string;
  upscaleRoutes: GenerativeEditUpscaleRouteStatus[];
  requestedUpscaleRoute: GenerativeEditUpscaleRoute | null;
  blockers: GenerativeEditReadinessBlocker[];
  ready: boolean;
  missingCredentialBlockers: GenerativeEditReadinessBlocker[];
  fallbackStates: GenerativeEditFallbackState[];
  runtimeSummary: GenerativeEditRuntimeSummary;
  unsupportedPhotoshopParityStates: Array<{
    state: GenerativeEditUnsupportedPhotoshopState;
    supported: false;
    caveat: string;
  }>;
  caveats: string[];
  preview: {
    id: string;
    label: string;
    operationLabel: string;
    documentSizeLabel: string;
    selectedRegionLabel: string;
  };
  previewSignature: string;
}

export interface GenerativeEditFallbackState {
  lane: 'selected-provider' | 'local-fallback' | 'cloud-fallback' | 'browser-fallback';
  routeKind: 'cloud' | 'local' | 'android' | 'browser' | 'unsupported';
  available: boolean;
  active: boolean;
  summary: string;
}

export interface GenerativeEditRuntimeSummary {
  executionMode: GenerativeEditExecutionMode;
  dispatchStatus: 'ready-for-provider-dispatch' | 'blocked';
  photoshopNativeAi: {
    supported: false;
    reason: string;
  };
  signalLoomExecution: {
    usesCloudProvider: boolean;
    executesLocally: boolean;
    requiresStoredCredential: boolean;
    requiresConfiguredRuntime: boolean;
    browserOnlyFallback: boolean;
  };
  blockerSummary: {
    requiredInputCodes: GenerativeEditReadinessBlockerCode[];
    providerCapabilityCodes: GenerativeEditReadinessBlockerCode[];
    credentialCodes: GenerativeEditReadinessBlockerCode[];
    runtimeCodes: GenerativeEditReadinessBlockerCode[];
    allCodes: GenerativeEditReadinessBlockerCode[];
  };
  warnings: Array<{
    code: GenerativeEditRuntimeWarningCode;
    severity: 'warning';
    message: string;
  }>;
}

export interface GenerativeFillLayerHandoffWarning {
  code: 'missing-durable-source-id' | 'blob-only-source-url';
  message: string;
}

export interface GenerativeFillLayerHandoffTargetDescriptor {
  target: GenerativeFillHandoffTarget;
  ready: boolean;
  reason: string;
}

export interface GenerativeFillLayerSourceSnapshotAvailability {
  available: boolean;
  sourceId: string | null;
}

export interface GenerativeFillLayerExternalAssetPackaging {
  required: boolean;
  caveats: string[];
}

export interface GenerativeFillLayerSuiteHandoffBlocker {
  code: GenerativeFillLayerHandoffWarning['code'];
  target: 'suite';
  message: string;
}

export interface GenerativeFillLayerHandoffDescriptor {
  descriptorId: 'generative-fill-layer-handoff:v1';
  documentId: string;
  layerId: string;
  layerName: string;
  sourceKind: 'generated-layer';
  source: {
    assetUrlKind: 'none' | 'blob-url' | 'embedded-data-url' | 'durable-url';
    blobOnly: boolean;
    durableAsset: boolean;
    durableSourceId: string | null;
    label: string | null;
    sourceFormat: string;
  };
  bounds: GenerativeFillPlacementBounds;
  sendTo: Record<GenerativeFillHandoffTarget, GenerativeFillLayerHandoffTargetDescriptor>;
  warnings: GenerativeFillLayerHandoffWarning[];
  preview: {
    id: string;
    label: string;
    sizeLabel: string;
    sourceLabel: string | null;
  };
  sourceSnapshotAvailability: GenerativeFillLayerSourceSnapshotAvailability;
  externalAssetPackaging: GenerativeFillLayerExternalAssetPackaging;
  suiteHandoffBlockers: GenerativeFillLayerSuiteHandoffBlocker[];
  handoffSignatures: {
    preview: string;
    export: string;
    sourceBin: string;
  };
  previewSignature: string;
}

export function createGenerativeFillLayerFromBitmap({
  doc,
  edgeFeatherPx = 3,
  id = `layer-fill-${Date.now()}`,
  placementBounds,
  prompt,
  resultBitmap,
  selection,
}: {
  doc: ImageDocument;
  edgeFeatherPx?: number;
  id?: string;
  placementBounds?: GenerativeFillPlacementBounds;
  prompt: string;
  resultBitmap: LayerBitmap;
  selection: SelectionMask;
}): ImageLayer {
  const bounds = placementBounds ? normalizeGenerativeFillPlacementBounds(placementBounds, doc) : undefined;
  const normalized = bounds
    ? createBitmap(bounds.width, bounds.height)
    : createBitmap(doc.width, doc.height);
  const ctx = normalized.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for generative fill layer');
  ctx.drawImage(resultBitmap, 0, 0, normalized.width, normalized.height);
  const localSelection = bounds ? cropSelectionToBounds(selection, bounds) : selection;
  const layerMask = edgeFeatherPx > 0
    ? featherSelectionMask(localSelection, edgeFeatherPx)
    : localSelection;

  return {
    id,
    name: `Generative Fill: "${prompt.slice(0, 30)}"`,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: bounds?.x ?? 0,
    y: bounds?.y ?? 0,
    bitmap: normalized,
    bitmapVersion: 0,
    mask: maskToCanvas(layerMask),
    metadata: {
      sourceFormat: 'generative-fill',
      sourceWarnings: [GENERATED_FILL_SOURCE_WARNING],
    },
  };
}

export function describeGeneratedImageLayerHandoff({
  doc,
  layer,
  sourceItem,
}: {
  doc: ImageDocument;
  layer: ImageLayer;
  sourceItem?: Pick<
    SourceBinLibraryItem,
    'id' | 'label' | 'assetUrl' | 'assetId' | 'scratchFileName' | 'nativeFilePath'
  >;
}): GenerativeFillLayerHandoffDescriptor {
  const sourceId = layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? null;
  const sourceLabel = layer.metadata?.sourceLink?.label ?? layer.metadata?.sourceLabel ?? null;
  const assetUrlKind = classifyGeneratedHandoffAssetUrl(sourceItem?.assetUrl);
  const blobOnly = assetUrlKind === 'blob-url' && !isDurableGeneratedSourceItem(sourceItem);
  const durableAsset = Boolean(sourceId) && !blobOnly;
  const warnings = describeGeneratedLayerHandoffWarnings(layer, sourceId, blobOnly);
  const bounds = {
    x: layer.x,
    y: layer.y,
    width: layer.bitmap?.width ?? doc.width,
    height: layer.bitmap?.height ?? doc.height,
  };
  const sendTo = {
    flow: describeGeneratedLayerTargetReadiness('flow', sourceId, durableAsset),
    video: describeGeneratedLayerTargetReadiness('video', sourceId, durableAsset),
    paper: describeGeneratedLayerTargetReadiness('paper', sourceId, durableAsset),
  };
  const previewSignature = `generative-fill-layer-handoff:v1:${JSON.stringify({
    documentId: doc.id,
    layerId: layer.id,
    sourceId,
    assetUrlKind,
    durableAsset,
    bounds,
    warnings: warnings.map((warning) => warning.code),
  })}`;

  return {
    descriptorId: 'generative-fill-layer-handoff:v1',
    documentId: doc.id,
    layerId: layer.id,
    layerName: layer.name,
    sourceKind: 'generated-layer',
    source: {
      assetUrlKind,
      blobOnly,
      durableAsset,
      durableSourceId: sourceId,
      label: sourceLabel,
      sourceFormat: layer.metadata?.sourceFormat ?? 'generative-fill',
    },
    bounds,
    sendTo,
    warnings,
    preview: {
      id: `generative-fill-preview:${doc.id}:${layer.id}:${sourceId ?? 'none'}`,
      label: layer.name || 'Generated layer',
      sizeLabel: `${bounds.width}x${bounds.height}`,
      sourceLabel,
    },
    sourceSnapshotAvailability: {
      available: false,
      sourceId,
    },
    externalAssetPackaging: describeGeneratedLayerExternalAssetPackaging(layer, sourceId, blobOnly),
    suiteHandoffBlockers: describeGeneratedLayerSuiteHandoffBlockers(layer, sourceId, warnings),
    handoffSignatures: buildGeneratedLayerHandoffSignatures({
      documentId: doc.id,
      layerId: layer.id,
      sourceId,
      assetUrlKind,
      durableAsset,
      warningCodes: warnings.map((warning) => warning.code),
      previewSignature,
    }),
    previewSignature,
  };
}

export function describeGenerativeEditReadiness(input: GenerativeEditReadinessInput): GenerativeEditReadinessDescriptor {
  const provider = describeGenerativeEditProviderCapabilities(input.provider, input.modelId);
  const selectedRegion = summarizeGenerativeEditSelection(input.operation, input.selection);
  const references = summarizeGenerativeEditReferences(input.operation, input.referenceInputs ?? []);
  const referenceSlots = describeGenerativeEditReferenceSlots(input.referenceInputs ?? []);
  const referenceSlotSignature = buildGenerativeEditReferenceSlotSignature(input.doc.id, input.operation, referenceSlots);
  const upscaleRoutes = describeGenerativeEditUpscaleRoutes(input);
  const requestedUpscaleRoute = input.requestedUpscaleRoute ?? (input.operation === 'upscale' ? 'browser' : null);
  const blockers = buildGenerativeEditReadinessBlockers(input, provider, selectedRegion, references, upscaleRoutes, requestedUpscaleRoute);
  const missingCredentialBlockers = blockers.filter((blocker) => (
    blocker.code === 'missing-provider-credential'
    || blocker.code === 'missing-local-route'
  ));
  const fallbackStates = describeGenerativeEditFallbackStates(input, provider, upscaleRoutes);
  const runtimeSummary = describeGenerativeEditRuntimeSummary(provider, blockers);
  const unsupportedPhotoshopParityStates = describeUnsupportedPhotoshopGenerativeFillStates();
  const caveats = buildGenerativeEditReadinessCaveats(input, provider, unsupportedPhotoshopParityStates);
  const selectedRegionLabel = selectedRegion.bounds
    ? `${selectedRegion.bounds.width}x${selectedRegion.bounds.height} (${formatCoverage(selectedRegion.coverage)})`
    : selectedRegion.required ? 'No selected region' : 'Selection optional';
  const providerLabel = provider.provider === 'none'
    ? 'No provider selected'
    : `${provider.displayName} / ${provider.modelId}`;
  const previewPayload = {
    documentId: input.doc.id,
    operation: input.operation,
    provider: provider.provider,
    modelId: provider.modelId,
    selectedPixels: selectedRegion.selectedPixels,
    selectionBounds: selectedRegion.bounds,
    references: references.inputs.map((reference) => `${reference.id}:${reference.kind}:${reference.ready ? 'ready' : 'blocked'}`),
    requestedUpscaleRoute,
    blockers: blockers.map((blocker) => blocker.code),
    alreadyPrintResolution: Boolean(input.alreadyPrintResolution),
    sourceKind: input.sourceKind ?? 'document',
  };

  return {
    descriptorId: 'generative-edit-readiness:v1',
    documentId: input.doc.id,
    operation: input.operation,
    provider,
    selectedRegion,
    references,
    referenceSlots,
    referenceSlotSignature,
    upscaleRoutes,
    requestedUpscaleRoute,
    blockers,
    ready: blockers.length === 0,
    missingCredentialBlockers,
    fallbackStates,
    runtimeSummary,
    unsupportedPhotoshopParityStates,
    caveats,
    preview: {
      id: `generative-edit-preview:${input.doc.id}:${input.operation}:${provider.provider}:${provider.modelId}`,
      label: `${providerLabel} ${input.operation}`,
      operationLabel: describeGenerativeEditOperation(input.operation),
      documentSizeLabel: `${input.doc.width}x${input.doc.height}`,
      selectedRegionLabel,
    },
    previewSignature: `generative-edit-readiness:v1:${JSON.stringify(previewPayload)}`,
  };
}

export async function createGenerativeFillLayerFromBlob({
  doc,
  edgeFeatherPx,
  id,
  placementBounds,
  png,
  prompt,
  selection,
}: {
  doc: ImageDocument;
  edgeFeatherPx?: number;
  id?: string;
  placementBounds?: GenerativeFillPlacementBounds;
  png: Blob;
  prompt: string;
  selection: SelectionMask;
}): Promise<ImageLayer> {
  const blobBitmap = await createImageBitmap(png);
  try {
    const resultBitmap = await bitmapFromImageSource(blobBitmap);
    return createGenerativeFillLayerFromBitmap({
      doc,
      edgeFeatherPx,
      id,
      placementBounds,
      prompt,
      resultBitmap,
      selection,
    });
  } finally {
    blobBitmap.close();
  }
}

function featherSelectionMask(selection: SelectionMask, radiusPx: number): SelectionMask {
  const radius = Math.max(0, Math.round(radiusPx));
  if (radius <= 0) {
    return {
      width: selection.width,
      height: selection.height,
      data: new Uint8ClampedArray(selection.data),
    };
  }

  let current: SelectionMask = {
    width: selection.width,
    height: selection.height,
    data: new Uint8ClampedArray(selection.data),
  };

  for (let pass = 0; pass < radius; pass += 1) {
    current = boxBlurSelectionMask(current);
  }

  return current;
}

function describeGeneratedLayerTargetReadiness(
  target: GenerativeFillHandoffTarget,
  sourceId: string | null,
  durableAsset: boolean,
): GenerativeFillLayerHandoffTargetDescriptor {
  if (sourceId && durableAsset) {
    return {
      target,
      ready: true,
      reason: target === 'paper'
        ? `Ready to place Source Library item "${sourceId}" in Paper.`
        : `Ready to send Source Library item "${sourceId}" to ${target === 'flow' ? 'Flow' : 'Video'}.`,
    };
  }

  if (sourceId) {
    return {
      target,
      ready: false,
      reason: target === 'paper'
        ? `Persist generated Source Library item "${sourceId}" before placing it in Paper.`
        : `Persist generated Source Library item "${sourceId}" before sending it to ${target === 'flow' ? 'Flow' : 'Video'}.`,
    };
  }

  return {
    target,
    ready: false,
    reason: target === 'paper'
      ? 'Save the generated layer to the Source Library before placing it in Paper.'
      : `Save the generated layer to the Source Library before sending it to ${target === 'flow' ? 'Flow' : 'Video'}.`,
  };
}

function describeGeneratedLayerHandoffWarnings(
  layer: ImageLayer,
  sourceId: string | null,
  blobOnly: boolean,
): GenerativeFillLayerHandoffWarning[] {
  if (blobOnly && sourceId) {
    return [{
      code: 'blob-only-source-url',
      message: `Generated Source Library item "${sourceId}" only has a blob URL and may not survive project save/open or native handoff.`,
    }];
  }
  if (!sourceId) {
    return [{
      code: 'missing-durable-source-id',
      message: `Generated layer "${layer.id}" is not linked to a durable Source Library item.`,
    }];
  }
  return [];
}

function describeGeneratedLayerExternalAssetPackaging(
  layer: ImageLayer,
  sourceId: string | null,
  blobOnly: boolean,
): GenerativeFillLayerExternalAssetPackaging {
  if (sourceId && blobOnly) {
    return {
      required: true,
      caveats: [
        `Generated Source Library item "${sourceId}" is blob-only; package it into project scratch or native media before suite handoff.`,
      ],
    };
  }
  if (!sourceId) {
    return {
      required: true,
      caveats: [
        `Save generated layer "${layer.id}" into the Source Library before packaging it for Flow, Video, or Paper.`,
      ],
    };
  }
  return {
    required: false,
    caveats: [],
  };
}

function describeGeneratedLayerSuiteHandoffBlockers(
  layer: ImageLayer,
  sourceId: string | null,
  warnings: GenerativeFillLayerHandoffWarning[],
): GenerativeFillLayerSuiteHandoffBlocker[] {
  return warnings.map((warning) => ({
    code: warning.code,
    target: 'suite',
    message: warning.code === 'blob-only-source-url' && sourceId
      ? `Persist generated Source Library item "${sourceId}" before Flow, Video, or Paper handoff.`
      : `Generated layer "${layer.id}" needs a durable Source Library item before Flow, Video, or Paper handoff.`,
  }));
}

function classifyGeneratedHandoffAssetUrl(
  assetUrl: string | undefined,
): GenerativeFillLayerHandoffDescriptor['source']['assetUrlKind'] {
  if (!assetUrl) return 'none';
  if (assetUrl.startsWith('blob:')) return 'blob-url';
  if (assetUrl.startsWith('data:')) return 'embedded-data-url';
  return 'durable-url';
}

function buildGeneratedLayerHandoffSignatures({
  documentId,
  layerId,
  sourceId,
  assetUrlKind,
  durableAsset,
  warningCodes,
  previewSignature,
}: {
  documentId: string;
  layerId: string;
  sourceId: string | null;
  assetUrlKind: GenerativeFillLayerHandoffDescriptor['source']['assetUrlKind'];
  durableAsset: boolean;
  warningCodes: GenerativeFillLayerHandoffWarning['code'][];
  previewSignature: string;
}): GenerativeFillLayerHandoffDescriptor['handoffSignatures'] {
  const payload = {
    documentId,
    layerId,
    sourceId,
    assetUrlKind,
    durableAsset,
    warningCodes,
  };

  return {
    preview: previewSignature,
    export: `generative-fill-export-handoff:v1:${JSON.stringify(payload)}`,
    sourceBin: `generative-fill-source-bin-handoff:v1:${JSON.stringify(payload)}`,
  };
}

function describeGenerativeEditProviderCapabilities(
  provider: ImageProvider | 'none',
  modelId: string | null | undefined,
): GenerativeEditProviderCapabilityDescriptor {
  const normalizedModelId = modelId?.trim() || defaultGenerativeEditModel(provider);
  if (provider === 'openai') {
    return {
      provider,
      modelId: normalizedModelId,
      displayName: 'OpenAI Images',
      routeKind: 'cloud',
      supportsSelectedRegion: true,
      supportsReferenceInputs: true,
      supportsOutpaint: true,
      supportsUpscale: false,
      credentialRequirement: 'api-key',
      cost: { estimatedUsd: 0.04, label: 'Cloud image edit estimate: about $0.04 per edit.', unit: 'per-edit' },
      capabilityNotes: ['Selected-region masks and reference images can be prepared locally before request dispatch.'],
    };
  }
  if (provider === 'gemini') {
    return {
      provider,
      modelId: normalizedModelId,
      displayName: 'Gemini image',
      routeKind: 'cloud',
      supportsSelectedRegion: true,
      supportsReferenceInputs: true,
      supportsOutpaint: false,
      supportsUpscale: false,
      credentialRequirement: 'api-key',
      cost: { estimatedUsd: 0.04, label: 'Cloud image edit estimate: usage depends on the configured Gemini billing project.', unit: 'per-edit' },
      capabilityNotes: ['Model controls are exposed as request metadata; exact billing is provider-side.'],
    };
  }
  if (provider === 'stability' || provider === 'bfl' || provider === 'atlas') {
    return {
      provider,
      modelId: normalizedModelId,
      displayName: provider === 'stability' ? 'Stability image' : provider === 'bfl' ? 'Black Forest Labs image' : 'Atlas image',
      routeKind: 'cloud',
      supportsSelectedRegion: true,
      supportsReferenceInputs: provider !== 'bfl',
      supportsOutpaint: provider === 'stability',
      supportsUpscale: provider === 'stability',
      credentialRequirement: 'api-key',
      cost: { estimatedUsd: null, label: 'Cloud image edit estimate: provider credit pricing varies by model.', unit: 'per-edit' },
      capabilityNotes: ['Capability flags are conservative until a live model catalog confirms exact edit controls.'],
    };
  }
  if (provider === 'localOpen') {
    return {
      provider,
      modelId: normalizedModelId,
      displayName: 'Local Open image endpoint',
      routeKind: 'local',
      supportsSelectedRegion: true,
      supportsReferenceInputs: true,
      supportsOutpaint: true,
      supportsUpscale: false,
      credentialRequirement: 'endpoint',
      cost: { estimatedUsd: 0, label: 'Local endpoint: no metered cloud cost from Sloom Studio.', unit: 'local' },
      capabilityNotes: ['Endpoint/model readiness depends on the locally configured image-edit server.'],
    };
  }
  if (provider === 'android') {
    return {
      provider,
      modelId: normalizedModelId,
      displayName: 'Android accelerator',
      routeKind: 'android',
      supportsSelectedRegion: true,
      supportsReferenceInputs: true,
      supportsOutpaint: false,
      supportsUpscale: true,
      credentialRequirement: 'android-route',
      cost: { estimatedUsd: 0, label: 'Android route: local device execution, no cloud cost.', unit: 'local' },
      capabilityNotes: ['Requires a paired Android accelerator endpoint or native Android upscaler bridge.'],
    };
  }
  if (provider === 'huggingface') {
    return {
      provider,
      modelId: normalizedModelId,
      displayName: 'Hugging Face image',
      routeKind: 'cloud',
      supportsSelectedRegion: true,
      supportsReferenceInputs: false,
      supportsOutpaint: false,
      supportsUpscale: false,
      credentialRequirement: 'api-key',
      cost: { estimatedUsd: null, label: 'Hosted inference cost depends on the selected Space or endpoint.', unit: 'per-edit' },
      capabilityNotes: ['Reference-input support is endpoint-specific and treated as unavailable by this readiness helper.'],
    };
  }
  return {
    provider,
    modelId: normalizedModelId,
    displayName: 'No image edit provider',
    routeKind: 'unsupported',
    supportsSelectedRegion: false,
    supportsReferenceInputs: false,
    supportsOutpaint: false,
    supportsUpscale: false,
    credentialRequirement: 'unsupported',
    cost: { estimatedUsd: null, label: 'No provider selected.', unit: 'local' },
    capabilityNotes: ['Choose a provider before running a generative edit.'],
  };
}

function summarizeGenerativeEditSelection(
  operation: GenerativeEditOperation,
  selection: SelectionMask | null | undefined,
): GenerativeEditSelectionReadiness {
  const required = operation === 'selected-region-edit' || operation === 'outpaint';
  if (!selection) {
    return {
      required,
      present: false,
      empty: true,
      width: 0,
      height: 0,
      selectedPixels: 0,
      coverage: 0,
      bounds: null,
      ready: !required,
    };
  }

  let selectedPixels = 0;
  let minX = selection.width;
  let minY = selection.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      if (selection.data[y * selection.width + x] > 0) {
        selectedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const empty = selectedPixels === 0;
  return {
    required,
    present: true,
    empty,
    width: selection.width,
    height: selection.height,
    selectedPixels,
    coverage: selection.width * selection.height > 0
      ? Number((selectedPixels / (selection.width * selection.height)).toFixed(4))
      : 0,
    bounds: empty ? null : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    ready: !required || !empty,
  };
}

function summarizeGenerativeEditReferences(
  operation: GenerativeEditOperation,
  references: GenerativeEditReferenceInput[],
): GenerativeEditReferenceReadiness {
  const required = operation === 'reference-edit';
  const inputs = references.map((reference) => {
    const label = reference.label?.trim() || reference.id;
    const ready = Boolean(reference.value?.trim());
    return {
      id: reference.id,
      kind: reference.kind,
      label,
      ready,
      reason: ready
        ? `${label} is ready as a ${reference.kind} reference.`
        : `${label} needs a URL, Source Library id, or description before it can guide the edit.`,
    };
  });
  const readyCount = inputs.filter((reference) => reference.ready).length;

  return {
    required,
    providedCount: references.length,
    readyCount,
    ready: required ? readyCount > 0 : inputs.every((reference) => reference.ready),
    inputs,
  };
}

function describeGenerativeEditReferenceSlots(
  references: GenerativeEditReferenceInput[],
): GenerativeEditReferenceSlotDescriptor[] {
  return references.map((reference, index) => {
    const slotIndex = index + 1;
    const label = reference.label?.trim() || reference.id;
    const ready = Boolean(reference.value?.trim());
    const dispatchRole = reference.kind === 'description' ? 'text-reference' : 'image-reference';
    const valueKind = reference.kind === 'image-url' ? 'url' : reference.kind;
    const missingValue = missingReferenceSlotValueLabel(reference.kind);
    const summary = ready
      ? `${label} is ready as ${dispatchRole === 'image-reference' ? 'image' : 'text'} reference slot ${slotIndex}.`
      : `${label} is missing ${missingValue} for reference slot ${slotIndex}.`;

    return {
      slotIndex,
      id: reference.id,
      kind: reference.kind,
      label,
      dispatchRole,
      ready,
      valueState: ready ? 'provided' : 'missing',
      valueKind,
      summary,
      blockerCode: ready ? null : 'missing-reference-input',
    };
  });
}

function buildGenerativeEditReferenceSlotSignature(
  documentId: string,
  operation: GenerativeEditOperation,
  referenceSlots: GenerativeEditReferenceSlotDescriptor[],
): string {
  return `generative-edit-reference-slots:v1:${JSON.stringify({
    documentId,
    operation,
    slots: referenceSlots.map((slot) => `${slot.slotIndex}:${slot.id}:${slot.kind}:${slot.valueState}`),
  })}`;
}

function missingReferenceSlotValueLabel(kind: GenerativeEditReferenceKind): string {
  if (kind === 'image-url') return 'an image URL';
  if (kind === 'source-library-item') return 'a Source Library item id';
  return 'a description';
}

function describeGenerativeEditUpscaleRoutes(input: GenerativeEditReadinessInput): GenerativeEditUpscaleRouteStatus[] {
  const settings = input.providerSettings ?? {};
  return [
    {
      route: 'android-accelerator',
      available: Boolean(settings.androidAcceleratorBaseUrl?.trim()),
      label: 'Android accelerator NPU/GPU upscaler',
      costLabel: 'Local device route, no cloud cost.',
      blockers: settings.androidAcceleratorBaseUrl?.trim() ? [] : ['missing-local-route'],
      caveats: ['Requires a paired Android accelerator service before dispatch.'],
    },
    {
      route: 'android-native',
      available: Boolean(input.isAndroidNativeUpscalerAvailable),
      label: 'Android native image upscaler',
      costLabel: 'Native Android route, no cloud cost.',
      blockers: input.isAndroidNativeUpscalerAvailable ? [] : ['missing-local-route'],
      caveats: ['Only available when the Android native bridge reports an installed upscaler.'],
    },
    {
      route: 'local-ai-cpu',
      available: Boolean(settings.localAiCpuEndpointUrl?.trim()),
      label: 'Local Vulkan AI upscaler',
      costLabel: 'Local endpoint route, no cloud cost.',
      blockers: settings.localAiCpuEndpointUrl?.trim() ? [] : ['missing-local-route'],
      caveats: ['The managed desktop runtime requires a working Vulkan GPU/driver and has no CPU fallback; custom compatible endpoints may differ.'],
    },
    {
      route: 'cloud',
      available: hasProviderCredential(input.provider, input.apiKeys, input.providerSettings),
      label: 'Cloud image upscaler',
      costLabel: 'Provider credit cost varies by model.',
      blockers: hasProviderCredential(input.provider, input.apiKeys, input.providerSettings) ? [] : ['missing-provider-credential'],
      caveats: ['Cloud upscale availability depends on the selected provider/model capability.'],
    },
    {
      route: 'browser',
      available: true,
      label: 'Browser resize fallback',
      costLabel: 'Local browser resize, no AI cost.',
      blockers: [],
      caveats: ['Browser resize is deterministic but is not an AI super-resolution result.'],
    },
  ];
}

function describeGenerativeEditFallbackStates(
  input: GenerativeEditReadinessInput,
  provider: GenerativeEditProviderCapabilityDescriptor,
  upscaleRoutes: GenerativeEditUpscaleRouteStatus[],
): GenerativeEditFallbackState[] {
  const localRoute = upscaleRoutes.find((route) => route.route === 'local-ai-cpu');
  const cloudRoute = upscaleRoutes.find((route) => route.route === 'cloud');
  const browserRoute = upscaleRoutes.find((route) => route.route === 'browser');
  const selectedProviderAvailable = provider.routeKind === 'browser'
    ? true
    : provider.routeKind === 'unsupported' || provider.provider === 'none'
      ? false
      : hasProviderCredential(provider.provider, input.apiKeys, input.providerSettings);
  const selectedSummary = selectedProviderAvailable
    ? provider.routeKind === 'cloud'
      ? `${provider.displayName} is the active cloud AI route for this edit.`
      : provider.routeKind === 'android'
        ? `${provider.displayName} is the active AI route family for this ${input.operation === 'upscale' ? 'upscale request' : 'edit'}.`
        : provider.routeKind === 'local'
          ? `${provider.displayName} is the active local AI route for this edit.`
          : provider.routeKind === 'browser'
            ? `${provider.displayName} is the active browser fallback route for this request.`
            : `${provider.displayName} is not a supported active route for this request.`
    : provider.routeKind === 'android'
      ? `${provider.displayName} is selected for this ${input.operation === 'upscale' ? 'upscale request' : 'edit'}, but the required Android runtime route is not configured yet.`
      : provider.routeKind === 'local'
        ? `${provider.displayName} is selected for this edit, but the required local runtime endpoint is not configured yet.`
        : provider.routeKind === 'cloud'
          ? `${provider.displayName} is selected for this edit, but provider credentials are not configured yet.`
          : `${provider.displayName} is not a supported active route for this request.`;

  const states: GenerativeEditFallbackState[] = [
    {
      lane: 'selected-provider',
      routeKind: provider.routeKind,
      available: selectedProviderAvailable,
      active: selectedProviderAvailable,
      summary: selectedSummary,
    },
    {
      lane: 'local-fallback',
      routeKind: 'local',
      available: localRoute?.available ?? provider.provider === 'localOpen',
      active: provider.routeKind === 'local',
      summary: localRoute?.available
        ? 'Local Vulkan AI fallback is available if the Android accelerator route is unavailable or intentionally bypassed.'
        : 'Local endpoint fallback is not active; configure a Local/Open provider to keep the edit on-device or LAN.',
    },
  ];

  if (input.operation === 'upscale' || provider.routeKind !== 'cloud') {
    states.push({
      lane: 'cloud-fallback',
      routeKind: 'cloud',
      available: cloudRoute?.available ?? provider.routeKind === 'cloud',
      active: provider.routeKind === 'cloud',
      summary: cloudRoute?.available
        ? 'Cloud upscale fallback is available through the selected provider family.'
        : 'Cloud upscale fallback still depends on provider/model credentials and is currently unavailable.',
    });
  }

  states.push({
    lane: 'browser-fallback',
    routeKind: 'browser',
    available: browserRoute?.available ?? true,
    active: provider.routeKind === 'browser',
    summary: input.operation === 'upscale'
      ? 'Browser resize fallback is available, but it is deterministic scaling rather than AI super-resolution.'
      : 'Browser fallback is limited to manual local edits/export and does not provide cloud semantic synthesis.',
  });

  return states;
}

function describeGenerativeEditRuntimeSummary(
  provider: GenerativeEditProviderCapabilityDescriptor,
  blockers: GenerativeEditReadinessBlocker[],
): GenerativeEditRuntimeSummary {
  const allCodes = blockers.map((blocker) => blocker.code);
  const blockerSummary = {
    requiredInputCodes: allCodes.filter((code) => (
      code === 'missing-selection'
      || code === 'empty-selection'
      || code === 'missing-prompt'
      || code === 'missing-reference-input'
      || code === 'source-print-resolution-excluded'
      || code === 'comic-sfx-print-resolution-excluded'
    )),
    providerCapabilityCodes: allCodes.filter((code) => (
      code === 'unsupported-provider'
      || code === 'unsupported-operation'
    )),
    credentialCodes: allCodes.filter((code) => code === 'missing-provider-credential'),
    runtimeCodes: allCodes.filter((code) => code === 'missing-local-route'),
    allCodes,
  };
  const executionMode = executionModeForProvider(provider);
  const warnings: GenerativeEditRuntimeSummary['warnings'] = [
    {
      code: 'not-photoshop-native-ai',
      severity: 'warning',
      message: 'Generative edit readiness does not call Photoshop, Firefly, or a native Photoshop cloud service.',
    },
  ];

  if (provider.routeKind === 'cloud') {
    warnings.push({
      code: 'external-cloud-provider',
      severity: 'warning',
      message: `${provider.displayName} would run through Sloom Studio provider dispatch with stored credentials, not Photoshop cloud execution.`,
    });
  } else if (provider.routeKind === 'local' || provider.routeKind === 'android') {
    warnings.push({
      code: 'local-runtime-not-configured',
      severity: 'warning',
      message: `${provider.displayName} depends on a configured local/native runtime route before dispatch.`,
    });
  } else if (provider.routeKind === 'browser') {
    warnings.push({
      code: 'browser-fallback-not-ai',
      severity: 'warning',
      message: 'Browser fallback descriptors cover deterministic local image operations, not AI semantic generation.',
    });
  }

  return {
    executionMode,
    dispatchStatus: blockers.length === 0 ? 'ready-for-provider-dispatch' : 'blocked',
    photoshopNativeAi: {
      supported: false,
      reason: 'Photoshop/Firefly native Generative Fill execution is not wired; this descriptor only prepares Sloom Studio provider routes.',
    },
    signalLoomExecution: {
      usesCloudProvider: provider.routeKind === 'cloud',
      executesLocally: provider.routeKind === 'local' || provider.routeKind === 'android',
      requiresStoredCredential: provider.credentialRequirement === 'api-key',
      requiresConfiguredRuntime: provider.credentialRequirement === 'endpoint' || provider.credentialRequirement === 'android-route',
      browserOnlyFallback: provider.routeKind === 'browser',
    },
    blockerSummary,
    warnings,
  };
}

function executionModeForProvider(provider: GenerativeEditProviderCapabilityDescriptor): GenerativeEditExecutionMode {
  if (provider.routeKind === 'cloud') return 'cloud-provider';
  if (provider.routeKind === 'local') return 'local-endpoint';
  if (provider.routeKind === 'android') return 'android-runtime';
  if (provider.routeKind === 'browser') return 'browser-fallback';
  return 'unsupported';
}

function buildGenerativeEditReadinessBlockers(
  input: GenerativeEditReadinessInput,
  provider: GenerativeEditProviderCapabilityDescriptor,
  selectedRegion: GenerativeEditSelectionReadiness,
  references: GenerativeEditReferenceReadiness,
  upscaleRoutes: GenerativeEditUpscaleRouteStatus[],
  requestedUpscaleRoute: GenerativeEditUpscaleRoute | null,
): GenerativeEditReadinessBlocker[] {
  const blockers: GenerativeEditReadinessBlocker[] = [];
  if (!input.prompt?.trim() && input.operation !== 'upscale') {
    blockers.push({ code: 'missing-prompt', message: 'A prompt is required before running a generative image edit.' });
  }
  if (selectedRegion.required && !selectedRegion.present) {
    blockers.push({ code: 'missing-selection', message: 'Select a document region before running this operation.' });
  } else if (selectedRegion.required && selectedRegion.empty) {
    blockers.push({ code: 'empty-selection', message: 'The selected region does not contain editable pixels.' });
  }
  if (references.required && !references.ready) {
    blockers.push({ code: 'missing-reference-input', message: 'At least one ready reference image or description is required for this operation.' });
  }
  if (provider.provider === 'none') {
    blockers.push({ code: 'unsupported-provider', message: 'Choose an image edit provider before running the operation.' });
  }
  if (!providerSupportsOperation(provider, input.operation)) {
    blockers.push({
      code: 'unsupported-operation',
      message: `${provider.displayName} does not advertise ${describeGenerativeEditOperation(input.operation)} support in this readiness helper.`,
    });
  }
  if (provider.provider !== 'none' && provider.credentialRequirement !== 'none' && !hasProviderCredential(provider.provider, input.apiKeys, input.providerSettings)) {
    blockers.push({
      code: provider.credentialRequirement === 'api-key' ? 'missing-provider-credential' : 'missing-local-route',
      message: credentialBlockerMessage(provider),
    });
  }
  if (input.operation === 'upscale' && requestedUpscaleRoute) {
    const route = upscaleRoutes.find((candidate) => candidate.route === requestedUpscaleRoute);
    if (route && !route.available) {
      blockers.push({ code: route.blockers[0] ?? 'missing-local-route', message: `${route.label} is not configured.` });
    }
  }
  if (input.operation === 'upscale' && input.alreadyPrintResolution) {
    if (input.sourceKind === 'comic-sfx-layer') {
      blockers.push({
        code: 'comic-sfx-print-resolution-excluded',
        message: 'Comic SFX layers already at print resolution are excluded from automatic AI upscaling.',
      });
    } else {
      blockers.push({
        code: 'source-print-resolution-excluded',
        message: `${describeGenerativeEditSourceKind(input.sourceKind)} is already at print resolution; automatic AI upscaling is skipped unless explicitly overridden.`,
      });
    }
  }
  return blockers;
}

function describeGenerativeEditSourceKind(sourceKind: GenerativeEditReadinessInput['sourceKind']): string {
  if (sourceKind === 'selected-layer') return 'Selected layer';
  if (sourceKind === 'comic-sfx-layer') return 'Comic SFX layer';
  return 'Source document';
}

function buildGenerativeEditReadinessCaveats(
  input: GenerativeEditReadinessInput,
  provider: GenerativeEditProviderCapabilityDescriptor,
  unsupportedStates: GenerativeEditReadinessDescriptor['unsupportedPhotoshopParityStates'],
): string[] {
  const caveats = [
    ...provider.capabilityNotes,
    ...unsupportedStates.map((state) => state.caveat),
  ];
  if (input.operation === 'upscale') {
    caveats.push('Upscaler routes operate on prepared image pixels; layered Photoshop Super Resolution metadata is not created.');
  }
  if (input.sourceKind === 'comic-sfx-layer') {
    caveats.push('Comic SFX layers retain designer recipes; print-resolution SFX should not be rerouted through AI upscaling unless explicitly requested.');
  }
  if (input.alreadyPrintResolution) {
    caveats.push(`Input is already at print resolution${input.targetDpi ? ` (${input.targetDpi} DPI)` : ''}; automatic upscale should be skipped unless the user overrides it.`);
  }
  return Array.from(new Set(caveats));
}

function describeUnsupportedPhotoshopGenerativeFillStates(): GenerativeEditReadinessDescriptor['unsupportedPhotoshopParityStates'] {
  return [
    {
      state: 'photoshop-generative-fill-native-layer',
      supported: false,
      caveat: 'Sloom Studio creates ordinary image layers with masks; it does not preserve Photoshop native Generative Fill layer semantics.',
    },
    {
      state: 'photoshop-firefly-variation-stack',
      supported: false,
      caveat: 'Photoshop Firefly variation stacks are not represented; only the chosen generated bitmap can be retained.',
    },
    {
      state: 'photoshop-contextual-taskbar-history',
      supported: false,
      caveat: 'Photoshop contextual taskbar prompt history is not imported or exported.',
    },
    {
      state: 'photoshop-cloud-credit-meter',
      supported: false,
      caveat: 'Provider cost labels are estimates/status text, not a Photoshop cloud-credit meter.',
    },
    {
      state: 'photoshop-prompt-safety-review',
      supported: false,
      caveat: 'Provider-side prompt moderation remains external to this deterministic readiness descriptor.',
    },
  ];
}

function providerSupportsOperation(
  provider: GenerativeEditProviderCapabilityDescriptor,
  operation: GenerativeEditOperation,
): boolean {
  if (operation === 'selected-region-edit') return provider.supportsSelectedRegion;
  if (operation === 'reference-edit') return provider.supportsReferenceInputs;
  if (operation === 'outpaint') return provider.supportsOutpaint;
  return provider.supportsUpscale || provider.provider === 'none';
}

function hasProviderCredential(
  provider: ImageProvider | 'none',
  apiKeys: Partial<ApiKeys> | undefined,
  settings: Partial<ProviderSettings> | undefined,
): boolean {
  if (provider === 'none') return false;
  if (provider === 'localOpen') return Boolean(settings?.localOpenImageEndpointUrl?.trim());
  if (provider === 'android') return Boolean(settings?.androidAcceleratorBaseUrl?.trim());
  return Boolean(apiKeys?.[provider]?.trim());
}

function credentialBlockerMessage(provider: GenerativeEditProviderCapabilityDescriptor): string {
  if (provider.credentialRequirement === 'endpoint') {
    return `${provider.displayName} needs a configured local image endpoint before dispatch.`;
  }
  if (provider.credentialRequirement === 'android-route') {
    return `${provider.displayName} needs a paired Android accelerator route before dispatch.`;
  }
  return `${provider.displayName} needs a stored API key before dispatch.`;
}

function defaultGenerativeEditModel(provider: ImageProvider | 'none'): string {
  if (provider === 'openai') return 'gpt-image-1';
  if (provider === 'gemini') return 'gemini-2.5-flash-image';
  if (provider === 'stability') return 'stable-image-edit';
  if (provider === 'bfl') return 'flux-kontext';
  if (provider === 'huggingface') return 'endpoint-selected-model';
  if (provider === 'localOpen') return 'Qwen/Qwen-Image-Edit';
  if (provider === 'android') return 'local-dream-active';
  if (provider === 'atlas') return 'atlas-image-edit';
  return 'none';
}

function describeGenerativeEditOperation(operation: GenerativeEditOperation): string {
  if (operation === 'selected-region-edit') return 'selected-region edit';
  if (operation === 'reference-edit') return 'reference-guided edit';
  if (operation === 'outpaint') return 'outpaint';
  return 'upscale';
}

function formatCoverage(coverage: number): string {
  return `${Math.round(coverage * 1000) / 10}% selected`;
}

function isDurableGeneratedSourceItem(
  item: Pick<SourceBinLibraryItem, 'assetId' | 'scratchFileName' | 'nativeFilePath'> | undefined,
): boolean {
  return Boolean(item?.assetId || item?.scratchFileName || item?.nativeFilePath);
}

function boxBlurSelectionMask(selection: SelectionMask): SelectionMask {
  const out = new Uint8ClampedArray(selection.width * selection.height);

  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      let sum = 0;
      let count = 0;

      for (let yy = y - 1; yy <= y + 1; yy += 1) {
        if (yy < 0 || yy >= selection.height) continue;
        for (let xx = x - 1; xx <= x + 1; xx += 1) {
          if (xx < 0 || xx >= selection.width) continue;
          sum += selection.data[yy * selection.width + xx];
          count += 1;
        }
      }

      out[y * selection.width + x] = Math.round(sum / Math.max(1, count));
    }
  }

  return {
    width: selection.width,
    height: selection.height,
    data: out,
  };
}
