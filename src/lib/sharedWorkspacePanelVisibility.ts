import type { WorkspaceView } from '../types/flow';

export interface SharedWorkspacePanelVisibilityInput {
  applicationChromeHidden: boolean;
  mobilePhoneInterfaceEnabled: boolean;
  workspaceView: WorkspaceView;
}

export function shouldShowSharedWorkspacePanels({
  applicationChromeHidden,
  mobilePhoneInterfaceEnabled,
  workspaceView,
}: SharedWorkspacePanelVisibilityInput): boolean {
  if (workspaceView === 'editor' || applicationChromeHidden) {
    return false;
  }

  // Every dedicated phone workspace owns its primary surface. Keeping the desktop Source Bin and
  // Bookmarks layers above Flow steals pointer input from the canvas and starter gallery.
  if (mobilePhoneInterfaceEnabled) {
    return false;
  }

  return true;
}
