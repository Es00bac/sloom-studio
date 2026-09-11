import { beforeEach, describe, expect, it } from 'vitest';
import { panelKey } from '../../lib/dockablePanel';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import {
  createPaperDockablePanelDefaults,
  getPaperDockableCanvasOffsetClassName,
  PAPER_DOCKABLE_PANEL_IDS,
  PAPER_DOCKABLE_WORKSPACE_ID,
} from './paperDockablePanels';

describe('paperDockablePanels', () => {
  beforeEach(() => {
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
  });

  it('defines movable Paper panels as dockable defaults while the document bar and tools stay pinned outside docking', () => {
    const defaults = createPaperDockablePanelDefaults();

    expect(defaults.map((panel) => panel.panelId)).toEqual([
      PAPER_DOCKABLE_PANEL_IDS.inspector,
      PAPER_DOCKABLE_PANEL_IDS.pages,
      PAPER_DOCKABLE_PANEL_IDS.layers,
      PAPER_DOCKABLE_PANEL_IDS.storyEditor,
      PAPER_DOCKABLE_PANEL_IDS.writingAssistant,
      PAPER_DOCKABLE_PANEL_IDS.assistedLayout,
      PAPER_DOCKABLE_PANEL_IDS.liveLayoutAgent,
      PAPER_DOCKABLE_PANEL_IDS.shortcutsHelp,
      PAPER_DOCKABLE_PANEL_IDS.preflight,
      PAPER_DOCKABLE_PANEL_IDS.linkedAssets,
      PAPER_DOCKABLE_PANEL_IDS.reviewComments,
      PAPER_DOCKABLE_PANEL_IDS.dtpParity,
      PAPER_DOCKABLE_PANEL_IDS.findChange,
      PAPER_DOCKABLE_PANEL_IDS.tiltmarkMaterial,
      PAPER_DOCKABLE_PANEL_IDS.tiltmarkPalette,
      PAPER_DOCKABLE_PANEL_IDS.tiltmarkCare,
      PAPER_DOCKABLE_PANEL_IDS.tiltmarkSupply,
    ]);
    expect(defaults.some((panel) => panel.panelId === PAPER_DOCKABLE_PANEL_IDS.documentStrip)).toBe(false);
    expect(defaults.some((panel) => panel.panelId === PAPER_DOCKABLE_PANEL_IDS.tools)).toBe(false);
    expect(defaults).toEqual(expect.arrayContaining([
      expect.objectContaining({ panelId: PAPER_DOCKABLE_PANEL_IDS.inspector, dockZone: 'right' }),
      expect.objectContaining({ panelId: PAPER_DOCKABLE_PANEL_IDS.preflight, dockZone: 'right' }),
      expect.objectContaining({ panelId: PAPER_DOCKABLE_PANEL_IDS.linkedAssets, dockZone: 'right' }),
      expect.objectContaining({ panelId: PAPER_DOCKABLE_PANEL_IDS.dtpParity, dockZone: 'right' }),
    ]));
  });

  it('keeps Paper tools out of the dock store so stale layouts cannot make it dockable or resizable', () => {
    expect(createPaperDockablePanelDefaults().map((panel) => panel.panelId))
      .not.toContain(PAPER_DOCKABLE_PANEL_IDS.tools);
  });

  it('keeps the default right dock narrow enough for a usable document canvas', () => {
    const defaults = createPaperDockablePanelDefaults();
    const rightPanels = defaults.filter((panel) => panel.dockZone === 'right');

    expect(rightPanels.length).toBeGreaterThan(0);
    for (const panel of rightPanels) {
      expect(panel.floatingRect?.width).toBeLessThanOrEqual(380);
      expect(panel.minSize?.width).toBeLessThanOrEqual(280);
    }
  });

  it('starts secondary right-side Paper panels hidden so the inspector does not consume the canvas', () => {
    const defaults = createPaperDockablePanelDefaults();
    const byId = new Map(defaults.map((panel) => [panel.panelId, panel]));

    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.inspector)?.mode ?? 'docked').toBe('docked');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.pages)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.layers)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.storyEditor)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.writingAssistant)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.assistedLayout)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.shortcutsHelp)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.preflight)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.linkedAssets)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.reviewComments)?.mode).toBe('hidden');
    expect(byId.get(PAPER_DOCKABLE_PANEL_IDS.dtpParity)?.mode).toBe('hidden');
  });

  it('offsets the canvas only when the shared dockable Source Bin owns the left edge', () => {
    expect(getPaperDockableCanvasOffsetClassName()).toBe('ml-0');
    expect(getPaperDockableCanvasOffsetClassName({ dockZone: 'left', mode: 'docked' })).toBe('ml-[22rem]');
    expect(getPaperDockableCanvasOffsetClassName({ dockZone: 'left', mode: 'collapsed' })).toBe('ml-0');
    expect(getPaperDockableCanvasOffsetClassName({ dockZone: 'left', mode: 'floating' })).toBe('ml-0');
    expect(getPaperDockableCanvasOffsetClassName({ dockZone: 'right', mode: 'docked' })).toBe('ml-0');
    expect(getPaperDockableCanvasOffsetClassName({ dockZone: 'left', mode: 'hidden' })).toBe('ml-0');
  });

  it('lets every Paper panel float, move, resize, collapse, hide, dock, and reset through the dock store', () => {
    const defaults = createPaperDockablePanelDefaults();
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);

    for (const definition of defaults) {
      const key = panelKey(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId);
      store.floatPanel(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId, { x: 180, y: 140, width: 420, height: 360 }, { width: 1280, height: 900 });
      expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({ mode: 'floating' });

      store.moveFloatingPanel(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId, 24, 16, { width: 1280, height: 900 });
      store.resizeFloatingPanel(
        PAPER_DOCKABLE_WORKSPACE_ID,
        definition.panelId,
        { edgeX: 1, edgeY: 1, deltaX: 32, deltaY: 28 },
        { width: 1280, height: 900 },
      );
      expect(useDockablePanelStore.getState().layouts[key].floatingRect.width).toBeGreaterThanOrEqual(definition.minSize?.width ?? 220);

      store.collapsePanel(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId);
      expect(useDockablePanelStore.getState().layouts[key].mode).toBe('collapsed');

      store.hidePanel(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId);
      expect(useDockablePanelStore.getState().layouts[key].mode).toBe('hidden');

      store.dockPanel(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId, 'overlay');
      expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({ mode: 'docked', dockZone: 'overlay' });

      store.resetPanelLayout(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId);
      expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({
        mode: definition.mode ?? 'docked',
        dockZone: definition.dockZone,
        floatingRect: definition.floatingRect,
      });
    }
  });

  it('resets the whole Paper dockable workspace back to defaults', () => {
    const defaults = createPaperDockablePanelDefaults();
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);

    for (const definition of defaults) {
      store.hidePanel(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId);
    }

    store.resetWorkspacePanels(PAPER_DOCKABLE_WORKSPACE_ID);

    for (const definition of defaults) {
      expect(useDockablePanelStore.getState().layouts[panelKey(PAPER_DOCKABLE_WORKSPACE_ID, definition.panelId)]).toMatchObject({
        mode: definition.mode ?? 'docked',
        dockZone: definition.dockZone,
      });
    }
  });
});
