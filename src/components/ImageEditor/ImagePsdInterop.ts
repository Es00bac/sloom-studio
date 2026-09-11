import {
  initializeCanvas,
  readPsd,
  writePsdUint8Array,
  type BlendMode as PsdBlendMode,
  type Color as PsdColor,
  type Justification as PsdJustification,
  type Layer as PsdLayer,
  type LayerTextData as PsdLayerTextData,
  type PixelData,
  type Psd,
} from 'ag-psd';
import type { BlendMode, ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import { flattenImageDocumentToBitmap } from './ImageDocumentExport';
import { describePhotoshopDocumentSizePolicy, type PhotoshopDocumentSizePolicyDescriptor } from './ImageFileFormats';
import { renderLayerWithEffects } from './ImageLayerEffects';
import { rasterizeLayerBitmapTransformed } from './ImageLayerTransform';
import { describeImageSmartSourceLinkedLayerMetadata } from './ImageLayerWorkflowMetadata';
import {
  attachSmartObjectPsdInterchange,
  getSmartObjectPsdRecord,
  readSmartObjectPsdInterchange,
  writeSmartObjectPsdInterchange,
  type SmartObjectPsdRecord,
} from './smartObjects/SmartObjectPsd';

export const IMAGE_PSD_MIME_TYPE = 'image/vnd.adobe.photoshop';
export const IMAGE_PSD_EXTENSION = 'psd';
export const SIGNAL_LOOM_PSD_METADATA_KEY = 'signalLoomImageMetadata';

export interface PsdDocumentImportParams {
  id: string;
  title: string;
  sourceBinItemId?: string;
}

export interface SignalLoomPsdUnsupportedNativeConstruct {
  code:
    | 'native-smart-object'
    | 'editable-text-layer'
    | 'adjustment-layer'
    | 'layer-effects'
    | 'layer-mask'
    | 'layer-group';
  flattened: boolean;
  message: string;
  nativePsdSmartObject?: boolean;
  nativePsdTextLayer?: boolean;
  nativePsdAdjustmentLayer?: boolean;
  nativePsdLayerEffects?: boolean;
  nativePsdLayerMask?: boolean;
  nativePsdLayerGroup?: boolean;
}

type SignalLoomPsdLayerMetadata = Pick<
  ImageLayer,
  | 'id'
  | 'name'
  | 'type'
  | 'text'
  | 'adjustment'
  | 'effects'
  | 'filters'
  | 'metadata'
  | 'groupId'
  | 'groupExpanded'
  | 'linkGroupId'
> & { order: number };

export type SignalLoomPsdExportMode = 'native-raster' | 'native-text' | 'native-group' | 'flattened-raster' | 'metadata-only';

export interface SignalLoomPsdExportCompatibilityDescriptor {
  layerOrder: 'bottom-to-top';
  psdLayerOrder: 'top-to-bottom';
  nativeRasterLayers: true;
  nativeLayerGroups: boolean;
  nativeEditableText: true;
  nativeAdjustmentLayers: false;
  nativeLayerEffects: false;
  nativeLayerMasks: true;
  nativeSmartObjects: false;
}

export interface SignalLoomPsdExportLayerDescriptor {
  id: string;
  name: string;
  type: ImageLayer['type'];
  order: number;
  psdChildIndex: number | null;
  exportMode: SignalLoomPsdExportMode;
  flattened: boolean;
  metadataOnly: boolean;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  groupId?: string;
  groupExpanded?: boolean;
  bitmap?: {
    width: number;
    height: number;
    left: number;
    top: number;
  };
  group?: {
    childLayerIds: string[];
    expanded: boolean;
    metadataOnly: boolean;
    nativePsdGroup: boolean;
  };
  text?: {
    contentLength: number;
    fontFamily?: string;
    fontSize?: number;
    metadataOnly: boolean;
    nativePsdTextLayer: boolean;
    fallbackReason?: string;
  };
  adjustment?: {
    kind: NonNullable<ImageLayer['adjustment']>['kind'];
    metadataOnly: true;
    nativePsdAdjustmentLayer: false;
  };
  effects?: {
    count: number;
    kinds: string[];
    enabledKinds: string[];
    flattened: true;
    nativePsdLayerEffects: false;
  };
  mask?: {
    width: number;
    height: number;
    density?: number;
    feather?: number;
    flattened: boolean;
    nativePsdLayerMask: boolean;
  };
  sourceLink?: {
    id: string;
    label?: string;
    width?: number;
    height?: number;
    status: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']>['status'];
    relinkCount: number;
    metadataOnly: true;
    nativePsdSmartObject: false;
    statusSummary: {
      state: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']>['status'] | 'none';
      missing: boolean;
      repairRequired: boolean;
    };
    historySummary: {
      relinkCount: number;
      lastRelinkAt?: number;
      lastSourceId?: string;
    };
    warnings: Array<{
      code: string;
      message: string;
    }>;
    preview: {
      layerBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      sourceDimensions?: {
        width: number;
        height: number;
      };
    };
    previewSignature: string;
    sourceSnapshotPreservation: {
      preserved: boolean;
      snapshotId?: string;
      layerCount: number;
      sourceIds: string[];
      missingSourceIds: string[];
    };
    smartFilters: {
      filterCount: number;
      enabledFilterCount: number;
      nativePsdSmartFilters: false;
      limitationWarnings: Array<{
        code: string;
        message: string;
      }>;
      metadataOnlyCaveats: Array<{
        descriptorId: string;
        code: string;
        message: string;
      }>;
      previewSignature: string;
    };
    roundtripSummary: {
      canRoundtripMetadata: boolean;
      nativePsdSmartObject: false;
      metadataOnlyPsdSmartObject: boolean;
      sourceId: string | null;
      status: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']>['status'] | 'none';
      relinkCount: number;
      warningCodes: string[];
    };
    roundtripStrategy: {
      descriptorId: string;
      strategy: 'package-source-and-retain-signal-loom-metadata';
      fallbackRoute: 'source-library-package';
      nativePsdSmartObject: false;
      metadataOnlyPsdSmartObject: true;
      caveats: string[];
    };
  };
  warningCodes: SignalLoomPsdUnsupportedNativeConstruct['code'][];
}

export interface SignalLoomPsdExportManifest {
  version: 1;
  kind: 'signal-loom-psd-export-manifest';
  compatibility: SignalLoomPsdExportCompatibilityDescriptor;
  summary: {
    layerCount: number;
    exportedPixelLayerCount: number;
    groupCount: number;
    textLayerCount: number;
    adjustmentLayerCount: number;
    effectLayerCount: number;
    maskLayerCount: number;
    sourceLinkedLayerCount: number;
    metadataOnlyLayerCount: number;
    flattenedLayerCount: number;
    warningCount: number;
  };
  warnings: SignalLoomPsdUnsupportedNativeConstruct[];
  layers: SignalLoomPsdExportLayerDescriptor[];
}

export type SignalLoomPsdNativeConstructWarningCode =
  | SignalLoomPsdUnsupportedNativeConstruct['code']
  | 'metadata-only-smart-filters'
  | 'smart-filter-mask-unsupported';

export type SignalLoomPsdPreservationMode =
  | 'none'
  | 'native-structure'
  | 'native-raster'
  | 'metadata-only'
  | 'flattened-raster-with-metadata';

export type SignalLoomPsdRoundTripRisk = 'none' | 'low' | 'medium' | 'high';
export type SignalLoomPsdFallbackRouteKind =
  | 'psd-signal-loom-metadata'
  | 'source-library-package'
  | 'tiff-visible-composite'
  | 'png-visible-composite';

export interface SignalLoomPsdNativeConstructPreservationSummary {
  present: number;
  importPreservation: SignalLoomPsdPreservationMode;
  exportPreservation: SignalLoomPsdPreservationMode;
  nativePsdSupported: boolean;
  flattened: boolean;
  metadataOnly: boolean;
  caveatCodes: SignalLoomPsdNativeConstructWarningCode[];
}

export interface SignalLoomPsdNativeConstructPolicy {
  nativeRasterLayers: true;
  nativeLayerGroups: boolean;
  nativeEditableText: true;
  nativeAdjustmentLayers: false;
  nativeLayerEffects: false;
  nativeLayerMasks: true;
  nativeSmartObjects: false;
  nativeSmartFilters: false;
  retainedSignalLoomMetadata: true;
}

export interface SignalLoomPsdRetainedMetadataSummary {
  textLayerIds: string[];
  effectLayerIds: string[];
  sourceLinkedLayerIds: string[];
  filterLayerIds: string[];
}

export interface SignalLoomPsdRecommendedFallbackRoute {
  route: SignalLoomPsdFallbackRouteKind;
  label: string;
  preserves: string;
  recommendedFor: string;
  caveat: string;
}

export interface SignalLoomPsdLayerRoundTripWarning {
  descriptorId: string;
  code: SignalLoomPsdNativeConstructWarningCode;
  nativeConstruct:
    | 'smart-object'
    | 'text'
    | 'adjustment-layer'
    | 'layer-effects'
    | 'layer-mask'
    | 'layer-group'
    | 'smart-filter';
  severity: 'warning';
  message: string;
  fallbackRoute: SignalLoomPsdFallbackRouteKind;
  flattened: boolean;
  metadataOnly: boolean;
}

export interface SignalLoomPsdLayerWarningDescriptor {
  layerId: string;
  layerName: string;
  exportMode: SignalLoomPsdExportMode;
  flattened: boolean;
  metadataOnly: boolean;
  warnings: SignalLoomPsdLayerRoundTripWarning[];
}

export interface SignalLoomPsdNativeConstructWarningRecord {
  descriptorId: string;
  code: SignalLoomPsdNativeConstructWarningCode;
  nativeConstruct: SignalLoomPsdLayerRoundTripWarning['nativeConstruct'];
  present: number;
  affectedLayerIds: string[];
  importPreservation: SignalLoomPsdPreservationMode;
  exportPreservation: SignalLoomPsdPreservationMode;
  nativePsdSupported: boolean;
  flattened: boolean;
  metadataOnly: boolean;
  fallbackRoute: SignalLoomPsdFallbackRouteKind;
  message: string;
}

export interface SignalLoomPsdNativeConstructReadiness {
  version: 1;
  kind: 'signal-loom-psd-native-construct-readiness';
  policy: SignalLoomPsdNativeConstructPolicy;
  constructs: {
    groups: SignalLoomPsdNativeConstructPreservationSummary;
    retainedText: SignalLoomPsdNativeConstructPreservationSummary;
    layerEffects: SignalLoomPsdNativeConstructPreservationSummary;
    layerMasks: SignalLoomPsdNativeConstructPreservationSummary;
    adjustmentLayers: SignalLoomPsdNativeConstructPreservationSummary;
    sourceLinkedSmartObjects: SignalLoomPsdNativeConstructPreservationSummary;
    smartFilters: SignalLoomPsdNativeConstructPreservationSummary;
  };
  warningCodes: SignalLoomPsdNativeConstructWarningCode[];
  roundTripRisk: SignalLoomPsdRoundTripRisk;
  flattenedLayerIds: string[];
  metadataOnlyLayerIds: string[];
  retainedMetadata: SignalLoomPsdRetainedMetadataSummary;
  recommendedFallbackRoutes: SignalLoomPsdRecommendedFallbackRoute[];
  layerWarnings: SignalLoomPsdLayerWarningDescriptor[];
  nativeConstructWarnings: SignalLoomPsdNativeConstructWarningRecord[];
  compatibilitySignature: string;
  manifestSignature: string;
  policySignature: string;
}

export interface SignalLoomPsdRoundtripRiskFactor {
  descriptorId: string;
  code: SignalLoomPsdNativeConstructWarningCode;
  nativeConstruct: SignalLoomPsdLayerRoundTripWarning['nativeConstruct'];
  affectedLayerIds: string[];
  fallbackRoute: SignalLoomPsdFallbackRouteKind;
  preservation: SignalLoomPsdPreservationMode;
  importPreservation: SignalLoomPsdPreservationMode;
  exportPreservation: SignalLoomPsdPreservationMode;
  flattened: boolean;
  metadataOnly: boolean;
  message: string;
}

export interface SignalLoomPsdRoundtripRiskDescriptor {
  descriptorId: string;
  risk: SignalLoomPsdRoundTripRisk;
  sourcePackageRequired: boolean;
  fallbackRouteOrder: SignalLoomPsdFallbackRouteKind[];
  flattenedLayerIds: string[];
  metadataOnlyLayerIds: string[];
  retainedMetadata: SignalLoomPsdRetainedMetadataSummary;
  riskFactors: SignalLoomPsdRoundtripRiskFactor[];
  signatures: {
    import: string;
    export: string;
    nativeConstructs: string;
    compatibility: string;
  };
}

export interface SignalLoomPsdMetadata {
  version: 1;
  unsupportedNativeConstructs: SignalLoomPsdUnsupportedNativeConstruct[];
  layers: SignalLoomPsdLayerMetadata[];
  exportManifest?: SignalLoomPsdExportManifest;
}

let agPsdCanvasInitialized = false;

export function buildPsdDocumentFromImageDocument(doc: ImageDocument): Psd {
  const children = buildPsdLayerTreeFromImageLayers(doc.layers);
  const composite = bitmapToPsdImageData(flattenImageDocumentToBitmap(doc));
  const smartObjectRecords = doc.layers
    .map((layer) => getSmartObjectPsdRecord(layer))
    .filter((record): record is SmartObjectPsdRecord => Boolean(record));

  const psd = attachSmartObjectPsdInterchange({
    width: doc.width,
    height: doc.height,
    imageData: composite,
    children,
  }, smartObjectRecords);
  return attachSignalLoomPsdMetadata(psd, doc);
}

export async function imageDocumentToPsdBlob(doc: ImageDocument): Promise<Blob> {
  ensureAgPsdCanvas();
  const bytes = writePsdUint8Array(buildPsdDocumentFromImageDocument(doc), {
    generateThumbnail: false,
    noBackground: true,
  });
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Blob([body], { type: IMAGE_PSD_MIME_TYPE });
}

export function psdArrayBufferToImageDocument(
  buffer: ArrayBuffer,
  params: PsdDocumentImportParams,
): ImageDocument {
  const bitDepth = inspectPsdHeaderBitDepth(buffer);
  if (bitDepth === 16 || bitDepth === 32) {
    throw new Error(
      `High-bit ${bitDepth}-bit/channel PSD import refused before mutation: ag-psd cannot preserve the native authority. `
      + 'Open the source as supported PNG16, TIFF16/TIFF32f, or OpenEXR instead.',
    );
  }
  const sizePolicy = describePhotoshopDocumentSizePolicy({ bytes: buffer });
  if (!sizePolicy.canAttemptLayeredPsdImport && sizePolicy.kind !== 'unknown') {
    throw new Error(buildPhotoshopDocumentSizePolicyImportError(sizePolicy));
  }
  ensureAgPsdCanvas();
  const psd = readPsd(buffer, {
    useImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  return psdDocumentToImageDocument(psd, params);
}

/** PSD header depth is authoritative; inspect it before invoking ag-psd, whose composite path is u8. */
export function inspectPsdHeaderBitDepth(buffer: ArrayBuffer): 8 | 16 | 32 | null {
  if (buffer.byteLength < 24) return null;
  const bytes = new Uint8Array(buffer, 0, 24);
  if (bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) return null;
  const depth = (bytes[22] << 8) | bytes[23];
  return depth === 8 || depth === 16 || depth === 32 ? depth : null;
}

export function detectPhotoshopDocumentKind(buffer: ArrayBuffer): 'psd' | 'psb' | 'unknown' {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 6));
  if (bytes.length < 6 || bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) {
    return 'unknown';
  }
  const version = (bytes[4] << 8) | bytes[5];
  return version === 2 ? 'psb' : version === 1 ? 'psd' : 'unknown';
}

function buildPhotoshopDocumentSizePolicyImportError(
  policy: PhotoshopDocumentSizePolicyDescriptor,
): string {
  const blockerSummary = policy.blockers.map((blocker) => blocker.summary).join(' ');
  if (policy.kind === 'psb') {
    return `PSB large-document files are detected, but Image currently supports layered PSD only. ${blockerSummary} Convert the file to PSD within 30,000 px per side, TIFF, PNG, or JPEG before opening.`;
  }
  return `${blockerSummary} Image cannot safely import this as layered PSD. Convert the file to PSD within 30,000 px per side, TIFF, PNG, or JPEG before opening.`;
}

export function psdDocumentToImageDocument(
  psd: Psd,
  params: PsdDocumentImportParams,
): ImageDocument {
  const layers = collectPsdImageLayers(psd.children ?? [], params.id, psd.linkedFiles ?? []);
  const metadata = readSignalLoomPsdMetadata(psd);
  const importedLayerNameCounts = countPsdLayerNames(layers);
  const retainedMetadataNameCounts = countPsdLayerNames(metadata.layers);
  const usedMetadataIndexes = new Set<number>();
  const layersWithMetadata = layers.map((layer, index) => {
    // PSD layer records do not carry a durable per-layer identity that survives an
    // external reorder or deletion. A repeated name therefore cannot safely prove
    // which retained Sloom record belongs to an imported layer. Decline the whole
    // association instead of transferring an editable identity to the wrong pixels.
    if (
      (importedLayerNameCounts.get(layer.name) ?? 0) !== 1
      || (retainedMetadataNameCounts.get(layer.name) ?? 0) !== 1
    ) return layer;
    const positionalIndex = metadata.layers.findIndex((candidate, candidateIndex) => (
      !usedMetadataIndexes.has(candidateIndex) && candidate.order === index && candidate.name === layer.name
    ));
    const sameName = metadata.layers.filter((candidate, candidateIndex) => !usedMetadataIndexes.has(candidateIndex) && candidate.name === layer.name);
    const storedIndex = positionalIndex >= 0 ? positionalIndex : sameName.length === 1
      ? metadata.layers.indexOf(sameName[0])
      : -1;
    const stored = storedIndex >= 0 ? metadata.layers[storedIndex] : undefined;
    if (!stored) return layer;
    usedMetadataIndexes.add(storedIndex);
    return {
      ...layer,
      id: stored.id ?? layer.id,
      type: stored.type ?? layer.type,
      text: stored.text,
      adjustment: stored.adjustment,
      effects: stored.effects,
      filters: stored.filters,
      metadata: stored.metadata,
      groupId: stored.groupId,
      groupExpanded: stored.groupExpanded,
      linkGroupId: stored.linkGroupId,
    } as ImageLayer;
  });

  return {
    id: params.id,
    title: params.title,
    width: Math.max(1, Math.floor(psd.width)),
    height: Math.max(1, Math.floor(psd.height)),
    layers: layersWithMetadata,
    activeLayerId: layersWithMetadata[layersWithMetadata.length - 1]?.id ?? null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    sourceBinItemId: params.sourceBinItemId,
  };
}

function countPsdLayerNames(layers: ReadonlyArray<Pick<ImageLayer, 'name'>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const layer of layers) {
    counts.set(layer.name, (counts.get(layer.name) ?? 0) + 1);
  }
  return counts;
}

function buildPsdLayerTreeFromImageLayers(layers: ImageLayer[], parentGroupId?: string): PsdLayer[] {
  return layers
    .filter((layer) => (layer.groupId ?? undefined) === parentGroupId)
    .map((layer) => {
      const childLayers = layer.type === 'group'
        ? buildPsdLayerTreeFromImageLayers(layers, layer.id)
        : undefined;
      return imageLayerToPsdLayer(layer, childLayers);
    })
    .filter((layer): layer is PsdLayer => Boolean(layer))
    .reverse();
}

function imageLayerToPsdLayer(layer: ImageLayer, children?: PsdLayer[]): PsdLayer | null {
  if (layer.type === 'group') {
    const groupMask = layer.mask ? {
      left: 0,
      top: 0,
      right: layer.mask.width,
      bottom: layer.mask.height,
      imageData: bitmapToPsdImageData(layer.mask),
      ...(typeof layer.maskDensity === 'number' ? { userMaskDensity: layer.maskDensity } : {}),
      ...(typeof layer.maskFeather === 'number' ? { userMaskFeather: layer.maskFeather } : {}),
    } : undefined;
    return {
      name: layer.name,
      opacity: clamp01(layer.opacity),
      hidden: !layer.visible,
      blendMode: imageBlendModeToPsdBlendMode(layer.blendMode),
      opened: layer.groupExpanded ?? true,
      children: children ?? [],
      ...(groupMask ? { mask: groupMask } : {}),
    };
  }

  if (!isLayerExportedAsPsdPixel(layer)) return null;

  const rendered = renderLayerWithEffects(layer);
  const sourceBitmap = rendered?.bitmap ?? layer.bitmap;
  if (!sourceBitmap) return null;
  const raster = rasterizeLayerBitmapTransformed(
    sourceBitmap,
    layer,
    rendered?.offsetX ?? 0,
    rendered?.offsetY ?? 0,
  );
  const bitmap = raster.bitmap;
  const left = raster.left;
  const top = raster.top;
  const nativeText = buildNativePsdTextLayer(layer, left, top, bitmap.width, bitmap.height);
  const smartObjectRecord = getSmartObjectPsdRecord(layer);
  const smartObjectInterchange = smartObjectRecord
    ? writeSmartObjectPsdInterchange(smartObjectRecord)
    : undefined;

  return {
    name: layer.name,
    left,
    top,
    right: left + bitmap.width,
    bottom: top + bitmap.height,
    opacity: clamp01(layer.opacity),
    hidden: !layer.visible,
    blendMode: imageBlendModeToPsdBlendMode(layer.blendMode),
    imageData: bitmapToPsdImageData(bitmap),
    ...(layer.mask ? { mask: {
      left,
      top,
      right: left + layer.mask.width,
      bottom: top + layer.mask.height,
      imageData: bitmapToPsdImageData(layer.mask),
      ...(typeof layer.maskDensity === 'number' ? { userMaskDensity: layer.maskDensity } : {}),
      ...(typeof layer.maskFeather === 'number' ? { userMaskFeather: layer.maskFeather } : {}),
    } } : {}),
    ...(nativeText ? { text: nativeText } : {}),
    ...(smartObjectInterchange ? { placedLayer: smartObjectInterchange.placedLayer } : {}),
  };
}

export function readSignalLoomPsdMetadata(psd: Psd): SignalLoomPsdMetadata {
  const value = (psd as unknown as Record<string, unknown>)[SIGNAL_LOOM_PSD_METADATA_KEY];
  if (!value || typeof value !== 'object') return { version: 1, unsupportedNativeConstructs: [], layers: [] };
  const record = value as { version?: unknown; unsupportedNativeConstructs?: unknown; layers?: unknown; exportManifest?: unknown };
  return {
    version: 1,
    unsupportedNativeConstructs: Array.isArray(record.unsupportedNativeConstructs)
      ? record.unsupportedNativeConstructs as SignalLoomPsdUnsupportedNativeConstruct[]
      : [],
    layers: Array.isArray(record.layers) ? record.layers as SignalLoomPsdLayerMetadata[] : [],
    ...(record.exportManifest && typeof record.exportManifest === 'object'
      ? { exportManifest: record.exportManifest as SignalLoomPsdExportManifest }
      : {}),
  };
}

function attachSignalLoomPsdMetadata(psd: Psd, doc: ImageDocument): Psd {
  const unsupportedNativeConstructs = buildUnsupportedNativeConstructWarnings(doc.layers);
  const metadata: SignalLoomPsdMetadata = {
    version: 1,
    unsupportedNativeConstructs,
    layers: doc.layers.map((layer, order) => layerToSignalLoomPsdMetadata(layer, order)),
    exportManifest: buildSignalLoomPsdExportManifest(doc, unsupportedNativeConstructs),
  };
  return Object.assign(psd, { [SIGNAL_LOOM_PSD_METADATA_KEY]: metadata });
}

export function buildSignalLoomPsdExportManifest(
  doc: ImageDocument,
  unsupportedNativeConstructs = buildUnsupportedNativeConstructWarnings(doc.layers),
): SignalLoomPsdExportManifest {
  const psdChildIndexByLayerId = buildPsdChildIndexByLayerId(doc.layers);
  const groupChildIdsByLayerId = buildGroupChildIdsByLayerId(doc.layers);
  const layers = doc.layers.map((layer, order) => buildPsdExportLayerDescriptor(
    layer,
    order,
    psdChildIndexByLayerId.get(layer.id) ?? null,
    groupChildIdsByLayerId.get(layer.id) ?? [],
  ));

  return {
    version: 1,
    kind: 'signal-loom-psd-export-manifest',
    compatibility: {
      layerOrder: 'bottom-to-top',
      psdLayerOrder: 'top-to-bottom',
      nativeRasterLayers: true,
      nativeLayerGroups: true,
      nativeEditableText: true,
      nativeAdjustmentLayers: false,
      nativeLayerEffects: false,
      nativeLayerMasks: true,
      nativeSmartObjects: false,
    },
    summary: {
      layerCount: layers.length,
      exportedPixelLayerCount: layers.filter((layer) => (
        layer.exportMode === 'native-raster' || layer.exportMode === 'native-text' || layer.exportMode === 'flattened-raster'
      )).length,
      groupCount: layers.filter((layer) => layer.type === 'group').length,
      textLayerCount: layers.filter((layer) => layer.text).length,
      adjustmentLayerCount: layers.filter((layer) => layer.adjustment).length,
      effectLayerCount: layers.filter((layer) => layer.effects).length,
      maskLayerCount: layers.filter((layer) => layer.mask).length,
      sourceLinkedLayerCount: layers.filter((layer) => layer.sourceLink).length,
      metadataOnlyLayerCount: layers.filter((layer) => layer.metadataOnly).length,
      flattenedLayerCount: layers.filter((layer) => layer.flattened).length,
      warningCount: unsupportedNativeConstructs.length,
    },
    warnings: unsupportedNativeConstructs,
    layers,
  };
}

export function serializeSignalLoomPsdExportManifest(manifest: SignalLoomPsdExportManifest): string {
  return stableSerializePsdMetadataValue(manifest);
}

export function buildSignalLoomPsdNativeConstructReadiness(doc: ImageDocument): SignalLoomPsdNativeConstructReadiness {
  const manifest = buildSignalLoomPsdExportManifest(doc);
  const policy: SignalLoomPsdNativeConstructPolicy = {
    nativeRasterLayers: true,
    nativeLayerGroups: true,
    nativeEditableText: true,
    nativeAdjustmentLayers: false,
    nativeLayerEffects: false,
    nativeLayerMasks: true,
    nativeSmartObjects: false,
    nativeSmartFilters: false,
    retainedSignalLoomMetadata: true,
  };
  const smartFilterCaveatCodes = uniquePsdWarningCodes(manifest.layers.flatMap((layer) => (
    layer.sourceLink?.smartFilters.limitationWarnings.map((warning) => warning.code as SignalLoomPsdNativeConstructWarningCode) ?? []
  )));
  const constructs: SignalLoomPsdNativeConstructReadiness['constructs'] = {
    groups: buildNativeConstructPreservationSummary({
      present: manifest.summary.groupCount,
      importPreservation: 'native-structure',
      exportPreservation: 'native-structure',
      flattened: false,
      metadataOnly: false,
      nativePsdSupported: true,
      caveatCodes: [],
    }),
    retainedText: buildNativeConstructPreservationSummary({
      present: manifest.summary.textLayerCount,
      importPreservation: manifest.layers.some((layer) => layer.text && !layer.text.nativePsdTextLayer) ? 'metadata-only' : 'native-structure',
      exportPreservation: manifest.layers.some((layer) => layer.text && !layer.text.nativePsdTextLayer) ? 'flattened-raster-with-metadata' : 'native-structure',
      flattened: manifest.layers.some((layer) => layer.text && !layer.text.nativePsdTextLayer),
      metadataOnly: manifest.layers.some((layer) => layer.text && !layer.text.nativePsdTextLayer),
      nativePsdSupported: true,
      caveatCodes: manifest.layers.some((layer) => layer.text && !layer.text.nativePsdTextLayer) ? ['editable-text-layer'] : [],
    }),
    layerEffects: buildNativeConstructPreservationSummary({
      present: manifest.summary.effectLayerCount,
      importPreservation: 'metadata-only',
      exportPreservation: 'flattened-raster-with-metadata',
      flattened: true,
      metadataOnly: true,
      caveatCodes: ['layer-effects'],
    }),
    layerMasks: buildNativeConstructPreservationSummary({
      present: manifest.summary.maskLayerCount,
      importPreservation: 'native-structure',
      exportPreservation: 'native-structure',
      flattened: false,
      metadataOnly: false,
      nativePsdSupported: true,
      caveatCodes: [],
    }),
    adjustmentLayers: buildNativeConstructPreservationSummary({
      present: manifest.summary.adjustmentLayerCount,
      importPreservation: 'metadata-only',
      exportPreservation: 'metadata-only',
      flattened: false,
      metadataOnly: true,
      caveatCodes: ['adjustment-layer'],
    }),
    sourceLinkedSmartObjects: buildNativeConstructPreservationSummary({
      present: manifest.summary.sourceLinkedLayerCount,
      importPreservation: 'metadata-only',
      exportPreservation: 'flattened-raster-with-metadata',
      flattened: true,
      metadataOnly: true,
      caveatCodes: ['native-smart-object'],
    }),
    smartFilters: buildNativeConstructPreservationSummary({
      present: manifest.layers.reduce((count, layer) => count + (layer.sourceLink?.smartFilters.filterCount ?? 0), 0),
      importPreservation: 'metadata-only',
      exportPreservation: 'metadata-only',
      flattened: false,
      metadataOnly: true,
      caveatCodes: smartFilterCaveatCodes,
    }),
  };
  const warningCodes = uniquePsdWarningCodes([
    ...manifest.warnings.map((warning) => warning.code),
    ...smartFilterCaveatCodes,
  ]);
  const roundTripRisk = describeSignalLoomPsdRoundTripRisk(constructs, warningCodes);
  const flattenedLayerIds = manifest.layers.filter((layer) => layer.flattened).map((layer) => layer.id);
  const metadataOnlyLayerIds = manifest.layers.filter((layer) => layer.metadataOnly).map((layer) => layer.id);
  const retainedMetadata = buildPsdRetainedMetadataSummary(doc.layers);

  return {
    version: 1,
    kind: 'signal-loom-psd-native-construct-readiness',
    policy,
    constructs,
    warningCodes,
    roundTripRisk,
    flattenedLayerIds,
    metadataOnlyLayerIds,
    retainedMetadata,
    recommendedFallbackRoutes: buildPsdRecommendedFallbackRoutes(warningCodes),
    layerWarnings: buildPsdLayerWarnings(manifest.layers),
    nativeConstructWarnings: buildPsdNativeConstructWarningRecords({
      constructs,
      layers: manifest.layers,
      warningCodes,
    }),
    compatibilitySignature: buildPsdReadinessCompatibilitySignature({
      manifest,
      roundTripRisk,
      retainedMetadata,
      flattenedLayerIds,
      metadataOnlyLayerIds,
      warningCodes,
    }),
    manifestSignature: `signal-loom-psd-manifest:v1:${serializeSignalLoomPsdExportManifest(manifest)}`,
    policySignature: `signal-loom-psd-policy:v1:${stableSerializePsdMetadataValue(policy)}`,
  };
}

export function buildSignalLoomPsdRoundtripRiskDescriptor(doc: ImageDocument): SignalLoomPsdRoundtripRiskDescriptor {
  const readiness = buildSignalLoomPsdNativeConstructReadiness(doc);
  const riskFactors = readiness.nativeConstructWarnings.map((warning): SignalLoomPsdRoundtripRiskFactor => ({
    descriptorId: `psd-roundtrip-risk-factor:v1|code=${warning.code}|layers=${joinPsdSignatureIds(warning.affectedLayerIds)}`,
    code: warning.code,
    nativeConstruct: warning.nativeConstruct,
    affectedLayerIds: warning.affectedLayerIds,
    fallbackRoute: warning.fallbackRoute,
    preservation: warning.exportPreservation,
    importPreservation: warning.importPreservation,
    exportPreservation: warning.exportPreservation,
    flattened: warning.flattened,
    metadataOnly: warning.metadataOnly,
    message: warning.message,
  }));

  return {
    descriptorId: `psd-roundtrip-risk:v1|risk=${readiness.roundTripRisk}|layers=${doc.layers.length}`,
    risk: readiness.roundTripRisk,
    sourcePackageRequired: readiness.warningCodes.some((code) => (
      code === 'native-smart-object'
      || code === 'metadata-only-smart-filters'
      || code === 'smart-filter-mask-unsupported'
    )),
    fallbackRouteOrder: readiness.recommendedFallbackRoutes.map((route) => route.route),
    flattenedLayerIds: readiness.flattenedLayerIds,
    metadataOnlyLayerIds: readiness.metadataOnlyLayerIds,
    retainedMetadata: readiness.retainedMetadata,
    riskFactors,
    signatures: {
      import: buildPsdRoundtripImportSignature(readiness),
      export: buildPsdRoundtripExportSignature(readiness),
      nativeConstructs: buildPsdRoundtripNativeConstructSignature(readiness),
      compatibility: readiness.compatibilitySignature,
    },
  };
}

function buildPsdExportLayerDescriptor(
  layer: ImageLayer,
  order: number,
  psdChildIndex: number | null,
  childLayerIds: string[],
): SignalLoomPsdExportLayerDescriptor {
  const normalizedMetadata = normalizeLayerMetadataForPsd(layer);
  const sourceLink = normalizedMetadata?.sourceLink;
  const nativeText = isNativePsdTextSupported(layer);
  const hasEffects = (layer.effects?.length ?? 0) > 0;
  const hasFlattenedRasterConstruct = Boolean(
    sourceLink
    || ((layer.type === 'text' || layer.text) && !nativeText)
    || hasEffects,
  );
  const nativeGroup = layer.type === 'group' && psdChildIndex !== null;
  const metadataOnly = psdChildIndex === null;
  const flattened = !metadataOnly && hasFlattenedRasterConstruct;
  const descriptor: SignalLoomPsdExportLayerDescriptor = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    order,
    psdChildIndex,
    exportMode: nativeGroup ? 'native-group' : metadataOnly ? 'metadata-only' : nativeText ? 'native-text' : flattened ? 'flattened-raster' : 'native-raster',
    flattened,
    metadataOnly,
    visible: layer.visible,
    opacity: clamp01(layer.opacity),
    blendMode: layer.blendMode,
    warningCodes: buildPsdExportLayerWarningCodes(layer, sourceLink),
  };

  if (layer.groupId) descriptor.groupId = layer.groupId;
  if (layer.groupExpanded !== undefined) descriptor.groupExpanded = layer.groupExpanded;
  if (layer.bitmap) {
    descriptor.bitmap = {
      width: layer.bitmap.width,
      height: layer.bitmap.height,
      left: Math.floor(layer.x),
      top: Math.floor(layer.y),
    };
  }
  if (layer.type === 'group') {
    descriptor.group = {
      childLayerIds,
      expanded: layer.groupExpanded ?? true,
      metadataOnly: !nativeGroup,
      nativePsdGroup: nativeGroup,
    };
  }
  if (layer.text) {
    descriptor.text = {
      contentLength: layer.text.content.length,
      fontFamily: layer.text.fontFamily,
      fontSize: layer.text.fontSize,
      metadataOnly: !nativeText,
      nativePsdTextLayer: nativeText,
      ...(!nativeText ? { fallbackReason: describeNativePsdTextFallbackReason(layer) } : {}),
    };
  }
  if (layer.adjustment) {
    descriptor.adjustment = {
      kind: layer.adjustment.kind,
      metadataOnly: true,
      nativePsdAdjustmentLayer: false,
    };
  }
  if (hasEffects && layer.effects) {
    const kinds = Array.from(new Set(layer.effects.map((effect) => effect.kind))).sort((left, right) => left.localeCompare(right));
    const enabledKinds = Array.from(new Set(
      layer.effects.filter((effect) => effect.enabled).map((effect) => effect.kind),
    )).sort((left, right) => left.localeCompare(right));
    descriptor.effects = {
      count: layer.effects.length,
      kinds,
      enabledKinds,
      flattened: true,
      nativePsdLayerEffects: false,
    };
  }
  if (layer.mask) {
    descriptor.mask = {
      width: layer.mask.width,
      height: layer.mask.height,
      ...(typeof layer.maskDensity === 'number' && Number.isFinite(layer.maskDensity) ? { density: layer.maskDensity } : {}),
      ...(typeof layer.maskFeather === 'number' && Number.isFinite(layer.maskFeather) ? { feather: layer.maskFeather } : {}),
      flattened: false,
      nativePsdLayerMask: true,
    };
  }
  if (sourceLink) {
    const sourceDescriptor = describeImageSmartSourceLinkedLayerMetadata(layer, {
      sourceExists: sourceLink.status !== 'missing',
      includePsdSmartObjectWarning: true,
    });
    descriptor.sourceLink = {
      id: sourceLink.id,
      ...(sourceLink.label ? { label: sourceLink.label } : {}),
      ...(typeof sourceLink.width === 'number' && Number.isFinite(sourceLink.width) ? { width: sourceLink.width } : {}),
      ...(typeof sourceLink.height === 'number' && Number.isFinite(sourceLink.height) ? { height: sourceLink.height } : {}),
      status: sourceLink.status,
      relinkCount: sourceLink.relinkHistory.length,
      metadataOnly: true,
      nativePsdSmartObject: false,
      statusSummary: {
        state: sourceDescriptor.status.state,
        missing: sourceDescriptor.status.missing,
        repairRequired: sourceDescriptor.status.repairRequired,
      },
      historySummary: {
        relinkCount: sourceDescriptor.history.relinkCount,
        ...(typeof sourceDescriptor.history.lastRelinkAt === 'number'
          ? { lastRelinkAt: sourceDescriptor.history.lastRelinkAt }
          : {}),
        ...(sourceDescriptor.history.lastSourceId ? { lastSourceId: sourceDescriptor.history.lastSourceId } : {}),
      },
      warnings: sourceDescriptor.warnings,
      preview: {
        layerBounds: sourceDescriptor.preview.layerBounds,
        ...(sourceDescriptor.preview.sourceDimensions ? { sourceDimensions: sourceDescriptor.preview.sourceDimensions } : {}),
      },
      previewSignature: sourceDescriptor.previewSignature,
      sourceSnapshotPreservation: sourceDescriptor.sourceSnapshotPreservation,
      smartFilters: {
        filterCount: sourceDescriptor.smartFilters.filterCount,
        enabledFilterCount: sourceDescriptor.smartFilters.enabledFilterCount,
        nativePsdSmartFilters: sourceDescriptor.smartFilters.nativePsdSmartFilters,
        limitationWarnings: sourceDescriptor.smartFilters.limitationWarnings,
        metadataOnlyCaveats: sourceDescriptor.smartFilters.limitationWarnings.map((warning) => ({
          descriptorId: `psd-smart-filter-caveat:v1|layer=${layer.id}|code=${warning.code}`,
          code: warning.code,
          message: warning.message,
        })),
        previewSignature: sourceDescriptor.smartFilters.previewSignature,
      },
      roundtripSummary: sourceDescriptor.sourceLinkRoundtrip,
      roundtripStrategy: {
        descriptorId: `psd-smart-object-roundtrip:v1|layer=${layer.id}|source=${sourceLink.id}|status=${sourceLink.status}|filters=${sourceDescriptor.smartFilters.filterCount}`,
        strategy: 'package-source-and-retain-signal-loom-metadata',
        fallbackRoute: 'source-library-package',
        nativePsdSmartObject: false,
        metadataOnlyPsdSmartObject: true,
        caveats: [
          'Native PSD Smart Object records are not written.',
          'Smart Filter stacks are retained as Sloom Studio metadata only.',
          'Package the original linked source asset beside the PSD for safer round-trip recovery.',
        ],
      },
    };
  }

  return descriptor;
}

function buildPsdChildIndexByLayerId(layers: ImageLayer[]): Map<string, number> {
  return new Map(
    layers
      .filter(isLayerExportedAsPsdNativeLayer)
      .map((layer) => layer.id)
      .reverse()
      .map((id, index) => [id, index] as const),
  );
}

function buildGroupChildIdsByLayerId(layers: ImageLayer[]): Map<string, string[]> {
  const childIdsByGroupId = new Map<string, string[]>();
  for (const layer of layers) {
    if (!layer.groupId) continue;
    const childIds = childIdsByGroupId.get(layer.groupId) ?? [];
    childIds.push(layer.id);
    childIdsByGroupId.set(layer.groupId, childIds);
  }
  return childIdsByGroupId;
}

function buildPsdExportLayerWarningCodes(
  layer: ImageLayer,
  sourceLink: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']> | undefined,
): SignalLoomPsdUnsupportedNativeConstruct['code'][] {
  const warningCodes: SignalLoomPsdUnsupportedNativeConstruct['code'][] = [];
  if (sourceLink) warningCodes.push('native-smart-object');
  if ((layer.type === 'text' || layer.text) && !isNativePsdTextSupported(layer)) warningCodes.push('editable-text-layer');
  if (layer.type === 'adjustment' || layer.adjustment) warningCodes.push('adjustment-layer');
  if ((layer.effects?.length ?? 0) > 0) warningCodes.push('layer-effects');
  return warningCodes;
}

function describeNativePsdTextFallbackReason(layer: ImageLayer): string {
  const text = layer.text;
  if (!text) return 'No retained text source is present.';
  if (text.content.length === 0) return 'Empty text has no native PSD text record.';
  if (text.orientation && text.orientation !== 'horizontal') return 'Vertical text is raster fallback only.';
  if (text.warp !== 'none') return 'Text warp is raster fallback only.';
  if (text.pathReference || text.pathLayout) return 'Text on a path is raster fallback only.';
  if ((layer.effects?.length ?? 0) > 0) return 'Text with layer effects is raster fallback only.';
  if (layer.mask || layer.maskLinkSourceLayerId) return 'Masked text is raster fallback only.';
  return 'The text colour is not a six-digit solid RGB value.';
}

function isLayerExportedAsPsdNativeLayer(layer: ImageLayer): boolean {
  return layer.type === 'group' || isLayerExportedAsPsdPixel(layer);
}

function isLayerExportedAsPsdPixel(layer: ImageLayer): boolean {
  return Boolean(layer.bitmap && layer.type !== 'adjustment' && layer.type !== 'group');
}

function stableSerializePsdMetadataValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializePsdMetadataValue).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerializePsdMetadataValue(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

function buildNativeConstructPreservationSummary(params: {
  present: number;
  importPreservation: SignalLoomPsdPreservationMode;
  exportPreservation: SignalLoomPsdPreservationMode;
  flattened: boolean;
  metadataOnly: boolean;
  nativePsdSupported?: boolean;
  caveatCodes: SignalLoomPsdNativeConstructWarningCode[];
}): SignalLoomPsdNativeConstructPreservationSummary {
  const present = Math.max(0, Math.floor(params.present));
  return {
    present,
    importPreservation: present > 0 ? params.importPreservation : 'none',
    exportPreservation: present > 0 ? params.exportPreservation : 'none',
    nativePsdSupported: present > 0 && params.nativePsdSupported === true,
    flattened: present > 0 && params.flattened,
    metadataOnly: present > 0 && params.metadataOnly,
    caveatCodes: present > 0 ? uniquePsdWarningCodes(params.caveatCodes) : [],
  };
}

function describeSignalLoomPsdRoundTripRisk(
  constructs: SignalLoomPsdNativeConstructReadiness['constructs'],
  warningCodes: SignalLoomPsdNativeConstructWarningCode[],
): SignalLoomPsdRoundTripRisk {
  if (warningCodes.length === 0) return 'none';
  if (
    constructs.sourceLinkedSmartObjects.present > 0
    || constructs.smartFilters.present > 0
    || constructs.retainedText.flattened
  ) {
    return 'high';
  }
  if (
    constructs.layerEffects.present > 0
    || constructs.adjustmentLayers.present > 0
  ) return 'medium';
  return 'low';
}

function buildPsdRetainedMetadataSummary(layers: ImageLayer[]): SignalLoomPsdRetainedMetadataSummary {
  return {
    textLayerIds: layers.filter((layer) => layer.type === 'text' || layer.text).map((layer) => layer.id),
    effectLayerIds: layers.filter((layer) => (layer.effects?.length ?? 0) > 0).map((layer) => layer.id),
    sourceLinkedLayerIds: layers.filter((layer) => layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink).map((layer) => layer.id),
    filterLayerIds: layers.filter((layer) => (layer.filters?.length ?? 0) > 0).map((layer) => layer.id),
  };
}

function buildPsdReadinessCompatibilitySignature({
  manifest,
  roundTripRisk,
  retainedMetadata,
  flattenedLayerIds,
  metadataOnlyLayerIds,
  warningCodes,
}: {
  manifest: SignalLoomPsdExportManifest;
  roundTripRisk: SignalLoomPsdRoundTripRisk;
  retainedMetadata: SignalLoomPsdRetainedMetadataSummary;
  flattenedLayerIds: string[];
  metadataOnlyLayerIds: string[];
  warningCodes: SignalLoomPsdNativeConstructWarningCode[];
}): string {
  return [
    'psd-readiness:v1',
    `layers=${manifest.summary.layerCount}`,
    `risk=${roundTripRisk}`,
    `retained=text:${retainedMetadata.textLayerIds.length},effects:${retainedMetadata.effectLayerIds.length},sourceLinks:${retainedMetadata.sourceLinkedLayerIds.length},filters:${retainedMetadata.filterLayerIds.length}`,
    `flattened=${joinPsdSignatureIds(flattenedLayerIds)}`,
    `metadataOnly=${joinPsdSignatureIds(metadataOnlyLayerIds)}`,
    `warnings=${warningCodes.join(',') || 'none'}`,
  ].join('|');
}

function buildPsdRoundtripImportSignature(readiness: SignalLoomPsdNativeConstructReadiness): string {
  return [
    'psd-import-roundtrip:v1',
    `nativeRaster=${readiness.policy.nativeRasterLayers}`,
    `metadataOnly=${joinPsdSignatureIds(readiness.metadataOnlyLayerIds)}`,
    `warnings=${readiness.warningCodes.join(',') || 'none'}`,
  ].join('|');
}

function buildPsdRoundtripExportSignature(readiness: SignalLoomPsdNativeConstructReadiness): string {
  const retained = readiness.retainedMetadata;
  return [
    'psd-export-roundtrip:v1',
    `flattened=${joinPsdSignatureIds(readiness.flattenedLayerIds)}`,
    `metadataOnly=${joinPsdSignatureIds(readiness.metadataOnlyLayerIds)}`,
    `retained=text:${joinPsdSignatureIds(retained.textLayerIds)},effects:${joinPsdSignatureIds(retained.effectLayerIds)},sourceLinks:${joinPsdSignatureIds(retained.sourceLinkedLayerIds)},filters:${joinPsdSignatureIds(retained.filterLayerIds)}`,
  ].join('|');
}

function buildPsdRoundtripNativeConstructSignature(readiness: SignalLoomPsdNativeConstructReadiness): string {
  return [
    'psd-native-constructs:v1',
    `nativeEditableText=${readiness.policy.nativeEditableText}`,
    `nativeEffects=${readiness.policy.nativeLayerEffects}`,
    `nativeSmartObjects=${readiness.policy.nativeSmartObjects}`,
    `nativeSmartFilters=${readiness.policy.nativeSmartFilters}`,
    `caveats=${readiness.warningCodes.join(',') || 'none'}`,
  ].join('|');
}

function buildPsdRecommendedFallbackRoutes(
  warningCodes: SignalLoomPsdNativeConstructWarningCode[],
): SignalLoomPsdRecommendedFallbackRoute[] {
  if (warningCodes.length === 0) return [];
  return [
    {
      route: 'psd-signal-loom-metadata',
      label: 'PSD with Sloom Studio metadata',
      preserves: 'raster layers plus retained Sloom Studio text, effects, adjustment, source-link, and filter metadata',
      recommendedFor: 'Best working master when Sloom Studio will reopen the PSD.',
      caveat: 'Photoshop and other PSD editors see text, effects, source links, and smart filters as flattened or metadata-only constructs where native PSD records are not written.',
    },
    {
      route: 'source-library-package',
      label: 'Source Library package',
      preserves: 'original source-linked assets, snapshots, relink history, and filter metadata beside the PSD',
      recommendedFor: 'Recover linked-source context during suite handoff or future re-open.',
      caveat: 'Requires keeping the packaged Sloom Studio project and source assets with the PSD; external PSD tools still do not gain native Smart Object or source-link records.',
    },
    {
      route: 'tiff-visible-composite',
      label: 'TIFF visible composite',
      preserves: 'flattened print-oriented pixels',
      recommendedFor: 'Final visible composite handoff where editability is no longer required.',
      caveat: 'Loses editable layers, text, effects, masks, source links, filters, and groups.',
    },
    {
      route: 'png-visible-composite',
      label: 'PNG visible composite',
      preserves: 'flattened visible pixels with transparency',
      recommendedFor: 'Preview or lightweight flattened handoff.',
      caveat: 'Use for preview or handoff only; native edit state, text, effects, source links, and roundtrip metadata are not preserved.',
    },
  ];
}

function buildPsdLayerWarnings(
  layers: SignalLoomPsdExportLayerDescriptor[],
): SignalLoomPsdLayerWarningDescriptor[] {
  return layers
    .map((layer) => {
      const smartFilterCodes = (layer.sourceLink?.smartFilters.limitationWarnings ?? [])
        .map((warning) => warning.code as SignalLoomPsdNativeConstructWarningCode);
      const warningCodes = uniquePsdWarningCodes([
        ...layer.warningCodes,
        ...smartFilterCodes,
      ]);
      const warnings = warningCodes.map((code) => buildPsdLayerRoundTripWarning(code, layer));

      return {
        layerId: layer.id,
        layerName: layer.name,
        exportMode: layer.exportMode,
        flattened: layer.flattened,
        metadataOnly: layer.metadataOnly,
        warnings,
      };
    })
    .filter((layer) => layer.warnings.length > 0);
}

function buildPsdNativeConstructWarningRecords({
  constructs,
  layers,
  warningCodes,
}: {
  constructs: SignalLoomPsdNativeConstructReadiness['constructs'];
  layers: SignalLoomPsdExportLayerDescriptor[];
  warningCodes: SignalLoomPsdNativeConstructWarningCode[];
}): SignalLoomPsdNativeConstructWarningRecord[] {
  return warningCodes
    .map((code) => {
      const summary = getPsdConstructSummaryForWarningCode(constructs, code);
      const affectedLayerIds = getPsdAffectedLayerIdsForWarningCode(layers, code);
      const record: SignalLoomPsdNativeConstructWarningRecord = {
        descriptorId: `psd-native-construct-warning:v1|code=${code}|present=${summary.present}|layers=${joinPsdSignatureIds(affectedLayerIds)}`,
        code,
        nativeConstruct: describePsdNativeConstruct(code),
        present: summary.present,
        affectedLayerIds,
        importPreservation: summary.importPreservation,
        exportPreservation: summary.exportPreservation,
        nativePsdSupported: summary.nativePsdSupported,
        flattened: summary.flattened,
        metadataOnly: summary.metadataOnly,
        fallbackRoute: describePsdLayerWarningFallbackRoute(code),
        message: describePsdLayerWarningMessage(code),
      };
      return record;
    })
    .filter((warning) => warning.present > 0);
}

function getPsdConstructSummaryForWarningCode(
  constructs: SignalLoomPsdNativeConstructReadiness['constructs'],
  code: SignalLoomPsdNativeConstructWarningCode,
): SignalLoomPsdNativeConstructPreservationSummary {
  switch (code) {
    case 'native-smart-object':
      return constructs.sourceLinkedSmartObjects;
    case 'editable-text-layer':
      return constructs.retainedText;
    case 'adjustment-layer':
      return constructs.adjustmentLayers;
    case 'layer-effects':
      return constructs.layerEffects;
    case 'layer-mask':
      return constructs.layerMasks;
    case 'layer-group':
      return constructs.groups;
    case 'metadata-only-smart-filters':
    case 'smart-filter-mask-unsupported':
      return constructs.smartFilters;
    default:
      return buildNativeConstructPreservationSummary({
        present: 0,
        importPreservation: 'none',
        exportPreservation: 'none',
        flattened: false,
        metadataOnly: false,
        caveatCodes: [],
      });
  }
}

function getPsdAffectedLayerIdsForWarningCode(
  layers: SignalLoomPsdExportLayerDescriptor[],
  code: SignalLoomPsdNativeConstructWarningCode,
): string[] {
  if (code === 'metadata-only-smart-filters' || code === 'smart-filter-mask-unsupported') {
    return layers
      .filter((layer) => layer.sourceLink?.smartFilters.limitationWarnings.some((warning) => warning.code === code))
      .map((layer) => layer.id);
  }

  return layers
    .filter((layer) => layer.warningCodes.includes(code as SignalLoomPsdUnsupportedNativeConstruct['code']))
    .map((layer) => layer.id);
}

function buildPsdLayerRoundTripWarning(
  code: SignalLoomPsdNativeConstructWarningCode,
  layer: SignalLoomPsdExportLayerDescriptor,
): SignalLoomPsdLayerRoundTripWarning {
  return {
    descriptorId: `psd-layer-warning:v1|layer=${layer.id}|code=${code}|mode=${layer.exportMode}`,
    code,
    nativeConstruct: describePsdNativeConstruct(code),
    severity: 'warning',
    message: describePsdLayerWarningMessage(code),
    fallbackRoute: describePsdLayerWarningFallbackRoute(code),
    flattened: layer.flattened,
    metadataOnly: layer.metadataOnly,
  };
}

function describePsdNativeConstruct(
  code: SignalLoomPsdNativeConstructWarningCode,
): SignalLoomPsdLayerRoundTripWarning['nativeConstruct'] {
  switch (code) {
    case 'native-smart-object':
      return 'smart-object';
    case 'editable-text-layer':
      return 'text';
    case 'adjustment-layer':
      return 'adjustment-layer';
    case 'layer-effects':
      return 'layer-effects';
    case 'layer-mask':
      return 'layer-mask';
    case 'layer-group':
      return 'layer-group';
    case 'metadata-only-smart-filters':
    case 'smart-filter-mask-unsupported':
      return 'smart-filter';
    default:
      return 'smart-filter';
  }
}

function describePsdLayerWarningFallbackRoute(
  code: SignalLoomPsdNativeConstructWarningCode,
): SignalLoomPsdFallbackRouteKind {
  switch (code) {
    case 'native-smart-object':
    case 'metadata-only-smart-filters':
    case 'smart-filter-mask-unsupported':
      return 'source-library-package';
    case 'editable-text-layer':
    case 'adjustment-layer':
    case 'layer-effects':
    case 'layer-mask':
    case 'layer-group':
      return 'psd-signal-loom-metadata';
    default:
      return 'psd-signal-loom-metadata';
  }
}

function describePsdLayerWarningMessage(code: SignalLoomPsdNativeConstructWarningCode): string {
  switch (code) {
    case 'native-smart-object':
      return 'Source-linked layer metadata is retained by Sloom Studio, but native PSD Smart Object records are not written; package the source asset for roundtrip safety.';
    case 'editable-text-layer':
      return 'Retained text content and style are stored in Sloom Studio metadata while PSD pixels are flattened instead of native editable text.';
    case 'adjustment-layer':
      return 'Adjustment settings are retained in Sloom Studio metadata only; native PSD adjustment records are not written.';
    case 'layer-effects':
      return 'Layer effects are rendered into exported PSD pixels and retained as Sloom Studio metadata rather than native PSD layer effects.';
    case 'layer-mask':
      return 'Layer masks are preserved as native PSD user-mask pixels with density and feather values.';
    case 'layer-group':
      return 'Layer groups are preserved as Sloom Studio metadata-only folders; native PSD group folders are not written.';
    case 'metadata-only-smart-filters':
      return 'Filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.';
    case 'smart-filter-mask-unsupported':
      return 'Smart Filter masks are not preserved as native PSD smart-filter masks.';
    default:
      return 'Unsupported native PSD construct is retained only through Sloom Studio compatibility metadata.';
  }
}

function joinPsdSignatureIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(',') : 'none';
}

function uniquePsdWarningCodes(
  warningCodes: readonly SignalLoomPsdNativeConstructWarningCode[],
): SignalLoomPsdNativeConstructWarningCode[] {
  const seen = new Set<SignalLoomPsdNativeConstructWarningCode>();
  const unique: SignalLoomPsdNativeConstructWarningCode[] = [];
  for (const code of warningCodes) {
    if (seen.has(code)) continue;
    seen.add(code);
    unique.push(code);
  }
  return unique;
}

function layerToSignalLoomPsdMetadata(layer: ImageLayer, order: number): SignalLoomPsdLayerMetadata {
  return {
    order,
    id: layer.id,
    name: layer.name,
    type: layer.type,
    text: layer.text,
    adjustment: layer.adjustment,
    effects: layer.effects,
    filters: layer.filters,
    metadata: normalizeLayerMetadataForPsd(layer),
    groupId: layer.groupId,
    groupExpanded: layer.groupExpanded,
    linkGroupId: layer.linkGroupId,
  };
}

function normalizeLayerMetadataForPsd(layer: ImageLayer): ImageLayer['metadata'] {
  const metadata = layer.metadata;
  if (!metadata) return undefined;

  const sourceId = metadata.sourceLink?.id ?? metadata.smartLinkedSourceId;
  if (!sourceId) return metadata;

  const sourceLink = metadata.sourceLink;
  return {
    ...metadata,
    smartLinkedSourceId: metadata.smartLinkedSourceId ?? sourceId,
    sourceLabel: metadata.sourceLabel ?? sourceLink?.label,
    sourceLink: {
      id: sourceId,
      label: sourceLink?.label ?? metadata.sourceLabel,
      width: sourceLink?.width ?? layer.bitmap?.width,
      height: sourceLink?.height ?? layer.bitmap?.height,
      status: sourceLink?.status ?? 'linked',
      relinkHistory: sourceLink?.relinkHistory ?? [],
    },
  };
}

function buildUnsupportedNativeConstructWarnings(layers: ImageLayer[]): SignalLoomPsdUnsupportedNativeConstruct[] {
  const warnings: SignalLoomPsdUnsupportedNativeConstruct[] = [];

  if (layers.some((layer) => layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink)) {
    warnings.push({
      code: 'native-smart-object',
      flattened: true,
      nativePsdSmartObject: false,
      message: 'Source-linked layers are exported as flattened raster pixels plus Sloom Studio metadata-only link records; native PSD Smart Object semantics are not written.',
    });
  }
  if (layers.some((layer) => (layer.type === 'text' || layer.text) && !isNativePsdTextSupported(layer))) {
    warnings.push({
      code: 'editable-text-layer',
      flattened: true,
      nativePsdTextLayer: false,
      message: 'This text layer uses a retained feature outside the bounded native PSD text subset, so PSD pixels are flattened and Sloom Studio metadata preserves the editable source.',
    });
  }
  if (layers.some((layer) => layer.type === 'adjustment' || layer.adjustment)) {
    warnings.push({
      code: 'adjustment-layer',
      flattened: true,
      nativePsdAdjustmentLayer: false,
      message: 'Adjustment settings are stored as Sloom Studio metadata-only data; native PSD adjustment layer records are not written.',
    });
  }
  if (layers.some((layer) => (layer.effects?.length ?? 0) > 0)) {
    warnings.push({
      code: 'layer-effects',
      flattened: true,
      nativePsdLayerEffects: false,
      message: 'Layer effects are rendered into flattened PSD pixels and retained as Sloom Studio metadata-only settings; native PSD layer effect records are not written.',
    });
  }
  return warnings;
}

function psdLayerToImageLayer(
  layer: PsdLayer,
  docId: string,
  index: number,
  groupId?: string,
  linkedFiles: Psd['linkedFiles'] = [],
): ImageLayer {
  const imageData = layer.imageData;
  const width = Math.max(1, Math.floor(imageData?.width ?? Math.max(1, (layer.right ?? 0) - (layer.left ?? 0))));
  const height = Math.max(1, Math.floor(imageData?.height ?? Math.max(1, (layer.bottom ?? 0) - (layer.top ?? 0))));
  const bitmap = createBitmap(width, height);

  if (imageData) {
    putBitmapImageData(bitmap, pixelDataToImageData(imageData));
  } else if (layer.canvas) {
    const ctx = bitmap.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context for imported PSD layer.');
    ctx.drawImage(layer.canvas, 0, 0);
  }

  const nativeText = psdLayerTextToImageTextStyle(layer.text);
  const smartObjectReadback = layer.placedLayer
    ? readSmartObjectPsdInterchange({ width: width, height, children: [layer], linkedFiles })[0]?.interchange
    : undefined;
  const importedSmartObject = smartObjectReadback && !smartObjectReadback.previewOnly
    && smartObjectReadback.source && smartObjectReadback.placement
    ? {
      source: smartObjectReadback.source,
      placement: smartObjectReadback.placement,
      filters: smartObjectReadback.filters,
      renderedImageData: imageData,
    }
    : undefined;
  const importedLayer = {
    id: `${docId}-layer-${index}`,
    name: layer.name?.trim() || `PSD Layer ${index + 1}`,
    type: nativeText ? 'text' : 'image',
    visible: !layer.hidden,
    locked: false,
    opacity: clamp01(layer.opacity ?? 1),
    blendMode: psdBlendModeToImageBlendMode(layer.blendMode),
    x: Math.floor(layer.left ?? 0),
    y: Math.floor(layer.top ?? 0),
    bitmap,
    bitmapVersion: 0,
    mask: layer.mask?.imageData ? bitmapFromPsdMask(layer.mask.imageData) : null,
    ...(typeof layer.mask?.userMaskDensity === 'number' ? { maskDensity: layer.mask.userMaskDensity } : {}),
    ...(typeof layer.mask?.userMaskFeather === 'number' ? { maskFeather: layer.mask.userMaskFeather } : {}),
    ...(nativeText ? { text: nativeText, metadata: { editableText: true } } : {}),
    ...(groupId ? { groupId } : {}),
  } as ImageLayer;
  if (importedSmartObject) {
    Object.assign(importedLayer, { smartObjectPsd: importedSmartObject });
  } else if (smartObjectReadback?.previewOnly) {
    Object.assign(importedLayer, { smartObjectPsdImport: smartObjectReadback });
  }
  return importedLayer;
}

function buildNativePsdTextLayer(
  layer: ImageLayer,
  left: number,
  top: number,
  rasterWidth: number,
  rasterHeight: number,
): PsdLayerTextData | undefined {
  const text = layer.text;
  if (!text || !isNativePsdTextSupported(layer)) return undefined;

  const fillColor = parsePsdTextColor(text.color);
  if (!fillColor) return undefined;
  const boxWidth = text.boxWidth ?? rasterWidth;
  const boxHeight = text.boxHeight ?? rasterHeight;
  const fontSize = Math.max(1, Math.round(text.fontSize));
  const isBox = text.wrap && text.boxWidth !== null && text.boxHeight !== null;

  return {
    text: text.content,
    left,
    top,
    right: left + Math.max(1, boxWidth),
    bottom: top + Math.max(1, boxHeight),
    orientation: 'horizontal',
    antiAlias: 'smooth',
    shapeType: isBox ? 'box' : 'point',
    ...(isBox ? { boxBounds: [left, top, left + boxWidth, top + boxHeight] } : { pointBase: [left, top] }),
    style: {
      font: { name: psdFontName(text.fontFamily) },
      fontSize,
      fauxBold: isPsdTextBold(text.fontWeight),
      fauxItalic: text.fontStyle !== 'normal',
      autoLeading: false,
      leading: Math.max(fontSize, text.lineHeight * fontSize),
      tracking: Math.round((text.letterSpacing / fontSize) * 1000),
      autoKerning: text.fontKerning !== 'none',
      baselineShift: text.baselineShift,
      fontCaps: text.fontVariantCaps === 'all-small-caps' ? 2 : text.fontVariantCaps === 'small-caps' ? 1 : 0,
      fillColor,
      fillFlag: true,
      strokeFlag: false,
    },
    paragraphStyle: {
      justification: text.align === 'justify' ? 'justify-left' : text.align,
      autoLeading: text.lineHeight,
    },
  };
}

function isNativePsdTextSupported(layer: ImageLayer): boolean {
  const text = layer.text;
  if (!text || text.content.length === 0) return false;
  if (text.orientation && text.orientation !== 'horizontal') return false;
  if (text.warp !== 'none' || text.pathReference || text.pathLayout) return false;
  if ((layer.effects?.length ?? 0) > 0 || layer.mask || layer.maskLinkSourceLayerId) return false;
  return parsePsdTextColor(text.color) !== null;
}

function psdLayerTextToImageTextStyle(text: PsdLayerTextData | undefined): ImageLayer['text'] | undefined {
  if (!text?.text || text.orientation && text.orientation !== 'horizontal') return undefined;
  if (text.warp?.style && text.warp.style !== 'none') return undefined;
  const color = psdTextColorToHex(text.style?.fillColor);
  if (!color) return undefined;
  const fontSize = Math.max(1, Math.round(text.style?.fontSize ?? 12));
  const boxWidth = text.shapeType === 'box' ? Math.max(1, Math.round((text.right ?? 0) - (text.left ?? 0))) : null;
  const boxHeight = text.shapeType === 'box' ? Math.max(1, Math.round((text.bottom ?? 0) - (text.top ?? 0))) : null;

  return {
    content: text.text,
    fontFamily: text.style?.font?.name || 'Arial',
    fontSize,
    fontWeight: text.style?.fauxBold ? '700' : '400',
    fontStyle: text.style?.fauxItalic ? 'italic' : 'normal',
    fontKerning: text.style?.autoKerning === false ? 'none' : 'auto',
    fontVariantCaps: text.style?.fontCaps === 2 ? 'all-small-caps' : text.style?.fontCaps === 1 ? 'small-caps' : 'normal',
    letterSpacing: ((text.style?.tracking ?? 0) * fontSize) / 1000,
    baselineShift: text.style?.baselineShift ?? 0,
    boxWidth,
    boxHeight,
    wrap: text.shapeType === 'box',
    color,
    lineHeight: normalizePsdTextLineHeight(text.style?.leading, fontSize),
    align: psdTextJustificationToImageAlign(text.paragraphStyle?.justification),
    verticalAlign: 'top',
    warp: 'none',
  };
}

function parsePsdTextColor(value: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function psdTextColorToHex(value: PsdColor | undefined): string | null {
  if (!value || typeof value !== 'object' || !('r' in value) || !('g' in value) || !('b' in value)) return null;
  const channels = [value.r, value.g, value.b];
  if (channels.some((channel) => typeof channel !== 'number' || !Number.isFinite(channel))) return null;
  return `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

function psdFontName(fontFamily: string): string {
  return fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || 'Arial';
}

function isPsdTextBold(fontWeight: string): boolean {
  const numeric = Number.parseInt(fontWeight, 10);
  return Number.isFinite(numeric) ? numeric >= 600 : /bold|semibold|black|heavy/i.test(fontWeight);
}

function normalizePsdTextLineHeight(leading: number | undefined, fontSize: number): number {
  if (typeof leading !== 'number' || !Number.isFinite(leading) || leading <= 0) return 1.2;
  return Math.max(0.75, Math.min(3, leading / fontSize));
}

function psdTextJustificationToImageAlign(value: PsdJustification | undefined): NonNullable<ImageLayer['text']>['align'] {
  if (value === 'center' || value === 'right') return value;
  if (typeof value === 'string' && value.startsWith('justify')) return 'justify';
  return 'left';
}

function psdGroupToImageLayer(layer: PsdLayer, id: string, groupId?: string): ImageLayer {
  return {
    id,
    name: layer.name?.trim() || 'PSD Group',
    type: 'group',
    visible: !layer.hidden,
    locked: false,
    opacity: clamp01(layer.opacity ?? 1),
    blendMode: psdBlendModeToImageBlendMode(layer.blendMode),
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: layer.mask?.imageData ? bitmapFromPsdMask(layer.mask.imageData) : null,
    ...(typeof layer.mask?.userMaskDensity === 'number' ? { maskDensity: layer.mask.userMaskDensity } : {}),
    ...(typeof layer.mask?.userMaskFeather === 'number' ? { maskFeather: layer.mask.userMaskFeather } : {}),
    groupExpanded: layer.opened !== false,
    ...(groupId ? { groupId } : {}),
  };
}

function collectPsdImageLayers(
  layers: PsdLayer[],
  docId: string,
  linkedFiles: Psd['linkedFiles'] = [],
): ImageLayer[] {
  const output: ImageLayer[] = [];
  let groupIndex = 0;

  const appendBottomToTop = (candidates: PsdLayer[], parentGroupId?: string) => {
    for (const layer of [...candidates].reverse()) {
      if (Array.isArray(layer.children)) {
        const groupId = `${docId}-group-${groupIndex + 1}`;
        groupIndex += 1;
        output.push(psdGroupToImageLayer(layer, groupId, parentGroupId));
        appendBottomToTop(layer.children, groupId);
        continue;
      }
      if (layer.imageData || layer.canvas) {
        output.push(psdLayerToImageLayer(layer, docId, output.length, parentGroupId, linkedFiles));
      }
    }
  };

  appendBottomToTop(layers);

  return output;
}

function bitmapToPsdImageData(bitmap: LayerBitmap): PixelData {
  const imageData = getBitmapImageData(bitmap);
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

function bitmapFromPsdMask(pixelData: PixelData): LayerBitmap {
  const bitmap = createBitmap(Math.max(1, pixelData.width), Math.max(1, pixelData.height));
  putBitmapImageData(bitmap, pixelDataToImageData(pixelData));
  return bitmap;
}

function pixelDataToImageData(pixelData: PixelData): ImageData {
  const data = new Uint8ClampedArray(pixelData.data);
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, pixelData.width, pixelData.height);
  }
  return {
    width: pixelData.width,
    height: pixelData.height,
    data,
  } as ImageData;
}

function ensureAgPsdCanvas(): void {
  if (agPsdCanvasInitialized) return;

  initializeCanvas(
    (width, height) => {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
      }
      throw new Error('PSD import/export requires a canvas-capable browser environment.');
    },
    (width, height) => {
      if (typeof ImageData !== 'undefined') {
        return new ImageData(width, height);
      }
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('PSD import/export could not create ImageData.');
      }
      return ctx.createImageData(width, height);
    },
  );

  agPsdCanvasInitialized = true;
}

function imageBlendModeToPsdBlendMode(mode: BlendMode): PsdBlendMode {
  switch (mode) {
    case 'color-dodge':
      return 'color dodge';
    case 'color-burn':
      return 'color burn';
    case 'hard-light':
      return 'hard light';
    case 'soft-light':
      return 'soft light';
    default:
      return mode;
  }
}

function psdBlendModeToImageBlendMode(mode: PsdBlendMode | undefined): BlendMode {
  switch (mode) {
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'difference':
    case 'exclusion':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return mode;
    case 'color dodge':
      return 'color-dodge';
    case 'color burn':
      return 'color-burn';
    case 'hard light':
      return 'hard-light';
    case 'soft light':
      return 'soft-light';
    default:
      return 'normal';
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}
