export type ImageBatchOperationKind = 'macro' | 'quick-action';
export type ImageBatchConflictStrategy = 'suffix' | 'overwrite' | 'skip';
export const IMAGE_BATCH_ACTION_SET_SCHEMA_VERSION = 1;
export type ImageBatchOutputFormat = 'source' | 'png' | 'jpeg' | 'webp' | 'psd' | 'tiff';
export type ImageBatchResolvedOutputFormat =
  | 'avif'
  | 'bmp'
  | 'gif'
  | 'jpeg'
  | 'jpg'
  | 'png'
  | 'psb'
  | 'psd'
  | 'svg'
  | 'tif'
  | 'tiff'
  | 'webp'
  | 'xcf';

export type ImageBatchSkippedReason =
  | 'unsupported-extension'
  | 'duplicate-path'
  | 'output-path-conflict'
  | 'invalid-action-set';

export interface ImageBatchActionSetManifest {
  schemaVersion: typeof IMAGE_BATCH_ACTION_SET_SCHEMA_VERSION;
  macroIds: string[];
  actionIds: string[];
}

export interface ImageBatchActionSetValidationResult {
  requested: ImageBatchActionSetManifest;
  resolved: ImageBatchActionSetManifest;
  missingMacroIds: string[];
  missingActionIds: string[];
}

export type ImageBatchUnavailableCommandWarning =
  | {
      code: 'missing-macro';
      severity: 'warning';
      id: string;
      message: string;
    }
  | {
      code: 'missing-quick-action';
      severity: 'warning';
      id: string;
      message: string;
    };

export interface ImageBatchInputFileRecord {
  id: string;
  path: string;
  folderId?: string;
  relativePath?: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface ImageBatchInputFolderRecord {
  id: string;
  path: string;
  label?: string;
}

export interface ImageBatchOutputOptions {
  folderPath: string;
  format?: ImageBatchOutputFormat;
  filenamePattern?: string;
  preserveFolderStructure?: boolean;
  conflictStrategy?: ImageBatchConflictStrategy;
}

export interface BuildImageBatchPlanInput {
  files: ImageBatchInputFileRecord[];
  folders?: ImageBatchInputFolderRecord[];
  macroIds?: string[];
  actionIds?: string[];
  availableMacroIds?: readonly string[];
  availableActionIds?: readonly string[];
  output: ImageBatchOutputOptions;
}

export interface ImageBatchPlanOperation {
  kind: ImageBatchOperationKind;
  id: string;
}

export interface ImageBatchPlanItem {
  fileId: string;
  inputPath: string;
  outputPath: string;
  sourceLabel: string;
  relativePath: string;
  operationLabel: string;
  outputFormat: ImageBatchResolvedOutputFormat;
  sizeBytes?: number;
  executionStatus: 'not-run';
  unavailableCommandWarnings: ImageBatchUnavailableCommandWarning[];
  queueDiagnostics: ImageBatchQueueItemDiagnostics;
  audit: ImageBatchPlanItemAudit;
}

export interface ImageBatchPlanItemAudit {
  fileId: string;
  inputPath: string;
  status: 'planned' | 'skipped';
  detail: string;
  outputConflictStrategy: ImageBatchConflictStrategy;
  conflictDecision: 'none' | 'renamed' | 'overwritten' | 'skipped';
  requestedOutputPath?: string;
  outputPath?: string;
  actionSet: ImageBatchActionSetValidationResult;
}

export interface ImageBatchSkippedFile {
  fileId: string;
  inputPath: string;
  reason: ImageBatchSkippedReason;
  detail: string;
  queueDiagnostics: ImageBatchQueueItemDiagnostics;
  audit: ImageBatchPlanItemAudit;
}

export interface ImageBatchPlan {
  mode: 'dry-run';
  canExecuteUnattended: false;
  auditLogLevel: 'summary';
  nativeExecution: {
    supported: false;
    reason: string;
    requiredWorkspace: 'image-automation';
  };
  actionSet: ImageBatchActionSetValidationResult;
  queueIdentity: ImageBatchQueueIdentity;
  operations: ImageBatchPlanOperation[];
  output: Required<ImageBatchOutputOptions>;
  items: ImageBatchPlanItem[];
  skipped: ImageBatchSkippedFile[];
  auditLog: ImageBatchPlanItemAudit[];
  queueAuditSummary: {
    requestedFiles: number;
    plannedItems: number;
    skippedFiles: number;
    conflictDecisions: Record<ImageBatchPlanItemAudit['conflictDecision'], number>;
    skippedReasons: Partial<Record<ImageBatchSkippedReason, number>>;
    unavailableCommandCount: number;
    outputFormats: ImageBatchResolvedOutputFormat[];
  };
  queueReadiness: {
    ready: boolean;
    sourceKinds: Array<'file' | 'folder'>;
    folderCount: number;
    fileCount: number;
    plannedFileCount: number;
    skippedFileCount: number;
    outputFolderReady: boolean;
    hasExecutableActionSet: boolean;
    blockers: string[];
    warnings: string[];
  };
  executionLogPolicy: {
    level: 'summary';
    maxEntries: number;
    retention: 'current-session';
    includesSkippedItems: boolean;
    includesOutputConflicts: boolean;
  };
  executionLog: ImageBatchExecutionLog;
  retryPolicy: {
    maxAttempts: number;
    retryableErrors: string[];
    stopOnFirstError: boolean;
    recordsPerItemErrors: boolean;
    unsupportedReason: string;
  };
  outputNamingPolicy: {
    filenamePattern: string;
    conflictStrategy: ImageBatchConflictStrategy;
    collisionPolicy: 'append-numeric-suffix' | 'overwrite-existing-output' | 'skip-conflicting-output';
    preservesFolderStructure: boolean;
    namingTokens: readonly ['{basename}', '{ext}', '{index}', '{operation}', '{relativeDir}', '{fileId}'];
    outputFolder: {
      path: string;
      writeState: 'requires-user-confirmed-directory-handle';
      nativeWriteSupported: false;
    };
    sampleCollisions: Array<{
      requestedPath: string;
      resolvedPath: string;
      decision: ImageBatchPlanItemAudit['conflictDecision'];
    }>;
    collisionChecks: {
      collisionCount: number;
      decisions: Record<'renamed' | 'overwritten' | 'skipped', number>;
      signature: string;
    };
    signature: string;
  };
  queuePlanning: ImageBatchQueuePlanningDescriptor;
  workspaceHandoff: {
    workspaceId: 'image-automation';
    ready: boolean;
    handoffKind: 'batch-plan-preview';
    requiredPayloads: string[];
    blockers: string[];
  };
  fileAccess: ImageBatchFileAccessDescriptor;
  variableFillPlan: ImageBatchVariableFillPlanningDescriptor;
  actionMacroHandoff: ImageBatchActionMacroHandoffDescriptor;
  nativeExecutionState: ImageBatchNativeExecutionState;
  progressEvidence: ImageBatchProgressEvidence;
  dashboardSignatures: ImageBatchDashboardSignatures;
  preview: {
    id: string;
    signature: string;
    sampleOutputPaths: string[];
    auditLabel: string;
  };
  totals: {
    requestedFiles: number;
    plannedItems: number;
    skippedFiles: number;
    macroCount: number;
    quickActionCount: number;
  };
}

export interface ImageBatchQueueIdentity {
  queueId: string;
  actionSetId: string;
  workspaceId: 'image-automation';
  signature: string;
}

export interface ImageBatchQueueItemDiagnostics {
  queueItemId: string;
  queueId: string;
  fileId: string;
  inputStatus: 'accepted' | 'skipped';
  dryRunStatus: 'planned-not-executed' | 'skipped-before-execution';
  plannedOperationIds: string[];
  unavailableCommandIds: string[];
  outputPath?: string;
  skipReason?: ImageBatchSkippedReason;
  signature: string;
}

export interface ImageBatchExecutionLogEntry {
  id: string;
  queueItemId: string;
  fileId: string;
  operation: ImageBatchPlanOperation;
  status: 'dry-run' | 'unavailable' | 'skipped';
  executed: false;
  message: string;
}

export interface ImageBatchExecutionLog {
  runId: string;
  queueId: string;
  mode: 'dry-run';
  status: 'planned' | 'blocked';
  stepCount: number;
  entries: ImageBatchExecutionLogEntry[];
  unsupportedExecution: {
    nativeFilesystemExecution: false;
    unattendedBackgroundExecution: false;
    arbitraryPluginCommands: false;
    fullPhotoshopActions: false;
  };
  signature: string;
}

export interface ImageBatchFileAccessSourceDescriptor {
  kind: 'direct-files' | 'input-folder';
  count: number;
  path?: string;
  label?: string;
  readState: 'queued-from-browser-or-native-picker' | 'requires-user-confirmed-directory-handle';
  caveats: string[];
}

export interface ImageBatchFileAccessDescriptor {
  capabilities: {
    directFileListInput: true;
    folderInput: true;
    folderOutput: true;
    perFileOutputDescriptors: true;
    writesDuringDryRun: false;
  };
  inputSources: ImageBatchFileAccessSourceDescriptor[];
  outputTarget: {
    kind: 'output-folder';
    path: string;
    writeState: 'requires-user-confirmed-directory-handle';
    overwritePolicy: ImageBatchConflictStrategy;
    caveats: string[];
  };
}

export interface ImageBatchVariableFillPlanningDescriptor {
  state: 'available-for-review';
  bindingReadiness: 'ready-for-explicit-review';
  aiAssist: 'planned-not-executed';
  requiredReview: true;
  fillSources: Array<'metadata' | 'filename'>;
  supportsOutputNamingBindings: true;
  supportsMacroPlaceholderBindings: true;
  supportsArbitraryJsExpressions: false;
  caveats: string[];
  algorithmicFill: {
    supported: true;
    deterministic: true;
    sources: readonly ['filename', 'metadata'];
    availableBindings: Array<{
      token: '{basename}' | '{relativeDir}' | '{index}' | '{fileId}';
      source: 'filename' | 'metadata';
      target: 'output-naming';
    }>;
    signature: string;
  };
  aiFill: {
    state: 'planned-not-executed';
    providerCallsDuringPlanning: false;
    sources: readonly ['ai-description'];
    reviewRequired: true;
    unsupportedExecutionReason: string;
    signature: string;
  };
  signature: string;
}

export interface ImageBatchCallableOperationDescriptor {
  kind: ImageBatchOperationKind;
  id: string;
  source: 'saved-macro' | 'suite-native-quick-action';
  callable: boolean;
  reason?: 'missing-from-registry';
}

export interface ImageBatchActionMacroHandoffDescriptor {
  state: 'ready' | 'blocked';
  automationSurface: {
    workspaceId: 'image-automation';
    surface: 'folder-list-batch';
    separateFromMainFlow: true;
  };
  macroIds: string[];
  quickActionIds: string[];
  skippedMacroIds: string[];
  skippedQuickActionIds: string[];
  callableOperations: ImageBatchCallableOperationDescriptor[];
  handoffPayloads: string[];
  caveats: string[];
}

export interface ImageBatchNativeExecutionState {
  state: 'unsupported';
  canRunNow: false;
  unsupportedReasons: Array<'native-batch-runner-not-wired' | 'directory-write-adapter-not-wired'>;
  nextSupportedState: 'preview-ready';
  unsupportedArbitraryJsState: {
    supported: false;
    reason: string;
  };
  filesystemStates: ImageBatchNativeFilesystemState[];
  signature: string;
}

export interface ImageBatchNativeFilesystemState {
  operation: 'read-folder-queue' | 'write-output-folder' | 'create-collision-safe-output';
  supported: false;
  state: 'requires-user-confirmed-directory-handle' | 'unsupported-native-adapter-missing' | 'planned-metadata-only';
  canExecuteInDryRun: false;
  reason: string;
}

export interface ImageBatchQueuePlanningDescriptor {
  descriptorId: 'image-batch-queue-planning:v1';
  imageOnly: true;
  workspaceId: 'image-automation';
  separateFromMainFlow: true;
  inputMode: 'file-list' | 'folder-queue' | 'mixed-file-folder';
  directFileQueue: {
    count: number;
    fileIds: string[];
  };
  folderQueues: Array<{
    id: string;
    path: string;
    label?: string;
    count: number;
    readState: 'requires-user-confirmed-directory-handle';
  }>;
  plannedFileIds: string[];
  skippedFileIds: string[];
  checks: {
    hasInputFiles: boolean;
    hasOutputFolder: boolean;
    hasExecutableActionSet: boolean;
    unsupportedInputCount: number;
    duplicateInputCount: number;
    outputConflictCount: number;
    ready: boolean;
  };
  signature: string;
}

export interface ImageBatchDashboardSignatures {
  queue: string;
  outputNaming: string;
  variableFill: string;
  nativeExecution: string;
  preview: string;
  checklist: string;
}

export interface ImageBatchProgressEvidence {
  state: 'planned';
  plannedCount: number;
  skippedCount: number;
  completedCount: 0;
  failedCount: 0;
  evidenceLevel: 'plan-only';
  auditSummary: string;
  sampleOutputPaths: string[];
  dryRunDiagnostics: {
    scope: 'multiple-documents';
    safe: true;
    canMutateDocuments: false;
    documentCount: number;
    plannedDocumentCount: number;
    skippedDocumentCount: number;
    sampleInputPaths: string[];
  };
}

const SUPPORTED_INPUT_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'psb',
  'psd',
  'svg',
  'tif',
  'tiff',
  'webp',
  'xcf',
]);

const IMAGE_BATCH_NAMING_TOKENS = [
  '{basename}',
  '{ext}',
  '{index}',
  '{operation}',
  '{relativeDir}',
  '{fileId}',
] as const;

function normalizePath(path: string): string {
  const normalizedSlashes = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  const hasLeadingSlash = normalizedSlashes.startsWith('/');
  const parts: string[] = [];

  for (const part of normalizedSlashes.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `${hasLeadingSlash ? '/' : ''}${parts.join('/')}`;
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function getFileName(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function getExtension(path: string): string {
  const fileName = getFileName(path);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

function getBasename(path: string): string {
  const fileName = getFileName(path);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : '';
}

function normalizeRelativePath(path: string): string {
  return normalizePath(path).replace(/^\/+/, '');
}

function getOutputFormat(inputExtension: string, requestedFormat: ImageBatchOutputFormat): ImageBatchResolvedOutputFormat {
  if (requestedFormat !== 'source') return requestedFormat;
  if (inputExtension === 'jpg') return 'jpeg';
  if (inputExtension === 'tif') return 'tiff';
  if (inputExtension === 'psb') return 'psd';
  if (inputExtension === 'xcf') return 'png';
  return inputExtension as ImageBatchResolvedOutputFormat;
}

function buildOperations(macroIds: string[], actionIds: string[]): ImageBatchPlanOperation[] {
  return [
    ...macroIds.map((id) => ({ kind: 'macro' as const, id })),
    ...actionIds.map((id) => ({ kind: 'quick-action' as const, id })),
  ];
}

function dedupeOrderedValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function buildUnavailableCommandWarnings(
  actionSet: ImageBatchActionSetValidationResult,
): ImageBatchUnavailableCommandWarning[] {
  return [
    ...actionSet.missingMacroIds.map((id) => ({
      code: 'missing-macro' as const,
      severity: 'warning' as const,
      id,
      message: `Batch macro ${id} is unavailable and will be skipped.`,
    })),
    ...actionSet.missingActionIds.map((id) => ({
      code: 'missing-quick-action' as const,
      severity: 'warning' as const,
      id,
      message: `Batch quick action ${id} is unavailable and will be skipped.`,
    })),
  ];
}

function buildImageBatchQueueAuditSummary(args: {
  requestedFiles: number;
  items: readonly ImageBatchPlanItem[];
  skipped: readonly ImageBatchSkippedFile[];
  unavailableCommandWarnings: readonly ImageBatchUnavailableCommandWarning[];
}): ImageBatchPlan['queueAuditSummary'] {
  const conflictDecisions: Record<ImageBatchPlanItemAudit['conflictDecision'], number> = {
    none: 0,
    renamed: 0,
    overwritten: 0,
    skipped: 0,
  };
  const skippedReasons: Partial<Record<ImageBatchSkippedReason, number>> = {};
  const outputFormats = new Set<ImageBatchResolvedOutputFormat>();

  for (const item of args.items) {
    conflictDecisions[item.audit.conflictDecision] += 1;
    outputFormats.add(item.outputFormat);
  }

  for (const skipped of args.skipped) {
    conflictDecisions[skipped.audit.conflictDecision] += 1;
    skippedReasons[skipped.reason] = (skippedReasons[skipped.reason] ?? 0) + 1;
  }

  return {
    requestedFiles: args.requestedFiles,
    plannedItems: args.items.length,
    skippedFiles: args.skipped.length,
    conflictDecisions,
    skippedReasons,
    unavailableCommandCount: args.unavailableCommandWarnings.length,
    outputFormats: [...outputFormats].sort((left, right) => left.localeCompare(right)),
  };
}

function buildImageBatchPlanPreview(args: {
  operations: readonly ImageBatchPlanOperation[];
  output: Required<ImageBatchOutputOptions>;
  items: readonly ImageBatchPlanItem[];
  skipped: readonly ImageBatchSkippedFile[];
  actionSet: ImageBatchActionSetValidationResult;
  unavailableCommandWarnings: readonly ImageBatchUnavailableCommandWarning[];
}): ImageBatchPlan['preview'] {
  const payload = {
    operations: args.operations,
    output: args.output,
    items: args.items.map((item) => ({
      fileId: item.fileId,
      inputPath: item.inputPath,
      outputPath: item.outputPath,
      outputFormat: item.outputFormat,
      conflictDecision: item.audit.conflictDecision,
    })),
    skipped: args.skipped.map((skipped) => ({
      fileId: skipped.fileId,
      inputPath: skipped.inputPath,
      reason: skipped.reason,
      conflictDecision: skipped.audit.conflictDecision,
    })),
    missing: {
      macroIds: args.actionSet.missingMacroIds,
      actionIds: args.actionSet.missingActionIds,
    },
  };

  return {
    id: `image-batch-preview:${args.items.length}-planned:${args.skipped.length}-skipped:${args.unavailableCommandWarnings.length}-unavailable`,
    signature: `image-batch-plan:v1:${JSON.stringify(payload)}`,
    sampleOutputPaths: args.items.slice(0, 3).map((item) => item.outputPath),
    auditLabel: `${args.items.length} planned / ${args.skipped.length} skipped / ${args.unavailableCommandWarnings.length} unavailable commands`,
  };
}

function buildImageBatchQueueIdentity(input: {
  files: readonly ImageBatchInputFileRecord[];
  actionSet: ImageBatchActionSetValidationResult;
  operations: readonly ImageBatchPlanOperation[];
}): ImageBatchQueueIdentity {
  const fileIds = input.files.map((file) => file.id);
  const operationIds = input.operations.map((operation) => operation.id);
  const unavailableCount = input.actionSet.missingMacroIds.length + input.actionSet.missingActionIds.length;
  const actionSetId = `image-batch-action-set:${[
    ...input.actionSet.requested.macroIds,
    ...input.actionSet.requested.actionIds,
  ].join(':') || 'empty'}`;
  const queueId = `image-batch-queue:${fileIds.join('+') || 'empty'}:${operationIds.join('+') || 'no-actions'}:${unavailableCount}-unavailable`;
  const signaturePayload = {
    fileIds,
    macroIds: input.actionSet.resolved.macroIds,
    actionIds: input.actionSet.resolved.actionIds,
    missingMacroIds: input.actionSet.missingMacroIds,
    missingActionIds: input.actionSet.missingActionIds,
    workspaceId: 'image-automation',
  };

  return {
    queueId,
    actionSetId,
    workspaceId: 'image-automation',
    signature: `image-batch-queue-identity:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildImageBatchQueueItemDiagnostics(input: {
  queueId: string;
  queueItemId: string;
  fileId: string;
  inputStatus: ImageBatchQueueItemDiagnostics['inputStatus'];
  dryRunStatus: ImageBatchQueueItemDiagnostics['dryRunStatus'];
  plannedOperationIds: readonly string[];
  unavailableCommandIds: readonly string[];
  outputPath?: string;
  skipReason?: ImageBatchSkippedReason;
}): ImageBatchQueueItemDiagnostics {
  const signaturePayload = {
    queueId: input.queueId,
    queueItemId: input.queueItemId,
    fileId: input.fileId,
    inputStatus: input.inputStatus,
    dryRunStatus: input.dryRunStatus,
    plannedOperationIds: input.plannedOperationIds,
    unavailableCommandIds: input.unavailableCommandIds,
    ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    ...(input.skipReason ? { skipReason: input.skipReason } : {}),
  };

  return {
    queueItemId: input.queueItemId,
    queueId: input.queueId,
    fileId: input.fileId,
    inputStatus: input.inputStatus,
    dryRunStatus: input.dryRunStatus,
    plannedOperationIds: [...input.plannedOperationIds],
    unavailableCommandIds: [...input.unavailableCommandIds],
    ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    ...(input.skipReason ? { skipReason: input.skipReason } : {}),
    signature: `image-batch-item-diagnostics:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function getCollisionPolicy(
  conflictStrategy: ImageBatchConflictStrategy,
): ImageBatchPlan['outputNamingPolicy']['collisionPolicy'] {
  if (conflictStrategy === 'overwrite') return 'overwrite-existing-output';
  if (conflictStrategy === 'skip') return 'skip-conflicting-output';
  return 'append-numeric-suffix';
}

function buildImageBatchOutputNamingPolicy(input: {
  output: Required<ImageBatchOutputOptions>;
  sampleCollisions: ImageBatchPlan['outputNamingPolicy']['sampleCollisions'];
}): ImageBatchPlan['outputNamingPolicy'] {
  const collisionPolicy = getCollisionPolicy(input.output.conflictStrategy);
  const decisions: Record<'renamed' | 'overwritten' | 'skipped', number> = {
    renamed: 0,
    overwritten: 0,
    skipped: 0,
  };

  for (const collision of input.sampleCollisions) {
    if (collision.decision === 'renamed' || collision.decision === 'overwritten' || collision.decision === 'skipped') {
      decisions[collision.decision] += 1;
    }
  }

  const collisionSignaturePayload = {
    conflictStrategy: input.output.conflictStrategy,
    collisions: input.sampleCollisions,
  };
  const signaturePayload = {
    folderPath: input.output.folderPath,
    filenamePattern: input.output.filenamePattern,
    format: input.output.format,
    preserveFolderStructure: input.output.preserveFolderStructure,
    conflictStrategy: input.output.conflictStrategy,
    collisionPolicy,
    sampleCollisions: input.sampleCollisions,
  };

  return {
    filenamePattern: input.output.filenamePattern,
    conflictStrategy: input.output.conflictStrategy,
    collisionPolicy,
    preservesFolderStructure: input.output.preserveFolderStructure,
    namingTokens: IMAGE_BATCH_NAMING_TOKENS,
    outputFolder: {
      path: input.output.folderPath,
      writeState: 'requires-user-confirmed-directory-handle',
      nativeWriteSupported: false,
    },
    sampleCollisions: input.sampleCollisions,
    collisionChecks: {
      collisionCount: input.sampleCollisions.length,
      decisions,
      signature: `image-batch-output-collisions:v1:${JSON.stringify(collisionSignaturePayload)}`,
    },
    signature: `image-batch-output-naming:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildImageBatchQueuePlanningDescriptor(input: {
  files: readonly ImageBatchInputFileRecord[];
  folders?: readonly ImageBatchInputFolderRecord[];
  items: readonly ImageBatchPlanItem[];
  skipped: readonly ImageBatchSkippedFile[];
  hasOutputFolder: boolean;
  hasExecutableActionSet: boolean;
  outputConflictCount: number;
  ready: boolean;
}): ImageBatchQueuePlanningDescriptor {
  const directFileIds = input.files.filter((file) => !file.folderId).map((file) => file.id);
  const folderFileCounts = new Map<string, number>();
  for (const file of input.files) {
    if (!file.folderId) continue;
    folderFileCounts.set(file.folderId, (folderFileCounts.get(file.folderId) ?? 0) + 1);
  }
  const folderQueues = (input.folders ?? []).map((folder) => ({
    id: folder.id,
    path: normalizePath(folder.path),
    label: folder.label,
    count: folderFileCounts.get(folder.id) ?? 0,
    readState: 'requires-user-confirmed-directory-handle' as const,
  }));
  const inputMode: ImageBatchQueuePlanningDescriptor['inputMode'] = folderQueues.length > 0
    ? directFileIds.length > 0 ? 'mixed-file-folder' : 'folder-queue'
    : 'file-list';
  const checks = {
    hasInputFiles: input.files.length > 0,
    hasOutputFolder: input.hasOutputFolder,
    hasExecutableActionSet: input.hasExecutableActionSet,
    unsupportedInputCount: input.skipped.filter((skipped) => skipped.reason === 'unsupported-extension').length,
    duplicateInputCount: input.skipped.filter((skipped) => skipped.reason === 'duplicate-path').length,
    outputConflictCount: input.outputConflictCount,
    ready: input.ready,
  };
  const signaturePayload = {
    workspaceId: 'image-automation',
    inputMode,
    directFileIds,
    folderQueues: folderQueues.map((folder) => ({
      id: folder.id,
      path: folder.path,
      count: folder.count,
    })),
    plannedFileIds: input.items.map((item) => item.fileId),
    skipped: input.skipped.map((skipped) => ({
      fileId: skipped.fileId,
      reason: skipped.reason,
    })),
    checks,
  };

  return {
    descriptorId: 'image-batch-queue-planning:v1',
    imageOnly: true,
    workspaceId: 'image-automation',
    separateFromMainFlow: true,
    inputMode,
    directFileQueue: {
      count: directFileIds.length,
      fileIds: directFileIds,
    },
    folderQueues,
    plannedFileIds: input.items.map((item) => item.fileId),
    skippedFileIds: input.skipped.map((skipped) => skipped.fileId),
    checks,
    signature: `image-batch-queue-planning:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildImageBatchDashboardSignatures(input: {
  queuePlanning: ImageBatchQueuePlanningDescriptor;
  outputNamingPolicy: ImageBatchPlan['outputNamingPolicy'];
  variableFillPlan: ImageBatchVariableFillPlanningDescriptor;
  nativeExecutionState: ImageBatchNativeExecutionState;
  preview: ImageBatchPlan['preview'];
}): ImageBatchDashboardSignatures {
  const checklistPayload = {
    queue: input.queuePlanning.signature,
    outputNaming: input.outputNamingPolicy.signature,
    variableFill: input.variableFillPlan.signature,
    nativeExecution: input.nativeExecutionState.signature,
  };

  return {
    queue: input.queuePlanning.signature,
    outputNaming: input.outputNamingPolicy.signature,
    variableFill: input.variableFillPlan.signature,
    nativeExecution: input.nativeExecutionState.signature,
    preview: input.preview.signature,
    checklist: `image-batch-dashboard:v1:${JSON.stringify(checklistPayload)}`,
  };
}

function formatCountWarning(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderOutputRelativePath(args: {
  file: ImageBatchInputFileRecord;
  normalizedInputPath: string;
  relativePath: string;
  operationLabel: string;
  outputExtension: string;
  output: Required<ImageBatchOutputOptions>;
  index: number;
}): string {
  const basename = getBasename(args.normalizedInputPath);
  const relativeDir = args.output.preserveFolderStructure ? getDirectory(args.relativePath) : '';
  const index = String(args.index).padStart(3, '0');
  const rendered = args.output.filenamePattern
    .replaceAll('{basename}', basename)
    .replaceAll('{ext}', args.outputExtension)
    .replaceAll('{index}', index)
    .replaceAll('{operation}', args.operationLabel)
    .replaceAll('{relativeDir}', relativeDir)
    .replaceAll('{fileId}', args.file.id);

  return normalizeRelativePath(rendered);
}

function appendCollisionSuffix(path: string, suffix: number): string {
  const normalizedPath = normalizePath(path);
  const slashIndex = normalizedPath.lastIndexOf('/');
  const directory = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : '';
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return `${directory}${fileName}-${suffix}`;
  }

  return `${directory}${fileName.slice(0, dotIndex)}-${suffix}${fileName.slice(dotIndex)}`;
}

function getSourceLabel(file: ImageBatchInputFileRecord, foldersById: Map<string, ImageBatchInputFolderRecord>): string {
  if (!file.folderId) return 'Direct files';
  const folder = foldersById.get(file.folderId);
  return folder?.label?.trim() || folder?.path || file.folderId;
}

export function buildImageBatchFileAccessDescriptor(input: {
  files: readonly ImageBatchInputFileRecord[];
  folders?: readonly ImageBatchInputFolderRecord[];
  output: Required<ImageBatchOutputOptions>;
}): ImageBatchFileAccessDescriptor {
  const folderFileCounts = new Map<string, number>();
  let directFileCount = 0;

  for (const file of input.files) {
    if (!file.folderId) {
      directFileCount += 1;
      continue;
    }
    folderFileCounts.set(file.folderId, (folderFileCounts.get(file.folderId) ?? 0) + 1);
  }

  const inputSources: ImageBatchFileAccessSourceDescriptor[] = [];
  if (directFileCount > 0) {
    inputSources.push({
      kind: 'direct-files',
      count: directFileCount,
      readState: 'queued-from-browser-or-native-picker',
      caveats: ['Direct file records are descriptor references; bytes are not read during planning.'],
    });
  }

  for (const folder of input.folders ?? []) {
    inputSources.push({
      kind: 'input-folder',
      count: folderFileCounts.get(folder.id) ?? 0,
      path: normalizePath(folder.path),
      label: folder.label,
      readState: 'requires-user-confirmed-directory-handle',
      caveats: [
        'Folder reads require a fresh user-approved directory handle in browser contexts.',
        'The dry-run planner normalizes paths and does not recursively inspect the filesystem.',
      ],
    });
  }

  return {
    capabilities: {
      directFileListInput: true,
      folderInput: true,
      folderOutput: true,
      perFileOutputDescriptors: true,
      writesDuringDryRun: false,
    },
    inputSources,
    outputTarget: {
      kind: 'output-folder',
      path: input.output.folderPath,
      writeState: 'requires-user-confirmed-directory-handle',
      overwritePolicy: input.output.conflictStrategy,
      caveats: [
        'Directory writes are unsupported in this dry-run plan until a browser File System Access or native save adapter is wired.',
        'The planner can name outputs but cannot create folders or replace files.',
      ],
    },
  };
}

function buildImageBatchVariableFillPlanningDescriptor(): ImageBatchVariableFillPlanningDescriptor {
  const algorithmicFill: ImageBatchVariableFillPlanningDescriptor['algorithmicFill'] = {
    supported: true,
    deterministic: true,
    sources: ['filename', 'metadata'],
    availableBindings: [
      { token: '{basename}', source: 'filename', target: 'output-naming' },
      { token: '{relativeDir}', source: 'filename', target: 'output-naming' },
      { token: '{index}', source: 'metadata', target: 'output-naming' },
      { token: '{fileId}', source: 'metadata', target: 'output-naming' },
    ],
    signature: 'image-batch-variable-fill-algorithmic:v1:{"sources":["filename","metadata"],"bindings":["{basename}","{relativeDir}","{index}","{fileId}"]}',
  };
  const aiFill: ImageBatchVariableFillPlanningDescriptor['aiFill'] = {
    state: 'planned-not-executed',
    providerCallsDuringPlanning: false,
    sources: ['ai-description'],
    reviewRequired: true,
    unsupportedExecutionReason: 'AI-assisted variable fills are metadata plans only until a reviewed runner is wired.',
    signature: 'image-batch-variable-fill-ai:v1:{"state":"planned-not-executed","providerCallsDuringPlanning":false,"sources":["ai-description"],"reviewRequired":true}',
  };
  const signaturePayload = {
    bindingReadiness: 'ready-for-explicit-review',
    algorithmicSources: algorithmicFill.sources,
    aiAssist: 'planned-not-executed',
    reviewRequired: true,
    arbitraryJs: false,
  };

  return {
    state: 'available-for-review',
    bindingReadiness: 'ready-for-explicit-review',
    aiAssist: 'planned-not-executed',
    requiredReview: true,
    fillSources: ['metadata', 'filename'],
    supportsOutputNamingBindings: true,
    supportsMacroPlaceholderBindings: true,
    supportsArbitraryJsExpressions: false,
    caveats: [
      'AI-assisted variable fills are planning descriptors only and do not call a provider.',
      'Variables must be reviewed before they can drive output naming or macro placeholders.',
    ],
    algorithmicFill,
    aiFill,
    signature: `image-batch-variable-fill:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildImageBatchActionMacroHandoffDescriptor(
  actionSet: ImageBatchActionSetValidationResult,
): ImageBatchActionMacroHandoffDescriptor {
  return {
    state: actionSet.resolved.macroIds.length + actionSet.resolved.actionIds.length > 0 ? 'ready' : 'blocked',
    automationSurface: {
      workspaceId: 'image-automation',
      surface: 'folder-list-batch',
      separateFromMainFlow: true,
    },
    macroIds: actionSet.resolved.macroIds,
    quickActionIds: actionSet.resolved.actionIds,
    skippedMacroIds: actionSet.missingMacroIds,
    skippedQuickActionIds: actionSet.missingActionIds,
    callableOperations: [
      ...actionSet.resolved.macroIds.map((id) => ({
        kind: 'macro' as const,
        id,
        source: 'saved-macro' as const,
        callable: true as const,
      })),
      ...actionSet.resolved.actionIds.map((id) => ({
        kind: 'quick-action' as const,
        id,
        source: 'suite-native-quick-action' as const,
        callable: true as const,
      })),
      ...actionSet.missingMacroIds.map((id) => ({
        kind: 'macro' as const,
        id,
        source: 'saved-macro' as const,
        callable: false as const,
        reason: 'missing-from-registry' as const,
      })),
      ...actionSet.missingActionIds.map((id) => ({
        kind: 'quick-action' as const,
        id,
        source: 'suite-native-quick-action' as const,
        callable: false as const,
        reason: 'missing-from-registry' as const,
      })),
    ],
    handoffPayloads: ['action-set-manifest', 'image-batch-items', 'output-naming-policy'],
    caveats: ['Macro and quick-action execution remains an Image Automation handoff, not a main Flow node execution.'],
  };
}

function buildImageBatchNativeExecutionState(): ImageBatchNativeExecutionState {
  const filesystemStates: ImageBatchNativeFilesystemState[] = [
    {
      operation: 'read-folder-queue',
      supported: false,
      state: 'requires-user-confirmed-directory-handle',
      canExecuteInDryRun: false,
      reason: 'Folder queue reads are represented by selected file records; the planner does not crawl native directories.',
    },
    {
      operation: 'write-output-folder',
      supported: false,
      state: 'unsupported-native-adapter-missing',
      canExecuteInDryRun: false,
      reason: 'Output folder writes require a future browser or native filesystem adapter.',
    },
    {
      operation: 'create-collision-safe-output',
      supported: false,
      state: 'planned-metadata-only',
      canExecuteInDryRun: false,
      reason: 'Collision-safe names are planned deterministically but files and directories are not created.',
    },
  ];
  const signaturePayload = {
    state: 'unsupported',
    unsupportedReasons: ['native-batch-runner-not-wired', 'directory-write-adapter-not-wired'],
    filesystemStates: filesystemStates.map((state) => `${state.operation}:${state.state}`),
  };

  return {
    state: 'unsupported',
    canRunNow: false,
    unsupportedReasons: ['native-batch-runner-not-wired', 'directory-write-adapter-not-wired'],
    nextSupportedState: 'preview-ready',
    unsupportedArbitraryJsState: {
      supported: false,
      reason: 'Only suite-native macro and quick-action ids are callable; arbitrary JavaScript state is unsupported.',
    },
    filesystemStates,
    signature: `image-batch-native-execution:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildImageBatchProgressEvidence(input: {
  items: readonly ImageBatchPlanItem[];
  skipped: readonly ImageBatchSkippedFile[];
  unavailableCommandWarnings: readonly ImageBatchUnavailableCommandWarning[];
}): ImageBatchProgressEvidence {
  return {
    state: 'planned',
    plannedCount: input.items.length,
    skippedCount: input.skipped.length,
    completedCount: 0,
    failedCount: 0,
    evidenceLevel: 'plan-only',
    auditSummary: `${input.items.length} planned / ${input.skipped.length} skipped / ${input.unavailableCommandWarnings.length} unavailable commands`,
    sampleOutputPaths: input.items.slice(0, 3).map((item) => item.outputPath),
    dryRunDiagnostics: {
      scope: 'multiple-documents',
      safe: true,
      canMutateDocuments: false,
      documentCount: input.items.length + input.skipped.length,
      plannedDocumentCount: input.items.length,
      skippedDocumentCount: input.skipped.length,
      sampleInputPaths: [...input.items.map((item) => item.inputPath), ...input.skipped.map((item) => item.inputPath)]
        .slice(0, 3),
    },
  };
}

function buildImageBatchExecutionLog(input: {
  queueIdentity: ImageBatchQueueIdentity;
  requestedFiles: readonly ImageBatchInputFileRecord[];
  items: readonly ImageBatchPlanItem[];
  skipped: readonly ImageBatchSkippedFile[];
  actionSet: ImageBatchActionSetValidationResult;
}): ImageBatchExecutionLog {
  const requestedFileIds = input.requestedFiles.map((file) => file.id);
  const missingOperations: ImageBatchPlanOperation[] = [
    ...input.actionSet.missingMacroIds.map((id) => ({ kind: 'macro' as const, id })),
    ...input.actionSet.missingActionIds.map((id) => ({ kind: 'quick-action' as const, id })),
  ];
  const entries: ImageBatchExecutionLogEntry[] = [];

  for (const item of input.items) {
    for (const operation of [
      ...input.actionSet.resolved.macroIds.map((id) => ({ kind: 'macro' as const, id })),
      ...input.actionSet.resolved.actionIds.map((id) => ({ kind: 'quick-action' as const, id })),
      ...missingOperations,
    ]) {
      const index = entries.length + 1;
      const status = missingOperations.some((missing) => missing.kind === operation.kind && missing.id === operation.id)
        ? 'unavailable'
        : 'dry-run';
      const actionLabel = operation.kind === 'quick-action' ? 'quick-action' : 'macro';
      entries.push({
        id: `image-batch-log:${String(index).padStart(3, '0')}:${item.fileId}:${operation.id}`,
        queueItemId: item.queueDiagnostics.queueItemId,
        fileId: item.fileId,
        operation,
        status,
        executed: false,
        message: status === 'unavailable'
          ? `Skipped unavailable ${actionLabel} ${operation.id} for ${item.inputPath}.`
          : `Planned ${actionLabel} ${operation.id} for ${item.inputPath}.`,
      });
    }
  }

  const runId = `image-batch-run:dry-run:${requestedFileIds.join('+') || 'empty'}:${input.items.length}-planned:${input.skipped.length}-skipped`;
  const signaturePayload = {
    runId,
    queueId: input.queueIdentity.queueId,
    entryIds: entries.map((entry) => entry.id),
    mode: 'dry-run',
    status: input.items.length > 0 ? 'planned' : 'blocked',
  };

  return {
    runId,
    queueId: input.queueIdentity.queueId,
    mode: 'dry-run',
    status: input.items.length > 0 ? 'planned' : 'blocked',
    stepCount: entries.length,
    entries,
    unsupportedExecution: {
      nativeFilesystemExecution: false,
      unattendedBackgroundExecution: false,
      arbitraryPluginCommands: false,
      fullPhotoshopActions: false,
    },
    signature: `image-batch-execution-log:v1:${JSON.stringify(signaturePayload)}`,
  };
}

export function buildImageBatchActionSetManifest(input: {
  macroIds?: readonly string[];
  actionIds?: readonly string[];
}): ImageBatchActionSetManifest {
  return {
    schemaVersion: IMAGE_BATCH_ACTION_SET_SCHEMA_VERSION,
    macroIds: dedupeOrderedValues(input.macroIds ?? []),
    actionIds: dedupeOrderedValues(input.actionIds ?? []),
  };
}

export function serializeImageBatchActionSetManifest(manifest: ImageBatchActionSetManifest): string {
  return JSON.stringify(buildImageBatchActionSetManifest(manifest));
}

export function parseImageBatchActionSetManifest(rawManifest: string): ImageBatchActionSetManifest | null {
  try {
    const parsed = JSON.parse(rawManifest);
    if (
      !parsed
      || typeof parsed !== 'object'
      || parsed.schemaVersion !== IMAGE_BATCH_ACTION_SET_SCHEMA_VERSION
      || !Array.isArray(parsed.macroIds)
      || !Array.isArray(parsed.actionIds)
    ) {
      return null;
    }
    return buildImageBatchActionSetManifest({
      macroIds: parsed.macroIds,
      actionIds: parsed.actionIds,
    });
  } catch {
    return null;
  }
}

export function validateImageBatchActionSetManifest(
  manifest: ImageBatchActionSetManifest,
  options?: {
    knownMacroIds?: readonly string[];
    knownActionIds?: readonly string[];
  },
): ImageBatchActionSetValidationResult {
  const requested = buildImageBatchActionSetManifest(manifest);
  const knownMacroIdSet = options?.knownMacroIds ? new Set(options.knownMacroIds) : null;
  const knownActionIdSet = options?.knownActionIds ? new Set(options.knownActionIds) : null;

  const resolvedMacroIds = knownMacroIdSet
    ? requested.macroIds.filter((id) => knownMacroIdSet.has(id))
    : requested.macroIds;

  const resolvedActionIds = knownActionIdSet
    ? requested.actionIds.filter((id) => knownActionIdSet.has(id))
    : requested.actionIds;

  return {
    requested,
    resolved: {
      schemaVersion: IMAGE_BATCH_ACTION_SET_SCHEMA_VERSION,
      macroIds: dedupeOrderedValues(resolvedMacroIds),
      actionIds: dedupeOrderedValues(resolvedActionIds),
    },
    missingMacroIds: knownMacroIdSet
      ? requested.macroIds.filter((id) => !knownMacroIdSet.has(id))
      : [],
    missingActionIds: knownActionIdSet
      ? requested.actionIds.filter((id) => !knownActionIdSet.has(id))
      : [],
  };
}

export function buildImageBatchPlan(input: BuildImageBatchPlanInput): ImageBatchPlan {
  const requested = buildImageBatchActionSetManifest({
    macroIds: input.macroIds ?? [],
    actionIds: input.actionIds ?? [],
  });
  const actionSet = validateImageBatchActionSetManifest(requested, {
    knownMacroIds: input.availableMacroIds,
    knownActionIds: input.availableActionIds,
  });
  const operations = buildOperations(actionSet.resolved.macroIds, actionSet.resolved.actionIds);
  const hasRequestedActionSet = requested.macroIds.length + requested.actionIds.length > 0;
  const hasExecutableActions = actionSet.resolved.macroIds.length + actionSet.resolved.actionIds.length > 0;
  const operationLabel = operations.map((operation) => operation.id).join('+') || 'no-actions-selected';
  const output: Required<ImageBatchOutputOptions> = {
    folderPath: normalizePath(input.output.folderPath),
    format: input.output.format ?? 'source',
    filenamePattern: input.output.filenamePattern ?? '{basename}-{operation}.{ext}',
    preserveFolderStructure: input.output.preserveFolderStructure ?? false,
    conflictStrategy: input.output.conflictStrategy ?? 'suffix',
  };
  const foldersById = new Map((input.folders ?? []).map((folder) => [folder.id, folder]));
  const seenInputPaths = new Set<string>();
  const usedOutputPaths = new Set<string>();
  const skipped: ImageBatchSkippedFile[] = [];
  const items: ImageBatchPlanItem[] = [];
  const auditLog: ImageBatchPlanItemAudit[] = [];
  const unavailableCommandWarnings = buildUnavailableCommandWarnings(actionSet);
  const unavailableCommandIds = [...actionSet.missingMacroIds, ...actionSet.missingActionIds];
  const queueIdentity = buildImageBatchQueueIdentity({
    files: input.files,
    actionSet,
    operations,
  });

  const resolveOutputPath = (
    desiredOutputPath: string,
  ): {
    decision: ImageBatchPlanItemAudit['conflictDecision'];
    requestedOutputPath: string;
    outputPath: string | null;
    detail: string;
  } => {
    const normalizedOutputPath = normalizePath(desiredOutputPath);

    if (!usedOutputPaths.has(normalizedOutputPath)) {
      usedOutputPaths.add(normalizedOutputPath);
      return {
        decision: 'none',
        requestedOutputPath: normalizedOutputPath,
        outputPath: normalizedOutputPath,
        detail: `Planned output path ${normalizedOutputPath} for the current file.`,
      };
    }

    if (output.conflictStrategy === 'overwrite') {
      usedOutputPaths.add(normalizedOutputPath);
      return {
        decision: 'overwritten',
        requestedOutputPath: normalizedOutputPath,
        outputPath: normalizedOutputPath,
        detail: `Planned output path ${normalizedOutputPath} with overwrite conflict strategy.`,
      };
    }

    if (output.conflictStrategy === 'skip') {
      return {
        decision: 'skipped',
        requestedOutputPath: normalizedOutputPath,
        outputPath: normalizedOutputPath,
        detail: `Planned output path ${normalizedOutputPath} already exists; conflict strategy is skip.`,
      };
    }

    let suffix = 2;
    let candidatePath = appendCollisionSuffix(normalizedOutputPath, suffix);
    while (usedOutputPaths.has(candidatePath)) {
      suffix += 1;
      candidatePath = appendCollisionSuffix(normalizedOutputPath, suffix);
    }
    usedOutputPaths.add(candidatePath);

    return {
      decision: 'renamed',
      requestedOutputPath: normalizedOutputPath,
      outputPath: candidatePath,
      detail: `Planned output path ${candidatePath} for the current file.`,
    };
  };

  for (const file of input.files) {
    const normalizedInputPath = normalizePath(file.path);
    const inputPathForPlan = normalizedInputPath;
    const inputExtension = getExtension(normalizedInputPath);

    const pushSkipped = (
      reason: ImageBatchSkippedReason,
      detail: string,
      auditOverrides: {
        status?: 'planned' | 'skipped';
        conflictDecision?: ImageBatchPlanItemAudit['conflictDecision'];
        requestedOutputPath?: string;
        outputPath?: string;
      } = {},
    ) => {
      const audit: ImageBatchPlanItemAudit = {
        fileId: file.id,
        inputPath: inputPathForPlan,
        status: auditOverrides.status ?? 'skipped',
        detail,
        outputConflictStrategy: output.conflictStrategy,
        conflictDecision: auditOverrides.conflictDecision ?? 'none',
        requestedOutputPath: auditOverrides.requestedOutputPath,
        outputPath: auditOverrides.outputPath,
        actionSet,
      };
      skipped.push({
        fileId: file.id,
        inputPath: inputPathForPlan,
        reason,
        detail,
        queueDiagnostics: buildImageBatchQueueItemDiagnostics({
          queueId: queueIdentity.queueId,
          queueItemId: `image-batch-item:${file.id}:skipped`,
          fileId: file.id,
          inputStatus: 'skipped',
          dryRunStatus: 'skipped-before-execution',
          plannedOperationIds: [],
          unavailableCommandIds,
          skipReason: reason,
        }),
        audit,
      });
      auditLog.push(audit);
    };

    if (!SUPPORTED_INPUT_EXTENSIONS.has(inputExtension)) {
      pushSkipped(
        'unsupported-extension',
        `${inputExtension.toUpperCase() || 'File'} is not supported by the dry-run batch planner.`,
      );
      continue;
    }

    if (seenInputPaths.has(inputPathForPlan)) {
      pushSkipped('duplicate-path', 'A file with this normalized path is already planned.');
      continue;
    }

    if (hasRequestedActionSet && !hasExecutableActions) {
      pushSkipped(
        'invalid-action-set',
        `No executable action-set entries remained after validation; referenced actions or macros were missing: ${
          [...actionSet.missingMacroIds, ...actionSet.missingActionIds].join(', ')
        }`,
      );
      continue;
    }

    seenInputPaths.add(inputPathForPlan);
    const relativePath = normalizeRelativePath(file.relativePath ?? getFileName(normalizedInputPath));
    const outputFormat = getOutputFormat(inputExtension, output.format);
    const outputRelativePath = renderOutputRelativePath({
      file,
      normalizedInputPath,
      relativePath,
      operationLabel,
      outputExtension: outputFormat,
      output,
      index: items.length + 1,
    });
    const fullOutputPath = joinPath(output.folderPath, outputRelativePath);
    const conflictResolution = resolveOutputPath(fullOutputPath);

    if (conflictResolution.outputPath == null || conflictResolution.decision === 'skipped') {
      const conflictDetail = conflictResolution.detail;
      pushSkipped('output-path-conflict', conflictDetail, {
        conflictDecision: 'skipped',
        requestedOutputPath: conflictResolution.requestedOutputPath,
        outputPath: conflictResolution.outputPath ?? undefined,
      });
      continue;
    }

    const itemOutputPath = conflictResolution.outputPath;
    const audit: ImageBatchPlanItemAudit = {
      fileId: file.id,
      inputPath: inputPathForPlan,
      status: 'planned',
      detail: conflictResolution.detail,
      outputConflictStrategy: output.conflictStrategy,
      conflictDecision: conflictResolution.decision,
      requestedOutputPath: conflictResolution.requestedOutputPath,
      outputPath: itemOutputPath,
      actionSet,
    };

    items.push({
      fileId: file.id,
      inputPath: inputPathForPlan,
      outputPath: itemOutputPath,
      sourceLabel: getSourceLabel(file, foldersById),
      relativePath,
      operationLabel,
      outputFormat,
      sizeBytes: file.sizeBytes,
      executionStatus: 'not-run',
      unavailableCommandWarnings,
      queueDiagnostics: buildImageBatchQueueItemDiagnostics({
        queueId: queueIdentity.queueId,
        queueItemId: `image-batch-item:${file.id}:${String(items.length + 1).padStart(3, '0')}`,
        fileId: file.id,
        inputStatus: 'accepted',
        dryRunStatus: 'planned-not-executed',
        plannedOperationIds: operations.map((operation) => operation.id),
        unavailableCommandIds,
        outputPath: itemOutputPath,
      }),
      audit,
    });
    auditLog.push(audit);
  }
  const queueAuditSummary = buildImageBatchQueueAuditSummary({
    requestedFiles: input.files.length,
    items,
    skipped,
    unavailableCommandWarnings,
  });
  const preview = buildImageBatchPlanPreview({
    operations,
    output,
    items,
    skipped,
    actionSet,
    unavailableCommandWarnings,
  });
  const sourceKinds: Array<'file' | 'folder'> = [
    'file',
    ...((input.folders?.length ?? 0) > 0 ? ['folder' as const] : []),
  ];
  const hasExecutableActionSet = operations.length > 0 || !hasRequestedActionSet;
  const outputFolderReady = output.folderPath.length > 0;
  const readinessBlockers = [
    ...(items.length === 0 ? ['No supported input files are planned.'] : []),
    ...(!outputFolderReady ? ['No output folder is configured.'] : []),
    ...(hasRequestedActionSet && operations.length === 0 ? ['No executable action-set entries are available.'] : []),
  ];
  const skippedWarning = formatCountWarning(
    skipped.length,
    'input file is skipped before execution.',
    'input files are skipped before execution.',
  );
  const unavailableWarning = formatCountWarning(
    unavailableCommandWarnings.length,
    'action-set entry is unavailable and will be skipped.',
    'action-set entries are unavailable and will be skipped.',
  );
  const queueWarnings = [skippedWarning, unavailableWarning].filter((warning): warning is string => Boolean(warning));
  const sampleCollisions = items
    .filter((item) => item.audit.conflictDecision !== 'none')
    .map((item) => ({
      requestedPath: item.audit.requestedOutputPath ?? item.outputPath,
      resolvedPath: item.outputPath,
      decision: item.audit.conflictDecision,
    }))
    .slice(0, 5);
  const outputConflictCount = auditLog.filter((audit) => audit.conflictDecision !== 'none').length;
  const outputNamingPolicy = buildImageBatchOutputNamingPolicy({
    output,
    sampleCollisions,
  });
  const queuePlanning = buildImageBatchQueuePlanningDescriptor({
    files: input.files,
    folders: input.folders,
    items,
    skipped,
    hasOutputFolder: outputFolderReady,
    hasExecutableActionSet,
    outputConflictCount,
    ready: readinessBlockers.length === 0,
  });
  const variableFillPlan = buildImageBatchVariableFillPlanningDescriptor();
  const nativeExecutionState = buildImageBatchNativeExecutionState();
  const dashboardSignatures = buildImageBatchDashboardSignatures({
    queuePlanning,
    outputNamingPolicy,
    variableFillPlan,
    nativeExecutionState,
    preview,
  });

  return {
    mode: 'dry-run',
    canExecuteUnattended: false,
    auditLogLevel: 'summary',
    nativeExecution: {
      supported: false,
      reason: 'Image batch plans are deterministic dry-run descriptors; native unattended execution is not wired.',
      requiredWorkspace: 'image-automation',
    },
    actionSet,
    queueIdentity,
    operations,
    output,
    items,
    skipped,
    auditLog,
    queueAuditSummary,
    queueReadiness: {
      ready: readinessBlockers.length === 0,
      sourceKinds,
      folderCount: input.folders?.length ?? 0,
      fileCount: input.files.length,
      plannedFileCount: items.length,
      skippedFileCount: skipped.length,
      outputFolderReady,
      hasExecutableActionSet,
      blockers: readinessBlockers,
      warnings: queueWarnings,
    },
    executionLogPolicy: {
      level: 'summary',
      maxEntries: 500,
      retention: 'current-session',
      includesSkippedItems: true,
      includesOutputConflicts: true,
    },
    executionLog: buildImageBatchExecutionLog({
      queueIdentity,
      requestedFiles: input.files,
      items,
      skipped,
      actionSet,
    }),
    retryPolicy: {
      maxAttempts: 1,
      retryableErrors: [],
      stopOnFirstError: false,
      recordsPerItemErrors: true,
      unsupportedReason: 'Retry execution is not available until native batch running is implemented.',
    },
    outputNamingPolicy,
    queuePlanning,
    workspaceHandoff: {
      workspaceId: 'image-automation',
      ready: readinessBlockers.length === 0,
      handoffKind: 'batch-plan-preview',
      requiredPayloads: ['input-file-queue', 'action-set-manifest', 'output-options'],
      blockers: readinessBlockers,
    },
    fileAccess: buildImageBatchFileAccessDescriptor({
      files: input.files,
      folders: input.folders,
      output,
    }),
    variableFillPlan,
    actionMacroHandoff: buildImageBatchActionMacroHandoffDescriptor(actionSet),
    nativeExecutionState,
    progressEvidence: buildImageBatchProgressEvidence({
      items,
      skipped,
      unavailableCommandWarnings,
    }),
    dashboardSignatures,
    preview,
    totals: {
      requestedFiles: input.files.length,
      plannedItems: items.length,
      skippedFiles: skipped.length,
      macroCount: actionSet.resolved.macroIds.length,
      quickActionCount: actionSet.resolved.actionIds.length,
    },
  };
}
