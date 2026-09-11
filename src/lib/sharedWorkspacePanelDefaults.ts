import { resolveSharedDockablePanelCanvasOffsetPx, type DockablePanelDefault, type DockZone } from './dockablePanel';

export type SharedWorkspaceId = 'flow' | 'image' | 'paper';

export interface SharedWorkspacePanelDefault extends DockablePanelDefault {
  panelId: 'source-bin' | 'bookmarks';
  title: string;
  allowedDockZones: DockZone[];
}

export type SharedWorkspacePanelId = SharedWorkspacePanelDefault['panelId'];

const SOURCE_BIN_DEFAULTS: Record<SharedWorkspaceId, SharedWorkspacePanelDefault> = {
  flow: {
    workspaceId: 'flow',
    panelId: 'source-bin',
    title: 'Source Bin',
    mode: 'docked',
    dockZone: 'left',
    floatingRect: { x: 0, y: 80, width: 352, height: 640 },
    minSize: { width: 320, height: 320 },
    allowedDockZones: ['left', 'right', 'overlay'],
  },
  image: {
    workspaceId: 'image',
    panelId: 'source-bin',
    title: 'Source Bin',
    mode: 'docked',
    dockZone: 'left',
    floatingRect: { x: 0, y: 112, width: 352, height: 560 },
    minSize: { width: 320, height: 320 },
    allowedDockZones: ['left', 'right', 'overlay'],
  },
  paper: {
    workspaceId: 'paper',
    panelId: 'source-bin',
    title: 'Source Bin',
    // Paper already has direct Place/Import actions. Keep the library one tap
    // away without spending a large part of a pen-first canvas on an empty bin.
    mode: 'collapsed',
    dockZone: 'left',
    floatingRect: { x: 0, y: 112, width: 352, height: 560 },
    minSize: { width: 320, height: 320 },
    allowedDockZones: ['left', 'right', 'overlay'],
  },
};

const SHARED_WORKSPACE_PANEL_TOP_OFFSET_PX: Record<SharedWorkspaceId, number> = {
  flow: 64,
  // Image has an extra workspace-controls row (zoom / Tools / Panels / Assets / Layout) below the
  // document-tab line; shared docked panels (e.g. the Source Bin) must start below it (~139px) so
  // they don't cover those controls.
  image: 144,
  // Paper's toolbar is portaled into the shared top bar, so nothing occupies the top of the
  // workspace container — the old 64px offset just left the shared Source Bin hanging 64px below
  // Paper's own panels (its Inspector starts flush at the container top).
  paper: 0,
};

export function getSharedWorkspacePanelDefaults(workspaceId: SharedWorkspaceId): SharedWorkspacePanelDefault[] {
  const defaults: SharedWorkspacePanelDefault[] = [SOURCE_BIN_DEFAULTS[workspaceId]];

  if (workspaceId === 'flow') {
    defaults.push(
      {
        workspaceId,
        panelId: 'bookmarks',
        title: 'Bookmarks',
        // Bookmarks are navigation aids, not primary authoring chrome. The
        // compact rail remains discoverable and expands when it is useful.
        mode: 'collapsed',
        dockZone: 'right',
        floatingRect: { x: 1536, y: 80, width: 352, height: 640 },
        minSize: { width: 300, height: 260 },
        allowedDockZones: ['left', 'right', 'overlay'],
      },
    );
  }

  return defaults;
}

export function getSharedWorkspacePanelTopOffsetPx(workspaceId: SharedWorkspaceId): number {
  return SHARED_WORKSPACE_PANEL_TOP_OFFSET_PX[workspaceId];
}

export function getSharedWorkspacePanelBodyClassName(panelId: SharedWorkspacePanelId): string {
  void panelId;
  return 'min-h-0 overflow-hidden p-0';
}

export function getSharedSourceBinCanvasOffsetClassName(
  sourceBinLayout?: Pick<DockablePanelDefault, 'dockZone' | 'mode'>,
): string {
  if (!sourceBinLayout || sourceBinLayout.dockZone !== 'left') {
    return 'ml-0';
  }

  return sourceBinLayout.mode === 'docked'
    ? 'ml-[22rem]'
    : 'ml-0';
}

export function getSharedSourceBinCanvasOffsetPx(
  sourceBinLayout?: Pick<DockablePanelDefault, 'dockZone' | 'mode' | 'floatingRect'>,
): number {
  return resolveSharedDockablePanelCanvasOffsetPx(sourceBinLayout);
}
