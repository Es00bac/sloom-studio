import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ImageWorkspaceLayout {
  toolbarVisible: boolean;
  rightPanelVisible: boolean;
  assetBarVisible: boolean;
  rightPanelWidth: number;
}

export interface PaperWorkspaceLayout {
  toolbarVisible: boolean;
  inspectorVisible: boolean;
  inspectorWidth: number;
}

export interface WorkspaceLayoutSnapshot {
  image: ImageWorkspaceLayout;
  paper: PaperWorkspaceLayout;
}

interface WorkspaceLayoutState extends WorkspaceLayoutSnapshot {
  setImageLayout: (patch: Partial<ImageWorkspaceLayout>) => void;
  setPaperLayout: (patch: Partial<PaperWorkspaceLayout>) => void;
  resetWorkspaceLayout: () => void;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutSnapshot = {
  image: {
    toolbarVisible: true,
    rightPanelVisible: true,
    assetBarVisible: true,
    rightPanelWidth: 224,
  },
  paper: {
    toolbarVisible: true,
    inspectorVisible: true,
    inspectorWidth: 288,
  },
};

export function createDefaultWorkspaceLayout(): WorkspaceLayoutSnapshot {
  return {
    image: { ...DEFAULT_WORKSPACE_LAYOUT.image },
    paper: { ...DEFAULT_WORKSPACE_LAYOUT.paper },
  };
}

export function clampWorkspaceLayout(snapshot: Partial<WorkspaceLayoutSnapshot> = {}): WorkspaceLayoutSnapshot {
  const input = isRecord(snapshot) ? snapshot : {};
  const image: Record<string, unknown> = isRecord(input.image) ? input.image : {};
  const paper: Record<string, unknown> = isRecord(input.paper) ? input.paper : {};
  return {
    image: {
      toolbarVisible: booleanOr(image.toolbarVisible, DEFAULT_WORKSPACE_LAYOUT.image.toolbarVisible),
      rightPanelVisible: booleanOr(image.rightPanelVisible, DEFAULT_WORKSPACE_LAYOUT.image.rightPanelVisible),
      assetBarVisible: booleanOr(image.assetBarVisible, DEFAULT_WORKSPACE_LAYOUT.image.assetBarVisible),
      rightPanelWidth: clampNumber(numberOr(image.rightPanelWidth, DEFAULT_WORKSPACE_LAYOUT.image.rightPanelWidth), 180, 560),
    },
    paper: {
      toolbarVisible: booleanOr(paper.toolbarVisible, DEFAULT_WORKSPACE_LAYOUT.paper.toolbarVisible),
      inspectorVisible: booleanOr(paper.inspectorVisible, DEFAULT_WORKSPACE_LAYOUT.paper.inspectorVisible),
      inspectorWidth: clampNumber(numberOr(paper.inspectorWidth, DEFAULT_WORKSPACE_LAYOUT.paper.inspectorWidth), 260, 620),
    },
  };
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      ...createDefaultWorkspaceLayout(),
      setImageLayout: (patch) =>
        set((state) => ({
          image: clampWorkspaceLayout({
            image: { ...state.image, ...patch },
            paper: state.paper,
          }).image,
        })),
      setPaperLayout: (patch) =>
        set((state) => ({
          paper: clampWorkspaceLayout({
            image: state.image,
            paper: { ...state.paper, ...patch },
          }).paper,
        })),
      resetWorkspaceLayout: () => set(createDefaultWorkspaceLayout()),
    }),
    {
      name: 'signal-loom-workspace-layouts',
      partialize: (state) => ({
        image: state.image,
        paper: state.paper,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...clampWorkspaceLayout(persisted as Partial<WorkspaceLayoutSnapshot>),
      }),
    },
  ),
);

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
