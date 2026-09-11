import type { DockablePanelDefault, DockZone, PanelRect, PanelSize } from './dockablePanel';

export function createDockableDialogPanelDefault({
  workspaceId,
  dialogId,
  dockZone = 'overlay',
  defaultFloatingRect,
  minSize,
}: {
  workspaceId: string;
  dialogId: string;
  dockZone?: DockZone;
  defaultFloatingRect?: Partial<PanelRect>;
  minSize?: Partial<PanelSize>;
}): DockablePanelDefault {
  return {
    workspaceId,
    panelId: dialogId,
    mode: 'floating',
    dockZone,
    floatingRect: defaultFloatingRect,
    minSize,
  };
}
