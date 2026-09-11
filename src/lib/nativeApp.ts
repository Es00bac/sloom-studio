import type { FlowProjectDocument } from './projectLibrary';
import type { PaperPdfExportRequest } from './paperPdfExport';
import type { PaperWebcomicImageFormat } from './paperWebcomicExport';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { WorkspaceWindowView } from './workspaceWindows';
import type { VertexImageRoute } from './vertexImageRequests';
import type { VertexVideoRoute } from './vertexVideoRequests';
import type { VertexNativeAuthConfig } from '../types/flow';
import type {
  ImportedMediaBatchNormalizationRequestItem,
  NormalizedImportedMediaBatchItem,
} from './flowImportWorker';
import type {
  SourceLibraryNativeChange,
  SourceLibraryNativeEvent,
  SourceLibraryNativeSnapshotResponse,
  SourceLibraryNativeSnapshotResult,
} from './sourceLibraryNativeSync';

export const NATIVE_RENDERER_COMMAND_EVENT = 'signal-loom:native-renderer-command';

export const NATIVE_MENU_COMMANDS = [
  'file:new',
  'file:open',
  'file:save',
  'file:save-as',
  'file:import-media',
  'file:set-scratch-folder',
  'file:export-project',
  'file:export-assets',
  'settings:keyboard-shortcuts',
  'settings:gamepad-bindings',
  'edit:undo',
  'edit:redo',
  'edit:cut',
  'edit:copy',
  'edit:paste',
  'edit:delete',
  'edit:select-all',
  'edit:deselect',
  'edit:invert-selection',
  'view:flow',
  'view:editor',
  'view:image',
  'view:paper',
  'view:toggle-source-bin',
  'view:toggle-inspector',
  'view:toggle-interface',
  'view:command-palette',
  'view:activity-trail',
  'view:layout-reset',
  'view:layout-balanced',
  'view:layout-focus',
  'view:layout-all-panels',
  'flow:add-source-bin',
  'image:tool-hand',
  'image:tool-text',
  'image:tool-move',
  'image:tool-marquee',
  'image:tool-lasso',
  'image:tool-magic-wand',
  'image:tool-brush',
  'image:tool-pen',
  'image:tool-eraser',
  'image:tool-background-eraser',
  'image:tool-magic-eraser',
  'image:tool-clone-stamp',
  'image:tool-spot-heal',
  'image:tool-blur-brush',
  'image:tool-sharpen-brush',
  'image:tool-smudge-brush',
  'image:tool-dodge-brush',
  'image:tool-burn-brush',
  'image:tool-sponge-saturate',
  'image:tool-sponge-desaturate',
  'image:tool-paint-bucket',
  'image:tool-gradient',
  'image:tool-rectangle-shape',
  'image:tool-ellipse-shape',
  'image:tool-crop',
  'image:tool-eyedropper',
  'image:export-visible',
  'image:export-psd',
  'image:file-new',
  'image:file-open',
  'image:file-save-as',
  'image:file-export-v1-compatibility',
  'image:adjust-brightness-contrast',
  'image:adjust-levels',
  'image:adjust-curves',
  'image:adjust-hue-saturation',
  'image:adjust-black-white',
  'image:adjust-exposure',
  'image:adjust-temperature-tint',
  'image:adjust-invert',
  'image:toggle-tools-panel',
  'image:toggle-brushes-panel',
  'image:toggle-layers-panel',
  'image:toggle-channels-panel',
  'image:toggle-paths-panel',
  'image:toggle-properties-panel',
  'image:toggle-history-panel',
  'image:toggle-assets-panel',
  'image:reset-panels',
  'timeline:select',
  'timeline:cut',
  'timeline:marquee',
  'timeline:ripple',
  'timeline:roll',
  'timeline:slip',
  'timeline:slide',
  'timeline:rate-stretch',
  'timeline:hand',
  'timeline:snap',
  'timeline:play-pause',
  'timeline:shuttle-reverse',
  'timeline:shuttle-stop',
  'timeline:shuttle-forward',
  'timeline:mark-in',
  'timeline:mark-out',
  'timeline:clear-in',
  'timeline:clear-out',
  'timeline:insert',
  'timeline:overwrite',
  'timeline:lift',
  'timeline:extract',
  'timeline:add-edit',
  'timeline:previous-edit',
  'timeline:next-edit',
  'timeline:track-select-forward',
  'timeline:track-select-backward',
  'timeline:zoom-selection',
  'timeline:zoom-in-out',
  'timeline:zoom-playhead',
  'timeline:previous-zoom',
  'timeline:trim-nudge-back',
  'timeline:trim-nudge-forward',
  'timeline:trim-commit',
  'timeline:trim-cancel',
  'timeline:add-marker',
  'timeline:previous-marker',
  'timeline:next-marker',
  'timeline:link',
  'timeline:unlink',
  'timeline:group',
  'timeline:ungroup',
  'timeline:add-keyframe',
  'timeline:previous-keyframe',
  'timeline:next-keyframe',
  'paper:tool-select',
  'paper:tool-hand',
  'paper:tool-text',
  'paper:tool-image',
  'paper:tool-eyedropper',
  'paper:new-document',
  'paper:add-page',
  'paper:file-open',
  'paper:file-save',
  'paper:file-save-as',
  'paper:export-pdf',
  'paper:export-accessible-pdf',
  'paper:export-epub',
  'paper:export-kdp-assets',
  'paper:export-kdp-pdf',
  'paper:export-reader-spreads-pdf',
  'paper:export-booklet-proof-pdf',
  'paper:export-webcomic-images',
  'paper:export-html',
  'paper:export-reader-spreads-html',
  'paper:export-booklet-proof-html',
  'paper:package-print',
  'paper:export-idml',
  'paper:soft-proof',
  'paper:export-stories-txt',
  'paper:export-stories-html',
  'paper:export-stories-rtf',
  'paper:export-stories-docx',
  'paper:export-cbz',
  'paper:export-json',
  'paper:import-json',
  'paper:add-text-frame',
  'paper:add-image-frame',
  'paper:add-speech-bubble',
  'paper:add-thought-bubble',
  'paper:add-caption',
  'paper:toggle-rulers',
  'paper:toggle-guides',
  'paper:toggle-grid',
  'paper:toggle-snap-to-guides',
  'paper:toggle-snap-to-grid',
  'paper:toggle-spreads',
  'paper:toggle-start-on-right',
  'paper:toggle-binding-direction',
  'paper:toggle-tools-panel',
  'paper:toggle-document-strip-panel',
  'paper:toggle-inspector-panel',
  'paper:toggle-preflight-panel',
  'paper:toggle-linked-assets-panel',
  'paper:toggle-dtp-parity-panel',
  'paper:reset-panels',
  'editor:toggle-source-bin-panel',
  'editor:toggle-source-monitor-panel',
  'editor:toggle-program-monitor-panel',
  'editor:toggle-inspector-panel',
  'editor:toggle-timeline-panel',
  'editor:toggle-premiere-parity-panel',
  'editor:toggle-sequence-settings-panel',
  'editor:toggle-export-preset-panel',
  'editor:toggle-diagnostics-panel',
  'editor:reset-panels',
  'help:project-documentation',
  'help:tutorial',
  'help:feature-help',
  'help:keyboard-shortcuts',
  'help:about',
] as const;

export type NativeMenuCommand = typeof NATIVE_MENU_COMMANDS[number];
export type NativeWorkspaceStandaloneEntryMode = 'shared-binary-window';
export type NativeWorkspaceStandaloneEntryStatus = 'ready';
export type NativeWorkspacePackageTarget = 'macos' | 'windows' | 'linux';
export type NativeWorkspaceSuiteHandoffMode = 'shared-binary-deep-link';

export interface NativeWorkspaceStandaloneEntryPoint {
  workspace: WorkspaceWindowView;
  command: Extract<NativeMenuCommand, 'view:flow' | 'view:editor' | 'view:image' | 'view:paper'>;
  entryPoint: `signal-loom://workspace/${WorkspaceWindowView}`;
  mode: NativeWorkspaceStandaloneEntryMode;
}

export interface NativeWorkspaceStandaloneEntryReadiness extends NativeWorkspaceStandaloneEntryPoint {
  status: NativeWorkspaceStandaloneEntryStatus;
  unsupportedStandaloneExecutable: true;
  suiteHandoffMode: NativeWorkspaceSuiteHandoffMode;
  packageTargets: readonly NativeWorkspacePackageTarget[];
  packageCaveats: string[];
  caveat: string;
  signature: string;
}

export const NATIVE_WORKSPACE_STANDALONE_ENTRY_POINTS: readonly NativeWorkspaceStandaloneEntryPoint[] = [
  {
    workspace: 'flow',
    command: 'view:flow',
    entryPoint: 'signal-loom://workspace/flow',
    mode: 'shared-binary-window',
  },
  {
    workspace: 'editor',
    command: 'view:editor',
    entryPoint: 'signal-loom://workspace/editor',
    mode: 'shared-binary-window',
  },
  {
    workspace: 'image',
    command: 'view:image',
    entryPoint: 'signal-loom://workspace/image',
    mode: 'shared-binary-window',
  },
  {
    workspace: 'paper',
    command: 'view:paper',
    entryPoint: 'signal-loom://workspace/paper',
    mode: 'shared-binary-window',
  },
] as const;

export function buildNativeStandaloneEntryReadiness(
  workspace: WorkspaceWindowView,
): NativeWorkspaceStandaloneEntryReadiness {
  const entry = NATIVE_WORKSPACE_STANDALONE_ENTRY_POINTS.find((candidate) => candidate.workspace === workspace);
  if (!entry) {
    throw new Error(`Unknown native standalone workspace entry: ${workspace}`);
  }

  return {
    ...entry,
    status: 'ready',
    unsupportedStandaloneExecutable: true,
    suiteHandoffMode: 'shared-binary-deep-link',
    packageTargets: ['macos', 'windows', 'linux'],
    packageCaveats: [
      'Standalone Image handoff stays inside the shared Sloom Studio desktop package; separate signed single-workspace executables are not produced.',
    ],
    caveat: 'Standalone workspace entry uses the shared Sloom Studio desktop binary and focused workspace windows; separate signed executables are not packaged.',
    signature: [
      'native-standalone-entry:v2',
      entry.workspace,
      entry.command,
      entry.entryPoint,
      entry.mode,
      'suite-handoff=shared-binary-deep-link',
      'targets=macos,windows,linux',
      'separate-exe=false',
    ].join('|'),
  };
}

export interface NativeState {
  currentProjectPath?: string;
  currentScratchDirectoryPath?: string;
  startupProject?: NativeProjectFileResult;
  startupProjectRecovery?: NativeStartupProjectRecovery;
  /** Opt-in only: a normal desktop launch starts with a blank project. */
  reopenLastProjectOnStartup?: boolean;
  /** Electron-process-owned interface language adopted by every desktop renderer (FBL-033). */
  interfaceLocale?: NativeInterfaceLocaleState;
  workspace?: WorkspaceWindowView;
  platform: string;
  isDev: boolean;
  /** Authoritative project identity/version this window must adopt before it may save (AUD-001). */
  projectAuthority?: NativeProjectAuthorityDescriptor;
  /** This window's own webContents id, used to ignore self-initiated authority broadcasts. */
  webContentsId?: number;
}

export interface NativeInterfaceLocaleState {
  owner: 'electron-main';
  locale: 'en' | 'ja';
  localeChosen: boolean;
  revision: number;
}

export interface NativeInterfaceLocaleUpdateRequest {
  locale: NativeInterfaceLocaleState['locale'];
  localeChosen: boolean;
  expectedRevision: number;
}

export interface NativeInterfaceLocaleUpdateResult {
  ok: boolean;
  changed: boolean;
  rejected?: 'invalid-request' | 'stale-revision';
  current: NativeInterfaceLocaleState;
}

export type NativeStartupProjectFailureCode =
  | 'missing'
  | 'unreadable'
  | 'corrupt'
  | 'invalid-project'
  | 'preparation-failed';

export interface NativeStartupProjectBackup {
  filePath: string;
  modifiedAtMs: number;
}

export interface NativeStartupProjectRecovery {
  /** Persisted original path; failures and Continue Blank never remove it. */
  filePath: string;
  failure: {
    code: NativeStartupProjectFailureCode;
    message: string;
  };
  backups: NativeStartupProjectBackup[];
}

/**
 * Immutable native project identity plus its monotonic content version. A fresh identity is
 * minted for every open/switch/Save As/path binding; the version advances only on accepted
 * saves. A save is authorized only when the sending renderer holds — and has confirmed
 * adopting — the current descriptor, so a display path alone never grants write access.
 */
export interface NativeProjectAuthorityDescriptor {
  authorityId: string;
  version: number;
  filePath?: string;
}

// Project-affecting side channels (Source Library and BroadcastChannel workspace commands)
// obtain the claim from this renderer-local holder. App updates it only after adoption; stores
// therefore cannot accidentally mint authority from a displayed file path.
let currentProjectAuthorityClaim: NativeProjectAuthorityDescriptor | undefined;
let currentProjectAuthorityEpoch = 0;
let projectAuthorityTransitionDepth = 0;

export function setCurrentProjectAuthorityClaim(claim: NativeProjectAuthorityDescriptor | undefined): void {
  currentProjectAuthorityClaim = claim ? { ...claim } : undefined;
  currentProjectAuthorityEpoch += 1;
}

export function getCurrentProjectAuthorityClaim(): NativeProjectAuthorityDescriptor | undefined {
  return projectAuthorityTransitionDepth === 0 && currentProjectAuthorityClaim
    ? { ...currentProjectAuthorityClaim }
    : undefined;
}

export interface ProjectAuthorityMutationScope {
  claim: NativeProjectAuthorityDescriptor;
  epoch: number;
}

/**
 * Renderer-local authority epoch captured around delayed startup work. Unlike a mutation scope,
 * this intentionally represents the initial no-claim state too: any Open/New/Save/adoption or
 * authority transition advances the epoch and invalidates the delayed startup response.
 */
export interface ProjectAuthorityStateScope {
  claim?: NativeProjectAuthorityDescriptor;
  epoch: number;
}

export function captureProjectAuthorityStateScope(): ProjectAuthorityStateScope {
  return {
    claim: currentProjectAuthorityClaim ? { ...currentProjectAuthorityClaim } : undefined,
    epoch: currentProjectAuthorityEpoch,
  };
}

export function isCurrentProjectAuthorityStateScope(scope: ProjectAuthorityStateScope): boolean {
  return scope.epoch === currentProjectAuthorityEpoch
    && scope.claim?.authorityId === currentProjectAuthorityClaim?.authorityId
    && scope.claim?.version === currentProjectAuthorityClaim?.version;
}

export function captureProjectAuthorityMutationScope(): ProjectAuthorityMutationScope | undefined {
  const claim = getCurrentProjectAuthorityClaim();
  return claim ? { claim, epoch: currentProjectAuthorityEpoch } : undefined;
}

export function isCurrentProjectAuthorityMutationScope(scope: ProjectAuthorityMutationScope | undefined): boolean {
  const claim = getCurrentProjectAuthorityClaim();
  return Boolean(
    scope
    && claim
    && scope.epoch === currentProjectAuthorityEpoch
    && scope.claim.authorityId === claim.authorityId
    && scope.claim.version === claim.version,
  );
}

export function beginProjectAuthorityTransition(): () => void {
  projectAuthorityTransitionDepth += 1;
  currentProjectAuthorityEpoch += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    projectAuthorityTransitionDepth = Math.max(0, projectAuthorityTransitionDepth - 1);
    currentProjectAuthorityEpoch += 1;
  };
}

export type NativeProjectSaveRejectionCode =
  /** The renderer never adopted any project authority (fresh/reloaded window mid-boot). */
  | 'unopened'
  /** The renderer's claim references an identity that is no longer the current project. */
  | 'switched'
  /** Right identity, but another window already saved a newer version. */
  | 'stale'
  /** The claim looks current but this renderer never confirmed adopting it. */
  | 'unauthorized'
  /** Staged target/startup publication could not commit and was rolled back. */
  | 'commit-failed'
  /** Candidate disk/renderer preparation failed while the prior authority remained current. */
  | 'prepare-failed'
  /** A prepared Open/New token was replayed, stale, or belonged to another renderer epoch. */
  | 'invalid-transaction'
  /** The renderer was destroyed/reloaded before the closed commit began. */
  | 'sender-gone';

export interface NativeProjectSaveRejection {
  code: NativeProjectSaveRejectionCode;
  message: string;
  current: NativeProjectAuthorityDescriptor;
}

export interface NativeProjectFileResult {
  canceled: boolean;
  filePath?: string;
  scratchDirectoryPath?: string;
  document?: FlowProjectDocument;
  /** Exact native Source version published with this committed project result. */
  sourceLibraryVersion?: number;
  /** The authority descriptor after a successful open/save commit. */
  authority?: NativeProjectAuthorityDescriptor;
  /** Present when the main process refused the save; nothing was written or advanced. */
  rejected?: NativeProjectSaveRejection;
}

export interface NativePreparedProjectSwitchResult extends NativeProjectFileResult {
  transactionId?: string;
  kind?: 'open' | 'clear';
  baseAuthority?: NativeProjectAuthorityDescriptor;
  /** Refreshed typed failure returned when a startup Retry/backup preparation still fails. */
  startupProjectRecovery?: NativeStartupProjectRecovery;
}

export interface NativeProjectSavePayload {
  document: FlowProjectDocument;
  claim?: NativeProjectAuthorityDescriptor;
}

export type NativeProjectAuthorityChangeReason = 'open' | 'save' | 'save-as' | 'clear';

export interface NativeProjectAuthorityChangedEvent {
  authority: NativeProjectAuthorityDescriptor;
  reason: NativeProjectAuthorityChangeReason;
  initiatorWebContentsId?: number;
}

export interface NativeProjectAdoptResult {
  authority: NativeProjectAuthorityDescriptor;
  filePath?: string;
  scratchDirectoryPath?: string;
  /** Canonical snapshot to hydrate; absent for a blank (unsaved) project. */
  document?: FlowProjectDocument;
}

export interface NativeProjectAdoptionConfirmation {
  ok: boolean;
  stale?: boolean;
  current?: NativeProjectAuthorityDescriptor;
}

export interface NativeScratchDirectoryResult {
  canceled: boolean;
  directoryPath?: string;
  error?: string;
  rejected?: NativeProjectSaveRejection;
}

export interface NativeImageOpenResult {
  canceled: boolean;
  bytes?: Uint8Array;
  path?: string;
}

export interface NativeImageSaveResult {
  canceled: boolean;
  path?: string;
}

export interface NativePaperOpenResult {
  canceled: boolean;
  bytes?: Uint8Array;
  path?: string;
}

/** One main-owned external-open intent offered to the designated renderer epoch. */
export interface NativeExternalOpenProjectIntent {
  id: string;
  kind: 'project';
  filePath: string;
  /** Prepared without changing canonical main-process project state. */
  result?: NativeProjectFileResult;
  error?: string;
}

export interface NativeExternalOpenPaperIntent {
  id: string;
  kind: 'paper';
  filePath: string;
  bytes?: Uint8Array;
  error?: string;
}

export type NativeExternalOpenIntent = NativeExternalOpenProjectIntent | NativeExternalOpenPaperIntent;

export interface NativeExternalOpenAuthorizationResult {
  authorized: boolean;
  epoch?: string;
  reason?: string;
}

export interface NativeExternalOpenNextResult {
  status: 'offered' | 'empty' | 'unauthorized';
  intent?: NativeExternalOpenIntent;
  state?: 'offered' | 'accepted';
}

export interface NativeExternalOpenTransitionRequest {
  epoch: string;
  intentId: string;
  reason?: string;
}

export interface NativeExternalOpenTransitionResult {
  status: 'accepted' | 'rejected' | 'committed' | 'revoked' | 'unauthorized' | 'not-found' | 'invalid-state' | 'error';
  error?: string;
  authority?: NativeProjectAuthorityDescriptor;
  filePath?: string;
  scratchDirectoryPath?: string;
}

export interface NativePaperSaveResult {
  canceled: boolean;
  path?: string;
}

export interface NativePaperPdfExportResult {
  canceled: boolean;
  filePath?: string;
  bytes?: number;
  error?: string;
}

export interface NativePaperPdfDestinationResult {
  canceled: boolean;
  filePath?: string;
  error?: string;
}

export type NativePaperPdfExportRequest = PaperPdfExportRequest & {
  /** Absolute path approved by the chooser-only IPC before renderer rasterization. */
  filePath?: string;
};

export interface NativePaperPdfBytesSaveRequest {
  title: string;
  fileName: string;
  bytes: Uint8Array;
  /** Absolute path supplied only by the opt-in native automation harness. */
  filePath?: string;
}

export interface NativePaperEpubExportResult {
  canceled: boolean;
  filePath?: string;
  bytes?: number;
  error?: string;
}

export interface NativePaperEpubBytesSaveRequest {
  title: string;
  fileName: string;
  bytes: Uint8Array;
  /** Absolute path supplied only by the opt-in native automation harness. */
  filePath?: string;
}

export interface NativePaperImageExportPage {
  pageId: string;
  pageNumber: number;
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg';
  dataUrl: string;
  widthPx?: number;
  heightPx?: number;
}

export interface NativePaperImageExportRequest {
  title: string;
  directoryName: string;
  format: PaperWebcomicImageFormat;
  mimeType: 'image/png' | 'image/jpeg';
  quality?: number;
  pages: NativePaperImageExportPage[];
  /** Absolute directory approved by the chooser-only IPC before renderer rasterization. */
  directoryPath?: string;
}

export interface NativePaperImageDestinationResult {
  canceled: boolean;
  directoryPath?: string;
  error?: string;
}

export interface NativePaperImageExportResult {
  canceled: boolean;
  directoryPath?: string;
  files?: Array<{
    fileName: string;
    filePath: string;
    pageNumber: number;
    bytes: number;
  }>;
  bytes?: number;
  error?: string;
}

export interface NativeVertexImageRequest {
  cancellationId?: string;
  projectId: string;
  location: string;
  modelId: string;
  route: VertexImageRoute;
  auth?: VertexNativeAuthConfig;
  body: Record<string, unknown>;
}

export interface NativeVertexImageResult {
  result?: string;
  resultType?: 'image';
  statusMessage?: string;
  mimeType?: string;
  error?: string;
}

export interface NativeVertexTextRequest {
  cancellationId?: string;
  projectId: string;
  location: string;
  modelId: string;
  auth?: VertexNativeAuthConfig;
  body: Record<string, unknown>;
}

export interface NativeVertexTextResult {
  text?: string;
  statusMessage?: string;
  error?: string;
}

export interface NativeVertexVideoRequest {
  cancellationId?: string;
  projectId: string;
  location: string;
  modelId: string;
  route: VertexVideoRoute;
  apiVersion?: 'v1' | 'v1beta1' | 'v1alpha';
  auth?: VertexNativeAuthConfig;
  body: Record<string, unknown>;
}

export interface NativeVertexVideoResult {
  result?: string;
  resultType?: 'video';
  statusMessage?: string;
  mimeType?: string;
  error?: string;
}

export interface NativeVertexAuthRequest {
  auth?: VertexNativeAuthConfig;
}

export interface NativeVertexLoginResult {
  ok: boolean;
  account?: string;
  projectId?: string;
  error?: string;
}

export interface NativeVertexDetectResult {
  ok: boolean;
  hasToken: boolean;
  account?: string;
  projectId?: string;
  quotaProjectId?: string;
  source?: 'imported-json' | 'adc-file' | 'application-default' | 'gcloud';
  error?: string;
}

export interface NativeVertexProjectsResult {
  ok: boolean;
  projects: Array<{ projectId: string; name: string }>;
  error?: string;
}

export interface NativeMaterializeSourceAssetRequest {
  claim: NativeProjectAuthorityDescriptor;
  id?: string;
  label: string;
  kind: Exclude<SourceBinLibraryItem['kind'], 'text'>;
  mimeType: string;
  dataUrl: string;
  binaryData?: Uint8Array;
  /** Existing desktop file produced by native FFmpeg; main copies/registers it without renderer bytes. */
  nativeFilePath?: string;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt?: number;
  sourceKey?: string;
  originNodeId?: string;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  professional?: SourceBinLibraryItem['professional'];
}

export interface NativeMaterializeSourceAssetResult {
  item?: SourceBinLibraryItem;
  error?: string;
}

export type NativeImportedMediaItem = SourceBinLibraryItem & {
  nativeFilePath?: string;
};

export interface NativeImportMediaResult {
  canceled: boolean;
  items: NativeImportedMediaItem[];
  error?: string;
  rejected?: NativeProjectSaveRejection;
}

export interface NativeVideoMediaRelinkResult {
  ok?: boolean;
  canceled: boolean;
  item?: SourceBinLibraryItem;
  version?: number;
  error?: string;
  rejected?: NativeProjectSaveRejection;
}

export interface NativeVideoMediaConsolidationResult {
  ok?: boolean;
  canceled: boolean;
  items?: SourceBinLibraryItem[];
  targetDirectory?: string;
  version?: number;
  error?: string;
  rejected?: NativeProjectSaveRejection;
}

export interface NativeVideoMediaAvailabilityResult {
  ok?: boolean;
  items?: Array<{ itemId: string; available: boolean }>;
  authority?: NativeProjectAuthorityDescriptor;
  error?: string;
  rejected?: NativeProjectSaveRejection;
}

export interface NativeWindowCaptureResult {
  canceled: boolean;
  mimeType?: 'image/png';
  base64?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface LocalUpscalerStatus {
  installed: boolean;
  running: boolean;
  /** Managed desktop runtime identity. The persisted local-ai-cpu key is legacy compatibility only. */
  backend?: 'realesrgan-ncnn-vulkan';
  accelerator?: 'vulkan';
  requiresVulkan?: true;
  cpuFallback?: false;
  endpointUrl?: string;
  authHeader?: string;
  error?: string;
}

export interface NativeCrashReportState {
  enabled: boolean;
  reports: import('./crashReports').CrashReportRecord[];
  nativeReporterStarted: boolean;
  crashDumpsPath?: string;
  pendingMinidumpCount: number;
}

export interface NativeCrashReportSetEnabledResult {
  enabled: boolean;
  persistResult: { ok: boolean; error?: string };
}

export interface NativeCrashReportClearResult {
  ok: boolean;
  persistError?: string;
  minidumpsRemoved: number;
  minidumpError?: string;
}

export interface NativeCrashReportRecordResult {
  recorded: boolean;
  reason?: string;
  report?: import('./crashReports').CrashReportRecord;
}

export interface NativeBundledFontLibraryStatus {
  /** True only when the main process resolved a real, validated font-library root on disk. */
  available: boolean;
}

export type NativeCliAgentId = 'codex' | 'claude' | 'kimi';
export type NativeCliAgentPurpose = 'writing-assistant' | 'assisted-layout' | 'live-layout-agent';

export interface NativeCliAgentCapability {
  id: NativeCliAgentId;
  label: string;
  available: boolean;
}

export interface NativeCliAgentCapabilitiesResult {
  agents: NativeCliAgentCapability[];
  maxConcurrentRuns: number;
}

export interface NativeCliAgentRunRequest {
  requestId: string;
  agent: NativeCliAgentId;
  purpose: NativeCliAgentPurpose;
  systemPrompt: string;
  userPrompt: string;
  modelId?: string;
}

export interface NativeCliAgentRunResult {
  ok: boolean;
  requestId?: string;
  agent?: NativeCliAgentId;
  text?: string;
  cancelled?: boolean;
  code?: string;
  error?: string;
}

export interface SignalLoomNativeBridge {
  /** False on native Wayland, where popup windows cannot be positioned during a panel drag. */
  readonly supportsExternalFloatingPanelWindows?: boolean;
  getNativeState: () => Promise<NativeState>;
  setReopenLastProjectOnStartup?: (
    enabled: boolean,
  ) => Promise<{ reopenLastProjectOnStartup: boolean }>;
  retryStartupProject?: (
    request: { claim?: NativeProjectAuthorityDescriptor },
  ) => Promise<NativePreparedProjectSwitchResult>;
  recoverStartupProjectBackup?: (
    request: { filePath: string; claim?: NativeProjectAuthorityDescriptor },
  ) => Promise<NativePreparedProjectSwitchResult>;
  dismissStartupProjectRecovery?: () => Promise<{ ok: boolean }>;
  /**
   * Dedicated signal-loom-font:// transport capability (FBL-025). A complete bridge is installed
   * even when the main process found no bundled-font-library root, in which case every
   * signal-loom-font request 404s — callers must query this, not infer availability from the
   * presence of other bridge methods.
   */
  bundledFontLibraryStatus?: () => Promise<NativeBundledFontLibraryStatus>;
  clearProjectPath: (request: { claim?: NativeProjectAuthorityDescriptor }) => Promise<NativePreparedProjectSwitchResult>;
  openProjectFile: (request: { claim?: NativeProjectAuthorityDescriptor }) => Promise<NativePreparedProjectSwitchResult>;
  requestProjectOpen?: () => Promise<NativeProjectFileResult & { queued?: boolean; error?: string }>;
  commitProjectSwitch: (request: { transactionId: string }) => Promise<NativeProjectFileResult & { ok?: boolean }>;
  cancelProjectSwitch: (request: { transactionId: string }) => Promise<{ ok?: boolean }>;
  saveProjectFile: (payload: NativeProjectSavePayload) => Promise<NativeProjectFileResult>;
  saveProjectFileAs: (payload: NativeProjectSavePayload) => Promise<NativeProjectFileResult>;
  /** Pull the canonical current-project snapshot for adoption after an authority change (AUD-001). */
  adoptProject?: () => Promise<NativeProjectAdoptResult>;
  /** Confirm this window hydrated the claimed authority; required before its saves authorize. */
  confirmProjectAdoption?: (claim: NativeProjectAuthorityDescriptor) => Promise<NativeProjectAdoptionConfirmation>;
  openImageDocumentFile: () => Promise<NativeImageOpenResult>;
  saveImageDocumentFileAs: (bytes: Uint8Array) => Promise<NativeImageSaveResult>;
  /** Re-read a .slimg by a known path (no dialog) — used by the .slimg Flow node's "Read disk". */
  readImageDocumentFile?: (path: string) => Promise<{ bytes?: Uint8Array; error?: string }>;
  /** One-click local AI upscaler runtime (Real-ESRGAN) managed by the main process. */
  localUpscalerStatus?: () => Promise<LocalUpscalerStatus>;
  localUpscalerInstall?: () => Promise<LocalUpscalerStatus>;
  localUpscalerStart?: () => Promise<LocalUpscalerStatus>;
  localUpscalerStop?: () => Promise<LocalUpscalerStatus>;
  /**
   * Opt-in local crash reporting (MH-014). The main process keeps a bounded, redacted,
   * file-backed queue under userData and never transmits anything. Mirrored renderer
   * reports are re-sanitized main-side before they enter that queue.
   */
  crashReportState?: () => Promise<NativeCrashReportState | undefined>;
  crashReportSetEnabled?: (enabled: boolean) => Promise<NativeCrashReportSetEnabledResult | undefined>;
  crashReportClear?: () => Promise<NativeCrashReportClearResult | undefined>;
  crashReportRecord?: (report: unknown) => Promise<NativeCrashReportRecordResult | undefined>;
  /** Overwrite a .slimg at a known path (no dialog) — the linked-edit round-trip's save. */
  writeImageDocumentFile?: (path: string, bytes: Uint8Array) => Promise<{ ok?: boolean; error?: string }>;
  openPaperDocumentFile: () => Promise<NativePaperOpenResult>;
  savePaperDocumentFileAs: (bytes: Uint8Array) => Promise<NativePaperSaveResult>;
  /** Overwrite an acknowledged standalone .slppr path without another chooser. */
  writePaperDocumentFile?: (path: string, bytes: Uint8Array) => Promise<{ ok?: boolean; path?: string; error?: string }>;
  importMediaFiles: (options: {
    scratchDirectoryPath?: string;
    claim?: NativeProjectAuthorityDescriptor;
    kinds?: Array<'image' | 'video' | 'audio' | 'subtitle'>;
    /** Linked media remains at its selected path instead of being duplicated into project scratch. */
    mediaHandling?: 'copy-to-scratch' | 'link';
  }) => Promise<NativeImportMediaResult>;
  /** Relink one saved Video media identity through a main-owned file chooser and authority commit. */
  relinkVideoMedia?: (request: {
    itemId: string;
    claim: NativeProjectAuthorityDescriptor;
  }) => Promise<NativeVideoMediaRelinkResult>;
  /** Copy exact registered originals into a chosen folder, then atomically retarget their identities. */
  consolidateVideoMedia?: (request: {
    itemIds: string[];
    claim: NativeProjectAuthorityDescriptor;
  }) => Promise<NativeVideoMediaConsolidationResult>;
  /** Main-owned capability truth for persisted Video media; paths never cross this boundary. */
  getVideoMediaAvailability?: (request: {
    itemIds: string[];
    claim: NativeProjectAuthorityDescriptor;
  }) => Promise<NativeVideoMediaAvailabilityResult>;
  normalizeImportedMediaBatch: (
    items: ImportedMediaBatchNormalizationRequestItem[],
  ) => Promise<NormalizedImportedMediaBatchItem[]>;
  choosePaperPdfExportPath?: (
    request: Pick<PaperPdfExportRequest, 'title' | 'fileName'>,
  ) => Promise<NativePaperPdfDestinationResult>;
  exportPaperPdf: (request: NativePaperPdfExportRequest) => Promise<NativePaperPdfExportResult>;
  savePaperPdfBytes?: (request: NativePaperPdfBytesSaveRequest) => Promise<NativePaperPdfExportResult>;
  /** Bounded, renderer-validated EPUB bytes saved through an explicit native chooser. */
  savePaperEpubBytes?: (request: NativePaperEpubBytesSaveRequest) => Promise<NativePaperEpubExportResult>;
  choosePaperImageExportDirectory?: (
    request: Pick<NativePaperImageExportRequest, 'title' | 'directoryName' | 'format'>,
  ) => Promise<NativePaperImageDestinationResult>;
  exportPaperImages: (request: NativePaperImageExportRequest) => Promise<NativePaperImageExportResult>;
  captureCurrentWindowPng: () => Promise<NativeWindowCaptureResult>;
  readClipboardImage: () => Promise<string | null | { error: string }>;
  downloadRemoteMedia: (url: string, cancellationId?: string) => Promise<{ base64?: string; mimeType?: string; error?: string } | null>;
  cancelRemoteMediaDownload?: (cancellationId: string) => Promise<{ cancelled?: boolean }>;
  providerPackRequest?: (request: {
    url: string;
    approvedOrigin: string;
    method: string;
    headers: Record<string, string>;
    body?: {
      kind: 'text' | 'binary' | 'multipart';
      text?: string;
      base64?: string;
      mimeType?: string;
      parts?: Array<{ name: string; value?: string; base64?: string; mimeType?: string; fileName?: string }>;
    };
    cancellationId: string;
  }) => Promise<{
    status?: number;
    headers?: Record<string, string>;
    base64?: string;
    error?: string;
  }>;
  cancelProviderPackRequest?: (cancellationId: string) => Promise<{ cancelled?: boolean }>;
  generateVertexImage: (request: NativeVertexImageRequest) => Promise<NativeVertexImageResult>;
  generateVertexText: (request: NativeVertexTextRequest) => Promise<NativeVertexTextResult>;
  generateVertexVideo: (request: NativeVertexVideoRequest) => Promise<NativeVertexVideoResult>;
  cancelVertexGeneration?: (cancellationId: string) => Promise<{ cancelled?: boolean }>;
  /** Fixed-command, stdin-only bridge to an installed authenticated coding-agent CLI. */
  nativeCliAgentCapabilities?: () => Promise<NativeCliAgentCapabilitiesResult>;
  runNativeCliAgent?: (request: NativeCliAgentRunRequest) => Promise<NativeCliAgentRunResult>;
  cancelNativeCliAgent?: (requestId: string) => Promise<{ cancelled?: boolean }>;
  configureRemotePhoneHost?: (request: { baseUrl: string }) => Promise<{
    ok: boolean;
    hostBaseUrl?: string;
    proxyApiBase?: string;
    generation?: number;
    error?: string;
  }>;
  activateRemotePhoneHost?: (request: { generation: number }) => Promise<{ ok: boolean; generation?: number; error?: string }>;
  markRemotePhoneHostSeeded?: (request: { generation: number }) => Promise<{ ok: boolean; error?: string }>;
  disconnectRemotePhoneHost?: (request: { generation: number }) => Promise<{
    ok: boolean;
    stale?: boolean;
    error?: string;
    localSaveSuspended?: boolean;
  }>;
  getRemotePhoneHostStatus?: () => Promise<{
    configured: boolean;
    paired?: boolean;
    hostBaseUrl?: string;
    proxyApiBase: string;
    generation: number;
    verified?: boolean;
    stateSeeded?: boolean;
    localSaveSuspended: boolean;
  }>;
  beginHaneQrPairing?: () => Promise<{
    ok: boolean;
    invitationId?: string;
    payload?: string;
    expiresAt?: number;
    deviceLabel?: string;
    error?: string;
  }>;
  pollHaneQrPairing?: (request: { invitationId: string }) => Promise<{
    status: 'pending' | 'completed' | 'expired' | 'invalid';
    hostBaseUrl?: string;
    proxyApiBase?: string;
    generation?: number;
    haneDeviceLabel?: string;
    tokenCustodied?: boolean;
    error?: string;
  }>;
  cancelHaneQrPairing?: (request: { invitationId: string }) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  loginVertex: (request: NativeVertexAuthRequest) => Promise<NativeVertexLoginResult>;
  detectVertexAdc: (request: NativeVertexAuthRequest) => Promise<NativeVertexDetectResult>;
  listVertexProjects: (request: NativeVertexAuthRequest) => Promise<NativeVertexProjectsResult>;
  materializeSourceAsset: (request: NativeMaterializeSourceAssetRequest) => Promise<NativeMaterializeSourceAssetResult>;
  chooseScratchDirectory: (request: { claim?: NativeProjectAuthorityDescriptor }) => Promise<NativeScratchDirectoryResult>;
  openWorkspaceWindow: (workspace: WorkspaceWindowView) => Promise<{ ok?: boolean; workspace?: WorkspaceWindowView; error?: string }>;
  setActiveWorkspace: (workspace: WorkspaceWindowView) => Promise<{ ok?: boolean }>;
  setKeyboardShortcuts: (shortcuts: Partial<Record<NativeMenuCommand, string>>) => Promise<{ ok?: boolean }>;
  // Propose a revision-checked interface preference to the Electron process owner (FBL-033).
  setLocale?: (request: NativeInterfaceLocaleUpdateRequest) => Promise<NativeInterfaceLocaleUpdateResult>;
  getSourceLibrarySnapshot: (request: { claim: NativeProjectAuthorityDescriptor }) => Promise<SourceLibraryNativeSnapshotResponse>;
  syncSourceLibrarySnapshot: (request: { snapshot: SourceLibraryNativeSnapshotResult['snapshot']; claim: NativeProjectAuthorityDescriptor }) => Promise<{ ok?: boolean; version?: number; error?: string }>;
  applySourceLibraryChange: (request: { change: SourceLibraryNativeChange; claim: NativeProjectAuthorityDescriptor }) => Promise<{ ok?: boolean; version?: number; error?: string }>;
  showAbout: (options?: { edition?: string }) => Promise<void>;
  openPath: (filePath: string) => Promise<{ ok?: boolean; error?: string }>;
  // At-rest encryption via the OS keychain (safeStorage). Optional: only present on builds that
  // expose it; the renderer falls back to WebCrypto when absent. encrypt/decrypt exchange base64.
  secretAvailable?: () => Promise<boolean>;
  secretEncrypt?: (plaintext: string) => Promise<string | null>;
  secretDecrypt?: (ciphertextBase64: string) => Promise<string | null>;
  // Main-owned transactional external opens. Only the designated Flow renderer receives an
  // epoch; an intent remains recoverable until explicit accept/reject and commit.
  authorizeExternalOpenRenderer?: () => Promise<NativeExternalOpenAuthorizationResult>;
  nextExternalOpenIntent?: (epoch: string) => Promise<NativeExternalOpenNextResult>;
  acceptExternalOpenIntent?: (request: NativeExternalOpenTransitionRequest) => Promise<NativeExternalOpenTransitionResult>;
  rejectExternalOpenIntent?: (request: NativeExternalOpenTransitionRequest) => Promise<NativeExternalOpenTransitionResult>;
  commitExternalOpenIntent?: (request: NativeExternalOpenTransitionRequest) => Promise<NativeExternalOpenTransitionResult>;
  releaseExternalOpenRenderer?: (epoch: string) => Promise<NativeExternalOpenTransitionResult>;
  onExternalOpenPending?: (callback: () => void) => () => void;
  onMenuCommand: (callback: (command: NativeMenuCommand) => void) => () => void;
  onProjectPathChanged: (callback: (filePath: string | undefined) => void) => () => void;
  /** Versioned project identity changes; drives adoption/stale-marking in every window. */
  onProjectAuthorityChanged?: (callback: (event: NativeProjectAuthorityChangedEvent) => void) => () => void;
  /** Process-owned locale changes; every desktop renderer adopts the same revision. */
  onInterfaceLocaleChanged?: (callback: (state: NativeInterfaceLocaleState) => void) => () => void;
  onSourceLibraryChanged: (callback: (event: SourceLibraryNativeEvent) => void) => () => void;
}

export interface SignalLoomAutomationBridge {
  applySourceLibraryChange?: (request: { change: SourceLibraryNativeChange; claim: NativeProjectAuthorityDescriptor }) => Promise<{ ok?: boolean; version?: number; error?: string }>;
}

declare global {
  interface Window {
    signalLoomNative?: SignalLoomNativeBridge;
    signalLoomAutomation?: SignalLoomAutomationBridge;
  }
}

export function isNativeMenuCommand(value: unknown): value is NativeMenuCommand {
  return typeof value === 'string' && NATIVE_MENU_COMMANDS.includes(value as NativeMenuCommand);
}

export function getSignalLoomNativeBridge(): SignalLoomNativeBridge | undefined {
  return typeof window !== 'undefined' ? window.signalLoomNative : undefined;
}

export function dispatchNativeRendererCommand(command: NativeMenuCommand): void {
  window.dispatchEvent(new CustomEvent(NATIVE_RENDERER_COMMAND_EVENT, {
    detail: {
      command,
    },
  }));
}

export function onNativeRendererCommand(
  callback: (command: NativeMenuCommand) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ command?: unknown }>).detail;

    if (isNativeMenuCommand(detail?.command)) {
      callback(detail.command);
    }
  };

  window.addEventListener(NATIVE_RENDERER_COMMAND_EVENT, listener);
  return () => window.removeEventListener(NATIVE_RENDERER_COMMAND_EVENT, listener);
}
