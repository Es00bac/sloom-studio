import { describe, expect, it } from 'vitest';
import { createDefaultDockablePanelLayout, panelKey } from '../../lib/dockablePanel';
import {
  IMAGE_DOCKABLE_PANEL_DEFINITIONS,
  IMAGE_DOCKABLE_PANEL_IDS,
  IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS,
  IMAGE_LAYOUT_PRESETS,
  IMAGE_DOCKABLE_WORKSPACE_ID,
  createImageDockablePanelDefinitions,
  getImageDockedPanelColumnContract,
  getImageDockablePanelDefinition,
  getImageDockablePanelTabGroup,
  getImageLayoutPreset,
  getImageLayoutPresetIdForLayout,
  resolveImagePanelsForWorkspaceChrome,
} from './ImageDockablePanels';

describe('ImageDockablePanels', () => {
  it('defines the expected Image workspace dockable panels', () => {
    expect(IMAGE_DOCKABLE_PANEL_DEFINITIONS.map((panel) => panel.panelId)).toEqual([
      IMAGE_DOCKABLE_PANEL_IDS.tools,
      IMAGE_DOCKABLE_PANEL_IDS.layers,
      IMAGE_DOCKABLE_PANEL_IDS.properties,
      IMAGE_DOCKABLE_PANEL_IDS.brushes,
      IMAGE_DOCKABLE_PANEL_IDS.channels,
      IMAGE_DOCKABLE_PANEL_IDS.paths,
      IMAGE_DOCKABLE_PANEL_IDS.history,
      IMAGE_DOCKABLE_PANEL_IDS.assets,
      IMAGE_DOCKABLE_PANEL_IDS.tiltmarkStudio,
      IMAGE_DOCKABLE_PANEL_IDS.tiltmarkPalette,
    ]);
    expect(IMAGE_DOCKABLE_PANEL_DEFINITIONS.every((panel) => panel.workspaceId === IMAGE_DOCKABLE_WORKSPACE_ID)).toBe(true);
  });

  it('keeps the Image tools panel floating-only while preserving the other default layout zones', () => {
    const layouts = Object.fromEntries(
      IMAGE_DOCKABLE_PANEL_DEFINITIONS.map((panel, index) => [
        panelKey(panel.workspaceId, panel.panelId),
        createDefaultDockablePanelLayout(panel, index),
      ]),
    );

    expect(layouts[panelKey('image', 'tools')]).toMatchObject({
      mode: 'floating',
      floatingRect: { x: 368, y: 112, width: 66, height: 393 },
      minSize: { width: 66, height: 393 },
    });
    expect(layouts[panelKey('image', 'layers')]).toMatchObject({ mode: 'docked', dockZone: 'right' });
    expect(layouts[panelKey('image', 'properties')]).toMatchObject({ mode: 'docked', dockZone: 'right' });
    expect(layouts[panelKey('image', 'channels')]).toMatchObject({ mode: 'docked', dockZone: 'right' });
    expect(layouts[panelKey('image', 'paths')]).toMatchObject({ mode: 'docked', dockZone: 'right' });
    expect(layouts[panelKey('image', 'history')]).toMatchObject({ mode: 'docked', dockZone: 'right' });
    expect(layouts[panelKey('image', 'assets')]).toMatchObject({ mode: 'docked', dockZone: 'bottom' });
  });

  it('limits panel dock-back zones to sensible Image workspace surfaces', () => {
    expect(getImageDockablePanelDefinition('tools')?.allowedDockZones).toEqual([]);
    expect(getImageDockablePanelDefinition('layers')?.allowedDockZones).toContain('right');
    expect(getImageDockablePanelDefinition('properties')?.allowedDockZones).toContain('right');
    expect(getImageDockablePanelDefinition('channels')?.allowedDockZones).toContain('right');
    expect(getImageDockablePanelDefinition('paths')?.allowedDockZones).toContain('right');
    expect(getImageDockablePanelDefinition('history')?.allowedDockZones).toContain('right');
    expect(getImageDockablePanelDefinition('assets')?.allowedDockZones).toEqual(['bottom', 'top']);
  });

  it('registers one consolidated Tiltmark studio panel, hidden until the engine is active', () => {
    const studio = getImageDockablePanelDefinition('tiltmark-studio');

    expect(studio).toMatchObject({
      title: 'Tiltmark',
      mode: 'hidden',
      dockZone: 'right',
      allowedDockZones: ['right', 'left', 'bottom'],
    });
    // Standard dockable chrome: dockable, closable, minimizable — not fixed overlay chrome.
    expect(studio?.chrome).toBeUndefined();
    expect(studio?.fixedSize).toBeUndefined();
    expect(IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS).toContain('tiltmark-studio');
    expect(getImageLayoutPreset('painting')?.panelModes['tiltmark-studio']).toBe('docked');
    expect(getImageLayoutPreset('quick-edit')?.panelModes['tiltmark-studio']).toBe('hidden');
  });

  it('uses compact fixed chrome for the undockable Image tools palette', () => {
    const tools = getImageDockablePanelDefinition('tools');

    expect(tools?.chrome).toBe('compact-floating');
    expect(tools?.fixedSize).toBe(true);
    expect(tools?.bodyClassName).toBe('min-h-0 overflow-hidden p-0');
  });

  it('keeps the floating Image tools palette visible when mobile chrome is collapsed or hidden', () => {
    const panels = createImageDockablePanelDefinitions().map((panel) => ({ ...panel, content: null }));

    expect(resolveImagePanelsForWorkspaceChrome(panels, true).map((panel) => panel.panelId)).toEqual([
      'tools',
      'layers',
      'properties',
      'brushes',
      'channels',
      'paths',
      'history',
      'assets',
      'tiltmark-studio',
      'tiltmark-palette',
    ]);
    expect(resolveImagePanelsForWorkspaceChrome(panels, false).map((panel) => panel.panelId)).toEqual(['tools']);
  });

  it('lets the Properties panel own one scroll surface when floating or stretched', () => {
    const properties = getImageDockablePanelDefinition('properties');

    expect(properties?.bodyClassName).toBe('min-h-0 overflow-hidden p-0');
  });

  it('exposes a shared-scroll docked column contract for the Image side inspector stack', () => {
    expect(getImageDockedPanelColumnContract()).toMatchObject({
      dockZone: 'right',
      equalWidth: true,
      itemScrollMode: 'content-only',
      orderPersistence: 'zOrder',
      scrollMode: 'shared-column',
      panelIds: IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS,
    });
  });

  it('uses persisted dock z-order metadata when deriving shared-column panel order', () => {
    expect(
      getImageDockedPanelColumnContract({
        history: { mode: 'docked', dockZone: 'right', zOrder: 0 },
        layers: { mode: 'docked', dockZone: 'right', zOrder: 1 },
        paths: { mode: 'docked', dockZone: 'right', zOrder: 2 },
        properties: { mode: 'docked', dockZone: 'right', zOrder: 3 },
        channels: { mode: 'docked', dockZone: 'right', zOrder: 4 },
      }).panelIds,
    ).toEqual(['history', 'layers', 'brushes', 'paths', 'properties', 'channels', 'tiltmark-studio']);
  });

  it('resolves shared-column side-docked panels without per-panel width or scroll traps', () => {
    const resolvedPanels = createImageDockablePanelDefinitions({
      layoutByPanelId: Object.fromEntries(
        IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS.map((panelId, index) => [
          panelId,
          { mode: 'docked', dockZone: 'right', zOrder: index },
        ]),
      ),
    }).filter((panel) => IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS.includes(panel.panelId as (typeof IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS)[number]));

    expect(resolvedPanels.map((panel) => panel.panelId)).toEqual(IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS);
    expect(resolvedPanels.every((panel) => panel.className === 'w-full')).toBe(true);
    expect(resolvedPanels.every((panel) => panel.bodyClassName === 'min-h-0 overflow-visible p-0')).toBe(true);
    expect(resolvedPanels.some((panel) => panel.className?.includes('w-72'))).toBe(false);
    expect(resolvedPanels.some((panel) => panel.bodyClassName?.includes('overflow-auto'))).toBe(false);
    expect(resolvedPanels.some((panel) => panel.bodyClassName?.includes('overflow-hidden'))).toBe(false);
  });

  it('can derive opt-in Photoshop-style tab group defaults for Layers, Channels, and Paths', () => {
    const baseDefinitions = createImageDockablePanelDefinitions();
    const tabbedDefinitions = createImageDockablePanelDefinitions({
      enableTabbedPanelGroups: true,
    });
    const layerTabs = tabbedDefinitions.filter((panel) => panel.tabGroupId === 'image-layer-channel-path-tabs');

    expect(baseDefinitions.find((panel) => panel.panelId === 'layers')?.tabGroupId).toBeUndefined();
    expect(layerTabs.map((panel) => panel.panelId)).toEqual(['layers', 'channels', 'paths']);
    expect(layerTabs.map((panel) => panel.tabGroupOrder)).toEqual([0, 1, 2]);
    expect(layerTabs.map((panel) => panel.tabGroupActive)).toEqual([true, false, false]);
    expect(getImageDockablePanelTabGroup('channels')).toMatchObject({
      id: 'image-layer-channel-path-tabs',
      activePanelId: 'layers',
      panelIds: ['layers', 'channels', 'paths'],
    });
  });

  it('defines the six goal-level Image layout presets with concrete panel visibility', () => {
    expect(IMAGE_LAYOUT_PRESETS.map((preset) => preset.id)).toEqual([
      'quick-edit',
      'full-suite',
      'retouching',
      'painting',
      'typography',
      'print-prep',
    ]);

    expect(getImageLayoutPreset('quick-edit')).toMatchObject({
      label: 'Quick Edit',
      layout: { toolbarVisible: true, rightPanelVisible: false, assetBarVisible: false },
      panelModes: {
        tools: 'floating',
        layers: 'hidden',
        properties: 'hidden',
        channels: 'hidden',
        paths: 'hidden',
        history: 'hidden',
        assets: 'hidden',
      },
    });
    expect(getImageLayoutPreset('full-suite')).toMatchObject({
      layout: { toolbarVisible: true, rightPanelVisible: true, assetBarVisible: true },
      panelModes: {
        tools: 'floating',
        layers: 'docked',
        properties: 'docked',
        channels: 'docked',
        paths: 'docked',
        history: 'docked',
        assets: 'docked',
      },
    });
    expect(getImageLayoutPreset('print-prep')?.layout.assetBarVisible).toBe(true);
    expect(getImageLayoutPreset('painting')?.panelModes.properties).toBe('docked');
    expect(getImageLayoutPreset('painting')?.panelModes.channels).toBe('docked');
    expect(getImageLayoutPreset('painting')?.panelModes.paths).toBe('docked');
    expect(getImageLayoutPreset('painting')?.panelModes.history).toBe('docked');
  });

  it('derives the matching preset from persisted Image layout visibility', () => {
    expect(getImageLayoutPresetIdForLayout({ toolbarVisible: true, rightPanelVisible: false, assetBarVisible: false })).toBe(
      'quick-edit',
    );
    expect(getImageLayoutPresetIdForLayout({ toolbarVisible: true, rightPanelVisible: true, assetBarVisible: true })).toBe(
      'full-suite',
    );
    expect(getImageLayoutPresetIdForLayout({ toolbarVisible: false, rightPanelVisible: true, assetBarVisible: false })).toBe(
      'custom',
    );
  });
});

describe('brushes panel registration', () => {
  it('registers a brushes panel definition', () => {
    expect(IMAGE_DOCKABLE_PANEL_IDS.brushes).toBe('brushes');
    expect(IMAGE_DOCKABLE_PANEL_DEFINITIONS.some((panel) => panel.panelId === 'brushes')).toBe(true);
    expect(IMAGE_DOCKED_PANEL_COLUMN_PANEL_IDS).toContain('brushes');
  });

  it('shows the brushes panel docked in the painting layout preset and hidden in quick-edit', () => {
    const painting = IMAGE_LAYOUT_PRESETS.find((preset) => preset.id === 'painting');
    expect(painting?.panelModes.brushes).toBe('docked');
    const quickEdit = IMAGE_LAYOUT_PRESETS.find((preset) => preset.id === 'quick-edit');
    expect(quickEdit?.panelModes.brushes).toBe('hidden');
  });
});
