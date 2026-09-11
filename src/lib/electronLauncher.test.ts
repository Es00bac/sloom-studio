import { describe, expect, it } from 'vitest';

interface ElectronLauncherModule {
  buildElectronEnvironment: (
    env?: Record<string, string | undefined>,
    platform?: NodeJS.Platform,
  ) => Record<string, string | undefined>;
  getElectronLaunchArgs: (
    env?: Record<string, string | undefined>,
    platform?: NodeJS.Platform,
    openTargets?: readonly string[],
  ) => string[];
  getElectronRendererUrl: (mode: string | undefined) => string | undefined;
  getLauncherForwardedOpenTargets: (
    argv: readonly string[],
    options?: { cwd?: string },
  ) => string[];
}

async function loadLauncherModule(): Promise<ElectronLauncherModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/launcher.cjs') as ElectronLauncherModule;
}

describe('Electron launcher environment', () => {
  it('keeps the menu in-window by default on Linux (no appmenu/global-menu export)', async () => {
    const { buildElectronEnvironment } = await loadLauncherModule();
    const env = buildElectronEnvironment({}, 'linux');

    expect(env.GTK_MODULES).toBeUndefined();
    expect(env.UBUNTU_MENUPROXY).toBeUndefined();
  });

  it('forces XWayland (not the dead appmenu GTK module) when the global menu is opted in on KDE', async () => {
    const { buildElectronEnvironment } = await loadLauncherModule();
    const env = buildElectronEnvironment(
      { XDG_CURRENT_DESKTOP: 'KDE', SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1' },
      'linux',
    );

    // appmenu-gtk-module is a dead end for Electron (Chromium draws its own menus) — never set it.
    // The KDE global menu is exported over pure DBus from the main process instead.
    expect(env.GTK_MODULES).toBeUndefined();
    expect(env.UBUNTU_MENUPROXY).toBeUndefined();
    // The AppMenu registrar keys on an X11 window id, so the global menu forces XWayland; the
    // ANGLE-Vulkan GPU path survives XWayland so this no longer costs hardware acceleration.
    expect(env.ELECTRON_OZONE_PLATFORM_HINT).toBe('x11');
    expect(env.GDK_BACKEND).toBe('x11');
  });

  it('defaults to native Wayland on KDE Wayland, forcing XWayland only when opted in', async () => {
    const { buildElectronEnvironment, getElectronLaunchArgs } = await loadLauncherModule();
    const base = { DISPLAY: ':1', XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' };

    const nativeEnv = buildElectronEnvironment(base, 'linux');
    expect(nativeEnv.ELECTRON_OZONE_PLATFORM_HINT).toBe('auto');
    expect(nativeEnv.GDK_BACKEND).toBeUndefined();
    expect(getElectronLaunchArgs(nativeEnv, 'linux')).toContain('--ozone-platform-hint=auto');
    expect(getElectronLaunchArgs(nativeEnv, 'linux')).not.toContain('--ozone-platform=x11');

    const forcedEnv = buildElectronEnvironment({ ...base, SIGNAL_LOOM_ELECTRON_FORCE_XWAYLAND: '1' }, 'linux');
    expect(forcedEnv.ELECTRON_OZONE_PLATFORM_HINT).toBe('x11');
    expect(forcedEnv.GDK_BACKEND).toBe('x11');
    expect(getElectronLaunchArgs(forcedEnv, 'linux')).toContain('--ozone-platform=x11');
  });

  it('honors the legacy native Wayland opt-out (stays native Wayland, never XWayland)', async () => {
    const { buildElectronEnvironment, getElectronLaunchArgs } = await loadLauncherModule();
    const env = buildElectronEnvironment({
      DISPLAY: ':1',
      SIGNAL_LOOM_ELECTRON_NATIVE_WAYLAND: '1',
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
    }, 'linux');

    expect(env.ELECTRON_OZONE_PLATFORM_HINT).toBe('auto');
    expect(env.GDK_BACKEND).toBeUndefined();
    expect(getElectronLaunchArgs(env, 'linux')).not.toContain('--ozone-platform=x11');
    expect(getElectronLaunchArgs(env, 'linux')).toContain('--ozone-platform-hint=auto');
  });

  it('defaults Linux to GPU rendering on native Wayland', async () => {
    const { getElectronLaunchArgs } = await loadLauncherModule();

    expect(getElectronLaunchArgs({}, 'linux')).toEqual([
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--disable-gpu-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--enable-features=CanvasOopRasterization',
      '--ozone-platform-hint=auto',
      '.',
    ]);
  });

  it('uses the ANGLE Vulkan backend with the Canvas2D-GPU flags', async () => {
    const { getElectronLaunchArgs } = await loadLauncherModule();

    expect(getElectronLaunchArgs({ SIGNAL_LOOM_ELECTRON_ENABLE_GPU: '1' }, 'linux')).toEqual([
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--disable-gpu-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--enable-features=CanvasOopRasterization',
      '--ozone-platform-hint=auto',
      '.',
    ]);
  });

  it('allows Linux GPU to be explicitly disabled via env (still native Wayland)', async () => {
    const { buildElectronEnvironment, getElectronLaunchArgs } = await loadLauncherModule();
    const env = buildElectronEnvironment({
      SIGNAL_LOOM_ELECTRON_DISABLE_GPU: '1',
    }, 'linux');

    expect(getElectronLaunchArgs(env, 'linux')).toEqual([
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--in-process-gpu',
      '--ozone-platform-hint=auto',
      '.',
    ]);
  });

  it('strips appmenu from existing GTK modules in the default in-window mode', async () => {
    const { buildElectronEnvironment } = await loadLauncherModule();
    const env = buildElectronEnvironment({
      GTK_MODULES: 'canberra-gtk-module:appmenu-gtk-module',
      ELECTRON_FORCE_WINDOW_MENU_BAR: '1',
    }, 'linux');

    expect(env.GTK_MODULES).toBe('canberra-gtk-module');
    expect(env.ELECTRON_FORCE_WINDOW_MENU_BAR).toBeUndefined();
  });

  it('still strips the dead appmenu GTK module even when the global menu is opted in', async () => {
    const { buildElectronEnvironment } = await loadLauncherModule();
    const env = buildElectronEnvironment({
      GTK_MODULES: 'canberra-gtk-module:appmenu-gtk-module',
      XDG_CURRENT_DESKTOP: 'KDE',
      SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1',
    }, 'linux');

    // The global menu no longer rides the GTK module, so the stale appmenu entry is dropped in every
    // mode — the real export is the DBus path. Other ambient modules are preserved.
    expect(env.GTK_MODULES).toBe('canberra-gtk-module');
  });

  it('extracts forwarded open targets from launcher argv, resolving relative paths against the launch cwd', async () => {
    const { getLauncherForwardedOpenTargets } = await loadLauncherModule();

    expect(getLauncherForwardedOpenTargets(
      ['--dev', 'projects/My Comic.sloom', '/abs/layout.slppr', 'signal-loom://workspace/paper', '--verbose', ''],
      { cwd: '/home/user' },
    )).toEqual([
      '/home/user/projects/My Comic.sloom',
      '/abs/layout.slppr',
      'signal-loom://workspace/paper',
    ]);
  });

  it('keeps file URLs untouched while forwarding launcher open targets', async () => {
    const { getLauncherForwardedOpenTargets } = await loadLauncherModule();

    expect(getLauncherForwardedOpenTargets(
      ['file:///home/user/%E9%80%B1%E5%88%8A.sloom'],
      { cwd: '/somewhere/else' },
    )).toEqual(['file:///home/user/%E9%80%B1%E5%88%8A.sloom']);
  });

  it('appends forwarded open targets after the app path in the electron launch args', async () => {
    const { getElectronLaunchArgs } = await loadLauncherModule();

    const linuxArgs = getElectronLaunchArgs({}, 'linux', ['/home/user/My Comic.sloom', '/home/user/layout.slppr']);
    expect(linuxArgs.slice(-3)).toEqual(['.', '/home/user/My Comic.sloom', '/home/user/layout.slppr']);

    expect(getElectronLaunchArgs({}, 'darwin', ['/Users/artist/comic.sloom'])).toEqual([
      '.',
      '/Users/artist/comic.sloom',
    ]);
    expect(getElectronLaunchArgs({}, 'darwin')).toEqual(['.']);
  });

  it('keeps non-Linux environments unchanged except dev renderer mode', async () => {
    const { buildElectronEnvironment, getElectronLaunchArgs, getElectronRendererUrl } = await loadLauncherModule();
    const env = buildElectronEnvironment({ GTK_MODULES: 'existing' }, 'darwin');

    expect(env.GTK_MODULES).toBe('existing');
    expect(getElectronLaunchArgs(env, 'darwin')).toEqual(['.']);
    expect(getElectronRendererUrl('dev')).toBe('http://127.0.0.1:5173');
    expect(getElectronRendererUrl(undefined)).toBeUndefined();
  });
});
