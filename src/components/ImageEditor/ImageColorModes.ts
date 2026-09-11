export interface RgbBitmapInput {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type ImageWorkflowColorMode = 'rgb' | 'cmyk' | 'lab' | 'grayscale' | 'indexed';
export type ImageWorkflowBitDepth = 8 | 16 | 32;
export type ImageWorkflowOperation = 'paint' | 'adjustments' | 'filters' | 'export';
export type ImageWorkflowPolicy = 'native' | 'rgb-preview-only' | 'convert-to-8bit-rgb' | 'unsupported';
export type ColorModeOperationConstraintCode =
  | 'native-8bit-rgb'
  | 'high-bit-rgb-downsample'
  | 'grayscale-rgb-conversion'
  | 'cmyk-proof-preview-only'
  | 'lab-external-conversion'
  | 'indexed-palette-expansion';
export type ColorModeOperationExportImplication =
  | 'native-rgb-export'
  | 'downgraded-rgb-export'
  | 'rgb-export-after-conversion'
  | 'rgb-export-with-proof-metadata'
  | 'external-export-required';
export type ColorModePreviewPipeline =
  | 'browser-rgb-canvas'
  | 'rgb-luminance-preview'
  | 'rgb-formula-cmyk-preview'
  | 'unsupported';
export type ColorModeProfilePolicy = 'browser-rgb-only' | 'label-only' | 'unsupported';
export type ColorModeProfileTransformBlockerCode =
  | 'icc-transform-unavailable'
  | 'rgb-browser-canvas-only'
  | 'grayscale-external-conversion-required'
  | 'cmyk-external-prepress-required'
  | 'lab-external-conversion-required'
  | 'indexed-external-reindex-required';

export interface ColorModeChannelDescriptor {
  id: string;
  label: string;
  previewRole: 'composite' | 'channel';
}

export interface ColorModeChannelPreviewDescriptor {
  colorMode: ImageWorkflowColorMode;
  previewKind: 'native' | 'rgb-preview-only' | 'unsupported';
  channels: ColorModeChannelDescriptor[];
  warnings: string[];
}

export interface ColorModeWorkflowPreviewDescriptor extends ColorModeChannelPreviewDescriptor {
  pipeline: ColorModePreviewPipeline;
}

export interface ColorModeOperationPolicy {
  colorMode: ImageWorkflowColorMode;
  bitDepth: ImageWorkflowBitDepth;
  operation: ImageWorkflowOperation;
  supported: boolean;
  workflow: ImageWorkflowPolicy;
  constraintCode: ColorModeOperationConstraintCode;
  externalConversionRequired: boolean;
  exportImplication: ColorModeOperationExportImplication;
  warnings: string[];
}

export interface ColorModeOperationCompatibilityDescriptor extends ColorModeOperationPolicy {
  previewId: string;
}

export interface ColorModeProfileDescriptor {
  requestedProfileLabel: string | null;
  iccTransformAvailable: false;
  appliedPolicy: ColorModeProfilePolicy;
  limitations: string[];
}

export interface ColorModePrintDescriptor {
  pressReady: false;
  warnings: string[];
}

export interface ColorModeWorkflowDescriptor {
  colorMode: ImageWorkflowColorMode;
  bitDepth: ImageWorkflowBitDepth;
  preview: ColorModeWorkflowPreviewDescriptor;
  profile: ColorModeProfileDescriptor;
  operations: Record<ImageWorkflowOperation, ColorModeOperationPolicy>;
  print: ColorModePrintDescriptor;
  warnings: string[];
}

export type ColorModeCapabilityStatus = 'native' | 'preview-only' | 'conversion-required' | 'unsupported';

export interface ColorModeCapabilityDescriptor {
  status: ColorModeCapabilityStatus;
  canEditPixels: boolean;
  canPreviewComposite: boolean;
  canExportWithoutConversion: boolean;
  channelCount: number;
}

export interface ColorModeConversionPlanDescriptor {
  required: boolean;
  flatteningRequired: boolean;
  targetMode: 'rgb';
  targetBitDepth: 8;
  limitations: string[];
}

export interface ColorModePrecisionDescriptor {
  sourceBitDepth: ImageWorkflowBitDepth;
  workingBitDepth: 8;
  channelPrecision: string;
  notes: string[];
}

export interface ColorModeBitDepthPipelineContract {
  sourceBits: ImageWorkflowBitDepth;
  workingBits: 8;
  convertedBits: 8;
  lossSurface: 'none' | 'quantization-banding' | 'dynamic-range-clamp';
  warnings: string[];
}

export interface ColorModePlanningPreviewDescriptor {
  id: string;
  pipeline: ColorModePreviewPipeline;
  previewKind: ColorModeChannelPreviewDescriptor['previewKind'];
  signature: string;
}

export interface ColorModeProfileTransformDescriptor {
  status: 'unsupported';
  requestedProfileLabel: string | null;
  iccConversionAvailable: false;
  transformIntentSupport: 'none';
  blockerCodes: ColorModeProfileTransformBlockerCode[];
  limitations: string[];
}

export interface ColorModeNativeExportDescriptor {
  canExportNative: false;
  exportColorMode: 'rgb';
  limitations: string[];
}

export interface ColorModeBitDepthPlanDescriptor {
  sourceBitDepth: ImageWorkflowBitDepth;
  storageBitDepth: 8;
  editBitDepth: 8;
  exportBitDepth: 8;
  highBitStorageSupported: false;
  highBitEditingSupported: false;
  highBitExportSupported: false;
  warnings: string[];
}

export type ImageBitDepthDocumentReadinessBlockerCode =
  | 'high-bit-depth-downsample'
  | 'high-bit-depth-export-unavailable';
export type ImageBitDepthOperationProcessingSurface = '8-bit-rgba-canvas' | '8-bit-visible-export';
export type ImageBitDepthSourceSamplePolicy =
  | 'native-8bit'
  | 'downsampled-to-8bit'
  | 'external-high-bit-master-required';

export interface ImageBitDepthDocumentOperationPolicy {
  operation: ImageWorkflowOperation;
  supported: boolean;
  blockerCode: ImageBitDepthDocumentReadinessBlockerCode | null;
  processingSurface: ImageBitDepthOperationProcessingSurface;
  sourceSamplePolicy: ImageBitDepthSourceSamplePolicy;
  message: string;
  printExportWarning: string | null;
}

export interface ImageBitDepthDocumentReadinessDescriptor {
  descriptorId: 'image-bit-depth-document-readiness:v1';
  documentId: string;
  sourceFormat: string;
  sourceBitDepth: ImageWorkflowBitDepth;
  storageBitDepth: 8;
  editBitDepth: 8;
  exportBitDepth: 8;
  highBitStorageSupported: false;
  highBitEditingSupported: false;
  highBitExportSupported: false;
  lossSurface: ColorModeBitDepthPipelineContract['lossSurface'];
  operationPolicies: ImageBitDepthDocumentOperationPolicy[];
  exportCaveats: string[];
  warnings: string[];
  signature: string;
}

export type ImageHighBitWorkflowOperationStatus = 'native-8bit' | 'downsample-required' | 'external-required' | 'unsupported';
export type ImageHighBitExportTarget = 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'psd' | 'exr' | 'cameraRaw';
export type ImageHighBitExportStatus = 'native-8bit' | '8bit-derivative' | '8bit-layered-metadata' | 'unsupported';
export type ImageHighBitWorkflowFallbackRoute =
  | 'external-high-bit-master'
  | '8bit-rgb-working-derivative'
  | 'psd-metadata-working-copy'
  | 'external-color-mode-conversion';
export type ImageHighBitUnsupportedStateCode =
  | 'native-high-bit-storage'
  | 'native-high-bit-editing'
  | 'native-high-bit-export'
  | 'native-cmyk-document'
  | 'native-grayscale-document'
  | 'native-lab-document'
  | 'indexed-palette-preservation'
  | 'icc-profile-transform';

export interface ImageHighBitOperationSupportDescriptor {
  operation: ImageWorkflowOperation;
  status: ImageHighBitWorkflowOperationStatus;
  supportedInEditor: boolean;
  sourcePrecisionPreserved: boolean;
  processingSurface: ImageBitDepthOperationProcessingSurface;
  fallbackRoute: ImageHighBitWorkflowFallbackRoute | null;
  message: string;
}

export interface ImageHighBitExportSupportDescriptor {
  target: ImageHighBitExportTarget;
  status: ImageHighBitExportStatus;
  supported: boolean;
  highBitPreserved: boolean;
  colorModePreserved: boolean;
  fallbackRoute: ImageHighBitWorkflowFallbackRoute | null;
  message: string;
}

export interface ImageHighBitWorkflowFallbackRecommendation {
  route: ImageHighBitWorkflowFallbackRoute;
  label: string;
  preserves: string;
  recommendedFor: string;
  caveat: string;
}

export interface ImageHighBitUnsupportedState {
  code: ImageHighBitUnsupportedStateCode;
  message: string;
}

export interface ImageHighBitWorkflowSupportMatrixDescriptor {
  descriptorId: 'image-high-bit-workflow-support-matrix:v1';
  sourceFormat: string;
  colorMode: ImageWorkflowColorMode;
  sourceBitDepth: ImageWorkflowBitDepth;
  workingBitDepth: 8;
  profileLabel: string | null;
  operationMatrix: Record<ImageWorkflowOperation, ImageHighBitOperationSupportDescriptor>;
  exportMatrix: Record<ImageHighBitExportTarget, ImageHighBitExportSupportDescriptor>;
  fallbackRecommendations: ImageHighBitWorkflowFallbackRecommendation[];
  unsupportedStates: ImageHighBitUnsupportedState[];
  stableSignature: string;
}

export interface ColorModePlanningDescriptor {
  colorMode: ImageWorkflowColorMode;
  modeLabel: string;
  bitDepth: ImageWorkflowBitDepth;
  capability: ColorModeCapabilityDescriptor;
  conversion: ColorModeConversionPlanDescriptor;
  precision: ColorModePrecisionDescriptor;
  bitDepthPipelineContract: ColorModeBitDepthPipelineContract;
  preview: ColorModePlanningPreviewDescriptor;
  profileTransform: ColorModeProfileTransformDescriptor;
  nativeExport: ColorModeNativeExportDescriptor;
  bitDepthPlan: ColorModeBitDepthPlanDescriptor;
  operationsMatrix: Record<ImageWorkflowOperation, ColorModeOperationCompatibilityDescriptor>;
  modeWorkflowLimitations: string[];
  profileWarnings: string[];
  outputWarnings: string[];
  warnings: string[];
  signature: string;
}

export type ImageColorModeReadinessStatus = 'ready' | 'conversion-required' | 'preview-only' | 'unsupported';
export type ImageColorModeReadinessBlockerCategory = 'conversion' | 'metadata-only' | 'unsupported' | 'print-export';
export type ImageColorModeReadinessBlockerCode =
  | 'color-conversion-required'
  | 'high-bit-depth-downsample'
  | 'icc-profile-metadata-only'
  | 'native-export-unavailable'
  | 'unsupported-color-mode';
export type ImageColorModeConversionPolicy = 'none' | 'external-conversion-required';

export interface ImageColorModeReadinessBlocker {
  code: ImageColorModeReadinessBlockerCode;
  category: ImageColorModeReadinessBlockerCategory;
  message: string;
}

export interface ImageColorModeReadinessPolicyDescriptor {
  nativeDocumentMode: boolean;
  editPolicy: ImageWorkflowPolicy;
  profilePolicy: ColorModeProfilePolicy;
  conversionPolicy: ImageColorModeConversionPolicy;
}

export interface ImageColorModeReadinessPreviewState {
  id: string;
  pipeline: ColorModePreviewPipeline;
  previewKind: ColorModeChannelPreviewDescriptor['previewKind'];
  readOnly: boolean;
  deterministic: true;
  signature: string;
}

export interface ImageColorModePrintExportReadinessDescriptor {
  exportColorMode: 'rgb';
  exportsWithoutModeConversion: boolean;
  nativeModeExportReady: boolean;
  pressReady: false;
  implications: string[];
}

export type ImageColorModeUnsupportedStateCode =
  | 'native-cmyk-document'
  | 'native-cmyk-export'
  | 'native-grayscale-document'
  | 'native-grayscale-export'
  | 'native-lab-document'
  | 'native-lab-export'
  | 'indexed-palette-preservation'
  | 'native-high-bit-document'
  | 'icc-profile-transform';

export interface ImageColorModeUnsupportedState {
  code: ImageColorModeUnsupportedStateCode;
  message: string;
}

export interface ImageColorModeReadinessDescriptor {
  descriptorId: 'image-color-mode-readiness:v1';
  ready: boolean;
  status: ImageColorModeReadinessStatus;
  colorMode: ImageWorkflowColorMode;
  bitDepth: ImageWorkflowBitDepth;
  profileLabel: string | null;
  policy: ImageColorModeReadinessPolicyDescriptor;
  previewState: ImageColorModeReadinessPreviewState;
  bitDepthCaveats: string[];
  operationCaveats: Record<ImageWorkflowOperation, string[]>;
  conversionBlockers: ImageColorModeReadinessBlocker[];
  metadataOnlyBlockers: ImageColorModeReadinessBlocker[];
  printExport: ImageColorModePrintExportReadinessDescriptor;
  unsupportedStates: ImageColorModeUnsupportedState[];
  blockers: ImageColorModeReadinessBlocker[];
  previewSignature: string;
}

export type ImageColorModeOperationalExportPolicy = 'native-rgb' | 'flattened-rgb-with-metadata';
export type ImageColorModeOperationalDestructiveRisk = 'none' | 'requires-conversion' | 'unsupported';

export interface ImageColorModeOperationalStateDescriptor {
  colorMode: ImageWorkflowColorMode;
  modeLabel: string;
  bitDepth: ImageWorkflowBitDepth;
  profileLabel: string | null;
  nativeDocumentMode: boolean;
}

export interface ImageColorModeOperationalPolicyDescriptor {
  previewPolicy: ColorModeChannelPreviewDescriptor['previewKind'];
  conversionPolicy: ImageColorModeConversionPolicy;
  profilePolicy: ColorModeProfilePolicy;
  exportPolicy: ImageColorModeOperationalExportPolicy;
}

export interface ImageColorModeActionSuitabilityDescriptor {
  suitable: boolean;
  recordable: boolean;
  deterministic: true;
  destructiveRisk: ImageColorModeOperationalDestructiveRisk;
}

export interface ImageColorModeBatchSuitabilityDescriptor {
  suitable: boolean;
  reason: string;
}

export interface ImageColorModeBitDepthPreservationDescriptor {
  sourceBitDepth: ImageWorkflowBitDepth;
  preserved: boolean;
  blockers: string[];
}

export interface ImageColorModeOperationalReadinessDescriptor {
  descriptorId: 'image-color-mode-operational-readiness:v1';
  ready: boolean;
  state: ImageColorModeOperationalStateDescriptor;
  policy: ImageColorModeOperationalPolicyDescriptor;
  iccProfileLimitations: string[];
  previewAndConversionCaveats: string[];
  bitDepthPreservation: ImageColorModeBitDepthPreservationDescriptor;
  exportPrintCaveats: string[];
  unsupportedPhotoshopStates: string[];
  suiteHandoffGuidance: string[];
  actionSuitability: ImageColorModeActionSuitabilityDescriptor;
  batchSuitability: ImageColorModeBatchSuitabilityDescriptor;
  signature: string;
}

export type ImageNonRgbColorMode = 'cmyk' | 'lab' | 'indexed';
export type ImageNonRgbColorModeOperationStatus =
  | 'preview-only-blocked'
  | 'conversion-required'
  | 'unsupported'
  | 'external-required';
export type ImageNonRgbColorModeRequiredRoute =
  | 'external-icc-to-rgb'
  | 'external-lab-to-rgb'
  | 'expand-palette-to-rgb'
  | 'external-reindex-after-rgb-export';
export type ImageNonRgbColorModeBlockerCategory =
  | 'preview'
  | 'conversion'
  | 'export'
  | 'prepress'
  | 'bit-depth';
export type ImageNonRgbColorModeBlockerCode =
  | 'native-cmyk-editing'
  | 'native-cmyk-export-unavailable'
  | 'native-lab-preview-unavailable'
  | 'native-lab-editing'
  | 'native-lab-export-unavailable'
  | 'native-indexed-editing'
  | 'native-indexed-export-unavailable'
  | 'icc-transform-unavailable'
  | 'lab-conversion-external'
  | 'indexed-palette-preservation'
  | 'indexed-reindex-required'
  | 'black-generation-unavailable'
  | 'total-area-coverage-unavailable'
  | 'high-bit-depth-downsample';

export interface ImageNonRgbColorModeBlocker {
  code: ImageNonRgbColorModeBlockerCode;
  category: ImageNonRgbColorModeBlockerCategory;
  message: string;
}

export interface ImageNonRgbColorModePreviewStateDescriptor {
  pipeline: ColorModePreviewPipeline;
  previewKind: ColorModeChannelPreviewDescriptor['previewKind'];
  readOnly: true;
  deterministic: true;
  computedFromRgb: boolean;
  channelLabels: string[];
  caveats: string[];
  signature: string;
}

export interface ImageNonRgbColorModeOperationSupportDescriptor {
  operation: ImageWorkflowOperation;
  status: ImageNonRgbColorModeOperationStatus;
  supportedInEditor: false;
  actionRecordable: true;
  batchSuitable: false;
  requiredRoute: ImageNonRgbColorModeRequiredRoute;
  outputPixelSpace: 'RGB';
  blockers: ImageNonRgbColorModeBlockerCode[];
  caveats: string[];
  signature: string;
}

export interface ImageNonRgbColorModePrepressCheckDescriptor {
  gamutWarningAvailable: false;
  blackGenerationAvailable: false;
  totalAreaCoverageCheckAvailable: false;
  overprintSimulationAvailable: false;
  caveats: string[];
}

export interface ImageNonRgbColorModeActionSuitabilityDescriptor {
  suitable: false;
  recordable: true;
  deterministic: true;
  destructiveRisk: 'requires-external-conversion' | 'unsupported';
}

export interface ImageNonRgbColorModeSupportMatrixDescriptor {
  descriptorId: 'image-non-rgb-color-mode-support-matrix:v1';
  colorMode: ImageNonRgbColorMode;
  modeLabel: string;
  bitDepth: ImageWorkflowBitDepth;
  profileLabel: string | null;
  nativeDocumentMode: false;
  previewState: ImageNonRgbColorModePreviewStateDescriptor;
  operationMatrix: Record<ImageWorkflowOperation, ImageNonRgbColorModeOperationSupportDescriptor>;
  conversionBlockers: ImageNonRgbColorModeBlocker[];
  exportBlockers: ImageNonRgbColorModeBlocker[];
  prepressChecks: ImageNonRgbColorModePrepressCheckDescriptor;
  actionSuitability: ImageNonRgbColorModeActionSuitabilityDescriptor;
  batchSuitability: ImageColorModeBatchSuitabilityDescriptor;
  stableSignature: string;
}

export interface ColorModeConversionWarningInput {
  fromMode: ImageWorkflowColorMode;
  toMode: ImageWorkflowColorMode;
  fromBitDepth?: ImageWorkflowBitDepth;
  toBitDepth?: ImageWorkflowBitDepth;
}

export interface GrayscalePreview {
  width: number;
  height: number;
  colorMode: 'grayscale-preview';
  channelLabel: 'Luminance Gray';
  data: Uint8ClampedArray;
  gray: Uint8ClampedArray;
  warnings: string[];
}

export interface CmykPreviewChannel {
  id: 'cyan' | 'magenta' | 'yellow' | 'black';
  label: 'Cyan' | 'Magenta' | 'Yellow' | 'Black';
  data: Uint8ClampedArray;
}

export interface CmykSeparationPreview {
  width: number;
  height: number;
  colorMode: 'cmyk-separation-preview';
  profileLabel: 'Device RGB formula preview';
  nativeCmykExport: false;
  channels: CmykPreviewChannel[];
  alpha: Uint8ClampedArray;
  unsupportedModes: ['lab', 'indexed'];
  warnings: string[];
}

const HIGH_BIT_DEPTH_WARNINGS: Record<16 | 32, string> = {
  16: 'Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.',
  32: 'Converting from 32-bit to 8-bit removes HDR/floating-point precision and clamps the workflow to standard dynamic range RGB.',
};

const IMAGE_WORKFLOW_OPERATIONS: ImageWorkflowOperation[] = ['paint', 'adjustments', 'filters', 'export'];
const IMAGE_HIGH_BIT_EXPORT_TARGETS: ImageHighBitExportTarget[] = [
  'png',
  'jpeg',
  'webp',
  'avif',
  'tiff',
  'psd',
  'exr',
  'cameraRaw',
];

export function describeColorModeChannels(colorMode: ImageWorkflowColorMode): ColorModeChannelPreviewDescriptor {
  switch (colorMode) {
    case 'rgb':
      return {
        colorMode,
        previewKind: 'native',
        channels: [
          { id: 'composite', label: 'Composite RGB', previewRole: 'composite' },
          { id: 'red', label: 'Red', previewRole: 'channel' },
          { id: 'green', label: 'Green', previewRole: 'channel' },
          { id: 'blue', label: 'Blue', previewRole: 'channel' },
        ],
        warnings: [],
      };
    case 'grayscale':
      return {
        colorMode,
        previewKind: 'rgb-preview-only',
        channels: [
          { id: 'gray', label: 'Luminance Gray', previewRole: 'channel' },
        ],
        warnings: [
          'Grayscale mode is previewed through RGB luminance only; no native grayscale document mode or ICC grayscale conversion is available.',
        ],
      };
    case 'cmyk':
      return {
        colorMode,
        previewKind: 'rgb-preview-only',
        channels: [
          { id: 'cyan', label: 'Cyan', previewRole: 'channel' },
          { id: 'magenta', label: 'Magenta', previewRole: 'channel' },
          { id: 'yellow', label: 'Yellow', previewRole: 'channel' },
          { id: 'black', label: 'Black', previewRole: 'channel' },
        ],
        warnings: [
          'CMYK channels are formula previews from RGB pixels; no ICC CMYK conversion or native CMYK document mode is available.',
        ],
      };
    case 'lab':
      return {
        colorMode,
        previewKind: 'unsupported',
        channels: [],
        warnings: ['Lab channel previews are not available because Sloom Studio does not implement native Lab conversion or editing.'],
      };
    case 'indexed':
      return {
        colorMode,
        previewKind: 'unsupported',
        channels: [],
        warnings: ['Indexed color preview is not available because palette-preserving indexed workflows are not implemented.'],
      };
  }
}

export function getColorModeOperationPolicy(
  input: {
    colorMode: ImageWorkflowColorMode;
    bitDepth: ImageWorkflowBitDepth;
    operation: ImageWorkflowOperation;
  },
): ColorModeOperationPolicy {
  const { colorMode, bitDepth, operation } = input;

  if (colorMode === 'rgb' && bitDepth === 8) {
    return {
      colorMode,
      bitDepth,
      operation,
      supported: true,
      workflow: 'native',
      constraintCode: 'native-8bit-rgb',
      externalConversionRequired: false,
      exportImplication: 'native-rgb-export',
      warnings: [],
    };
  }

  if (colorMode === 'rgb' && bitDepth === 16) {
    return {
      colorMode,
      bitDepth,
      operation,
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'high-bit-rgb-downsample',
      externalConversionRequired: false,
      exportImplication: 'downgraded-rgb-export',
      warnings: ['16-bit RGB sources must be reduced to 8-bit RGB before adjustments run; highlight and gradient precision will be lost.'],
    };
  }

  if (colorMode === 'rgb' && bitDepth === 32) {
    return {
      colorMode,
      bitDepth,
      operation,
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'high-bit-rgb-downsample',
      externalConversionRequired: false,
      exportImplication: 'downgraded-rgb-export',
      warnings: ['32-bit RGB sources must be tone-mapped down to 8-bit RGB before filters run; HDR and floating-point precision will be lost.'],
    };
  }

  if (colorMode === 'grayscale') {
    return {
      colorMode,
      bitDepth,
      operation,
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'grayscale-rgb-conversion',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-after-conversion',
      warnings: ['Grayscale documents are edited through RGB conversion only; native grayscale paint and channel math are unavailable.'],
    };
  }

  if (colorMode === 'cmyk') {
    return {
      colorMode,
      bitDepth,
      operation,
      supported: false,
      workflow: 'rgb-preview-only',
      constraintCode: 'cmyk-proof-preview-only',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-with-proof-metadata',
      warnings: ['CMYK editing is unavailable; only RGB-based soft proof metadata and formula channel previews exist.'],
    };
  }

  if (colorMode === 'lab') {
    return {
      colorMode,
      bitDepth,
      operation,
      supported: false,
      workflow: 'unsupported',
      constraintCode: 'lab-external-conversion',
      externalConversionRequired: true,
      exportImplication: 'external-export-required',
      warnings: ['Lab workflows are not implemented, so exports must convert elsewhere before entering Sloom Studio.'],
    };
  }

  return {
    colorMode,
    bitDepth,
    operation,
    supported: false,
    workflow: 'convert-to-8bit-rgb',
    constraintCode: 'indexed-palette-expansion',
    externalConversionRequired: true,
    exportImplication: 'rgb-export-after-conversion',
    warnings: ['Indexed color is not preserved during editing; convert to RGB first and expect palette loss.'],
  };
}

export function describeColorModeWorkflow(
  input: {
    colorMode: ImageWorkflowColorMode;
    bitDepth: ImageWorkflowBitDepth;
    profileLabel?: string;
  },
): ColorModeWorkflowDescriptor {
  const preview = describeColorModeChannels(input.colorMode);
  const operations = IMAGE_WORKFLOW_OPERATIONS.reduce<Record<ImageWorkflowOperation, ColorModeOperationPolicy>>(
    (accumulator, operation) => {
      accumulator[operation] = getColorModeOperationPolicy({
        colorMode: input.colorMode,
        bitDepth: input.bitDepth,
        operation,
      });
      return accumulator;
    },
    {} as Record<ImageWorkflowOperation, ColorModeOperationPolicy>,
  );
  const profile = describeColorModeProfile(input.colorMode, input.profileLabel);
  const print = describeColorModePrint(input.colorMode);

  return {
    colorMode: input.colorMode,
    bitDepth: input.bitDepth,
    preview: {
      ...preview,
      pipeline: pipelineForColorMode(input.colorMode),
    },
    profile,
    operations,
    print,
    warnings: uniqueStrings([
      ...preview.warnings,
      ...profile.limitations,
      ...Object.values(operations).flatMap((operationPolicy) => operationPolicy.warnings),
      ...print.warnings,
    ]),
  };
}

export function buildColorModeConversionWarnings(input: ColorModeConversionWarningInput): string[] {
  const warnings: string[] = [];

  if (input.fromMode === 'cmyk' && input.toMode === 'rgb') {
    warnings.push('CMYK to RGB conversion inside Sloom Studio is only a formula preview; use an external ICC-aware tool for press-accurate conversion.');
  }

  if (input.fromMode === 'grayscale' && input.toMode === 'rgb') {
    warnings.push('Grayscale sources convert through luminance-only RGB preview data; no ICC grayscale transform is applied.');
  }

  if (input.fromMode === 'indexed' && input.toMode === 'rgb') {
    warnings.push('Indexed color conversion expands palette entries into flat RGB pixels; palette tables and exact index values are not preserved.');
  }

  if (input.fromMode === 'lab') {
    warnings.push('Lab conversion is not implemented in Sloom Studio; move the document through an external color-managed app before editing here.');
  }

  if (input.fromBitDepth && input.toBitDepth === 8 && input.fromBitDepth in HIGH_BIT_DEPTH_WARNINGS) {
    warnings.push(HIGH_BIT_DEPTH_WARNINGS[input.fromBitDepth as 16 | 32]);
  }

  return warnings;
}

export function describeColorModePlanningDescriptor(
  input: {
    colorMode: ImageWorkflowColorMode;
    bitDepth: ImageWorkflowBitDepth;
    profileLabel?: string;
  },
): ColorModePlanningDescriptor {
  const normalizedProfileLabel = normalizeProfileLabel(input.profileLabel);
  const channelPreview = describeColorModeChannels(input.colorMode);
  const capability = describeColorModeCapability(input.colorMode, input.bitDepth);
  const conversion = describeColorModeConversionPlan(input.colorMode);
  const precision = describeColorModePrecision(input.colorMode, input.bitDepth);
  const pipeline = pipelineForColorMode(input.colorMode);
  const bitDepthPipelineContract = buildColorModeBitDepthPipelineContract(input.bitDepth);
  const profileWarnings = buildColorModeProfileWarnings(normalizedProfileLabel);
  const profileTransform = buildColorModeProfileTransformDescriptor(input.colorMode, normalizedProfileLabel);
  const nativeExport = buildColorModeNativeExportDescriptor(input.colorMode);
  const bitDepthPlan = buildColorModeBitDepthPlanDescriptor(input.bitDepth);
  const operationsMatrix = buildColorModeOperationMatrix(input.colorMode, input.bitDepth);
  const modeWorkflowLimitations = buildColorModeWorkflowLimitations(input.colorMode);
  const outputWarnings = buildColorModeOutputWarnings(input.colorMode);
  const conversionWarnings = conversion.required
    ? buildColorModeConversionWarnings({
      fromMode: input.colorMode,
      toMode: 'rgb',
      fromBitDepth: input.bitDepth,
      toBitDepth: 8,
    })
    : [];

  return {
    colorMode: input.colorMode,
    modeLabel: labelForWorkflowColorMode(input.colorMode),
    bitDepth: input.bitDepth,
    capability,
    conversion,
    precision,
    bitDepthPipelineContract,
    preview: {
      id: `mode-preview:${input.colorMode}:${input.bitDepth}:${normalizedProfileLabel ?? 'unmanaged'}`,
      pipeline,
      previewKind: channelPreview.previewKind,
      signature: `${input.colorMode}:${input.bitDepth}:${pipeline}:${normalizedProfileLabel ?? 'unmanaged'}`,
    },
    profileTransform,
    nativeExport,
    bitDepthPlan,
    operationsMatrix,
    modeWorkflowLimitations,
    profileWarnings,
    outputWarnings,
    warnings: uniqueStrings([
      ...channelPreview.warnings,
      ...profileWarnings,
      ...profileTransform.limitations,
      ...nativeExport.limitations,
      ...bitDepthPlan.warnings,
      ...modeWorkflowLimitations,
      ...outputWarnings,
      ...conversion.limitations,
      ...conversionWarnings,
      ...precision.notes,
    ]),
    signature: `mode-plan:${input.colorMode}:${input.bitDepth}:${normalizedProfileLabel ?? 'unmanaged'}:${capability.status}`,
  };
}

export function describeImageColorModeReadiness(
  input: {
    colorMode: ImageWorkflowColorMode;
    bitDepth: ImageWorkflowBitDepth;
    profileLabel?: string;
  },
): ImageColorModeReadinessDescriptor {
  const planning = describeColorModePlanningDescriptor(input);
  const normalizedProfileLabel = normalizeProfileLabel(input.profileLabel);
  const profileSignatureLabel = normalizedProfileLabel ?? 'unmanaged';
  const status = colorModeReadinessStatusForCapability(planning.capability.status);
  const previewReadOnly = status !== 'ready';
  const profileDescriptor = describeColorModeProfile(input.colorMode, input.profileLabel);
  const conversionBlockers = buildColorModeReadinessConversionBlockers(planning);
  const metadataOnlyBlockers = buildColorModeReadinessMetadataOnlyBlockers(normalizedProfileLabel);
  const unsupportedBlockers = buildColorModeReadinessUnsupportedBlockers(input.colorMode);
  const printExport = buildColorModeReadinessPrintExport(input.colorMode, input.bitDepth);
  const printExportBlockers = buildColorModeReadinessPrintExportBlockers(input.colorMode, printExport);
  const blockers = dedupeColorModeReadinessBlockers([
    ...unsupportedBlockers,
    ...conversionBlockers,
    ...metadataOnlyBlockers,
    ...printExportBlockers,
  ]);
  const previewState = {
    id: `image-color-mode-readiness-preview:${input.colorMode}:${input.bitDepth}:${profileSignatureLabel}`,
    pipeline: planning.preview.pipeline,
    previewKind: planning.preview.previewKind,
    readOnly: previewReadOnly,
    deterministic: true,
    signature: buildColorModeReadinessPreviewStateSignature({
      colorMode: input.colorMode,
      bitDepth: input.bitDepth,
      pipeline: planning.preview.pipeline,
      profileLabel: profileSignatureLabel,
      readOnly: previewReadOnly,
    }),
  } satisfies ImageColorModeReadinessPreviewState;

  return {
    descriptorId: 'image-color-mode-readiness:v1',
    ready: blockers.length === 0,
    status,
    colorMode: input.colorMode,
    bitDepth: input.bitDepth,
    profileLabel: normalizedProfileLabel,
    policy: {
      nativeDocumentMode: input.colorMode === 'rgb' && input.bitDepth === 8,
      editPolicy: planning.operationsMatrix.paint.workflow,
      profilePolicy: profileDescriptor.appliedPolicy,
      conversionPolicy: planning.conversion.required || input.bitDepth !== 8
        ? 'external-conversion-required'
        : 'none',
    },
    previewState,
    bitDepthCaveats: planning.bitDepthPipelineContract.warnings,
    operationCaveats: buildColorModeReadinessOperationCaveats(
      input.colorMode,
      input.bitDepth,
      normalizedProfileLabel,
    ),
    conversionBlockers,
    metadataOnlyBlockers,
    printExport,
    unsupportedStates: buildColorModeReadinessUnsupportedStates(input.colorMode, input.bitDepth),
    blockers,
    previewSignature: buildColorModeReadinessSignature({
      colorMode: input.colorMode,
      bitDepth: input.bitDepth,
      profileLabel: profileSignatureLabel,
      status,
      previewReadOnly,
      blockerCodes: blockers.map((blocker) => blocker.code),
    }),
  };
}

export function describeImageBitDepthDocumentReadiness(
  input: {
    documentId: string;
    sourceFormat?: string;
    sourceBitDepth: ImageWorkflowBitDepth;
    requestedOperations?: ImageWorkflowOperation[];
  },
): ImageBitDepthDocumentReadinessDescriptor {
  const sourceFormat = normalizeSourceFormatLabel(input.sourceFormat);
  const requestedOperations = input.requestedOperations?.length
    ? [...input.requestedOperations]
    : [...IMAGE_WORKFLOW_OPERATIONS];
  const contract = buildColorModeBitDepthPipelineContract(input.sourceBitDepth);

  return {
    descriptorId: 'image-bit-depth-document-readiness:v1',
    documentId: input.documentId,
    sourceFormat,
    sourceBitDepth: input.sourceBitDepth,
    storageBitDepth: 8,
    editBitDepth: 8,
    exportBitDepth: 8,
    highBitStorageSupported: false,
    highBitEditingSupported: false,
    highBitExportSupported: false,
    lossSurface: contract.lossSurface,
    operationPolicies: requestedOperations.map((operation) => buildBitDepthDocumentOperationPolicy(
      operation,
      input.sourceBitDepth,
    )),
    exportCaveats: buildBitDepthDocumentExportCaveats(sourceFormat, input.sourceBitDepth),
    warnings: [...contract.warnings],
    signature: [
      'image-bit-depth-document-readiness:v1',
      input.documentId,
      sourceFormat,
      String(input.sourceBitDepth),
      requestedOperations.join(','),
      '8',
    ].join(':'),
  };
}

export function describeImageHighBitWorkflowSupportMatrix(
  input: {
    sourceFormat?: string;
    colorMode: ImageWorkflowColorMode;
    sourceBitDepth: ImageWorkflowBitDepth;
    profileLabel?: string;
  },
): ImageHighBitWorkflowSupportMatrixDescriptor {
  const sourceFormat = normalizeSourceFormatLabel(input.sourceFormat);
  const profileLabel = normalizeProfileLabel(input.profileLabel);
  const operationMatrix = buildHighBitOperationSupportMatrix(
    input.colorMode,
    input.sourceBitDepth,
  );
  const exportMatrix = buildHighBitExportSupportMatrix(
    input.colorMode,
    input.sourceBitDepth,
  );
  const unsupportedStates = buildHighBitUnsupportedStates(
    input.colorMode,
    input.sourceBitDepth,
    profileLabel,
  );

  return {
    descriptorId: 'image-high-bit-workflow-support-matrix:v1',
    sourceFormat,
    colorMode: input.colorMode,
    sourceBitDepth: input.sourceBitDepth,
    workingBitDepth: 8,
    profileLabel,
    operationMatrix,
    exportMatrix,
    fallbackRecommendations: buildHighBitFallbackRecommendations(input.sourceBitDepth),
    unsupportedStates,
    stableSignature: [
      'image-high-bit-workflow-support-matrix:v1',
      `format=${sourceFormat}`,
      `mode=${input.colorMode}`,
      `bits=${input.sourceBitDepth}`,
      `profile=${profileLabel ?? 'unmanaged'}`,
      `ops=${IMAGE_WORKFLOW_OPERATIONS.map((operation) => `${operation}:${operationMatrix[operation].status}`).join(',')}`,
      `exports=${IMAGE_HIGH_BIT_EXPORT_TARGETS.map((target) => `${target}:${exportMatrix[target].status}`).join(',')}`,
      `unsupported=${unsupportedStates.map((state) => state.code).join(',') || 'none'}`,
    ].join('|'),
  };
}

export function describeImageNonRgbColorModeSupportMatrix(
  input: {
    colorMode: ImageNonRgbColorMode;
    bitDepth: ImageWorkflowBitDepth;
    profileLabel?: string;
  },
): ImageNonRgbColorModeSupportMatrixDescriptor {
  const profileLabel = normalizeProfileLabel(input.profileLabel);
  const channelPreview = describeColorModeChannels(input.colorMode);
  const previewState = buildNonRgbColorModePreviewState(input.colorMode, input.bitDepth, profileLabel, channelPreview);
  const conversionBlockers = buildNonRgbColorModeConversionBlockers(input.colorMode, input.bitDepth);
  const exportBlockers = buildNonRgbColorModeExportBlockers(input.colorMode, input.bitDepth);
  const operationMatrix = buildNonRgbColorModeOperationMatrix(
    input.colorMode,
    input.bitDepth,
    profileLabel,
  );
  const actionSuitability = buildNonRgbColorModeActionSuitability(input.colorMode);
  const batchSuitability = buildNonRgbColorModeBatchSuitability(input.colorMode);

  return {
    descriptorId: 'image-non-rgb-color-mode-support-matrix:v1',
    colorMode: input.colorMode,
    modeLabel: labelForWorkflowColorMode(input.colorMode),
    bitDepth: input.bitDepth,
    profileLabel,
    nativeDocumentMode: false,
    previewState,
    operationMatrix,
    conversionBlockers,
    exportBlockers,
    prepressChecks: buildNonRgbColorModePrepressChecks(input.colorMode),
    actionSuitability,
    batchSuitability,
    stableSignature: [
      'image-non-rgb-color-mode-support-matrix:v1',
      `mode=${input.colorMode}`,
      `bits=${input.bitDepth}`,
      `profile=${profileLabel ?? 'unmanaged'}`,
      `preview=${previewState.pipeline}`,
      `ops=${IMAGE_WORKFLOW_OPERATIONS.map((operation) => `${operation}:${operationMatrix[operation].status}`).join(',')}`,
      `conversion=${conversionBlockers.map((blocker) => blocker.code).join(',')}`,
      `export=${exportBlockers.map((blocker) => blocker.code).join(',')}`,
    ].join('|'),
  };
}

export function describeImageColorModeOperationalReadiness(
  input: {
    colorMode: ImageWorkflowColorMode;
    bitDepth: ImageWorkflowBitDepth;
    profileLabel?: string;
  },
): ImageColorModeOperationalReadinessDescriptor {
  const planning = describeColorModePlanningDescriptor(input);
  const readiness = describeImageColorModeReadiness(input);
  const profileLabel = normalizeProfileLabel(input.profileLabel);
  const ready = readiness.ready;
  const destructiveRisk = planning.capability.status === 'unsupported'
    ? 'unsupported'
    : ready
      ? 'none'
      : 'requires-conversion';

  return {
    descriptorId: 'image-color-mode-operational-readiness:v1',
    ready,
    state: {
      colorMode: input.colorMode,
      modeLabel: planning.modeLabel,
      bitDepth: input.bitDepth,
      profileLabel,
      nativeDocumentMode: readiness.policy.nativeDocumentMode,
    },
    policy: {
      previewPolicy: readiness.previewState.previewKind,
      conversionPolicy: readiness.policy.conversionPolicy,
      profilePolicy: readiness.policy.profilePolicy,
      exportPolicy: readiness.printExport.nativeModeExportReady ? 'native-rgb' : 'flattened-rgb-with-metadata',
    },
    iccProfileLimitations: buildColorModeOperationalIccLimitations(readiness, planning),
    previewAndConversionCaveats: uniqueStrings([
      ...planning.conversion.limitations,
      ...readiness.conversionBlockers.map((blocker) => blocker.message),
    ]),
    bitDepthPreservation: {
      sourceBitDepth: input.bitDepth,
      preserved: input.bitDepth === 8,
      blockers: planning.bitDepthPlan.warnings,
    },
    exportPrintCaveats: readiness.printExport.implications,
    unsupportedPhotoshopStates: buildColorModeUnsupportedPhotoshopStates(input.colorMode, input.bitDepth),
    suiteHandoffGuidance: buildColorModeSuiteHandoffGuidance(input.colorMode, input.bitDepth),
    actionSuitability: {
      suitable: ready,
      recordable: true,
      deterministic: true,
      destructiveRisk,
    },
    batchSuitability: buildColorModeBatchSuitability(ready, readiness.policy.conversionPolicy),
    signature: [
      'image-color-mode-operational-readiness:v1',
      input.colorMode,
      String(input.bitDepth),
      profileLabel ?? 'unmanaged',
      planning.capability.status,
      ready ? 'ready' : 'blocked',
    ].join(':'),
  };
}

function buildNonRgbColorModePreviewState(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
  profileLabel: string | null,
  channelPreview: ColorModeChannelPreviewDescriptor,
): ImageNonRgbColorModePreviewStateDescriptor {
  const pipeline = pipelineForColorMode(colorMode);
  const channelLabels = nonRgbChannelLabels(colorMode);
  return {
    pipeline,
    previewKind: channelPreview.previewKind,
    readOnly: true,
    deterministic: true,
    computedFromRgb: colorMode === 'cmyk',
    channelLabels,
    caveats: buildNonRgbPreviewCaveats(colorMode),
    signature: [
      'image-non-rgb-color-mode-preview:v1',
      colorMode,
      String(bitDepth),
      pipeline,
      profileLabel ?? 'unmanaged',
      'read-only',
    ].join(':'),
  };
}

function buildNonRgbColorModeOperationMatrix(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
  profileLabel: string | null,
): Record<ImageWorkflowOperation, ImageNonRgbColorModeOperationSupportDescriptor> {
  return IMAGE_WORKFLOW_OPERATIONS.reduce<Record<ImageWorkflowOperation, ImageNonRgbColorModeOperationSupportDescriptor>>(
    (accumulator, operation) => {
      accumulator[operation] = buildNonRgbColorModeOperationSupport(
        colorMode,
        bitDepth,
        profileLabel,
        operation,
      );
      return accumulator;
    },
    {} as Record<ImageWorkflowOperation, ImageNonRgbColorModeOperationSupportDescriptor>,
  );
}

function buildNonRgbColorModeOperationSupport(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
  profileLabel: string | null,
  operation: ImageWorkflowOperation,
): ImageNonRgbColorModeOperationSupportDescriptor {
  const status = nonRgbOperationStatus(colorMode, operation);
  const blockers = operation === 'export'
    ? buildNonRgbColorModeExportBlockers(colorMode, bitDepth).map((blocker) => blocker.code)
    : buildNonRgbColorModeConversionBlockers(colorMode, bitDepth).map((blocker) => blocker.code);

  return {
    operation,
    status,
    supportedInEditor: false,
    actionRecordable: true,
    batchSuitable: false,
    requiredRoute: nonRgbRequiredRoute(colorMode, operation),
    outputPixelSpace: 'RGB',
    blockers,
    caveats: uniqueStrings([
      ...buildColorModeOperationModeCaveats(colorMode, operation),
      ...buildColorModeOperationBitDepthCaveats(bitDepth, operation),
      ...buildColorModeOperationProfileCaveats(profileLabel, operation),
      ...buildNonRgbOperationPrepressCaveats(colorMode, operation),
    ]),
    signature: [
      'image-non-rgb-color-mode-operation:v1',
      colorMode,
      String(bitDepth),
      operation,
      status,
      blockers.join(','),
    ].join(':'),
  };
}

function buildNonRgbColorModeConversionBlockers(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ImageNonRgbColorModeBlocker[] {
  const blockerCodes = nonRgbConversionBlockerCodes(colorMode, bitDepth);
  return blockerCodes.map(buildNonRgbColorModeBlocker);
}

function buildNonRgbColorModeExportBlockers(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ImageNonRgbColorModeBlocker[] {
  const blockerCodes = nonRgbExportBlockerCodes(colorMode, bitDepth);
  return blockerCodes.map(buildNonRgbColorModeBlocker);
}

function nonRgbConversionBlockerCodes(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ImageNonRgbColorModeBlockerCode[] {
  const bitDepthBlockers: ImageNonRgbColorModeBlockerCode[] = bitDepth === 8
    ? []
    : ['high-bit-depth-downsample'];

  if (colorMode === 'cmyk') {
    return [
      'native-cmyk-editing',
      'icc-transform-unavailable',
      'black-generation-unavailable',
      'total-area-coverage-unavailable',
      ...bitDepthBlockers,
    ];
  }

  if (colorMode === 'lab') {
    return [
      'native-lab-preview-unavailable',
      'native-lab-editing',
      'lab-conversion-external',
      'icc-transform-unavailable',
      ...bitDepthBlockers,
    ];
  }

  return [
    'indexed-palette-preservation',
    'native-indexed-editing',
    'indexed-reindex-required',
    ...bitDepthBlockers,
  ];
}

function nonRgbExportBlockerCodes(
  colorMode: ImageNonRgbColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ImageNonRgbColorModeBlockerCode[] {
  const bitDepthBlockers: ImageNonRgbColorModeBlockerCode[] = bitDepth === 8
    ? []
    : ['high-bit-depth-downsample'];

  if (colorMode === 'cmyk') {
    return [
      'native-cmyk-export-unavailable',
      'icc-transform-unavailable',
      'black-generation-unavailable',
      'total-area-coverage-unavailable',
      ...bitDepthBlockers,
    ];
  }

  if (colorMode === 'lab') {
    return [
      'native-lab-export-unavailable',
      'lab-conversion-external',
      'icc-transform-unavailable',
      ...bitDepthBlockers,
    ];
  }

  return [
    'native-indexed-export-unavailable',
    'indexed-palette-preservation',
    'indexed-reindex-required',
    ...bitDepthBlockers,
  ];
}

function buildNonRgbColorModeBlocker(
  code: ImageNonRgbColorModeBlockerCode,
): ImageNonRgbColorModeBlocker {
  const messages: Record<ImageNonRgbColorModeBlockerCode, string> = {
    'native-cmyk-editing': 'Native CMYK editing is unavailable; edit an external ICC-converted 8-bit RGB derivative.',
    'native-cmyk-export-unavailable': 'Native CMYK export and process separations are unavailable; exports remain RGB.',
    'native-lab-preview-unavailable': 'Native Lab preview is unavailable; Lab channels are not converted into the Image canvas.',
    'native-lab-editing': 'Native Lab channel editing is unavailable; convert Lab documents to RGB externally.',
    'native-lab-export-unavailable': 'Native Lab export is unavailable; no Lab channels or Lab profile output is produced.',
    'native-indexed-editing': 'Native indexed editing is unavailable; palette-index operations require external tooling.',
    'native-indexed-export-unavailable': 'Native indexed export is unavailable; re-index exported RGB pixels externally.',
    'icc-transform-unavailable': 'ICC transforms are unavailable; profile labels are metadata only.',
    'lab-conversion-external': 'Lab conversion requires an external color-managed conversion to RGB.',
    'indexed-palette-preservation': 'Indexed palette tables, transparency tables, and exact index values are not preserved.',
    'indexed-reindex-required': 'Palette re-indexing must happen outside Sloom Studio after RGB export.',
    'black-generation-unavailable': 'CMYK black generation/UCR/GCR decisions are not computed.',
    'total-area-coverage-unavailable': 'Total area coverage and ink-limit checks are not computed.',
    'high-bit-depth-downsample': 'High-bit sources are downgraded to 8-bit RGB canvas data before editing/export.',
  };

  return {
    code,
    category: categoryForNonRgbBlocker(code),
    message: messages[code],
  };
}

function categoryForNonRgbBlocker(
  code: ImageNonRgbColorModeBlockerCode,
): ImageNonRgbColorModeBlockerCategory {
  if (code === 'high-bit-depth-downsample') return 'bit-depth';
  if (code.includes('export')) return 'export';
  if (code.includes('black') || code.includes('coverage')) return 'prepress';
  if (code.includes('preview')) return 'preview';
  return 'conversion';
}

function nonRgbOperationStatus(
  colorMode: ImageNonRgbColorMode,
  operation: ImageWorkflowOperation,
): ImageNonRgbColorModeOperationStatus {
  if (operation === 'export') return 'external-required';
  if (colorMode === 'cmyk') return 'preview-only-blocked';
  if (colorMode === 'indexed') return 'conversion-required';
  return 'unsupported';
}

function nonRgbRequiredRoute(
  colorMode: ImageNonRgbColorMode,
  operation: ImageWorkflowOperation,
): ImageNonRgbColorModeRequiredRoute {
  if (colorMode === 'indexed') {
    return operation === 'export'
      ? 'external-reindex-after-rgb-export'
      : 'expand-palette-to-rgb';
  }
  if (colorMode === 'lab') return 'external-lab-to-rgb';
  return 'external-icc-to-rgb';
}

function buildNonRgbColorModePrepressChecks(
  colorMode: ImageNonRgbColorMode,
): ImageNonRgbColorModePrepressCheckDescriptor {
  return {
    gamutWarningAvailable: false,
    blackGenerationAvailable: false,
    totalAreaCoverageCheckAvailable: false,
    overprintSimulationAvailable: false,
    caveats: buildNonRgbPrepressCaveats(colorMode),
  };
}

function buildNonRgbColorModeActionSuitability(
  colorMode: ImageNonRgbColorMode,
): ImageNonRgbColorModeActionSuitabilityDescriptor {
  return {
    suitable: false,
    recordable: true,
    deterministic: true,
    destructiveRisk: colorMode === 'lab' ? 'unsupported' : 'requires-external-conversion',
  };
}

function buildNonRgbColorModeBatchSuitability(
  colorMode: ImageNonRgbColorMode,
): ImageColorModeBatchSuitabilityDescriptor {
  if (colorMode === 'cmyk') {
    return {
      suitable: false,
      reason: 'Batch CMYK processing is blocked until an external ICC conversion/separation step creates an 8-bit RGB derivative.',
    };
  }
  if (colorMode === 'lab') {
    return {
      suitable: false,
      reason: 'Batch Lab processing is blocked because native Lab preview/edit/export is unsupported.',
    };
  }
  return {
    suitable: false,
    reason: 'Batch indexed processing is blocked until palette expansion and external re-indexing are planned.',
  };
}

function nonRgbChannelLabels(colorMode: ImageNonRgbColorMode): string[] {
  if (colorMode === 'cmyk') return ['Cyan', 'Magenta', 'Yellow', 'Black'];
  if (colorMode === 'lab') return ['Lightness', 'a', 'b'];
  return ['Palette index'];
}

function buildNonRgbPreviewCaveats(colorMode: ImageNonRgbColorMode): string[] {
  if (colorMode === 'cmyk') {
    return [
      'CMYK preview channels are deterministic RGB formula separations, not ICC-managed process plates.',
      'The preview is read-only; editing still requires an 8-bit RGB working derivative.',
    ];
  }
  if (colorMode === 'lab') {
    return [
      'Lab preview is unavailable because Lab channel conversion is not implemented.',
      'Convert Lab documents externally before Image editing.',
    ];
  }
  return [
    'Indexed preview is unavailable because palette tables and exact indices are not modeled.',
    'Expand to RGB before editing and re-index externally after export.',
  ];
}

function buildNonRgbPrepressCaveats(colorMode: ImageNonRgbColorMode): string[] {
  if (colorMode === 'cmyk') {
    return [
      'Gamut warnings are unavailable for CMYK mode planning.',
      'Black generation and total area coverage checks require an external prepress tool.',
      'Overprint simulation is unavailable in the Image RGB renderer.',
    ];
  }
  if (colorMode === 'lab') {
    return [
      'Lab gamut mapping requires an external ICC-managed conversion.',
      'Press checks cannot run until Lab is converted to a target RGB/CMYK output workflow.',
    ];
  }
  return [
    'Palette gamut and nearest-color remapping are not computed.',
    'Exact palette optimization and re-indexing require an external indexed-color workflow.',
  ];
}

function buildNonRgbOperationPrepressCaveats(
  colorMode: ImageNonRgbColorMode,
  operation: ImageWorkflowOperation,
): string[] {
  if (colorMode !== 'cmyk') return [];
  if (operation === 'export') {
    return [
      'Export does not compute black generation, total area coverage, overprint, or press separations.',
    ];
  }
  return [
    `${labelForImageWorkflowOperation(operation)} does not evaluate CMYK gamut clipping, black generation, total area coverage, or overprint behavior.`,
  ];
}

function buildColorModeOperationMatrix(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): Record<ImageWorkflowOperation, ColorModeOperationCompatibilityDescriptor> {
  return IMAGE_WORKFLOW_OPERATIONS.reduce<Record<ImageWorkflowOperation, ColorModeOperationCompatibilityDescriptor>>(
    (accumulator, operation) => {
      const policy = getColorModeOperationPolicy({ colorMode, bitDepth, operation });
      accumulator[operation] = {
        ...policy,
        previewId: `mode-op:${colorMode}:${bitDepth}:${operation}:${policy.workflow}`,
      };
      return accumulator;
    },
    {} as Record<ImageWorkflowOperation, ColorModeOperationCompatibilityDescriptor>,
  );
}

function buildBitDepthDocumentOperationPolicy(
  operation: ImageWorkflowOperation,
  sourceBitDepth: ImageWorkflowBitDepth,
): ImageBitDepthDocumentOperationPolicy {
  const operationLabel = labelForImageWorkflowOperation(operation);
  const operationVerb = operation === 'paint' || operation === 'export' ? 'runs' : 'run';
  if (sourceBitDepth === 8) {
    return {
      operation,
      supported: true,
      blockerCode: null,
      processingSurface: operation === 'export' ? '8-bit-visible-export' : '8-bit-rgba-canvas',
      sourceSamplePolicy: 'native-8bit',
      message: `${operationLabel} ${operationVerb} on native 8-bit RGBA canvas data.`,
      printExportWarning: null,
    };
  }

  if (operation === 'export') {
    return {
      operation,
      supported: false,
      blockerCode: 'high-bit-depth-export-unavailable',
      processingSurface: '8-bit-visible-export',
      sourceSamplePolicy: 'external-high-bit-master-required',
      message: `Export writes 8-bit RGB/RGBA derivatives; ${sourceBitDepth}-bit output requires an external high-bit master.`,
      printExportWarning: 'Export is an 8-bit RGB/RGBA derivative; use an external high-bit master for print, archive, or VFX handoff.',
    };
  }

  return {
    operation,
    supported: false,
    blockerCode: 'high-bit-depth-downsample',
    processingSurface: '8-bit-rgba-canvas',
    sourceSamplePolicy: 'downsampled-to-8bit',
    message: `${operationLabel} ${operationVerb} on downgraded 8-bit RGBA canvas data; ${sourceBitDepth}-bit source samples are not preserved.`,
    printExportWarning: `${operationLabel} output is an 8-bit RGB derivative; keep a high-bit master for print, archive, or VFX handoff.`,
  };
}

function buildBitDepthDocumentExportCaveats(
  sourceFormat: string,
  sourceBitDepth: ImageWorkflowBitDepth,
): string[] {
  if (sourceBitDepth === 8) {
    return ['Visible exports use flattened 8-bit RGB/RGBA derivatives from the editable Image document.'];
  }

  return [
    'Visible exports are flattened 8-bit RGB/RGBA derivatives, not high-bit TIFF/PSD/EXR masters.',
    `Keep the original ${sourceFormat} high-bit master outside Sloom Studio when ${sourceBitDepth}-bit precision must survive print or archive handoff.`,
  ];
}

function buildHighBitOperationSupportMatrix(
  colorMode: ImageWorkflowColorMode,
  sourceBitDepth: ImageWorkflowBitDepth,
): Record<ImageWorkflowOperation, ImageHighBitOperationSupportDescriptor> {
  return IMAGE_WORKFLOW_OPERATIONS.reduce<Record<ImageWorkflowOperation, ImageHighBitOperationSupportDescriptor>>(
    (accumulator, operation) => {
      accumulator[operation] = buildHighBitOperationSupportDescriptor(
        operation,
        colorMode,
        sourceBitDepth,
      );
      return accumulator;
    },
    {} as Record<ImageWorkflowOperation, ImageHighBitOperationSupportDescriptor>,
  );
}

function buildHighBitOperationSupportDescriptor(
  operation: ImageWorkflowOperation,
  colorMode: ImageWorkflowColorMode,
  sourceBitDepth: ImageWorkflowBitDepth,
): ImageHighBitOperationSupportDescriptor {
  const operationLabel = labelForImageWorkflowOperation(operation);

  if (sourceBitDepth === 8 && colorMode === 'rgb') {
    return {
      operation,
      status: 'native-8bit',
      supportedInEditor: true,
      sourcePrecisionPreserved: true,
      processingSurface: operation === 'export' ? '8-bit-visible-export' : '8-bit-rgba-canvas',
      fallbackRoute: null,
      message: `${operationLabel} uses native 8-bit RGB/RGBA Image document pixels.`,
    };
  }

  if (operation === 'export') {
    return {
      operation,
      status: 'external-required',
      supportedInEditor: false,
      sourcePrecisionPreserved: false,
      processingSurface: '8-bit-visible-export',
      fallbackRoute: sourceBitDepth === 8 ? 'external-color-mode-conversion' : 'external-high-bit-master',
      message: sourceBitDepth === 8
        ? `Native ${labelForWorkflowColorMode(colorMode)} export requires external color-mode conversion; Image visible exports stay 8-bit RGB.`
        : `Export writes 8-bit RGB/RGBA derivatives; preserve ${sourceBitDepth}-bit output in an external high-bit master.`,
    };
  }

  return {
    operation,
    status: sourceBitDepth === 8 ? 'external-required' : 'downsample-required',
    supportedInEditor: false,
    sourcePrecisionPreserved: false,
    processingSurface: '8-bit-rgba-canvas',
    fallbackRoute: sourceBitDepth === 8 ? 'external-color-mode-conversion' : '8bit-rgb-working-derivative',
    message: sourceBitDepth === 8
      ? `${operationLabel} cannot run in native ${labelForWorkflowColorMode(colorMode)} mode; convert externally to 8-bit RGB first.`
      : `${operationLabel} runs only after creating an 8-bit RGB/RGBA derivative; ${sourceBitDepth}-bit source precision is not preserved.`,
  };
}

function buildHighBitExportSupportMatrix(
  colorMode: ImageWorkflowColorMode,
  sourceBitDepth: ImageWorkflowBitDepth,
): Record<ImageHighBitExportTarget, ImageHighBitExportSupportDescriptor> {
  return IMAGE_HIGH_BIT_EXPORT_TARGETS.reduce<Record<ImageHighBitExportTarget, ImageHighBitExportSupportDescriptor>>(
    (accumulator, target) => {
      accumulator[target] = buildHighBitExportSupportDescriptor(target, colorMode, sourceBitDepth);
      return accumulator;
    },
    {} as Record<ImageHighBitExportTarget, ImageHighBitExportSupportDescriptor>,
  );
}

function buildHighBitExportSupportDescriptor(
  target: ImageHighBitExportTarget,
  colorMode: ImageWorkflowColorMode,
  sourceBitDepth: ImageWorkflowBitDepth,
): ImageHighBitExportSupportDescriptor {
  const colorModePreserved = colorMode === 'rgb';

  if (target === 'exr') {
    return {
      target,
      status: 'unsupported',
      supported: false,
      highBitPreserved: false,
      colorModePreserved: false,
      fallbackRoute: 'external-high-bit-master',
      message: 'OpenEXR/HDR export is unsupported; use an external high-bit or VFX pipeline for EXR output.',
    };
  }

  if (target === 'cameraRaw') {
    return {
      target,
      status: 'unsupported',
      supported: false,
      highBitPreserved: false,
      colorModePreserved: false,
      fallbackRoute: 'external-high-bit-master',
      message: 'Camera Raw export is unsupported; Image cannot reconstruct sensor RAW payloads from edited pixels.',
    };
  }

  if (target === 'psd') {
    return {
      target,
      status: '8bit-layered-metadata',
      supported: true,
      highBitPreserved: false,
      colorModePreserved,
      fallbackRoute: sourceBitDepth === 8 && colorModePreserved ? null : 'external-high-bit-master',
      message: sourceBitDepth === 8
        ? 'PSD export can carry Image layer metadata, but pixels remain 8-bit RGB/RGBA.'
        : `PSD export carries Image layer metadata around 8-bit RGB/RGBA pixels; ${sourceBitDepth}-bit source samples are not preserved.`,
    };
  }

  return {
    target,
    status: sourceBitDepth === 8 && colorModePreserved ? 'native-8bit' : '8bit-derivative',
    supported: true,
    highBitPreserved: false,
    colorModePreserved,
    fallbackRoute: sourceBitDepth === 8 && colorModePreserved ? null : 'external-high-bit-master',
    message: sourceBitDepth === 8 && colorModePreserved
      ? `${target.toUpperCase()} export writes the current 8-bit RGB/RGBA visible result.`
      : `${target.toUpperCase()} export writes an 8-bit RGB/RGBA derivative; native ${sourceBitDepth}-bit or ${labelForWorkflowColorMode(colorMode)} output is not produced.`,
  };
}

function buildHighBitFallbackRecommendations(
  sourceBitDepth: ImageWorkflowBitDepth,
): ImageHighBitWorkflowFallbackRecommendation[] {
  if (sourceBitDepth === 8) {
    return [
      {
        route: '8bit-rgb-working-derivative',
        label: 'Use 8-bit RGB working document',
        preserves: 'native Image paint, adjustment, filter, and export behavior',
        recommendedFor: 'Standard Sloom Studio Image editing and suite handoff.',
        caveat: 'Profile transforms and press separations still require external color management.',
      },
    ];
  }

  return [
    {
      route: 'external-high-bit-master',
      label: 'Keep external high-bit master',
      preserves: `${sourceBitDepth}-bit source precision, ICC-managed profile transforms, and archive/print latitude`,
      recommendedFor: 'Print, archive, VFX, or any workflow where high-bit precision must survive.',
      caveat: 'Image edits apply to an 8-bit RGB derivative and do not update the high-bit master.',
    },
    {
      route: '8bit-rgb-working-derivative',
      label: 'Create 8-bit RGB working derivative',
      preserves: 'visible pixel intent for Image paint, adjustments, filters, and suite handoff',
      recommendedFor: 'Interactive Image editing after accepting precision loss.',
      caveat: 'Quantization, banding, and HDR clamp risk are baked into the derivative.',
    },
    {
      route: 'psd-metadata-working-copy',
      label: 'PSD metadata working copy',
      preserves: 'Image layer metadata and visible 8-bit RGB edit state',
      recommendedFor: 'Layered Sloom Studio reopening after high-bit conversion.',
      caveat: 'PSD output is not a native high-bit master and profile transforms remain metadata-only.',
    },
  ];
}

function buildHighBitUnsupportedStates(
  colorMode: ImageWorkflowColorMode,
  sourceBitDepth: ImageWorkflowBitDepth,
  profileLabel: string | null,
): ImageHighBitUnsupportedState[] {
  const states: ImageHighBitUnsupportedState[] = [];

  if (sourceBitDepth !== 8) {
    states.push(
      {
        code: 'native-high-bit-storage',
        message: `Native ${sourceBitDepth}-bit document storage is unsupported; Image stores editable pixels as 8-bit RGBA canvas data.`,
      },
      {
        code: 'native-high-bit-editing',
        message: `Native ${sourceBitDepth}-bit paint, adjustment, and filter processing is unsupported.`,
      },
      {
        code: 'native-high-bit-export',
        message: `Native ${sourceBitDepth}-bit export is unsupported; visible exports are 8-bit derivatives.`,
      },
    );
  }

  if (colorMode === 'cmyk') {
    states.push({
      code: 'native-cmyk-document',
      message: 'Native CMYK document storage/editing/export is unsupported; convert externally for press workflows.',
    });
  } else if (colorMode === 'grayscale') {
    states.push({
      code: 'native-grayscale-document',
      message: 'Native grayscale document storage/editing/export is unsupported; convert externally for grayscale workflows.',
    });
  } else if (colorMode === 'lab') {
    states.push({
      code: 'native-lab-document',
      message: 'Native Lab document preview/editing/export is unsupported; convert externally before Image editing.',
    });
  } else if (colorMode === 'indexed') {
    states.push({
      code: 'indexed-palette-preservation',
      message: 'Indexed palette tables and exact indices are unsupported; exports use expanded 8-bit RGB pixels.',
    });
  }

  if (profileLabel) {
    states.push({
      code: 'icc-profile-transform',
      message: `Profile "${profileLabel}" is metadata only; no ICC transform is applied to the high-bit derivative.`,
    });
  }

  return states;
}

function buildColorModeOperationalIccLimitations(
  readiness: ImageColorModeReadinessDescriptor,
  planning: ColorModePlanningDescriptor,
): string[] {
  const blockerMessages = readiness.metadataOnlyBlockers.map((blocker) => blocker.message);
  const limitations = blockerMessages.length > 0
    ? blockerMessages
    : planning.profileTransform.limitations;

  return uniqueStrings(limitations);
}

function buildColorModeUnsupportedPhotoshopStates(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): string[] {
  if (colorMode === 'rgb') {
    return bitDepth === 8
      ? ['custom display-profile transforms']
      : ['16-bit/32-bit channel preservation', 'custom display-profile transforms'];
  }

  const highBitStates = bitDepth === 8 ? [] : ['16-bit/32-bit channel preservation'];

  if (colorMode === 'cmyk') {
    return [
      'native CMYK document editing',
      'ICC-managed CMYK conversion intents',
      'native CMYK export/separations',
      ...highBitStates,
    ];
  }

  if (colorMode === 'grayscale') {
    return [
      'native grayscale document editing',
      'ICC-managed grayscale conversion',
      'native grayscale export',
      ...highBitStates,
    ];
  }

  if (colorMode === 'indexed') {
    return [
      'palette-table preservation',
      'native indexed editing',
      'native indexed export',
      ...highBitStates,
    ];
  }

  return [
    'native Lab preview/editing',
    'ICC-managed Lab conversion',
    'native Lab export',
    ...highBitStates,
  ];
}

function buildColorModeBatchSuitability(
  ready: boolean,
  conversionPolicy: ImageColorModeConversionPolicy,
): ImageColorModeBatchSuitabilityDescriptor {
  if (ready) {
    return {
      suitable: true,
      reason: 'Native 8-bit RGB operations can be recorded and replayed without mode conversion.',
    };
  }

  if (conversionPolicy === 'external-conversion-required') {
    return {
      suitable: false,
      reason: 'Batch color-mode processing requires external ICC conversion before native Image editing/export.',
    };
  }

  return {
    suitable: false,
    reason: 'Batch color-mode processing is blocked by unsupported native mode/export state.',
  };
}

function buildColorModeSuiteHandoffGuidance(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): string[] {
  const guidance = ['Convert documents to 8-bit RGB before recording shared Image actions for other workspaces.'];

  if (colorMode === 'cmyk') {
    guidance.push('Treat CMYK proof/profile labels as handoff metadata only; downstream apps must perform real separations.');
  } else if (colorMode === 'lab') {
    guidance.push('Lab documents must be converted in an external color-managed app before suite handoff.');
  } else if (colorMode === 'grayscale') {
    guidance.push('Treat grayscale proof/profile labels as handoff metadata only; downstream apps must perform real grayscale conversion.');
  } else if (colorMode === 'indexed') {
    guidance.push('Re-index outside Sloom Studio after export when palette fidelity matters to downstream apps.');
  } else {
    guidance.push('RGB pixels can move between workspaces, but profile labels remain descriptive metadata only.');
  }

  if (bitDepth !== 8) {
    guidance.push(`Keep a native master outside Sloom Studio when ${bitDepth}-bit precision must survive handoff.`);
  }

  return guidance;
}

function colorModeReadinessStatusForCapability(status: ColorModeCapabilityStatus): ImageColorModeReadinessStatus {
  if (status === 'native') return 'ready';
  return status;
}

function buildColorModeReadinessConversionBlockers(
  planning: ColorModePlanningDescriptor,
): ImageColorModeReadinessBlocker[] {
  const blockers: ImageColorModeReadinessBlocker[] = [];

  if (planning.conversion.required) {
    blockers.push({
      code: 'color-conversion-required',
      category: 'conversion',
      message: buildColorModeConversionBlockerMessage(planning.colorMode),
    });
  }

  if (planning.bitDepth !== 8) {
    blockers.push({
      code: 'high-bit-depth-downsample',
      category: 'conversion',
      message: `${planning.bitDepth}-bit sources are downgraded to 8-bit RGB canvas data before Image editing/export.`,
    });
  }

  return blockers;
}

function buildColorModeReadinessMetadataOnlyBlockers(
  profileLabel: string | null,
): ImageColorModeReadinessBlocker[] {
  if (!profileLabel) return [];
  return [
    {
      code: 'icc-profile-metadata-only',
      category: 'metadata-only',
      message: `ICC/profile "${profileLabel}" is retained as metadata only; preview pixels are not ICC transformed.`,
    },
  ];
}

function buildColorModeReadinessUnsupportedBlockers(
  colorMode: ImageWorkflowColorMode,
): ImageColorModeReadinessBlocker[] {
  if (colorMode !== 'lab') return [];
  return [
    {
      code: 'unsupported-color-mode',
      category: 'unsupported',
      message: 'Lab mode is unsupported for native preview, editing, storage, and export in the Image workspace.',
    },
  ];
}

function buildColorModeReadinessPrintExport(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ImageColorModePrintExportReadinessDescriptor {
  const nativeModeExportReady = colorMode === 'rgb' && bitDepth === 8;

  if (colorMode === 'rgb') {
    return {
      exportColorMode: 'rgb',
      exportsWithoutModeConversion: bitDepth === 8,
      nativeModeExportReady,
      pressReady: false,
      implications: [
        bitDepth === 8
          ? 'RGB export can remain RGB without mode conversion, but press separations still require an external ICC-managed workflow.'
          : 'High-bit RGB sources export through downgraded 8-bit RGB canvas pixels; preserve high-bit masters externally.',
      ],
    };
  }

  if (colorMode === 'cmyk') {
    return {
      exportColorMode: 'rgb',
      exportsWithoutModeConversion: false,
      nativeModeExportReady,
      pressReady: false,
      implications: [
        'CMYK output is planning metadata only; exported pixels remain flattened 8-bit RGB.',
        'Create press-ready CMYK separations in an external ICC-managed prepress workflow.',
      ],
    };
  }

  if (colorMode === 'grayscale') {
    return {
      exportColorMode: 'rgb',
      exportsWithoutModeConversion: false,
      nativeModeExportReady,
      pressReady: false,
      implications: [
        'Grayscale output is a luminance preview; exported pixels remain RGB.',
        'Create press-ready grayscale output in an external ICC-managed workflow.',
      ],
    };
  }

  if (colorMode === 'indexed') {
    return {
      exportColorMode: 'rgb',
      exportsWithoutModeConversion: false,
      nativeModeExportReady,
      pressReady: false,
      implications: [
        'Indexed output is not palette-preserving; exported pixels are expanded 8-bit RGB.',
        'Re-index exported files externally when exact palette tables or index values matter.',
      ],
    };
  }

  return {
    exportColorMode: 'rgb',
    exportsWithoutModeConversion: false,
    nativeModeExportReady,
    pressReady: false,
    implications: [
      'Lab output is unsupported; Sloom Studio does not produce Lab channels, Lab profiles, or native Lab exports.',
      'Convert Lab documents to RGB in an external ICC-aware tool before Image editing or export.',
    ],
  };
}

function buildColorModeReadinessPrintExportBlockers(
  colorMode: ImageWorkflowColorMode,
  printExport: ImageColorModePrintExportReadinessDescriptor,
): ImageColorModeReadinessBlocker[] {
  if (printExport.nativeModeExportReady) return [];
  return [
    {
      code: 'native-export-unavailable',
      category: 'print-export',
      message: `Native ${labelForWorkflowColorMode(colorMode)} export is unavailable; Image exports 8-bit RGB pixels for this workflow.`,
    },
  ];
}

function buildColorModeReadinessOperationCaveats(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
  profileLabel: string | null,
): Record<ImageWorkflowOperation, string[]> {
  return IMAGE_WORKFLOW_OPERATIONS.reduce<Record<ImageWorkflowOperation, string[]>>(
    (accumulator, operation) => {
      accumulator[operation] = uniqueStrings([
        ...buildColorModeOperationModeCaveats(colorMode, operation),
        ...buildColorModeOperationBitDepthCaveats(bitDepth, operation),
        ...buildColorModeOperationProfileCaveats(profileLabel, operation),
      ]);
      return accumulator;
    },
    {} as Record<ImageWorkflowOperation, string[]>,
  );
}

function buildColorModeOperationModeCaveats(
  colorMode: ImageWorkflowColorMode,
  operation: ImageWorkflowOperation,
): string[] {
  const operationLabel = labelForImageWorkflowOperation(operation);
  if (colorMode === 'rgb') return [];

  if (colorMode === 'cmyk') {
    return operation === 'export'
      ? ['Export produces flattened 8-bit RGB pixels with CMYK/profile labels only; native CMYK separations are unsupported.']
      : [`${operationLabel} cannot run in a native CMYK/ICC working space; convert externally to 8-bit RGB before editing.`];
  }

  if (colorMode === 'grayscale') {
    return operation === 'export'
      ? ['Export produces flattened 8-bit RGB pixels with grayscale/profile labels only; native grayscale output is unsupported.']
      : [`${operationLabel} cannot run in a native grayscale/ICC working space; convert externally to 8-bit RGB before editing.`];
  }

  if (colorMode === 'indexed') {
    return operation === 'export'
      ? ['Export produces expanded 8-bit RGB pixels; palette tables, exact indices, and native indexed export are unsupported.']
      : [`${operationLabel} cannot preserve indexed palette tables; expand externally to 8-bit RGB before editing.`];
  }

  return operation === 'export'
    ? ['Export cannot produce Lab channels or Lab profile output; convert Lab documents externally before Image export.']
    : [`${operationLabel} cannot run in native Lab mode; convert externally to 8-bit RGB before editing.`];
}

function buildColorModeOperationBitDepthCaveats(
  bitDepth: ImageWorkflowBitDepth,
  operation: ImageWorkflowOperation,
): string[] {
  if (bitDepth === 8) return [];
  if (operation === 'export') {
    return [`Export cannot preserve ${bitDepth}-bit source precision; keep a high-bit master outside Sloom Studio.`];
  }

  const operationLabel = labelForImageWorkflowOperation(operation);
  const verb = operation === 'paint' ? 'operates' : 'operate';
  return [
    `${operationLabel} ${verb} only on the downgraded 8-bit RGB canvas derivative; ${bitDepth}-bit samples are not preserved.`,
  ];
}

function buildColorModeOperationProfileCaveats(
  profileLabel: string | null,
  operation: ImageWorkflowOperation,
): string[] {
  if (!profileLabel) return [];
  if (operation === 'export') {
    return [`Profile "${profileLabel}" remains metadata-only; no ICC conversion or embedded output profile is produced.`];
  }

  return [
    `Profile "${profileLabel}" remains metadata-only; no ICC transform is applied before ${operation}.`,
  ];
}

function buildColorModeReadinessUnsupportedStates(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ImageColorModeUnsupportedState[] {
  const states: ImageColorModeUnsupportedState[] = [];

  if (colorMode === 'cmyk') {
    states.push(
      {
        code: 'native-cmyk-document',
        message: 'Native CMYK document editing/storage is unsupported; CMYK state is preview/planning metadata only.',
      },
      {
        code: 'native-cmyk-export',
        message: 'Native CMYK export and separations are unsupported; visible exports remain 8-bit RGB.',
      },
    );
  } else if (colorMode === 'grayscale') {
    states.push(
      {
        code: 'native-grayscale-document',
        message: 'Native grayscale document editing/storage is unsupported; grayscale state is luminance preview/planning metadata only.',
      },
      {
        code: 'native-grayscale-export',
        message: 'Native grayscale export is unsupported; visible exports remain 8-bit RGB.',
      },
    );
  } else if (colorMode === 'lab') {
    states.push(
      {
        code: 'native-lab-document',
        message: 'Native Lab preview/editing/storage is unsupported; convert Lab documents externally before Image editing.',
      },
      {
        code: 'native-lab-export',
        message: 'Native Lab export is unsupported; visible exports remain 8-bit RGB only after external conversion.',
      },
    );
  } else if (colorMode === 'indexed') {
    states.push({
      code: 'indexed-palette-preservation',
      message: 'Indexed palette tables, exact indices, and native indexed export are unsupported; exports use expanded 8-bit RGB.',
    });
  }

  if (bitDepth !== 8) {
    states.push({
      code: 'native-high-bit-document',
      message: `${bitDepth}-bit document storage/editing/export is unsupported; the Image editor keeps an 8-bit RGB canvas derivative.`,
    });
  }

  states.push({
    code: 'icc-profile-transform',
    message: 'ICC profile transforms and embedded output profiles are unsupported; profile labels are metadata only.',
  });

  return states;
}

function buildColorModeConversionBlockerMessage(colorMode: ImageWorkflowColorMode): string {
  if (colorMode === 'cmyk') {
    return 'CMYK requires external ICC-managed conversion/flattening before native RGB editing.';
  }
  if (colorMode === 'grayscale') {
    return 'Grayscale requires external ICC-managed conversion/flattening before native RGB editing.';
  }
  if (colorMode === 'indexed') {
    return 'Indexed color requires palette expansion to RGB before native Image editing.';
  }
  if (colorMode === 'lab') {
    return 'Lab requires external ICC-managed conversion to RGB before Image editing.';
  }
  return 'High-bit RGB requires conversion to 8-bit RGB before native Image editing.';
}

function dedupeColorModeReadinessBlockers(
  blockers: readonly ImageColorModeReadinessBlocker[],
): ImageColorModeReadinessBlocker[] {
  const seen = new Set<ImageColorModeReadinessBlockerCode>();
  const deduped: ImageColorModeReadinessBlocker[] = [];
  for (const blocker of blockers) {
    if (seen.has(blocker.code)) continue;
    seen.add(blocker.code);
    deduped.push(blocker);
  }
  return deduped;
}

function buildColorModeReadinessPreviewStateSignature(input: {
  colorMode: ImageWorkflowColorMode;
  bitDepth: ImageWorkflowBitDepth;
  pipeline: ColorModePreviewPipeline;
  profileLabel: string;
  readOnly: boolean;
}): string {
  return [
    'image-color-mode-readiness-preview:v1',
    input.colorMode,
    String(input.bitDepth),
    input.pipeline,
    input.profileLabel,
    input.readOnly ? 'read-only' : 'editable',
  ].join(':');
}

function buildColorModeReadinessSignature(input: {
  colorMode: ImageWorkflowColorMode;
  bitDepth: ImageWorkflowBitDepth;
  profileLabel: string;
  status: ImageColorModeReadinessStatus;
  previewReadOnly: boolean;
  blockerCodes: ImageColorModeReadinessBlockerCode[];
}): string {
  return `image-color-mode-readiness:v1:${JSON.stringify({
    colorMode: input.colorMode,
    bitDepth: input.bitDepth,
    profileLabel: input.profileLabel,
    status: input.status,
    previewReadOnly: input.previewReadOnly,
    blockers: input.blockerCodes,
  })}`;
}

function buildColorModeProfileTransformDescriptor(
  colorMode: ImageWorkflowColorMode,
  requestedProfileLabel: string | null,
): ColorModeProfileTransformDescriptor {
  const blockerCodes: ColorModeProfileTransformBlockerCode[] = ['icc-transform-unavailable'];
  const secondLimitation = colorMode === 'cmyk'
    ? 'CMYK profile conversion, black generation, TAC limits, and rendering intents require an external color-managed tool.'
    : `${labelForWorkflowColorMode(colorMode)} profile conversion requires an external color-managed tool.`;

  if (colorMode === 'rgb') {
    blockerCodes.push('rgb-browser-canvas-only');
  } else if (colorMode === 'grayscale') {
    blockerCodes.push('grayscale-external-conversion-required');
  } else if (colorMode === 'cmyk') {
    blockerCodes.push('cmyk-external-prepress-required');
  } else if (colorMode === 'lab') {
    blockerCodes.push('lab-external-conversion-required');
  } else {
    blockerCodes.push('indexed-external-reindex-required');
  }

  return {
    status: 'unsupported',
    requestedProfileLabel,
    iccConversionAvailable: false,
    transformIntentSupport: 'none',
    blockerCodes,
    limitations: [
      'ICC transforms are not available; profile labels are retained only for handoff metadata.',
      secondLimitation,
    ],
  };
}

function buildColorModeNativeExportDescriptor(colorMode: ImageWorkflowColorMode): ColorModeNativeExportDescriptor {
  const label = labelForWorkflowColorMode(colorMode);
  const limitation = colorMode === 'cmyk'
    ? 'Native CMYK export is unavailable; exports remain flattened 8-bit RGB pixels with CMYK planning metadata.'
    : `Native ${label} export is unavailable; exports remain 8-bit RGB pixels with planning metadata.`;

  return {
    canExportNative: false,
    exportColorMode: 'rgb',
    limitations: colorMode === 'rgb' ? [] : [limitation],
  };
}

function buildColorModeBitDepthPlanDescriptor(bitDepth: ImageWorkflowBitDepth): ColorModeBitDepthPlanDescriptor {
  const warnings = bitDepth === 8
    ? []
    : [
      `${bitDepth}-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.`,
      `${bitDepth}-bit editing and export are unsupported; edits and exported files use 8-bit RGB precision.`,
    ];

  return {
    sourceBitDepth: bitDepth,
    storageBitDepth: 8,
    editBitDepth: 8,
    exportBitDepth: 8,
    highBitStorageSupported: false,
    highBitEditingSupported: false,
    highBitExportSupported: false,
    warnings,
  };
}

function buildColorModeBitDepthPipelineContract(bitDepth: ImageWorkflowBitDepth): ColorModeBitDepthPipelineContract {
  if (bitDepth === 8) {
    return {
      sourceBits: 8,
      workingBits: 8,
      convertedBits: 8,
      lossSurface: 'none',
      warnings: [],
    };
  }

  if (bitDepth === 16) {
    return {
      sourceBits: 16,
      workingBits: 8,
      convertedBits: 8,
      lossSurface: 'quantization-banding',
      warnings: [
        '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '16-bit source editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
        'Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.',
      ],
    };
  }

  return {
    sourceBits: 32,
    workingBits: 8,
    convertedBits: 8,
    lossSurface: 'dynamic-range-clamp',
    warnings: [
      '32-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
      '32-bit source editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
      'Converting from 32-bit to 8-bit removes HDR/floating-point precision and clamps the workflow to standard dynamic range RGB.',
    ],
  };
}

function buildColorModeWorkflowLimitations(colorMode: ImageWorkflowColorMode): string[] {
  if (colorMode === 'lab') {
    return [
      'Lab workflows cannot be previewed, edited, stored, or exported natively in this Image editor.',
      'Convert Lab documents to RGB in an external ICC-aware application before using Sloom Studio.',
    ];
  }

  if (colorMode === 'indexed') {
    return [
      'Indexed workflows do not preserve palette tables, exact indices, transparency tables, or palette animation metadata.',
      'Indexed sources expand to 8-bit RGB before editing; re-index externally after export if palette fidelity matters.',
    ];
  }

  return [];
}

function buildColorModeOutputWarnings(colorMode: ImageWorkflowColorMode): string[] {
  if (colorMode === 'cmyk') {
    return ['Print/output warning: CMYK output is planning metadata only; create press-ready separations outside Sloom Studio.'];
  }

  if (colorMode === 'lab') {
    return ['Print/output warning: Lab output is unsupported; no Lab profile, channels, or native export are produced.'];
  }

  if (colorMode === 'indexed') {
    return ['Print/output warning: indexed output is not native; exported pixels are expanded RGB.'];
  }

  if (colorMode === 'grayscale') {
    return ['Print/output warning: grayscale output is a luminance preview; create press-ready grayscale externally.'];
  }

  return ['Print/output warning: RGB exports are screen-oriented and not press-separated.'];
}

function describeColorModeProfile(
  colorMode: ImageWorkflowColorMode,
  profileLabel: string | undefined,
): ColorModeProfileDescriptor {
  const requestedProfileLabel = normalizeProfileLabel(profileLabel);

  if (colorMode === 'rgb') {
    return {
      requestedProfileLabel,
      iccTransformAvailable: false,
      appliedPolicy: 'browser-rgb-only',
      limitations: [
        'ICC profiles are retained as labels only; browser canvas compositing does not apply custom profile transforms.',
      ],
    };
  }

  if (colorMode === 'grayscale') {
    return {
      requestedProfileLabel,
      iccTransformAvailable: false,
      appliedPolicy: 'label-only',
      limitations: [
        'Grayscale ICC profiles are not applied; previews use deterministic RGB luminance.',
      ],
    };
  }

  if (colorMode === 'cmyk') {
    return {
      requestedProfileLabel,
      iccTransformAvailable: false,
      appliedPolicy: 'label-only',
      limitations: [
        'CMYK ICC profiles are not applied; separations use a deterministic Device RGB formula preview.',
      ],
    };
  }

  return {
    requestedProfileLabel,
    iccTransformAvailable: false,
    appliedPolicy: 'unsupported',
    limitations: [
      `${labelForWorkflowColorMode(colorMode)} ICC workflows are not implemented in Sloom Studio.`,
    ],
  };
}

function describeColorModePrint(colorMode: ImageWorkflowColorMode): ColorModePrintDescriptor {
  if (colorMode === 'rgb') {
    return {
      pressReady: false,
      warnings: [
        'RGB output is screen-oriented; make press CMYK separations in an external ICC-managed print workflow.',
      ],
    };
  }

  if (colorMode === 'grayscale') {
    return {
      pressReady: false,
      warnings: [
        'Grayscale preview is not a press-managed grayscale conversion; export RGB and convert externally for print.',
      ],
    };
  }

  if (colorMode === 'cmyk') {
    return {
      pressReady: false,
      warnings: [
        'CMYK preview is not a press-ready separation; use an external ICC-managed CMYK export for production print.',
      ],
    };
  }

  return {
    pressReady: false,
    warnings: [
      `${labelForWorkflowColorMode(colorMode)} output is unsupported for print handoff inside Sloom Studio.`,
    ],
  };
}

function pipelineForColorMode(colorMode: ImageWorkflowColorMode): ColorModePreviewPipeline {
  if (colorMode === 'rgb') return 'browser-rgb-canvas';
  if (colorMode === 'grayscale') return 'rgb-luminance-preview';
  if (colorMode === 'cmyk') return 'rgb-formula-cmyk-preview';
  return 'unsupported';
}

function normalizeProfileLabel(profileLabel: string | undefined): string | null {
  const normalized = profileLabel?.trim();
  return normalized ? normalized : null;
}

function normalizeSourceFormatLabel(sourceFormat: string | undefined): string {
  const normalized = sourceFormat?.trim();
  return normalized || 'RGB';
}

function labelForImageWorkflowOperation(operation: ImageWorkflowOperation): string {
  switch (operation) {
    case 'paint':
      return 'Paint';
    case 'adjustments':
      return 'Adjustments';
    case 'filters':
      return 'Filters';
    case 'export':
      return 'Export';
  }
}

function labelForWorkflowColorMode(colorMode: ImageWorkflowColorMode): string {
  switch (colorMode) {
    case 'rgb':
      return 'RGB';
    case 'grayscale':
      return 'Grayscale';
    case 'cmyk':
      return 'CMYK';
    case 'lab':
      return 'Lab';
    case 'indexed':
      return 'Indexed color';
  }
}

function describeColorModeCapability(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ColorModeCapabilityDescriptor {
  if (colorMode === 'rgb' && bitDepth === 8) {
    return {
      status: 'native',
      canEditPixels: true,
      canPreviewComposite: true,
      canExportWithoutConversion: true,
      channelCount: 3,
    };
  }

  if (colorMode === 'cmyk') {
    return {
      status: 'preview-only',
      canEditPixels: false,
      canPreviewComposite: true,
      canExportWithoutConversion: false,
      channelCount: 4,
    };
  }

  if (colorMode === 'lab') {
    return {
      status: 'unsupported',
      canEditPixels: false,
      canPreviewComposite: false,
      canExportWithoutConversion: false,
      channelCount: 3,
    };
  }

  if (colorMode === 'indexed') {
    return {
      status: 'conversion-required',
      canEditPixels: false,
      canPreviewComposite: false,
      canExportWithoutConversion: false,
      channelCount: 1,
    };
  }

  return {
    status: 'conversion-required',
    canEditPixels: false,
    canPreviewComposite: true,
    canExportWithoutConversion: false,
    channelCount: colorMode === 'grayscale' ? 1 : 3,
  };
}

function describeColorModeConversionPlan(colorMode: ImageWorkflowColorMode): ColorModeConversionPlanDescriptor {
  if (colorMode === 'rgb') {
    return {
      required: false,
      flatteningRequired: false,
      targetMode: 'rgb',
      targetBitDepth: 8,
      limitations: [],
    };
  }

  if (colorMode === 'cmyk') {
    return {
      required: true,
      flatteningRequired: true,
      targetMode: 'rgb',
      targetBitDepth: 8,
      limitations: [
        'CMYK conversion is a flattened RGB formula preview; spot inks, overprint, black generation, and ICC intents are not preserved.',
        'Flatten before handoff because layered CMYK separations are not represented in the editor document model.',
      ],
    };
  }

  if (colorMode === 'indexed') {
    return {
      required: true,
      flatteningRequired: true,
      targetMode: 'rgb',
      targetBitDepth: 8,
      limitations: [
        'Indexed palettes expand to flat RGB pixels; palette tables, exact indices, and palette animation metadata are not preserved.',
        'Flatten before conversion because indexed-layer palette compositing is not modeled.',
      ],
    };
  }

  if (colorMode === 'grayscale') {
    return {
      required: true,
      flatteningRequired: true,
      targetMode: 'rgb',
      targetBitDepth: 8,
      limitations: [
        'Grayscale conversion uses flattened RGB luminance preview data; grayscale profiles and channel-specific edits are not preserved.',
      ],
    };
  }

  return {
    required: true,
    flatteningRequired: true,
    targetMode: 'rgb',
    targetBitDepth: 8,
    limitations: [
      'Lab conversion requires an external color-managed flatten or conversion before editing in Sloom Studio.',
    ],
  };
}

function describeColorModePrecision(
  colorMode: ImageWorkflowColorMode,
  bitDepth: ImageWorkflowBitDepth,
): ColorModePrecisionDescriptor {
  if (colorMode === 'indexed') {
    return {
      sourceBitDepth: bitDepth,
      workingBitDepth: 8,
      channelPrecision: '8-bit palette indices expanded to 8-bit RGB channels',
      notes: ['Indexed palette indices are expanded to RGB bytes before any editor operation.'],
    };
  }

  if (bitDepth === 16) {
    return {
      sourceBitDepth: bitDepth,
      workingBitDepth: 8,
      channelPrecision: '16-bit source is downgraded to 8-bit preview channels',
      notes: [HIGH_BIT_DEPTH_WARNINGS[16]],
    };
  }

  if (bitDepth === 32) {
    return {
      sourceBitDepth: bitDepth,
      workingBitDepth: 8,
      channelPrecision: '32-bit source is tone-mapped to 8-bit preview channels',
      notes: [HIGH_BIT_DEPTH_WARNINGS[32]],
    };
  }

  return {
    sourceBitDepth: bitDepth,
    workingBitDepth: 8,
    channelPrecision: '8-bit integer channels',
    notes: [],
  };
}

function buildColorModeProfileWarnings(profileLabel: string | null): string[] {
  if (!profileLabel) return [];
  return [`Requested ICC/profile "${profileLabel}" is retained as a label only; no ICC transform is applied.`];
}

export function convertRgbToGrayscalePreview(input: RgbBitmapInput): GrayscalePreview {
  const pixelCount = getPixelCount(input);
  const data = new Uint8ClampedArray(pixelCount * 4);
  const gray = new Uint8ClampedArray(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const luminance = rgbToLuminanceByte(input.data[offset], input.data[offset + 1], input.data[offset + 2]);
    gray[pixelIndex] = luminance;
    data[offset] = luminance;
    data[offset + 1] = luminance;
    data[offset + 2] = luminance;
    data[offset + 3] = input.data[offset + 3];
  }

  return {
    width: input.width,
    height: input.height,
    colorMode: 'grayscale-preview',
    channelLabel: 'Luminance Gray',
    data,
    gray,
    warnings: ['Grayscale preview uses deterministic RGB luminance and does not apply an ICC grayscale profile.'],
  };
}

export function buildRgbCmykSeparationPreview(input: RgbBitmapInput): CmykSeparationPreview {
  const pixelCount = getPixelCount(input);
  const cyan = new Uint8ClampedArray(pixelCount);
  const magenta = new Uint8ClampedArray(pixelCount);
  const yellow = new Uint8ClampedArray(pixelCount);
  const black = new Uint8ClampedArray(pixelCount);
  const alpha = new Uint8ClampedArray(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const r = input.data[offset] / 255;
    const g = input.data[offset + 1] / 255;
    const b = input.data[offset + 2] / 255;
    const k = 1 - Math.max(r, g, b);

    if (k >= 1) {
      cyan[pixelIndex] = 0;
      magenta[pixelIndex] = 0;
      yellow[pixelIndex] = 0;
      black[pixelIndex] = 255;
    } else {
      const scale = 1 - k;
      cyan[pixelIndex] = normalizedToByte((1 - r - k) / scale);
      magenta[pixelIndex] = normalizedToByte((1 - g - k) / scale);
      yellow[pixelIndex] = normalizedToByte((1 - b - k) / scale);
      black[pixelIndex] = normalizedToByte(k);
    }
    alpha[pixelIndex] = input.data[offset + 3];
  }

  return {
    width: input.width,
    height: input.height,
    colorMode: 'cmyk-separation-preview',
    profileLabel: 'Device RGB formula preview',
    nativeCmykExport: false,
    channels: [
      { id: 'cyan', label: 'Cyan', data: cyan },
      { id: 'magenta', label: 'Magenta', data: magenta },
      { id: 'yellow', label: 'Yellow', data: yellow },
      { id: 'black', label: 'Black', data: black },
    ],
    alpha,
    unsupportedModes: ['lab', 'indexed'],
    warnings: ['CMYK separations are formula previews from RGB pixels; ICC transforms and native CMYK export remain unavailable.'],
  };
}

function getPixelCount(input: RgbBitmapInput): number {
  const pixelCount = input.width * input.height;
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error('Image color-mode helpers require positive integer width and height.');
  }
  if (input.data.length < pixelCount * 4) {
    throw new Error('Image color-mode helpers require RGBA data for every pixel.');
  }
  return pixelCount;
}

function rgbToLuminanceByte(red: number, green: number, blue: number): number {
  return normalizedToByte(((0.2126 * red) + (0.7152 * green) + (0.0722 * blue)) / 255);
}

function normalizedToByte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
