import { describe, expect, it, vi } from 'vitest';
import { applyVideoDockablePanelVisibility } from './videoDockablePanelVisibility';
import { VIDEO_PANEL_IDS, VIDEO_WORKSPACE_ID } from './videoDockablePanels';

describe('video dockable panel visibility bridge', () => {
  it('opens the Source toggle as a docked Source Monitor instead of only changing legacy visibility', () => {
    const actions = {
      setPanelVisibility: vi.fn(),
      dockPanel: vi.fn(),
      hidePanel: vi.fn(),
    };

    applyVideoDockablePanelVisibility('sourceMonitorVisible', true, actions);

    expect(actions.setPanelVisibility).toHaveBeenCalledWith('sourceMonitorVisible', true);
    expect(actions.dockPanel).toHaveBeenCalledWith(VIDEO_WORKSPACE_ID, VIDEO_PANEL_IDS.sourceMonitor, 'center');
    expect(actions.hidePanel).not.toHaveBeenCalled();
  });

  it('hides the dockable Source Monitor when the Source toggle is turned off', () => {
    const actions = {
      setPanelVisibility: vi.fn(),
      dockPanel: vi.fn(),
      hidePanel: vi.fn(),
    };

    applyVideoDockablePanelVisibility('sourceMonitorVisible', false, actions);

    expect(actions.setPanelVisibility).toHaveBeenCalledWith('sourceMonitorVisible', false);
    expect(actions.hidePanel).toHaveBeenCalledWith(VIDEO_WORKSPACE_ID, VIDEO_PANEL_IDS.sourceMonitor);
    expect(actions.dockPanel).not.toHaveBeenCalled();
  });

  it('maps the other Video titlebar toggles to their dockable panels', () => {
    const actions = {
      setPanelVisibility: vi.fn(),
      dockPanel: vi.fn(),
      hidePanel: vi.fn(),
    };

    applyVideoDockablePanelVisibility('sourceBinVisible', true, actions);
    applyVideoDockablePanelVisibility('programMonitorVisible', true, actions);
    applyVideoDockablePanelVisibility('inspectorVisible', true, actions);

    expect(actions.dockPanel).toHaveBeenCalledWith(VIDEO_WORKSPACE_ID, VIDEO_PANEL_IDS.projectSourceBin, 'left');
    expect(actions.dockPanel).toHaveBeenCalledWith(VIDEO_WORKSPACE_ID, VIDEO_PANEL_IDS.programMonitor, 'center');
    expect(actions.dockPanel).toHaveBeenCalledWith(VIDEO_WORKSPACE_ID, VIDEO_PANEL_IDS.inspector, 'right');
  });
});
