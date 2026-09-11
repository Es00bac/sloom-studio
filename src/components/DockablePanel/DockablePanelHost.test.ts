// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDockablePanelLayout, panelKey, type DockablePanelDefault, type DockablePanelLayout } from '../../lib/dockablePanel';
import {
  resolveActiveDockZoneLayout,
  shouldSplitDockZoneEntries,
  shouldSplitDockZoneLayouts,
} from '../../lib/dockablePanelStack';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { DockablePanelHost, prepareDockablePanelRenderLayout, type DockablePanelDefinition } from './DockablePanelHost';

function layout(panelId: string, zOrder: number): DockablePanelLayout {
  return {
    workspaceId: 'video',
    panelId,
    mode: 'docked',
    dockZone: 'center',
    floatingRect: { x: 0, y: 0, width: 400, height: 300 },
    minSize: { width: 220, height: 160 },
    zOrder,
  };
}

describe('DockablePanelHost active center panels', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture | undefined;
  let originalReleasePointerCapture: typeof HTMLElement.prototype.releasePointerCapture | undefined;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalSetPointerCapture) {
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).setPointerCapture;
    }
    if (originalReleasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).releasePointerCapture;
    }
  });

  it('keeps the Program Monitor active by default when Source Monitor shares the center stack', () => {
    const source = layout('source-monitor', 1);
    const program = layout('program-monitor', 2);

    expect(resolveActiveDockZoneLayout([source, program], null)?.panelId).toBe('program-monitor');
    expect(resolveActiveDockZoneLayout([source, program], 'source-monitor')?.panelId).toBe('source-monitor');
  });

  it('chooses split presentation for center panels that are all marked as split-capable', () => {
    expect(shouldSplitDockZoneLayouts(
      'center',
      [layout('source-monitor', 1), layout('program-monitor', 2)],
      (panelId) => panelId === 'source-monitor' || panelId === 'program-monitor',
    )).toBe(true);

    expect(shouldSplitDockZoneLayouts(
      'center',
      [layout('source-monitor', 1), layout('project-source-bin', 2)],
      (panelId) => panelId === 'source-monitor',
    )).toBe(false);
  });

  it('keeps the center split when a tab group holds a split-capable monitor (Inspector tabbed onto Source Monitor)', () => {
    // Regression: dropping the Inspector onto the Source Monitor forms a tab group. The center must
    // stay split (group | Program Monitor) — previously it degraded to a one-visible-entry tab
    // strip and the other monitor silently vanished from the layout.
    const isMonitor = (panelId: string) => panelId === 'source-monitor' || panelId === 'program-monitor';

    expect(shouldSplitDockZoneEntries(
      'center',
      [
        { memberPanelIds: ['source-monitor', 'inspector'] },
        { memberPanelIds: ['program-monitor'] },
      ],
      isMonitor,
    )).toBe(true);

    // A group with NO split-capable member still tabs the center.
    expect(shouldSplitDockZoneEntries(
      'center',
      [
        { memberPanelIds: ['inspector', 'project-source-bin'] },
        { memberPanelIds: ['program-monitor'] },
      ],
      isMonitor,
    )).toBe(false);

    // A single entry (everything tabbed together) renders as one tabbed panel, not a split.
    expect(shouldSplitDockZoneEntries(
      'center',
      [{ memberPanelIds: ['source-monitor', 'program-monitor', 'inspector'] }],
      isMonitor,
    )).toBe(false);
  });

  it('does not clamp floating render geometry before native external panels can use desktop coordinates', () => {
    const floatingLayout: DockablePanelLayout = {
      workspaceId: 'image',
      panelId: 'tools',
      mode: 'floating',
      dockZone: 'left',
      floatingRect: { x: -1800, y: 140, width: 1600, height: 1200 },
      minSize: { width: 66, height: 456 },
      zOrder: 8,
    };

    expect(
      prepareDockablePanelRenderLayout(
        floatingLayout,
        {
          fixedSize: false,
        },
        { width: 1280, height: 720 },
      ).floatingRect,
    ).toEqual({ x: -1800, y: 140, width: 1600, height: 1200 });

    expect(
      prepareDockablePanelRenderLayout(
        floatingLayout,
        {
          floatingRect: { width: 66, height: 456 },
          minSize: { width: 66, height: 456 },
          fixedSize: true,
        },
        { width: 1280, height: 720 },
      ).floatingRect,
    ).toEqual({ x: -1800, y: 140, width: 66, height: 456 });
  });

  it('makes stacked side-docked panels vertically scrollable so lower Image panels remain reachable at 1080p', () => {
    const panels: DockablePanelDefinition[] = [
      createTestDockedPanelDefinition('layers', 220),
      createTestDockedPanelDefinition('properties', 180),
      createTestDockedPanelDefinition('channels', 220),
      createTestDockedPanelDefinition('history', 220),
      createTestDockedPanelDefinition('paths', 220),
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults });

    act(() => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
    });

    const stack = container.querySelector<HTMLElement>('[data-dock-zone-stack="right"]');
    expect(stack).not.toBeNull();
    expect(stack!.className).toContain('overflow-y-auto');
    expect(stack!.className).toContain('flex-col');
  });

  it('renders side-docked stacks as height-filling, same-width panels that scroll their own bodies', () => {
    const panels: DockablePanelDefinition[] = [
      createTestDockedPanelDefinition('paths', 220, 280),
      createTestDockedPanelDefinition('history', 260, 320),
      createTestDockedPanelDefinition('layers', 300, 360),
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults });

    act(() => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
    });

    const stack = container.querySelector<HTMLElement>('[data-dock-zone-stack="right"]');
    const stackItems = Array.from(container.querySelectorAll<HTMLElement>('[data-dock-zone-stack-panel="right"]'));
    const dockedPanels = Array.from(container.querySelectorAll<HTMLElement>('[data-dockable-panel-mode="docked"]'));

    expect(stack).not.toBeNull();
    // The column keeps an overflow-y fallback for when the stacked minimums don't fit.
    expect(stack!.className).toContain('overflow-y-auto');
    expect(stackItems).toHaveLength(3);
    expect(stackItems.every((item) => item.className.includes('shrink-0'))).toBe(true);
    // Panels are the same width and fill the height they're allotted, so each
    // body scrolls within that height rather than the whole column scrolling.
    expect(new Set(dockedPanels.map((panel) => panel.style.width))).toEqual(new Set(['360px']));
    expect(dockedPanels.every((panel) => panel.className.includes('h-full'))).toBe(true);
    expect(new Set(dockedPanels.map((panel) => panel.style.minHeight))).toEqual(new Set(['112px']));
    const bodies = Array.from(container.querySelectorAll<HTMLElement>('[data-dockable-panel-body]'));
    expect(bodies.every((body) => /overflow-(y-)?auto/.test(body.className))).toBe(true);
  });

  it('scrolls each side-docked panel body within its column height and keeps a usable minimum height', () => {
    const panels: DockablePanelDefinition[] = [
      createTestDockedPanelDefinition('layers', 300, 320),
      createTestDockedPanelDefinition('history', 260, 320),
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults });

    act(() => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
    });

    const panelBodies = Array.from(container.querySelectorAll<HTMLElement>('[data-dockable-panel-body]'));

    expect(panelBodies).toHaveLength(2);
    // Each side-docked body scrolls its own content within the column height
    // (so resizing a stacked panel grows/shrinks its content), instead of the
    // whole content expanding.
    expect(panelBodies.every((body) => /overflow-(y-)?auto/.test(body.className))).toBe(true);
    expect(panelBodies.some((body) => body.className.includes('overflow-visible'))).toBe(false);
    // The body fills the panel height so resizing changes what's visible.
    expect(panelBodies.every((body) => body.className.includes('flex-1'))).toBe(true);

    // Stacked panels keep a usable minimum height.
    const stackPanels = Array.from(container.querySelectorAll<HTMLElement>('[data-dock-zone-stack-panel]'));
    expect(stackPanels.length).toBeGreaterThan(0);
    expect(stackPanels.every((panel) => Number.parseFloat(panel.style.minHeight) >= 100)).toBe(true);
  });

  it('resizes the two side-stack panels adjacent to a dragged vertical divider', () => {
    const panels: DockablePanelDefinition[] = [
      {
        ...createTestDockedPanelDefinition('layers', 160, 320),
        floatingRect: { x: 0, y: 0, width: 320, height: 300 },
      },
      {
        ...createTestDockedPanelDefinition('history', 160, 320),
        floatingRect: { x: 0, y: 300, width: 320, height: 300 },
      },
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        return [key, createDefaultDockablePanelLayout(panel, index)];
      }),
    ) as Record<string, DockablePanelLayout>;
    useDockablePanelStore.setState({ defaults, layouts: defaults });

    act(() => {
      root.render(
        createElement(DockablePanelHost, { workspaceId: 'image', panels }, createElement('div', null, 'Canvas')),
      );
    });

    const divider = container.querySelector<HTMLElement>('[aria-label="Vertical resize divider"]');
    expect(divider).not.toBeNull();
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientY: 300 });
    Object.defineProperty(pointerDown, 'pointerId', { value: 21 });
    const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientY: 360 });
    Object.defineProperty(pointerMove, 'pointerId', { value: 21 });

    act(() => {
      divider?.dispatchEvent(pointerDown);
      divider?.dispatchEvent(pointerMove);
    });

    const layouts = useDockablePanelStore.getState().layouts;
    expect(layouts[panelKey('image', 'layers')].floatingRect.height).toBe(360);
    expect(layouts[panelKey('image', 'history')].floatingRect.height).toBe(240);
    expect(
      layouts[panelKey('image', 'layers')].floatingRect.height
      + layouts[panelKey('image', 'history')].floatingRect.height,
    ).toBe(600);
  });

  it('renders side-docked panels in separate columns by dockColumn and collapses a column to a rail', () => {
    const panels: DockablePanelDefinition[] = [
      createTestDockedPanelDefinition('layers', 300, 320),
      { ...createTestDockedPanelDefinition('history', 260, 320), dockColumn: 1 },
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const built = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            dockColumn: panel.dockColumn,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, built];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults, collapsedDockColumns: {} });

    act(() => {
      root.render(
        createElement(DockablePanelHost, { workspaceId: 'image', panels }, createElement('div', null, 'Canvas')),
      );
    });

    // Two columns, each with a collapse handle.
    expect(Array.from(container.querySelectorAll('[data-dock-zone-column]'))).toHaveLength(2);
    expect(container.querySelectorAll('[data-dock-zone-column-collapse]')).toHaveLength(2);
    expect(container.querySelector('[data-dockable-panel-body="history"]')).not.toBeNull();

    // Collapsing column 1 turns it into a rail (and removes its expanded body).
    act(() => {
      useDockablePanelStore.getState().toggleDockColumnCollapsed('image', 'right', 1);
    });
    expect(container.querySelector('[data-dock-zone-column-rail="1"]')).not.toBeNull();
    expect(container.querySelector('[data-dock-zone-column="1"]')).toBeNull();
    expect(container.querySelector('[data-dockable-panel-body="history"]')).toBeNull();
    // The other column stays expanded.
    expect(container.querySelector('[data-dock-zone-column="0"]')).not.toBeNull();

    // Expanding it again restores the column.
    act(() => {
      useDockablePanelStore.getState().toggleDockColumnCollapsed('image', 'right', 1);
    });
    expect(container.querySelector('[data-dock-zone-column="1"]')).not.toBeNull();
    expect(container.querySelector('[data-dockable-panel-body="history"]')).not.toBeNull();
  });

  it('renders grouped side panels as one dock slot with tabs and only the active tab body', () => {
    const panels: DockablePanelDefinition[] = [
      createTestDockedPanelDefinition('layers', 220, 320),
      createTestDockedPanelDefinition('properties', 220, 320),
      createTestDockedPanelDefinition('history', 220, 320),
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;
    const layouts = { ...defaults };
    layouts[panelKey('image', 'layers')] = {
      ...layouts[panelKey('image', 'layers')],
      tabGroupId: 'image-right-stack-a',
      tabGroupOrder: 0,
      tabGroupActive: true,
    };
    layouts[panelKey('image', 'properties')] = {
      ...layouts[panelKey('image', 'properties')],
      tabGroupId: 'image-right-stack-a',
      tabGroupOrder: 1,
      tabGroupActive: false,
    };

    useDockablePanelStore.setState({ defaults, layouts });

    act(() => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
    });

    const stackItems = Array.from(container.querySelectorAll<HTMLElement>('[data-dock-zone-stack-panel="right"]'));
    const tabList = container.querySelector<HTMLElement>('[data-dockable-tab-list="image-right-stack-a"]');
    const activeBody = container.querySelector<HTMLElement>('[data-dockable-tab-panel="layers"]');

    expect(stackItems).toHaveLength(2);
    expect(tabList).not.toBeNull();
    expect(Array.from(tabList!.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual(['layers', 'properties']);
    expect(activeBody?.textContent).toBe('layers');
    expect(container.querySelector('[data-dockable-tab-panel="properties"]')).toBeNull();

    act(() => {
      tabList!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    });

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].tabGroupActive).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-dockable-tab-panel="properties"]')?.textContent).toBe('properties');
  });

  it('opens a tab context menu with reorder, ungroup, float, and reset actions', () => {
    const panels: DockablePanelDefinition[] = [
      {
        ...createTestDockedPanelDefinition('layers', 220),
        tabGroupId: 'image-right-stack-a',
        tabGroupOrder: 0,
        tabGroupActive: true,
      },
      {
        ...createTestDockedPanelDefinition('properties', 180),
        tabGroupId: 'image-right-stack-a',
        tabGroupOrder: 1,
        tabGroupActive: false,
      },
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
            tabGroupId: 'image-right-stack-a',
            tabGroupOrder: index,
            tabGroupActive: index === 0,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults });

    act(() => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
    });

    const propertiesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent === 'properties');
    expect(propertiesTab).toBeTruthy();

    act(() => {
      propertiesTab!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 128,
        clientY: 96,
      }));
    });

    const menu = container.querySelector<HTMLElement>('[data-dockable-tab-context-menu="true"]');
    expect(menu).not.toBeNull();
    expect(menu?.style.left).toBe('128px');
    expect(menu?.style.top).toBe('96px');
    expect(Array.from(menu!.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Activate Tab',
      'Move Tab Left',
      'Move Tab Right',
      'Ungroup Tab',
      'Float Tab',
      'Reset Panel',
    ]);

    act(() => {
      menu!.querySelector<HTMLButtonElement>('[data-dockable-tab-menu-action="ungroup"]')?.click();
    });

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].tabGroupId).toBeUndefined();
    expect(container.querySelector('[data-dockable-tab-context-menu="true"]')).toBeNull();
  });

  it('registers tab group metadata from panel definitions before rendering docked defaults', () => {
    const panels: DockablePanelDefinition[] = [
      {
        ...createTestDockedPanelDefinition('layers', 220, 320),
        tabGroupId: 'image-layer-tabs',
        tabGroupOrder: 0,
        tabGroupActive: true,
      },
      {
        ...createTestDockedPanelDefinition('channels', 220, 320),
        tabGroupId: 'image-layer-tabs',
        tabGroupOrder: 1,
        tabGroupActive: false,
      },
      createTestDockedPanelDefinition('history', 220, 320),
    ];

    act(() => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
    });

    const stackItems = Array.from(container.querySelectorAll<HTMLElement>('[data-dock-zone-stack-panel="right"]'));
    const tabList = container.querySelector<HTMLElement>('[data-dockable-tab-list="image-layer-tabs"]');

    expect(stackItems).toHaveLength(2);
    expect(tabList).not.toBeNull();
    expect(Array.from(tabList!.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual(['layers', 'channels']);
    expect(container.querySelector<HTMLElement>('[data-dockable-tab-panel="layers"]')?.textContent).toBe('layers');
    expect(container.querySelector('[data-dockable-tab-panel="channels"]')).toBeNull();
  });

  it('preserves the active floating Image tab group rect instead of ballooning to a larger sibling tab', async () => {
    window.signalLoomNative = {} as never;
    const popupDocument = document.implementation.createHTMLDocument('Layers');
    const popup = {
      closed: false,
      document: popupDocument,
      screenX: 112,
      screenY: 88,
      innerWidth: 420,
      innerHeight: 520,
      outerWidth: 420,
      outerHeight: 520,
      addEventListener: vi.fn(),
      close: vi.fn(),
      moveTo: vi.fn(),
      removeEventListener: vi.fn(),
      resizeTo: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    const panels: DockablePanelDefinition[] = [
      createTestFloatingPanelDefinition('layers', 'Layers'),
      {
        ...createTestFloatingPanelDefinition('properties', 'Properties'),
        floatingRect: { x: 112, y: 88, width: 640, height: 760 },
        minSize: { width: 300, height: 260 },
      },
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
            tabGroupId: panel.tabGroupId,
            tabGroupOrder: panel.tabGroupOrder,
            tabGroupActive: panel.tabGroupActive,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults });

    await act(async () => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
      await Promise.resolve();
    });

    expect(open).toHaveBeenCalledWith(
      '',
      'signal-loom-image-image-floating-tabs',
      'popup=yes,frame=false,width=420,height=520,left=112,top=88',
    );
    expect(popup.resizeTo).not.toHaveBeenCalled();
  });

  it('keeps a native floating tab group in one stable-size palette while switching active tabs', async () => {
    window.signalLoomNative = {} as never;
    const popupDocument = document.implementation.createHTMLDocument('Layers');
    const popup = {
      closed: false,
      document: popupDocument,
      screenX: 112,
      screenY: 88,
      innerWidth: 420,
      innerHeight: 520,
      outerWidth: 420,
      outerHeight: 520,
      addEventListener: vi.fn(),
      close: vi.fn(),
      moveTo: vi.fn(),
      removeEventListener: vi.fn(),
      resizeTo: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    const panels: DockablePanelDefinition[] = [
      createTestFloatingPanelDefinition('layers', 'Layers'),
      createTestFloatingPanelDefinition('properties', 'Properties'),
    ];
    const defaults = Object.fromEntries(
      panels.map((panel, index) => {
        const key = panelKey(panel.workspaceId, panel.panelId);
        const layout = createDefaultDockablePanelLayout(
          {
            workspaceId: panel.workspaceId,
            panelId: panel.panelId,
            mode: panel.mode,
            dockZone: panel.dockZone,
            floatingRect: panel.floatingRect,
            minSize: panel.minSize,
            tabGroupId: panel.tabGroupId,
            tabGroupOrder: panel.tabGroupOrder,
            tabGroupActive: panel.tabGroupActive,
          } satisfies DockablePanelDefault,
          index,
        );
        return [key, layout];
      }),
    ) as Record<string, DockablePanelLayout>;

    useDockablePanelStore.setState({ defaults, layouts: defaults });

    await act(async () => {
      root.render(
        createElement(
          DockablePanelHost,
          { workspaceId: 'image', panels },
          createElement('div', null, 'Canvas'),
        ),
      );
      await Promise.resolve();
    });

    const initialPanel = popupDocument.querySelector<HTMLElement>('[data-dockable-panel-mode="floating"]');
    const propertiesTab = Array.from(popupDocument.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent === 'Properties');

    expect(open).toHaveBeenCalledWith(
      '',
      'signal-loom-image-image-floating-tabs',
      'popup=yes,frame=false,width=420,height=520,left=112,top=88',
    );
    expect(propertiesTab).not.toBeUndefined();
    const initialWidth = initialPanel?.style.width;
    const initialHeight = initialPanel?.style.height;

    await act(async () => {
      propertiesTab?.click();
      await Promise.resolve();
    });

    const switchedPanel = popupDocument.querySelector<HTMLElement>('[data-dockable-panel-mode="floating"]');

    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();
    expect(switchedPanel?.style.width).toBe(initialWidth);
    expect(switchedPanel?.style.height).toBe(initialHeight);
    expect(popup.resizeTo).not.toHaveBeenCalled();
    expect(popupDocument.querySelector<HTMLElement>('[data-dockable-tab-panel="properties"]')?.textContent).toBe('Properties content');
  });

  it('keeps an ungrouped docked tab adjacent to its former group in tab order', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      createTestDockedPanelDefinition('layers', 220, 300),
      createTestDockedPanelDefinition('properties', 220, 300),
      createTestDockedPanelDefinition('history', 220, 300),
    ]);

    store.groupPanelWithPanel('image', 'history', 'layers');
    store.ungroupPanelTab('image', 'history');

    const rightStackOrder = Object.values(useDockablePanelStore.getState().layouts)
      .filter((entry) => entry.workspaceId === 'image' && entry.dockZone === 'right' && entry.mode === 'docked')
      .sort((left, right) => left.zOrder - right.zOrder || left.panelId.localeCompare(right.panelId))
      .map((entry) => entry.panelId);

    expect(rightStackOrder).toEqual(['layers', 'history', 'properties']);
  });
});

function createTestDockedPanelDefinition(panelId: string, minHeight: number, width = 300): DockablePanelDefinition {
  return {
    workspaceId: 'image',
    panelId,
    title: panelId,
    mode: 'docked',
    dockZone: 'right',
    floatingRect: { x: 0, y: 0, width, height: minHeight },
    minSize: { width: 224, height: minHeight },
    content: createElement('div', null, panelId),
  };
}

function createTestFloatingPanelDefinition(panelId: string, title: string): DockablePanelDefinition {
  return {
    workspaceId: 'image',
    panelId,
    title,
    mode: 'floating',
    dockZone: 'right',
    floatingRect: { x: 112, y: 88, width: 420, height: 520 },
    minSize: { width: 260, height: 180 },
    tabGroupId: 'image-floating-tabs',
    tabGroupOrder: panelId === 'layers' ? 0 : 1,
    tabGroupActive: panelId === 'layers',
    content: createElement('div', null, `${title} content`),
  };
}
