import { inferFormatFromFile, inferMimeTypeFromFile, normalizeMimeType } from '../../lib/mediaFormatRegistry';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import { createBitmap, putBitmapImageData } from './LayerBitmap';
import { describeXcfImportLimitStrings, describeXcfUnsupportedCompressionMessage, describeXcfUnsupportedPrecision, inspectXcfFileForPolicy } from './ImageXcfImport';
import { validateImageCmykProfile } from '../../lib/iccTransforms';
import { convertImageCmykaBytesToRgba } from './cmyk/ImageCmykDocument';
import { decodeImageCmykTiff } from './cmyk/cmykTiff';
import { createImportedImageCmykProfile } from './cmyk/cmykProfiles';

export const IMAGE_TIFF_MIME_TYPE = 'image/tiff';
export const IMAGE_SVG_MIME_TYPE = 'image/svg+xml';
export const IMAGE_BMP_MIME_TYPE = 'image/bmp';
export const IMAGE_GIF_MIME_TYPE = 'image/gif';

const BROWSER_RASTER_DEPTH_LABEL = '8-bit RGBA canvas pixels';
export const PHOTOSHOP_PSD_MAX_DIMENSION = 30000;
export const CAMERA_RAW_SUPPORTED_EXTENSIONS = [
  '3fr',
  'ari',
  'arw',
  'bay',
  'cr2',
  'cr3',
  'crw',
  'dcr',
  'dng',
  'erf',
  'fff',
  'iiq',
  'kdc',
  'mef',
  'mos',
  'mrw',
  'nef',
  'nrw',
  'orf',
  'pef',
  'raf',
  'raw',
  'rwl',
  'rw2',
  'sr2',
  'srf',
  'srw',
  'x3f',
] as const;

export const CAMERA_RAW_SUPPORTED_MIME_TYPES = [
  'image/x-adobe-dng',
  'image/x-canon-cr2',
  'image/x-canon-cr3',
  'image/x-canon-crw',
  'image/x-epson-erf',
  'image/x-fuji-raf',
  'image/x-hasselblad-3fr',
  'image/x-kodak-dcr',
  'image/x-kodak-kdc',
  'image/x-leaf-mos',
  'image/x-mamiya-mef',
  'image/x-minolta-mrw',
  'image/x-nikon-nef',
  'image/x-nikon-nrw',
  'image/x-olympus-orf',
  'image/x-panasonic-raw',
  'image/x-panasonic-rw2',
  'image/x-pentax-pef',
  'image/x-phaseone-iiq',
  'image/x-samsung-srw',
  'image/x-sigma-x3f',
  'image/x-sony-arw',
  'image/x-sony-sr2',
  'image/x-sony-srf',
] as const;

export const CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS = ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'] as const;
const CAMERA_RAW_RECOMMENDED_CONVERSION_PATH = [
  'Develop the RAW source in a dedicated RAW processor with demosaic, profile interpretation, and non-destructive edits.',
  `Export a fully developed derivative as ${CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS.join(', ')} before opening in Image.`,
  'Open the exported file as a normal raster import target.',
] as const;

const CAMERA_RAW_EXTENSIONS = new Set<string>(CAMERA_RAW_SUPPORTED_EXTENSIONS);
const CAMERA_RAW_MIME_TYPES = new Set<string>(CAMERA_RAW_SUPPORTED_MIME_TYPES);
const PSD_MIME_TYPES = new Set([
  'image/vnd.adobe.photoshop',
  'image/x-photoshop',
  'application/photoshop',
  'application/x-photoshop',
]);
const XCF_MIME_TYPES = new Set(['image/x-xcf', 'image/x-gimp-xcf', 'image/xcf']);

const CAMERA_RAW_UNSUPPORTED_MESSAGE = 'Camera Raw files are detected, but Image does not currently include a RAW demosaic/development pipeline. Develop the RAW file in a camera raw processor and export 8-bit TIFF, PSD, PNG, or JPEG before opening here.';

export type CameraRawImportBlockerCode = 'raw-demosaic-missing' | 'camera-profile-controls-missing';

export interface CameraRawImportBlockerDescriptor {
  code: CameraRawImportBlockerCode;
  summary: string;
}

export interface CameraRawRoundtripRiskDescriptor {
  level: 'unsupported';
  summary: string;
  caveats: string[];
}

export interface CameraRawDevelopFirstMetadata {
  sourceLabel?: string;
  sourceMimeType?: string;
  sourceExtension?: string;
  supportedHandoffFormats: string[];
  recommendedConversionPath: readonly string[];
  openAsPixelsBlockedReasons: string[];
}

export type CameraRawOpenPolicy = 'develop-first' | 'open-as-pixels';
export type CameraRawUnsupportedStateCode =
  | 'native-raw-open'
  | 'raw-demosaic'
  | 'raw-camera-profile-controls'
  | 'raw-non-destructive-develop';

export interface CameraRawUnsupportedStateDescriptor {
  code: CameraRawUnsupportedStateCode;
  message: string;
}

export interface CameraRawOpenPolicyDescriptor {
  descriptorId: 'camera-raw-open-policy:v1';
  detected: boolean;
  sourceLabel?: string;
  sourceExtension?: string;
  sourceMimeType?: string;
  openPolicy: CameraRawOpenPolicy;
  canOpenAsPixels: boolean;
  externalDevelopmentRequired: boolean;
  developFirst?: CameraRawDevelopFirstMetadata;
  recommendedFallbackRoutes: SourceImageWorkflowFallbackRouteDescriptor[];
  unsupportedStates: CameraRawUnsupportedStateDescriptor[];
  stableSignature: string;
}

export interface CameraRawImportReadinessDescriptor {
  descriptorId: 'camera-raw-import-readiness:v1';
  detected: boolean;
  sourceExtension?: string;
  sourceMimeType?: string;
  sourceLabel?: string;
  supportedExtensions: string[];
  supportedMimeTypes: string[];
  supportedHandoffFormats: string[];
  externalDevelopmentRequired: true;
  openAsPixelsBlockedReasons: string[];
  openAsPixelsBlockers: CameraRawImportBlockerDescriptor[];
  unsupportedImportBlockers: CameraRawImportBlockerDescriptor[];
  roundtripRisk: CameraRawRoundtripRiskDescriptor;
  suiteHandoffCaveats: string[];
  policySignatures: {
    detection: string;
    handoff: string;
    blockers: string;
  };
}

interface SourceImageFormatPolicyMetadata {
  sourceFormatLabel?: string;
  sourceMimeType?: string;
  sourceExtension?: string;
  sourceBitsPerChannel?: number;
  highBitDepth?: boolean;
}

type SourceImageFormatPolicyWithMetadata<T> = T & SourceImageFormatPolicyMetadata;

export type SourceImageFormatPolicy =
  | SourceImageFormatPolicyWithMetadata<{ kind: 'psd' }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'psb'; message: string }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'xcf'; message?: string }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'tiff' }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'svg' }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'gif'; animated: boolean; warning?: string }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'exr'; message: string }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'cameraRaw'; message: string }>
  | SourceImageFormatPolicyWithMetadata<{ kind: 'raster' }>;

export type SourceImageFormatImportStatus = 'supported' | 'rasterized' | 'first-frame-only' | 'unsupported';
export type SourceImageFormatExportStatus = 'flattened-raster' | 'layered-with-metadata' | 'layered-export-only' | 'unsupported';
export type SourceImageFormatNativeRoundtrip = 'none' | 'metadata-only' | 'rasterized' | 'unsupported';
export type SourceImageBitDepthStatus =
  | 'browser-8-bit-rgba'
  | 'native-8-bit-supported'
  | 'native-high-bit-supported'
  | 'high-bit-depth-loss-warning'
  | 'high-bit-depth-unsupported'
  | 'not-decoded';
export type SourceImageBitsPerChannel = number | 'unknown' | 'camera-raw';
export type SourceImageFormatWarningCode =
  | 'psd-native-constructs-flattened'
  | 'psb-import-unsupported'
  | 'xcf-import-unsupported'
  | 'xcf-format-limits'
  | 'xcf-editable-state-loss'
  | 'tiff-format-limits'
  | 'svg-rasterized-import'
  | 'svg-flattened-export'
  | 'gif-animation-first-frame'
  | 'gif-static-flattened-export'
  | 'exr-import-unsupported'
  | 'camera-raw-import-unsupported'
  | 'high-bit-depth-raster-loss'
  | 'high-bit-depth-import-unsupported';

export type SourceImageCompatibilityWarningCategory =
  | 'editable-state-loss'
  | 'layer-mask-effect-loss'
  | 'format-limits'
  | 'vector-rasterized'
  | 'animation-loss'
  | 'raw-development'
  | 'high-bit-depth-loss'
  | 'unsupported-format';

export interface SourceImageCompatibilityWarningDescriptor {
  code: SourceImageFormatWarningCode;
  category: SourceImageCompatibilityWarningCategory;
  severity: 'warning';
  summary: string;
}

export type SourceImageReadinessStatus = 'ready' | 'limited' | 'handoff-required' | 'unsupported';
export type SourceImageImportAction = 'open-as-pixels' | 'rasterize' | 'first-frame-only' | 'develop-first' | 'convert-first' | 'unsupported';
export type SourceImageExportAction = 'flattened-raster' | 'layered-with-metadata' | 'layered-export-only' | 'unsupported';

export interface SourceImageFormatReadinessDescriptor {
  status: SourceImageReadinessStatus;
  importAction: SourceImageImportAction;
  exportAction: SourceImageExportAction;
  userSummary: string;
  roundTripCaveats: string[];
}

export interface SourceImageBitDepthDescriptor {
  status: SourceImageBitDepthStatus;
  sourceBitsPerChannel: SourceImageBitsPerChannel;
  editorBitsPerChannel: 8 | 16 | 32;
  browserDecodedTo: typeof BROWSER_RASTER_DEPTH_LABEL | 'native u16/f32 PixelBuffer authority' | 'not decoded';
  preservesHighBitDepth: boolean;
  warning?: string;
}

export interface SourceImageFormatCompatibilityDescriptor {
  importSupported: boolean;
  exportSupported: boolean;
  nativeRoundtrip: SourceImageFormatNativeRoundtrip;
  preservesEditableLayers: boolean;
  preservesAnimation: boolean;
  flattenedExport: boolean;
}

export interface SourceImageFormatPolicyDescription {
  formatLabel: string;
  sourceMimeType?: string;
  sourceExtension?: string;
  importStatus: SourceImageFormatImportStatus;
  exportStatus: SourceImageFormatExportStatus;
  importSummary: string;
  exportSummary: string;
  warningCodes: SourceImageFormatWarningCode[];
  warnings: string[];
  limitations: string[];
  sourceFormatLimits: string[];
  bitDepth: SourceImageBitDepthDescriptor;
  compatibility: SourceImageFormatCompatibilityDescriptor;
  compatibilityWarnings: SourceImageCompatibilityWarningDescriptor[];
  editStateLoss: SourceImageEditStateLossDescriptor;
  readiness: SourceImageFormatReadinessDescriptor;
  roundTripCaveats: string[];
  importPolicy: SourceImageImportPolicyDescriptor;
  policySignature: string;
}

export interface SourceImageWorkflowFallbackRouteDescriptor {
  route: string;
  label: string;
  preserves: string;
  recommendedFor: string;
  caveat: string;
}

export interface SourceImageEditStateLossDescriptor {
  layers: string;
  text: string;
  effects: string;
  sourceLinks: string;
}

export interface SourceImageImportPolicyDescriptor {
  status: SourceImageFormatImportStatus;
  canOpenAsPixels: boolean;
  requiresExternalProcessor: boolean;
  recommendedHandoffFormats: string[];
  recommendedFallbackRoutes: SourceImageWorkflowFallbackRouteDescriptor[];
  vectorStatePreserved: boolean;
  animationPreserved: boolean;
  limitations: string[];
}

export type SourceImageLayerFlatteningPolicy = 'preserves-layers' | 'flattens-on-import' | 'flattens-on-export' | 'unsupported';
export type SourceImageFrameLimit = number | 'none' | 'not-decoded';

export interface SourceImageLayerPolicyDescriptor {
  importPreservesLayers: boolean;
  exportPreservesLayers: boolean;
  flattening: SourceImageLayerFlatteningPolicy;
  summary: string;
}

export interface SourceImageAnimationPolicyDescriptor {
  importFrameLimit: SourceImageFrameLimit;
  exportFrameLimit: SourceImageFrameLimit;
  preservesAnimation: boolean;
  summary: string;
}

export interface SourceImageVectorPolicyDescriptor {
  importPreservesVectorState: boolean;
  exportPreservesVectorState: boolean;
  summary: string;
}

export interface SourceImageColorProfilePolicyDescriptor {
  preservesEmbeddedProfiles: boolean;
  summary: string;
}

export interface SourceImageRawHandoffPolicyDescriptor {
  requiresDevelopFirst: true;
  recommendedHandoffFormats: string[];
  recommendedConversionPath: readonly string[];
  openAsPixelsBlockedReasons: string[];
  summary: string;
}

export type SourceImagePsbThresholdCode = 'psd-max-dimension-exceeded' | 'psb-header-version-2';

export type PhotoshopDocumentKind = 'psd' | 'psb' | 'unknown';

export interface SourceImagePsbThresholdDescriptor {
  code: SourceImagePsbThresholdCode;
  limit: string;
  unsupported: true;
  summary: string;
}

export interface SourceImagePsbUnsupportedPolicyDescriptor {
  unsupported: true;
  thresholds: string[];
  thresholdDescriptors: SourceImagePsbThresholdDescriptor[];
  largeDocumentCaveats: string[];
  summary: string;
}

export interface PhotoshopDocumentSizePolicyDescriptor {
  descriptorId: 'photoshop-document-size-policy:v1';
  kind: PhotoshopDocumentKind;
  width?: number;
  height?: number;
  channels?: number;
  bitDepth?: number;
  colorMode?: number;
  psdMaxDimension: typeof PHOTOSHOP_PSD_MAX_DIMENSION;
  canAttemptLayeredPsdImport: boolean;
  requiresConversion: boolean;
  blockers: SourceImagePsbThresholdDescriptor[];
  recommendedFallbackRoutes: SourceImageWorkflowFallbackRouteDescriptor[];
  stableSignature: string;
}

export interface SourceImageFormatPolicyWarningDescriptor {
  descriptorId: string;
  code: SourceImageFormatWarningCode;
  summary: string;
}

export interface SourceImageFormatExportReadinessDescriptor {
  formatLabel: string;
  importAction: SourceImageImportAction;
  exportAction: SourceImageExportAction;
  warningCodes: SourceImageFormatWarningCode[];
  policyWarnings: SourceImageFormatPolicyWarningDescriptor[];
  recommendedHandoffFormats: string[];
  recommendedFallbackRoutes: SourceImageWorkflowFallbackRouteDescriptor[];
  editStateLoss: SourceImageEditStateLossDescriptor;
  layerPolicy: SourceImageLayerPolicyDescriptor;
  animationPolicy: SourceImageAnimationPolicyDescriptor;
  vectorPolicy: SourceImageVectorPolicyDescriptor;
  colorProfilePolicy: SourceImageColorProfilePolicyDescriptor;
  bitDepthPolicy: SourceImageBitDepthDescriptor;
  rawPolicy?: SourceImageRawHandoffPolicyDescriptor;
  psbPolicy?: SourceImagePsbUnsupportedPolicyDescriptor;
  stableSignature: string;
}

export type SourceImageOpenRouteKind =
  | 'open-as-pixels'
  | 'open-layered-psd'
  | 'open-as-psb'
  | 'open-native-xcf'
  | SourceImageWorkflowFallbackRouteDescriptor['route'];

export type SourceImageOpenUnsupportedStateCode =
  | 'native-raw-demosaic'
  | 'raw-camera-profile-controls'
  | 'raw-non-destructive-develop'
  | 'native-xcf-decode'
  | 'full-xcf-native-constructs'
  | 'full-psd-native-constructs'
  | 'native-psb-decode'
  | 'full-psb-native-constructs'
  | 'icc-managed-open-transform';

export type SourceImageOpenUnsupportedStateCategory =
  | 'raw-development'
  | 'native-constructs'
  | 'native-decoder'
  | 'color-management';

export interface SourceImageOpenUnsupportedStateDescriptor {
  code: SourceImageOpenUnsupportedStateCode;
  category: SourceImageOpenUnsupportedStateCategory;
  blocksOpenAsPixels: boolean;
  summary: string;
}

export interface SourceImageOpenRouteDescriptor {
  route: SourceImageOpenRouteKind;
  rank: number;
  supported: boolean;
  openAction: SourceImageImportAction;
  label: string;
  preserves: string;
  recommendedFor: string;
  caveat: string;
  unsupportedStateCodes: SourceImageOpenUnsupportedStateCode[];
}

export type SourceImageRoundtripRiskLevel = 'none' | 'rasterized' | 'metadata-only' | 'unsupported';

export interface SourceImageFileOpenRoundtripRiskDescriptor {
  riskId: string;
  stableId: string;
  level: SourceImageRoundtripRiskLevel;
  nativeRoundtrip: SourceImageFormatNativeRoundtrip;
  affectedConstructs: SourceImageOpenUnsupportedStateCode[];
  summary: string;
}

export interface SourceImageFileOpenReadinessSignatures {
  importPolicy: string;
  fallbackRouteRanking: string;
  nativeConstructWarnings: string;
  roundtripRisk: string;
  sourcePolicy: string;
}

export interface SourceImageFileOpenReadinessDescriptor {
  descriptorId: 'source-image-file-open-readiness:v1';
  formatLabel: string;
  sourceExtension?: string;
  sourceMimeType?: string;
  importStatus: SourceImageFormatImportStatus;
  importAction: SourceImageImportAction;
  canOpenAsPixels: boolean;
  requiresExternalProcessor: boolean;
  openRoutes: SourceImageOpenRouteDescriptor[];
  unsupportedStates: SourceImageOpenUnsupportedStateDescriptor[];
  nativeConstructWarnings: SourceImageOpenUnsupportedStateDescriptor[];
  fallbackRoutes: SourceImageWorkflowFallbackRouteDescriptor[];
  rawDevelopFirst?: CameraRawDevelopFirstMetadata;
  roundtripRisk: SourceImageFileOpenRoundtripRiskDescriptor;
  sourcePolicySignature: string;
  signatures: SourceImageFileOpenReadinessSignatures;
  stableSignature: string;
}

export interface SourceImageOpenParams {
  id: string;
  title: string;
  sourceBinItemId?: string;
  sourceLabel?: string;
  sourceMimeType?: string;
  sourceUrl?: string;
  /** Detected source precision. The editable browser raster remains 8-bit RGBA. */
  sourceBitDepth?: 8 | 16 | 32;
}

export function describePhotoshopDocumentSizePolicy(input: {
  bytes?: Uint8Array | ArrayBuffer;
  fileName?: string;
  mimeType?: string;
  kind?: PhotoshopDocumentKind;
  width?: number;
  height?: number;
} = {}): PhotoshopDocumentSizePolicyDescriptor {
  const header = readPhotoshopDocumentHeader(input.bytes);
  const extension = normalizeSourceExtension(input.fileName);
  const mimeType = normalizeMimeType(input.mimeType);
  const kind = input.kind ?? header.kind ?? inferPhotoshopDocumentKindFromIdentity(extension, mimeType);
  const width = normalizePositiveInteger(input.width ?? header.width);
  const height = normalizePositiveInteger(input.height ?? header.height);
  const blockers = buildPhotoshopDocumentSizeBlockers({ kind, width, height });
  const canAttemptLayeredPsdImport = kind === 'psd' && blockers.length === 0;
  const requiresConversion = blockers.length > 0 || kind === 'psb';
  const recommendedFallbackRoutes = requiresConversion ? buildPhotoshopLargeDocumentFallbackRoutes() : [];
  const descriptor: PhotoshopDocumentSizePolicyDescriptor = {
    descriptorId: 'photoshop-document-size-policy:v1',
    kind,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(header.channels ? { channels: header.channels } : {}),
    ...(header.bitDepth ? { bitDepth: header.bitDepth } : {}),
    ...(header.colorMode !== undefined ? { colorMode: header.colorMode } : {}),
    psdMaxDimension: PHOTOSHOP_PSD_MAX_DIMENSION,
    canAttemptLayeredPsdImport,
    requiresConversion,
    blockers,
    recommendedFallbackRoutes,
    stableSignature: [
      'photoshop-size-policy:v1',
      `kind=${kind}`,
      `width=${width ?? 'unknown'}`,
      `height=${height ?? 'unknown'}`,
      `max=${PHOTOSHOP_PSD_MAX_DIMENSION}`,
      `blockers=${blockers.map((blocker) => blocker.code).join(',') || 'none'}`,
    ].join('|'),
  };
  return descriptor;
}

export function describeSourceImageFormatPolicy(policy: SourceImageFormatPolicy): SourceImageFormatPolicyDescription {
  switch (policy.kind) {
    case 'psd':
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'PSD',
        importStatus: 'supported',
        exportStatus: 'layered-with-metadata',
        importSummary: 'Layered PSD import is supported, including retained Sloom Studio metadata for linked-source and editor state where available.',
        exportSummary: 'PSD export writes native editable records for the bounded horizontal unwarped solid-colour text subset; unsupported native constructs remain flattened pixels plus Sloom Studio metadata-only records.',
        warningCodes: ['psd-native-constructs-flattened'],
        warnings: [],
        limitations: [
          'Native PSD Smart Object semantics are not written back as editable Smart Objects.',
          'Ordinary horizontal unwarped solid-colour text exports as native PSD text; vertical, warped, path, masked, effected, and unsupported-style text plus adjustment layers and effects use flattened pixels with metadata-only preservation where possible.',
        ],
        compatibility: {
          nativeRoundtrip: 'metadata-only',
          preservesEditableLayers: false,
        },
      });
    case 'psb':
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'PSB',
        importStatus: 'unsupported',
        exportStatus: 'unsupported',
        importSummary: policy.message,
        exportSummary: 'PSB large-document import is not supported. Convert the file to PSD, TIFF, PNG, or JPEG before opening in Image.',
        warningCodes: ['psb-import-unsupported'],
        warnings: [policy.message],
        limitations: [
          'PSB large document decoding is not implemented in Image.',
        ],
      });
    case 'xcf': {
      const xcfUnsupported = Boolean(policy.message);
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'XCF',
        importStatus: xcfUnsupported ? 'unsupported' : 'supported',
        exportStatus: 'layered-export-only',
        importSummary: xcfUnsupported
          ? policy.message ?? 'This XCF file cannot be imported.'
          : 'XCF import is supported for GIMP workfiles with 8-bit RGB, grayscale, or indexed layers and masks using uncompressed, RLE, or zlib tiles.',
        exportSummary: 'XCF layered raster export is available for sharing Image documents with GIMP.',
        warningCodes: xcfUnsupported
          ? ['xcf-import-unsupported', 'xcf-editable-state-loss']
          : ['xcf-format-limits', 'xcf-editable-state-loss'],
        warnings: xcfUnsupported ? [policy.message ?? 'This XCF file cannot be imported.'] : [],
        limitations: [
          ...describeXcfImportLimitStrings(),
          'Editable text, layer groups, filters, effects, and source links are not reconstructed as native editable constructs on import. Detected GIMP non-destructive effects warn per layer and import their unfiltered source pixels.',
        ],
        compatibility: {
          exportSupported: true,
          nativeRoundtrip: 'unsupported',
          preservesEditableLayers: !xcfUnsupported,
          flattenedExport: false,
        },
      });
    }
    case 'tiff': {
      const highBitTiff = Boolean(policy.highBitDepth && (policy.sourceBitsPerChannel ?? 0) > 8);
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'TIFF',
        sourceMimeType: policy.sourceMimeType,
        sourceExtension: policy.sourceExtension,
        importStatus: 'supported',
        exportStatus: 'flattened-raster',
        importSummary: highBitTiff
          ? `${policy.sourceBitsPerChannel}-bit/channel TIFF samples are decoded as native authority for the supported classic uncompressed chunky RGBA subset.`
          : 'TIFF import is supported for classic uncompressed 8-bit grayscale, RGB, and RGBA images.',
        exportSummary: 'TIFF export writes native u16/f32 RGBA authority when the document uses a supported single raster layer; other documents use a flattened 8-bit RGBA image.',
        warningCodes: ['tiff-format-limits'],
        warnings: [],
        limitations: [
          'BigTIFF, compressed TIFF, planar TIFF, and non-8-bit sample depths outside the native u16/f32 RGBA subset are refused.',
        ],
        sourceFormatLimits: createTiffSourceFormatLimits(policy),
        bitDepth: highBitTiff
          ? createNativeHighBitDepthDescriptor(policy.sourceBitsPerChannel === 32 ? 32 : 16)
          : createNativeEightBitDepthDescriptor(),
      });
    }
    case 'svg':
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'SVG',
        importStatus: 'rasterized',
        exportStatus: 'flattened-raster',
        importSummary: 'SVG files are rasterized on open and kept as pixel layers while the original SVG source is retained in metadata.',
        exportSummary: 'SVG export wraps a flattened raster snapshot in an SVG container; it does not rebuild editable vector artwork.',
        warningCodes: ['svg-rasterized-import', 'svg-flattened-export'],
        warnings: [],
        limitations: [
          'Editable vector structure is not reconstructed from browser rasterization, so SVG import/export remains raster-backed.',
        ],
        sourceFormatLimits: [
          `SVG import is rasterized through browser image decoding, so Image edits ${BROWSER_RASTER_DEPTH_LABEL} rather than retained SVG objects.`,
        ],
        bitDepth: createBrowserRasterBitDepthDescriptor(policy),
        compatibility: {
          nativeRoundtrip: 'rasterized',
        },
      });
    case 'gif':
      return makeSourceImageFormatPolicyDescription({
        formatLabel: policy.animated ? 'Animated GIF' : 'GIF',
        importStatus: policy.animated ? 'first-frame-only' : 'supported',
        exportStatus: 'flattened-raster',
        importSummary: policy.animated
          ? policy.warning ?? 'Animated GIF files open as the first frame only.'
          : 'Static GIF import is supported as a raster image.',
        exportSummary: 'GIF export is static GIF only and writes a flattened single-frame image.',
        warningCodes: policy.animated
          ? ['gif-animation-first-frame', 'gif-static-flattened-export']
          : ['gif-static-flattened-export'],
        warnings: policy.warning ? [policy.warning] : [],
        limitations: [
          policy.animated
            ? 'Animation timing and multi-frame playback are not preserved in Image; use Video for animation workflows.'
            : 'GIF export remains palette-based and flattened.',
        ],
        sourceFormatLimits: [
          `GIF frames are decoded into ${BROWSER_RASTER_DEPTH_LABEL}; palette animation state is not an Image document channel.`,
        ],
        bitDepth: createBrowserRasterBitDepthDescriptor(policy),
        compatibility: {
          preservesAnimation: !policy.animated,
        },
      });
    case 'exr':
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'OpenEXR',
        importStatus: 'supported',
        exportStatus: 'flattened-raster',
        importSummary: 'Bounded single-part scanline OpenEXR RGB[A] files open as native 32-bit float authority.',
        exportSummary: 'Supported single-raster f32 documents export directly to bounded OpenEXR; unsupported layers, models, or depths refuse before an 8-bit fallback.',
        warningCodes: [],
        warnings: [],
        limitations: [
          'Only bounded single-part scanline RGB[A] HALF/FLOAT EXR with supported compression opens natively; other layouts are refused.',
        ],
        bitDepth: createNativeHighBitDepthDescriptor(32),
        compatibility: {
          importSupported: true,
          nativeRoundtrip: 'metadata-only',
        },
      });
    case 'cameraRaw':
      return makeSourceImageFormatPolicyDescription({
        formatLabel: 'Camera Raw',
        sourceMimeType: policy.sourceMimeType,
        sourceExtension: policy.sourceExtension,
        importStatus: 'unsupported',
        exportStatus: 'unsupported',
        importSummary: policy.message,
        exportSummary: 'Develop first in a RAW processor, then export 8-bit TIFF, PSD, PNG, or JPEG for Image.',
        warningCodes: ['camera-raw-import-unsupported'],
        warnings: [policy.message],
        limitations: [
          'RAW demosaic, camera-profile controls, and non-destructive RAW development are not implemented in Image.',
        ],
        sourceFormatLimits: [
          `${formatSourceIdentity(policy, 'Camera Raw')} requires external RAW development before Image can edit pixels.`,
        ],
        bitDepth: createNotDecodedBitDepthDescriptor('camera-raw'),
      });
    case 'raster':
    default: {
      const rasterWarnings = policy.highBitDepth ? [createHighBitDepthRasterWarning(policy)] : [];
      const nativePng16 = policy.highBitDepth && policy.sourceBitsPerChannel === 16 && policy.sourceFormatLabel === 'PNG';
      return makeSourceImageFormatPolicyDescription({
        formatLabel: policy.sourceFormatLabel ?? 'Raster image',
        sourceMimeType: policy.sourceMimeType,
        sourceExtension: policy.sourceExtension,
        importStatus: 'supported',
        exportStatus: 'flattened-raster',
        importSummary: nativePng16
          ? '16-bit/channel PNG sources open as native u16 authority with a derived 8-bit display proxy.'
          : policy.highBitDepth && policy.sourceBitsPerChannel
            ? `${policy.sourceFormatLabel ?? 'Raster image'} sources open as flattened image layers after browser decode; ${policy.sourceBitsPerChannel}-bit/channel source samples are reduced to 8-bit RGBA canvas pixels.`
          : 'Standard browser-decodable raster formats open as flattened image layers.',
        exportSummary: 'Raster export is available through the supported flattened document formats.',
        warningCodes: nativePng16 ? [] : policy.highBitDepth ? ['high-bit-depth-raster-loss'] : [],
        warnings: nativePng16 ? [] : rasterWarnings,
        limitations: nativePng16 ? ['PNG16 native ingress is bounded to supported 16-bit/channel PNG layouts.'] : policy.highBitDepth ? [createHighBitDepthRasterWarning(policy)] : [],
        sourceFormatLimits: createRasterSourceFormatLimits(policy),
        bitDepth: nativePng16 ? createNativeHighBitDepthDescriptor(16) : createBrowserRasterBitDepthDescriptor(policy),
      });
    }
  }
}

export function describeSourceImageFormatExportReadiness(
  policy: SourceImageFormatPolicy,
): SourceImageFormatExportReadinessDescriptor {
  const description = describeSourceImageFormatPolicy(policy);
  const recommendedHandoffFormats = description.importPolicy.recommendedHandoffFormats;
  const layerPolicy = buildLayerPolicyDescriptor(description);
  const animationPolicy = buildAnimationPolicyDescriptor(description);
  const vectorPolicy = buildVectorPolicyDescriptor(description);
  const bitDepthPolicy = buildReadinessBitDepthPolicy(policy, description);
  const cameraRawDevelopFirst = describeCameraRawDevelopFirstMetadata({
    sourceMimeType: description.sourceMimeType,
    sourceExtension: description.sourceExtension,
  });
  const rawPolicy = policy.kind === 'cameraRaw'
    ? {
        requiresDevelopFirst: true,
        recommendedHandoffFormats,
        recommendedConversionPath: cameraRawDevelopFirst.recommendedConversionPath,
        openAsPixelsBlockedReasons: cameraRawDevelopFirst.openAsPixelsBlockedReasons,
        summary: 'RAW demosaic, camera color/profile interpretation, and non-destructive develop settings must be handled in an external RAW processor before Image editing.',
      } satisfies SourceImageRawHandoffPolicyDescriptor
    : undefined;
  const psbPolicy = policy.kind === 'psb'
    ? {
        unsupported: true,
        thresholds: [
          'PSD 30,000 px per side limit exceeded or PSB version 2 header detected',
          'Large document workflows require conversion before Image import',
        ],
        thresholdDescriptors: [
          {
            code: 'psd-max-dimension-exceeded',
            limit: '30,000 px per side',
            unsupported: true,
            summary: 'Documents beyond the PSD 30,000 px per side limit require PSB, which Image does not decode.',
          },
          {
            code: 'psb-header-version-2',
            limit: '8BPS version 2 header',
            unsupported: true,
            summary: 'PSB version 2 large-document headers are detected and blocked before ag-psd import.',
          },
        ],
        largeDocumentCaveats: [
          'Image has no tiled or streaming PSB decoder for large canvases.',
          'Native PSB round-trip is unsupported; convert to PSD within size limits or to a flattened 8-bit raster handoff.',
        ],
        summary: 'PSB large-document import/export is unsupported; convert to a supported handoff format before opening in Image.',
      } satisfies SourceImagePsbUnsupportedPolicyDescriptor
    : undefined;

  const readiness = {
    formatLabel: description.formatLabel,
    importAction: description.readiness.importAction,
    exportAction: description.readiness.exportAction,
    warningCodes: description.warningCodes,
    policyWarnings: description.compatibilityWarnings.map((warning) => ({
      descriptorId: `source-format-warning:v1|format=${description.formatLabel}|code=${warning.code}`,
      code: warning.code,
      summary: warning.summary,
    })),
    recommendedHandoffFormats,
    recommendedFallbackRoutes: description.importPolicy.recommendedFallbackRoutes,
    editStateLoss: description.editStateLoss,
    layerPolicy,
    animationPolicy,
    vectorPolicy,
    colorProfilePolicy: buildColorProfilePolicyDescriptor(description),
    bitDepthPolicy,
    ...(rawPolicy ? { rawPolicy } : {}),
    ...(psbPolicy ? { psbPolicy } : {}),
  };

  return {
    ...readiness,
    stableSignature: buildSourceExportReadinessSignature(readiness),
  };
}

export function describeSourceImageFileOpenReadiness(
  policy: SourceImageFormatPolicy,
): SourceImageFileOpenReadinessDescriptor {
  const description = describeSourceImageFormatPolicy(policy);
  const importAction = description.readiness.importAction;
  const canOpenAsPixels = description.importPolicy.canOpenAsPixels;
  const unsupportedStates = buildSourceImageOpenUnsupportedStates(policy, description);
  const fallbackRoutes = description.importPolicy.recommendedFallbackRoutes;
  const openRoutes = buildSourceImageOpenRoutes(policy, description, unsupportedStates);
  const nativeConstructWarnings = unsupportedStates.filter((state) => (
    state.category === 'native-constructs'
    || state.category === 'native-decoder'
    || state.category === 'raw-development'
    || state.category === 'color-management'
  ));
  const roundtripRisk = buildSourceImageFileOpenRoundtripRisk(description, unsupportedStates);
  const rawDevelopFirst = policy.kind === 'cameraRaw'
    ? describeCameraRawDevelopFirstMetadata({
        sourceMimeType: description.sourceMimeType,
        sourceExtension: description.sourceExtension,
      })
    : undefined;
  const signatures: SourceImageFileOpenReadinessSignatures = {
    importPolicy: buildSourceImageOpenImportPolicySignature(description),
    fallbackRouteRanking: buildSourceImageOpenFallbackRouteRankingSignature(description.formatLabel, openRoutes),
    nativeConstructWarnings: buildSourceImageOpenNativeConstructWarningSignature(description.formatLabel, nativeConstructWarnings),
    roundtripRisk: roundtripRisk.riskId,
    sourcePolicy: description.policySignature,
  };

  return {
    descriptorId: 'source-image-file-open-readiness:v1',
    formatLabel: description.formatLabel,
    ...(description.sourceExtension ? { sourceExtension: description.sourceExtension } : {}),
    ...(description.sourceMimeType ? { sourceMimeType: description.sourceMimeType } : {}),
    importStatus: description.importStatus,
    importAction,
    canOpenAsPixels,
    requiresExternalProcessor: description.importPolicy.requiresExternalProcessor,
    openRoutes,
    unsupportedStates,
    nativeConstructWarnings,
    fallbackRoutes,
    ...(rawDevelopFirst ? { rawDevelopFirst } : {}),
    roundtripRisk,
    sourcePolicySignature: description.policySignature,
    signatures,
    stableSignature: [
      'source-image-file-open-readiness:v1',
      `format=${description.formatLabel}`,
      `import=${description.importStatus}`,
      `action=${importAction}`,
      `routes=${openRoutes.map((route) => `${route.rank}:${route.route}:${route.supported ? 'supported' : 'unsupported'}`).join(',')}`,
      `unsupported=${unsupportedStates.map((state) => state.code).join(',') || 'none'}`,
      `risk=${roundtripRisk.riskId}`,
    ].join('|'),
  };
}

export function isCameraRawExtension(extensionOrFileName: string | undefined): boolean {
  const extension = normalizeCameraRawExtension(extensionOrFileName);
  return CAMERA_RAW_EXTENSIONS.has(extension ?? '');
}

export function isCameraRawMimeType(mimeType: string | undefined): boolean {
  return CAMERA_RAW_MIME_TYPES.has(normalizeMimeType(mimeType) ?? '');
}

export function describeCameraRawImportReadiness(input: {
  fileName?: string;
  mimeType?: string;
  sourceLabel?: string;
} = {}): CameraRawImportReadinessDescriptor {
  const sourceExtension = normalizeCameraRawExtension(input.fileName);
  const sourceMimeType = normalizeMimeType(input.mimeType);
  const detected = isCameraRawFormat(sourceExtension, sourceMimeType);
  const unsupportedImportBlockers = createCameraRawUnsupportedImportBlockers();
  const sourceLabel = (input.sourceLabel ?? input.fileName ?? '').trim();
  const developFirstMetadata = describeCameraRawDevelopFirstMetadata({
    sourceLabel,
    sourceMimeType,
    sourceExtension,
  });

  return {
    descriptorId: 'camera-raw-import-readiness:v1',
    detected,
    ...(sourceExtension ? { sourceExtension } : {}),
    ...(sourceMimeType ? { sourceMimeType } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
    supportedExtensions: [...CAMERA_RAW_SUPPORTED_EXTENSIONS],
    supportedMimeTypes: [...CAMERA_RAW_SUPPORTED_MIME_TYPES],
    supportedHandoffFormats: [...CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS],
    externalDevelopmentRequired: true,
    unsupportedImportBlockers,
    openAsPixelsBlockedReasons: developFirstMetadata.openAsPixelsBlockedReasons,
    openAsPixelsBlockers: unsupportedImportBlockers,
    roundtripRisk: {
      level: 'unsupported',
      summary: 'Camera Raw cannot round-trip as an editable source document in Image.',
      caveats: [
        'RAW demosaic, camera profiles, and non-destructive RAW settings are not represented in Image documents.',
        'Developed pixels can continue through Image only after export to 8-bit TIFF, PSD, PNG, or JPEG.',
      ],
    },
    suiteHandoffCaveats: [
      'Flow, Video, and Paper handoff should receive the developed raster or PSD derivative, not the original RAW payload.',
      'Keep the original RAW as a Source Library reference if provenance matters; Image edits will not update it.',
    ],
    policySignatures: {
      detection: `camera-raw-detection:v1|ext=${sourceExtension ?? 'none'}|mime=${sourceMimeType ?? 'none'}|detected=${detected}`,
      handoff: `camera-raw-handoff:v1|formats=${CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS.join(',')}|external=true`,
      blockers: `camera-raw-blockers:v1|${unsupportedImportBlockers.map((blocker) => blocker.code).join(',')}`,
    },
  };
}

export function describeCameraRawDevelopFirstMetadata(input: {
  sourceLabel?: string;
  sourceMimeType?: string;
  sourceExtension?: string;
}): CameraRawDevelopFirstMetadata {
  return {
    sourceLabel: input.sourceLabel?.trim(),
    sourceMimeType: normalizeMimeType(input.sourceMimeType),
    sourceExtension: normalizeCameraRawExtension(input.sourceExtension),
    supportedHandoffFormats: [...CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS],
    recommendedConversionPath: [...CAMERA_RAW_RECOMMENDED_CONVERSION_PATH],
    openAsPixelsBlockedReasons: createCameraRawUnsupportedImportBlockers().map((blocker) => blocker.summary),
  };
}

export function describeCameraRawOpenPolicy(input: {
  fileName?: string;
  mimeType?: string;
  sourceLabel?: string;
} = {}): CameraRawOpenPolicyDescriptor {
  const sourceExtension = normalizeCameraRawExtension(input.fileName);
  const sourceMimeType = normalizeMimeType(input.mimeType);
  const sourceLabel = (input.sourceLabel ?? input.fileName ?? '').trim();
  const detected = isCameraRawFormat(sourceExtension, sourceMimeType);
  const openPolicy: CameraRawOpenPolicy = detected ? 'develop-first' : 'open-as-pixels';
  const unsupportedStates = detected ? buildCameraRawOpenUnsupportedStates() : [];
  const developFirst = detected
    ? describeCameraRawDevelopFirstMetadata({
        sourceLabel,
        sourceExtension,
        sourceMimeType,
      })
    : undefined;
  const editStateLoss = detected
    ? buildEditStateLossDescriptor({
        formatLabel: 'Camera Raw',
        warningCodes: ['camera-raw-import-unsupported'],
        importStatus: 'unsupported',
        exportStatus: 'unsupported',
      })
    : undefined;
  const recommendedFallbackRoutes = detected && editStateLoss
    ? buildWorkflowFallbackRoutes({
        formatLabel: 'Camera Raw',
        warningCodes: ['camera-raw-import-unsupported'],
        importStatus: 'unsupported',
        editStateLoss,
      })
    : [];

  return {
    descriptorId: 'camera-raw-open-policy:v1',
    detected,
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(sourceExtension ? { sourceExtension } : {}),
    ...(sourceMimeType ? { sourceMimeType } : {}),
    openPolicy,
    canOpenAsPixels: !detected,
    externalDevelopmentRequired: detected,
    ...(developFirst ? { developFirst } : {}),
    recommendedFallbackRoutes,
    unsupportedStates,
    stableSignature: [
      'camera-raw-open-policy:v1',
      `ext=${sourceExtension ?? 'none'}`,
      `mime=${sourceMimeType ?? 'none'}`,
      `detected=${detected}`,
      `policy=${openPolicy}`,
      `unsupported=${unsupportedStates.map((state) => state.code).join(',') || 'none'}`,
    ].join('|'),
  };
}

type SourceImageFormatPolicyDescriptionInput = Omit<
  SourceImageFormatPolicyDescription,
  | 'compatibility'
  | 'sourceFormatLimits'
  | 'bitDepth'
  | 'compatibilityWarnings'
  | 'editStateLoss'
  | 'readiness'
  | 'roundTripCaveats'
  | 'importPolicy'
  | 'policySignature'
> & {
  sourceFormatLimits?: string[];
  bitDepth?: SourceImageBitDepthDescriptor;
  compatibility?: Partial<SourceImageFormatCompatibilityDescriptor>;
};

function makeSourceImageFormatPolicyDescription(
  input: SourceImageFormatPolicyDescriptionInput,
): SourceImageFormatPolicyDescription {
  const { compatibility, bitDepth, sourceFormatLimits, ...description } = input;
  const resolvedSourceFormatLimits = sourceFormatLimits ?? [];
  const resolvedBitDepth = bitDepth ?? createNotDecodedBitDepthDescriptor('unknown');
  const resolvedCompatibility: SourceImageFormatCompatibilityDescriptor = {
    importSupported: description.importStatus !== 'unsupported',
    exportSupported: description.exportStatus !== 'unsupported',
    nativeRoundtrip: description.importStatus === 'unsupported' || description.exportStatus === 'unsupported'
      ? 'unsupported'
      : 'none',
    preservesEditableLayers: false,
    preservesAnimation: false,
    flattenedExport: description.exportStatus === 'flattened-raster',
    ...compatibility,
  };
  const compatibilityWarnings = description.warningCodes.map((code) => buildCompatibilityWarningDescriptor(code));
  const roundTripCaveats = buildRoundTripCaveats({
    formatLabel: description.formatLabel,
    warningCodes: description.warningCodes,
    limitations: description.limitations,
    importStatus: description.importStatus,
    exportStatus: description.exportStatus,
  });
  const editStateLoss = buildEditStateLossDescriptor({
    formatLabel: description.formatLabel,
    warningCodes: description.warningCodes,
    importStatus: description.importStatus,
    exportStatus: description.exportStatus,
  });
  const readiness = buildReadinessDescriptor({
    formatLabel: description.formatLabel,
    importStatus: description.importStatus,
    exportStatus: description.exportStatus,
    warningCodes: description.warningCodes,
    roundTripCaveats,
  });
  const importPolicy = buildSourceImageImportPolicy({
    importStatus: description.importStatus,
    warningCodes: description.warningCodes,
    limitations: description.limitations,
    sourceFormatLimits: resolvedSourceFormatLimits,
    compatibility: resolvedCompatibility,
    formatLabel: description.formatLabel,
    editStateLoss,
  });
  const resolvedDescription = {
    ...description,
    sourceFormatLimits: resolvedSourceFormatLimits,
    bitDepth: resolvedBitDepth,
    compatibility: resolvedCompatibility,
    compatibilityWarnings,
    editStateLoss,
    readiness,
    roundTripCaveats,
    importPolicy,
  };

  return {
    ...resolvedDescription,
    policySignature: buildSourcePolicySignature(resolvedDescription),
  };
}

function buildCompatibilityWarningDescriptor(
  code: SourceImageFormatWarningCode,
): SourceImageCompatibilityWarningDescriptor {
  switch (code) {
    case 'svg-rasterized-import':
      return {
        code,
        category: 'vector-rasterized',
        severity: 'warning',
        summary: 'SVG vector objects are rasterized on import.',
      };
    case 'svg-flattened-export':
      return {
        code,
        category: 'vector-rasterized',
        severity: 'warning',
        summary: 'SVG export is a flattened raster snapshot rather than editable vector artwork.',
      };
    case 'gif-animation-first-frame':
      return {
        code,
        category: 'animation-loss',
        severity: 'warning',
        summary: 'GIF animation frames and timing are not preserved in Image.',
      };
    case 'gif-static-flattened-export':
      return {
        code,
        category: 'animation-loss',
        severity: 'warning',
        summary: 'GIF export is flattened to a static single-frame image.',
      };
    case 'tiff-format-limits':
      return {
        code,
        category: 'layer-mask-effect-loss',
        severity: 'warning',
        summary: 'TIFF interoperability is flattened; native layer, mask, and effect structures are not round-tripped.',
      };
    case 'camera-raw-import-unsupported':
      return {
        code,
        category: 'raw-development',
        severity: 'warning',
        summary: 'Develop Camera Raw externally before opening in Image.',
      };
    case 'high-bit-depth-raster-loss':
    case 'high-bit-depth-import-unsupported':
      return {
        code,
        category: 'high-bit-depth-loss',
        severity: 'warning',
        summary: 'High-bit-depth source samples are not preserved in Image editing.',
      };
    case 'psd-native-constructs-flattened':
    case 'xcf-editable-state-loss':
      return {
        code,
        category: 'editable-state-loss',
        severity: 'warning',
        summary: 'Native editable state is represented as flattened pixels or metadata where supported.',
      };
    case 'psb-import-unsupported':
      return {
        code,
        category: 'unsupported-format',
        severity: 'warning',
        summary: 'PSB large-document import/export is unsupported; convert to a supported handoff format before opening in Image.',
      };
    case 'xcf-format-limits':
      return {
        code,
        category: 'format-limits',
        severity: 'warning',
        summary: 'XCF import is bounded to 8-bit layers and masks with uncompressed, RLE, or zlib tiles, and to the documented pixel, layer, and structure caps.',
      };
    case 'xcf-import-unsupported':
    case 'exr-import-unsupported':
    default:
      return {
        code,
        category: 'unsupported-format',
        severity: 'warning',
        summary: 'This source format requires conversion or a limited handoff before editing in Image.',
      };
  }
}

function buildReadinessDescriptor({
  formatLabel,
  importStatus,
  exportStatus,
  warningCodes,
  roundTripCaveats,
}: {
  formatLabel: string;
  importStatus: SourceImageFormatImportStatus;
  exportStatus: SourceImageFormatExportStatus;
  warningCodes: readonly SourceImageFormatWarningCode[];
  roundTripCaveats: string[];
}): SourceImageFormatReadinessDescriptor {
  return {
    status: inferReadinessStatus(importStatus, exportStatus, warningCodes),
    importAction: inferImportAction(importStatus, warningCodes),
    exportAction: exportStatus,
    userSummary: buildUserCompatibilitySummary(formatLabel, importStatus, exportStatus, warningCodes),
    roundTripCaveats,
  };
}

function inferReadinessStatus(
  importStatus: SourceImageFormatImportStatus,
  exportStatus: SourceImageFormatExportStatus,
  warningCodes: readonly SourceImageFormatWarningCode[],
): SourceImageReadinessStatus {
  if (warningCodes.includes('camera-raw-import-unsupported') || warningCodes.includes('psb-import-unsupported')) return 'handoff-required';
  if (importStatus === 'unsupported' && exportStatus === 'unsupported') return 'unsupported';
  if (importStatus !== 'supported' || exportStatus !== 'layered-with-metadata' || warningCodes.length > 0) return 'limited';
  return 'ready';
}

function inferImportAction(
  importStatus: SourceImageFormatImportStatus,
  warningCodes: readonly SourceImageFormatWarningCode[],
): SourceImageImportAction {
  if (warningCodes.includes('camera-raw-import-unsupported')) return 'develop-first';
  if (
    warningCodes.includes('psb-import-unsupported')
    || warningCodes.includes('xcf-import-unsupported')
    || warningCodes.includes('exr-import-unsupported')
    || warningCodes.includes('high-bit-depth-import-unsupported')
  ) return 'convert-first';
  if (importStatus === 'rasterized') return 'rasterize';
  if (importStatus === 'first-frame-only') return 'first-frame-only';
  if (importStatus === 'supported') return 'open-as-pixels';
  return 'unsupported';
}

function buildUserCompatibilitySummary(
  formatLabel: string,
  importStatus: SourceImageFormatImportStatus,
  exportStatus: SourceImageFormatExportStatus,
  warningCodes: readonly SourceImageFormatWarningCode[],
): string {
  if (warningCodes.includes('camera-raw-import-unsupported')) {
    return 'Camera Raw requires external RAW development before Image can edit pixels.';
  }
  if (warningCodes.includes('tiff-format-limits')) {
    return 'TIFF opens for bounded classic uncompressed grayscale/RGB/RGBA data, including the supported native u16/f32 high-bit subset; other layouts refuse before lossy conversion.';
  }
  if (warningCodes.includes('gif-animation-first-frame')) {
    return 'Animated GIF opens as the first frame only; GIF export is flattened and static.';
  }
  if (warningCodes.includes('svg-rasterized-import')) {
    return 'SVG opens as rasterized pixels; export is a flattened raster snapshot, not editable vector artwork.';
  }
  if (importStatus === 'unsupported') {
    return `${formatLabel} must be converted before Image can edit it.`;
  }
  if (exportStatus === 'flattened-raster') {
    return `${formatLabel} opens as pixels and exports through flattened raster formats.`;
  }
  return `${formatLabel} can be opened with the current Image interoperability policy.`;
}

function buildRoundTripCaveats({
  formatLabel,
  warningCodes,
  limitations,
  importStatus,
  exportStatus,
}: {
  formatLabel: string;
  warningCodes: readonly SourceImageFormatWarningCode[];
  limitations: readonly string[];
  importStatus: SourceImageFormatImportStatus;
  exportStatus: SourceImageFormatExportStatus;
}): string[] {
  const caveats: string[] = [];
  if (warningCodes.includes('camera-raw-import-unsupported')) {
    caveats.push('RAW demosaic, camera profiles, and non-destructive RAW settings are not represented in Image documents.');
  }
  if (warningCodes.includes('tiff-format-limits')) {
    caveats.push('TIFF layers, masks, effects, compression variants, and high-bit-depth samples are not round-tripped as native edit state.');
  }
  if (warningCodes.includes('gif-animation-first-frame')) {
    caveats.push('GIF animation frames, frame delays, disposal modes, and looping metadata are not preserved in Image.');
  }
  if (warningCodes.includes('svg-rasterized-import')) {
    caveats.push('SVG vector objects, text, gradients, filters, masks, and effects are rasterized to pixels on import.');
  }
  if (warningCodes.includes('svg-flattened-export')) {
    caveats.push('SVG export wraps or represents a flattened raster snapshot rather than reconstructing editable vector state.');
  }
  if (warningCodes.includes('xcf-import-unsupported')) {
    caveats.push('This XCF file\'s tile compression is not decoded here; re-save it from GIMP with RLE or zlib tiles.');
  }
  if (warningCodes.includes('xcf-format-limits')) {
    caveats.push('XCF import is bounded to 8-bit layers and masks with uncompressed, RLE, or zlib tiles, and to the documented pixel, layer, and structure caps.');
  }
  if (importStatus === 'unsupported' && caveats.length === 0) {
    caveats.push(`${formatLabel} import is unsupported and requires conversion before editing.`);
  }
  if (exportStatus === 'flattened-raster' && caveats.length === 0) {
    caveats.push(`${formatLabel} export is flattened raster output; layered edit state stays in the Image document.`);
  }
  return uniqueStrings([...caveats, ...limitations.filter((limit) => /layer|mask|effect|animation|vector|RAW|demosaic|flatten/i.test(limit))]);
}

function buildSourceImageImportPolicy({
  importStatus,
  warningCodes,
  limitations,
  sourceFormatLimits,
  compatibility,
  formatLabel,
  editStateLoss,
}: {
  importStatus: SourceImageFormatImportStatus;
  warningCodes: readonly SourceImageFormatWarningCode[];
  limitations: readonly string[];
  sourceFormatLimits: readonly string[];
  compatibility: SourceImageFormatCompatibilityDescriptor;
  formatLabel: string;
  editStateLoss: SourceImageEditStateLossDescriptor;
}): SourceImageImportPolicyDescriptor {
  const requiresExternalProcessor = warningCodes.includes('camera-raw-import-unsupported')
    || warningCodes.includes('psb-import-unsupported')
    || warningCodes.includes('exr-import-unsupported')
    || warningCodes.includes('high-bit-depth-import-unsupported');

  return {
    status: importStatus,
    canOpenAsPixels: importStatus === 'supported' || importStatus === 'rasterized' || importStatus === 'first-frame-only',
    requiresExternalProcessor,
    recommendedHandoffFormats: requiresExternalProcessor ? [...CAMERA_RAW_SUPPORTED_HANDOFF_FORMATS] : [],
    recommendedFallbackRoutes: buildWorkflowFallbackRoutes({
      formatLabel,
      warningCodes,
      importStatus,
      editStateLoss,
    }),
    vectorStatePreserved: compatibility.nativeRoundtrip !== 'rasterized' && compatibility.preservesEditableLayers,
    animationPreserved: compatibility.preservesAnimation,
    limitations: uniqueStrings([...limitations, ...sourceFormatLimits]),
  };
}

function buildEditStateLossDescriptor({
  formatLabel,
  warningCodes,
  importStatus,
  exportStatus,
}: {
  formatLabel: string;
  warningCodes: readonly SourceImageFormatWarningCode[];
  importStatus: SourceImageFormatImportStatus;
  exportStatus: SourceImageFormatExportStatus;
}): SourceImageEditStateLossDescriptor {
  if (warningCodes.includes('camera-raw-import-unsupported')) {
    return {
      layers: 'RAW development yields a single developed raster derivative; layered Image work begins only after export to PSD, TIFF, PNG, or JPEG.',
      text: 'RAW camera files do not carry Image text-layer edit state; add text after external development.',
      effects: 'RAW develop controls stay outside Image and do not become editable Image layer effects.',
      sourceLinks: 'Keep the original RAW in the Source Library for provenance; Image edits apply only to the developed derivative.',
    };
  }
  if (warningCodes.includes('psb-import-unsupported')) {
    return {
      layers: 'PSB cannot be opened directly in Image; convert to PSD for layered work or TIFF, PNG, or JPEG for flattened handoff.',
      text: 'Text editability depends on the external conversion path before import; Image does not import native PSB text state.',
      effects: 'Effect editability depends on the external conversion path before import; native PSB effect records are not read here.',
      sourceLinks: 'Source-linked or Smart Object semantics do not import from PSB in Image; keep the original PSB beside any converted derivative.',
    };
  }
  if (warningCodes.includes('xcf-format-limits')) {
    return {
      layers: 'XCF raster layers import as editable Image layers within the documented bounds; groups flatten to a flat list with an explicit warning.',
      text: 'Editable XCF text imports as raster pixels with an explicit per-layer warning.',
      effects: 'Native GIMP effects are not reconstructed as editable constructs; effect state imports as the pixels GIMP rendered.',
      sourceLinks: 'Source-linked layers and Smart Object-like relationships are not reconstructed as native XCF links.',
    };
  }
  if (warningCodes.includes('xcf-import-unsupported')) {
    return {
      layers: 'This XCF file\'s tile compression is not decoded; re-save it from GIMP with RLE or zlib tiles before opening here.',
      text: 'Text editability depends on re-saving the workfile with supported tiles; Image does not reconstruct native XCF text state.',
      effects: 'Effect editability depends on re-saving the workfile with supported tiles; native effect records are not read here.',
      sourceLinks: 'Source-linked or Smart Object semantics do not import from XCF; keep the original workfile beside any converted derivative.',
    };
  }
  if (warningCodes.includes('psd-native-constructs-flattened')) {
    return {
      layers: 'Raster PSD layers can reopen, but unsupported groups, adjustments, and linked constructs fall back to flattened pixels or metadata-only records.',
      text: 'Retained text is stored as Sloom Studio metadata; exported PSD layers do not carry native editable PSD text records.',
      effects: 'Layer effects are flattened into PSD pixels and metadata-only settings instead of native PSD layer-effect records.',
      sourceLinks: 'Source-linked layers export as flattened pixels plus Sloom Studio metadata; native PSD Smart Object and source-link records are not written.',
    };
  }
  if (warningCodes.includes('svg-rasterized-import') || warningCodes.includes('svg-flattened-export')) {
    return {
      layers: 'SVG artwork is rasterized on import and flattened on export; retained layer structure is not reconstructed.',
      text: 'SVG text becomes raster pixels on import and export.',
      effects: 'SVG filters, masks, gradients, and effects are rasterized into pixels.',
      sourceLinks: 'Keep the original SVG in the Source Library if provenance matters; rasterized Image edits do not preserve external SVG link semantics.',
    };
  }
  if (warningCodes.includes('gif-animation-first-frame') || warningCodes.includes('gif-static-flattened-export')) {
    return {
      layers: 'GIF import opens a single raster frame and GIF export writes a single flattened frame only.',
      text: 'Text is baked into the imported or exported GIF frame.',
      effects: 'Layer effects are baked into the imported or exported GIF frame.',
      sourceLinks: 'Source-linked relationships are not represented in GIF files; keep linked originals outside the GIF handoff.',
    };
  }
  if (warningCodes.includes('tiff-format-limits') || warningCodes.includes('high-bit-depth-import-unsupported')) {
    return {
      layers: 'TIFF import and export operate as flattened raster pixels only; layered edit state does not round-trip.',
      text: 'Text is flattened into visible TIFF pixels.',
      effects: 'Layer effects are flattened into visible TIFF pixels.',
      sourceLinks: 'Source-linked relationships are not represented in TIFF; keep linked originals in the Source Library or a PSD working file.',
    };
  }
  if (importStatus === 'unsupported') {
    return {
      layers: `${formatLabel} requires conversion before Image can edit raster layers.`,
      text: `${formatLabel} text editability is not preserved through unsupported import.`,
      effects: `${formatLabel} effect editability is not preserved through unsupported import.`,
      sourceLinks: `${formatLabel} source-link semantics are not available to Image without conversion.`,
    };
  }
  if (exportStatus === 'flattened-raster') {
    return {
      layers: `${formatLabel} export is flattened; layered edit state stays in the Image document.`,
      text: `${formatLabel} export bakes text into raster pixels.`,
      effects: `${formatLabel} export bakes layer effects into raster pixels.`,
      sourceLinks: `${formatLabel} export does not carry native source-link relationships.`,
    };
  }
  return {
    layers: `${formatLabel} can reopen raster layers under the current policy.`,
    text: `${formatLabel} text editability is limited to what Image retains in local metadata.`,
    effects: `${formatLabel} effect editability is limited to what Image retains in local metadata.`,
    sourceLinks: `${formatLabel} source-link state is limited to what Image retains in local metadata.`,
  };
}

function buildWorkflowFallbackRoutes({
  formatLabel,
  warningCodes,
  importStatus,
  editStateLoss,
}: {
  formatLabel: string;
  warningCodes: readonly SourceImageFormatWarningCode[];
  importStatus: SourceImageFormatImportStatus;
  editStateLoss: SourceImageEditStateLossDescriptor;
}): SourceImageWorkflowFallbackRouteDescriptor[] {
  if (warningCodes.includes('camera-raw-import-unsupported')) {
    return [
      {
        route: 'external-raw-development',
        label: 'Develop in RAW processor',
        preserves: 'demosaic, camera profile, lens correction, and non-destructive RAW controls',
        recommendedFor: 'Primary develop master before any Image editing.',
        caveat: 'Image cannot open RAW sensor data directly; only the developed derivative continues into Image.',
      },
      {
        route: 'psd-developed-derivative',
        label: 'PSD developed derivative',
        preserves: 'developed pixels plus room for layered Image edits after import',
        recommendedFor: 'Continue compositing after external RAW development.',
        caveat: editStateLoss.layers,
      },
      {
        route: 'tiff-developed-derivative',
        label: 'TIFF developed derivative',
        preserves: 'developed raster pixels for print-oriented handoff',
        recommendedFor: 'Bake the develop result for raster finishing or print exchange.',
        caveat: 'Keep the RAW separately; TIFF does not preserve RAW develop controls, source links, or layered edit state.',
      },
      {
        route: 'source-library-original',
        label: 'Keep original RAW in Source Library',
        preserves: 'the untouched camera original for provenance and re-development',
        recommendedFor: 'Reference and archive alongside developed derivatives.',
        caveat: editStateLoss.sourceLinks,
      },
    ];
  }
  if (warningCodes.includes('psb-import-unsupported')) {
    return [
      {
        route: 'psd-conversion',
        label: 'Convert to PSD',
        preserves: 'the safest layered route Image can reopen',
        recommendedFor: 'Working master when the large document can be reduced into PSD limits.',
        caveat: 'Layer, text, effect, and source-link fidelity depends on the external conversion; verify after conversion.',
      },
      {
        route: 'tiff-visible-composite',
        label: 'TIFF visible composite',
        preserves: 'flattened print-oriented pixels',
        recommendedFor: 'Visible raster handoff when layered editing is no longer required.',
        caveat: 'Loses layers, editable text, effects, and source links.',
      },
      {
        route: 'png-jpeg-preview',
        label: 'PNG or JPEG preview',
        preserves: 'lightweight flattened preview pixels',
        recommendedFor: 'Review, approvals, or quick downstream preview use.',
        caveat: 'Preview exports drop layered, text, effect, and source-link editability.',
      },
      {
        route: 'source-library-original',
        label: 'Keep original PSB in Source Library',
        preserves: 'the original large-document file for archive or external suite work',
        recommendedFor: 'Retain provenance when conversion is necessary.',
        caveat: editStateLoss.sourceLinks,
      },
    ];
  }
  if (warningCodes.includes('xcf-import-unsupported')) {
    return [
      {
        route: 'psd-layered-handoff',
        label: 'PSD layered handoff',
        preserves: 'best-effort raster layers and metadata after conversion',
        recommendedFor: 'Best route when you still need a layered document Image can reopen.',
        caveat: 'Text, masks, effects, groups, and source links may still flatten during GIMP-to-PSD conversion.',
      },
      {
        route: 'tiff-visible-composite',
        label: 'TIFF visible composite',
        preserves: 'flattened print-oriented pixels',
        recommendedFor: 'Visible composite handoff after editing elsewhere.',
        caveat: 'Loses XCF layers, text editability, effects, and source-link semantics.',
      },
      {
        route: 'png-visible-composite',
        label: 'PNG visible composite',
        preserves: 'flattened pixels and transparency',
        recommendedFor: 'Preview or lightweight flattened exchange.',
        caveat: 'Loses XCF layers, masks, text editability, effects, and source links.',
      },
      {
        route: 'source-library-original',
        label: 'Keep original XCF in Source Library',
        preserves: 'the untouched GIMP workfile for reference or external editing',
        recommendedFor: 'Archive provenance while using converted derivatives in Image.',
        caveat: editStateLoss.sourceLinks,
      },
    ];
  }
  if (warningCodes.includes('psd-native-constructs-flattened') || (importStatus === 'supported' && formatLabel === 'PSD')) {
    return [
      {
        route: 'psd-signal-loom-metadata',
        label: 'PSD with Sloom Studio metadata',
        preserves: 'raster layers plus retained Sloom Studio text, effects, adjustment, source-link, and filter metadata',
        recommendedFor: 'Best working master when Sloom Studio will reopen the PSD.',
        caveat: 'Text, effects, and source links reopen as metadata-only or flattened constructs, not native PSD records.',
      },
      {
        route: 'source-library-package',
        label: 'Source Library package',
        preserves: 'original linked assets, snapshots, relink history, and retained metadata beside the PSD',
        recommendedFor: 'Keep suite handoff recoverable when linked assets or smart filters matter.',
        caveat: 'Requires the packaged project assets; external PSD tools still do not see native Smart Object or source-link records.',
      },
      {
        route: 'tiff-visible-composite',
        label: 'TIFF visible composite',
        preserves: 'flattened print-oriented pixels',
        recommendedFor: 'Print or approval handoff where editability is no longer required.',
        caveat: 'Loses editable layers, text, effects, masks, source links, filters, and groups.',
      },
      {
        route: 'png-visible-composite',
        label: 'PNG visible composite',
        preserves: 'flattened visible pixels with transparency',
        recommendedFor: 'Preview or lightweight flattened handoff.',
        caveat: 'Use for preview only; text, effects, layers, and source links are all baked into pixels.',
      },
    ];
  }
  if (warningCodes.includes('svg-rasterized-import') || warningCodes.includes('svg-flattened-export')) {
    return [
      {
        route: 'source-library-original-svg',
        label: 'Keep original SVG in Source Library',
        preserves: 'the original vector artwork and source provenance',
        recommendedFor: 'Return to a vector editor or preserve the authoring source.',
        caveat: editStateLoss.sourceLinks,
      },
      {
        route: 'png-visible-composite',
        label: 'PNG visible composite',
        preserves: 'flattened pixels and transparency',
        recommendedFor: 'Preview or downstream raster handoff.',
        caveat: 'Vector text, effects, filters, and masks remain rasterized.',
      },
      {
        route: 'psd-raster-working-file',
        label: 'PSD raster working file',
        preserves: 'the rasterized import in a layered Image-friendly working format',
        recommendedFor: 'Continue raster compositing after accepting the SVG-to-pixels conversion.',
        caveat: 'Keeps the rasterized result only; editable SVG vector state is not reconstructed.',
      },
    ];
  }
  if (warningCodes.includes('gif-animation-first-frame') || warningCodes.includes('gif-static-flattened-export')) {
    return [
      {
        route: 'video-animation-workflow',
        label: 'Use Video for animation',
        preserves: 'frame timing, ordering, and animation workflow controls',
        recommendedFor: 'Any animated GIF timing or multi-frame editing work.',
        caveat: 'Image only opens the first frame and exports a static flattened GIF.',
      },
      {
        route: 'png-single-frame',
        label: 'PNG single frame',
        preserves: 'the selected visible frame as a flattened raster image',
        recommendedFor: 'Edit or review one frame outside the animation timeline.',
        caveat: 'Animation timing, loops, text editability, effects, and source links are lost.',
      },
      {
        route: 'tiff-single-frame',
        label: 'TIFF single frame',
        preserves: 'a flattened single frame for print-oriented raster handoff',
        recommendedFor: 'Static print or color-critical frame delivery.',
        caveat: 'Animation state and any layered editability are lost.',
      },
    ];
  }
  if (warningCodes.includes('tiff-format-limits') || warningCodes.includes('high-bit-depth-import-unsupported')) {
    return [
      {
        route: 'psd-layered-working-master',
        label: 'PSD layered working master',
        preserves: 'the safest layered Image working file once TIFF pixels are imported',
        recommendedFor: 'Continue layered editing after a TIFF import or conversion.',
        caveat: 'TIFF itself stays flattened; keep PSD as the editable master if text, effects, or source links matter.',
      },
      {
        route: 'tiff-visible-composite',
        label: 'TIFF visible composite',
        preserves: 'flattened raster pixels for print-oriented exchange',
        recommendedFor: 'Final visible composite delivery.',
        caveat: 'Loses layers, text editability, effects, and source links.',
      },
      {
        route: 'png-preview-handoff',
        label: 'PNG preview handoff',
        preserves: 'lightweight flattened preview pixels',
        recommendedFor: 'Quick preview or review handoff.',
        caveat: 'Preview route remains flattened and does not preserve edit-state metadata.',
      },
    ];
  }
  return [];
}

function buildSourceImageOpenRoutes(
  policy: SourceImageFormatPolicy,
  description: SourceImageFormatPolicyDescription,
  unsupportedStates: SourceImageOpenUnsupportedStateDescriptor[],
): SourceImageOpenRouteDescriptor[] {
  if (policy.kind === 'cameraRaw') {
    return rankSourceImageOpenRoutes([
      sourceImageFallbackRouteToOpenRoute(description.importPolicy.recommendedFallbackRoutes[0], description.readiness.importAction, true),
      makeUnsupportedOpenRoute({
        route: 'open-as-pixels',
        label: 'Open RAW as pixels',
        openAction: 'develop-first',
        unsupportedStateCodes: ['native-raw-demosaic'],
        caveat: 'Image cannot demosaic RAW sensor data directly.',
      }),
      ...description.importPolicy.recommendedFallbackRoutes.slice(1).map((route) => sourceImageFallbackRouteToOpenRoute(route, description.readiness.importAction, true)),
    ]);
  }

  if (policy.kind === 'psd') {
    return rankSourceImageOpenRoutes([
      {
        route: 'open-layered-psd',
        rank: 0,
        supported: true,
        openAction: 'open-as-pixels',
        label: 'Open layered PSD',
        preserves: 'raster PSD layers plus Sloom Studio metadata where present',
        recommendedFor: 'PSD files within current size limits when raster layer editing is needed.',
        caveat: 'Full native PSD constructs are partial: text, effects, source links, smart filters, masks, and groups are flattened or metadata-only.',
        unsupportedStateCodes: ['full-psd-native-constructs'],
      },
      ...description.importPolicy.recommendedFallbackRoutes.map((route) => sourceImageFallbackRouteToOpenRoute(route, description.readiness.importAction, true)),
    ]);
  }

  if (policy.kind === 'psb') {
    return rankSourceImageOpenRoutes([
      ...description.importPolicy.recommendedFallbackRoutes.map((route) => sourceImageFallbackRouteToOpenRoute(route, description.readiness.importAction, true)),
      makeUnsupportedOpenRoute({
        route: 'open-as-psb',
        label: 'Open native PSB',
        openAction: 'convert-first',
        unsupportedStateCodes: ['native-psb-decode', 'full-psb-native-constructs'],
        caveat: 'Image has no PSB large-document decoder or full native Photoshop construct importer.',
      }),
    ]);
  }

  if (policy.kind === 'xcf') {
    if (description.importPolicy.canOpenAsPixels) {
      return rankSourceImageOpenRoutes([
        {
          route: 'open-as-pixels',
          rank: 0,
          supported: true,
          openAction: description.readiness.importAction,
          label: 'Open layered XCF',
          preserves: 'bounded 8-bit raster layers, masks, offsets, opacity, visibility, and blend modes',
          recommendedFor: 'GIMP XCF workfiles that fit Image’s documented 8-bit, tile-compression, pixel, layer, and structure limits.',
          caveat: 'Layers, masks, offsets, opacity, visibility, and blend modes import within the documented 8-bit/compression/caps limits; text, groups, filters, and source links stay flattened or warned.',
          unsupportedStateCodes: ['full-xcf-native-constructs'],
        },
        ...description.importPolicy.recommendedFallbackRoutes.map((route) => sourceImageFallbackRouteToOpenRoute(route, description.readiness.importAction, true)),
        makeUnsupportedOpenRoute({
          route: 'full-xcf-native-constructs',
          label: 'Full native XCF constructs',
          openAction: 'convert-first',
          unsupportedStateCodes: ['full-xcf-native-constructs'],
          caveat: 'Image does not reconstruct editable XCF text, groups, filters, effects, or source links as native constructs.',
        }),
      ]);
    }
    return rankSourceImageOpenRoutes([
      ...description.importPolicy.recommendedFallbackRoutes.map((route) => sourceImageFallbackRouteToOpenRoute(route, description.readiness.importAction, true)),
      makeUnsupportedOpenRoute({
        route: 'open-native-xcf',
        label: 'Open native XCF',
        openAction: 'convert-first',
        unsupportedStateCodes: ['native-xcf-decode', 'full-xcf-native-constructs'],
        caveat: 'This file\'s tile compression is not decoded; re-save it from GIMP with RLE or zlib tiles.',
      }),
    ]);
  }

  if (description.importPolicy.canOpenAsPixels) {
    return rankSourceImageOpenRoutes([{
      route: 'open-as-pixels',
      rank: 0,
      supported: true,
      openAction: description.readiness.importAction,
      label: description.importStatus === 'rasterized' ? `Rasterize ${description.formatLabel}` : `Open ${description.formatLabel} as pixels`,
      preserves: description.importStatus === 'first-frame-only'
        ? 'the first decoded frame as 8-bit RGBA pixels'
        : 'browser-decoded 8-bit RGBA pixels',
      recommendedFor: 'Direct Image editing when accepting the current raster import limits.',
      caveat: description.roundTripCaveats[0] ?? `${description.formatLabel} opens under the current raster import policy.`,
      unsupportedStateCodes: unsupportedStates
        .filter((state) => state.blocksOpenAsPixels)
        .map((state) => state.code),
    }]);
  }

  return rankSourceImageOpenRoutes(description.importPolicy.recommendedFallbackRoutes.map((route) => (
    sourceImageFallbackRouteToOpenRoute(route, description.readiness.importAction, true)
  )));
}

function rankSourceImageOpenRoutes(routes: Array<Omit<SourceImageOpenRouteDescriptor, 'rank'> & { rank?: number }>): SourceImageOpenRouteDescriptor[] {
  return routes
    .filter((route): route is Omit<SourceImageOpenRouteDescriptor, 'rank'> & { rank?: number } => Boolean(route))
    .map((route, index) => ({
      ...route,
      rank: index + 1,
      unsupportedStateCodes: uniqueSourceImageOpenUnsupportedStateCodes(route.unsupportedStateCodes),
    }));
}

function sourceImageFallbackRouteToOpenRoute(
  route: SourceImageWorkflowFallbackRouteDescriptor | undefined,
  openAction: SourceImageImportAction,
  supported: boolean,
): Omit<SourceImageOpenRouteDescriptor, 'rank'> {
  if (!route) {
    return {
      route: 'open-as-pixels',
      supported: false,
      openAction,
      label: 'Unsupported open route',
      preserves: 'nothing',
      recommendedFor: 'No supported direct route is available.',
      caveat: 'No fallback route is available for this source.',
      unsupportedStateCodes: [],
    };
  }
  return {
    route: route.route,
    supported,
    openAction,
    label: route.label,
    preserves: route.preserves,
    recommendedFor: route.recommendedFor,
    caveat: route.caveat,
    unsupportedStateCodes: [],
  };
}

function makeUnsupportedOpenRoute(input: {
  route: SourceImageOpenRouteKind;
  label: string;
  openAction: SourceImageImportAction;
  unsupportedStateCodes: SourceImageOpenUnsupportedStateCode[];
  caveat: string;
}): Omit<SourceImageOpenRouteDescriptor, 'rank'> {
  return {
    route: input.route,
    supported: false,
    openAction: input.openAction,
    label: input.label,
    preserves: 'no native editable state in Image',
    recommendedFor: 'Unsupported direct open attempt; use a ranked fallback route instead.',
    caveat: input.caveat,
    unsupportedStateCodes: input.unsupportedStateCodes,
  };
}

function buildSourceImageOpenUnsupportedStates(
  policy: SourceImageFormatPolicy,
  description: SourceImageFormatPolicyDescription,
): SourceImageOpenUnsupportedStateDescriptor[] {
  const states: SourceImageOpenUnsupportedStateDescriptor[] = [];
  if (policy.kind === 'cameraRaw') {
    states.push(
      makeSourceImageOpenUnsupportedState('native-raw-demosaic'),
      makeSourceImageOpenUnsupportedState('raw-camera-profile-controls'),
      makeSourceImageOpenUnsupportedState('raw-non-destructive-develop'),
    );
  }
  if (policy.kind === 'xcf') {
    states.push(makeSourceImageOpenUnsupportedState('full-xcf-native-constructs'));
  }
  if (policy.kind === 'psd') {
    states.push(makeSourceImageOpenUnsupportedState('full-psd-native-constructs'));
  }
  if (policy.kind === 'psb') {
    states.push(
      makeSourceImageOpenUnsupportedState('native-psb-decode'),
      makeSourceImageOpenUnsupportedState('full-psb-native-constructs'),
    );
  }
  if (!description.warningCodes.includes('exr-import-unsupported')) {
    states.push(makeSourceImageOpenUnsupportedState('icc-managed-open-transform'));
  }
  return uniqueSourceImageOpenUnsupportedStates(states);
}

function makeSourceImageOpenUnsupportedState(
  code: SourceImageOpenUnsupportedStateCode,
): SourceImageOpenUnsupportedStateDescriptor {
  switch (code) {
    case 'native-raw-demosaic':
      return {
        code,
        category: 'raw-development',
        blocksOpenAsPixels: true,
        summary: 'Native RAW demosaic is unavailable; RAW files require external development before Image can edit pixels.',
      };
    case 'raw-camera-profile-controls':
      return {
        code,
        category: 'raw-development',
        blocksOpenAsPixels: true,
        summary: 'Camera profile, white balance, lens correction, and sensor color controls are not implemented in Image.',
      };
    case 'raw-non-destructive-develop':
      return {
        code,
        category: 'raw-development',
        blocksOpenAsPixels: true,
        summary: 'Non-destructive RAW develop state is not stored or round-tripped by Image documents.',
      };
    case 'native-xcf-decode':
      return {
        code,
        category: 'native-decoder',
        blocksOpenAsPixels: true,
        summary: 'This file\'s XCF tile compression is not decoded; re-save it from GIMP with RLE or zlib tiles.',
      };
    case 'full-xcf-native-constructs':
      return {
        code,
        category: 'native-constructs',
        blocksOpenAsPixels: false,
        summary: 'Editable XCF text, groups, filters, effects, and source links are not reconstructed as native constructs. Detected GIMP non-destructive effects retain unfiltered source pixels with an explicit per-layer warning; unknown native constructs may require GIMP re-export before import.',
      };
    case 'full-psd-native-constructs':
      return {
        code,
        category: 'native-constructs',
        blocksOpenAsPixels: false,
        summary: 'Full PSD native constructs are partial: unsupported text, effects, masks, groups, Smart Objects, and smart filters are flattened or metadata-only.',
      };
    case 'native-psb-decode':
      return {
        code,
        category: 'native-decoder',
        blocksOpenAsPixels: true,
        summary: 'Native PSB large-document decoding is not implemented.',
      };
    case 'full-psb-native-constructs':
      return {
        code,
        category: 'native-constructs',
        blocksOpenAsPixels: true,
        summary: 'Full PSB native Photoshop constructs cannot be imported because PSB decoding is unsupported.',
      };
    case 'icc-managed-open-transform':
    default:
      return {
        code: 'icc-managed-open-transform',
        category: 'color-management',
        blocksOpenAsPixels: false,
        summary: 'ICC-managed open transforms are not applied; browser-decoded pixels are treated as 8-bit RGBA workspace pixels.',
      };
  }
}

function buildSourceImageFileOpenRoundtripRisk(
  description: SourceImageFormatPolicyDescription,
  unsupportedStates: SourceImageOpenUnsupportedStateDescriptor[],
): SourceImageFileOpenRoundtripRiskDescriptor {
  const level = getSourceImageFileOpenRoundtripRiskLevel(description);
  const formatId = formatLabelForStableId(description.formatLabel);
  const riskId = `roundtrip-risk:${formatId}:${level}:v1`;
  const affectedConstructs = unsupportedStates.map((state) => state.code);
  return {
    riskId,
    stableId: riskId,
    level,
    nativeRoundtrip: description.compatibility.nativeRoundtrip,
    affectedConstructs,
    summary: buildSourceImageFileOpenRoundtripRiskSummary(description.formatLabel, level),
  };
}

function getSourceImageFileOpenRoundtripRiskLevel(
  description: SourceImageFormatPolicyDescription,
): SourceImageRoundtripRiskLevel {
  if (description.compatibility.nativeRoundtrip === 'metadata-only') return 'metadata-only';
  if (description.compatibility.nativeRoundtrip === 'rasterized') return 'rasterized';
  if (description.compatibility.nativeRoundtrip === 'unsupported') return 'unsupported';
  return 'none';
}

function buildSourceImageFileOpenRoundtripRiskSummary(
  formatLabel: string,
  level: SourceImageRoundtripRiskLevel,
): string {
  switch (level) {
    case 'metadata-only':
      return `${formatLabel} can reopen through raster layers plus retained Sloom Studio metadata, but full native construct round-trip is not claimed.`;
    case 'rasterized':
      return `${formatLabel} opens through rasterization; editable native source structure is not round-tripped.`;
    case 'unsupported':
      return `${formatLabel} native open or round-trip is unsupported; use a ranked conversion or handoff route.`;
    case 'none':
    default:
      return `${formatLabel} has no native round-trip claim beyond the current pixel-open policy.`;
  }
}

function buildSourceImageOpenImportPolicySignature(
  description: SourceImageFormatPolicyDescription,
): string {
  return [
    'import-policy:v1',
    `format=${description.formatLabel}`,
    `status=${description.importStatus}`,
    `action=${description.readiness.importAction}`,
    `canOpen=${description.importPolicy.canOpenAsPixels}`,
    `external=${description.importPolicy.requiresExternalProcessor}`,
  ].join('|');
}

function buildSourceImageOpenFallbackRouteRankingSignature(
  formatLabel: string,
  routes: SourceImageOpenRouteDescriptor[],
): string {
  return [
    'fallback-ranking:v1',
    `format=${formatLabel}`,
    `routes=${routes.map((route) => `${route.rank}:${route.route}`).join(',') || 'none'}`,
  ].join('|');
}

function buildSourceImageOpenNativeConstructWarningSignature(
  formatLabel: string,
  warnings: SourceImageOpenUnsupportedStateDescriptor[],
): string {
  return [
    'native-constructs:v1',
    `format=${formatLabel}`,
    `warnings=${warnings.map((warning) => warning.code).join(',') || 'none'}`,
  ].join('|');
}

function formatLabelForStableId(formatLabel: string): string {
  return formatLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function uniqueSourceImageOpenUnsupportedStates(
  states: SourceImageOpenUnsupportedStateDescriptor[],
): SourceImageOpenUnsupportedStateDescriptor[] {
  const seen = new Set<SourceImageOpenUnsupportedStateCode>();
  return states.filter((state) => {
    if (seen.has(state.code)) return false;
    seen.add(state.code);
    return true;
  });
}

function uniqueSourceImageOpenUnsupportedStateCodes(
  codes: SourceImageOpenUnsupportedStateCode[],
): SourceImageOpenUnsupportedStateCode[] {
  return [...new Set(codes)];
}

function readPhotoshopDocumentHeader(bytes: Uint8Array | ArrayBuffer | undefined): {
  kind?: PhotoshopDocumentKind;
  width?: number;
  height?: number;
  channels?: number;
  bitDepth?: number;
  colorMode?: number;
} {
  const viewBytes = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : bytes;
  if (!viewBytes || viewBytes.length < 6) return {};
  if (viewBytes[0] !== 0x38 || viewBytes[1] !== 0x42 || viewBytes[2] !== 0x50 || viewBytes[3] !== 0x53) {
    return {};
  }

  const view = new DataView(viewBytes.buffer, viewBytes.byteOffset, viewBytes.byteLength);
  const version = view.getUint16(4, false);
  const header = {
    kind: version === 1 ? 'psd' as const : version === 2 ? 'psb' as const : 'unknown' as const,
    ...(viewBytes.length >= 26
      ? {
          channels: view.getUint16(12, false),
          height: view.getUint32(14, false),
          width: view.getUint32(18, false),
          bitDepth: view.getUint16(22, false),
          colorMode: view.getUint16(24, false),
        }
      : {}),
  };
  return header;
}

function inferPhotoshopDocumentKindFromIdentity(
  extension: string | undefined,
  mimeType: string | undefined,
): PhotoshopDocumentKind {
  if (extension === 'psb') return 'psb';
  if (extension === 'psd' || PSD_MIME_TYPES.has(mimeType ?? '')) return 'psd';
  return 'unknown';
}

function buildPhotoshopDocumentSizeBlockers({
  kind,
  width,
  height,
}: {
  kind: PhotoshopDocumentKind;
  width?: number;
  height?: number;
}): SourceImagePsbThresholdDescriptor[] {
  const blockers: SourceImagePsbThresholdDescriptor[] = [];
  if (kind === 'psb') {
    blockers.push({
      code: 'psb-header-version-2',
      limit: '8BPS version 2 header',
      unsupported: true,
      summary: 'PSB version 2 large-document headers are blocked before ag-psd import.',
    });
  }
  if (
    (typeof width === 'number' && width > PHOTOSHOP_PSD_MAX_DIMENSION)
    || (typeof height === 'number' && height > PHOTOSHOP_PSD_MAX_DIMENSION)
  ) {
    blockers.push({
      code: 'psd-max-dimension-exceeded',
      limit: '30,000 px per side',
      unsupported: true,
      summary: `PSD header dimensions ${width ?? 'unknown'} x ${height ?? 'unknown'} exceed the 30,000 px PSD limit; convert to a supported derivative before Image import.`,
    });
  }
  return blockers;
}

function buildPhotoshopLargeDocumentFallbackRoutes(): SourceImageWorkflowFallbackRouteDescriptor[] {
  return [
    {
      route: 'psd-conversion',
      label: 'Convert to PSD within size limits',
      preserves: 'the safest layered route Image can attempt when dimensions fit PSD limits',
      recommendedFor: 'Working master handoff after reducing canvas size, cropping, or flattening oversized content.',
      caveat: 'Layer, text, effect, and source-link fidelity depends on the external conversion; verify after conversion.',
    },
    {
      route: 'tiff-visible-composite',
      label: 'TIFF visible composite',
      preserves: 'flattened print-oriented pixels',
      recommendedFor: 'Visible raster handoff when layered editing is no longer required.',
      caveat: 'Loses layers, editable text, effects, and source links.',
    },
    {
      route: 'png-jpeg-preview',
      label: 'PNG or JPEG preview',
      preserves: 'lightweight flattened preview pixels',
      recommendedFor: 'Review, approvals, or quick downstream preview use.',
      caveat: 'Preview exports drop layered, text, effect, and source-link editability.',
    },
    {
      route: 'source-library-original',
      label: 'Keep original Photoshop document in Source Library',
      preserves: 'the original PSD/PSB for archive or external suite work',
      recommendedFor: 'Retain provenance when conversion is necessary.',
      caveat: 'Image cannot decode PSB or oversized PSD layer data directly.',
    },
  ];
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeSourceExtension(fileName: string | undefined): string | undefined {
  const value = fileName?.trim().toLowerCase();
  if (!value) return undefined;
  const withoutQuery = value.split(/[?#]/)[0];
  const extension = withoutQuery.startsWith('.') && !withoutQuery.slice(1).includes('.')
    ? withoutQuery.slice(1)
    : withoutQuery.split('.').pop();
  return extension || undefined;
}

function buildSourcePolicySignature(description: Omit<SourceImageFormatPolicyDescription, 'policySignature'>): string {
  return [
    'source-format:v1',
    `format=${description.formatLabel}`,
    `ext=${description.sourceExtension ?? 'none'}`,
    `mime=${description.sourceMimeType ?? 'none'}`,
    `import=${description.importStatus}`,
    `export=${description.exportStatus}`,
    `bitDepth=${description.bitDepth.sourceBitsPerChannel}`,
    `warnings=${description.warningCodes.join(',') || 'none'}`,
  ].join('|');
}

function buildLayerPolicyDescriptor(
  description: SourceImageFormatPolicyDescription,
): SourceImageLayerPolicyDescriptor {
  const importPreservesLayers = description.compatibility.preservesEditableLayers && description.importStatus === 'supported';
  const exportPreservesLayers = description.exportStatus === 'layered-with-metadata' && description.compatibility.preservesEditableLayers;
  const flattening: SourceImageLayerFlatteningPolicy = description.importStatus === 'unsupported'
    ? 'unsupported'
    : exportPreservesLayers
      ? 'preserves-layers'
      : description.importStatus === 'rasterized'
        ? 'flattens-on-import'
        : 'flattens-on-export';

  return {
    importPreservesLayers,
    exportPreservesLayers,
    flattening,
    summary: exportPreservesLayers
      ? `${description.formatLabel} can carry layered metadata for this policy.`
      : `${description.formatLabel} handoff is flattened for layer preservation; editable layer, mask, effect, and adjustment state stays in the Image document or metadata only.`,
  };
}

function buildAnimationPolicyDescriptor(
  description: SourceImageFormatPolicyDescription,
): SourceImageAnimationPolicyDescriptor {
  const animatedGif = description.warningCodes.includes('gif-animation-first-frame');
  const notDecoded = description.importStatus === 'unsupported';
  const importFrameLimit: SourceImageFrameLimit = animatedGif ? 1 : notDecoded ? 'not-decoded' : 'none';
  const exportFrameLimit: SourceImageFrameLimit = description.exportStatus === 'flattened-raster' ? 1 : notDecoded ? 'not-decoded' : 'none';

  return {
    importFrameLimit,
    exportFrameLimit,
    preservesAnimation: description.compatibility.preservesAnimation,
    summary: animatedGif
      ? 'Animated GIF imports the first frame only and exports a flattened single-frame GIF; frame delays, disposal modes, and loops are not preserved.'
      : `${description.formatLabel} does not preserve timeline animation in Image export policy.`,
  };
}

function buildVectorPolicyDescriptor(
  description: SourceImageFormatPolicyDescription,
): SourceImageVectorPolicyDescriptor {
  const rasterizedSvg = description.warningCodes.includes('svg-rasterized-import') || description.warningCodes.includes('svg-flattened-export');
  return {
    importPreservesVectorState: !rasterizedSvg && description.compatibility.preservesEditableLayers,
    exportPreservesVectorState: !rasterizedSvg && description.exportStatus !== 'flattened-raster',
    summary: rasterizedSvg
      ? 'SVG is rasterized on import and flattened on export; editable vector objects, text, filters, gradients, and masks are not reconstructed.'
      : `${description.formatLabel} vector edit state is not guaranteed outside retained Image document metadata.`,
  };
}

function buildColorProfilePolicyDescriptor(
  description: SourceImageFormatPolicyDescription,
): SourceImageColorProfilePolicyDescriptor {
  return {
    preservesEmbeddedProfiles: false,
    summary: `${description.formatLabel} policy uses browser/canvas or local 8-bit RGBA pixels; embedded ICC profiles, camera profiles, and wide-gamut color management are not round-tripped as native profile data.`,
  };
}

function buildReadinessBitDepthPolicy(
  policy: SourceImageFormatPolicy,
  description: SourceImageFormatPolicyDescription,
): SourceImageBitDepthDescriptor {
  if (policy.kind === 'tiff' && policy.sourceBitsPerChannel === undefined) {
    return {
      ...description.bitDepth,
      sourceBitsPerChannel: 'unknown',
    };
  }
  return description.bitDepth;
}

function buildSourceExportReadinessSignature(
  readiness: Omit<SourceImageFormatExportReadinessDescriptor, 'stableSignature'>,
): string {
  const layerSignature = readiness.layerPolicy.exportPreservesLayers ? 'preserved' : 'flattened';
  return [
    'source-export-readiness:v1',
    `format=${readiness.formatLabel}`,
    `import=${readiness.importAction}`,
    `export=${readiness.exportAction}`,
    `layers=${layerSignature}`,
    `frames=${readiness.animationPolicy.importFrameLimit}`,
    `bitDepth=${readiness.bitDepthPolicy.sourceBitsPerChannel}`,
    `warnings=${readiness.warningCodes.join(',') || 'none'}`,
  ].join('|');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function createCameraRawUnsupportedImportBlockers(): CameraRawImportBlockerDescriptor[] {
  return [
    {
      code: 'raw-demosaic-missing',
      summary: 'Image has no RAW demosaic/development pipeline for camera sensor data.',
    },
    {
      code: 'camera-profile-controls-missing',
      summary: 'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
    },
  ];
}

function buildCameraRawOpenUnsupportedStates(): CameraRawUnsupportedStateDescriptor[] {
  return [
    {
      code: 'native-raw-open',
      message: 'Native Camera Raw files cannot be opened as editable Image pixels without external development.',
    },
    {
      code: 'raw-demosaic',
      message: 'RAW demosaic is unsupported in the Image workspace.',
    },
    {
      code: 'raw-camera-profile-controls',
      message: 'Camera profile, white balance, lens correction, and sensor color controls are unsupported in Image.',
    },
    {
      code: 'raw-non-destructive-develop',
      message: 'Non-destructive RAW develop settings are not stored or round-tripped by Image documents.',
    },
  ];
}

function createNotDecodedBitDepthDescriptor(
  sourceBitsPerChannel: SourceImageBitsPerChannel,
): SourceImageBitDepthDescriptor {
  return {
    status: 'not-decoded',
    sourceBitsPerChannel,
    editorBitsPerChannel: 8,
    browserDecodedTo: 'not decoded',
    preservesHighBitDepth: false,
  };
}

function createBrowserRasterBitDepthDescriptor(policy: SourceImageFormatPolicy): SourceImageBitDepthDescriptor {
  if (policy.highBitDepth && policy.sourceBitsPerChannel) {
    return {
      status: 'high-bit-depth-loss-warning',
      sourceBitsPerChannel: policy.sourceBitsPerChannel,
      editorBitsPerChannel: 8,
      browserDecodedTo: BROWSER_RASTER_DEPTH_LABEL,
      preservesHighBitDepth: false,
      warning: createHighBitDepthRasterWarning(policy),
    };
  }

  return {
    status: 'browser-8-bit-rgba',
    sourceBitsPerChannel: policy.sourceBitsPerChannel ?? 'unknown',
    editorBitsPerChannel: 8,
    browserDecodedTo: BROWSER_RASTER_DEPTH_LABEL,
    preservesHighBitDepth: false,
  };
}

function createNativeEightBitDepthDescriptor(): SourceImageBitDepthDescriptor {
  return {
    status: 'native-8-bit-supported',
    sourceBitsPerChannel: 8,
    editorBitsPerChannel: 8,
    browserDecodedTo: 'not decoded',
    preservesHighBitDepth: false,
  };
}

function createNativeHighBitDepthDescriptor(bits: 16 | 32): SourceImageBitDepthDescriptor {
  return {
    status: 'native-high-bit-supported',
    sourceBitsPerChannel: bits,
    editorBitsPerChannel: bits,
    browserDecodedTo: 'native u16/f32 PixelBuffer authority',
    preservesHighBitDepth: true,
  };
}

function createHighBitDepthRasterWarning(policy: SourceImageFormatPolicy): string {
  const formatLabel = policy.sourceFormatLabel ?? policy.kind.toUpperCase();
  const bits = policy.sourceBitsPerChannel ?? 'high-bit';
  return `${formatLabel} source is ${bits}-bit/channel, but browser image decoding and canvas editing reduce it to 8-bit RGBA pixels.`;
}

function createRasterSourceFormatLimits(policy: SourceImageFormatPolicy): string[] {
  const formatLabel = policy.sourceFormatLabel ?? 'Raster image';
  if (policy.sourceFormatLabel === 'PNG' && policy.sourceBitsPerChannel === 16) {
    return [
      'PNG16 imports use the bounded native u16 PixelBuffer authority and derive an 8-bit display proxy.',
    ];
  }
  const limits = [
    `${formatLabel} imports use browser image decoding and canvas APIs, so Image edits ${BROWSER_RASTER_DEPTH_LABEL} regardless of source bit depth.`,
  ];
  if (policy.sourceMimeType || policy.sourceExtension) {
    limits.push(`${formatSourceIdentity(policy, formatLabel)} is treated as a browser-decodable flattened raster source.`);
  }
  return limits;
}

function createTiffSourceFormatLimits(policy: SourceImageFormatPolicy): string[] {
  return [
    `${formatSourceIdentity(policy, 'TIFF')} must be classic uncompressed chunky 8-bit grayscale, RGB, or RGBA TIFF to import.`,
    'BigTIFF, compressed TIFF, planar TIFF, floating point samples, and high-bit integer samples are not decoded.',
  ];
}

function formatSourceIdentity(policy: SourceImageFormatPolicy, fallbackLabel: string): string {
  const parts = [
    policy.sourceMimeType ? `Source MIME ${policy.sourceMimeType}` : undefined,
    policy.sourceExtension ? `.${policy.sourceExtension}` : undefined,
    policy.sourceFormatLabel ?? fallbackLabel,
  ].filter(Boolean);
  return parts.join(' / ');
}

function isXcfFileHeaderBytes(bytes: Uint8Array | undefined): boolean {
  if (!bytes || bytes.length < 14) return false;
  let magic = '';
  for (let index = 0; index < 9; index += 1) {
    magic += String.fromCharCode(bytes[index]);
  }
  return magic === 'gimp xcf ';
}

function getXcfUnsupportedCompressionMessage(
  inspection: ReturnType<typeof inspectXcfFileForPolicy>,
): string | undefined {
  const version = Number(/^v(\d{3})$/.exec(inspection?.versionTag ?? '')?.[1] ?? 0);
  const unsupportedPrecision = describeXcfUnsupportedPrecision(version, inspection?.precision ?? null);
  if (unsupportedPrecision) return unsupportedPrecision;
  const compression = inspection?.compression;
  if (compression === undefined || compression === null) return undefined;
  if (compression === 3) return describeXcfUnsupportedCompressionMessage(compression);
  if (compression === 2 && typeof DecompressionStream === 'undefined') {
    return describeXcfUnsupportedCompressionMessage(compression);
  }
  if (compression !== 0 && compression !== 1 && compression !== 2) {
    return describeXcfUnsupportedCompressionMessage(compression);
  }
  return undefined;
}

export function detectSourceImageFormatPolicy(input: {
  fileName?: string;
  mimeType?: string;
  bytes?: Uint8Array;
}): SourceImageFormatPolicy {
  const extension = input.fileName?.split('.').pop()?.toLowerCase();
  const mimeType = normalizeMimeType(input.mimeType);
  const bytes = input.bytes;

  if (bytes && bytes.length >= 4 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) {
    const version = bytes.length >= 6 ? (bytes[4] << 8) | bytes[5] : 1;
    if (version === 2) {
      return {
        kind: 'psb',
        message: 'PSB large-document files are detected, but Image currently supports layered PSD only. Convert to PSD, TIFF, PNG, or JPEG before opening.',
        ...createSourcePolicyMetadata(extension, mimeType, 'PSB'),
      };
    }
    return { kind: 'psd', ...createSourcePolicyMetadata(extension, mimeType, 'PSD') };
  }

  if (extension === 'psb') {
    return {
      kind: 'psb',
      message: 'PSB large-document files are not supported in Image yet. Convert to PSD, TIFF, PNG, or JPEG before opening.',
      ...createSourcePolicyMetadata(extension, mimeType, 'PSB'),
    };
  }
  if (extension === 'psd' || PSD_MIME_TYPES.has(mimeType ?? '')) return { kind: 'psd', ...createSourcePolicyMetadata(extension, mimeType, 'PSD') };
  if (extension === 'xcf' || XCF_MIME_TYPES.has(mimeType ?? '') || isXcfFileHeaderBytes(bytes)) {
    const inspection = inspectXcfFileForPolicy(bytes);
    const unsupportedCompressionMessage = getXcfUnsupportedCompressionMessage(inspection);
    return {
      kind: 'xcf',
      ...(unsupportedCompressionMessage ? { message: unsupportedCompressionMessage } : {}),
      ...createSourcePolicyMetadata(extension, mimeType, 'XCF'),
    };
  }
  if (extension === 'exr' || mimeType === 'image/x-exr' || mimeType === 'image/exr') {
    return {
      kind: 'exr',
      message: 'OpenEXR/HDR image data is detected, but Image does not currently include a browser-safe EXR decoder. Convert to PNG, TIFF, or JPEG before opening.',
      ...createSourcePolicyMetadata(extension, mimeType, 'OpenEXR'),
    };
  }
  if (isCameraRawFormat(extension, mimeType)) {
    return {
      kind: 'cameraRaw',
      message: CAMERA_RAW_UNSUPPORTED_MESSAGE,
      ...createSourcePolicyMetadata(extension, mimeType, 'Camera Raw'),
    };
  }
  if (extension === 'svg' || mimeType === IMAGE_SVG_MIME_TYPE || startsWithAscii(bytes, '<svg') || startsWithAscii(bytes, '<?xml')) {
    return { kind: 'svg' };
  }
  if (isTiffHeader(bytes) || extension === 'tif' || extension === 'tiff' || mimeType === IMAGE_TIFF_MIME_TYPE) {
    return { kind: 'tiff', ...createTiffPolicyMetadata(extension, mimeType, bytes) };
  }
  if (isGifHeader(bytes) || extension === 'gif' || mimeType === 'image/gif') {
    const animated = bytes ? isAnimatedGif(bytes) : false;
    return {
      kind: 'gif',
      animated,
      warning: animated ? 'Animated GIF opened as the first frame only. Use Video for animation/timing work.' : undefined,
      ...createSourcePolicyMetadata(extension, mimeType, 'GIF'),
    };
  }

  return { kind: 'raster', ...createRasterPolicyMetadata(extension, mimeType, bytes) };
}

export function getImageMimeTypeFromRegistry(fileName?: string, mimeType?: string): string {
  const format = inferFormatFromFile(fileName, mimeType);
  if (format?.kind === 'image') {
    return inferMimeTypeFromFile(fileName, 'image') ?? format.mimeTypes[0] ?? 'image/png';
  }
  return mimeType || 'image/png';
}

function createSourcePolicyMetadata(
  extension: string | undefined,
  mimeType: string | undefined,
  sourceFormatLabel: string,
): SourceImageFormatPolicyMetadata {
  return {
    sourceFormatLabel,
    ...(mimeType ? { sourceMimeType: mimeType } : {}),
    ...(extension ? { sourceExtension: extension } : {}),
  };
}

function createTiffPolicyMetadata(
  extension: string | undefined,
  mimeType: string | undefined,
  bytes: Uint8Array | undefined,
): SourceImageFormatPolicyMetadata {
  const bits = readTiffBitsPerChannel(bytes);
  return {
    ...createSourcePolicyMetadata(extension, mimeType, 'TIFF'),
    ...(bits ? { sourceBitsPerChannel: bits } : {}),
    ...(bits && bits > 8 ? { highBitDepth: true } : {}),
  };
}

function createRasterPolicyMetadata(
  extension: string | undefined,
  mimeType: string | undefined,
  bytes: Uint8Array | undefined,
): SourceImageFormatPolicyMetadata {
  const sourceFormatLabel = inferBrowserRasterFormatLabel(extension, mimeType, bytes);
  const bits = sourceFormatLabel === 'PNG' ? readPngBitsPerChannel(bytes) : undefined;
  return {
    ...createSourcePolicyMetadata(extension, mimeType, sourceFormatLabel),
    ...(bits ? { sourceBitsPerChannel: bits } : {}),
    ...(bits && bits > 8 ? { highBitDepth: true } : {}),
  };
}

function inferBrowserRasterFormatLabel(
  extension: string | undefined,
  mimeType: string | undefined,
  bytes: Uint8Array | undefined,
): string {
  if (isPngHeader(bytes) || extension === 'png' || mimeType === 'image/png') return 'PNG';
  if (extension === 'jpg' || extension === 'jpeg' || mimeType === 'image/jpeg') return 'JPEG';
  if (extension === 'webp' || mimeType === 'image/webp') return 'WebP';
  if (extension === 'avif' || mimeType === 'image/avif') return 'AVIF';
  if (extension === 'bmp' || mimeType === IMAGE_BMP_MIME_TYPE) return 'BMP';
  return 'Raster image';
}

function normalizeCameraRawExtension(extensionOrFileName: string | undefined): string | undefined {
  const value = extensionOrFileName?.trim().toLowerCase();
  if (!value) return undefined;
  const withoutQuery = value.split(/[?#]/)[0];
  const extension = withoutQuery.startsWith('.') && !withoutQuery.slice(1).includes('.')
    ? withoutQuery.slice(1)
    : withoutQuery.split('.').pop();
  return extension || undefined;
}

function isCameraRawFormat(extension: string | undefined, mimeType: string | undefined): boolean {
  return CAMERA_RAW_EXTENSIONS.has(extension ?? '') || CAMERA_RAW_MIME_TYPES.has(mimeType ?? '');
}

export function encodeImageDataToTiff(imageData: ImageData): Uint8Array {
  const width = Math.max(1, Math.floor(imageData.width));
  const height = Math.max(1, Math.floor(imageData.height));
  const rgbaByteCount = width * height * 4;
  const tagCount = 11;
  const ifdOffset = 8;
  const ifdByteCount = 2 + tagCount * 12 + 4;
  const bitsOffset = ifdOffset + ifdByteCount;
  const extraSamplesOffset = bitsOffset + 8;
  const stripOffset = extraSamplesOffset + 2;
  const output = new Uint8Array(stripOffset + rgbaByteCount);
  const view = new DataView(output.buffer);

  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, tagCount, true);

  let entry = ifdOffset + 2;
  const writeTag = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, count, true);
    if (type === 3 && count === 1) {
      view.setUint16(entry + 8, value, true);
      view.setUint16(entry + 10, 0, true);
    } else {
      view.setUint32(entry + 8, value, true);
    }
    entry += 12;
  };

  writeTag(256, 4, 1, width);
  writeTag(257, 4, 1, height);
  writeTag(258, 3, 4, bitsOffset);
  writeTag(259, 3, 1, 1);
  writeTag(262, 3, 1, 2);
  writeTag(273, 4, 1, stripOffset);
  writeTag(277, 3, 1, 4);
  writeTag(278, 4, 1, height);
  writeTag(279, 4, 1, rgbaByteCount);
  writeTag(284, 3, 1, 1);
  writeTag(338, 3, 1, extraSamplesOffset);
  view.setUint32(entry, 0, true);

  for (let index = 0; index < 4; index += 1) view.setUint16(bitsOffset + index * 2, 8, true);
  view.setUint16(extraSamplesOffset, 2, true);
  output.set(new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength), stripOffset);
  return output;
}

export function encodeImageDataToBmp(imageData: ImageData): Uint8Array {
  const width = Math.max(1, Math.floor(imageData.width));
  const height = Math.max(1, Math.floor(imageData.height));
  const headerByteCount = 14 + 40;
  const pixelByteCount = width * height * 4;
  const output = new Uint8Array(headerByteCount + pixelByteCount);
  const view = new DataView(output.buffer);

  output[0] = 0x42;
  output[1] = 0x4d;
  view.setUint32(2, output.byteLength, true);
  view.setUint32(10, headerByteCount, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(34, pixelByteCount, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  let target = headerByteCount;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      output[target] = imageData.data[source + 2];
      output[target + 1] = imageData.data[source + 1];
      output[target + 2] = imageData.data[source];
      output[target + 3] = imageData.data[source + 3];
      target += 4;
    }
  }

  return output;
}

export function encodeImageDataToStaticGif(imageData: ImageData): Uint8Array {
  const width = Math.max(1, Math.min(65535, Math.floor(imageData.width)));
  const height = Math.max(1, Math.min(65535, Math.floor(imageData.height)));
  const output: number[] = [];
  const writeAscii = (value: string) => {
    for (let index = 0; index < value.length; index += 1) output.push(value.charCodeAt(index));
  };
  const writeU16 = (value: number) => {
    output.push(value & 0xff, (value >>> 8) & 0xff);
  };

  writeAscii('GIF89a');
  writeU16(width);
  writeU16(height);
  output.push(0xf7, 0, 0);
  output.push(...buildGifPalette());
  output.push(0x21, 0xf9, 0x04, 0x01, 0, 0, 0, 0);
  output.push(0x2c);
  writeU16(0);
  writeU16(0);
  writeU16(width);
  writeU16(height);
  output.push(0);
  output.push(8);
  output.push(...buildGifImageDataBlocks(indexGifPixels(imageData, width, height)));
  output.push(0x3b);

  return new Uint8Array(output);
}

export function decodeTiffToImageData(buffer: ArrayBuffer): ImageData {
  const bytes = new Uint8Array(buffer);
  if (!isTiffHeader(bytes)) throw new Error('Unsupported TIFF: missing classic TIFF header.');
  const littleEndian = bytes[0] === 0x49;
  const view = new DataView(buffer);
  const readU16 = (offset: number) => view.getUint16(offset, littleEndian);
  const readU32 = (offset: number) => view.getUint32(offset, littleEndian);
  const magic = readU16(2);
  if (magic === 43) throw new Error('Unsupported TIFF: BigTIFF is not supported. Export or convert to classic 8-bit TIFF first.');
  if (magic !== 42) throw new Error('Unsupported TIFF: invalid TIFF magic number.');

  const ifdOffset = readU32(4);
  const tagCount = readU16(ifdOffset);
  const tags = new Map<number, { type: number; count: number; valueOffset: number; entryOffset: number }>();
  for (let i = 0; i < tagCount; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    tags.set(readU16(entry), {
      type: readU16(entry + 2),
      count: readU32(entry + 4),
      valueOffset: readU32(entry + 8),
      entryOffset: entry,
    });
  }

  const getTagValue = (tag: number, fallback = 0) => {
    const entry = tags.get(tag);
    if (!entry) return fallback;
    if (entry.type === 3 && entry.count === 1) return readU16(entry.entryOffset + 8);
    return entry.valueOffset;
  };
  const getTagArray = (tag: number): number[] => {
    const entry = tags.get(tag);
    if (!entry) return [];
    const bytesPerValue = entry.type === 3 ? 2 : 4;
    if (entry.count === 1) return [getTagValue(tag)];
    const inline = entry.count * bytesPerValue <= 4;
    const offset = inline ? entry.entryOffset + 8 : entry.valueOffset;
    return Array.from({ length: entry.count }, (_, index) => entry.type === 3 ? readU16(offset + index * 2) : readU32(offset + index * 4));
  };

  const width = getTagValue(256);
  const height = getTagValue(257);
  const compression = getTagValue(259, 1);
  const photometric = getTagValue(262, 2);
  const samplesPerPixel = getTagValue(277, 1);
  const planarConfig = getTagValue(284, 1);
  const bitsPerSample = getTagArray(258);
  const stripOffsets = getTagArray(273);
  const stripByteCounts = getTagArray(279);
  const rowsPerStrip = getTagValue(278, height);

  if (width <= 0 || height <= 0) throw new Error('Unsupported TIFF: invalid image dimensions.');
  if (photometric === 5) throw new Error('DeviceCMYK TIFF must be opened through the native CMYK importer; no RGB channel reinterpretation was performed.');
  if (compression !== 1) throw new Error('Unsupported TIFF: compressed TIFF variants are not supported yet. Use uncompressed 8-bit RGB/RGBA TIFF.');
  if (planarConfig !== 1) throw new Error('Unsupported TIFF: planar TIFF data is not supported yet. Use chunky RGB/RGBA TIFF.');
  if (![1, 3, 4].includes(samplesPerPixel)) throw new Error('Unsupported TIFF: only grayscale, RGB, and RGBA samples are supported.');
  if (bitsPerSample.length > 0 && bitsPerSample.some((bits) => bits !== 8)) throw new Error('Unsupported TIFF: only 8-bit samples are supported.');

  const data = new Uint8ClampedArray(width * height * 4);
  let outputPixel = 0;
  for (let stripIndex = 0; stripIndex < stripOffsets.length; stripIndex += 1) {
    const offset = stripOffsets[stripIndex];
    const byteCount = stripByteCounts[stripIndex] ?? 0;
    const rows = Math.min(rowsPerStrip, height - stripIndex * rowsPerStrip);
    const expected = rows * width * samplesPerPixel;
    const limit = offset + Math.min(byteCount || expected, expected);
    for (let source = offset; source < limit && outputPixel < width * height; source += samplesPerPixel) {
      const target = outputPixel * 4;
      if (samplesPerPixel === 1) {
        const gray = photometric === 0 ? 255 - bytes[source] : bytes[source];
        data[target] = gray;
        data[target + 1] = gray;
        data[target + 2] = gray;
        data[target + 3] = 255;
      } else {
        data[target] = bytes[source];
        data[target + 1] = bytes[source + 1];
        data[target + 2] = bytes[source + 2];
        data[target + 3] = samplesPerPixel >= 4 ? bytes[source + 3] : 255;
      }
      outputPixel += 1;
    }
  }

  return makeImageData(data, width, height);
}

export function imageDataToBitmap(imageData: ImageData): LayerBitmap {
  const bitmap = createBitmap(imageData.width, imageData.height);
  putBitmapImageData(bitmap, imageData);
  return bitmap;
}

export async function createTiffImageDocument(buffer: ArrayBuffer, params: SourceImageOpenParams): Promise<ImageDocument> {
  const source = new Uint8Array(buffer);
  try {
    const decoded = decodeImageCmykTiff(source);
    if (!decoded.profileBytes) {
      throw new Error('DeviceCMYK TIFF import requires an embedded CMYK ICC profile; no bundled profile was guessed.');
    }
    const profile = await validateImageCmykProfile(decoded.profileBytes);
    const sha256 = await sha256Hex(decoded.profileBytes);
    const identity = createImportedImageCmykProfile({
      assetId: `embedded-cmyk-${sha256}`,
      sha256,
      label: profile.name,
    });
    const rgba = await convertImageCmykaBytesToRgba(decoded.buffer, decoded.profileBytes, {
      intent: 'relative',
      blackPointCompensation: true,
    });
    const bitmap = imageDataToBitmap(makeImageData(new Uint8ClampedArray(rgba), decoded.buffer.width, decoded.buffer.height));
    const shell = createSingleLayerDocument(bitmap, params, 'TIFF / DeviceCMYK', [...decoded.warnings]);
    const first = shell.layers[0]!;
    return {
      ...shell,
      layers: [{ ...first, cmykPixels: decoded.buffer, cmykPixelsData: undefined }],
      metadata: {
        ...shell.metadata,
        colorMode: 'cmyk',
        cmyk: {
          profileId: identity.source.assetId,
          profileLabel: identity.label,
          profileSource: identity.source,
          profileBytesData: base64FromBytes(decoded.profileBytes),
          intent: 'relative',
          blackPointCompensation: true,
          paperWhiteSimulation: false,
        },
      },
    };
  } catch (error) {
    // A non-CMYK TIFF must continue through the ordinary decoder.  DeviceCMYK
    // TIFFs are rejected there with an explicit native-import message instead
    // of being reinterpreted as RGBA channels.
    if (isDeviceCmykTiff(buffer)) throw error;
  }
  const bitmap = imageDataToBitmap(decodeTiffToImageData(buffer));
  return createSingleLayerDocument(bitmap, params, 'TIFF', []);
}

function isDeviceCmykTiff(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (!isTiffHeader(bytes) || bytes.byteLength < 10) return false;
  const littleEndian = bytes[0] === 0x49;
  const view = new DataView(buffer);
  try {
    if (view.getUint16(2, littleEndian) !== 42) return false;
    const ifdOffset = view.getUint32(4, littleEndian);
    const tagCount = view.getUint16(ifdOffset, littleEndian);
    for (let index = 0; index < tagCount; index += 1) {
      const entry = ifdOffset + 2 + index * 12;
      if (view.getUint16(entry, littleEndian) !== 262) continue;
      const type = view.getUint16(entry + 2, littleEndian);
      const count = view.getUint32(entry + 4, littleEndian);
      return type === 3 && count === 1 && view.getUint16(entry + 8, littleEndian) === 5;
    }
  } catch {
    return false;
  }
  return false;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', owned));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createSvgImageDocument(svgSource: string, params: SourceImageOpenParams): Promise<ImageDocument> {
  const bitmap = await rasterizeSvgToBitmap(svgSource);
  return createSingleLayerDocument(bitmap, params, 'SVG', [], { originalSvgSource: svgSource });
}

export async function createRasterImageDocumentFromBlob(blob: Blob, params: SourceImageOpenParams, warnings: string[] = []): Promise<ImageDocument> {
  const imageBitmap = await createImageBitmap(blob);
  try {
    const bitmap = createBitmap(imageBitmap.width, imageBitmap.height);
    bitmap.getContext('2d')?.drawImage(imageBitmap, 0, 0);
    return createSingleLayerDocument(bitmap, params, params.sourceMimeType || blob.type || 'Raster', warnings);
  } finally {
    imageBitmap.close();
  }
}

function createSingleLayerDocument(
  bitmap: LayerBitmap,
  params: SourceImageOpenParams,
  sourceFormat: string,
  warnings: string[],
  extraMetadata: Partial<NonNullable<ImageLayer['metadata']>> = {},
): ImageDocument {
  const shell = createEmptyImageDocument({
    id: params.id,
    title: params.title,
    width: bitmap.width,
    height: bitmap.height,
    sourceBinItemId: params.sourceBinItemId,
  });
  const layer: ImageLayer = {
    id: `${params.id}-layer-0`,
    name: params.sourceLabel ?? params.title,
    type: extraMetadata.originalSvgSource ? 'vector' : 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 0,
    mask: null,
    vectorRecipe: extraMetadata.originalSvgSource,
    metadata: {
      smartLinkedSourceId: params.sourceBinItemId,
      sourceLabel: params.sourceLabel,
      sourceFormat,
      sourceMimeType: params.sourceMimeType,
      sourceWarnings: warnings,
      sourceLink: params.sourceBinItemId ? {
        id: params.sourceBinItemId,
        label: params.sourceLabel,
        width: bitmap.width,
        height: bitmap.height,
        status: 'linked',
        relinkHistory: [],
      } : undefined,
      ...extraMetadata,
    },
  };
  return {
    ...shell,
    width: bitmap.width,
    height: bitmap.height,
    layers: [layer],
    activeLayerId: layer.id,
    metadata: {
      sourceFormat,
      sourceMimeType: params.sourceMimeType,
      ...(params.sourceBitDepth ? { sourceBitDepth: params.sourceBitDepth } : {}),
      warnings,
    },
  };
}

export async function rasterizeSvgToBitmapAtResolution(
  svgSource: string,
  width: number,
  height: number,
): Promise<LayerBitmap> {
  const blob = new Blob([svgSource], { type: IMAGE_SVG_MIME_TYPE });
  const imageBitmap = await createImageBitmap(blob);
  try {
    const bitmap = createBitmap(width, height);
    bitmap.getContext('2d')?.drawImage(imageBitmap, 0, 0, width, height);
    return bitmap;
  } finally {
    imageBitmap.close();
  }
}

async function rasterizeSvgToBitmap(svgSource: string): Promise<LayerBitmap> {
  const blob = new Blob([svgSource], { type: IMAGE_SVG_MIME_TYPE });
  const imageBitmap = await createImageBitmap(blob);
  try {
    const bitmap = createBitmap(imageBitmap.width, imageBitmap.height);
    bitmap.getContext('2d')?.drawImage(imageBitmap, 0, 0);
    return bitmap;
  } finally {
    imageBitmap.close();
  }
}

function isTiffHeader(bytes: Uint8Array | undefined): boolean {
  if (!bytes || bytes.length < 4) return false;
  return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42)
    || (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 43 && bytes[3] === 0)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 43);
}

function readTiffBitsPerChannel(bytes: Uint8Array | undefined): number | undefined {
  if (!isTiffHeader(bytes) || !bytes || bytes.length < 10) return undefined;
  const littleEndian = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readU16 = (offset: number) => offset + 2 <= bytes.byteLength ? view.getUint16(offset, littleEndian) : undefined;
  const readU32 = (offset: number) => offset + 4 <= bytes.byteLength ? view.getUint32(offset, littleEndian) : undefined;
  if (readU16(2) !== 42) return undefined;

  const ifdOffset = readU32(4);
  if (ifdOffset === undefined || ifdOffset + 2 > bytes.byteLength) return undefined;
  const tagCount = readU16(ifdOffset);
  if (tagCount === undefined) return undefined;

  for (let index = 0; index < tagCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > bytes.byteLength || readU16(entryOffset) !== 258) continue;
    const type = readU16(entryOffset + 2);
    const count = readU32(entryOffset + 4);
    const valueOffset = readU32(entryOffset + 8);
    if (type === undefined || count === undefined || valueOffset === undefined) return undefined;
    if (type !== 3 && type !== 4) return undefined;
    if (count === 1) return type === 3 ? readU16(entryOffset + 8) : valueOffset;

    const bytesPerValue = type === 3 ? 2 : 4;
    const inline = count * bytesPerValue <= 4;
    const offset = inline ? entryOffset + 8 : valueOffset;
    if (offset + count * bytesPerValue > bytes.byteLength) return undefined;
    let maxBits = 0;
    for (let valueIndex = 0; valueIndex < count; valueIndex += 1) {
      const value = type === 3
        ? readU16(offset + valueIndex * bytesPerValue)
        : readU32(offset + valueIndex * bytesPerValue);
      if (value === undefined) return undefined;
      maxBits = Math.max(maxBits, value);
    }
    return maxBits || undefined;
  }

  return undefined;
}

function isPngHeader(bytes: Uint8Array | undefined): boolean {
  return Boolean(bytes
    && bytes.length >= 8
    && bytes[0] === 137
    && bytes[1] === 80
    && bytes[2] === 78
    && bytes[3] === 71
    && bytes[4] === 13
    && bytes[5] === 10
    && bytes[6] === 26
    && bytes[7] === 10);
}

function readPngBitsPerChannel(bytes: Uint8Array | undefined): number | undefined {
  if (!isPngHeader(bytes) || !bytes || bytes.length < 25) return undefined;
  if (!startsWithAscii(bytes.subarray(12, 16), 'IHDR')) return undefined;
  return bytes[24];
}

function isGifHeader(bytes: Uint8Array | undefined): boolean {
  return Boolean(bytes && bytes.length >= 6 && (startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a')));
}

export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (!isGifHeader(bytes)) return false;
  let imageCount = 0;
  for (let index = 13; index < bytes.length; index += 1) {
    if (bytes[index] === 0x2c) {
      imageCount += 1;
      if (imageCount > 1) return true;
    }
  }
  return false;
}

function startsWithAscii(bytes: Uint8Array | undefined, prefix: string): boolean {
  if (!bytes || bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    const byte = bytes[index];
    const lower = byte >= 65 && byte <= 90 ? byte + 32 : byte;
    const expected = prefix.charCodeAt(index);
    const normalizedExpected = expected >= 65 && expected <= 90 ? expected + 32 : expected;
    if (lower !== normalizedExpected) return false;
  }
  return true;
}

function buildGifPalette(): number[] {
  const palette = [0, 0, 0];
  for (let r = 0; r < 7; r += 1) {
    for (let g = 0; g < 6; g += 1) {
      for (let b = 0; b < 6; b += 1) {
        palette.push(
          Math.round((r / 6) * 255),
          Math.round((g / 5) * 255),
          Math.round((b / 5) * 255),
        );
      }
    }
  }

  while (palette.length < 256 * 3) palette.push(0);
  return palette.slice(0, 256 * 3);
}

function indexGifPixels(imageData: ImageData, width: number, height: number): number[] {
  const indices: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      if (imageData.data[offset + 3] < 128) {
        indices.push(0);
        continue;
      }
      const r = Math.round((imageData.data[offset] / 255) * 6);
      const g = Math.round((imageData.data[offset + 1] / 255) * 5);
      const b = Math.round((imageData.data[offset + 2] / 255) * 5);
      indices.push(1 + r * 36 + g * 6 + b);
    }
  }
  return indices;
}

function buildGifImageDataBlocks(indices: number[]): number[] {
  const clearCode = 256;
  const endCode = 257;
  const codes: number[] = [];

  for (let index = 0; index < indices.length; index += 254) {
    codes.push(clearCode, ...indices.slice(index, index + 254));
  }
  codes.push(endCode);

  const packed = packGifCodes(codes, 9);
  const blocks: number[] = [];
  for (let index = 0; index < packed.length; index += 255) {
    const chunk = packed.slice(index, index + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return blocks;
}

function packGifCodes(codes: number[], codeSize: number): number[] {
  const bytes: number[] = [];
  let current = 0;
  let bits = 0;

  for (const code of codes) {
    current |= code << bits;
    bits += codeSize;

    while (bits >= 8) {
      bytes.push(current & 0xff);
      current >>>= 8;
      bits -= 8;
    }
  }

  if (bits > 0) bytes.push(current & 0xff);
  return bytes;
}

function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  const copy = new Uint8ClampedArray(data);
  if (typeof ImageData !== 'undefined') return new ImageData(copy, width, height);
  return { data: copy, width, height } as ImageData;
}
