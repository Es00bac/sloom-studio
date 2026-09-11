import { describe, expect, it, beforeEach } from 'vitest';
import { panelKey } from '../../lib/dockablePanel';
import { createDockableDialogPanelDefault } from '../../lib/dockableDialog';
import { useDockablePanelStore } from '../../store/dockablePanelStore';

describe('DockableDialog defaults', () => {
  beforeEach(() => {
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
  });

  it('creates floating dialog defaults with requested dock target and sizing', () => {
    const defaultPanel = createDockableDialogPanelDefault({
      workspaceId: 'app-dialogs',
      dialogId: 'settings',
      dockZone: 'overlay',
      defaultFloatingRect: { x: 128, y: 64, width: 900, height: 640 },
      minSize: { width: 520, height: 400 },
    });

    expect(defaultPanel).toMatchObject({
      workspaceId: 'app-dialogs',
      panelId: 'settings',
      mode: 'floating',
      dockZone: 'overlay',
      floatingRect: { x: 128, y: 64, width: 900, height: 640 },
      minSize: { width: 520, height: 400 },
    });
  });

  it('uses dockable store hide, float, dock, collapse, and reset lifecycle', () => {
    const defaultPanel = createDockableDialogPanelDefault({
      workspaceId: 'video',
      dialogId: 'video-help',
      defaultFloatingRect: { x: 160, y: 92, width: 760, height: 600 },
      minSize: { width: 420, height: 320 },
    });
    const key = panelKey('video', 'video-help');

    useDockablePanelStore.getState().registerPanelDefaults([defaultPanel]);
    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({ mode: 'floating', dockZone: 'overlay' });

    useDockablePanelStore.getState().hidePanel('video', 'video-help');
    expect(useDockablePanelStore.getState().layouts[key].mode).toBe('hidden');

    useDockablePanelStore.getState().floatPanel('video', 'video-help', { x: 320, y: 220 }, { width: 1280, height: 720 });
    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({
      mode: 'floating',
      floatingRect: { x: 320, y: 220, width: 760, height: 600 },
    });

    useDockablePanelStore.getState().dockPanel('video', 'video-help', 'right');
    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({ mode: 'docked', dockZone: 'right' });

    useDockablePanelStore.getState().collapsePanel('video', 'video-help');
    expect(useDockablePanelStore.getState().layouts[key].mode).toBe('collapsed');

    useDockablePanelStore.getState().resetPanelLayout('video', 'video-help');
    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({
      mode: 'floating',
      dockZone: 'overlay',
      floatingRect: { x: 160, y: 92, width: 760, height: 600 },
    });
  });
});
