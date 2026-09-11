import { describe, expect, it } from 'vitest';

// The KDE Plasma global-menu decoupling lives in CommonJS Electron-side modules (they run in the main
// process and must not pull in the renderer bundle). These tests cover the three PURE, deterministic
// pieces that don't need DBus or X11: the menu model builder, the support gate, and — most important —
// the X11 window-id resolver, which must NEVER hand back a window that isn't confidently ours.

interface DbusMenuNode {
  id: number;
  parentId: number;
  type: 'standard' | 'separator';
  label: string;
  childrenDisplay: 'submenu' | null;
  children: number[];
  command: string | null;
  shortcut: string[][] | null;
}

interface DbusMenuModelModule {
  buildDbusMenuModel: (options?: {
    activeWorkspace?: string;
    keyboardShortcuts?: Record<string, string>;
    isMac?: boolean;
    revision?: number;
    locale?: string;
  }) => { revision: number; rootId: number; nodes: Map<number, DbusMenuNode> };
  toDbusShortcut: (accelerator: string) => string[][] | null;
}

interface ControllerModule {
  isGlobalMenuSupported: (env?: Record<string, string | undefined>, platform?: NodeJS.Platform) => boolean;
}

type Exec = (file: string, args: string[]) => string;
interface X11Module {
  resolveX11WindowId: (options: { pid?: number; titleIncludes?: string; exec?: Exec }) => number | null;
  escapeForXdotoolName: (value: string) => string;
  parseWindowId: (raw: unknown) => number | null;
}

async function loadModel(): Promise<DbusMenuModelModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return (await import('../../electron/globalMenu/dbusMenuModel.cjs')) as DbusMenuModelModule;
}
async function loadController(): Promise<ControllerModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return (await import('../../electron/globalMenu/globalMenuController.cjs')) as ControllerModule;
}
async function loadX11(): Promise<X11Module> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return (await import('../../electron/globalMenu/x11WindowId.cjs')) as X11Module;
}

const findByCommand = (nodes: Map<number, DbusMenuNode>, command: string) =>
  [...nodes.values()].find((node) => node.command === command);

describe('global menu — DBusMenu model builder', () => {
  it('mirrors the image workspace top-level menus from the shared JSON', async () => {
    const { buildDbusMenuModel } = await loadModel();
    const { rootId, nodes } = buildDbusMenuModel({ activeWorkspace: 'image', isMac: false });

    const root = nodes.get(rootId)!;
    const topLabels = root.children.map((id) => nodes.get(id)!.label);
    expect(topLabels).toEqual(['Project', 'File', 'Edit', 'Image', 'Select', 'Tools', 'View', 'Window', 'Help']);
  });

  it('translates top-level + role labels when locale is ja (keeping brand names), English by default', async () => {
    const { buildDbusMenuModel } = await loadModel();

    // Paper workspace: Japanese top-level labels resolve from the shared JSON labelJa fields.
    const jaPaper = buildDbusMenuModel({ activeWorkspace: 'paper', isMac: false, locale: 'ja' });
    const jaTop = jaPaper.nodes.get(jaPaper.rootId)!.children.map((id) => jaPaper.nodes.get(id)!.label);
    expect(jaTop).toEqual(['プロジェクト', 'ファイル', '編集', 'レイアウト', '挿入', 'ツール', '表示', 'ウィンドウ', 'ヘルプ']);

    // A leaf command label + a synthetic role label both translate.
    expect(findByCommand(jaPaper.nodes, 'edit:undo')?.label).toBe('元に戻す');
    expect(findByCommand(jaPaper.nodes, 'role:quit')?.label).toBe('Sloom Studio を終了');

    // The flow workspace's Flow group is a product proper noun — English even in Japanese.
    const jaFlow = buildDbusMenuModel({ activeWorkspace: 'flow', isMac: false, locale: 'ja' });
    const jaFlowTop = jaFlow.nodes.get(jaFlow.rootId)!.children.map((id) => jaFlow.nodes.get(id)!.label);
    expect(jaFlowTop).toContain('Flow');

    // Default locale is unchanged English.
    const enPaper = buildDbusMenuModel({ activeWorkspace: 'paper', isMac: false });
    expect(findByCommand(enPaper.nodes, 'edit:undo')?.label).toBe('Undo');
  });

  it('maps Electron roles to synthetic role:* commands and drops `close` on non-mac', async () => {
    const { buildDbusMenuModel } = await loadModel();
    const { nodes } = buildDbusMenuModel({ activeWorkspace: 'image', isMac: false });

    const quit = findByCommand(nodes, 'role:quit');
    expect(quit?.label).toBe('Quit Sloom Studio');
    expect(findByCommand(nodes, 'role:reload')).toBeDefined();
    expect(findByCommand(nodes, 'role:togglefullscreen')).toBeDefined();
    // `close` has no ROLE_ITEMS entry on non-mac, so it must not surface as any command.
    expect([...nodes.values()].some((n) => n.command === 'role:close')).toBe(false);
  });

  it('lets keyboardShortcuts override an item accelerator (same as the in-window menu)', async () => {
    const { buildDbusMenuModel } = await loadModel();
    const { nodes } = buildDbusMenuModel({
      activeWorkspace: 'image',
      isMac: false,
      keyboardShortcuts: { 'image:file-new': 'Ctrl+Shift+Alt+N' },
    });

    const fileNew = findByCommand(nodes, 'image:file-new');
    expect(fileNew?.shortcut).toEqual([['Control', 'Shift', 'Alt', 'N']]);
  });

  it('builds recursive submenus (Window ▸ Panels) with childrenDisplay set', async () => {
    const { buildDbusMenuModel } = await loadModel();
    const { nodes } = buildDbusMenuModel({ activeWorkspace: 'image', isMac: false });

    const panels = [...nodes.values()].find((n) => n.label === 'Panels');
    expect(panels?.childrenDisplay).toBe('submenu');
    expect(panels && panels.children.length).toBeGreaterThan(1);
  });

  it('toDbusShortcut normalizes modifiers to the aas form', async () => {
    const { toDbusShortcut } = await loadModel();
    expect(toDbusShortcut('Ctrl+Shift+S')).toEqual([['Control', 'Shift', 'S']]);
    expect(toDbusShortcut('CmdOrCtrl+K')).toEqual([['Control', 'K']]);
    expect(toDbusShortcut('')).toBeNull();
  });
});

describe('global menu — support gate (opt-in)', () => {
  const kde = { XDG_CURRENT_DESKTOP: 'KDE' as const };

  it('requires the explicit opt-in flag even on KDE/Linux', async () => {
    const { isGlobalMenuSupported } = await loadController();
    expect(isGlobalMenuSupported({ ...kde }, 'linux')).toBe(false);
    expect(isGlobalMenuSupported({ ...kde, SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1' }, 'linux')).toBe(true);
  });

  it('stays off when not KDE, not Linux, or explicitly disabled / pinned to native Wayland', async () => {
    const { isGlobalMenuSupported } = await loadController();
    const on = { SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1', ...kde };
    expect(isGlobalMenuSupported(on, 'darwin')).toBe(false);
    expect(isGlobalMenuSupported({ SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1', XDG_CURRENT_DESKTOP: 'GNOME' }, 'linux')).toBe(false);
    expect(isGlobalMenuSupported({ ...on, SIGNAL_LOOM_ELECTRON_DISABLE_GLOBAL_MENU: '1' }, 'linux')).toBe(false);
    expect(isGlobalMenuSupported({ ...on, SIGNAL_LOOM_ELECTRON_FORCE_NATIVE_WAYLAND: '1' }, 'linux')).toBe(false);
  });
});

describe('global menu — strict X11 window-id resolver', () => {
  // Build a fake `exec` from a scenario so the matching logic is tested without a real X server.
  const makeExec = (scenario: {
    pidSearch?: string;
    nameSearch?: string;
    clientList?: string;
    names?: Record<number, string>;
  }): Exec => (file, args) => {
    if (file === 'xdotool' && args[0] === 'search' && args[1] === '--pid') return scenario.pidSearch ?? '';
    if (file === 'xdotool' && args[0] === 'search' && args[1] === '--name') return scenario.nameSearch ?? '';
    if (file === 'xprop') return scenario.clientList ?? '';
    if (file === 'xdotool' && args[0] === 'getwindowname') return scenario.names?.[Number(args[1])] ?? '';
    return '';
  };

  it('returns the candidate whose title matches, disambiguating same-pid windows', async () => {
    const { resolveX11WindowId } = await loadX11();
    const xid = resolveX11WindowId({
      pid: 1234,
      titleIncludes: 'Sloom Studio — Image',
      exec: makeExec({
        pidSearch: '0x100\n0x200\n',
        names: { 0x100: 'Sloom Studio — Flow', 0x200: 'Sloom Studio — Image' },
      }),
    });
    expect(xid).toBe(0x200);
  });

  it('REFUSES to return a foreign window when nothing matches the title (the hijack regression)', async () => {
    const { resolveX11WindowId } = await loadX11();
    // pid search surfaces only some unrelated app's window; the title does not match it.
    const xid = resolveX11WindowId({
      pid: 1234,
      titleIncludes: 'Sloom Studio',
      exec: makeExec({ pidSearch: '0x1000035\n', names: { 0x1000035: 'BulmaCAS.bot' } }),
    });
    expect(xid).toBeNull();
  });

  it('with no title, returns the id only when exactly one managed toplevel is a candidate', async () => {
    const { resolveX11WindowId } = await loadX11();
    const single = resolveX11WindowId({
      pid: 1234,
      exec: makeExec({ pidSearch: '0x300\n0x301\n', clientList: '0x300\n' }),
    });
    expect(single).toBe(0x300);

    const ambiguous = resolveX11WindowId({
      pid: 1234,
      exec: makeExec({ pidSearch: '0x300\n0x301\n', clientList: '0x300\n0x301\n' }),
    });
    expect(ambiguous).toBeNull();
  });

  it('returns null when there are no candidates at all', async () => {
    const { resolveX11WindowId } = await loadX11();
    expect(resolveX11WindowId({ pid: 1234, titleIncludes: 'Sloom Studio', exec: makeExec({}) })).toBeNull();
  });

  it('escapes regex metacharacters before handing a title to xdotool --name', async () => {
    const { escapeForXdotoolName } = await loadX11();
    expect(escapeForXdotoolName('Sloom Studio (probe)')).toBe('Sloom Studio \\(probe\\)');
  });

  it('parseWindowId rejects the 0x1 placeholder and non-ids', async () => {
    const { parseWindowId } = await loadX11();
    expect(parseWindowId('0x1')).toBeNull();
    expect(parseWindowId('0x1000035')).toBe(0x1000035);
    expect(parseWindowId('not-an-id')).toBeNull();
  });
});
