import type { DockablePanelDefinition } from '../DockablePanel/DockablePanelHost';
import type { DockablePanelLayout } from '../../lib/dockablePanel';

export const PAPER_DOCKABLE_WORKSPACE_ID = 'paper';

export const PAPER_DOCKABLE_PANEL_IDS = {
  tools: 'tools',
  documentStrip: 'document-strip',
  inspector: 'inspector',
  pages: 'pages',
  layers: 'layers',
  storyEditor: 'story-editor',
  writingAssistant: 'writing-assistant',
  assistedLayout: 'assisted-layout',
  liveLayoutAgent: 'live-layout-agent',
  shortcutsHelp: 'shortcuts-help',
  preflight: 'preflight',
  linkedAssets: 'linked-assets',
  reviewComments: 'review-comments',
  dtpParity: 'dtp-parity',
  findChange: 'find-change',
  tiltmarkMaterial: 'tiltmark-material',
  tiltmarkPalette: 'tiltmark-palette',
  tiltmarkCare: 'tiltmark-care',
  tiltmarkSupply: 'tiltmark-supply',
} as const;

export const PAPER_TILTMARK_PHYSICAL_PANEL_IDS = [
  PAPER_DOCKABLE_PANEL_IDS.tiltmarkMaterial,
  PAPER_DOCKABLE_PANEL_IDS.tiltmarkPalette,
  PAPER_DOCKABLE_PANEL_IDS.tiltmarkCare,
  PAPER_DOCKABLE_PANEL_IDS.tiltmarkSupply,
] as const;

export type PaperDockablePanelId = typeof PAPER_DOCKABLE_PANEL_IDS[keyof typeof PAPER_DOCKABLE_PANEL_IDS];
export type PaperDockablePanelDefault = Omit<DockablePanelDefinition, 'content' | 'title'>;

export function createPaperDockablePanelDefaults(): PaperDockablePanelDefault[] {
  return [
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.inspector,
      dockZone: 'right',
      floatingRect: { x: 1040, y: 96, width: 340, height: 720 },
      minSize: { width: 260, height: 360 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.pages,
      mode: 'hidden',
      dockZone: 'left',
      floatingRect: { x: 96, y: 96, width: 300, height: 640 },
      minSize: { width: 240, height: 300 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.layers,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 1010, y: 116, width: 320, height: 560 },
      minSize: { width: 250, height: 260 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.storyEditor,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 950, y: 88, width: 380, height: 720 },
      minSize: { width: 280, height: 360 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.writingAssistant,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 980, y: 104, width: 360, height: 680 },
      minSize: { width: 280, height: 360 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.assistedLayout,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 950, y: 88, width: 380, height: 720 },
      minSize: { width: 280, height: 400 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.liveLayoutAgent,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 950, y: 88, width: 380, height: 720 },
      minSize: { width: 280, height: 420 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.shortcutsHelp,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 990, y: 96, width: 350, height: 680 },
      minSize: { width: 280, height: 320 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.preflight,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 980, y: 128, width: 320, height: 420 },
      minSize: { width: 260, height: 240 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.linkedAssets,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 1020, y: 168, width: 340, height: 420 },
      minSize: { width: 260, height: 240 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.reviewComments,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 990, y: 120, width: 340, height: 560 },
      minSize: { width: 260, height: 260 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.dtpParity,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 1060, y: 208, width: 360, height: 520 },
      minSize: { width: 280, height: 260 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.findChange,
      mode: 'hidden',
      dockZone: 'right',
      floatingRect: { x: 1000, y: 148, width: 340, height: 400 },
      minSize: { width: 280, height: 240 },
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.tiltmarkMaterial,
      mode: 'hidden',
      dockZone: 'overlay',
      floatingRect: { x: 480, y: 104, width: 250, height: 238 },
      minSize: { width: 250, height: 238 },
      allowedDockZones: [],
      chrome: 'compact-floating',
      fixedSize: true,
      bodyClassName: 'min-h-0 overflow-hidden p-0',
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.tiltmarkPalette,
      mode: 'hidden',
      dockZone: 'overlay',
      floatingRect: { x: 480, y: 362, width: 236, height: 92 },
      minSize: { width: 236, height: 92 },
      allowedDockZones: [],
      chrome: 'compact-floating',
      fixedSize: true,
      bodyClassName: 'min-h-0 overflow-visible p-0',
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.tiltmarkCare,
      mode: 'hidden',
      dockZone: 'overlay',
      floatingRect: { x: 732, y: 362, width: 188, height: 114 },
      minSize: { width: 188, height: 114 },
      allowedDockZones: [],
      chrome: 'compact-floating',
      fixedSize: true,
      bodyClassName: 'min-h-0 overflow-hidden p-0',
    },
    {
      workspaceId: PAPER_DOCKABLE_WORKSPACE_ID,
      panelId: PAPER_DOCKABLE_PANEL_IDS.tiltmarkSupply,
      mode: 'hidden',
      dockZone: 'overlay',
      floatingRect: { x: 744, y: 104, width: 224, height: 132 },
      minSize: { width: 224, height: 132 },
      allowedDockZones: [],
      chrome: 'compact-floating',
      fixedSize: true,
      bodyClassName: 'min-h-0 overflow-hidden p-0',
    },
  ];
}

export function getPaperDockableCanvasOffsetClassName(
  sourceBinLayout?: Pick<DockablePanelLayout, 'dockZone' | 'mode'>,
): string {
  if (!sourceBinLayout || sourceBinLayout.dockZone !== 'left') {
    return 'ml-0';
  }

  return sourceBinLayout.mode === 'docked'
    ? 'ml-[22rem]'
    : 'ml-0';
}
