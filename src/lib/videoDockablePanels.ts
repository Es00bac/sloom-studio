import type { DockablePanelDefault, DockZone } from './dockablePanel';

export const VIDEO_WORKSPACE_ID = 'video';

export const VIDEO_PANEL_IDS = {
  projectSourceBin: 'project-source-bin',
  sourceMonitor: 'source-monitor',
  programMonitor: 'program-monitor',
  inspector: 'inspector',
  timeline: 'timeline',
  premiereParity: 'premiere-parity',
  sequenceSettings: 'sequence-settings',
  exportPreset: 'export-preset',
  diagnostics: 'diagnostics',
} as const;

export type VideoDockablePanelId = typeof VIDEO_PANEL_IDS[keyof typeof VIDEO_PANEL_IDS];

export interface VideoDockablePanelDefaultInput {
  sourceBinVisible: boolean;
  sourceMonitorVisible: boolean;
  programMonitorVisible: boolean;
  inspectorVisible: boolean;
  sourceBinWidth: number;
  inspectorWidth: number;
  monitorSplitPercent: number;
  monitorSectionHeight: number;
}

export interface VideoDockablePanelDefault extends DockablePanelDefault {
  panelId: VideoDockablePanelId;
  dockZone: DockZone;
}

const DEFAULT_FLOATING_TOP = 88;
const DEFAULT_MONITOR_SPLIT_WIDTH = 960;

export function buildVideoDockablePanelDefaults({
  sourceBinVisible,
  inspectorVisible,
  sourceBinWidth,
  inspectorWidth,
  monitorSplitPercent,
  monitorSectionHeight,
}: VideoDockablePanelDefaultInput): VideoDockablePanelDefault[] {
  const rawSourceMonitorWidth = Math.round(DEFAULT_MONITOR_SPLIT_WIDTH * (monitorSplitPercent / 100));
  const sourceMonitorWidth = Math.max(320, rawSourceMonitorWidth);
  const programMonitorWidth = Math.max(420, DEFAULT_MONITOR_SPLIT_WIDTH - rawSourceMonitorWidth);
  const timelineHeight = Math.max(360, Math.min(400, Math.round(monitorSectionHeight * 0.82)));

  return [
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.projectSourceBin,
      mode: sourceBinVisible ? 'docked' : 'hidden',
      dockZone: 'left',
      floatingRect: { x: 16, y: DEFAULT_FLOATING_TOP, width: Math.min(sourceBinWidth, 320), height: 720 },
      minSize: { width: 240, height: 260 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.sourceMonitor,
      mode: 'docked',
      dockZone: 'center',
      floatingRect: { x: sourceBinWidth + 40, y: DEFAULT_FLOATING_TOP, width: sourceMonitorWidth, height: monitorSectionHeight },
      minSize: { width: 320, height: 200 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.programMonitor,
      mode: 'docked',
      dockZone: 'center',
      floatingRect: { x: sourceBinWidth + sourceMonitorWidth + 56, y: DEFAULT_FLOATING_TOP, width: programMonitorWidth, height: monitorSectionHeight },
      minSize: { width: 420, height: 240 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.inspector,
      mode: inspectorVisible ? 'docked' : 'hidden',
      dockZone: 'right',
      floatingRect: { x: 1280 - inspectorWidth - 24, y: DEFAULT_FLOATING_TOP, width: inspectorWidth, height: 720 },
      minSize: { width: 260, height: 280 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.timeline,
      mode: 'docked',
      dockZone: 'bottom',
      floatingRect: { x: sourceBinWidth + 40, y: DEFAULT_FLOATING_TOP + monitorSectionHeight + 24, width: 1120, height: timelineHeight },
      minSize: { width: 520, height: 280 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.premiereParity,
      mode: 'hidden',
      dockZone: 'left',
      floatingRect: { x: 48, y: 132, width: Math.max(300, sourceBinWidth), height: 520 },
      minSize: { width: 280, height: 220 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.sequenceSettings,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 940, y: 120, width: 360, height: 220 },
      minSize: { width: 280, height: 180 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.exportPreset,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 980, y: 360, width: 360, height: 220 },
      minSize: { width: 280, height: 180 },
    },
    {
      workspaceId: VIDEO_WORKSPACE_ID,
      panelId: VIDEO_PANEL_IDS.diagnostics,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 1020, y: 600, width: 360, height: 260 },
      minSize: { width: 280, height: 180 },
    },
  ];
}
