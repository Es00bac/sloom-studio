import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceView } from '../types/flow';

export interface EditorWorkspaceSnapshot {
  workspaceView: WorkspaceView;
  activeSourceBinId?: string;
  activeFlowSourceBinId?: string;
  activeCompositionId?: string;
  selectedSourceItemId?: string;
  selectedVisualClipId?: string;
  selectedAudioClipId?: string;
  selectedVisualClipIds: string[];
  selectedAudioClipIds: string[];
  sourceBinTab: 'media' | 'editorAssets';
  sourceMonitorVisible: boolean;
  programMonitorVisible: boolean;
  inspectorVisible: boolean;
  sourceBinVisible: boolean;
  sourceMonitorWidth: number;
  inspectorWidth: number;
  sourceBinWidth: number;
  monitorSplitPercent: number;
  monitorSectionHeight: number;
  timelineVisualTrackHeight: number;
  timelineAudioTrackHeight: number;
}

interface EditorState extends EditorWorkspaceSnapshot {
  setWorkspaceView: (view: WorkspaceView) => void;
  toggleWorkspaceView: () => void;
  setActiveSourceBinId: (id: string | undefined) => void;
  setActiveFlowSourceBinId: (id: string | undefined) => void;
  setActiveCompositionId: (id: string | undefined) => void;
  setSelectedSourceItemId: (id: string | undefined) => void;
  setSelectedVisualClipId: (id: string | undefined) => void;
  setSelectedAudioClipId: (id: string | undefined) => void;
  setSelectedVisualClipIds: (ids: readonly string[], primaryId?: string) => void;
  setSelectedAudioClipIds: (ids: readonly string[], primaryId?: string) => void;
  setSourceBinTab: (tab: 'media' | 'editorAssets') => void;
  setPanelVisibility: (
    panel: 'sourceMonitorVisible' | 'programMonitorVisible' | 'inspectorVisible' | 'sourceBinVisible',
    visible: boolean,
  ) => void;
  setPanelWidth: (panel: 'sourceMonitorWidth' | 'inspectorWidth' | 'sourceBinWidth', width: number) => void;
  setMonitorSplitPercent: (percent: number) => void;
  setMonitorSectionHeight: (height: number) => void;
  setTimelineTrackHeight: (trackType: 'visual' | 'audio', height: number) => void;
  clearTimelineSelection: () => void;
  openEditorForSourceBin: (id: string) => void;
  openEditorForComposition: (id: string) => void;
  exportWorkspaceSnapshot: () => EditorWorkspaceSnapshot;
  restoreWorkspaceSnapshot: (snapshot?: Partial<EditorWorkspaceSnapshot>) => void;
}

const DEFAULT_EDITOR_LAYOUT: Pick<
  EditorWorkspaceSnapshot,
  | 'sourceMonitorVisible'
  | 'sourceBinTab'
  | 'programMonitorVisible'
  | 'inspectorVisible'
  | 'sourceBinVisible'
  | 'sourceMonitorWidth'
  | 'inspectorWidth'
  | 'sourceBinWidth'
  | 'monitorSplitPercent'
  | 'monitorSectionHeight'
  | 'timelineVisualTrackHeight'
  | 'timelineAudioTrackHeight'
> = {
  sourceBinTab: 'media',
  sourceMonitorVisible: true,
  programMonitorVisible: true,
  inspectorVisible: true,
  sourceBinVisible: true,
  sourceMonitorWidth: 320,
  inspectorWidth: 320,
  sourceBinWidth: 280,
  monitorSplitPercent: 50,
  monitorSectionHeight: 400,
  timelineVisualTrackHeight: 84,
  timelineAudioTrackHeight: 64,
};

const WORKSPACE_VIEWS: readonly WorkspaceView[] = ['flow', 'editor', 'image', 'paper'];
const SOURCE_BIN_TABS: readonly EditorWorkspaceSnapshot['sourceBinTab'][] = ['media', 'editorAssets'];

function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.max(min, Math.min(max, Math.round(width)));
}

function clampPercent(percent: number, min: number, max: number): number {
  if (!Number.isFinite(percent)) return min;
  return Math.max(min, Math.min(max, Math.round(percent)));
}

function clampPanelHeight(height: number, min: number, max: number): number {
  if (!Number.isFinite(height)) return min;
  return Math.max(min, Math.min(max, Math.round(height)));
}

function clampTimelineTrackHeight(height: number, min: number, max: number): number {
  if (!Number.isFinite(height)) return min;
  return Math.max(min, Math.min(max, Math.round(height)));
}

export function sanitizeEditorWorkspaceSnapshot(snapshot: unknown): EditorWorkspaceSnapshot {
  const input = isRecord(snapshot) ? snapshot : {};
  const selectedVisualClipId = optionalString(input.selectedVisualClipId);
  const selectedAudioClipId = optionalString(input.selectedAudioClipId);
  const selectedVisualClipIds = boundedUniqueStrings(input.selectedVisualClipIds, 2_000);
  const selectedAudioClipIds = boundedUniqueStrings(input.selectedAudioClipIds, 2_000);
  return {
    workspaceView: isWorkspaceView(input.workspaceView) ? input.workspaceView : 'flow',
    activeSourceBinId: optionalString(input.activeSourceBinId),
    activeFlowSourceBinId: optionalString(input.activeFlowSourceBinId),
    activeCompositionId: optionalString(input.activeCompositionId),
    selectedSourceItemId: optionalString(input.selectedSourceItemId),
    selectedVisualClipId,
    selectedAudioClipId,
    selectedVisualClipIds: selectedVisualClipIds.length > 0
      ? selectedVisualClipIds
      : selectedVisualClipId ? [selectedVisualClipId] : [],
    selectedAudioClipIds: selectedAudioClipIds.length > 0
      ? selectedAudioClipIds
      : selectedAudioClipId ? [selectedAudioClipId] : [],
    sourceBinTab: isSourceBinTab(input.sourceBinTab) ? input.sourceBinTab : DEFAULT_EDITOR_LAYOUT.sourceBinTab,
    sourceMonitorVisible: booleanOr(input.sourceMonitorVisible, DEFAULT_EDITOR_LAYOUT.sourceMonitorVisible),
    programMonitorVisible: booleanOr(input.programMonitorVisible, DEFAULT_EDITOR_LAYOUT.programMonitorVisible),
    inspectorVisible: booleanOr(input.inspectorVisible, DEFAULT_EDITOR_LAYOUT.inspectorVisible),
    sourceBinVisible: booleanOr(input.sourceBinVisible, DEFAULT_EDITOR_LAYOUT.sourceBinVisible),
    sourceMonitorWidth: clampPanelWidth(numberOr(input.sourceMonitorWidth, DEFAULT_EDITOR_LAYOUT.sourceMonitorWidth), 260, 560),
    inspectorWidth: clampPanelWidth(numberOr(input.inspectorWidth, DEFAULT_EDITOR_LAYOUT.inspectorWidth), 260, 560),
    sourceBinWidth: clampPanelWidth(numberOr(input.sourceBinWidth, DEFAULT_EDITOR_LAYOUT.sourceBinWidth), 240, 520),
    monitorSplitPercent: clampPercent(numberOr(input.monitorSplitPercent, DEFAULT_EDITOR_LAYOUT.monitorSplitPercent), 30, 70),
    monitorSectionHeight: clampPanelHeight(numberOr(input.monitorSectionHeight, DEFAULT_EDITOR_LAYOUT.monitorSectionHeight), 220, 900),
    timelineVisualTrackHeight: clampTimelineTrackHeight(numberOr(input.timelineVisualTrackHeight, DEFAULT_EDITOR_LAYOUT.timelineVisualTrackHeight), 60, 220),
    timelineAudioTrackHeight: clampTimelineTrackHeight(numberOr(input.timelineAudioTrackHeight, DEFAULT_EDITOR_LAYOUT.timelineAudioTrackHeight), 44, 220),
  };
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      workspaceView: 'flow',
      activeSourceBinId: undefined,
      activeFlowSourceBinId: undefined,
      activeCompositionId: undefined,
      selectedSourceItemId: undefined,
      selectedVisualClipId: undefined,
      selectedAudioClipId: undefined,
      selectedVisualClipIds: [],
      selectedAudioClipIds: [],
      ...DEFAULT_EDITOR_LAYOUT,
      setWorkspaceView: (workspaceView) => set({ workspaceView }),
      toggleWorkspaceView: () =>
        set((state) => {
          const views: WorkspaceView[] = ['flow', 'editor', 'image', 'paper'];
          const currentIndex = views.indexOf(state.workspaceView);
          const nextIndex = (currentIndex + 1) % views.length;
          return { workspaceView: views[nextIndex] };
        }),
      setActiveSourceBinId: (activeSourceBinId) => set({ activeSourceBinId }),
      setActiveFlowSourceBinId: (activeFlowSourceBinId) => set({ activeFlowSourceBinId }),
      setActiveCompositionId: (activeCompositionId) => set({ activeCompositionId }),
      setSelectedSourceItemId: (selectedSourceItemId) => set({ selectedSourceItemId }),
      setSelectedVisualClipId: (selectedVisualClipId) => set({
        selectedVisualClipId,
        selectedVisualClipIds: selectedVisualClipId ? [selectedVisualClipId] : [],
      }),
      setSelectedAudioClipId: (selectedAudioClipId) => set({
        selectedAudioClipId,
        selectedAudioClipIds: selectedAudioClipId ? [selectedAudioClipId] : [],
      }),
      setSelectedVisualClipIds: (ids, primaryId) => set(() => {
        const selectedVisualClipIds = boundedUniqueStrings(ids, 2_000);
        return {
          selectedVisualClipIds,
          selectedVisualClipId: primaryId && selectedVisualClipIds.includes(primaryId)
            ? primaryId
            : selectedVisualClipIds.at(-1),
        };
      }),
      setSelectedAudioClipIds: (ids, primaryId) => set(() => {
        const selectedAudioClipIds = boundedUniqueStrings(ids, 2_000);
        return {
          selectedAudioClipIds,
          selectedAudioClipId: primaryId && selectedAudioClipIds.includes(primaryId)
            ? primaryId
            : selectedAudioClipIds.at(-1),
        };
      }),
      setSourceBinTab: (sourceBinTab) => set({ sourceBinTab }),
      setPanelVisibility: (panel, visible) => set({ [panel]: visible } as Partial<EditorState>),
      setPanelWidth: (panel, width) =>
        set({
          [panel]:
            panel === 'sourceBinWidth'
              ? clampPanelWidth(width, 240, 520)
              : clampPanelWidth(width, 260, 560),
        } as Partial<EditorState>),
      setMonitorSplitPercent: (monitorSplitPercent) =>
        set({
          monitorSplitPercent: clampPercent(monitorSplitPercent, 30, 70),
        }),
      setMonitorSectionHeight: (monitorSectionHeight) =>
        set({
          monitorSectionHeight: clampPanelHeight(monitorSectionHeight, 220, 900),
        }),
      setTimelineTrackHeight: (trackType, height) =>
        set({
          [trackType === 'visual' ? 'timelineVisualTrackHeight' : 'timelineAudioTrackHeight']:
            clampTimelineTrackHeight(height, trackType === 'visual' ? 60 : 44, 220),
        } as Partial<EditorState>),
      clearTimelineSelection: () =>
        set({
          selectedVisualClipId: undefined,
          selectedAudioClipId: undefined,
          selectedVisualClipIds: [],
          selectedAudioClipIds: [],
        }),
      openEditorForSourceBin: (activeSourceBinId) =>
        set({
          workspaceView: 'editor',
          activeSourceBinId,
        }),
      openEditorForComposition: (activeCompositionId) =>
        set({
          workspaceView: 'editor',
          activeCompositionId,
        }),
      exportWorkspaceSnapshot: () => {
        const state = get();

        return {
          workspaceView: state.workspaceView,
          activeSourceBinId: state.activeSourceBinId,
          activeFlowSourceBinId: state.activeFlowSourceBinId,
          activeCompositionId: state.activeCompositionId,
          selectedSourceItemId: state.selectedSourceItemId,
          selectedVisualClipId: state.selectedVisualClipId,
          selectedAudioClipId: state.selectedAudioClipId,
          selectedVisualClipIds: [...state.selectedVisualClipIds],
          selectedAudioClipIds: [...state.selectedAudioClipIds],
          sourceBinTab: state.sourceBinTab,
          sourceMonitorVisible: state.sourceMonitorVisible,
          programMonitorVisible: state.programMonitorVisible,
          inspectorVisible: state.inspectorVisible,
          sourceBinVisible: state.sourceBinVisible,
          sourceMonitorWidth: state.sourceMonitorWidth,
          inspectorWidth: state.inspectorWidth,
          sourceBinWidth: state.sourceBinWidth,
          monitorSplitPercent: state.monitorSplitPercent,
          monitorSectionHeight: state.monitorSectionHeight,
          timelineVisualTrackHeight: state.timelineVisualTrackHeight,
          timelineAudioTrackHeight: state.timelineAudioTrackHeight,
        };
      },
      restoreWorkspaceSnapshot: (snapshot) =>
        set(sanitizeEditorWorkspaceSnapshot(snapshot)),
    }),
    {
      name: 'flow-editor-workspace',
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeEditorWorkspaceSnapshot(persisted),
      }),
    },
  ),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boundedUniqueStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))]
    .slice(0, limit);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return typeof value === 'string' && WORKSPACE_VIEWS.includes(value as WorkspaceView);
}

function isSourceBinTab(value: unknown): value is EditorWorkspaceSnapshot['sourceBinTab'] {
  return typeof value === 'string' && SOURCE_BIN_TABS.includes(value as EditorWorkspaceSnapshot['sourceBinTab']);
}
