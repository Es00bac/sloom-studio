import type {
  ImageColorProofIntent,
  ImageColorProofMode,
  ImageDocument,
  ImageLayer,
  LayerBitmap,
} from '../../types/imageEditor';
import { inferMimeTypeFromFile } from '../../lib/mediaFormatRegistry';
import { getBitmapImageData } from './LayerBitmap';
import { maskToCanvas, type SelectionMask } from './SelectionMask';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { isImageLayerEffectivelyVisible } from './ImageLayerGroups';
import { buildImageColorProofWorkflowDescriptor, normalizeImageColorProofSetup } from './ImageColorProof';
import {
  IMAGE_BMP_MIME_TYPE,
  IMAGE_GIF_MIME_TYPE,
  IMAGE_SVG_MIME_TYPE,
  IMAGE_TIFF_MIME_TYPE,
  encodeImageDataToBmp,
  encodeImageDataToStaticGif,
  encodeImageDataToTiff,
} from './ImageFileFormats';
import { ensureBundledFontDependenciesReady } from '../../lib/bundledFontLibrary';
import { collectImageBundledFontDependencies } from '../../lib/managedBundledFonts';
import { encodeNativeHighBitDocument } from './ImageNativeHighBitExport';
import {
  exportImageDocumentCmykTiff,
} from './cmyk/ImageCmykDocument';
import {
  loadBundledImageCmykProfile,
  type ImageCmykProfileIdentity,
} from './cmyk/cmykProfiles';

export interface ImageExportFormat {
  label: string;
  mimeType: string;
  extension: string;
}

export type ImageDocumentExportWarningCode =
  | 'visible-export-flattens-layers'
  | 'hidden-layers-omitted'
  | 'layer-masks-flattened'
  | 'layer-effects-flattened'
  | 'layer-filters-flattened'
  | 'editable-layer-state-flattened'
  | 'layer-compositing-flattened'
  | 'source-links-flattened'
  | 'print-resolution-below-target'
  | 'tiff-export-8bit-rgba'
  | 'source-high-bit-depth-downsampled'
  | 'gif-export-static-only'
  | 'svg-vector-state-flattened'
  | 'color-profile-not-embedded'
  | 'cmyk-proof-not-separated';

export type ImageDocumentExportWarningSummaryCode =
  | 'flattened-text'
  | 'flattened-vector'
  | 'flattened-effects'
  | 'flattened-masks'
  | 'color-profile'
  | 'high-bit-depth';

export type ImageDocumentExportWorkflow = 'export-as' | 'save-for-web';
export type ImageDocumentExportStatus = 'ready' | 'limited-ready' | 'blocked';
export type ImageDocumentExportTransparencyCapability = 'alpha' | 'binary' | 'none';
export type ImageDocumentExportAnimationCapability = 'unsupported' | 'static-only';
export type ImageDocumentExportFlattenedCapability = 'flattened' | 'rasterized';
export type ImageDocumentExportColorProfileCapability = 'not-embedded';
export type ImageDocumentExportMetadataCapability = 'preserved' | 'stripped';
export type ImageDocumentExportMetadataPolicy = 'preserve' | 'strip';

export type ImageDocumentExportImplicationCode =
  | 'alpha-preserved'
  | 'alpha-quantized'
  | 'alpha-discarded'
  | 'animation-unsupported'
  | 'static-animation-only'
  | 'vector-rasterized'
  | 'text-rasterized'
  | 'layers-flattened'
  | 'metadata-stripped'
  | 'metadata-preserved';

export type ImageDocumentExportUnsupportedStateCode =
  | 'animated-webp-export'
  | 'animated-gif-export'
  | 'gif-alpha-quantized'
  | 'indexed-palette-editor'
  | 'icc-profile-embedding'
  | 'icc-profile-conversion'
  | 'pdfx-printer-marks'
  | 'live-native-vector-preservation'
  | 'live-native-text-preservation'
  | 'native-layer-effect-preservation'
  | 'animation-frames-beyond-current'
  | 'true-cmyk-separations'
  | 'spot-color-separations'
  | 'high-bit-depth-output';

export type ImageDocumentExportBlockerCode =
  | 'animation-export-unsupported'
  | 'batch-empty'
  | 'batch-template-missing';

export type ImageDocumentExportFlatteningCaveatCode =
  | 'hidden-layers-omitted'
  | 'layer-masks-baked'
  | 'layer-effects-rasterized'
  | 'layer-filters-rasterized'
  | 'editable-state-rasterized'
  | 'source-links-derived-only';

export type ImageDocumentExportSourceBinHandoffTarget = 'source-bin' | 'flow' | 'video' | 'paper';
export type ImageDocumentExportSourceUrlKind = 'durable' | 'blob' | 'missing';
export type ImageDocumentExportHandoffCaveatCode =
  | 'flattened-derivative-required'
  | 'hidden-layers-not-packaged'
  | 'source-link-editability-not-preserved'
  | 'blob-url-not-durable'
  | 'source-id-missing'
  | 'profile-intent-metadata-only'
  | 'batch-template-required'
  | 'paper-proof-routing-review-only'
  | 'video-handoff-still-frame-only';

export type ImageDocumentExportBlockerSummaryCode =
  | 'source-id-missing'
  | 'blob-url-not-durable';

export interface ImageDocumentExportFlatteningCaveat {
  code: ImageDocumentExportFlatteningCaveatCode;
  layerIds: string[];
  message: string;
}

export interface ImageDocumentExportSourceBinHandoffReadiness {
  target: ImageDocumentExportSourceBinHandoffTarget;
  safe: boolean;
  sourceItemId: string | null;
  sourceUrlKind: ImageDocumentExportSourceUrlKind;
  packageFlattenedDerivative: true;
  preserveOriginalSourceReference: boolean;
  caveats: Array<{
    code: ImageDocumentExportHandoffCaveatCode;
    message: string;
  }>;
  signature: string;
}

export interface ImageDocumentExportWarning {
  code: ImageDocumentExportWarningCode;
  severity: 'warning';
  formatExtension: string;
  layerIds: string[];
  message: string;
}

export interface ImageDocumentExportWarningSummaryGroup {
  code: ImageDocumentExportWarningSummaryCode;
  formatExtension: string;
  warningCodes: ImageDocumentExportWarningCode[];
  layerIds: string[];
  message: string;
}

export interface ImageDocumentExportBlocker {
  code: ImageDocumentExportBlockerCode;
  formatExtension: string;
  message: string;
}

export interface ImageDocumentExportBlockerSummary {
  code: ImageDocumentExportBlockerSummaryCode;
  formatExtension: string;
  caveatCodes: ImageDocumentExportHandoffCaveatCode[];
  message: string;
}

export interface ImageDocumentExportUnsupportedState {
  code: ImageDocumentExportUnsupportedStateCode;
  formatExtension: string;
  message: string;
}

export interface ImageDocumentExportImplication {
  code: ImageDocumentExportImplicationCode;
  formatExtension: string;
  message: string;
}

export interface ImageDocumentExportFormatCapability {
  formatExtension: string;
  transparency: ImageDocumentExportTransparencyCapability;
  animation: ImageDocumentExportAnimationCapability;
  vector: ImageDocumentExportFlattenedCapability;
  text: ImageDocumentExportFlattenedCapability;
  layers: 'flattened';
  colorProfile: ImageDocumentExportColorProfileCapability;
  metadata: ImageDocumentExportMetadataCapability;
  browserEncoder: boolean;
}

export interface ImageDocumentExportFlattenedFeatureCounts {
  masks: number;
  effects: number;
  filters: number;
  adjustments: number;
  textLayers: number;
  vectorLayers: number;
  nonNormalBlendModes: number;
  partialOpacity: number;
  sourceLinks: number;
}

export interface ImageDocumentExportFlatteningDescriptor {
  required: boolean;
  preservesLayers: boolean;
  includesHiddenLayers: boolean;
  visibleLayerIds: string[];
  omittedHiddenLayerIds: string[];
  flattenedLayerCount: number;
  featureCounts: ImageDocumentExportFlattenedFeatureCounts;
  caveats: ImageDocumentExportFlatteningCaveat[];
}

export interface ImageDocumentExportPlanDescriptor {
  kind: 'visible-export';
  format: ImageExportFormat;
  sourceDimensions: { width: number; height: number };
  outputDimensions: { width: number; height: number };
  flattening: ImageDocumentExportFlatteningDescriptor;
  warnings: ImageDocumentExportWarning[];
}

export type ImageDocumentExportIntent = 'screen' | 'proof' | 'print';
export type ImageDocumentExportSourceBitDepth = 8 | 16 | 32;

export interface ImageDocumentExportReadinessOptions {
  mimeType?: string;
  workflow?: ImageDocumentExportWorkflow;
  intent?: ImageDocumentExportIntent;
  scale?: number;
  targetDpi?: number;
  printWidthInches?: number;
  printHeightInches?: number;
  colorProfileLabel?: string;
  previewTag?: string;
  sourceFormat?: string;
  sourceBitDepth?: ImageDocumentExportSourceBitDepth;
  requestedAnimation?: boolean;
  requestedTransparency?: boolean;
  exportPreset?: {
    id: string;
    label: string;
    quality?: number;
    metadataPolicy?: ImageDocumentExportMetadataPolicy;
  };
  batch?: {
    enabled: boolean;
    itemCount: number;
    nameTemplate: string;
  };
  sourceBinHandoff?: {
    target?: ImageDocumentExportSourceBinHandoffTarget;
    sourceItemId?: string | null;
    sourceUrlKind?: ImageDocumentExportSourceUrlKind;
    preserveOriginalSourceReference?: boolean;
  };
}

export interface ImageDocumentExportPrintDescriptor {
  targetDpi: number;
  widthInches: number;
  heightInches: number;
  widthMm: number;
  heightMm: number;
  actualPpiX: number;
  actualPpiY: number;
  meetsTargetDpi: boolean;
}

export type ImageDocumentExportPressReadySeparationCode =
  | 'process-cmyk-separations'
  | 'spot-color-plates'
  | 'icc-output-profile-conversion'
  | 'printer-marks-pdfx';

export interface ImageDocumentExportUnsupportedSeparation {
  code: ImageDocumentExportPressReadySeparationCode;
  supported: false;
  message: string;
}

export interface ImageDocumentExportPressReadyDescriptor {
  pressReady: false;
  outputPixelSpace: 'RGB';
  nativeCmyk: false;
  embeddedIccProfile: false;
  minTargetDpi: 300;
  dpiReady: boolean;
  profileReady: false;
  unsupportedSeparations: ImageDocumentExportUnsupportedSeparation[];
  caveats: string[];
  signature: string;
}

export type ImageDocumentExportPrintProofUnsupportedCode =
  | 'contract-proof-calibration'
  | 'icc-profile-conversion'
  | 'pdfx-printer-marks';

export interface ImageDocumentExportPrintProofUnsupportedState {
  code: ImageDocumentExportPrintProofUnsupportedCode;
  supported: false;
  message: string;
}

export interface ImageDocumentExportPrintProofRouteDescriptor {
  mode: 'flattened-rgb-proof-derivative';
  truePrintProof: false;
  dpiReady: boolean;
  profileReady: false;
  softProofMode: ImageColorProofMode;
  profileLabel: string | null;
  warnings: string[];
  unsupportedStates: ImageDocumentExportPrintProofUnsupportedState[];
  signature: string;
}

export interface ImageDocumentExportProofDescriptor {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  profileLabel: string | null;
  nativeCmykExport: false;
  outputColorSpace: 'RGB';
  warnings: string[];
}

export interface ImageDocumentExportProfileDescriptor {
  requestedProfileLabel: string | null;
  embeddedProfile: false;
  conversionApplied: false;
  warnings: string[];
}

export interface ImageDocumentExportBitDepthDescriptor {
  sourceFormat: string | null;
  sourceBitDepth: ImageDocumentExportSourceBitDepth;
  exportBitDepth: ImageDocumentExportSourceBitDepth;
  preservesSourceBitDepth: boolean;
  highBitDepthCaveats: string[];
}

export interface ImageDocumentExportScaleDescriptor {
  factor: number;
  sourceDimensions: { width: number; height: number };
  outputDimensions: { width: number; height: number };
  metadataDpi: number;
  dpiEmbedded: false;
  resampling: 'browser-bitmap-resample';
}

export interface ImageDocumentExportPresetReadiness {
  ready: boolean;
  id: string | null;
  label: string | null;
  quality: number | null;
  metadataPolicy: ImageDocumentExportMetadataPolicy;
  signature: string;
}

export interface ImageDocumentExportBatchReadiness {
  ready: boolean;
  enabled: boolean;
  itemCount: number;
  nameTemplate: string;
  warnings: string[];
  signature: string;
}

export interface ImageDocumentExportPreviewDescriptor {
  tag: string;
  dimensions: { width: number; height: number };
  flattenedLayerIds: string[];
  omittedHiddenLayerIds: string[];
  signature: string;
}

export interface ImageDocumentExportReadinessDescriptor {
  kind: 'export-readiness';
  documentId: string;
  workflow: ImageDocumentExportWorkflow;
  status: ImageDocumentExportStatus;
  format: ImageExportFormat;
  capability: ImageDocumentExportFormatCapability;
  intent: ImageDocumentExportIntent;
  sourceDimensions: { width: number; height: number };
  outputDimensions: { width: number; height: number };
  scale: ImageDocumentExportScaleDescriptor;
  flattening: ImageDocumentExportFlatteningDescriptor;
  print: ImageDocumentExportPrintDescriptor;
  pressReady: ImageDocumentExportPressReadyDescriptor;
  printProof: ImageDocumentExportPrintProofRouteDescriptor;
  proof: ImageDocumentExportProofDescriptor;
  profile: ImageDocumentExportProfileDescriptor;
  bitDepth: ImageDocumentExportBitDepthDescriptor;
  exportPreset: ImageDocumentExportPresetReadiness;
  batch: ImageDocumentExportBatchReadiness;
  sourceBinHandoff: ImageDocumentExportSourceBinHandoffReadiness;
  implications: ImageDocumentExportImplication[];
  unsupportedStates: ImageDocumentExportUnsupportedState[];
  blockers: ImageDocumentExportBlocker[];
  warningSummaryGroups: ImageDocumentExportWarningSummaryGroup[];
  blockerSummaries: ImageDocumentExportBlockerSummary[];
  preview: ImageDocumentExportPreviewDescriptor;
  warnings: ImageDocumentExportWarning[];
  signature: string;
}

export type ImageDocumentExportNativeConstructRiskCode =
  | 'live-native-vector-preservation'
  | 'live-native-text-preservation'
  | 'native-layer-effect-preservation'
  | 'native-layer-mask-preservation'
  | 'source-link-editability-preservation';

export interface ImageDocumentExportFormatPolicyDescriptor {
  formatExtension: string;
  transparency: ImageDocumentExportTransparencyCapability;
  animation: ImageDocumentExportAnimationCapability;
  vector: ImageDocumentExportFlattenedCapability;
  text: ImageDocumentExportFlattenedCapability;
  layers: 'flattened';
  colorProfile: ImageDocumentExportColorProfileCapability;
  metadata: ImageDocumentExportMetadataCapability;
  browserEncoder: boolean;
  warningCodes: ImageDocumentExportWarningCode[];
  unsupportedStateCodes: ImageDocumentExportUnsupportedStateCode[];
  signature: string;
}

export interface ImageDocumentExportFlatteningRiskDescriptor {
  signature: string;
  nativeConstructRiskCodes: ImageDocumentExportNativeConstructRiskCode[];
  flattenedFeatureCounts: ImageDocumentExportFlattenedFeatureCounts;
}

export interface ImageDocumentExportProofPressPolicyDescriptor {
  printProofUnsupportedCodes: ImageDocumentExportPrintProofUnsupportedCode[];
  pressReadyUnsupportedCodes: ImageDocumentExportPressReadySeparationCode[];
  warningCodes: ImageDocumentExportWarningCode[];
  signatures: {
    printProof: string;
    pressReady: string;
  };
}

export interface ImageDocumentExportPresetCompatibilityDescriptor {
  ready: boolean;
  presetSignature: string;
  compatibilitySignature: string;
  warningCodes: ImageDocumentExportUnsupportedStateCode[];
  blockerCodes: ImageDocumentExportBlockerCode[];
}

export interface ImageDocumentExportSourceBinHandoffRiskDescriptor {
  safe: boolean;
  signature: string;
  riskSignature: string;
  caveatCodes: ImageDocumentExportHandoffCaveatCode[];
}

export interface ImageDocumentExportPolicyDescriptor {
  descriptorId: 'image-export-policy:v1';
  readiness: ImageDocumentExportReadinessDescriptor;
  formatPolicy: ImageDocumentExportFormatPolicyDescriptor;
  flatteningRisk: ImageDocumentExportFlatteningRiskDescriptor;
  proofPressPolicy: ImageDocumentExportProofPressPolicyDescriptor;
  presetCompatibility: ImageDocumentExportPresetCompatibilityDescriptor;
  sourceBinHandoffRisk: ImageDocumentExportSourceBinHandoffRiskDescriptor;
  stableSignatures: {
    formatPolicy: string;
    exportPresetCompatibility: string;
    printProof: string;
    pressReady: string;
    sourceBinHandoffRisk: string;
    readiness: string;
  };
}

const IMAGE_VISIBLE_EXPORT_EXTENSIONS = ['png', 'jpg', 'webp', 'avif', 'bmp', 'gif', 'tif', 'exr', 'svg'] as const;
type ImageVisibleExportExtension = typeof IMAGE_VISIBLE_EXPORT_EXTENSIONS[number];

export const IMAGE_EXPORT_FORMATS: ImageExportFormat[] = IMAGE_VISIBLE_EXPORT_EXTENSIONS.map((extension) => ({
  label: extension === 'jpg' ? 'JPEG' : extension === 'tif' ? 'TIFF' : extension === 'exr' ? 'OpenEXR' : extension.toUpperCase(),
  mimeType: inferMimeTypeFromFile(`image.${extension}`, 'image') ?? 'image/png',
  extension,
}));

export const IMAGE_EXPORT_FORMAT_CAPABILITY_MATRIX: Record<ImageVisibleExportExtension, ImageDocumentExportFormatCapability> = {
  png: {
    formatExtension: 'png',
    transparency: 'alpha',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: true,
  },
  jpg: {
    formatExtension: 'jpg',
    transparency: 'none',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: true,
  },
  webp: {
    formatExtension: 'webp',
    transparency: 'alpha',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: true,
  },
  avif: {
    formatExtension: 'avif',
    transparency: 'alpha',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: true,
  },
  bmp: {
    formatExtension: 'bmp',
    transparency: 'none',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: false,
  },
  gif: {
    formatExtension: 'gif',
    transparency: 'binary',
    animation: 'static-only',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: false,
  },
  tif: {
    formatExtension: 'tif',
    transparency: 'alpha',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: false,
  },
  exr: {
    formatExtension: 'exr',
    transparency: 'alpha',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'stripped',
    browserEncoder: false,
  },
  svg: {
    formatExtension: 'svg',
    transparency: 'alpha',
    animation: 'unsupported',
    vector: 'rasterized',
    text: 'rasterized',
    layers: 'flattened',
    colorProfile: 'not-embedded',
    metadata: 'preserved',
    browserEncoder: false,
  },
};

const DEFAULT_IMAGE_EXPORT_MIME_TYPE = 'image/png';

export function normalizeImageExportMimeType(mimeType: string | undefined): string {
  if (mimeType === 'image/exr') return 'image/x-exr';
  return mimeType && IMAGE_EXPORT_FORMATS.some((format) => format.mimeType === mimeType)
    ? mimeType
    : DEFAULT_IMAGE_EXPORT_MIME_TYPE;
}

export function getImageExportFormat(mimeType: string | undefined): ImageExportFormat {
  const normalized = normalizeImageExportMimeType(mimeType);
  return IMAGE_EXPORT_FORMATS.find((format) => format.mimeType === normalized) ?? IMAGE_EXPORT_FORMATS[0];
}

export function describeImageDocumentExportPlan(
  doc: ImageDocument,
  mimeType = 'image/png',
): ImageDocumentExportPlanDescriptor {
  const format = getImageExportFormat(mimeType);
  const visibleLayers = getVisibleExportLayers(doc);
  const omittedHiddenLayerIds = getOmittedHiddenLayerIds(doc);
  const featureCounts = buildFlattenedFeatureCounts(visibleLayers);
  const flattening: ImageDocumentExportFlatteningDescriptor = {
    required: true,
    preservesLayers: false,
    includesHiddenLayers: false,
    visibleLayerIds: visibleLayers.map((layer) => layer.id),
    omittedHiddenLayerIds,
    flattenedLayerCount: visibleLayers.length,
    featureCounts,
    caveats: buildFlatteningCaveats(visibleLayers, omittedHiddenLayerIds, featureCounts),
  };
  const dimensions = {
    width: normalizeExportDimension(doc.width),
    height: normalizeExportDimension(doc.height),
  };

  return {
    kind: 'visible-export',
    format,
    sourceDimensions: { ...dimensions },
    outputDimensions: { ...dimensions },
    flattening,
    warnings: buildImageDocumentExportWarnings(format, visibleLayers, omittedHiddenLayerIds, featureCounts),
  };
}

export function buildImageDocumentExportReadinessDescriptor(
  doc: ImageDocument,
  options: ImageDocumentExportReadinessOptions = {},
): ImageDocumentExportReadinessDescriptor {
  const format = getImageExportFormat(options.mimeType);
  const basePlan = describeImageDocumentExportPlan(doc, format.mimeType);
  const workflow = options.workflow ?? 'export-as';
  const intent = options.intent ?? 'screen';
  const targetDpi = normalizeDpi(options.targetDpi ?? 72);
  const visibleLayers = getVisibleExportLayers(doc);
  const scale = buildExportScaleDescriptor(basePlan.sourceDimensions, options.scale, targetDpi);
  const metadataPolicy = options.exportPreset?.metadataPolicy ?? (workflow === 'save-for-web' ? 'strip' : 'preserve');
  const capability = buildExportFormatCapability(format, metadataPolicy);
  const exportPreset = buildExportPresetReadiness(options.exportPreset, metadataPolicy);
  const batch = buildExportBatchReadiness(options.batch);
  const print = buildExportPrintDescriptor(scale.outputDimensions, {
    targetDpi,
    printWidthInches: options.printWidthInches,
    printHeightInches: options.printHeightInches,
  });
  const bitDepth = buildExportBitDepthDescriptor(format, {
    sourceFormat: options.sourceFormat ?? doc.metadata?.sourceFormat,
    sourceBitDepth: options.sourceBitDepth ?? doc.metadata?.sourceBitDepth,
    workingBitDepth: doc.metadata?.bitDepth,
  });
  const proofSetup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const proofWorkflow = buildImageColorProofWorkflowDescriptor(doc);
  const profileLabel = options.colorProfileLabel?.trim() || proofSetup.profileLabel?.trim() || null;
  const proof: ImageDocumentExportProofDescriptor = {
    mode: proofSetup.mode,
    intent: proofSetup.intent,
    profileLabel: proofSetup.profileLabel?.trim() || null,
    nativeCmykExport: false,
    outputColorSpace: 'RGB',
    warnings: proofWorkflow.print.warnings,
  };
  const profile: ImageDocumentExportProfileDescriptor = {
    requestedProfileLabel: profileLabel,
    embeddedProfile: false,
    conversionApplied: false,
    warnings: profileLabel
      ? [`${profileLabel} is recorded as export intent metadata only; ICC conversion and profile embedding are not applied by visible export.`]
      : [],
  };
  const pressReady = buildExportPressReadyDescriptor(format, {
    intent,
    print,
    profileLabel,
    proofMode: proofSetup.mode,
  });
  const printProof = buildExportPrintProofRouteDescriptor(format, {
    intent,
    print,
    profileLabel,
    proofMode: proofSetup.mode,
  });
  const extraWarnings = buildReadinessWarnings(format, basePlan.flattening.visibleLayerIds, basePlan.flattening.featureCounts, {
    print,
    profileLabel,
    proofMode: proofSetup.mode,
    intent,
    bitDepth,
  });
  const warnings = [...basePlan.warnings, ...extraWarnings];
  const unsupportedStates = buildExportUnsupportedStates(format, capability, {
    requestedAnimation: options.requestedAnimation ?? false,
    requestedTransparency: options.requestedTransparency ?? false,
    profileLabel,
  });
  const blockers = buildExportBlockers(format, capability, batch, {
    requestedAnimation: options.requestedAnimation ?? false,
  });
  const sourceBinHandoff = buildSourceBinHandoffReadiness({
    options: options.sourceBinHandoff,
    flattening: basePlan.flattening,
    profileLabel,
    batch,
  });
  const warningSummaryGroups = buildExportWarningSummaryGroups({
    format,
    visibleLayers,
    warnings,
    profileLabel,
    bitDepth,
  });
  const blockerSummaries = buildExportBlockerSummaries(format, sourceBinHandoff);
  const implications = buildExportImplications(format, capability, basePlan.flattening.featureCounts, {
    requestedAnimation: options.requestedAnimation ?? false,
    requestedTransparency: options.requestedTransparency ?? false,
  });
  const status = resolveExportReadinessStatus(warnings, unsupportedStates, blockers);
  const previewTag = options.previewTag?.trim() || 'default';
  const preview: ImageDocumentExportPreviewDescriptor = {
    tag: previewTag,
    dimensions: { ...scale.outputDimensions },
    flattenedLayerIds: [...basePlan.flattening.visibleLayerIds],
    omittedHiddenLayerIds: [...basePlan.flattening.omittedHiddenLayerIds],
    signature: buildExportPreviewSignature({
      doc,
      format,
      intent,
      dimensions: scale.outputDimensions,
      visibleLayerIds: basePlan.flattening.visibleLayerIds,
      hiddenLayerIds: basePlan.flattening.omittedHiddenLayerIds,
      targetDpi,
      proofMode: proofSetup.mode,
      proofIntent: proofSetup.intent,
      proofProfileLabel: proofSetup.profileLabel,
      profileLabel,
      previewTag,
      printWidthInches: options.printWidthInches,
      printHeightInches: options.printHeightInches,
    }),
  };

  const descriptor: ImageDocumentExportReadinessDescriptor = {
    kind: 'export-readiness',
    documentId: doc.id,
    workflow,
    status,
    format,
    capability,
    intent,
    sourceDimensions: { ...basePlan.sourceDimensions },
    outputDimensions: { ...scale.outputDimensions },
    scale,
    flattening: basePlan.flattening,
    print,
    pressReady,
    printProof,
    proof,
    profile,
    bitDepth,
    exportPreset,
    batch,
    sourceBinHandoff,
    implications,
    unsupportedStates,
    blockers,
    warningSummaryGroups,
    blockerSummaries,
    preview,
    warnings,
    signature: '',
  };
  descriptor.signature = buildImageDocumentExportReadinessSignature(descriptor);
  return descriptor;
}

export function describeImageDocumentExportPolicyDescriptor(
  doc: ImageDocument,
  options: ImageDocumentExportReadinessOptions = {},
): ImageDocumentExportPolicyDescriptor {
  const readiness = buildImageDocumentExportReadinessDescriptor(doc, options);
  const formatPolicy = buildExportFormatPolicyDescriptor(readiness);
  const flatteningRisk = buildExportFlatteningRiskDescriptor(readiness);
  const proofPressPolicy = buildExportProofPressPolicyDescriptor(readiness);
  const presetCompatibility = buildExportPresetCompatibilityDescriptor(readiness);
  const sourceBinHandoffRisk = buildExportSourceBinHandoffRiskDescriptor(readiness);

  return {
    descriptorId: 'image-export-policy:v1',
    readiness,
    formatPolicy,
    flatteningRisk,
    proofPressPolicy,
    presetCompatibility,
    sourceBinHandoffRisk,
    stableSignatures: {
      formatPolicy: formatPolicy.signature,
      exportPresetCompatibility: presetCompatibility.compatibilitySignature,
      printProof: proofPressPolicy.signatures.printProof,
      pressReady: proofPressPolicy.signatures.pressReady,
      sourceBinHandoffRisk: sourceBinHandoffRisk.riskSignature,
      readiness: readiness.signature,
    },
  };
}

function buildExportFormatPolicyDescriptor(
  readiness: ImageDocumentExportReadinessDescriptor,
): ImageDocumentExportFormatPolicyDescriptor {
  const unsupportedStateCodes = uniqueExportUnsupportedCodes([
    ...readiness.unsupportedStates.map((state) => state.code),
    'icc-profile-conversion',
    'pdfx-printer-marks',
    'live-native-vector-preservation',
    'live-native-text-preservation',
    'native-layer-effect-preservation',
    ...(readiness.capability.animation !== 'unsupported' ? [] : ['animation-frames-beyond-current' as const]),
    'true-cmyk-separations',
    'spot-color-separations',
    ...(readiness.bitDepth.preservesSourceBitDepth ? [] : ['high-bit-depth-output' as const]),
  ]);
  const warningCodes = uniqueExportWarningCodes(readiness.warnings.map((warning) => warning.code));

  return {
    formatExtension: readiness.capability.formatExtension,
    transparency: readiness.capability.transparency,
    animation: readiness.capability.animation,
    vector: readiness.capability.vector,
    text: readiness.capability.text,
    layers: readiness.capability.layers,
    colorProfile: readiness.capability.colorProfile,
    metadata: readiness.capability.metadata,
    browserEncoder: readiness.capability.browserEncoder,
    warningCodes,
    unsupportedStateCodes,
    signature: [
      'image-export-format-policy:v1',
      `fmt=${readiness.capability.formatExtension}`,
      `transparency=${readiness.capability.transparency}`,
      `animation=${readiness.capability.animation}`,
      `vector=${readiness.capability.vector}`,
      `text=${readiness.capability.text}`,
      `layers=${readiness.capability.layers}`,
      `profile=${readiness.capability.colorProfile}`,
      `metadata=${readiness.capability.metadata}`,
      `browserEncoder=${readiness.capability.browserEncoder}`,
    ].join('|'),
  };
}

function buildExportFlatteningRiskDescriptor(
  readiness: ImageDocumentExportReadinessDescriptor,
): ImageDocumentExportFlatteningRiskDescriptor {
  const counts = readiness.flattening.featureCounts;
  const nativeConstructRiskCodes: ImageDocumentExportNativeConstructRiskCode[] = [
    ...(counts.vectorLayers > 0 ? ['live-native-vector-preservation' as const] : []),
    ...(counts.textLayers > 0 ? ['live-native-text-preservation' as const] : []),
    ...(counts.effects > 0 ? ['native-layer-effect-preservation' as const] : []),
    ...(counts.masks > 0 ? ['native-layer-mask-preservation' as const] : []),
    ...(counts.sourceLinks > 0 ? ['source-link-editability-preservation' as const] : []),
  ];

  return {
    signature: [
      'image-export-flattening-risk:v1',
      `required=${readiness.flattening.required}`,
      `layers=${readiness.flattening.visibleLayerIds.join(',') || 'none'}`,
      `hidden=${readiness.flattening.omittedHiddenLayerIds.join(',') || 'none'}`,
      `text=${counts.textLayers}`,
      `vector=${counts.vectorLayers}`,
      `effects=${counts.effects}`,
      `masks=${counts.masks}`,
      `sourceLinks=${counts.sourceLinks}`,
    ].join('|'),
    nativeConstructRiskCodes,
    flattenedFeatureCounts: counts,
  };
}

function buildExportProofPressPolicyDescriptor(
  readiness: ImageDocumentExportReadinessDescriptor,
): ImageDocumentExportProofPressPolicyDescriptor {
  return {
    printProofUnsupportedCodes: readiness.printProof.unsupportedStates.map((state) => state.code),
    pressReadyUnsupportedCodes: readiness.pressReady.unsupportedSeparations.map((state) => state.code),
    warningCodes: uniqueExportWarningCodes(
      readiness.warnings
        .filter((warning) => (
          warning.code === 'print-resolution-below-target'
          || warning.code === 'color-profile-not-embedded'
          || warning.code === 'cmyk-proof-not-separated'
          || warning.code === 'source-high-bit-depth-downsampled'
          || warning.code === 'tiff-export-8bit-rgba'
        ))
        .map((warning) => warning.code),
    ),
    signatures: {
      printProof: readiness.printProof.signature,
      pressReady: readiness.pressReady.signature,
    },
  };
}

function buildExportPresetCompatibilityDescriptor(
  readiness: ImageDocumentExportReadinessDescriptor,
): ImageDocumentExportPresetCompatibilityDescriptor {
  const warningCodes = buildPresetCompatibilityWarningCodes(readiness);
  const blockerCodes = readiness.blockers.map((blocker) => blocker.code);
  const ready = readiness.exportPreset.ready && blockerCodes.length === 0 && warningCodes.length === 0;

  return {
    ready,
    presetSignature: readiness.exportPreset.signature,
    compatibilitySignature: [
      'image-export-preset-compat:v1',
      `preset=${readiness.exportPreset.id ?? 'none'}`,
      `fmt=${readiness.format.extension}`,
      `ready=${ready}`,
      `metadata=${readiness.exportPreset.metadataPolicy}`,
      `quality=${readiness.exportPreset.quality ?? 'auto'}`,
      `warnings=${warningCodes.join(',') || 'none'}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
    ].join('|'),
    warningCodes,
    blockerCodes,
  };
}

function buildExportSourceBinHandoffRiskDescriptor(
  readiness: ImageDocumentExportReadinessDescriptor,
): ImageDocumentExportSourceBinHandoffRiskDescriptor {
  const caveatCodes = readiness.sourceBinHandoff.caveats.map((caveat) => caveat.code);
  const sourceState = readiness.sourceBinHandoff.sourceItemId ?? 'missing';

  return {
    safe: readiness.sourceBinHandoff.safe,
    signature: [
      'image-export-source-bin-handoff:v1',
      `target=${readiness.sourceBinHandoff.target}`,
      `safe=${readiness.sourceBinHandoff.safe}`,
      `source=${sourceState}`,
      `url=${readiness.sourceBinHandoff.sourceUrlKind}`,
      `preserveOriginal=${readiness.sourceBinHandoff.preserveOriginalSourceReference}`,
      `caveats=${caveatCodes.join(',') || 'none'}`,
    ].join('|'),
    riskSignature: [
      'image-export-source-handoff-risk:v1',
      `target=${readiness.sourceBinHandoff.target}`,
      `safe=${readiness.sourceBinHandoff.safe}`,
      `url=${readiness.sourceBinHandoff.sourceUrlKind}`,
      `source=${sourceState}`,
      `caveats=${caveatCodes.join(',') || 'none'}`,
    ].join('|'),
    caveatCodes,
  };
}

function buildExportWarningSummaryGroups({
  format,
  visibleLayers,
  warnings,
  profileLabel,
  bitDepth,
}: {
  format: ImageExportFormat;
  visibleLayers: readonly ImageLayer[];
  warnings: readonly ImageDocumentExportWarning[];
  profileLabel: string | null;
  bitDepth: ImageDocumentExportBitDepthDescriptor;
}): ImageDocumentExportWarningSummaryGroup[] {
  const warningCodeSet = new Set(warnings.map((warning) => warning.code));
  const allVisibleLayerIds = visibleLayers.map((layer) => layer.id);
  const groups: ImageDocumentExportWarningSummaryGroup[] = [];

  appendWarningSummaryGroup(groups, {
    active: warningCodeSet.has('editable-layer-state-flattened'),
    code: 'flattened-text',
    format,
    warningCodes: ['editable-layer-state-flattened'],
    layerIds: visibleLayers
      .filter((layer) => layer.type === 'text' || Boolean(layer.text))
      .map((layer) => layer.id),
    message: `${format.label} export rasterizes editable text into the flattened output.`,
  });
  appendWarningSummaryGroup(groups, {
    active: warningCodeSet.has('editable-layer-state-flattened'),
    code: 'flattened-vector',
    format,
    warningCodes: ['editable-layer-state-flattened'],
    layerIds: visibleLayers
      .filter((layer) => layer.type === 'vector' || Boolean(layer.vectorRecipe || layer.metadata?.vectorShape))
      .map((layer) => layer.id),
    message: `${format.label} export rasterizes editable vector content into the flattened output.`,
  });
  appendWarningSummaryGroup(groups, {
    active: warningCodeSet.has('layer-effects-flattened'),
    code: 'flattened-effects',
    format,
    warningCodes: ['layer-effects-flattened'],
    layerIds: visibleLayers
      .filter((layer) => hasEnabledEntries(layer.effects))
      .map((layer) => layer.id),
    message: `${format.label} export rasterizes layer effects into the flattened output.`,
  });
  appendWarningSummaryGroup(groups, {
    active: warningCodeSet.has('layer-masks-flattened'),
    code: 'flattened-masks',
    format,
    warningCodes: ['layer-masks-flattened'],
    layerIds: visibleLayers
      .filter((layer) => Boolean(layer.mask))
      .map((layer) => layer.id),
    message: `${format.label} export bakes layer masks into flattened alpha and pixels.`,
  });
  appendWarningSummaryGroup(groups, {
    active: warningCodeSet.has('color-profile-not-embedded') && Boolean(profileLabel),
    code: 'color-profile',
    format,
    warningCodes: ['color-profile-not-embedded'],
    layerIds: allVisibleLayerIds,
    message: `${format.label} export records ${profileLabel} as metadata intent only and does not embed an ICC profile.`,
  });
  const highBitWarningCodes: ImageDocumentExportWarningCode[] = [
    ...(warningCodeSet.has('tiff-export-8bit-rgba') ? ['tiff-export-8bit-rgba' as const] : []),
    ...(warningCodeSet.has('source-high-bit-depth-downsampled') ? ['source-high-bit-depth-downsampled' as const] : []),
  ];
  appendWarningSummaryGroup(groups, {
    active: highBitWarningCodes.length > 0,
    code: 'high-bit-depth',
    format,
    warningCodes: highBitWarningCodes,
    layerIds: allVisibleLayerIds,
    message: buildHighBitDepthWarningSummaryMessage(format, bitDepth),
  });

  return groups;
}

function appendWarningSummaryGroup(
  groups: ImageDocumentExportWarningSummaryGroup[],
  {
    active,
    code,
    format,
    warningCodes,
    layerIds,
    message,
  }: {
    active: boolean;
    code: ImageDocumentExportWarningSummaryCode;
    format: ImageExportFormat;
    warningCodes: ImageDocumentExportWarningCode[];
    layerIds: string[];
    message: string;
  },
): void {
  if (!active || layerIds.length === 0) return;
  groups.push({
    code,
    formatExtension: format.extension,
    warningCodes,
    layerIds,
    message,
  });
}

function buildHighBitDepthWarningSummaryMessage(
  format: ImageExportFormat,
  bitDepth: ImageDocumentExportBitDepthDescriptor,
): string {
  if (!bitDepth.preservesSourceBitDepth) {
    return `${format.label} export writes flattened 8-bit RGB/RGBA output and does not preserve ${bitDepth.sourceBitDepth}-bit ${bitDepth.sourceFormat ?? 'source'} source data.`;
  }
  return `${format.label} export writes flattened 8-bit RGBA output and does not preserve high-bit-depth document data.`;
}

function buildExportBlockerSummaries(
  format: ImageExportFormat,
  sourceBinHandoff: ImageDocumentExportSourceBinHandoffReadiness,
): ImageDocumentExportBlockerSummary[] {
  const caveatCodeSet = new Set(sourceBinHandoff.caveats.map((caveat) => caveat.code));
  const targetLabel = describeHandoffTarget(sourceBinHandoff.target);
  const summaries: ImageDocumentExportBlockerSummary[] = [];

  if (caveatCodeSet.has('source-id-missing')) {
    summaries.push({
      code: 'source-id-missing',
      formatExtension: format.extension,
      caveatCodes: ['source-id-missing'],
      message: `${format.label} handoff needs a durable Source Library item id before ${targetLabel} can safely reference the exported derivative.`,
    });
  }
  if (caveatCodeSet.has('blob-url-not-durable')) {
    summaries.push({
      code: 'blob-url-not-durable',
      formatExtension: format.extension,
      caveatCodes: ['blob-url-not-durable'],
      message: `${format.label} handoff cannot rely on blob URLs for ${targetLabel} because blob-backed exports are session-local and not durable.`,
    });
  }

  return summaries;
}

function describeHandoffTarget(target: ImageDocumentExportSourceBinHandoffTarget): string {
  switch (target) {
    case 'source-bin':
      return 'Source Library';
    case 'flow':
      return 'Flow';
    case 'video':
      return 'Video';
    case 'paper':
      return 'Paper';
    default:
      return 'the target workspace';
  }
}

export function buildImageDocumentExportReadinessSignature(
  descriptor: Pick<
    ImageDocumentExportReadinessDescriptor,
    | 'documentId'
    | 'workflow'
    | 'status'
    | 'format'
    | 'scale'
    | 'bitDepth'
    | 'outputDimensions'
    | 'exportPreset'
    | 'batch'
    | 'sourceBinHandoff'
    | 'warnings'
    | 'blockers'
    | 'unsupportedStates'
  >,
): string {
  const warningCodes = descriptor.warnings.map((warning) => warning.code).join(',') || 'none';
  const blockerCodes = descriptor.blockers.map((blocker) => blocker.code).join(',') || 'none';
  const unsupportedCodes = descriptor.unsupportedStates.map((state) => state.code).join(',') || 'none';
  const presetId = descriptor.exportPreset.id ?? 'none';
  const batchPart = descriptor.batch.enabled ? String(descriptor.batch.itemCount) : 'off';

  return [
    'image-export-readiness:v1',
    `doc=${descriptor.documentId}`,
    `workflow=${descriptor.workflow}`,
    `status=${descriptor.status}`,
    `fmt=${descriptor.format.extension}`,
    `scale=${formatSignatureNumber(descriptor.scale.factor)}`,
    `size=${descriptor.outputDimensions.width}x${descriptor.outputDimensions.height}`,
    `dpi=${descriptor.scale.metadataDpi}`,
    `bitDepth=${descriptor.bitDepth.sourceBitDepth}to${descriptor.bitDepth.exportBitDepth}`,
    `preset=${presetId}`,
    `batch=${batchPart}`,
    `handoff=${descriptor.sourceBinHandoff.safe ? 'safe' : 'caveat'}`,
    `warnings=${warningCodes}`,
    `blockers=${blockerCodes}`,
    `unsupported=${unsupportedCodes}`,
  ].join('|');
}

export function flattenImageDocumentToBitmap(doc: ImageDocument): LayerBitmap {
  return renderImageDocumentLayersToBitmap(doc);
}

export function renderSelectionMaskToBitmap(mask: SelectionMask): LayerBitmap {
  return maskToCanvas(mask) as LayerBitmap;
}

export async function imageDocumentToDataUrl(
  doc: ImageDocument,
  mimeType = 'image/png',
): Promise<string> {
  return blobToDataUrl(await imageDocumentToBlob(doc, mimeType));
}

export async function imageDocumentToBlob(
  doc: ImageDocument,
  mimeType = 'image/png',
): Promise<Blob> {
  await ensureBundledFontDependenciesReady(collectImageBundledFontDependencies([doc]));
  const normalized = normalizeImageExportMimeType(mimeType);
  if (normalized === IMAGE_TIFF_MIME_TYPE && doc.metadata?.colorMode === 'cmyk' && doc.metadata.cmyk) {
    const metadata = doc.metadata.cmyk;
    let profileBytes: Uint8Array;
    let profile: ImageCmykProfileIdentity;
    if (metadata.profileSource?.kind === 'imported') {
      if (!metadata.profileBytesData) throw new Error('Native CMYK TIFF export requires the exact imported ICC profile bytes; the profile asset is unavailable.');
      try {
        const binary = atob(metadata.profileBytesData);
        profileBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } catch {
        throw new Error('Native CMYK TIFF export refused a malformed imported ICC profile payload.');
      }
      profile = {
        source: metadata.profileSource,
        id: metadata.profileSource.assetId,
        label: metadata.profileLabel,
        ...(metadata.profileLabel ? { outputConditionId: metadata.profileLabel } : {}),
      };
    } else {
      const loaded = await loadBundledImageCmykProfile(metadata.profileId);
      profileBytes = loaded.bytes;
      profile = loaded.identity;
    }
    const exported = exportImageDocumentCmykTiff(doc, profile, profileBytes);
    const body = new ArrayBuffer(exported.bytes.byteLength);
    new Uint8Array(body).set(exported.bytes);
    return new Blob([body], { type: IMAGE_TIFF_MIME_TYPE });
  }
  const nativeBytes = encodeNativeHighBitDocument(doc, normalized);
  if (nativeBytes) {
    const body = new ArrayBuffer(nativeBytes.byteLength);
    new Uint8Array(body).set(nativeBytes);
    return new Blob([body], { type: normalized });
  }
  if (normalized === 'image/x-exr') {
    throw new Error('OpenEXR export requires a native 32-bit float document; ordinary 8-bit documents are not converted to EXR.');
  }
  if (normalized === IMAGE_TIFF_MIME_TYPE) {
    const imageData = getBitmapImageData(flattenImageDocumentToBitmap(doc));
    const bytes = encodeImageDataToTiff(imageData);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Blob([body], { type: IMAGE_TIFF_MIME_TYPE });
  }
  if (normalized === IMAGE_BMP_MIME_TYPE) {
    const imageData = getBitmapImageData(flattenImageDocumentToBitmap(doc));
    const bytes = encodeImageDataToBmp(imageData);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Blob([body], { type: IMAGE_BMP_MIME_TYPE });
  }
  if (normalized === IMAGE_GIF_MIME_TYPE) {
    const imageData = getBitmapImageData(flattenImageDocumentToBitmap(doc));
    const bytes = encodeImageDataToStaticGif(imageData);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Blob([body], { type: IMAGE_GIF_MIME_TYPE });
  }
  if (normalized === IMAGE_SVG_MIME_TYPE) {
    const raster = await bitmapToDataUrl(flattenImageDocumentToBitmap(doc), 'image/png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><title>${escapeXml(doc.title || 'Image export')}</title><image href="${raster}" width="${doc.width}" height="${doc.height}" preserveAspectRatio="none" /></svg>`;
    return new Blob([svg], { type: IMAGE_SVG_MIME_TYPE });
  }
  return bitmapToBlob(flattenImageDocumentToBitmap(doc), normalized);
}

export async function selectionMaskToDataUrl(
  mask: SelectionMask,
  mimeType = 'image/png',
): Promise<string> {
  return bitmapToDataUrl(renderSelectionMaskToBitmap(mask), mimeType);
}

export function buildImageDocumentExportLabel({
  doc,
  sourceLabel,
  existingItems,
  suffix,
}: {
  doc: Pick<ImageDocument, 'title'>;
  sourceLabel?: string;
  existingItems: Array<{ label: string }>;
  suffix: 'edit' | 'mask';
}): string {
  const base = stripImageExtension(sourceLabel || doc.title || 'Image').trim() || 'Image';
  const first = `${base} ${suffix}`;
  const existingLabels = new Set(existingItems.map((item) => item.label.trim().toLowerCase()));

  if (!existingLabels.has(first.toLowerCase())) {
    return first;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${first} ${index}`;
    if (!existingLabels.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${first} ${Date.now()}`;
}

function stripImageExtension(label: string): string {
  return label.replace(/\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i, '');
}

function getVisibleExportLayers(doc: ImageDocument): ImageLayer[] {
  return doc.layers.filter((layer) => layer.type !== 'group' && isImageLayerEffectivelyVisible(layer, doc.layers));
}

function getOmittedHiddenLayerIds(doc: ImageDocument): string[] {
  return doc.layers
    .filter((layer) => layer.type !== 'group' && !isImageLayerEffectivelyVisible(layer, doc.layers))
    .map((layer) => layer.id);
}

function buildFlattenedFeatureCounts(layers: readonly ImageLayer[]): ImageDocumentExportFlattenedFeatureCounts {
  return {
    masks: countLayers(layers, (layer) => Boolean(layer.mask)),
    effects: countLayers(layers, (layer) => hasEnabledEntries(layer.effects)),
    filters: countLayers(layers, (layer) => hasEnabledEntries(layer.filters)),
    adjustments: countLayers(layers, (layer) => layer.type === 'adjustment' || Boolean(layer.adjustment)),
    textLayers: countLayers(layers, (layer) => layer.type === 'text' || Boolean(layer.text)),
    vectorLayers: countLayers(layers, (layer) => layer.type === 'vector' || Boolean(layer.vectorRecipe || layer.metadata?.vectorShape)),
    nonNormalBlendModes: countLayers(layers, (layer) => layer.blendMode !== 'normal'),
    partialOpacity: countLayers(layers, (layer) => layer.opacity < 1),
    sourceLinks: countLayers(layers, (layer) => Boolean(layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink)),
  };
}

function buildImageDocumentExportWarnings(
  format: ImageExportFormat,
  visibleLayers: readonly ImageLayer[],
  omittedHiddenLayerIds: readonly string[],
  featureCounts: ImageDocumentExportFlattenedFeatureCounts,
): ImageDocumentExportWarning[] {
  const warnings: ImageDocumentExportWarning[] = [];
  const visibleLayerIds = visibleLayers.map((layer) => layer.id);

  if (visibleLayers.length > 1 || hasFlattenedFeatureState(featureCounts)) {
    warnings.push(makeExportWarning(
      'visible-export-flattens-layers',
      format,
      visibleLayerIds,
      `${format.label} export writes a flattened visible bitmap and does not preserve editable Image layers.`,
    ));
  }

  if (omittedHiddenLayerIds.length > 0) {
    warnings.push(makeExportWarning(
      'hidden-layers-omitted',
      format,
      [...omittedHiddenLayerIds],
      'Hidden layers are omitted from the visible export.',
    ));
  }

  appendLayerFeatureWarning(warnings, {
    code: 'layer-masks-flattened',
    format,
    layers: visibleLayers,
    predicate: (layer) => Boolean(layer.mask),
    message: 'Layer masks are baked into the exported pixels.',
  });
  appendLayerFeatureWarning(warnings, {
    code: 'layer-effects-flattened',
    format,
    layers: visibleLayers,
    predicate: (layer) => hasEnabledEntries(layer.effects),
    message: 'Layer effects are rasterized into the flattened export.',
  });
  appendLayerFeatureWarning(warnings, {
    code: 'layer-filters-flattened',
    format,
    layers: visibleLayers,
    predicate: (layer) => hasEnabledEntries(layer.filters),
    message: 'Layer filter stacks are rasterized into the flattened export.',
  });
  appendLayerFeatureWarning(warnings, {
    code: 'editable-layer-state-flattened',
    format,
    layers: visibleLayers,
    predicate: (layer) => (
      layer.type === 'adjustment'
      || layer.type === 'text'
      || layer.type === 'vector'
      || Boolean(layer.adjustment || layer.text || layer.vectorRecipe || layer.metadata?.vectorShape)
    ),
    message: 'Editable adjustment, text, and vector layer state is rasterized into the flattened export.',
  });
  appendLayerFeatureWarning(warnings, {
    code: 'layer-compositing-flattened',
    format,
    layers: visibleLayers,
    predicate: (layer) => layer.opacity < 1 || layer.blendMode !== 'normal',
    message: 'Layer opacity and blend modes are composited into the flattened export.',
  });
  appendLayerFeatureWarning(warnings, {
    code: 'source-links-flattened',
    format,
    layers: visibleLayers,
    predicate: (layer) => Boolean(layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink),
    message: 'Source-linked layer editability is not preserved by visible flattened export formats.',
  });

  return warnings;
}

function buildFlatteningCaveats(
  visibleLayers: readonly ImageLayer[],
  omittedHiddenLayerIds: readonly string[],
  featureCounts: ImageDocumentExportFlattenedFeatureCounts,
): ImageDocumentExportFlatteningCaveat[] {
  const caveats: ImageDocumentExportFlatteningCaveat[] = [];
  if (omittedHiddenLayerIds.length > 0) {
    caveats.push({
      code: 'hidden-layers-omitted',
      layerIds: [...omittedHiddenLayerIds],
      message: 'Hidden layers are not included in the flattened visible export.',
    });
  }
  appendFlatteningCaveat(caveats, {
    code: 'layer-masks-baked',
    layers: visibleLayers,
    predicate: (layer) => Boolean(layer.mask),
    message: 'Layer masks become baked alpha/pixel results in the output bitmap.',
  });
  appendFlatteningCaveat(caveats, {
    code: 'layer-effects-rasterized',
    layers: visibleLayers,
    predicate: (layer) => hasEnabledEntries(layer.effects),
    message: 'Layer effects are rasterized and cannot be edited after export.',
  });
  appendFlatteningCaveat(caveats, {
    code: 'layer-filters-rasterized',
    layers: visibleLayers,
    predicate: (layer) => hasEnabledEntries(layer.filters),
    message: 'Layer filters are rasterized and cannot be adjusted after export.',
  });
  if (featureCounts.adjustments > 0 || featureCounts.textLayers > 0 || featureCounts.vectorLayers > 0) {
    caveats.push({
      code: 'editable-state-rasterized',
      layerIds: visibleLayers
        .filter((layer) => (
          layer.type === 'adjustment'
          || layer.type === 'text'
          || layer.type === 'vector'
          || Boolean(layer.adjustment || layer.text || layer.vectorRecipe || layer.metadata?.vectorShape)
        ))
        .map((layer) => layer.id),
      message: 'Adjustment, text, and vector editability is retained only in the Image document, not in the flattened export.',
    });
  }
  if (featureCounts.sourceLinks > 0) {
    caveats.push({
      code: 'source-links-derived-only',
      layerIds: visibleLayers
        .filter((layer) => Boolean(layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink))
        .map((layer) => layer.id),
      message: 'Source-linked layers export as derived pixels; original source links must be packaged separately for handoff.',
    });
  }
  return caveats;
}

function appendFlatteningCaveat(
  caveats: ImageDocumentExportFlatteningCaveat[],
  {
    code,
    layers,
    predicate,
    message,
  }: {
    code: ImageDocumentExportFlatteningCaveatCode;
    layers: readonly ImageLayer[];
    predicate: (layer: ImageLayer) => boolean;
    message: string;
  },
): void {
  const layerIds = layers.filter(predicate).map((layer) => layer.id);
  if (layerIds.length === 0) return;
  caveats.push({ code, layerIds, message });
}

function appendLayerFeatureWarning(
  warnings: ImageDocumentExportWarning[],
  {
    code,
    format,
    layers,
    predicate,
    message,
  }: {
    code: ImageDocumentExportWarningCode;
    format: ImageExportFormat;
    layers: readonly ImageLayer[];
    predicate: (layer: ImageLayer) => boolean;
    message: string;
  },
): void {
  const layerIds = layers.filter(predicate).map((layer) => layer.id);
  if (layerIds.length === 0) return;
  warnings.push(makeExportWarning(code, format, layerIds, message));
}

function makeExportWarning(
  code: ImageDocumentExportWarningCode,
  format: ImageExportFormat,
  layerIds: string[],
  message: string,
): ImageDocumentExportWarning {
  return {
    code,
    severity: 'warning',
    formatExtension: format.extension,
    layerIds,
    message,
  };
}

function buildExportFormatCapability(
  format: ImageExportFormat,
  metadataPolicy: ImageDocumentExportMetadataPolicy,
): ImageDocumentExportFormatCapability {
  const base = IMAGE_EXPORT_FORMAT_CAPABILITY_MATRIX[format.extension as ImageVisibleExportExtension]
    ?? IMAGE_EXPORT_FORMAT_CAPABILITY_MATRIX.png;
  return {
    ...base,
    metadata: metadataPolicy === 'strip' ? 'stripped' : 'preserved',
  };
}

function buildExportScaleDescriptor(
  sourceDimensions: { width: number; height: number },
  scale: number | undefined,
  metadataDpi: number,
): ImageDocumentExportScaleDescriptor {
  const factor = normalizeScaleFactor(scale);
  return {
    factor,
    sourceDimensions: { ...sourceDimensions },
    outputDimensions: {
      width: normalizeExportDimension(sourceDimensions.width * factor),
      height: normalizeExportDimension(sourceDimensions.height * factor),
    },
    metadataDpi,
    dpiEmbedded: false,
    resampling: 'browser-bitmap-resample',
  };
}

function buildExportBitDepthDescriptor(
  format: ImageExportFormat,
  {
    sourceFormat,
    sourceBitDepth,
    workingBitDepth,
  }: {
    sourceFormat?: string;
    sourceBitDepth?: ImageDocumentExportSourceBitDepth;
    workingBitDepth?: ImageDocumentExportSourceBitDepth;
  },
): ImageDocumentExportBitDepthDescriptor {
  const normalizedSourceFormat = normalizeSourceFormatLabel(sourceFormat);
  const normalizedSourceBitDepth = normalizeSourceBitDepth(sourceBitDepth);
  const normalizedWorkingBitDepth = normalizeSourceBitDepth(workingBitDepth);
  const hasNativeAuthority = normalizedWorkingBitDepth === 16 || normalizedWorkingBitDepth === 32;
  const nativeExportSupported = hasNativeAuthority && (
    format.extension === 'tif'
    || (format.extension === 'png' && normalizedWorkingBitDepth === 16)
    || (format.extension === 'exr' && normalizedWorkingBitDepth === 32)
  );
  if (hasNativeAuthority) {
    const exportBitDepth = nativeExportSupported ? normalizedWorkingBitDepth : 8;
    const sourceDepth = normalizedSourceBitDepth === 8 ? normalizedWorkingBitDepth : normalizedSourceBitDepth;
    return {
      sourceFormat: normalizedSourceFormat,
      sourceBitDepth: sourceDepth,
      exportBitDepth,
      preservesSourceBitDepth: nativeExportSupported,
      highBitDepthCaveats: nativeExportSupported
        ? [`${format.label} export reads the document's native ${normalizedWorkingBitDepth}-bit/channel authority directly; the visible preview remains a derived 8-bit proxy.`]
        : [`${format.label} cannot preserve the document's native ${normalizedWorkingBitDepth}-bit/channel authority without conversion; this export refuses rather than routing through the 8-bit proxy.`],
    };
  }
  const preservesSourceBitDepth = normalizedSourceBitDepth === 8;

  return {
    sourceFormat: normalizedSourceFormat,
    sourceBitDepth: normalizedSourceBitDepth,
    exportBitDepth: 8,
    preservesSourceBitDepth,
    highBitDepthCaveats: preservesSourceBitDepth
      ? []
      : [
        `${normalizedSourceFormat ?? 'Source'} source precision is represented by the editable Image document as 8-bit RGBA canvas data.`,
        `${format.label} export writes a flattened 8-bit RGB/RGBA derivative; keep the ${normalizedSourceFormat ?? 'source'} source master for ${normalizedSourceBitDepth}-bit print, archive, or VFX handoff.`,
      ],
  };
}

function buildExportPresetReadiness(
  preset: ImageDocumentExportReadinessOptions['exportPreset'],
  metadataPolicy: ImageDocumentExportMetadataPolicy,
): ImageDocumentExportPresetReadiness {
  const id = preset?.id.trim() || null;
  const label = preset?.label.trim() || null;
  const quality = preset?.quality === undefined ? null : normalizeQuality(preset.quality);

  return {
    ready: Boolean(id && label),
    id,
    label,
    quality,
    metadataPolicy,
    signature: [
      `preset=${id ?? 'none'}`,
      quality === null ? 'quality=auto' : `quality=${quality}`,
      `metadata=${metadataPolicy}`,
    ].join('|'),
  };
}

function buildExportBatchReadiness(
  batch: ImageDocumentExportReadinessOptions['batch'],
): ImageDocumentExportBatchReadiness {
  if (!batch?.enabled) {
    return {
      ready: true,
      enabled: false,
      itemCount: 1,
      nameTemplate: '',
      warnings: [],
      signature: 'batch=off',
    };
  }

  const itemCount = normalizeBatchItemCount(batch.itemCount);
  const nameTemplate = batch.nameTemplate.trim();
  const warnings: string[] = [];
  if (itemCount < 1) {
    warnings.push('Batch export needs at least one target item.');
  }
  if (!nameTemplate) {
    warnings.push('Batch export needs a non-empty file-name template.');
  }

  return {
    ready: warnings.length === 0,
    enabled: true,
    itemCount,
    nameTemplate,
    warnings,
    signature: `batch=on|items=${itemCount}|template=${nameTemplate || 'none'}`,
  };
}

function buildSourceBinHandoffReadiness({
  options,
  flattening,
  profileLabel,
  batch,
}: {
  options: ImageDocumentExportReadinessOptions['sourceBinHandoff'];
  flattening: ImageDocumentExportFlatteningDescriptor;
  profileLabel: string | null;
  batch: ImageDocumentExportBatchReadiness;
}): ImageDocumentExportSourceBinHandoffReadiness {
  const target = options?.target ?? 'source-bin';
  const sourceItemId = options?.sourceItemId?.trim() || null;
  const sourceUrlKind = options?.sourceUrlKind ?? 'durable';
  const preserveOriginalSourceReference = options?.preserveOriginalSourceReference ?? true;
  const caveats: ImageDocumentExportSourceBinHandoffReadiness['caveats'] = [];

  caveats.push({
    code: 'flattened-derivative-required',
    message: 'Handoff should package the exported flattened derivative as a new asset, not overwrite the editable Image document.',
  });
  if (flattening.omittedHiddenLayerIds.length > 0) {
    caveats.push({
      code: 'hidden-layers-not-packaged',
      message: 'Hidden layers are omitted from the derivative and remain available only in the Image document.',
    });
  }
  if (flattening.featureCounts.sourceLinks > 0) {
    caveats.push({
      code: 'source-link-editability-not-preserved',
      message: 'Source-linked layer editability is not preserved in the flattened derivative; package originals separately when provenance matters.',
    });
  }
  if (sourceUrlKind === 'blob') {
    caveats.push({
      code: 'blob-url-not-durable',
      message: 'Blob URLs are session-local; persist the exported derivative into project scratch or native media before cross-workspace handoff.',
    });
  }
  if (!sourceItemId) {
    caveats.push({
      code: 'source-id-missing',
      message: 'A durable Source Library item id is needed before Flow, Video, or Paper can safely reference the exported derivative.',
    });
  }
  if (profileLabel) {
    caveats.push({
      code: 'profile-intent-metadata-only',
      message: 'Color profile intent is metadata-only for this export path and should not be treated as embedded ICC data.',
    });
  }
  if (batch.enabled && !batch.ready) {
    caveats.push({
      code: 'batch-template-required',
      message: 'Batch handoff needs a valid item count and file-name template before packaging derivatives.',
    });
  }
  if (target === 'paper') {
    caveats.push({
      code: 'paper-proof-routing-review-only',
      message: 'Paper handoff receives a flattened page/placeable asset; trim, bleed, and press-proof routing stay review-only until Paper or artboard proof workflows re-establish print geometry.',
    });
  }
  if (target === 'video') {
    caveats.push({
      code: 'video-handoff-still-frame-only',
      message: 'Video handoff receives a still flattened frame; print-proof metadata does not become timeline-aware video output.',
    });
  }

  const safe = sourceUrlKind === 'durable' && Boolean(sourceItemId) && (!batch.enabled || batch.ready);
  const descriptor: ImageDocumentExportSourceBinHandoffReadiness = {
    target,
    safe,
    sourceItemId,
    sourceUrlKind,
    packageFlattenedDerivative: true,
    preserveOriginalSourceReference,
    caveats,
    signature: '',
  };
  descriptor.signature = [
    'image-export-source-bin-handoff:v1',
    `target=${target}`,
    `safe=${safe}`,
    `source=${sourceItemId ?? 'none'}`,
    `url=${sourceUrlKind}`,
    `preserveOriginal=${preserveOriginalSourceReference}`,
    `caveats=${caveats.map((caveat) => caveat.code).join(',') || 'none'}`,
  ].join('|');
  return descriptor;
}

function buildExportUnsupportedStates(
  format: ImageExportFormat,
  capability: ImageDocumentExportFormatCapability,
  {
    requestedAnimation,
    requestedTransparency,
    profileLabel,
  }: {
    requestedAnimation: boolean;
    requestedTransparency: boolean;
    profileLabel: string | null;
  },
): ImageDocumentExportUnsupportedState[] {
  const states: ImageDocumentExportUnsupportedState[] = [];

  if (requestedAnimation && format.extension === 'webp' && capability.animation === 'unsupported') {
    states.push(makeUnsupportedState(
      'animated-webp-export',
      format,
      'Animated WebP export is not generated; the current export path writes a single flattened frame.',
    ));
  }
  if (requestedAnimation && format.extension === 'gif') {
    states.push(makeUnsupportedState(
      'animated-gif-export',
      format,
      'Animated GIF export is not generated; GIF output is a static flattened frame.',
    ));
  }
  if (format.mimeType === IMAGE_GIF_MIME_TYPE && requestedTransparency) {
    states.push(makeUnsupportedState(
      'gif-alpha-quantized',
      format,
      'GIF transparency is limited to binary transparency and cannot preserve full alpha.',
    ));
  }
  if (format.mimeType === IMAGE_GIF_MIME_TYPE) {
    states.push(makeUnsupportedState(
      'indexed-palette-editor',
      format,
      'Indexed palette editing and palette-size optimization are not exposed for GIF export.',
    ));
  }
  if (profileLabel) {
    states.push(makeUnsupportedState(
      'icc-profile-embedding',
      format,
      'ICC profile embedding is metadata-only in this export readiness helper.',
    ));
  }

  return states;
}

function buildPresetCompatibilityWarningCodes(
  readiness: ImageDocumentExportReadinessDescriptor,
): ImageDocumentExportUnsupportedStateCode[] {
  return uniqueExportUnsupportedCodes([
    ...readiness.unsupportedStates.map((state) => state.code),
    'live-native-vector-preservation',
    'live-native-text-preservation',
    'native-layer-effect-preservation',
    'true-cmyk-separations',
    'spot-color-separations',
    ...(readiness.bitDepth.preservesSourceBitDepth ? [] : ['high-bit-depth-output' as const]),
  ]);
}

function uniqueExportWarningCodes(
  codes: readonly ImageDocumentExportWarningCode[],
): ImageDocumentExportWarningCode[] {
  return [...new Set(codes)];
}

function uniqueExportUnsupportedCodes(
  codes: readonly ImageDocumentExportUnsupportedStateCode[],
): ImageDocumentExportUnsupportedStateCode[] {
  return [...new Set(codes)];
}

function makeUnsupportedState(
  code: ImageDocumentExportUnsupportedStateCode,
  format: ImageExportFormat,
  message: string,
): ImageDocumentExportUnsupportedState {
  return {
    code,
    formatExtension: format.extension,
    message,
  };
}

function buildExportBlockers(
  format: ImageExportFormat,
  capability: ImageDocumentExportFormatCapability,
  batch: ImageDocumentExportBatchReadiness,
  {
    requestedAnimation,
  }: {
    requestedAnimation: boolean;
  },
): ImageDocumentExportBlocker[] {
  const blockers: ImageDocumentExportBlocker[] = [];

  if (requestedAnimation && capability.animation === 'unsupported') {
    blockers.push(makeExportBlocker(
      'animation-export-unsupported',
      format,
      `${format.label} animation export is unsupported by the current flattened export path.`,
    ));
  }
  if (batch.enabled && batch.itemCount < 1) {
    blockers.push(makeExportBlocker(
      'batch-empty',
      format,
      'Batch export cannot run without at least one target item.',
    ));
  }
  if (batch.enabled && !batch.nameTemplate) {
    blockers.push(makeExportBlocker(
      'batch-template-missing',
      format,
      'Batch export needs a file-name template before it can run.',
    ));
  }

  return blockers;
}

function makeExportBlocker(
  code: ImageDocumentExportBlockerCode,
  format: ImageExportFormat,
  message: string,
): ImageDocumentExportBlocker {
  return {
    code,
    formatExtension: format.extension,
    message,
  };
}

function buildExportImplications(
  format: ImageExportFormat,
  capability: ImageDocumentExportFormatCapability,
  featureCounts: ImageDocumentExportFlattenedFeatureCounts,
  {
    requestedAnimation,
    requestedTransparency,
  }: {
    requestedAnimation: boolean;
    requestedTransparency: boolean;
  },
): ImageDocumentExportImplication[] {
  const implications: ImageDocumentExportImplication[] = [];

  if (capability.transparency === 'alpha') {
    implications.push(makeExportImplication(
      'alpha-preserved',
      format,
      `${format.label} can preserve flattened alpha transparency.`,
    ));
  } else if (capability.transparency === 'binary' && requestedTransparency) {
    implications.push(makeExportImplication(
      'alpha-quantized',
      format,
      `${format.label} reduces alpha transparency to an on/off transparent index.`,
    ));
  } else if (capability.transparency === 'none' && requestedTransparency) {
    implications.push(makeExportImplication(
      'alpha-discarded',
      format,
      `${format.label} export composites transparency against the flattened bitmap.`,
    ));
  }

  if (requestedAnimation && capability.animation === 'unsupported') {
    implications.push(makeExportImplication(
      'animation-unsupported',
      format,
      'The current export path does not generate multi-frame or timeline animation outputs.',
    ));
  } else if (requestedAnimation && capability.animation === 'static-only') {
    implications.push(makeExportImplication(
      'static-animation-only',
      format,
      'The current export path writes a single static frame instead of animation timing.',
    ));
  }

  implications.push(makeExportImplication(
    'vector-rasterized',
    format,
    'Vector content is represented in the flattened raster output instead of editable vector instructions.',
  ));
  if (featureCounts.textLayers > 0) {
    implications.push(makeExportImplication(
      'text-rasterized',
      format,
      'Editable text is rendered into pixels in the flattened export.',
    ));
  }
  implications.push(makeExportImplication(
    'layers-flattened',
    format,
    'Layer structure is flattened into one visible output image.',
  ));
  implications.push(makeExportImplication(
    capability.metadata === 'stripped' ? 'metadata-stripped' : 'metadata-preserved',
    format,
    capability.metadata === 'stripped'
      ? 'Save-for-web metadata policy strips document metadata from the readiness plan.'
      : 'Export-as metadata policy keeps metadata intent in the readiness plan, subject to encoder support.',
  ));

  return implications;
}

function makeExportImplication(
  code: ImageDocumentExportImplicationCode,
  format: ImageExportFormat,
  message: string,
): ImageDocumentExportImplication {
  return {
    code,
    formatExtension: format.extension,
    message,
  };
}

function resolveExportReadinessStatus(
  warnings: readonly ImageDocumentExportWarning[],
  unsupportedStates: readonly ImageDocumentExportUnsupportedState[],
  blockers: readonly ImageDocumentExportBlocker[],
): ImageDocumentExportStatus {
  if (blockers.length > 0) return 'blocked';
  return warnings.length > 0 || unsupportedStates.length > 0 ? 'limited-ready' : 'ready';
}

function buildReadinessWarnings(
  format: ImageExportFormat,
  visibleLayerIds: readonly string[],
  featureCounts: ImageDocumentExportFlattenedFeatureCounts,
  {
    print,
    profileLabel,
    proofMode,
    intent,
    bitDepth,
  }: {
    print: ImageDocumentExportPrintDescriptor;
    profileLabel: string | null;
    proofMode: ImageDocumentExportProofDescriptor['mode'];
    intent: ImageDocumentExportIntent;
    bitDepth: ImageDocumentExportBitDepthDescriptor;
  },
): ImageDocumentExportWarning[] {
  const warnings: ImageDocumentExportWarning[] = [];

  if (intent === 'print' && !print.meetsTargetDpi) {
    warnings.push(makeExportWarning(
      'print-resolution-below-target',
      format,
      [...visibleLayerIds],
      `Print size resolves to ${print.actualPpiX} x ${print.actualPpiY} PPI, below the ${print.targetDpi} DPI target.`,
    ));
  }
  if (format.mimeType === IMAGE_TIFF_MIME_TYPE) {
    warnings.push(makeExportWarning(
      'tiff-export-8bit-rgba',
      format,
      [...visibleLayerIds],
      'TIFF export writes flattened 8-bit RGBA pixels; high-bit-depth samples, layers, and embedded ICC profiles are not preserved.',
    ));
  }
  if (!bitDepth.preservesSourceBitDepth) {
    warnings.push(makeExportWarning(
      'source-high-bit-depth-downsampled',
      format,
      [...visibleLayerIds],
      `${bitDepth.sourceFormat ?? 'Source'} source is ${bitDepth.sourceBitDepth}-bit, but visible export writes 8-bit RGB/RGBA derivative pixels.`,
    ));
  }
  if (format.mimeType === IMAGE_GIF_MIME_TYPE) {
    warnings.push(makeExportWarning(
      'gif-export-static-only',
      format,
      [...visibleLayerIds],
      'GIF export writes a static flattened image only; animation timing and multi-frame output are not generated.',
    ));
  }
  if (format.mimeType === IMAGE_SVG_MIME_TYPE && featureCounts.vectorLayers > 0) {
    warnings.push(makeExportWarning(
      'svg-vector-state-flattened',
      format,
      [...visibleLayerIds],
      'SVG export embeds a flattened raster snapshot and does not preserve editable vector layer structure.',
    ));
  }
  if (profileLabel) {
    warnings.push(makeExportWarning(
      'color-profile-not-embedded',
      format,
      [...visibleLayerIds],
      `${profileLabel} is not embedded or applied as an ICC transform in visible export.`,
    ));
  }
  if (proofMode === 'cmyk-soft-proof') {
    warnings.push(makeExportWarning(
      'cmyk-proof-not-separated',
      format,
      [...visibleLayerIds],
      'CMYK soft proof remains RGB preview metadata; export does not create press-ready separations.',
    ));
  }

  return warnings;
}

function buildExportPrintDescriptor(
  dimensions: { width: number; height: number },
  options: {
    targetDpi: number;
    printWidthInches?: number;
    printHeightInches?: number;
  },
): ImageDocumentExportPrintDescriptor {
  const widthInches = normalizePrintInches(options.printWidthInches ?? dimensions.width / options.targetDpi);
  const heightInches = normalizePrintInches(options.printHeightInches ?? dimensions.height / options.targetDpi);
  const actualPpiX = roundNumber(dimensions.width / widthInches);
  const actualPpiY = roundNumber(dimensions.height / heightInches);

  return {
    targetDpi: options.targetDpi,
    widthInches,
    heightInches,
    widthMm: roundNumber(widthInches * 25.4),
    heightMm: roundNumber(heightInches * 25.4),
    actualPpiX,
    actualPpiY,
    meetsTargetDpi: actualPpiX >= options.targetDpi && actualPpiY >= options.targetDpi,
  };
}

function buildExportPressReadyDescriptor(
  format: ImageExportFormat,
  {
    intent,
    print,
    profileLabel,
    proofMode,
  }: {
    intent: ImageDocumentExportIntent;
    print: ImageDocumentExportPrintDescriptor;
    profileLabel: string | null;
    proofMode: ImageColorProofMode;
  },
): ImageDocumentExportPressReadyDescriptor {
  const unsupportedSeparations: ImageDocumentExportUnsupportedSeparation[] = [
    {
      code: 'process-cmyk-separations',
      supported: false,
      message: 'Process CMYK separations are unsupported; visible export writes flattened RGB/RGBA pixels.',
    },
    {
      code: 'spot-color-plates',
      supported: false,
      message: 'Spot-color plates are unsupported; spot and proof intent must be handled by external prepress tooling.',
    },
    {
      code: 'icc-output-profile-conversion',
      supported: false,
      message: 'ICC output-profile conversion and embedding are unsupported in the visible export path.',
    },
    {
      code: 'printer-marks-pdfx',
      supported: false,
      message: 'Printer marks, output intents, and PDF/X packaging are outside Image visible export planning.',
    },
  ];
  const dpiReady = intent === 'print'
    ? print.meetsTargetDpi && print.targetDpi >= 300
    : print.meetsTargetDpi;
  const caveats: string[] = [];

  if (intent === 'print' && !dpiReady) {
    caveats.push('Print size resolves below 300 DPI; resize/upscale or reduce physical print size before press handoff.');
  }
  if (profileLabel) {
    caveats.push(`Requested profile "${profileLabel}" is recorded as intent metadata only; ICC conversion and embedding are unsupported.`);
  }
  if (proofMode === 'cmyk-soft-proof') {
    caveats.push('CMYK soft proof is a preview/metadata state only and does not create process-color separations.');
  }
  caveats.push('Press-ready separations, spot plates, output intents, printer marks, and PDF/X packaging require external prepress tooling.');

  return {
    pressReady: false,
    outputPixelSpace: 'RGB',
    nativeCmyk: false,
    embeddedIccProfile: false,
    minTargetDpi: 300,
    dpiReady,
    profileReady: false,
    unsupportedSeparations,
    caveats,
    signature: [
      'image-export-press-ready:v1',
      `fmt=${format.extension}`,
      `intent=${intent}`,
      `dpi=${print.targetDpi}`,
      `actual=${formatSignatureNumber(print.actualPpiX)}x${formatSignatureNumber(print.actualPpiY)}`,
      `dpiReady=${dpiReady}`,
      `profile=${profileLabel ?? 'none'}`,
      'profileReady=false',
      `separations=${unsupportedSeparations.map((separation) => separation.code).join(',')}`,
    ].join('|'),
  };
}

function buildExportPrintProofRouteDescriptor(
  format: ImageExportFormat,
  {
    intent,
    print,
    profileLabel,
    proofMode,
  }: {
    intent: ImageDocumentExportIntent;
    print: ImageDocumentExportPrintDescriptor;
    profileLabel: string | null;
    proofMode: ImageColorProofMode;
  },
): ImageDocumentExportPrintProofRouteDescriptor {
  const unsupportedStates: ImageDocumentExportPrintProofUnsupportedState[] = [
    {
      code: 'contract-proof-calibration',
      supported: false,
      message: 'Hardware-calibrated contract proof output is unsupported by Image visible export.',
    },
    {
      code: 'icc-profile-conversion',
      supported: false,
      message: 'ICC output-profile conversion and embedding are unsupported by Image visible export.',
    },
    {
      code: 'pdfx-printer-marks',
      supported: false,
      message: 'PDF/X output intents, registration marks, crop marks, and color bars are not generated.',
    },
  ];
  const dpiReady = intent === 'print'
    ? print.meetsTargetDpi && print.targetDpi >= 300
    : print.meetsTargetDpi;
  const warnings: string[] = [];

  if (!dpiReady) {
    warnings.push(`Print proof output resolves below the ${print.targetDpi} DPI target.`);
  }
  if (profileLabel) {
    warnings.push(`${profileLabel} is recorded as proof intent metadata only; ICC conversion and embedding are not applied.`);
  }
  if (proofMode === 'cmyk-soft-proof') {
    warnings.push('CMYK soft proof does not create process separations in the flattened export route.');
  }
  warnings.push('True contract proof calibration, printer marks, output intents, and PDF/X packaging require external prepress tooling.');

  return {
    mode: 'flattened-rgb-proof-derivative',
    truePrintProof: false,
    dpiReady,
    profileReady: false,
    softProofMode: proofMode,
    profileLabel,
    warnings,
    unsupportedStates,
    signature: [
      'image-export-print-proof:v1',
      `fmt=${format.extension}`,
      `intent=${intent}`,
      `dpiReady=${dpiReady}`,
      'profileReady=false',
      `profile=${profileLabel ?? 'none'}`,
      'trueProof=false',
      `unsupported=${unsupportedStates.map((state) => state.code).join(',')}`,
    ].join('|'),
  };
}

function buildExportPreviewSignature({
  doc,
  format,
  intent,
  dimensions,
  visibleLayerIds,
  hiddenLayerIds,
  targetDpi,
  proofMode,
  proofIntent,
  proofProfileLabel,
  profileLabel,
  previewTag,
  printWidthInches,
  printHeightInches,
}: {
  doc: ImageDocument;
  format: ImageExportFormat;
  intent: ImageDocumentExportIntent;
  dimensions: { width: number; height: number };
  visibleLayerIds: readonly string[];
  hiddenLayerIds: readonly string[];
  targetDpi: number;
  proofMode: ImageDocumentExportProofDescriptor['mode'];
  proofIntent: ImageDocumentExportProofDescriptor['intent'];
  proofProfileLabel?: string;
  profileLabel: string | null;
  previewTag: string;
  printWidthInches?: number;
  printHeightInches?: number;
}): string {
  const parts = [
    'image-export:v1',
    `doc=${doc.id}`,
    `fmt=${format.extension}`,
    `intent=${intent}`,
    `size=${dimensions.width}x${dimensions.height}`,
    `layers=${visibleLayerIds.join(',') || 'none'}`,
    `hidden=${hiddenLayerIds.join(',') || 'none'}`,
    `dpi=${targetDpi}`,
    `proof=${proofMode}:${proofIntent}:${proofProfileLabel?.trim() || 'none'}`,
    `profile=${profileLabel || 'none'}`,
  ];

  if (printWidthInches && printHeightInches) {
    parts.push(`print=${normalizePrintInches(printWidthInches)}x${normalizePrintInches(printHeightInches)}in`);
  }

  parts.push(`tag=${previewTag}`);
  return parts.join('|');
}

function normalizeDpi(value: number): number {
  if (!Number.isFinite(value)) return 72;
  return Math.max(1, Math.round(value));
}

function normalizeScaleFactor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(16, Math.max(0.01, roundNumber(value)));
}

function normalizeQuality(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(1, Math.round(value)));
}

function normalizeBatchItemCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeSourceFormatLabel(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeSourceBitDepth(value: ImageDocumentExportSourceBitDepth | undefined): ImageDocumentExportSourceBitDepth {
  if (value === 16 || value === 32) return value;
  return 8;
}

function normalizePrintInches(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.0001, roundNumber(value));
}

function roundNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function formatSignatureNumber(value: number): string {
  return String(roundNumber(value));
}

function hasFlattenedFeatureState(featureCounts: ImageDocumentExportFlattenedFeatureCounts): boolean {
  return Object.values(featureCounts).some((count) => count > 0);
}

function countLayers(layers: readonly ImageLayer[], predicate: (layer: ImageLayer) => boolean): number {
  return layers.filter(predicate).length;
}

function hasEnabledEntries(entries: readonly { enabled: boolean }[] | undefined): boolean {
  return Boolean(entries?.some((entry) => entry.enabled));
}

function normalizeExportDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

async function bitmapToDataUrl(bitmap: LayerBitmap, mimeType: string): Promise<string> {
  const blob = await bitmapToBlob(bitmap, mimeType);
  return blobToDataUrl(blob);
}

async function bitmapToBlob(bitmap: LayerBitmap, mimeType: string): Promise<Blob> {
  return bitmap.convertToBlob({ type: mimeType });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to export image data.'));
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('The exported image could not be converted into a data URL.'));
          return;
        }
        resolve(reader.result);
      };
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}
