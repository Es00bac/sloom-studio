import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import {
  IMAGE_EXPORT_FORMATS,
  getImageExportFormat,
  imageDocumentToBlob,
  type ImageExportFormat,
} from './ImageDocumentExport';
import {
  IMAGE_PSD_EXTENSION,
  IMAGE_PSD_MIME_TYPE,
  imageDocumentToPsdBlob,
} from './ImagePsdInterop';
import {
  IMAGE_XCF_EXTENSION,
  IMAGE_XCF_MIME_TYPE,
  imageDocumentToXcfBlob,
} from './ImageXcfInterop';
import {
  readStringPreference,
  writeStringPreference,
} from '../../shared/storage/preferences';
import {
  buildNativeStandaloneEntryReadiness,
  type NativeWorkspaceStandaloneEntryReadiness,
} from '../../lib/nativeApp';
import { applyImageExportProvenanceToBlob } from '../../lib/exportProvenance';

export type ImageDocumentSaveKind = 'visible' | 'layered';
export type ImageDocumentWorkflowKind = 'quick-edit' | 'source-linked' | 'export-only';
export type ImageDocumentSaveDestination = 'download' | 'source-bin';
export type ImageDocumentSaveNativeRoundtrip = 'none' | 'metadata-only' | 'unsupported';
export type ImageDocumentSaveSourceStateKind = 'standalone' | 'document-source' | 'layer-sources';
export type ImageDocumentSaveDestructivePolicy = 'copy-only' | 'copy-unless-confirmed' | 'overwrite-current-source';
export type ImageDocumentSaveEditableWorkfileState =
  | 'flattened-export-only'
  | 'signal-loom-metadata-only'
  | 'unsupported-native-roundtrip';
export type ImageDocumentSaveNativeRoundtripCaveatCode =
  | 'signal-loom-metadata-only'
  | 'native-layer-roundtrip-unsupported';
export type ImageDocumentSaveWorkflowWarningCode =
  | 'destructive-overwrite'
  | 'export-only-copy'
  | 'flattened-export'
  | 'missing-source-link'
  | 'unsupported-native-roundtrip';
export type ImageDocumentSavePolicyCheckBlockerCode =
  | 'missing-source-link'
  | 'native-roundtrip-unsupported';
export type ImageDocumentSaveDestructivePolicyCheckStatus =
  | 'not-applicable'
  | 'copy-only'
  | 'requires-confirmation'
  | 'overwrites-current-source'
  | 'blocked';
export type ImageDocumentSaveExportCopyCheckStatus = 'not-applicable' | 'not-needed' | 'copy-warning';
export type ImageDocumentSaveNativeRoundtripCheckStatus = 'supported' | 'metadata-only' | 'unsupported';
export type StandaloneQuickEditSaveOpenMode = 'source-linked' | 'export-only';
export type StandaloneQuickEditSaveOpenBlockerCode =
  | 'missing-source-link'
  | 'native-roundtrip-unsupported'
  | 'os-identity-unsigned'
  | 'os-identity-missing-app-id';
export const IMAGE_DOCUMENT_SAVE_MIME_STORAGE_KEY = 'signal-loom.image-editor.save-mime-type';

export interface ImageDocumentSaveFormat extends ImageExportFormat {
  kind: ImageDocumentSaveKind;
}

export interface ImageDocumentSaveWorkflowWarning {
  code: ImageDocumentSaveWorkflowWarningCode;
  message: string;
  sourceId?: string;
  formatExtension?: string;
}

export interface ImageDocumentSaveSourceStateDescriptor {
  kind: ImageDocumentSaveSourceStateKind;
  documentSourceId: string | null;
  sourceItemExists: boolean | null;
  layerSourceIds: string[];
  missingSourceIds: string[];
  signature: string;
}

export interface ImageDocumentSavePolicyDescriptor {
  destructiveSave: ImageDocumentSaveDestructivePolicy;
  canOverwriteSource: boolean;
  exportOnly: boolean;
  writesSourceLibrary: boolean;
  exportOnlyReason: 'standalone-source-bin-copy' | null;
  destructiveOverwriteSafeguard: 'not-needed' | 'confirmation-required-before-overwrite' | 'explicit-overwrite-requested';
  signature: string;
}

export interface ImageDocumentSaveNativeRoundtripCaveat {
  code: ImageDocumentSaveNativeRoundtripCaveatCode;
  message: string;
  formatExtension: string;
}

export interface ImageDocumentSavePreviewDescriptor {
  documentId: string;
  title: string;
  width: number;
  height: number;
  layerCount: number;
  dirty: boolean;
  formatExtension: string;
  signature: string;
}

export interface ImageDocumentSaveSourceLinkedOriginalsDescriptor {
  sourceIds: string[];
  missingSourceIds: string[];
  preservedInSavedOutput: boolean;
  requiresPackageOriginals: boolean;
  signature: string;
}

export interface ImageDocumentSaveWorkfilePackageDescriptor {
  kind: 'flattened-export-package' | 'signal-loom-workfile-package' | 'unsupported-native-workfile-package';
  destination: ImageDocumentSaveDestination;
  formatExtension: string;
  editableWorkfileState: ImageDocumentSaveEditableWorkfileState;
  preservesLayers: boolean;
  includesSourceLibraryLink: boolean;
  requiresSourceLinkedOriginalPackaging: boolean;
  warnings: ImageDocumentSaveWorkflowWarningCode[];
  signature: string;
}

export interface ImageDocumentSaveSuiteHandoffDescriptor {
  ready: boolean;
  destination: ImageDocumentSaveDestination;
  workfilePackageKind: ImageDocumentSaveWorkfilePackageDescriptor['kind'];
  preservesEditability: boolean;
  requiresSourceLinkedOriginalPackaging: boolean;
  caveats: string[];
  signature: string;
}

export interface ImageDocumentSaveDestructivePolicyCheckDescriptor {
  kind: 'quick-edit-destructive-save-policy';
  status: ImageDocumentSaveDestructivePolicyCheckStatus;
  sourceBinItemId: string | null;
  destructiveSave: ImageDocumentSaveDestructivePolicy;
  overwritesSource: boolean;
  canOverwriteSource: boolean;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
  blockerCodes: ImageDocumentSavePolicyCheckBlockerCode[];
  signature: string;
}

export interface ImageDocumentSaveExportCopyCheckDescriptor {
  kind: 'export-only-copy-warning';
  status: ImageDocumentSaveExportCopyCheckStatus;
  destination: ImageDocumentSaveDestination;
  writesSourceLibrary: boolean;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
  signature: string;
}

export interface ImageDocumentSaveNativeRoundtripCheckDescriptor {
  kind: 'native-roundtrip-unsupported-state';
  status: ImageDocumentSaveNativeRoundtripCheckStatus;
  state: ImageDocumentSaveNativeRoundtrip;
  unsupported: boolean;
  formatExtension: string;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
  caveatCodes: ImageDocumentSaveNativeRoundtripCaveatCode[];
  blockerCodes: ImageDocumentSavePolicyCheckBlockerCode[];
  signature: string;
}

export interface ImageDocumentSaveSuitePackageCheckDescriptor {
  kind: 'suite-package-descriptor';
  ready: boolean;
  packageKind: ImageDocumentSaveWorkfilePackageDescriptor['kind'];
  preservesEditability: boolean;
  requiresSourceLinkedOriginalPackaging: boolean;
  sourceIds: string[];
  missingSourceIds: string[];
  workfilePackageSignature: string;
  suiteHandoffSignature: string;
  signature: string;
}

export interface ImageDocumentSavePolicyChecksDescriptor {
  descriptorId: 'image-document-save-policy-checks:v1';
  destructiveSave: ImageDocumentSaveDestructivePolicyCheckDescriptor;
  exportOnlyCopy: ImageDocumentSaveExportCopyCheckDescriptor;
  nativeRoundtrip: ImageDocumentSaveNativeRoundtripCheckDescriptor;
  suitePackage: ImageDocumentSaveSuitePackageCheckDescriptor;
  signature: string;
}

export interface ImageDocumentSaveWorkflowDescriptor {
  workflowKind: ImageDocumentWorkflowKind;
  destination: ImageDocumentSaveDestination;
  sourceBinItemId?: string;
  overwritesSource: boolean;
  preservesLayers: boolean;
  flattenedExport: boolean;
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip;
  format: ImageDocumentSaveFormat;
  sourceState: ImageDocumentSaveSourceStateDescriptor;
  savePolicy: ImageDocumentSavePolicyDescriptor;
  nativeRoundtripCaveats: ImageDocumentSaveNativeRoundtripCaveat[];
  preview: ImageDocumentSavePreviewDescriptor;
  previewSignature: string;
  warnings: ImageDocumentSaveWorkflowWarning[];
  sourceLinkedOriginals: ImageDocumentSaveSourceLinkedOriginalsDescriptor;
  workfilePackage: ImageDocumentSaveWorkfilePackageDescriptor;
  suiteHandoff: ImageDocumentSaveSuiteHandoffDescriptor;
  policyChecks: ImageDocumentSavePolicyChecksDescriptor;
}

export interface DescribeImageDocumentSaveWorkflowOptions {
  destination?: ImageDocumentSaveDestination;
  mimeType?: string;
  overwriteSource?: boolean;
  sourceItemExists?: boolean;
}

export interface StandaloneQuickEditOsIdentityOptions {
  platform?: 'darwin' | 'linux' | 'win32' | 'unknown';
  signedPackage?: boolean;
  appId?: string | null;
}

export interface DescribeStandaloneQuickEditSaveOpenReadinessOptions extends DescribeImageDocumentSaveWorkflowOptions {
  osIdentity?: StandaloneQuickEditOsIdentityOptions;
}

export interface StandaloneQuickEditSaveOpenBlocker {
  code: StandaloneQuickEditSaveOpenBlockerCode;
  message: string;
  sourceId?: string;
}

export interface StandaloneQuickEditSaveOpenReadinessDescriptor {
  descriptorId: 'standalone-quick-edit-save-open-readiness:v1';
  ready: boolean;
  documentState: {
    documentId: string;
    title: string;
    sourceBinItemId: string | null;
    workflowKind: ImageDocumentWorkflowKind;
    mode: StandaloneQuickEditSaveOpenMode;
    layerCount: number;
    dirty: boolean;
  };
  saveOpen: {
    destination: ImageDocumentSaveDestination;
    formatExtension: string;
    destructivePolicy: ImageDocumentSaveDestructivePolicy;
    overwritesSource: boolean;
    flattenedExport: boolean;
    preservesLayers: boolean;
    nativeRoundtrip: ImageDocumentSaveNativeRoundtrip;
    editableWorkfileState: ImageDocumentSaveEditableWorkfileState;
    canReopenAsEditableDocument: boolean;
    canReopenLinkedSource: boolean;
  };
  sourceLinks: ImageDocumentSaveSourceStateDescriptor;
  nativeApp: NativeWorkspaceStandaloneEntryReadiness;
  osIdentity: {
    platform: NonNullable<StandaloneQuickEditOsIdentityOptions['platform']>;
    appId: string | null;
    signedPackage: boolean;
    caveats: string[];
  };
  nativeRoundtripUnsupported: {
    unsupported: boolean;
    state: ImageDocumentSaveNativeRoundtrip;
    caveatCodes: ImageDocumentSaveNativeRoundtripCaveatCode[];
  };
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
  blockers: StandaloneQuickEditSaveOpenBlocker[];
  workflow: ImageDocumentSaveWorkflowDescriptor;
  previewSignature: string;
  signature: string;
}

const LAYERED_IMAGE_SAVE_FORMATS: ImageDocumentSaveFormat[] = [
  {
    kind: 'layered',
    label: 'PSD',
    mimeType: IMAGE_PSD_MIME_TYPE,
    extension: IMAGE_PSD_EXTENSION,
  },
  {
    kind: 'layered',
    label: 'XCF',
    mimeType: IMAGE_XCF_MIME_TYPE,
    extension: IMAGE_XCF_EXTENSION,
  },
];

export const IMAGE_DOCUMENT_SAVE_FORMATS: ImageDocumentSaveFormat[] = [
  ...IMAGE_EXPORT_FORMATS.map((format) => ({ ...format, kind: 'visible' as const })),
  ...LAYERED_IMAGE_SAVE_FORMATS,
];

export function getVisibleImageSaveFormats(): ImageDocumentSaveFormat[] {
  return IMAGE_DOCUMENT_SAVE_FORMATS.filter((format) => format.kind === 'visible');
}

export function isVisibleImageSaveFormat(mimeType: string | undefined): boolean {
  return getVisibleImageSaveFormats().some((format) => format.mimeType === mimeType);
}

export function getImageDocumentSaveFormat(mimeType: string | undefined): ImageDocumentSaveFormat {
  return IMAGE_DOCUMENT_SAVE_FORMATS.find((format) => format.mimeType === mimeType)
    ?? { ...getImageExportFormat(mimeType), kind: 'visible' };
}

export function describeImageDocumentSaveWorkflow(
  doc: ImageDocument,
  options: DescribeImageDocumentSaveWorkflowOptions = {},
): ImageDocumentSaveWorkflowDescriptor {
  const destination = options.destination ?? 'download';
  const format = getImageDocumentSaveFormat(options.mimeType);
  const sourceLinkedLayers = doc.layers.filter(hasLayerSourceLink);
  const workflowKind = doc.sourceBinItemId
    ? 'quick-edit'
    : sourceLinkedLayers.length > 0
      ? 'source-linked'
      : 'export-only';
  const sourceState = describeImageDocumentSaveSourceState(doc, sourceLinkedLayers, options.sourceItemExists);
  const overwritesSource = Boolean(
    destination === 'source-bin'
    && options.overwriteSource
    && doc.sourceBinItemId
    && options.sourceItemExists !== false,
  );
  const flattenedExport = format.kind === 'visible' && hasLayerStateThatVisibleExportFlattens(doc);
  const nativeRoundtrip = getSaveFormatNativeRoundtrip(format);
  const savePolicy = describeImageDocumentSavePolicy({
    destination,
    workflowKind,
    overwritesSource,
    canOverwriteSource: Boolean(doc.sourceBinItemId && options.sourceItemExists !== false),
  });
  const nativeRoundtripCaveats = buildNativeRoundtripCaveats(doc, format, nativeRoundtrip);
  const warnings: ImageDocumentSaveWorkflowWarning[] = [];

  if (overwritesSource) {
    warnings.push({
      code: 'destructive-overwrite',
      sourceId: doc.sourceBinItemId,
      message: `Save Over will replace the linked Source Library asset "${doc.sourceBinItemId}" with the current document export.`,
    });
  }

  if (savePolicy.exportOnly && destination === 'source-bin') {
    warnings.push({
      code: 'export-only-copy',
      message: 'This standalone document has no linked Source Library original, so saving to the Source Bin creates a new exported copy.',
    });
  }

  const missingSourceId = getMissingSourceId(doc, sourceLinkedLayers, options.sourceItemExists);
  if (missingSourceId) {
    warnings.push({
      code: 'missing-source-link',
      sourceId: missingSourceId,
      message: `The source link "${missingSourceId}" is missing, so this workflow cannot update the original source without relinking.`,
    });
  }

  if (flattenedExport) {
    warnings.push({
      code: 'flattened-export',
      formatExtension: format.extension,
      message: `${format.label} export writes a visible flattened image and does not preserve Image layers, masks, effects, or source-link editability.`,
    });
  }

  if (hasUnsupportedNativeRoundtripRisk(doc, format, nativeRoundtrip)) {
    warnings.push({
      code: 'unsupported-native-roundtrip',
      formatExtension: format.extension,
      message: `${format.label} save is not a complete native roundtrip for editable Sloom Studio layer metadata; unsupported native constructs are preserved only as pixels and/or Sloom Studio metadata where available.`,
    });
  }

  const previewSignature = buildImageDocumentSavePreviewSignature({
    doc,
    destination,
    workflowKind,
    format,
    sourceState,
    savePolicy,
    nativeRoundtrip,
    warningCodes: warnings.map((warning) => warning.code),
  });
  const preview: ImageDocumentSavePreviewDescriptor = {
    documentId: doc.id,
    title: doc.title,
    width: doc.width,
    height: doc.height,
    layerCount: doc.layers.length,
    dirty: doc.dirty,
    formatExtension: format.extension,
    signature: previewSignature,
  };
  const editableWorkfileState = getEditableWorkfileState(format, nativeRoundtrip);
  const sourceLinkedOriginals = buildSourceLinkedOriginalsDescriptor(doc, sourceState, editableWorkfileState);
  const workfilePackage = buildWorkfilePackageDescriptor({
    destination,
    format,
    editableWorkfileState,
    preservesLayers: format.kind === 'layered',
    sourceState,
    warningCodes: warnings.map((warning) => warning.code),
  });
  const suiteHandoff = buildSuiteHandoffDescriptor({
    destination,
    editableWorkfileState,
    sourceLinkedOriginals,
    workfilePackage,
  });
  const policyChecks = buildImageDocumentSavePolicyChecks({
    workflowKind,
    destination,
    sourceBinItemId: doc.sourceBinItemId ?? null,
    overwritesSource,
    nativeRoundtrip,
    format,
    sourceState,
    savePolicy,
    nativeRoundtripCaveats,
    warningCodes: warnings.map((warning) => warning.code),
    sourceLinkedOriginals,
    workfilePackage,
    suiteHandoff,
  });

  return {
    workflowKind,
    destination,
    sourceBinItemId: doc.sourceBinItemId,
    overwritesSource,
    preservesLayers: format.kind === 'layered',
    flattenedExport,
    nativeRoundtrip,
    format,
    sourceState,
    savePolicy,
    nativeRoundtripCaveats,
    preview,
    previewSignature,
    warnings,
    sourceLinkedOriginals,
    workfilePackage,
    suiteHandoff,
    policyChecks,
  };
}

export function describeStandaloneQuickEditSaveOpenReadiness(
  doc: ImageDocument,
  options: DescribeStandaloneQuickEditSaveOpenReadinessOptions = {},
): StandaloneQuickEditSaveOpenReadinessDescriptor {
  const workflow = describeImageDocumentSaveWorkflow(doc, options);
  const nativeApp = buildNativeStandaloneEntryReadiness('image');
  const osIdentity = describeStandaloneQuickEditOsIdentity(options.osIdentity);
  const nativeRoundtripUnsupported = {
    unsupported: workflow.nativeRoundtrip === 'unsupported',
    state: workflow.nativeRoundtrip,
    caveatCodes: workflow.nativeRoundtripCaveats.map((caveat) => caveat.code),
  };
  const blockers = buildStandaloneQuickEditSaveOpenBlockers({
    workflow,
    osIdentity,
    nativeRoundtripUnsupported,
  });
  const descriptorBase = {
    descriptorId: 'standalone-quick-edit-save-open-readiness:v1' as const,
    ready: blockers.length === 0,
    documentState: {
      documentId: doc.id,
      title: doc.title,
      sourceBinItemId: doc.sourceBinItemId ?? null,
      workflowKind: workflow.workflowKind,
      mode: workflow.workflowKind === 'export-only' ? 'export-only' as const : 'source-linked' as const,
      layerCount: doc.layers.length,
      dirty: doc.dirty,
    },
    saveOpen: {
      destination: workflow.destination,
      formatExtension: workflow.format.extension,
      destructivePolicy: workflow.savePolicy.destructiveSave,
      overwritesSource: workflow.overwritesSource,
      flattenedExport: workflow.flattenedExport,
      preservesLayers: workflow.preservesLayers,
      nativeRoundtrip: workflow.nativeRoundtrip,
      editableWorkfileState: workflow.workfilePackage.editableWorkfileState,
      canReopenAsEditableDocument: workflow.preservesLayers && workflow.nativeRoundtrip === 'metadata-only',
      canReopenLinkedSource: Boolean(workflow.sourceState.documentSourceId && workflow.sourceState.sourceItemExists !== false),
    },
    sourceLinks: workflow.sourceState,
    nativeApp,
    osIdentity,
    nativeRoundtripUnsupported,
    warningCodes: workflow.warnings.map((warning) => warning.code),
    blockers,
    workflow,
    previewSignature: workflow.previewSignature,
  };

  return {
    ...descriptorBase,
    signature: buildStandaloneQuickEditSaveOpenSignature(descriptorBase),
  };
}

export function readStoredImageDocumentSaveMimeType(): string {
  return readStringPreference({
    key: IMAGE_DOCUMENT_SAVE_MIME_STORAGE_KEY,
    fallback: 'image/png',
    normalize: (value) => getImageDocumentSaveFormat(value).mimeType,
  });
}

export function writeStoredImageDocumentSaveMimeType(mimeType: string): void {
  writeStringPreference({
    key: IMAGE_DOCUMENT_SAVE_MIME_STORAGE_KEY,
    value: mimeType,
    fallback: 'image/png',
    normalize: (value) => getImageDocumentSaveFormat(value).mimeType,
  });
}

export async function imageDocumentToSaveBlob(
  doc: ImageDocument,
  mimeType: string | undefined,
): Promise<{ blob: Blob; format: ImageDocumentSaveFormat }> {
  const format = getImageDocumentSaveFormat(mimeType);

  if (format.mimeType === IMAGE_PSD_MIME_TYPE) {
    return { blob: await imageDocumentToPsdBlob(doc), format };
  }
  if (format.mimeType === IMAGE_XCF_MIME_TYPE) {
    return { blob: await imageDocumentToXcfBlob(doc), format };
  }

  // Invisible provenance metadata (licensing spec Part 2 §6): PNG tEXt / JPEG XMP records the
  // edition; never drawn on pixels. Other formats pass through unchanged.
  return {
    blob: await applyImageExportProvenanceToBlob(await imageDocumentToBlob(doc, format.mimeType)),
    format,
  };
}

function hasLayerSourceLink(layer: ImageLayer): boolean {
  return Boolean(layer.metadata?.smartLinkedSourceId || layer.metadata?.sourceLink);
}

function describeImageDocumentSaveSourceState(
  doc: ImageDocument,
  sourceLinkedLayers: ImageLayer[],
  sourceItemExists: boolean | undefined,
): ImageDocumentSaveSourceStateDescriptor {
  const documentSourceId = doc.sourceBinItemId ?? null;
  const layerSourceIds = dedupeAndSortStrings(sourceLinkedLayers.flatMap((layer) => {
    const sourceId = getLayerSourceId(layer);
    return sourceId ? [sourceId] : [];
  }));
  const missingSourceIds = dedupeAndSortStrings([
    ...(documentSourceId && sourceItemExists === false ? [documentSourceId] : []),
    ...sourceLinkedLayers.flatMap((layer) => (
      layer.metadata?.sourceLink?.status === 'missing'
        ? [getLayerSourceId(layer)].filter((sourceId): sourceId is string => Boolean(sourceId))
        : []
    )),
  ]);

  const kind: ImageDocumentSaveSourceStateKind = documentSourceId
    ? 'document-source'
    : layerSourceIds.length > 0
      ? 'layer-sources'
      : 'standalone';
  const sourceExists = documentSourceId ? sourceItemExists ?? null : null;

  return {
    kind,
    documentSourceId,
    sourceItemExists: sourceExists,
    layerSourceIds,
    missingSourceIds,
    signature: [
      'image-document-save-source-state:v1',
      `kind=${kind}`,
      `document=${documentSourceId ?? 'none'}`,
      `exists=${sourceExists ?? 'unknown'}`,
      `layers=${layerSourceIds.join(',') || 'none'}`,
      `missing=${missingSourceIds.join(',') || 'none'}`,
    ].join('|'),
  };
}

function describeImageDocumentSavePolicy({
  destination,
  workflowKind,
  overwritesSource,
  canOverwriteSource,
}: {
  destination: ImageDocumentSaveDestination;
  workflowKind: ImageDocumentWorkflowKind;
  overwritesSource: boolean;
  canOverwriteSource: boolean;
}): ImageDocumentSavePolicyDescriptor {
  const writesSourceLibrary = destination === 'source-bin';
  const destructiveSave = overwritesSource
    ? 'overwrite-current-source'
    : canOverwriteSource && writesSourceLibrary
      ? 'copy-unless-confirmed'
      : 'copy-only';
  const exportOnly = workflowKind === 'export-only';
  const exportOnlyReason = exportOnly && writesSourceLibrary ? 'standalone-source-bin-copy' : null;
  const destructiveOverwriteSafeguard = overwritesSource
    ? 'explicit-overwrite-requested'
    : canOverwriteSource && writesSourceLibrary
      ? 'confirmation-required-before-overwrite'
      : 'not-needed';

  return {
    destructiveSave,
    canOverwriteSource: canOverwriteSource && writesSourceLibrary,
    exportOnly,
    writesSourceLibrary,
    exportOnlyReason,
    destructiveOverwriteSafeguard,
    signature: [
      'image-document-save-export-policy:v1',
      `workflow=${workflowKind}`,
      `destination=${destination}`,
      `destructive=${destructiveSave}`,
      `canOverwrite=${canOverwriteSource && writesSourceLibrary}`,
      `exportOnly=${exportOnly}`,
      `writesSourceLibrary=${writesSourceLibrary}`,
      `safeguard=${destructiveOverwriteSafeguard}`,
      `exportReason=${exportOnlyReason ?? 'none'}`,
    ].join('|'),
  };
}

function getLayerSourceId(layer: ImageLayer): string | undefined {
  return layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId;
}

function getMissingSourceId(
  doc: ImageDocument,
  sourceLinkedLayers: ImageLayer[],
  sourceItemExists: boolean | undefined,
): string | undefined {
  if (doc.sourceBinItemId && sourceItemExists === false) return doc.sourceBinItemId;
  const missingLayer = sourceLinkedLayers.find((layer) => layer.metadata?.sourceLink?.status === 'missing');
  return missingLayer?.metadata?.sourceLink?.id ?? missingLayer?.metadata?.smartLinkedSourceId;
}

function hasLayerStateThatVisibleExportFlattens(doc: ImageDocument): boolean {
  return doc.layers.length > 1 || doc.layers.some((layer) => (
    layer.type !== 'image'
    || Boolean(layer.mask)
    || Boolean(layer.text)
    || Boolean(layer.adjustment)
    || (layer.effects?.length ?? 0) > 0
    || (layer.filters?.length ?? 0) > 0
    || layer.opacity !== 1
    || layer.blendMode !== 'normal'
    || layer.x !== 0
    || layer.y !== 0
    || Boolean(layer.rotationDeg)
    || Boolean(layer.skewXDeg)
    || Boolean(layer.skewYDeg)
    || Boolean(layer.perspectiveX)
    || Boolean(layer.perspectiveY)
    || Boolean(layer.warp)
    || Boolean(layer.cornerOffsets)
    || Boolean(layer.metadata?.sourceLink)
    || Boolean(layer.metadata?.smartLinkedSourceId)
    || Boolean(layer.vectorRecipe)
  ));
}

function getSaveFormatNativeRoundtrip(format: ImageDocumentSaveFormat): ImageDocumentSaveNativeRoundtrip {
  if (format.kind === 'visible') return 'none';
  if (format.mimeType === IMAGE_PSD_MIME_TYPE) return 'metadata-only';
  return 'unsupported';
}

function hasUnsupportedNativeRoundtripRisk(
  doc: ImageDocument,
  format: ImageDocumentSaveFormat,
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip,
): boolean {
  if (format.kind !== 'layered') return false;
  if (nativeRoundtrip === 'unsupported') return true;
  return doc.layers.some((layer) => (
    hasLayerSourceLink(layer)
    || layer.type === 'text'
    || Boolean(layer.text)
    || layer.type === 'adjustment'
    || Boolean(layer.adjustment)
    || (layer.effects?.length ?? 0) > 0
    || (layer.filters?.length ?? 0) > 0
  ));
}

function buildNativeRoundtripCaveats(
  doc: ImageDocument,
  format: ImageDocumentSaveFormat,
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip,
): ImageDocumentSaveNativeRoundtripCaveat[] {
  if (format.kind !== 'layered') return [];
  if (nativeRoundtrip === 'unsupported') {
    return [{
      code: 'native-layer-roundtrip-unsupported',
      formatExtension: format.extension,
      message: `${format.label} save does not provide complete native editable layer roundtrip support.`,
    }];
  }
  if (!hasUnsupportedNativeRoundtripRisk(doc, format, nativeRoundtrip)) return [];
  return [{
    code: 'signal-loom-metadata-only',
    formatExtension: format.extension,
    message: `${format.label} save keeps Sloom Studio editability as metadata where possible, but native editors may only preserve unsupported constructs as pixels.`,
  }];
}

function getEditableWorkfileState(
  format: ImageDocumentSaveFormat,
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip,
): ImageDocumentSaveEditableWorkfileState {
  if (format.kind === 'visible') return 'flattened-export-only';
  if (nativeRoundtrip === 'unsupported') return 'unsupported-native-roundtrip';
  return 'signal-loom-metadata-only';
}

function buildSourceLinkedOriginalsDescriptor(
  doc: ImageDocument,
  sourceState: ImageDocumentSaveSourceStateDescriptor,
  editableWorkfileState: ImageDocumentSaveEditableWorkfileState,
): ImageDocumentSaveSourceLinkedOriginalsDescriptor {
  const sourceIds = dedupeAndSortStrings([
    ...(doc.sourceBinItemId ? [doc.sourceBinItemId] : []),
    ...sourceState.layerSourceIds,
  ]);
  const preservedInSavedOutput = sourceIds.length === 0 && editableWorkfileState !== 'flattened-export-only';
  const requiresPackageOriginals = sourceIds.length > 0;

  return {
    sourceIds,
    missingSourceIds: sourceState.missingSourceIds,
    preservedInSavedOutput,
    requiresPackageOriginals,
    signature: [
      'image-document-save-source-links:v1',
      `ids=${sourceIds.join(',') || 'none'}`,
      `missing=${sourceState.missingSourceIds.join(',') || 'none'}`,
      `preserved=${preservedInSavedOutput}`,
      `packageOriginals=${requiresPackageOriginals}`,
    ].join('|'),
  };
}

function buildWorkfilePackageDescriptor({
  destination,
  format,
  editableWorkfileState,
  preservesLayers,
  sourceState,
  warningCodes,
}: {
  destination: ImageDocumentSaveDestination;
  format: ImageDocumentSaveFormat;
  editableWorkfileState: ImageDocumentSaveEditableWorkfileState;
  preservesLayers: boolean;
  sourceState: ImageDocumentSaveSourceStateDescriptor;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
}): ImageDocumentSaveWorkfilePackageDescriptor {
  const kind = editableWorkfileState === 'flattened-export-only'
    ? 'flattened-export-package'
    : editableWorkfileState === 'unsupported-native-roundtrip'
      ? 'unsupported-native-workfile-package'
      : 'signal-loom-workfile-package';
  const includesSourceLibraryLink = Boolean(sourceState.documentSourceId && sourceState.sourceItemExists !== false);
  const requiresSourceLinkedOriginalPackaging = Boolean(
    sourceState.documentSourceId
    || sourceState.layerSourceIds.length > 0,
  );

  return {
    kind,
    destination,
    formatExtension: format.extension,
    editableWorkfileState,
    preservesLayers,
    includesSourceLibraryLink,
    requiresSourceLinkedOriginalPackaging,
    warnings: warningCodes,
    signature: [
      'image-document-save-workfile-package:v1',
      `kind=${kind}`,
      `destination=${destination}`,
      `format=${format.extension}`,
      `editable=${editableWorkfileState}`,
      `preservesLayers=${preservesLayers}`,
      `includesSourceLibraryLink=${includesSourceLibraryLink}`,
      `requiresOriginals=${requiresSourceLinkedOriginalPackaging}`,
      `warnings=${warningCodes.join(',') || 'none'}`,
    ].join('|'),
  };
}

function buildSuiteHandoffDescriptor({
  destination,
  editableWorkfileState,
  sourceLinkedOriginals,
  workfilePackage,
}: {
  destination: ImageDocumentSaveDestination;
  editableWorkfileState: ImageDocumentSaveEditableWorkfileState;
  sourceLinkedOriginals: ImageDocumentSaveSourceLinkedOriginalsDescriptor;
  workfilePackage: ImageDocumentSaveWorkfilePackageDescriptor;
}): ImageDocumentSaveSuiteHandoffDescriptor {
  const ready = sourceLinkedOriginals.missingSourceIds.length === 0;
  const preservesEditability = editableWorkfileState === 'signal-loom-metadata-only';
  const caveatCode = editableWorkfileState === 'flattened-export-only'
    ? 'flattened-export-needs-workfile-package'
    : editableWorkfileState === 'unsupported-native-roundtrip'
      ? 'unsupported-native-workfile-package'
      : 'metadata-only-workfile-package';
  const caveats = editableWorkfileState === 'flattened-export-only'
    ? ['Flattened exports package the visible composite only; keep the Image workfile and linked originals beside the Source Library derivative for suite handoff.']
    : editableWorkfileState === 'unsupported-native-roundtrip'
      ? ['This layered save can be handed off as a Sloom Studio workfile package, but native editable roundtrip is unsupported and linked originals should travel beside it.']
      : ['This layered save remains a Sloom Studio workfile package; linked originals should travel beside it when external suite provenance matters.'];

  return {
    ready,
    destination,
    workfilePackageKind: workfilePackage.kind,
    preservesEditability,
    requiresSourceLinkedOriginalPackaging: sourceLinkedOriginals.requiresPackageOriginals,
    caveats,
    signature: [
      'image-document-save-suite-handoff:v1',
      `ready=${ready}`,
      `destination=${destination}`,
      `package=${workfilePackage.kind}`,
      `preservesEditability=${preservesEditability}`,
      `requiresOriginals=${sourceLinkedOriginals.requiresPackageOriginals}`,
      `caveats=${caveatCode}`,
    ].join('|'),
  };
}

function buildImageDocumentSavePolicyChecks({
  workflowKind,
  destination,
  sourceBinItemId,
  overwritesSource,
  nativeRoundtrip,
  format,
  sourceState,
  savePolicy,
  nativeRoundtripCaveats,
  warningCodes,
  sourceLinkedOriginals,
  workfilePackage,
  suiteHandoff,
}: {
  workflowKind: ImageDocumentWorkflowKind;
  destination: ImageDocumentSaveDestination;
  sourceBinItemId: string | null;
  overwritesSource: boolean;
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip;
  format: ImageDocumentSaveFormat;
  sourceState: ImageDocumentSaveSourceStateDescriptor;
  savePolicy: ImageDocumentSavePolicyDescriptor;
  nativeRoundtripCaveats: ImageDocumentSaveNativeRoundtripCaveat[];
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
  sourceLinkedOriginals: ImageDocumentSaveSourceLinkedOriginalsDescriptor;
  workfilePackage: ImageDocumentSaveWorkfilePackageDescriptor;
  suiteHandoff: ImageDocumentSaveSuiteHandoffDescriptor;
}): ImageDocumentSavePolicyChecksDescriptor {
  const destructiveSave = buildDestructivePolicyCheck({
    workflowKind,
    sourceBinItemId,
    overwritesSource,
    sourceState,
    savePolicy,
    warningCodes,
  });
  const exportOnlyCopy = buildExportOnlyCopyCheck({
    workflowKind,
    destination,
    savePolicy,
    warningCodes,
  });
  const nativeRoundtripCheck = buildNativeRoundtripCheck({
    nativeRoundtrip,
    format,
    nativeRoundtripCaveats,
    warningCodes,
  });
  const suitePackage = buildSuitePackageCheck({
    sourceLinkedOriginals,
    workfilePackage,
    suiteHandoff,
  });

  return {
    descriptorId: 'image-document-save-policy-checks:v1',
    destructiveSave,
    exportOnlyCopy,
    nativeRoundtrip: nativeRoundtripCheck,
    suitePackage,
    signature: [
      'image-document-save-policy-checks:v1',
      `destructive=${destructiveSave.signature}`,
      `exportCopy=${exportOnlyCopy.signature}`,
      `nativeRoundtrip=${nativeRoundtripCheck.signature}`,
      `suite=${suitePackage.signature}`,
    ].join('|'),
  };
}

function buildDestructivePolicyCheck({
  workflowKind,
  sourceBinItemId,
  overwritesSource,
  sourceState,
  savePolicy,
  warningCodes,
}: {
  workflowKind: ImageDocumentWorkflowKind;
  sourceBinItemId: string | null;
  overwritesSource: boolean;
  sourceState: ImageDocumentSaveSourceStateDescriptor;
  savePolicy: ImageDocumentSavePolicyDescriptor;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
}): ImageDocumentSaveDestructivePolicyCheckDescriptor {
  const blockerCodes: ImageDocumentSavePolicyCheckBlockerCode[] =
    workflowKind === 'quick-edit' && sourceState.missingSourceIds.length > 0 ? ['missing-source-link'] : [];
  const destructiveWarningCodes = warningCodes.filter((code) => code === 'destructive-overwrite');
  const status: ImageDocumentSaveDestructivePolicyCheckStatus = workflowKind !== 'quick-edit'
    ? 'not-applicable'
    : blockerCodes.length > 0
      ? 'blocked'
      : overwritesSource
        ? 'overwrites-current-source'
        : savePolicy.destructiveSave === 'copy-unless-confirmed'
          ? 'requires-confirmation'
          : 'copy-only';

  return {
    kind: 'quick-edit-destructive-save-policy',
    status,
    sourceBinItemId,
    destructiveSave: savePolicy.destructiveSave,
    overwritesSource,
    canOverwriteSource: savePolicy.canOverwriteSource,
    warningCodes: destructiveWarningCodes,
    blockerCodes,
    signature: [
      'image-document-save-destructive-policy:v1',
      `workflow=${workflowKind}`,
      `source=${sourceBinItemId ?? 'none'}`,
      `policy=${savePolicy.destructiveSave}`,
      `overwrites=${overwritesSource}`,
      `canOverwrite=${savePolicy.canOverwriteSource}`,
      `warnings=${destructiveWarningCodes.join(',') || 'none'}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
    ].join('|'),
  };
}

function buildExportOnlyCopyCheck({
  workflowKind,
  destination,
  savePolicy,
  warningCodes,
}: {
  workflowKind: ImageDocumentWorkflowKind;
  destination: ImageDocumentSaveDestination;
  savePolicy: ImageDocumentSavePolicyDescriptor;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
}): ImageDocumentSaveExportCopyCheckDescriptor {
  const exportOnlyWarningCodes = warningCodes.filter((code) => code === 'export-only-copy');
  const status: ImageDocumentSaveExportCopyCheckStatus = workflowKind !== 'export-only'
    ? 'not-applicable'
    : exportOnlyWarningCodes.length > 0
      ? 'copy-warning'
      : 'not-needed';

  return {
    kind: 'export-only-copy-warning',
    status,
    destination,
    writesSourceLibrary: savePolicy.writesSourceLibrary,
    warningCodes: exportOnlyWarningCodes,
    signature: [
      'image-document-save-export-copy:v1',
      `workflow=${workflowKind}`,
      `destination=${destination}`,
      `writesSourceLibrary=${savePolicy.writesSourceLibrary}`,
      `warnings=${exportOnlyWarningCodes.join(',') || 'none'}`,
    ].join('|'),
  };
}

function buildNativeRoundtripCheck({
  nativeRoundtrip,
  format,
  nativeRoundtripCaveats,
  warningCodes,
}: {
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip;
  format: ImageDocumentSaveFormat;
  nativeRoundtripCaveats: ImageDocumentSaveNativeRoundtripCaveat[];
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
}): ImageDocumentSaveNativeRoundtripCheckDescriptor {
  const roundtripWarningCodes = warningCodes.filter((code) => code === 'unsupported-native-roundtrip');
  const caveatCodes = nativeRoundtripCaveats.map((caveat) => caveat.code);
  const blockerCodes: ImageDocumentSavePolicyCheckBlockerCode[] =
    nativeRoundtrip === 'unsupported' ? ['native-roundtrip-unsupported'] : [];
  const status: ImageDocumentSaveNativeRoundtripCheckStatus = nativeRoundtrip === 'unsupported'
    ? 'unsupported'
    : nativeRoundtrip === 'metadata-only'
      ? 'metadata-only'
      : 'supported';

  return {
    kind: 'native-roundtrip-unsupported-state',
    status,
    state: nativeRoundtrip,
    unsupported: nativeRoundtrip === 'unsupported',
    formatExtension: format.extension,
    warningCodes: roundtripWarningCodes,
    caveatCodes,
    blockerCodes,
    signature: [
      'image-document-save-native-roundtrip-check:v1',
      `state=${nativeRoundtrip}`,
      `format=${format.extension}`,
      `unsupported=${nativeRoundtrip === 'unsupported'}`,
      `warnings=${roundtripWarningCodes.join(',') || 'none'}`,
      `caveats=${caveatCodes.join(',') || 'none'}`,
      `blockers=${blockerCodes.join(',') || 'none'}`,
    ].join('|'),
  };
}

function buildSuitePackageCheck({
  sourceLinkedOriginals,
  workfilePackage,
  suiteHandoff,
}: {
  sourceLinkedOriginals: ImageDocumentSaveSourceLinkedOriginalsDescriptor;
  workfilePackage: ImageDocumentSaveWorkfilePackageDescriptor;
  suiteHandoff: ImageDocumentSaveSuiteHandoffDescriptor;
}): ImageDocumentSaveSuitePackageCheckDescriptor {
  return {
    kind: 'suite-package-descriptor',
    ready: suiteHandoff.ready,
    packageKind: workfilePackage.kind,
    preservesEditability: suiteHandoff.preservesEditability,
    requiresSourceLinkedOriginalPackaging: suiteHandoff.requiresSourceLinkedOriginalPackaging,
    sourceIds: sourceLinkedOriginals.sourceIds,
    missingSourceIds: sourceLinkedOriginals.missingSourceIds,
    workfilePackageSignature: workfilePackage.signature,
    suiteHandoffSignature: suiteHandoff.signature,
    signature: [
      'image-document-save-suite-package-check:v1',
      `ready=${suiteHandoff.ready}`,
      `package=${workfilePackage.kind}`,
      `preservesEditability=${suiteHandoff.preservesEditability}`,
      `requiresOriginals=${suiteHandoff.requiresSourceLinkedOriginalPackaging}`,
      `sources=${sourceLinkedOriginals.sourceIds.join(',') || 'none'}`,
      `missing=${sourceLinkedOriginals.missingSourceIds.join(',') || 'none'}`,
    ].join('|'),
  };
}

function buildImageDocumentSavePreviewSignature({
  doc,
  destination,
  workflowKind,
  format,
  sourceState,
  savePolicy,
  nativeRoundtrip,
  warningCodes,
}: {
  doc: ImageDocument;
  destination: ImageDocumentSaveDestination;
  workflowKind: ImageDocumentWorkflowKind;
  format: ImageDocumentSaveFormat;
  sourceState: ImageDocumentSaveSourceStateDescriptor;
  savePolicy: ImageDocumentSavePolicyDescriptor;
  nativeRoundtrip: ImageDocumentSaveNativeRoundtrip;
  warningCodes: ImageDocumentSaveWorkflowWarningCode[];
}): string {
  return `image-document-save:v1:${JSON.stringify({
    documentId: doc.id,
    title: doc.title,
    size: `${doc.width}x${doc.height}`,
    layerCount: doc.layers.length,
    dirty: doc.dirty,
    destination,
    workflowKind,
    formatExtension: format.extension,
    formatKind: format.kind,
    nativeRoundtrip,
    sourceState,
    destructiveSave: savePolicy.destructiveSave,
    canOverwriteSource: savePolicy.canOverwriteSource,
    exportOnly: savePolicy.exportOnly,
    writesSourceLibrary: savePolicy.writesSourceLibrary,
    warningCodes,
  })}`;
}

function describeStandaloneQuickEditOsIdentity(
  osIdentity: StandaloneQuickEditOsIdentityOptions | undefined,
): StandaloneQuickEditSaveOpenReadinessDescriptor['osIdentity'] {
  const platform = osIdentity?.platform ?? 'unknown';
  const signedPackage = osIdentity?.signedPackage ?? false;
  const appId = osIdentity?.appId ?? null;
  const caveats: string[] = [];

  if (!signedPackage) {
    caveats.push('Unsigned desktop builds may not preserve OS-level file association, open-with, or save permission identity across machines.');
  }
  if (!appId) {
    caveats.push('Missing application identity prevents deterministic OS save/open association checks for packaged builds.');
  }

  return {
    platform,
    appId,
    signedPackage,
    caveats,
  };
}

function buildStandaloneQuickEditSaveOpenBlockers({
  workflow,
  osIdentity,
  nativeRoundtripUnsupported,
}: {
  workflow: ImageDocumentSaveWorkflowDescriptor;
  osIdentity: StandaloneQuickEditSaveOpenReadinessDescriptor['osIdentity'];
  nativeRoundtripUnsupported: StandaloneQuickEditSaveOpenReadinessDescriptor['nativeRoundtripUnsupported'];
}): StandaloneQuickEditSaveOpenBlocker[] {
  const blockers: StandaloneQuickEditSaveOpenBlocker[] = [];

  if (workflow.sourceState.missingSourceIds.length > 0) {
    blockers.push({
      code: 'missing-source-link',
      sourceId: workflow.sourceState.missingSourceIds[0],
      message: 'One or more Source Library links are missing, so save/open cannot deterministically update or reopen the original asset.',
    });
  }
  if (nativeRoundtripUnsupported.unsupported) {
    blockers.push({
      code: 'native-roundtrip-unsupported',
      message: `${workflow.format.label} cannot be reopened as a complete editable native roundtrip document.`,
    });
  }
  if (!osIdentity.signedPackage && (osIdentity.platform === 'darwin' || osIdentity.platform === 'win32')) {
    blockers.push({
      code: 'os-identity-unsigned',
      message: 'The desktop package is unsigned, so OS open-with identity and permission behavior are not production-ready.',
    });
  }
  if (!osIdentity.appId) {
    blockers.push({
      code: 'os-identity-missing-app-id',
      message: 'No packaged application identifier is available for deterministic OS save/open association checks.',
    });
  }

  return blockers;
}

function buildStandaloneQuickEditSaveOpenSignature(
  descriptor: Omit<StandaloneQuickEditSaveOpenReadinessDescriptor, 'signature'>,
): string {
  return `standalone-quick-edit-save-open-readiness:v1:${JSON.stringify({
    descriptorId: descriptor.descriptorId,
    ready: descriptor.ready,
    documentState: descriptor.documentState,
    saveOpen: descriptor.saveOpen,
    sourceLinks: descriptor.sourceLinks,
    nativeAppSignature: descriptor.nativeApp.signature,
    osIdentity: descriptor.osIdentity,
    nativeRoundtripUnsupported: descriptor.nativeRoundtripUnsupported,
    warningCodes: descriptor.warningCodes,
    blockerCodes: descriptor.blockers.map((blocker) => blocker.code),
    workfilePackageKind: descriptor.workflow.workfilePackage.kind,
    suiteHandoffSignature: descriptor.workflow.suiteHandoff.signature,
    policyChecksSignature: descriptor.workflow.policyChecks.signature,
    previewSignature: descriptor.previewSignature,
  })}`;
}

function dedupeAndSortStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
