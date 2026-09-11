import type { BlendMode, ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import { flattenImageDocumentToBitmap } from './ImageDocumentExport';
import { renderLayerWithEffects } from './ImageLayerEffects';
import { rasterizeLayerBitmapTransformed } from './ImageLayerTransform';

export const IMAGE_XCF_MIME_TYPE = 'image/x-xcf';
export const IMAGE_XCF_EXTENSION = 'xcf';

export type SignalLoomXcfExportMode = 'native-raster' | 'flattened-raster' | 'omitted-unsupported';
export type SignalLoomXcfDetectionConfidence = 'extension-and-mime' | 'extension' | 'mime' | 'none';
export type SignalLoomXcfExportCompatibilityLevel = 'layered-raster-export-only';
export type SignalLoomXcfFallbackRouteKind = 'png' | 'tiff' | 'psd' | 'source-library';
export type SignalLoomXcfFallbackRecommendationAction =
  | 'convert-layered-handoff'
  | 'convert-visible-composite'
  | 'convert-visible-preview'
  | 'archive-original';
export type SignalLoomXcfNativeHeaderState =
  | 'recognized-xcf-header'
  | 'missing-header-bytes'
  | 'unrecognized-header';
export type SignalLoomXcfNativeHeaderSignature = 'gimp-xcf' | 'not-provided' | 'unknown';
export type SignalLoomXcfNativeDecodeStatus = 'bounded-import' | 'not-xcf-source';
export type SignalLoomXcfNativeDecodeAction = 'open-as-pixels' | 'ignore-non-xcf';
export type SignalLoomXcfNativeBlockedOperation =
  | 'reconstruct-editable-text'
  | 'reconstruct-groups'
  | 'reconstruct-filter-stacks'
  | 'reconstruct-source-links';
export type SignalLoomXcfNativeUnsupportedStateCode =
  | 'native-edit-state-decode-unavailable';

export interface SignalLoomXcfSourceIdentityInput {
  fileName?: string;
  mimeType?: string;
}

export interface SignalLoomXcfSourceIdentity {
  extension: string | null;
  mimeType: string | null;
  isXcfExtension: boolean;
  isXcfMimeType: boolean;
  isXcf: boolean;
  confidence: SignalLoomXcfDetectionConfidence;
}

export interface SignalLoomXcfImportReadinessInput extends SignalLoomXcfSourceIdentityInput {
  bytes?: ArrayBufferLike | Uint8Array;
  sourceLibraryItemId?: string;
}

export interface SignalLoomXcfFallbackRoute {
  route: SignalLoomXcfFallbackRouteKind;
  label: string;
  preserves: string;
  recommendedFor: string;
  caveat: string;
}

export interface SignalLoomXcfFallbackRecommendation extends SignalLoomXcfFallbackRoute {
  rank: number;
  action: SignalLoomXcfFallbackRecommendationAction;
}

export interface SignalLoomXcfNativeHeaderDescriptor {
  provided: boolean;
  recognized: boolean;
  signature: SignalLoomXcfNativeHeaderSignature;
  version: string | null;
  state: SignalLoomXcfNativeHeaderState;
}

export interface SignalLoomXcfNativeUnsupportedState {
  code: SignalLoomXcfNativeUnsupportedStateCode;
  summary: string;
}

export interface SignalLoomXcfNativeDecodeStateDescriptor {
  version: 1;
  kind: 'signal-loom-xcf-native-decode-state';
  detection: SignalLoomXcfSourceIdentity;
  header: SignalLoomXcfNativeHeaderDescriptor;
  decode: {
    status: SignalLoomXcfNativeDecodeStatus;
    canDecodePixels: true;
    canDecodeNativeEditState: false;
    unsupportedReason: null;
    unsupportedStates: SignalLoomXcfNativeUnsupportedState[];
    blockedOperations: SignalLoomXcfNativeBlockedOperation[];
  };
  recommendedAction: SignalLoomXcfNativeDecodeAction;
  fallbackRecommendations: SignalLoomXcfFallbackRecommendation[];
  stableSignature: string;
}

export interface SignalLoomXcfRoundTripRiskDescriptor {
  level: 'high';
  nativeReopenSupported: false;
  sourceEditStatePreserved: false;
  summary: string;
  affectedConstructs: SignalLoomXcfNativeConstruct[];
  recommendedFallbackRoutes: SignalLoomXcfFallbackRouteKind[];
  blockers: string[];
}

export interface SignalLoomXcfImportReadinessPolicy {
  version: 1;
  kind: 'signal-loom-xcf-import-readiness';
  detection: SignalLoomXcfSourceIdentity;
  import: {
    supported: true;
    status: 'bounded-raster-import';
    canOpenAsPixels: true;
    message: string;
  };
  fallbackRoutes: SignalLoomXcfFallbackRoute[];
  fallbackRecommendations: SignalLoomXcfFallbackRecommendation[];
  nativeDecodeState: SignalLoomXcfNativeDecodeStateDescriptor;
  exportCompatibilityLevel: SignalLoomXcfExportCompatibilityLevel;
  caveats: {
    layers: string;
    masks: string;
    groups: string;
    text: string;
    effects: string;
    filters: string;
    sourceLinks: string;
  };
  sourcePolicy: {
    importSignature: string;
    exportSignature: string;
    nativeRoundtrip: 'unsupported';
  };
  compatibilitySignature: string;
  policyWarnings: SignalLoomXcfPolicyWarning[];
  roundTripRisk: SignalLoomXcfRoundTripRiskDescriptor;
}

export type SignalLoomXcfExportWarningCode =
  | 'editable-text-flattened'
  | 'layer-effects-flattened'
  | 'layer-masks-flattened'
  | 'source-links-flattened'
  | 'filter-metadata-flattened'
  | 'adjustment-layers-omitted'
  | 'layer-groups-omitted';

export type SignalLoomXcfPolicyWarningCode =
  | SignalLoomXcfExportWarningCode
  | 'xcf-editable-state-loss';

export type SignalLoomXcfPolicyWarningScope = 'import' | 'export';
export type SignalLoomXcfNativeConstruct =
  | 'xcf-document'
  | 'text'
  | 'layer-effects'
  | 'layer-mask'
  | 'source-link'
  | 'filter-stack'
  | 'adjustment-layer'
  | 'layer-group';
export type SignalLoomXcfPolicyPreservation = 'unsupported' | 'flattened-raster' | 'omitted';

export interface SignalLoomXcfExportWarning {
  code: SignalLoomXcfExportWarningCode;
  severity: 'warning';
  layerIds: string[];
  message: string;
}

export interface SignalLoomXcfPolicyWarning {
  descriptorId: string;
  scope: SignalLoomXcfPolicyWarningScope;
  code: SignalLoomXcfPolicyWarningCode;
  nativeConstruct: SignalLoomXcfNativeConstruct;
  affectedLayerIds: string[];
  preservation: SignalLoomXcfPolicyPreservation;
  nativeRoundtrip: 'unsupported';
  fallbackRoute: SignalLoomXcfFallbackRouteKind;
  message: string;
}

export interface SignalLoomXcfExportLayerDescriptor {
  id: string;
  name: string;
  type: ImageLayer['type'];
  order: number;
  xcfLayerIndex: number | null;
  exportMode: SignalLoomXcfExportMode;
  flattened: boolean;
  omitted: boolean;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  text?: {
    contentLength: number;
    fontFamily?: string;
    fontSize?: number;
    nativeEditableText: false;
  };
  effects?: {
    count: number;
    kinds: string[];
    enabledKinds: string[];
    nativeLayerEffects: false;
  };
  mask?: {
    width: number;
    height: number;
    nativeLayerMask: false;
  };
  sourceLink?: {
    id: string;
    label?: string;
    status: NonNullable<NonNullable<ImageLayer['metadata']>['sourceLink']>['status'] | 'linked';
    nativeSmartObject: false;
  };
  filters?: {
    count: number;
    enabledCount: number;
    kinds: string[];
    nativeSmartFilters: false;
    metadataOnly: true;
  };
  adjustment?: {
    kind: NonNullable<ImageLayer['adjustment']>['kind'];
    nativeAdjustmentLayer: false;
  };
  warningCodes: SignalLoomXcfExportWarningCode[];
}

export interface SignalLoomXcfRetainedMetadataSummary {
  textLayerIds: string[];
  effectLayerIds: string[];
  sourceLinkedLayerIds: string[];
  filterLayerIds: string[];
}

export interface SignalLoomXcfLayerRoundTripWarning {
  code: SignalLoomXcfExportWarningCode;
  severity: 'warning';
  message: string;
  fallbackRoute: SignalLoomXcfFallbackRouteKind;
  flattened: boolean;
  omitted: boolean;
}

export interface SignalLoomXcfLayerWarningDescriptor {
  layerId: string;
  layerName: string;
  exportMode: SignalLoomXcfExportMode;
  flattened: boolean;
  omitted: boolean;
  warnings: SignalLoomXcfLayerRoundTripWarning[];
}

export interface SignalLoomXcfLayerConstructWarningDescriptor {
  descriptorId: string;
  layerId: string;
  layerName: string;
  code: SignalLoomXcfExportWarningCode;
  nativeConstruct: SignalLoomXcfNativeConstruct;
  preservation: SignalLoomXcfPolicyPreservation;
  fallbackRoute: SignalLoomXcfFallbackRouteKind;
  exportMode: SignalLoomXcfExportMode;
  flattened: boolean;
  omitted: boolean;
  message: string;
}

export interface SignalLoomXcfExportCompatibilityDescriptor {
  version: 1;
  kind: 'signal-loom-xcf-export-compatibility';
  format: {
    label: 'XCF';
    mimeType: typeof IMAGE_XCF_MIME_TYPE;
    extension: typeof IMAGE_XCF_EXTENSION;
  };
  import: {
    supported: true;
    status: 'bounded-raster-import';
    canOpenAsPixels: true;
    recommendedHandoffFormats: ['PSD', 'TIFF', 'PNG', 'JPEG'];
    message: string;
  };
  export: {
    supported: true;
    status: 'layered-raster-export-only';
    layerOrder: 'bottom-to-top';
    xcfLayerOrder: 'bottom-to-top';
    preservesRasterLayers: true;
    preservesEditableText: false;
    preservesAdjustmentLayers: false;
    preservesLayerEffects: false;
    preservesLayerMasks: false;
    preservesLayerGroups: false;
    preservesSourceLinks: false;
  };
  summary: {
    layerCount: number;
    exportedRasterLayerCount: number;
    skippedLayerCount: number;
    flattenedLayerCount: number;
    textLayerCount: number;
    adjustmentLayerCount: number;
    effectLayerCount: number;
    maskLayerCount: number;
    filterLayerCount: number;
    groupCount: number;
    sourceLinkedLayerCount: number;
    warningCount: number;
  };
  sourcePolicy: {
    signature: string;
    importAction: 'open-as-pixels';
    exportAction: 'export-layered-raster';
    nativeRoundtrip: 'unsupported';
  };
  compatibilitySignature: string;
  recommendedFallbackRoutes: SignalLoomXcfFallbackRoute[];
  fallbackRecommendations: SignalLoomXcfFallbackRecommendation[];
  retainedMetadata: SignalLoomXcfRetainedMetadataSummary;
  layerWarnings: SignalLoomXcfLayerWarningDescriptor[];
  layerConstructWarnings: SignalLoomXcfLayerConstructWarningDescriptor[];
  policyWarnings: SignalLoomXcfPolicyWarning[];
  roundTripRisk: SignalLoomXcfRoundTripRiskDescriptor;
  compatibilitySummary: string;
  roundTripCaveats: string[];
  warnings: SignalLoomXcfExportWarning[];
  layers: SignalLoomXcfExportLayerDescriptor[];
}

interface XcfLayerExport {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  mode: number;
  imageData: ImageData;
  active: boolean;
}

const XCF_TILE_SIZE = 64;
const XCF_IMPORT_SUPPORTED_MESSAGE = 'GIMP XCF workfiles import as layered raster documents: 8-bit RGB, grayscale, and indexed layers and masks with uncompressed, RLE, or zlib tiles. Editable text, groups, filters, and source links are not reconstructed.';
const XCF_DETECTED_SUPPORTED_MESSAGE = 'GIMP XCF workfiles are detected and import as layered raster documents within the documented limits; native XCF edit state is not reconstructed.';
const XCF_MIME_TYPES = new Set(['image/x-xcf', 'image/x-gimp-xcf', 'image/xcf']);
const XCF_NATIVE_BLOCKED_OPERATIONS: SignalLoomXcfNativeBlockedOperation[] = [
  'reconstruct-editable-text',
  'reconstruct-groups',
  'reconstruct-filter-stacks',
  'reconstruct-source-links',
];
const XCF_NATIVE_UNSUPPORTED_STATES: SignalLoomXcfNativeUnsupportedState[] = [
  {
    code: 'native-edit-state-decode-unavailable',
    summary: 'Image does not reconstruct editable XCF text, groups, filters, effects, or source-link state; those constructs import as flattened pixels or explicit warnings.',
  },
];
const XCF_IMPORT_RISK_CONSTRUCTS: SignalLoomXcfNativeConstruct[] = [
  'xcf-document',
  'text',
  'layer-effects',
  'layer-mask',
  'source-link',
  'filter-stack',
  'adjustment-layer',
  'layer-group',
];

export function detectXcfSourceIdentity(input: SignalLoomXcfSourceIdentityInput): SignalLoomXcfSourceIdentity {
  const extension = normalizeXcfExtension(input.fileName);
  const mimeType = normalizeXcfMimeType(input.mimeType);
  const isXcfExtension = extension === IMAGE_XCF_EXTENSION;
  const isXcfMimeType = Boolean(mimeType && XCF_MIME_TYPES.has(mimeType));
  const confidence = getXcfDetectionConfidence(isXcfExtension, isXcfMimeType);

  return {
    extension,
    mimeType,
    isXcfExtension,
    isXcfMimeType,
    isXcf: isXcfExtension || isXcfMimeType,
    confidence,
  };
}

export function describeXcfNativeDecodeState(
  input: SignalLoomXcfImportReadinessInput = {},
): SignalLoomXcfNativeDecodeStateDescriptor {
  const detection = detectXcfSourceIdentity(input);
  const header = inspectXcfHeader(input.bytes);
  const isXcfCandidate = detection.isXcf || header.recognized;
  const status: SignalLoomXcfNativeDecodeStatus = isXcfCandidate ? 'bounded-import' : 'not-xcf-source';
  const fallbackRecommendations = isXcfCandidate ? buildXcfFallbackRecommendations() : [];

  return {
    version: 1,
    kind: 'signal-loom-xcf-native-decode-state',
    detection,
    header,
    decode: {
      status,
      canDecodePixels: true,
      canDecodeNativeEditState: false,
      unsupportedReason: null,
      unsupportedStates: status === 'bounded-import' ? XCF_NATIVE_UNSUPPORTED_STATES : [],
      blockedOperations: status === 'bounded-import' ? XCF_NATIVE_BLOCKED_OPERATIONS : [],
    },
    recommendedAction: status === 'bounded-import' ? 'open-as-pixels' : 'ignore-non-xcf',
    fallbackRecommendations,
    stableSignature: buildXcfNativeDecodeStateSignature(detection, header, status, fallbackRecommendations),
  };
}

export function describeXcfImportReadinessPolicy(
  input: SignalLoomXcfImportReadinessInput = {},
): SignalLoomXcfImportReadinessPolicy {
  const detection = detectXcfSourceIdentity(input);
  const nativeDecodeState = describeXcfNativeDecodeState(input);
  const policyWarnings = buildXcfPolicyWarnings([{
    code: 'xcf-editable-state-loss',
    severity: 'warning',
    layerIds: [],
    message: 'Imported XCF layers are raster pixels: editable text, groups, filters, effects, and source links are not reconstructed as native Image constructs.',
  }]);

  return {
    version: 1,
    kind: 'signal-loom-xcf-import-readiness',
    detection,
    import: {
      supported: true,
      status: 'bounded-raster-import',
      canOpenAsPixels: true,
      message: XCF_DETECTED_SUPPORTED_MESSAGE,
    },
    fallbackRoutes: buildXcfFallbackRoutes(),
    fallbackRecommendations: buildXcfFallbackRecommendations(),
    nativeDecodeState,
    exportCompatibilityLevel: 'layered-raster-export-only',
    caveats: {
      layers: 'XCF raster layers import as layered Image documents within the documented pixel, layer, and compression limits.',
      masks: 'XCF layer masks import as real Image masks when the source applied them.',
      groups: 'Native XCF group folders are flattened to a flat layer list with an explicit warning; child layers keep their stack order.',
      text: 'Editable XCF text is imported as raster pixels with an explicit per-layer warning.',
      effects: 'Native GIMP effects are not reconstructed; effect state imports as the pixels GIMP rendered.',
      filters: 'GIMP filter/plugin state is not reconstructed as native editable filters.',
      sourceLinks: 'Source-linked layers and Smart Object-like relationships are not reconstructed as native XCF links.',
    },
    sourcePolicy: {
      importSignature: buildXcfImportPolicySignature(detection, input.sourceLibraryItemId),
      exportSignature: 'xcf-export:v1|level=layered-raster-export-only|nativeRoundtrip=unsupported',
      nativeRoundtrip: 'unsupported',
    },
    compatibilitySignature: buildXcfImportCompatibilitySignature(detection),
    policyWarnings,
    roundTripRisk: buildXcfImportRoundTripRisk(),
  };
}

export function describeImageDocumentXcfExportCompatibility(
  doc: ImageDocument,
): SignalLoomXcfExportCompatibilityDescriptor {
  const xcfLayerIndexByLayerId = buildXcfLayerIndexByLayerId(doc.layers);
  const layers = doc.layers.map((layer, order) => buildXcfExportLayerDescriptor(
    layer,
    order,
    xcfLayerIndexByLayerId.get(layer.id) ?? null,
  ));
  const warnings = buildXcfExportWarnings(layers);
  const retainedMetadata = buildXcfRetainedMetadataSummary(layers);
  const policyWarnings = buildXcfPolicyWarnings(warnings);

  return {
    version: 1,
    kind: 'signal-loom-xcf-export-compatibility',
    format: { label: 'XCF', mimeType: IMAGE_XCF_MIME_TYPE, extension: IMAGE_XCF_EXTENSION },
    import: {
      supported: true,
      status: 'bounded-raster-import',
      canOpenAsPixels: true,
      recommendedHandoffFormats: ['PSD', 'TIFF', 'PNG', 'JPEG'],
      message: XCF_IMPORT_SUPPORTED_MESSAGE,
    },
    export: {
      supported: true,
      status: 'layered-raster-export-only',
      layerOrder: 'bottom-to-top',
      xcfLayerOrder: 'bottom-to-top',
      preservesRasterLayers: true,
      preservesEditableText: false,
      preservesAdjustmentLayers: false,
      preservesLayerEffects: false,
      preservesLayerMasks: false,
      preservesLayerGroups: false,
      preservesSourceLinks: false,
    },
    summary: {
      layerCount: layers.length,
      exportedRasterLayerCount: layers.filter((layer) => !layer.omitted).length,
      skippedLayerCount: layers.filter((layer) => layer.omitted).length,
      flattenedLayerCount: layers.filter((layer) => layer.flattened).length,
      textLayerCount: layers.filter((layer) => layer.text).length,
      adjustmentLayerCount: layers.filter((layer) => layer.adjustment).length,
      effectLayerCount: layers.filter((layer) => layer.effects).length,
      maskLayerCount: layers.filter((layer) => layer.mask).length,
      filterLayerCount: layers.filter((layer) => layer.filters).length,
      groupCount: layers.filter((layer) => layer.type === 'group').length,
      sourceLinkedLayerCount: layers.filter((layer) => layer.sourceLink).length,
      warningCount: warnings.length,
    },
    sourcePolicy: {
      signature: buildXcfSourcePolicySignature(layers, warnings),
      importAction: 'open-as-pixels',
      exportAction: 'export-layered-raster',
      nativeRoundtrip: 'unsupported',
    },
    compatibilitySignature: buildXcfCompatibilitySignature(layers, warnings),
    recommendedFallbackRoutes: buildXcfFallbackRoutes(),
    fallbackRecommendations: buildXcfFallbackRecommendations(),
    retainedMetadata,
    layerWarnings: buildXcfLayerWarnings(layers),
    layerConstructWarnings: buildXcfLayerConstructWarnings(layers),
    policyWarnings,
    roundTripRisk: buildXcfExportRoundTripRisk(warnings),
    compatibilitySummary: 'XCF raster layers and masks export from and re-open in Image; editable text, effects, filters, groups, and source links stay raster or metadata-only.',
    roundTripCaveats: buildXcfRoundTripCaveats(warnings),
    warnings,
    layers,
  };
}

export async function imageDocumentToXcfBlob(doc: ImageDocument): Promise<Blob> {
  const bytes = imageDocumentToXcfBytes(doc);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Blob([body], { type: IMAGE_XCF_MIME_TYPE });
}

export function imageDocumentToXcfBytes(doc: ImageDocument): Uint8Array {
  const layers = collectXcfLayers(doc);
  const writer = new XcfWriter();
  const layerPointerOffsets: number[] = [];

  writer.writeAscii('gimp xcf v003');
  writer.writeByte(0);
  writer.writeU32(doc.width);
  writer.writeU32(doc.height);
  writer.writeU32(0);
  writeProperty(writer, 17, [0]);
  writePropertyEnd(writer);

  // XCF stores the display stack top-first. Image keeps document layers bottom-first, so both
  // the pointer list and layer records must be emitted in reverse document order.
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    layerPointerOffsets.push(writer.reserveU32());
  }
  writer.writeU32(0);
  writer.writeU32(0);
  writer.writeU32(0);

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    const pointerOffset = layerPointerOffsets[layers.length - 1 - index];
    writer.patchU32(pointerOffset, writer.offset);
    writeLayer(writer, layer);
  }

  return writer.toUint8Array();
}

function collectXcfLayers(doc: ImageDocument): XcfLayerExport[] {
  const layers = doc.layers
    .map((layer) => imageLayerToXcfLayer(layer, layer.id === doc.activeLayerId))
    .filter((layer): layer is XcfLayerExport => Boolean(layer));

  if (layers.length > 0) return layers;

  const bitmap = flattenImageDocumentToBitmap(doc);
  return [{
    name: doc.title || 'Visible Composite',
    width: bitmap.width,
    height: bitmap.height,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    mode: 0,
    imageData: getBitmapImageData(bitmap),
    active: true,
  }];
}

function imageLayerToXcfLayer(layer: ImageLayer, active: boolean): XcfLayerExport | null {
  if (!layer.bitmap || layer.type === 'adjustment') return null;

  const rendered = renderLayerWithEffects(layer);
  const raster = rasterizeLayerBitmapTransformed(
    rendered?.bitmap ?? layer.bitmap,
    layer,
    rendered?.offsetX ?? 0,
    rendered?.offsetY ?? 0,
  );

  return {
    name: layer.name || 'Layer',
    width: raster.bitmap.width,
    height: raster.bitmap.height,
    x: raster.left,
    y: raster.top,
    visible: layer.visible,
    opacity: clamp01(layer.opacity),
    mode: imageBlendModeToXcfMode(layer.blendMode),
    imageData: getBitmapImageData(raster.bitmap as LayerBitmap),
    active,
  };
}

function normalizeXcfExtension(fileName: string | undefined): string | null {
  const trimmed = fileName?.trim();
  if (!trimmed) return null;
  const lastSegment = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) return null;
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function normalizeXcfMimeType(mimeType: string | undefined): string | null {
  const normalized = mimeType?.trim().toLowerCase();
  return normalized || null;
}

function getXcfDetectionConfidence(
  isXcfExtension: boolean,
  isXcfMimeType: boolean,
): SignalLoomXcfDetectionConfidence {
  if (isXcfExtension && isXcfMimeType) return 'extension-and-mime';
  if (isXcfExtension) return 'extension';
  if (isXcfMimeType) return 'mime';
  return 'none';
}

function inspectXcfHeader(bytes: ArrayBufferLike | Uint8Array | undefined): SignalLoomXcfNativeHeaderDescriptor {
  const view = normalizeXcfByteView(bytes);
  if (!view || view.byteLength === 0) {
    return {
      provided: false,
      recognized: false,
      signature: 'not-provided',
      version: null,
      state: 'missing-header-bytes',
    };
  }

  let headerText = '';
  const length = Math.min(view.byteLength, 14);
  for (let index = 0; index < length; index += 1) {
    const byte = view[index];
    if (byte === 0) break;
    headerText += String.fromCharCode(byte);
  }

  const match = /^gimp xcf(?:\s+(v\d{3}))?/i.exec(headerText);
  if (match) {
    return {
      provided: true,
      recognized: true,
      signature: 'gimp-xcf',
      version: match[1]?.toLowerCase() ?? null,
      state: 'recognized-xcf-header',
    };
  }

  return {
    provided: true,
    recognized: false,
    signature: 'unknown',
    version: null,
    state: 'unrecognized-header',
  };
}

function normalizeXcfByteView(bytes: ArrayBufferLike | Uint8Array | undefined): Uint8Array | null {
  if (!bytes) return null;
  if (bytes instanceof Uint8Array) return bytes;
  return new Uint8Array(bytes);
}

function buildXcfFallbackRoutes(): SignalLoomXcfFallbackRoute[] {
  return [
    {
      route: 'png',
      label: 'PNG visible composite',
      preserves: 'flattened pixels and transparency',
      recommendedFor: 'Preview or lightweight flattened exchange.',
      caveat: 'Loses layers, masks, text editability, effects, and source links.',
    },
    {
      route: 'tiff',
      label: 'TIFF visible composite',
      preserves: 'flattened print-oriented pixels',
      recommendedFor: 'Visible composite handoff after editing elsewhere.',
      caveat: 'Use 8-bit uncompressed TIFF; layered/native XCF state, text editability, effects, and source links are not reconstructed.',
    },
    {
      route: 'psd',
      label: 'PSD layered handoff',
      preserves: 'best-effort layers and metadata',
      recommendedFor: 'Best route when you still need a layered document Image can reopen.',
      caveat: 'Still may flatten native XCF text, masks, effects, groups, source links, and blend behavior depending on GIMP export.',
    },
    {
      route: 'source-library',
      label: 'Keep original in Source Library',
      preserves: 'the original XCF file as a managed source asset',
      recommendedFor: 'Archive provenance while using converted derivatives in Image.',
      caveat: 'Stored for handoff/reference only; it is not decoded into an editable Image document.',
    },
  ];
}

function buildXcfFallbackRecommendations(): SignalLoomXcfFallbackRecommendation[] {
  const routesByKind = new Map(buildXcfFallbackRoutes().map((route) => [route.route, route] as const));
  return [
    {
      ...getXcfFallbackRoute(routesByKind, 'psd'),
      rank: 1,
      action: 'convert-layered-handoff',
    },
    {
      ...getXcfFallbackRoute(routesByKind, 'tiff'),
      rank: 2,
      action: 'convert-visible-composite',
    },
    {
      ...getXcfFallbackRoute(routesByKind, 'png'),
      rank: 3,
      action: 'convert-visible-preview',
    },
    {
      ...getXcfFallbackRoute(routesByKind, 'source-library'),
      rank: 4,
      action: 'archive-original',
    },
  ];
}

function getXcfFallbackRoute(
  routesByKind: Map<SignalLoomXcfFallbackRouteKind, SignalLoomXcfFallbackRoute>,
  route: SignalLoomXcfFallbackRouteKind,
): SignalLoomXcfFallbackRoute {
  const fallback = routesByKind.get(route);
  if (!fallback) throw new Error(`Missing XCF fallback route: ${route}`);
  return fallback;
}

function buildXcfImportPolicySignature(
  detection: SignalLoomXcfSourceIdentity,
  sourceLibraryItemId: string | undefined,
): string {
  return [
    'xcf-import:v1',
    `detected=${detection.confidence}`,
    'status=bounded-raster-import',
    'pixels=8bit-none-rle-zlib',
    `fallbacks=${buildXcfFallbackRoutes().map((route) => route.route).join(',')}`,
    `source=${sourceLibraryItemId?.trim() || 'untracked'}`,
  ].join('|');
}

function buildXcfNativeDecodeStateSignature(
  detection: SignalLoomXcfSourceIdentity,
  header: SignalLoomXcfNativeHeaderDescriptor,
  status: SignalLoomXcfNativeDecodeStatus,
  fallbackRecommendations: SignalLoomXcfFallbackRecommendation[],
): string {
  return [
    'xcf-native-decode:v1',
    `detected=${detection.confidence}`,
    `header=${formatXcfHeaderSignature(header)}`,
    `status=${status}`,
    'pixels=true|8bit|none-rle-zlib',
    'editState=false',
    `fallbacks=${fallbackRecommendations.map((route) => route.route).join(',') || 'none'}`,
  ].join('|');
}

function formatXcfHeaderSignature(header: SignalLoomXcfNativeHeaderDescriptor): string {
  if (header.signature !== 'gimp-xcf') return header.signature;
  return `gimp-xcf-${header.version ?? 'unknown'}`;
}

function buildXcfImportCompatibilitySignature(detection: SignalLoomXcfSourceIdentity): string {
  return [
    'xcf-import-compatibility:v1',
    `detected=${detection.confidence}`,
    'import=bounded-raster',
    'export=layered-raster-export-only',
    `fallbacks=${buildXcfFallbackRoutes().map((route) => route.route).join(',')}`,
  ].join('|');
}

function buildXcfCompatibilitySignature(
  layers: SignalLoomXcfExportLayerDescriptor[],
  warnings: SignalLoomXcfExportWarning[],
): string {
  return [
    'xcf-compatibility:v1',
    'import=bounded-raster',
    'export=layered-raster-export-only',
    `layers=${layers.length}`,
    `exported=${layers.filter((layer) => !layer.omitted).length}`,
    `omitted=${layers.filter((layer) => layer.omitted).length}`,
    `flattened=${layers.filter((layer) => layer.flattened).length}`,
    `warnings=${warnings.map((warning) => warning.code).join(',') || 'none'}`,
  ].join('|');
}

function buildXcfRetainedMetadataSummary(
  layers: SignalLoomXcfExportLayerDescriptor[],
): SignalLoomXcfRetainedMetadataSummary {
  return {
    textLayerIds: layers.filter((layer) => layer.text).map((layer) => layer.id),
    effectLayerIds: layers.filter((layer) => layer.effects).map((layer) => layer.id),
    sourceLinkedLayerIds: layers.filter((layer) => layer.sourceLink).map((layer) => layer.id),
    filterLayerIds: layers.filter((layer) => layer.filters).map((layer) => layer.id),
  };
}

function buildXcfLayerWarnings(
  layers: SignalLoomXcfExportLayerDescriptor[],
): SignalLoomXcfLayerWarningDescriptor[] {
  return layers
    .map((layer) => ({
      layerId: layer.id,
      layerName: layer.name,
      exportMode: layer.exportMode,
      flattened: layer.flattened,
      omitted: layer.omitted,
      warnings: layer.warningCodes.map((code) => buildXcfLayerRoundTripWarning(code, layer)),
    }))
    .filter((layer) => layer.warnings.length > 0);
}

function buildXcfLayerConstructWarnings(
  layers: SignalLoomXcfExportLayerDescriptor[],
): SignalLoomXcfLayerConstructWarningDescriptor[] {
  return layers.flatMap((layer) => layer.warningCodes.map((code) => ({
    descriptorId: `xcf-layer-construct-warning:v1|layer=${layer.id}|code=${code}`,
    layerId: layer.id,
    layerName: layer.name,
    code,
    nativeConstruct: describeXcfPolicyWarningNativeConstruct(code),
    preservation: describeXcfPolicyWarningPreservation(code),
    fallbackRoute: describeXcfLayerWarningFallbackRoute(code),
    exportMode: layer.exportMode,
    flattened: layer.flattened,
    omitted: layer.omitted,
    message: describeXcfLayerWarningMessage(code),
  })));
}

function buildXcfLayerRoundTripWarning(
  code: SignalLoomXcfExportWarningCode,
  layer: SignalLoomXcfExportLayerDescriptor,
): SignalLoomXcfLayerRoundTripWarning {
  return {
    code,
    severity: 'warning',
    message: describeXcfLayerWarningMessage(code),
    fallbackRoute: describeXcfLayerWarningFallbackRoute(code),
    flattened: layer.flattened,
    omitted: layer.omitted,
  };
}

function buildXcfPolicyWarnings(
  warnings: Array<SignalLoomXcfExportWarning | {
    code: 'xcf-editable-state-loss';
    severity: 'warning';
    layerIds: string[];
    message: string;
  }>,
): SignalLoomXcfPolicyWarning[] {
  return warnings.map((warning) => ({
    descriptorId: `xcf-policy-warning:v1|scope=${warning.layerIds.length === 0 ? 'import' : 'export'}|code=${warning.code}`,
    scope: warning.layerIds.length === 0 ? ('import' as const) : ('export' as const),
    code: warning.code,
    nativeConstruct: describeXcfPolicyWarningNativeConstruct(warning.code),
    affectedLayerIds: [...warning.layerIds],
    preservation: describeXcfPolicyWarningPreservation(warning.code),
    nativeRoundtrip: 'unsupported' as const,
    fallbackRoute: describeXcfLayerWarningFallbackRoute(warning.code),
    message: warning.message,
  }));
}

function buildXcfImportRoundTripRisk(): SignalLoomXcfRoundTripRiskDescriptor {
  return {
    level: 'high',
    nativeReopenSupported: false,
    sourceEditStatePreserved: false,
    summary: 'XCF pixels, layers, and masks import into Image, but native XCF edit state (text, groups, filters, effects, source links) cannot round-trip through Image.',
    affectedConstructs: XCF_IMPORT_RISK_CONSTRUCTS,
    recommendedFallbackRoutes: buildXcfFallbackRecommendations().map((route) => route.route),
    blockers: [
      'no native XCF text/effect reconstruction',
      'no native XCF group/filter/source-link roundtrip',
    ],
  };
}

function buildXcfExportRoundTripRisk(
  warnings: SignalLoomXcfExportWarning[],
): SignalLoomXcfRoundTripRiskDescriptor {
  return {
    level: 'high',
    nativeReopenSupported: false,
    sourceEditStatePreserved: false,
    summary: 'Exported XCF files are not native round-trip workfiles for Image; unsupported constructs require fallback handoff formats.',
    affectedConstructs: buildXcfAffectedConstructs(warnings),
    recommendedFallbackRoutes: buildXcfFallbackRecommendations().map((route) => route.route),
    blockers: buildXcfRoundTripRiskBlockers(warnings),
  };
}

function buildXcfAffectedConstructs(
  warnings: SignalLoomXcfExportWarning[],
): SignalLoomXcfNativeConstruct[] {
  const constructs: SignalLoomXcfNativeConstruct[] = [];
  warnings.forEach((warning) => {
    const construct = describeXcfPolicyWarningNativeConstruct(warning.code);
    if (!constructs.includes(construct)) constructs.push(construct);
  });
  return constructs;
}

function buildXcfRoundTripRiskBlockers(warnings: SignalLoomXcfExportWarning[]): string[] {
  const warningCodes = new Set(warnings.map((warning) => warning.code));
  const blockers = ['native XCF edit state (text, groups, filters, effects, source links) does not round-trip as editable constructs'];
  if (warningCodes.has('editable-text-flattened')) {
    blockers.push('editable text exports as raster pixels');
  }
  if (warningCodes.has('layer-effects-flattened')) {
    blockers.push('layer effects export as flattened pixels');
  }
  if (warningCodes.has('layer-masks-flattened')) {
    blockers.push('layer masks export as flattened pixels');
  }
  if (warningCodes.has('source-links-flattened')) {
    blockers.push('source links are not native XCF links');
  }
  if (warningCodes.has('filter-metadata-flattened')) {
    blockers.push('filter stacks are not native editable XCF filters');
  }
  if (warningCodes.has('adjustment-layers-omitted')) {
    blockers.push('adjustment layers are omitted from native XCF layers');
  }
  if (warningCodes.has('layer-groups-omitted')) {
    blockers.push('layer groups are omitted as native XCF folders');
  }
  return blockers;
}

function describeXcfPolicyWarningNativeConstruct(
  code: SignalLoomXcfPolicyWarningCode,
): SignalLoomXcfNativeConstruct {
  switch (code) {
    case 'editable-text-flattened':
      return 'text';
    case 'layer-effects-flattened':
      return 'layer-effects';
    case 'layer-masks-flattened':
      return 'layer-mask';
    case 'source-links-flattened':
      return 'source-link';
    case 'filter-metadata-flattened':
      return 'filter-stack';
    case 'adjustment-layers-omitted':
      return 'adjustment-layer';
    case 'layer-groups-omitted':
      return 'layer-group';
    case 'xcf-editable-state-loss':
    default:
      return 'xcf-document';
  }
}

function describeXcfPolicyWarningPreservation(
  code: SignalLoomXcfPolicyWarningCode,
): SignalLoomXcfPolicyPreservation {
  switch (code) {
    case 'adjustment-layers-omitted':
    case 'layer-groups-omitted':
      return 'omitted';
    case 'xcf-editable-state-loss':
      return 'flattened-raster';
    default:
      return 'flattened-raster';
  }
}

function describeXcfLayerWarningFallbackRoute(
  code: SignalLoomXcfPolicyWarningCode,
): SignalLoomXcfFallbackRouteKind {
  switch (code) {
    case 'source-links-flattened':
      return 'source-library';
    case 'editable-text-flattened':
    case 'layer-effects-flattened':
    case 'layer-masks-flattened':
    case 'filter-metadata-flattened':
    case 'layer-groups-omitted':
      return 'psd';
    case 'adjustment-layers-omitted':
      return 'tiff';
    default:
      return 'png';
  }
}

function describeXcfLayerWarningMessage(code: SignalLoomXcfExportWarningCode): string {
  switch (code) {
    case 'editable-text-flattened':
      return 'Editable text exports to XCF as raster pixels; text remains editable only in the Sloom Studio Image document.';
    case 'layer-effects-flattened':
      return 'Layer effects are rasterized into XCF layer pixels instead of native editable GIMP effects.';
    case 'layer-masks-flattened':
      return 'Layer masks are baked into XCF layer pixels instead of native editable GIMP masks.';
    case 'source-links-flattened':
      return 'Source-linked layer metadata is not written as native XCF link state; keep the original asset in the Source Library.';
    case 'filter-metadata-flattened':
      return 'Filter stacks are retained as Sloom Studio metadata but exported as flattened XCF pixels instead of native editable filters.';
    case 'adjustment-layers-omitted':
      return 'Adjustment layers are omitted from native XCF layers; use a visible flattened format when baked color is required.';
    case 'layer-groups-omitted':
      return 'Layer groups are not written as native XCF folders; exported raster layers remain flat.';
    default:
      return 'XCF native construct is not preserved as editable GIMP state.';
  }
}

function buildXcfLayerIndexByLayerId(layers: ImageLayer[]): Map<string, number> {
  return new Map(
    layers
      .filter(isLayerExportedAsXcfRaster)
      .map((layer, index) => [layer.id, index] as const),
  );
}

function buildXcfExportLayerDescriptor(
  layer: ImageLayer,
  order: number,
  xcfLayerIndex: number | null,
): SignalLoomXcfExportLayerDescriptor {
  const warningCodes = buildXcfLayerWarningCodes(layer, xcfLayerIndex !== null);
  const flattened = xcfLayerIndex !== null && warningCodes.some((code) => (
    code === 'editable-text-flattened'
    || code === 'layer-effects-flattened'
    || code === 'layer-masks-flattened'
    || code === 'source-links-flattened'
    || code === 'filter-metadata-flattened'
  ));
  const descriptor: SignalLoomXcfExportLayerDescriptor = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    order,
    xcfLayerIndex,
    exportMode: xcfLayerIndex === null ? 'omitted-unsupported' : flattened ? 'flattened-raster' : 'native-raster',
    flattened,
    omitted: xcfLayerIndex === null,
    visible: layer.visible,
    opacity: clamp01(layer.opacity),
    blendMode: layer.blendMode,
    warningCodes,
  };

  if (layer.text) {
    descriptor.text = {
      contentLength: layer.text.content.length,
      fontFamily: layer.text.fontFamily,
      fontSize: layer.text.fontSize,
      nativeEditableText: false,
    };
  }
  if (layer.effects?.length) {
    const kinds = Array.from(new Set(layer.effects.map((effect) => effect.kind))).sort((left, right) => left.localeCompare(right));
    const enabledKinds = Array.from(new Set(
      layer.effects.filter((effect) => effect.enabled).map((effect) => effect.kind),
    )).sort((left, right) => left.localeCompare(right));
    descriptor.effects = {
      count: layer.effects.length,
      kinds,
      enabledKinds,
      nativeLayerEffects: false,
    };
  }
  if (layer.mask) {
    descriptor.mask = {
      width: layer.mask.width,
      height: layer.mask.height,
      nativeLayerMask: false,
    };
  }
  const sourceLink = normalizeXcfSourceLink(layer);
  if (sourceLink) descriptor.sourceLink = sourceLink;
  if (layer.filters?.length) {
    const kinds = Array.from(new Set(layer.filters.map((filter) => filter.kind))).sort((left, right) => left.localeCompare(right));
    descriptor.filters = {
      count: layer.filters.length,
      enabledCount: layer.filters.filter((filter) => filter.enabled).length,
      kinds,
      nativeSmartFilters: false,
      metadataOnly: true,
    };
  }
  if (layer.adjustment) {
    descriptor.adjustment = {
      kind: layer.adjustment.kind,
      nativeAdjustmentLayer: false,
    };
  }

  return descriptor;
}

function buildXcfLayerWarningCodes(
  layer: ImageLayer,
  exported: boolean,
): SignalLoomXcfExportWarningCode[] {
  const warningCodes: SignalLoomXcfExportWarningCode[] = [];
  if (exported && (layer.type === 'text' || layer.text)) warningCodes.push('editable-text-flattened');
  if (exported && (layer.effects?.length ?? 0) > 0) warningCodes.push('layer-effects-flattened');
  if (exported && layer.mask) warningCodes.push('layer-masks-flattened');
  if (exported && (layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink)) warningCodes.push('source-links-flattened');
  if (exported && (layer.filters?.length ?? 0) > 0) warningCodes.push('filter-metadata-flattened');
  if (layer.type === 'adjustment' || layer.adjustment) warningCodes.push('adjustment-layers-omitted');
  if (layer.type === 'group') warningCodes.push('layer-groups-omitted');
  return warningCodes;
}

function buildXcfExportWarnings(
  layers: SignalLoomXcfExportLayerDescriptor[],
): SignalLoomXcfExportWarning[] {
  const warnings: SignalLoomXcfExportWarning[] = [];

  appendXcfLayerWarning(warnings, layers, 'editable-text-flattened', 'Editable text layers are exported to XCF as raster pixels; text content and style remain editable only in the Image document.');
  appendXcfLayerWarning(warnings, layers, 'layer-effects-flattened', 'Layer effects are rasterized into XCF layer pixels instead of native editable GIMP effects.');
  appendXcfLayerWarning(warnings, layers, 'layer-masks-flattened', 'Layer masks are baked into XCF layer pixels instead of native editable GIMP masks.');
  appendXcfLayerWarning(warnings, layers, 'source-links-flattened', 'Source-linked layer editability is exported as raster pixels; native smart object/source-link semantics are not written to XCF.');
  appendXcfLayerWarning(warnings, layers, 'filter-metadata-flattened', 'Filter stacks are retained as Sloom Studio metadata but exported to XCF as flattened layer pixels instead of native editable filters.');
  appendXcfLayerWarning(warnings, layers, 'adjustment-layers-omitted', 'Adjustment layers are not written as native XCF layers; export a visible flattened format for baked color adjustments.');
  appendXcfLayerWarning(warnings, layers, 'layer-groups-omitted', 'Layer groups are not written as native XCF folders; exported child raster layers remain flat.');

  return warnings;
}

function appendXcfLayerWarning(
  warnings: SignalLoomXcfExportWarning[],
  layers: SignalLoomXcfExportLayerDescriptor[],
  code: SignalLoomXcfExportWarningCode,
  message: string,
): void {
  const layerIds = layers
    .filter((layer) => layer.warningCodes.includes(code))
    .map((layer) => layer.id);
  if (layerIds.length === 0) return;
  warnings.push({ code, severity: 'warning', layerIds, message });
}

function buildXcfSourcePolicySignature(
  layers: SignalLoomXcfExportLayerDescriptor[],
  warnings: SignalLoomXcfExportWarning[],
): string {
  return [
    'xcf-interop:v1',
    'import=bounded-raster',
    'export=layered-raster-export-only',
    `layers=${layers.length}`,
    `exported=${layers.filter((layer) => !layer.omitted).length}`,
    `omitted=${layers.filter((layer) => !layer.omitted).length}`,
    `warnings=${warnings.map((warning) => warning.code).join(',') || 'none'}`,
  ].join('|');
}

function buildXcfRoundTripCaveats(warnings: SignalLoomXcfExportWarning[]): string[] {
  const warningCodes = new Set(warnings.map((warning) => warning.code));
  const caveats = ['Imported XCF raster layers and masks re-open in Image; native XCF edit state does not round-trip.'];
  const editableStateLossCodes: SignalLoomXcfExportWarningCode[] = [
    'editable-text-flattened',
    'adjustment-layers-omitted',
  ];

  if (editableStateLossCodes.some((code) => warningCodes.has(code))) {
    caveats.push('Editable text, adjustment layers, layer effects, masks, groups, and source links are not round-tripped as native XCF edit state.');
  }
  if (
    warningCodes.has('layer-masks-flattened')
    || warningCodes.has('layer-effects-flattened')
    || warningCodes.has('source-links-flattened')
    || warningCodes.has('filter-metadata-flattened')
    || warningCodes.has('layer-groups-omitted')
  ) {
    caveats.push('Layer masks, layer effects, source links, and filter stacks are flattened into exported pixels.');
  }
  if (warningCodes.has('layer-groups-omitted')) {
    caveats.push('Layer groups are omitted as native folders; exported raster layers remain flat.');
  }

  return caveats;
}

function isLayerExportedAsXcfRaster(layer: ImageLayer): boolean {
  return Boolean(layer.bitmap && layer.type !== 'adjustment');
}

function normalizeXcfSourceLink(layer: ImageLayer): SignalLoomXcfExportLayerDescriptor['sourceLink'] {
  const sourceId = layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId;
  if (!sourceId) return undefined;
  return {
    id: sourceId,
    ...(layer.metadata?.sourceLink?.label || layer.metadata?.sourceLabel
      ? { label: layer.metadata.sourceLink?.label ?? layer.metadata.sourceLabel }
      : {}),
    status: layer.metadata?.sourceLink?.status ?? 'linked',
    nativeSmartObject: false,
  };
}

function writeLayer(writer: XcfWriter, layer: XcfLayerExport): void {
  writer.writeU32(layer.width);
  writer.writeU32(layer.height);
  writer.writeU32(1);
  writer.writeString(layer.name);
  writeLayerProperties(writer, layer);
  const hierarchyPointerOffset = writer.reserveU32();
  writer.writeU32(0);
  writer.writeU32(0);
  writer.patchU32(hierarchyPointerOffset, writer.offset);
  writeHierarchy(writer, layer);
}

function writeLayerProperties(writer: XcfWriter, layer: XcfLayerExport): void {
  if (layer.active) writeProperty(writer, 2, []);
  writePropertyU32(writer, 6, Math.round(layer.opacity * 255));
  writePropertyU32(writer, 8, layer.visible ? 1 : 0);
  writePropertyU32(writer, 7, layer.mode);
  const offsets = new XcfWriter();
  offsets.writeI32(layer.x);
  offsets.writeI32(layer.y);
  writeProperty(writer, 15, offsets.bytes);
  writePropertyEnd(writer);
}

function writeHierarchy(writer: XcfWriter, layer: XcfLayerExport): void {
  writer.writeU32(layer.width);
  writer.writeU32(layer.height);
  writer.writeU32(4);
  const levelPointerOffset = writer.reserveU32();
  writer.writeU32(0);
  writer.patchU32(levelPointerOffset, writer.offset);
  writeLevel(writer, layer);
}

function writeLevel(writer: XcfWriter, layer: XcfLayerExport): void {
  const columns = Math.ceil(layer.width / XCF_TILE_SIZE);
  const rows = Math.ceil(layer.height / XCF_TILE_SIZE);
  const tilePointerOffsets: number[] = [];

  writer.writeU32(layer.width);
  writer.writeU32(layer.height);
  for (let index = 0; index < columns * rows; index += 1) {
    tilePointerOffsets.push(writer.reserveU32());
  }
  writer.writeU32(0);

  let tileIndex = 0;
  for (let tileY = 0; tileY < layer.height; tileY += XCF_TILE_SIZE) {
    for (let tileX = 0; tileX < layer.width; tileX += XCF_TILE_SIZE) {
      writer.patchU32(tilePointerOffsets[tileIndex], writer.offset);
      writeTile(writer, layer.imageData, tileX, tileY);
      tileIndex += 1;
    }
  }
}

function writeTile(writer: XcfWriter, imageData: ImageData, tileX: number, tileY: number): void {
  const width = Math.min(XCF_TILE_SIZE, imageData.width - tileX);
  const height = Math.min(XCF_TILE_SIZE, imageData.height - tileY);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((tileY + y) * imageData.width + tileX + x) * 4;
      writer.writeByte(imageData.data[source]);
      writer.writeByte(imageData.data[source + 1]);
      writer.writeByte(imageData.data[source + 2]);
      writer.writeByte(imageData.data[source + 3]);
    }
  }
}

function writePropertyU32(writer: XcfWriter, type: number, value: number): void {
  const payload = new XcfWriter();
  payload.writeU32(value);
  writeProperty(writer, type, payload.bytes);
}

function writeProperty(writer: XcfWriter, type: number, payload: number[]): void {
  writer.writeU32(type);
  writer.writeU32(payload.length);
  writer.writeBytes(payload);
}

function writePropertyEnd(writer: XcfWriter): void {
  writer.writeU32(0);
  writer.writeU32(0);
}

function imageBlendModeToXcfMode(mode: BlendMode): number {
  switch (mode) {
    case 'multiply':
      return 3;
    case 'screen':
      return 4;
    case 'overlay':
      return 5;
    case 'difference':
      return 6;
    case 'darken':
      return 9;
    case 'lighten':
      return 10;
    case 'hue':
      return 11;
    case 'saturation':
      return 12;
    case 'color':
      return 13;
    case 'luminosity':
      return 14;
    case 'color-dodge':
      return 16;
    case 'color-burn':
      return 17;
    case 'hard-light':
      return 18;
    case 'soft-light':
      return 19;
    default:
      return 0;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

class XcfWriter {
  bytes: number[] = [];

  get offset(): number {
    return this.bytes.length;
  }

  writeAscii(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      this.writeByte(value.charCodeAt(index));
    }
  }

  writeByte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeBytes(values: number[] | Uint8Array): void {
    for (const value of values) this.writeByte(value);
  }

  writeU32(value: number): void {
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  writeI32(value: number): void {
    this.writeU32(value >>> 0);
  }

  reserveU32(): number {
    const offset = this.offset;
    this.writeU32(0);
    return offset;
  }

  patchU32(offset: number, value: number): void {
    this.bytes[offset] = (value >>> 24) & 0xff;
    this.bytes[offset + 1] = (value >>> 16) & 0xff;
    this.bytes[offset + 2] = (value >>> 8) & 0xff;
    this.bytes[offset + 3] = value & 0xff;
  }

  writeString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length === 0) {
      this.writeU32(0);
      return;
    }
    this.writeU32(bytes.length + 1);
    this.writeBytes(bytes);
    this.writeByte(0);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}
