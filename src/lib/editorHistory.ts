import type {
  AspectRatio,
  EditorAudioClip,
  EditorAsset,
  EditorVisualTrackKind,
  EditorVisualClip,
  NodeData,
  VideoExportPresetPlanData,
  VideoResolution,
} from '../types/flow';
import {
  getEditorAudioClips,
  getEditorAudioTrackVolumes,
  getEditorVisualTrackKinds,
  getEditorVisualClips,
} from './manualEditorState';
import { normalizeAudioTrackIndexes } from './editorAudioMix';
import { getEditorStageObjects } from './editorStageObjects';
import { getEditorAssets } from './editorAssets';
import { isAspectRatio } from './providerCatalog';
import { normalizeTimelineSnapPoints } from './editorTimelineSnap';
import { normalizeTimelineMarkers, type TimelineMarker } from './editorTimelineMarkers';
import { normalizeLockedTracks } from './editorTrackLocks';
import { normalizeCollapsedTracks } from './editorTrackCollapse';

export const EDITOR_HISTORY_LIMIT = 80;
export const EDITOR_HISTORY_ABSOLUTE_LIMIT = 200;
export const EDITOR_HISTORY_SERIALIZED_CHARACTER_BUDGET = 16 * 1024 * 1024;
const historyEntryCharacterCounts = new WeakMap<EditorHistoryEntry, number>();

export interface EditorHistorySnapshot {
  aspectRatio?: AspectRatio;
  videoResolution?: VideoResolution;
  videoFrameRate?: number;
  compositionTimelineSeconds?: number;
  compositionAudioTrackCount?: number;
  compositionUseVideoAudio?: boolean;
  compositionVideoAudioVolume?: number;
  compositionAudio1OffsetMs?: number;
  compositionAudio2OffsetMs?: number;
  compositionAudio3OffsetMs?: number;
  compositionAudio4OffsetMs?: number;
  compositionAudio1Volume?: number;
  compositionAudio2Volume?: number;
  compositionAudio3Volume?: number;
  compositionAudio4Volume?: number;
  compositionAudio1Enabled?: boolean;
  compositionAudio2Enabled?: boolean;
  compositionAudio3Enabled?: boolean;
  compositionAudio4Enabled?: boolean;
  editorVisualClips: EditorVisualClip[];
  editorVisualTrackKinds: EditorVisualTrackKind[];
  editorAudioClips: EditorAudioClip[];
  editorAudioTrackVolumes: number[];
  editorMutedAudioTracks: number[];
  editorSoloAudioTracks: number[];
  editorAssets: EditorAsset[];
  editorStageObjects: NodeData['editorStageObjects'];
  editorTimelineSnapPoints: number[];
  editorTimelineMarkers: TimelineMarker[];
  editorLockedVisualTracks: number[];
  editorLockedAudioTracks: number[];
  editorCollapsedVisualTracks: number[];
  editorCollapsedAudioTracks: number[];
  editorExportPresetPlan?: VideoExportPresetPlanData;
  editorProfessionalState: NodeData['editorProfessionalState'];
  editorProfessionalWorkflowState: NodeData['editorProfessionalWorkflowState'];
  toPatch: () => Partial<NodeData>;
}

export interface EditorHistoryEntry {
  compositionId: string;
  before: EditorHistorySnapshot;
  after: EditorHistorySnapshot;
  label: string;
}

export interface EditorHistoryState {
  undoStack: EditorHistoryEntry[];
  redoStack: EditorHistoryEntry[];
  limit: number;
  serializedCharacterBudget: number;
}

export interface EditorHistoryResult {
  history: EditorHistoryState;
  entry?: EditorHistoryEntry;
  snapshot?: EditorHistorySnapshot;
}

export function createEditorHistoryState(
  limit = EDITOR_HISTORY_LIMIT,
  serializedCharacterBudget = EDITOR_HISTORY_SERIALIZED_CHARACTER_BUDGET,
): EditorHistoryState {
  return {
    undoStack: [],
    redoStack: [],
    limit: normalizeHistoryLimit(limit),
    serializedCharacterBudget: normalizeHistoryCharacterBudget(serializedCharacterBudget),
  };
}

export function createEditorHistorySnapshot(data: Partial<NodeData>): EditorHistorySnapshot {
  const visualClips = getEditorVisualClips(data).map(cloneVisualClip);
  const audioClips = getEditorAudioClips(data).map(cloneAudioClip);
  const visualTrackCount = resolveTrackCount(data.editorVisualTrackKinds, visualClips.map((clip) => clip.trackIndex));
  const audioTrackCount = resolveTrackCount(data.editorAudioTrackVolumes, audioClips.map((clip) => clip.trackIndex));
  const snapshotData = {
    aspectRatio: normalizeAspectRatio(data.aspectRatio),
    videoResolution: normalizeVideoResolution(data.videoResolution),
    videoFrameRate: optionalFiniteNumber(data.videoFrameRate),
    compositionTimelineSeconds: normalizeTimelineSeconds(data.compositionTimelineSeconds),
    compositionAudioTrackCount: optionalInteger(data.compositionAudioTrackCount, 1, 4),
    compositionUseVideoAudio: optionalBoolean(data.compositionUseVideoAudio),
    compositionVideoAudioVolume: optionalFiniteNumber(data.compositionVideoAudioVolume),
    compositionAudio1OffsetMs: optionalFiniteNumber(data.compositionAudio1OffsetMs),
    compositionAudio2OffsetMs: optionalFiniteNumber(data.compositionAudio2OffsetMs),
    compositionAudio3OffsetMs: optionalFiniteNumber(data.compositionAudio3OffsetMs),
    compositionAudio4OffsetMs: optionalFiniteNumber(data.compositionAudio4OffsetMs),
    compositionAudio1Volume: optionalFiniteNumber(data.compositionAudio1Volume),
    compositionAudio2Volume: optionalFiniteNumber(data.compositionAudio2Volume),
    compositionAudio3Volume: optionalFiniteNumber(data.compositionAudio3Volume),
    compositionAudio4Volume: optionalFiniteNumber(data.compositionAudio4Volume),
    compositionAudio1Enabled: optionalBoolean(data.compositionAudio1Enabled),
    compositionAudio2Enabled: optionalBoolean(data.compositionAudio2Enabled),
    compositionAudio3Enabled: optionalBoolean(data.compositionAudio3Enabled),
    compositionAudio4Enabled: optionalBoolean(data.compositionAudio4Enabled),
    editorVisualClips: visualClips,
    editorVisualTrackKinds: getEditorVisualTrackKinds(data, visualTrackCount),
    editorAudioClips: audioClips,
    editorAudioTrackVolumes: getEditorAudioTrackVolumes(data, audioTrackCount),
    editorMutedAudioTracks: normalizeAudioTrackIndexes(data.editorMutedAudioTracks),
    editorSoloAudioTracks: normalizeAudioTrackIndexes(data.editorSoloAudioTracks),
    editorAssets: getEditorAssets(data).map(cloneEditorAsset),
    editorStageObjects: getEditorStageObjects(data).map(cloneStageObject),
    editorTimelineSnapPoints: normalizeTimelineSnapPoints(data.editorTimelineSnapPoints),
    editorTimelineMarkers: normalizeTimelineMarkers(data.editorTimelineMarkers),
    editorLockedVisualTracks: normalizeLockedTracks(data.editorLockedVisualTracks),
    editorLockedAudioTracks: normalizeLockedTracks(data.editorLockedAudioTracks),
    editorCollapsedVisualTracks: normalizeCollapsedTracks(data.editorCollapsedVisualTracks),
    editorCollapsedAudioTracks: normalizeCollapsedTracks(data.editorCollapsedAudioTracks),
    editorExportPresetPlan: cloneJsonValue(data.editorExportPresetPlan),
    editorProfessionalState: cloneJsonValue(data.editorProfessionalState),
    editorProfessionalWorkflowState: cloneJsonValue(data.editorProfessionalWorkflowState),
  };

  return {
    ...snapshotData,
    toPatch: () => ({
      aspectRatio: snapshotData.aspectRatio,
      videoResolution: snapshotData.videoResolution,
      videoFrameRate: snapshotData.videoFrameRate,
      compositionTimelineSeconds: snapshotData.compositionTimelineSeconds,
      compositionAudioTrackCount: snapshotData.compositionAudioTrackCount,
      compositionUseVideoAudio: snapshotData.compositionUseVideoAudio,
      compositionVideoAudioVolume: snapshotData.compositionVideoAudioVolume,
      compositionAudio1OffsetMs: snapshotData.compositionAudio1OffsetMs,
      compositionAudio2OffsetMs: snapshotData.compositionAudio2OffsetMs,
      compositionAudio3OffsetMs: snapshotData.compositionAudio3OffsetMs,
      compositionAudio4OffsetMs: snapshotData.compositionAudio4OffsetMs,
      compositionAudio1Volume: snapshotData.compositionAudio1Volume,
      compositionAudio2Volume: snapshotData.compositionAudio2Volume,
      compositionAudio3Volume: snapshotData.compositionAudio3Volume,
      compositionAudio4Volume: snapshotData.compositionAudio4Volume,
      compositionAudio1Enabled: snapshotData.compositionAudio1Enabled,
      compositionAudio2Enabled: snapshotData.compositionAudio2Enabled,
      compositionAudio3Enabled: snapshotData.compositionAudio3Enabled,
      compositionAudio4Enabled: snapshotData.compositionAudio4Enabled,
      editorVisualClips: snapshotData.editorVisualClips.map(cloneVisualClip),
      editorVisualTrackKinds: [...snapshotData.editorVisualTrackKinds],
      editorAudioClips: snapshotData.editorAudioClips.map(cloneAudioClip),
      editorAudioTrackVolumes: [...snapshotData.editorAudioTrackVolumes],
      editorMutedAudioTracks: [...snapshotData.editorMutedAudioTracks],
      editorSoloAudioTracks: [...snapshotData.editorSoloAudioTracks],
      editorAssets: snapshotData.editorAssets.map(cloneEditorAsset),
      editorStageObjects: snapshotData.editorStageObjects?.map(cloneStageObject),
      editorTimelineSnapPoints: [...snapshotData.editorTimelineSnapPoints],
      editorTimelineMarkers: snapshotData.editorTimelineMarkers.map((marker) => ({ ...marker })),
      editorLockedVisualTracks: [...snapshotData.editorLockedVisualTracks],
      editorLockedAudioTracks: [...snapshotData.editorLockedAudioTracks],
      editorCollapsedVisualTracks: [...snapshotData.editorCollapsedVisualTracks],
      editorCollapsedAudioTracks: [...snapshotData.editorCollapsedAudioTracks],
      editorExportPresetPlan: cloneJsonValue(snapshotData.editorExportPresetPlan),
      editorProfessionalState: cloneJsonValue(snapshotData.editorProfessionalState),
      editorProfessionalWorkflowState: cloneJsonValue(snapshotData.editorProfessionalWorkflowState),
    }),
  };
}

export function pushEditorHistoryEntry(
  history: EditorHistoryState,
  entry: EditorHistoryEntry,
): EditorHistoryState {
  const beforeString = stableSnapshotString(entry.before);
  const afterString = stableSnapshotString(entry.after);
  if (beforeString === afterString) {
    return history;
  }
  historyEntryCharacterCounts.set(entry, beforeString.length + afterString.length);
  const serializedCharacterBudget = normalizeHistoryCharacterBudget(history.serializedCharacterBudget);

  return {
    ...history,
    undoStack: trimHistoryEntriesToBudget(
      [...history.undoStack, entry].slice(-history.limit),
      serializedCharacterBudget,
    ),
    redoStack: [],
    serializedCharacterBudget,
  };
}

export function undoEditorHistory(history: EditorHistoryState): EditorHistoryResult {
  const entry = history.undoStack.at(-1);

  if (!entry) {
    return { history };
  }

  return {
    history: {
      ...history,
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, entry].slice(-history.limit),
    },
    entry,
    snapshot: entry.before,
  };
}

export function redoEditorHistory(history: EditorHistoryState): EditorHistoryResult {
  const entry = history.redoStack.at(-1);

  if (!entry) {
    return { history };
  }

  return {
    history: {
      ...history,
      undoStack: [...history.undoStack, entry].slice(-history.limit),
      redoStack: history.redoStack.slice(0, -1),
    },
    entry,
    snapshot: entry.after,
  };
}

export function estimateEditorHistoryEntryCharacters(entry: EditorHistoryEntry): number {
  const cached = historyEntryCharacterCounts.get(entry);
  if (cached !== undefined) return cached;
  const estimate = stableSnapshotString(entry.before).length + stableSnapshotString(entry.after).length;
  historyEntryCharacterCounts.set(entry, estimate);
  return estimate;
}

function trimHistoryEntriesToBudget(
  entries: readonly EditorHistoryEntry[],
  serializedCharacterBudget: number,
): EditorHistoryEntry[] {
  let retainedStart = entries.length;
  let retainedCharacters = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entryCharacters = estimateEditorHistoryEntryCharacters(entries[index]);
    if (retainedStart < entries.length && retainedCharacters + entryCharacters > serializedCharacterBudget) break;
    retainedCharacters += entryCharacters;
    retainedStart = index;
  }
  return entries.slice(retainedStart);
}

function stableSnapshotString(snapshot: EditorHistorySnapshot): string {
  return JSON.stringify({
    aspectRatio: snapshot.aspectRatio,
    videoResolution: snapshot.videoResolution,
    videoFrameRate: snapshot.videoFrameRate,
    compositionTimelineSeconds: snapshot.compositionTimelineSeconds,
    compositionAudioTrackCount: snapshot.compositionAudioTrackCount,
    compositionUseVideoAudio: snapshot.compositionUseVideoAudio,
    compositionVideoAudioVolume: snapshot.compositionVideoAudioVolume,
    compositionAudio1OffsetMs: snapshot.compositionAudio1OffsetMs,
    compositionAudio2OffsetMs: snapshot.compositionAudio2OffsetMs,
    compositionAudio3OffsetMs: snapshot.compositionAudio3OffsetMs,
    compositionAudio4OffsetMs: snapshot.compositionAudio4OffsetMs,
    compositionAudio1Volume: snapshot.compositionAudio1Volume,
    compositionAudio2Volume: snapshot.compositionAudio2Volume,
    compositionAudio3Volume: snapshot.compositionAudio3Volume,
    compositionAudio4Volume: snapshot.compositionAudio4Volume,
    compositionAudio1Enabled: snapshot.compositionAudio1Enabled,
    compositionAudio2Enabled: snapshot.compositionAudio2Enabled,
    compositionAudio3Enabled: snapshot.compositionAudio3Enabled,
    compositionAudio4Enabled: snapshot.compositionAudio4Enabled,
    editorVisualClips: snapshot.editorVisualClips,
    editorVisualTrackKinds: snapshot.editorVisualTrackKinds,
    editorAudioClips: snapshot.editorAudioClips,
    editorAudioTrackVolumes: snapshot.editorAudioTrackVolumes,
    editorMutedAudioTracks: snapshot.editorMutedAudioTracks,
    editorSoloAudioTracks: snapshot.editorSoloAudioTracks,
    editorAssets: snapshot.editorAssets,
    editorStageObjects: snapshot.editorStageObjects,
    editorTimelineSnapPoints: snapshot.editorTimelineSnapPoints,
    editorTimelineMarkers: snapshot.editorTimelineMarkers,
    editorLockedVisualTracks: snapshot.editorLockedVisualTracks,
    editorLockedAudioTracks: snapshot.editorLockedAudioTracks,
    editorCollapsedVisualTracks: snapshot.editorCollapsedVisualTracks,
    editorCollapsedAudioTracks: snapshot.editorCollapsedAudioTracks,
    editorExportPresetPlan: snapshot.editorExportPresetPlan,
    editorProfessionalState: snapshot.editorProfessionalState,
    editorProfessionalWorkflowState: snapshot.editorProfessionalWorkflowState,
  });
}

function cloneVisualClip(clip: EditorVisualClip): EditorVisualClip {
  return cloneJsonValue(clip);
}

function cloneAudioClip(clip: EditorAudioClip): EditorAudioClip {
  return cloneJsonValue(clip);
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneEditorAsset(asset: EditorAsset): EditorAsset {
  return cloneJsonValue(asset);
}

function cloneStageObject(
  object: NonNullable<NodeData['editorStageObjects']>[number],
): NonNullable<NodeData['editorStageObjects']>[number] {
  return cloneJsonValue(object);
}

function normalizeAspectRatio(value: unknown): AspectRatio | undefined {
  return isAspectRatio(value) ? value : undefined;
}

function normalizeVideoResolution(value: unknown): VideoResolution | undefined {
  return value === '720p' || value === '1080p' || value === '4k' ? value : undefined;
}

function normalizeTimelineSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : undefined;
}

function normalizeHistoryLimit(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_HISTORY_LIMIT;
  return Math.max(1, Math.min(EDITOR_HISTORY_ABSOLUTE_LIMIT, Math.floor(value)));
}

function normalizeHistoryCharacterBudget(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_HISTORY_SERIALIZED_CHARACTER_BUDGET;
  return Math.max(1_024, Math.min(EDITOR_HISTORY_SERIALIZED_CHARACTER_BUDGET, Math.floor(value)));
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function resolveTrackCount(rawTracks: unknown, clipTrackIndexes: readonly number[]): number {
  const explicitCount = Array.isArray(rawTracks) ? rawTracks.length : 0;
  const clipCount = clipTrackIndexes.reduce(
    (maximum, index) => Number.isInteger(index) && index >= 0 ? Math.max(maximum, index + 1) : maximum,
    0,
  );
  return Math.min(64, Math.max(4, explicitCount, clipCount));
}
