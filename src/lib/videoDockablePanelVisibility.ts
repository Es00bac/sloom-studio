import type { DockZone } from './dockablePanel';
import { VIDEO_PANEL_IDS, VIDEO_WORKSPACE_ID, type VideoDockablePanelId } from './videoDockablePanels';

export type VideoPanelVisibilityKey =
  | 'sourceMonitorVisible'
  | 'programMonitorVisible'
  | 'inspectorVisible'
  | 'sourceBinVisible';

interface VideoPanelVisibilityTarget {
  panelId: VideoDockablePanelId;
  dockZone: DockZone;
}

export interface VideoPanelVisibilityActions {
  setPanelVisibility: (panel: VideoPanelVisibilityKey, visible: boolean) => void;
  dockPanel: (workspaceId: string, panelId: string, zone: DockZone) => void;
  hidePanel: (workspaceId: string, panelId: string) => void;
}

const VIDEO_PANEL_VISIBILITY_TARGETS: Record<VideoPanelVisibilityKey, VideoPanelVisibilityTarget> = {
  sourceBinVisible: {
    panelId: VIDEO_PANEL_IDS.projectSourceBin,
    dockZone: 'left',
  },
  sourceMonitorVisible: {
    panelId: VIDEO_PANEL_IDS.sourceMonitor,
    dockZone: 'center',
  },
  programMonitorVisible: {
    panelId: VIDEO_PANEL_IDS.programMonitor,
    dockZone: 'center',
  },
  inspectorVisible: {
    panelId: VIDEO_PANEL_IDS.inspector,
    dockZone: 'right',
  },
};

export function applyVideoDockablePanelVisibility(
  panel: VideoPanelVisibilityKey,
  visible: boolean,
  actions: VideoPanelVisibilityActions,
): void {
  actions.setPanelVisibility(panel, visible);
  const target = VIDEO_PANEL_VISIBILITY_TARGETS[panel];

  if (visible) {
    actions.dockPanel(VIDEO_WORKSPACE_ID, target.panelId, target.dockZone);
  } else {
    actions.hidePanel(VIDEO_WORKSPACE_ID, target.panelId);
  }
}
