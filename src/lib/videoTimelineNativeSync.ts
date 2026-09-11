import type { AppNode, NodeData } from '../types/flow';
import { isTimelineMarkerWithinBounds, MAX_TIMELINE_MARKERS } from './editorTimelineMarkers';

export const VIDEO_TIMELINE_SYNC_SCHEMA_VERSION = 1 as const;
export const MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES = 1_500_000;
export const MAX_VIDEO_TIMELINE_SYNC_SNAPSHOT_JSON_BYTES = 8_000_000;
export const MAX_VIDEO_TIMELINE_SYNC_COMPOSITIONS = 128;
export const MAX_VIDEO_TIMELINE_SYNC_CLIPS_PER_KIND = 2_000;
export const MAX_VIDEO_TIMELINE_SYNC_ASSETS = 1_000;
export const MAX_VIDEO_TIMELINE_SYNC_MARKERS = MAX_TIMELINE_MARKERS;

/** Output-affecting, editable Video state. Media bytes deliberately do not appear in this list. */
export const VIDEO_TIMELINE_DATA_KEYS = [
  'aspectRatio',
  'videoResolution',
  'videoFrameRate',
  'compositionTimelineSeconds',
  'compositionAudioTrackCount',
  'compositionUseVideoAudio',
  'compositionVideoAudioVolume',
  'compositionAudio1OffsetMs',
  'compositionAudio2OffsetMs',
  'compositionAudio3OffsetMs',
  'compositionAudio4OffsetMs',
  'compositionAudio1Volume',
  'compositionAudio2Volume',
  'compositionAudio3Volume',
  'compositionAudio4Volume',
  'compositionAudio1Enabled',
  'compositionAudio2Enabled',
  'compositionAudio3Enabled',
  'compositionAudio4Enabled',
  'editorVisualClips',
  'editorVisualTrackKinds',
  'editorAudioClips',
  'editorAudioTrackVolumes',
  'editorMutedAudioTracks',
  'editorSoloAudioTracks',
  'editorAssets',
  'editorStageObjects',
  'editorTimelineSnapPoints',
  'editorTimelineMarkers',
  'editorLockedVisualTracks',
  'editorLockedAudioTracks',
  'editorCollapsedVisualTracks',
  'editorCollapsedAudioTracks',
  'editorExportPresetPlan',
  'editorProfessionalState',
  'editorProfessionalWorkflowState',
] as const satisfies readonly (keyof NodeData)[];

export type VideoTimelineDataKey = (typeof VIDEO_TIMELINE_DATA_KEYS)[number];
export type VideoTimelineData = Partial<Pick<NodeData, VideoTimelineDataKey>>;

/** Device-local render artifacts and the revision they create must never leak through Flow sync. */
const VIDEO_COMPOSITION_LOCAL_ONLY_KEYS = [
  'inputRevision',
  'result',
  'resultType',
  'resultMimeType',
  'resultExtension',
  'resultFileName',
  'resultOutputMetadata',
  'resultInputSignature',
  'editorRenderCacheCompositionSignature',
  'editorRenderCacheSegmentSignatures',
  'editorRenderCacheSegmentArtifacts',
  'editorRenderCacheAssemblyManifest',
  'editorRenderCacheLastAssemblyManifest',
  'editorRenderCacheLastAssemblyResult',
  'editorRenderCacheUpdatedAt',
] as const satisfies readonly (keyof NodeData)[];

const VIDEO_OWNED_KEYS = new Set<string>([
  ...VIDEO_TIMELINE_DATA_KEYS,
  ...VIDEO_COMPOSITION_LOCAL_ONLY_KEYS,
]);
const VIDEO_LOCAL_ONLY_KEYS = new Set<string>(VIDEO_COMPOSITION_LOCAL_ONLY_KEYS);

export interface VideoTimelineCompositionSnapshot {
  compositionId: string;
  nodeInstanceId?: string;
  data: VideoTimelineData;
}

export interface VideoTimelineWorkspaceSnapshotChange {
  type: 'video-timeline-workspace-snapshot';
  schemaVersion: typeof VIDEO_TIMELINE_SYNC_SCHEMA_VERSION;
  workspaceId?: string;
  compositions: VideoTimelineCompositionSnapshot[];
}

export interface VideoTimelineCompositionUpdatedChange {
  type: 'video-timeline-composition-updated';
  schemaVersion: typeof VIDEO_TIMELINE_SYNC_SCHEMA_VERSION;
  workspaceId?: string;
  composition: VideoTimelineCompositionSnapshot;
  /** Fields changed from the sender's last acknowledged authority snapshot. */
  changedKeys?: VideoTimelineDataKey[];
}

export interface VideoTimelineSyncUnavailableChange {
  type: 'video-timeline-sync-unavailable';
  schemaVersion: typeof VIDEO_TIMELINE_SYNC_SCHEMA_VERSION;
  workspaceId?: string;
  reason: 'payload-too-large';
}

export type VideoTimelineNativeChange =
  | VideoTimelineWorkspaceSnapshotChange
  | VideoTimelineCompositionUpdatedChange
  | VideoTimelineSyncUnavailableChange;

export type VideoTimelineCompositionSyncReadiness =
  | {
      status: 'ready';
      encodedBytes: number;
      maximumBytes: number;
      message: '';
    }
  | {
      status: 'unavailable';
      reason: 'invalid-schema' | 'payload-too-large';
      encodedBytes: number;
      maximumBytes: number;
      message: string;
    };

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function extractVideoTimelineData(data: NodeData): VideoTimelineData {
  const result: VideoTimelineData = {};
  for (const key of VIDEO_TIMELINE_DATA_KEYS) {
    const value = data[key];
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }
  return jsonClone(result);
}

export function createVideoTimelineCompositionSnapshot(node: AppNode): VideoTimelineCompositionSnapshot | null {
  if (node.type !== 'composition' || !isSafeId(node.id)) return null;
  const nodeInstanceId = typeof node.data.nodeInstanceId === 'string' && isSafeId(node.data.nodeInstanceId)
    ? node.data.nodeInstanceId
    : undefined;
  return {
    compositionId: node.id,
    nodeInstanceId,
    data: extractVideoTimelineData(node.data),
  };
}

export function createVideoTimelineWorkspaceSnapshot(
  nodes: readonly AppNode[],
  workspaceId?: string,
): VideoTimelineWorkspaceSnapshotChange | VideoTimelineSyncUnavailableChange {
  const compositions = nodes
    .map(createVideoTimelineCompositionSnapshot)
    .filter((value): value is VideoTimelineCompositionSnapshot => value !== null);
  const change: VideoTimelineWorkspaceSnapshotChange = {
    type: 'video-timeline-workspace-snapshot',
    schemaVersion: VIDEO_TIMELINE_SYNC_SCHEMA_VERSION,
    workspaceId: isSafeId(workspaceId) ? workspaceId : undefined,
    compositions,
  };
  if (isVideoTimelineNativeChange(change)) return change;
  return {
    type: 'video-timeline-sync-unavailable',
    schemaVersion: VIDEO_TIMELINE_SYNC_SCHEMA_VERSION,
    workspaceId: isSafeId(workspaceId) ? workspaceId : undefined,
    reason: 'payload-too-large',
  };
}

export function createVideoTimelineCompositionUpdatedChange(
  node: AppNode,
  workspaceId?: string,
): VideoTimelineCompositionUpdatedChange | null {
  const composition = createVideoTimelineCompositionSnapshot(node);
  if (!composition) return null;
  const change: VideoTimelineCompositionUpdatedChange = {
    type: 'video-timeline-composition-updated',
    schemaVersion: VIDEO_TIMELINE_SYNC_SCHEMA_VERSION,
    workspaceId: isSafeId(workspaceId) ? workspaceId : undefined,
    composition,
  };
  return isVideoTimelineNativeChange(change) ? change : null;
}

/**
 * Exact preflight used by the workspace to make native-sync resource failures visible. Local
 * project persistence is independent, so an unavailable sync result never implies marker loss.
 */
export function describeVideoTimelineCompositionSyncReadiness(
  node: AppNode,
  workspaceId?: string,
): VideoTimelineCompositionSyncReadiness {
  const composition = createVideoTimelineCompositionSnapshot(node);
  if (!composition) {
    return {
      status: 'unavailable',
      reason: 'invalid-schema',
      encodedBytes: 0,
      maximumBytes: MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES,
      message: 'Native timeline sync is unavailable because this sequence is outside the bounded sync schema. Local project save remains available.',
    };
  }
  const change: VideoTimelineCompositionUpdatedChange = {
    type: 'video-timeline-composition-updated',
    schemaVersion: VIDEO_TIMELINE_SYNC_SCHEMA_VERSION,
    workspaceId: isSafeId(workspaceId) ? workspaceId : undefined,
    composition,
  };
  const encodedBytes = encodedJsonBytes(change);
  if (encodedBytes > MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES) {
    return {
      status: 'unavailable',
      reason: 'payload-too-large',
      encodedBytes,
      maximumBytes: MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES,
      message: `Native timeline sync is unavailable because this sequence's ${encodedBytes.toLocaleString('en-US')}-byte authored-state payload exceeds the ${MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES.toLocaleString('en-US')}-byte per-edit limit. Local project save remains available; reduce marker notes/count or other timeline metadata before relying on cross-device sync.`,
    };
  }
  if (!isVideoTimelineNativeChange(change)) {
    return {
      status: 'unavailable',
      reason: 'invalid-schema',
      encodedBytes,
      maximumBytes: MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES,
      message: 'Native timeline sync is unavailable because this sequence is outside the bounded sync schema. Local project save remains available.',
    };
  }
  return {
    status: 'ready',
    encodedBytes,
    maximumBytes: MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES,
    message: '',
  };
}

/**
 * Flow still owns composition node creation/removal and non-Video settings. Its incremental data
 * patches use this projection so Video-authored state travels exactly once on the Video channel.
 * Full Flow seed snapshots and node-added ops retain the fields, making channel start order harmless.
 */
export function stripVideoOwnedCompositionData(data: NodeData): NodeData {
  const result: NodeData = {};
  for (const [key, value] of Object.entries(data)) {
    if (!VIDEO_OWNED_KEYS.has(key)) result[key] = value;
  }
  return result;
}

/** Remove device-local render/revision state while retaining authored timeline fields for Flow seeds. */
export function stripVideoCompositionLocalOnlyData(data: NodeData): NodeData {
  const result: NodeData = {};
  for (const [key, value] of Object.entries(data)) {
    if (!VIDEO_LOCAL_ONLY_KEYS.has(key)) result[key] = value;
  }
  return result;
}

export function videoTimelineCompositionFingerprint(node: AppNode): string | null {
  const snapshot = createVideoTimelineCompositionSnapshot(node);
  return snapshot ? JSON.stringify(snapshot) : null;
}

export function isVideoTimelineNativeChange(value: unknown): value is VideoTimelineNativeChange {
  if (!isRecord(value) || value.schemaVersion !== VIDEO_TIMELINE_SYNC_SCHEMA_VERSION) return false;
  if (value.workspaceId !== undefined && !isSafeId(value.workspaceId)) return false;

  if (value.type === 'video-timeline-sync-unavailable') {
    return encodedJsonBytes(value) <= MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES
      && hasOnlyKeys(value, ['type', 'schemaVersion', 'workspaceId', 'reason'])
      && value.reason === 'payload-too-large';
  }
  const byteLimit = value.type === 'video-timeline-workspace-snapshot'
    ? MAX_VIDEO_TIMELINE_SYNC_SNAPSHOT_JSON_BYTES
    : MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES;
  if (encodedJsonBytes(value) > byteLimit) return false;

  if (value.type === 'video-timeline-composition-updated') {
    if (!hasOnlyKeys(value, ['type', 'schemaVersion', 'workspaceId', 'composition', 'changedKeys'])) return false;
    if (value.changedKeys !== undefined && (
      !Array.isArray(value.changedKeys)
      || value.changedKeys.length > VIDEO_TIMELINE_DATA_KEYS.length
      || new Set(value.changedKeys).size !== value.changedKeys.length
      || value.changedKeys.some((key) => !VIDEO_TIMELINE_DATA_KEYS.includes(key as VideoTimelineDataKey))
    )) return false;
    return isCompositionSnapshot(value.composition);
  }
  if (value.type !== 'video-timeline-workspace-snapshot' || !Array.isArray(value.compositions)) return false;
  if (!hasOnlyKeys(value, ['type', 'schemaVersion', 'workspaceId', 'compositions'])) return false;
  if (value.compositions.length > MAX_VIDEO_TIMELINE_SYNC_COMPOSITIONS) return false;
  const ids = new Set<string>();
  for (const composition of value.compositions) {
    if (!isCompositionSnapshot(composition) || ids.has(composition.compositionId)) return false;
    ids.add(composition.compositionId);
  }
  return true;
}

export function assertVideoTimelineNativeChange(value: unknown): asserts value is VideoTimelineNativeChange {
  if (!isVideoTimelineNativeChange(value)) {
    throw new Error('Video timeline sync payload is malformed or exceeds its bounded schema.');
  }
}

function isCompositionSnapshot(value: unknown): value is VideoTimelineCompositionSnapshot {
  // A workspace seed may aggregate several compositions up to 8 MB, but every individual
  // composition must still fit the mutation route. Otherwise it could seed once and then become
  // permanently unsyncable after the next edit.
  if (!isRecord(value)
    || encodedJsonBytes(value) > MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES
    || !isSafeId(value.compositionId)) return false;
  if (!hasOnlyKeys(value, ['compositionId', 'nodeInstanceId', 'data'])) return false;
  if (value.nodeInstanceId !== undefined && !isSafeId(value.nodeInstanceId)) return false;
  if (!isRecord(value.data)) return false;
  if (Object.keys(value.data).some((key) => !VIDEO_OWNED_KEYS.has(key) || !VIDEO_TIMELINE_DATA_KEYS.includes(key as VideoTimelineDataKey))) {
    return false;
  }
  if (!isBoundedArray(value.data.editorVisualClips, MAX_VIDEO_TIMELINE_SYNC_CLIPS_PER_KIND)) return false;
  if (!isBoundedArray(value.data.editorAudioClips, MAX_VIDEO_TIMELINE_SYNC_CLIPS_PER_KIND)) return false;
  if (!isBoundedArray(value.data.editorAssets, MAX_VIDEO_TIMELINE_SYNC_ASSETS)) return false;
  if (!isBoundedArray(value.data.editorStageObjects, MAX_VIDEO_TIMELINE_SYNC_ASSETS)) return false;
  if (!isBoundedArray(value.data.editorTimelineMarkers, MAX_VIDEO_TIMELINE_SYNC_MARKERS)) return false;
  return isVideoTimelineDataShape(value.data) && isJsonValue(value.data, 0);
}

function isVideoTimelineDataShape(data: Record<string, unknown>): boolean {
  const stringKeys = ['aspectRatio', 'videoResolution'] as const;
  const numberKeys = [
    'videoFrameRate', 'compositionTimelineSeconds', 'compositionAudioTrackCount',
    'compositionVideoAudioVolume', 'compositionAudio1OffsetMs', 'compositionAudio2OffsetMs',
    'compositionAudio3OffsetMs', 'compositionAudio4OffsetMs', 'compositionAudio1Volume',
    'compositionAudio2Volume', 'compositionAudio3Volume', 'compositionAudio4Volume',
  ] as const;
  const booleanKeys = [
    'compositionUseVideoAudio', 'compositionAudio1Enabled', 'compositionAudio2Enabled',
    'compositionAudio3Enabled', 'compositionAudio4Enabled',
  ] as const;
  if (stringKeys.some((key) => data[key] !== undefined && typeof data[key] !== 'string')) return false;
  if (numberKeys.some((key) => data[key] !== undefined
    && (typeof data[key] !== 'number' || !Number.isFinite(data[key])))) return false;
  if (booleanKeys.some((key) => data[key] !== undefined && typeof data[key] !== 'boolean')) return false;

  for (const key of [
    'editorVisualClips', 'editorAudioClips', 'editorAssets', 'editorStageObjects',
    'editorTimelineMarkers',
  ] as const) {
    const entries = data[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.some((entry) => !isRecord(entry) || !isSafeId(entry.id))) return false;
    if (key === 'editorTimelineMarkers' && entries.some((entry) => !isTimelineMarkerWithinBounds(entry))) return false;
    if ((key === 'editorVisualClips' || key === 'editorAudioClips')
      && entries.some((entry) => !isSafeId(entry.sourceNodeId))) return false;
  }
  const numericArrays = [
    'editorAudioTrackVolumes', 'editorTimelineSnapPoints', 'editorLockedVisualTracks',
    'editorLockedAudioTracks', 'editorCollapsedVisualTracks', 'editorCollapsedAudioTracks',
  ] as const;
  if (numericArrays.some((key) => data[key] !== undefined
    && (!Array.isArray(data[key]) || (data[key] as unknown[]).some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))))) {
    return false;
  }
  if (data.editorVisualTrackKinds !== undefined
    && (!Array.isArray(data.editorVisualTrackKinds)
      || data.editorVisualTrackKinds.some((entry) => entry !== 'standard' && entry !== 'overlay'))) return false;
  if (data.editorExportPresetPlan !== undefined) {
    if (!isRecord(data.editorExportPresetPlan)
      || !hasOnlyKeys(data.editorExportPresetPlan, ['presetId', 'notes'])
      || !isSafeId(data.editorExportPresetPlan.presetId)
      || (data.editorExportPresetPlan.notes !== undefined && typeof data.editorExportPresetPlan.notes !== 'string')) return false;
  }
  return true;
}

function isBoundedArray(value: unknown, limit: number): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= limit);
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 24) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 65_536;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= MAX_VIDEO_TIMELINE_SYNC_MARKERS
    && value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(([key, entry]) => key.length <= 128 && isJsonValue(entry, depth + 1));
}

function encodedJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}
