import type { Edge } from '@xyflow/react';
import type { EditorWorkspaceSnapshot } from '../store/editorStore';
import type { ImageEditorProjectSnapshot } from '../store/imageEditorStore';
import type { SourceBinLibraryItem, SourceBinProjectSnapshot } from '../store/sourceBinStore';
import type { AppNode, EditorSourceKind, EnvelopeItem, NodeData, NodeOutputArtifact, NodeResultAttempt, ResultType, UsageTelemetry, WorkspaceView } from '../types/flow';
import type {
  PaperDocumentSnapshot,
  PaperQuarantinedDocumentRecovery,
  PaperSnapshotRecovery,
  PaperTool,
  PaperWorkspaceDocumentSnapshot,
} from '../types/paper';
import { mergePaperSnapshotRecovery, sanitizePaperSnapshotRecovery } from './paperSnapshotRecovery';
import { sanitizePaperPortableAssetsSection } from '../features/paper/assets/PaperPortableAssets';
import { isBinaryAssetRef, type BinaryAssetId } from '../shared/assets/contentAddressedAsset';
import type {
  ImageDocument,
  ImageDocumentSnapshot,
  ImageDocumentSnapshotAssetIntegrity,
  ImageDocumentSnapshotIntegrity,
  ImageLayer,
  ImageLayerComp,
  ImageLayerEditTarget,
  ImageQuickActionMacro,
  ImageSavedWorkPath,
  ImageVectorPathPoint,
  LayerType,
} from '../types/imageEditor';
import { MAX_SAVED_WORK_PATHS, sanitizeSavedWorkPathName } from '../components/ImageEditor/ImageSavedWorkPaths';
import type { FlowProjectDocument } from './projectLibrary';
import {
  buildDefaultFlowWorkspace,
  DEFAULT_FLOW_WORKSPACE_ID,
  DEFAULT_FLOW_WORKSPACE_NAME,
  findActiveFlowWorkspace,
  type FlowWorkspaceProjectSnapshot,
} from './flowProjectWorkspaces';
import { buildFlowNodeGeneratedResultPatch, collectSourceBinItemsForFlowNode, rebindNodeOutputAssetsToSourceBin } from './flowNodeResultRestore';
import { buildMediaAssetSignaturePart } from './mediaAssetSignature';
import { CURRENT_PROJECT_SCHEMA_VERSION, isFlowNodeType } from './projectSchema';
import { sanitizeProjectHistorySection } from './projectHistory';
import { sanitizeProjectUsageLedgerSnapshot } from './projectUsageLedger';
import { sanitizeCompositionAudioMigrationWarnings } from './compositionTracks';
import { sanitizeImageLayerLocks } from './imageLayerLocks';
import {
  assertImageDocumentSnapshotDecodeBounds,
  IMAGE_PROJECT_MAX_SNAPSHOT_LAYERS,
  IMAGE_PROJECT_MAX_SNAPSHOT_METADATA_BYTES,
  IMAGE_PROJECT_MAX_SNAPSHOT_STRUCTURAL_RESOURCES,
  IMAGE_PROJECT_MAX_SNAPSHOTS,
} from '../components/ImageEditor/ImageSnapshots';
import {
  omitImageLayerLinkGroup,
  sanitizeImageLayerLinkGroupId,
} from './imageLayerLinks';
import {
  sanitizeImageLayerMaskDensity,
  sanitizeImageLayerMaskFeather,
} from '../components/ImageEditor/ImageLayerMask';
import {
  isPlausibleSavedSelectionChannelData,
  sanitizeSavedSelectionChannelName,
  truncateSavedSelectionChannels,
} from '../components/ImageEditor/ImageSelectionChannels';
import { sanitizeImageSpotChannelName } from '../components/ImageEditor/ImageSpotChannels';
import { isPaperManagedIccProfile } from './paperManagedIccProfiles';
import { normalizeBundledFontFaceState, normalizeBundledFontFaceStateForTypography } from './bundledFontLibrary';
import { getEditorAssets } from './editorAssets';
import { getEditorAudioClips, getEditorVisualClips } from './manualEditorState';
import {
  sanitizeEditorProfessionalVideoState,
  sanitizeSourceBinProfessionalMediaState,
} from './videoProfessionalState';
import { sanitizeEditorProfessionalWorkflowState } from './videoProductionState';
import { getEditorStageObjects } from './editorStageObjects';
import { normalizeTimelineMarkers } from './editorTimelineMarkers';
import { restoreResultValue } from './flowResultValues';
import {
  MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH,
  sanitizeImageTiltmarkLayerMetadata,
} from '../components/ImageEditor/tiltmark/ImageTiltmarkLayer';
import {
  attachProjectSnapshotsToModelCardNodes,
  sanitizeEmbeddedProviderPackSnapshots,
} from './providerPackProjectSanitizer';
import {
  API_REQUESTER_PERSISTED_CREDENTIAL_MARKER,
  isApiRequesterCredentialFieldName,
} from './apiRequesterCredentials';
import {
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  type CardColumnCountV1,
  type ModelCardLayoutOverrideV1,
  type ModelCardRefV1,
} from './providerPackContracts';

const VALID_RESULT_TYPES = new Set<ResultType>(['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope']);
const VALID_SOURCE_KINDS = new Set<EditorSourceKind>(['text', 'image', 'video', 'audio', 'composition', 'document', 'subtitle', 'package']);
const VALID_WORKSPACE_VIEWS = new Set<WorkspaceView>(['flow', 'editor', 'image', 'paper']);
const VALID_PAPER_TOOLS = new Set<PaperTool>([
  'select', 'hand', 'text', 'image', 'speech', 'thought', 'caption', 'panel', 'shape', 'line', 'ellipse', 'triangle', 'pentagon', 'hexagon', 'gutterKnife', 'tiltmark',
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validModelCardColumns(value: unknown): value is CardColumnCountV1 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 14;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalNonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function sanitizeUsage(value: unknown): UsageTelemetry | undefined {
  if (!isRecord(value) || (value.source !== 'actual' && value.source !== 'estimate')) return undefined;
  if (!['measured', 'heuristic', 'fixed', 'unknown'].includes(String(value.confidence))) return undefined;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === 'string' && Boolean(note.trim()))
    : undefined;
  return {
    source: value.source,
    confidence: value.confidence as UsageTelemetry['confidence'],
    provider: optionalNonBlankString(value.provider),
    modelId: optionalNonBlankString(value.modelId),
    costUsd: optionalNumber(value.costUsd),
    inputTokens: optionalNumber(value.inputTokens),
    outputTokens: optionalNumber(value.outputTokens),
    totalTokens: optionalNumber(value.totalTokens),
    characters: optionalNumber(value.characters),
    durationSeconds: optionalNumber(value.durationSeconds),
    imageCount: optionalNumber(value.imageCount),
    notes: notes && notes.length > 0 ? notes : undefined,
  };
}

type SafeMetadataValue = string | number | boolean | null | SafeMetadataValue[] | { [key: string]: SafeMetadataValue };

const SAFE_OUTPUT_METADATA_MAX_DEPTH = 12;
const SAFE_OUTPUT_METADATA_MAX_KEYS_PER_OBJECT = 64;
const SAFE_OUTPUT_METADATA_MAX_KEYS = 256;
const SAFE_OUTPUT_METADATA_MAX_ARRAY_LENGTH = 256;
const SAFE_OUTPUT_METADATA_MAX_STRING_BYTES = 16 * 1024;
const SAFE_OUTPUT_METADATA_MAX_KEY_BYTES = 512;
const SAFE_OUTPUT_METADATA_MAX_NODES = 1024;
const SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES = 1024 * 1024;
const UNSAFE_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Output metadata is untrusted persisted data. Bound it in one linear walk so
 * a malformed attempt loses only metadata, never its otherwise valid result.
 */
function sanitizeMetadataValue(value: unknown): SafeMetadataValue | undefined {
  const seen = new WeakSet<object>();
  let nodeCount = 0;
  let keyCount = 0;
  let estimatedUtf8Bytes = 0;

  const visit = (candidate: unknown, depth: number): SafeMetadataValue | undefined => {
    nodeCount += 1;
    if (nodeCount > SAFE_OUTPUT_METADATA_MAX_NODES || depth > SAFE_OUTPUT_METADATA_MAX_DEPTH) return undefined;

    if (candidate === null || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') return Number.isFinite(candidate) ? candidate : undefined;
    if (typeof candidate === 'string') {
      const bytes = utf8ByteLength(candidate);
      estimatedUtf8Bytes += bytes;
      return bytes <= SAFE_OUTPUT_METADATA_MAX_STRING_BYTES && estimatedUtf8Bytes <= SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES
        ? candidate
        : undefined;
    }
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return undefined;
    seen.add(candidate);

    // Never read untrusted properties directly. Descriptors make accessors
    // fail closed, while Reflect calls are caught below for revoked/trapping
    // Proxies. Persisted JSON has only enumerable own data properties.
    if (Array.isArray(candidate)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > SAFE_OUTPUT_METADATA_MAX_ARRAY_LENGTH) return undefined;
      const keys = Reflect.ownKeys(candidate);
      if (keys.length !== length + 1 || keys.some((key) => typeof key !== 'string')) return undefined;
      const items: SafeMetadataValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined;
        const sanitized = visit(descriptor.value, depth + 1);
        if (sanitized === undefined) return undefined;
        items.push(sanitized);
      }
      return items;
    }

    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(candidate);
    if (keys.length > SAFE_OUTPUT_METADATA_MAX_KEYS_PER_OBJECT || keys.some((key) => typeof key !== 'string')) return undefined;
    keyCount += keys.length;
    if (keyCount > SAFE_OUTPUT_METADATA_MAX_KEYS) return undefined;

    const result = Object.create(null) as { [key: string]: SafeMetadataValue };
    for (const key of keys) {
      if (typeof key !== 'string' || UNSAFE_METADATA_KEYS.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined;
      const keyBytes = utf8ByteLength(key);
      estimatedUtf8Bytes += keyBytes;
      if (keyBytes > SAFE_OUTPUT_METADATA_MAX_KEY_BYTES || estimatedUtf8Bytes > SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES) return undefined;
      const sanitized = visit(descriptor.value, depth + 1);
      if (sanitized === undefined) return undefined;
      Object.defineProperty(result, key, { value: sanitized, enumerable: true, configurable: true, writable: true });
    }
    return result;
  };

  try {
    const sanitized = visit(value, 0);
    if (sanitized === undefined) return undefined;
    return utf8ByteLength(JSON.stringify(sanitized)) <= SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES ? sanitized : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeOutputMetadata(value: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitizeMetadataValue(value);
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === 'object'
    ? sanitized as Record<string, unknown>
    : undefined;
}

function sanitizeNodeOutputTable(value: unknown): Record<string, NodeOutputArtifact> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return {};
  const entries: Array<[string, NodeOutputArtifact]> = [];

  for (const [handle, rawOutput] of Object.entries(value).slice(0, 64)) {
    if (!handle.trim() || handle.length > 160 || !isRecord(rawOutput)) continue;
    const rawResultType = optionalString(rawOutput.resultType);
    if (!rawResultType || !VALID_RESULT_TYPES.has(rawResultType as ResultType)) continue;
    const resultType = rawResultType as ResultType;
    const result = restoreResultValue(rawOutput.result, resultType);
    if (result === undefined) continue;
    const rawAssetKind = optionalString(rawOutput.assetKind);
    const assetKind = rawAssetKind && VALID_SOURCE_KINDS.has(rawAssetKind as EditorSourceKind)
      ? rawAssetKind as EditorSourceKind
      : undefined;

    entries.push([handle, {
      result,
      resultType,
      assetKind,
      sourceBinItemId: optionalNonBlankString(rawOutput.sourceBinItemId),
      mimeType: optionalNonBlankString(rawOutput.mimeType),
      extension: optionalNonBlankString(rawOutput.extension),
      fileName: optionalNonBlankString(rawOutput.fileName),
      outputMetadata: sanitizeOutputMetadata(rawOutput.outputMetadata),
      additionalResults: Array.isArray(rawOutput.additionalResults)
        ? rawOutput.additionalResults.slice(0, 64).flatMap((item) => isRecord(item) && typeof item.result === 'string'
          ? [{ result: item.result, mimeType: optionalNonBlankString(item.mimeType) }]
          : [])
        : undefined,
    }]);
  }

  return Object.fromEntries(entries);
}

function sanitizeResultHistory(value: unknown): NodeResultAttempt[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];

  return value.flatMap((attempt, index) => {
    if (!isRecord(attempt)) return [];
    const resultType = optionalString(attempt.resultType);
    const result = resultType && VALID_RESULT_TYPES.has(resultType as ResultType)
      ? restoreResultValue(attempt.result, resultType as ResultType)
      : undefined;

    if (result === undefined || (typeof result === 'string' && result === '') || !resultType || !VALID_RESULT_TYPES.has(resultType as ResultType)) {
      return [];
    }

    return [{
      id: stringValue(attempt.id, `attempt-${index}`),
      result,
      resultType: resultType as ResultType,
      statusMessage: stringValue(attempt.statusMessage, 'Restored result'),
      createdAt: stringValue(attempt.createdAt, new Date(0).toISOString()),
      usage: sanitizeUsage(attempt.usage),
      mimeType: optionalNonBlankString(attempt.mimeType),
      extension: optionalNonBlankString(attempt.extension),
      fileName: optionalNonBlankString(attempt.fileName),
      outputMetadata: sanitizeOutputMetadata(attempt.outputMetadata),
      variableName: optionalNonBlankString(attempt.variableName),
      sourceBinItemId: optionalNonBlankString(attempt.sourceBinItemId),
    }];
  });
}

function sanitizeEnvelopeItems(value: unknown): EnvelopeItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const seenSourceBinItemIds = new Set<string>();
  const seenSignatures = new Set<string>();

  const rawItems = value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const val = optionalString(item.value);
    const kind = optionalString(item.kind);
    if (val === undefined || !kind || !VALID_RESULT_TYPES.has(kind as ResultType)) return [];

    const id = stringValue(item.id, `envelope-item-${index}`);
    const sourceBinItemId = optionalString(item.sourceBinItemId);
    const sourceNodeId = optionalString(item.sourceNodeId);

    const sigPart = buildMediaAssetSignaturePart(val);
    const signature = `${kind}:${sigPart}`;

    if (seenIds.has(id)) return [];
    if (sourceBinItemId && seenSourceBinItemIds.has(sourceBinItemId)) return [];
    if (seenSignatures.has(signature)) return [];

    seenIds.add(id);
    if (sourceBinItemId) seenSourceBinItemIds.add(sourceBinItemId);
    seenSignatures.add(signature);

    return [{
      id,
      index: optionalNumber(item.index) ?? index,
      kind: kind as ResultType,
      label: stringValue(item.label, `Envelope item ${index + 1}`),
      value: val,
      mimeType: optionalString(item.mimeType),
      sourceBinItemId,
      sourceNodeId,
      usage: isRecord(item.usage) ? item.usage as unknown as EnvelopeItem['usage'] : undefined,
    }];
  });

  const sorted = rawItems.sort((left, right) => left.index - right.index);

  return sorted.map((item, index) => {
    let cleanSourceNodeId = item.sourceNodeId;
    if (cleanSourceNodeId) {
      const parts = cleanSourceNodeId.split(':');
      if (parts.length > 2) {
        cleanSourceNodeId = `${parts[0]}:${parts[1]}`;
      }
    }

    return {
      ...item,
      index,
      sourceNodeId: cleanSourceNodeId,
    };
  });
}

function restoreSelectedResultFromHistory(data: NodeData, history: NodeResultAttempt[]): void {
  if (history.length === 0) return;
  const selectedResultId = typeof data.selectedResultId === 'string' ? data.selectedResultId : undefined;
  const selected = history.find((attempt) => attempt.id === selectedResultId) ?? history[history.length - 1];
  if (!selected) return;

  data.selectedResultId = selected.id;
  data.result = selected.result;
  data.resultType = selected.resultType;
  data.usage = selected.usage;
  data.resultMimeType = selected.mimeType;
  data.resultExtension = selected.extension;
  data.resultFileName = selected.fileName;
  data.resultOutputMetadata = selected.outputMetadata;
}

function sanitizeNodeData(value: unknown, options: { preserveRuntimeRunState?: boolean } = {}): NodeData {
  const data: NodeData = isRecord(value) ? { ...value } : {};
  const history = sanitizeResultHistory(data.resultHistory);
  const envelopeItems = sanitizeEnvelopeItems(data.envelopeItems);

  delete data.onChange;
  delete data.onRun;
  delete data.onSelectAttempt;
  data.modelCardRef = sanitizeModelCardRef(data.modelCardRef);
  data.modelCardLayoutOverride = sanitizeModelCardLayoutOverride(data.modelCardLayoutOverride);
  data.modelCardValues = sanitizeModelCardValues(data.modelCardValues);
  // Embedded snapshots are accepted only from the bounded top-level project section and attached
  // after all Flow workspaces are sanitized.
  delete data.embeddedProviderPackSnapshots;
  if (!options.preserveRuntimeRunState) {
    data.isRunning = undefined;
  }
  data.error = undefined;
  data.statusMessage = undefined;

  if (Object.hasOwn(data, 'resultOutputMetadata')) {
    data.resultOutputMetadata = sanitizeOutputMetadata(data.resultOutputMetadata);
  }
  if (Object.hasOwn(data, 'functionOutputs')) {
    data.functionOutputs = sanitizeNodeOutputTable(data.functionOutputs);
  }
  if (Object.hasOwn(data, 'namedOutputs')) {
    data.namedOutputs = sanitizeNodeOutputTable(data.namedOutputs);
  }

  if (Object.hasOwn(data, 'compositionAudioMigrationWarnings')) {
    data.compositionAudioMigrationWarnings = sanitizeCompositionAudioMigrationWarnings(
      data.compositionAudioMigrationWarnings,
    );
  }

  if (Object.hasOwn(data, 'editorTimelineMarkers')) {
    data.editorTimelineMarkers = normalizeTimelineMarkers(data.editorTimelineMarkers);
  }

  if (data.resultType === 'boolean' && Object.hasOwn(data, 'result')) {
    const result = restoreResultValue(data.result, 'boolean');
    if (result === undefined) {
      delete data.result;
      delete data.resultType;
    } else {
      data.result = result;
    }
  }

  if (history !== undefined) {
    data.resultHistory = history;
    if (data.selectedResultId && !history.some((attempt) => attempt.id === data.selectedResultId)) {
      data.selectedResultId = history[history.length - 1]?.id;
    }
    restoreSelectedResultFromHistory(data, history);
  }

  if (envelopeItems !== undefined) {
    data.envelopeItems = envelopeItems;
  }

  if (data.editorAssets !== undefined) data.editorAssets = getEditorAssets(data);
  if (data.editorVisualClips !== undefined) data.editorVisualClips = getEditorVisualClips(data);
  if (data.editorAudioClips !== undefined) data.editorAudioClips = getEditorAudioClips(data);
  if (data.editorProfessionalState !== undefined) {
    data.editorProfessionalState = sanitizeEditorProfessionalVideoState(data.editorProfessionalState);
  }
  if (data.editorProfessionalWorkflowState !== undefined) {
    data.editorProfessionalWorkflowState = sanitizeEditorProfessionalWorkflowState(data.editorProfessionalWorkflowState);
  }
  if (data.editorStageObjects !== undefined) data.editorStageObjects = getEditorStageObjects(data);

  return data;
}

function sanitizeModelCardRef(value: unknown): ModelCardRefV1 | undefined {
  if (
    !isRecord(value)
    || !['packId', 'version', 'hash', 'cardId'].every((key) =>
      typeof value[key] === 'string' && String(value[key]).length <= 512
    )
  ) return undefined;
  return {
    packId: String(value.packId),
    version: String(value.version),
    hash: String(value.hash),
    cardId: String(value.cardId),
  };
}

function sanitizeModelCardLayoutOverride(value: unknown): ModelCardLayoutOverrideV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.cardId !== 'string') return undefined;
  const width = typeof value.width === 'number' && Number.isFinite(value.width)
    ? Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, value.width))
    : undefined;
  const fitTarget = ['1080p', '1440p', '4k'].includes(String(value.fitTarget))
    ? value.fitTarget as ModelCardLayoutOverrideV1['fitTarget']
    : undefined;
  const containers = Array.isArray(value.containers)
    ? value.containers.slice(0, 256).flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.order !== 'number') return [];
        return [{
          id: entry.id.slice(0, 256),
          order: entry.order,
          columns: validModelCardColumns(entry.columns) ? entry.columns : undefined,
          operationColumns: isRecord(entry.operationColumns)
            ? Object.fromEntries(Object.entries(entry.operationColumns).filter(([, columns]) =>
                validModelCardColumns(columns)
              )) as Record<string, CardColumnCountV1>
            : undefined,
          collapsedByDefault: typeof entry.collapsedByDefault === 'boolean' ? entry.collapsedByDefault : undefined,
          x: finiteOptionalNumber(entry.x),
          y: finiteOptionalNumber(entry.y),
          width: finiteOptionalNumber(entry.width),
          height: finiteOptionalNumber(entry.height),
        }];
      })
    : undefined;
  const elements = Array.isArray(value.elements)
    ? value.elements.slice(0, 1_024).flatMap((entry) => {
        if (
          !isRecord(entry)
          || typeof entry.id !== 'string'
          || typeof entry.containerId !== 'string'
          || typeof entry.order !== 'number'
        ) return [];
        return [{
          id: entry.id.slice(0, 256),
          containerId: entry.containerId.slice(0, 256),
          order: entry.order,
          x: finiteOptionalNumber(entry.x),
          y: finiteOptionalNumber(entry.y),
          width: finiteOptionalNumber(entry.width),
          height: finiteOptionalNumber(entry.height),
          columnSpan: validModelCardColumns(entry.columnSpan) ? entry.columnSpan : undefined,
          hidden: typeof entry.hidden === 'boolean' ? entry.hidden : undefined,
        }];
      })
    : undefined;
  const handlePlacements = Array.isArray(value.handlePlacements)
    ? value.handlePlacements.slice(0, 4_096).flatMap((entry) => {
        if (
          !isRecord(entry)
          || typeof entry.portId !== 'string'
          || !['card', 'element'].includes(String(entry.anchor))
          || !['left', 'right', 'top', 'bottom'].includes(String(entry.side))
          || typeof entry.offsetPercent !== 'number'
          || !Number.isFinite(entry.offsetPercent)
        ) return [];
        if (entry.anchor === 'element' && typeof entry.elementId !== 'string') return [];
        return [{
          portId: entry.portId.slice(0, 256),
          anchor: entry.anchor as 'card' | 'element',
          ...(entry.anchor === 'element' ? { elementId: String(entry.elementId).slice(0, 256) } : {}),
          side: entry.side as 'left' | 'right' | 'top' | 'bottom',
          offsetPercent: Math.max(0, Math.min(100, entry.offsetPercent)),
        }];
      })
    : undefined;
  return {
    schemaVersion: 1,
    cardId: value.cardId.slice(0, 256),
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId.slice(0, 256) } : {}),
    ...(width === undefined ? {} : { width }),
    ...(fitTarget === undefined ? {} : { fitTarget }),
    ...(containers === undefined ? {} : { containers }),
    ...(elements === undefined ? {} : { elements }),
    ...(handlePlacements === undefined ? {} : { handlePlacements }),
  };
}

function sanitizeModelCardValues(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 512).map(([key, item]) => [
    key.slice(0, 256),
    isApiRequesterCredentialFieldName(key) ? API_REQUESTER_PERSISTED_CREDENTIAL_MARKER : item,
  ]));
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeVisionVerifyNodeData(data: NodeData): NodeData {
  const legacyBoolean = data.resultType === 'text' ? restoreResultValue(data.result, 'boolean') : undefined;
  const history = Array.isArray(data.resultHistory)
    ? data.resultHistory.map((attempt) => {
      const legacyAttemptBoolean = attempt.resultType === 'text'
        ? restoreResultValue(attempt.result, 'boolean')
        : undefined;
      return legacyAttemptBoolean === undefined
        ? attempt
        : { ...attempt, result: legacyAttemptBoolean, resultType: 'boolean' as const };
    })
    : undefined;
  const normalized: NodeData = {
    ...data,
    ...(history ? { resultHistory: history } : {}),
    ...(typeof data.result === 'boolean' ? { resultType: 'boolean' as const } : {}),
    ...(legacyBoolean === undefined ? {} : { result: legacyBoolean, resultType: 'boolean' as const }),
  };

  // Re-select after converting history so the active value and its port type
  // agree even when the user last selected a legacy false attempt.
  if (history) {
    restoreSelectedResultFromHistory(normalized, history);
  }
  return normalized;
}

export function sanitizeFlowSnapshot(
  snapshot: unknown,
  options: { preserveRuntimeRunState?: boolean } = {},
): FlowProjectDocument['flow'] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) {
    throw new Error('The selected file is not a valid Sloom Studio .sloom project: flow nodes and edges must be arrays.');
  }

  const seenNodeIds = new Set<string>();
  const nodes = snapshot.nodes.flatMap((node, index): AppNode[] => {
    if (!isRecord(node)) return [];

    const rawType = node.type === 'input' ? 'textNode' : node.type;
    if (!isFlowNodeType(rawType)) {
      return [];
    }

    const id = stringValue(node.id, `node-${index}`);
    if (seenNodeIds.has(id)) return [];
    seenNodeIds.add(id);

    const rawPosition = isRecord(node.position) ? node.position : undefined;
    return [{
      ...node,
      id,
      type: rawType,
      position: {
        x: finiteNumber(rawPosition?.x, 0),
        y: finiteNumber(rawPosition?.y, 0),
      },
      data: rawType === 'visionVerifyNode'
        ? normalizeVisionVerifyNodeData(sanitizeNodeData(node.data, options))
        : sanitizeNodeData(node.data, options),
    } as AppNode];
  });

  const validNodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const edges = snapshot.edges.flatMap((edge, index): Edge[] => {
    if (!isRecord(edge)) return [];
    const source = optionalString(edge.source);
    const target = optionalString(edge.target);

    if (!source || !target || !validNodeIds.has(source) || !validNodeIds.has(target)) {
      return [];
    }

    const id = stringValue(edge.id, `${source}-${target}-${index}`);
    if (seenEdgeIds.has(id)) return [];
    seenEdgeIds.add(id);

    return [{
      ...edge,
      id,
      source,
      target,
      sourceHandle: optionalString(edge.sourceHandle),
      targetHandle: optionalString(edge.targetHandle),
    } as Edge];
  });

  return {
    version: finiteNumber(snapshot.version, 3),
    nodes,
    edges,
  };
}

export function sanitizeEditorSnapshot(snapshot: unknown): Partial<EditorWorkspaceSnapshot> | undefined {
  if (snapshot === undefined) return undefined;
  if (!isRecord(snapshot)) return undefined;

  return {
    workspaceView: VALID_WORKSPACE_VIEWS.has(snapshot.workspaceView as WorkspaceView) ? snapshot.workspaceView as WorkspaceView : 'flow',
    activeSourceBinId: optionalString(snapshot.activeSourceBinId),
    activeCompositionId: optionalString(snapshot.activeCompositionId),
    selectedSourceItemId: optionalString(snapshot.selectedSourceItemId),
    selectedVisualClipId: optionalString(snapshot.selectedVisualClipId),
    selectedAudioClipId: optionalString(snapshot.selectedAudioClipId),
    sourceBinTab: snapshot.sourceBinTab === 'editorAssets' ? 'editorAssets' : 'media',
    sourceMonitorVisible: typeof snapshot.sourceMonitorVisible === 'boolean' ? snapshot.sourceMonitorVisible : undefined,
    programMonitorVisible: typeof snapshot.programMonitorVisible === 'boolean' ? snapshot.programMonitorVisible : undefined,
    inspectorVisible: typeof snapshot.inspectorVisible === 'boolean' ? snapshot.inspectorVisible : undefined,
    sourceBinVisible: typeof snapshot.sourceBinVisible === 'boolean' ? snapshot.sourceBinVisible : undefined,
    sourceMonitorWidth: optionalNumber(snapshot.sourceMonitorWidth),
    inspectorWidth: optionalNumber(snapshot.inspectorWidth),
    sourceBinWidth: optionalNumber(snapshot.sourceBinWidth),
    monitorSplitPercent: optionalNumber(snapshot.monitorSplitPercent),
    monitorSectionHeight: optionalNumber(snapshot.monitorSectionHeight),
    timelineVisualTrackHeight: optionalNumber(snapshot.timelineVisualTrackHeight),
    timelineAudioTrackHeight: optionalNumber(snapshot.timelineAudioTrackHeight),
  };
}

function sanitizeSourceBinItem(item: unknown, index: number): (SourceBinLibraryItem & { assetUrl?: string }) | undefined {
  if (!isRecord(item)) return undefined;
  const rawKind = optionalString(item.kind);
  if (!rawKind || !VALID_SOURCE_KINDS.has(rawKind as EditorSourceKind)) return undefined;
  const kind = rawKind as EditorSourceKind;
  const assetUrl = optionalString(item.assetUrl);
  const assetId = optionalString(item.assetId);
  const scratchFileName = optionalString(item.scratchFileName);
  const nativeFilePath = optionalString(item.nativeFilePath);
  const text = optionalString(item.text);

  if (kind === 'text' && !text && !assetUrl) return undefined;
  if (kind !== 'text' && !assetUrl && !assetId && !scratchFileName && !nativeFilePath) return undefined;

  const rawOriginNodeId = optionalString(item.originNodeId);
  let cleanOriginNodeId = rawOriginNodeId;
  if (cleanOriginNodeId) {
    const baseNodeIdAndIndex = cleanOriginNodeId.match(/^([^:]+):(\d+)/);
    if (baseNodeIdAndIndex) {
      cleanOriginNodeId = `${baseNodeIdAndIndex[1]}:${baseNodeIdAndIndex[2]}`;
    }
  }

  return {
    id: stringValue(item.id, `source-item-${index}`),
    label: stringValue(item.label, kind),
    kind,
    mimeType: optionalString(item.mimeType),
    assetId,
    assetUrl,
    scratchFileName,
    nativeFilePath,
    text,
    createdAt: finiteNumber(item.createdAt, Date.now()),
    sourceKey: optionalString(item.sourceKey),
    originNodeId: cleanOriginNodeId,
    isGenerated: typeof item.isGenerated === 'boolean' ? item.isGenerated : undefined,
    starred: Boolean(item.starred),
    collapsed: Boolean(item.collapsed),
    envelopeId: optionalString(item.envelopeId),
    envelopeLabel: optionalString(item.envelopeLabel),
    envelopeIndex: optionalNumber(item.envelopeIndex),
    envelopeCollapsed: typeof item.envelopeCollapsed === 'boolean' ? item.envelopeCollapsed : undefined,
    professional: sanitizeSourceBinProfessionalMediaState(item.professional),
  };
}

export function sanitizeSourceBinSnapshot(snapshot: unknown): SourceBinProjectSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  if (!isRecord(snapshot)) return undefined;

  const flatItems = Array.isArray(snapshot.items)
    ? snapshot.items.flatMap((item, index) => sanitizeSourceBinItem(item, index) ?? [])
    : undefined;
  const bins = Array.isArray(snapshot.bins)
    ? snapshot.bins.flatMap((bin, binIndex) => {
        if (!isRecord(bin)) return [];
        const items = Array.isArray(bin.items)
          ? bin.items.flatMap((item, itemIndex) => sanitizeSourceBinItem(item, itemIndex) ?? [])
          : [];
        return [{
          id: stringValue(bin.id, binIndex === 0 ? 'default' : `bin-${binIndex}`),
          name: stringValue(bin.name, binIndex === 0 ? 'Source Library' : `Bin ${binIndex + 1}`),
          items,
          collapsed: Boolean(bin.collapsed),
          createdAt: finiteNumber(bin.createdAt, Date.now()),
        }];
      })
    : undefined;

  return {
    bins: bins && bins.length > 0 ? bins : undefined,
    items: bins && bins.length > 0 ? undefined : flatItems,
    dismissedSourceKeys: Array.isArray(snapshot.dismissedSourceKeys)
      ? snapshot.dismissedSourceKeys.filter((key): key is string => typeof key === 'string')
      : [],
  };
}

export function sanitizePaperSnapshot(snapshot: unknown): Partial<PaperDocumentSnapshot> | undefined {
  if (snapshot === undefined || !isRecord(snapshot)) return undefined;

  const repairs: string[] = [];
  const quarantined: PaperQuarantinedDocumentRecovery[] = [];
  const priorRecovery = sanitizePaperSnapshotRecovery(snapshot.recovery);

  // Tabs are validated independently: one malformed or duplicated entry must never blank the
  // remaining valid documents. Failures are quarantined with their original payload instead.
  let documents: PaperWorkspaceDocumentSnapshot[] | undefined;
  let hadDocumentEntries = false;
  if (snapshot.documents !== undefined) {
    if (!Array.isArray(snapshot.documents)) {
      repairs.push('The saved Paper tab list was malformed; fell back to the active document.');
    } else if (snapshot.documents.length > 0) {
      hadDocumentEntries = true;
      const validDocuments: PaperWorkspaceDocumentSnapshot[] = [];
      snapshot.documents.forEach((candidate, index) => {
        const result = sanitizePaperWorkspaceDocumentSnapshot(candidate, index);
        if (result.ok) {
          repairs.push(...result.repairs);
          validDocuments.push(result.snapshot);
        } else {
          quarantined.push(buildPaperQuarantineEntry(candidate, index, result.reason));
        }
      });
      const seenTabIds = new Set<string>();
      const dedupedDocuments = validDocuments.map((workspaceDocument) => {
        let id = workspaceDocument.id;
        if (seenTabIds.has(id)) {
          let suffix = 2;
          while (seenTabIds.has(`${workspaceDocument.id}-${suffix}`)) suffix += 1;
          id = `${workspaceDocument.id}-${suffix}`;
          repairs.push(`Duplicate Paper tab id "${workspaceDocument.id}" was renamed to "${id}".`);
        }
        seenTabIds.add(id);
        return id === workspaceDocument.id ? workspaceDocument : { ...workspaceDocument, id };
      });
      if (dedupedDocuments.length > 0) documents = dedupedDocuments;
    }
  }

  let activeDocument: PaperWorkspaceDocumentSnapshot | undefined;
  if (documents) {
    const requestedActiveId = typeof snapshot.activeDocumentId === 'string' ? snapshot.activeDocumentId : undefined;
    activeDocument = documents.find((candidate) => candidate.id === requestedActiveId) ?? documents[0];
  } else {
    const legacyResult = sanitizePaperWorkspaceDocumentSnapshot({
      id: typeof snapshot.activeDocumentId === 'string'
        ? snapshot.activeDocumentId
        : isRecord(snapshot.document) ? stringValue(snapshot.document.id, 'paper-document') : 'paper-document',
      document: snapshot.document,
      selectedPageId: snapshot.selectedPageId,
      selectedFrameId: snapshot.selectedFrameId,
      selectedFrameIds: snapshot.selectedFrameIds,
      tool: snapshot.tool,
      zoom: snapshot.zoom,
    });
    if (legacyResult.ok) {
      repairs.push(...legacyResult.repairs);
      activeDocument = legacyResult.snapshot;
    }
  }

  if (!activeDocument) {
    // Nothing restorable. When tabs were declared, surface the quarantined payloads explicitly so
    // the workspace opens with a recoverable diagnostic; a snapshot that never had a valid shape
    // keeps the historical undefined result.
    const recovery = mergePaperSnapshotRecovery(priorRecovery, buildPaperSnapshotRecovery(quarantined, repairs));
    return hadDocumentEntries && recovery ? { recovery } : undefined;
  }

  const assetIds = [...new Set((documents ?? [activeDocument]).flatMap((candidate) => candidate.assetIds ?? []))].sort();
  if (snapshot.assetIds !== undefined) {
    if (!Array.isArray(snapshot.assetIds)) {
      repairs.push('The saved Paper asset inventory was malformed; recomputed from document content.');
    } else {
      const declaredAssetIds = snapshot.assetIds.filter((assetId): assetId is BinaryAssetId => isBinaryAssetId(assetId));
      if (declaredAssetIds.length !== snapshot.assetIds.length || !samePaperAssetIds(assetIds, declaredAssetIds)) {
        repairs.push('The saved Paper asset inventory was stale; recomputed from document content.');
      }
    }
  }

  const recovery = mergePaperSnapshotRecovery(priorRecovery, buildPaperSnapshotRecovery(quarantined, repairs));
  return {
    document: activeDocument.document,
    assetIds,
    selectedPageId: activeDocument.selectedPageId,
    selectedFrameId: activeDocument.selectedFrameId,
    selectedFrameIds: activeDocument.selectedFrameIds,
    tool: activeDocument.tool,
    zoom: activeDocument.zoom,
    documents,
    activeDocumentId: documents ? activeDocument.id : undefined,
    ...(recovery ? { recovery } : {}),
  };
}

type PaperWorkspaceDocumentSanitizeResult =
  | { ok: true; snapshot: PaperWorkspaceDocumentSnapshot; repairs: string[] }
  | { ok: false; reason: 'malformed-document' | 'invalid-asset-reference' };

function sanitizePaperWorkspaceDocumentSnapshot(
  value: unknown,
  index = 0,
): PaperWorkspaceDocumentSanitizeResult {
  if (!isRecord(value) || !isRecord(value.document) || !Array.isArray(value.document.pages)) {
    return { ok: false, reason: 'malformed-document' };
  }
  const assetIds = collectPaperSnapshotAssetIds(value.document);
  if (!assetIds) return { ok: false, reason: 'invalid-asset-reference' };
  const id = stringValue(value.id, `paper-document-${index + 1}`);
  // The declared inventory is advisory — reachability is always recomputed from content — so a
  // stale list (e.g. captured before save-time locator remapping) is repaired, not discarded.
  const repairs: string[] = [];
  if (value.assetIds !== undefined) {
    if (!Array.isArray(value.assetIds)) {
      repairs.push(`Paper tab "${id}": the saved asset inventory was malformed; recomputed from document content.`);
    } else {
      const declaredAssetIds = value.assetIds.filter((assetId): assetId is BinaryAssetId => isBinaryAssetId(assetId));
      if (declaredAssetIds.length !== value.assetIds.length || !samePaperAssetIds(assetIds, declaredAssetIds)) {
        repairs.push(`Paper tab "${id}": the saved asset inventory was stale; recomputed from document content.`);
      }
    }
  }
  return {
    ok: true,
    repairs,
    snapshot: {
      id,
      document: value.document as unknown as PaperWorkspaceDocumentSnapshot['document'],
      assetIds,
      selectedPageId: optionalString(value.selectedPageId),
      selectedFrameId: optionalString(value.selectedFrameId),
      selectedFrameIds: Array.isArray(value.selectedFrameIds)
        ? value.selectedFrameIds.filter((frameId): frameId is string => typeof frameId === 'string')
        : undefined,
      tool: VALID_PAPER_TOOLS.has(value.tool as PaperTool) ? value.tool as PaperTool : 'select',
      zoom: finiteNumber(value.zoom, 0.8),
    },
  };
}

function buildPaperQuarantineEntry(
  candidate: unknown,
  index: number,
  reason: 'malformed-document' | 'invalid-asset-reference',
): PaperQuarantinedDocumentRecovery {
  const record = isRecord(candidate) ? candidate : undefined;
  const documentRecord = record && isRecord(record.document) ? record.document : undefined;
  let payloadJson: string | undefined;
  try {
    payloadJson = JSON.stringify(candidate);
  } catch {
    payloadJson = undefined;
  }
  const id = record ? optionalString(record.id) : undefined;
  const title = documentRecord ? optionalString(documentRecord.title) : undefined;
  return {
    index,
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    reason,
    detail: reason === 'invalid-asset-reference'
      ? 'The tab document contained invalid or inline asset references.'
      : 'The tab entry was not a valid Paper document snapshot.',
    ...(payloadJson ? { payloadJson } : {}),
  };
}

function buildPaperSnapshotRecovery(
  quarantinedDocuments: PaperQuarantinedDocumentRecovery[],
  repairs: string[],
): PaperSnapshotRecovery | undefined {
  if (quarantinedDocuments.length === 0 && repairs.length === 0) return undefined;
  return { quarantinedDocuments, repairs };
}

function collectPaperSnapshotAssetIds(document: Record<string, unknown>): BinaryAssetId[] | undefined {
  const assetIds = new Set<BinaryAssetId>();
  const frameContainers = [...(document.pages as unknown[])];
  if (document.parentPages !== undefined) {
    if (!Array.isArray(document.parentPages)) return undefined;
    frameContainers.push(...document.parentPages);
  }
  for (const page of frameContainers) {
    if (!isRecord(page) || !Array.isArray(page.frames)) return undefined;
    for (const frame of page.frames) {
      if (!isRecord(frame)) return undefined;
      const asset = frame.asset;
      if (asset === undefined) continue;
      if (!isRecord(asset)) return undefined;
      const locator = asset.locator;
      if (locator === undefined) continue;
      if (!isRecord(locator) || typeof locator.kind !== 'string') return undefined;
      if (locator.kind === 'managed') {
        if (!isBinaryAssetRef(locator.ref)) return undefined;
        assetIds.add(locator.ref.id);
      } else if (locator.kind === 'external') {
        if (typeof locator.url !== 'string' || /^(?:data:|blob:)/i.test(locator.url)) return undefined;
      } else {
        return undefined;
      }
    }
  }

  const importedFonts = document.importedFonts;
  if (importedFonts !== undefined) {
    if (!Array.isArray(importedFonts)) return undefined;
    for (const font of importedFonts) {
      if (!isRecord(font)) return undefined;
      if (isBinaryAssetRef(font.fontAsset)) {
        assetIds.add(font.fontAsset.id);
        if (isRecord(font.license) && isBinaryAssetRef(font.license.textAsset)) {
          assetIds.add(font.license.textAsset.id);
        }
        continue;
      }
      if (isBinaryAssetRef(font.assetRef)) {
        assetIds.add(font.assetRef.id);
        continue;
      }
      // Older Paper saves stored imported font bytes directly in the document. Keep that exact
      // legacy shape only until restoreProjectDocument migrates it into the managed repository.
      if (typeof font.dataBase64 !== 'string' || font.dataBase64.length === 0) return undefined;
    }
  }

  const managedIccProfiles = document.managedIccProfiles;
  if (managedIccProfiles !== undefined) {
    if (!Array.isArray(managedIccProfiles)) return undefined;
    for (const profile of managedIccProfiles) {
      if (!isPaperManagedIccProfile(profile) || !isRecord(profile)) return undefined;
      // Project snapshots carry references only. Byte strings belong in the asset store/container.
      if ('bytes' in profile || 'dataBase64' in profile || 'assetBase64' in profile) return undefined;
      assetIds.add(profile.asset.id);
    }
  }

  return [...assetIds].sort();
}

function isBinaryAssetId(value: unknown): value is BinaryAssetId {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function samePaperAssetIds(left: readonly BinaryAssetId[], right: readonly BinaryAssetId[]): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return left.every((assetId, index) => assetId === sortedRight[index]);
}

export function sanitizeImageEditorSnapshot(snapshot: unknown): ImageEditorProjectSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  if (!isRecord(snapshot)) return undefined;
  const rawDocuments = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const projectSnapshots = rawDocuments.flatMap((doc) => (
    isRecord(doc) && Array.isArray(doc.snapshots) ? doc.snapshots : []
  ));
  assertImageDocumentSnapshotDecodeBounds(projectSnapshots, {
    transport: 'project',
    maxSnapshots: IMAGE_PROJECT_MAX_SNAPSHOTS,
    maxAggregateLayers: IMAGE_PROJECT_MAX_SNAPSHOT_LAYERS,
    maxAggregateProofs: IMAGE_PROJECT_MAX_SNAPSHOT_LAYERS,
    maxAggregateResources: IMAGE_PROJECT_MAX_SNAPSHOT_STRUCTURAL_RESOURCES,
    maxAggregateMetadataBytes: IMAGE_PROJECT_MAX_SNAPSHOT_METADATA_BYTES,
  });
  const documents = rawDocuments.length > 0
    ? rawDocuments.flatMap((doc, index) => {
        if (!isRecord(doc)) return [];
        const width = finiteNumber(doc.width, 0);
        const height = finiteNumber(doc.height, 0);
        if (width <= 0 || height <= 0) return [];
        const layers = Array.isArray(doc.layers) ? doc.layers.filter(isRecord) : [];
        const sanitizedLayers = sanitizeImageLayerCollection(layers);
        const rawSnapshots = Array.isArray(doc.snapshots) ? doc.snapshots : [];
        assertImageDocumentSnapshotDecodeBounds(rawSnapshots, { transport: 'project' });
        const snapshots = rawSnapshots.filter(isRecord);
        const sanitizedSnapshots = snapshots.map((namedSnapshot, snapshotIndex) => sanitizeImageDocumentSnapshot(
          namedSnapshot,
          snapshotIndex,
          { width, height },
        ));
        assertImageDocumentSnapshotDecodeBounds(sanitizedSnapshots, { transport: 'project' });
        const activeLayerEditTarget: ImageLayerEditTarget = doc.activeLayerEditTarget === 'mask' ? 'mask' : 'layer';
        return [{
          ...doc,
          id: stringValue(doc.id, `image-doc-${index}`),
          title: stringValue(doc.title, `Image ${index + 1}`),
          width,
          height,
          layers: sanitizedLayers,
          activeLayerId: optionalString(doc.activeLayerId) ?? null,
          activeLayerEditTarget,
          hasSelection: Boolean(doc.hasSelection),
          selectionVersion: finiteNumber(doc.selectionVersion, 0),
          selectionMask: undefined,
          selectionMaskData: typeof doc.selectionMaskData === 'string' ? doc.selectionMaskData : undefined,
          savedSelectionChannels: sanitizeSavedSelectionChannels(doc.savedSelectionChannels),
          spotChannels: sanitizeImageSpotChannels(doc.spotChannels),
          savedWorkPaths: sanitizeSavedWorkPaths(doc.savedWorkPaths),
          layerComps: sanitizeImageLayerComps(doc.layerComps, sanitizedLayers),
          viewport: isRecord(doc.viewport)
            ? {
                zoom: finiteNumber(doc.viewport.zoom, 1),
                panX: finiteNumber(doc.viewport.panX, 0),
                panY: finiteNumber(doc.viewport.panY, 0),
                ...(Number.isFinite(doc.viewport.rotationDeg) && doc.viewport.rotationDeg !== 0
                  ? { rotationDeg: doc.viewport.rotationDeg as number }
                  : {}),
              }
            : { zoom: 1, panX: 0, panY: 0 },
          dirty: Boolean(doc.dirty),
          snapshots: sanitizedSnapshots,
          // MH-009: the persisted working depth is untrusted; only the exact
          // supported depths survive sanitization.
          metadata: sanitizeImageDocumentBitDepth(doc.metadata),
        }];
      })
    : [];

  return {
    documents,
    activeDocId: optionalString(snapshot.activeDocId) ?? documents[0]?.id ?? null,
    quickActionMacros: sanitizeImageQuickActionMacros(snapshot.quickActionMacros),
  };
}

/** MH-009: keep only a supported persisted working depth; everything else is metadata-only. */
function sanitizeImageDocumentBitDepth(
  metadata: unknown,
): ImageDocument['metadata'] {
  if (!isRecord(metadata)) return metadata as ImageDocument['metadata'];
  const bitDepth = metadata.bitDepth;
  if (bitDepth === 8 || bitDepth === 16 || bitDepth === 32) {
    return metadata as ImageDocument['metadata'];
  }
  const { bitDepth: _removed, ...rest } = metadata;
  return rest as ImageDocument['metadata'];
}

function sanitizeImageQuickActionMacros(value: unknown): ImageQuickActionMacro[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const steps = Array.isArray(entry.steps)
      ? entry.steps.flatMap((step) => {
          if (!isRecord(step)) return [];
          const actionId = optionalString(step.actionId);
          return actionId ? [{ actionId }] : [];
        })
      : [];

    if (steps.length === 0) return [];

    return [{
      id: stringValue(entry.id, `quick-action-macro-${index}`),
      name: stringValue(entry.name, `Action ${index + 1}`),
      createdAt: finiteNumber(entry.createdAt, 0),
      updatedAt: finiteNumber(entry.updatedAt, finiteNumber(entry.createdAt, 0)),
      steps,
    }];
  });
}

function sanitizeImageDocumentSnapshot(
  snapshot: UnknownRecord,
  index: number,
  fallbackSize: { width: number; height: number },
): ImageDocumentSnapshot {
  const width = positiveFiniteNumber(snapshot.width, fallbackSize.width);
  const height = positiveFiniteNumber(snapshot.height, fallbackSize.height);
  const layers = Array.isArray(snapshot.layers) ? snapshot.layers.filter(isRecord) : [];
  const integrity = sanitizeImageDocumentSnapshotIntegrity(snapshot.integrity);
  if (
    snapshot.pixelState === 'complete'
    && isRecord(snapshot.integrity)
    && snapshot.integrity.version === 2
    && !integrity
  ) {
    throw new Error('Image snapshot has a malformed cryptographic content integrity manifest.');
  }

  return {
    ...snapshot,
    id: stringValue(snapshot.id, `image-snapshot-${index}`),
    name: stringValue(snapshot.name, `Snapshot ${index + 1}`),
    createdAt: finiteNumber(snapshot.createdAt, 0),
    ...(typeof snapshot.updatedAt === 'number' && Number.isFinite(snapshot.updatedAt)
      ? { updatedAt: snapshot.updatedAt }
      : {}),
    width,
    height,
    layers: sanitizeImageLayerCollection(layers),
    activeLayerId: optionalString(snapshot.activeLayerId) ?? null,
    hasSelection: Boolean(snapshot.hasSelection),
    selectionVersion: finiteNumber(snapshot.selectionVersion, 0),
    selectionMask: undefined,
    selectionMaskData: typeof snapshot.selectionMaskData === 'string' ? snapshot.selectionMaskData : undefined,
    pixelState: snapshot.pixelState === 'complete' && integrity ? 'complete' : 'unavailable',
    ...(integrity ? { integrity } : {}),
  };
}

function sanitizeImageDocumentSnapshotAssetIntegrity(
  value: unknown,
): ImageDocumentSnapshotAssetIntegrity | undefined {
  if (!isRecord(value) || typeof value.present !== 'boolean') return undefined;
  const width = finiteNumber(value.width, -1);
  const height = finiteNumber(value.height, -1);
  if (value.present) {
    if (width <= 0 || height <= 0) return undefined;
    if (typeof value.contentDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.contentDigest)) {
      return undefined;
    }
  } else if (width !== 0 || height !== 0) {
    return undefined;
  } else if (value.contentDigest !== undefined) {
    return undefined;
  }
  return {
    present: value.present,
    width,
    height,
    ...(value.present ? { contentDigest: value.contentDigest as string } : {}),
  };
}

function sanitizeImageDocumentSnapshotIntegrity(value: unknown): ImageDocumentSnapshotIntegrity | undefined {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.layers) || !isRecord(value.selection)) {
    return undefined;
  }
  const layers = value.layers.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.layerId !== 'string') return [];
    const bitmap = sanitizeImageDocumentSnapshotAssetIntegrity(entry.bitmap);
    const mask = sanitizeImageDocumentSnapshotAssetIntegrity(entry.mask);
    return bitmap && mask ? [{ layerId: entry.layerId, bitmap, mask }] : [];
  });
  if (layers.length !== value.layers.length) return undefined;
  const selectionAsset = sanitizeImageDocumentSnapshotAssetIntegrity(value.selection);
  const byteLength = finiteNumber(value.selection.byteLength, -1);
  if (!selectionAsset || byteLength < 0) return undefined;
  if (selectionAsset.present) {
    if (byteLength !== selectionAsset.width * selectionAsset.height) return undefined;
  } else if (byteLength !== 0) {
    return undefined;
  }
  return {
    version: 2,
    layers,
    selection: { ...selectionAsset, byteLength },
  };
}

function sanitizeSavedSelectionChannels(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      dataBase64: string;
      createdAt: number;
    }>;
  }

  return truncateSavedSelectionChannels(value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const width = positiveFiniteNumber(entry.width, 0);
    const height = positiveFiniteNumber(entry.height, 0);
    const name = sanitizeSavedSelectionChannelName(entry.name);
    const dataBase64 = isPlausibleSavedSelectionChannelData(entry.dataBase64) ? entry.dataBase64 : undefined;
    if (width <= 0 || height <= 0 || !name || !dataBase64) return [];
    return [{
      id: stringValue(entry.id, `alpha-channel-${index}`),
      name,
      width,
      height,
      dataBase64,
      createdAt: finiteNumber(entry.createdAt, 0),
    }];
  }));
}

function sanitizeSavedWorkPathPoints(value: unknown): ImageVectorPathPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const x = finiteNumber(entry.x, Number.NaN);
    const y = finiteNumber(entry.y, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const point: ImageVectorPathPoint = { x, y };
    if (isRecord(entry.inHandle)) {
      const inX = finiteNumber(entry.inHandle.x, Number.NaN);
      const inY = finiteNumber(entry.inHandle.y, Number.NaN);
      if (Number.isFinite(inX) && Number.isFinite(inY)) point.inHandle = { x: inX, y: inY };
    }
    if (isRecord(entry.outHandle)) {
      const outX = finiteNumber(entry.outHandle.x, Number.NaN);
      const outY = finiteNumber(entry.outHandle.y, Number.NaN);
      if (Number.isFinite(outX) && Number.isFinite(outY)) point.outHandle = { x: outX, y: outY };
    }
    return [point];
  });
}

function sanitizeSavedWorkPaths(value: unknown): ImageSavedWorkPath[] {
  if (!Array.isArray(value)) return [];

  return value.slice(-MAX_SAVED_WORK_PATHS).flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const name = sanitizeSavedWorkPathName(entry.name);
    const points = sanitizeSavedWorkPathPoints(entry.points);
    if (!name || points.length < 2) return [];
    return [{
      id: stringValue(entry.id, `saved-path-${index}`),
      name,
      kind: entry.kind === 'work' ? 'work' as const : 'saved' as const,
      closed: Boolean(entry.closed),
      points,
      createdAt: finiteNumber(entry.createdAt, 0),
      updatedAt: finiteNumber(entry.updatedAt, 0),
    }];
  });
}

function sanitizeImageSpotChannels(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      color: { r: number; g: number; b: number };
      opacity: number;
      solidity: number;
      visible: boolean;
      dataBase64: string;
      createdAt: number;
      updatedAt?: number;
    }>;
  }

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const width = positiveFiniteNumber(entry.width, 0);
    const height = positiveFiniteNumber(entry.height, 0);
    const name = sanitizeImageSpotChannelName(entry.name);
    const dataBase64 = isPlausibleSavedSelectionChannelData(entry.dataBase64) ? entry.dataBase64 : undefined;
    if (width <= 0 || height <= 0 || !name || !dataBase64) return [];

    const updatedAt = finiteNumber(entry.updatedAt, Number.NaN);
    return [{
      id: stringValue(entry.id, `spot-channel-${index}`),
      name,
      width,
      height,
      color: sanitizeImageSpotChannelColor(entry.color),
      opacity: clampUnit(finiteNumber(entry.opacity, 1)),
      solidity: clampUnit(finiteNumber(entry.solidity, 1)),
      visible: entry.visible !== false,
      dataBase64,
      createdAt: finiteNumber(entry.createdAt, 0),
      ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    }];
  });
}

function sanitizeImageSpotChannelColor(value: unknown): { r: number; g: number; b: number } {
  const color = isRecord(value) ? value : {};
  return {
    r: clampByte(finiteNumber(color.r, 0)),
    g: clampByte(finiteNumber(color.g, 174)),
    b: clampByte(finiteNumber(color.b, 239)),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function sanitizeImageLayer(layer: UnknownRecord, layerIndex: number): ImageLayer {
  const locks = sanitizeImageLayerLocks(layer.locks);
  const type = sanitizeImageLayerType(layer.type);
  const groupExpanded = typeof layer.groupExpanded === 'boolean' ? layer.groupExpanded : true;
  const groupPassThrough = layer.groupPassThrough === true;
  const linkGroupId = sanitizeImageLayerLinkGroupId(layer.linkGroupId);
  const skewXDeg = sanitizeImageLayerTransformSkew(layer.skewXDeg);
  const skewYDeg = sanitizeImageLayerTransformSkew(layer.skewYDeg);
  const perspectiveX = sanitizeImageLayerTransformPerspective(layer.perspectiveX);
  const perspectiveY = sanitizeImageLayerTransformPerspective(layer.perspectiveY);
  const warp = sanitizeImageLayerTransformWarp(layer.warp);
  const cornerOffsets = sanitizeImageLayerTransformCornerOffsets(layer.cornerOffsets);
  const transformOriginX = sanitizeImageLayerTransformOrigin(layer.transformOriginX);
  const transformOriginY = sanitizeImageLayerTransformOrigin(layer.transformOriginY);
  const maskDensity = sanitizeImageLayerMaskDensity(layer.maskDensity);
  const maskFeather = sanitizeImageLayerMaskFeather(layer.maskFeather);
  const blendIf = sanitizeImageLayerBlendIf(layer.blendIf);
  const rawMetadata = isRecord(layer.metadata) ? layer.metadata : undefined;
  const tiltmarkMetadata = sanitizeImageTiltmarkLayerMetadata(rawMetadata?.tiltmark);
  const metadata = rawMetadata
    ? {
        ...rawMetadata,
        ...(tiltmarkMetadata ? { tiltmark: tiltmarkMetadata } : { tiltmark: undefined }),
      } as ImageLayer['metadata']
    : undefined;
  const tiltmarkSimulationData = typeof layer.tiltmarkSimulationData === 'string'
    && layer.tiltmarkSimulationData.length <= MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH
    ? layer.tiltmarkSimulationData
    : undefined;
  return {
    ...layer,
    id: stringValue(layer.id, `layer-${layerIndex}`),
    name: stringValue(layer.name, `Layer ${layerIndex + 1}`),
    type,
    visible: typeof layer.visible === 'boolean' ? layer.visible : true,
    locked: Boolean(layer.locked),
    ...(locks ? { locks } : { locks: undefined }),
    opacity: finiteNumber(layer.opacity, 1),
    blendMode: typeof layer.blendMode === 'string' ? layer.blendMode as ImageLayer['blendMode'] : 'normal',
    ...(blendIf ? { blendIf } : {}),
    x: type === 'group' ? 0 : finiteNumber(layer.x, 0),
    y: type === 'group' ? 0 : finiteNumber(layer.y, 0),
    ...(type !== 'group' && skewXDeg !== undefined ? { skewXDeg } : {}),
    ...(type !== 'group' && skewYDeg !== undefined ? { skewYDeg } : {}),
    ...(type !== 'group' && perspectiveX !== undefined ? { perspectiveX } : {}),
    ...(type !== 'group' && perspectiveY !== undefined ? { perspectiveY } : {}),
    ...(type !== 'group' && warp !== undefined ? { warp } : {}),
    ...(type !== 'group' && cornerOffsets !== undefined ? { cornerOffsets } : {}),
    transformOriginX: type === 'group' ? undefined : transformOriginX,
    transformOriginY: type === 'group' ? undefined : transformOriginY,
    bitmap: null,
    mask: null,
    tiltmarkBaseBitmap: null,
    // MH-009: high-bit authorities are runtime typed arrays and never persist
    // directly; their bounded base64 transport is kept like bitmapData.
    pixels: undefined,
    pixelsVersion: undefined,
    pixelsData: typeof layer.pixelsData === 'string' ? layer.pixelsData : undefined,
    // Serialized pixel payloads carry the actual layer pixels across a project save/open; keep
    // them through sanitize so the image isn't wiped on restore (decoded back into bitmap/mask).
    bitmapData: typeof layer.bitmapData === 'string' ? layer.bitmapData : undefined,
    maskData: typeof layer.maskData === 'string' ? layer.maskData : undefined,
    tiltmarkBaseBitmapData: typeof layer.tiltmarkBaseBitmapData === 'string'
      ? layer.tiltmarkBaseBitmapData
      : undefined,
    tiltmarkSimulationData,
    ...(maskDensity !== undefined ? { maskDensity } : {}),
    ...(maskFeather !== undefined ? { maskFeather } : {}),
    bitmapVersion: finiteNumber(layer.bitmapVersion, 0),
    text: sanitizeImageTextLayerStyle(layer.text),
    groupExpanded: type === 'group' ? groupExpanded : undefined,
    groupPassThrough: type === 'group' && groupPassThrough ? true : undefined,
    linkGroupId: type === 'group' ? undefined : linkGroupId,
    metadata,
  };
}

function sanitizeImageLayerBlendIf(value: unknown): ImageLayer['blendIf'] | undefined {
  if (!isRecord(value)) return undefined;
  const sourceBlack = Math.max(0, Math.min(254, Math.round(finiteNumber(value.sourceBlack, 0))));
  const sourceWhite = Math.max(sourceBlack + 1, Math.min(255, Math.round(finiteNumber(value.sourceWhite, 255))));
  return { sourceBlack, sourceWhite };
}

function sanitizeImageLayerComps(value: unknown, layers: readonly ImageLayer[]): ImageLayerComp[] {
  if (!Array.isArray(value)) return [];
  const layerIds = new Set(layers.map((layer) => layer.id));
  const names = new Set<string>();
  return value.slice(0, 100).flatMap((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.layers)) return [];
    const name = stringValue(entry.name, `Layer Comp ${index + 1}`).trim().slice(0, 80);
    if (!name || names.has(name)) return [];
    const states = entry.layers.flatMap((state) => {
      if (!isRecord(state) || typeof state.layerId !== 'string' || !layerIds.has(state.layerId)) return [];
      return [{
        layerId: state.layerId,
        visible: state.visible !== false,
        opacity: clampUnit(finiteNumber(state.opacity, 1)),
        blendMode: typeof state.blendMode === 'string' ? state.blendMode as ImageLayer['blendMode'] : 'normal',
      }];
    });
    if (states.length === 0) return [];
    names.add(name);
    return [{
      id: stringValue(entry.id, `layer-comp-${index}`),
      name,
      layers: states,
      createdAt: finiteNumber(entry.createdAt, 0),
    }];
  });
}

function sanitizeImageTextLayerStyle(value: unknown): ImageLayer['text'] {
  if (!isRecord(value)) return undefined;
  const initialManagedFaceState = normalizeBundledFontFaceState(value.managedFace, value.managedFaceIssue);
  const fontStyle = value.fontStyle === 'italic' || (value.fontStyle === 'oblique' && initialManagedFaceState.managedFace?.style === 'oblique')
    ? value.fontStyle
    : 'normal';
  const managedFaceState = normalizeBundledFontFaceStateForTypography(value.managedFace, value.managedFaceIssue, {
    family: typeof value.fontFamily === 'string' ? value.fontFamily : '',
    weight: value.fontWeight as string | number | undefined,
    style: fontStyle,
  });
  return {
    ...(value as unknown as NonNullable<ImageLayer['text']>),
    fontStyle,
    managedFace: managedFaceState.managedFace,
    managedFaceIssue: managedFaceState.managedFaceIssue,
  };
}

function sanitizeImageLayerCollection(layers: UnknownRecord[]): ImageLayer[] {
  const sanitized = layers.map(sanitizeImageLayer);
  const groupIds = new Set(sanitized.filter((layer) => layer.type === 'group').map((layer) => layer.id));
  const grouped = sanitized.map((layer) => {
    const validGroupId = typeof layer.groupId === 'string'
      && layer.groupId !== layer.id
      && groupIds.has(layer.groupId);
    if (layer.type === 'group') {
      return omitImageLayerGroupId(layer);
    }
    return validGroupId ? layer : omitImageLayerGroupId(layer);
  });
  const linkCounts = new Map<string, number>();
  for (const layer of grouped) {
    if (!layer.linkGroupId) continue;
    linkCounts.set(layer.linkGroupId, (linkCounts.get(layer.linkGroupId) ?? 0) + 1);
  }
  return grouped.map((layer) => (
    layer.linkGroupId && (linkCounts.get(layer.linkGroupId) ?? 0) >= 2
      ? layer
      : omitImageLayerLinkGroup(layer)
  ));
}

function sanitizeImageLayerType(value: unknown): LayerType {
  return ['image', 'mask', 'text', 'adjustment', 'vector', 'group'].includes(value as string)
    ? value as LayerType
    : 'image';
}

function omitImageLayerGroupId(layer: ImageLayer): ImageLayer {
  const { groupId: _groupId, ...rest } = layer;
  return rest;
}

function positiveFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function sanitizeImageLayerTransformOrigin(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function sanitizeImageLayerTransformSkew(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-75, Math.min(75, Math.round(value * 100) / 100));
}

function sanitizeImageLayerTransformPerspective(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-0.95, Math.min(0.95, Math.round(value * 1000) / 1000));
}

function sanitizeImageLayerTransformWarp(value: unknown): ImageLayer['warp'] | undefined {
  if (value === undefined) return undefined;
  const entry = isRecord(value) ? value : {};
  return {
    top: sanitizeImageLayerTransformWarpValue(entry.top),
    right: sanitizeImageLayerTransformWarpValue(entry.right),
    bottom: sanitizeImageLayerTransformWarpValue(entry.bottom),
    left: sanitizeImageLayerTransformWarpValue(entry.left),
  };
}

function sanitizeImageLayerTransformCornerOffsets(value: unknown): ImageLayer['cornerOffsets'] | undefined {
  if (value === undefined) return undefined;
  const entry = isRecord(value) ? value : {};
  return {
    nw: sanitizeImageTransformPoint(entry.nw),
    ne: sanitizeImageTransformPoint(entry.ne),
    se: sanitizeImageTransformPoint(entry.se),
    sw: sanitizeImageTransformPoint(entry.sw),
  };
}

function sanitizeImageTransformPoint(value: unknown): { x: number; y: number } {
  const point = isRecord(value) ? value : {};
  return {
    x: sanitizeImageTransformCoordinate(point.x),
    y: sanitizeImageTransformCoordinate(point.y),
  };
}

function sanitizeImageTransformCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function sanitizeImageLayerTransformWarpValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, Math.round(value * 1000) / 1000));
}

export function sanitizeFileSystemMetadata(value: unknown): FlowProjectDocument['fileSystem'] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    projectDirectoryName: optionalString(value.projectDirectoryName),
    scratchDirectoryName: optionalString(value.scratchDirectoryName),
    lastSavedToFolderAt: optionalNumber(value.lastSavedToFolderAt),
    scratchAssetCount: optionalNumber(value.scratchAssetCount),
  };
}

function collectSourceBinSnapshotItems(sourceBin: SourceBinProjectSnapshot | undefined): Array<SourceBinLibraryItem & { assetUrl?: string }> {
  if (!sourceBin) return [];
  const binItems = sourceBin.bins?.flatMap((bin) => bin.items) ?? [];
  const flatItems = sourceBin.items ?? [];
  return [...binItems, ...flatItems];
}

function hydrateFlowSnapshotFromSourceBin(
  flow: FlowProjectDocument['flow'],
  sourceBin: SourceBinProjectSnapshot | undefined,
): FlowProjectDocument['flow'] {
  const sourceBinItems = collectSourceBinSnapshotItems(sourceBin);

  if (sourceBinItems.length === 0) {
    return {
      ...flow,
      nodes: flow.nodes.map((node) => ({
        ...node,
        data: finalizeHydratedNodeData({ ...node.data }),
      })),
    };
  }

  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      const sourceItems = collectSourceBinItemsForFlowNode(node.id, sourceBinItems);
      const data: NodeData = { ...node.data };

      if (sourceItems.length > 0) {
        data.namedOutputs = rebindNodeOutputAssetsToSourceBin(data.namedOutputs, sourceItems);
        data.functionOutputs = rebindNodeOutputAssetsToSourceBin(data.functionOutputs, sourceItems);
        Object.assign(data, buildFlowNodeGeneratedResultPatch(node.id, node.type, data, sourceItems));
      }

      return {
        ...node,
        data: finalizeHydratedNodeData(data),
      };
    }),
  };
}

function finalizeHydratedNodeData(data: NodeData): NodeData {
  if (Array.isArray(data.resultHistory)) {
    restoreSelectedResultFromHistory(data, data.resultHistory);
  }
  return data;
}

function sanitizeFlowWorkspaceSnapshot(
  snapshot: unknown,
  index: number,
  sourceBin: SourceBinProjectSnapshot | undefined,
): FlowWorkspaceProjectSnapshot | undefined {
  if (!isRecord(snapshot)) {
    return undefined;
  }

  const rawFlow = snapshot.flow;
  if (rawFlow === undefined) {
    return undefined;
  }

  const createdAt = finiteNumber(snapshot.createdAt, Date.now());
  const sanitizedFlow = hydrateFlowSnapshotFromSourceBin(
    sanitizeFlowSnapshot(rawFlow),
    sourceBin,
  );

  return {
    id: stringValue(snapshot.id, index === 0 ? DEFAULT_FLOW_WORKSPACE_ID : `flow-workspace-${index + 1}`),
    name: stringValue(snapshot.name, index === 0 ? DEFAULT_FLOW_WORKSPACE_NAME : `Flow Workspace ${index + 1}`),
    createdAt,
    updatedAt: finiteNumber(snapshot.updatedAt, createdAt),
    flow: sanitizedFlow,
  };
}

function sanitizeFlowWorkspaceState(
  input: UnknownRecord,
  sourceBin: SourceBinProjectSnapshot | undefined,
): {
  flow: FlowProjectDocument['flow'];
  flowWorkspaces: FlowWorkspaceProjectSnapshot[];
  activeFlowWorkspaceId: string;
} {
  const legacyFlowInput = input.flow;
  const legacyFlow = legacyFlowInput === undefined
    ? undefined
    : hydrateFlowSnapshotFromSourceBin(sanitizeFlowSnapshot(legacyFlowInput), sourceBin);
  const sanitizedWorkspaces = Array.isArray(input.flowWorkspaces)
    ? input.flowWorkspaces.flatMap((workspace, index) => sanitizeFlowWorkspaceSnapshot(workspace, index, sourceBin) ?? [])
    : [];
  const flowWorkspaces = sanitizedWorkspaces.length > 0
    ? sanitizedWorkspaces
    : legacyFlow
      ? [buildDefaultFlowWorkspace(legacyFlow)]
      : [];
  const activeWorkspace = findActiveFlowWorkspace(
    flowWorkspaces,
    optionalString(input.activeFlowWorkspaceId),
  );

  if (!activeWorkspace) {
    throw new Error('The selected file is not a valid Sloom Studio .sloom project: flow nodes and edges must be arrays.');
  }

  return {
    flow: activeWorkspace.flow,
    flowWorkspaces,
    activeFlowWorkspaceId: activeWorkspace.id,
  };
}

const INVALID_PROJECT_FILE_ERROR = 'The selected file is not a valid Sloom Studio .sloom project.';

/**
 * Bounded pre-authorization shape check for an incoming replacement candidate. Deliberately
 * shallow and allocation-free: full validation is deferred until the current workspace's
 * replacement is authorized, so malformed/unbounded input is never deeply processed merely to
 * show the decision dialog. Must stay strictly weaker than sanitizeProjectDocument — anything
 * rejected here is rejected there for the same reason.
 */
export function assertProjectDocumentReplacementCandidate(input: unknown): void {
  if (input !== undefined && input !== null && !isRecord(input)) {
    throw new Error(INVALID_PROJECT_FILE_ERROR);
  }
}

export function sanitizeProjectDocument(input: unknown, fallbackName = 'Sloom Studio Project'): FlowProjectDocument {
  if (!isRecord(input)) {
    throw new Error(INVALID_PROJECT_FILE_ERROR);
  }

  const sourceBin = sanitizeSourceBinSnapshot(input.sourceBin);
  const flowWorkspaceState = sanitizeFlowWorkspaceState(input, sourceBin);
  const providerPacks = sanitizeEmbeddedProviderPackSnapshots(input.providerPacks);
  const flowWorkspaces = flowWorkspaceState.flowWorkspaces.map((workspace) => ({
    ...workspace,
    flow: {
      ...workspace.flow,
      nodes: attachProjectSnapshotsToModelCardNodes(workspace.flow.nodes, providerPacks),
    },
  }));
  const activeWorkspace = findActiveFlowWorkspace(flowWorkspaces, flowWorkspaceState.activeFlowWorkspaceId);
  const paper = sanitizePaperSnapshot(input.paper);
  const paperAssets = sanitizePaperPortableAssetsSection(input.paperAssets);
  const paperAssetIds = new Set<BinaryAssetId>([
    ...(paper?.assetIds ?? []),
    ...((paper?.documents ?? []).flatMap((entry) => entry.assetIds ?? [])),
  ]);
  if (paperAssets) {
    const supplied = new Set(paperAssets.assets.map((entry) => entry.ref.id));
    // Explicit policy exclusions/missing-at-save records are not an integrity mismatch: opening
    // retains their diagnostics and later output is still blocked rather than silently painted.
    const declaredUnavailable = new Set([
      ...(paperAssets.excludedFonts ?? []).map((entry) => entry.assetId),
      ...(paperAssets.missingAssets ?? []).map((entry) => entry.id),
    ]);
    const missing = [...paperAssetIds].filter((id) => !supplied.has(id) && !declaredUnavailable.has(id));
    if (missing.length > 0) throw new Error(`The selected project is missing portable Paper assets required by its document references: ${missing.join(', ')}.`);
  }

  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: stringValue(input.id, globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}`),
    name: stringValue(input.name, fallbackName),
    savedAt: finiteNumber(input.savedAt, Date.now()),
    flow: activeWorkspace?.flow ?? {
      ...flowWorkspaceState.flow,
      nodes: attachProjectSnapshotsToModelCardNodes(flowWorkspaceState.flow.nodes, providerPacks),
    },
    flowWorkspaces,
    activeFlowWorkspaceId: flowWorkspaceState.activeFlowWorkspaceId,
    providerPacks,
    editor: sanitizeEditorSnapshot(input.editor),
    sourceBin,
    usageLedger: sanitizeProjectUsageLedgerSnapshot(input.usageLedger),
    paper,
    paperAssets,
    imageEditor: sanitizeImageEditorSnapshot(input.imageEditor),
    fileSystem: sanitizeFileSystemMetadata(input.fileSystem),
    projectHistory: sanitizeProjectHistorySection(input.projectHistory).section,
  };
}
