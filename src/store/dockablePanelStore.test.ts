import { beforeEach, describe, expect, it } from 'vitest';
import { panelKey, resolveDockablePanelTabGroups } from '../lib/dockablePanel';
import { useDockablePanelStore } from './dockablePanelStore';

const defaults = [
  {
    workspaceId: 'image',
    panelId: 'layers',
    dockZone: 'right' as const,
    floatingRect: { x: 100, y: 80, width: 300, height: 400 },
    minSize: { width: 240, height: 180 },
  },
  {
    workspaceId: 'image',
    panelId: 'assets',
    dockZone: 'left' as const,
    floatingRect: { x: 220, y: 120, width: 280, height: 300 },
  },
];

describe('dockablePanelStore', () => {
  beforeEach(() => {
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
  });

  it('registers default panel layouts keyed by workspace and panel id', () => {
    useDockablePanelStore.getState().registerPanelDefaults(defaults);

    const layout = useDockablePanelStore.getState().layouts[panelKey('image', 'layers')];
    expect(layout).toMatchObject({
      workspaceId: 'image',
      panelId: 'layers',
      mode: 'docked',
      dockZone: 'right',
      minSize: { width: 240, height: 180 },
    });
  });

  it('does not notify subscribers when registering equivalent defaults again', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    const stateBefore = useDockablePanelStore.getState();
    let updates = 0;
    const unsubscribe = useDockablePanelStore.subscribe(() => {
      updates += 1;
    });

    store.registerPanelDefaults(defaults.map((panel) => ({ ...panel })));
    unsubscribe();

    expect(updates).toBe(0);
    expect(useDockablePanelStore.getState()).toBe(stateBefore);
  });

  it('applies a changed default dock column while preserving a user-selected column', () => {
    const store = useDockablePanelStore.getState();
    const columnZeroDefault = { ...defaults[0], dockColumn: 0 };
    store.registerPanelDefaults([columnZeroDefault]);

    store.registerPanelDefaults([{ ...columnZeroDefault, dockColumn: 1 }]);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].dockColumn).toBe(1);

    store.setPanelDockColumn('image', 'layers', 3);
    store.registerPanelDefaults([{ ...columnZeroDefault, dockColumn: 2 }]);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].dockColumn).toBe(3);
    expect(useDockablePanelStore.getState().defaults[panelKey('image', 'layers')].dockColumn).toBe(2);
  });

  it('does not mutate when repeated host-style registrations only change React content', () => {
    const firstRenderDefaults = defaults.map((panel, index) => ({
      ...panel,
      content: { render: index },
    }));
    const secondRenderDefaults = defaults.map((panel, index) => ({
      ...panel,
      content: { render: index + 10 },
      onClick: () => index,
    }));
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(firstRenderDefaults);
    store.hidePanel('image', 'layers');
    const stateBefore = useDockablePanelStore.getState();
    let updates = 0;
    const unsubscribe = useDockablePanelStore.subscribe(() => {
      updates += 1;
    });

    for (let index = 0; index < 20; index += 1) {
      store.registerPanelDefaults(secondRenderDefaults.map((panel) => ({ ...panel, content: { render: index } })));
    }
    unsubscribe();

    expect(updates).toBe(0);
    expect(useDockablePanelStore.getState()).toBe(stateBefore);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].mode).toBe('hidden');
  });

  it('repairs malformed persisted layouts when defaults are registered', () => {
    const key = panelKey('image', 'layers');
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        [key]: {
          workspaceId: 'wrong',
          panelId: 'wrong',
          mode: 'detached',
          dockZone: 'sideways',
          floatingRect: null,
          minSize: { width: Number.POSITIVE_INFINITY },
          zOrder: Number.NaN,
        } as never,
      },
    });

    useDockablePanelStore.getState().registerPanelDefaults([defaults[0]]);

    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({
      workspaceId: 'image',
      panelId: 'layers',
      mode: 'docked',
      dockZone: 'right',
      floatingRect: { x: 100, y: 80, width: 300, height: 400 },
      minSize: { width: 240, height: 180 },
      zOrder: 0,
    });
  });

  it('preserves off-owner native floating panel geometry when defaults are registered', () => {
    const key = panelKey('image', 'layers');
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        [key]: {
          workspaceId: 'image',
          panelId: 'layers',
          mode: 'floating',
          dockZone: 'right',
          floatingRect: { x: -1800, y: 140, width: 1600, height: 1200 },
          minSize: { width: 240, height: 180 },
          zOrder: 3,
        },
      },
    });

    useDockablePanelStore.getState().registerPanelDefaults([defaults[0]]);

    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({
      workspaceId: 'image',
      panelId: 'layers',
      mode: 'floating',
      dockZone: 'right',
      floatingRect: { x: -1800, y: 140, width: 1600, height: 1200 },
      minSize: { width: 240, height: 180 },
      zOrder: 3,
    });
  });

  it('repairs stale fixed-size palette dimensions and minimums when defaults are registered', () => {
    const key = panelKey('image', 'tools');
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        [key]: {
          workspaceId: 'image',
          panelId: 'tools',
          mode: 'floating',
          dockZone: 'left',
          floatingRect: { x: -1480, y: 180, width: 224, height: 640 },
          floatingRectSpace: 'screen',
          minSize: { width: 224, height: 160 },
          zOrder: 7,
        },
      },
    });

    useDockablePanelStore.getState().registerPanelDefaults([{
      workspaceId: 'image',
      panelId: 'tools',
      mode: 'floating',
      dockZone: 'left',
      floatingRect: { x: 368, y: 112, width: 66, height: 456 },
      minSize: { width: 66, height: 456 },
      fixedSize: true,
    }]);

    expect(useDockablePanelStore.getState().layouts[key]).toMatchObject({
      workspaceId: 'image',
      panelId: 'tools',
      mode: 'floating',
      dockZone: 'left',
      floatingRectSpace: 'screen',
      floatingRect: { x: -1480, y: 180, width: 66, height: 456 },
      minSize: { width: 66, height: 456 },
      zOrder: 7,
    });
  });

  it('migrates untouched layouts when registered defaults change', () => {
    const key = panelKey('video', 'source-monitor');
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([{
      workspaceId: 'video',
      panelId: 'source-monitor',
      mode: 'hidden',
      dockZone: 'center',
      floatingRect: { x: 40, y: 80, width: 420, height: 320 },
      minSize: { width: 320, height: 200 },
    }]);

    expect(useDockablePanelStore.getState().layouts[key].mode).toBe('hidden');

    useDockablePanelStore.getState().registerPanelDefaults([{
      workspaceId: 'video',
      panelId: 'source-monitor',
      mode: 'docked',
      dockZone: 'center',
      floatingRect: { x: 40, y: 80, width: 420, height: 320 },
      minSize: { width: 320, height: 200 },
    }]);

    expect(useDockablePanelStore.getState().layouts[key].mode).toBe('docked');
  });

  it('floats, moves, and resizes panels without clamping position to the owner viewport', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    store.floatPanel('image', 'layers', { x: 760, y: 560 }, { width: 900, height: 700 });
    store.moveFloatingPanel('image', 'layers', 200, 200, { width: 900, height: 700 });
    store.resizeFloatingPanel(
      'image',
      'layers',
      { edgeX: 1, edgeY: 1, deltaX: 900, deltaY: 900 },
      { width: 900, height: 700 },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')]).toMatchObject({
      mode: 'floating',
      floatingRect: { x: 960, y: 760, width: 774, height: 602 },
    });
  });

  it('can persist native external floating panel geometry outside the owner window without shrinking size', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    store.floatPanel(
      'image',
      'layers',
      { x: -1800, y: 140, width: 1600, height: 1200 },
      { width: 1280, height: 720 },
      { constrainSize: false },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')]).toMatchObject({
      mode: 'floating',
      floatingRect: { x: -1800, y: 140, width: 1600, height: 1200 },
    });
  });

  it('can persist native external floating panels in desktop-screen coordinate space', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    store.floatPanel(
      'image',
      'layers',
      { x: -1800, y: 140, width: 1600, height: 1200 },
      { width: 1280, height: 720 },
      { constrainSize: false, floatingRectSpace: 'screen' },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')]).toMatchObject({
      mode: 'floating',
      floatingRectSpace: 'screen',
      floatingRect: { x: -1800, y: 140, width: 1600, height: 1200 },
    });
  });

  it('can resize native external floating panels without owner-viewport size clamping', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    store.floatPanel(
      'image',
      'layers',
      { x: -1800, y: 140, width: 1400, height: 960 },
      { width: 1280, height: 720 },
      { constrainSize: false },
    );
    store.resizeFloatingPanel(
      'image',
      'layers',
      { edgeX: 1, edgeY: 1, deltaX: 220, deltaY: 180 },
      { width: 1280, height: 720 },
      { constrainSize: false },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect).toEqual({
      x: -1800,
      y: 140,
      width: 1620,
      height: 1140,
    });
  });

  it('resizes docked bottom and side panels through controlled layout state', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'video',
        panelId: 'timeline',
        dockZone: 'bottom' as const,
        floatingRect: { x: 40, y: 600, width: 1120, height: 420 },
        minSize: { width: 520, height: 320 },
      },
      {
        workspaceId: 'video',
        panelId: 'project-source-bin',
        dockZone: 'left' as const,
        floatingRect: { x: 16, y: 80, width: 280, height: 720 },
        minSize: { width: 240, height: 260 },
      },
    ]);

    const resizeDockedPanel = (useDockablePanelStore.getState() as {
      resizeDockedPanel?: (
        workspaceId: string,
        panelId: string,
        resize: { edgeX: -1 | 0 | 1; edgeY: -1 | 0 | 1; deltaX: number; deltaY: number },
        viewport: { width: number; height: number },
      ) => void;
    }).resizeDockedPanel;

    expect(resizeDockedPanel).toBeTypeOf('function');
    resizeDockedPanel?.(
      'video',
      'timeline',
      { edgeX: 0, edgeY: -1, deltaX: 0, deltaY: -160 },
      { width: 1600, height: 1000 },
    );
    resizeDockedPanel?.(
      'video',
      'project-source-bin',
      { edgeX: 1, edgeY: 0, deltaX: 180, deltaY: 0 },
      { width: 1600, height: 1000 },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'timeline')].floatingRect.height).toBe(580);
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'project-source-bin')].floatingRect.width).toBe(460);
  });

  it('resizes adjacent center-docked split panels from the divider between them', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'video',
        panelId: 'source-monitor',
        dockZone: 'center' as const,
        floatingRect: { x: 0, y: 0, width: 480, height: 320 },
        minSize: { width: 320, height: 200 },
      },
      {
        workspaceId: 'video',
        panelId: 'program-monitor',
        dockZone: 'center' as const,
        floatingRect: { x: 480, y: 0, width: 480, height: 320 },
        minSize: { width: 420, height: 240 },
      },
    ]);

    store.resizeDockedPanel(
      'video',
      'source-monitor',
      { edgeX: 1, edgeY: 0, deltaX: 60, deltaY: 0 },
      { width: 1600, height: 1000 },
    );

    const source = useDockablePanelStore.getState().layouts[panelKey('video', 'source-monitor')];
    const program = useDockablePanelStore.getState().layouts[panelKey('video', 'program-monitor')];

    expect(source.floatingRect.width).toBe(540);
    expect(program.floatingRect.width).toBe(420);
    expect(source.floatingRect.width + program.floatingRect.width).toBe(960);
  });

  it('resizes adjacent panels in one side stack while preserving their total and minimum heights', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 0, width: 320, height: 300 },
        minSize: { width: 220, height: 180 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 300, width: 320, height: 300 },
        minSize: { width: 220, height: 180 },
      },
      {
        workspaceId: 'image',
        panelId: 'history',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 600, width: 320, height: 240 },
        minSize: { width: 220, height: 180 },
      },
    ]);

    store.resizeAdjacentDockedPanelHeights('image', 'layers', 'properties', 80);

    let layouts = useDockablePanelStore.getState().layouts;
    expect(layouts[panelKey('image', 'layers')].floatingRect.height).toBe(380);
    expect(layouts[panelKey('image', 'properties')].floatingRect.height).toBe(220);
    expect(layouts[panelKey('image', 'history')].floatingRect.height).toBe(240);
    expect(
      layouts[panelKey('image', 'layers')].floatingRect.height
      + layouts[panelKey('image', 'properties')].floatingRect.height,
    ).toBe(600);

    store.resizeAdjacentDockedPanelHeights('image', 'layers', 'properties', 500);

    layouts = useDockablePanelStore.getState().layouts;
    expect(layouts[panelKey('image', 'layers')].floatingRect.height).toBe(420);
    expect(layouts[panelKey('image', 'properties')].floatingRect.height).toBe(180);
    expect(
      layouts[panelKey('image', 'layers')].floatingRect.height
      + layouts[panelKey('image', 'properties')].floatingRect.height,
    ).toBe(600);
  });

  it('resizes every docked panel in the same side column to prevent stacked panel width jumps', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        floatingRect: { x: 0, y: 0, width: 320, height: 420 },
        minSize: { width: 240, height: 180 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 0, y: 430, width: 320, height: 420 },
        minSize: { width: 260, height: 180 },
      },
      {
        workspaceId: 'image',
        panelId: 'tools',
        dockZone: 'left' as const,
        floatingRect: { x: 0, y: 0, width: 280, height: 420 },
      },
    ]);

    store.resizeDockedPanel(
      'image',
      'layers',
      { edgeX: -1, edgeY: 0, deltaX: -80, deltaY: 0 },
      { width: 1600, height: 1000 },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect.width).toBe(400);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].floatingRect.width).toBe(400);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'tools')].floatingRect.width).toBe(280);
  });

  it('keeps side-dock widths independent between columns', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 0, width: 320, height: 420 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 430, width: 320, height: 420 },
      },
      {
        workspaceId: 'image',
        panelId: 'history',
        dockZone: 'right' as const,
        dockColumn: 1,
        floatingRect: { x: 0, y: 0, width: 440, height: 420 },
      },
    ]);

    store.resizeDockedPanel(
      'image',
      'layers',
      { edgeX: -1, edgeY: 0, deltaX: -80, deltaY: 0 },
      { width: 1600, height: 1000 },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect.width).toBe(400);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].floatingRect.width).toBe(400);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'history')].floatingRect.width).toBe(440);
  });

  it('restores a hidden side panel at its column width without changing another column', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 0, width: 320, height: 420 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        mode: 'hidden' as const,
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 0, width: 520, height: 420 },
      },
      {
        workspaceId: 'image',
        panelId: 'history',
        dockZone: 'right' as const,
        dockColumn: 1,
        floatingRect: { x: 0, y: 0, width: 440, height: 420 },
      },
    ]);

    store.setPanelMode('image', 'properties', 'docked');

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].floatingRect.width).toBe(320);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect.width).toBe(320);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'history')].floatingRect.width).toBe(440);
  });

  it('does not change docked side-panel z-order when a docked panel receives pointer focus', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        floatingRect: { x: 0, y: 0, width: 320, height: 420 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 0, y: 430, width: 320, height: 420 },
      },
    ]);

    const before = Object.values(useDockablePanelStore.getState().layouts)
      .filter((layout) => layout.workspaceId === 'image' && layout.dockZone === 'right')
      .sort((a, b) => a.zOrder - b.zOrder)
      .map((layout) => `${layout.panelId}:${layout.zOrder}`);

    store.bringPanelToFront('image', 'layers');

    const after = Object.values(useDockablePanelStore.getState().layouts)
      .filter((layout) => layout.workspaceId === 'image' && layout.dockZone === 'right')
      .sort((a, b) => a.zOrder - b.zOrder)
      .map((layout) => `${layout.panelId}:${layout.zOrder}`);

    expect(after).toEqual(before);
  });

  it('brings floating panels to the front by increasing z-order', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    store.floatPanel('image', 'layers');
    store.floatPanel('image', 'assets');
    const before = useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].zOrder;
    store.bringPanelToFront('image', 'layers');
    const after = useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].zOrder;

    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(useDockablePanelStore.getState().layouts[panelKey('image', 'assets')].zOrder);
  });

  it('groups dockable panels as Adobe-style tabs and switches the active tab', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      ...defaults,
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 100, y: 80, width: 340, height: 360 },
        minSize: { width: 260, height: 200 },
      },
    ]);

    store.groupPanelWithPanel('image', 'properties', 'layers');

    const layers = useDockablePanelStore.getState().layouts[panelKey('image', 'layers')];
    const properties = useDockablePanelStore.getState().layouts[panelKey('image', 'properties')];

    expect(layers.tabGroupId).toBeTruthy();
    expect(properties.tabGroupId).toBe(layers.tabGroupId);
    expect(layers.tabGroupOrder).toBe(0);
    expect(properties.tabGroupOrder).toBe(1);
    expect(layers.tabGroupActive).toBe(false);
    expect(properties.tabGroupActive).toBe(true);
    expect(properties).toMatchObject({
      mode: layers.mode,
      dockZone: layers.dockZone,
      floatingRect: layers.floatingRect,
      floatingRectSpace: layers.floatingRectSpace,
      zOrder: layers.zOrder,
    });

    store.activatePanelTab('image', 'layers');

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].tabGroupActive).toBe(true);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].tabGroupActive).toBe(false);
  });

  it('snaps a panel onto another panel as an ordered tab group', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      ...defaults,
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 100, y: 80, width: 340, height: 360 },
        minSize: { width: 260, height: 200 },
      },
    ]);

    store.snapPanelToDockTarget('image', 'properties', {
      mode: 'tab',
      dockZone: 'right',
      referencePanelId: 'layers',
    });

    const tabGroups = resolveDockablePanelTabGroups(Object.values(useDockablePanelStore.getState().layouts));

    expect(tabGroups).toHaveLength(1);
    expect(tabGroups[0]).toMatchObject({
      workspaceId: 'image',
      dockZone: 'right',
      activePanelId: 'properties',
      tabs: [
        { panelId: 'layers', order: 0, active: false },
        { panelId: 'properties', order: 1, active: true },
      ],
    });
  });

  it('reorders and splits tabbed floating panels without changing palette geometry', () => {
    const store = useDockablePanelStore.getState() as typeof useDockablePanelStore extends { getState: () => infer State }
      ? State & {
        reorderPanelTab?: (
          workspaceId: string,
          panelId: string,
          targetPanelId: string,
          placement: 'before' | 'after',
        ) => void;
        splitPanelTab?: (workspaceId: string, panelId: string) => void;
      }
      : never;
    store.registerPanelDefaults([
      ...defaults,
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 320, y: 180, width: 340, height: 360 },
        minSize: { width: 260, height: 200 },
      },
      {
        workspaceId: 'image',
        panelId: 'history',
        dockZone: 'right' as const,
        floatingRect: { x: 360, y: 220, width: 300, height: 360 },
        minSize: { width: 240, height: 200 },
      },
    ]);
    store.floatPanel(
      'image',
      'layers',
      { x: -900, y: 140, width: 620, height: 520 },
      { width: 1280, height: 720 },
      { constrainSize: false, floatingRectSpace: 'screen' },
    );
    store.groupPanelWithPanel('image', 'properties', 'layers');
    store.groupPanelWithPanel('image', 'history', 'layers');
    const stableGeometry = useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect;

    expect(store.reorderPanelTab).toBeTypeOf('function');
    store.reorderPanelTab?.('image', 'history', 'layers', 'before');

    expect(resolveDockablePanelTabGroups(Object.values(useDockablePanelStore.getState().layouts))[0]).toMatchObject({
      activePanelId: 'history',
      tabs: [
        { panelId: 'history', order: 0, active: true },
        { panelId: 'layers', order: 1, active: false },
        { panelId: 'properties', order: 2, active: false },
      ],
    });

    expect(store.splitPanelTab).toBeTypeOf('function');
    store.splitPanelTab?.('image', 'history');

    const layouts = useDockablePanelStore.getState().layouts;
    expect(layouts[panelKey('image', 'history')]).toMatchObject({
      mode: 'floating',
      floatingRectSpace: 'screen',
      floatingRect: stableGeometry,
      tabGroupId: undefined,
      tabGroupOrder: undefined,
      tabGroupActive: undefined,
    });
    expect(resolveDockablePanelTabGroups(Object.values(layouts))[0]).toMatchObject({
      activePanelId: 'layers',
      tabs: [
        { panelId: 'layers', order: 0, active: true },
        { panelId: 'properties', order: 1, active: false },
      ],
    });
    expect(layouts[panelKey('image', 'layers')].floatingRect).toEqual(stableGeometry);
    expect(layouts[panelKey('image', 'properties')].floatingRect).toEqual(stableGeometry);
  });

  it('keeps docked side-container width metadata shared across tab groups and neighbor panels', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        floatingRect: { x: 0, y: 0, width: 320, height: 420 },
        minSize: { width: 240, height: 180 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 0, y: 430, width: 360, height: 420 },
        minSize: { width: 260, height: 180 },
      },
      {
        workspaceId: 'image',
        panelId: 'history',
        dockZone: 'left' as const,
        floatingRect: { x: 0, y: 0, width: 280, height: 420 },
        minSize: { width: 240, height: 180 },
      },
    ]);

    store.groupPanelWithPanel('image', 'properties', 'layers');
    store.dockPanel('image', 'history', 'right');

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect.width).toBe(320);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].floatingRect.width).toBe(320);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'history')].floatingRect.width).toBe(320);

    store.resizeDockedPanel(
      'image',
      'properties',
      { edgeX: -1, edgeY: 0, deltaX: -80, deltaY: 0 },
      { width: 1600, height: 1000 },
    );

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].floatingRect.width).toBe(400);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].floatingRect.width).toBe(400);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'history')].floatingRect.width).toBe(400);
  });

  it('keeps every tab-group member in the same dock column through grouping, moves, and activation', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'image',
        panelId: 'layers',
        dockZone: 'right' as const,
        dockColumn: 1,
        floatingRect: { x: 0, y: 0, width: 320, height: 420 },
      },
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        dockColumn: 0,
        floatingRect: { x: 0, y: 0, width: 360, height: 420 },
      },
    ]);

    store.groupPanelWithPanel('image', 'properties', 'layers');
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].dockColumn).toBe(1);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].dockColumn).toBe(1);

    store.setPanelDockColumn('image', 'properties', 2);
    store.activatePanelTab('image', 'layers');

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].dockColumn).toBe(2);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'properties')].dockColumn).toBe(2);
  });

  it('keeps floating tab group geometry synchronized during move and resize', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      ...defaults,
      {
        workspaceId: 'image',
        panelId: 'properties',
        dockZone: 'right' as const,
        floatingRect: { x: 320, y: 180, width: 340, height: 360 },
        minSize: { width: 260, height: 200 },
      },
    ]);
    store.floatPanel(
      'image',
      'layers',
      { x: -900, y: 140, width: 620, height: 520 },
      { width: 1280, height: 720 },
      { constrainSize: false, floatingRectSpace: 'screen' },
    );

    store.groupPanelWithPanel('image', 'properties', 'layers');
    store.moveFloatingPanel('image', 'properties', 80, 40, { width: 1280, height: 720 });
    store.resizeFloatingPanel(
      'image',
      'properties',
      { edgeX: 1, edgeY: 1, deltaX: 120, deltaY: 90 },
      { width: 1280, height: 720 },
      { constrainSize: false },
    );

    const layers = useDockablePanelStore.getState().layouts[panelKey('image', 'layers')];
    const properties = useDockablePanelStore.getState().layouts[panelKey('image', 'properties')];

    expect(layers.mode).toBe('floating');
    expect(properties.mode).toBe('floating');
    expect(layers.floatingRectSpace).toBe('screen');
    expect(properties.floatingRectSpace).toBe('screen');
    expect(properties.floatingRect).toEqual({ x: -820, y: 180, width: 740, height: 610 });
    expect(layers.floatingRect).toEqual(properties.floatingRect);
  });

  it('docks, hides, collapses, and resets panels to registered defaults', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);
    store.floatPanel('image', 'layers');
    store.dockPanel('image', 'layers', 'left');
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')]).toMatchObject({
      mode: 'docked',
      dockZone: 'left',
    });

    store.collapsePanel('image', 'layers');
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].mode).toBe('collapsed');

    store.hidePanel('image', 'layers');
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].mode).toBe('hidden');

    store.resetPanelLayout('image', 'layers');
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')]).toMatchObject({
      mode: 'docked',
      dockZone: 'right',
      floatingRect: { x: 100, y: 80, width: 300, height: 400 },
    });
  });

  it('stacks snapped side panels before or after existing dock layers', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      ...defaults,
      {
        workspaceId: 'image',
        panelId: 'history',
        dockZone: 'right' as const,
        floatingRect: { x: 260, y: 160, width: 280, height: 300 },
      },
    ]);

    store.dockPanel('image', 'assets', 'left');
    store.dockPanel('image', 'history', 'left');
    store.snapPanelToDockTarget('image', 'layers', {
      mode: 'docked',
      dockZone: 'left',
      placement: 'before',
      referencePanelId: 'assets',
    });

    const leftPanels = Object.values(useDockablePanelStore.getState().layouts)
      .filter((layout) => layout.workspaceId === 'image' && layout.dockZone === 'left')
      .sort((a, b) => a.zOrder - b.zOrder)
      .map((layout) => layout.panelId);

    expect(leftPanels).toEqual(['layers', 'assets', 'history']);

    store.snapPanelToDockTarget('image', 'layers', {
      mode: 'docked',
      dockZone: 'left',
      placement: 'after',
      referencePanelId: 'history',
    });

    const reorderedLeftPanels = Object.values(useDockablePanelStore.getState().layouts)
      .filter((layout) => layout.workspaceId === 'image' && layout.dockZone === 'left')
      .sort((a, b) => a.zOrder - b.zOrder)
      .map((layout) => layout.panelId);

    expect(reorderedLeftPanels).toEqual(['assets', 'history', 'layers']);
  });

  it('resets all panels in a workspace without affecting other registered defaults', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([...defaults, { workspaceId: 'paper', panelId: 'inspector', dockZone: 'right' as const }]);
    store.hidePanel('image', 'layers');
    store.hidePanel('paper', 'inspector');
    store.resetWorkspacePanels('image');

    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].mode).toBe('docked');
    expect(useDockablePanelStore.getState().layouts[panelKey('paper', 'inspector')].mode).toBe('hidden');
  });

  it('applies workspace view defaults for recovery and focused editing', () => {
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      {
        workspaceId: 'video',
        panelId: 'project-source-bin',
        dockZone: 'left' as const,
        mode: 'docked' as const,
      },
      {
        workspaceId: 'video',
        panelId: 'program-monitor',
        dockZone: 'center' as const,
        mode: 'docked' as const,
      },
      {
        workspaceId: 'video',
        panelId: 'timeline',
        dockZone: 'bottom' as const,
        mode: 'docked' as const,
      },
      {
        workspaceId: 'video',
        panelId: 'diagnostics',
        dockZone: 'right' as const,
        mode: 'hidden' as const,
      },
      {
        workspaceId: 'paper',
        panelId: 'inspector',
        dockZone: 'right' as const,
        mode: 'docked' as const,
      },
    ]);

    store.floatPanel('video', 'project-source-bin', { x: 2000, y: 1600, width: 1600, height: 1200 }, { width: 1280, height: 720 });
    store.hidePanel('video', 'timeline');
    store.dockPanel('video', 'diagnostics', 'right');

    const applyWorkspaceViewDefault = (useDockablePanelStore.getState() as {
      applyWorkspaceViewDefault?: (workspaceId: string, preset: 'reset' | 'balanced' | 'focus' | 'all-panels') => void;
    }).applyWorkspaceViewDefault;

    expect(applyWorkspaceViewDefault).toBeTypeOf('function');
    applyWorkspaceViewDefault?.('video', 'focus');

    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'program-monitor')]).toMatchObject({
      mode: 'docked',
      dockZone: 'center',
    });
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'timeline')]).toMatchObject({
      mode: 'docked',
      dockZone: 'bottom',
    });
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'project-source-bin')].mode).toBe('hidden');
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'diagnostics')].mode).toBe('hidden');
    expect(useDockablePanelStore.getState().layouts[panelKey('paper', 'inspector')].mode).toBe('docked');

    applyWorkspaceViewDefault?.('video', 'all-panels');
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'project-source-bin')]).toMatchObject({
      mode: 'docked',
      dockZone: 'left',
    });
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'diagnostics')]).toMatchObject({
      mode: 'docked',
      dockZone: 'right',
    });

    applyWorkspaceViewDefault?.('video', 'balanced');
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'diagnostics')].mode).toBe('hidden');

    store.hidePanel('video', 'program-monitor');
    applyWorkspaceViewDefault?.('video', 'reset');
    expect(useDockablePanelStore.getState().layouts[panelKey('video', 'program-monitor')].mode).toBe('docked');
  });

  it('saves, applies, and deletes named custom layouts per workspace', () => {
    useDockablePanelStore.setState({ defaults: {}, layouts: {}, collapsedDockColumns: {}, savedLayouts: [] });
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults(defaults);

    // Arrange: move layers to column 1 and collapse that column.
    store.setPanelDockColumn('image', 'layers', 1);
    store.toggleDockColumnCollapsed('image', 'right', 1);
    const id = store.saveCurrentLayout('image', 'Two Column');
    expect(useDockablePanelStore.getState().savedLayouts).toHaveLength(1);
    expect(useDockablePanelStore.getState().savedLayouts[0]).toMatchObject({ id, workspaceId: 'image', name: 'Two Column' });

    // Change the arrangement, then re-apply the saved layout.
    store.setPanelDockColumn('image', 'layers', 0);
    store.toggleDockColumnCollapsed('image', 'right', 1);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].dockColumn).toBe(0);
    expect(useDockablePanelStore.getState().collapsedDockColumns['image:right:1']).toBe(false);

    useDockablePanelStore.getState().applySavedLayout(id);
    expect(useDockablePanelStore.getState().layouts[panelKey('image', 'layers')].dockColumn).toBe(1);
    expect(useDockablePanelStore.getState().collapsedDockColumns['image:right:1']).toBe(true);

    useDockablePanelStore.getState().deleteSavedLayout(id);
    expect(useDockablePanelStore.getState().savedLayouts).toHaveLength(0);
  });

  it('only captures the target workspace when saving a layout', () => {
    useDockablePanelStore.setState({ defaults: {}, layouts: {}, collapsedDockColumns: {}, savedLayouts: [] });
    const store = useDockablePanelStore.getState();
    store.registerPanelDefaults([
      ...defaults,
      { workspaceId: 'paper', panelId: 'inspector', dockZone: 'right' as const, floatingRect: { x: 0, y: 0, width: 280, height: 320 } },
    ]);
    const id = store.saveCurrentLayout('image', 'Image Only');
    const saved = useDockablePanelStore.getState().savedLayouts.find((entry) => entry.id === id);
    expect(Object.values(saved!.layouts).every((layout) => layout.workspaceId === 'image')).toBe(true);
    expect(Object.keys(saved!.layouts)).not.toContain(panelKey('paper', 'inspector'));
  });
});
