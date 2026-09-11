import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react';
import type {
  Connection,
  Edge,
  EdgeChange,
  NodeChange,
  OnConnect,
  OnEdgesChange,
  OnNodesChange,
} from '@xyflow/react';
import { loadImportedAsset } from '../lib/assetStore';
import { buildLoraWeightsJson } from '../lib/loraSpecNode';
import { parseSignalLoomAssetId } from '../lib/signalLoomAssetUrl';
import {
  COMPOSITION_AUDIO_HANDLES,
  COMPOSITION_VIDEO_HANDLE,
  functionNodeMatchesCompositionMediaFamily,
  getCompositionTrackSettings,
  normalizeCompositionAudioTrackCounts,
  sanitizeCompositionAudioMigrationWarnings,
  type CompositionMediaFamily,
} from '../lib/compositionTracks';
import {
  isCompositionVideoConnection,
  normalizeCompositionConnectionTargetHandle,
  normalizeCompositionEdgesWithDiagnostics,
  surfaceCompositionEdgeDiagnostics,
  type CompositionAudioEdgeMigrationDiagnostic,
} from '../lib/compositionEdgeMigration';
import {
  DEFAULT_EXECUTION_CONFIG,
  getAudioOutputFormat,
  getImageOutputFormat,
  getNodeAspectRatio,
  getVideoResolution,
} from '../lib/providerCatalog';
import {
  normalizeImageConnectionTargetHandle,
  normalizeImageEdges,
} from '../lib/imageEdgeMigration';
import { resolveImageNodeMaskInput } from '../lib/imageNodeMask';
import {
  aggregateUsageTelemetries,
  estimateNodeExecutionTelemetry,
  formatRollupSummary,
  projectedImageOutputCount,
  type UsageRollup,
} from '../lib/costEstimation';
import { IMAGE_MASK_HANDLE, IMAGE_REFERENCE_HANDLES } from '../lib/imageModelSupport';
import {
  getEditorAudioClips,
  getEditorAudioTrackVolumes,
  getEditorVisualClips,
} from '../lib/manualEditorState';
import { MAX_PROFESSIONAL_TRACKS, sanitizeEditorProfessionalVideoState } from '../lib/videoProfessionalState';
import { isAudioTrackAudible, normalizeAudioTrackIndexes } from '../lib/editorAudioMix';
import { getEditorAssets } from '../lib/editorAssets';
import { getEditorStageObjects } from '../lib/editorStageObjects';
import {
  buildManualEditorVisualSequenceClip,
  type ManualEditorVisualSequenceClip,
} from '../lib/manualEditorSequence';
import { projectExecutableMulticamClips } from '../lib/videoMulticamExecution';
import { compileVideoRuntimeIr } from '../lib/videoRuntimeNestedExecution';
import { sanitizeEditorProfessionalWorkflowState } from '../lib/videoProductionState';
import { buildVideoCaptionEmbeddingPlan } from '../lib/videoCaptionEmbedding';
import { getVideoExportPresetOption } from '../lib/videoPremiereParity';
import { appendResultAttempt, resolveSelectedResultAttempt } from '../lib/resultHistory';
import {
  deserializeResultValueFromContainer,
  resultValueAsMediaUrl,
  serializeResultValueForContainer,
} from '../lib/flowResultValues';
import {
  executeNodeRequest,
  hashExecutionParameters,
  type ExecutionContext,
  type FunctionNodeExecutionRuntime,
} from '../lib/flowExecution';
import {
  buildCollapsedFunctionNode,
  createDefaultFunctionNodeConfig,
  createGroupNodeConfig,
  getNodeResultForFunctionRouting,
  getFunctionNodeOutput,
  pasteFlowClipboard,
  serializeFlowSelection,
  type FlowClipboardPayload,
} from '../lib/functionNodes';
import {
  API_REQUESTER_PERSISTED_CREDENTIAL_MARKER,
  isApiRequesterCredentialFieldName,
  isApiRequesterSensitiveHeaderName,
} from '../lib/apiRequesterCredentials';
import {
  buildListNodeItems,
  getListNodeKind,
  isListItemTargetHandle,
  resolveExpandedListItemForNode,
  resolveNodeListItemKind,
  resolvePackageNodeData,
  collectEnvelopeItemsForEnvelopeNode,
  evaluateNodeTextForMonitor,
} from '../lib/listNodes';
import {
  applyListItemsToExecutionContext,
  buildRoutedLoopInputs,
  buildLoopIterationItems,
  collectListLoopInputs,
  type LoopIterationItem,
  getLoopIterationCount,
  normalizeListLoopMode,
  resolveAllCombinationSubIndices,
  resolveLoopRunCount,
} from '../lib/listExecution';
import {
  collectNodePromptSignals,
  getBlockingSignalDiagnostics,
  type FlowSignal,
  getSignalIterationCount,
  resolveReferenceGroupsAtIndex,
  signalToTextAt,
  type NodePromptSignals,
  type ReferenceSlotInputs,
} from '../lib/flowSignals';
import {
  referenceSlotNumberForHandle,
  VIDEO_REFERENCE_HANDLES,
} from '../lib/referenceGroups';
import {
  annotateFlowEdges,
  flowNodeConnectionContractsChanged,
  validateFlowConnection,
} from '../lib/flowConnectionContracts';
import { LOOP_BREAK_TARGET_HANDLE } from '../lib/flowControlHandles';
import { shouldBreakLoopAtIteration } from '../lib/loopControl';
import { getBlockingFlowDiagnostics } from '../lib/flowDiagnostics';
import { buildSourceBinItem } from '../lib/sourceBin';
import { buildFlowNodePatchForRestoredSourceBinItem } from '../lib/sourceBinFlowBridge';
import {
  buildFlowNodeGeneratedResultPatch,
  sourceBinItemBelongsToFlowNode,
} from '../lib/flowNodeResultRestore';
import { recordProjectUsageFromExecution } from '../lib/projectUsageRecording';
import type { FlowProjectFlowSnapshot, FlowProjectFlowSnapshotInput } from '../lib/flowProjectWorkspaces';
import { applyFlowGraphNativeChange, type FlowGraphNativeChange } from '../lib/flowGraphNativeSync';
import {
  getDefaultGeminiTextMimeType,
  isGeminiTextMediaInputSupported,
  type GeminiTextMediaInput,
} from '../lib/geminiTextModel';
import {
  buildSourceBinLibraryItemLookup,
  mapLibraryItemToEditorSourceItem,
} from '../lib/editorSourceItems';
import { renameNodeBookmarkState } from './flow/slices/bookmarkActions';
import { replaceFlowSnapshotState } from './flow/slices/snapshotActions';
import {
  normalizeVideoImageConnectionTargetHandle,
  normalizeVideoImageEdges,
  replaceExclusiveVideoFrameEdges,
} from '../lib/videoEdgeMigration';
import {
  normalizeGeminiVideoModelId,
} from '../lib/videoModelSupport';
import { resolveEffectiveSourceNode } from '../lib/virtualNodes';
import {
  isPortalSyntheticEdge,
  normalizePortalEdges,
  prunePortalExitEdgesForRemovedEntryLeads,
} from '../lib/portalNodes';
import type {
  AspectRatio,
  AppNode,
  DynamicValue,
  EditorSourceKind,
  ExecutionConfig,
  EnvelopeItem,
  EditorAudioClip,
  FlowNodeType,
  ImageTargetHandle,
  NodeOutputArtifact,
  NodeData,
  PersistedNodeData,
  ResultType,
  RuntimeSettingsSnapshot,
  SerializableNodeValue,
  UsageTelemetry,
  VideoReferenceType,
  VideoTargetHandle,
} from '../types/flow';
import { useSettingsStore } from './settingsStore';
import { useSourceBinStore } from './sourceBinStore';
import { useProjectUsageStore } from './projectUsageStore';
import { useConfirmationStore } from './confirmationStore';
import {
  getFlowWorkspaceSnapshotGeneration,
  useFlowWorkspaceStore,
  type FlowRunOwner,
} from './flowWorkspaceStore';
import {
  validateSourceBinResumeItem,
  type ValidatedSourceBinResume,
} from '../lib/sourceBinResume';
import {
  createFlowResultCacheKey,
  getFlowResultCacheEntry,
  isValidFlowResultCacheEntry,
  setFlowResultCacheEntry,
  type FlowResultCacheEntry,
} from '../lib/flowResultCache';

export interface FlowState {
  nodes: AppNode[];
  edges: Edge[];
  bookmarkSidebarOpen: boolean;
  setBookmarkSidebarOpen: (open: boolean) => void;
  onNodesChange: OnNodesChange<AppNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (type: FlowNodeType, position: { x: number; y: number }, initialData?: Partial<NodeData>) => string;
  addConnectedNode: (sourceNodeId: string, type: FlowNodeType, targetHandle?: string) => void;
  updateNodeData: (id: string, key: string, value: SerializableNodeValue) => void;
  patchNodeData: (id: string, patch: Partial<NodeData>) => void;
  renameNodeBookmark: (id: string, rawTitle: string | null) => void;
  clearNodeBookmark: (id: string) => void;
  removeEditorSourceReferences: (sourceNodeId: string) => void;
  selectNodeAttempt: (id: string, attemptId: string) => void;
  runNode: (id: string, options?: { force?: boolean }) => Promise<void>;
  cancelNodeRun: (id: string) => void;
  hydratePersistedState: () => void;
  restoreImportedAssets: () => Promise<void>;
  exportFlow: () => string;
  exportProjectFlowSnapshot: () => FlowProjectFlowSnapshot;
  replaceFlowSnapshot: (snapshot: FlowProjectFlowSnapshotInput) => void;
  /**
   * Apply a remote Flow-graph op from the unified cross-device sync (task #51; channel `'flow'` on
   * [[projectSyncService]]). Mutates the live graph WITHOUT re-broadcasting — the echo guard lives in
   * the sync layer (`flowSyncChannel`), not here. Newly-added nodes get their runtime callbacks
   * re-attached. Returns whether the graph actually changed (idempotent ops on missing/unchanged
   * targets are no-ops, so a self-echoed op doesn't thrash the store).
   */
  applyRemoteFlowGraphChange: (change: FlowGraphNativeChange) => boolean;
  insertTemplate: (
    template: { nodes: Partial<AppNode>[]; edges: Partial<Edge>[] },
    position: { x: number; y: number },
    options?: { select?: boolean },
  ) => void;
  copySelection: () => boolean;
  cutSelection: () => Promise<boolean>;
  pasteClipboard: (position: { x: number; y: number }) => boolean;
  deleteSelection: () => Promise<boolean>;
  selectAllNodes: () => void;
  deselectAll: () => void;
  createGroupFromSelection: (title?: string) => string | undefined;
  collapseSelectionToFunction: (title?: string) => string | undefined;
  centerOnNode: (id: string) => void;
  registerCenterOnNodeCallback: (callback: (id: string) => void) => void;
  onSourceBinItemRemoved: (id: string, removedItem?: import('./sourceBinStore').SourceBinLibraryItem) => void;
}

const activeRunControllers = new Map<string, AbortController>();
const activeGraphRuns = new Map<string, Promise<void>>();
const activePlanningControllers = new Map<string, AbortController>();
const activePlanningRunIds = new Set<string>();
const reconfirmablePlanningRunIds = new Set<string>();
let hydratedFlowGraphGeneration = 0;
let hydratedCanvasWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
let flowClipboard: FlowClipboardPayload | null = null;

function activeGraphRunKey(workspaceId: string, nodeId: string, node: AppNode | undefined): string {
  return [
    workspaceId,
    hydratedFlowGraphGeneration,
    nodeId,
    node?.data.nodeInstanceId ?? '',
    node?.data.inputRevision ?? '',
  ].join(':');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const FLOW_STORAGE_KEY = 'flow-canvas-storage';
const PERSIST_DEBOUNCE_MS = 400;

function makeFlowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

const RUNTIME_NODE_DATA_KEYS = new Set<string>([
  'onChange',
  'onRun',
  'onSelectAttempt',
  'isRunning',
  'retryState',
  'error',
  'statusMessage',
  'result',
  'resultType',
  'resultMimeType',
  'resultExtension',
  'resultFileName',
  'resultOutputMetadata',
  'functionOutputs',
  'namedOutputs',
  'resultInputSignature',
  'resultHistory',
  'selectedResultId',
  'usage',
  'envelopeItems',
  'envelopeItemKind',
  'expandedItemIndex',
  'sourceAssetUrl',
  'sourceBinItemId',
  'loopBreakReason',
]);

function shouldBumpInputRevision(patch: Partial<NodeData>): boolean {
  return Object.keys(patch).some(
    (key) => key !== 'nodeInstanceId' && key !== 'inputRevision' && !RUNTIME_NODE_DATA_KEYS.has(key),
  );
}

function makeNodeIdentity(): { nodeInstanceId: string; inputRevision: string } {
  const id = makeFlowId();
  return { nodeInstanceId: id, inputRevision: id };
}

function createDebouncedLocalStorage(delayMs: number): StateStorage {
  const pending = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const flush = (name: string) => {
    const value = pending.get(name);
    const timer = timers.get(name);

    if (timer) {
      clearTimeout(timer);
      timers.delete(name);
    }

    if (value === undefined) {
      return;
    }

    pending.delete(name);

    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Storage quota or unavailable — drop the write rather than crash.
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      for (const name of Array.from(pending.keys())) {
        flush(name);
      }
    });
  }

  return {
    getItem: (name) => {
      const buffered = pending.get(name);
      if (buffered !== undefined) {
        return buffered;
      }

      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);

      const existingTimer = timers.get(name);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      timers.set(
        name,
        setTimeout(() => flush(name), delayMs),
      );
    },
    removeItem: (name) => {
      pending.delete(name);

      const timer = timers.get(name);
      if (timer) {
        clearTimeout(timer);
        timers.delete(name);
      }

      try {
        window.localStorage.removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

export function resolveNodeOutputAsset(node: AppNode, sourceHandle?: string | null): string | undefined {
  if (node.type === 'functionNode') {
    return resultValueAsMediaUrl(getFunctionNodeOutput(node, sourceHandle)?.result);
  }
  if (
    (node.type === 'imageGen' || node.type === 'audioGen' || node.type === 'videoGen') &&
    (node.data.mediaMode ?? 'generate') === 'import'
  ) {
    const sourceAssetUrl = resultValueAsMediaUrl(node.data.sourceAssetUrl);
    if (sourceAssetUrl) {
      return sourceAssetUrl;
    }
    const result = resultValueAsMediaUrl(node.data.result);
    if (result) {
      return result;
    }
    if (node.data.sourceBinItemId) {
      const item = useSourceBinStore.getState().getAllItems().find((item) => item.id === node.data.sourceBinItemId);
      if (item?.assetUrl) {
        return item.assetUrl;
      }
    }
    return undefined;
  }

  return resultValueAsMediaUrl(node.data.result);
}

// A successful signature-bound result is safe to use while planning. Input edits clear the
// signature below, and the execution path still verifies the complete context-derived key.
function shouldReuseExistingNodeOutput(node: AppNode): boolean {
  if (!node.data.resultInputSignature || node.data.error || node.data.isRunning) return false;
  // Vector outputs must remain in the execution order so the final spend plan
  // can validate every persisted Source Bin item before a downstream rerun.
  if ((node.data.envelopeItems?.length ?? 0) > 1) return false;
  if (node.data.sourceBinItemId) {
    const sourceItem = useSourceBinStore.getState().getAllItems().find((item) => item.id === node.data.sourceBinItemId);
    if (!sourceItem) return false;
    const locator = sourceItem.assetUrl ?? sourceItem.assetId ?? sourceItem.scratchFileName ?? sourceItem.nativeFilePath;
    // Obvious corrupt/missing data URLs are kept in the spend plan for asynchronous validation;
    // normal durable/HTTP/native locators can be validated at the final approval boundary.
    if (!locator || (sourceItem.assetUrl?.startsWith('data:') && sourceItem.assetUrl.includes('%'))) return false;
    return true;
  }
  return Boolean(getFlowResultCacheEntry(node.data.resultInputSignature));
}

export function canRunNode(node: AppNode): boolean {
  if (
    node.type === 'composition' ||
    node.type === 'cropImageNode' ||
    node.type === 'visionVerifyNode' ||
    node.type === 'functionNode' ||
    node.type === 'apiFetchNode' ||
    node.type === 'transcriptionNode' ||
    node.type === 'audioProcessNode'
  ) {
    return true;
  }

  if (node.type === 'textNode') {
    return (node.data.mode ?? 'prompt') === 'generate';
  }

  if (node.type === 'imageGen' || node.type === 'audioGen' || node.type === 'videoGen') {
    return (node.data.mediaMode ?? 'generate') === 'generate';
  }

  return false;
}

function createInitialNodeData(type: FlowNodeType, settings: RuntimeSettingsSnapshot): PersistedNodeData {
  switch (type) {
    case 'textNode':
      return {
        mode: 'prompt',
        prompt: '',
        systemPrompt: '',
        provider: 'gemini',
        modelId: settings.defaultModels.text.gemini,
      };
    case 'imageGen': {
      // Use the user-pinned default image model (set via the node's "default" checkbox) when present.
      const pinnedImageModel = useSettingsStore.getState().defaultImageNodeModel;
      return {
        mediaMode: 'generate',
        provider: pinnedImageModel?.provider ?? 'gemini',
        modelId: pinnedImageModel?.modelId ?? settings.defaultModels.image.gemini,
        videoFrameSelection: 'last',
      };
    }
    case 'cropImageNode':
      return {
        cropXPercent: 10,
        cropYPercent: 10,
        cropWidthPercent: 80,
        cropHeightPercent: 80,
      };
    case 'videoGen':
      return {
        mediaMode: 'generate',
        provider: 'gemini',
        modelId: settings.defaultModels.video.gemini,
        videoReference1Type: 'asset',
        videoReference2Type: 'asset',
        videoReference3Type: 'asset',
      };
    case 'audioGen':
      return {
        mediaMode: 'generate',
        provider: 'elevenlabs',
        modelId: settings.defaultModels.audio.elevenlabs,
        voiceId: settings.providerSettings.elevenlabsVoiceId,
        geminiVoiceName: 'Kore',
        audioStyleDescription: '',
        audioGenerationMode: 'speech',
        audioLoop: false,
        audioPromptInfluence: 0.3,
        audioRemoveBackgroundNoise: false,
      };
    case 'transcriptionNode':
      return {
        transcriptionModelId: 'scribe_v2',
        transcriptionOperation: 'transcribe',
        transcriptionLanguageCode: 'auto',
        transcriptionDiarize: true,
        transcriptionTagAudioEvents: true,
        transcriptionNoVerbatim: false,
        transcriptionTimestampGranularity: 'word',
      };
    case 'audioProcessNode':
      return {
        audioProcessOperation: 'isolate-voice',
      };
    case 'settings':
      return {
        aspectRatio: DEFAULT_EXECUTION_CONFIG.aspectRatio,
        steps: DEFAULT_EXECUTION_CONFIG.steps,
        durationSeconds: DEFAULT_EXECUTION_CONFIG.durationSeconds,
        videoResolution: DEFAULT_EXECUTION_CONFIG.videoResolution,
        imageOutputFormat: DEFAULT_EXECUTION_CONFIG.imageOutputFormat,
        audioOutputFormat: DEFAULT_EXECUTION_CONFIG.audioOutputFormat,
      };
    case 'composition':
      return {
        aspectRatio: '16:9',
        videoResolution: '1080p',
        videoFrameRate: 30,
        compositionAudioTrackCount: 1,
        compositionTimelineSeconds: 30,
        compositionUseVideoAudio: false,
        compositionVideoAudioVolume: 100,
        compositionAudio1OffsetMs: 0,
        compositionAudio2OffsetMs: 0,
        compositionAudio3OffsetMs: 0,
        compositionAudio4OffsetMs: 0,
        compositionAudio1Volume: 100,
        compositionAudio2Volume: 100,
        compositionAudio3Volume: 100,
        compositionAudio4Volume: 100,
        compositionAudio1Enabled: true,
        compositionAudio2Enabled: true,
        compositionAudio3Enabled: true,
        compositionAudio4Enabled: true,
      };
    case 'sourceBin':
      return {};
    case 'valueNode':
      return {
        valueKind: 'text',
        value: '',
      };
    case 'colorSwatchNode':
      return {
        colorSwatchColors: [],
        colorSwatchDraftColor: '#38BDF8',
        colorSwatchSelectedIndex: -1,
        colorSwatchUsageMode: 'primary',
      };
    case 'list':
      return {};
    case 'expander':
      return {
        expandedItemIndex: 0,
      };
    case 'envelope':
    case 'virtual':
    case 'portal':
    case 'advancedImageEditor':
      return {};
    case 'groupNode':
      return {
        groupNode: createGroupNodeConfig({
          childNodeIds: [],
          childEdgeIds: [],
          bounds: { x: 0, y: 0, width: 280, height: 180 },
        }),
      };
    case 'functionNode':
      return {
        functionNode: createDefaultFunctionNodeConfig('Reusable function'),
      };
    default:
      return {};
  }
}

function stripRuntimeData(node: AppNode): AppNode {
  const persistedData = redactApiRequesterCredentialsForPersistence(node);
  return {
    ...node,
    data: {
      ...persistedData,
      onChange: undefined,
      onRun: undefined,
      onSelectAttempt: undefined,
      isRunning: undefined,
      error: undefined,
      statusMessage: undefined,
      result: undefined,
      resultType: undefined,
      resultMimeType: undefined,
      resultExtension: undefined,
      resultFileName: undefined,
      resultOutputMetadata: undefined,
      functionOutputs: undefined,
      namedOutputs: undefined,
      resultHistory: undefined,
      selectedResultId: undefined,
      usage: undefined,
      sourceAssetUrl: undefined,
    },
  };
}

function stripProjectRuntimeData(node: AppNode): AppNode {
  const persistedData = redactApiRequesterCredentialsForPersistence(node);
  const requesterTransientData: Partial<NodeData> = node.type === 'apiFetchNode'
    ? {
        result: undefined,
        resultType: undefined,
        resultMimeType: undefined,
        resultExtension: undefined,
        resultFileName: undefined,
        resultOutputMetadata: undefined,
        resultHistory: undefined,
        selectedResultId: undefined,
        usage: undefined,
      }
    : {};
  return {
    ...node,
    data: {
      ...persistedData,
      functionOutputs: makeNodeOutputTablePortable(persistedData.functionOutputs),
      namedOutputs: makeNodeOutputTablePortable(persistedData.namedOutputs),
      ...requesterTransientData,
      onChange: undefined,
      onRun: undefined,
      onSelectAttempt: undefined,
      error: undefined,
      statusMessage: undefined,
      sourceAssetUrl: undefined,
    },
  };
}

function makeNodeOutputTablePortable(
  outputs: Record<string, NodeOutputArtifact> | undefined,
): Record<string, NodeOutputArtifact> | undefined {
  if (!outputs) return undefined;
  return Object.fromEntries(Object.entries(outputs).map(([handle, output]) => [handle, {
    ...output,
    blob: undefined,
  }]));
}

function redactApiRequesterCredentialsForPersistence(node: AppNode): NodeData {
  const modelCardValues = isRecord(node.data.modelCardValues)
    ? Object.fromEntries(Object.entries(node.data.modelCardValues).map(([key, value]) => [
        key,
        isApiRequesterCredentialFieldName(key) ? API_REQUESTER_PERSISTED_CREDENTIAL_MARKER : value,
      ]))
    : node.data.modelCardValues;
  const safeNodeData: NodeData = {
    ...node.data,
    ...(modelCardValues === undefined ? {} : { modelCardValues }),
  };
  if (node.type !== 'apiFetchNode') return safeNodeData;

  const headers = typeof safeNodeData.headers === 'string'
    ? safeNodeData.headers.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return line;
      const name = line.slice(0, separator).trim();
      return isApiRequesterSensitiveHeaderName(name)
        ? `${name}: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}`
        : line;
    }).join('\n')
    : safeNodeData.headers;
  const url = typeof safeNodeData.url === 'string' ? redactApiRequesterUrlForPersistence(safeNodeData.url) : safeNodeData.url;
  const body = typeof safeNodeData.body === 'string' ? redactApiRequesterBodyForPersistence(safeNodeData.body) : safeNodeData.body;

  return { ...safeNodeData, headers, url, body };
}

function redactApiRequesterBodyForPersistence(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return rawBody;

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const redactJson = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redactJson);
      if (!isRecord(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        isApiRequesterCredentialFieldName(key) ? API_REQUESTER_PERSISTED_CREDENTIAL_MARKER : redactJson(entry),
      ]));
    };
    return JSON.stringify(redactJson(parsed));
  } catch {
    // A form body is still structured credential-bearing input. Preserve non-secret fields and
    // the original separator layout rather than applying a broad text replacement.
    if (!rawBody.includes('=')) return rawBody;
    return rawBody.split('&').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return part;
      const rawKey = part.slice(0, separator);
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Use the raw key if it is malformed; this is persistence redaction, not request parsing.
      }
      return isApiRequesterCredentialFieldName(key)
        ? `${rawKey}=${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}`
        : part;
    }).join('&');
  }
}

function redactApiRequesterUrlForPersistence(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = API_REQUESTER_PERSISTED_CREDENTIAL_MARKER;
    if (url.password) url.password = API_REQUESTER_PERSISTED_CREDENTIAL_MARKER;
    for (const [key] of url.searchParams) {
      if (isApiRequesterCredentialFieldName(key)) {
        url.searchParams.set(key, API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
      }
    }
    return url.toString();
  } catch {
    // Invalid URLs are rejected before execution. Do not use substring heuristics here:
    // they corrupt ordinary creative text and cannot establish URL structure safely.
    return rawUrl;
  }
}

function combineNodeDataPatches(...patches: Array<Partial<NodeData> | undefined>): Partial<NodeData> | undefined {
  const combined: Partial<NodeData> = {};

  for (const patch of patches) {
    if (patch) {
      Object.assign(combined, patch);
    }
  }

  return Object.keys(combined).length > 0 ? combined : undefined;
}

export async function prepareFlowSnapshotImportedAssets(
  snapshot: FlowProjectFlowSnapshot,
  sourceBinItems: import('./sourceBinStore').SourceBinLibraryItem[],
): Promise<FlowProjectFlowSnapshot> {
  const nodes = await Promise.all(snapshot.nodes.map(async (node) => {
    const sourceBinPatch = buildFlowNodePatchForRestoredSourceBinItem(node.data, sourceBinItems);
    const generatedResultPatch = buildFlowNodeGeneratedResultPatch(node.id, node.type, node.data, sourceBinItems, {
      replaceExistingHistory: true,
    });
    const sourceBinAssetUrl = typeof sourceBinPatch?.sourceAssetUrl === 'string' && sourceBinPatch.sourceAssetUrl.trim()
      ? sourceBinPatch.sourceAssetUrl
      : undefined;
    if (sourceBinPatch && sourceBinAssetUrl) {
      const patch = combineNodeDataPatches(sourceBinPatch, generatedResultPatch);
      return patch ? { ...node, data: { ...node.data, ...patch } } : node;
    }
    const assetId = (
      typeof sourceBinPatch?.sourceAssetId === 'string' && sourceBinPatch.sourceAssetId.trim()
        ? sourceBinPatch.sourceAssetId
        : undefined
    ) ?? node.data.sourceAssetId ?? parseSignalLoomAssetId(node.data.sourceAssetUrl);
    if (!assetId) {
      const patch = combineNodeDataPatches(sourceBinPatch, generatedResultPatch);
      return patch ? { ...node, data: { ...node.data, ...patch } } : node;
    }
    const storedAsset = await loadImportedAsset(assetId).catch(() => undefined);
    const patch = storedAsset
      ? combineNodeDataPatches({
          ...sourceBinPatch,
          sourceAssetId: assetId,
          sourceAssetUrl: storedAsset.dataUrl,
          sourceAssetName: sourceBinPatch?.sourceAssetName ?? storedAsset.name,
          sourceAssetMimeType: sourceBinPatch?.sourceAssetMimeType ?? storedAsset.mimeType,
        }, generatedResultPatch)
      : combineNodeDataPatches(
          sourceBinPatch,
          generatedResultPatch,
          sourceBinPatch ? undefined : { sourceAssetUrl: undefined },
        );
    return patch ? { ...node, data: { ...node.data, ...patch } } : node;
  }));
  return { ...snapshot, nodes };
}

function normalizePersistedNode(node: AppNode): AppNode {
  let normalizedNode =
    (node.type as string) === 'input'
      ? ({
          ...node,
          type: 'textNode',
        } as AppNode)
      : node;

  // Old projects and remote graph operations can arrive without the execution
  // identity introduced in schema v2. Treat the hydration boundary as creation
  // of that local node instance so an id reused by a later snapshot cannot
  // accept a completion belonging to the previous instance.
  if (!normalizedNode.data.nodeInstanceId || !normalizedNode.data.inputRevision) {
    const identity = makeNodeIdentity();
    normalizedNode = {
      ...normalizedNode,
      data: {
        ...normalizedNode.data,
        // Flow sync deliberately keeps the authority's nodeInstanceId while omitting the
        // device-local inputRevision. Preserve whichever half already exists: replacing both when
        // only inputRevision was absent gave the served peer a different Composition identity, so
        // its otherwise-valid Video timeline mutations were rejected by the phone authority.
        nodeInstanceId: normalizedNode.data.nodeInstanceId || identity.nodeInstanceId,
        inputRevision: normalizedNode.data.inputRevision || identity.inputRevision,
      },
    };
  }

  if (
    normalizedNode.type === 'videoGen' &&
    (normalizedNode.data.provider === undefined || normalizedNode.data.provider === 'gemini')
  ) {
    const normalizedModelId = normalizeGeminiVideoModelId(normalizedNode.data.modelId);

    if (normalizedModelId !== normalizedNode.data.modelId) {
      return {
        ...normalizedNode,
        data: {
          ...normalizedNode.data,
          modelId: normalizedModelId,
        },
      };
    }
  }

  return normalizedNode;
}

function normalizeHydratedNode(node: AppNode): AppNode {
  const normalized = normalizePersistedNode(node);
  return {
    ...normalized,
    data: {
      ...normalized.data,
      // A saved snapshot cannot own a live AbortController. Always reset stale activity only
      // while hydrating; ordinary runtime re-attachment must preserve the current state.
      isRunning: false,
      retryState: undefined,
    },
  };
}

type StableRuntimeCallbacks = {
  onChange: NonNullable<NodeData['onChange']>;
  onSelectAttempt: NonNullable<NodeData['onSelectAttempt']>;
  onRun: NonNullable<NodeData['onRun']> | undefined;
};

const RUNTIME_CALLBACK_CACHE = new Map<string, { canRun: boolean; callbacks: StableRuntimeCallbacks }>();

function getStableRuntimeCallbacks(
  nodeId: string,
  canRun: boolean,
  get: () => FlowState,
): StableRuntimeCallbacks {
  const cached = RUNTIME_CALLBACK_CACHE.get(nodeId);

  if (cached && cached.canRun === canRun) {
    return cached.callbacks;
  }

  const callbacks: StableRuntimeCallbacks = {
    onChange: (key, value) => get().updateNodeData(nodeId, key, value),
    onSelectAttempt: (attemptId) => get().selectNodeAttempt(nodeId, attemptId),
    onRun: canRun
      ? () => {
          void get().runNode(nodeId);
        }
      : undefined,
  };

  RUNTIME_CALLBACK_CACHE.set(nodeId, { canRun, callbacks });
  return callbacks;
}

function attachRuntimeData(node: AppNode, get: () => FlowState): AppNode {
  const callbacks = getStableRuntimeCallbacks(node.id, canRunNode(node), get);
  const isRunning = node.data.isRunning === true;

  if (
    node.data.onChange === callbacks.onChange &&
    node.data.onSelectAttempt === callbacks.onSelectAttempt &&
    node.data.onRun === callbacks.onRun &&
    node.data.isRunning === isRunning
  ) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      onChange: callbacks.onChange,
      onSelectAttempt: callbacks.onSelectAttempt,
      onRun: callbacks.onRun,
      isRunning,
    },
  };
}

function attachRuntimeDataToNodes(nodes: AppNode[], get: () => FlowState): AppNode[] {
  let mutated = false;
  const next = nodes.map((node) => {
    const normalized = normalizePersistedNode(node);
    const attached = attachRuntimeData(normalized, get);

    if (attached !== node) {
      mutated = true;
    }

    return attached;
  });

  return mutated ? next : nodes;
}

function attachHydratedRuntimeDataToNodes(nodes: AppNode[], get: () => FlowState): AppNode[] {
  return attachRuntimeDataToNodes(nodes.map(normalizeHydratedNode), get);
}

async function confirmGeneratedAssetCleanupForRemovedNodes(removedNodeIds: Iterable<string>): Promise<void> {
  const removedNodeIdSet = new Set(removedNodeIds);
  if (removedNodeIdSet.size === 0) {
    return;
  }

  const sourceBinStore = useSourceBinStore.getState();
  const itemsToRemove = sourceBinStore.getAllItems().filter((item) => item.originNodeId && removedNodeIdSet.has(item.originNodeId));

  if (itemsToRemove.length === 0) {
    return;
  }

  const shouldDelete = await useConfirmationStore.getState().requestConfirmation(
    `Deleting these nodes will orphan ${itemsToRemove.length} generated asset(s) in your Source Library.\n\nContinue to delete these generated assets as well, or cancel to keep them in the Source Library.`,
    'Generated Asset Cleanup',
  );

  if (shouldDelete) {
    itemsToRemove.forEach((item) => sourceBinStore.removeItem(item.id));
  }
}

function invalidateHydratedRunGraphs(nodeIds: Iterable<string>): void {
  const workspaceStore = useFlowWorkspaceStore.getState();
  for (const nodeId of nodeIds) {
    workspaceStore.invalidateFlowRunForNode(workspaceStore.hydratedWorkspaceId, nodeId);
  }
}

function hasNodeDataPatchChange(data: NodeData, patch: Partial<NodeData>): boolean {
  return Object.entries(patch).some(([key, value]) => !Object.is(data[key], value));
}

function normalizeFlowEdges(
  nodes: AppNode[],
  edges: Edge[],
  onCompositionDiagnostics?: (diagnostics: CompositionAudioEdgeMigrationDiagnostic[]) => void,
): Edge[] {
  const visibleEdges = edges.filter((edge) => !isPortalSyntheticEdge(edge));
  const preComposition = normalizeVideoImageEdges(nodes, normalizeImageEdges(nodes, visibleEdges));
  const { edges: compositionNormalized, diagnostics } = normalizeCompositionEdgesWithDiagnostics(nodes, preComposition);
  onCompositionDiagnostics?.(diagnostics);
  const normalizedEdges = normalizePortalEdges(nodes, compositionNormalized);
  return annotateFlowEdges(normalizedEdges, nodes);
}

/**
 * Every graph-ingress mutation path (hydrate, edge changes, template insert, paste, incremental
 * remote sync) must normalize edges and surface any dropped Composition audio handle on the same
 * pass so nodes/edges/diagnostics stay atomic (FBL-019 correction) — centralized here instead of
 * duplicating the diagnostics-capture callback at every call site.
 */
function normalizeFlowEdgesWithCompositionDiagnostics(
  nodes: AppNode[],
  edges: Edge[],
): { nodes: AppNode[]; edges: Edge[] } {
  let compositionDiagnostics: CompositionAudioEdgeMigrationDiagnostic[] = [];
  const normalizedEdges = normalizeFlowEdges(nodes, edges, (diagnostics) => {
    compositionDiagnostics = diagnostics;
  });
  return {
    nodes: surfaceCompositionEdgeDiagnostics(nodes, compositionDiagnostics),
    edges: normalizedEdges,
  };
}

function reuseEquivalentFlowEdges(previousEdges: Edge[], nextEdges: Edge[]): Edge[] {
  const previousById = new Map(previousEdges.map((edge) => [edge.id, edge]));
  const reused = nextEdges.map((edge) => {
    const previous = previousById.get(edge.id);
    if (!previous) return edge;
    try {
      return JSON.stringify(previous) === JSON.stringify(edge) ? previous : edge;
    } catch {
      return edge;
    }
  });

  return reused.length === previousEdges.length
    && reused.every((edge, index) => edge === previousEdges[index])
    ? previousEdges
    : reused;
}

function sanitizePersistedCompositionAudioMigrationWarnings(node: AppNode): AppNode {
  if (!isRecord(node) || !isRecord(node.data) || !('compositionAudioMigrationWarnings' in node.data)) {
    return node;
  }

  const sanitized = sanitizeCompositionAudioMigrationWarnings(node.data.compositionAudioMigrationWarnings);
  if (sanitized === node.data.compositionAudioMigrationWarnings) {
    return node;
  }

  return { ...node, data: { ...node.data, compositionAudioMigrationWarnings: sanitized } };
}

export function sanitizePersistedFlowState(value: unknown): { nodes: AppNode[]; edges: Edge[]; bookmarkSidebarOpen: boolean } {
  const input = isRecord(value) ? value : {};
  return {
    nodes: Array.isArray(input.nodes)
      ? (input.nodes as AppNode[]).map(sanitizePersistedCompositionAudioMigrationWarnings)
      : [],
    edges: Array.isArray(input.edges) ? (input.edges as Edge[]) : [],
    bookmarkSidebarOpen: typeof input.bookmarkSidebarOpen === 'boolean' ? input.bookmarkSidebarOpen : true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateListConnection(
  connection: Connection,
  nodes: AppNode[],
  edges: Edge[],
): { connection?: Connection; edges: Edge[]; error?: string } {
  const targetNode = nodes.find((node) => node.id === connection.target);

  if (targetNode?.type !== 'list') {
    return { connection, edges };
  }

  if (!isListItemTargetHandle(connection.targetHandle)) {
    return {
      edges,
      error: 'Drop outputs onto a visible list slot instead of the list body.',
    };
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rawSourceNode = nodesById.get(connection.source);
  const sourceNode = rawSourceNode
    ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
    : undefined;
  const sourceKind = sourceNode?.type === 'expander'
    ? resolveExpandedListItemForNode(sourceNode, nodes, edges)?.kind
    : sourceNode
      ? resolveNodeListItemKind(sourceNode, nodes, edges)
      : undefined;

  if (!sourceKind) {
    return {
      edges,
      error: 'This output does not have a valid completed value to add yet.',
    };
  }

  const existingKind = getListNodeKind(buildListNodeItems(targetNode.id, nodes, edges));

  if (existingKind && existingKind !== sourceKind) {
    return {
      edges,
      error: `This list is typed as ${existingKind}; ${sourceKind} outputs cannot be added.`,
    };
  }

  return {
    connection,
    edges: edges.filter(
      (edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle),
    ),
  };
}

function buildIncomingMap(edges: Edge[]): Map<string, string[]> {
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    const existing = incoming.get(edge.target) ?? [];
    existing.push(edge.source);
    incoming.set(edge.target, existing);
  }

  return incoming;
}

function buildNodeMap(nodes: AppNode[]): Map<string, AppNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function getEffectiveSources(
  nodeId: string,
  edges: Edge[],
  nodesById: Map<string, AppNode>,
  visited = new Set<string>()
): AppNode[] {
  if (visited.has(nodeId)) {
    return [];
  }
  visited.add(nodeId);

  const node = nodesById.get(nodeId);
  if (!node) {
    return [];
  }

  if (canRunNode(node)) {
    return [node];
  }

  const sources: AppNode[] = [];
  const resolvedNode = resolveEffectiveSourceNode(node, nodesById, edges);
  if (resolvedNode && resolvedNode.id !== node.id) {
    return getEffectiveSources(resolvedNode.id, edges, nodesById, visited);
  }

  for (const edge of edges) {
    if (edge.target === nodeId) {
      const parentSources = getEffectiveSources(edge.source, edges, nodesById, visited);
      for (const src of parentSources) {
        if (!sources.some((s) => s.id === src.id)) {
          sources.push(src);
        }
      }
    }
  }

  if (sources.length === 0) {
    return [node];
  }

  return sources;
}

/**
 * The single source of truth for what a node "sees" when it executes: every prompt,
 * media, editor, and config collector the flow executor feeds into executeNodeRequest.
 * runNode uses it for canvas nodes, and it is injected (as part of
 * flowFunctionNodeExecutionRuntime) into collapsed reusable functions so their internal
 * subgraphs execute through exactly the same context-building path.
 */
export function buildNodeExecutionContext(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  _promptSignal?: FlowSignal,
): ExecutionContext {
  // AUD-011 established buildNodeExecutionResolution as the canonical context
  // boundary for direct runs and planning. Functions deliberately use the same
  // resolver instead of reviving the older partial collector copied by their
  // source branch.
  return buildNodeExecutionResolution(node, nodes, edges).context;
}

/**
 * The executor primitives collapsed reusable functions need to run their internal
 * subgraphs with full canvas-execution semantics. Injected into executeNodeRequest
 * because flowExecution cannot import this store module.
 */
export const flowFunctionNodeExecutionRuntime: FunctionNodeExecutionRuntime = {
  buildContext: buildNodeExecutionContext,
  getDependencies: (node, edges, nodesById) => getExecutionDependencies(node, edges, nodesById),
};

export function getExecutionDependencies(
  node: AppNode,
  edges: Edge[],
  nodesById: Map<string, AppNode>,
): string[] {
  const dependencies = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== node.id) {
      continue;
    }

    const rawSourceNode = nodesById.get(edge.source);
    if (!rawSourceNode) {
      continue;
    }

    const effectiveSources = getEffectiveSources(rawSourceNode.id, edges, nodesById);

    for (const sourceNode of effectiveSources) {
      if (edge.targetHandle === LOOP_BREAK_TARGET_HANDLE) {
        if (canRunNode(sourceNode)) {
          dependencies.add(sourceNode.id);
        }
        continue;
      }

      // Preflight has already rejected invalid typed edges. Any runnable effective source of a
      // valid incoming value is therefore a real execution dependency, regardless of which
      // routing/container node exposed it. Keeping this type-driven avoids parallel node allowlists
      // that silently fall behind new output types.
      if (canRunNode(sourceNode)) {
        dependencies.add(sourceNode.id);
      }
    }
  }

  if (node.type === 'storyStateNode') {
    const key = (node.data.key as string) ?? '';
    const incomingEdge = edges.find((e) => e.target === node.id);
    if (!incomingEdge && key) {
      for (const n of nodesById.values()) {
        if (n.type === 'storyStateNode' && n.id !== node.id && (n.data.key as string) === key) {
          if (edges.some((e) => e.target === n.id)) {
            dependencies.add(n.id);
          }
        }
      }
    }
  }

  return [...dependencies].filter((depId) => depId !== node.id);
}

export function collectTextInputs(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[] = [],
): string {
  const sourceIds = incoming.get(nodeId) ?? [];
  const prompts = sourceIds.flatMap((sourceId) =>
    collectTextInputsFromSource(sourceId, nodesById, incoming, edges, new Set()),
  );

  return prompts.join('\n\n').trim();
}

export function collectTextMediaInputs(
  node: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): GeminiTextMediaInput[] {
  const inputsByUrl = new Map<string, GeminiTextMediaInput>();
  const addInput = (input: GeminiTextMediaInput) => {
    const mimeType = input.mimeType ?? getDefaultGeminiTextMimeType(input.kind);
    const normalizedInput: GeminiTextMediaInput = {
      ...input,
      mimeType,
    };

    if (!normalizedInput.url || !isGeminiTextMediaInputSupported(normalizedInput)) {
      return;
    }

    inputsByUrl.set(`${normalizedInput.url}:${mimeType ?? ''}`, normalizedInput);
  };
  const directSourceItemId =
    typeof node.data.textVisionSourceItemId === 'string' && node.data.textVisionSourceItemId.trim()
      ? node.data.textVisionSourceItemId.trim()
      : undefined;
  const sourceBinItems = useSourceBinStore.getState().getAllItems();

  if (typeof node.data.sourceAssetUrl === 'string' && node.data.sourceAssetUrl.trim()) {
    addInput({
      url: node.data.sourceAssetUrl,
      mimeType: node.data.sourceAssetMimeType,
      kind: inferGeminiTextMediaKind(node.data.sourceAssetMimeType),
      label: node.data.sourceAssetName,
    });
  }

  if (directSourceItemId) {
    const directSourceItem = sourceBinItems.find((item) => item.id === directSourceItemId);

    if (directSourceItem?.assetUrl) {
      addInput({
        url: directSourceItem.assetUrl,
        mimeType: directSourceItem.mimeType,
        kind: directSourceItem.kind,
        label: directSourceItem.label,
      });
    }
  }

  const incoming = buildIncomingMap(edges);
  const matchingEdges = edges.filter((edge) => edge.target === node.id);

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    if (!sourceNode || ![
      'imageGen',
      'cropImageNode',
      'slimgNode',
      'advancedImageEditor',
      'audioGen',
      'audioProcessNode',
      'videoGen',
      'composition',
      'functionNode',
      'expander',
    ].includes(sourceNode.type)) {
      continue;
    }

    const mediaInput = collectTextMediaInputFromSource(edge.source, nodesById, incoming, edges, new Set());

    if (mediaInput) {
      addInput(mediaInput);
    }
  }

  return [...inputsByUrl.values()];
}

function resolveExpandedItemFromNode(
  node: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
) {
  return resolveExpandedListItemForNode(node, [...nodesById.values()], edges);
}

function expandedItemMatchesAcceptedTypes(
  item: ReturnType<typeof resolveExpandedListItemForNode>,
  acceptedTypes: FlowNodeType[],
): boolean {
  if (!item) return false;
  return acceptedTypes.some((type) => {
    switch (type) {
      case 'textNode':
        return item.kind === 'text';
      case 'imageGen':
      case 'cropImageNode':
        return item.kind === 'image';
      case 'videoGen':
      case 'composition':
        return item.kind === 'video';
      case 'audioGen':
      case 'audioProcessNode':
        return item.kind === 'audio';
      default:
        return false;
    }
  });
}

function textMediaKindForExpandedItem(
  item: NonNullable<ReturnType<typeof resolveExpandedListItemForNode>>,
): GeminiTextMediaInput['kind'] | undefined {
  return inferGeminiTextMediaKind(item.mimeType)
    ?? (item.kind === 'image' || item.kind === 'audio' || item.kind === 'video' ? item.kind : undefined);
}

function collectTextInputsFromSource(
  sourceId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[],
  visited: Set<string>,
): string[] {
  if (visited.has(sourceId)) {
    return [];
  }

  visited.add(sourceId);

  const node = nodesById.get(sourceId);
  if (!node) {
    return [];
  }

  if (node.type === 'settings') {
    return (incoming.get(sourceId) ?? []).flatMap((upstreamId) =>
      collectTextInputsFromSource(upstreamId, nodesById, incoming, edges, visited),
    );
  }

  if (node.type === 'virtual') {
    return (incoming.get(sourceId) ?? []).flatMap((upstreamId) =>
      collectTextInputsFromSource(upstreamId, nodesById, incoming, edges, visited),
    );
  }

  const listAndUtilityNodeTypes = [
    'textNode',
    'expander',
    'packageNode',
    'colorSwatchNode',
    'conditionalNode',
    'stringTemplateNode',
    'promptsJoinerNode',
    'regexReplaceNode',
    'listLengthNode',
    'mathNode',
    'logicNode',
    'comparisonNode',
    'visionVerifyNode',
    'valueMonitorNode',
    'numberNode',
    'functionNode',
    'doodleNode',
  ];

  if (listAndUtilityNodeTypes.includes(node.type)) {
    const monitorVisited = new Set(visited);
    monitorVisited.delete(node.id);
    const value = evaluateNodeTextForMonitor(node.id, Array.from(nodesById.values()), edges, monitorVisited);
    return value.trim() ? [value.trim()] : [];
  }

  if (node.type === 'envelope') {
    const items = collectEnvelopeItemsForEnvelopeNode(node.id, Array.from(nodesById.values()), edges);
    return items.flatMap((item) => {
      if (item.kind === 'text' && item.value?.trim()) {
        return [item.value.trim()];
      }
      if (item.kind === 'package' && item.text?.trim()) {
        return [item.text.trim()];
      }
      return [];
    });
  }

  return [];
}

function collectImageInputForHandle(
  nodeId: string,
  targetHandles: Array<VideoTargetHandle | undefined>,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const incoming = buildIncomingMap(edges);
  const matchingEdges = edges.filter(
    (edge) => edge.target === nodeId && targetHandles.includes(edge.targetHandle as VideoTargetHandle | undefined),
  );

  for (const edge of matchingEdges) {
    const image = collectImageInputFromSource(edge.source, nodesById, incoming, edges, new Set());

    if (image) {
      return image;
    }
  }

  return undefined;
}

/**
 * AUD-011: per numbered video Reference N handle — the slot's statically resolved image, its
 * authored asset/style type, and the textual/JSON guidance signals connected to that same
 * numbered handle. `resolveReferenceGroupsAtIndex` materializes the canonical groups from this.
 */
function collectVideoReferenceSlotInputs(
  node: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  promptSignals: NodePromptSignals,
): ReferenceSlotInputs[] {
  return VIDEO_REFERENCE_HANDLES.map((handle, index) => {
    const dataKey = `videoReference${index + 1}Type` as const;
    return {
      slot: index + 1,
      imageUrl: collectImageInputForHandle(node.id, [handle], nodesById, edges),
      referenceType: (node.data[dataKey] as VideoReferenceType | undefined) ?? 'asset',
      textSignals: promptSignals.referenceTextSignals.get(handle) ?? [],
    };
  });
}

function collectVideoExtensionInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  return collectResultInputForHandle(
    nodeId,
    'video-source-video',
    nodesById,
    edges,
    ['videoGen', 'composition'],
    undefined,
  )?.result;
}

export function collectUpstreamImageInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const explicitSource = collectUpstreamImageInputForHandles(
    nodeId,
    ['image-edit-source', 'image'],
    nodesById,
    edges,
  );

  if (explicitSource) {
    return explicitSource;
  }

  const incoming = buildIncomingMap(edges);
  const matchingEdges = edges.filter(
    (edge) => edge.target === nodeId && (edge.targetHandle == null || edge.targetHandle === ''),
  );

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    const allowedTypes: FlowNodeType[] = ['imageGen', 'cropImageNode', 'slimgNode', 'advancedImageEditor', 'packageNode', 'doodleNode', 'envelope', 'expander', 'functionNode'];
    if (!sourceNode || !allowedTypes.includes(sourceNode.type)) {
      continue;
    }

    const image = collectImageInputFromSource(edge.source, nodesById, incoming, edges, new Set());

    if (image) {
      return image;
    }
  }

  return undefined;
}

// loras JSON from a connected LoRA Spec node (first one wins), for FLUX LoRA image models.
function collectUpstreamLoraJson(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = nodesById.get(edge.source);
    if (sourceNode?.type !== 'loraSpecNode') continue;
    const json = buildLoraWeightsJson(sourceNode.data.loraEntries);
    if (json) return json;
  }
  return undefined;
}

export function collectUpstreamImageInputForHandles(
  nodeId: string,
  targetHandles: Array<ImageTargetHandle | undefined>,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const incoming = buildIncomingMap(edges);
  const matchingEdges = edges.filter(
    (edge) => edge.target === nodeId && targetHandles.includes(edge.targetHandle as ImageTargetHandle | undefined),
  );

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    const allowedTypes: FlowNodeType[] = ['imageGen', 'cropImageNode', 'slimgNode', 'advancedImageEditor', 'packageNode', 'doodleNode', 'envelope', 'expander', 'functionNode'];
    if (!sourceNode || !allowedTypes.includes(sourceNode.type)) {
      continue;
    }

    const image = collectImageInputFromSource(edge.source, nodesById, incoming, edges, new Set());

    if (image) {
      return image;
    }
  }

  return undefined;
}

/**
 * AUD-011: per numbered image Reference N handle — the slot's single permitted image plus the
 * textual/JSON guidance signals connected to that same numbered handle, in slot order.
 */
function collectImageReferenceSlotInputs(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  promptSignals: NodePromptSignals,
): ReferenceSlotInputs[] {
  return IMAGE_REFERENCE_HANDLES.map((handle, index) => ({
    slot: index + 1,
    imageUrl: collectUpstreamImageInputForHandles(nodeId, [handle], nodesById, edges),
    textSignals: promptSignals.referenceTextSignals.get(handle) ?? [],
  }));
}

export function collectImageMaskInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const node = nodesById.get(nodeId);
  const connectedMaskInput = collectUpstreamImageInputForHandles(nodeId, [IMAGE_MASK_HANDLE], nodesById, edges);
  return node ? resolveImageNodeMaskInput({ connectedMaskInput, nodeData: node.data }) : connectedMaskInput;
}

function collectUpstreamVideoInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const matchingEdges = edges.filter((edge) => edge.target === nodeId);

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;

    if (!sourceNode) {
      continue;
    }

    if (sourceNode.type === 'expander') {
      const item = resolveExpandedItemFromNode(sourceNode, nodesById, edges);
      if (item?.kind === 'video') {
        return item.value;
      }
      continue;
    }

    if (sourceNode.type === 'functionNode') {
      const asset = sourceNode.data.resultType === 'video' && typeof sourceNode.data.result === 'string'
        ? sourceNode.data.result
        : undefined;
      if (asset) {
        return asset;
      }
      continue;
    }

    if (!['videoGen', 'composition'].includes(sourceNode.type)) {
      continue;
    }

    const asset = resolveNodeOutputAsset(sourceNode);

    if (asset) {
      return asset;
    }
  }

  return undefined;
}

function collectUpstreamAudioInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const matchingEdges = edges.filter((edge) => edge.target === nodeId);

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;

    if (!sourceNode) {
      continue;
    }

    if (sourceNode.type === 'expander') {
      const item = resolveExpandedItemFromNode(sourceNode, nodesById, edges);
      if (item?.kind === 'audio') {
        return item.value;
      }
      continue;
    }

    if (sourceNode.type === 'functionNode') {
      const asset = sourceNode.data.resultType === 'audio' && typeof sourceNode.data.result === 'string'
        ? sourceNode.data.result
        : undefined;
      if (asset) {
        return asset;
      }
      continue;
    }

    if (sourceNode.type !== 'audioGen' && sourceNode.type !== 'audioProcessNode') {
      continue;
    }

    const asset = resolveNodeOutputAsset(sourceNode);

    if (asset) {
      return asset;
    }
  }

  return undefined;
}

function collectEditorVisualSequence(
  node: AppNode,
  nodesById: Map<string, AppNode>,
): { clips: ManualEditorVisualSequenceClip[]; runtimeError?: string } {
  const sourceBinItems = useSourceBinStore.getState().getAllItems();
  const sourceBinItemBySourceId = buildSourceBinLibraryItemLookup(sourceBinItems);
  const editorAssetById = new Map(getEditorAssets(node.data).map((asset) => [asset.id, asset]));
  const runtime = compileVideoRuntimeIr({
    visualClips: getEditorVisualClips(node.data),
    professionalState: node.data.editorProfessionalState,
  });
  if (!runtime.ok) {
    return { clips: [], runtimeError: runtime.errors.join(' ') };
  }

  const executableAngleSourceIds = new Set([...sourceBinItemBySourceId.entries()].flatMap(([sourceId, item]) =>
    item.kind === 'video' || item.kind === 'composition' ? [sourceId] : [],
  ));
  for (const [sourceId, sourceNode] of nodesById) {
    const item = buildSourceBinItem(sourceNode);
    if (item?.kind === 'video' || item?.kind === 'composition') executableAngleSourceIds.add(sourceId);
  }
  const projection = projectExecutableMulticamClips(
    runtime.ir.visualClips,
    sanitizeEditorProfessionalVideoState(node.data.editorProfessionalState),
    new Set([...sourceBinItemBySourceId.keys(), ...editorAssetById.keys(), ...nodesById.keys()]),
    executableAngleSourceIds,
  );
  if (!projection.ok) throw new Error(`Video export refused: ${projection.message}`);

  const clips: ManualEditorVisualSequenceClip[] = [];
  for (const clip of projection.clips) {
    const editorAsset = editorAssetById.get(clip.sourceNodeId);
    const libraryItem = sourceBinItemBySourceId.get(clip.sourceNodeId);
    const sourceNode = nodesById.get(clip.sourceNodeId) ??
      (libraryItem?.originNodeId ? nodesById.get(libraryItem.originNodeId) : undefined);
    const sourceItem = libraryItem
      ? mapLibraryItemToEditorSourceItem(libraryItem)
      : sourceNode
        ? buildSourceBinItem(sourceNode)
        : undefined;

    if (!sourceItem && !editorAsset && clip.runtimeRole !== 'adjustment') {
      if (clip.runtimePath.length > 0) {
        return {
          clips: [],
          runtimeError: `Nested sequence '${clip.runtimePath.join(' → ')}' references unavailable source '${clip.sourceNodeId}'; monitor and export were both refused.`,
        };
      }
      continue;
    }

    const sourceAspectRatio =
      sourceNode && (sourceNode.type === 'imageGen' || sourceNode.type === 'videoGen')
        ? (sourceNode.data.aspectRatio as AspectRatio | undefined)
        : undefined;

    clips.push({ ...buildManualEditorVisualSequenceClip(clip, {
      aspectRatio: sourceAspectRatio,
      assetUrl: sourceItem?.assetUrl,
      nativeFilePath: sourceItem?.nativeFilePath,
      text: sourceItem?.text ?? editorAsset?.textDefaults?.text,
      mimeType: sourceItem?.mimeType,
    }), runtimeRole: clip.runtimeRole });
  }

  return { clips };
}

function collectEditorAudioSequence(
  node: AppNode,
  nodesById: Map<string, AppNode>,
): Array<{
  id?: string;
  url: string;
  nativeFilePath?: string;
  sourceNodeId: string;
  sourceKind: 'audio' | 'video' | 'composition';
  mimeType?: string;
  offsetMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  trackIndex: number;
  trackVolumePercent?: number;
  volumePercent: number;
  volumeAutomationPoints?: Array<{ timePercent: number; valuePercent: number }>;
  volumeKeyframes?: Array<{ timePercent: number; volumePercent: number }>;
  measuredMatchGainDb?: number;
  loudnessReferenceClipId?: string;
  audioProcessing?: EditorAudioClip['audioProcessing'];
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  enabled: boolean;
  professional?: {
    pan?: number;
    busId?: string;
    parameterKeyframes?: NonNullable<EditorAudioClip['professional']>['parameterKeyframes'];
  };
}> {
  const sourceBinItems = useSourceBinStore.getState().getAllItems();
  const sourceBinItemBySourceId = buildSourceBinLibraryItemLookup(sourceBinItems);
  const editorAudioClips = getEditorAudioClips(node.data);
  const professionalAudioTrackCount = Array.isArray(node.data.editorProfessionalState?.tracks)
    ? node.data.editorProfessionalState.tracks.filter((track) => track?.kind === 'audio').length
    : 0;
  const audioTrackCount = Math.min(MAX_PROFESSIONAL_TRACKS, Math.max(
    4,
    professionalAudioTrackCount,
    editorAudioClips.reduce((maximum, clip) => Math.max(maximum, clip.trackIndex + 1), 0),
  ));
  const audioTrackVolumes = getEditorAudioTrackVolumes(node.data, audioTrackCount);
  const mutedTracks = normalizeAudioTrackIndexes(node.data.editorMutedAudioTracks, audioTrackCount);
  const soloTracks = normalizeAudioTrackIndexes(node.data.editorSoloAudioTracks, audioTrackCount);

  return editorAudioClips.flatMap((clip) => {
    const libraryItem = sourceBinItemBySourceId.get(clip.sourceNodeId);
    const sourceNode = nodesById.get(clip.sourceNodeId);
    const sourceItem = libraryItem
      ? mapLibraryItemToEditorSourceItem(libraryItem)
      : sourceNode
        ? buildSourceBinItem(sourceNode)
        : undefined;

    if (
      !sourceItem?.assetUrl ||
      (sourceItem.kind !== 'audio' && sourceItem.kind !== 'video' && sourceItem.kind !== 'composition')
    ) {
      return [];
    }

    return [{
      id: clip.id,
      url: sourceItem.assetUrl,
      nativeFilePath: sourceItem.nativeFilePath,
      sourceNodeId: clip.sourceNodeId,
      sourceKind: sourceItem.kind,
      mimeType: sourceItem.mimeType,
      offsetMs: clip.offsetMs,
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs,
      trackIndex: clip.trackIndex,
      trackVolumePercent: audioTrackVolumes[clip.trackIndex] ?? 100,
      volumePercent: clip.volumePercent,
      volumeAutomationPoints: clip.volumeAutomationPoints?.map((point) => ({ ...point })),
      volumeKeyframes: clip.volumeKeyframes?.map((keyframe) => ({ ...keyframe })),
      measuredMatchGainDb: clip.measuredMatchGainDb,
      loudnessReferenceClipId: clip.loudnessReferenceClipId,
      audioProcessing: clip.audioProcessing ? { ...clip.audioProcessing } : undefined,
      audioDucking: clip.audioDucking ? { ...clip.audioDucking } : undefined,
      fadeInSeconds: clip.fadeInSeconds,
      fadeOutSeconds: clip.fadeOutSeconds,
      enabled: clip.enabled && isAudioTrackAudible(clip.trackIndex, mutedTracks, soloTracks),
      professional: clip.professional ? {
        pan: clip.professional.pan,
        busId: clip.professional.busId,
        parameterKeyframes: clip.professional.parameterKeyframes?.map((track) => ({
          ...track,
          keyframes: track.keyframes.map((keyframe) => ({
            ...keyframe,
            bezier: keyframe.bezier ? { ...keyframe.bezier } : undefined,
          })),
        })),
      } : undefined,
    }];
  });
}

function collectEditorStageObjects(node: AppNode) {
  return getEditorStageObjects(node.data).map((object) => ({ ...object }));
}

function collectResultInputForHandle(
  nodeId: string,
  targetHandle: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  acceptedTypes: FlowNodeType[],
  expectedMediaFamily: CompositionMediaFamily | undefined,
): { node: AppNode; result: string } | undefined {
  const edge = edges.find((candidate) => {
    if (candidate.target !== nodeId) {
      return false;
    }

    if (candidate.targetHandle === targetHandle) {
      return true;
    }

    const rawSourceNode = nodesById.get(candidate.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, candidate.sourceHandle)
      : undefined;
    return targetHandle === COMPOSITION_VIDEO_HANDLE && isCompositionVideoConnection(candidate) && (
      sourceNode?.type === 'videoGen' || sourceNode?.type === 'composition'
    );
  });

  if (!edge) {
    return undefined;
  }

  const rawSourceNode = nodesById.get(edge.source);
  const sourceNode = rawSourceNode
    ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
    : undefined;

  if (!sourceNode || !acceptedTypes.includes(sourceNode.type)) {
    if (sourceNode?.type === 'expander') {
      const item = resolveExpandedItemFromNode(sourceNode, nodesById, edges);
      if (expandedItemMatchesAcceptedTypes(item, acceptedTypes)) {
        return {
          node: sourceNode,
          result: item!.value,
        };
      }
    }
    return undefined;
  }

  if (
    sourceNode.type === 'functionNode'
    && expectedMediaFamily
    && !functionNodeMatchesCompositionMediaFamily(sourceNode, expectedMediaFamily)
  ) {
    return undefined;
  }

  const result = resolveNodeOutputAsset(sourceNode);

  if (!result) {
    return undefined;
  }

  return {
    node: sourceNode,
    result,
  };
}

function collectFunctionNodeInputs(
  node: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): Record<string, DynamicValue> {
  const config = node.data.functionNode;
  if (!config) {
    return {};
  }

  const portsById = new Map(config.contract.inputPorts.map((port) => [port.id, port]));
  const inputs: Record<string, DynamicValue> = {};

  for (const edge of edges) {
    if (edge.target !== node.id || !edge.targetHandle) {
      continue;
    }

    const port = portsById.get(edge.targetHandle);
    if (!port) {
      continue;
    }

    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;

    if (!sourceNode) {
      continue;
    }

    const value = resolveFunctionInputValue(sourceNode, nodesById, edges, edge.sourceHandle);
    inputs[port.id] = value;
    inputs[port.key] = value;
  }

  return inputs;
}

function resolveFunctionInputValue(
  sourceNode: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  sourceHandle?: string | null,
): DynamicValue {
  const asset = resolveNodeOutputAsset(sourceNode, sourceHandle);
  if (asset !== undefined) {
    return asset;
  }

  const routed = getNodeResultForFunctionRouting(sourceNode);
  if (!isEmptyFunctionInputValue(routed)) {
    return routed;
  }

  return evaluateNodeTextForMonitor(sourceNode.id, Array.from(nodesById.values()), edges, new Set());
}

function isEmptyFunctionInputValue(value: DynamicValue): boolean {
  return value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function collectImageInputFromSource(
  sourceId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[],
  visited: Set<string>,
): string | undefined {
  if (visited.has(sourceId)) {
    return undefined;
  }

  visited.add(sourceId);

  const node = nodesById.get(sourceId);
  if (!node) {
    return undefined;
  }

  if (node.type === 'settings') {
    for (const upstreamId of incoming.get(sourceId) ?? []) {
      const image = collectImageInputFromSource(upstreamId, nodesById, incoming, edges, visited);

      if (image) {
        return image;
      }
    }

    return undefined;
  }

  if (node.type === 'virtual') {
    for (const upstreamId of incoming.get(sourceId) ?? []) {
      const image = collectImageInputFromSource(upstreamId, nodesById, incoming, edges, visited);

      if (image) {
        return image;
      }
    }

    return undefined;
  }

  if (node.type === 'imageGen' || node.type === 'cropImageNode') {
    if ((node.data.mediaMode ?? 'generate') === 'import') {
      const sourceAssetUrl = resultValueAsMediaUrl(node.data.sourceAssetUrl);
      if (sourceAssetUrl) {
        return sourceAssetUrl;
      }
      const result = resultValueAsMediaUrl(node.data.result);
      if (result) {
        return result;
      }
      if (node.data.sourceBinItemId) {
        const item = useSourceBinStore.getState().getAllItems().find((item) => item.id === node.data.sourceBinItemId);
        if (item?.assetUrl) {
          return item.assetUrl;
        }
      }
      return undefined;
    }
    return resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'functionNode') {
    return node.data.resultType === 'image' && typeof node.data.result === 'string'
      ? node.data.result
      : undefined;
  }

  if (node.type === 'advancedImageEditor') {
    return typeof node.data.result === 'string' && node.data.result ? node.data.result : undefined;
  }

  if (node.type === 'expander') {
    const item = resolveExpandedItemFromNode(node, nodesById, edges);
    return item?.kind === 'image' ? item.value : undefined;
  }

  if (node.type === 'packageNode') {
    const pkg = resolvePackageNodeData(node.id, Array.from(nodesById.values()), edges);
    return pkg.image;
  }

  if (node.type === 'doodleNode') {
    const sketch = node.data.doodleSketch;
    return typeof sketch === 'string' && sketch ? sketch : undefined;
  }

  if (node.type === 'slimgNode') {
    return typeof node.data.result === 'string' && node.data.result ? node.data.result : undefined;
  }

  if (node.type === 'envelope') {
    const items = collectEnvelopeItemsForEnvelopeNode(node.id, Array.from(nodesById.values()), edges);
    const imgItem = items.find((item) => (item.kind === 'image' || item.kind === 'package') && item.value);
    return imgItem?.value;
  }

  return undefined;
}

function collectTextMediaInputFromSource(
  sourceId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[],
  visited: Set<string>,
): GeminiTextMediaInput | undefined {
  if (visited.has(sourceId)) {
    return undefined;
  }

  visited.add(sourceId);

  const node = nodesById.get(sourceId);
  if (!node) {
    return undefined;
  }

  if (node.type === 'settings' || node.type === 'virtual') {
    for (const upstreamId of incoming.get(sourceId) ?? []) {
      const input = collectTextMediaInputFromSource(upstreamId, nodesById, incoming, edges, visited);

      if (input) {
        return input;
      }
    }

    return undefined;
  }

  if (
    node.type === 'imageGen' ||
    node.type === 'cropImageNode' ||
    node.type === 'slimgNode' ||
    node.type === 'advancedImageEditor' ||
    node.type === 'audioGen' ||
    node.type === 'videoGen' ||
    node.type === 'composition' ||
    node.type === 'functionNode'
  ) {
    const url = resolveNodeOutputAsset(node);

    if (!url) {
      return undefined;
    }

    return {
      url,
      kind: resolveTextMediaKindForNode(node),
      mimeType: resolveNodeOutputMimeType(node),
      label: typeof node.data.sourceAssetName === 'string' ? node.data.sourceAssetName : node.data.modelId,
    };
  }

  if (node.type === 'expander') {
    const item = resolveExpandedItemFromNode(node, nodesById, edges);
    if (!item) return undefined;
    const kind = textMediaKindForExpandedItem(item);
    if (!kind) return undefined;
    return {
      url: item.value,
      kind,
      mimeType: item.mimeType,
      label: item.label,
    };
  }

  return undefined;
}

function resolveNodeOutputMimeType(node: AppNode): string | undefined {
  if (node.type === 'imageGen' || node.type === 'cropImageNode' || node.type === 'videoGen' || node.type === 'audioGen') {
    return (node.data.mediaMode ?? 'generate') === 'import'
      ? node.data.sourceAssetMimeType
      : node.data.resultMimeType ?? getDefaultGeminiTextMimeType(resolveTextMediaKindForNode(node));
  }

  if (node.type === 'composition') {
    return typeof node.data.resultMimeType === 'string'
      ? node.data.resultMimeType
      : node.data.resultType === 'package'
        ? 'application/zip'
        : 'video/mp4';
  }

  if (node.type === 'functionNode') {
    if (typeof node.data.resultMimeType === 'string') {
      return node.data.resultMimeType;
    }
    switch (node.data.resultType) {
      case 'image':
        return 'image/png';
      case 'video':
        return 'video/mp4';
      case 'audio':
        return 'audio/mpeg';
      case 'package':
        return 'application/zip';
      case 'text':
      case 'number':
      case 'boolean':
        return 'text/plain';
      case 'json':
      case 'list':
      case 'envelope':
        return 'application/json';
      default:
        return undefined;
    }
  }

  if (node.type === 'slimgNode' || node.type === 'advancedImageEditor') {
    return node.data.resultMimeType ?? 'image/png';
  }

  return undefined;
}

function resolveTextMediaKindForNode(node: AppNode): GeminiTextMediaInput['kind'] | undefined {
  switch (node.type) {
    case 'imageGen':
    case 'cropImageNode':
    case 'slimgNode':
    case 'advancedImageEditor':
      return 'image';
    case 'audioGen':
    case 'audioProcessNode':
      return 'audio';
    case 'videoGen':
      return 'video';
    case 'composition':
      return node.data.resultType === 'package' ? 'package' : 'composition';
    case 'functionNode':
      if (node.data.resultType === 'image' || node.data.resultType === 'audio' || node.data.resultType === 'video' || node.data.resultType === 'package') {
        return node.data.resultType;
      }
      return undefined;
    default:
      return undefined;
  }
}

function inferGeminiTextMediaKind(mimeType?: string): GeminiTextMediaInput['kind'] | undefined {
  const normalized = mimeType?.toLowerCase() ?? '';

  if (normalized.startsWith('image/')) {
    return 'image';
  }

  if (normalized.startsWith('audio/')) {
    return 'audio';
  }

  if (normalized.startsWith('video/')) {
    return 'video';
  }

  if (normalized === 'application/pdf' || normalized.startsWith('text/')) {
    return 'document';
  }

  return undefined;
}

function collectExecutionConfig(
  nodeId: string,
  currentNode: AppNode,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
): ExecutionConfig {
  const configNodes: NodeData[] = [];
  visitConfigNodes(nodeId, nodesById, incoming, new Set(), configNodes);
  const baseConfig = getDefaultExecutionConfigForNode(currentNode.type);

  const mergedConfig = configNodes.reduce<ExecutionConfig>(
    (current, data) => mergeExecutionConfig(current, data),
    baseConfig,
  );

  return mergeExecutionConfig(mergedConfig, currentNode.data);
}

function mergeExecutionConfig(current: ExecutionConfig, data: NodeData): ExecutionConfig {
  return {
    aspectRatio: getNodeAspectRatio((data.aspectRatio as string | undefined) ?? current.aspectRatio),
    steps: coerceNumber(data.steps, current.steps),
    durationSeconds: coerceNumber(data.durationSeconds, current.durationSeconds),
    videoResolution: getVideoResolution((data.videoResolution as string | undefined) ?? current.videoResolution),
    videoFrameRate: coerceFrameRate(data.videoFrameRate, current.videoFrameRate),
    imageOutputFormat: getImageOutputFormat(
      (data.imageOutputFormat as string | undefined) ?? current.imageOutputFormat,
    ),
    audioOutputFormat: getAudioOutputFormat(
      (data.audioOutputFormat as string | undefined) ?? current.audioOutputFormat,
    ),
  };
}

function coerceFrameRate(value: number | string | undefined, fallback: number): number {
  const next = coerceNumber(value, fallback);
  return [24, 25, 30, 60].includes(next) ? next : fallback;
}

function visitConfigNodes(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  visited: Set<string>,
  collected: NodeData[],
): void {
  if (visited.has(nodeId)) {
    return;
  }

  visited.add(nodeId);

  for (const sourceId of incoming.get(nodeId) ?? []) {
    visitConfigNodes(sourceId, nodesById, incoming, visited, collected);
    const sourceNode = nodesById.get(sourceId);

    if (sourceNode?.type === 'settings') {
      collected.push(sourceNode.data);
    }
  }
}

function coerceNumber(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

interface NodeExecutionResolution {
  /** Combined/prompt/reference signal views — one collection pass shared by planning and rendering. */
  promptSignals: NodePromptSignals;
  /** Numbered reference slot inputs (empty for node types without reference handles). */
  referenceSlots: ReferenceSlotInputs[];
  /** The iteration-0 execution context, reference groups already resolved. */
  context: ExecutionContext;
}

function collectReferenceSlotInputsForNode(
  node: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  promptSignals: NodePromptSignals,
): ReferenceSlotInputs[] {
  if (node.type === 'imageGen') {
    return collectImageReferenceSlotInputs(node.id, nodesById, edges, promptSignals);
  }
  if (node.type === 'videoGen') {
    return collectVideoReferenceSlotInputs(node, nodesById, edges, promptSignals);
  }
  return [];
}

/**
 * AUD-011: materializes the canonical numbered reference groups for one iteration and derives
 * the flat provider arrays FROM them, so structured collection and provider projection can
 * never drift. Direct list/envelope items routed to a numbered handle replace that slot's
 * image for the iteration; textual guidance resolves on the same iteration axis as the prompt.
 */
function applyResolvedReferenceGroups(
  context: ExecutionContext,
  node: AppNode,
  referenceSlots: ReferenceSlotInputs[],
  promptIndex: number,
  iterationItems: LoopIterationItem[] = [],
): ExecutionContext {
  if (referenceSlots.length === 0) {
    return context;
  }

  const iterationImages = new Map<number, string>();
  for (const { input, item } of iterationItems) {
    if (item.kind !== 'image') continue;
    const slot = referenceSlotNumberForHandle(node.type, input.targetHandle);
    if (slot !== undefined) {
      iterationImages.set(slot, item.value);
    }
  }
  const effectiveSlots = iterationImages.size === 0
    ? referenceSlots
    : referenceSlots.map((slot) => iterationImages.has(slot.slot)
        ? { ...slot, imageUrl: iterationImages.get(slot.slot) }
        : slot);

  const referenceGroups = resolveReferenceGroupsAtIndex(effectiveSlots, promptIndex);
  const next: ExecutionContext = { ...context };
  // Only reference-bearing contexts carry the field, so envelope ids of existing flows without
  // numbered references stay byte-identical and their resumes keep matching.
  if (referenceGroups.length > 0) {
    next.referenceGroups = referenceGroups;
  } else {
    delete next.referenceGroups;
  }
  if (node.type === 'imageGen') {
    next.editReferenceImageInputs = referenceGroups.flatMap((group) => group.imageUrl ? [group.imageUrl] : []);
  } else if (node.type === 'videoGen') {
    next.referenceImageInputs = referenceGroups.flatMap((group) => group.imageUrl
      ? [{ url: group.imageUrl, referenceType: group.referenceType ?? 'asset' }]
      : []);
  }
  return next;
}

function buildNodeExecutionResolution(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
): NodeExecutionResolution {
  const promptSignals = collectNodePromptSignals(node.id, nodes, edges);
  const nodesById = buildNodeMap(nodes);
  const referenceSlots = collectReferenceSlotInputsForNode(node, nodesById, edges, promptSignals);
  const context = applyResolvedReferenceGroups(
    buildExecutionContextForNode(node, nodes, edges, signalToTextAt(promptSignals.prompt, 0)),
    node,
    referenceSlots,
    0,
  );
  return { promptSignals, referenceSlots, context };
}

export function buildExecutionContextForNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  prompt = signalToTextAt(collectNodePromptSignals(node.id, nodes, edges).prompt, 0),
): ExecutionContext {
  const nodesById = buildNodeMap(nodes);
  const incoming = buildIncomingMap(edges);
  const visualSequence = collectEditorVisualSequence(node, nodesById);
  const config = collectExecutionConfig(node.id, node, nodesById, incoming);
  const workflow = sanitizeEditorProfessionalWorkflowState(node.data.editorProfessionalWorkflowState);
  const captionEmbeddingResolution = buildVideoCaptionEmbeddingPlan({
    workflow,
    exportPreset: getVideoExportPresetOption(node.data.editorExportPresetPlan?.presetId),
    frameRate: config.videoFrameRate,
  });
  const captionEmbedding = captionEmbeddingResolution.ok && !captionEmbeddingResolution.value
    ? undefined
    : captionEmbeddingResolution;

  return {
    prompt,
    nativeOutputDirectoryPath: useSourceBinStore.getState().nativeScratchDirectoryPath,
    textMediaInputs: collectTextMediaInputs(node, nodesById, edges),
    functionInputs: node.type === 'functionNode'
      ? collectFunctionNodeInputs(node, nodesById, edges)
      : undefined,
    editImageInput: collectUpstreamImageInput(node.id, nodesById, edges),
    refImageInput: collectUpstreamImageInputForHandles(node.id, ['refImage'], nodesById, edges),
    editMaskImageInput: collectImageMaskInput(node.id, nodesById, edges),
    // Both reference arrays are derived from the canonical groups by
    // applyResolvedReferenceGroups; these placeholders only keep the legacy empty-array shape
    // for node types without numbered reference handles.
    editReferenceImageInputs: [],
    loraWeightsJson: collectUpstreamLoraJson(node.id, nodesById, edges),
    audioSourceInput: collectUpstreamAudioInput(node.id, nodesById, edges),
    sourceVideoInput: collectUpstreamVideoInput(node.id, nodesById, edges),
    startImageInput: collectImageInputForHandle(node.id, ['video-start-frame'], nodesById, edges),
    endImageInput: collectImageInputForHandle(node.id, ['video-end-frame'], nodesById, edges),
    referenceImageInputs: [],
    extensionVideoInput: collectVideoExtensionInput(node.id, nodesById, edges),
    videoInput: collectResultInputForHandle(
      node.id,
      COMPOSITION_VIDEO_HANDLE,
      nodesById,
      edges,
      ['videoGen', 'composition', 'functionNode'],
      'video',
    )?.result,
    audioInputs: COMPOSITION_AUDIO_HANDLES.map((handle) => {
      const track = collectResultInputForHandle(
        node.id,
        handle,
        nodesById,
        edges,
        ['audioGen', 'audioProcessNode', 'functionNode'],
        'audio',
      );

      if (!track) {
        return undefined;
      }

      const settingsForTrack = getCompositionTrackSettings(node.data, handle);
      return {
        url: track.result,
        sourceNodeId: track.node.id,
        delayMs: settingsForTrack.offsetMs,
        volumePercent: settingsForTrack.volumePercent,
        enabled: settingsForTrack.enabled,
      };
    }).filter(
      (
        value,
      ): value is {
        url: string;
        sourceNodeId: string;
        delayMs: number;
        volumePercent: number;
        enabled: boolean;
      } => Boolean(value),
    ),
    useVideoAudio: Boolean(node.data.compositionUseVideoAudio),
    videoAudioVolumePercent: coerceNumber(node.data.compositionVideoAudioVolume, 100),
    visualSequenceClips: visualSequence.clips,
    videoRuntimeError: visualSequence.runtimeError,
    stageObjects: collectEditorStageObjects(node),
    sequenceAudioInputs: collectEditorAudioSequence(node, nodesById),
    sequenceLoudnessNormalization: node.data.editorProfessionalState?.loudnessNormalization,
    sequenceAudioMixerBuses: sanitizeEditorProfessionalVideoState(node.data.editorProfessionalState)?.audioBuses,
    nativeAssemblyManifest: node.data.editorRenderCacheAssemblyManifest,
    exportPresetId: node.data.editorExportPresetPlan?.presetId,
    ...(captionEmbedding ? { captionEmbedding } : {}),
    config,
  };
}

function stableNodeDataForExecution(node: AppNode): NodeData {
  const {
    nodeInstanceId: _nodeInstanceId,
    inputRevision: _inputRevision,
    envelopeItems: _envelopeItems,
    sourceBinItemId: _sourceBinItemId,
    resultInputSignature: _resultInputSignature,
    ...data
  } = stripRuntimeData(node).data;
  return data;
}

function flowResultCacheKeyForNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  iterationIndex = 0,
): string {
  return createFlowResultCacheKey({
    node,
    nodeData: stableNodeDataForExecution(node),
    context,
    settings,
    iterationIndex,
  });
}

function flowResultCacheSignatureFromKeys(keys: readonly string[]): string | undefined {
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0];
  return `vector:${JSON.stringify(keys)}`;
}

function isVectorResultCacheSignature(signature: string | undefined): boolean {
  return typeof signature === 'string' && signature.startsWith('vector:');
}

function persistedResultOutputCount(node: AppNode): number {
  return Math.max(1, projectedImageOutputCount(node), node.data.envelopeItems?.length ?? 0);
}

function flowResultCacheKeysForPlan(
  node: AppNode,
  plan: NodeExecutionPlan,
  settings: RuntimeSettingsSnapshot,
): string[] {
  return plan.iterations.flatMap((iteration) => {
    // The current runtime loop path publishes one Source Bin item per loop
    // iteration. Multi-result provider responses are the non-loop path and
    // publish one item per response output.
    const outputCount = plan.isLoopRun
      ? 1
      : Math.max(iteration.existingResumes?.length ?? 0, persistedResultOutputCount(node));
    return Array.from({ length: outputCount }, () => flowResultCacheKeyForNode(
      node,
      iteration.context,
      settings,
      iteration.index,
    ));
  });
}

function flowResultCacheSignatureForPlan(
  node: AppNode,
  plan: NodeExecutionPlan,
  settings: RuntimeSettingsSnapshot,
): string | undefined {
  return flowResultCacheSignatureFromKeys(flowResultCacheKeysForPlan(node, plan, settings));
}

function cacheEntryFromNode(
  node: AppNode,
  key: string,
): FlowResultCacheEntry | undefined {
  if (node.data.result === undefined || !node.data.resultType || !node.data.statusMessage) return undefined;
  return {
    key,
    nodeId: node.id,
    nodeInstanceId: node.data.nodeInstanceId,
    result: node.data.result,
    resultType: node.data.resultType,
    status: 'succeeded',
    resultMimeType: node.data.resultMimeType,
    resultExtension: node.data.resultExtension,
    resultFileName: node.data.resultFileName,
    resultOutputMetadata: node.data.resultOutputMetadata,
    sourceBinItemId: node.data.sourceBinItemId,
    statusMessage: node.data.statusMessage,
    createdAt: new Date().toISOString(),
  };
}

function cacheEntryFromEnvelopeItem(
  node: AppNode,
  item: EnvelopeItem,
  key: string,
  statusMessage: string,
): FlowResultCacheEntry | undefined {
  const result = deserializeResultValueFromContainer(item.value, item.kind);
  if (result === undefined) return undefined;
  return {
    key,
    nodeId: node.id,
    nodeInstanceId: node.data.nodeInstanceId,
    result,
    resultType: item.kind,
    status: 'succeeded',
    resultMimeType: item.mimeType,
    sourceBinItemId: item.sourceBinItemId,
    statusMessage,
    createdAt: new Date().toISOString(),
  };
}

interface NodeExecutionIterationPlan {
  index: number;
  context: ExecutionContext;
  iterationItems: LoopIterationItem[];
  envelopeId: string;
  existingResume: ValidatedSourceBinResume | undefined;
  existingResumes?: ValidatedSourceBinResume[];
}

interface NodeExecutionPlan {
  iterations: NodeExecutionIterationPlan[];
  isLoopRun: boolean;
  loopIterationCount: number;
  combinedIterationCount: number;
  noRunnableItems: boolean;
  stoppedLoopMessage?: string;
}

function releaseExecutionPlanResumes(plan: NodeExecutionPlan): void {
  const released = new Set<ValidatedSourceBinResume>();
  for (const iteration of plan.iterations) {
    for (const resume of [iteration.existingResume, ...(iteration.existingResumes ?? [])]) {
      if (!resume || released.has(resume)) continue;
      released.add(resume);
      resume.release?.();
    }
  }
}

interface PlannedNodeSpend {
  nodeId: string;
  nodeType: FlowNodeType;
  label: string;
  role: 'Dependency' | 'Target';
  telemetries: UsageTelemetry[];
}

interface ProviderSpendPlan {
  nodes: PlannedNodeSpend[];
  rollup: UsageRollup;
  /** Source Bin proofs approved as no-spend work for roots and reusable dependencies. */
  resumeProofs: Map<string, string>;
  /** Cardinality of every non-free provider dispatch in final confirmation. */
  providerCallCounts: Map<string, number>;
}

type SourceBinItemSnapshot = ReturnType<ReturnType<typeof useSourceBinStore.getState>['getAllItems']>[number];

interface ProviderRunSnapshot {
  nodes: AppNode[];
  edges: Edge[];
  settings: RuntimeSettingsSnapshot;
  sourceBinItems: SourceBinItemSnapshot[];
  fingerprint: string;
}

function cloneRuntimeSettings(settings: RuntimeSettingsSnapshot): RuntimeSettingsSnapshot {
  return {
    apiKeys: { ...settings.apiKeys },
    defaultModels: {
      text: { ...settings.defaultModels.text },
      image: { ...settings.defaultModels.image },
      video: { ...settings.defaultModels.video },
      audio: { ...settings.defaultModels.audio },
    },
    providerSettings: { ...settings.providerSettings },
  };
}

function stableRunPlanStringify(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') {
      return undefined;
    }
    if (entry === null || typeof entry !== 'object') {
      return entry;
    }
    if (entry instanceof Blob) {
      return { blobType: entry.type, blobSize: entry.size };
    }
    if (Array.isArray(entry)) {
      return entry.map(normalize);
    }

    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([key, nested]) => {
          const normalized = normalize(nested);
          return normalized === undefined ? [] : [[key, normalized]];
        }),
    );
  };

  return JSON.stringify(normalize(value));
}

function nodeDataForRunFingerprint(data: NodeData, isRootNode: boolean): Record<string, unknown> {
  const spendAffectingData = { ...data } as Record<string, unknown>;
  for (const key of [
    'onChange', 'onRun', 'onSelectAttempt', 'isRunning', 'error', 'statusMessage',
    // Runtime identity protects publication; it does not affect provider work.
    'nodeInstanceId', 'inputRevision',
  ]) {
    delete spendAffectingData[key];
  }
  if (isRootNode) {
    for (const key of [
      'result',
      'resultType',
      'resultMimeType',
      'resultExtension',
      'resultFileName',
      'resultOutputMetadata',
      'functionOutputs',
      'namedOutputs',
      'resultInputSignature',
      'resultHistory',
      'selectedResultId',
      'usage',
      'envelopeItems',
    ]) {
      delete spendAffectingData[key];
    }
  }
  return spendAffectingData;
}

function createProviderRunFingerprint(
  rootNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  settings: RuntimeSettingsSnapshot,
  sourceBinItems: SourceBinItemSnapshot[],
): string {
  return stableRunPlanStringify({
    rootNodeId,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      data: nodeDataForRunFingerprint(node.data, node.id === rootNodeId),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      data: edge.data,
    })),
    settings,
    sourceBinItems: sourceBinItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      assetId: item.assetId,
      assetUrl: item.assetUrl,
      scratchFileName: item.scratchFileName,
      nativeFilePath: item.nativeFilePath,
      text: item.text,
      mimeType: item.mimeType,
      sourceKey: item.sourceKey,
      originNodeId: item.originNodeId,
      envelopeId: item.envelopeId,
      envelopeIndex: item.envelopeIndex,
      envelopeLabel: item.envelopeLabel,
    })),
  });
}

function captureProviderRunSnapshot(rootNodeId: string): ProviderRunSnapshot {
  const flowState = useFlowStore.getState();
  const nodes = flowState.nodes.map((node) => ({ ...node, data: { ...node.data } }));
  const edges = flowState.edges.map((edge) => ({ ...edge }));
  const settings = cloneRuntimeSettings(useSettingsStore.getState());
  const sourceBinItems = useSourceBinStore.getState().getAllItems().map((item) => ({ ...item }));

  return {
    nodes,
    edges,
    settings,
    sourceBinItems,
    fingerprint: createProviderRunFingerprint(rootNodeId, nodes, edges, settings, sourceBinItems),
  };
}

function isProviderRunSnapshotCurrent(snapshot: ProviderRunSnapshot, rootNodeId: string): boolean {
  const current = captureProviderRunSnapshot(rootNodeId);
  return current.fingerprint === snapshot.fingerprint;
}

async function requestRunConfirmation(
  message: string,
  title: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }

  const confirmationStore = useConfirmationStore.getState();
  const confirmationPromise = confirmationStore.requestConfirmation(message, title);

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<boolean>((resolve) => {
    abortHandler = () => {
      const activeRequest = useConfirmationStore.getState().activeRequest;
      if (activeRequest?.message === message && activeRequest.title === title) {
        useConfirmationStore.getState().respond(false);
      }
      resolve(false);
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([confirmationPromise, abortPromise]);
  } finally {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

async function buildNodeExecutionPlan(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  sourceBinItems: ReturnType<ReturnType<typeof useSourceBinStore.getState>['getAllItems']>,
  signal?: AbortSignal,
  materializeResumes = true,
): Promise<NodeExecutionPlan> {
  const resolution = buildNodeExecutionResolution(node, nodes, edges);
  // The combined signal (unnumbered prompt + numbered reference guidance) remains the single
  // cardinality and diagnostics authority, so loop iteration counts are exactly what they were
  // before AUD-011 structured the reference groups.
  const promptSignal = resolution.promptSignals.combined;
  const blockingPromptDiagnostics = getBlockingSignalDiagnostics(promptSignal);
  if (blockingPromptDiagnostics.length > 0) {
    throw new Error(formatBlockingDiagnosticsMessage(blockingPromptDiagnostics));
  }

  const context = resolution.context;
  const loopInputs = collectListLoopInputs(node.id, nodes, edges);
  const promptIsEmptyContainer = (
    (promptSignal.kind === 'list' || promptSignal.kind === 'envelope')
    && Array.isArray(promptSignal.items)
    && promptSignal.items.length === 0
  );
  const noRunnableItems = promptIsEmptyContainer || loopInputs.some((input) => input.items.length === 0);

  if (noRunnableItems) {
    return {
      iterations: [],
      isLoopRun: true,
      loopIterationCount: 0,
      combinedIterationCount: 0,
      noRunnableItems: true,
    };
  }

  const loopMode = normalizeListLoopMode(node.data.listLoopMode);
  const promptSignalIterationCount = getSignalIterationCount(promptSignal);
  const routedLoopInputs = buildRoutedLoopInputs(loopInputs, promptSignal);
  const loopIterationCount = getLoopIterationCount(routedLoopInputs, loopMode);
  const combinedIterationCount = resolveLoopRunCount(routedLoopInputs, loopMode, promptSignal);
  const stableNodeData = stableNodeDataForExecution(node);

  if (combinedIterationCount === 0) {
    const envelopeId = await hashExecutionParameters(stableNodeData, context);
    const outputCount = persistedResultOutputCount(node);
    const existingResumes = await findExistingIterationAssets(
      sourceBinItems,
      node,
      envelopeId,
      0,
      outputCount,
      signal,
      materializeResumes,
    );
    return {
      iterations: [{
        index: 0,
        context,
        iterationItems: [],
        envelopeId,
        existingResume: existingResumes?.[0],
        existingResumes,
      }],
      isLoopRun: false,
      loopIterationCount,
      combinedIterationCount,
      noRunnableItems: false,
    };
  }

  const iterations: NodeExecutionIterationPlan[] = [];
  let stoppedLoopMessage: string | undefined;
  for (let index = 0; index < combinedIterationCount; index += 1) {
    const breakDecision = shouldBreakLoopAtIteration(node.id, nodes, edges, index);
    if (breakDecision.shouldBreak) {
      stoppedLoopMessage = `Stopped before iteration ${index + 1}/${combinedIterationCount}${breakDecision.reason ? `: ${breakDecision.reason}` : ''}`;
      break;
    }

    const { directIndex, promptIndex } = resolveAllCombinationSubIndices(
      index,
      loopIterationCount,
      promptSignalIterationCount,
      loopMode,
    );
    const iterationItems = loopIterationCount > 0
      ? buildLoopIterationItems(routedLoopInputs, directIndex, loopMode)
      : [];
    const iterationContext = applyResolvedReferenceGroups(
      applyListItemsToExecutionContext(
        {
          ...context,
          prompt: promptSignalIterationCount > 0 ? signalToTextAt(resolution.promptSignals.prompt, promptIndex) : context.prompt,
        },
        node,
        iterationItems,
      ),
      node,
      resolution.referenceSlots,
      promptIndex,
      iterationItems,
    );
    const envelopeId = await hashExecutionParameters(stableNodeData, iterationContext);
    const existingResumes = await findExistingIterationAssets(
      sourceBinItems,
      node,
      envelopeId,
      index,
      1,
      signal,
      materializeResumes,
    );
    iterations.push({
      index,
      context: iterationContext,
      iterationItems,
      envelopeId,
      existingResume: existingResumes?.[0],
      existingResumes,
    });
  }

  return {
    iterations,
    isLoopRun: true,
    loopIterationCount,
    combinedIterationCount,
    noRunnableItems: false,
    stoppedLoopMessage,
  };
}

async function findExistingIterationAsset(
  sourceBinItems: ReturnType<ReturnType<typeof useSourceBinStore.getState>['getAllItems']>,
  node: AppNode,
  envelopeId: string,
  envelopeIndex: number,
  signal?: AbortSignal,
  materialize = true,
): Promise<ValidatedSourceBinResume | undefined> {
  const candidates = sourceBinItems.filter((item) => (
    item.originNodeId === node.id
    && item.envelopeId === envelopeId
    && item.envelopeIndex === envelopeIndex
  ));

  for (const candidate of candidates) {
    const resume = await validateSourceBinResumeItem(candidate, projectedResultType(node), signal, {
      materializeStoredAsset: materialize,
    });
    if (resume) {
      return resume;
    }
  }

  return undefined;
}

async function findExistingIterationAssets(
  sourceBinItems: ReturnType<ReturnType<typeof useSourceBinStore.getState>['getAllItems']>,
  node: AppNode,
  envelopeId: string,
  envelopeIndex: number,
  outputCount: number,
  signal?: AbortSignal,
  materialize = true,
): Promise<ValidatedSourceBinResume[] | undefined> {
  const resumes: ValidatedSourceBinResume[] = [];
  for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
    const resume = await findExistingIterationAsset(
      sourceBinItems,
      node,
      envelopeId,
      envelopeIndex * outputCount + outputIndex,
      signal,
      materialize,
    );
    if (!resume) {
      for (const prior of resumes) prior.release?.();
      return undefined;
    }
    resumes.push(resume);
  }
  return resumes;
}

function collectExecutionOrder(rootNodeId: string, nodes: AppNode[], edges: Edge[]): string[] {
  const nodesById = buildNodeMap(nodes);
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) return;
    if (nodeId !== rootNodeId && shouldReuseExistingNodeOutput(node)) return;
    // Traverse passive routing/container nodes as well as runnable effective
    // sources. Their projected outputs determine downstream cardinality during
    // spend planning (for example Seedream -> Envelope -> image root).
    const dependencyIds = new Set([
      ...getExecutionDependencies(node, edges, nodesById),
      ...edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source),
    ]);
    for (const dependencyId of dependencyIds) {
      visit(dependencyId);
    }
    order.push(nodeId);
  };

  visit(rootNodeId);
  return order;
}

function projectedResultValue(
  node: AppNode,
  iteration: NodeExecutionIterationPlan,
  telemetry: UsageTelemetry | undefined,
  outputIndex = 0,
): string {
  const kind = projectedResultType(node);
  if (kind === 'text') {
    const projectedTokens = Math.max(1, Math.min(512, telemetry?.outputTokens ?? 32));
    return Array.from({ length: projectedTokens }, () => 'projected').join(' ');
  }
  // Provider-derived loop controls are not knowable during spend planning.
  // Project the non-breaking branch so the final approval covers every bounded
  // downstream call that runtime may execute.
  if (kind === 'boolean') return 'false';
  if (kind === 'number') return '0';
  if (kind === 'json' || kind === 'list' || kind === 'envelope') return '{}';
  if (kind === 'package') return `projected-package:${node.id}:${iteration.index}:${outputIndex}`;
  return `data:${getResultMimeType(kind)};base64,planning-${node.id}-${iteration.index}-${outputIndex}`;
}

function applyProjectedNodeOutput(
  node: AppNode,
  plan: NodeExecutionPlan,
  telemetryByIndex: Map<number, UsageTelemetry>,
): AppNode {
  if (plan.noRunnableItems || plan.iterations.length === 0) {
    return {
      ...node,
      data: { ...node.data, result: undefined, envelopeItems: [] },
    };
  }

  const kind = projectedResultType(node);
  const outputCount = plan.isLoopRun ? projectedImageOutputCount(node) : Math.max(
    persistedResultOutputCount(node),
    plan.iterations[0]?.existingResumes?.length ?? 0,
  );
  const items = plan.iterations.flatMap((iteration) => Array.from({ length: outputCount }, (_, outputIndex) => {
    const existingResume = iteration.existingResumes?.[outputIndex] ?? iteration.existingResume;
    return {
      id: `planning-${node.id}-${iteration.index}-${outputIndex}`,
      index: iteration.index * outputCount + outputIndex,
      kind,
      label: `Planned ${kind} ${iteration.index + 1}${outputCount > 1 ? `.${outputIndex + 1}` : ''}`,
      value: existingResume?.value
        ?? projectedResultValue(node, iteration, telemetryByIndex.get(iteration.index), outputIndex),
      mimeType: existingResume?.mimeType ?? getResultMimeType(kind),
      sourceBinItemId: existingResume?.item.id,
      sourceNodeId: node.id,
    } satisfies EnvelopeItem;
  }));
  const firstItem = items[0];

  return {
    ...node,
    data: {
      ...node.data,
      result: firstItem.value,
      resultType: firstItem.kind,
      resultMimeType: firstItem.mimeType,
      envelopeItems: plan.isLoopRun || outputCount > 1 ? items : undefined,
    },
  };
}

function isPaidProviderTelemetry(telemetry: UsageTelemetry): boolean {
  return telemetry.provider !== 'local' && telemetry.costUsd !== 0;
}

/** Keep planning and runtime authorization on the same dispatch class. */
function providerDispatchTelemetry(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
): UsageTelemetry | undefined {
  const estimated = estimateNodeExecutionTelemetry(node, context, settings);
  if (estimated) return estimated;

  const provider = typeof node.data.provider === 'string' ? node.data.provider : undefined;
  // Android execution is on-device and has no provider spend. An unmapped
  // provider is deliberately unknown-cost and therefore consent-requiring.
  if (!provider || provider === 'android') return undefined;
  return {
    source: 'estimate',
    confidence: 'unknown',
    provider,
    modelId: typeof node.data.modelId === 'string' ? node.data.modelId : undefined,
    notes: ['No catalog rate is available; provider cost is unknown.'],
  };
}

function requiresApprovedProviderDispatch(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
): boolean {
  const telemetry = providerDispatchTelemetry(node, context, settings);
  return Boolean(telemetry && isPaidProviderTelemetry(telemetry));
}

function plannedResumeKey(nodeId: string, envelopeId: string, envelopeIndex: number): string {
  return `${nodeId}:${envelopeId}:${envelopeIndex}`;
}

function addPlanResumeProofs(
  resumeProofs: Map<string, string>,
  node: AppNode,
  plan: NodeExecutionPlan,
): void {
  const outputCount = plan.isLoopRun ? 1 : Math.max(
    persistedResultOutputCount(node),
    plan.iterations[0]?.existingResumes?.length ?? 0,
  );
  for (const iteration of plan.iterations) {
    const resumes = iteration.existingResumes ?? (iteration.existingResume ? [iteration.existingResume] : []);
    for (let outputIndex = 0; outputIndex < resumes.length; outputIndex += 1) {
      const resume = resumes[outputIndex];
      resumeProofs.set(
        plannedResumeKey(node.id, iteration.envelopeId, iteration.index * outputCount + outputIndex),
        resume.proof,
      );
    }
  }
}

async function buildProviderSpendPlan(
  rootNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  settings: RuntimeSettingsSnapshot,
  sourceBinItems: SourceBinItemSnapshot[],
  signal?: AbortSignal,
  forceRoot = false,
): Promise<ProviderSpendPlan> {
  let planningNodes = nodes.map((node) => ({ ...node, data: { ...node.data } }));
  const order = collectExecutionOrder(rootNodeId, planningNodes, edges);
  const plannedNodes: PlannedNodeSpend[] = [];
  const resumeProofs = new Map<string, string>();
  const providerCallCounts = new Map<string, number>();

  for (const currentId of order) {
    if (signal?.aborted) {
      throw new DOMException('The run was cancelled.', 'AbortError');
    }
    const node = planningNodes.find((candidate) => candidate.id === currentId);
    if (!node) continue;
    if (!canRunNode(node)) {
      // Materialize passive envelope routing against the already-projected
      // upstream nodes before a paid downstream plan reads its cardinality.
      if (node.type === 'envelope') {
        const envelopeItems = collectEnvelopeItemsForEnvelopeNode(node.id, planningNodes, edges);
        planningNodes = planningNodes.map((candidate) => candidate.id === node.id
          ? { ...candidate, data: { ...candidate.data, envelopeItems } }
          : candidate);
      }
      continue;
    }
    // Signature-bound Source Bin results are reusable for roots and safe dependencies.
    const plan = await buildNodeExecutionPlan(
      node,
      planningNodes,
      edges,
      node.id === rootNodeId
        ? (forceRoot ? [] : sourceBinItems)
        : (node.data.resultInputSignature ? sourceBinItems : []),
      signal,
      false,
    );
    try {
      if (signal?.aborted) {
        throw new DOMException('The run was cancelled.', 'AbortError');
      }
      const telemetryByIndex = new Map<number, UsageTelemetry>();
      const paidTelemetries: UsageTelemetry[] = [];
      const expectedSignature = flowResultCacheSignatureForPlan(node, plan, settings);
      for (const iteration of plan.iterations) {
        // A persisted Source Bin item is reusable for a dependency only when the node's
        // signature still describes this exact resolved context and provider settings. This
        // protects reopened projects from accidentally feeding an old result downstream.
        if (iteration.existingResume && node.data.resultInputSignature !== expectedSignature) {
          for (const resume of iteration.existingResumes ?? [iteration.existingResume]) resume.release?.();
          iteration.existingResume = undefined;
          iteration.existingResumes = undefined;
        }
        if (iteration.existingResume) {
          addPlanResumeProofs(resumeProofs, node, {
            iterations: [iteration],
            isLoopRun: plan.isLoopRun,
            loopIterationCount: plan.loopIterationCount,
            combinedIterationCount: plan.combinedIterationCount,
            noRunnableItems: plan.noRunnableItems,
          });
          continue;
        }
        const telemetry = providerDispatchTelemetry(node, iteration.context, settings);
        if (!telemetry) continue;
        telemetryByIndex.set(iteration.index, telemetry);
        if (requiresApprovedProviderDispatch(node, iteration.context, settings)) {
          // `plan` is built after projected provider envelopes have traversed
          // passive Envelope nodes. Its iterations therefore represent the
          // real routed axes (including paired/broadcast/cartesian behavior),
          // not a lossy ancestry-wide output multiplier.
          paidTelemetries.push(telemetry);
          providerCallCounts.set(node.id, (providerCallCounts.get(node.id) ?? 0) + 1);
        }
      }

      if (paidTelemetries.length > 0) {
        plannedNodes.push({
          nodeId: node.id,
          nodeType: node.type,
          label: String(node.data.customTitle ?? node.data.title ?? node.id),
          role: node.id === rootNodeId ? 'Target' : 'Dependency',
          telemetries: paidTelemetries,
        });
      }

      const projected = applyProjectedNodeOutput(node, plan, telemetryByIndex);
      planningNodes = planningNodes.map((candidate) => candidate.id === currentId ? projected : candidate);
    } finally {
      releaseExecutionPlanResumes(plan);
    }
  }

  const telemetries = plannedNodes.flatMap((entry) => entry.telemetries);
  return {
    nodes: plannedNodes,
    rollup: aggregateUsageTelemetries(telemetries),
    resumeProofs,
    providerCallCounts,
  };
}

/**
 * A Source Library item can retain an HTTP/native/stored-asset locator whose
 * bytes change without altering the item record. Re-read each root resume at
 * the final planning boundary so the approval is tied to the exact bounded
 * content that dispatch will be allowed to consume.
 */
async function areApprovedSourceBinResumesCurrent(
  rootNodeId: string,
  spendPlan: ProviderSpendPlan,
  snapshot: ProviderRunSnapshot,
  signal?: AbortSignal,
): Promise<boolean> {
  if (spendPlan.resumeProofs.size === 0) return true;
  const currentProofs = new Map<string, string>();
  const order = collectExecutionOrder(rootNodeId, snapshot.nodes, snapshot.edges);
  for (const nodeId of order) {
    const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !canRunNode(node) || !node.data.resultInputSignature) continue;
    const plan = await buildNodeExecutionPlan(
      node,
      snapshot.nodes,
      snapshot.edges,
      snapshot.sourceBinItems,
      signal,
      false,
    );
    try {
      addPlanResumeProofs(currentProofs, node, plan);
    } finally {
      releaseExecutionPlanResumes(plan);
    }
  }
  return [...spendPlan.resumeProofs].every(([key, proof]) => currentProofs.get(key) === proof);
}

function formatProviderSpendPlan(plan: ProviderSpendPlan): string {
  const lines = plan.nodes.map((entry) => {
    const rollup = aggregateUsageTelemetries(entry.telemetries);
    const summary = formatRollupSummary(rollup, `${entry.telemetries.length} provider call${entry.telemetries.length === 1 ? '' : 's'}`);
    return `${entry.role} ${entry.nodeType} “${entry.label}”: ${summary}`;
  });
  return [
    'Planned paid provider work:',
    ...lines,
    '',
    formatRollupSummary(plan.rollup, 'Total estimated provider spend'),
    '',
    'Only continue if you want to spend against the configured providers now.',
  ].join('\n');
}

function formatBlockingDiagnosticsMessage(diagnostics: Array<{ message: string; nodeId?: string; edgeId?: string }>): string {
  const [first, ...rest] = diagnostics;
  const location = first?.nodeId ? `Node ${first.nodeId}: ` : first?.edgeId ? `Edge ${first.edgeId}: ` : '';
  const suffix = rest.length > 0 ? ` (${rest.length} more issue${rest.length === 1 ? '' : 's'} in Diagnostics.)` : '';
  return `${location}${first?.message ?? 'Flow diagnostics found a blocking issue.'}${suffix}`;
}

function buildEnvelopeItemFromExecution(
  nodeId: string,
  index: number,
  execution: {
    result: import('../types/flow').ResultValue;
    resultType: ResultType;
    statusMessage: string;
    usage?: UsageTelemetry;
    mimeType?: string;
  },
  iterationItems: LoopIterationItem[] = [],
): EnvelopeItem {
  return {
    id: `${nodeId}-envelope-${Date.now()}-${index}`,
    index,
    kind: execution.resultType,
    label: buildEnvelopeItemLabel(execution.resultType, index, iterationItems),
    value: serializeResultValueForContainer(execution.result, execution.resultType),
    mimeType: execution.mimeType ?? getResultMimeType(execution.resultType),
    sourceNodeId: nodeId,
    usage: execution.usage,
  };
}

function projectedResultType(node: AppNode): ResultType {
  switch (node.type) {
    case 'imageGen':
    case 'cropImageNode':
      return 'image';
    case 'videoGen':
    case 'composition':
      return 'video';
    case 'audioGen':
    case 'audioProcessNode':
      return 'audio';
    case 'transcriptionNode':
      return 'text';
    case 'visionVerifyNode':
      return 'boolean';
    case 'functionNode':
      return ['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope'].includes(String(node.data.resultType))
        ? node.data.resultType as ResultType
        : 'text';
    default:
      return 'text';
  }
}

function buildEnvelopeItemFromSourceBinItem(resume: ValidatedSourceBinResume): EnvelopeItem {
  const { item } = resume;
  return {
    id: `envelope-${item.id}`,
    index: item.envelopeIndex ?? 0,
    kind: resume.kind,
    label: item.label,
    value: resume.value,
    mimeType: resume.mimeType,
    sourceBinItemId: item.id,
    sourceNodeId: item.originNodeId ?? '',
  };
}

function buildEnvelopeItemLabel(
  kind: ResultType,
  index: number,
  iterationItems: LoopIterationItem[],
): string {
  const baseLabel = `${capitalizeResultKind(kind)} ${index + 1}`;

  if (iterationItems.length < 2) {
    return baseLabel;
  }

  const dimensions = iterationItems
    .map(formatLoopDimensionLabel)
    .filter((label) => label.length > 0);

  return dimensions.length > 0 ? `${baseLabel} · ${dimensions.join(' + ')}` : baseLabel;
}

function formatLoopDimensionLabel(iterationItem: LoopIterationItem): string {
  const handleLabel = formatLoopTargetHandleLabel(iterationItem.input.targetHandle);

  if (handleLabel) {
    return `${handleLabel} ${iterationItem.item.index + 1}`;
  }

  return iterationItem.item.label;
}

function formatLoopTargetHandleLabel(targetHandle?: string | null): string | undefined {
  switch (targetHandle) {
    case 'video-prompt':
      return 'Prompt';
    case 'video-start-frame':
      return 'Start';
    case 'video-end-frame':
      return 'End';
    case 'video-reference-1':
      return 'Reference 1';
    case 'video-reference-2':
      return 'Reference 2';
    case 'video-reference-3':
      return 'Reference 3';
    case 'video-source-video':
      return 'Source Video';
    case 'image-edit-source':
      return 'Source';
    case 'image-mask':
      return 'Mask';
    case 'image-reference-1':
      return 'Reference 1';
    case 'image-reference-2':
      return 'Reference 2';
    case 'image-reference-3':
      return 'Reference 3';
    case 'composition-video':
      return 'Video';
    case 'composition-audio-1':
      return 'Audio 1';
    case 'composition-audio-2':
      return 'Audio 2';
    case 'composition-audio-3':
      return 'Audio 3';
    case 'composition-audio-4':
      return 'Audio 4';
    default:
      return undefined;
  }
}

function aggregateEnvelopeUsage(items: EnvelopeItem[]): UsageTelemetry | undefined {
  const usages = items.map((item) => item.usage).filter((usage): usage is UsageTelemetry => Boolean(usage));

  if (usages.length === 0) {
    return undefined;
  }

  const sumField = (field: keyof UsageTelemetry): number | undefined => {
    const values = usages.map((usage) => usage[field]).filter((value): value is number => typeof value === 'number');
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
  };

  const costValues = usages.map((usage) => usage.costUsd);
  const allCostsKnown = costValues.every((value) => typeof value === 'number');

  return {
    source: 'actual',
    confidence: usages.every((usage) => usage.confidence === 'measured') ? 'measured' : 'unknown',
    costUsd: allCostsKnown
      ? costValues.reduce((total, value) => total + (value ?? 0), 0)
      : undefined,
    inputTokens: sumField('inputTokens'),
    outputTokens: sumField('outputTokens'),
    totalTokens: sumField('totalTokens'),
    characters: sumField('characters'),
    durationSeconds: sumField('durationSeconds'),
    imageCount: sumField('imageCount') ?? (items.filter((item) => item.kind === 'image').length || undefined),
    notes: [`Aggregated from ${items.length} envelope iteration${items.length === 1 ? '' : 's'}.`],
  };
}

function capitalizeResultKind(kind: ResultType): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function getResultMimeType(kind: ResultType): string {
  switch (kind) {
    case 'image':
      return 'image/png';
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    case 'package':
      return 'application/zip';
    case 'text':
    case 'number':
      return 'text/plain';
    case 'boolean':
      return 'application/x.boolean';
    case 'json':
    case 'list':
    case 'envelope':
      return 'application/json';
  }
}

function isAssetSourceKind(kind: ResultType): kind is Extract<ResultType, Exclude<EditorSourceKind, 'text'>> {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'package';
}

function getDefaultExecutionConfigForNode(nodeType: FlowNodeType): ExecutionConfig {
  if (nodeType === 'videoGen') {
    return {
      ...DEFAULT_EXECUTION_CONFIG,
      aspectRatio: '16:9',
    };
  }

  return DEFAULT_EXECUTION_CONFIG;
}

let centerOnNodeCallback: ((id: string) => void) | null = null;

export { evaluateNodeTextForMonitor } from '../lib/listNodes';

export const useFlowStore = create<FlowState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      bookmarkSidebarOpen: true,
      setBookmarkSidebarOpen: (bookmarkSidebarOpen) => set({ bookmarkSidebarOpen }),
      centerOnNode: (id) => centerOnNodeCallback?.(id),
      registerCenterOnNodeCallback: (cb) => { centerOnNodeCallback = cb; },
      onSourceBinItemRemoved: (id, removedItem) => {
        set((state) => {
          const updatedNodes = state.nodes.map((node) => {
            let nodeUpdated = false;
            const nextData = { ...node.data };

            // 1. Clear node results or imported assets matching the removed item
            if (nextData.result && (nextData.result === removedItem?.assetUrl || nextData.result === removedItem?.text)) {
              nextData.result = undefined;
              nextData.resultType = undefined;
              nextData.resultMimeType = undefined;
              nextData.resultExtension = undefined;
              nextData.resultFileName = undefined;
              nodeUpdated = true;
            }
            if (nextData.sourceAssetUrl && nextData.sourceAssetUrl === removedItem?.assetUrl) {
              nextData.sourceAssetUrl = undefined;
              nextData.sourceAssetId = undefined;
              nextData.sourceAssetName = undefined;
              nextData.sourceAssetMimeType = undefined;
              nodeUpdated = true;
            }

            // 2. Filter envelopeItems
            if (Array.isArray(nextData.envelopeItems)) {
              const previousLength = nextData.envelopeItems.length;
              const filtered = nextData.envelopeItems.filter((item) => {
                if (item.sourceBinItemId === id) return false;
                if (removedItem?.assetUrl && item.value === removedItem.assetUrl) return false;
                return true;
              });

              if (filtered.length !== previousLength) {
                // Re-index remaining envelope items sequentially
                nextData.envelopeItems = filtered.map((item, idx) => ({
                  ...item,
                  index: idx,
                }));
                nodeUpdated = true;
              }
            }

            // 3. Filter resultHistory
            if (Array.isArray(nextData.resultHistory)) {
              const previousLength = nextData.resultHistory.length;
              const filteredHistory = nextData.resultHistory.filter((attempt) => {
                if (removedItem?.assetUrl && attempt.result === removedItem.assetUrl) return false;
                return true;
              });

              if (filteredHistory.length !== previousLength) {
                nextData.resultHistory = filteredHistory;
                nodeUpdated = true;

                // Handle selected result pointer
                if (nextData.selectedResultId && !filteredHistory.some((h) => h.id === nextData.selectedResultId)) {
                  nextData.selectedResultId = undefined;
                  if (filteredHistory.length > 0) {
                    const lastAttempt = filteredHistory[filteredHistory.length - 1];
                    nextData.result = lastAttempt.result;
                    nextData.selectedResultId = lastAttempt.id;
                  } else {
                    nextData.result = undefined;
                  }
                }
              }
            }

            if (nodeUpdated) {
              return { ...node, data: nextData };
            }
            return node;
          });

          return {
            nodes: attachRuntimeDataToNodes(updatedNodes, () => state),
          };
        });
      },
      onNodesChange: async (changes: NodeChange<AppNode>[]) => {
        const removedNodeIds = changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id);

        if (removedNodeIds.length > 0) {
          invalidateHydratedRunGraphs(removedNodeIds);
          await confirmGeneratedAssetCleanupForRemovedNodes(removedNodeIds);
        }

        set({
          nodes: attachRuntimeDataToNodes(applyNodeChanges(changes, get().nodes), get),
        });
      },
      onEdgesChange: (changes: EdgeChange[]) => {
        const previousEdges = get().edges;
        const removedEdgeIds = changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id);
        const changedEdges = applyEdgeChanges(changes, previousEdges);
        const prunedEdges = prunePortalExitEdgesForRemovedEntryLeads(
          get().nodes,
          previousEdges,
          changedEdges,
          removedEdgeIds,
        );

        const { nodes, edges } = normalizeFlowEdgesWithCompositionDiagnostics(get().nodes, prunedEdges);
        set({ nodes, edges });
      },
      onConnect: (connection: Connection) => {
        const normalizedImageConnection = normalizeImageConnectionTargetHandle(
          connection,
          get().nodes,
          get().edges,
        );
        const normalizedVideoConnection = normalizeVideoImageConnectionTargetHandle(
          normalizedImageConnection,
          get().nodes,
          get().edges,
        );
        const normalizedConnection = normalizeCompositionConnectionTargetHandle(
          normalizedVideoConnection,
          get().nodes,
          get().edges,
        );
        const listValidation = validateListConnection(normalizedConnection, get().nodes, get().edges);

        if (!listValidation.connection) {
          if (normalizedConnection.target && listValidation.error) {
            get().patchNodeData(normalizedConnection.target, {
              error: listValidation.error,
              statusMessage: undefined,
            });
          }
          return;
        }

        const prunedEdges = replaceExclusiveVideoFrameEdges(
          listValidation.connection,
          get().nodes,
          listValidation.edges,
        );
        // Ports that depend on the edge set (e.g. Composition audio tracks) must see this
        // candidate connection as already present, or an authored-count-1 node with no other
        // connections would reject its own first higher-track connection (FBL-019). The candidate
        // carries a synthetic id so maxConnections/connectionGroup counting can exclude it as "not
        // yet an existing connection", matching how `annotateFlowEdge` treats an edge against a
        // context that already contains itself.
        const candidateEdge = { ...listValidation.connection, id: `candidate-${makeFlowId()}` } as Edge;
        const contractValidation = validateFlowConnection(candidateEdge, {
          nodes: get().nodes,
          edges: [...prunedEdges, candidateEdge],
        });

        if (!contractValidation.valid) {
          if (normalizedConnection.target && contractValidation.reason) {
            get().patchNodeData(normalizedConnection.target, {
              error: contractValidation.reason,
              statusMessage: undefined,
            });
          }
          return;
        }

        if (normalizedConnection.target) {
          get().patchNodeData(normalizedConnection.target, {
            error: undefined,
            statusMessage: undefined,
          });
        }

        const nextEdges = normalizeFlowEdges(get().nodes, addEdge(listValidation.connection, prunedEdges));
        set({ nodes: normalizeCompositionAudioTrackCounts(get().nodes, nextEdges), edges: nextEdges });
      },
      addNode: (type, position, initialData) => {
        const settings = useSettingsStore.getState();
        if (type === 'portal') {
          const pairId = `portal-pair-${makeFlowId()}`;
          const entryId = `portal-entry-${makeFlowId()}`;
          const exitId = `portal-exit-${makeFlowId()}`;
          const entry = attachRuntimeData(
            {
              id: entryId,
              type,
              position,
              data: {
                ...createInitialNodeData(type, settings),
                ...makeNodeIdentity(),
                portalRole: 'entry',
                portalPairId: pairId,
                portalLabel: 'Portal pair',
              },
            },
            get,
          );
          const exit = attachRuntimeData(
            {
              id: exitId,
              type,
              position: {
                x: position.x + 420,
                y: position.y,
              },
              data: {
                ...createInitialNodeData(type, settings),
                ...makeNodeIdentity(),
                portalRole: 'exit',
                portalPairId: pairId,
                portalLabel: 'Portal pair',
              },
            },
            get,
          );

          set({ nodes: [...get().nodes, entry, exit] });
          return entryId;
        }

        const id = `${type}-${makeFlowId()}`;
        const node = attachRuntimeData(
          {
            id,
            type,
            position,
            data: {
              ...(combineNodeDataPatches(createInitialNodeData(type, settings), initialData) ?? {}),
              ...makeNodeIdentity(),
            },
          },
          get,
        );

        set({ nodes: [...get().nodes, node] });
        return id;
      },
      insertTemplate: (template, position, options) => {
        const settings = useSettingsStore.getState();
        const idMap = new Map<string, string>();
        
        const newNodes = template.nodes.map(templateNode => {
          const originalId = templateNode.id!;
          const newId = `${templateNode.type}-${makeFlowId()}`;
          idMap.set(originalId, newId);
          
          return attachRuntimeData(
            {
              id: newId,
              type: templateNode.type as AppNode['type'],
              position: {
                x: position.x + (templateNode.position?.x ?? 0),
                y: position.y + (templateNode.position?.y ?? 0)
              },
              data: {
                ...(combineNodeDataPatches(createInitialNodeData(templateNode.type as AppNode['type'], settings), templateNode.data) ?? {}),
                ...makeNodeIdentity(),
              },
            },
            get
          );
        });

        const newEdges = template.edges.map(templateEdge => ({
          ...templateEdge,
          id: `e-${makeFlowId()}`,
          source: idMap.get(templateEdge.source!) || templateEdge.source!,
          target: idMap.get(templateEdge.target!) || templateEdge.target!,
        })) as Edge[];

        const nextNodes = [...get().nodes, ...newNodes];
        const normalized = normalizeFlowEdgesWithCompositionDiagnostics(nextNodes, [...get().edges, ...newEdges]);
        const settledNodes = normalizeCompositionAudioTrackCounts(normalized.nodes, normalized.edges);
        const select = options?.select ?? false;
        const newNodeIds = new Set(newNodes.map((node) => node.id));
        const newEdgeIds = new Set(newEdges.map((edge) => edge.id));
        set({
          nodes: select
            ? settledNodes.map((node) => ({ ...node, selected: newNodeIds.has(node.id) }))
            : settledNodes,
          edges: select
            ? normalized.edges.map((edge) => ({ ...edge, selected: newEdgeIds.has(edge.id) }))
            : normalized.edges,
        });
      },
      copySelection: () => {
        const clipboard = serializeFlowSelection(get().nodes, get().edges);
        if (!clipboard) {
          return false;
        }
        flowClipboard = clipboard;
        return true;
      },
      cutSelection: async () => {
        if (!get().copySelection()) {
          return false;
        }
        return await get().deleteSelection();
      },
      pasteClipboard: (position) => {
        const pasted = pasteFlowClipboard({
          clipboard: flowClipboard,
          existingNodes: get().nodes,
          existingEdges: get().edges,
          position,
          createId: (prefix) => `${prefix}-${makeFlowId()}`,
        });

        if (pasted.nodes.length === 0) {
          return false;
        }

        const pastedNodeIds = new Set(pasted.nodes.map((node) => node.id));
        const nodesWithIdentity = pasted.nextNodes.map((node) => (
          pastedNodeIds.has(node.id)
            ? {
              ...node,
              data: {
                ...node.data,
                ...makeNodeIdentity(),
              },
            }
            : node
        ));

        const normalized = normalizeFlowEdgesWithCompositionDiagnostics(nodesWithIdentity, pasted.nextEdges);
        set({
          nodes: normalizeCompositionAudioTrackCounts(attachRuntimeDataToNodes(normalized.nodes, get), normalized.edges),
          edges: normalized.edges,
        });
        return true;
      },
      deleteSelection: async () => {
        const selectedNodeIds = new Set(get().nodes.filter((node) => node.selected).map((node) => node.id));
        const selectedEdgeIds = new Set(get().edges.filter((edge) => edge.selected).map((edge) => edge.id));

        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
          return false;
        }

        invalidateHydratedRunGraphs(selectedNodeIds);
        await confirmGeneratedAssetCleanupForRemovedNodes(selectedNodeIds);

        const nextNodes = get().nodes.filter((node) => !selectedNodeIds.has(node.id));
        const nextEdges = get().edges.filter((edge) => (
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.source) &&
          !selectedNodeIds.has(edge.target)
        ));

        set({
          nodes: attachRuntimeDataToNodes(nextNodes, get),
          edges: normalizeFlowEdges(nextNodes, nextEdges),
        });
        return true;
      },
      selectAllNodes: () => {
        set({
          nodes: get().nodes.map((node) => ({ ...node, selected: true })),
          edges: get().edges.map((edge) => ({ ...edge, selected: true })),
        });
      },
      deselectAll: () => {
        set({
          nodes: get().nodes.map((node) => ({ ...node, selected: false })),
          edges: get().edges.map((edge) => ({ ...edge, selected: false })),
        });
      },
      createGroupFromSelection: (title = 'Group') => {
        const clipboard = serializeFlowSelection(get().nodes, get().edges);
        if (!clipboard) {
          return undefined;
        }

        const id = `groupNode-${makeFlowId()}`;
        const groupNode = attachRuntimeData(
          {
            id,
            type: 'groupNode',
            position: {
              x: clipboard.bounds.x - 24,
              y: clipboard.bounds.y - 64,
            },
            selected: true,
            data: {
              groupNode: createGroupNodeConfig({
                title,
                childNodeIds: clipboard.nodes.map((node) => node.id),
                childEdgeIds: clipboard.edges.map((edge) => edge.id),
                bounds: clipboard.bounds,
              }),
              ...makeNodeIdentity(),
            },
          },
          get,
        );

        set({
          nodes: [
            ...get().nodes.map((node) => ({ ...node, selected: false })),
            groupNode,
          ],
        });
        return id;
      },
      collapseSelectionToFunction: (title) => {
        const collapsed = buildCollapsedFunctionNode({
          nodes: get().nodes,
          edges: get().edges,
          createId: (prefix) => `${prefix}-${makeFlowId()}`,
          title,
        });

        if (!collapsed) {
          return undefined;
        }

        set({
          nodes: attachRuntimeDataToNodes(collapsed.nextNodes.map((node) => (
            node.id === collapsed.functionNode.id
              ? { ...node, data: { ...node.data, ...makeNodeIdentity() } }
              : node
          )), get),
          edges: normalizeFlowEdges(collapsed.nextNodes, collapsed.nextEdges),
        });
        return collapsed.functionNode.id;
      },
      addConnectedNode: (sourceNodeId, type, targetHandle) => {
        const sourceNode = get().nodes.find((node) => node.id === sourceNodeId);

        if (!sourceNode) {
          return;
        }

        const settings = useSettingsStore.getState();
        if (type === 'portal') {
          const pairId = `portal-pair-${makeFlowId()}`;
          const entryId = `portal-entry-${makeFlowId()}`;
          const exitId = `portal-exit-${makeFlowId()}`;
          const entry = attachRuntimeData(
            {
              id: entryId,
              type,
              position: {
                x: sourceNode.position.x + 320,
                y: sourceNode.position.y + 24,
              },
              data: {
                ...createInitialNodeData(type, settings),
                ...makeNodeIdentity(),
                portalRole: 'entry',
                portalPairId: pairId,
                portalLabel: 'Portal pair',
              },
            },
            get,
          );
          const exit = attachRuntimeData(
            {
              id: exitId,
              type,
              position: {
                x: sourceNode.position.x + 740,
                y: sourceNode.position.y + 24,
              },
              data: {
                ...createInitialNodeData(type, settings),
                ...makeNodeIdentity(),
                portalRole: 'exit',
                portalPairId: pairId,
                portalLabel: 'Portal pair',
              },
            },
            get,
          );

          set({
            nodes: [...get().nodes, entry, exit],
            edges: normalizeFlowEdges(
              [...get().nodes, entry, exit],
              addEdge(
                {
                  source: sourceNodeId,
                  sourceHandle: null,
                  target: entryId,
                  targetHandle: targetHandle ?? null,
                },
                get().edges,
              ),
            ),
          });
          return;
        }

        const id = `${type}-${makeFlowId()}`;
        const xOffset = type === 'composition' ? 420 : 320;
        const nextNode = attachRuntimeData(
          {
            id,
            type,
            position: {
              x: sourceNode.position.x + xOffset,
              y: sourceNode.position.y + 24,
            },
            data: {
              ...createInitialNodeData(type, settings),
              ...makeNodeIdentity(),
            },
          },
          get,
        );

        set({
          nodes: [...get().nodes, nextNode],
          edges: normalizeFlowEdges(
            [...get().nodes, nextNode],
            addEdge(
              {
                source: sourceNodeId,
                sourceHandle: null,
                target: id,
                targetHandle: targetHandle ?? null,
              },
              get().edges,
            ),
          ),
        });
      },
      updateNodeData: (id, key, value) => {
        get().patchNodeData(id, { [key]: value } as Partial<NodeData>);
      },
      patchNodeData: (id, patch) => {
        const currentNodes = get().nodes;
        const currentEdges = get().edges;
        const requestedPatchChanged = currentNodes.some((node) => (
          node.id === id && hasNodeDataPatchChange(node.data, patch)
        ));

        if (!requestedPatchChanged) {
          return;
        }

        const activeRunId = useFlowWorkspaceStore.getState().getActiveFlowRunId(
          useFlowWorkspaceStore.getState().hydratedWorkspaceId,
          id,
        );
        // Edits while the consent dialog is open invalidate the candidate
        // snapshot and re-plan. Once execution starts, the same edit cancels
        // the graph-wide owner immediately.
        const invalidatesRun = shouldBumpInputRevision(patch)
          && Boolean(activeRunId)
          && (!activePlanningRunIds.has(activeRunId!) || !reconfirmablePlanningRunIds.has(activeRunId!));
        const effectivePatch = shouldBumpInputRevision(patch)
          ? { ...patch, inputRevision: makeFlowId(), resultInputSignature: undefined }
          : patch;
        let changed = false;
        const nodes = currentNodes.map((node) => {
          if (node.id !== id || !hasNodeDataPatchChange(node.data, effectivePatch)) {
            return node;
          }

          changed = true;
          return attachRuntimeData({ ...node, data: { ...node.data, ...effectivePatch } }, get);
        });

        if (!changed) {
          return;
        }

        if (invalidatesRun) {
          const workspaceStore = useFlowWorkspaceStore.getState();
          workspaceStore.invalidateFlowRunForNode(workspaceStore.hydratedWorkspaceId, id);
        }

        if (!flowNodeConnectionContractsChanged(id, currentNodes, nodes, currentEdges)) {
          set({ nodes });
          return;
        }

        // Node settings can alter visible handles, carried types, accepted types, cardinality, or
        // routed media families. Run the same canonical ingress pipeline used by import/paste and
        // retain byte-equivalent edge objects so unrelated persisted edges do not churn.
        const normalized = normalizeFlowEdgesWithCompositionDiagnostics(nodes, currentEdges);
        const normalizedNodes = normalizeCompositionAudioTrackCounts(normalized.nodes, normalized.edges);
        set({
          nodes: normalizedNodes,
          edges: reuseEquivalentFlowEdges(currentEdges, normalized.edges),
        });
      },
      renameNodeBookmark: (id, rawTitle) => {
        const nextState = renameNodeBookmarkState(
          get().nodes,
          get().bookmarkSidebarOpen,
          id,
          rawTitle,
          (node) => attachRuntimeData(node, get),
        );

        if (nextState) {
          set(nextState);
        }
      },
      clearNodeBookmark: (id) => {
        get().renameNodeBookmark(id, '');
      },
      removeEditorSourceReferences: (sourceNodeId) => {
        for (const node of get().nodes) {
          if (node.type !== 'composition') {
            continue;
          }

          const visualClips = getEditorVisualClips(node.data);
          const audioClips = getEditorAudioClips(node.data);
          const nextVisualClips = visualClips.filter((clip) => clip.sourceNodeId !== sourceNodeId);
          const nextAudioClips = audioClips.filter((clip) => clip.sourceNodeId !== sourceNodeId);

          if (nextVisualClips.length === visualClips.length && nextAudioClips.length === audioClips.length) {
            continue;
          }

          get().patchNodeData(node.id, {
            editorVisualClips: nextVisualClips,
            editorAudioClips: nextAudioClips,
          });
        }
      },
      selectNodeAttempt: (id, attemptId) => {
        const node = get().nodes.find((entry) => entry.id === id);
        const attempts = node?.data.resultHistory ?? [];
        const selectedAttempt = resolveSelectedResultAttempt(attempts, attemptId);

        if (!selectedAttempt) {
          return;
        }

        get().patchNodeData(id, {
          selectedResultId: selectedAttempt.id,
          result: selectedAttempt.result,
          resultType: selectedAttempt.resultType,
          usage: selectedAttempt.usage,
          resultMimeType: selectedAttempt.mimeType,
          resultExtension: selectedAttempt.extension,
          resultFileName: selectedAttempt.fileName,
          resultOutputMetadata: selectedAttempt.outputMetadata,
          statusMessage: selectedAttempt.statusMessage,
          error: undefined,
        });
      },
      cancelNodeRun: (id) => {
        const workspaceState = useFlowWorkspaceStore.getState();
        const workspaceId = workspaceState.hydratedWorkspaceId;
        const runId = workspaceState.getActiveFlowRunId(workspaceId, id);
        const planningKey = activeGraphRunKey(
          workspaceId,
          id,
          get().nodes.find((node) => node.id === id),
        );
        const controller = runId
          ? activeRunControllers.get(runId)
          : activePlanningControllers.get(planningKey);

        if (!controller) {
          return;
        }

        // Planning and final confirmation have not crossed the provider
        // dispatch boundary. Preserve that fact in the terminal state.
        const cancelledBeforeDispatch = Boolean(runId && activePlanningRunIds.has(runId));
        controller.abort();
        const runNodeIds = runId ? workspaceState.invalidateFlowRunForNode(workspaceId, id) : [id];
        const cancelledNodeOwners = runNodeIds.map((runNodeId) => {
          const data = get().nodes.find((node) => node.id === runNodeId)?.data;
          return {
            nodeId: runNodeId,
            nodeInstanceId: data?.nodeInstanceId,
            inputRevision: data?.inputRevision,
          };
        });
        for (const runNodeId of runNodeIds) {
          get().patchNodeData(runNodeId, {
            isRunning: false,
            statusMessage: 'Cancelling run…',
            error: undefined,
          });
        }
        queueMicrotask(() => {
          if (useFlowWorkspaceStore.getState().hydratedWorkspaceId !== workspaceId) return;
          for (const cancelledOwner of cancelledNodeOwners) {
            if (useFlowWorkspaceStore.getState().getActiveFlowRunId(workspaceId, cancelledOwner.nodeId)) continue;
            const current = get().nodes.find((node) => node.id === cancelledOwner.nodeId);
            if (
              current?.data.nodeInstanceId !== cancelledOwner.nodeInstanceId
              || current?.data.inputRevision !== cancelledOwner.inputRevision
            ) {
              continue;
            }
            get().patchNodeData(cancelledOwner.nodeId, {
              isRunning: false,
              statusMessage: cancelledBeforeDispatch
                ? 'Run cancelled before sending any provider requests.'
                : 'Run cancelled.',
              error: undefined,
            });
          }
        });
      },
      hydratePersistedState: () => {
        const safe = sanitizePersistedFlowState(get());
        const normalizedNodes = attachHydratedRuntimeDataToNodes(safe.nodes, get);
        hydratedCanvasWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
        const normalized = normalizeFlowEdgesWithCompositionDiagnostics(normalizedNodes, safe.edges);
        set({
          nodes: normalizeCompositionAudioTrackCounts(normalized.nodes, normalized.edges),
          edges: normalized.edges,
          bookmarkSidebarOpen: safe.bookmarkSidebarOpen,
        });
      },
      restoreImportedAssets: async () => {
        const restorationGraphGeneration = hydratedFlowGraphGeneration;
        const restorationWorkspaceId = hydratedCanvasWorkspaceId;
        const sourceBinItems = useSourceBinStore.getState().getAllItems();
        const nodesWithAssets = get().nodes.filter((node) => (
          node.data.sourceAssetId ||
          node.data.sourceAssetUrl ||
          node.data.sourceAssetName ||
          node.data.sourceBinItemId ||
          node.data.textVisionSourceItemId ||
          sourceBinItems.some((item) => sourceBinItemBelongsToFlowNode(item, node.id))
        ));

        const updates = await Promise.all(
          nodesWithAssets.map(async (node) => {
            const sourceBinPatch = buildFlowNodePatchForRestoredSourceBinItem(node.data, sourceBinItems);
            const generatedResultPatch = buildFlowNodeGeneratedResultPatch(node.id, node.type, node.data, sourceBinItems, {
              replaceExistingHistory: true,
            });
            const sourceBinAssetUrl =
              typeof sourceBinPatch?.sourceAssetUrl === 'string' && sourceBinPatch.sourceAssetUrl.trim()
                ? sourceBinPatch.sourceAssetUrl
                : undefined;

            if (sourceBinPatch && sourceBinAssetUrl) {
              const patch = combineNodeDataPatches(sourceBinPatch, generatedResultPatch);
              return patch ? { nodeId: node.id, patch } : undefined;
            }

            const patchedAssetId =
              typeof sourceBinPatch?.sourceAssetId === 'string' && sourceBinPatch.sourceAssetId.trim()
                ? sourceBinPatch.sourceAssetId
                : undefined;
            const assetId = patchedAssetId
              ?? node.data.sourceAssetId
              ?? parseSignalLoomAssetId(node.data.sourceAssetUrl);

            if (!assetId) {
              const patch = combineNodeDataPatches(sourceBinPatch, generatedResultPatch);
              return patch ? { nodeId: node.id, patch } : undefined;
            }

            const storedAsset = await loadImportedAsset(assetId).catch(() => undefined);

            if (!storedAsset) {
              const missingAssetPatch = sourceBinPatch
                ? undefined
                : ({ sourceAssetUrl: undefined } as Partial<NodeData>);
              const patch = combineNodeDataPatches(
                sourceBinPatch,
                generatedResultPatch,
                missingAssetPatch,
              );
              return patch ? { nodeId: node.id, patch } : undefined;
            }

            const restoredAssetPatch: Partial<NodeData> = {
              ...sourceBinPatch,
              sourceAssetId: assetId,
              sourceAssetUrl: storedAsset.dataUrl,
              sourceAssetName: sourceBinPatch?.sourceAssetName ?? storedAsset.name,
              sourceAssetMimeType: sourceBinPatch?.sourceAssetMimeType ?? storedAsset.mimeType,
            };
            const patch = combineNodeDataPatches(restoredAssetPatch, generatedResultPatch);
            return {
              nodeId: node.id,
              patch: patch ?? restoredAssetPatch,
            };
          }),
        );

        const patchesByNodeId = new Map<string, Partial<NodeData>>();
        for (const update of updates) {
          if (update) {
            patchesByNodeId.set(update.nodeId, update.patch);
          }
        }

        if (patchesByNodeId.size === 0) {
          return;
        }

        // Asset reads are intentionally asynchronous. A project replacement, cancellation, or a
        // different canvas may have won while bytes were loading; never apply the old owner's URLs
        // to reused node ids in that replacement graph.
        if (
          hydratedFlowGraphGeneration !== restorationGraphGeneration
          || hydratedCanvasWorkspaceId !== restorationWorkspaceId
          || useFlowWorkspaceStore.getState().hydratedWorkspaceId !== restorationWorkspaceId
        ) return;

        set({
          nodes: get().nodes.map((node) => {
            const patch = patchesByNodeId.get(node.id);
            if (!patch) {
              return node;
            }
            return attachRuntimeData({ ...node, data: { ...node.data, ...patch } }, get);
          }),
        });
      },
      exportFlow: () =>
        JSON.stringify(
          {
            version: 2,
            nodes: get().nodes.map(stripRuntimeData),
            edges: get().edges,
          },
          null,
          2,
        ),
      exportProjectFlowSnapshot: () => ({
        version: 3,
        nodes: get().nodes.map(stripProjectRuntimeData),
        edges: get().edges,
      }),
      replaceFlowSnapshot: (snapshot) => {
        const targetWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
        const isWorkspaceSwitch = targetWorkspaceId !== hydratedCanvasWorkspaceId;
        // Replacing the current canvas creates a new graph boundary. Any active
        // graph owned by this workspace must be invalidated before reused node IDs
        // can receive a completion from the graph it replaced. A workspace switch
        // updates hydratedWorkspaceId first, so runs owned by the workspace being
        // left remain eligible to publish to their immutable owner snapshot.
        if (!isWorkspaceSwitch) {
          invalidateHydratedRunGraphs(get().nodes.map((node) => node.id));
        }
        hydratedFlowGraphGeneration += 1;
        const nextSnapshot = replaceFlowSnapshotState(
          snapshot,
          (nodes) => isWorkspaceSwitch
            ? attachRuntimeDataToNodes(nodes, get)
            : attachHydratedRuntimeDataToNodes(nodes, get),
          normalizeFlowEdges,
        );
        set({
          ...nextSnapshot,
          nodes: normalizeCompositionAudioTrackCounts(nextSnapshot.nodes, nextSnapshot.edges),
        });
        hydratedCanvasWorkspaceId = targetWorkspaceId;
      },
      applyRemoteFlowGraphChange: (change) => {
        // A full snapshot reuses the existing restore path (runtime re-attach + edge normalization).
        if (change.type === 'flow-graph-snapshot') {
          get().replaceFlowSnapshot(change.snapshot);
          return true;
        }
        if (change.type === 'flow-node-removed') {
          invalidateHydratedRunGraphs([change.nodeId]);
        }
        let changed = false;
        set((state) => {
          const next = applyFlowGraphNativeChange({ nodes: state.nodes, edges: state.edges }, change);
          if (next.nodes === state.nodes && next.edges === state.edges) return {};
          changed = true;
          // Re-attach runtime callbacks (a remote `flow-node-added` arrives stripped); idempotent for
          // already-attached nodes, so a move/patch/remove only re-runs the cheap identity checks.
          const nodes =
            next.nodes === state.nodes ? state.nodes : attachRuntimeDataToNodes(next.nodes, get);
          // Only an edge change can move a Composition audio track's effective count — a plain
          // move/patch/removal-of-other-node doesn't need edges renormalized (FBL-019).
          if (next.edges === state.edges) {
            return { nodes, edges: next.edges };
          }
          const normalized = normalizeFlowEdgesWithCompositionDiagnostics(nodes, next.edges);
          return {
            nodes: normalizeCompositionAudioTrackCounts(normalized.nodes, normalized.edges),
            edges: normalized.edges,
          };
        });
        return changed;
      },
      runNode: (nodeId: string, options?: { force?: boolean }) => {
        const forceRoot = options?.force === true;
        const runWorkspaceId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
        const runKey = activeGraphRunKey(
          runWorkspaceId,
          nodeId,
          get().nodes.find((node) => node.id === nodeId),
        );
        const existingRun = activeGraphRuns.get(runKey);
        if (existingRun) {
          return existingRun;
        }

        const run = (async () => {
        const preflightState = get();
        let executionNodeIds = collectExecutionOrder(nodeId, preflightState.nodes, preflightState.edges);
        const runningNode = executionNodeIds
          .map((id) => preflightState.nodes.find((node) => node.id === id))
          .find((node) => node?.data.isRunning);

        if (runningNode) {
          get().patchNodeData(nodeId, {
            error: `Wait for ${runningNode.type} node ${runningNode.id} to finish before running this sub-graph again.`,
            statusMessage: undefined,
          });
          return;
        }

        const blockingDiagnostics = getBlockingFlowDiagnostics(preflightState.nodes, preflightState.edges, nodeId);
        if (blockingDiagnostics.length > 0) {
          get().patchNodeData(nodeId, {
            error: formatBlockingDiagnosticsMessage(blockingDiagnostics),
            statusMessage: undefined,
          });
          return;
        }

        const workspaceState = useFlowWorkspaceStore.getState();
        const ownerWorkspaceId = workspaceState.hydratedWorkspaceId;
        const ownerWorkspace = workspaceState.getWorkspace(ownerWorkspaceId);
        const ownerNode = get().nodes.find((node) => node.id === nodeId);
        const owner: FlowRunOwner = {
          workspaceId: ownerWorkspaceId,
          workspaceName: ownerWorkspace?.name,
          nodeId,
          nodeInstanceId: ownerNode?.data.nodeInstanceId,
          inputRevision: ownerNode?.data.inputRevision,
          runId: makeFlowId(),
        };
        const ownerWorkspaceSnapshotGeneration = getFlowWorkspaceSnapshotGeneration();

        const runController = new AbortController();
        activePlanningControllers.set(runKey, runController);
        activeRunControllers.set(owner.runId, runController);
        activePlanningRunIds.add(owner.runId);
        // Ownership begins before any asynchronous planning or confirmation.
        // Register the whole frozen traversal now, not lazily as recursion
        // reaches it, so reset/edit/cancel of a later branch cancels this run.
        workspaceState.registerFlowRun(owner, { abort: () => runController.abort() });
        for (const executionNodeId of executionNodeIds) {
          const executionNode = preflightState.nodes.find((node) => node.id === executionNodeId);
          workspaceState.registerFlowRunNode(owner, {
            nodeId: executionNodeId,
            nodeInstanceId: executionNode?.data.nodeInstanceId,
            inputRevision: executionNode?.data.inputRevision,
          });
        }
        const abortSignal = runController.signal;
        const refreshPlannedGraphOwnership = (snapshot: ProviderRunSnapshot) => {
          const snapshotRoot = snapshot.nodes.find((node) => node.id === nodeId);
          owner.nodeInstanceId = snapshotRoot?.data.nodeInstanceId;
          owner.inputRevision = snapshotRoot?.data.inputRevision;
          executionNodeIds = collectExecutionOrder(nodeId, snapshot.nodes, snapshot.edges);
          workspaceState.unregisterFlowRun(owner);
          workspaceState.registerFlowRun(owner, { abort: () => runController.abort() });
          for (const executionNodeId of executionNodeIds) {
            const executionNode = snapshot.nodes.find((node) => node.id === executionNodeId);
            workspaceState.registerFlowRunNode(owner, {
              nodeId: executionNodeId,
              nodeInstanceId: executionNode?.data.nodeInstanceId,
              inputRevision: executionNode?.data.inputRevision,
            });
          }
        };
        const isPlanningOwnerValid = () => (
          ownerWorkspaceSnapshotGeneration === getFlowWorkspaceSnapshotGeneration()
          && workspaceState.getActiveFlowRunId(owner.workspaceId, owner.nodeId) === owner.runId
        );
        const requestedRootNode = get().nodes.find((node) => node.id === nodeId);
        const throwIfRunAborted = () => {
          if (abortSignal.aborted || !isPlanningOwnerValid()) {
            throw new DOMException('The run was cancelled.', 'AbortError');
          }
        };
        const releasePlanningOwner = () => {
          activePlanningControllers.delete(runKey);
          activePlanningRunIds.delete(owner.runId);
          reconfirmablePlanningRunIds.delete(owner.runId);
          activeRunControllers.delete(owner.runId);
          workspaceState.unregisterFlowRun(owner);
        };

        get().patchNodeData(nodeId, {
          isRunning: true,
          error: undefined,
          statusMessage: 'Planning provider spend…',
        });

        let approvedSnapshot: ProviderRunSnapshot | undefined;
        let approvedSpendPlan: ProviderSpendPlan | undefined;
        while (!approvedSnapshot) {
          const candidateSnapshot = captureProviderRunSnapshot(nodeId);
          try {
            throwIfRunAborted();
            const currentBlockingDiagnostics = getBlockingFlowDiagnostics(
              candidateSnapshot.nodes,
              candidateSnapshot.edges,
              nodeId,
            );
            if (currentBlockingDiagnostics.length > 0) {
              throw new Error(formatBlockingDiagnosticsMessage(currentBlockingDiagnostics));
            }
            const spendPlan = await buildProviderSpendPlan(
              nodeId,
              candidateSnapshot.nodes,
              candidateSnapshot.edges,
              candidateSnapshot.settings,
              candidateSnapshot.sourceBinItems,
              abortSignal,
              forceRoot,
            );
            throwIfRunAborted();

            if (spendPlan.nodes.length > 0) {
              reconfirmablePlanningRunIds.add(owner.runId);
              const proceed = await requestRunConfirmation(
                formatProviderSpendPlan(spendPlan),
                'Final Run Cost Confirmation',
                abortSignal,
              );
              reconfirmablePlanningRunIds.delete(owner.runId);
              if (!proceed) {
                get().patchNodeData(nodeId, {
                  isRunning: false,
                  statusMessage: 'Run cancelled before sending any provider requests.',
                  error: undefined,
                });
                releasePlanningOwner();
                return;
              }
            }

            throwIfRunAborted();
            if (!await areApprovedSourceBinResumesCurrent(nodeId, spendPlan, candidateSnapshot, abortSignal)) {
              get().patchNodeData(nodeId, {
                statusMessage: 'Source Library content changed while awaiting final dispatch. Re-planning before any provider request…',
                error: undefined,
              });
              continue;
            }
            throwIfRunAborted();
            const switchedWorkspace = useFlowWorkspaceStore.getState().hydratedWorkspaceId !== owner.workspaceId;
            if (!switchedWorkspace && !isProviderRunSnapshotCurrent(candidateSnapshot, nodeId)) {
              get().patchNodeData(nodeId, {
                statusMessage: 'The run plan changed while awaiting confirmation. Re-planning before any provider request…',
                error: undefined,
              });
              continue;
            }
            throwIfRunAborted();
            refreshPlannedGraphOwnership(candidateSnapshot);
            approvedSnapshot = candidateSnapshot;
            approvedSpendPlan = spendPlan;
          } catch (error) {
            if (isAbortError(error)) {
              if (isPlanningOwnerValid()) {
                get().patchNodeData(nodeId, {
                  isRunning: false,
                  statusMessage: 'Run cancelled before sending any provider requests.',
                  error: undefined,
                });
              }
              releasePlanningOwner();
              return;
            }
            get().patchNodeData(nodeId, {
              isRunning: false,
              error: error instanceof Error ? error.message : 'The provider spend plan could not be built.',
              statusMessage: undefined,
            });
            releasePlanningOwner();
            return;
          }
        }

        activePlanningControllers.delete(runKey);
        activePlanningRunIds.delete(owner.runId);
        reconfirmablePlanningRunIds.delete(owner.runId);
        if (!approvedSpendPlan) {
          throw new Error('The provider spend plan was not retained for execution.');
        }
        const dispatchedProviderCalls = new Map<string, number>();
        const authorizeProviderDispatch = (node: AppNode, context: ExecutionContext) => {
          if (!requiresApprovedProviderDispatch(node, context, executionSettings)) return;
          const dispatched = (dispatchedProviderCalls.get(node.id) ?? 0) + 1;
          const approved = approvedSpendPlan.providerCallCounts.get(node.id) ?? 0;
          if (dispatched > approved) {
            throw new Error('This provider request is not represented in the approved final spend plan. Re-plan and reconfirm before continuing.');
          }
          dispatchedProviderCalls.set(node.id, dispatched);
        };

        const workspaceStore = useFlowWorkspaceStore.getState();
        let executionNodes = approvedSnapshot.nodes.map((node) => ({ ...node, data: { ...node.data } }));
        const executionEdges = approvedSnapshot.edges.map((edge) => ({ ...edge }));
        const executionSettings = approvedSnapshot.settings;
        const commitRunPatch = (currentId: string, patch: Partial<NodeData>) => {
          const committed = workspaceStore.commitFlowRunPatch(owner, currentId, patch, {
            getHydratedNodeData: (currentNodeId) => get().nodes.find((node) => node.id === currentNodeId)?.data,
            applyToHydratedCanvas: (currentNodeId, nodePatch) => get().patchNodeData(currentNodeId, nodePatch),
          });
          if (committed) {
            executionNodes = executionNodes.map((node) => node.id === currentId
              ? { ...node, data: { ...node.data, ...patch } }
              : node);
          }
          return committed;
        };
        const isRunOwnerValid = (currentId: string) => {
          return ownerWorkspaceSnapshotGeneration === getFlowWorkspaceSnapshotGeneration()
            && workspaceStore.isFlowRunOwnerValid(owner, currentId, {
            getHydratedNodeData: (currentNodeId) => get().nodes.find((node) => node.id === currentNodeId)?.data,
          });
        };
        if (requestedRootNode && !canRunNode(requestedRootNode)) {
          commitRunPatch(nodeId, {
            isRunning: true,
            error: undefined,
            statusMessage: 'Running…',
          });
        }
        const recordedUsageEvents = new Set<string>();
        let usageEventSequence = 0;
        const recordIncurredUsage = (node: AppNode, usage: UsageTelemetry | undefined) => {
          if (!usage) return;
          const eventId = `${owner.runId}:${node.id}:${usageEventSequence++}`;
          if (recordedUsageEvents.has(eventId)) return;
          recordedUsageEvents.add(eventId);
          // A provider response is a financial fact even if the owner became stale
          // while it was in flight. Always ledger it to the immutable starting owner;
          // publication remains separately guarded below.
          recordProjectUsageFromExecution({
            node,
            usage,
            workspace: 'flow',
            flowWorkspaceId: owner.workspaceId,
            flowWorkspaceName: owner.workspaceName,
            recordUsage: useProjectUsageStore.getState().recordUsage,
          });
        };
        const discardRunSourceItems = (items: Array<import('./sourceBinStore').SourceBinLibraryItem | undefined>) => {
          const sourceBin = useSourceBinStore.getState();
          for (const item of items) {
            if (item?.originWorkspaceId === owner.workspaceId && item.originRunId === owner.runId) {
              sourceBin.removeItem(item.id);
            }
          }
        };
        const persistAndPublishRunAsset = async (
          currentId: string,
          item: Parameters<ReturnType<typeof useSourceBinStore.getState>['addAssetItem']>[0],
        ) => {
          throwIfRunAborted();
          if (!isRunOwnerValid(currentId)) {
            throw new DOMException('The run was cancelled.', 'AbortError');
          }
          const sourceStore = useSourceBinStore.getState();
          const sourceItem = await sourceStore.addAssetItem(item, undefined, { deferPublication: true });
          if (abortSignal.aborted || !isRunOwnerValid(currentId)) {
            sourceStore.discardProvisionalAssetItem(sourceItem.id);
            throw new DOMException('The run was cancelled.', 'AbortError');
          }
          return sourceStore.publishProvisionalAssetItem(sourceItem.id) ?? sourceItem;
        };
        const persistNamedOutputAssets = async (
          currentId: string,
          outputs: Record<string, NodeOutputArtifact> | undefined,
          input: {
            envelopeId: string;
            envelopeIndex: number;
            nodeLabel: string;
            primaryOriginalResult?: string;
            primaryPublishedResult?: string;
            primarySourceBinItemId?: string;
          },
          publishedItems: Array<import('./sourceBinStore').SourceBinLibraryItem>,
        ): Promise<Record<string, NodeOutputArtifact> | undefined> => {
          if (!outputs) return undefined;
          const next: Record<string, NodeOutputArtifact> = {};
          for (const [handle, output] of Object.entries(outputs)) {
            const inferredKind = isAssetSourceKind(output.resultType) ? output.resultType : undefined;
            const kind = output.assetKind ?? inferredKind;
            const result = typeof output.result === 'string' ? output.result : undefined;

            if (!kind || kind === 'text' || !result) {
              next[handle] = output;
              continue;
            }

            if (input.primarySourceBinItemId && result === input.primaryOriginalResult) {
              next[handle] = {
                ...output,
                result: input.primaryPublishedResult ?? result,
                sourceBinItemId: input.primarySourceBinItemId,
              };
              continue;
            }

            const sourceItem = await persistAndPublishRunAsset(currentId, {
              label: output.fileName ?? `${input.nodeLabel} · ${handle}`,
              kind,
              mimeType: output.mimeType ?? 'application/octet-stream',
              dataUrl: result,
              blob: output.blob,
              isGenerated: true,
              originNodeId: currentId,
              originWorkspaceId: owner.workspaceId,
              originRunId: owner.runId,
              envelopeId: input.envelopeId,
              envelopeLabel: input.nodeLabel,
              envelopeIndex: input.envelopeIndex,
              envelopeCollapsed: false,
            });
            publishedItems.push(sourceItem);
            next[handle] = {
              ...output,
              result: sourceItem.assetUrl ?? result,
              sourceBinItemId: sourceItem.id,
            };
          }
          return next;
        };
        // A dependency can feed multiple branches of one root execution. Memoize
        // the in-flight/completed promise for this root only: it deduplicates a
        // diamond without treating a saved result from an earlier root run as a
        // dependency result for this one.
        const completedNodePromises = new Map<string, Promise<void>>();
        const executeRecursively = (currentId: string, stack: Set<string>): Promise<void> => {
          if (stack.has(currentId)) {
            return Promise.reject(new Error('Flow execution cannot continue because the graph contains a cycle.'));
          }

          const existingExecution = completedNodePromises.get(currentId);
          if (existingExecution) {
            return existingExecution;
          }

          const execution = (async (): Promise<void> => {
            throwIfRunAborted();

          const currentNode = executionNodes.find((node) => node.id === currentId);
          if (!currentNode) {
            return;
          }

          workspaceStore.registerFlowRunNode(owner, {
            nodeId: currentId,
            nodeInstanceId: currentNode.data.nodeInstanceId,
            inputRevision: currentNode.data.inputRevision,
          });

          const nextStack = new Set(stack);
          nextStack.add(currentId);

          if (canRunNode(currentNode)) {
            commitRunPatch(currentId, {
              isRunning: true,
              error: undefined,
              statusMessage: 'Running…',
            });
          }

          try {
            const currentEdges = executionEdges;
            const currentNodesById = buildNodeMap(executionNodes);
            const sourceIds = getExecutionDependencies(currentNode, currentEdges, currentNodesById);

            for (const sourceId of sourceIds) {
              await executeRecursively(sourceId, nextStack);
            }

            throwIfRunAborted();

            const latestState = { nodes: executionNodes, edges: executionEdges };
            const latestNode = executionNodes.find((node) => node.id === currentId);

            if (!latestNode || !canRunNode(latestNode)) {
              return;
            }

            // One shared resolution keeps this execution path, the planner, and direct Run on
            // the same canonical prompt/reference-group representation (AUD-011).
            const resolution = buildNodeExecutionResolution(latestNode, latestState.nodes, latestState.edges);
            const promptSignal = resolution.promptSignals.combined;
            const blockingPromptDiagnostics = getBlockingSignalDiagnostics(promptSignal);
            if (blockingPromptDiagnostics.length > 0) {
              throw new Error(formatBlockingDiagnosticsMessage(blockingPromptDiagnostics));
            }
            const context = resolution.context;
            const settings = executionSettings;
            const loopInputs = collectListLoopInputs(currentId, latestState.nodes, latestState.edges);
            const loopMode = normalizeListLoopMode(latestNode.data.listLoopMode);
            const promptSignalIterationCount = getSignalIterationCount(promptSignal);
            const routedLoopInputs = buildRoutedLoopInputs(loopInputs, promptSignal);
            const loopIterationCount = getLoopIterationCount(routedLoopInputs, loopMode);
            const combinedIterationCount = resolveLoopRunCount(routedLoopInputs, loopMode, promptSignal);

            const promptIsEmptyContainer = (
              (promptSignal.kind === 'list' || promptSignal.kind === 'envelope')
              && Array.isArray(promptSignal.items)
              && promptSignal.items.length === 0
            );
            if (promptIsEmptyContainer || loopInputs.some((input) => input.items.length === 0)) {
              commitRunPatch(currentId, {
                envelopeItems: undefined,
                statusMessage: 'The connected list did not contain any runnable items.',
                error: undefined,
              });
              return;
            }

            const hasMultiItemListAxis = loopInputs.some((input) => input.items.length > 1);
            const preservesSingleFunctionLoop = latestNode.type === 'functionNode' && loopInputs.length > 0;
            if (combinedIterationCount > 0 && (hasMultiItemListAxis || promptSignalIterationCount > 1 || preservesSingleFunctionLoop)) {
              const envelopeItems: EnvelopeItem[] = [];
              let latestNamedOutputs: Record<string, NodeOutputArtifact> | undefined;
              let stoppedLoopMessage: string | undefined;
              const loopStatusLabel = loopIterationCount > 0
                ? loopMode === 'allCombinations' ? 'Combination' : 'Envelope'
                : 'Prompt batch';
              const loopCacheKeys: string[] = [];

              for (let index = 0; index < combinedIterationCount; index += 1) {
                throwIfRunAborted();

                const breakDecision = shouldBreakLoopAtIteration(currentId, latestState.nodes, latestState.edges, index);
                if (breakDecision.shouldBreak) {
                  stoppedLoopMessage = `Stopped before iteration ${index + 1}/${combinedIterationCount}${breakDecision.reason ? `: ${breakDecision.reason}` : ''}`;
                  commitRunPatch(currentId, {
                    envelopeItems,
                    statusMessage: stoppedLoopMessage,
                    error: undefined,
                  });
                  break;
                }

                const { directIndex, promptIndex } = resolveAllCombinationSubIndices(
                  index,
                  loopIterationCount,
                  promptSignalIterationCount,
                  loopMode,
                );
                const iterationItems = loopIterationCount > 0
                  ? buildLoopIterationItems(routedLoopInputs, directIndex, loopMode)
                  : [];
                const loopContext = applyResolvedReferenceGroups(
                  applyListItemsToExecutionContext(
                    {
                      ...context,
                      prompt: promptSignalIterationCount > 0 ? signalToTextAt(resolution.promptSignals.prompt, promptIndex) : context.prompt,
                    },
                    latestNode,
                    iterationItems,
                  ),
                  latestNode,
                  resolution.referenceSlots,
                  promptIndex,
                  iterationItems,
                );
                const iterationCacheKey = flowResultCacheKeyForNode(latestNode, loopContext, settings, index);
                loopCacheKeys.push(iterationCacheKey);
                
                const envelopeId = await hashExecutionParameters(
                  stableNodeDataForExecution(latestNode),
                  loopContext,
                );
                // The confirmed plan owns this exact Source Bin view. A later
                // library mutation must trigger a new plan, never change which
                // iterations this already-confirmed root resumes.
                const allSourceBinItems = approvedSnapshot.sourceBinItems;
                const existingAsset = allSourceBinItems.find(
                  (item) => item.originNodeId === currentId && item.envelopeId === envelopeId && item.envelopeIndex === index
                );
                const approvedResumeProof = !(forceRoot && currentId === nodeId)
                  ? approvedSpendPlan.resumeProofs.get(plannedResumeKey(currentId, envelopeId, index))
                  : undefined;
                const existingResume = approvedResumeProof && existingAsset
                  ? await validateSourceBinResumeItem(existingAsset, projectedResultType(latestNode), abortSignal)
                  : undefined;
                if (approvedResumeProof && (!existingResume || existingResume.proof !== approvedResumeProof)) {
                  existingResume?.release?.();
                  throw new Error('A Source Bin resume changed after spend planning. Re-plan and reconfirm before any provider request.');
                }

                // Signature-bound Source results are safe for dependency reuse after
                // the approved bounded-content proof has been revalidated.
                if (existingResume) {
                  envelopeItems.push(buildEnvelopeItemFromSourceBinItem(existingResume));
                  existingResume.release?.();
                  commitRunPatch(currentId, {
                    envelopeItems,
                    statusMessage: `${loopStatusLabel} ${index + 1}/${combinedIterationCount}: Resumed from Source Bin`,
                    error: undefined,
                  });
                  continue;
                }

                if (!isRunOwnerValid(currentId)) {
                  throw new DOMException('The run was cancelled.', 'AbortError');
                }
                authorizeProviderDispatch(latestNode, loopContext);
                const execution = await executeNodeRequest(latestNode, loopContext, settings, (statusMessage) => {
                  if (abortSignal.aborted) {
                    return;
                  }

                  commitRunPatch(currentId, {
                    statusMessage: `${loopStatusLabel} ${index + 1}/${combinedIterationCount}: ${statusMessage}`,
                    error: undefined,
                  });
                }, {
                  signal: abortSignal,
                  graph: { nodes: latestState.nodes, edges: latestState.edges },
                  functionRuntime: flowFunctionNodeExecutionRuntime,
                  onInternalUsage: (entry) => recordIncurredUsage(entry.node, entry.usage),
                });

                if (!execution.usageAttributions?.length) {
                  recordIncurredUsage(latestNode, execution.usage);
                }
                throwIfRunAborted();
                if (!isRunOwnerValid(currentId)) return;
                
                const newEnvelopeItem = buildEnvelopeItemFromExecution(currentId, index, execution, iterationItems);
                const sourceItemsForPatch: Array<import('./sourceBinStore').SourceBinLibraryItem> = [];
                
                if (isAssetSourceKind(execution.resultType)) {
                  if (!isRunOwnerValid(currentId)) return;
                  const sourceItem = await persistAndPublishRunAsset(currentId, {
                    label: newEnvelopeItem.label,
                    kind: execution.resultType,
                    mimeType: newEnvelopeItem.mimeType ?? 'application/octet-stream',
                    dataUrl: newEnvelopeItem.value,
                    blob: execution.blob,
                    nativeFilePath: execution.nativeFilePath,
                    isGenerated: true,
                    originNodeId: currentId,
                    originWorkspaceId: owner.workspaceId,
                    originRunId: owner.runId,
                    envelopeId,
                    envelopeLabel: newEnvelopeItem.label,
                    envelopeIndex: index,
                    envelopeCollapsed: false,
                  });
                  sourceItemsForPatch.push(sourceItem);
                  if (!isRunOwnerValid(currentId)) {
                    discardRunSourceItems(sourceItemsForPatch);
                    return;
                  }
                  newEnvelopeItem.value = sourceItem.assetUrl ?? newEnvelopeItem.value;
                  newEnvelopeItem.sourceBinItemId = sourceItem.id;
                }

                latestNamedOutputs = await persistNamedOutputAssets(currentId, execution.namedOutputs ?? execution.functionOutputs, {
                  envelopeId,
                  envelopeIndex: index,
                  nodeLabel: newEnvelopeItem.label,
                  primaryOriginalResult: typeof execution.result === 'string' ? execution.result : undefined,
                  primaryPublishedResult: newEnvelopeItem.value,
                  primarySourceBinItemId: newEnvelopeItem.sourceBinItemId,
                }, sourceItemsForPatch);

                envelopeItems.push(newEnvelopeItem);

                if (!commitRunPatch(currentId, {
                  envelopeItems,
                  functionOutputs: execution.functionOutputs ? latestNamedOutputs : undefined,
                  namedOutputs: latestNamedOutputs,
                  statusMessage: `${loopStatusLabel} ${index + 1}/${combinedIterationCount}: ${execution.statusMessage}`,
                  error: undefined,
                })) {
                  discardRunSourceItems(sourceItemsForPatch);
                  return;
                }
              }

              const firstItem = envelopeItems[0];
              if (!firstItem) {
                commitRunPatch(currentId, {
                  envelopeItems,
                  error: undefined,
                  statusMessage: stoppedLoopMessage ?? 'The connected list did not contain any runnable items.',
                });
                return;
              }

              const statusMessage = stoppedLoopMessage
                ? `${stoppedLoopMessage}. Kept ${envelopeItems.length} ${firstItem.kind} item${envelopeItems.length === 1 ? '' : 's'}.`
                : `Generated envelope with ${envelopeItems.length} ${firstItem.kind} item${envelopeItems.length === 1 ? '' : 's'}`;
              const usage = aggregateEnvelopeUsage(envelopeItems);
              const selectedResult = deserializeResultValueFromContainer(firstItem.value, firstItem.kind);
              if (selectedResult === undefined) {
                throw new Error(`The generated ${firstItem.kind} envelope value is invalid and cannot be restored.`);
              }
              const nextAttemptState = appendResultAttempt(latestNode.data.resultHistory ?? [], {
                result: selectedResult,
                resultType: firstItem.kind,
                statusMessage,
                usage,
                sourceBinItemId: firstItem.sourceBinItemId,
              });
              const resultInputSignature = flowResultCacheSignatureFromKeys(loopCacheKeys);
              const finalPatch: Partial<NodeData> = {
                result: selectedResult,
                resultType: firstItem.kind,
                envelopeItems,
                functionOutputs: latestNode.type === 'functionNode' ? latestNamedOutputs : undefined,
                namedOutputs: latestNamedOutputs,
                resultHistory: nextAttemptState.attempts,
                selectedResultId: nextAttemptState.selectedAttemptId,
                usage,
                error: undefined,
                statusMessage,
                sourceBinItemId: firstItem.sourceBinItemId,
                resultInputSignature,
              };
              if (!commitRunPatch(currentId, finalPatch)) {
                return;
              }
              for (const [index, item] of envelopeItems.entries()) {
                const cacheKey = loopCacheKeys[index];
                if (!cacheKey) continue;
                const cacheEntry = cacheEntryFromEnvelopeItem(latestNode, item, cacheKey, statusMessage);
                if (cacheEntry) setFlowResultCacheEntry(cacheEntry);
              }
              return;
            }

            const envelopeId = await hashExecutionParameters(
              stableNodeDataForExecution(latestNode),
              context,
            );
            const cacheKey = flowResultCacheKeyForNode(latestNode, context, settings);
            const cacheReuseAllowed = !(forceRoot && currentId === nodeId);
            const cachedEntry = cacheReuseAllowed
              ? getFlowResultCacheEntry(cacheKey)
              : undefined;
            if (
              cachedEntry
              && latestNode.data.resultInputSignature === cacheKey
              && isValidFlowResultCacheEntry(cachedEntry, cacheKey, projectedResultType(latestNode))
            ) {
              let cacheAssetValid = true;
              if (cachedEntry.sourceBinItemId) {
                const cacheItem = approvedSnapshot.sourceBinItems.find((item) => item.id === cachedEntry.sourceBinItemId);
                const validated = cacheItem
                  ? await validateSourceBinResumeItem(cacheItem, projectedResultType(latestNode), abortSignal, {
                    materializeStoredAsset: false,
                  })
                  : undefined;
                validated?.release?.();
                cacheAssetValid = Boolean(validated);
              }
              if (cacheAssetValid) {
                commitRunPatch(currentId, {
                  result: cachedEntry.result,
                  resultType: cachedEntry.resultType,
                  resultMimeType: cachedEntry.resultMimeType,
                  resultExtension: cachedEntry.resultExtension,
                  resultFileName: cachedEntry.resultFileName,
                  resultOutputMetadata: cachedEntry.resultOutputMetadata,
                  resultInputSignature: cacheKey,
                  statusMessage: 'Reused cached result',
                  error: undefined,
                });
                return;
              }
            }

            const allSourceBinItems = approvedSnapshot.sourceBinItems;
            const vectorOutputCount = latestNode.data.envelopeItems?.length ?? 0;
            const vectorResult = isVectorResultCacheSignature(latestNode.data.resultInputSignature);
            if (cacheReuseAllowed && vectorResult && vectorOutputCount > 1) {
              const vectorSignature = flowResultCacheSignatureFromKeys(
                Array.from({ length: vectorOutputCount }, () => cacheKey),
              );
              if (latestNode.data.resultInputSignature === vectorSignature) {
                const vectorResumes: ValidatedSourceBinResume[] = [];
                let vectorResumeValid = true;
                for (let index = 0; index < vectorOutputCount; index += 1) {
                  const vectorAsset = allSourceBinItems.find(
                    (item) => item.originNodeId === currentId
                      && item.envelopeId === envelopeId
                      && item.envelopeIndex === index,
                  );
                  const vectorProof = approvedSpendPlan.resumeProofs.get(
                    plannedResumeKey(currentId, envelopeId, index),
                  );
                  if (!vectorAsset || !vectorProof) {
                    vectorResumeValid = false;
                    break;
                  }
                  const vectorResume = await validateSourceBinResumeItem(
                    vectorAsset,
                    projectedResultType(latestNode),
                    abortSignal,
                  );
                  if (!vectorResume || vectorResume.proof !== vectorProof) {
                    vectorResume?.release?.();
                    throw new Error('A Source Bin resume changed after spend planning. Re-plan and reconfirm before any provider request.');
                  }
                  vectorResumes.push(vectorResume);
                }
                if (vectorResumeValid && vectorResumes.length === vectorOutputCount) {
                  const restoredEnvelopeItems = vectorResumes.map(buildEnvelopeItemFromSourceBinItem);
                  const firstRestoredItem = restoredEnvelopeItems[0];
                  const restoredResult = firstRestoredItem
                    ? deserializeResultValueFromContainer(firstRestoredItem.value, firstRestoredItem.kind)
                    : undefined;
                  if (restoredResult === undefined || !firstRestoredItem) {
                    for (const resume of vectorResumes) resume.release?.();
                    throw new Error('A persisted multi-result output is invalid and cannot be restored.');
                  }
                  const nextAttemptState = appendResultAttempt(latestNode.data.resultHistory ?? [], {
                    result: restoredResult,
                    resultType: firstRestoredItem.kind,
                    statusMessage: 'Resumed from Source Bin',
                    sourceBinItemId: firstRestoredItem.sourceBinItemId,
                  });
                  commitRunPatch(currentId, {
                    result: restoredResult,
                    resultType: firstRestoredItem.kind,
                    resultMimeType: firstRestoredItem.mimeType,
                    envelopeItems: restoredEnvelopeItems,
                    resultHistory: nextAttemptState.attempts,
                    selectedResultId: nextAttemptState.selectedAttemptId,
                    sourceBinItemId: firstRestoredItem.sourceBinItemId,
                    resultInputSignature: vectorSignature,
                    statusMessage: 'Resumed from Source Bin',
                    error: undefined,
                  });
                  for (const resume of vectorResumes) resume.release?.();
                  return;
                }
                for (const resume of vectorResumes) resume.release?.();
              }
            }
            // Keep one-item resumes on the same immutable Source Bin view as
            // the cost plan above.
            const existingAsset = allSourceBinItems.find(
              (item) => item.originNodeId === currentId && item.envelopeId === envelopeId && item.envelopeIndex === 0
            );
            const approvedResumeProof = cacheReuseAllowed && !vectorResult
              ? approvedSpendPlan.resumeProofs.get(plannedResumeKey(currentId, envelopeId, 0))
              : undefined;
            const existingResume = approvedResumeProof && existingAsset
              ? await validateSourceBinResumeItem(existingAsset, projectedResultType(latestNode), abortSignal)
              : undefined;
            if (approvedResumeProof && (!existingResume || existingResume.proof !== approvedResumeProof)) {
              existingResume?.release?.();
              throw new Error('A Source Bin resume changed after spend planning. Re-plan and reconfirm before any provider request.');
            }

            // Never satisfy a dependency from an earlier root's saved Source item.
            // Root-level resume remains available for an explicit direct rerun.
            if (existingResume) {
              const execution = {
                result: existingResume.value,
                resultType: existingResume.kind,
                statusMessage: 'Resumed from Source Bin',
                mimeType: existingResume.mimeType,
              };

              const nextAttemptState = appendResultAttempt(latestNode.data.resultHistory ?? [], {
                ...execution,
                sourceBinItemId: existingResume.item.id,
              });

              commitRunPatch(currentId, {
                result: execution.result,
                resultType: execution.resultType,
                resultMimeType: execution.mimeType,
                envelopeItems: undefined,
                resultHistory: nextAttemptState.attempts,
                selectedResultId: nextAttemptState.selectedAttemptId,
                sourceBinItemId: existingResume.item.id,
                resultInputSignature: cacheKey,
                statusMessage: execution.statusMessage,
                error: undefined,
              });
              existingResume.release?.();
              return;
            }

            if (!isRunOwnerValid(currentId)) {
              throw new DOMException('The run was cancelled.', 'AbortError');
            }
            authorizeProviderDispatch(latestNode, context);
            const execution = await executeNodeRequest(latestNode, context, settings, (statusMessage) => {
              if (abortSignal.aborted) {
                return;
              }

              commitRunPatch(currentId, {
                statusMessage,
                error: undefined,
              });
            }, {
              signal: abortSignal,
              graph: { nodes: latestState.nodes, edges: latestState.edges },
              functionRuntime: flowFunctionNodeExecutionRuntime,
              onInternalUsage: (entry) => recordIncurredUsage(entry.node, entry.usage),
            });

            if (!execution.usageAttributions?.length) {
              recordIncurredUsage(latestNode, execution.usage);
            }
            throwIfRunAborted();
            if (!isRunOwnerValid(currentId)) return;

            // Multi-image output from a SINGLE call (e.g. Seedream Sequential's `max_images`): surface every
            // image as an envelope so they all land in the Source Library + downstream list, not just the first.
            if (isAssetSourceKind(execution.resultType) && execution.additionalResults && execution.additionalResults.length > 0) {
              const firstMediaResult = resultValueAsMediaUrl(execution.result);
              if (!firstMediaResult) {
                throw new Error(`The ${execution.resultType} executor returned a non-media value.`);
              }
              const allOutputs = [{ result: firstMediaResult, mimeType: execution.mimeType }, ...execution.additionalResults];
              const baseLabel = (latestNode.data.title as string) || `${latestNode.type} result`;
              const envelopeItems: EnvelopeItem[] = [];
              const sourceItemsForPatch: Array<import('./sourceBinStore').SourceBinLibraryItem> = [];
              for (let index = 0; index < allOutputs.length; index += 1) {
                throwIfRunAborted();
                if (!isRunOwnerValid(currentId)) {
                  discardRunSourceItems(sourceItemsForPatch);
                  return;
                }
                const output = allOutputs[index];
                const sourceItem = await persistAndPublishRunAsset(currentId, {
                  label: `${baseLabel} ${index + 1}`,
                  kind: execution.resultType,
                  mimeType: output.mimeType ?? execution.mimeType ?? 'application/octet-stream',
                  dataUrl: output.result,
                  isGenerated: true,
                  originNodeId: currentId,
                  originWorkspaceId: owner.workspaceId,
                  originRunId: owner.runId,
                  envelopeId,
                  envelopeLabel: baseLabel,
                  envelopeIndex: index,
                  envelopeCollapsed: false,
                });
                sourceItemsForPatch.push(sourceItem);
                if (!isRunOwnerValid(currentId)) {
                  discardRunSourceItems(sourceItemsForPatch);
                  return;
                }
                envelopeItems.push({
                  id: `${currentId}-envelope-${Date.now()}-${index}`,
                  index,
                  kind: execution.resultType,
                  label: `${baseLabel} ${index + 1}`,
                  value: sourceItem.assetUrl ?? output.result,
                  mimeType: output.mimeType ?? execution.mimeType ?? getResultMimeType(execution.resultType),
                  sourceNodeId: currentId,
                  sourceBinItemId: sourceItem.id,
                  usage: index === 0 ? execution.usage : undefined,
                });
              }
              const firstItem = envelopeItems[0];
              const publishedNamedOutputs = await persistNamedOutputAssets(currentId, execution.namedOutputs ?? execution.functionOutputs, {
                envelopeId,
                envelopeIndex: 0,
                nodeLabel: baseLabel,
                primaryOriginalResult: firstMediaResult,
                primaryPublishedResult: firstItem.value,
                primarySourceBinItemId: firstItem.sourceBinItemId,
              }, sourceItemsForPatch);
              const multiAttemptState = appendResultAttempt(latestNode.data.resultHistory ?? [], {
                result: firstItem.value,
                resultType: execution.resultType,
                statusMessage: execution.statusMessage,
                usage: execution.usage,
                sourceBinItemId: firstItem.sourceBinItemId,
              });
              const vectorCacheKeys = allOutputs.map(() => cacheKey);
              const resultInputSignature = flowResultCacheSignatureFromKeys(vectorCacheKeys);
              const finalPatch: Partial<NodeData> = {
                result: firstItem.value,
                resultType: execution.resultType,
                resultMimeType: firstItem.mimeType,
                functionOutputs: execution.functionOutputs ? publishedNamedOutputs : undefined,
                namedOutputs: publishedNamedOutputs,
                envelopeItems,
                resultHistory: multiAttemptState.attempts,
                selectedResultId: multiAttemptState.selectedAttemptId,
                usage: execution.usage,
                error: undefined,
                statusMessage: execution.statusMessage,
                sourceBinItemId: firstItem.sourceBinItemId,
                resultInputSignature,
              };
              if (!commitRunPatch(currentId, finalPatch)) {
                discardRunSourceItems(sourceItemsForPatch);
                return;
              }
              for (const [index, item] of envelopeItems.entries()) {
                const itemCacheKey = vectorCacheKeys[index];
                if (!itemCacheKey) continue;
                const cacheEntry = cacheEntryFromEnvelopeItem(latestNode, item, itemCacheKey, execution.statusMessage);
                if (cacheEntry) setFlowResultCacheEntry(cacheEntry);
              }
              return;
            }

            let generatedSourceBinItemId: string | undefined;
            let primaryOriginalResult: string | undefined;
            const sourceItemsForPatch: Array<import('./sourceBinStore').SourceBinLibraryItem> = [];
            if (isAssetSourceKind(execution.resultType)) {
              const mediaResult = resultValueAsMediaUrl(execution.result);
              if (!mediaResult) {
                throw new Error(`The ${execution.resultType} executor returned a non-media value.`);
              }
              primaryOriginalResult = mediaResult;
              if (!isRunOwnerValid(currentId)) return;
              const sourceItem = await persistAndPublishRunAsset(currentId, {
                label: (latestNode.data.title as string) || `${latestNode.type} result`,
                kind: execution.resultType,
                mimeType: execution.mimeType ?? 'application/octet-stream',
                dataUrl: mediaResult,
                blob: execution.blob,
                nativeFilePath: execution.nativeFilePath,
                isGenerated: true,
                originNodeId: currentId,
                originWorkspaceId: owner.workspaceId,
                originRunId: owner.runId,
                envelopeId,
                envelopeLabel: (latestNode.data.title as string) || `${latestNode.type} result`,
                envelopeIndex: 0,
                envelopeCollapsed: false,
              });
              sourceItemsForPatch.push(sourceItem);
              if (!isRunOwnerValid(currentId)) {
                discardRunSourceItems(sourceItemsForPatch);
                return;
              }
              execution.result = sourceItem.assetUrl ?? mediaResult;
              generatedSourceBinItemId = sourceItem.id;
            }

            const publishedNamedOutputs = await persistNamedOutputAssets(currentId, execution.namedOutputs ?? execution.functionOutputs, {
              envelopeId,
              envelopeIndex: 0,
              nodeLabel: (latestNode.data.title as string) || `${latestNode.type} result`,
              primaryOriginalResult,
              primaryPublishedResult: typeof execution.result === 'string' ? execution.result : undefined,
              primarySourceBinItemId: generatedSourceBinItemId,
            }, sourceItemsForPatch);

            const nextAttemptState = appendResultAttempt(latestNode.data.resultHistory ?? [], {
              ...execution,
              sourceBinItemId: generatedSourceBinItemId,
            });

            const finalPatch: Partial<NodeData> = {
              result: execution.result,
              resultType: execution.resultType,
              resultMimeType: execution.mimeType,
              resultExtension: execution.extension,
              resultFileName: execution.fileName,
              resultOutputMetadata: execution.outputMetadata,
              functionOutputs: execution.functionOutputs ? publishedNamedOutputs : undefined,
              namedOutputs: publishedNamedOutputs,
              envelopeItems: undefined,
              resultHistory: nextAttemptState.attempts,
              selectedResultId: nextAttemptState.selectedAttemptId,
              sourceBinItemId: generatedSourceBinItemId,
              usage: execution.usage,
              resultInputSignature: cacheKey,
              error: undefined,
              statusMessage: execution.statusMessage,
            };
            if (!commitRunPatch(currentId, finalPatch)) {
              discardRunSourceItems(sourceItemsForPatch);
            } else {
              const cacheEntry = cacheEntryFromNode(
                { ...latestNode, data: { ...latestNode.data, ...finalPatch } },
                cacheKey,
              );
              if (cacheEntry) setFlowResultCacheEntry(cacheEntry);
            }
          } catch (error) {
            const partialUsage = (error as { usage?: UsageTelemetry }).usage;
            if (partialUsage && canRunNode(currentNode)) {
              recordIncurredUsage(currentNode, partialUsage);
            }
            if (isAbortError(error)) {
              commitRunPatch(currentId, {
                error: undefined,
                statusMessage: 'Run cancelled.',
                resultInputSignature: undefined,
              });
              throw error;
            }

            const message =
              error instanceof Error ? error.message : 'Flow execution failed for an unknown reason.';
            commitRunPatch(currentId, {
              error: message,
              statusMessage: undefined,
              resultInputSignature: undefined,
            });

            throw error;
          } finally {
            if (canRunNode(currentNode)) {
              commitRunPatch(currentId, {
                isRunning: false,
              });
            }
          }
          })();
          completedNodePromises.set(currentId, execution);
          return execution;
        };

        try {
          await executeRecursively(nodeId, new Set());
        } catch (error) {
          if (!isAbortError(error)) {
            console.error(error);
          }
        } finally {
          if (requestedRootNode && !canRunNode(requestedRootNode)) {
            commitRunPatch(nodeId, { isRunning: false });
          }
          activeRunControllers.delete(owner.runId);
          workspaceStore.unregisterFlowRun(owner);
          activeGraphRuns.delete(runKey);
        }
        })();

        activeGraphRuns.set(runKey, run);
        void run.finally(() => {
          activePlanningControllers.delete(runKey);
          if (activeGraphRuns.get(runKey) === run) {
            activeGraphRuns.delete(runKey);
          }
        }).catch(() => {
          // runNode deliberately renders failures into node state instead of rejecting to callers.
        });
        return run;
      },
    }),
    {
      name: FLOW_STORAGE_KEY,
      storage: createJSONStorage(() => createDebouncedLocalStorage(PERSIST_DEBOUNCE_MS)),
      partialize: (state) => ({
        nodes: Array.isArray(state.nodes) ? state.nodes.map(stripRuntimeData) : [],
        edges: Array.isArray(state.edges) ? state.edges : [],
        bookmarkSidebarOpen: state.bookmarkSidebarOpen,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedFlowState(persisted),
      }),
      onRehydrateStorage: () => (state) => {
        state?.hydratePersistedState();
      },
    },
  ),
);

// Tie the unified cross-device sync's Flow channel (task #51) to this store's lifetime: registering it
// here means sync activates exactly when the Flow workspace is present, at no app-startup cost. Dynamic
// import keeps the static dependency one-way (`flowSyncChannel` → `flowStore`), avoiding an import cycle.
// Skipped under the test runner so a unit test importing this store can't spawn a floating channel-init
// side-effect that races vitest's multi-file module evaluation; the channel's own tests init explicitly.
if (import.meta.env?.MODE !== 'test') {
  void Promise.all([
    import('../lib/flowSyncChannel').then((module) => module.initializeFlowSyncChannel()),
    import('../lib/videoSyncChannel').then((module) => module.initializeVideoSyncChannel()),
  ]).catch(() => undefined);
}
