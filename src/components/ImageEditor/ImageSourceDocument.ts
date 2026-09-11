import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { bitmapFromUrl, createBitmap, fillBitmap } from './LayerBitmap';
import { getImageClipboardBitmap } from './ImageEditorClipboard';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { isRemoteLanClient } from '../../lib/projectLibrary';
import { loadImportedAssetAsDataUrl } from '../../lib/assetStore';
import { parseSignalLoomAssetId } from '../../lib/signalLoomAssetUrl';
import { fetchRemoteHostSourceAssetDataUrl } from '../../lib/remoteHostClient';
import {
  CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS,
  describeCameraRawDevelopFirstMetadata,
  type CameraRawDevelopFirstMetadata,
  createRasterImageDocumentFromBlob,
  createSvgImageDocument,
  createTiffImageDocument,
  describeSourceImageFormatPolicy,
  detectSourceImageFormatPolicy,
  getImageMimeTypeFromRegistry,
  type SourceImageBitDepthDescriptor,
  type SourceImageFormatImportStatus,
  type SourceImageFormatPolicy,
} from './ImageFileFormats';
import { decodeNativeHighBitImport, type NativeHighBitImport } from './ImageNativeHighBitImport';
import { createXcfImageDocument } from './ImageXcfImport';

interface CreateSourceImageDocumentOptions {
  fallbackWidth?: number;
  fallbackHeight?: number;
  loadBitmap?: (url: string) => Promise<LayerBitmap>;
}

interface CreateLocalImageDocumentOptions {
  id?: string;
}

export type ImageSourceOpenWorkflowKind = 'quick-edit' | 'source-linked' | 'export-only';
export type ImageSourceOpenWorkflowMode =
  | 'source-bin-document'
  | 'local-file-document'
  | 'source-linked-layer-refresh';
export type ImageSourceOpenNativeRoundtrip = 'none' | 'source-linked' | 'metadata-only' | 'unsupported';
export type ImageSourceOpenWorkflowWarningCode =
  | 'missing-source-link'
  | 'unsupported-native-roundtrip'
  | 'high-bit-depth-source-loss'
  | 'raw-development-required';

export interface ImageSourceOpenWorkflowWarning {
  code: ImageSourceOpenWorkflowWarningCode;
  message: string;
  sourceId?: string;
  formatLabel?: string;
  sourceMimeType?: string;
}

export interface ImageSourceOpenWorkflowDescriptor {
  workflowKind: ImageSourceOpenWorkflowKind;
  mode: ImageSourceOpenWorkflowMode;
  sourceBinItemId?: string;
  sourceLabel?: string;
  formatLabel?: string;
  sourceExtension?: string;
  sourceMimeType?: string;
  importStatus?: SourceImageFormatImportStatus;
  bitDepth?: SourceImageBitDepthDescriptor;
  formatLimitations: string[];
  opensEditableDocument: boolean;
  keepsSourceLink: boolean;
  nativeRoundtrip: ImageSourceOpenNativeRoundtrip;
  warnings: ImageSourceOpenWorkflowWarning[];
  rawDevelopFirst?: CameraRawDevelopFirstMetadata;
}

export type ImageSourceDocumentRoundtripRisk = 'none' | 'source-linked' | 'metadata-only' | 'unsupported';

export interface ImageSourceDocumentRoundtripRiskDescriptor {
  descriptorId: 'image-source-document-roundtrip-risk:v1';
  workflowKind: ImageSourceOpenWorkflowKind;
  mode: ImageSourceOpenWorkflowMode;
  sourceBinItemId?: string;
  sourceLabel?: string;
  formatLabel?: string;
  importStatus?: SourceImageFormatImportStatus;
  externalDevelopmentRequired: boolean;
  roundtripRisk: ImageSourceDocumentRoundtripRisk;
  unsupportedImportBlockers: ImageSourceOpenWorkflowWarningCode[];
  supportedHandoffFormats: string[];
  sourceDocumentCaveats: string[];
  rawDevelopFirst?: CameraRawDevelopFirstMetadata;
  suiteHandoffCaveats: string[];
  previewSignature: string;
}

export type ImageSourceLibraryHandoffState =
  | 'source-linked-opened'
  | 'opened-local-document'
  | 'missing-source-id';
export type ImageSourceLibraryAssetUrlKind =
  | 'none'
  | 'blob-url'
  | 'embedded-data-url'
  | 'durable-url';
export type ImageSourceLibraryHandoffWarningCode = 'missing-source-id' | 'blob-only-source-url';

export interface ImageSourceLibraryHandoffWarning {
  code: ImageSourceLibraryHandoffWarningCode;
  message: string;
  sourceId?: string;
}

export interface ImageSourceLibraryWorkspaceReadiness {
  target: 'flow' | 'video' | 'paper';
  ready: boolean;
  reason: string;
}

export interface ImageSourceLibraryLayerHandoffSummary {
  kind: 'generated' | 'reference' | 'source-linked';
  layerId: string;
  layerName: string;
  sourceBinItemId: string | null;
  ready: boolean;
  blockerCodes: ImageSourceLibraryHandoffWarningCode[];
  signature: string;
  summary: string;
}

export interface ImageSourceLibrarySourceSnapshotAvailability {
  available: boolean;
  snapshotCount: number;
  latestSnapshotId?: string;
  sourceIds: string[];
  missingSourceIds: string[];
}

export interface ImageSourceLibraryExternalAssetPackaging {
  required: boolean;
  caveats: string[];
  signature: string;
}

export type ImageSourceLibrarySourceSnapshotRiskState =
  | 'preserved'
  | 'missing-snapshots'
  | 'missing-source'
  | 'blob-only-risk';

export interface ImageSourceLibrarySourceSnapshotRisk {
  state: ImageSourceLibrarySourceSnapshotRiskState;
  preservesSourceSnapshot: boolean;
  snapshotCount: number;
  latestSnapshotId?: string;
  sourceIds: string[];
  missingSourceIds: string[];
  blobOnlySourceIds: string[];
  blockerCodes: ImageSourceLibraryHandoffWarningCode[];
  caveats: string[];
  signature: string;
}

export interface ImageSourceLibrarySuiteHandoffBlocker {
  code: ImageSourceLibraryHandoffWarningCode;
  target: 'suite';
  message: string;
}

export interface ImageSourceLibraryLayerSnapshot {
  layerId: string;
  layerName: string;
  sourceFormat: string;
  bounds: { x: number; y: number; width: number; height: number };
  sourceBinItemId: string | null;
}

export interface ImageSourceLibraryDocumentSnapshotSummary {
  id: string;
  name: string;
  createdAt: number;
  width: number;
  height: number;
  layerCount: number;
}

export interface ImageSourceLibraryHandoffDescriptor {
  descriptorId: 'image-source-library-handoff:v1';
  documentId: string;
  documentTitle: string;
  documentState: ImageSourceLibraryHandoffState;
  source: {
    sourceBinItemId: string | null;
    label: string | null;
    assetUrlKind: ImageSourceLibraryAssetUrlKind;
    durableAsset: boolean;
    pixelWidth: number | null;
    pixelHeight: number | null;
  };
  readiness: Record<'flow' | 'video' | 'paper', ImageSourceLibraryWorkspaceReadiness>;
  generatedSnapshots: ImageSourceLibraryLayerSnapshot[];
  referenceSnapshots: ImageSourceLibraryLayerSnapshot[];
  snapshots: ImageSourceLibraryDocumentSnapshotSummary[];
  warnings: ImageSourceLibraryHandoffWarning[];
  preview: {
    id: string;
    label: string;
    sizeLabel: string;
    sourceLabel: string | null;
  };
  layerHandoff: {
    generated: ImageSourceLibraryLayerHandoffSummary[];
    reference: ImageSourceLibraryLayerHandoffSummary[];
    sourceLinked: ImageSourceLibraryLayerHandoffSummary[];
  };
  sourceSnapshotAvailability: ImageSourceLibrarySourceSnapshotAvailability;
  sourceSnapshotRisk: ImageSourceLibrarySourceSnapshotRisk;
  externalAssetPackaging: ImageSourceLibraryExternalAssetPackaging;
  suiteHandoffBlockers: ImageSourceLibrarySuiteHandoffBlocker[];
  sourceDocumentSignature: string;
  layerHandoffSignature: string;
  previewSignature: string;
}

export type ImageSourceLinkedLayerReadinessStatus = 'linked' | 'relinked' | 'missing' | 'blocked' | 'unlinked';
export type ImageSourceLinkedLayerReadinessBlockerCode =
  | 'missing-source-id'
  | 'missing-source-asset'
  | 'blob-only-source-url'
  | 'non-image-source-asset';

export interface ImageSourceLinkedLayerRefreshBlocker {
  code: ImageSourceLinkedLayerReadinessBlockerCode;
  sourceId: string | null;
  message: string;
}

export interface ImageSourceLinkedLayerRefreshPolicyDescriptor {
  mode: 'source-linked-refresh';
  operation: 'refresh-linked-bitmap';
  ready: boolean;
  sourceBinItemId: string | null;
  requiresRelink: boolean;
  destructiveSaveBlocked: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  blockers: ImageSourceLinkedLayerRefreshBlocker[];
  signature: string;
}

export interface ImageSourceLinkedLayerSnapshotAvailability {
  available: boolean;
  snapshotCount: number;
  latestSnapshotId?: string;
  state: 'available' | 'missing-source-id' | 'no-snapshots';
  caveat?: string;
}

export interface ImageSourceLinkedLayerSnapshotPreservation {
  preserved: boolean;
  snapshotCount: number;
  latestSnapshotId?: string;
  sourceIds: string[];
  missingSourceIds: string[];
}

export interface ImageSourceLinkedLayerAutomationSuitability {
  suitable: boolean;
  operation: 'replace-contents' | 'relink-repair' | 'edit-original' | 'batch-replace-contents';
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  caveats: string[];
}

export type ImageSourceLinkedLayerReadinessWarningCode =
  | 'metadata-only-psd-smart-object'
  | 'metadata-only-smart-filters'
  | 'smart-filter-mask-unsupported'
  | 'relinked-source-dimensions-should-be-verified';

export interface ImageSourceLinkedLayerReadinessWarning {
  code: ImageSourceLinkedLayerReadinessWarningCode;
  message: string;
}

export interface ImageSourceLinkedLayerHandoffReadiness {
  target: 'source-bin' | 'video';
  ready: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  caveats: string[];
}

export type ImageSourceLinkedLayerStandaloneDestructiveOverwriteWarning =
  | 'required-before-source-overwrite'
  | 'blocked-until-source-relinked';

export interface ImageSourceLinkedLayerStandaloneStateDescriptor {
  mode: 'standalone-quick-edit';
  quickOpenReady: boolean;
  quickSaveReady: boolean;
  quickExportReady: boolean;
  destructiveOverwriteWarning: ImageSourceLinkedLayerStandaloneDestructiveOverwriteWarning;
  nativeExternalEditorRoundtrip: false;
  signedInstallerIdentityClaimed: false;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  caveats: string[];
  signature: string;
}

export type ImageSourceLinkedLayerSuitePackageState =
  | 'durable-source-library-asset'
  | 'missing-source-id'
  | 'missing-source-asset'
  | 'blob-url-needs-packaging'
  | 'non-image-source-asset';

export interface ImageSourceLinkedLayerSuitePackageTargetReadiness {
  target: 'flow' | 'video' | 'paper';
  ready: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  caveats: string[];
}

export interface ImageSourceLinkedLayerSuitePackageDescriptor {
  mode: 'source-library-package-handoff';
  ready: boolean;
  sourceLibraryPackageState: ImageSourceLinkedLayerSuitePackageState;
  packagedSourceIds: string[];
  missingSourceIds: string[];
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  targets: Record<'flow' | 'video' | 'paper', ImageSourceLinkedLayerSuitePackageTargetReadiness>;
  caveats: string[];
  signature: string;
}

export interface ImageSourceLinkedLayerReadinessDescriptor {
  descriptorId: 'image-source-linked-layer-readiness:v1';
  layerId: string;
  layerName: string;
  status: ImageSourceLinkedLayerReadinessStatus;
  source: {
    sourceBinItemId: string | null;
    label: string | null;
    formatLabel: string | null;
    linkStatus: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']>['status'] | 'unlinked';
    relinkHistoryCount: number;
    latestRelink?: { sourceId: string; label?: string; at: number };
    assetAvailable: boolean;
    assetUrlKind: ImageSourceLibraryAssetUrlKind;
    durableAsset: boolean;
    pixelWidth: number | null;
    pixelHeight: number | null;
  };
  replaceContents: {
    ready: boolean;
    mode: 'replace-linked-bitmap' | 'relink-required';
    preservesTransformMaskEffects: boolean;
    blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
    caveats: string[];
  };
  refreshPolicy: ImageSourceLinkedLayerRefreshPolicyDescriptor;
  editOriginal: {
    ready: false;
    mode: 'metadata-only';
    caveat: string;
  };
  rasterize: {
    ready: true;
    mode: 'detach-source-link';
    preservesSourceLink: false;
    preservesSourceSnapshotHistory: boolean;
    caveats: string[];
  };
  sourceSnapshotPreservation: ImageSourceLinkedLayerSnapshotPreservation;
  sourceSnapshotAvailability: ImageSourceLinkedLayerSnapshotAvailability;
  relinkRepair: {
    ready: boolean;
    state: 'ready' | 'needs-source-id' | 'needs-source-asset' | 'needs-durable-asset' | 'needs-image-source';
    blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
    blockers: string[];
  };
  smartFilters: {
    filterCount: number;
    editableInHost: boolean;
    caveats: string[];
  };
  psdSmartObject: {
    supported: false;
    reason: string;
  };
  psdMetadataWarnings: ImageSourceLinkedLayerReadinessWarning[];
  handoffReadiness: {
    sourceBin: ImageSourceLinkedLayerHandoffReadiness;
    video: ImageSourceLinkedLayerHandoffReadiness;
  };
  actionSuitability: {
    replaceContents: ImageSourceLinkedLayerAutomationSuitability;
    relinkRepair: ImageSourceLinkedLayerAutomationSuitability;
    editOriginal: ImageSourceLinkedLayerAutomationSuitability;
  };
  batchSuitability: ImageSourceLinkedLayerAutomationSuitability;
  suiteHandoffSafe: boolean;
  standaloneState: ImageSourceLinkedLayerStandaloneStateDescriptor;
  suitePackage: ImageSourceLinkedLayerSuitePackageDescriptor;
  warningCodes: ImageSourceLinkedLayerReadinessWarningCode[];
  previewSignature: string;
}

export interface DescribeImageSourceLibraryHandoffInput {
  doc: ImageDocument;
  sourceItems?: Array<Pick<
    SourceBinLibraryItem,
    'id' | 'label' | 'assetUrl' | 'assetId' | 'scratchFileName' | 'nativeFilePath' | 'pixelWidth' | 'pixelHeight'
  >>;
}

export interface DescribeSourceLinkedLayerReadinessInput {
  layer: ImageLayer;
  sourceItems?: Array<Pick<
    SourceBinLibraryItem,
    'id' | 'label' | 'kind' | 'assetUrl' | 'assetId' | 'scratchFileName' | 'nativeFilePath' | 'pixelWidth' | 'pixelHeight'
  >>;
  snapshots?: Array<Pick<ImageSourceLibraryDocumentSnapshotSummary, 'id' | 'name' | 'createdAt'> & {
    sourceIds?: string[];
    missingSourceIds?: string[];
  }>;
}

export type DescribeImageSourceOpenWorkflowInput =
  | {
      kind: 'source-bin-item';
      item: Pick<SourceBinLibraryItem, 'id' | 'label' | 'kind' | 'assetUrl' | 'mimeType'>;
      bytes?: Uint8Array;
    }
  | {
      kind: 'local-file';
      fileName: string;
      mimeType?: string;
      bytes?: Uint8Array;
    }
  | {
      kind: 'source-linked-layer';
      layer: ImageLayer;
      item?: Pick<SourceBinLibraryItem, 'id' | 'label' | 'kind' | 'assetUrl'>;
    };

export function describeImageSourceOpenWorkflow(
  input: DescribeImageSourceOpenWorkflowInput,
): ImageSourceOpenWorkflowDescriptor {
  if (input.kind === 'source-bin-item') {
    return describeSourceBinItemOpenWorkflow(input.item, input.bytes);
  }
  if (input.kind === 'source-linked-layer') {
    return describeSourceLinkedLayerOpenWorkflow(input.layer, input.item);
  }
  return describeLocalFileOpenWorkflow(input.fileName, input.mimeType, input.bytes);
}

export function describeImageSourceDocumentRoundtripRisk(
  input: DescribeImageSourceOpenWorkflowInput,
): ImageSourceDocumentRoundtripRiskDescriptor {
  const workflow = describeImageSourceOpenWorkflow(input);
  const unsupportedImportBlockers = workflow.warnings
    .map((warning) => warning.code)
    .filter((code) => code === 'raw-development-required'
      || code === 'unsupported-native-roundtrip'
      || code === 'missing-source-link');
  const externalDevelopmentRequired = unsupportedImportBlockers.includes('raw-development-required');
  const roundtripRisk = getSourceDocumentRoundtripRisk(workflow, externalDevelopmentRequired);

  return {
    descriptorId: 'image-source-document-roundtrip-risk:v1',
    workflowKind: workflow.workflowKind,
    mode: workflow.mode,
    ...(workflow.sourceBinItemId ? { sourceBinItemId: workflow.sourceBinItemId } : {}),
    ...(workflow.sourceLabel ? { sourceLabel: workflow.sourceLabel } : {}),
    ...(workflow.formatLabel ? { formatLabel: workflow.formatLabel } : {}),
    ...(workflow.importStatus ? { importStatus: workflow.importStatus } : {}),
    externalDevelopmentRequired,
    roundtripRisk,
    unsupportedImportBlockers,
    ...(workflow.rawDevelopFirst ? { rawDevelopFirst: workflow.rawDevelopFirst } : {}),
    supportedHandoffFormats: externalDevelopmentRequired ? [...CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS] : [],
    sourceDocumentCaveats: describeSourceDocumentRoundtripCaveats(workflow, externalDevelopmentRequired),
    suiteHandoffCaveats: describeSourceDocumentSuiteHandoffCaveats(externalDevelopmentRequired),
    previewSignature: [
      'image-source-document-roundtrip-risk:v1',
      `mode=${workflow.mode}`,
      `source=${workflow.sourceBinItemId ?? workflow.sourceLabel ?? 'none'}`,
      `format=${workflow.formatLabel ?? 'unknown'}`,
      `risk=${roundtripRisk}`,
      `blockers=${unsupportedImportBlockers.join(',') || 'none'}`,
    ].join('|'),
  };
}

export function describeImageSourceLibraryHandoff({
  doc,
  sourceItems = [],
}: DescribeImageSourceLibraryHandoffInput): ImageSourceLibraryHandoffDescriptor {
  const sourceId = doc.sourceBinItemId ?? null;
  const sourceItem = sourceId ? sourceItems.find((item) => item.id === sourceId) : undefined;
  const assetUrlKind = classifySourceLibraryAssetUrl(sourceItem?.assetUrl);
  const durableAsset = Boolean(sourceItem && isDurableSourceLibraryItem(sourceItem));
  const warnings = describeImageSourceLibraryHandoffWarnings(sourceId, sourceItem, assetUrlKind, durableAsset);
  const documentState: ImageSourceLibraryHandoffState = sourceId && sourceItem
    ? 'source-linked-opened'
    : 'missing-source-id';
  const sourceLabel = sourceItem?.label ?? null;
  const generatedSnapshots = doc.layers
    .filter((layer) => isGeneratedImageSourceLayer(layer))
    .map(describeImageSourceLibraryLayerSnapshot)
    .sort(compareLayerSnapshots);
  const referenceSnapshots = doc.layers
    .filter((layer) => !isGeneratedImageSourceLayer(layer) && Boolean(getLayerSourceId(layer)))
    .map(describeImageSourceLibraryLayerSnapshot)
    .sort(compareLayerSnapshots);
  const snapshots = (doc.snapshots ?? [])
    .map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      width: snapshot.width,
      height: snapshot.height,
      layerCount: snapshot.layers.length,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const layerHandoff = {
    generated: generatedSnapshots.map((snapshot) => describeImageSourceLibraryLayerHandoff(snapshot, 'generated')),
    reference: referenceSnapshots.map((snapshot) => describeImageSourceLibraryLayerHandoff(snapshot, 'reference')),
    sourceLinked: referenceSnapshots.map((snapshot) => describeImageSourceLibraryLayerHandoff(snapshot, 'source-linked')),
  };
  const sourceSnapshotAvailability = describeImageSourceLibrarySourceSnapshotAvailability(
    sourceId,
    sourceItem,
    snapshots,
    [...generatedSnapshots, ...referenceSnapshots],
  );
  const externalAssetPackaging = describeImageSourceLibraryExternalAssetPackaging(sourceId, assetUrlKind, durableAsset);
  const sourceSnapshotRisk = describeImageSourceLibrarySourceSnapshotRisk({
    sourceSnapshotAvailability,
    sourceId,
    assetUrlKind,
    durableAsset,
    warnings,
  });
  const suiteHandoffBlockers = describeImageSourceLibrarySuiteHandoffBlockers(sourceId, warnings);
  const sourceDocumentSignature = [
    'image-source-library-source-document:v1',
    `document=${doc.id}`,
    `state=${documentState}`,
    `source=${sourceId ?? 'none'}`,
    `asset=${assetUrlKind}`,
    `durable=${durableAsset}`,
    `size=${doc.width}x${doc.height}`,
  ].join('|');
  const layerHandoffSignature = [
    'image-source-library-layer-handoff-set:v1',
    `generated=${layerHandoff.generated.map((summary) => summary.signature).join(';') || 'none'}`,
    `reference=${layerHandoff.reference.map((summary) => summary.signature).join(';') || 'none'}`,
    `sourceLinked=${layerHandoff.sourceLinked.map((summary) => summary.signature).join(';') || 'none'}`,
  ].join('|');

  return {
    descriptorId: 'image-source-library-handoff:v1',
    documentId: doc.id,
    documentTitle: doc.title,
    documentState,
    source: {
      sourceBinItemId: sourceId,
      label: sourceLabel,
      assetUrlKind,
      durableAsset,
      pixelWidth: sourceItem?.pixelWidth ?? null,
      pixelHeight: sourceItem?.pixelHeight ?? null,
    },
    readiness: {
      flow: describeSourceLibraryWorkspaceReadiness('flow', sourceId, durableAsset),
      video: describeSourceLibraryWorkspaceReadiness('video', sourceId, durableAsset),
      paper: describeSourceLibraryWorkspaceReadiness('paper', sourceId, durableAsset),
    },
    generatedSnapshots,
    referenceSnapshots,
    snapshots,
    warnings,
    preview: {
      id: `image-source-library-preview:${doc.id}:${sourceId ?? 'none'}`,
      label: doc.title || sourceLabel || 'Untitled Image',
      sizeLabel: `${doc.width}x${doc.height}`,
      sourceLabel,
    },
    layerHandoff,
    sourceSnapshotAvailability,
    sourceSnapshotRisk,
    externalAssetPackaging,
    suiteHandoffBlockers,
    sourceDocumentSignature,
    layerHandoffSignature,
    previewSignature: `image-source-library-handoff:v1:${JSON.stringify({
      documentId: doc.id,
      sourceId,
      documentState,
      size: `${doc.width}x${doc.height}`,
      layers: [...generatedSnapshots, ...referenceSnapshots].map((snapshot) => snapshot.layerId).sort(),
      snapshots: snapshots.map((snapshot) => snapshot.id),
      warnings: warnings.map((warning) => warning.code),
    })}`,
  };
}

export function describeSourceLinkedLayerReadiness({
  layer,
  sourceItems = [],
  snapshots = [],
}: DescribeSourceLinkedLayerReadinessInput): ImageSourceLinkedLayerReadinessDescriptor {
  const sourceId = getLayerSourceId(layer);
  const sourceItem = sourceId ? sourceItems.find((item) => item.id === sourceId) : undefined;
  const assetUrlKind = classifySourceLibraryAssetUrl(sourceItem?.assetUrl);
  const durableAsset = Boolean(sourceItem && isDurableSourceLibraryItem(sourceItem));
  const assetAvailable = Boolean(sourceItem?.assetUrl);
  const linkStatus = layer.metadata?.sourceLink?.status ?? (sourceId ? 'linked' : 'unlinked');
  const relinkHistory = layer.metadata?.sourceLink?.relinkHistory ?? [];
  const latestRelink = [...relinkHistory].sort((left, right) => {
    const timeDelta = right.at - left.at;
    if (timeDelta !== 0) return timeDelta;
    return right.sourceId.localeCompare(left.sourceId);
  })[0];
  const blockerCodes = describeSourceLinkedLayerReadinessBlockers(sourceId, sourceItem, assetUrlKind, durableAsset);
  const replacementReady = blockerCodes.length === 0;
  const sourceSnapshotPreservation = describeSourceLinkedLayerSnapshotPreservation(snapshots, sourceId);
  const snapshotAvailability = describeSourceLinkedLayerSnapshotAvailability(snapshots, Boolean(sourceId));
  const filterCount = layer.filters?.filter((filter) => filter.enabled !== false).length ?? 0;
  const hasLocalFilterMask = (layer.filters ?? []).some((filter) => filter.mask != null);
  const status = describeSourceLinkedLayerReadinessStatus(sourceId, linkStatus, blockerCodes);
  const relinkRepairState = describeSourceLinkedLayerRelinkRepairState(sourceId, blockerCodes);
  const replaceContentsCaveats = [
    'Replacement updates the linked bitmap and metadata; it does not rewrite the original Source Library asset.',
  ];
  const editOriginalCaveat = 'Edit Original is metadata-only: Sloom Studio can identify the Source Library item, but does not launch or round-trip a native external editor.';
  const smartFilterCaveats = [
    'Smart filters are retained as Sloom Studio layer filters only; native Photoshop Smart Filter stacks are not round-tripped.',
  ];
  const rasterizeCaveats = [
    'Rasterize detaches the Source Library relationship and bakes the current linked pixels into the layer.',
    ...(filterCount > 0 ? ['Smart filters flatten into pixels when the source-linked layer is rasterized.'] : []),
  ];
  const psdMetadataWarnings = describeSourceLinkedLayerPsdMetadataWarnings({
    filterCount,
    hasLocalFilterMask,
  });
  const warningCodes = describeSourceLinkedLayerWarningCodes(psdMetadataWarnings, relinkHistory.length);
  const handoffReadiness = describeSourceLinkedLayerHandoffReadiness({
    replacementReady,
    blockerCodes,
    filterCount,
  });
  const {
    batchReplaceContents,
    ...actionSuitability
  } = describeSourceLinkedLayerActionSuitability({
    replacementReady,
    blockerCodes,
    replaceContentsCaveats,
    editOriginalCaveat,
    smartFilterCaveats,
  });
  const standaloneState = describeSourceLinkedLayerStandaloneState({
    layer,
    sourceId,
    replacementReady,
    blockerCodes,
    editOriginalCaveat,
  });
  const refreshPolicy = describeSourceLinkedLayerRefreshPolicy({
    layer,
    sourceId,
    replacementReady,
    blockerCodes,
  });
  const suitePackage = describeSourceLinkedLayerSuitePackage({
    layer,
    sourceId,
    replacementReady,
    blockerCodes,
  });

  return {
    descriptorId: 'image-source-linked-layer-readiness:v1',
    layerId: layer.id,
    layerName: layer.name,
    status,
    source: {
      sourceBinItemId: sourceId,
      label: layer.metadata?.sourceLabel ?? layer.metadata?.sourceLink?.label ?? sourceItem?.label ?? null,
      formatLabel: layer.metadata?.sourceFormat ?? null,
      linkStatus,
      relinkHistoryCount: relinkHistory.length,
      ...(latestRelink ? { latestRelink } : {}),
      assetAvailable,
      assetUrlKind,
      durableAsset,
      pixelWidth: sourceItem?.pixelWidth ?? layer.metadata?.sourceLink?.width ?? layer.bitmap?.width ?? null,
      pixelHeight: sourceItem?.pixelHeight ?? layer.metadata?.sourceLink?.height ?? layer.bitmap?.height ?? null,
    },
    replaceContents: {
      ready: replacementReady,
      mode: replacementReady ? 'replace-linked-bitmap' : 'relink-required',
      preservesTransformMaskEffects: true,
      blockerCodes,
      caveats: replaceContentsCaveats,
    },
    refreshPolicy,
    editOriginal: {
      ready: false,
      mode: 'metadata-only',
      caveat: editOriginalCaveat,
    },
    rasterize: {
      ready: true,
      mode: 'detach-source-link',
      preservesSourceLink: false,
      preservesSourceSnapshotHistory: sourceSnapshotPreservation.preserved,
      caveats: rasterizeCaveats,
    },
    sourceSnapshotPreservation,
    sourceSnapshotAvailability: snapshotAvailability,
    relinkRepair: {
      ready: replacementReady,
      state: relinkRepairState,
      blockerCodes,
      blockers: describeSourceLinkedLayerReadinessBlockerMessages(sourceId, blockerCodes),
    },
    smartFilters: {
      filterCount,
      editableInHost: true,
      caveats: smartFilterCaveats,
    },
    psdSmartObject: {
      supported: false,
      reason: 'PSD Smart Object payload editing and native embedded-object roundtrip are unsupported; this descriptor tracks Source Library links only.',
    },
    psdMetadataWarnings,
    handoffReadiness,
    actionSuitability,
    batchSuitability: batchReplaceContents,
    suiteHandoffSafe: handoffReadiness.sourceBin.ready && handoffReadiness.video.ready,
    standaloneState,
    suitePackage,
    warningCodes,
    previewSignature: `image-source-linked-layer-readiness:v1:${JSON.stringify({
      layerId: layer.id,
      sourceId,
      linkStatus,
      assetAvailable,
      durableAsset,
      replaceReady: replacementReady,
      relinkReady: replacementReady,
      rasterizeReady: true,
      snapshotCount: snapshotAvailability.snapshotCount,
      snapshotState: snapshotAvailability.state,
      preservedSnapshotId: sourceSnapshotPreservation.latestSnapshotId ?? null,
      filterCount,
      blockers: blockerCodes,
      warningCodes,
      handoff: {
        sourceBin: handoffReadiness.sourceBin.ready,
        video: handoffReadiness.video.ready,
      },
      standalone: `${standaloneState.mode}:${standaloneState.quickOpenReady && standaloneState.quickSaveReady ? 'ready' : 'blocked'}`,
      suitePackage: `${suitePackage.sourceLibraryPackageState}:${suitePackage.ready ? 'ready' : 'blocked'}`,
      refreshPolicy: refreshPolicy.ready ? 'ready' : `blocked:${blockerCodes.join(',') || 'none'}`,
      batchSuitable: batchReplaceContents.suitable,
    })}`,
  };
}

function describeImageSourceLibraryLayerHandoff(
  snapshot: ImageSourceLibraryLayerSnapshot,
  kind: 'generated' | 'reference' | 'source-linked',
): ImageSourceLibraryLayerHandoffSummary {
  const ready = Boolean(snapshot.sourceBinItemId);
  const blockerCodes: ImageSourceLibraryHandoffWarningCode[] = ready ? [] : ['missing-source-id'];
  const signature = [
    'image-source-library-layer-handoff:v1',
    `kind=${kind}`,
    `layer=${snapshot.layerId}`,
    `source=${snapshot.sourceBinItemId ?? 'none'}`,
    `ready=${ready}`,
    `blockers=${blockerCodes.join(',') || 'none'}`,
  ].join('|');

  if (!ready) {
    return {
      kind,
      layerId: snapshot.layerId,
      layerName: snapshot.layerName,
      sourceBinItemId: null,
      ready: false,
      blockerCodes,
      signature,
      summary: `${snapshot.layerName} needs a durable Source Library source before suite handoff.`,
    };
  }
  return {
    kind,
    layerId: snapshot.layerId,
    layerName: snapshot.layerName,
    sourceBinItemId: snapshot.sourceBinItemId,
    ready: true,
    blockerCodes,
    signature,
    summary: kind === 'source-linked'
      ? `${snapshot.layerName} can refresh from Source Library item "${snapshot.sourceBinItemId}".`
      : `${snapshot.layerName} can hand off Source Library item "${snapshot.sourceBinItemId}".`,
  };
}

function describeSourceLinkedLayerReadinessStatus(
  sourceId: string | null,
  linkStatus: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']>['status'] | 'unlinked',
  blockers: ImageSourceLinkedLayerReadinessBlockerCode[],
): ImageSourceLinkedLayerReadinessStatus {
  if (!sourceId) return 'unlinked';
  if (linkStatus === 'missing' || blockers.includes('missing-source-asset')) return 'missing';
  if (blockers.length > 0) return 'blocked';
  return linkStatus === 'relinked' ? 'linked' : linkStatus;
}

function describeSourceLinkedLayerReadinessBlockers(
  sourceId: string | null,
  sourceItem: Pick<SourceBinLibraryItem, 'id' | 'kind' | 'assetUrl'> | undefined,
  assetUrlKind: ImageSourceLibraryAssetUrlKind,
  durableAsset: boolean,
): ImageSourceLinkedLayerReadinessBlockerCode[] {
  const blockers: ImageSourceLinkedLayerReadinessBlockerCode[] = [];
  if (!sourceId) return ['missing-source-id'];
  if (!sourceItem || !sourceItem.assetUrl) blockers.push('missing-source-asset');
  if (sourceItem && sourceItem.kind !== 'image') blockers.push('non-image-source-asset');
  if (sourceItem && assetUrlKind === 'blob-url' && !durableAsset) blockers.push('blob-only-source-url');
  return blockers;
}

function describeSourceLinkedLayerReadinessBlockerMessages(
  sourceId: string | null,
  blockers: ImageSourceLinkedLayerReadinessBlockerCode[],
): string[] {
  return blockers.map((blocker) => {
    if (blocker === 'missing-source-id') {
      return 'Layer has no Source Library id; relink it to a durable image source before replacement or suite handoff.';
    }
    if (blocker === 'missing-source-asset') {
      return sourceId
        ? `Source Library item "${sourceId}" is missing or has no asset URL; repair or relink it before replacement.`
        : 'Source Library asset is missing; repair or relink it before replacement.';
    }
    if (blocker === 'blob-only-source-url') {
      return sourceId
        ? `Source Library item "${sourceId}" only has a blob URL; persist it before replacement or suite handoff.`
        : 'Source Library item only has a blob URL; persist it before replacement or suite handoff.';
    }
    return sourceId
      ? `Source Library item "${sourceId}" is not an image asset; relink it to an image before replacement.`
      : 'Source Library item is not an image asset; relink it to an image before replacement.';
  });
}

function describeSourceLinkedLayerSnapshotAvailability(
  snapshots: Array<Pick<ImageSourceLibraryDocumentSnapshotSummary, 'id' | 'createdAt'>>,
  hasSourceId: boolean,
): ImageSourceLinkedLayerSnapshotAvailability {
  const latestSnapshot = [...snapshots].sort((left, right) => {
    const createdDelta = right.createdAt - left.createdAt;
    if (createdDelta !== 0) return createdDelta;
    return right.id.localeCompare(left.id);
  })[0];

  const available = hasSourceId && snapshots.length > 0;
  const state: ImageSourceLinkedLayerSnapshotAvailability['state'] = available
    ? 'available'
    : hasSourceId
      ? 'no-snapshots'
      : 'missing-source-id';

  return {
    available,
    snapshotCount: snapshots.length,
    ...(latestSnapshot ? { latestSnapshotId: latestSnapshot.id } : {}),
    state,
    ...(!available
      ? {
          caveat: hasSourceId
            ? 'No source snapshots are available for before/after repair review.'
            : 'Source snapshots require a durable Source Library id on the layer.',
        }
      : {}),
  };
}

function describeSourceLinkedLayerSnapshotPreservation(
  snapshots: Array<Pick<ImageSourceLibraryDocumentSnapshotSummary, 'id' | 'createdAt'> & {
    sourceIds?: string[];
    missingSourceIds?: string[];
  }>,
  sourceId: string | null,
): ImageSourceLinkedLayerSnapshotPreservation {
  const latestSnapshot = [...snapshots].sort((left, right) => {
    const createdDelta = right.createdAt - left.createdAt;
    if (createdDelta !== 0) return createdDelta;
    return right.id.localeCompare(left.id);
  })[0];
  const latestSnapshotSourceIds = latestSnapshot?.sourceIds ?? [];
  const snapshotTracksSourceIds = Array.isArray(latestSnapshot?.sourceIds);
  const sourceIds = dedupeStrings([...latestSnapshotSourceIds, ...(sourceId ? [sourceId] : [])]).sort((left, right) => left.localeCompare(right));
  const missingSourceIds = dedupeStrings([
    ...(latestSnapshot?.missingSourceIds ?? []),
    ...(sourceId && latestSnapshot && snapshotTracksSourceIds && !latestSnapshotSourceIds.includes(sourceId) ? [sourceId] : []),
  ]).sort((left, right) => left.localeCompare(right));

  return {
    preserved: Boolean(latestSnapshot),
    snapshotCount: snapshots.length,
    ...(latestSnapshot ? { latestSnapshotId: latestSnapshot.id } : {}),
    sourceIds,
    missingSourceIds,
  };
}

function describeSourceLinkedLayerRelinkRepairState(
  sourceId: string | null,
  blockers: readonly ImageSourceLinkedLayerReadinessBlockerCode[],
): ImageSourceLinkedLayerReadinessDescriptor['relinkRepair']['state'] {
  if (!sourceId || blockers.includes('missing-source-id')) return 'needs-source-id';
  if (blockers.includes('missing-source-asset')) return 'needs-source-asset';
  if (blockers.includes('blob-only-source-url')) return 'needs-durable-asset';
  if (blockers.includes('non-image-source-asset')) return 'needs-image-source';
  return 'ready';
}

function describeSourceLinkedLayerActionSuitability({
  replacementReady,
  blockerCodes,
  replaceContentsCaveats,
  editOriginalCaveat,
  smartFilterCaveats,
}: {
  replacementReady: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  replaceContentsCaveats: string[];
  editOriginalCaveat: string;
  smartFilterCaveats: string[];
}): ImageSourceLinkedLayerReadinessDescriptor['actionSuitability'] & {
  batchReplaceContents: ImageSourceLinkedLayerAutomationSuitability;
} {
  const replaceContents: ImageSourceLinkedLayerAutomationSuitability = {
    suitable: replacementReady,
    operation: 'replace-contents',
    blockerCodes,
    caveats: [...replaceContentsCaveats, ...smartFilterCaveats],
  };
  const relinkRepair: ImageSourceLinkedLayerAutomationSuitability = {
    suitable: replacementReady,
    operation: 'relink-repair',
    blockerCodes,
    caveats: replacementReady
      ? ['Relink repair can run because the linked source is present, durable, and image-backed.']
      : ['Relink repair needs a valid, durable image Source Library item before automation can proceed.'],
  };
  const editOriginal: ImageSourceLinkedLayerAutomationSuitability = {
    suitable: false,
    operation: 'edit-original',
    blockerCodes: [],
    caveats: [editOriginalCaveat],
  };
  const batchReplaceContents: ImageSourceLinkedLayerAutomationSuitability = {
    suitable: replacementReady,
    operation: 'batch-replace-contents',
    blockerCodes,
    caveats: replacementReady
      ? [
          'Batch replace is suitable for deterministic linked bitmap swaps; validate dimensions when relink history exists.',
          ...smartFilterCaveats,
        ]
      : ['Batch replace is blocked until every selected source-linked layer has a durable image Source Library asset.'],
  };

  return {
    replaceContents,
    relinkRepair,
    editOriginal,
    batchReplaceContents,
  };
}

function describeSourceLinkedLayerPsdMetadataWarnings({
  filterCount,
  hasLocalFilterMask,
}: {
  filterCount: number;
  hasLocalFilterMask: boolean;
}): ImageSourceLinkedLayerReadinessWarning[] {
  const warnings: ImageSourceLinkedLayerReadinessWarning[] = [{
    code: 'metadata-only-psd-smart-object',
    message: 'PSD export keeps source-link planning metadata but writes flattened pixels instead of native Smart Object data.',
  }];

  if (filterCount > 0) {
    warnings.push(
      {
        code: 'metadata-only-smart-filters',
        message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
      },
      ...(hasLocalFilterMask ? [{
        code: 'smart-filter-mask-unsupported' as const,
        message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
      }] : []),
    );
  }

  return warnings.sort((left, right) => left.code.localeCompare(right.code));
}

function describeSourceLinkedLayerWarningCodes(
  psdMetadataWarnings: readonly ImageSourceLinkedLayerReadinessWarning[],
  relinkHistoryCount: number,
): ImageSourceLinkedLayerReadinessWarningCode[] {
  const warningCodes = psdMetadataWarnings.map((warning) => warning.code);
  if (relinkHistoryCount > 0) {
    warningCodes.push('relinked-source-dimensions-should-be-verified');
  }
  return Array.from(new Set(warningCodes)).sort((left, right) => left.localeCompare(right));
}

function describeSourceLinkedLayerHandoffReadiness({
  replacementReady,
  blockerCodes,
  filterCount,
}: {
  replacementReady: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  filterCount: number;
}): ImageSourceLinkedLayerReadinessDescriptor['handoffReadiness'] {
  return {
    sourceBin: {
      target: 'source-bin',
      ready: replacementReady,
      blockerCodes: [...blockerCodes],
      caveats: replacementReady
        ? ['Source Bin repair and replace workflows stay metadata-backed; they do not mutate the original Source Library asset bytes.']
        : ['Source Bin relink and repair are blocked until the layer resolves to a durable image Source Library asset.'],
    },
    video: {
      target: 'video',
      ready: replacementReady,
      blockerCodes: [...blockerCodes],
      caveats: replacementReady
        ? [
            'Video handoff receives flattened pixels plus Source Library provenance; native Smart Object editing is unavailable.',
            ...(filterCount > 0 ? ['Smart filters are flattened for Video handoff and PSD-native Smart Filter parity is unavailable.'] : []),
          ]
        : ['Video handoff is blocked until the layer resolves to a durable image Source Library asset.'],
    },
  };
}

function describeSourceLinkedLayerStandaloneState({
  layer,
  sourceId,
  replacementReady,
  blockerCodes,
  editOriginalCaveat,
}: {
  layer: ImageLayer;
  sourceId: string | null;
  replacementReady: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
  editOriginalCaveat: string;
}): ImageSourceLinkedLayerStandaloneStateDescriptor {
  const quickExportReady = Boolean(layer.bitmap);
  const destructiveOverwriteWarning: ImageSourceLinkedLayerStandaloneDestructiveOverwriteWarning = replacementReady
    ? 'required-before-source-overwrite'
    : 'blocked-until-source-relinked';
  const caveats = replacementReady
    ? [
        'Save Over source-linked layers only after an explicit destructive overwrite confirmation.',
        'Edit Original is metadata-only and does not launch a native external editor.',
      ]
    : [
        'Save Over is blocked until the layer resolves to a durable Source Library image source.',
        editOriginalCaveat,
      ];

  return {
    mode: 'standalone-quick-edit',
    quickOpenReady: replacementReady,
    quickSaveReady: replacementReady,
    quickExportReady,
    destructiveOverwriteWarning,
    nativeExternalEditorRoundtrip: false,
    signedInstallerIdentityClaimed: false,
    blockerCodes: [...blockerCodes],
    caveats,
    signature: [
      'image-source-linked-layer-standalone:v1',
      `layer=${layer.id}`,
      `source=${sourceId ?? 'none'}`,
      `open=${replacementReady}`,
      `save=${replacementReady}`,
      `export=${quickExportReady}`,
      `overwriteWarning=${destructiveOverwriteWarning}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
      'nativeRoundtrip=false',
      'signedIdentity=false',
    ].join('|'),
  };
}

function describeSourceLinkedLayerRefreshPolicy({
  layer,
  sourceId,
  replacementReady,
  blockerCodes,
}: {
  layer: ImageLayer;
  sourceId: string | null;
  replacementReady: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
}): ImageSourceLinkedLayerRefreshPolicyDescriptor {
  const blockers = describeSourceLinkedLayerRefreshBlockers(sourceId, blockerCodes);
  const requiresRelink = blockers.length > 0;

  return {
    mode: 'source-linked-refresh',
    operation: 'refresh-linked-bitmap',
    ready: replacementReady,
    sourceBinItemId: sourceId,
    requiresRelink,
    destructiveSaveBlocked: requiresRelink,
    blockerCodes: [...blockerCodes],
    blockers,
    signature: [
      'image-source-linked-layer-refresh-policy:v1',
      `layer=${layer.id}`,
      `source=${sourceId ?? 'none'}`,
      `ready=${replacementReady}`,
      `requiresRelink=${requiresRelink}`,
      `destructiveSaveBlocked=${requiresRelink}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
    ].join('|'),
  };
}

function describeSourceLinkedLayerRefreshBlockers(
  sourceId: string | null,
  blockerCodes: readonly ImageSourceLinkedLayerReadinessBlockerCode[],
): ImageSourceLinkedLayerRefreshBlocker[] {
  return blockerCodes.map((code) => ({
    code,
    sourceId,
    message: describeSourceLinkedLayerRefreshBlockerMessage(sourceId, code),
  }));
}

function describeSourceLinkedLayerRefreshBlockerMessage(
  sourceId: string | null,
  blockerCode: ImageSourceLinkedLayerReadinessBlockerCode,
): string {
  if (blockerCode === 'missing-source-id') {
    return 'Layer has no Source Library id; refresh is blocked until it is relinked.';
  }
  if (blockerCode === 'missing-source-asset') {
    return sourceId
      ? `Source Library item "${sourceId}" is missing or has no asset URL; refresh is blocked until it is relinked.`
      : 'Source Library asset is missing; refresh is blocked until it is relinked.';
  }
  if (blockerCode === 'blob-only-source-url') {
    return sourceId
      ? `Source Library item "${sourceId}" only has a blob URL; persist it before refreshing this layer.`
      : 'Source Library item only has a blob URL; persist it before refreshing this layer.';
  }
  return sourceId
    ? `Source Library item "${sourceId}" is not an image asset; refresh is blocked until it is relinked to an image.`
    : 'Source Library item is not an image asset; refresh is blocked until it is relinked to an image.';
}

function describeSourceLinkedLayerSuitePackage({
  layer,
  sourceId,
  replacementReady,
  blockerCodes,
}: {
  layer: ImageLayer;
  sourceId: string | null;
  replacementReady: boolean;
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[];
}): ImageSourceLinkedLayerSuitePackageDescriptor {
  const sourceLibraryPackageState = describeSourceLinkedLayerSuitePackageState(blockerCodes);
  const packagedSourceIds = replacementReady && sourceId ? [sourceId] : [];
  const missingSourceIds = !replacementReady && sourceId ? [sourceId] : [];
  const targets = {
    flow: describeSourceLinkedLayerSuitePackageTarget('flow', replacementReady, blockerCodes),
    video: describeSourceLinkedLayerSuitePackageTarget('video', replacementReady, blockerCodes),
    paper: describeSourceLinkedLayerSuitePackageTarget('paper', replacementReady, blockerCodes),
  };
  const caveats = replacementReady
    ? ['Suite handoff packages the durable Source Library source beside flattened Image pixels and Sloom Studio metadata.']
    : ['Resolve source-linked layer blockers before handing source-library packages to Flow, Video, or Paper.'];

  return {
    mode: 'source-library-package-handoff',
    ready: replacementReady,
    sourceLibraryPackageState,
    packagedSourceIds,
    missingSourceIds,
    blockerCodes: [...blockerCodes],
    targets,
    caveats,
    signature: [
      'image-source-linked-layer-suite-package:v1',
      `layer=${layer.id}`,
      `source=${sourceId ?? 'none'}`,
      `state=${sourceLibraryPackageState}`,
      `ready=${replacementReady}`,
      `packaged=${packagedSourceIds.join(',') || 'none'}`,
      `missing=${missingSourceIds.join(',') || 'none'}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
      `targets=flow:${targets.flow.ready},video:${targets.video.ready},paper:${targets.paper.ready}`,
    ].join('|'),
  };
}

function describeSourceLinkedLayerSuitePackageState(
  blockerCodes: readonly ImageSourceLinkedLayerReadinessBlockerCode[],
): ImageSourceLinkedLayerSuitePackageState {
  if (blockerCodes.includes('missing-source-id')) return 'missing-source-id';
  if (blockerCodes.includes('missing-source-asset')) return 'missing-source-asset';
  if (blockerCodes.includes('blob-only-source-url')) return 'blob-url-needs-packaging';
  if (blockerCodes.includes('non-image-source-asset')) return 'non-image-source-asset';
  return 'durable-source-library-asset';
}

function describeSourceLinkedLayerSuitePackageTarget(
  target: ImageSourceLinkedLayerSuitePackageTargetReadiness['target'],
  ready: boolean,
  blockerCodes: ImageSourceLinkedLayerReadinessBlockerCode[],
): ImageSourceLinkedLayerSuitePackageTargetReadiness {
  if (!ready) {
    return {
      target,
      ready: false,
      blockerCodes: [...blockerCodes],
      caveats: [`${describeSuitePackageTargetLabel(target)} handoff is blocked until this layer resolves to a durable Source Library image package.`],
    };
  }

  const caveatByTarget: Record<ImageSourceLinkedLayerSuitePackageTargetReadiness['target'], string> = {
    flow: 'Flow handoff uses the packaged Source Library asset plus flattened layer pixels; native Smart Object editing stays unavailable.',
    video: 'Video handoff uses flattened pixels plus packaged Source Library provenance; native Smart Object editing stays unavailable.',
    paper: 'Paper handoff places flattened pixels while preserving packaged Source Library provenance for relink review.',
  };

  return {
    target,
    ready: true,
    blockerCodes: [],
    caveats: [caveatByTarget[target]],
  };
}

function describeSuitePackageTargetLabel(
  target: ImageSourceLinkedLayerSuitePackageTargetReadiness['target'],
): string {
  if (target === 'flow') return 'Flow';
  if (target === 'video') return 'Video';
  return 'Paper';
}

export function createSourceBackedImageDocumentShell(
  item: Pick<SourceBinLibraryItem, 'id' | 'label'>,
  options: Pick<CreateSourceImageDocumentOptions, 'fallbackWidth' | 'fallbackHeight'> = {},
): ImageDocument {
  return createEmptyImageDocument({
    id: `doc-${item.id}`,
    title: item.label ?? 'Untitled',
    width: options.fallbackWidth ?? 800,
    height: options.fallbackHeight ?? 600,
    sourceBinItemId: item.id,
  });
}

export function createNewBlankDocument(options: {
  title: string;
  width: number;
  height: number;
  background: string;
}): ImageDocument {
  const docId = `doc-new-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const docWidth = options.width || 800;
  const docHeight = options.height || 600;

  const bitmap = createBitmap(docWidth, docHeight);
  if (options.background !== 'transparent') {
    fillBitmap(bitmap, options.background);
  }

  const layer: ImageLayer = {
    id: `layer-bg-${Date.now()}`,
    name: options.background !== 'transparent' ? 'Background' : 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };

  return {
    id: docId,
    title: options.title || 'Untitled',
    width: docWidth,
    height: docHeight,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: true,
    snapshots: [],
  };
}

/**
 * Build a new single-layer document sized exactly to a bitmap, with the layer at
 * the origin (Photoshop "New from clipboard" behaviour).
 */
function buildSingleLayerImageDocumentFromBitmap(bitmap: LayerBitmap, title: string): ImageDocument {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const layer: ImageLayer = {
    id: `layer-clip-${stamp}`,
    name: title,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
  return {
    id: `doc-clip-${stamp}`,
    title,
    width: bitmap.width,
    height: bitmap.height,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: true,
    snapshots: [],
  };
}

function createNativeHighBitImageDocument(
  native: NativeHighBitImport,
  params: {
    id: string;
    title: string;
    sourceBinItemId?: string;
    sourceLabel?: string;
    sourceMimeType?: string;
    sourceUrl?: string;
    sourceBitDepth?: 8 | 16 | 32;
  },
  sourceFormat: string,
): ImageDocument {
  const shell = createEmptyImageDocument({
    id: params.id,
    title: params.title,
    width: native.width,
    height: native.height,
    sourceBinItemId: params.sourceBinItemId,
  });
  const layer: ImageLayer = {
    id: `${params.id}-layer-0`,
    name: params.sourceLabel ?? params.title,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: native.bitmap,
    bitmapVersion: 0,
    pixels: native.pixels,
    pixelsVersion: 0,
    mask: null,
    metadata: {
      smartLinkedSourceId: params.sourceBinItemId,
      sourceLabel: params.sourceLabel,
      sourceFormat,
      sourceMimeType: params.sourceMimeType,
      sourceLink: params.sourceBinItemId ? {
        id: params.sourceBinItemId,
        label: params.sourceLabel,
        width: native.width,
        height: native.height,
        status: 'linked',
        relinkHistory: [],
      } : undefined,
    },
  };
  return {
    ...shell,
    width: native.width,
    height: native.height,
    layers: [layer],
    activeLayerId: layer.id,
    metadata: {
      sourceFormat,
      sourceMimeType: params.sourceMimeType,
      sourceBitDepth: params.sourceBitDepth ?? (native.depth === 'u16' ? 16 : 32),
      bitDepth: native.depth === 'u16' ? 16 : 32,
      warnings: [],
    },
  };
}

/** Read the first image on the OS clipboard into a bitmap, or null if none/denied. */
async function readOsClipboardImageBitmap(): Promise<LayerBitmap | null> {
  // Prefer Electron's native clipboard: the async web Clipboard API is
  // permission-gated and frequently denied for images inside Electron (its
  // default permission handler rejects `clipboard-read`), which previously
  // surfaced as a false "no image on the clipboard".
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.readClipboardImage) {
    try {
      const result = await bridge.readClipboardImage();
      if (typeof result === 'string' && result.startsWith('data:image/')) {
        return await bitmapFromUrl(result);
      }
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        console.warn('[clipboard] native readClipboardImage failed:', result.error);
      }
    } catch (error) {
      console.warn('[clipboard] native readClipboardImage threw:', error);
    }
  }

  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((candidate) => candidate.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const imageBitmap = await createImageBitmap(blob);
      try {
        const bitmap = createBitmap(imageBitmap.width, imageBitmap.height);
        bitmap.getContext('2d')?.drawImage(imageBitmap, 0, 0);
        return bitmap;
      } finally {
        imageBitmap.close();
      }
    }
    console.warn('[clipboard] no image/* item found on the clipboard; available types were read but none matched.');
  } catch (error) {
    // Clipboard read can be denied or unsupported; surface the reason so a
    // false "no image" is debuggable instead of silently swallowed.
    console.warn('[clipboard] navigator.clipboard.read failed:', error);
  }
  return null;
}

/**
 * Create a new document from clipboard image content. Prefers the in-app
 * clipboard (last Copy within the Image editor), then falls back to the OS
 * clipboard. Returns null when no image content is available.
 */
export async function createImageDocumentFromClipboard(
  options: { title?: string } = {},
): Promise<ImageDocument | null> {
  const bitmap = getImageClipboardBitmap() ?? (await readOsClipboardImageBitmap());
  if (!bitmap) return null;
  return buildSingleLayerImageDocumentFromBitmap(bitmap, options.title ?? 'Clipboard');
}

export async function createImageDocumentFromFile(
  file: File,
  options: CreateLocalImageDocumentOptions = {},
): Promise<ImageDocument> {
  const id = options.id ?? `local-image-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const title = stripImageFileExtension(file.name) || 'Untitled Image';
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sourceMimeType = getImageMimeTypeFromRegistry(file.name, file.type);
  const policy = detectSourceImageFormatPolicy({ fileName: file.name, mimeType: sourceMimeType, bytes });
  const policyDescription = describeSourceImageFormatPolicy(policy);
  const params = {
    id,
    title,
    sourceLabel: file.name,
    sourceMimeType,
    sourceBitDepth: normalizeDetectedSourceBitDepth(policyDescription.bitDepth.sourceBitsPerChannel),
  };

  const native = decodeNativeHighBitImport(bytes, policy);
  if (native) return createNativeHighBitImageDocument(native, params, policyDescription.formatLabel);

  const rejectionMessage = getGenericImageOpenRejectionMessage(policy);
  if (rejectionMessage) throw new Error(rejectionMessage);
  if (policy.kind === 'tiff') return createTiffImageDocument(buffer, params);
  if (policy.kind === 'xcf') return createXcfImageDocument(buffer, params);
  if (policy.kind === 'svg') return createSvgImageDocument(await file.text(), params);
  if (policy.kind === 'gif') return createRasterImageDocumentFromBlob(file, params, policyDescription.warnings);
  if (policy.kind === 'psd') throw new Error('Layered PSD files must be opened with the Image workspace Open PSD control. PSB is not supported.');
  return createRasterImageDocumentFromBlob(file, params, policyDescription.warnings);
}

/**
 * Resolve a directly fetchable URL for a source item's image bytes.
 *
 * In a served LAN (phone-host) session the synced item's `assetUrl` is a phone-local URL
 * (`blob:` / `signal-loom-asset://`) that the served desktop browser cannot reach — a raw
 * `fetch()` of it throws "NetworkError when attempting to fetch resource". Route through the
 * authenticated host API instead and hand back a same-origin data URL.
 *
 * Primary path: {@link fetchRemoteHostSourceAssetDataUrl} asks the host to resolve the item by its
 * source-item id through the universal bounded source-asset lifecycle, so it serves *every* backing the phone
 * knows — native-file- and scratch-backed items included, which carry no `assetId` and so could never
 * be reached via `/asset/:id`. That is the actual fix for the open-NetworkError. The `/asset/:id`
 * lookup (via the bounded asset-store data-URL loader) is kept as a fallback for IndexedDB/assetId-backed items
 * and for older hosts that predate the `/source-asset/:id` endpoint. Desktop / Electron / native
 * sessions are not remote LAN clients, so they fall straight through to the item's own `assetUrl`.
 */
async function resolveSourceItemFetchUrl(item: SourceBinLibraryItem): Promise<string | undefined> {
  if (isRemoteLanClient()) {
    try {
      const hosted = await fetchRemoteHostSourceAssetDataUrl(item.id);
      if (hosted) return hosted;
    } catch {
      // Fall through to the assetId / item.assetUrl paths below.
    }
    const lookupId = item.assetId ?? parseSignalLoomAssetId(item.assetUrl);
    if (lookupId) {
      try {
        const payload = await loadImportedAssetAsDataUrl(lookupId);
        if (payload?.dataUrl) return payload.dataUrl;
      } catch {
        // Fall through to the item's own assetUrl below.
      }
    }
  }
  return item.assetUrl;
}

export async function createImageDocumentFromSourceItem(
  item: SourceBinLibraryItem,
  options: CreateSourceImageDocumentOptions = {},
): Promise<ImageDocument> {
  const shell = createSourceBackedImageDocumentShell(item, options);
  if (item.kind !== 'image' || !item.assetUrl) return shell;

  const fetchUrl = await resolveSourceItemFetchUrl(item);
  if (!fetchUrl) return shell;

  if (!options.loadBitmap) {
    const response = await fetch(fetchUrl);
    if (!response.ok) throw new Error(`Failed to fetch image source: ${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const sourceMimeType = getImageMimeTypeFromRegistry(item.label, item.mimeType || blob.type);
    const policy = detectSourceImageFormatPolicy({ fileName: item.label, mimeType: sourceMimeType, bytes });
    const policyDescription = describeSourceImageFormatPolicy(policy);
    const params = {
      id: `doc-${item.id}`,
      title: item.label ?? 'Untitled',
      sourceBinItemId: item.id,
      sourceLabel: item.label,
      sourceMimeType,
      sourceUrl: item.assetUrl,
      sourceBitDepth: normalizeDetectedSourceBitDepth(policyDescription.bitDepth.sourceBitsPerChannel),
    };

    const native = decodeNativeHighBitImport(bytes, policy);
    if (native) return createNativeHighBitImageDocument(native, params, policyDescription.formatLabel);

    const rejectionMessage = getGenericImageOpenRejectionMessage(policy);
    if (rejectionMessage) throw new Error(rejectionMessage);
    if (policy.kind === 'tiff') return createTiffImageDocument(buffer, params);
    if (policy.kind === 'xcf') return createXcfImageDocument(buffer, params);
    if (policy.kind === 'svg') return createSvgImageDocument(await blob.text(), params);
    if (policy.kind === 'gif') return createRasterImageDocumentFromBlob(blob, params, policyDescription.warnings);
    if (policy.kind === 'psd') throw new Error('Layered PSD files must be opened with the Image workspace Open PSD control. PSB is not supported.');
    return createRasterImageDocumentFromBlob(blob, params, policyDescription.warnings);
  }

  {
    // A caller-supplied bitmap loader is a legacy proxy escape hatch. Fetch the
    // source bytes first so a native high-bit source cannot silently bypass the
    // reviewed authority codecs; ordinary 8-bit sources still use the caller's
    // existing loader and preserve its behavior.
    try {
      const response = await fetch(fetchUrl);
      if (response.ok) {
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const sourceMimeType = getImageMimeTypeFromRegistry(item.label, item.mimeType || blob.type);
        const policy = detectSourceImageFormatPolicy({ fileName: item.label, mimeType: sourceMimeType, bytes });
        const policyDescription = describeSourceImageFormatPolicy(policy);
        const params = {
          id: `doc-${item.id}`,
          title: item.label ?? 'Untitled',
          sourceBinItemId: item.id,
          sourceLabel: item.label,
          sourceMimeType,
          sourceUrl: item.assetUrl,
          sourceBitDepth: normalizeDetectedSourceBitDepth(policyDescription.bitDepth.sourceBitsPerChannel),
        };
        const native = decodeNativeHighBitImport(bytes, policy);
        if (native) return createNativeHighBitImageDocument(native, params, policyDescription.formatLabel);
      }
    } catch (error) {
      const hinted = detectSourceImageFormatPolicy({ fileName: item.label, mimeType: item.mimeType });
      if (hinted.kind === 'exr' || hinted.kind === 'tiff' || hinted.highBitDepth) {
        throw new Error(`Native high-bit source could not be opened safely: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const bitmap = await (options.loadBitmap ?? bitmapFromUrl)(fetchUrl);
  const layer: ImageLayer = {
    id: `layer-${sanitizeSourceId(item.id)}`,
    name: item.label ?? 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 0,
    mask: null,
    metadata: {
      smartLinkedSourceId: item.id,
      sourceLabel: item.label,
      sourceLink: createSourceLinkMetadata(item, bitmap),
    },
  };

  return {
    ...shell,
    width: bitmap.width,
    height: bitmap.height,
    layers: [layer],
    activeLayerId: layer.id,
  };
}

export async function loadSourceLinkedLayerBitmap(
  item: SourceBinLibraryItem,
  loadBitmap: (url: string) => Promise<LayerBitmap> = bitmapFromUrl,
): Promise<LayerBitmap> {
  if (item.kind !== 'image' || !item.assetUrl) {
    throw new Error('Source-linked layer can only update from an image Source Bin item with an asset URL.');
  }
  const fetchUrl = (await resolveSourceItemFetchUrl(item)) ?? item.assetUrl;
  return loadBitmap(fetchUrl);
}

export function replaceSourceLinkedLayerBitmap(
  layer: ImageLayer,
  item: SourceBinLibraryItem,
  bitmap: LayerBitmap,
): ImageLayer {
  const previous = layer.metadata?.sourceLink;
  const history = [
    ...(previous?.relinkHistory ?? []),
    ...(previous?.id && previous.id !== item.id
      ? [{ sourceId: previous.id, label: previous.label, at: Date.now() }]
      : []),
  ];
  return {
    ...layer,
    name: layer.name || item.label || 'Linked Source',
    type: 'image',
    bitmap,
    bitmapVersion: layer.bitmapVersion + 1,
    metadata: {
      ...layer.metadata,
      smartLinkedSourceId: item.id,
      sourceLabel: item.label,
      sourceLink: {
        id: item.id,
        label: item.label,
        width: bitmap.width,
        height: bitmap.height,
        status: previous?.id && previous.id !== item.id ? 'relinked' : 'linked',
        relinkHistory: history,
      },
    },
  };
}

export function markSourceLinkedLayerMissing(layer: ImageLayer): ImageLayer {
  const sourceId = layer.metadata?.smartLinkedSourceId ?? layer.metadata?.sourceLink?.id;
  if (!sourceId) return layer;
  return {
    ...layer,
    metadata: {
      ...layer.metadata,
      smartLinkedSourceId: sourceId,
      sourceLink: {
        id: sourceId,
        label: layer.metadata?.sourceLabel ?? layer.metadata?.sourceLink?.label,
        width: layer.metadata?.sourceLink?.width ?? layer.bitmap?.width,
        height: layer.metadata?.sourceLink?.height ?? layer.bitmap?.height,
        status: 'missing',
        relinkHistory: layer.metadata?.sourceLink?.relinkHistory ?? [],
      },
    },
  };
}

export function createSourceLinkMetadata(
  item: Pick<SourceBinLibraryItem, 'id' | 'label'>,
  bitmap: Pick<LayerBitmap, 'width' | 'height'>,
): NonNullable<ImageLayer['metadata']>['sourceLink'] {
  return {
    id: item.id,
    label: item.label,
    width: bitmap.width,
    height: bitmap.height,
    status: 'linked',
    relinkHistory: [],
  };
}

function describeSourceBinItemOpenWorkflow(
  item: Pick<SourceBinLibraryItem, 'id' | 'label' | 'kind' | 'assetUrl' | 'mimeType'>,
  bytes: Uint8Array | undefined,
): ImageSourceOpenWorkflowDescriptor {
  const policy = detectSourceImageFormatPolicy({ fileName: item.label, mimeType: item.mimeType, bytes });
  const rawDevelopFirst = describeCameraRawOpenMetadata(policy, item.label);
  const policyFields = getOpenPolicyDescriptorFields(policy);
  const nativeRoundtrip = getOpenPolicyNativeRoundtrip(policy, true);
  const missingSource = item.kind !== 'image' || !item.assetUrl;
  const opensEditableDocument = !missingSource && canOpenPolicyAsEditableDocument(policy);
  const warnings = getOpenPolicyWarnings(policy);

  if (missingSource) {
    warnings.unshift({
      code: 'missing-source-link',
      sourceId: item.id,
      message: `Source Library item "${item.id}" is missing an image asset URL, so the quick-edit document can only open as an empty fallback shell.`,
    });
  }

  return {
    workflowKind: 'quick-edit',
    mode: 'source-bin-document',
    sourceBinItemId: item.id,
    sourceLabel: item.label,
    ...policyFields,
    opensEditableDocument,
    keepsSourceLink: opensEditableDocument,
    rawDevelopFirst,
    nativeRoundtrip: nativeRoundtrip === 'metadata-only' || nativeRoundtrip === 'unsupported'
      ? nativeRoundtrip
      : 'source-linked',
    warnings,
  };
}

function describeLocalFileOpenWorkflow(
  fileName: string,
  mimeType: string | undefined,
  bytes: Uint8Array | undefined,
): ImageSourceOpenWorkflowDescriptor {
  const policy = detectSourceImageFormatPolicy({ fileName, mimeType, bytes });
  const rawDevelopFirst = describeCameraRawOpenMetadata(policy, fileName);
  const policyFields = getOpenPolicyDescriptorFields(policy);
  const nativeRoundtrip = getOpenPolicyNativeRoundtrip(policy, false);

  return {
    workflowKind: 'export-only',
    mode: 'local-file-document',
    sourceBinItemId: undefined,
    sourceLabel: fileName,
    ...policyFields,
    rawDevelopFirst,
    opensEditableDocument: canOpenPolicyAsEditableDocument(policy),
    keepsSourceLink: false,
    nativeRoundtrip,
    warnings: getOpenPolicyWarnings(policy),
  };
}

function describeSourceLinkedLayerOpenWorkflow(
  layer: ImageLayer,
  item: Pick<SourceBinLibraryItem, 'id' | 'label' | 'kind' | 'assetUrl'> | undefined,
): ImageSourceOpenWorkflowDescriptor {
  const sourceId = layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? item?.id;
  const sourceLabel = layer.metadata?.sourceLabel ?? layer.metadata?.sourceLink?.label ?? item?.label;
  const missingSource = !sourceId
    || layer.metadata?.sourceLink?.status === 'missing'
    || Boolean(item && (item.kind !== 'image' || !item.assetUrl));
  const warnings: ImageSourceOpenWorkflowWarning[] = [];

  if (missingSource) {
    warnings.push({
      code: 'missing-source-link',
      sourceId,
      message: sourceId
        ? `Source-linked layer "${layer.name || layer.id}" points at missing Source Library item "${sourceId}" and must be relinked before refreshing.`
        : `Source-linked layer "${layer.name || layer.id}" does not have a source id and must be relinked before refreshing.`,
    });
  }
  const canRefreshSource = Boolean(sourceId) && !missingSource;

  return {
    workflowKind: 'source-linked',
    mode: 'source-linked-layer-refresh',
    sourceBinItemId: sourceId,
    sourceLabel,
    sourceMimeType: layer.metadata?.sourceMimeType,
    formatLabel: layer.metadata?.sourceFormat,
    formatLimitations: [],
    opensEditableDocument: canRefreshSource,
    keepsSourceLink: canRefreshSource,
    rawDevelopFirst: describeSourceLinkedRawMetadata(sourceId, sourceLabel, item),
    nativeRoundtrip: canRefreshSource ? 'source-linked' : 'unsupported',
    warnings,
  };
}

function describeSourceLinkedRawMetadata(
  sourceId: string | null | undefined,
  sourceLabel: string | undefined,
  item?: Pick<SourceBinLibraryItem, 'id' | 'label' | 'mimeType' | 'kind' | 'assetUrl'>,
): CameraRawDevelopFirstMetadata | undefined {
  if (!sourceId) return undefined;
  const resolvedSourceLabel = sourceLabel ?? item?.label;
  if (!resolvedSourceLabel) return undefined;
  const sourceMimeType = item?.mimeType;
  const policy = detectSourceImageFormatPolicy({
    fileName: resolvedSourceLabel,
    mimeType: sourceMimeType,
  });

  return describeCameraRawOpenMetadata(policy, resolvedSourceLabel);
}

function describeCameraRawOpenMetadata(
  policy: SourceImageFormatPolicy,
  sourceLabel: string | undefined,
): CameraRawDevelopFirstMetadata | undefined {
  if (policy.kind !== 'cameraRaw') return undefined;
  if (!sourceLabel) return undefined;
  return describeCameraRawDevelopFirstMetadata({
    sourceLabel,
    sourceMimeType: policy.sourceMimeType,
    sourceExtension: policy.sourceExtension,
  });
}

function canOpenPolicyAsEditableDocument(policy: SourceImageFormatPolicy): boolean {
  const description = describeSourceImageFormatPolicy(policy);
  return description.compatibility.importSupported
    && policy.kind !== 'psb'
    && policy.kind !== 'cameraRaw';
}

function getOpenPolicyNativeRoundtrip(
  policy: SourceImageFormatPolicy,
  sourceLinked: boolean,
): ImageSourceOpenNativeRoundtrip {
  if (policy.kind === 'psd') return 'metadata-only';
  if (!canOpenPolicyAsEditableDocument(policy)) return 'unsupported';
  return sourceLinked ? 'source-linked' : 'none';
}

function getOpenPolicyWarnings(policy: SourceImageFormatPolicy): ImageSourceOpenWorkflowWarning[] {
  const description = describeSourceImageFormatPolicy(policy);
  const nativeRoundtrip = getOpenPolicyNativeRoundtrip(policy, false);
  const warnings: ImageSourceOpenWorkflowWarning[] = [];
  const isRawDevelopmentRequired = description.warningCodes.includes('camera-raw-import-unsupported');

  if (isRawDevelopmentRequired) {
    warnings.push({
      code: 'raw-development-required',
      formatLabel: description.formatLabel,
      sourceMimeType: description.sourceMimeType,
      message: description.warnings[0]
        ?? 'Develop RAW files in an external RAW processor before opening this document in Image.',
    });
  }

  if (description.warningCodes.includes('high-bit-depth-raster-loss')) {
    warnings.push({
      code: 'high-bit-depth-source-loss',
      formatLabel: description.formatLabel,
      sourceMimeType: description.sourceMimeType,
      message: description.bitDepth.warning
        ?? description.warnings[0]
        ?? `${description.formatLabel} source is reduced to 8-bit RGBA pixels by browser decoding.`,
    });
  }

  if (nativeRoundtrip === 'metadata-only' || nativeRoundtrip === 'unsupported') {
    if (isRawDevelopmentRequired) {
      return warnings;
    }
    warnings.push({
      code: 'unsupported-native-roundtrip',
      formatLabel: description.formatLabel,
      sourceMimeType: description.sourceMimeType,
      message: nativeRoundtrip === 'metadata-only'
        ? `${description.formatLabel} import/export is metadata-only for some native constructs; verify editable layer semantics before treating it as a native roundtrip.`
        : description.warnings[0] ?? `${description.formatLabel} cannot be opened as a native editable Image document.`,
    });
  }

  return warnings;
}

function getOpenPolicyDescriptorFields(policy: SourceImageFormatPolicy): Pick<
  ImageSourceOpenWorkflowDescriptor,
  'formatLabel' | 'sourceMimeType' | 'sourceExtension' | 'importStatus' | 'bitDepth' | 'formatLimitations'
> {
  const description = describeSourceImageFormatPolicy(policy);
  return {
    formatLabel: description.formatLabel,
    sourceMimeType: description.sourceMimeType,
    sourceExtension: description.sourceExtension,
    importStatus: description.importStatus,
    bitDepth: description.bitDepth,
    formatLimitations: dedupeStrings([...description.sourceFormatLimits, ...description.limitations]),
  };
}

function getSourceDocumentRoundtripRisk(
  workflow: ImageSourceOpenWorkflowDescriptor,
  externalDevelopmentRequired: boolean,
): ImageSourceDocumentRoundtripRisk {
  if (externalDevelopmentRequired || workflow.nativeRoundtrip === 'unsupported') return 'unsupported';
  if (workflow.nativeRoundtrip === 'metadata-only') return 'metadata-only';
  if (workflow.nativeRoundtrip === 'source-linked') return 'source-linked';
  return 'none';
}

function describeSourceDocumentRoundtripCaveats(
  workflow: ImageSourceOpenWorkflowDescriptor,
  externalDevelopmentRequired: boolean,
): string[] {
  if (externalDevelopmentRequired) {
    return [
      'Camera Raw sources cannot open as editable Image documents until developed externally.',
      'No RAW demosaic, camera-profile, or non-destructive develop settings are preserved in Image source documents.',
    ];
  }
  if (workflow.nativeRoundtrip === 'metadata-only') {
    return [
      `${workflow.formatLabel ?? 'Source'} native editable constructs may be retained only as Sloom Studio metadata.`,
    ];
  }
  if (workflow.nativeRoundtrip === 'unsupported') {
    return [
      `${workflow.formatLabel ?? 'Source'} cannot round-trip as an editable Image source document with the current import policy.`,
    ];
  }
  if (workflow.nativeRoundtrip === 'source-linked') {
    return [
      'Source-linked edits preserve the Source Library relationship, but exports are still Image derivatives.',
    ];
  }
  return [];
}

function describeSourceDocumentSuiteHandoffCaveats(externalDevelopmentRequired: boolean): string[] {
  if (!externalDevelopmentRequired) return [];
  return [
    'Hand off developed TIFF, PSD, PNG, or JPEG derivatives to Flow, Video, or Paper.',
    'Keep the RAW source as provenance only; Image edits target the developed derivative.',
  ];
}

function getGenericImageOpenRejectionMessage(policy: SourceImageFormatPolicy): string | undefined {
  if (policy.kind === 'psd') {
    return 'Layered PSD files must be opened with the Image workspace Open PSD control. PSB is not supported.';
  }
  if (canOpenPolicyAsEditableDocument(policy)) return undefined;

  const description = describeSourceImageFormatPolicy(policy);
  return description.warnings[0]
    ?? getPolicyMessage(policy)
    ?? `${description.formatLabel} cannot be opened as an editable Image document.`;
}

function getPolicyMessage(policy: SourceImageFormatPolicy): string | undefined {
  return 'message' in policy ? policy.message : undefined;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function classifySourceLibraryAssetUrl(assetUrl: string | undefined): ImageSourceLibraryAssetUrlKind {
  if (!assetUrl) return 'none';
  if (assetUrl.startsWith('blob:')) return 'blob-url';
  if (assetUrl.startsWith('data:')) return 'embedded-data-url';
  return 'durable-url';
}

function isDurableSourceLibraryItem(
  item: Pick<SourceBinLibraryItem, 'assetUrl' | 'assetId' | 'scratchFileName' | 'nativeFilePath'>,
): boolean {
  if (item.assetId || item.scratchFileName || item.nativeFilePath) return true;
  return classifySourceLibraryAssetUrl(item.assetUrl) !== 'blob-url' && Boolean(item.assetUrl);
}

function describeImageSourceLibraryHandoffWarnings(
  sourceId: string | null,
  sourceItem: Pick<SourceBinLibraryItem, 'id' | 'assetUrl'> | undefined,
  assetUrlKind: ImageSourceLibraryAssetUrlKind,
  durableAsset: boolean,
): ImageSourceLibraryHandoffWarning[] {
  if (!sourceId || !sourceItem) {
    return [{
      code: 'missing-source-id',
      sourceId: sourceId ?? undefined,
      message: sourceId
        ? `Image document points at missing Source Library item "${sourceId}".`
        : 'Image document is not linked to a Source Library item.',
    }];
  }
  if (assetUrlKind === 'blob-url' && !durableAsset) {
    return [{
      code: 'blob-only-source-url',
      sourceId,
      message: `Source Library item "${sourceId}" only has a blob URL and may not survive project save/open or native handoff.`,
    }];
  }
  return [];
}

function describeImageSourceLibrarySourceSnapshotAvailability(
  documentSourceId: string | null,
  sourceItem: Pick<SourceBinLibraryItem, 'id'> | undefined,
  snapshots: ImageSourceLibraryDocumentSnapshotSummary[],
  layerSnapshots: ImageSourceLibraryLayerSnapshot[],
): ImageSourceLibrarySourceSnapshotAvailability {
  const sourceIds = dedupeStrings([
    ...(sourceItem?.id ? [sourceItem.id] : []),
    ...layerSnapshots.flatMap((snapshot) => snapshot.sourceBinItemId ? [snapshot.sourceBinItemId] : []),
  ]).sort((left, right) => left.localeCompare(right));
  const missingSourceIds = documentSourceId && !sourceItem ? [documentSourceId] : [];
  const latestSnapshot = [...snapshots].sort((left, right) => {
    const createdDelta = right.createdAt - left.createdAt;
    if (createdDelta !== 0) return createdDelta;
    return right.id.localeCompare(left.id);
  })[0];

  return {
    available: snapshots.length > 0 && sourceIds.length > 0,
    snapshotCount: snapshots.length,
    ...(latestSnapshot ? { latestSnapshotId: latestSnapshot.id } : {}),
    sourceIds,
    missingSourceIds,
  };
}

function describeImageSourceLibraryExternalAssetPackaging(
  sourceId: string | null,
  assetUrlKind: ImageSourceLibraryAssetUrlKind,
  durableAsset: boolean,
): ImageSourceLibraryExternalAssetPackaging {
  const signature = [
    'image-source-library-external-asset-package:v1',
    `source=${sourceId ?? 'none'}`,
    `asset=${assetUrlKind}`,
    `durable=${durableAsset}`,
    `required=${Boolean(sourceId && assetUrlKind === 'blob-url' && !durableAsset)}`,
  ].join('|');

  if (sourceId && assetUrlKind === 'blob-url' && !durableAsset) {
    return {
      required: true,
      caveats: [
        `Source Library item "${sourceId}" only has a blob URL; package it into project scratch or native media before cross-workspace handoff.`,
      ],
      signature,
    };
  }
  return {
    required: false,
    caveats: [],
    signature,
  };
}

function describeImageSourceLibrarySourceSnapshotRisk({
  sourceSnapshotAvailability,
  sourceId,
  assetUrlKind,
  durableAsset,
  warnings,
}: {
  sourceSnapshotAvailability: ImageSourceLibrarySourceSnapshotAvailability;
  sourceId: string | null;
  assetUrlKind: ImageSourceLibraryAssetUrlKind;
  durableAsset: boolean;
  warnings: ImageSourceLibraryHandoffWarning[];
}): ImageSourceLibrarySourceSnapshotRisk {
  const blockerCodes = warnings.map((warning) => warning.code);
  const blobOnlySourceIds = sourceId && assetUrlKind === 'blob-url' && !durableAsset ? [sourceId] : [];
  const state: ImageSourceLibrarySourceSnapshotRiskState = blobOnlySourceIds.length > 0
    ? 'blob-only-risk'
    : sourceSnapshotAvailability.missingSourceIds.length > 0 || blockerCodes.includes('missing-source-id')
      ? 'missing-source'
      : sourceSnapshotAvailability.available
        ? 'preserved'
        : 'missing-snapshots';
  const preservesSourceSnapshot = state === 'preserved';
  const caveats = describeImageSourceLibrarySourceSnapshotRiskCaveats({
    state,
    sourceId,
    blobOnlySourceIds,
  });

  return {
    state,
    preservesSourceSnapshot,
    snapshotCount: sourceSnapshotAvailability.snapshotCount,
    ...(sourceSnapshotAvailability.latestSnapshotId ? { latestSnapshotId: sourceSnapshotAvailability.latestSnapshotId } : {}),
    sourceIds: sourceSnapshotAvailability.sourceIds,
    missingSourceIds: sourceSnapshotAvailability.missingSourceIds,
    blobOnlySourceIds,
    blockerCodes,
    caveats,
    signature: [
      'image-source-library-source-snapshot-risk:v1',
      `state=${state}`,
      `preserved=${preservesSourceSnapshot}`,
      `snapshots=${sourceSnapshotAvailability.snapshotCount}`,
      `latest=${sourceSnapshotAvailability.latestSnapshotId ?? 'none'}`,
      `sources=${sourceSnapshotAvailability.sourceIds.join(',') || 'none'}`,
      `missing=${sourceSnapshotAvailability.missingSourceIds.join(',') || 'none'}`,
      `blobOnly=${blobOnlySourceIds.join(',') || 'none'}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
    ].join('|'),
  };
}

function describeImageSourceLibrarySourceSnapshotRiskCaveats({
  state,
  sourceId,
  blobOnlySourceIds,
}: {
  state: ImageSourceLibrarySourceSnapshotRiskState;
  sourceId: string | null;
  blobOnlySourceIds: string[];
}): string[] {
  if (state === 'preserved') return [];
  if (state === 'blob-only-risk') {
    return [
      `Source snapshot preservation is at risk because ${blobOnlySourceIds.join(', ') || 'the source'} only has a blob URL and is not packaged durably.`,
    ];
  }
  if (state === 'missing-source') {
    return [
      sourceId
        ? `Source snapshot preservation is blocked until Source Library item "${sourceId}" is repaired or relinked.`
        : 'Source snapshot preservation is blocked until the document is linked to a Source Library item.',
    ];
  }
  return ['No source snapshots are available for before/after handoff review.'];
}

function describeImageSourceLibrarySuiteHandoffBlockers(
  sourceId: string | null,
  warnings: ImageSourceLibraryHandoffWarning[],
): ImageSourceLibrarySuiteHandoffBlocker[] {
  return warnings.map((warning) => ({
    code: warning.code,
    target: 'suite',
    message: warning.code === 'blob-only-source-url' && sourceId
      ? `Persist Source Library item "${sourceId}" before Flow, Video, or Paper handoff.`
      : sourceId
        ? `Resolve Source Library item "${sourceId}" before Flow, Video, or Paper handoff.`
        : 'Link this document to a Source Library item before Flow, Video, or Paper handoff.',
  }));
}

function describeSourceLibraryWorkspaceReadiness(
  target: 'flow' | 'video' | 'paper',
  sourceId: string | null,
  durableAsset: boolean,
): ImageSourceLibraryWorkspaceReadiness {
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
        ? `Persist Source Library item "${sourceId}" before placing it in Paper.`
        : `Persist Source Library item "${sourceId}" before sending it to ${target === 'flow' ? 'Flow' : 'Video'}.`,
    };
  }
  return {
    target,
    ready: false,
    reason: target === 'paper'
      ? 'Link this document to a durable Source Library item before placing it in Paper.'
      : `Link this document to a durable Source Library item before sending it to ${target === 'flow' ? 'Flow' : 'Video'}.`,
  };
}

function describeImageSourceLibraryLayerSnapshot(layer: ImageLayer): ImageSourceLibraryLayerSnapshot {
  return {
    layerId: layer.id,
    layerName: layer.name,
    sourceFormat: layer.metadata?.sourceFormat ?? 'image',
    bounds: {
      x: layer.x,
      y: layer.y,
      width: layer.bitmap?.width ?? 0,
      height: layer.bitmap?.height ?? 0,
    },
    sourceBinItemId: getLayerSourceId(layer),
  };
}

function isGeneratedImageSourceLayer(layer: ImageLayer): boolean {
  return layer.metadata?.sourceFormat === 'generative-fill'
    || layer.metadata?.sourceFormat === 'generated'
    || layer.metadata?.sourceWarnings?.some((warning) => /generated/i.test(warning)) === true;
}

function getLayerSourceId(layer: ImageLayer): string | null {
  return layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? null;
}

function compareLayerSnapshots(a: ImageSourceLibraryLayerSnapshot, b: ImageSourceLibraryLayerSnapshot): number {
  return a.layerId.localeCompare(b.layerId);
}

function sanitizeSourceId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, '-');
}

function normalizeDetectedSourceBitDepth(value: unknown): 8 | 16 | 32 | undefined {
  return value === 8 || value === 16 || value === 32 ? value : undefined;
}

function stripImageFileExtension(fileName: string): string {
  return fileName
    .replace(/\.(?:png|jpe?g|webp|avif|bmp|gif|tiff?|svg)$/i, '')
    .trim();
}
