import { useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument, ImageQuickActionMacro } from '../../types/imageEditor';
import {
  getPhotoshopQuickActionCapabilityDescriptor,
  PHOTOSHOP_QUICK_ACTIONS,
} from './PhotoshopQuickActions';
import { runPhotoshopQuickAction } from './PhotoshopQuickActionRunner';
import type {
  PhotoshopQuickActionCapabilityDescriptor,
  PhotoshopQuickActionCapabilityInput,
  PhotoshopQuickActionCapabilityOutput,
} from './photoshopQuickActions/types';

export const IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION = 1;

export interface ImageQuickActionMacroStepDescriptor {
  id: string;
  actionId: string;
  params?: unknown;
}

export interface ImageQuickActionMacroDescriptor {
  id: string;
  name: string;
  steps: ImageQuickActionMacroStepDescriptor[];
  tags: string[];
}

export interface ImageQuickActionMacroSetManifest {
  schemaVersion: typeof IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION;
  macros: ImageQuickActionMacroDescriptor[];
}

export type ImageQuickActionMacroValidationIssue =
  | {
      code: 'duplicate-step-id';
      macroId: string;
      stepId: string;
      message: string;
    }
  | {
      code: 'missing-action-id';
      macroId: string;
      stepId: string;
      actionId: string;
      message: string;
    }
  | {
      code: 'unsupported-params';
      macroId: string;
      stepId: string;
      actionId: string;
      message: string;
    };

export interface ImageQuickActionMacroSetValidationResult {
  valid: boolean;
  macros: ImageQuickActionMacroDescriptor[];
  issues: ImageQuickActionMacroValidationIssue[];
  missingActionIds: string[];
  duplicateStepIds: string[];
  unsupportedParameterSteps: string[];
}

export type ImageQuickActionPlaybackWarning =
  | {
      code: 'unavailable-command';
      severity: 'warning';
      actionId: string;
      message: string;
    }
  | {
      code: 'no-active-layer';
      severity: 'warning';
      message: string;
    };

export interface ImageQuickActionFileFolderBatchWarning {
  code: 'file-folder-batch-unsupported';
  severity: 'warning';
  message: string;
}

export interface ImageQuickActionMacroPlaybackDocumentDiagnostics {
  id: string;
  title: string;
  width: number;
  height: number;
  layerCount: number;
  active: boolean;
  canAttemptPlayback: boolean;
  warnings: ImageQuickActionPlaybackWarning[];
}

export interface ImageQuickActionMacroPlaybackDiagnostics {
  descriptorId: 'image-quick-action-playback-diagnostics:v1';
  macro: {
    id: string;
    name: string;
    stepCount: number;
    identity: string;
  };
  macroRunIdentity: ImageQuickActionMacroRunIdentity;
  importValidation: ImageQuickActionMacroImportValidationDescriptor;
  stepExecutionLog: ImageQuickActionMacroStepExecutionLog;
  commandAvailability: {
    supportedActionIds: string[];
    unavailableActionIds: string[];
    warnings: ImageQuickActionPlaybackWarning[];
  };
  commandRecordingCaveats: {
    arbitraryCommandsSupported: false;
    parameterizedStepsSupported: false;
    fixedQuickActionIdsOnly: true;
    message: string;
  };
  documents: ImageQuickActionMacroPlaybackDocumentDiagnostics[];
  preview: {
    id: string;
    documentCount: number;
    attemptedDocumentCount: number;
    unavailableCommandCount: number;
    signature: string;
  };
  batchOpenDocuments: {
    supported: true;
    scope: 'currently-open-image-documents';
    documentCount: number;
    attemptedDocumentCount: number;
    blockedDocumentCount: number;
    previewSignature: string;
    deterministicRouteSignature: string;
  };
  fileFolderBatch: {
    supported: false;
    unsupportedInputKinds: readonly ['file-list', 'folder'];
    caveats: string[];
    warnings: ImageQuickActionFileFolderBatchWarning[];
    readinessSignature: string;
  };
  automationBoundary: {
    separateFromMainFlow: true;
    requiredWorkspace: 'image-automation';
    mainFlowCallable: false;
    reason: string;
  };
  nativeExecution: {
    supported: false;
    reason: string;
    requiredWorkspace: 'image-automation';
  };
  importExportUi: {
    manifestSchemaVersion: typeof IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION;
    canSerializeManifest: boolean;
    canParseManifest: boolean;
    hasDedicatedImportUi: false;
    hasDedicatedExportUi: false;
    gaps: string[];
  };
  workspaceHandoff: {
    workspaceId: 'image-automation';
    ready: boolean;
    handoffKind: 'macro-playback-preview';
    requiredPayloads: string[];
    blockers: string[];
  };
}

export interface ImageQuickActionMacroRunIdentity {
  macroId: string;
  actionSetId: string;
  runId: string;
  signature: string;
}

export interface ImageQuickActionMacroImportValidationDescriptor {
  schemaVersion: typeof IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION;
  state: 'valid' | 'valid-with-warnings' | 'invalid';
  valid: boolean;
  issueCodes: ImageQuickActionMacroValidationIssue['code'][];
  missingActionIds: string[];
  duplicateStepIds: string[];
  unsupportedParameterSteps: string[];
  warnings: ImageQuickActionPlaybackWarning[];
  signature: string;
}

export interface ImageQuickActionMacroStepExecutionLogEntry {
  id: string;
  documentId: string;
  stepId: string;
  actionId: string;
  status: 'dry-run' | 'unavailable' | 'blocked-document';
  executed: false;
  warnings: ImageQuickActionPlaybackWarning[];
  signature: string;
}

export interface ImageQuickActionMacroStepExecutionLog {
  runId: string;
  mode: 'dry-run';
  status: 'planned' | 'blocked';
  entries: ImageQuickActionMacroStepExecutionLogEntry[];
  unsupportedExecution: {
    nativeFilesystemExecution: false;
    unattendedBackgroundExecution: false;
    arbitraryPluginCommands: false;
    fullPhotoshopActions: false;
  };
  signature: string;
}

export type ImageQuickActionReadinessBlockerCode =
  | 'unsupported-action'
  | 'unsupported-params'
  | 'no-active-layer'
  | 'active-layer-locked'
  | 'active-layer-position-locked'
  | 'active-layer-pixels-locked'
  | 'missing-selection';

export interface ImageQuickActionReadinessBlocker {
  code: ImageQuickActionReadinessBlockerCode;
  severity: 'error' | 'warning';
  actionId?: string;
  stepId?: string;
  documentId?: string;
  message: string;
}

export interface ImageQuickActionActionReadinessDescriptor {
  actionId: string;
  label: string;
  supported: boolean;
  input: readonly PhotoshopQuickActionCapabilityInput[];
  output: PhotoshopQuickActionCapabilityOutput | 'unknown';
  mutatesDocument: boolean;
  undoable: boolean;
  implementation: PhotoshopQuickActionCapabilityDescriptor['implementation'] | 'unsupported';
  warning: string | null;
  nativeExecutionCaveat: string;
  signature: string;
}

export interface ImageQuickActionRecordedStepSummary {
  id: string;
  actionId: string;
  label: string;
  supported: boolean;
  hasUnsupportedParams: boolean;
  mutatesDocument: boolean;
  undoable: boolean;
  input: readonly PhotoshopQuickActionCapabilityInput[];
  output: PhotoshopQuickActionCapabilityOutput | 'unknown';
  blockers: ImageQuickActionReadinessBlocker[];
  signature: string;
}

export interface ImageQuickActionMacroDocumentReadiness {
  id: string;
  title: string;
  width: number;
  height: number;
  active: boolean;
  layerCount: number;
  activeLayerId: string | null;
  hasSelection: boolean;
  ready: boolean;
  blockers: ImageQuickActionReadinessBlocker[];
  compatibility: ImageQuickActionMacroDocumentCompatibility;
  signature: string;
}

export interface ImageQuickActionMacroDocumentStepCompatibility {
  stepId: string;
  actionId: string;
  compatible: boolean;
  requiredInputs: readonly PhotoshopQuickActionCapabilityInput[];
  output: PhotoshopQuickActionCapabilityOutput | 'unknown';
  blockerCodes: ImageQuickActionReadinessBlockerCode[];
  signature: string;
}

export interface ImageQuickActionMacroDocumentCompatibility {
  state: 'compatible' | 'blocked';
  compatible: boolean;
  stepCount: number;
  compatibleStepCount: number;
  blockedStepCount: number;
  unsupportedActionIds: string[];
  unsupportedParameterStepIds: string[];
  missingRequiredInputs: ImageQuickActionReadinessBlockerCode[];
  requiredInputs: PhotoshopQuickActionCapabilityInput[];
  outputKinds: Array<PhotoshopQuickActionCapabilityOutput | 'unknown'>;
  stepChecks: ImageQuickActionMacroDocumentStepCompatibility[];
  signature: string;
}

export interface ImageQuickActionMacroCompatibilitySummary {
  readyDocumentIds: string[];
  blockedDocumentIds: string[];
  documentCompatibilitySignatures: string[];
  signature: string;
}

export interface ImageQuickActionMacroDashboardSignatures {
  macro: string;
  batchPlayback: string;
  documentCompatibility: string;
  nativeExecution: string;
  checklist: string;
}

export interface ImageQuickActionMacroReadinessDescriptor {
  descriptorId: 'image-quick-action-macro-readiness:v1';
  macro: {
    id: string;
    name: string;
    stepCount: number;
    mutatesDocument: boolean;
    allStepsUndoable: boolean;
    signature: string;
  };
  recordedCommands: {
    fixedQuickActionCommandCount: number;
    unsupportedArbitraryCommandRecording: {
      supported: false;
      reason: string;
      supportedRecordingKinds: readonly ['fixed-quick-action-id'];
      unsupportedStepIds: string[];
    };
    steps: ImageQuickActionRecordedStepSummary[];
  };
  batchPlayback: {
    ready: boolean;
    documentCount: number;
    readyDocumentCount: number;
    blockedDocumentCount: number;
    unsupportedActionIds: string[];
    unsupportedParameterSteps: string[];
    blockers: ImageQuickActionReadinessBlocker[];
    preview: {
      id: string;
      signature: string;
    };
    warnings: ImageQuickActionFileFolderBatchWarning[];
  };
  fileFolderBatch: {
    supported: false;
    openDocumentPlaybackSupported: true;
    unsupportedInputKinds: readonly ['file-list', 'folder'];
    caveats: string[];
    warnings: ImageQuickActionFileFolderBatchWarning[];
  };
  compatibilitySummary: ImageQuickActionMacroCompatibilitySummary;
  dashboardSignatures: ImageQuickActionMacroDashboardSignatures;
  documents: ImageQuickActionMacroDocumentReadiness[];
  nativeExecution: {
    supported: false;
    caveats: string[];
  };
  signature: string;
}

export type ImageQuickActionMacroDescriptorInput = Partial<Omit<ImageQuickActionMacroDescriptor, 'steps' | 'tags'>>
  & Pick<Partial<ImageQuickActionMacro>, 'createdAt' | 'updatedAt'>
  & {
    steps?: readonly Partial<ImageQuickActionMacroStepDescriptor>[];
    tags?: readonly string[];
  };

const QUICK_ACTION_LABELS = new Map(
  PHOTOSHOP_QUICK_ACTIONS.map((action) => [action.id, `${action.group}: ${action.label}`] as const),
);

const SUPPORTED_QUICK_ACTION_IDS = new Set(PHOTOSHOP_QUICK_ACTIONS.map((action) => action.id));

export function getImageQuickActionLabel(actionId: string): string {
  return QUICK_ACTION_LABELS.get(actionId) ?? actionId;
}

function normalizeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || fallback;
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function hasUnsupportedParams(step: Partial<ImageQuickActionMacroStepDescriptor>): boolean {
  return Object.prototype.hasOwnProperty.call(step, 'params') && step.params !== undefined;
}

function sortMacrosById(
  macros: readonly ImageQuickActionMacroDescriptor[],
): ImageQuickActionMacroDescriptor[] {
  return [...macros].sort((left, right) => left.id.localeCompare(right.id));
}

function dedupeSortedValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dedupeOrderedValues<T extends string>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const deduped: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function buildUnavailableCommandWarnings(actionIds: readonly string[]): ImageQuickActionPlaybackWarning[] {
  return actionIds.map((actionId) => ({
    code: 'unavailable-command' as const,
    severity: 'warning' as const,
    actionId,
    message: `Quick action command ${actionId} is not available for playback.`,
  }));
}

function buildPlaybackFileFolderBatchWarning(): ImageQuickActionFileFolderBatchWarning {
  return {
    code: 'file-folder-batch-unsupported',
    severity: 'warning',
    message: 'File/folder batch playback is not implemented; macro playback only targets currently open Image documents.',
  };
}

function buildReadinessFileFolderBatchWarning(): ImageQuickActionFileFolderBatchWarning {
  return {
    code: 'file-folder-batch-unsupported',
    severity: 'warning',
    message: 'Batch playback readiness covers currently open Image documents only; file and folder queues are not executable.',
  };
}

function buildPlaybackFileFolderBatchCaveat(macroId: string): ImageQuickActionMacroPlaybackDiagnostics['fileFolderBatch'] {
  return {
    supported: false,
    unsupportedInputKinds: ['file-list', 'folder'],
    caveats: [
      'File-list batch queues are not wired to quick-action macro playback.',
      'Folder input/output batch processing is not implemented for Image quick actions.',
      'Playback diagnostics only cover documents that are already open in the Image workspace.',
    ],
    warnings: [buildPlaybackFileFolderBatchWarning()],
    readinessSignature: `image-quick-action-file-folder-batch:v2:${JSON.stringify({
      macroId,
      supported: false,
      unsupportedInputKinds: ['file-list', 'folder'],
      openDocumentScope: 'currently-open-image-documents',
    })}`,
  };
}

function buildReadinessFileFolderBatchCaveat(): ImageQuickActionMacroReadinessDescriptor['fileFolderBatch'] {
  return {
    supported: false,
    openDocumentPlaybackSupported: true,
    unsupportedInputKinds: ['file-list', 'folder'],
    caveats: [
      'Quick-action macro playback can iterate currently open Image documents.',
      'File-list batch queues are not wired to quick-action macro playback.',
      'Folder input/output batch processing is not implemented for Image quick actions.',
    ],
    warnings: [buildReadinessFileFolderBatchWarning()],
  };
}

function blockerKey(blocker: ImageQuickActionReadinessBlocker): string {
  return [
    blocker.code,
    blocker.actionId ?? '',
    blocker.stepId ?? '',
    blocker.documentId ?? '',
    blocker.message,
  ].join(':');
}

function dedupeReadinessBlockers(
  blockers: readonly ImageQuickActionReadinessBlocker[],
): ImageQuickActionReadinessBlocker[] {
  const seen = new Set<string>();
  const deduped: ImageQuickActionReadinessBlocker[] = [];
  for (const blocker of blockers) {
    const key = blockerKey(blocker);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(blocker);
  }
  return deduped;
}

function getActiveLayer(doc: ImageDocument) {
  return doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null;
}

function buildCapabilityDocumentBlockers(input: {
  doc: ImageDocument;
  step: ImageQuickActionMacroStepDescriptor;
  action: ImageQuickActionActionReadinessDescriptor;
}): ImageQuickActionReadinessBlocker[] {
  const { doc, step, action } = input;
  const blockers: ImageQuickActionReadinessBlocker[] = [];
  const activeLayer = getActiveLayer(doc);
  const needsActiveLayer = action.input.some((required) => (
    required === 'activeLayer' || required === 'editablePixels' || required === 'movableLayer'
  ));

  if (!action.supported) {
    blockers.push({
      code: 'unsupported-action',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Step ${step.id} references unsupported quick action ${step.actionId}.`,
    });
  }

  if (hasUnsupportedParams(step)) {
    blockers.push({
      code: 'unsupported-params',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Step ${step.id} includes arbitrary parameters; only fixed quick action ids are recordable.`,
    });
  }

  if (needsActiveLayer && !activeLayer) {
    blockers.push({
      code: 'no-active-layer',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Document ${doc.id} has no active layer for step ${step.id}.`,
    });
  }

  if (activeLayer && needsActiveLayer && activeLayer.locked) {
    blockers.push({
      code: 'active-layer-locked',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Document ${doc.id} active layer ${activeLayer.id} is locked for step ${step.id}.`,
    });
  }

  if (activeLayer && action.input.includes('movableLayer') && activeLayer.locks?.position) {
    blockers.push({
      code: 'active-layer-position-locked',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Document ${doc.id} active layer ${activeLayer.id} has locked position for step ${step.id}.`,
    });
  }

  if (activeLayer && action.input.includes('editablePixels') && activeLayer.locks?.pixels) {
    blockers.push({
      code: 'active-layer-pixels-locked',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Document ${doc.id} active layer ${activeLayer.id} has locked pixels for step ${step.id}.`,
    });
  }

  if (action.input.includes('selection') && !doc.hasSelection) {
    blockers.push({
      code: 'missing-selection',
      severity: 'error',
      actionId: step.actionId,
      stepId: step.id,
      documentId: doc.id,
      message: `Document ${doc.id} has no active selection for step ${step.id}.`,
    });
  }

  return blockers;
}

function buildDocumentStepCompatibility(input: {
  doc: ImageDocument;
  macroId: string;
  step: ImageQuickActionMacroStepDescriptor;
  action: ImageQuickActionActionReadinessDescriptor;
}): ImageQuickActionMacroDocumentStepCompatibility & { blockers: ImageQuickActionReadinessBlocker[] } {
  const blockers = buildCapabilityDocumentBlockers({
    doc: input.doc,
    step: input.step,
    action: input.action,
  });
  const blockerCodes = blockers.map((blocker) => blocker.code);
  const signaturePayload = {
    documentId: input.doc.id,
    macroId: input.macroId,
    stepId: input.step.id,
    actionId: input.step.actionId,
    compatible: blockers.length === 0,
    blockerCodes,
  };

  return {
    stepId: input.step.id,
    actionId: input.step.actionId,
    compatible: blockers.length === 0,
    requiredInputs: input.action.input,
    output: input.action.output,
    blockerCodes,
    signature: `image-quick-action-step-document-compatibility:v1:${JSON.stringify(signaturePayload)}`,
    blockers,
  };
}

function buildDocumentCompatibility(input: {
  doc: ImageDocument;
  macroId: string;
  stepChecks: Array<ImageQuickActionMacroDocumentStepCompatibility & { blockers: ImageQuickActionReadinessBlocker[] }>;
}): ImageQuickActionMacroDocumentCompatibility {
  const publicStepChecks = input.stepChecks.map(({ blockers: _blockers, ...stepCheck }) => stepCheck);
  const compatibleStepCount = publicStepChecks.filter((step) => step.compatible).length;
  const allBlockerCodes = input.stepChecks.flatMap((step) => step.blockerCodes);
  const missingRequiredInputs = dedupeOrderedValues(allBlockerCodes.filter((code) => (
    code !== 'unsupported-action' && code !== 'unsupported-params'
  )));
  const signaturePayload = {
    documentId: input.doc.id,
    macroId: input.macroId,
    stepChecks: publicStepChecks.map((step) => ({
      stepId: step.stepId,
      actionId: step.actionId,
      compatible: step.compatible,
      blockerCodes: step.blockerCodes,
    })),
  };

  return {
    state: compatibleStepCount === publicStepChecks.length ? 'compatible' : 'blocked',
    compatible: compatibleStepCount === publicStepChecks.length,
    stepCount: publicStepChecks.length,
    compatibleStepCount,
    blockedStepCount: publicStepChecks.length - compatibleStepCount,
    unsupportedActionIds: dedupeSortedValues(input.stepChecks
      .filter((step) => step.blockerCodes.includes('unsupported-action'))
      .map((step) => step.actionId)),
    unsupportedParameterStepIds: dedupeSortedValues(input.stepChecks
      .filter((step) => step.blockerCodes.includes('unsupported-params'))
      .map((step) => step.stepId)),
    missingRequiredInputs,
    requiredInputs: (
      dedupeSortedValues(input.stepChecks.flatMap((step) => [...step.requiredInputs]))
    ) as PhotoshopQuickActionCapabilityInput[],
    outputKinds: (
      dedupeSortedValues(input.stepChecks.map((step) => step.output))
    ) as Array<PhotoshopQuickActionCapabilityOutput | 'unknown'>,
    stepChecks: publicStepChecks,
    signature: `image-quick-action-document-compatibility:v1:${JSON.stringify(signaturePayload)}`,
  };
}

export function describeImageQuickActionReadiness(actionId: string): ImageQuickActionActionReadinessDescriptor {
  const descriptor = getPhotoshopQuickActionCapabilityDescriptor(actionId);
  const fallbackSignaturePayload = {
    actionId,
    supported: false,
    input: [],
    output: 'unknown',
    mutatesDocument: false,
    undoable: false,
    implementation: 'unsupported',
  };

  if (!descriptor) {
    return {
      actionId,
      label: getImageQuickActionLabel(actionId),
      supported: false,
      input: [],
      output: 'unknown',
      mutatesDocument: false,
      undoable: false,
      implementation: 'unsupported',
      warning: 'No local fixed quick action command is registered for this id.',
      nativeExecutionCaveat: 'Native Photoshop action playback is not implemented.',
      signature: `image-quick-action-readiness:v1:${JSON.stringify(fallbackSignaturePayload)}`,
    };
  }

  const signaturePayload = {
    actionId: descriptor.id,
    supported: true,
    input: descriptor.input,
    output: descriptor.output,
    mutatesDocument: descriptor.mutatesDocument,
    undoable: descriptor.undoable,
    implementation: descriptor.implementation,
  };

  return {
    actionId: descriptor.id,
    label: descriptor.label,
    supported: true,
    input: descriptor.input,
    output: descriptor.output,
    mutatesDocument: descriptor.mutatesDocument,
    undoable: descriptor.undoable,
    implementation: descriptor.implementation,
    warning: descriptor.warning,
    nativeExecutionCaveat: 'Native Photoshop action playback is not implemented; local browser/store playback is the only executable path.',
    signature: `image-quick-action-readiness:v1:${JSON.stringify(signaturePayload)}`,
  };
}

export function normalizeImageQuickActionMacroDescriptor(
  macro: ImageQuickActionMacroDescriptorInput,
  macroIndex = 1,
): ImageQuickActionMacroDescriptor {
  const macroFallbackId = `macro-${macroIndex}`;
  const macroId = normalizeIdentifier(macro.id, macroFallbackId);
  const seenTags = new Set<string>();
  const tags: string[] = [];

  for (const rawTag of macro.tags ?? []) {
    if (typeof rawTag !== 'string') continue;
    const tag = normalizeTag(rawTag);
    if (!tag || seenTags.has(tag)) continue;
    seenTags.add(tag);
    tags.push(tag);
  }

  return {
    id: macroId,
    name: normalizeLabel(macro.name, `Macro ${macroIndex}`),
    steps: (macro.steps ?? []).map((step, stepIndex) => {
      const normalizedStep: ImageQuickActionMacroStepDescriptor = {
        id: normalizeIdentifier(step.id, `step-${stepIndex + 1}`),
        actionId: normalizeLabel(step.actionId, ''),
      };
      if (hasUnsupportedParams(step)) {
        normalizedStep.params = step.params;
      }
      return normalizedStep;
    }),
    tags,
  };
}

export function buildImageQuickActionMacroSetManifest(
  macros: readonly ImageQuickActionMacroDescriptorInput[],
): ImageQuickActionMacroSetManifest {
  return {
    schemaVersion: IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION,
    macros: sortMacrosById(
      macros.map((macro, index) => normalizeImageQuickActionMacroDescriptor(macro, index + 1)),
    ),
  };
}

export function validateImageQuickActionMacroSet(
  macros: readonly ImageQuickActionMacroDescriptorInput[],
  options?: {
    supportedActionIds?: readonly string[];
  },
): ImageQuickActionMacroSetValidationResult {
  const supportedActionIds = new Set(options?.supportedActionIds ?? [...SUPPORTED_QUICK_ACTION_IDS]);
  const normalizedMacros = macros.map((macro, index) => normalizeImageQuickActionMacroDescriptor(macro, index + 1));
  const issues: ImageQuickActionMacroValidationIssue[] = [];
  const missingActionIds: string[] = [];
  const duplicateStepIds: string[] = [];
  const unsupportedParameterSteps: string[] = [];
  const seenMissingActionIds = new Set<string>();

  for (const macro of normalizedMacros) {
    const seenStepIds = new Set<string>();
    const reportedDuplicateStepIds = new Set<string>();

    for (const step of macro.steps) {
      if (seenStepIds.has(step.id)) {
        const duplicateKey = `${macro.id}:${step.id}`;
        if (!reportedDuplicateStepIds.has(step.id)) {
          duplicateStepIds.push(duplicateKey);
          reportedDuplicateStepIds.add(step.id);
        }
        issues.push({
          code: 'duplicate-step-id',
          macroId: macro.id,
          stepId: step.id,
          message: `Macro ${macro.id} has duplicate step id ${step.id}.`,
        });
      } else {
        seenStepIds.add(step.id);
      }

      if (!step.actionId || !supportedActionIds.has(step.actionId)) {
        if (step.actionId && !seenMissingActionIds.has(step.actionId)) {
          missingActionIds.push(step.actionId);
          seenMissingActionIds.add(step.actionId);
        }
        issues.push({
          code: 'missing-action-id',
          macroId: macro.id,
          stepId: step.id,
          actionId: step.actionId,
          message: `Macro ${macro.id} step ${step.id} references unsupported action ${step.actionId}.`,
        });
      }

      if (hasUnsupportedParams(step)) {
        unsupportedParameterSteps.push(`${macro.id}:${step.id}`);
        issues.push({
          code: 'unsupported-params',
          macroId: macro.id,
          stepId: step.id,
          actionId: step.actionId,
          message: `Macro ${macro.id} step ${step.id} has unsupported parameter payloads.`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    macros: normalizedMacros,
    issues,
    missingActionIds,
    duplicateStepIds,
    unsupportedParameterSteps,
  };
}

export function buildImageQuickActionMacroReadiness(input: {
  macro: ImageQuickActionMacroDescriptorInput;
  documents?: readonly ImageDocument[];
  activeDocId?: string | null;
}): ImageQuickActionMacroReadinessDescriptor {
  const macro = normalizeImageQuickActionMacroDescriptor(input.macro, 1);
  const steps = macro.steps.map((step) => {
    const action = describeImageQuickActionReadiness(step.actionId);
    const blockers: ImageQuickActionReadinessBlocker[] = [];

    if (!action.supported) {
      blockers.push({
        code: 'unsupported-action',
        severity: 'error',
        actionId: step.actionId,
        stepId: step.id,
        message: `Step ${step.id} references unsupported quick action ${step.actionId}.`,
      });
    }

    if (hasUnsupportedParams(step)) {
      blockers.push({
        code: 'unsupported-params',
        severity: 'error',
        actionId: step.actionId,
        stepId: step.id,
        message: `Step ${step.id} includes arbitrary parameters; only fixed quick action ids are recordable.`,
      });
    }

    const signaturePayload = {
      id: step.id,
      actionId: step.actionId,
      supported: action.supported,
      hasUnsupportedParams: hasUnsupportedParams(step),
      input: action.input,
      output: action.output,
      mutatesDocument: action.mutatesDocument,
      undoable: action.undoable,
      blockerCodes: blockers.map((blocker) => blocker.code),
    };

    return {
      id: step.id,
      actionId: step.actionId,
      label: action.label,
      supported: action.supported,
      hasUnsupportedParams: hasUnsupportedParams(step),
      mutatesDocument: action.mutatesDocument,
      undoable: action.undoable,
      input: action.input,
      output: action.output,
      blockers,
      signature: `image-quick-action-recorded-step:v1:${JSON.stringify(signaturePayload)}`,
    };
  });
  const documents = [...(input.documents ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((doc) => {
      const stepCompatibilityChecks = macro.steps.map((step) => buildDocumentStepCompatibility({
        doc,
        macroId: macro.id,
        step,
        action: describeImageQuickActionReadiness(step.actionId),
      }));
      const blockers = dedupeReadinessBlockers(stepCompatibilityChecks.flatMap((step) => step.blockers));
      const compatibility = buildDocumentCompatibility({
        doc,
        macroId: macro.id,
        stepChecks: stepCompatibilityChecks,
      });
      const signaturePayload = {
        id: doc.id,
        layerCount: doc.layers.length,
        activeLayerId: doc.activeLayerId,
        hasSelection: doc.hasSelection,
        blockerCodes: blockers.map((blocker) => blocker.code),
      };

      return {
        id: doc.id,
        title: doc.title,
        width: doc.width,
        height: doc.height,
        active: doc.id === (input.activeDocId ?? null),
        layerCount: doc.layers.length,
        activeLayerId: doc.activeLayerId,
        hasSelection: doc.hasSelection,
        ready: blockers.length === 0,
        blockers,
        compatibility,
        signature: `image-quick-action-document-readiness:v1:${JSON.stringify(signaturePayload)}`,
      };
    });
  const unsupportedActionIds = dedupeSortedValues(
    steps.filter((step) => !step.supported).map((step) => step.actionId),
  );
  const unsupportedParameterSteps = steps
    .filter((step) => step.hasUnsupportedParams)
    .map((step) => `${macro.id}:${step.id}`);
  const macroBlockers = dedupeReadinessBlockers(steps.flatMap((step) => step.blockers));
  const documentBlockers = dedupeReadinessBlockers(documents.flatMap((doc) => doc.blockers));
  const batchBlockers = dedupeReadinessBlockers([...macroBlockers, ...documentBlockers]);
  const fileFolderBatch = buildReadinessFileFolderBatchCaveat();
  const mutatesDocument = steps.some((step) => step.mutatesDocument);
  const allStepsUndoable = steps.every((step) => step.undoable);
  const readyDocumentCount = documents.filter((doc) => doc.ready).length;
  const nativeExecutionSignature = 'image-quick-action-native-execution:v1:{"supported":false,"scope":"image-automation","filesystemExecution":false}';
  const compatibilitySummaryPayload = {
    macroId: macro.id,
    readyDocumentIds: documents.filter((doc) => doc.compatibility.compatible).map((doc) => doc.id),
    blockedDocumentIds: documents.filter((doc) => !doc.compatibility.compatible).map((doc) => doc.id),
    documentCompatibilitySignatures: documents.map((doc) => doc.compatibility.signature),
  };
  const compatibilitySummary: ImageQuickActionMacroCompatibilitySummary = {
    readyDocumentIds: compatibilitySummaryPayload.readyDocumentIds,
    blockedDocumentIds: compatibilitySummaryPayload.blockedDocumentIds,
    documentCompatibilitySignatures: compatibilitySummaryPayload.documentCompatibilitySignatures,
    signature: `image-quick-action-document-compatibility-summary:v1:${JSON.stringify(compatibilitySummaryPayload)}`,
  };
  const openDocumentPreviewPayload = {
    macroId: macro.id,
    documentSignatures: documents.map((doc) => doc.signature),
    readyDocumentCount,
    blockerCodes: documentBlockers.map((blocker) => blocker.code),
  };
  const macroSignaturePayload = {
    id: macro.id,
    name: macro.name,
    stepSignatures: steps.map((step) => step.signature),
  };
  const readinessSignaturePayload = {
    macro: {
      id: macro.id,
      stepCount: steps.length,
      mutatesDocument,
      allStepsUndoable,
    },
    unsupportedActionIds,
    unsupportedParameterSteps,
    documentSignatures: documents.map((doc) => doc.signature),
    blockerCodes: batchBlockers.map((blocker) => blocker.code),
  };

  return {
    descriptorId: 'image-quick-action-macro-readiness:v1',
    macro: {
      id: macro.id,
      name: macro.name,
      stepCount: steps.length,
      mutatesDocument,
      allStepsUndoable,
      signature: `image-quick-action-macro:v1:${JSON.stringify(macroSignaturePayload)}`,
    },
    recordedCommands: {
      fixedQuickActionCommandCount: steps.filter((step) => step.supported && !step.hasUnsupportedParams).length,
      unsupportedArbitraryCommandRecording: {
        supported: false,
        reason: 'Macro recording stores fixed quick action command ids only; arbitrary command payloads are not executable.',
        supportedRecordingKinds: ['fixed-quick-action-id'],
        unsupportedStepIds: steps.filter((step) => step.hasUnsupportedParams).map((step) => step.id),
      },
      steps,
    },
    batchPlayback: {
      ready: batchBlockers.length === 0,
      documentCount: documents.length,
      readyDocumentCount,
      blockedDocumentCount: documents.length - readyDocumentCount,
      unsupportedActionIds,
      unsupportedParameterSteps,
      blockers: batchBlockers,
      preview: {
        id: `image-quick-action-open-documents-preview:${macro.id}:${documents.length}-docs:${documentBlockers.length}-blockers`,
        signature: `image-quick-action-open-documents:v1:${JSON.stringify(openDocumentPreviewPayload)}`,
      },
      warnings: fileFolderBatch.warnings,
    },
    fileFolderBatch,
    compatibilitySummary,
    dashboardSignatures: {
      macro: `image-quick-action-macro:v1:${JSON.stringify(macroSignaturePayload)}`,
      batchPlayback: `image-quick-action-open-documents:v1:${JSON.stringify(openDocumentPreviewPayload)}`,
      documentCompatibility: compatibilitySummary.signature,
      nativeExecution: nativeExecutionSignature,
      checklist: `image-quick-action-dashboard:v1:${JSON.stringify({
        macro: `image-quick-action-macro:v1:${JSON.stringify(macroSignaturePayload)}`,
        documentCompatibility: compatibilitySummary.signature,
        nativeExecution: nativeExecutionSignature,
      })}`,
    },
    documents,
    nativeExecution: {
      supported: false,
      caveats: [
        'Native Photoshop action execution is not available.',
        'Local quick-action macro playback can mutate open Image documents through browser/store commands only.',
        'Batch playback readiness is a planning descriptor and does not launch unattended native automation.',
      ],
    },
    signature: `image-quick-action-macro-readiness:v1:${JSON.stringify(readinessSignaturePayload)}`,
  };
}

export function exportImageQuickActionMacroSet(macros: readonly ImageQuickActionMacroDescriptorInput[]): string {
  return JSON.stringify(buildImageQuickActionMacroSetManifest(macros));
}

export function importImageQuickActionMacroSet(rawManifest: string): ImageQuickActionMacroSetManifest | null {
  try {
    const parsed = JSON.parse(rawManifest);
    if (
      !parsed
      || typeof parsed !== 'object'
      || parsed.schemaVersion !== IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION
      || !Array.isArray(parsed.macros)
    ) {
      return null;
    }

    return buildImageQuickActionMacroSetManifest(parsed.macros);
  } catch {
    return null;
  }
}

function buildMacroRunIdentity(input: {
  macro: ImageQuickActionMacroDescriptor;
  documentIds: readonly string[];
  unavailableActionIds: readonly string[];
}): ImageQuickActionMacroRunIdentity {
  const stepActionIds = input.macro.steps.map((step) => step.actionId);
  const signaturePayload = {
    macroId: input.macro.id,
    documentIds: input.documentIds,
    stepActionIds,
    unavailableActionIds: input.unavailableActionIds,
  };

  return {
    macroId: input.macro.id,
    actionSetId: `image-quick-action-macro-set:${input.macro.id}:${input.macro.steps.length}-steps`,
    runId: `image-quick-action-run:${input.macro.id}:${input.documentIds.length}-docs:${input.unavailableActionIds.length}-unavailable`,
    signature: `image-quick-action-run-identity:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildMacroImportValidationDescriptor(input: {
  macro: ImageQuickActionMacroDescriptor;
  supportedActionIds: readonly string[];
  warnings: ImageQuickActionPlaybackWarning[];
}): ImageQuickActionMacroImportValidationDescriptor {
  const validation = validateImageQuickActionMacroSet([input.macro], {
    supportedActionIds: input.supportedActionIds,
  });
  const issueCodes = dedupeOrderedValues(validation.issues.map((issue) => issue.code));
  const state: ImageQuickActionMacroImportValidationDescriptor['state'] = validation.issues.length === 0
    ? 'valid'
    : input.warnings.length > 0 && validation.issues.every((issue) => issue.code === 'missing-action-id')
      ? 'valid-with-warnings'
      : 'invalid';
  const signaturePayload = {
    schemaVersion: IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION,
    macroId: input.macro.id,
    issueCodes,
    missingActionIds: validation.missingActionIds,
    duplicateStepIds: validation.duplicateStepIds,
    unsupportedParameterSteps: validation.unsupportedParameterSteps,
  };

  return {
    schemaVersion: IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION,
    state,
    valid: validation.issues.length === 0,
    issueCodes,
    missingActionIds: validation.missingActionIds,
    duplicateStepIds: validation.duplicateStepIds,
    unsupportedParameterSteps: validation.unsupportedParameterSteps,
    warnings: input.warnings,
    signature: `image-quick-action-import-validation:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildMacroStepExecutionLog(input: {
  runId: string;
  macro: ImageQuickActionMacroDescriptor;
  documents: readonly ImageQuickActionMacroPlaybackDocumentDiagnostics[];
  unavailableActionIds: readonly string[];
  commandWarnings: readonly ImageQuickActionPlaybackWarning[];
}): ImageQuickActionMacroStepExecutionLog {
  const entries: ImageQuickActionMacroStepExecutionLogEntry[] = [];
  const unavailableActionSet = new Set(input.unavailableActionIds);

  for (const doc of input.documents) {
    for (const step of input.macro.steps) {
      const index = entries.length + 1;
      const warnings = unavailableActionSet.has(step.actionId)
        ? input.commandWarnings.filter((warning) => warning.code === 'unavailable-command' && warning.actionId === step.actionId)
        : [];
      const hasDocumentBlocker = doc.warnings.some((warning) => warning.code === 'no-active-layer');
      const status: ImageQuickActionMacroStepExecutionLogEntry['status'] = warnings.length > 0
        ? 'unavailable'
        : hasDocumentBlocker ? 'blocked-document' : 'dry-run';
      const signaturePayload = {
        runId: input.runId,
        documentId: doc.id,
        stepId: step.id,
        actionId: step.actionId,
        status,
        executed: false,
        warningCodes: warnings.map((warning) => warning.code),
      };

      entries.push({
        id: `image-quick-action-log:${String(index).padStart(3, '0')}:${doc.id}:${step.id}`,
        documentId: doc.id,
        stepId: step.id,
        actionId: step.actionId,
        status,
        executed: false,
        warnings,
        signature: `image-quick-action-step-log:v1:${JSON.stringify(signaturePayload)}`,
      });
    }
  }

  const logStatus: ImageQuickActionMacroStepExecutionLog['status'] = entries.some((entry) => entry.status !== 'dry-run')
    ? 'blocked'
    : 'planned';
  const signaturePayload = {
    runId: input.runId,
    mode: 'dry-run',
    status: logStatus,
    entryIds: entries.map((entry) => entry.id),
  };

  return {
    runId: input.runId,
    mode: 'dry-run',
    status: logStatus,
    entries,
    unsupportedExecution: {
      nativeFilesystemExecution: false,
      unattendedBackgroundExecution: false,
      arbitraryPluginCommands: false,
      fullPhotoshopActions: false,
    },
    signature: `image-quick-action-step-execution-log:v1:${JSON.stringify(signaturePayload)}`,
  };
}

export function buildImageQuickActionMacroPlaybackDiagnostics(input: {
  macro: ImageQuickActionMacro;
  documents: readonly ImageDocument[];
  activeDocId: string | null;
  supportedActionIds?: readonly string[];
}): ImageQuickActionMacroPlaybackDiagnostics {
  const playbackMacro = normalizeImageQuickActionMacroDescriptor(input.macro, 1);
  const supportedActionIds = dedupeSortedValues(input.supportedActionIds ?? [...SUPPORTED_QUICK_ACTION_IDS]);
  const supportedActionIdSet = new Set(supportedActionIds);
  const unavailableActionIds = dedupeSortedValues(
    playbackMacro.steps
      .map((step) => step.actionId)
      .filter((actionId) => !supportedActionIdSet.has(actionId)),
  );
  const commandWarnings = buildUnavailableCommandWarnings(unavailableActionIds);
  const documents = input.documents.map((doc) => {
    const warnings: ImageQuickActionPlaybackWarning[] = [];
    if (!doc.activeLayerId) {
      warnings.push({
        code: 'no-active-layer',
        severity: 'warning',
        message: `Document ${doc.id} has no active layer for layer-targeted quick actions.`,
      });
    }
    warnings.push(...commandWarnings);

    return {
      id: doc.id,
      title: doc.title,
      width: doc.width,
      height: doc.height,
      layerCount: doc.layers.length,
      active: doc.id === input.activeDocId,
      canAttemptPlayback: warnings.length === 0,
      warnings,
    };
  });
  const attemptedDocumentCount = documents.filter((doc) => doc.canAttemptPlayback).length;
  const attemptedDocumentIds = documents.filter((doc) => doc.canAttemptPlayback).map((doc) => doc.id);
  const blockedDocumentIds = documents.filter((doc) => !doc.canAttemptPlayback).map((doc) => doc.id);
  const macroRunIdentity = buildMacroRunIdentity({
    macro: playbackMacro,
    documentIds: documents.map((doc) => doc.id),
    unavailableActionIds,
  });
  const importValidation = buildMacroImportValidationDescriptor({
    macro: playbackMacro,
    supportedActionIds,
    warnings: commandWarnings,
  });
  const stepExecutionLog = buildMacroStepExecutionLog({
    runId: macroRunIdentity.runId,
    macro: playbackMacro,
    documents,
    unavailableActionIds,
    commandWarnings,
  });
  const perDocumentBlockers = documents.flatMap((doc) => doc.warnings
    .filter((warning) => warning.code === 'no-active-layer')
    .map((warning) => warning.message));
  const signaturePayload = {
    macro: {
      id: input.macro.id,
      stepCount: input.macro.steps.length,
      unavailableActionIds,
    },
    documents: documents.map((doc) => ({
      id: doc.id,
      layerCount: doc.layerCount,
      active: doc.active,
      canAttemptPlayback: doc.canAttemptPlayback,
      warningCodes: doc.warnings.map((warning) => warning.code),
    })),
  };
  const previewSignature = `image-quick-action-playback-diagnostics:v1:${JSON.stringify(signaturePayload)}`;
  const deterministicRouteSignature = `image-quick-action-open-doc-batch:v2:${JSON.stringify({
    macroId: input.macro.id,
    documentIds: documents.map((doc) => doc.id),
    attemptedDocumentIds,
    blockedDocumentIds,
    unavailableActionIds,
  })}`;
  const workspaceBlockers = [
    'Native unattended execution is not implemented.',
    'Macro import/export UI is descriptor-only.',
    ...perDocumentBlockers,
    ...(unavailableActionIds.length > 0 ? ['One or more macro commands are unavailable.'] : []),
  ];

  return {
    descriptorId: 'image-quick-action-playback-diagnostics:v1',
    macro: {
      id: input.macro.id,
      name: input.macro.name,
      stepCount: playbackMacro.steps.length,
      identity: `${input.macro.id}:${input.macro.name}:${playbackMacro.steps.length}-steps:${unavailableActionIds.length}-unavailable`,
    },
    macroRunIdentity,
    importValidation,
    stepExecutionLog,
    commandAvailability: {
      supportedActionIds,
      unavailableActionIds,
      warnings: commandWarnings,
    },
    commandRecordingCaveats: {
      arbitraryCommandsSupported: false,
      parameterizedStepsSupported: false,
      fixedQuickActionIdsOnly: true,
      message: 'Playback diagnostics assume fixed Sloom Studio quick action ids only; arbitrary commands and parameter payloads remain descriptor-only caveats.',
    },
    documents,
    preview: {
      id: `image-quick-action-preview:${input.macro.id}:${documents.length}-docs:${unavailableActionIds.length}-unavailable`,
      documentCount: documents.length,
      attemptedDocumentCount,
      unavailableCommandCount: unavailableActionIds.length,
      signature: previewSignature,
    },
    batchOpenDocuments: {
      supported: true,
      scope: 'currently-open-image-documents',
      documentCount: documents.length,
      attemptedDocumentCount,
      blockedDocumentCount: documents.length - attemptedDocumentCount,
      previewSignature,
      deterministicRouteSignature,
    },
    fileFolderBatch: buildPlaybackFileFolderBatchCaveat(input.macro.id),
    automationBoundary: {
      separateFromMainFlow: true,
      requiredWorkspace: 'image-automation',
      mainFlowCallable: false,
      reason: 'Quick action macro playback stays in Image Automation surfaces and does not become a main Flow node execution path.',
    },
    nativeExecution: {
      supported: false,
      reason: 'Quick action macros are deterministic browser/store playback descriptors only; unattended native filesystem execution is not wired.',
      requiredWorkspace: 'image-automation',
    },
    importExportUi: {
      manifestSchemaVersion: IMAGE_QUICK_ACTION_MACRO_SET_SCHEMA_VERSION,
      canSerializeManifest: true,
      canParseManifest: true,
      hasDedicatedImportUi: false,
      hasDedicatedExportUi: false,
      gaps: [
        'No dedicated Image Automation import button is wired to macro manifests.',
        'No dedicated Image Automation export button is wired to macro manifests.',
      ],
    },
    workspaceHandoff: {
      workspaceId: 'image-automation',
      ready: workspaceBlockers.length === 0,
      handoffKind: 'macro-playback-preview',
      requiredPayloads: ['macro-manifest', 'open-document-targets', 'command-availability'],
      blockers: workspaceBlockers,
    },
  };
}

export function playImageQuickActionMacro(macroId: string): boolean {
  const store = useImageEditorStore.getState();
  const macro = store.quickActionMacros.find((entry) => entry.id === macroId);
  if (!macro) return false;

  let ranAtLeastOneStep = false;
  for (const step of macro.steps) {
    if (runPhotoshopQuickAction(step.actionId, { skipRecording: true })) {
      ranAtLeastOneStep = true;
    }
  }

  return ranAtLeastOneStep;
}

export interface ImageQuickActionBatchResult {
  macroId: string;
  requestedCount: number;
  successCount: number;
  failedDocIds: string[];
}

export function playImageQuickActionMacroAcrossOpenDocuments(
  macroId: string,
): ImageQuickActionBatchResult | null {
  const initialState = useImageEditorStore.getState();
  const macro = initialState.quickActionMacros.find((entry) => entry.id === macroId);
  if (!macro) return null;

  const originalActiveDocId = initialState.activeDocId;
  const docIds = initialState.documents.map((doc) => doc.id);
  const failedDocIds: string[] = [];
  let successCount = 0;

  for (const docId of docIds) {
    useImageEditorStore.getState().setActiveDocument(docId);
    let docSucceeded = true;
    for (const step of macro.steps) {
      if (!runPhotoshopQuickAction(step.actionId, { skipRecording: true })) {
        docSucceeded = false;
      }
    }
    if (docSucceeded) {
      successCount += 1;
    } else {
      failedDocIds.push(docId);
    }
  }

  useImageEditorStore.setState((state) => ({
    ...state,
    activeDocId: originalActiveDocId,
  }));

  return {
    macroId,
    requestedCount: docIds.length,
    successCount,
    failedDocIds,
  };
}
