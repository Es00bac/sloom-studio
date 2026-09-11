import { describe, expect, it, vi } from 'vitest';

interface GpuSwitch {
  name: string;
  value?: string;
}

interface GpuPolicy {
  disabled: boolean;
  reason: string;
  clearSentinel: boolean;
}

interface ElectronLinuxWindowingModule {
  applyElectronMainLinuxWindowingCompatibility: (
    app: { commandLine?: { appendSwitch?: (name: string, value?: string) => void } },
    env?: Record<string, string | undefined>,
    platform?: NodeJS.Platform,
  ) => void;
  applyLinuxGpuCommandLine: (
    app: {
      disableHardwareAcceleration?: () => void;
      commandLine?: { appendSwitch?: (name: string, value?: string) => void };
    },
    options?: { disabled?: boolean },
    platform?: NodeJS.Platform,
  ) => void;
  getLinuxGpuSwitches: (disabled: boolean) => GpuSwitch[];
  resolveLinuxGpuPolicy: (
    env?: Record<string, string | undefined>,
    context?: { sentinelTimestamp?: number | null; now?: number; cooldownMs?: number },
    platform?: NodeJS.Platform,
  ) => GpuPolicy;
  supportsExternalFloatingPanelWindows: (
    env?: Record<string, string | undefined>,
    platform?: NodeJS.Platform,
  ) => boolean;
}

async function loadElectronLinuxWindowingModule(): Promise<ElectronLinuxWindowingModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/linux-windowing.cjs') as ElectronLinuxWindowingModule;
}

describe('Electron Linux windowing compatibility', () => {
  it('uses owner-window floating panels when native Wayland cannot place popup windows', async () => {
    const { supportsExternalFloatingPanelWindows } = await loadElectronLinuxWindowingModule();

    expect(supportsExternalFloatingPanelWindows({
      ELECTRON_OZONE_PLATFORM_HINT: 'auto',
      WAYLAND_DISPLAY: 'wayland-0',
      XDG_SESSION_TYPE: 'wayland',
    }, 'linux')).toBe(false);
    expect(supportsExternalFloatingPanelWindows({
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      WAYLAND_DISPLAY: 'wayland-0',
      XDG_SESSION_TYPE: 'wayland',
    }, 'linux')).toBe(true);
    expect(supportsExternalFloatingPanelWindows({
      XDG_SESSION_TYPE: 'x11',
    }, 'linux')).toBe(true);
    expect(supportsExternalFloatingPanelWindows({}, 'darwin')).toBe(true);
  });

  it('keeps the menu in-window by default (no global-menu export) and defaults to native Wayland on KDE', async () => {
    const { applyElectronMainLinuxWindowingCompatibility } = await loadElectronLinuxWindowingModule();
    const appendSwitch = vi.fn();
    const env: Record<string, string | undefined> = {
      DISPLAY: ':1',
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
    };

    applyElectronMainLinuxWindowingCompatibility({ commandLine: { appendSwitch } }, env, 'linux');

    // No appmenu/global-menu export by default — the menu must stay in-window.
    expect(env.GTK_MODULES).toBeUndefined();
    expect(env.UBUNTU_MENUPROXY).toBeUndefined();
    // Default is native Wayland (auto) so the GPU initializes; XWayland is opt-in only.
    expect(env.ELECTRON_OZONE_PLATFORM_HINT).toBe('auto');
    expect(env.GDK_BACKEND).toBeUndefined();
    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform-hint', 'auto');
  });

  it('forces XWayland (not the dead GTK appmenu module) when SIGNAL_LOOM_ELECTRON_GLOBAL_MENU=1 on KDE', async () => {
    const { applyElectronMainLinuxWindowingCompatibility } = await loadElectronLinuxWindowingModule();
    const appendSwitch = vi.fn();
    const env: Record<string, string | undefined> = {
      DISPLAY: ':1',
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
      SIGNAL_LOOM_ELECTRON_GLOBAL_MENU: '1',
    };

    applyElectronMainLinuxWindowingCompatibility({ commandLine: { appendSwitch } }, env, 'linux');

    // The appmenu GTK module is a dead end for Electron — never set it, even in global-menu mode.
    expect(env.GTK_MODULES).toBeUndefined();
    expect(env.UBUNTU_MENUPROXY).toBeUndefined();
    // The KDE AppMenu registrar keys on an X11 window id, so the global menu forces XWayland. The
    // ANGLE-Vulkan GPU path survives XWayland, so this no longer costs the GPU.
    expect(env.ELECTRON_OZONE_PLATFORM_HINT).toBe('x11');
    expect(env.GDK_BACKEND).toBe('x11');
    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform', 'x11');
  });

  it('strips a stale appmenu-gtk-module from the ambient env in the default in-window mode', async () => {
    const { applyElectronMainLinuxWindowingCompatibility } = await loadElectronLinuxWindowingModule();
    const env: Record<string, string | undefined> = {
      GTK_MODULES: 'canberra-gtk-module:appmenu-gtk-module',
      UBUNTU_MENUPROXY: '1',
      XDG_SESSION_TYPE: 'x11',
    };

    applyElectronMainLinuxWindowingCompatibility({ commandLine: { appendSwitch: vi.fn() } }, env, 'linux');

    expect(env.GTK_MODULES).toBe('canberra-gtk-module');
    expect(env.UBUNTU_MENUPROXY).toBeUndefined();
  });

  it('honors the explicit native Wayland opt-out for packaged Electron startup', async () => {
    const { applyElectronMainLinuxWindowingCompatibility } = await loadElectronLinuxWindowingModule();
    const appendSwitch = vi.fn();
    const env: Record<string, string | undefined> = {
      DISPLAY: ':1',
      SIGNAL_LOOM_ELECTRON_NATIVE_WAYLAND: '1',
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
    };

    applyElectronMainLinuxWindowingCompatibility({ commandLine: { appendSwitch } }, env, 'linux');

    expect(env.ELECTRON_OZONE_PLATFORM_HINT).toBe('auto');
    expect(env.GDK_BACKEND).toBeUndefined();
    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform-hint', 'auto');
  });
});

describe('Electron Linux GPU policy', () => {
  it('pins ANGLE to the native GL/EGL backend when the GPU is enabled', async () => {
    const { getLinuxGpuSwitches } = await loadElectronLinuxWindowingModule();

    expect(getLinuxGpuSwitches(false)).toEqual([
      { name: 'use-gl', value: 'angle' },
      { name: 'use-angle', value: 'vulkan' },
      { name: 'disable-gpu-sandbox' },
      // Force the Canvas2D composite onto the GPU (ANGLE alone only accelerates WebGL; Mesa is
      // blocklisted for accelerated 2D canvas/raster, which kept it on SwiftShader).
      { name: 'ignore-gpu-blocklist' },
      { name: 'enable-gpu-rasterization' },
      { name: 'enable-zero-copy' },
      { name: 'enable-features', value: 'CanvasOopRasterization' },
    ]);
  });

  it('falls back to the software switches when the GPU is disabled', async () => {
    const { getLinuxGpuSwitches } = await loadElectronLinuxWindowingModule();

    expect(getLinuxGpuSwitches(true)).toEqual([
      { name: 'disable-gpu' },
      { name: 'disable-gpu-sandbox' },
      { name: 'in-process-gpu' },
    ]);
  });

  it('defaults to GPU rendering on Linux (native Wayland makes the canvas composite GPU-fast)', async () => {
    const { resolveLinuxGpuPolicy } = await loadElectronLinuxWindowingModule();

    expect(resolveLinuxGpuPolicy({}, {}, 'linux')).toMatchObject({ disabled: false, reason: 'default-gpu' });
  });

  it('enables the GPU only when explicitly opted in', async () => {
    const { resolveLinuxGpuPolicy } = await loadElectronLinuxWindowingModule();

    expect(resolveLinuxGpuPolicy({ SIGNAL_LOOM_ELECTRON_ENABLE_GPU: '1' }, {}, 'linux')).toMatchObject({
      disabled: false,
      reason: 'enabled-opt-in',
    });
  });

  it('honors the explicit env opt-out', async () => {
    const { resolveLinuxGpuPolicy } = await loadElectronLinuxWindowingModule();

    expect(resolveLinuxGpuPolicy({ SIGNAL_LOOM_ELECTRON_DISABLE_GPU: '1' }, {}, 'linux')).toMatchObject({
      disabled: true,
      reason: 'env-opt-out',
    });
  });

  it('disables the GPU while a recent crash sentinel is within the cooldown (opt-in path)', async () => {
    const { resolveLinuxGpuPolicy } = await loadElectronLinuxWindowingModule();
    const now = 1_000_000_000;

    expect(
      resolveLinuxGpuPolicy(
        { SIGNAL_LOOM_ELECTRON_ENABLE_GPU: '1' },
        { sentinelTimestamp: now - 60_000, now },
        'linux',
      ),
    ).toMatchObject({ disabled: true, reason: 'crash-fallback', clearSentinel: false });
  });

  it('re-attempts the GPU and clears the sentinel after the cooldown expires (opt-in path)', async () => {
    const { resolveLinuxGpuPolicy } = await loadElectronLinuxWindowingModule();
    const now = 1_000_000_000;

    expect(
      resolveLinuxGpuPolicy(
        { SIGNAL_LOOM_ELECTRON_ENABLE_GPU: '1' },
        { sentinelTimestamp: now - 7 * 60 * 60 * 1000, now },
        'linux',
      ),
    ).toMatchObject({ disabled: false, reason: 'crash-fallback-expired', clearSentinel: true });
  });

  it('never touches the GPU on non-Linux platforms', async () => {
    const { resolveLinuxGpuPolicy } = await loadElectronLinuxWindowingModule();

    expect(resolveLinuxGpuPolicy({ SIGNAL_LOOM_ELECTRON_DISABLE_GPU: '1' }, {}, 'darwin')).toMatchObject({
      disabled: false,
      reason: 'non-linux',
    });
  });

  it('applies the GL/EGL switches to the app command line without disabling acceleration', async () => {
    const { applyLinuxGpuCommandLine } = await loadElectronLinuxWindowingModule();
    const appendSwitch = vi.fn();
    const disableHardwareAcceleration = vi.fn();

    applyLinuxGpuCommandLine(
      { commandLine: { appendSwitch }, disableHardwareAcceleration },
      { disabled: false },
      'linux',
    );

    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(appendSwitch).toHaveBeenCalledWith('use-gl', 'angle');
    expect(appendSwitch).toHaveBeenCalledWith('use-angle', 'vulkan');
    expect(appendSwitch).toHaveBeenCalledWith('disable-gpu-sandbox');
  });

  it('disables hardware acceleration when the policy resolves to disabled', async () => {
    const { applyLinuxGpuCommandLine } = await loadElectronLinuxWindowingModule();
    const appendSwitch = vi.fn();
    const disableHardwareAcceleration = vi.fn();

    applyLinuxGpuCommandLine(
      { commandLine: { appendSwitch }, disableHardwareAcceleration },
      { disabled: true },
      'linux',
    );

    expect(disableHardwareAcceleration).toHaveBeenCalledTimes(1);
    expect(appendSwitch).toHaveBeenCalledWith('disable-gpu');
    expect(appendSwitch).toHaveBeenCalledWith('in-process-gpu');
  });
});
