import type {
  ImageLayer,
  TextLayerBezierSegment,
  ImageVectorPathPoint,
  LayerBitmap,
  TextLayerOpenTypeFeatures,
  TextLayerPathLayout,
  TextLayerPathReferenceMetadata,
  TextLayerStyle,
} from '../../types/imageEditor';
import { createBitmap } from './LayerBitmap';
import { getEditableVectorShape, getVectorPathDocumentPoints } from './ImageVectorShape';
import { formatFontFamily } from '../../lib/formatFontFamily';
import {
  bundledFontFaceIdentitySignature,
  bundledFontFaceRuntimeFamilyName,
  bundledFontFaceStyleDescriptor,
  normalizeBundledFontFaceState,
  normalizeBundledFontFaceStateForTypography,
} from '../../lib/bundledFontLibrary';

export type ImageTextAlign = 'left' | 'center' | 'right' | 'justify';

export interface ImageTextLayerStyle extends TextLayerStyle {
  lineHeight: number;
  align: ImageTextAlign;
}

export interface MeasuredImageTextLine {
  text: string;
  width: number;
  x: number;
  baseline: number;
}

export interface MeasuredImageTextBlock {
  lines: MeasuredImageTextLine[];
  width: number;
  height: number;
  lineHeightPx: number;
  align: ImageTextAlign;
  boxWidth: number | null;
  boxHeight: number | null;
}

export const IMAGE_TEXT_RASTER_MAX_DIMENSION = 4096;
export const IMAGE_TEXT_RASTER_MAX_PIXELS = 8 * 1024 * 1024;
const IMAGE_TEXT_WARP_MAX_DISPLACEMENT = 16;

export class ImageTextRasterBudgetError extends Error {
  readonly code = 'IMAGE_TEXT_RASTER_BUDGET_EXCEEDED' as const;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly maxDimension = IMAGE_TEXT_RASTER_MAX_DIMENSION;
  readonly maxPixels = IMAGE_TEXT_RASTER_MAX_PIXELS;

  constructor(width: number, height: number, pixelCount: number) {
    super(
      `Text raster allocation ${formatRasterDimension(width)}x${formatRasterDimension(height)} `
      + `(${formatRasterDimension(pixelCount)} pixels) exceeds the `
      + `${IMAGE_TEXT_RASTER_MAX_DIMENSION}px per-axis / ${IMAGE_TEXT_RASTER_MAX_PIXELS}-pixel budget.`,
    );
    this.name = 'ImageTextRasterBudgetError';
    this.width = width;
    this.height = height;
    this.pixelCount = pixelCount;
  }
}

export interface ImageTextOpenTypeFeatureDescriptor {
  enabled: string[];
  disabled: string[];
  unsupported?: string[];
}

export interface ImageTextStandardFontStack {
  id: string;
  label: string;
  stack: string;
  category: 'Sans' | 'Serif' | 'Display' | 'Mono' | 'Comic';
}

export interface ImageTextVisibleOpenTypeFeature {
  tag: string;
  label: string;
  ariaLabel: string;
  description: string;
}

export interface ImageTextFontCatalogEntry extends ImageTextStandardFontStack {
  selected: boolean;
}

export interface ImageTextFontCatalogDescriptor {
  requestedFamily: string;
  selectedStack: ImageTextFontCatalogEntry | null;
  standardStacks: ImageTextFontCatalogEntry[];
  customFamily: string | null;
}

export interface ImageTextInstalledFontEntry {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
}

export interface ImageTextInstalledFontBrowserDescriptor {
  supported: true;
  source: 'local-font-access-api-or-injected-font-list' | 'standard-stack-fallback';
  requestedFamily: string;
  selectedFamilyAvailable: boolean;
  installedFonts: ImageTextInstalledFontEntry[];
  browserEntries: Array<ImageTextInstalledFontEntry & { selected: boolean }>;
  standardStacks: ImageTextFontCatalogEntry[];
  signature: string;
}

export interface ImageTextDictionarySpellcheckMisspelling {
  word: string;
  normalized: string;
  layerIds: string[];
  suggestions: string[];
}

export interface ImageTextDictionarySpellcheckPlan extends Omit<ImageTextWorkflowLayerSummary, 'previewSignature'> {
  status: 'ready' | 'limited';
  affectedLayerIds: string[];
  dictionarySize: number;
  misspellings: ImageTextDictionarySpellcheckMisspelling[];
  previewSignature: string;
}

export interface ImageTextAdvancedTypographySupportDescriptor {
  descriptorId: 'image-text-advanced-typography-support:v1';
  version: 1;
  deterministic: true;
  installedFonts: Pick<ImageTextInstalledFontBrowserDescriptor, 'supported' | 'source' | 'selectedFamilyAvailable' | 'installedFonts'>;
  fontBrowser: ImageTextInstalledFontBrowserDescriptor;
  dictionarySpellcheck: {
    supported: true;
    status: ImageTextDictionarySpellcheckPlan['status'];
    dictionarySize: number;
    misspellingCount: number;
    misspellings: ImageTextDictionarySpellcheckMisspelling[];
  };
  advancedShaping: {
    supported: true;
    engine: 'browser-canvas-intl-segmenter';
    graphemeClusterCount: number;
    bidiRuns: Array<'ltr' | 'rtl'>;
    openTypeCss: string[];
  };
  verticalType: {
    supported: true;
    layerIds: string[];
    orientations: Array<NonNullable<ImageTextLayerStyle['orientation']>>;
  };
  bezierTextOnPath: {
    supported: true;
    layerIds: string[];
    sampledPathSignatures: string[];
  };
  editableTextWarp: {
    supported: true;
    layerIds: string[];
    warpModes: Array<Exclude<ImageTextLayerStyle['warp'], 'none'>>;
  };
  signature: string;
}

export interface SerializedImageTextOpenTypeFeatures extends ImageTextOpenTypeFeatureDescriptor {
  css: string;
}

export interface ImageTextCharacterStyleDescriptor {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: ImageTextLayerStyle['fontStyle'];
  fontKerning: ImageTextLayerStyle['fontKerning'];
  fontVariantCaps: ImageTextLayerStyle['fontVariantCaps'];
  letterSpacing: number;
  baselineShift: number;
  openTypeFeatures: SerializedImageTextOpenTypeFeatures;
}

export interface ImageTextParagraphStyleDescriptor {
  align: ImageTextLayerStyle['align'];
  lineHeight: number;
  verticalAlign: ImageTextLayerStyle['verticalAlign'];
  orientation?: Exclude<NonNullable<ImageTextLayerStyle['orientation']>, 'horizontal'>;
  wrap: boolean;
  boxWidth: number | null;
  boxHeight: number | null;
}

export interface ImageTextStylePreviewDescriptor {
  previewId?: string;
  contentLength: number;
  lineCount: number;
  signature: string;
}

export interface SerializedImageTextStylePackage {
  characterStyle: ImageTextCharacterStyleDescriptor;
  paragraphStyle: ImageTextParagraphStyleDescriptor;
  warnings: string[];
  preview: ImageTextStylePreviewDescriptor;
}

export type ImageTextPathReferenceMetadata = TextLayerPathReferenceMetadata;

export interface ImageTextOnPathPlanRequest {
  textLayerId?: string | null;
  pathLayerId?: string | null;
  pathReference?: ImageTextPathReferenceMetadata | null;
  pathLayout?: TextLayerPathLayout | null;
  startOffset?: number;
  reverse?: boolean;
}

export interface SupportedImageTextOnPathDescriptor {
  status: 'ready';
  feature: 'text-on-path';
  textLayerId: string | null;
  pathLayerId: string | null;
  pathReference: ImageTextPathReferenceMetadata;
  startOffset: number;
  reverse: boolean;
  geometry: 'straight-segment-path' | 'bezier-sampled-path';
  editableSource: 'retained-text-and-vector-path-reference';
  pathLength: number;
  pointCount: number;
  nativePsdRoundtrip: 'unsupported';
  previewSignature: string;
  warnings: string[];
}

export interface UnsupportedImageTextOnPathDescriptor {
  status: 'unsupported';
  feature: 'text-on-path';
  textLayerId: string | null;
  pathLayerId: string | null;
  pathReference: ImageTextPathReferenceMetadata | null;
  startOffset: number;
  reverse: boolean;
  fallback: string;
  requiredMetadata: string[];
  reason: string;
  warnings: string[];
}

export type ImageTextOnPathDescriptor =
  | SupportedImageTextOnPathDescriptor
  | UnsupportedImageTextOnPathDescriptor;

export interface ImageTextFontPersistenceDescriptor {
  requestedFamily: string;
  preferredFamily: string;
  fallbackFamilies: string[];
  discoveryStatus: 'fallback-stack-recorded';
  fallbackStatus: 'fallbacks-available' | 'no-fallbacks-declared';
  persistenceNote: string;
}

export interface ImageTextLiveEditStatusDescriptor {
  status: 'retained-live-edit' | 'metadata-only' | 'not-editable';
  editable: boolean;
  retainedMetadata: boolean;
  caveats: string[];
}

export interface ImageTextFontDiscoveryDescriptor {
  status: 'fallback-stack-recorded';
  requestedFamily: string;
  preferredFamily: string;
  fallbackFamilies: string[];
  warning: string;
}

export interface ImageTextOpenTypeSupportDescriptor {
  status: 'supported-subset' | 'unsupported-tags-ignored' | 'default-features';
  supportedTags: string[];
  unsupportedTags: string[];
  css: string;
}

export interface ImageTextRasterPreviewDescriptor {
  status: 'rasterized-from-retained-text' | 'missing-raster-preview';
  editableSource: 'retained-text-style';
  caveat: string;
}

export interface ImageTextNativePsdTextRoundtripDescriptor {
  status: 'limited';
  warningCode: 'native-psd-editable-text-subset';
  message: string;
}

export type ImageTextTypographyCapabilityId =
  | 'live-text-editing'
  | 'character-options'
  | 'paragraph-options'
  | 'style-package-signatures'
  | 'text-preview-signatures'
  | 'font-fallback-persistence'
  | 'installed-font-browsing'
  | 'opentype-feature-intent'
  | 'advanced-shaping'
  | 'find-replace'
  | 'readability-diagnostics'
  | 'dictionary-backed-spellcheck'
  | 'straight-segment-text-on-path'
  | 'bezier-text-on-path-editing'
  | 'vertical-type'
  | 'editable-text-warp'
  | 'native-psd-editable-text-export';

export type ImageTextTypographyCapabilityStatus = 'ready' | 'limited' | 'unsupported';

export interface ImageTextTypographyCapabilityDescriptor {
  id: ImageTextTypographyCapabilityId;
  label: string;
  status: ImageTextTypographyCapabilityStatus;
  implemented: boolean;
  blockerCode?: string;
  layerIds: string[];
  evidence: string[];
  caveats: string[];
  signature: string;
}

export interface ImageTextTypographySupportMatrixSummary {
  ready: number;
  limited: number;
  unsupported: number;
}

export interface ImageTextTypographySupportMatrixDescriptor {
  capabilities: ImageTextTypographyCapabilityDescriptor[];
  unsupportedCapabilityIds: ImageTextTypographyCapabilityId[];
  summary: ImageTextTypographySupportMatrixSummary;
  previewSignature: string;
}

export type ImageTextExportSourceBinHandoffCaveatCode =
  | 'export-flattens-live-type'
  | 'font-fallback-on-reopen'
  | 'opentype-support-on-reopen'
  | 'text-on-path-style-handoff'
  | 'flattened-text-not-recoverable';

export interface ImageTextExportSourceBinHandoffCaveat {
  code: ImageTextExportSourceBinHandoffCaveatCode;
  scope: 'export' | 'source-bin';
  layerIds: string[];
  message: string;
}

export interface ImageTextExportSourceBinHandoffRoute {
  target: 'visible-raster-export';
  preservesEditableText: boolean;
  preservesStylePackage: boolean;
  sourceBinPayload: 'flattened-preview-with-signal-loom-text-metadata';
}

export interface ImageTextExportSourceBinHandoffDescriptor {
  status: 'ready' | 'limited';
  retainedTextLayerIds: string[];
  flattenedLayerIds: string[];
  exportRoute: ImageTextExportSourceBinHandoffRoute;
  caveats: ImageTextExportSourceBinHandoffCaveat[];
  previewSignature: string;
}

export interface ImageTextLayerDescriptor {
  layerId: string;
  editable: boolean;
  rasterizedPreview: boolean;
  bitmapVersion: number;
  liveEditStatus: ImageTextLiveEditStatusDescriptor;
  previewId: string;
  previewSignature: string;
  preview: ImageTextStylePreviewDescriptor;
  warnings: string[];
  fontPersistence: ImageTextFontPersistenceDescriptor;
  fontDiscovery: ImageTextFontDiscoveryDescriptor;
  openTypeSupport: ImageTextOpenTypeSupportDescriptor;
  textOnPath: ImageTextOnPathDescriptor;
  rasterPreview: ImageTextRasterPreviewDescriptor;
  nativePsdTextRoundtrip: ImageTextNativePsdTextRoundtripDescriptor;
}

export type ImageTextWorkflowUnsupportedFeature =
  | 'live-native-font-discovery'
  | 'text-on-path'
  | 'spellcheck-dictionaries';

export interface ImageTextWorkflowUnsupportedState {
  feature: ImageTextWorkflowUnsupportedFeature;
  status: 'unsupported';
  reason: string;
}

export type ImageTextWorkflowSkippedLayerReason =
  | 'non-text-or-rasterized-layer'
  | 'missing-retained-text'
  | 'non-editable-text-metadata';

export interface ImageTextSearchableLayerSummary {
  layerId: string;
  name: string;
  contentLength: number;
  lineCount: number;
  editable: boolean;
}

export interface ImageTextWorkflowSkippedLayer {
  layerId: string;
  name: string;
  reason: ImageTextWorkflowSkippedLayerReason;
}

export interface ImageTextWorkflowLayerSummary {
  searchableTextLayers: ImageTextSearchableLayerSummary[];
  skippedLayers: ImageTextWorkflowSkippedLayer[];
  unsupportedStates: ImageTextWorkflowUnsupportedState[];
  previewSignature: string;
}

export interface ImageTextFindReplaceRequest {
  find: string;
  replace: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface ImageTextReplacementProposal {
  layerId: string;
  matchCount: number;
  originalContent: string;
  proposedContent: string;
}

export interface ImageTextFindReplacePlan extends Omit<ImageTextWorkflowLayerSummary, 'previewSignature'> {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  affectedLayerIds: string[];
  proposedReplacements: ImageTextReplacementProposal[];
  previewSignature: string;
}

export interface AppliedImageTextFindReplace {
  layers: ImageLayer[];
  plan: ImageTextFindReplacePlan;
}

export interface ImageTextReadabilitySummary {
  characterCount: number;
  wordCount: number;
  sentenceCount: number;
  averageWordsPerSentence: number;
  longestLineLength: number;
}

export interface ImageTextSpellcheckReadabilityPlan extends Omit<ImageTextWorkflowLayerSummary, 'previewSignature'> {
  affectedLayerIds: string[];
  readability: ImageTextReadabilitySummary;
  previewSignature: string;
}

export type ImageTextTypographyReadinessStatus = 'ready' | 'limited' | 'blocked';

export type ImageTextTypographyReadinessBlockerCode =
  | 'unresolved-managed-font'
  | 'missing-retained-text'
  | 'non-editable-text-metadata'
  | 'locked-layer'
  | 'empty-find-query'
  | 'no-searchable-text-layers';

export type ImageTextTypographyReadinessWarningCode =
  | 'raster-preview-only'
  | 'missing-raster-preview'
  | 'font-fallback-stack-recorded'
  | 'opentype-unsupported-tags-ignored'
  | 'opentype-feature-caveat'
  | 'text-warp-rasterized'
  | 'native-psd-editable-text-subset'
  | 'spellcheck-dictionaries-unavailable'
  | 'text-on-path-unsupported';

export interface ImageTextTypographyReadinessIssue {
  code: ImageTextTypographyReadinessBlockerCode | ImageTextTypographyReadinessWarningCode;
  scope: 'layer' | 'operation' | 'document';
  layerId?: string;
  message: string;
}

export interface ImageTextTypographyReadinessLayerDescriptor {
  layerId: string;
  name: string;
  status: ImageTextTypographyReadinessStatus;
  retainedText: boolean;
  retainedEditability: ImageTextLiveEditStatusDescriptor;
  stylePackage: SerializedImageTextStylePackage | null;
  fontPersistence: ImageTextFontPersistenceDescriptor | null;
  fontDiscovery: ImageTextFontDiscoveryDescriptor | null;
  openTypeSupport: ImageTextOpenTypeSupportDescriptor | null;
  nativePsdTextWarning: ImageTextNativePsdTextRoundtripDescriptor | null;
  blockers: ImageTextTypographyReadinessIssue[];
  warnings: ImageTextTypographyReadinessIssue[];
  previewSignature: string;
}

export interface ImageTextFindReplaceReadinessOperation {
  status: ImageTextTypographyReadinessStatus;
  affectedLayerIds: string[];
  plan: ImageTextFindReplacePlan;
  blockers: ImageTextTypographyReadinessIssue[];
  warnings: ImageTextTypographyReadinessIssue[];
  previewSignature: string;
}

export interface ImageTextSpellcheckReadabilityReadinessOperation {
  status: ImageTextTypographyReadinessStatus;
  affectedLayerIds: string[];
  readability: ImageTextReadabilitySummary;
  plan: ImageTextSpellcheckReadabilityPlan;
  blockers: ImageTextTypographyReadinessIssue[];
  warnings: ImageTextTypographyReadinessIssue[];
  previewSignature: string;
}

export interface ImageTextNativePsdTextReadinessOperation {
  status: 'limited';
  warningCode: 'native-psd-editable-text-subset';
  affectedLayerIds: string[];
  message: string;
}

export interface ImageTextTypographyReadinessOperations {
  findReplace: ImageTextFindReplaceReadinessOperation;
  spellcheckReadability: ImageTextSpellcheckReadabilityReadinessOperation;
  nativePsdText: ImageTextNativePsdTextReadinessOperation;
}

export interface ImageTextTypographyReadinessRequest {
  findReplace?: ImageTextFindReplaceRequest | null;
}

export interface ImageTextTypographyReadinessDescriptor {
  status: ImageTextTypographyReadinessStatus;
  layerReadiness: ImageTextTypographyReadinessLayerDescriptor[];
  operations: ImageTextTypographyReadinessOperations;
  blockers: ImageTextTypographyReadinessIssue[];
  warnings: ImageTextTypographyReadinessIssue[];
  previewSignature: string;
}

export type ImageTextTypographyParityCheckId =
  | 'live-edit-readiness'
  | 'font-fallback-persistence'
  | 'opentype-unsupported-states'
  | 'style-package-metadata'
  | 'text-on-path-caveats'
  | 'find-replace-planning'
  | 'spellcheck-readability-planning'
  | 'stable-signatures';

export interface ImageTextTypographyParityProgressCheck {
  id: ImageTextTypographyParityCheckId;
  label: string;
  status: ImageTextTypographyReadinessStatus;
  layerIds: string[];
  evidence: string[];
  caveats: string[];
  signature: string;
}

export interface ImageTextTypographyParityStableSignatures {
  readiness: string;
  checks: string[];
}

export interface ImageTextTypographyParityProgressDescriptor {
  status: ImageTextTypographyReadinessStatus;
  checks: ImageTextTypographyParityProgressCheck[];
  stableSignatures: ImageTextTypographyParityStableSignatures;
  previewSignature: string;
}

export const IMAGE_TEXT_STANDARD_FONT_STACKS: ImageTextStandardFontStack[] = [
  {
    id: 'inter-system',
    label: 'Inter / System UI',
    stack: 'Inter, system-ui, sans-serif',
    category: 'Sans',
  },
  {
    id: 'atkinson-hyperlegible',
    label: 'Atkinson Hyperlegible',
    stack: 'Atkinson Hyperlegible, Inter, sans-serif',
    category: 'Sans',
  },
  {
    id: 'source-serif',
    label: 'Source Serif / Georgia',
    stack: 'Source Serif 4, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'cormorant-editorial',
    label: 'Cormorant Editorial',
    stack: 'Cormorant Garamond, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'impact-display',
    label: 'Impact Display',
    stack: 'Impact, Haettenschweiler, Arial Black, sans-serif',
    category: 'Display',
  },
  {
    id: 'comic-lettering',
    label: 'Comic Lettering',
    stack: 'Komika Axis, Bangers, Impact, sans-serif',
    category: 'Comic',
  },
  {
    id: 'mono-code',
    label: 'JetBrains Mono',
    stack: 'JetBrains Mono, SFMono-Regular, Consolas, monospace',
    category: 'Mono',
  },
];

export const IMAGE_TEXT_VISIBLE_OPENTYPE_FEATURES: ImageTextVisibleOpenTypeFeature[] = [
  {
    tag: 'liga',
    label: 'Ligatures',
    ariaLabel: 'ligatures',
    description: 'Standard ligature substitution.',
  },
  {
    tag: 'kern',
    label: 'Kerning',
    ariaLabel: 'kerning',
    description: 'Font kerning pair adjustment.',
  },
  {
    tag: 'dlig',
    label: 'Discretionary',
    ariaLabel: 'discretionary ligatures',
    description: 'Optional discretionary ligatures.',
  },
  {
    tag: 'salt',
    label: 'Alternates',
    ariaLabel: 'stylistic alternates',
    description: 'Stylistic alternate glyphs.',
  },
  {
    tag: 'swsh',
    label: 'Swash',
    ariaLabel: 'swash',
    description: 'Swash forms where the font supports them.',
  },
  {
    tag: 'ss01',
    label: 'Set 1',
    ariaLabel: 'stylistic set 1',
    description: 'Stylistic set 1.',
  },
];

export const DEFAULT_IMAGE_TEXT_STYLE: ImageTextLayerStyle = {
  content: '',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 48,
  fontWeight: '400',
  fontStyle: 'normal',
  fontKerning: 'auto',
  fontVariantCaps: 'normal',
  letterSpacing: 0,
  baselineShift: 0,
  boxWidth: null,
  boxHeight: null,
  wrap: true,
  color: '#ffffff',
  lineHeight: 1.15,
  align: 'left',
  verticalAlign: 'top',
  warp: 'none',
};

const MAX_IMAGE_TEXT_PATH_DIMENSION = 4096;
const MAX_IMAGE_TEXT_PATH_SEGMENTS = 64;
const MAX_IMAGE_TEXT_PATH_POINTS = 8192;

export function normalizeImageTextStyle(
  patch: Partial<ImageTextLayerStyle> = {},
): ImageTextLayerStyle {
  const initialManagedFaceState = normalizeBundledFontFaceState(patch.managedFace, patch.managedFaceIssue);
  const fontSize = clampNumber(patch.fontSize, 4, 512, DEFAULT_IMAGE_TEXT_STYLE.fontSize);
  const lineHeight = clampNumber(patch.lineHeight, 0.75, 3, DEFAULT_IMAGE_TEXT_STYLE.lineHeight);
  const letterSpacing = clampNumber(patch.letterSpacing, -20, 100, DEFAULT_IMAGE_TEXT_STYLE.letterSpacing);
  const baselineShift = clampNumber(patch.baselineShift, -256, 256, DEFAULT_IMAGE_TEXT_STYLE.baselineShift);
  const boxWidth = normalizeOptionalDimension(patch.boxWidth, 1, 4096);
  const boxHeight = normalizeOptionalDimension(patch.boxHeight, 1, 4096);
  const openTypeFeatures = patch.openTypeFeatures
    ? normalizeImageTextOpenTypeFeatures(patch.openTypeFeatures)
    : undefined;
  const orientation = normalizeImageTextOrientation(patch.orientation);

  const style: ImageTextLayerStyle = {
    content: (patch.content ?? DEFAULT_IMAGE_TEXT_STYLE.content).trim(),
    fontFamily: patch.fontFamily?.trim() || DEFAULT_IMAGE_TEXT_STYLE.fontFamily,
    fontSize,
    fontWeight: patch.fontWeight?.trim() || DEFAULT_IMAGE_TEXT_STYLE.fontWeight,
    fontStyle: patch.fontStyle === 'italic' || (patch.fontStyle === 'oblique' && initialManagedFaceState.managedFace?.style === 'oblique')
      ? patch.fontStyle
      : 'normal',
    fontKerning: normalizeFontKerning(patch.fontKerning),
    fontVariantCaps: normalizeFontVariantCaps(patch.fontVariantCaps),
    letterSpacing,
    baselineShift,
    boxWidth,
    boxHeight,
    wrap: patch.wrap ?? DEFAULT_IMAGE_TEXT_STYLE.wrap,
    color: patch.color?.trim() || DEFAULT_IMAGE_TEXT_STYLE.color,
    lineHeight,
    align: patch.align ?? DEFAULT_IMAGE_TEXT_STYLE.align,
    verticalAlign: patch.verticalAlign ?? DEFAULT_IMAGE_TEXT_STYLE.verticalAlign,
    warp: normalizeImageTextWarp(patch.warp),
  };
  if (orientation !== 'horizontal') {
    style.orientation = orientation;
  }
  if (openTypeFeatures) {
    style.openTypeFeatures = openTypeFeatures;
  }
  const managedFaceState = normalizeBundledFontFaceStateForTypography(patch.managedFace, patch.managedFaceIssue, {
    family: style.fontFamily,
    weight: style.fontWeight,
    style: style.fontStyle,
  });
  Object.assign(style, managedFaceState);
  if (Object.prototype.hasOwnProperty.call(patch, 'pathReference')) {
    style.pathReference = patch.pathReference ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'pathLayout')) {
    style.pathLayout = normalizeImageTextPathLayout(patch.pathLayout ?? null);
  }
  return style;
}

export function imageTextCanvasFont(style: Pick<ImageTextLayerStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'fontVariantCaps' | 'managedFace' | 'managedFaceIssue'>): string {
  // Canvas font shorthand accepts `small-caps` but not `all-small-caps`. The latter is applied
  // through the CanvasRenderingContext2D `fontVariantCaps` property after the font shorthand is set
  // so the retained text content stays unchanged.
  const shorthandVariant = style.fontVariantCaps === 'small-caps' ? 'small-caps' : undefined;
  const caps = shorthandVariant ? `${shorthandVariant} ` : '';
  const family = style.managedFace
    ? bundledFontFaceRuntimeFamilyName(style.managedFace)
    : style.managedFaceIssue
      ? 'Sloom Managed Face Blocked'
      : style.fontFamily;
  const fontStyle = style.managedFace ? bundledFontFaceStyleDescriptor(style.managedFace) : style.fontStyle;
  return `${fontStyle} ${caps}${style.fontWeight} ${style.fontSize}px ${formatFontFamily(family)}`;
}



function normalizeImageTextPathLayout(layout: TextLayerPathLayout | null | undefined): TextLayerPathLayout | null {
  if (!layout || !Array.isArray(layout.points) || layout.points.length < 2) return null;
  if (layout.points.length > MAX_IMAGE_TEXT_PATH_POINTS) return null;
  const bezierSegments = normalizeTextLayerBezierSegments(layout.bezierSegments);
  if (!bezierSegments) return null;
  const geometry = bezierSegments.length > 0 || layout.geometry === 'bezier-sampled-path'
    ? 'bezier-sampled-path'
    : 'straight-segment-path';
  if (!layout.points.every(isFinitePoint)) return null;
  const points = layout.points.map(roundPoint);
  const pathLength = Math.max(0, roundToTwoDecimals(measurePathLength(points, Boolean(layout.closed))));
  if (pathLength <= 0) return null;
  const geometryBounds = measurePointBounds(points);
  const suppliedBounds = layout.bounds;
  if (suppliedBounds && (
    !Number.isFinite(suppliedBounds.x)
    || !Number.isFinite(suppliedBounds.y)
    || !Number.isFinite(suppliedBounds.width)
    || !Number.isFinite(suppliedBounds.height)
    || suppliedBounds.width <= 0
    || suppliedBounds.height <= 0
  )) return null;
  const width = Math.max(1, Math.ceil(geometryBounds.width));
  const height = Math.max(1, Math.ceil(geometryBounds.height));
  if (width > MAX_IMAGE_TEXT_PATH_DIMENSION || height > MAX_IMAGE_TEXT_PATH_DIMENSION) return null;
  const startOffset = clampNumber(layout.startOffset, 0, Math.max(0, pathLength), 0);
  const reverse = Boolean(layout.reverse);
  const normalizedBounds = {
    x: Math.floor(geometryBounds.x),
    y: Math.floor(geometryBounds.y),
    width,
    height,
  };
  const previewSignature = `text-path-layout:v1:${JSON.stringify({
      sourceLayerId: layout.sourceLayerId ?? null,
      geometry,
      points,
      bezierSegments,
      closed: Boolean(layout.closed),
      startOffset,
      reverse,
      bounds: normalizedBounds,
  })}`;

  return {
    sourceLayerId: layout.sourceLayerId,
    geometry,
    points,
    ...(bezierSegments.length > 0 ? { bezierSegments } : {}),
    closed: Boolean(layout.closed),
    startOffset,
    reverse,
    pathLength,
    bounds: normalizedBounds,
    previewSignature,
  };
}

function normalizeTextLayerBezierSegments(
  segments: TextLayerBezierSegment[] | undefined,
): TextLayerBezierSegment[] | null {
  if (segments === undefined) return [];
  if (!Array.isArray(segments) || segments.length > MAX_IMAGE_TEXT_PATH_SEGMENTS) return null;
  if (!segments.every((segment) => (
    isFinitePoint(segment.from)
    && isFinitePoint(segment.control1)
    && isFinitePoint(segment.control2)
    && isFinitePoint(segment.to)
  ))) return null;
  return segments.map((segment) => ({
      from: roundPoint(segment.from),
      control1: roundPoint(segment.control1),
      control2: roundPoint(segment.control2),
      to: roundPoint(segment.to),
    }));
}

export function buildImageTextBezierPathLayout({
  sourceLayerId,
  segments,
  samples = 24,
  closed = false,
  startOffset = 0,
  reverse = false,
}: {
  sourceLayerId?: string;
  segments: TextLayerBezierSegment[];
  samples?: number;
  closed?: boolean;
  startOffset?: number;
  reverse?: boolean;
}): TextLayerPathLayout | null {
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_IMAGE_TEXT_PATH_SEGMENTS) return null;
  const normalizedSegments = normalizeTextLayerBezierSegments(segments);
  if (!normalizedSegments || normalizedSegments.length !== segments.length) return null;
  const sampleCount = Math.max(2, Math.min(96, Math.round(Number.isFinite(samples) ? samples : 24)));
  const points = sampleBezierSegments(normalizedSegments, sampleCount);
  if (points.length < 2) return null;
  const bounds = measurePointBounds(points);
  const pathLength = roundToTwoDecimals(measurePathLength(points, closed));
  return normalizeImageTextPathLayout({
    sourceLayerId,
    geometry: 'bezier-sampled-path',
    points,
    bezierSegments: normalizedSegments,
    closed,
    startOffset,
    reverse,
    pathLength,
    bounds,
    previewSignature: '',
  });
}

export function normalizeImageTextOpenTypeFeatures(
  descriptor: Partial<ImageTextOpenTypeFeatureDescriptor> | null | undefined = {},
): ImageTextOpenTypeFeatureDescriptor {
  const source = descriptor ?? {};
  const disabledResult = normalizeOpenTypeFeatureTagList(source.disabled);
  const enabledResult = normalizeOpenTypeFeatureTagList(source.enabled);
  const unsupportedResult = normalizeOpenTypeFeatureTagList(source.unsupported);
  const disabled = disabledResult.supported;
  const enabled = enabledResult.supported.filter((tag) => !disabled.includes(tag));
  const unsupported = [...new Set([
    ...enabledResult.unsupported,
    ...disabledResult.unsupported,
    ...unsupportedResult.supported,
    ...unsupportedResult.unsupported,
  ])].sort();

  return {
    enabled,
    disabled,
    unsupported,
  };
}

export function toggleImageTextOpenTypeFeature(
  descriptor: Partial<TextLayerOpenTypeFeatures> | null | undefined,
  tag: string,
  active: boolean,
): TextLayerOpenTypeFeatures {
  const normalizedTag = normalizeOpenTypeFeatureTagList([tag]).supported[0];
  const current = normalizeImageTextOpenTypeFeatures(descriptor);
  if (!normalizedTag) return current;
  const enabled = new Set(current.enabled);
  const disabled = new Set(current.disabled);
  if (active) {
    enabled.add(normalizedTag);
    disabled.delete(normalizedTag);
  } else {
    enabled.delete(normalizedTag);
    disabled.add(normalizedTag);
  }
  return normalizeImageTextOpenTypeFeatures({
    enabled: [...enabled],
    disabled: [...disabled],
    unsupported: current.unsupported,
  });
}

export function serializeImageTextCharacterStyle(
  style: ImageTextLayerStyle,
  features?: Partial<ImageTextOpenTypeFeatureDescriptor> | null,
): ImageTextCharacterStyleDescriptor {
  const openTypeFeatures = serializeImageTextOpenTypeFeatures(
    features ?? style.openTypeFeatures ?? inferImageTextOpenTypeFeatures(style),
  );

  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontKerning: style.fontKerning,
    fontVariantCaps: style.fontVariantCaps,
    letterSpacing: style.letterSpacing,
    baselineShift: style.baselineShift,
    openTypeFeatures,
  };
}

export function serializeImageTextStylePackage(
  style: ImageTextLayerStyle,
  features?: Partial<ImageTextOpenTypeFeatureDescriptor> | null,
): SerializedImageTextStylePackage {
  const characterStyle = serializeImageTextCharacterStyle(style, features);
  const paragraphStyle = serializeImageTextParagraphStyle(style);
  const warnings = buildImageTextStyleSerializationWarnings(style, characterStyle.openTypeFeatures);

  return {
    characterStyle,
    paragraphStyle,
    warnings,
    preview: buildImageTextStylePreview(style, characterStyle.openTypeFeatures),
  };
}

export function serializeImageTextParagraphStyle(
  style: ImageTextLayerStyle,
): ImageTextParagraphStyleDescriptor {
  const paragraphStyle: ImageTextParagraphStyleDescriptor = {
    align: style.align,
    lineHeight: style.lineHeight,
    verticalAlign: style.verticalAlign,
    wrap: style.wrap,
    boxWidth: style.boxWidth,
    boxHeight: style.boxHeight,
  };
  const orientation = normalizeImageTextOrientation(style.orientation);
  if (orientation !== 'horizontal') paragraphStyle.orientation = orientation;
  return paragraphStyle;
}

export function planImageTextOnPath(
  request: ImageTextOnPathPlanRequest = {},
): ImageTextOnPathDescriptor {
  const hasExplicitPathReference = Object.prototype.hasOwnProperty.call(request, 'pathReference');
  const pathReference = hasExplicitPathReference
    ? request.pathReference ?? null
    : null;
  const pathLayout = normalizeImageTextPathLayout(request.pathLayout ?? null);

  if (pathReference && pathLayout && pathLayout.points.length >= 2) {
    const geometry = pathLayout.geometry ?? 'straight-segment-path';
    return {
      status: 'ready',
      feature: 'text-on-path',
      textLayerId: request.textLayerId ?? null,
      pathLayerId: request.pathLayerId ?? pathReference.layerId ?? pathLayout.sourceLayerId ?? null,
      pathReference,
      startOffset: pathLayout.startOffset,
      reverse: pathLayout.reverse,
      geometry,
      editableSource: 'retained-text-and-vector-path-reference',
      pathLength: pathLayout.pathLength,
      pointCount: pathLayout.points.length,
      nativePsdRoundtrip: 'unsupported',
      previewSignature: `image-text-on-path:v1:${JSON.stringify({
        textLayerId: request.textLayerId ?? null,
        pathLayerId: request.pathLayerId ?? pathReference.layerId ?? pathLayout.sourceLayerId ?? null,
        pathSignature: pathLayout.previewSignature,
      })}`,
      warnings: [
        'native-psd-text-on-path-export-unsupported',
        ...(geometry === 'bezier-sampled-path' ? ['curved-bezier-text-on-path-available-through-sampled-layouts'] : []),
      ],
    };
  }

  return {
    status: 'unsupported',
    feature: 'text-on-path',
    textLayerId: request.textLayerId ?? null,
    pathLayerId: request.pathLayerId ?? pathReference?.layerId ?? null,
    pathReference,
    startOffset: Number.isFinite(request.startOffset) ? request.startOffset ?? 0 : 0,
    reverse: request.reverse ?? false,
    fallback: 'retain point text metadata and rasterize current glyph layout',
    requiredMetadata: ['textLayerId', 'pathReference.kind', 'pathReference.layerId'],
    reason: 'Sloom Studio does not support editable text-on-path layers yet.',
    warnings: [
      'Editable text-on-path is not available; preserve the path reference so a future text engine can restore intent.',
    ],
  };
}

export function describeUnsupportedImageTextOnPath(
  request: ImageTextOnPathPlanRequest = {},
): UnsupportedImageTextOnPathDescriptor {
  const hasExplicitPathReference = Object.prototype.hasOwnProperty.call(request, 'pathReference');
  const pathReference = hasExplicitPathReference
    ? request.pathReference ?? null
    : null;

  return {
    status: 'unsupported',
    feature: 'text-on-path',
    textLayerId: request.textLayerId ?? null,
    pathLayerId: request.pathLayerId ?? pathReference?.layerId ?? null,
    pathReference,
    startOffset: Number.isFinite(request.startOffset) ? request.startOffset ?? 0 : 0,
    reverse: request.reverse ?? false,
    fallback: 'retain point text metadata and rasterize current glyph layout',
    requiredMetadata: ['textLayerId', 'pathReference.kind', 'pathReference.layerId'],
    reason: 'Sloom Studio does not support editable text-on-path layers yet.',
    warnings: [
      'Editable text-on-path is not available; preserve the path reference so a future text engine can restore intent.',
    ],
  };
}

export function describeImageTextFontPersistence(fontFamily: string): ImageTextFontPersistenceDescriptor {
  const families = splitFontFamilyStack(fontFamily);
  const preferredFamily = families[0] ?? fontFamily.trim();

  return {
    requestedFamily: fontFamily,
    preferredFamily,
    fallbackFamilies: families.slice(1),
    discoveryStatus: 'fallback-stack-recorded',
    fallbackStatus: families.length > 1 ? 'fallbacks-available' : 'no-fallbacks-declared',
    persistenceNote: 'Persist the full font-family stack; browser canvas may render with the first installed fallback.',
  };
}

export function describeImageTextFontCatalog(fontFamily: string): ImageTextFontCatalogDescriptor {
  const requestedFamily = fontFamily.trim();
  const standardStacks = IMAGE_TEXT_STANDARD_FONT_STACKS.map((stack) => ({
    ...stack,
    selected: normalizeFontStackForComparison(stack.stack) === normalizeFontStackForComparison(requestedFamily),
  }));
  const selectedStack = standardStacks.find((stack) => stack.selected) ?? null;
  return {
    requestedFamily,
    selectedStack,
    standardStacks,
    customFamily: selectedStack ? null : requestedFamily,
  };
}

export function describeImageTextInstalledFontBrowser(
  fontFamily: string,
  installedFonts: ImageTextInstalledFontEntry[] = [],
): ImageTextInstalledFontBrowserDescriptor {
  const requestedFamily = fontFamily.trim();
  const requestedFamilies = splitFontFamilyStack(requestedFamily).map((family) => normalizeFontStackForComparison(family));
  const normalizedInstalled = dedupeInstalledFonts(installedFonts);
  const selectedFamilyAvailable = normalizedInstalled.some((font) => (
    requestedFamilies.includes(normalizeFontStackForComparison(font.family))
    || requestedFamilies.includes(normalizeFontStackForComparison(font.fullName ?? ''))
    || requestedFamilies.includes(normalizeFontStackForComparison(font.postscriptName ?? ''))
  ));
  const catalog = describeImageTextFontCatalog(requestedFamily);
  const source = normalizedInstalled.length > 0
    ? 'local-font-access-api-or-injected-font-list'
    : 'standard-stack-fallback';
  const browserEntries = normalizedInstalled.map((font) => ({
    ...font,
    selected: requestedFamilies.includes(normalizeFontStackForComparison(font.family)),
  }));

  return {
    supported: true,
    source,
    requestedFamily,
    selectedFamilyAvailable,
    installedFonts: normalizedInstalled,
    browserEntries,
    standardStacks: catalog.standardStacks,
    signature: `image-text-installed-font-browser:v1:${JSON.stringify({
      requestedFamily,
      source,
      selectedFamilyAvailable,
      installedFonts: normalizedInstalled.map((font) => [
        font.family,
        font.fullName ?? null,
        font.postscriptName ?? null,
        font.style ?? null,
      ]),
      selectedStack: catalog.selectedStack?.id ?? null,
    })}`,
  };
}

export function describeImageTextAdvancedTypographySupport(
  layers: ImageLayer[] = [],
  options: {
    selectedFontFamily?: string;
    installedFonts?: ImageTextInstalledFontEntry[];
    dictionary?: string[];
  } = {},
): ImageTextAdvancedTypographySupportDescriptor {
  const selectedFontFamily = options.selectedFontFamily
    ?? layers.find((layer) => layer.text)?.text?.fontFamily
    ?? DEFAULT_IMAGE_TEXT_STYLE.fontFamily;
  const fontBrowser = describeImageTextInstalledFontBrowser(selectedFontFamily, options.installedFonts ?? []);
  const spellcheck = planImageTextDictionarySpellcheck(layers, { dictionary: options.dictionary });
  const retainedText = layers
    .filter((layer) => layer.text)
    .map((layer) => layer.text!);
  const graphemeClusterCount = retainedText.reduce((sum, style) => (
    sum + segmentTextGraphemes(style.content).length
  ), 0);
  const bidiRuns = dedupeBidiRuns(retainedText.flatMap((style) => detectBidiRuns(style.content)));
  const openTypeCss = retainedText
    .map((style) => serializeImageTextStylePackage(style).characterStyle.openTypeFeatures.css)
    .filter((css, index, all) => css && all.indexOf(css) === index);
  const verticalLayerIds = layers
    .filter((layer) => layer.text && isVerticalImageTextStyle(layer.text))
    .map((layer) => layer.id);
  const verticalOrientations = [...new Set(layers
    .map((layer) => normalizeImageTextOrientation(layer.text?.orientation))
    .filter((orientation) => orientation !== 'horizontal'))];
  const bezierPathLayers = layers
    .filter((layer) => layer.text?.pathLayout?.geometry === 'bezier-sampled-path')
    .map((layer) => layer.id);
  const sampledPathSignatures = layers
    .map((layer) => layer.text?.pathLayout)
    .filter((layout): layout is TextLayerPathLayout => Boolean(layout?.geometry === 'bezier-sampled-path'))
    .map((layout) => layout.previewSignature);
  const warpedLayerIds = layers
    .filter((layer) => layer.text?.warp && layer.text.warp !== 'none')
    .map((layer) => layer.id);
  const warpModes = [...new Set(layers
    .map((layer) => layer.text?.warp)
    .filter((warp): warp is Exclude<ImageTextLayerStyle['warp'], 'none'> => Boolean(warp && warp !== 'none')))];

  return {
    descriptorId: 'image-text-advanced-typography-support:v1',
    version: 1,
    deterministic: true,
    installedFonts: {
      supported: true,
      source: fontBrowser.source,
      selectedFamilyAvailable: fontBrowser.selectedFamilyAvailable,
      installedFonts: fontBrowser.installedFonts,
    },
    fontBrowser,
    dictionarySpellcheck: {
      supported: true,
      status: spellcheck.status,
      dictionarySize: spellcheck.dictionarySize,
      misspellingCount: spellcheck.misspellings.length,
      misspellings: spellcheck.misspellings,
    },
    advancedShaping: {
      supported: true,
      engine: 'browser-canvas-intl-segmenter',
      graphemeClusterCount,
      bidiRuns,
      openTypeCss,
    },
    verticalType: {
      supported: true,
      layerIds: verticalLayerIds,
      orientations: verticalOrientations,
    },
    bezierTextOnPath: {
      supported: true,
      layerIds: bezierPathLayers,
      sampledPathSignatures,
    },
    editableTextWarp: {
      supported: true,
      layerIds: warpedLayerIds,
      warpModes,
    },
    signature: `image-text-advanced-typography-support:v1:${JSON.stringify({
      selectedFontFamily,
      fontBrowser: fontBrowser.signature,
      spellcheck: spellcheck.previewSignature,
      graphemeClusterCount,
      bidiRuns,
      verticalLayerIds,
      bezierPathLayers,
      warpedLayerIds,
    })}`,
  };
}

export function buildImageTextLayerDescriptor(layer: ImageLayer): ImageTextLayerDescriptor | null {
  if (!layer.text) return null;
  const stylePackage = serializeImageTextStylePackage(layer.text);
  const rasterizedPreview = layer.bitmap !== null;
  const editable = layer.metadata?.editableText ?? layer.type === 'text';
  const warnings = rasterizedPreview
    ? [
        'Canvas raster preview is regenerated from retained text metadata; exported pixels may not preserve live type editability.',
      ]
    : [
        'Text metadata is retained but no raster preview bitmap is currently attached.',
      ];
  if (layer.text.pathLayout && layer.text.pathReference) {
    warnings.push(
      layer.text.pathLayout.geometry === 'bezier-sampled-path'
        ? 'Text follows a retained cubic Bezier vector path; native PSD editable text-on-path export is still unsupported.'
        : 'Text follows a retained straight-segment vector path; native PSD editable text-on-path export is still unsupported.',
    );
  }
  const styleSignature = stylePackage.preview.signature;
  const fontPersistence = describeImageTextFontPersistence(layer.text.fontFamily);
  const previewSignature = `image-text-layer:v1:${JSON.stringify({
    layerId: layer.id,
    bitmapVersion: layer.bitmapVersion,
    styleSignature,
    rasterizedPreview,
    editable,
  })}`;

  return {
    layerId: layer.id,
    editable,
    rasterizedPreview,
    bitmapVersion: layer.bitmapVersion,
    liveEditStatus: buildImageTextLiveEditStatusDescriptor(editable),
    previewId: `image-text-layer:${layer.id}`,
    previewSignature,
    preview: {
      ...stylePackage.preview,
      previewId: `image-text-style:${layer.id}`,
      signature: `text-layer:${layer.id}:v${layer.bitmapVersion}:${stylePackage.preview.signature}`,
    },
    warnings,
    fontPersistence,
    fontDiscovery: buildImageTextFontDiscoveryDescriptor(fontPersistence),
    openTypeSupport: buildImageTextOpenTypeSupportDescriptor(stylePackage.characterStyle.openTypeFeatures),
    textOnPath: planImageTextOnPath({
      textLayerId: layer.id,
      pathLayerId: layer.text.pathReference?.layerId ?? layer.text.pathLayout?.sourceLayerId ?? null,
      pathReference: layer.text.pathReference ?? null,
      pathLayout: layer.text.pathLayout ?? null,
    }),
    rasterPreview: buildImageTextRasterPreviewDescriptor(rasterizedPreview),
    nativePsdTextRoundtrip: buildNativePsdTextRoundtripDescriptor(),
  };
}

export function describeImageTextTypographyReadiness(
  layers: ImageLayer[],
  request: ImageTextTypographyReadinessRequest = {},
): ImageTextTypographyReadinessDescriptor {
  const layerReadiness = layers.map((layer) => buildImageTextTypographyReadinessLayerDescriptor(layer));
  const findReplace = buildImageTextFindReplaceReadinessOperation(layers, request.findReplace ?? null);
  const spellcheckReadability = buildImageTextSpellcheckReadabilityReadinessOperation(layers);
  const nativePsdText = buildImageTextNativePsdTextReadinessOperation(layerReadiness);
  const operations = {
    findReplace,
    spellcheckReadability,
    nativePsdText,
  };
  const blockers = [
    ...layerReadiness.flatMap((layer) => layer.blockers),
    ...findReplace.blockers,
    ...spellcheckReadability.blockers,
  ];
  const warnings = [
    ...layerReadiness.flatMap((layer) => layer.warnings),
    ...findReplace.warnings,
    ...spellcheckReadability.warnings,
  ];
  const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'limited' : 'ready';

  return {
    status,
    layerReadiness,
    operations,
    blockers,
    warnings,
    previewSignature: `image-text-typography-readiness:v1:${JSON.stringify({
      status,
      layerStatuses: layerReadiness.map((layer) => [layer.layerId, layer.status]),
      blockerCodes: blockers.map((blocker) => blocker.code),
      warningCodes: warnings.map((warning) => warning.code),
      findReplace: findReplace.previewSignature,
      spellcheckReadability: spellcheckReadability.previewSignature,
    })}`,
  };
}

export function describeImageTextTypographyParityProgress(
  layers: ImageLayer[],
  request: ImageTextTypographyReadinessRequest = {},
): ImageTextTypographyParityProgressDescriptor {
  const readiness = describeImageTextTypographyReadiness(layers, request);
  const checks = buildImageTextTypographyParityProgressChecks(layers, readiness);
  const status = summarizeImageTextTypographyCheckStatuses(checks);
  const stableSignatures = {
    readiness: readiness.previewSignature,
    checks: checks.map((check) => check.signature),
  };

  return {
    status,
    checks,
    stableSignatures,
    previewSignature: `image-text-typography-parity-progress:v1:${JSON.stringify({
      status,
      checkStatuses: checks.map((check) => [check.id, check.status]),
      readinessSignature: readiness.previewSignature,
      checkSignatures: stableSignatures.checks,
    })}`,
  };
}

export function describeImageTextTypographySupportMatrix(
  layers: ImageLayer[] = [],
): ImageTextTypographySupportMatrixDescriptor {
  const retainedTextLayerIds = layers
    .filter((layer) => Boolean(layer.text))
    .map((layer) => layer.id);
  const editableTextLayerIds = layers
    .filter((layer) => Boolean(layer.text) && (layer.metadata?.editableText ?? layer.type === 'text') && !layer.locked)
    .map((layer) => layer.id);
  const pathTextLayerIds = layers
    .filter((layer) => Boolean(layer.text?.pathReference && layer.text.pathLayout))
    .map((layer) => layer.id);
  const bezierPathTextLayerIds = layers
    .filter((layer) => layer.text?.pathLayout?.geometry === 'bezier-sampled-path')
    .map((layer) => layer.id);
  const fontFallbackLayerIds = layers
    .filter((layer) => layer.text && splitFontFamilyStack(layer.text.fontFamily).length > 1)
    .map((layer) => layer.id);
  const openTypeLayerIds = layers
    .filter((layer) => {
      if (!layer.text) return false;
      const features = serializeImageTextStylePackage(layer.text).characterStyle.openTypeFeatures;
      return features.enabled.length > 0 || features.disabled.length > 0 || Boolean(features.unsupported?.length);
    })
    .map((layer) => layer.id);
  const warpedLayerIds = layers
    .filter((layer) => layer.text?.warp && layer.text.warp !== 'none')
    .map((layer) => layer.id);
  const verticalLayerIds = layers
    .filter((layer) => layer.text && isVerticalImageTextStyle(layer.text))
    .map((layer) => layer.id);
  const advancedSupport = describeImageTextAdvancedTypographySupport(layers);

  const capabilities = [
    createImageTextTypographyCapability({
      id: 'live-text-editing',
      label: 'Live text editing',
      status: 'ready',
      implemented: true,
      layerIds: editableTextLayerIds,
      evidence: [`Editable retained layers: ${editableTextLayerIds.join(', ') || 'none in current selection'}`],
      caveats: ['Live edits mutate Sloom Studio metadata and regenerate raster previews, not native PSD text records.'],
    }),
    createImageTextTypographyCapability({
      id: 'character-options',
      label: 'Character options',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: ['Font family, size, weight, style, kerning, caps, tracking, baseline, color, and OpenType intent are typed.'],
      caveats: ['Glyph metrics still depend on the resolved browser canvas font.'],
    }),
    createImageTextTypographyCapability({
      id: 'paragraph-options',
      label: 'Paragraph options',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: ['Alignment, leading, wrapping, box dimensions, and vertical alignment are typed.'],
      caveats: ['Justified text is retained as intent; canvas preview uses bounded line placement.'],
    }),
    createImageTextTypographyCapability({
      id: 'style-package-signatures',
      label: 'Style package signatures',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: retainedTextLayerIds.length
        ? layers
            .filter((layer) => layer.text)
            .map((layer) => `${layer.id}: ${buildImageTextStylePackageSignature(layer.text!)}`)
        : ['No retained text layers in current selection.'],
      caveats: ['Signatures describe Sloom Studio metadata packages, not native PSD text resources.'],
    }),
    createImageTextTypographyCapability({
      id: 'text-preview-signatures',
      label: 'Text preview signatures',
      status: 'limited',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: retainedTextLayerIds.length
        ? layers
            .filter((layer) => layer.text)
            .map((layer) => `${layer.id}: ${serializeImageTextStylePackage(layer.text!).preview.signature}`)
        : ['No retained text preview signatures in current selection.'],
      caveats: ['Preview signatures track deterministic text metadata, not pixel-perfect native font rendering.'],
    }),
    createImageTextTypographyCapability({
      id: 'font-fallback-persistence',
      label: 'Font fallback persistence',
      status: 'limited',
      implemented: true,
      layerIds: fontFallbackLayerIds,
      evidence: fontFallbackLayerIds.length
        ? layers
            .filter((layer) => layer.text && fontFallbackLayerIds.includes(layer.id))
            .map((layer) => `${layer.id}: ${buildImageTextFontFallbackSignature(describeImageTextFontPersistence(layer.text!.fontFamily))}`)
        : ['Font-family stacks are persisted even when no fallback is declared.'],
      caveats: ['Installed-font availability is not discovered; browser canvas resolves the first available fallback.'],
    }),
    createImageTextTypographyCapability({
      id: 'installed-font-browsing',
      label: 'Installed font browsing',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: [
        `Font browser source: ${advancedSupport.fontBrowser.source}`,
        `Standard stacks: ${advancedSupport.fontBrowser.standardStacks.map((font) => font.label).join(', ')}`,
      ],
      caveats: advancedSupport.fontBrowser.source === 'standard-stack-fallback'
        ? ['Local Font Access is optional; standard stack fallback remains available when native font enumeration is unavailable.']
        : [],
    }),
    createImageTextTypographyCapability({
      id: 'opentype-feature-intent',
      label: 'OpenType feature intent',
      status: 'limited',
      implemented: true,
      layerIds: openTypeLayerIds,
      evidence: openTypeLayerIds.length
        ? [`OpenType metadata layers: ${openTypeLayerIds.join(', ')}`]
        : ['Default OpenType feature state is serializable.'],
      caveats: ['OpenType feature tags are serialized, but advanced shaping and glyph availability depend on the resolved font/browser engine.'],
    }),
    createImageTextTypographyCapability({
      id: 'advanced-shaping',
      label: 'Advanced shaping',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: [
        `Grapheme clusters: ${advancedSupport.advancedShaping.graphemeClusterCount}`,
        `Bidi runs: ${advancedSupport.advancedShaping.bidiRuns.join(', ') || 'none'}`,
      ],
      caveats: ['Canvas/browser text shaping is used for glyph shaping; native HarfBuzz/CoreText/DirectWrite internals are not exposed directly.'],
    }),
    createImageTextTypographyCapability({
      id: 'find-replace',
      label: 'Find and replace',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: ['Retained editable text layers can be searched and updated through a pure planning helper.'],
      caveats: ['Flattened lettering without retained text metadata is skipped.'],
    }),
    createImageTextTypographyCapability({
      id: 'readability-diagnostics',
      label: 'Readability diagnostics',
      status: 'limited',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: ['Character, word, sentence, average words per sentence, and longest line metrics are deterministic.'],
      caveats: ['Diagnostics do not include dictionary-backed spelling, grammar, language detection, or hyphenation.'],
    }),
    createImageTextTypographyCapability({
      id: 'dictionary-backed-spellcheck',
      label: 'Dictionary-backed spellcheck',
      status: 'ready',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: [
        `Dictionary size: ${advancedSupport.dictionarySpellcheck.dictionarySize}`,
        `Misspellings: ${advancedSupport.dictionarySpellcheck.misspellingCount}`,
      ],
      caveats: ['Bundled dictionary coverage is intentionally compact and can be extended by injecting a larger dictionary.'],
    }),
    createImageTextTypographyCapability({
      id: 'straight-segment-text-on-path',
      label: 'Straight-segment text on path',
      status: 'limited',
      implemented: true,
      layerIds: pathTextLayerIds,
      evidence: pathTextLayerIds.length
        ? [`Retained straight-segment path text layers: ${pathTextLayerIds.join(', ')}`]
        : ['Straight-segment path metadata can be retained when attached to a vector path.'],
      caveats: ['Current glyph layout exports as pixels; native editable text-on-path export is unsupported.'],
    }),
    createImageTextTypographyCapability({
      id: 'bezier-text-on-path-editing',
      label: 'Bezier text-on-path editing',
      status: 'ready',
      implemented: true,
      layerIds: bezierPathTextLayerIds,
      evidence: bezierPathTextLayerIds.length
        ? [`Bezier sampled text paths: ${bezierPathTextLayerIds.join(', ')}`]
        : ['Cubic Bezier text paths can be sampled into retained editable path-layout metadata.'],
      caveats: ['Bezier controls are retained as metadata and rasterized through sampled path points for canvas preview/export.'],
    }),
    createImageTextTypographyCapability({
      id: 'vertical-type',
      label: 'Vertical type',
      status: 'ready',
      implemented: true,
      layerIds: verticalLayerIds,
      evidence: verticalLayerIds.length
        ? [`Vertical text layers: ${verticalLayerIds.join(', ')}`]
        : ['Vertical right-to-left and left-to-right orientation metadata, explicit columns, box-height wrapping, and raster bounds are supported by the rasterizer and controls.'],
      caveats: [
        'Vertical raster type preserves Unicode grapheme order but does not claim Japanese vertical glyph substitutions, kinsoku, tate-chu-yoko, or native PSD editable text.',
      ],
    }),
    createImageTextTypographyCapability({
      id: 'editable-text-warp',
      label: 'Editable text warp',
      status: 'ready',
      implemented: true,
      layerIds: warpedLayerIds,
      evidence: warpedLayerIds.length
        ? [`Editable warp metadata layers: ${warpedLayerIds.join(', ')}`]
        : ['Arc, flag, and bulge warp choices are retained as editable text metadata and rerasterized on change.'],
      caveats: ['Warp preview/export is rasterized and does not claim native Photoshop vector warp mesh parity.'],
    }),
    createImageTextTypographyCapability({
      id: 'native-psd-editable-text-export',
      label: 'Native PSD editable text export',
      status: 'limited',
      implemented: true,
      layerIds: retainedTextLayerIds,
      evidence: [buildImageTextNativeExportStateSignature(buildNativePsdTextRoundtripDescriptor())],
      caveats: ['PSD-native records cover ordinary horizontal unwarped solid-colour text. Path text, vertical type, warps, masks, effects, and advanced style state remain raster fallback with retained Sloom Studio metadata.'],
    }),
  ] satisfies ImageTextTypographyCapabilityDescriptor[];
  const summary = summarizeImageTextTypographySupportMatrix(capabilities);

  return {
    capabilities,
    unsupportedCapabilityIds: capabilities
      .filter((capability) => capability.status === 'unsupported')
      .map((capability) => capability.id),
    summary,
    previewSignature: `image-text-typography-support-matrix:v1:${JSON.stringify({
      layerIds: layers.map((layer) => layer.id),
      capabilities: capabilities.map((capability) => [capability.id, capability.status]),
      summary,
    })}`,
  };
}

export function buildImageTextStylePackageSignature(
  style: ImageTextLayerStyle,
  features?: Partial<ImageTextOpenTypeFeatureDescriptor> | null,
): string {
  const stylePackage = serializeImageTextStylePackage(style, features);
  const character = stylePackage.characterStyle;
  const paragraph = stylePackage.paragraphStyle;
  return `image-text-style-package:v1:${JSON.stringify({
    styleSignature: stylePackage.preview.signature,
    character: [
      character.fontFamily,
      character.fontSize,
      character.fontWeight,
      character.fontStyle,
      character.fontVariantCaps,
      character.fontKerning,
      character.letterSpacing,
      character.baselineShift,
      buildOpenTypeFeatureSignature(character.openTypeFeatures),
    ].join('|'),
    paragraph: [
      paragraph.align,
      paragraph.lineHeight,
      paragraph.verticalAlign,
      paragraph.wrap ? 'wrap' : 'nowrap',
      paragraph.boxWidth ?? 'auto',
      paragraph.boxHeight ?? 'auto',
      ...(paragraph.orientation ? [paragraph.orientation] : []),
    ].join('|'),
    warningCodes: buildImageTextStylePackageWarningCodes(stylePackage),
  })}`;
}

export function buildImageTextFontFallbackSignature(
  descriptor: ImageTextFontPersistenceDescriptor,
): string {
  return `image-text-font-fallback:v1:${JSON.stringify({
    requestedFamily: descriptor.requestedFamily,
    preferredFamily: descriptor.preferredFamily,
    fallbackFamilies: descriptor.fallbackFamilies,
    fallbackStatus: descriptor.fallbackStatus,
    discoveryStatus: descriptor.discoveryStatus,
  })}`;
}

export function buildImageTextNativeExportStateSignature(
  descriptor: ImageTextNativePsdTextRoundtripDescriptor,
): string {
  return `image-text-native-export:v1:${JSON.stringify({
    status: descriptor.status,
    warningCode: descriptor.warningCode,
  })}`;
}

export function buildImageTextExportSourceBinHandoffDescriptor(
  layers: ImageLayer[],
): ImageTextExportSourceBinHandoffDescriptor {
  const retainedTextLayerIds = layers
    .filter((layer) => Boolean(layer.text))
    .map((layer) => layer.id);
  const flattenedLayerIds = layers
    .filter((layer) => !layer.text)
    .map((layer) => layer.id);
  const caveats = buildImageTextExportSourceBinHandoffCaveats(layers, retainedTextLayerIds, flattenedLayerIds);
  const status = caveats.length > 0 ? 'limited' : 'ready';

  return {
    status,
    retainedTextLayerIds,
    flattenedLayerIds,
    exportRoute: {
      target: 'visible-raster-export',
      preservesEditableText: false,
      preservesStylePackage: retainedTextLayerIds.length > 0,
      sourceBinPayload: 'flattened-preview-with-signal-loom-text-metadata',
    },
    caveats,
    previewSignature: `image-text-export-source-bin-handoff:v1:${JSON.stringify({
      status,
      retainedTextLayerIds,
      flattenedLayerIds,
      caveatCodes: caveats.map((caveat) => caveat.code),
    })}`,
  };
}

export function measureImageTextBlock(
  style: ImageTextLayerStyle,
  measureLine: (line: string) => number,
): MeasuredImageTextBlock {
  const rawLines = splitTextLines(style.content);
  const lines = style.wrap && style.boxWidth ? wrapTextLines(rawLines, style.boxWidth, measureLine) : rawLines;
  const lineWidths = lines.map((line) => Math.max(1, Math.ceil(measureSpacedLine(line, style.letterSpacing, measureLine))));
  const contentWidth = Math.max(1, ...lineWidths);
  const width = Math.max(1, Math.ceil(style.boxWidth ?? contentWidth));
  const lineHeightPx = Math.max(1, Math.ceil(style.fontSize * style.lineHeight));
  const contentHeight = Math.max(lineHeightPx, lines.length * lineHeightPx);
  const height = Math.max(contentHeight, Math.ceil(style.boxHeight ?? contentHeight));
  const verticalOffset =
    style.verticalAlign === 'middle'
      ? (height - contentHeight) / 2
      : style.verticalAlign === 'bottom'
        ? height - contentHeight
        : 0;
  const measuredLines = lines.map((line, index) => {
    const lineWidth = lineWidths[index];
    const x =
      style.align === 'center'
        ? (width - lineWidth) / 2
        : style.align === 'right'
          ? width - lineWidth
          : 0;

    return {
      text: line,
      width: lineWidth,
      x,
      baseline: verticalOffset + index * lineHeightPx + style.fontSize + style.baselineShift,
    };
  });

  return {
    lines: measuredLines,
    width,
    height,
    lineHeightPx,
    align: style.align,
    boxWidth: style.boxWidth,
    boxHeight: style.boxHeight,
  };
}

interface MeasuredVerticalImageTextColumn {
  glyphs: string[];
  sourceColumnIndex: number;
  continuationIndex: number;
  x: number;
  y: number;
}

interface MeasuredVerticalImageTextBlock {
  columns: MeasuredVerticalImageTextColumn[];
  width: number;
  height: number;
  glyphAdvance: number;
  orientation: 'vertical-rl' | 'vertical-lr';
}

/**
 * Validate output dimensions before an OffscreenCanvas is constructed. Keeping this check separate
 * from createBitmap makes failed text edits side-effect free and prevents the browser from attempting
 * a giant backing-store allocation first.
 */
export function assertImageTextRasterAllocation(
  requestedWidth: number,
  requestedHeight: number,
): { width: number; height: number; pixelCount: number } {
  const width = normalizeRasterDimension(requestedWidth);
  const height = normalizeRasterDimension(requestedHeight);
  const pixelCount = Number.isFinite(width) && Number.isFinite(height)
    && width <= Number.MAX_SAFE_INTEGER / Math.max(1, height)
    ? width * height
    : Number.POSITIVE_INFINITY;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width > IMAGE_TEXT_RASTER_MAX_DIMENSION
    || height > IMAGE_TEXT_RASTER_MAX_DIMENSION
    || pixelCount > IMAGE_TEXT_RASTER_MAX_PIXELS
  ) {
    throw new ImageTextRasterBudgetError(width, height, pixelCount);
  }
  return { width, height, pixelCount };
}

function measureVerticalImageTextBlock(style: ImageTextLayerStyle): MeasuredVerticalImageTextBlock {
  const orientation = normalizeImageTextOrientation(style.orientation);
  if (orientation === 'horizontal') {
    throw new Error('Vertical text layout requires vertical-rl or vertical-lr orientation metadata.');
  }

  const glyphAdvance = Math.max(1, Math.ceil(style.fontSize + style.letterSpacing));
  const columnAdvance = Math.max(1, Math.ceil(style.fontSize * style.lineHeight));
  const rawSourceColumns = splitVerticalTextColumns(style.content);
  // A cheap lower-bound check rejects pathological newline counts before grapheme arrays are built.
  assertImageTextRasterAllocation(
    Math.max(rawSourceColumns.length * columnAdvance, Math.ceil(style.boxWidth ?? 0)),
    Math.max(glyphAdvance, Math.ceil(style.boxHeight ?? 0)),
  );
  const sourceColumns = rawSourceColumns.map((column) => segmentTextGraphemes(column));
  const maxGlyphsPerColumn = style.wrap && style.boxHeight
    ? Math.max(1, Math.floor(style.boxHeight / glyphAdvance))
    : null;
  const expectedColumnCount = Math.max(1, sourceColumns.reduce((count, glyphs) => {
    if (!maxGlyphsPerColumn || glyphs.length === 0) return count + 1;
    return count + Math.ceil(glyphs.length / maxGlyphsPerColumn);
  }, 0));
  const maxColumnGlyphCount = sourceColumns.reduce((maximum, glyphs) => {
    const columnGlyphCount = maxGlyphsPerColumn
      ? Math.min(glyphs.length, maxGlyphsPerColumn)
      : glyphs.length;
    return Math.max(maximum, columnGlyphCount);
  }, 0);
  const allocation = assertImageTextRasterAllocation(
    Math.max(expectedColumnCount * columnAdvance, Math.ceil(style.boxWidth ?? 0)),
    Math.max(glyphAdvance, maxColumnGlyphCount * glyphAdvance, Math.ceil(style.boxHeight ?? 0)),
  );
  const columnDrafts: Array<{
    glyphs: string[];
    sourceColumnIndex: number;
    continuationIndex: number;
  }> = [];

  sourceColumns.forEach((glyphs, sourceColumnIndex) => {
    if (!maxGlyphsPerColumn || glyphs.length <= maxGlyphsPerColumn) {
      columnDrafts.push({ glyphs, sourceColumnIndex, continuationIndex: 0 });
      return;
    }
    for (let offset = 0, continuationIndex = 0; offset < glyphs.length; offset += maxGlyphsPerColumn, continuationIndex += 1) {
      columnDrafts.push({
        glyphs: glyphs.slice(offset, offset + maxGlyphsPerColumn),
        sourceColumnIndex,
        continuationIndex,
      });
    }
  });

  if (columnDrafts.length === 0) {
    columnDrafts.push({ glyphs: [], sourceColumnIndex: 0, continuationIndex: 0 });
  }
  const columns = columnDrafts.map((column, columnIndex): MeasuredVerticalImageTextColumn => {
    const columnHeight = Math.max(glyphAdvance, column.glyphs.length * glyphAdvance);
    const y = style.verticalAlign === 'middle'
      ? (allocation.height - columnHeight) / 2
      : style.verticalAlign === 'bottom'
        ? allocation.height - columnHeight
        : 0;
    const offset = columnIndex * columnAdvance + columnAdvance / 2;
    return {
      ...column,
      x: orientation === 'vertical-lr' ? offset : allocation.width - offset,
      y,
    };
  });

  return {
    columns,
    width: allocation.width,
    height: allocation.height,
    glyphAdvance,
    orientation,
  };
}

export function buildTextLayerName(content: string): string {
  const firstLine = splitTextLines(content.trim())[0]?.trim() ?? '';
  if (!firstLine) return 'Text';
  return firstLine.length > 25 ? `${firstLine.slice(0, 25).trimEnd()}...` : firstLine;
}

export function rasterizeImageTextStyle(styleInput: Partial<ImageTextLayerStyle>): LayerBitmap {
  assertRequestedImageTextBoxDimensions(styleInput);
  const requestedPathLayout = styleInput.pathLayout !== undefined && styleInput.pathLayout !== null;
  const style = normalizeImageTextStyle(styleInput);
  assertCanvasCanPaintManagedImageText(style);
  if (requestedPathLayout && !style.pathLayout) return createBitmap(1, 1);
  if (style.pathLayout) {
    return rasterizeImageTextOnPathStyle(style);
  }
  if (isVerticalImageTextStyle(style)) {
    return rasterizeVerticalImageTextStyle(style);
  }
  const measure = createBitmap(1, 1);
  const mctx = measure.getContext('2d');
  if (!mctx) throw new Error('Failed to acquire text measurement context.');
  mctx.font = imageTextCanvasFont(style);
  applyCanvasTypographySettings(mctx, style);
  const layout = measureImageTextBlock(style, (line) => mctx.measureText(line || ' ').width);
  const warpPadding = imageTextWarpPadding(style.warp);
  const allocation = assertImageTextRasterAllocation(
    layout.width,
    layout.height + warpPadding * 2,
  );
  const bitmap = createBitmap(allocation.width, allocation.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire text rasterization context.');
  ctx.font = imageTextCanvasFont(style);
  applyCanvasTypographySettings(ctx, style);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'alphabetic';

  for (const line of layout.lines) {
    drawTextLine(
      ctx,
      line.text,
      line.x,
      line.baseline + warpPadding,
      style.letterSpacing,
      style.warp,
      layout.width,
      line.width,
    );
  }

  return bitmap;
}

function rasterizeImageTextOnPathStyle(style: ImageTextLayerStyle): LayerBitmap {
  const pathLayout = normalizeImageTextPathLayout(style.pathLayout);
  if (!pathLayout) return createBitmap(1, 1);
  const padding = imageTextPathPadding(style);
  const width = Math.max(1, Math.ceil(pathLayout.bounds.width + padding * 2));
  const height = Math.max(1, Math.ceil(pathLayout.bounds.height + padding * 2));
  if (width > MAX_IMAGE_TEXT_PATH_DIMENSION || height > MAX_IMAGE_TEXT_PATH_DIMENSION) {
    return createBitmap(1, 1);
  }
  const measure = createBitmap(1, 1);
  const mctx = measure.getContext('2d');
  if (!mctx) throw new Error('Failed to acquire text measurement context.');
  mctx.font = imageTextCanvasFont(style);
  applyCanvasTypographySettings(mctx, style);

  const allocation = assertImageTextRasterAllocation(width, height);
  const bitmap = createBitmap(allocation.width, allocation.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire text-on-path rasterization context.');
  ctx.font = imageTextCanvasFont(style);
  applyCanvasTypographySettings(ctx, style);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.translate(padding - pathLayout.bounds.x, padding - pathLayout.bounds.y);

  const text = splitTextLines(style.content).join(' ').trim();
  const points = pathLayout.reverse ? [...pathLayout.points].reverse() : pathLayout.points;
  let cursor = pathLayout.startOffset;

  for (const char of text) {
    const charWidth = Math.max(1, mctx.measureText(char || ' ').width);
    const sample = samplePointOnPath(points, cursor + charWidth / 2, pathLayout.closed);
    if (!sample) break;
    drawPathTextGlyph(ctx, char, sample.x, sample.y + style.baselineShift, sample.angle, charWidth);
    cursor += charWidth + style.letterSpacing;
    if (cursor > pathLayout.pathLength + charWidth) break;
  }

  return bitmap;
}

function imageTextPathPadding(
  style: Pick<ImageTextLayerStyle, 'fontSize' | 'baselineShift'>,
): number {
  return Math.max(16, Math.ceil(style.fontSize * 1.5 + Math.abs(style.baselineShift)));
}

function rasterizeVerticalImageTextStyle(style: ImageTextLayerStyle): LayerBitmap {
  const layout = measureVerticalImageTextBlock(style);
  const bitmap = createBitmap(layout.width, layout.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire vertical text rasterization context.');
  ctx.font = imageTextCanvasFont(style);
  applyCanvasTypographySettings(ctx, style);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  for (const column of layout.columns) {
    column.glyphs.forEach((glyph, index) => {
      ctx.fillText(
        glyph,
        column.x,
        column.y + index * layout.glyphAdvance + layout.glyphAdvance / 2 + style.baselineShift,
      );
    });
  }
  return bitmap;
}

export function attachTextLayerToVectorPath(
  textLayer: ImageLayer,
  pathLayer: ImageLayer,
  options: { startOffset?: number; reverse?: boolean } = {},
): ImageLayer {
  const plan = buildImageTextPathAttachmentPlan(textLayer, pathLayer, options);
  return plan ? applyImageTextPathAttachmentPlan(textLayer, plan) : textLayer;
}

interface ImageTextPathAttachmentPlan {
  x: number;
  y: number;
  pathReference: TextLayerPathReferenceMetadata;
  pathLayout: TextLayerPathLayout;
}

function buildImageTextPathAttachmentPlan(
  textLayer: ImageLayer,
  pathLayer: ImageLayer,
  options: { startOffset?: number; reverse?: boolean },
): ImageTextPathAttachmentPlan | null {
  const pathShape = getEditableVectorShape(pathLayer);
  const documentPoints = getVectorPathDocumentPoints(pathLayer);
  if (!textLayer.text || !pathShape || pathShape.kind !== 'path' || documentPoints.length < 2) return null;
  if (documentPoints.length > MAX_IMAGE_TEXT_PATH_POINTS) return null;
  if (documentPoints.length - 1 + (pathShape.closed ? 1 : 0) > MAX_IMAGE_TEXT_PATH_SEGMENTS) return null;
  if (!documentPoints.every(isFiniteVectorPathPoint)) return null;

  const documentPathSegments = buildImageTextVectorPathSegments(documentPoints, pathShape.closed);
  const sampledDocumentLayout = documentPathSegments.length > 0
    ? buildImageTextBezierPathLayout({
      sourceLayerId: pathLayer.id,
      segments: documentPathSegments,
      closed: pathShape.closed,
      startOffset: options.startOffset ?? 0,
      reverse: options.reverse ?? false,
    })
    : null;
  if (documentPathSegments.length > 0 && !sampledDocumentLayout) return null;
  const hasSampledPath = sampledDocumentLayout !== null;
  const documentPathPoints = sampledDocumentLayout?.points ?? documentPoints.map(roundPoint);
  if (!documentPathPoints.every(isFinitePoint)) return null;
  const pathLength = measurePathLength(documentPathPoints, pathShape.closed);
  if (pathLength <= 0) return null;

  const sampledBounds = measurePointBounds(documentPathPoints);
  const padding = imageTextPathPadding(textLayer.text);
  const paddedWidth = Math.ceil(sampledBounds.width) + padding * 2;
  const paddedHeight = Math.ceil(sampledBounds.height) + padding * 2;
  if (
    paddedWidth > MAX_IMAGE_TEXT_PATH_DIMENSION
    || paddedHeight > MAX_IMAGE_TEXT_PATH_DIMENSION
  ) return null;

  const originX = sampledBounds.x - padding;
  const originY = sampledBounds.y - padding;
  const pathPoints = documentPathPoints.map((point) => translateImageTextPathPoint(point, -originX, -originY));
  const localPathSegments = documentPathSegments.map((segment) => ({
    from: translateImageTextPathPoint(segment.from, -originX, -originY),
    control1: translateImageTextPathPoint(segment.control1, -originX, -originY),
    control2: translateImageTextPathPoint(segment.control2, -originX, -originY),
    to: translateImageTextPathPoint(segment.to, -originX, -originY),
  }));
  const pathLayout = normalizeImageTextPathLayout({
    sourceLayerId: pathLayer.id,
    geometry: hasSampledPath ? 'bezier-sampled-path' : 'straight-segment-path',
    points: pathPoints,
    ...(hasSampledPath ? { bezierSegments: localPathSegments } : {}),
    closed: pathShape.closed,
    startOffset: options.startOffset ?? 0,
    reverse: options.reverse ?? false,
    pathLength,
    bounds: measurePointBounds(pathPoints),
    previewSignature: '',
  });
  if (!pathLayout) return null;

  const pathReference: TextLayerPathReferenceMetadata = {
    kind: 'vector-layer',
    layerId: pathLayer.id,
    pathId: pathLayer.name,
    revision: pathLayer.bitmapVersion,
  };
  return {
    pathReference,
    pathLayout,
    x: originX,
    y: originY,
  };
}

function applyImageTextPathAttachmentPlan(
  textLayer: ImageLayer,
  plan: ImageTextPathAttachmentPlan,
): ImageLayer {
  const next = updateTextLayerFromStyle(textLayer, {
    pathReference: plan.pathReference,
    pathLayout: plan.pathLayout,
  });
  return { ...next, x: plan.x, y: plan.y };
}

export function refreshImageTextLayersForChangedVectorPaths(
  previousLayers: readonly ImageLayer[],
  nextLayers: ImageLayer[],
  options: { clearMissingPathReferences?: boolean } = {},
): ImageLayer[] {
  const previousLayersById = new Map(previousLayers.map((layer) => [layer.id, layer]));
  const previousPaths = collectImageTextVectorPathLayers(previousLayers);
  const nextPaths = collectImageTextVectorPathLayers(nextLayers);
  const changedPathIds = new Set<string>();
  for (const pathId of new Set([...previousPaths.keys(), ...nextPaths.keys()])) {
    if (!imageTextVectorPathGeometryMatches(previousPaths.get(pathId), nextPaths.get(pathId))) {
      changedPathIds.add(pathId);
    }
  }
  let changed = false;
  const refreshed = nextLayers.map((layer) => {
    const reference = layer.text?.pathReference;
    const sourceLayerId = reference?.kind === 'vector-layer' ? reference.layerId : undefined;
    if (!sourceLayerId) return layer;
    if (!changedPathIds.has(sourceLayerId) && previousLayersById.get(layer.id) === layer) return layer;
    const sourcePath = nextPaths.get(sourceLayerId);
    if (!sourcePath) {
      if (options.clearMissingPathReferences === false) return layer;
      changed = true;
      return updateTextLayerFromStyle(layer, { pathReference: null, pathLayout: null });
    }
    const plan = buildImageTextPathAttachmentPlan(layer, sourcePath, {
      startOffset: layer.text?.pathLayout?.startOffset ?? 0,
      reverse: layer.text?.pathLayout?.reverse ?? false,
    });
    if (!plan) {
      changed = true;
      return updateTextLayerFromStyle(layer, { pathReference: null, pathLayout: null });
    }
    if (imageTextLayerMatchesPathAttachmentPlan(layer, plan)) return layer;
    changed = true;
    return applyImageTextPathAttachmentPlan(layer, plan);
  });
  return changed ? refreshed : nextLayers;
}

function collectImageTextVectorPathLayers(layers: readonly ImageLayer[]): Map<string, ImageLayer> {
  return new Map(layers.flatMap((layer) => (
    getEditableVectorShape(layer)?.kind === 'path' ? [[layer.id, layer] as const] : []
  )));
}

function imageTextVectorPathGeometryMatches(
  previous: ImageLayer | undefined,
  next: ImageLayer | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  const previousShape = getEditableVectorShape(previous);
  const nextShape = getEditableVectorShape(next);
  if (!previousShape || previousShape.kind !== 'path' || !nextShape || nextShape.kind !== 'path') return false;
  if (
    previous.name !== next.name
    || previous.x !== next.x
    || previous.y !== next.y
    || previous.bitmapVersion !== next.bitmapVersion
    || previousShape.closed !== nextShape.closed
    || previousShape.width !== nextShape.width
    || previousShape.height !== nextShape.height
    || previousShape.points.length !== nextShape.points.length
  ) return false;
  return previousShape.points.every((point, index) => (
    imageTextVectorPathPointMatches(point, nextShape.points[index])
  ));
}

function imageTextVectorPathPointMatches(
  previous: ImageVectorPathPoint,
  next: ImageVectorPathPoint | undefined,
): boolean {
  return next !== undefined
    && previous.x === next.x
    && previous.y === next.y
    && imageTextVectorPathHandleMatches(previous.inHandle, next.inHandle)
    && imageTextVectorPathHandleMatches(previous.outHandle, next.outHandle);
}

function imageTextVectorPathHandleMatches(
  previous: ImageVectorPathPoint | undefined,
  next: ImageVectorPathPoint | undefined,
): boolean {
  return previous === next || Boolean(previous && next && previous.x === next.x && previous.y === next.y);
}

function imageTextLayerMatchesPathAttachmentPlan(
  layer: ImageLayer,
  plan: ImageTextPathAttachmentPlan,
): boolean {
  const reference = layer.text?.pathReference;
  const layout = normalizeImageTextPathLayout(layer.text?.pathLayout);
  return layer.x === plan.x
    && layer.y === plan.y
    && reference?.kind === plan.pathReference.kind
    && reference.layerId === plan.pathReference.layerId
    && reference.pathId === plan.pathReference.pathId
    && reference.revision === plan.pathReference.revision
    && layout?.previewSignature === plan.pathLayout.previewSignature;
}

function buildImageTextVectorPathSegments(
  points: ImageVectorPathPoint[],
  closed: boolean,
): TextLayerBezierSegment[] {
  if (points.length < 2) return [];
  const pairs: Array<{ from: ImageVectorPathPoint; to: ImageVectorPathPoint }> = [];
  for (let index = 1; index < points.length; index += 1) {
    pairs.push({ from: points[index - 1]!, to: points[index]! });
  }
  if (closed && points.length > 1) {
    pairs.push({ from: points[points.length - 1]!, to: points[0]! });
  }
  const hasBezier = pairs.some(({ from, to }) => Boolean(from.outHandle || to.inHandle));
  if (!hasBezier) return [];
  return pairs.map(({ from, to }) => ({
    from,
    control1: from.outHandle ?? from,
    control2: to.inHandle ?? to,
    to,
  }));
}

export function updateTextLayerFromStyle(
  layer: ImageLayer,
  patch: Partial<ImageTextLayerStyle>,
): ImageLayer {
  assertRequestedImageTextBoxDimensions(patch);
  const style = normalizeImageTextStyle({ ...(layer.text ?? DEFAULT_IMAGE_TEXT_STYLE), ...patch });
  return {
    ...layer,
    name: buildTextLayerName(style.content),
    type: 'text',
    bitmap: rasterizeImageTextStyle(style),
    bitmapVersion: layer.bitmapVersion + 1,
    text: style,
    metadata: { ...layer.metadata, editableText: true },
  };
}

export function summarizeImageTextWorkflowLayers(layers: ImageLayer[]): ImageTextWorkflowLayerSummary {
  const { searchableTextLayers, skippedLayers } = collectImageTextWorkflowLayers(layers);
  return {
    searchableTextLayers,
    skippedLayers,
    unsupportedStates: buildImageTextWorkflowUnsupportedStates(),
    previewSignature: `image-text-workflow-layers:v1:${JSON.stringify({
      searchableLayerIds: searchableTextLayers.map((layer) => layer.layerId),
      skippedLayerIds: skippedLayers.map((layer) => layer.layerId),
    })}`,
  };
}

export function planImageTextFindReplace(
  layers: ImageLayer[],
  request: ImageTextFindReplaceRequest,
): ImageTextFindReplacePlan {
  const query = request.find;
  const replacement = request.replace;
  const caseSensitive = request.caseSensitive ?? false;
  const wholeWord = request.wholeWord ?? false;
  const { searchableTextLayers, skippedLayers, retainedLayers } = collectImageTextWorkflowLayers(layers);
  const proposedReplacements: ImageTextReplacementProposal[] = [];

  if (query.length > 0) {
    for (const layer of retainedLayers) {
      const originalContent = layer.text?.content ?? '';
      const replacementResult = replaceImageTextContent(originalContent, query, replacement, {
        caseSensitive,
        wholeWord,
      });
      if (replacementResult.matchCount > 0) {
        proposedReplacements.push({
          layerId: layer.id,
          matchCount: replacementResult.matchCount,
          originalContent,
          proposedContent: replacementResult.content,
        });
      }
    }
  }

  const affectedLayerIds = proposedReplacements.map((proposal) => proposal.layerId);

  return {
    query,
    replacement,
    caseSensitive,
    wholeWord,
    affectedLayerIds,
    searchableTextLayers,
    proposedReplacements,
    skippedLayers,
    unsupportedStates: buildImageTextWorkflowUnsupportedStates(),
    previewSignature: `image-text-find-replace:v1:${JSON.stringify({
      query,
      replacement,
      caseSensitive,
      wholeWord,
      affectedLayerIds,
      proposals: proposedReplacements.map((proposal) => [
        proposal.layerId,
        proposal.matchCount,
        proposal.proposedContent,
      ]),
      skippedLayerIds: skippedLayers.map((layer) => layer.layerId),
    })}`,
  };
}

export function applyImageTextFindReplace(
  layers: ImageLayer[],
  request: ImageTextFindReplaceRequest,
): AppliedImageTextFindReplace {
  const plan = planImageTextFindReplace(layers, request);
  const proposalsByLayerId = new Map(plan.proposedReplacements.map((proposal) => [proposal.layerId, proposal]));
  return {
    plan,
    layers: layers.map((layer) => {
      const proposal = proposalsByLayerId.get(layer.id);
      if (!proposal) return layer;
      return updateTextLayerFromStyle(layer, { content: proposal.proposedContent });
    }),
  };
}

const IMAGE_TEXT_DEFAULT_DICTIONARY = [
  'a',
  'ai',
  'and',
  'caption',
  'city',
  'cyberpunk',
  'firewall',
  'for',
  'image',
  'in',
  'leyline',
  'loom',
  'magic',
  'of',
  'signal',
  'spellcheck',
  'text',
  'the',
  'title',
  'tool',
  'type',
  'workspace',
];

export function planImageTextDictionarySpellcheck(
  layers: ImageLayer[],
  options: { dictionary?: string[] } = {},
): ImageTextDictionarySpellcheckPlan {
  const { searchableTextLayers, skippedLayers, retainedLayers } = collectImageTextWorkflowLayers(layers);
  const dictionary = normalizeDictionaryWords(options.dictionary?.length ? options.dictionary : IMAGE_TEXT_DEFAULT_DICTIONARY);
  const misspellingsByWord = new Map<string, ImageTextDictionarySpellcheckMisspelling>();

  for (const layer of retainedLayers) {
    const words = extractSpellcheckWords(layer.text?.content ?? '');
    for (const word of words) {
      const normalized = normalizeSpellcheckWord(word);
      if (!normalized || dictionary.has(normalized)) continue;
      const existing = misspellingsByWord.get(normalized);
      if (existing) {
        if (!existing.layerIds.includes(layer.id)) existing.layerIds.push(layer.id);
        continue;
      }
      misspellingsByWord.set(normalized, {
        word,
        normalized,
        layerIds: [layer.id],
        suggestions: suggestDictionaryWords(normalized, dictionary),
      });
    }
  }

  const misspellings = [...misspellingsByWord.values()]
    .sort((a, b) => a.normalized.localeCompare(b.normalized));
  const affectedLayerIds = searchableTextLayers.map((layer) => layer.layerId);

  return {
    status: searchableTextLayers.length > 0 ? 'ready' : 'limited',
    affectedLayerIds,
    searchableTextLayers,
    skippedLayers,
    unsupportedStates: buildImageTextWorkflowUnsupportedStates(),
    dictionarySize: dictionary.size,
    misspellings,
    previewSignature: `image-text-dictionary-spellcheck:v1:${JSON.stringify({
      affectedLayerIds,
      dictionarySize: dictionary.size,
      misspellings: misspellings.map((misspelling) => [
        misspelling.normalized,
        misspelling.layerIds,
        misspelling.suggestions,
      ]),
      skippedLayerIds: skippedLayers.map((layer) => layer.layerId),
    })}`,
  };
}

export function planImageTextSpellcheckReadability(layers: ImageLayer[]): ImageTextSpellcheckReadabilityPlan {
  const { searchableTextLayers, skippedLayers, retainedLayers } = collectImageTextWorkflowLayers(layers);
  const affectedLayerIds = searchableTextLayers.map((layer) => layer.layerId);
  const readability = summarizeImageTextReadability(retainedLayers.map((layer) => layer.text?.content ?? ''));

  return {
    affectedLayerIds,
    searchableTextLayers,
    skippedLayers,
    readability,
    unsupportedStates: buildImageTextWorkflowUnsupportedStates(),
    previewSignature: `image-text-spellcheck-readability:v1:${JSON.stringify({
      affectedLayerIds,
      readability,
      skippedLayerIds: skippedLayers.map((layer) => layer.layerId),
    })}`,
  };
}

function buildImageTextTypographyParityProgressChecks(
  layers: ImageLayer[],
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck[] {
  return [
    buildImageTextLiveEditReadinessCheck(readiness),
    buildImageTextFontFallbackPersistenceCheck(readiness),
    buildImageTextOpenTypeUnsupportedStatesCheck(readiness),
    buildImageTextStylePackageMetadataCheck(readiness),
    buildImageTextOnPathCaveatsCheck(layers),
    buildImageTextFindReplacePlanningCheck(readiness),
    buildImageTextSpellcheckReadabilityPlanningCheck(readiness),
    buildImageTextStableSignaturesCheck(readiness),
  ];
}

function buildImageTextLiveEditReadinessCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  const editableLayers = readiness.layerReadiness
    .filter((layer) => layer.retainedEditability.editable)
    .map((layer) => layer.layerId);
  const blockedRetainedLayers = readiness.layerReadiness
    .filter((layer) => layer.retainedText && layer.blockers.length > 0)
    .map((layer) => layer.layerId);
  const caveats = readiness.layerReadiness
    .filter((layer) => layer.retainedText)
    .flatMap((layer) => layer.blockers.map((blocker) => blocker.message));
  if (editableLayers.length === 0) {
    caveats.push('No retained editable text layers are available for live edit planning.');
  }

  return createImageTextTypographyParityCheck({
    id: 'live-edit-readiness',
    label: 'Live edit readiness',
    status: blockedRetainedLayers.length > 0 || editableLayers.length === 0 ? 'blocked' : 'ready',
    layerIds: editableLayers,
    evidence: [
      `Editable retained layers: ${editableLayers.join(', ') || 'none'}`,
      ...(blockedRetainedLayers.length > 0 ? [`Blocked retained layers: ${blockedRetainedLayers.join(', ')}`] : []),
    ],
    caveats,
  });
}

function buildImageTextFontFallbackPersistenceCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  const fontLayers = readiness.layerReadiness.filter((layer) => layer.fontPersistence);
  const evidence = fontLayers.map((layer) => {
    const persistence = layer.fontPersistence!;
    return `${layer.layerId}: ${persistence.preferredFamily}${persistence.fallbackFamilies.length ? ` -> ${persistence.fallbackFamilies.join(', ')}` : ' (no fallback)'}`;
  });
  const hasFallbacks = fontLayers.some((layer) => Boolean(layer.fontPersistence?.fallbackFamilies.length));

  return createImageTextTypographyParityCheck({
    id: 'font-fallback-persistence',
    label: 'Font fallback persistence',
    status: fontLayers.length === 0 ? 'blocked' : hasFallbacks ? 'limited' : 'ready',
    layerIds: fontLayers.map((layer) => layer.layerId),
    evidence: evidence.length ? evidence : ['No retained text font-family stacks found.'],
    caveats: hasFallbacks
      ? ['Installed-font discovery is unsupported; persisted font-family stacks are metadata only.']
      : [],
  });
}

function buildImageTextOpenTypeUnsupportedStatesCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  const openTypeLayers = readiness.layerReadiness.filter((layer) => layer.openTypeSupport);
  const hasUnsupported = openTypeLayers.some((layer) => Boolean(layer.openTypeSupport?.unsupportedTags.length));
  const hasSupportedIntent = openTypeLayers.some((layer) => Boolean(layer.openTypeSupport?.supportedTags.length));
  const caveats: string[] = [];
  if (hasUnsupported) {
    caveats.push('Unsupported OpenType feature tags are ignored instead of being applied to canvas text.');
  }
  if (hasUnsupported || hasSupportedIntent) {
    caveats.push('OpenType glyph availability depends on the resolved font fallback.');
  }

  return createImageTextTypographyParityCheck({
    id: 'opentype-unsupported-states',
    label: 'OpenType unsupported states',
    status: openTypeLayers.length === 0 ? 'blocked' : hasUnsupported ? 'limited' : 'ready',
    layerIds: openTypeLayers.map((layer) => layer.layerId),
    evidence: openTypeLayers.length
      ? openTypeLayers.map((layer) => formatImageTextOpenTypeEvidence(layer))
      : ['No retained OpenType metadata found.'],
    caveats,
  });
}

function buildImageTextStylePackageMetadataCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  const packagedLayers = readiness.layerReadiness
    .filter((layer) => layer.stylePackage)
    .map((layer) => layer.layerId);

  return createImageTextTypographyParityCheck({
    id: 'style-package-metadata',
    label: 'Style package metadata',
    status: packagedLayers.length > 0 ? 'ready' : 'blocked',
    layerIds: packagedLayers,
    evidence: [`Character and paragraph packages: ${packagedLayers.join(', ') || 'none'}`],
    caveats: packagedLayers.length > 0
      ? ['Style packages are Sloom Studio metadata and do not create native PSD editable text records.']
      : ['No retained text layers are available for character/paragraph style packaging.'],
  });
}

function buildImageTextOnPathCaveatsCheck(
  layers: ImageLayer[],
): ImageTextTypographyParityProgressCheck {
  const pathLayerIds = layers
    .filter((layer) => {
      const descriptor = buildImageTextLayerDescriptor(layer);
      return descriptor?.textOnPath.status === 'ready';
    })
    .map((layer) => layer.id);

  return createImageTextTypographyParityCheck({
    id: 'text-on-path-caveats',
    label: 'Text-on-path caveats',
    status: 'limited',
    layerIds: pathLayerIds,
    evidence: pathLayerIds.length
      ? [`Retained straight text path metadata: ${pathLayerIds.join(', ')}`]
      : ['Editable text-on-path is not available; point text metadata remains editable.'],
    caveats: [
      'Text-on-path exports flatten current glyph layout to pixels; native PSD editable text-on-path remains unsupported.',
      'Curved Bezier text-on-path editing uses retained cubic controls plus sampled glyph baselines for canvas preview/export.',
    ],
  });
}

function buildImageTextFindReplacePlanningCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  const operation = readiness.operations.findReplace;
  const matchCount = operation.plan.proposedReplacements.reduce((sum, proposal) => sum + proposal.matchCount, 0);

  return createImageTextTypographyParityCheck({
    id: 'find-replace-planning',
    label: 'Find/replace planning',
    status: operation.status,
    layerIds: operation.affectedLayerIds,
    evidence: [
      `Searchable retained layers: ${operation.plan.searchableTextLayers.map((layer) => layer.layerId).join(', ') || 'none'}`,
      `Planned replacements: ${matchCount}`,
    ],
    caveats: [...operation.blockers, ...operation.warnings].map((issue) => issue.message),
  });
}

function buildImageTextSpellcheckReadabilityPlanningCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  const operation = readiness.operations.spellcheckReadability;
  return createImageTextTypographyParityCheck({
    id: 'spellcheck-readability-planning',
    label: 'Spellcheck/readability planning',
    status: operation.status,
    layerIds: operation.affectedLayerIds,
    evidence: [
      `Readability metrics: ${operation.readability.characterCount} chars, ${operation.readability.wordCount} words, ${operation.readability.sentenceCount} sentences`,
      `Longest line: ${operation.readability.longestLineLength}`,
    ],
    caveats: [...operation.blockers, ...operation.warnings].map((issue) => issue.message),
  });
}

function buildImageTextStableSignaturesCheck(
  readiness: ImageTextTypographyReadinessDescriptor,
): ImageTextTypographyParityProgressCheck {
  return createImageTextTypographyParityCheck({
    id: 'stable-signatures',
    label: 'Stable signatures',
    status: 'ready',
    layerIds: readiness.layerReadiness.map((layer) => layer.layerId),
    evidence: [
      `Readiness signature: ${readiness.previewSignature}`,
      `Layer signatures: ${readiness.layerReadiness.map((layer) => layer.previewSignature).join(' | ') || 'none'}`,
    ],
    caveats: ['Signatures describe deterministic metadata/planning state, not native PSD editable text support.'],
  });
}

function createImageTextTypographyParityCheck(
  check: Omit<ImageTextTypographyParityProgressCheck, 'signature'>,
): ImageTextTypographyParityProgressCheck {
  return {
    ...check,
    signature: `image-text-typography-parity-check:v1:${JSON.stringify({
      id: check.id,
      status: check.status,
      layerIds: check.layerIds,
      evidence: check.evidence,
      caveats: check.caveats,
    })}`,
  };
}

function createImageTextTypographyCapability(
  capability: Omit<ImageTextTypographyCapabilityDescriptor, 'signature'>,
): ImageTextTypographyCapabilityDescriptor {
  return {
    ...capability,
    signature: `image-text-typography-capability:v1:${JSON.stringify({
      id: capability.id,
      status: capability.status,
      implemented: capability.implemented,
      blockerCode: capability.blockerCode ?? null,
    })}`,
  };
}

function summarizeImageTextTypographySupportMatrix(
  capabilities: ImageTextTypographyCapabilityDescriptor[],
): ImageTextTypographySupportMatrixSummary {
  return {
    ready: capabilities.filter((capability) => capability.status === 'ready').length,
    limited: capabilities.filter((capability) => capability.status === 'limited').length,
    unsupported: capabilities.filter((capability) => capability.status === 'unsupported').length,
  };
}

function buildImageTextStylePackageWarningCodes(
  stylePackage: SerializedImageTextStylePackage,
): string[] {
  const codes: string[] = [];
  if (stylePackage.characterStyle.openTypeFeatures.unsupported?.length) {
    codes.push('opentype-unsupported-tags');
  }
  if (stylePackage.warnings.some((warning) => warning.includes('warps'))) {
    codes.push('rasterized-warp');
  }
  return codes;
}

function summarizeImageTextTypographyCheckStatuses(
  checks: ImageTextTypographyParityProgressCheck[],
): ImageTextTypographyReadinessStatus {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked';
  if (checks.some((check) => check.status === 'limited')) return 'limited';
  return 'ready';
}

function formatImageTextOpenTypeEvidence(
  layer: ImageTextTypographyReadinessLayerDescriptor,
): string {
  const support = layer.openTypeSupport;
  if (!support || (support.supportedTags.length === 0 && support.unsupportedTags.length === 0)) {
    return `${layer.layerId}: default features`;
  }
  const supported = support.supportedTags.length
    ? `supported ${support.supportedTags.join(', ')}`
    : 'supported none';
  const unsupported = support.unsupportedTags.length
    ? `; unsupported ${support.unsupportedTags.join(', ')}`
    : '';
  return `${layer.layerId}: ${supported}${unsupported}`;
}

function splitTextLines(content: string): string[] {
  const lines = content.split(/\r?\n/).map((line) => line.trimEnd());
  const meaningful = lines.filter((line) => line.trim().length > 0);
  return meaningful.length > 0 ? meaningful : [''];
}

function splitVerticalTextColumns(content: string): string[] {
  const columns = content.split(/\r?\n/).map((column) => column.trimEnd());
  return columns.length > 0 ? columns : [''];
}

function collectImageTextWorkflowLayers(layers: ImageLayer[]): {
  searchableTextLayers: ImageTextSearchableLayerSummary[];
  skippedLayers: ImageTextWorkflowSkippedLayer[];
  retainedLayers: ImageLayer[];
} {
  const searchableTextLayers: ImageTextSearchableLayerSummary[] = [];
  const skippedLayers: ImageTextWorkflowSkippedLayer[] = [];
  const retainedLayers: ImageLayer[] = [];

  for (const layer of layers) {
    const editable = layer.metadata?.editableText ?? layer.type === 'text';
    if (!layer.text) {
      skippedLayers.push({
        layerId: layer.id,
        name: layer.name,
        reason: layer.type === 'text' ? 'missing-retained-text' : 'non-text-or-rasterized-layer',
      });
      continue;
    }
    if (!editable) {
      skippedLayers.push({
        layerId: layer.id,
        name: layer.name,
        reason: 'non-editable-text-metadata',
      });
      continue;
    }

    retainedLayers.push(layer);
    searchableTextLayers.push({
      layerId: layer.id,
      name: layer.name,
      contentLength: layer.text.content.length,
      lineCount: splitTextLines(layer.text.content).length,
      editable,
    });
  }

  return { searchableTextLayers, skippedLayers, retainedLayers };
}

function buildImageTextWorkflowUnsupportedStates(): ImageTextWorkflowUnsupportedState[] {
  return [];
}

function replaceImageTextContent(
  content: string,
  query: string,
  replacement: string,
  options: { caseSensitive: boolean; wholeWord: boolean },
): { content: string; matchCount: number } {
  const flags = options.caseSensitive ? 'g' : 'gi';
  const matcher = new RegExp(escapeRegExp(query), flags);
  let matchCount = 0;
  const replaced = content.replace(matcher, (match, offset: number, fullContent: string) => {
    if (options.wholeWord && !isWholeWordMatch(fullContent, offset, offset + match.length)) {
      return match;
    }
    matchCount += 1;
    return replacement;
  });
  return { content: replaced, matchCount };
}

function isWholeWordMatch(content: string, start: number, end: number): boolean {
  const previous = start > 0 ? content[start - 1] : '';
  const next = end < content.length ? content[end] : '';
  return !isWordCharacter(previous) && !isWordCharacter(next);
}

function isWordCharacter(char: string): boolean {
  return /^[A-Za-z0-9_]$/.test(char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function summarizeImageTextReadability(contents: string[]): ImageTextReadabilitySummary {
  const combined = contents.join('\n');
  const lines = combined.split(/\r?\n/);
  const words = combined.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? [];
  const sentences = combined.match(/[^.!?]+[.!?]+|[^.!?\s][^.!?]*$/g) ?? [];
  const sentenceCount = Math.max(1, sentences.filter((sentence) => sentence.trim().length > 0).length);
  const averageWordsPerSentence = roundToTwoDecimals(words.length / sentenceCount);

  return {
    characterCount: combined.length,
    wordCount: words.length,
    sentenceCount,
    averageWordsPerSentence,
    longestLineLength: Math.max(0, ...lines.map((line) => line.length)),
  };
}

function normalizeDictionaryWords(words: string[]): Set<string> {
  return new Set(words.map(normalizeSpellcheckWord).filter(Boolean));
}

function extractSpellcheckWords(content: string): string[] {
  return content.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
}

function normalizeSpellcheckWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function suggestDictionaryWords(word: string, dictionary: Set<string>): string[] {
  return [...dictionary]
    .map((candidate) => ({
      candidate,
      distance: levenshteinDistance(word, candidate),
    }))
    .filter((entry) => entry.distance <= Math.max(2, Math.ceil(word.length * 0.35)))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j]!;
    }
  }
  return previous[b.length] ?? 0;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function wrapTextLines(
  lines: string[],
  maxWidth: number,
  measureLine: (line: string) => number,
): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      continue;
    }
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (measureLine(candidate) <= maxWidth || current.length === 0) {
        current = candidate;
      } else {
        wrapped.push(current);
        current = word;
      }
    }
    wrapped.push(current);
  }
  return wrapped;
}

function drawTextLine(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  letterSpacing: number,
  warp: ImageTextLayerStyle['warp'],
  blockWidth: number,
  lineWidth: number,
): void {
  if (!letterSpacing && warp === 'none') {
    ctx.fillText(text, x, baseline);
    return;
  }
  let cursor = x;
  for (const char of text) {
    const charWidth = ctx.measureText(char).width;
    const isBulge = warp === 'bulge';
    const sampleX = isBulge ? cursor - x + charWidth / 2 : cursor + lineWidth / 2;
    const sampleWidth = isBulge ? lineWidth : blockWidth;
    const charY = baseline + warpOffset(sampleX, sampleWidth, warp);
    ctx.fillText(char, cursor, charY);
    cursor += charWidth + letterSpacing;
  }
}

function drawPathTextGlyph(
  ctx: OffscreenCanvasRenderingContext2D,
  char: string,
  x: number,
  y: number,
  angle: number,
  charWidth: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillText(char, -charWidth / 2, 0);
  ctx.restore();
}

function measurePointBounds(points: ImageVectorPathPoint[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function measurePathLength(points: ImageVectorPathPoint[], closed: boolean): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenPoints(points[index - 1]!, points[index]!);
  }
  if (closed && points.length > 1) {
    total += distanceBetweenPoints(points[points.length - 1]!, points[0]!);
  }
  return total;
}

function samplePointOnPath(
  points: ImageVectorPathPoint[],
  distance: number,
  closed: boolean,
): { x: number; y: number; angle: number } | null {
  if (points.length < 2) return null;
  const segments = buildPathSegments(points, closed);
  if (segments.length === 0) return null;
  let remaining = Math.max(0, distance);
  for (const segment of segments) {
    if (remaining <= segment.length || segment === segments[segments.length - 1]) {
      const t = segment.length > 0 ? Math.min(1, Math.max(0, remaining / segment.length)) : 0;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * t,
        y: segment.from.y + (segment.to.y - segment.from.y) * t,
        angle: Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x),
      };
    }
    remaining -= segment.length;
  }
  return null;
}

function buildPathSegments(points: ImageVectorPathPoint[], closed: boolean): Array<{
  from: ImageVectorPathPoint;
  to: ImageVectorPathPoint;
  length: number;
}> {
  const segments: Array<{ from: ImageVectorPathPoint; to: ImageVectorPathPoint; length: number }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    segments.push({ from, to, length: distanceBetweenPoints(from, to) });
  }
  if (closed && points.length > 1) {
    const from = points[points.length - 1]!;
    const to = points[0]!;
    segments.push({ from, to, length: distanceBetweenPoints(from, to) });
  }
  return segments.filter((segment) => segment.length > 0);
}

function distanceBetweenPoints(a: ImageVectorPathPoint, b: ImageVectorPathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function sampleBezierSegments(
  segments: TextLayerBezierSegment[],
  samplesPerSegment: number,
): ImageVectorPathPoint[] {
  const points: ImageVectorPathPoint[] = [];
  for (const segment of segments) {
    for (let sample = 0; sample <= samplesPerSegment; sample += 1) {
      if (points.length > 0 && sample === 0) continue;
      points.push(sampleCubicBezier(segment, sample / samplesPerSegment));
    }
  }
  return points;
}

function sampleCubicBezier(segment: TextLayerBezierSegment, t: number): ImageVectorPathPoint {
  const mt = 1 - t;
  const x = mt ** 3 * segment.from.x
    + 3 * mt ** 2 * t * segment.control1.x
    + 3 * mt * t ** 2 * segment.control2.x
    + t ** 3 * segment.to.x;
  const y = mt ** 3 * segment.from.y
    + 3 * mt ** 2 * t * segment.control1.y
    + 3 * mt * t ** 2 * segment.control2.y
    + t ** 3 * segment.to.y;
  return { x: Math.round(x), y: Math.round(y) };
}

function isFinitePoint(point: ImageVectorPathPoint | undefined): point is ImageVectorPathPoint {
  if (!point) return false;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isFiniteVectorPathPoint(point: ImageVectorPathPoint): boolean {
  return isFinitePoint(point)
    && (point.inHandle === undefined || isFinitePoint(point.inHandle))
    && (point.outHandle === undefined || isFinitePoint(point.outHandle));
}

function translateImageTextPathPoint(
  point: ImageVectorPathPoint,
  offsetX: number,
  offsetY: number,
): ImageVectorPathPoint {
  return {
    x: Math.round(point.x + offsetX),
    y: Math.round(point.y + offsetY),
  };
}

function roundPoint(point: ImageVectorPathPoint): ImageVectorPathPoint {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function measureSpacedLine(
  line: string,
  letterSpacing: number,
  measureLine: (line: string) => number,
): number {
  if (!line) return measureLine(' ');
  return measureLine(line) + Math.max(0, line.length - 1) * letterSpacing;
}

function warpOffset(x: number, width: number, warp: ImageTextLayerStyle['warp']): number {
  if (warp === 'none' || width <= 0) return 0;
  const centered = warp === 'bulge'
    ? Math.min(0.5, Math.max(-0.5, x / width - 0.5))
    : x / width - 0.5;
  if (warp === 'arc') return -Math.cos(centered * Math.PI) * 8 + 8;
  if (warp === 'bulge') {
    const normalized = centered * 2;
    return (1 - normalized ** 2) * 12;
  }
  return Math.sin(centered * Math.PI * 2) * 5;
}

function imageTextWarpPadding(warp: ImageTextLayerStyle['warp']): number {
  if (warp !== 'bulge') return 0;
  return IMAGE_TEXT_WARP_MAX_DISPLACEMENT + 1;
}

function isVerticalImageTextStyle(style: Pick<ImageTextLayerStyle, 'orientation'>): boolean {
  return style.orientation === 'vertical-rl' || style.orientation === 'vertical-lr';
}

function applyCanvasTypographySettings(
  ctx: OffscreenCanvasRenderingContext2D,
  style: Pick<ImageTextLayerStyle, 'fontKerning' | 'fontVariantCaps' | 'managedFace'>,
): void {
  const typographyContext = ctx as unknown as {
    fontKerning?: ImageTextLayerStyle['fontKerning'];
    fontStretch?: string;
    fontVariantCaps?: ImageTextLayerStyle['fontVariantCaps'];
  };
  typographyContext.fontKerning = style.fontKerning;
  if (style.managedFace) typographyContext.fontStretch = `${style.managedFace.stretchPercent}%`;
  // Canvas font shorthand cannot express `all-small-caps`, so it is applied through this context
  // property after the font shorthand is set. The retained text content is left unchanged.
  typographyContext.fontVariantCaps = style.fontVariantCaps;
}

/** Canvas 2D has no standard variable-coordinate setter. Do not paint a default instance as exact. */
export function assertCanvasCanPaintManagedImageText(style: Pick<ImageTextLayerStyle, 'managedFace'>): void {
  const coordinates = style.managedFace?.variationSettings;
  if (coordinates && Object.keys(coordinates).length > 0) {
    throw new Error('Exact managed variable-font coordinates require the supported Paper shaping route; Canvas 2D raster paint is blocked rather than substituting the default instance.');
  }
}

function buildImageTextLiveEditStatusDescriptor(editable: boolean): ImageTextLiveEditStatusDescriptor {
  return {
    status: editable ? 'retained-live-edit' : 'metadata-only',
    editable,
    retainedMetadata: true,
    caveats: [
      'Live edits update Sloom Studio text metadata and regenerate a canvas raster preview.',
    ],
  };
}

function buildImageTextFontDiscoveryDescriptor(
  persistence: ImageTextFontPersistenceDescriptor,
): ImageTextFontDiscoveryDescriptor {
  return {
    status: 'fallback-stack-recorded',
    requestedFamily: persistence.requestedFamily,
    preferredFamily: persistence.preferredFamily,
    fallbackFamilies: persistence.fallbackFamilies,
    warning: 'Browser canvas font resolution is environment-dependent; keep the full stack for deterministic metadata.',
  };
}

function buildImageTextOpenTypeSupportDescriptor(
  features: SerializedImageTextOpenTypeFeatures,
): ImageTextOpenTypeSupportDescriptor {
  const supportedTags = [...features.disabled, ...features.enabled].sort();
  const unsupportedTags = features.unsupported ?? [];
  return {
    status: unsupportedTags.length
      ? 'unsupported-tags-ignored'
      : supportedTags.length
        ? 'supported-subset'
        : 'default-features',
    supportedTags,
    unsupportedTags,
    css: features.css,
  };
}

function buildImageTextRasterPreviewDescriptor(rasterizedPreview: boolean): ImageTextRasterPreviewDescriptor {
  return {
    status: rasterizedPreview ? 'rasterized-from-retained-text' : 'missing-raster-preview',
    editableSource: 'retained-text-style',
    caveat: rasterizedPreview
      ? 'Preview pixels are rasterized for canvas/export and are not native editable glyph outlines.'
      : 'Retained text metadata can be edited, but the layer has no current canvas raster preview.',
  };
}

function buildNativePsdTextRoundtripDescriptor(): ImageTextNativePsdTextRoundtripDescriptor {
  return {
    status: 'limited',
    warningCode: 'native-psd-editable-text-subset',
    message: 'PSD export writes native editable records for ordinary horizontal unwarped solid-colour text; path, vertical, warped, masked, effected, and unsupported-style text remains raster fallback with retained Sloom Studio metadata.',
  };
}

function buildImageTextTypographyReadinessLayerDescriptor(
  layer: ImageLayer,
): ImageTextTypographyReadinessLayerDescriptor {
  const retainedText = Boolean(layer.text);
  const editable = retainedText ? layer.metadata?.editableText ?? layer.type === 'text' : false;
  const stylePackage = layer.text ? serializeImageTextStylePackage(layer.text) : null;
  const fontPersistence = layer.text ? describeImageTextFontPersistence(layer.text.fontFamily) : null;
  const fontDiscovery = fontPersistence ? buildImageTextFontDiscoveryDescriptor(fontPersistence) : null;
  const openTypeSupport = stylePackage
    ? buildImageTextOpenTypeSupportDescriptor(stylePackage.characterStyle.openTypeFeatures)
    : null;
  const nativePsdTextWarning = retainedText ? buildNativePsdTextRoundtripDescriptor() : null;
  const retainedEditability = buildImageTextTypographyRetainedEditabilityDescriptor(layer, retainedText, editable);
  const blockers = buildImageTextTypographyLayerBlockers(layer, retainedText, editable);
  const warnings = buildImageTextTypographyLayerWarnings({
    layer,
    retainedText,
    stylePackage,
    fontPersistence,
    openTypeSupport,
    nativePsdTextWarning,
  });
  const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'limited' : 'ready';

  return {
    layerId: layer.id,
    name: layer.name,
    status,
    retainedText,
    retainedEditability,
    stylePackage,
    fontPersistence,
    fontDiscovery,
    openTypeSupport,
    nativePsdTextWarning,
    blockers,
    warnings,
    previewSignature: `image-text-readiness-layer:v1:${JSON.stringify({
      layerId: layer.id,
      status,
      retained: retainedText,
      editable,
      locked: layer.locked,
      bitmapVersion: layer.bitmapVersion,
      styleSignature: stylePackage?.preview.signature ?? null,
      blockerCodes: blockers.map((blocker) => blocker.code),
      warningCodes: warnings.map((warning) => warning.code),
    })}`,
  };
}

function buildImageTextFindReplaceReadinessOperation(
  layers: ImageLayer[],
  request: ImageTextFindReplaceRequest | null,
): ImageTextFindReplaceReadinessOperation {
  const requested = request !== null;
  const plan = planImageTextFindReplace(layers, request ?? { find: '', replace: '' });
  const blockers: ImageTextTypographyReadinessIssue[] = [];

  if (requested && request.find.trim().length === 0) {
    blockers.push({
      code: 'empty-find-query',
      scope: 'operation',
      message: 'Find/replace requires a non-empty search query.',
    });
  }
  if (requested && plan.searchableTextLayers.length === 0) {
    blockers.push({
      code: 'no-searchable-text-layers',
      scope: 'operation',
      message: 'Find/replace requires at least one editable retained text layer.',
    });
  }

  const status = blockers.length > 0 ? 'blocked' : 'ready';
  return {
    status,
    affectedLayerIds: plan.affectedLayerIds,
    plan,
    blockers,
    warnings: [],
    previewSignature: blockers.length
      ? `image-text-readiness-find-replace:v1:${JSON.stringify({
          status,
          blockerCodes: blockers.map((blocker) => blocker.code),
          planSignature: plan.previewSignature,
        })}`
      : plan.previewSignature,
  };
}

function buildImageTextSpellcheckReadabilityReadinessOperation(
  layers: ImageLayer[],
): ImageTextSpellcheckReadabilityReadinessOperation {
  const plan = planImageTextSpellcheckReadability(layers);
  const blockers: ImageTextTypographyReadinessIssue[] = [];
  if (plan.searchableTextLayers.length === 0) {
    blockers.push({
      code: 'no-searchable-text-layers',
      scope: 'operation',
      message: 'Spellcheck/readability planning requires at least one editable retained text layer.',
    });
  }
  const warnings = buildImageTextSpellcheckReadabilityWarnings();
  return {
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'limited' : 'ready',
    affectedLayerIds: plan.affectedLayerIds,
    readability: plan.readability,
    plan,
    blockers,
    warnings,
    previewSignature: plan.previewSignature,
  };
}

function buildImageTextNativePsdTextReadinessOperation(
  layerReadiness: ImageTextTypographyReadinessLayerDescriptor[],
): ImageTextNativePsdTextReadinessOperation {
  return {
    status: 'limited',
    warningCode: 'native-psd-editable-text-subset',
    affectedLayerIds: layerReadiness.filter((layer) => layer.retainedText).map((layer) => layer.layerId),
    message: 'PSD-native text records are available for the bounded horizontal unwarped solid-colour subset; other retained text uses raster fallback plus Sloom Studio metadata.',
  };
}

function buildImageTextExportSourceBinHandoffCaveats(
  layers: ImageLayer[],
  retainedTextLayerIds: string[],
  flattenedLayerIds: string[],
): ImageTextExportSourceBinHandoffCaveat[] {
  const caveats: ImageTextExportSourceBinHandoffCaveat[] = [];
  if (retainedTextLayerIds.length > 0) {
    caveats.push({
      code: 'export-flattens-live-type',
      scope: 'export',
      layerIds: retainedTextLayerIds,
      message: 'Visible image exports and source-bin thumbnails flatten text to pixels; Sloom Studio text metadata must travel as sidecar project data to stay editable.',
    });
  }

  const fallbackLayerIds = layers
    .filter((layer) => layer.text && shouldWarnImageTextFontFallback(layer.text.fontFamily))
    .map((layer) => layer.id);
  if (fallbackLayerIds.length > 0) {
    caveats.push({
      code: 'font-fallback-on-reopen',
      scope: 'source-bin',
      layerIds: fallbackLayerIds,
      message: 'Source-bin handoff retains font-family stacks, but reopened previews may resolve to installed fallbacks.',
    });
  }

  const openTypeLayerIds = layers
    .filter((layer) => {
      if (!layer.text) return false;
      const features = serializeImageTextStylePackage(layer.text).characterStyle.openTypeFeatures;
      return features.enabled.length > 0 || features.disabled.length > 0 || Boolean(features.unsupported?.length);
    })
    .map((layer) => layer.id);
  if (openTypeLayerIds.length > 0) {
    caveats.push({
      code: 'opentype-support-on-reopen',
      scope: 'source-bin',
      layerIds: openTypeLayerIds,
      message: 'OpenType feature intent is serialized, but glyph support after handoff depends on the resolved font.',
    });
  }

  const textOnPathLayerIds = layers
    .filter((layer) => layer.text?.pathReference && layer.text.pathLayout)
    .map((layer) => layer.id);
  if (textOnPathLayerIds.length > 0) {
    caveats.push({
      code: 'text-on-path-style-handoff',
      scope: 'source-bin',
      layerIds: textOnPathLayerIds,
      message: 'Text-on-path handoff keeps the vector path reference and text style metadata, but exported/source-bin previews flatten the current glyph layout to pixels.',
    });
  }

  if (flattenedLayerIds.length > 0) {
    caveats.push({
      code: 'flattened-text-not-recoverable',
      scope: 'source-bin',
      layerIds: flattenedLayerIds,
      message: 'Flattened lettering without retained text metadata cannot be recovered as editable text from source-bin assets.',
    });
  }

  return caveats;
}

function buildImageTextTypographyRetainedEditabilityDescriptor(
  layer: ImageLayer,
  retainedText: boolean,
  editable: boolean,
): ImageTextLiveEditStatusDescriptor {
  if (!retainedText) {
    return {
      status: 'not-editable',
      editable: false,
      retainedMetadata: false,
      caveats: ['Layer does not include retained Sloom Studio text metadata.'],
    };
  }
  if (!editable) {
    return {
      status: 'metadata-only',
      editable: false,
      retainedMetadata: true,
      caveats: ['Text metadata is retained for warning/interop state, but local text mutation is disabled.'],
    };
  }
  return buildImageTextLiveEditStatusDescriptor(layer.metadata?.editableText ?? true);
}

function buildImageTextTypographyLayerBlockers(
  layer: ImageLayer,
  retainedText: boolean,
  editable: boolean,
): ImageTextTypographyReadinessIssue[] {
  const blockers: ImageTextTypographyReadinessIssue[] = [];
  if (layer.text?.managedFaceIssue) {
    blockers.push({
      code: 'unresolved-managed-font',
      scope: 'layer',
      layerId: layer.id,
      message: layer.text.managedFaceIssue.message,
    });
  }
  if (!retainedText) {
    blockers.push({
      code: 'missing-retained-text',
      scope: 'layer',
      layerId: layer.id,
      message: 'Layer does not retain editable Sloom Studio text metadata.',
    });
    return blockers;
  }
  if (!editable) {
    blockers.push({
      code: 'non-editable-text-metadata',
      scope: 'layer',
      layerId: layer.id,
      message: 'Layer has retained text metadata but is marked non-editable.',
    });
  }
  if (layer.locked) {
    blockers.push({
      code: 'locked-layer',
      scope: 'layer',
      layerId: layer.id,
      message: 'Layer is locked; retained text edits must be unblocked before mutation.',
    });
  }
  return blockers;
}

function buildImageTextTypographyLayerWarnings({
  layer,
  retainedText,
  stylePackage,
  fontPersistence,
  openTypeSupport,
  nativePsdTextWarning,
}: {
  layer: ImageLayer;
  retainedText: boolean;
  stylePackage: SerializedImageTextStylePackage | null;
  fontPersistence: ImageTextFontPersistenceDescriptor | null;
  openTypeSupport: ImageTextOpenTypeSupportDescriptor | null;
  nativePsdTextWarning: ImageTextNativePsdTextRoundtripDescriptor | null;
}): ImageTextTypographyReadinessIssue[] {
  if (!retainedText || !stylePackage || !fontPersistence || !openTypeSupport || !nativePsdTextWarning) return [];
  const warnings: ImageTextTypographyReadinessIssue[] = [];

  warnings.push(
    layer.bitmap
      ? {
          code: 'raster-preview-only',
          scope: 'layer',
          layerId: layer.id,
          message: 'Canvas raster preview is regenerated from retained text metadata and is not native live type.',
        }
      : {
          code: 'missing-raster-preview',
          scope: 'layer',
          layerId: layer.id,
          message: 'Retained text metadata has no current raster preview bitmap.',
        },
  );

  if (shouldWarnImageTextFontFallback(fontPersistence.requestedFamily)) {
    warnings.push({
      code: 'font-fallback-stack-recorded',
      scope: 'layer',
      layerId: layer.id,
      message: 'Font stack is persisted, but installed font discovery is browser-dependent.',
    });
  }
  if (openTypeSupport.unsupportedTags.length > 0) {
    warnings.push({
      code: 'opentype-unsupported-tags-ignored',
      scope: 'layer',
      layerId: layer.id,
      message: `Unsupported OpenType tags were ignored: ${openTypeSupport.unsupportedTags.join(', ')}.`,
    });
  }
  if (openTypeSupport.supportedTags.length > 0) {
    warnings.push({
      code: 'opentype-feature-caveat',
      scope: 'layer',
      layerId: layer.id,
      message: 'OpenType feature intent is persisted, but actual glyph support depends on the resolved font.',
    });
  }
  if (layer.text?.warp !== 'none') {
    warnings.push({
      code: 'text-warp-rasterized',
      scope: 'layer',
      layerId: layer.id,
      message: 'Text warp intent is retained, but preview/export is a rasterized approximation.',
    });
  }
  warnings.push({
    code: nativePsdTextWarning.warningCode,
    scope: 'layer',
    layerId: layer.id,
    message: nativePsdTextWarning.message,
  });

  return warnings;
}

function buildImageTextSpellcheckReadabilityWarnings(): ImageTextTypographyReadinessIssue[] {
  return [];
}

function shouldWarnImageTextFontFallback(fontFamily: string): boolean {
  const catalog = describeImageTextFontCatalog(fontFamily);
  return catalog.customFamily !== null && splitFontFamilyStack(fontFamily).length > 1;
}

function normalizeImageTextOrientation(value: ImageTextLayerStyle['orientation'] | undefined): NonNullable<ImageTextLayerStyle['orientation']> {
  return value === 'vertical-rl' || value === 'vertical-lr' ? value : 'horizontal';
}

function normalizeRasterDimension(value: number): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(value));
}

function assertRequestedImageTextBoxDimensions(style: Partial<ImageTextLayerStyle>): void {
  const width = style.boxWidth;
  const height = style.boxHeight;
  const widthIsUnsafe = width !== null && width !== undefined
    && (!Number.isFinite(width) || width > IMAGE_TEXT_RASTER_MAX_DIMENSION);
  const heightIsUnsafe = height !== null && height !== undefined
    && (!Number.isFinite(height) || height > IMAGE_TEXT_RASTER_MAX_DIMENSION);
  if (widthIsUnsafe || heightIsUnsafe) {
    assertImageTextRasterAllocation(width ?? 1, height ?? 1);
  }
}

function formatRasterDimension(value: number): string {
  return Number.isFinite(value) ? String(value) : 'unbounded';
}

function normalizeFontKerning(value: ImageTextLayerStyle['fontKerning'] | undefined): ImageTextLayerStyle['fontKerning'] {
  return value === 'normal' || value === 'none' ? value : 'auto';
}

function normalizeFontVariantCaps(value: ImageTextLayerStyle['fontVariantCaps'] | undefined): ImageTextLayerStyle['fontVariantCaps'] {
  return value === 'small-caps' || value === 'all-small-caps' ? value : 'normal';
}

function normalizeImageTextWarp(value: ImageTextLayerStyle['warp'] | undefined): ImageTextLayerStyle['warp'] {
  return value === 'arc' || value === 'flag' || value === 'bulge' ? value : 'none';
}

function inferImageTextOpenTypeFeatures(
  style: Pick<ImageTextLayerStyle, 'fontVariantCaps'>,
): ImageTextOpenTypeFeatureDescriptor {
  if (style.fontVariantCaps === 'all-small-caps') {
    return { enabled: ['c2sc', 'smcp'], disabled: [] };
  }
  if (style.fontVariantCaps === 'small-caps') {
    return { enabled: ['smcp'], disabled: [] };
  }
  return { enabled: [], disabled: [] };
}

function serializeImageTextOpenTypeFeatures(
  descriptor: Partial<ImageTextOpenTypeFeatureDescriptor> | null | undefined,
): SerializedImageTextOpenTypeFeatures {
  const normalized = normalizeImageTextOpenTypeFeatures(descriptor);
  const css = [
    ...normalized.disabled.map((tag) => `'${tag}' 0`),
    ...normalized.enabled.map((tag) => `'${tag}' 1`),
  ].join(', ');

  const serialized: SerializedImageTextOpenTypeFeatures = {
    ...normalized,
    css,
  };
  if (serialized.unsupported?.length === 0) {
    delete serialized.unsupported;
  }
  return serialized;
}

function buildImageTextStyleSerializationWarnings(
  style: ImageTextLayerStyle,
  features: SerializedImageTextOpenTypeFeatures,
): string[] {
  const warnings: string[] = [];
  if (features.unsupported?.length) {
    warnings.push(
      `OpenType feature tags must be exactly four alphanumeric characters; unsupported tags were ignored: ${features.unsupported.join(', ')}.`,
    );
  }
  if (style.warp !== 'none') {
    warnings.push('Arc, flag, and bulge text warps are rasterized approximations and are not editable vector type.');
  }
  return warnings;
}

function buildImageTextStylePreview(
  style: ImageTextLayerStyle,
  features: SerializedImageTextOpenTypeFeatures,
): ImageTextStylePreviewDescriptor {
  const lines = splitTextLines(style.content);
  const signatureParts = [
    'text',
    String(style.content.length),
    style.fontFamily,
    String(style.fontSize),
    style.fontWeight,
    style.fontStyle,
    style.fontVariantCaps,
    buildOpenTypeFeatureSignature(features),
    style.align,
    String(style.lineHeight),
    style.boxWidth ?? 'auto',
    style.fontKerning,
    style.warp,
  ];
  if (style.managedFace) signatureParts.push(bundledFontFaceIdentitySignature(style.managedFace));
  if (style.managedFaceIssue) signatureParts.push(JSON.stringify(style.managedFaceIssue));
  if (isVerticalImageTextStyle(style)) {
    signatureParts.push(style.orientation!);
  }
  return {
    contentLength: style.content.length,
    lineCount: lines.length,
    signature: signatureParts.join(':'),
  };
}

function buildOpenTypeFeatureSignature(features: SerializedImageTextOpenTypeFeatures): string {
  const disabled = features.disabled.map((tag) => `${tag}=0`);
  const enabled = features.enabled.map((tag) => `${tag}=1`);
  return [...disabled, ...enabled].join('|') || 'default';
}

function normalizeOpenTypeFeatureTagList(tags: string[] | undefined): { supported: string[]; unsupported: string[] } {
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const tag of tags ?? []) {
    const normalized = tag.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) continue;
    if (/^[a-z0-9]{4}$/.test(normalized)) {
      supported.push(normalized);
    } else {
      unsupported.push(normalized);
    }
  }
  return {
    supported: [...new Set(supported)].sort(),
    unsupported: [...new Set(unsupported)].sort(),
  };
}

function splitFontFamilyStack(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function dedupeInstalledFonts(fonts: ImageTextInstalledFontEntry[]): ImageTextInstalledFontEntry[] {
  const seen = new Set<string>();
  const result: ImageTextInstalledFontEntry[] = [];
  for (const font of fonts) {
    const family = font.family?.trim();
    if (!family) continue;
    const entry: ImageTextInstalledFontEntry = {
      family,
      ...(font.fullName?.trim() ? { fullName: font.fullName.trim() } : {}),
      ...(font.postscriptName?.trim() ? { postscriptName: font.postscriptName.trim() } : {}),
      ...(font.style?.trim() ? { style: font.style.trim() } : {}),
    };
    const key = [
      normalizeFontStackForComparison(entry.family),
      normalizeFontStackForComparison(entry.fullName ?? ''),
      normalizeFontStackForComparison(entry.postscriptName ?? ''),
      normalizeFontStackForComparison(entry.style ?? ''),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.sort((a, b) => a.family.localeCompare(b.family) || (a.style ?? '').localeCompare(b.style ?? ''));
}

function segmentTextGraphemes(content: string): string[] {
  const maybeIntl = globalThis.Intl as typeof Intl & {
    Segmenter?: new (locale?: string, options?: { granularity?: 'grapheme' | 'word' | 'sentence' }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  };
  if (typeof maybeIntl.Segmenter === 'function') {
    const segmenter = new maybeIntl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(content)]
      .map((part) => part.segment);
  }
  return Array.from(content);
}

function detectBidiRuns(content: string): Array<'ltr' | 'rtl'> {
  const runs: Array<'ltr' | 'rtl'> = [];
  for (const char of content) {
    if (/[\u0590-\u08ff]/u.test(char)) {
      runs.push('rtl');
    } else if (/[A-Za-z0-9]/.test(char)) {
      runs.push('ltr');
    }
  }
  return dedupeBidiRuns(runs);
}

function dedupeBidiRuns(runs: Array<'ltr' | 'rtl'>): Array<'ltr' | 'rtl'> {
  return [...new Set(runs)];
}

function normalizeFontStackForComparison(fontFamily: string): string {
  return splitFontFamilyStack(fontFamily)
    .map((family) => family.toLowerCase())
    .join(',');
}

function normalizeOptionalDimension(value: number | null | undefined, min: number, max: number): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
