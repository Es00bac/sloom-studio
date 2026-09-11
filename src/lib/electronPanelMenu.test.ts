import { afterEach, describe, expect, it, vi } from 'vitest';

// The native-Wayland KDE panel menu (desktop/kde/signal-loom-panelmenu/ + electron/globalMenu/
// panelMenu*.cjs) is the "global menu WITHOUT XWayland" path: the app publishes the focused workspace's
// menu over a plain `org.signalloom.PanelMenu` D-Bus service that our own Plasma applet renders, so no
// X11 window id is needed and the GPU stays on native Wayland. These tests cover the PURE pieces (the
// JSON tree builder, the base64 wire codec, the opt-in gate) plus the service's observable behavior with
// an injected fake bus — no real D-Bus required.

interface PanelMenuNode {
  label?: string;
  separator?: true;
  enabled?: boolean;
  command?: string;
  shortcut?: string;
  children?: PanelMenuNode[];
}
interface PanelMenu {
  schema: string;
  revision: number;
  workspace: string;
  groups: { label: string; children: PanelMenuNode[] }[];
}

interface PanelMenuModelModule {
  buildPanelMenu: (options?: {
    activeWorkspace?: string;
    keyboardShortcuts?: Record<string, string>;
    isMac?: boolean;
    revision?: number;
  }) => PanelMenu;
  encodePanelMenu: (menu: PanelMenu) => string;
  formatShortcut: (shortcut: string[][] | null) => string | null;
  PANEL_MENU_SCHEMA: string;
}

interface PanelMenuServiceModule {
  isPanelMenuSupported: (env?: Record<string, string | undefined>, platform?: NodeJS.Platform) => boolean;
  normalizePanelMenuBusAddress: (address?: string) => string | null;
  createPanelMenuService: (options?: Record<string, unknown>) => {
    isSupported: () => boolean;
    start: () => Promise<boolean>;
    setActive: (next: boolean) => void;
    setActiveWorkspace: () => void;
    refresh: () => void;
    stop: () => Promise<void>;
    buildMenuBase64: () => string;
    getState: () => { supported: boolean; started: boolean; active: boolean; revision: number; busName: string | null };
  };
  SignalLoomPanelMenu: new (options: {
    getMenuBase64?: () => string;
    getState?: () => { active: boolean; revision: number };
    onActivate?: (command: string) => void;
    appId?: string;
  }) => {
    AppId: string;
    State: () => string;
    GetMenu: () => string;
    Activate: (command: string) => boolean;
  };
  PANEL_MENU_SERVICE: string;
  PANEL_MENU_PATH: string;
}

interface DbusMenuExporterModule {
  SignalLoomDbusMenu: new () => {
    Version: number;
    TextDirection: string;
    Status: string;
    IconThemePath: string[];
  };
}

async function loadModel(): Promise<PanelMenuModelModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return (await import('../../electron/globalMenu/panelMenuModel.cjs')) as PanelMenuModelModule;
}
async function loadService(): Promise<PanelMenuServiceModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return (await import('../../electron/globalMenu/panelMenuService.cjs')) as PanelMenuServiceModule;
}
async function loadDbusMenuExporter(): Promise<DbusMenuExporterModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return (await import('../../electron/globalMenu/dbusMenuExporter.cjs')) as DbusMenuExporterModule;
}

const decode = (base64: string): PanelMenu => JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
const findNode = (nodes: PanelMenuNode[], command: string): PanelMenuNode | undefined => {
  for (const node of nodes) {
    if (node.command === command) return node;
    if (node.children) {
      const hit = findNode(node.children, command);
      if (hit) return hit;
    }
  }
  return undefined;
};
const allNodes = (menu: PanelMenu): PanelMenuNode[] => {
  const out: PanelMenuNode[] = [];
  const walk = (nodes: PanelMenuNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children) walk(node.children);
    }
  };
  for (const group of menu.groups) walk(group.children);
  return out;
};

describe('panel menu — JSON tree builder', () => {
  it('mirrors the workspace top-level menus from the same shared JSON as the in-window menu', async () => {
    const { buildPanelMenu } = await loadModel();
    const menu = buildPanelMenu({ activeWorkspace: 'image', isMac: false });
    expect(menu.groups.map((group) => group.label)).toEqual([
      'Project', 'File', 'Edit', 'Image', 'Select', 'Tools', 'View', 'Window', 'Help',
    ]);
    expect(menu.workspace).toBe('image');
  });

  it('carries commands, formats shortcuts as compact display strings, and keeps role:* items', async () => {
    const { buildPanelMenu } = await loadModel();
    const menu = buildPanelMenu({ activeWorkspace: 'image', isMac: false });
    expect(findNode(menu.groups.flatMap((g) => g.children), 'role:quit')?.label).toBe('Quit Sloom Studio');

    const withShortcut = allNodes(menu).find((node) => typeof node.shortcut === 'string');
    expect(withShortcut?.shortcut).toMatch(/^[A-Za-z0-9+]+$/); // e.g. "Ctrl+Shift+S", never the aas form
  });

  it('lets keyboardShortcuts override an item accelerator (same source of truth as the DBusMenu)', async () => {
    const { buildPanelMenu } = await loadModel();
    const menu = buildPanelMenu({
      activeWorkspace: 'image',
      isMac: false,
      keyboardShortcuts: { 'image:file-new': 'Ctrl+Shift+Alt+N' },
    });
    expect(findNode(menu.groups.flatMap((g) => g.children), 'image:file-new')?.shortcut).toBe('Ctrl+Shift+Alt+N');
  });

  it('builds nested submenus (Window ▸ Panels) with a children array', async () => {
    const { buildPanelMenu } = await loadModel();
    const menu = buildPanelMenu({ activeWorkspace: 'image', isMac: false });
    const panels = allNodes(menu).find((node) => node.label === 'Panels');
    expect(Array.isArray(panels?.children)).toBe(true);
    expect(panels?.children && panels.children.length).toBeGreaterThan(1);
  });

  it('formatShortcut renders the aas modifier form as Ctrl/Alt/Shift/Super', async () => {
    const { formatShortcut } = await loadModel();
    expect(formatShortcut([['Control', 'Shift', 'S']])).toBe('Ctrl+Shift+S');
    expect(formatShortcut([['Super', 'K']])).toBe('Super+K');
    expect(formatShortcut(null)).toBeNull();
  });

  it('base64 codec round-trips to identical JSON (no whitespace, decodes cleanly)', async () => {
    const { buildPanelMenu, encodePanelMenu, PANEL_MENU_SCHEMA } = await loadModel();
    const menu = buildPanelMenu({ activeWorkspace: 'flow', isMac: false });
    const encoded = encodePanelMenu(menu);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/); // pure base64 → survives any shell/GVariant quoting
    const decoded = decode(encoded);
    expect(decoded.schema).toBe(PANEL_MENU_SCHEMA);
    expect(decoded.groups.map((g) => g.label)).toEqual(menu.groups.map((g) => g.label));
  });
});

describe('panel menu — support gate (opt-in, never forces XWayland)', () => {
  it('requires the dedicated opt-in flag and is Linux-only', async () => {
    const { isPanelMenuSupported } = await loadService();
    expect(isPanelMenuSupported({}, 'linux')).toBe(false);
    expect(isPanelMenuSupported({ SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1' }, 'linux')).toBe(true);
    expect(isPanelMenuSupported({ SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1' }, 'darwin')).toBe(false);
    expect(isPanelMenuSupported({ SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1' }, 'win32')).toBe(false);
  });

  it('is a DIFFERENT flag from the XWayland-forcing global menu (so it stays native-Wayland)', async () => {
    const { isPanelMenuSupported } = await loadService();
    // The global-menu flag must NOT enable the panel service, and vice-versa — they are independent.
    expect(isPanelMenuSupported({ SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1' }, 'linux')).toBe(false);
    expect(isPanelMenuSupported({ SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1', SIGNAL_LOOM_ELECTRON_DISABLE_PANEL_MENU: '1' }, 'linux')).toBe(false);
  });
});

describe('panel menu — Electron-safe session bus route', () => {
  it('routes filesystem Unix sockets through node:net instead of the native usocket addon', async () => {
    const { normalizePanelMenuBusAddress } = await loadService();
    expect(normalizePanelMenuBusAddress('unix:path=/run/user/1000/bus')).toBe('unix:socket=/run/user/1000/bus');
    expect(normalizePanelMenuBusAddress('unix:path=/run/user/1000/bus,guid=abc')).toBe('unix:socket=/run/user/1000/bus,guid=abc');
  });

  it('drops native-only abstract addresses while retaining safe alternatives', async () => {
    const { normalizePanelMenuBusAddress } = await loadService();
    expect(normalizePanelMenuBusAddress('unix:abstract=/tmp/dbus-native-only')).toBeNull();
    expect(normalizePanelMenuBusAddress('unix:abstract=/tmp/native;tcp:host=127.0.0.1,port=1234')).toBe('tcp:host=127.0.0.1,port=1234');
  });

  it('exposes DBusMenu metadata as readable properties rather than function values', async () => {
    const { SignalLoomDbusMenu } = await loadDbusMenuExporter();
    const menu = new SignalLoomDbusMenu();
    expect(menu.Version).toBe(3);
    expect(menu.TextDirection).toBe('ltr');
    expect(menu.Status).toBe('normal');
    expect(menu.IconThemePath).toEqual([]);
  });
});

describe('panel menu — D-Bus interface behavior', () => {
  it('State encodes active + revision; GetMenu returns the base64 payload; Activate forwards the command', async () => {
    const { SignalLoomPanelMenu } = await loadService();
    const activated: string[] = [];
    const iface = new SignalLoomPanelMenu({
      getMenuBase64: () => 'BASE64',
      getState: () => ({ active: true, revision: 7 }),
      onActivate: (command) => activated.push(command),
      appId: 'signal-loom\nSloom Studio',
    });
    expect(iface.State()).toBe('1:7');
    expect(iface.GetMenu()).toBe('BASE64');
    expect(iface.Activate('image:file-new')).toBe(true);
    expect(iface.Activate('role:quit')).toBe(true);
    expect(activated).toEqual(['image:file-new', 'role:quit']);
    expect(iface.AppId).toContain('signal-loom');
  });
});

describe('panel menu — service lifecycle (fake bus)', () => {
  afterEach(() => vi.useRealTimers());

  const makeFakeBus = () => {
    const calls: { export: unknown[]; requestName: unknown[]; released: boolean; disconnected: boolean } = {
      export: [], requestName: [], released: false, disconnected: false,
    };
    return {
      calls,
      bus: {
        name: ':1.999',
        export: (path: string, iface: unknown) => calls.export.push([path, iface]),
        unexport: () => {},
        requestName: async (name: string, flags: number) => { calls.requestName.push([name, flags]); return 1; },
        releaseName: async () => { calls.released = true; return 1; },
        disconnect: () => { calls.disconnected = true; },
      },
    };
  };

  it('start() exports the object and requests the well-known name on a supported env', async () => {
    const { createPanelMenuService, PANEL_MENU_SERVICE, PANEL_MENU_PATH } = await loadService();
    const fake = makeFakeBus();
    const service = createPanelMenuService({
      env: { SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1' },
      platform: 'linux',
      connect: () => fake.bus,
    });
    expect(service.isSupported()).toBe(true);
    expect(await service.start()).toBe(true);
    expect(service.getState().started).toBe(true);
    expect(service.getState().busName).toBe(':1.999');
    // Two objects go on the bus: the com.canonical.dbusmenu twin (for the Global Menu applet fork)
    // and the simple panel-menu interface (for the QML applet).
    const exportedPaths = fake.calls.export.map((call) => (call as unknown[])[0]);
    expect(exportedPaths).toContain(PANEL_MENU_PATH);
    expect(exportedPaths).toContain('/org/signalloom/menus/active');
    expect(fake.calls.requestName[0]).toEqual([PANEL_MENU_SERVICE, 0]);
  });

  it('does nothing (no bus) when the opt-in flag is absent', async () => {
    const { createPanelMenuService } = await loadService();
    let connected = false;
    const service = createPanelMenuService({
      env: {},
      platform: 'linux',
      connect: () => { connected = true; return {} as never; },
    });
    expect(service.isSupported()).toBe(false);
    expect(await service.start()).toBe(false);
    expect(connected).toBe(false);
  });

  it('setActive(true) and refresh() bump the revision; blur is debounced before going inactive', async () => {
    vi.useFakeTimers();
    const { createPanelMenuService } = await loadService();
    const service = createPanelMenuService({
      env: { SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1' },
      platform: 'linux',
      connect: () => makeFakeBus().bus,
      blurGraceMs: 300,
    });
    await service.start();

    const revBefore = service.getState().revision;
    service.setActive(true);
    expect(service.getState().active).toBe(true);
    service.refresh();
    expect(service.getState().revision).toBeGreaterThan(revBefore);

    service.setActive(false);
    expect(service.getState().active).toBe(true); // still active during the grace window
    vi.advanceTimersByTime(350);
    expect(service.getState().active).toBe(false);
  });

  it('buildMenuBase64 produces a decodable menu without ever touching the bus', async () => {
    const { createPanelMenuService } = await loadService();
    const service = createPanelMenuService({
      env: { SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1' },
      platform: 'linux',
      getActiveWorkspace: () => 'image',
    });
    const decoded = decode(service.buildMenuBase64());
    expect(decoded.groups[0].label).toBe('Project');
  });
});
