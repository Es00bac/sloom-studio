import type {
  ImageColorProofIntent,
  ImageColorProofMetadata,
  ImageColorProofMode,
  ImageDocument,
} from '../../types/imageEditor';
import {
  createImageGamutCheckTransform,
} from '../../lib/iccTransforms';
import {
  convertImageCmykaBytesToRgba,
  convertImageRgbaBytesToCmyka,
} from './cmyk/ImageCmykDocument';

/** Actual ICC proof output; this is intentionally separate from legacy metadata-only proof descriptors. */
export interface ImageIccSoftProofExecution {
  rgba: Uint8Array;
  gamutWarnings: boolean[];
  outOfGamutPixels: number;
}

/**
 * Executes RGB→CMYKA→display through Little-CMS and runs its real gamut-check
 * transform. Transparent pixels can be rendered as the profile's zero-ink
 * paper white without changing the source RGB or CMYKA authority.
 */
export async function executeImageIccSoftProof(
  rgba: Uint8Array,
  width: number,
  height: number,
  profileBytes: Uint8Array,
  options: { intent?: 'relative' | 'perceptual' | 'saturation' | 'absolute'; blackPointCompensation?: boolean; paperWhiteSimulation?: boolean } = {},
): Promise<ImageIccSoftProofExecution> {
  const cmyka = await convertImageRgbaBytesToCmyka(rgba, width, height, profileBytes, options);
  if (options.paperWhiteSimulation) {
    for (let offset = 4; offset < cmyka.data.length; offset += 5) {
      if (cmyka.data[offset] === 0) cmyka.data[offset] = 255;
    }
  }
  const gamut = await createImageGamutCheckTransform(profileBytes, options);
  try {
    const gamutWarnings = gamut.checkImage(rgba, width, height);
    return {
      rgba: await convertImageCmykaBytesToRgba(cmyka, profileBytes, options),
      gamutWarnings,
      outOfGamutPixels: gamutWarnings.filter(Boolean).length,
    };
  } finally {
    gamut.dispose();
  }
}

export const DEFAULT_IMAGE_COLOR_PROOF: ImageColorProofMetadata = {
  mode: 'rgb',
  intent: 'screen-rgb',
};

export const IMAGE_COLOR_PROOF_MODES: Array<{ value: ImageColorProofMode; label: string }> = [
  { value: 'rgb', label: 'RGB' },
  { value: 'grayscale-soft-proof', label: 'Grayscale Soft Proof' },
  { value: 'cmyk-soft-proof', label: 'CMYK proof setup (legacy metadata)' },
];

export const IMAGE_COLOR_PROOF_INTENTS: Array<{ value: ImageColorProofIntent; label: string }> = [
  { value: 'screen-rgb', label: 'Screen RGB' },
  { value: 'grayscale-luminance', label: 'Luminance grayscale proof' },
  { value: 'relative-colorimetric', label: 'Relative colorimetric CMYK proof' },
  { value: 'perceptual', label: 'Perceptual CMYK proof' },
];

export const IMAGE_COLOR_PROOF_SETUP_PRESETS = [
  {
    id: 'screen-rgb',
    label: 'Screen RGB',
    setup: {
      mode: 'rgb',
      intent: 'screen-rgb',
    },
    summary: 'Native editable RGB canvas with no ICC proof transform.',
  },
  {
    id: 'grayscale-soft-proof',
    label: 'Luminance Grayscale Proof',
    setup: {
      mode: 'grayscale-soft-proof',
      intent: 'grayscale-luminance',
    },
    summary: 'Read-only luminance proof; edits stay RGB and grayscale conversion/export remain external.',
  },
  {
    id: 'cmyk-soft-proof-relative',
    label: 'CMYK Proof Setup (Legacy Metadata)',
    setup: {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
    },
    summary: 'Legacy proof metadata only; run the live ICC proof and gamut check for a rendered read-only LCMS preview. CMYK separation/export remain external.',
  },
  {
    id: 'cmyk-soft-proof-perceptual',
    label: 'CMYK Proof Setup Perceptual (Legacy Metadata)',
    setup: {
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
    },
    summary: 'Legacy perceptual-intent metadata only; live ICC proof must be run separately. Exports stay RGB plus proof labels.',
  },
] as const;

export type ImageColorProofPreviewPipeline =
  | 'browser-rgb-canvas'
  | 'rgb-luminance-soft-proof'
  | 'rgb-cmyk-proof-metadata';
export type ImageColorProofOperation = 'paint' | 'adjustments' | 'filters' | 'export';
export type ImageColorProofPolicy = 'native' | 'preview-only' | 'metadata-only';
export type ImageColorProofProfilePolicy = 'browser-rgb-only' | 'label-only';
export type ImageColorProofPreviewImplication =
  | 'native-rgb-preview'
  | 'luminance-soft-proof-preview'
  | 'cmyk-proof-metadata-preview';
export type ImageColorProofExportImplication = 'rgb-pixels-only' | 'rgb-pixels-plus-proof-metadata';
export type ImageColorProofProfileTransformBlockerCode =
  | 'browser-rgb-proof-only'
  | 'icc-proof-transform-unavailable'
  | 'grayscale-proof-conversion-external'
  | 'cmyk-proof-separation-external';

export interface ImageColorProofStatus {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  modeLabel: string;
  proofLabel: string;
  profileLabel?: string;
  nativeWorkingSpace: 'RGB';
  canExportNativeCmyk: false;
  warnings: string[];
}

export interface ImageColorProofPreviewDescriptor {
  label: string;
  proofLabel: string;
  pipeline: ImageColorProofPreviewPipeline;
  nativeWorkingSpace: 'RGB';
  iccTransformAvailable: false;
}

export interface ImageColorProofProfileDescriptor {
  requestedProfileLabel: string | null;
  appliedPolicy: ImageColorProofProfilePolicy;
  iccTransformAvailable: false;
  limitations: string[];
}

export interface ImageColorProofOperationDescriptor {
  operation: ImageColorProofOperation;
  supported: true;
  workingSpace: 'RGB';
  proofPolicy: ImageColorProofPolicy;
  previewImplication: ImageColorProofPreviewImplication;
  exportImplication: ImageColorProofExportImplication;
  profileTransformBlockers: ImageColorProofProfileTransformBlockerCode[];
  warnings: string[];
}

export interface ImageColorProofOperationCompatibilityDescriptor extends ImageColorProofOperationDescriptor {
  previewId: string;
}

export interface ImageColorProofPrintDescriptor {
  pressReady: false;
  nativeCmykExport: false;
  warnings: string[];
}

export interface ImageColorProofWorkflowDescriptor {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  preview: ImageColorProofPreviewDescriptor;
  profile: ImageColorProofProfileDescriptor;
  operations: Record<ImageColorProofOperation, ImageColorProofOperationDescriptor>;
  print: ImageColorProofPrintDescriptor;
  warnings: string[];
}

export type ImageColorProofAccuracy = 'native-rgb' | 'luminance-preview' | 'metadata-only';

export interface ImageColorProofPlanningPreviewDescriptor {
  id: string;
  pipeline: ImageColorProofPreviewPipeline;
  signature: string;
}

export interface ImageColorProofGamutWarningDescriptor {
  warningAvailable: false;
  summary: string;
}

export interface ImageColorProofSoftProofSummary {
  destructiveConversion: false;
  nativeWorkingSpace: 'RGB';
  nativeCmykExport: false;
  proofAccuracy: ImageColorProofAccuracy;
}

export interface ImageColorProofConversionDescriptor {
  flatteningRequiredForPress: boolean;
  limitations: string[];
}

export interface ImageColorProofProfileTransformDescriptor {
  status: 'unsupported';
  requestedProfileLabel: string | null;
  iccConversionAvailable: false;
  transformIntentSupport: 'metadata-only';
  blockerCodes: ImageColorProofProfileTransformBlockerCode[];
  limitations: string[];
}

export interface ImageColorProofPlanningDescriptor {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  preview: ImageColorProofPlanningPreviewDescriptor;
  iccHandoffContract: {
    metadataOnly: true;
    externalIccRequired: true;
    printReady: false;
    handoffPolicy: 'icc-profile-metadata-only';
    warnings: string[];
  };
  gamut: ImageColorProofGamutWarningDescriptor;
  profileTransform: ImageColorProofProfileTransformDescriptor;
  operationMatrix: Record<ImageColorProofOperation, ImageColorProofOperationCompatibilityDescriptor>;
  profileWarnings: string[];
  softProofSummary: ImageColorProofSoftProofSummary;
  conversion: ImageColorProofConversionDescriptor;
  printOutputWarnings: string[];
  warnings: string[];
  signature: string;
}

export type ImageColorProofReadinessBlockerCategory = 'conversion' | 'metadata-only' | 'print-export';
export type ImageColorProofReadinessBlockerCode =
  | 'external-proof-conversion-required'
  | 'proof-profile-metadata-only'
  | 'gamut-warning-unavailable'
  | 'export-proof-metadata-only'
  | 'native-proof-export-unavailable';

export interface ImageColorProofReadinessBlocker {
  code: ImageColorProofReadinessBlockerCode;
  category: ImageColorProofReadinessBlockerCategory;
  message: string;
}

export interface ImageColorProofReadinessPreviewState {
  id: string;
  pipeline: ImageColorProofPreviewPipeline;
  readOnly: boolean;
  deterministic: true;
  gamutWarningAvailable: false;
  signature: string;
}

export interface ImageColorProofProfileReadinessDescriptor {
  profileLabel: string | null;
  metadataOnly: boolean;
  iccTransformAvailable: false;
}

export interface ImageColorProofPrintExportReadinessDescriptor {
  exportPixelSpace: 'RGB';
  proofMetadataEmbedded: boolean;
  nativeCmykExport: false;
  pressReady: false;
  implications: string[];
}

export type ImageColorProofUnsupportedStateCode =
  | 'icc-proof-transform'
  | 'gamut-warning-overlay'
  | 'native-cmyk-proof-export'
  | 'native-grayscale-proof-export'
  | 'black-generation-tac-check'
  | 'dot-gain-proof-check';

export interface ImageColorProofUnsupportedState {
  code: ImageColorProofUnsupportedStateCode;
  message: string;
}

export type ImageColorProofSeparationRequest = 'screen-rgb' | 'grayscale-plate' | 'process-cmyk';
export type ImageColorProofSeparationUnsupportedCode =
  | 'process-cmyk-separations'
  | 'grayscale-plate-export'
  | 'spot-color-plates'
  | 'icc-output-profile-conversion'
  | 'black-generation-tac-check';

export interface ImageColorProofSeparationUnsupportedState {
  code: ImageColorProofSeparationUnsupportedCode;
  message: string;
}

export interface ImageColorProofSeparationReadinessDescriptor {
  requested: ImageColorProofSeparationRequest;
  nativeSeparationAvailable: false;
  outputPixelSpace: 'RGB';
  pressReady: false;
  externalRequired: true;
  unsupported: ImageColorProofSeparationUnsupportedState[];
  signature: string;
}

export interface ImageColorProofReadinessDescriptor {
  descriptorId: 'image-color-proof-readiness:v1';
  ready: boolean;
  previewReady: boolean;
  pressReady: false;
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  profileLabel: string | null;
  previewState: ImageColorProofReadinessPreviewState;
  profile: ImageColorProofProfileReadinessDescriptor;
  conversionBlockers: ImageColorProofReadinessBlocker[];
  metadataOnlyBlockers: ImageColorProofReadinessBlocker[];
  printExport: ImageColorProofPrintExportReadinessDescriptor;
  separations: ImageColorProofSeparationReadinessDescriptor;
  operationCaveats: Record<ImageColorProofOperation, string[]>;
  unsupportedStates: ImageColorProofUnsupportedState[];
  blockers: ImageColorProofReadinessBlocker[];
  previewSignature: string;
}

export type ImageColorProofOperationalPreviewPolicy = 'native' | 'preview-only';
export type ImageColorProofOperationalConversionPolicy = 'none' | 'external-proof-conversion-required';
export type ImageColorProofOperationalProfilePolicy = 'browser-rgb-only' | 'metadata-only';
export type ImageColorProofOperationalExportPolicy = 'native-rgb' | 'rgb-pixels-plus-proof-metadata';
export type ImageColorProofOperationalDestructiveRisk = 'none' | 'metadata-only-proof';

export interface ImageColorProofOperationalStateDescriptor {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  proofLabel: string;
  profileLabel: string | null;
  nativeWorkingSpace: 'RGB';
}

export interface ImageColorProofOperationalPolicyDescriptor {
  previewPolicy: ImageColorProofOperationalPreviewPolicy;
  conversionPolicy: ImageColorProofOperationalConversionPolicy;
  profilePolicy: ImageColorProofOperationalProfilePolicy;
  exportPolicy: ImageColorProofOperationalExportPolicy;
}

export interface ImageColorProofActionSuitabilityDescriptor {
  suitable: boolean;
  recordable: boolean;
  deterministic: true;
  destructiveRisk: ImageColorProofOperationalDestructiveRisk;
}

export interface ImageColorProofBatchSuitabilityDescriptor {
  suitable: boolean;
  reason: string;
}

export interface ImageColorProofOperationalReadinessDescriptor {
  descriptorId: 'image-color-proof-operational-readiness:v1';
  ready: boolean;
  state: ImageColorProofOperationalStateDescriptor;
  policy: ImageColorProofOperationalPolicyDescriptor;
  iccProfileLimitations: string[];
  previewAndGamutCaveats: string[];
  exportPrintCaveats: string[];
  unsupportedPhotoshopStates: string[];
  suiteHandoffGuidance: string[];
  actionSuitability: ImageColorProofActionSuitabilityDescriptor;
  batchSuitability: ImageColorProofBatchSuitabilityDescriptor;
  signature: string;
}

export type ImageColorProofHighBitUnsupportedCode =
  | 'high-bit-proof-transform'
  | 'high-bit-proof-export'
  | 'high-bit-gamut-warning';

export interface ImageColorProofHighBitImplication {
  supported: boolean;
  precision: string;
  caveat: string;
}

export interface ImageColorProofHighBitFallbackRecommendation {
  route: 'external-high-bit-color-managed-proof' | '8bit-rgb-proof-derivative' | 'keep-high-bit-master';
  label: string;
  preserves: string;
  recommendedFor: string;
  caveat: string;
}

export interface ImageColorProofHighBitUnsupportedState {
  code: ImageColorProofHighBitUnsupportedCode;
  message: string;
}

export interface ImageColorProofHighBitImplicationsDescriptor {
  descriptorId: 'image-color-proof-high-bit-implications:v1';
  proofMode: ImageColorProofMode;
  proofIntent: ImageColorProofIntent;
  profileLabel: string | null;
  sourceFormat: string;
  sourceBitDepth: 8 | 16 | 32;
  proofPreviewBitDepth: 8;
  exportBitDepth: 8;
  proofDoesNotPreserveHighBitDepth: boolean;
  proofMetadataOnly: boolean;
  exportPixelSpace: 'RGB';
  implicationMatrix: {
    preview: ImageColorProofHighBitImplication;
    export: ImageColorProofHighBitImplication;
    gamutWarning: ImageColorProofHighBitImplication;
  };
  fallbackRecommendations: ImageColorProofHighBitFallbackRecommendation[];
  unsupportedStates: ImageColorProofHighBitUnsupportedState[];
  stableSignature: string;
}

export interface ImageColorProofReadOnlyStatePreviewDescriptor {
  readOnly: boolean;
  deterministic: true;
  editablePixelSpace: 'RGB';
  proofChangesPixels: false;
  previewAccuracy: ImageColorProofAccuracy;
  gamutWarningAvailable: false;
  signature: string;
}

export interface ImageColorProofReadOnlySeparationDescriptor {
  nativeSeparationAvailable: false;
  outputPixelSpace: 'RGB';
  blackGenerationAvailable: false;
  totalAreaCoverageCheckAvailable: false;
  dotGainCheckAvailable: false;
  overprintSimulationAvailable: false;
  caveats: string[];
}

export interface ImageColorProofReadOnlyOperationDescriptor {
  operation: ImageColorProofOperation;
  editsPixelSpace: 'RGB';
  proofReadOnly: boolean;
  proofPolicy: ImageColorProofPolicy;
  actionRecordable: true;
  batchSuitable: boolean;
  caveats: string[];
}

export interface ImageColorProofReadOnlyStateDescriptor {
  descriptorId: 'image-color-proof-read-only-state:v1';
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  profileLabel: string | null;
  state: ImageColorProofReadOnlyStatePreviewDescriptor;
  separations: ImageColorProofReadOnlySeparationDescriptor;
  operationMatrix: Record<ImageColorProofOperation, ImageColorProofReadOnlyOperationDescriptor>;
  actionSuitability: ImageColorProofActionSuitabilityDescriptor;
  batchSuitability: ImageColorProofBatchSuitabilityDescriptor;
  stableSignature: string;
}

type UnknownProofSetup = Partial<ImageColorProofMetadata> | null | undefined;
const IMAGE_COLOR_PROOF_OPERATIONS: ImageColorProofOperation[] = ['paint', 'adjustments', 'filters', 'export'];

export function normalizeImageColorProofSetup(setup: UnknownProofSetup): ImageColorProofMetadata {
  const mode = isImageColorProofMode(setup?.mode) ? setup.mode : DEFAULT_IMAGE_COLOR_PROOF.mode;
  const intent = normalizeIntentForMode(mode, setup?.intent);
  const profileLabel = typeof setup?.profileLabel === 'string'
    ? setup.profileLabel.trim()
    : '';

  return {
    mode,
    intent,
    ...(profileLabel ? { profileLabel } : {}),
  };
}

export function buildImageColorProofStatus(doc: ImageDocument): ImageColorProofStatus {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const warnings = ['Image currently composites and exports pixels through the RGB renderer.'];

  if (setup.mode === 'cmyk-soft-proof') {
    warnings.push('This saved CMYK proof setup is legacy metadata only; run the live ICC proof and gamut check in CMYK document mode to render a read-only LCMS preview.');
    warnings.push('No CMYK separations or native CMYK export are generated by the legacy proof setup.');
  }
  if (setup.mode === 'grayscale-soft-proof') {
    warnings.push('Grayscale proof does not destructively convert layer pixels.');
  }

  return {
    mode: setup.mode,
    intent: setup.intent,
    modeLabel: labelForMode(setup.mode),
    proofLabel: labelForIntent(setup.intent),
    profileLabel: setup.profileLabel,
    nativeWorkingSpace: 'RGB',
    canExportNativeCmyk: false,
    warnings,
  };
}

export function applyImageColorProofSetup(
  doc: ImageDocument,
  setup: UnknownProofSetup,
): ImageDocument {
  const colorProof = normalizeImageColorProofSetup(setup);
  const current = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  if (isSameProofSetup(current, colorProof)) return doc;

  return {
    ...doc,
    dirty: true,
    metadata: {
      ...doc.metadata,
      colorProof,
    },
  };
}

export function buildImageColorProofWorkflowDescriptor(doc: ImageDocument): ImageColorProofWorkflowDescriptor {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const status = buildImageColorProofStatus(doc);
  const profile = buildProofProfileDescriptor(setup);
  const operations = IMAGE_COLOR_PROOF_OPERATIONS.reduce<Record<ImageColorProofOperation, ImageColorProofOperationDescriptor>>(
    (accumulator, operation) => {
      accumulator[operation] = buildProofOperationDescriptor(setup.mode, operation);
      return accumulator;
    },
    {} as Record<ImageColorProofOperation, ImageColorProofOperationDescriptor>,
  );
  const print = buildProofPrintDescriptor(setup.mode);

  return {
    mode: setup.mode,
    intent: setup.intent,
    preview: {
      label: labelForMode(setup.mode),
      proofLabel: labelForIntent(setup.intent),
      pipeline: pipelineForProofMode(setup.mode),
      nativeWorkingSpace: 'RGB',
      iccTransformAvailable: false,
    },
    profile,
    operations,
    print,
    warnings: uniqueStrings([
      ...status.warnings,
      ...profile.limitations,
      ...Object.values(operations).flatMap((operationDescriptor) => operationDescriptor.warnings),
      ...print.warnings,
    ]),
  };
}

export function buildImageColorProofPlanningDescriptor(doc: ImageDocument): ImageColorProofPlanningDescriptor {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const pipeline = pipelineForProofMode(setup.mode);
  const profileLabel = setup.profileLabel?.trim() || null;
  const proofAccuracy = proofAccuracyForMode(setup.mode);
  const gamut = buildProofGamutDescriptor(setup.mode);
  const profileWarnings = buildProofProfileWarnings(profileLabel);
  const iccHandoffContract = buildProofIccHandoffContract(setup.mode);
  const conversion = buildProofConversionDescriptor(setup.mode);
  const profileTransform = buildProofProfileTransformDescriptor(setup.mode, profileLabel);
  const operationMatrix = buildProofOperationMatrix(setup.mode, setup.intent);
  const printOutputWarnings = buildProofPrintOutputWarnings(setup.mode);

  return {
    mode: setup.mode,
    intent: setup.intent,
    preview: {
      id: `proof-preview:${setup.mode}:${setup.intent}:${profileLabel ?? 'unmanaged'}`,
      pipeline,
      signature: `proof:${setup.mode}:${setup.intent}:${profileLabel ?? 'unmanaged'}:${pipeline}`,
    },
    iccHandoffContract: {
      metadataOnly: true,
      externalIccRequired: true,
      printReady: false,
      handoffPolicy: 'icc-profile-metadata-only',
      warnings: iccHandoffContract,
    },
    gamut,
    profileTransform,
    operationMatrix,
    profileWarnings,
    softProofSummary: {
      destructiveConversion: false,
      nativeWorkingSpace: 'RGB',
      nativeCmykExport: false,
      proofAccuracy,
    },
    conversion,
    printOutputWarnings,
    warnings: uniqueStrings([
      gamut.summary,
      ...iccHandoffContract,
      ...profileTransform.limitations,
      ...profileWarnings,
      ...conversion.limitations,
      ...printOutputWarnings,
    ]),
    signature: `proof-plan:${setup.mode}:${setup.intent}:${profileLabel ?? 'unmanaged'}:${proofAccuracy}`,
  };
}

export function describeImageColorProofReadiness(doc: ImageDocument): ImageColorProofReadinessDescriptor {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const planning = buildImageColorProofPlanningDescriptor(doc);
  const profileLabel = setup.profileLabel?.trim() || null;
  const profileSignatureLabel = profileLabel ?? 'unmanaged';
  const previewReadOnly = setup.mode !== 'rgb';
  const conversionBlockers = buildProofReadinessConversionBlockers(setup.mode);
  const metadataOnlyBlockers = buildProofReadinessMetadataOnlyBlockers(setup.mode, profileLabel);
  const printExport = buildProofReadinessPrintExport(setup.mode);
  const printExportBlockers = buildProofReadinessPrintExportBlockers(setup.mode);
  const separations = buildProofSeparationReadiness(setup, profileLabel);
  const blockers = dedupeProofReadinessBlockers([
    ...conversionBlockers,
    ...metadataOnlyBlockers,
    ...printExportBlockers,
  ]);
  const previewState = {
    id: `image-color-proof-readiness-preview:${setup.mode}:${setup.intent}:${profileSignatureLabel}`,
    pipeline: planning.preview.pipeline,
    readOnly: previewReadOnly,
    deterministic: true,
    gamutWarningAvailable: planning.gamut.warningAvailable,
    signature: buildProofReadinessPreviewStateSignature({
      mode: setup.mode,
      intent: setup.intent,
      pipeline: planning.preview.pipeline,
      profileLabel: profileSignatureLabel,
      readOnly: previewReadOnly,
    }),
  } satisfies ImageColorProofReadinessPreviewState;

  return {
    descriptorId: 'image-color-proof-readiness:v1',
    ready: blockers.length === 0,
    previewReady: true,
    pressReady: false,
    mode: setup.mode,
    intent: setup.intent,
    profileLabel,
    previewState,
    profile: {
      profileLabel,
      metadataOnly: Boolean(profileLabel),
      iccTransformAvailable: false,
    },
    conversionBlockers,
    metadataOnlyBlockers,
    printExport,
    separations,
    operationCaveats: buildProofReadinessOperationCaveats(setup, profileLabel),
    unsupportedStates: buildProofReadinessUnsupportedStates(setup.mode),
    blockers,
    previewSignature: buildProofReadinessSignature({
      mode: setup.mode,
      intent: setup.intent,
      profileLabel: profileSignatureLabel,
      previewReadOnly,
      gamutWarningAvailable: planning.gamut.warningAvailable,
      blockerCodes: blockers.map((blocker) => blocker.code),
    }),
  };
}

export function describeImageColorProofOperationalReadiness(doc: ImageDocument): ImageColorProofOperationalReadinessDescriptor {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const planning = buildImageColorProofPlanningDescriptor(doc);
  const readiness = describeImageColorProofReadiness(doc);
  const profileLabel = setup.profileLabel?.trim() || null;
  const ready = readiness.ready;

  return {
    descriptorId: 'image-color-proof-operational-readiness:v1',
    ready,
    state: {
      mode: setup.mode,
      intent: setup.intent,
      proofLabel: labelForIntent(setup.intent),
      profileLabel,
      nativeWorkingSpace: 'RGB',
    },
    policy: {
      previewPolicy: setup.mode === 'rgb' ? 'native' : 'preview-only',
      conversionPolicy: setup.mode === 'rgb' ? 'none' : 'external-proof-conversion-required',
      profilePolicy: setup.mode === 'rgb' ? 'browser-rgb-only' : 'metadata-only',
      exportPolicy: setup.mode === 'rgb' ? 'native-rgb' : 'rgb-pixels-plus-proof-metadata',
    },
    iccProfileLimitations: buildProofOperationalIccLimitations(readiness, planning),
    previewAndGamutCaveats: uniqueStrings([
      planning.gamut.summary,
      ...readiness.metadataOnlyBlockers
        .filter((blocker) => blocker.code === 'gamut-warning-unavailable')
        .map((blocker) => blocker.message),
    ]),
    exportPrintCaveats: readiness.printExport.implications,
    unsupportedPhotoshopStates: buildProofUnsupportedPhotoshopStates(setup.mode),
    suiteHandoffGuidance: buildProofSuiteHandoffGuidance(setup.mode),
    actionSuitability: {
      suitable: ready,
      recordable: true,
      deterministic: true,
      destructiveRisk: ready ? 'none' : 'metadata-only-proof',
    },
    batchSuitability: buildProofBatchSuitability(ready, setup.mode),
    signature: [
      'image-color-proof-operational-readiness:v1',
      setup.mode,
      setup.intent,
      profileLabel ?? 'unmanaged',
      ready ? 'ready' : 'blocked',
    ].join(':'),
  };
}

export function describeImageColorProofHighBitImplications(
  doc: ImageDocument,
  input: {
    sourceFormat?: string;
    sourceBitDepth: 8 | 16 | 32;
  },
): ImageColorProofHighBitImplicationsDescriptor {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const profileLabel = setup.profileLabel?.trim() || null;
  const sourceFormat = normalizeProofSourceFormat(input.sourceFormat);
  const unsupportedStates = buildProofHighBitUnsupportedStates(input.sourceBitDepth);

  return {
    descriptorId: 'image-color-proof-high-bit-implications:v1',
    proofMode: setup.mode,
    proofIntent: setup.intent,
    profileLabel,
    sourceFormat,
    sourceBitDepth: input.sourceBitDepth,
    proofPreviewBitDepth: 8,
    exportBitDepth: 8,
    proofDoesNotPreserveHighBitDepth: input.sourceBitDepth !== 8,
    proofMetadataOnly: setup.mode !== 'rgb' || Boolean(profileLabel),
    exportPixelSpace: 'RGB',
    implicationMatrix: {
      preview: buildProofHighBitPreviewImplication(setup.mode, input.sourceBitDepth),
      export: buildProofHighBitExportImplication(setup.mode, input.sourceBitDepth),
      gamutWarning: buildProofHighBitGamutImplication(setup.mode),
    },
    fallbackRecommendations: buildProofHighBitFallbackRecommendations(
      sourceFormat,
      input.sourceBitDepth,
    ),
    unsupportedStates,
    stableSignature: [
      'image-color-proof-high-bit-implications:v1',
      `mode=${setup.mode}`,
      `intent=${setup.intent}`,
      `profile=${profileLabel ?? 'unmanaged'}`,
      `format=${sourceFormat}`,
      `bits=${input.sourceBitDepth}`,
      'preview=8',
      'export=8',
      `unsupported=${unsupportedStates.map((state) => state.code).join(',') || 'none'}`,
    ].join('|'),
  };
}

export function describeImageColorProofReadOnlyState(
  doc: ImageDocument,
): ImageColorProofReadOnlyStateDescriptor {
  const setup = normalizeImageColorProofSetup(doc.metadata?.colorProof);
  const profileLabel = setup.profileLabel?.trim() || null;
  const profileSignatureLabel = profileLabel ?? 'unmanaged';
  const readOnly = setup.mode !== 'rgb';
  const previewAccuracy = proofAccuracyForMode(setup.mode);
  const operationMatrix = buildProofReadOnlyOperationMatrix(setup, profileLabel);

  return {
    descriptorId: 'image-color-proof-read-only-state:v1',
    mode: setup.mode,
    intent: setup.intent,
    profileLabel,
    state: {
      readOnly,
      deterministic: true,
      editablePixelSpace: 'RGB',
      proofChangesPixels: false,
      previewAccuracy,
      gamutWarningAvailable: false,
      signature: [
        'image-color-proof-read-only-state-preview:v1',
        setup.mode,
        setup.intent,
        profileSignatureLabel,
        readOnly ? 'read-only' : 'editable',
        previewAccuracy,
      ].join(':'),
    },
    separations: buildProofReadOnlySeparationDescriptor(setup.mode),
    operationMatrix,
    actionSuitability: {
      suitable: !readOnly,
      recordable: true,
      deterministic: true,
      destructiveRisk: readOnly ? 'metadata-only-proof' : 'none',
    },
    batchSuitability: buildProofBatchSuitability(!readOnly, setup.mode),
    stableSignature: [
      'image-color-proof-read-only-state:v1',
      `mode=${setup.mode}`,
      `intent=${setup.intent}`,
      `profile=${profileSignatureLabel}`,
      `readOnly=${String(readOnly)}`,
      `accuracy=${previewAccuracy}`,
      `ops=${IMAGE_COLOR_PROOF_OPERATIONS.map((operation) => {
        const descriptor = operationMatrix[operation];
        return `${operation}:${descriptor.proofPolicy}:${descriptor.proofReadOnly ? 'read-only' : 'editable'}`;
      }).join(',')}`,
    ].join('|'),
  };
}

function buildProofReadOnlyOperationMatrix(
  setup: ImageColorProofMetadata,
  profileLabel: string | null,
): Record<ImageColorProofOperation, ImageColorProofReadOnlyOperationDescriptor> {
  const proofReadOnly = setup.mode !== 'rgb';
  const operationCaveats = buildProofReadinessOperationCaveats(setup, profileLabel);

  return IMAGE_COLOR_PROOF_OPERATIONS.reduce<Record<ImageColorProofOperation, ImageColorProofReadOnlyOperationDescriptor>>(
    (accumulator, operation) => {
      const operationDescriptor = buildProofOperationDescriptor(setup.mode, operation);
      accumulator[operation] = {
        operation,
        editsPixelSpace: 'RGB',
        proofReadOnly,
        proofPolicy: operationDescriptor.proofPolicy,
        actionRecordable: true,
        batchSuitable: !proofReadOnly,
        caveats: operationCaveats[operation],
      };
      return accumulator;
    },
    {} as Record<ImageColorProofOperation, ImageColorProofReadOnlyOperationDescriptor>,
  );
}

function buildProofReadOnlySeparationDescriptor(
  mode: ImageColorProofMode,
): ImageColorProofReadOnlySeparationDescriptor {
  return {
    nativeSeparationAvailable: false,
    outputPixelSpace: 'RGB',
    blackGenerationAvailable: false,
    totalAreaCoverageCheckAvailable: false,
    dotGainCheckAvailable: false,
    overprintSimulationAvailable: false,
    caveats: buildProofReadOnlySeparationCaveats(mode),
  };
}

function buildProofReadOnlySeparationCaveats(mode: ImageColorProofMode): string[] {
  if (mode === 'cmyk-soft-proof') {
    return [
      'CMYK process plates are not generated; this saved proof selection remains legacy metadata until a live ICC proof is run.',
      'Black generation and total area coverage checks are not computed for press readiness.',
      'Overprint simulation is unavailable; validate overprint and ink limits externally.',
    ];
  }

  if (mode === 'grayscale-soft-proof') {
    return [
      'Native grayscale plates are not generated; grayscale proof remains an RGB luminance preview plus metadata.',
      'Dot-gain proof checks are not computed for press readiness.',
      'Overprint and spot-color plate behavior must be validated externally.',
    ];
  }

  return [
    'RGB screen proof does not generate process CMYK separations.',
    'Custom display/output ICC conversion is unavailable; RGB canvas pixels remain browser-managed.',
    'Press separations, overprint, TAC, and black generation checks require an external proofing workflow.',
  ];
}

function buildProofHighBitPreviewImplication(
  mode: ImageColorProofMode,
  sourceBitDepth: 8 | 16 | 32,
): ImageColorProofHighBitImplication {
  if (mode === 'cmyk-soft-proof') {
    return {
      supported: true,
      precision: '8-bit legacy CMYK proof metadata',
      caveat: `The saved CMYK proof setup does not render source pixels; ${sourceBitDepth}-bit source precision and ICC gamut mapping require the live ICC proof or external proofing.`,
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      supported: true,
      precision: '8-bit luminance proof preview',
      caveat: `Grayscale soft proof previews the 8-bit RGB derivative; ${sourceBitDepth}-bit source precision and dot-gain behavior are not evaluated.`,
    };
  }

  return {
    supported: true,
    precision: '8-bit RGB screen preview',
    caveat: `RGB proof previews the browser-managed 8-bit RGB derivative; ${sourceBitDepth}-bit source precision and custom display ICC transforms are not evaluated.`,
  };
}

function buildProofHighBitExportImplication(
  mode: ImageColorProofMode,
  sourceBitDepth: 8 | 16 | 32,
): ImageColorProofHighBitImplication {
  if (mode === 'cmyk-soft-proof') {
    return {
      supported: true,
      precision: '8-bit RGB export plus proof metadata',
      caveat: `Export writes RGB pixels plus CMYK proof metadata only; no ${sourceBitDepth}-bit CMYK separation or ICC proof transform is produced.`,
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      supported: true,
      precision: '8-bit RGB export plus proof metadata',
      caveat: `Export writes RGB pixels plus grayscale proof metadata only; no ${sourceBitDepth}-bit grayscale conversion or ICC proof transform is produced.`,
    };
  }

  return {
    supported: true,
    precision: '8-bit RGB export',
    caveat: `Export writes browser RGB pixels only; no ${sourceBitDepth}-bit output profile conversion is produced.`,
  };
}

function buildProofHighBitGamutImplication(
  mode: ImageColorProofMode,
): ImageColorProofHighBitImplication {
  if (mode === 'cmyk-soft-proof') {
    return {
      supported: false,
      precision: 'unavailable',
      caveat: 'Gamut warnings are unavailable for high-bit CMYK proof handoff; use an external color-managed proofing tool.',
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      supported: false,
      precision: 'unavailable',
      caveat: 'Gamut warnings are unavailable for high-bit grayscale proof handoff; use an external color-managed proofing tool.',
    };
  }

  return {
    supported: false,
    precision: 'unavailable',
    caveat: 'Gamut warnings are unavailable for high-bit RGB proof handoff; use an external color-managed proofing tool.',
  };
}

function buildProofHighBitFallbackRecommendations(
  sourceFormat: string,
  sourceBitDepth: 8 | 16 | 32,
): ImageColorProofHighBitFallbackRecommendation[] {
  return [
    {
      route: 'external-high-bit-color-managed-proof',
      label: 'External high-bit proof',
      preserves: `${sourceBitDepth}-bit precision, ICC soft-proof transform, gamut warning, and press separation checks`,
      recommendedFor: 'Production print proofing, archive masters, and color-critical review.',
      caveat: 'Sloom Studio proof metadata can guide setup, but it is not production proof evidence.',
    },
    {
      route: '8bit-rgb-proof-derivative',
      label: '8-bit RGB proof derivative',
      preserves: 'screen-visible approximation for Image, Flow, Video, and Paper handoff',
      recommendedFor: 'Suite preview or storyboard review after accepting high-bit precision loss.',
      caveat: 'Derivative proof cannot validate out-of-gamut colors, TAC, black generation, or high-bit gradients.',
    },
    {
      route: 'keep-high-bit-master',
      label: 'Keep high-bit master',
      preserves: `the original ${sourceFormat} source for re-proofing and final output`,
      recommendedFor: 'Any downstream workflow that may need revised color management.',
      caveat: 'Image edits do not update the retained high-bit master automatically.',
    },
  ];
}

function buildProofHighBitUnsupportedStates(
  sourceBitDepth: 8 | 16 | 32,
): ImageColorProofHighBitUnsupportedState[] {
  if (sourceBitDepth === 8) return [];

  return [
    {
      code: 'high-bit-proof-transform',
      message: `${sourceBitDepth}-bit ICC proof transforms are unsupported; previews use an 8-bit RGB derivative.`,
    },
    {
      code: 'high-bit-proof-export',
      message: `${sourceBitDepth}-bit proof export/separations are unsupported; exports remain 8-bit RGB plus metadata.`,
    },
    {
      code: 'high-bit-gamut-warning',
      message: 'High-bit gamut warning overlays are unsupported in Image proof readiness.',
    },
  ];
}

function normalizeProofSourceFormat(sourceFormat: string | undefined): string {
  const normalized = sourceFormat?.trim();
  return normalized || 'Image source';
}

function buildProofIccHandoffContract(mode: ImageColorProofMode): string[] {
  const modeWarning = mode === 'cmyk-soft-proof'
    ? 'Press conversions are not performed in-editor for CMYK soft-proof mode.'
    : mode === 'grayscale-soft-proof'
      ? 'Press conversions are not performed in-editor for grayscale soft-proof mode.'
      : 'Press conversions are not performed in-editor for RGB screen proof mode.';

  return [
    'Proof setup/profile labels are carried as handoff metadata only.',
    'ICC-converted proof and separations require an external color-managed workflow.',
    modeWarning,
  ];
}

function buildProofOperationalIccLimitations(
  readiness: ImageColorProofReadinessDescriptor,
  planning: ImageColorProofPlanningDescriptor,
): string[] {
  const blockerMessages = readiness.metadataOnlyBlockers
    .filter((blocker) => blocker.code === 'proof-profile-metadata-only')
    .map((blocker) => blocker.message);
  const limitations = blockerMessages.length > 0
    ? blockerMessages
    : planning.profileTransform.limitations;

  return uniqueStrings(limitations);
}

function buildProofUnsupportedPhotoshopStates(mode: ImageColorProofMode): string[] {
  if (mode === 'rgb') {
    return ['custom display-profile transforms'];
  }

  if (mode === 'grayscale-soft-proof') {
    return [
      'ICC soft-proof transforms',
      'out-of-gamut warning overlay',
      'native grayscale proof export',
      'dot-gain proof checks',
    ];
  }

  return [
    'ICC soft-proof transforms',
    'out-of-gamut warning overlay',
    'native CMYK proof export/separations',
    'black generation/TAC proof checks',
  ];
}

function buildProofBatchSuitability(
  ready: boolean,
  mode: ImageColorProofMode,
): ImageColorProofBatchSuitabilityDescriptor {
  if (ready) {
    return {
      suitable: true,
      reason: 'RGB screen-proof metadata is deterministic and can be included in recorded actions.',
    };
  }

  return {
    suitable: false,
    reason: mode === 'cmyk-soft-proof'
      ? 'Batch proof handoff requires external ICC-managed conversion/separation before production output.'
      : 'Batch proof handoff requires external ICC-managed grayscale conversion before production output.',
  };
}

function buildProofSuiteHandoffGuidance(mode: ImageColorProofMode): string[] {
  if (mode === 'rgb') {
    return [
      'RGB proof stays editable in-suite; downstream consumers can reuse the same 8-bit RGB pixels.',
      'Attach any display/profile labels as guidance only because preview pixels are not ICC transformed.',
    ];
  }

  if (mode === 'grayscale-soft-proof') {
    return [
      'Keep proof presets attached as metadata when handing work to Flow, Video, or external print apps.',
      'Run final ICC grayscale conversion outside Sloom Studio before production handoff.',
      'Do not treat the soft-proof preview as native grayscale evidence in automated suites.',
    ];
  }

  return [
    'Keep proof presets attached as metadata when handing work to Flow, Video, or external print apps.',
    'Run final ICC conversion and CMYK separation outside Sloom Studio before production handoff.',
    'Do not treat the soft-proof preview as native CMYK evidence in automated suites.',
  ];
}

function buildProofReadinessConversionBlockers(
  mode: ImageColorProofMode,
): ImageColorProofReadinessBlocker[] {
  if (mode === 'rgb') return [];

  return [
    {
      code: 'external-proof-conversion-required',
      category: 'conversion',
      message: mode === 'cmyk-soft-proof'
        ? 'CMYK soft proof requires external ICC-managed conversion/separation for press-ready output.'
        : 'Grayscale soft proof requires external ICC-managed grayscale conversion for press-ready output.',
    },
  ];
}

function buildProofReadinessMetadataOnlyBlockers(
  mode: ImageColorProofMode,
  profileLabel: string | null,
): ImageColorProofReadinessBlocker[] {
  if (mode === 'rgb') {
    return profileLabel
      ? [
          {
            code: 'proof-profile-metadata-only',
            category: 'metadata-only',
            message: `Proof profile "${profileLabel}" is stored as metadata only; preview pixels are not ICC transformed.`,
          },
        ]
      : [];
  }

  const label = mode === 'cmyk-soft-proof' ? 'CMYK soft proof' : 'grayscale soft proof';
  const exportLabel = mode === 'cmyk-soft-proof' ? 'CMYK proof' : 'grayscale proof';
  const blockers: ImageColorProofReadinessBlocker[] = [];

  if (profileLabel) {
    blockers.push({
      code: 'proof-profile-metadata-only',
      category: 'metadata-only',
      message: `Proof profile "${profileLabel}" is stored as metadata only; preview pixels are not ICC transformed.`,
    });
  }

  blockers.push(
    {
      code: 'gamut-warning-unavailable',
      category: 'metadata-only',
      message: `Gamut warning state is unavailable for ${label} previews.`,
    },
    {
      code: 'export-proof-metadata-only',
      category: 'metadata-only',
      message: `Export keeps RGB pixels and stores ${exportLabel} setup as metadata only.`,
    },
  );

  return blockers;
}

function buildProofReadinessPrintExport(
  mode: ImageColorProofMode,
): ImageColorProofPrintExportReadinessDescriptor {
  if (mode === 'cmyk-soft-proof') {
    return {
      exportPixelSpace: 'RGB',
      proofMetadataEmbedded: true,
      nativeCmykExport: false,
      pressReady: false,
      implications: [
        'CMYK soft proof is not a press-ready separation; exported pixels remain RGB.',
        'Embed or assign press ICC profiles in an external prepress application before production handoff.',
      ],
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      exportPixelSpace: 'RGB',
      proofMetadataEmbedded: true,
      nativeCmykExport: false,
      pressReady: false,
      implications: [
        'Grayscale soft proof is not a press-managed grayscale conversion; exported pixels remain RGB.',
        'Convert grayscale through an external ICC-managed workflow before production handoff.',
      ],
    };
  }

  return {
    exportPixelSpace: 'RGB',
    proofMetadataEmbedded: false,
    nativeCmykExport: false,
    pressReady: false,
    implications: [
      'RGB screen proof exports RGB pixels; press-managed CMYK or grayscale conversion remains external.',
    ],
  };
}

function buildProofReadinessPrintExportBlockers(
  mode: ImageColorProofMode,
): ImageColorProofReadinessBlocker[] {
  if (mode === 'rgb') return [];

  return [
    {
      code: 'native-proof-export-unavailable',
      category: 'print-export',
      message: mode === 'cmyk-soft-proof'
        ? 'Native CMYK proof export is unavailable; exported pixels remain RGB plus proof metadata.'
        : 'Native grayscale proof export is unavailable; exported pixels remain RGB plus proof metadata.',
    },
  ];
}

function buildProofSeparationReadiness(
  setup: ImageColorProofMetadata,
  profileLabel: string | null,
): ImageColorProofSeparationReadinessDescriptor {
  const requested = getProofSeparationRequest(setup.mode);
  const unsupported = buildProofSeparationUnsupportedStates(setup.mode);

  return {
    requested,
    nativeSeparationAvailable: false,
    outputPixelSpace: 'RGB',
    pressReady: false,
    externalRequired: true,
    unsupported,
    signature: [
      'image-color-proof-separations:v1',
      `mode=${setup.mode}`,
      `intent=${setup.intent}`,
      `profile=${profileLabel ?? 'unmanaged'}`,
      `requested=${requested}`,
      'supported=false',
      `unsupported=${unsupported.map((state) => state.code).join(',')}`,
    ].join('|'),
  };
}

function getProofSeparationRequest(mode: ImageColorProofMode): ImageColorProofSeparationRequest {
  if (mode === 'cmyk-soft-proof') return 'process-cmyk';
  if (mode === 'grayscale-soft-proof') return 'grayscale-plate';
  return 'screen-rgb';
}

function buildProofSeparationUnsupportedStates(
  mode: ImageColorProofMode,
): ImageColorProofSeparationUnsupportedState[] {
  if (mode === 'cmyk-soft-proof') {
    return [
      {
        code: 'process-cmyk-separations',
        message: 'CMYK process plates are not generated; this saved proof selection is legacy metadata, not a rendered ICC preview.',
      },
      {
        code: 'spot-color-plates',
        message: 'Spot-color plates are unsupported by color proof readiness and must be produced externally.',
      },
      {
        code: 'icc-output-profile-conversion',
        message: 'ICC output-profile conversion is unavailable; requested proof profiles remain metadata only.',
      },
      {
        code: 'black-generation-tac-check',
        message: 'Black generation and total area coverage checks are not computed for press readiness.',
      },
    ];
  }

  if (mode === 'grayscale-soft-proof') {
    return [
      {
        code: 'grayscale-plate-export',
        message: 'Native grayscale plates are not generated; grayscale proof remains an RGB luminance preview plus metadata.',
      },
      {
        code: 'spot-color-plates',
        message: 'Spot-color plates are unsupported by color proof readiness and must be produced externally.',
      },
      {
        code: 'icc-output-profile-conversion',
        message: 'ICC grayscale output-profile conversion is unavailable; requested proof profiles remain metadata only.',
      },
    ];
  }

  return [
    {
      code: 'process-cmyk-separations',
      message: 'RGB screen proof does not generate process CMYK separations.',
    },
    {
      code: 'spot-color-plates',
      message: 'RGB screen proof does not generate spot-color plates.',
    },
    {
      code: 'icc-output-profile-conversion',
      message: 'Custom display/output ICC conversion is unavailable; RGB canvas pixels remain browser-managed.',
    },
  ];
}

function buildProofReadinessOperationCaveats(
  setup: ImageColorProofMetadata,
  profileLabel: string | null,
): Record<ImageColorProofOperation, string[]> {
  return IMAGE_COLOR_PROOF_OPERATIONS.reduce<Record<ImageColorProofOperation, string[]>>(
    (accumulator, operation) => {
      accumulator[operation] = uniqueStrings([
        ...buildProofOperationModeCaveats(setup.mode, operation),
        ...buildProofOperationProfileCaveats(profileLabel, operation),
      ]);
      return accumulator;
    },
    {} as Record<ImageColorProofOperation, string[]>,
  );
}

function buildProofOperationModeCaveats(
  mode: ImageColorProofMode,
  operation: ImageColorProofOperation,
): string[] {
  if (mode === 'rgb') {
    return [
      `${labelForProofOperation(operation)} uses browser RGB pixels; custom display ICC proof transforms are not applied.`,
    ];
  }

  if (mode === 'grayscale-soft-proof') {
    if (operation === 'export') {
      return [
        'Export writes RGB pixels plus grayscale proof metadata only; no ICC grayscale conversion, dot-gain proof check, or native grayscale file is produced.',
      ];
    }

    return [
      `${labelForProofOperation(operation)} edits RGB pixels while the grayscale proof remains a read-only luminance preview.`,
      `No ICC proof transform or dot-gain proof check is applied before ${operation}.`,
    ];
  }

  if (operation === 'export') {
    return [
      'Export writes RGB pixels plus CMYK proof metadata only; no ICC separation, black generation, TAC check, or native CMYK file is produced.',
    ];
  }

  return [
    `${labelForProofOperation(operation)} edits RGB pixels while the saved CMYK proof selection remains legacy metadata.`,
    `No ICC proof transform, gamut clipping, black generation, or TAC check is applied by this saved setup before ${operation}.`,
  ];
}

function buildProofOperationProfileCaveats(
  profileLabel: string | null,
  operation: ImageColorProofOperation,
): string[] {
  if (!profileLabel) return [];
  if (operation === 'export') {
    return [
      `Proof profile "${profileLabel}" remains metadata-only; no ICC profile is embedded or converted on export.`,
    ];
  }

  return [
    `Proof profile "${profileLabel}" remains metadata-only; preview pixels are not ICC transformed.`,
  ];
}

function buildProofReadinessUnsupportedStates(
  mode: ImageColorProofMode,
): ImageColorProofUnsupportedState[] {
  if (mode === 'rgb') {
    return [
      {
        code: 'icc-proof-transform',
        message: 'The saved proof setup does not execute ICC transforms; run the live ICC proof and gamut check for a rendered read-only LCMS preview.',
      },
    ];
  }

  if (mode === 'grayscale-soft-proof') {
    return [
      {
        code: 'icc-proof-transform',
        message: 'The saved proof setup does not execute ICC transforms; run the live ICC proof and gamut check for a rendered read-only LCMS preview.',
      },
      {
        code: 'gamut-warning-overlay',
        message: 'Out-of-gamut warning overlays are unsupported; gamutWarningAvailable stays false.',
      },
      {
        code: 'native-grayscale-proof-export',
        message: 'Native grayscale proof export is unsupported; exports remain RGB plus proof metadata.',
      },
      {
        code: 'dot-gain-proof-check',
        message: 'Dot-gain proof checks are unsupported in grayscale soft proof mode.',
      },
    ];
  }

  return [
    {
      code: 'icc-proof-transform',
      message: 'The saved CMYK proof setup does not execute ICC transforms; run the live ICC proof and gamut check for a rendered read-only LCMS preview.',
    },
    {
      code: 'gamut-warning-overlay',
      message: 'Out-of-gamut warning overlays are unsupported; gamutWarningAvailable stays false.',
    },
    {
      code: 'native-cmyk-proof-export',
      message: 'Native CMYK proof export/separations are unsupported; exports remain RGB plus proof metadata.',
    },
    {
      code: 'black-generation-tac-check',
      message: 'Black generation and total area coverage checks are unsupported in CMYK soft proof mode.',
    },
  ];
}

function labelForProofOperation(operation: ImageColorProofOperation): string {
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

function dedupeProofReadinessBlockers(
  blockers: readonly ImageColorProofReadinessBlocker[],
): ImageColorProofReadinessBlocker[] {
  const seen = new Set<ImageColorProofReadinessBlockerCode>();
  const deduped: ImageColorProofReadinessBlocker[] = [];
  for (const blocker of blockers) {
    if (seen.has(blocker.code)) continue;
    seen.add(blocker.code);
    deduped.push(blocker);
  }
  return deduped;
}

function buildProofReadinessPreviewStateSignature(input: {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  pipeline: ImageColorProofPreviewPipeline;
  profileLabel: string;
  readOnly: boolean;
}): string {
  return [
    'image-color-proof-readiness-preview:v1',
    input.mode,
    input.intent,
    input.pipeline,
    input.profileLabel,
    input.readOnly ? 'read-only' : 'editable',
  ].join(':');
}

function buildProofReadinessSignature(input: {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  profileLabel: string;
  previewReadOnly: boolean;
  gamutWarningAvailable: boolean;
  blockerCodes: ImageColorProofReadinessBlockerCode[];
}): string {
  return `image-color-proof-readiness:v1:${JSON.stringify({
    mode: input.mode,
    intent: input.intent,
    profileLabel: input.profileLabel,
    previewReadOnly: input.previewReadOnly,
    gamutWarningAvailable: input.gamutWarningAvailable,
    blockers: input.blockerCodes,
  })}`;
}

function normalizeIntentForMode(
  mode: ImageColorProofMode,
  intent: ImageColorProofIntent | undefined,
): ImageColorProofIntent {
  if (mode === 'rgb') return 'screen-rgb';
  if (mode === 'grayscale-soft-proof') return 'grayscale-luminance';
  return intent === 'perceptual' ? 'perceptual' : 'relative-colorimetric';
}

function isImageColorProofMode(value: unknown): value is ImageColorProofMode {
  return value === 'rgb' || value === 'grayscale-soft-proof' || value === 'cmyk-soft-proof';
}

function labelForMode(mode: ImageColorProofMode): string {
  return IMAGE_COLOR_PROOF_MODES.find((item) => item.value === mode)?.label ?? 'RGB';
}

function labelForIntent(intent: ImageColorProofIntent): string {
  return IMAGE_COLOR_PROOF_INTENTS.find((item) => item.value === intent)?.label ?? 'Screen RGB';
}

function isSameProofSetup(
  a: ImageColorProofMetadata,
  b: ImageColorProofMetadata,
): boolean {
  return a.mode === b.mode && a.intent === b.intent && (a.profileLabel ?? '') === (b.profileLabel ?? '');
}

function buildProofProfileDescriptor(setup: ImageColorProofMetadata): ImageColorProofProfileDescriptor {
  const requestedProfileLabel = setup.profileLabel?.trim() || null;
  if (setup.mode === 'rgb') {
    return {
      requestedProfileLabel,
      appliedPolicy: 'browser-rgb-only',
      iccTransformAvailable: false,
      limitations: [
        'Requested proof profiles are stored as handoff labels only; ICC profile transforms are not applied.',
        'RGB preview uses the browser canvas RGB renderer rather than a custom display profile.',
      ],
    };
  }

  return {
    requestedProfileLabel,
    appliedPolicy: 'label-only',
    iccTransformAvailable: false,
    limitations: [
      'Requested proof profiles are stored as handoff labels only; ICC profile transforms are not applied.',
      setup.mode === 'grayscale-soft-proof'
        ? 'Grayscale proof uses deterministic RGB luminance rather than an ICC grayscale profile.'
        : 'CMYK proof setup is legacy metadata; it does not render an ICC preview or CMYK separation.',
    ],
  };
}

function buildProofOperationDescriptor(
  mode: ImageColorProofMode,
  operation: ImageColorProofOperation,
): ImageColorProofOperationDescriptor {
  if (mode === 'rgb') {
    return {
      operation,
      supported: true,
      workingSpace: 'RGB',
      proofPolicy: 'native',
      previewImplication: 'native-rgb-preview',
      exportImplication: 'rgb-pixels-only',
      profileTransformBlockers: ['browser-rgb-proof-only'],
      warnings: [],
    };
  }

  if (operation === 'export') {
    return {
      operation,
      supported: true,
      workingSpace: 'RGB',
      proofPolicy: 'metadata-only',
      previewImplication: mode === 'grayscale-soft-proof'
        ? 'luminance-soft-proof-preview'
        : 'cmyk-proof-metadata-preview',
      exportImplication: 'rgb-pixels-plus-proof-metadata',
      profileTransformBlockers: mode === 'grayscale-soft-proof'
        ? ['icc-proof-transform-unavailable', 'grayscale-proof-conversion-external']
        : ['icc-proof-transform-unavailable', 'cmyk-proof-separation-external'],
      warnings: [
        mode === 'grayscale-soft-proof'
          ? 'Export keeps RGB pixels and stores grayscale proof metadata only.'
          : 'Export keeps RGB pixels and stores CMYK proof metadata only.',
      ],
    };
  }

  return {
    operation,
    supported: true,
    workingSpace: 'RGB',
    proofPolicy: 'preview-only',
    previewImplication: mode === 'grayscale-soft-proof'
      ? 'luminance-soft-proof-preview'
      : 'cmyk-proof-metadata-preview',
    exportImplication: 'rgb-pixels-only',
    profileTransformBlockers: mode === 'grayscale-soft-proof'
      ? ['icc-proof-transform-unavailable', 'grayscale-proof-conversion-external']
      : ['icc-proof-transform-unavailable', 'cmyk-proof-separation-external'],
    warnings: [
      mode === 'grayscale-soft-proof'
        ? 'Edits modify RGB pixels while grayscale proof remains a luminance preview.'
        : 'Edits modify RGB pixels while the saved CMYK proof setup remains legacy metadata.',
    ],
  };
}

function buildProofOperationMatrix(
  mode: ImageColorProofMode,
  intent: ImageColorProofIntent,
): Record<ImageColorProofOperation, ImageColorProofOperationCompatibilityDescriptor> {
  return IMAGE_COLOR_PROOF_OPERATIONS.reduce<Record<ImageColorProofOperation, ImageColorProofOperationCompatibilityDescriptor>>(
    (accumulator, operation) => {
      const descriptor = buildProofOperationDescriptor(mode, operation);
      accumulator[operation] = {
        ...descriptor,
        previewId: `proof-op:${mode}:${intent}:${operation}:${descriptor.proofPolicy}`,
      };
      return accumulator;
    },
    {} as Record<ImageColorProofOperation, ImageColorProofOperationCompatibilityDescriptor>,
  );
}

function buildProofProfileTransformDescriptor(
  mode: ImageColorProofMode,
  requestedProfileLabel: string | null,
): ImageColorProofProfileTransformDescriptor {
  const blockerCodes: ImageColorProofProfileTransformBlockerCode[] = mode === 'rgb'
    ? ['browser-rgb-proof-only']
    : mode === 'grayscale-soft-proof'
      ? ['icc-proof-transform-unavailable', 'grayscale-proof-conversion-external']
      : ['icc-proof-transform-unavailable', 'cmyk-proof-separation-external'];
  const workflowLimitation = mode === 'cmyk-soft-proof'
    ? 'CMYK rendering intents, gamut mapping, black generation, and TAC checks require an external proofing workflow.'
    : mode === 'grayscale-soft-proof'
      ? 'Grayscale profile conversion and dot-gain proofing require an external proofing workflow.'
      : 'Display profile conversion requires an external color-managed proofing workflow.';

  return {
    status: 'unsupported',
    requestedProfileLabel,
    iccConversionAvailable: false,
    transformIntentSupport: 'metadata-only',
    blockerCodes,
    limitations: [
      'Proof profiles are retained as labels only; ICC soft-proof transforms are not applied to preview pixels.',
      workflowLimitation,
    ],
  };
}

function buildProofPrintDescriptor(mode: ImageColorProofMode): ImageColorProofPrintDescriptor {
  if (mode === 'rgb') {
    return {
      pressReady: false,
      nativeCmykExport: false,
      warnings: [
        'RGB proof is screen-oriented; convert and proof externally for press-ready print.',
      ],
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      pressReady: false,
      nativeCmykExport: false,
      warnings: [
        'Grayscale soft proof is not a press-managed grayscale conversion; exported pixels remain RGB.',
      ],
    };
  }

  return {
    pressReady: false,
    nativeCmykExport: false,
    warnings: [
      'CMYK soft proof is not a press-ready separation; exported pixels remain RGB.',
    ],
  };
}

function buildProofPrintOutputWarnings(mode: ImageColorProofMode): string[] {
  if (mode === 'cmyk-soft-proof') {
    return [
      'Print/output warning: CMYK soft proof is not a press-ready separation; exported pixels remain RGB.',
      'Print/output warning: embed or assign press ICC profiles in an external prepress application before production handoff.',
    ];
  }

  if (mode === 'grayscale-soft-proof') {
    return [
      'Print/output warning: grayscale soft proof is not a press-managed grayscale conversion; exported pixels remain RGB.',
      'Print/output warning: convert to a target grayscale ICC profile outside Sloom Studio before production handoff.',
    ];
  }

  return [
    'Print/output warning: RGB screen proof is not a press conversion; create production separations externally.',
  ];
}

function pipelineForProofMode(mode: ImageColorProofMode): ImageColorProofPreviewPipeline {
  if (mode === 'grayscale-soft-proof') return 'rgb-luminance-soft-proof';
  if (mode === 'cmyk-soft-proof') return 'rgb-cmyk-proof-metadata';
  return 'browser-rgb-canvas';
}

function proofAccuracyForMode(mode: ImageColorProofMode): ImageColorProofAccuracy {
  if (mode === 'grayscale-soft-proof') return 'luminance-preview';
  if (mode === 'cmyk-soft-proof') return 'metadata-only';
  return 'native-rgb';
}

function buildProofGamutDescriptor(mode: ImageColorProofMode): ImageColorProofGamutWarningDescriptor {
  if (mode === 'cmyk-soft-proof') {
    return {
      warningAvailable: false,
      summary: 'Gamut warnings are not computed by the saved CMYK proof metadata; run the live ICC proof and gamut check for the rendered warning overlay.',
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      warningAvailable: false,
      summary: 'Gamut warnings are not computed for grayscale proof; preview uses luminance only.',
    };
  }

  return {
    warningAvailable: false,
    summary: 'Gamut warnings are not computed for RGB screen proof; preview uses browser canvas RGB.',
  };
}

function buildProofProfileWarnings(profileLabel: string | null): string[] {
  if (!profileLabel) return [];
  return [`Requested proof profile "${profileLabel}" is retained as metadata only; ICC proof transforms are not applied.`];
}

function buildProofConversionDescriptor(mode: ImageColorProofMode): ImageColorProofConversionDescriptor {
  if (mode === 'rgb') {
    return {
      flatteningRequiredForPress: false,
      limitations: [
        'RGB screen proof is not a press conversion; convert externally for press-managed CMYK or grayscale output.',
      ],
    };
  }

  if (mode === 'grayscale-soft-proof') {
    return {
      flatteningRequiredForPress: true,
      limitations: [
        'Press handoff requires external flattening and ICC-managed grayscale conversion; Sloom Studio exports RGB pixels plus proof metadata.',
      ],
    };
  }

  return {
    flatteningRequiredForPress: true,
    limitations: [
      'Press handoff requires external flattening and ICC-managed CMYK separation; Sloom Studio exports RGB pixels plus proof metadata.',
    ],
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
