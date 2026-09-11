const APPMENU_GTK_MODULE = 'appmenu-gtk-module';
const NATIVE_WAYLAND_OPT_OUT = 'SIGNAL_LOOM_ELECTRON_NATIVE_WAYLAND';

function isKdeDesktop(value) {
  return (value ?? '').split(':').some((entry) => entry.toLowerCase() === 'kde');
}

function shouldForceXWaylandForGlobalMenu(env, platform = process.platform) {
  // Native Wayland is the default now. Forcing XWayland once blocked GPU EGL init on AMD/Mesa
  // ("No suitable EGL configs found") which pinned the Canvas2D composite to SwiftShader and tanked
  // sketching to single-digit FPS — but that was the gl-egl ANGLE backend. The current ANGLE-Vulkan
  // backend gets a GPU surface under XWayland too, so XWayland is safe to force when a feature needs
  // it. Two opt-ins force it: SIGNAL_LOOM_ELECTRON_GLOBAL_MENU (the KDE Plasma global menu registers
  // against an X11 window id, so the app must be an XWayland toplevel) and the older
  // SIGNAL_LOOM_ELECTRON_FORCE_XWAYLAND escape hatch. The legacy NATIVE_WAYLAND var still wins.
  return (
    platform === 'linux' &&
    env[NATIVE_WAYLAND_OPT_OUT] !== '1' &&
    (env.SIGNAL_LOOM_ELECTRON_GLOBAL_MENU === '1' || env.SIGNAL_LOOM_ELECTRON_FORCE_XWAYLAND === '1') &&
    isKdeDesktop(env.XDG_CURRENT_DESKTOP)
  );
}

/**
 * Native Wayland deliberately does not expose global window coordinates and
 * rejects programmatic window positioning. Dockable panels depend on both
 * while dragging renderer-created popup windows, so those panels must stay
 * inside their owning workspace window on Wayland. X11/XWayland, Windows, and
 * macOS retain the external popup path.
 */
function supportsExternalFloatingPanelWindows(env = process.env, platform = process.platform) {
  if (platform !== 'linux') {
    return true;
  }

  const ozonePlatform = (env.ELECTRON_OZONE_PLATFORM_HINT ?? '').trim().toLowerCase();
  const gdkBackends = (env.GDK_BACKEND ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (ozonePlatform === 'x11' || gdkBackends.includes('x11')) {
    return true;
  }

  const sessionType = (env.XDG_SESSION_TYPE ?? '').trim().toLowerCase();
  const hasWaylandDisplay = typeof env.WAYLAND_DISPLAY === 'string' && env.WAYLAND_DISPLAY.trim() !== '';
  return sessionType !== 'wayland' && !hasWaylandDisplay;
}

function buildElectronEnvironment(env = process.env, platform = process.platform) {
  const nextEnv = { ...env };

  if (platform !== 'linux') {
    return nextEnv;
  }

  // The in-window menu bar is the universal fallback and must always render. The appmenu GTK module +
  // UBUNTU_MENUPROXY are a DEAD END for Electron — Chromium draws its own menus, not GTK menus, so the
  // module never exports anything; worse, on a desktop without a global-menu applet it hoists the menu
  // OUT of the window and it vanishes entirely. So we never set it, and we strip any ambient copy from
  // the live env. The real KDE Plasma global menu (opt-in via SIGNAL_LOOM_ELECTRON_GLOBAL_MENU=1) is
  // exported over pure DBus from the main process (electron/globalMenu/*), independent of GTK modules;
  // that path also forces XWayland below so the AppMenu registrar can key on a real X11 window id.
  const ambientGtkModules = (nextEnv.GTK_MODULES ?? '')
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const gtkModules = ambientGtkModules.filter((entry) => entry !== APPMENU_GTK_MODULE);
  // Use `undefined` (not `delete`) so applyElectronMainLinuxWindowingCompatibility strips any
  // ambient appmenu export from the LIVE process env, not just from this copy.
  nextEnv.GTK_MODULES = gtkModules.length > 0 ? gtkModules.join(':') : undefined;
  nextEnv.UBUNTU_MENUPROXY = undefined;

  delete nextEnv.ELECTRON_FORCE_WINDOW_MENU_BAR;

  // Default to native Wayland. Electron's Linux default is X11/XWayland, which can't get a GPU
  // EGL config on some AMD/Mesa stacks and pins the canvas to software; 'auto' picks Wayland when
  // available (exactly what Chrome does) and X11 otherwise. XWayland is opt-in (see above).
  if (shouldForceXWaylandForGlobalMenu(nextEnv, platform)) {
    nextEnv.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
    nextEnv.GDK_BACKEND = 'x11';
  } else {
    nextEnv.ELECTRON_OZONE_PLATFORM_HINT = nextEnv.ELECTRON_OZONE_PLATFORM_HINT || 'auto';
  }

  return nextEnv;
}

// GPU rendering is the DEFAULT on Linux (opt out with SIGNAL_LOOM_ELECTRON_DISABLE_GPU=1). The
// old software default existed because GPU pixel READBACKS at every stroke commit measured ~7x
// slower — but that was while the GPU was crippled by the forced XWayland session (no usable EGL
// config → SwiftShader). On native Wayland the GPU inits properly, dirty-rect paint keeps readbacks
// tiny (~0.2ms), and the canvas composite drops from ~25-90ms to <1ms (a flat 60fps, like Chrome).
// Uses the ANGLE Vulkan backend (overridable via SIGNAL_LOOM_ELECTRON_ANGLE_BACKEND) + the
// un-blocklist/raster flags so the Canvas2D composite is GPU-accelerated. A GPU-process crash drops
// to software via the sentinel and self-heals after a cooldown.
function getLinuxGpuSwitches(disabled) {
  if (disabled) {
    return [
      { name: 'disable-gpu' },
      { name: 'disable-gpu-sandbox' },
      { name: 'in-process-gpu' },
    ];
  }

  // ANGLE over Vulkan. The gl-egl backend can't find a GPU-capable EGL config on this AMD/Mesa
  // stack ("No suitable EGL configs found") so it silently drops to SwiftShader; Vulkan (RADV) is
  // rock-solid on RDNA cards and sidesteps the EGL-config path. Overridable via
  // SIGNAL_LOOM_ELECTRON_ANGLE_BACKEND (e.g. gl, gl-egl) if a given stack prefers another.
  const angleBackend = (process.env.SIGNAL_LOOM_ELECTRON_ANGLE_BACKEND || 'vulkan').trim() || 'vulkan';
  return [
    { name: 'use-gl', value: 'angle' },
    { name: 'use-angle', value: angleBackend },
    { name: 'disable-gpu-sandbox' },
    // ANGLE alone only accelerates WebGL; the Image workspace is a Canvas2D app, and Mesa is on
    // Chromium's GPU blocklist for accelerated 2D canvas + raster — so without these the layer
    // composite (drawImage) silently stays on SwiftShader. These move it onto the GPU like a real
    // Chrome tab (which holds a flat 60fps on the identical bundle while software dips on one layer).
    { name: 'ignore-gpu-blocklist' },
    { name: 'enable-gpu-rasterization' },
    { name: 'enable-zero-copy' },
    { name: 'enable-features', value: 'CanvasOopRasterization' },
  ];
}

// Pure decision for whether to disable the Linux GPU this launch. Honors the
// explicit env opt-out and a runtime crash sentinel (written when the GPU process
// dies), with a cooldown so a one-off driver hiccup self-heals instead of pinning
// the user to software rendering forever.
function resolveLinuxGpuPolicy(env = process.env, context = {}, platform = process.platform) {
  if (platform !== 'linux') {
    return { disabled: false, reason: 'non-linux', clearSentinel: false };
  }

  if (env.SIGNAL_LOOM_ELECTRON_DISABLE_GPU === '1') {
    return { disabled: true, reason: 'env-opt-out', clearSentinel: false };
  }

  // GPU is the default (see the comment on getLinuxGpuSwitches). Keep the crash sentinel/cooldown
  // safety net so a GPU-process death drops to software and self-heals.
  const {
    sentinelTimestamp = null,
    now = Date.now(),
    cooldownMs = 6 * 60 * 60 * 1000,
  } = context;

  if (sentinelTimestamp != null) {
    if (now - sentinelTimestamp < cooldownMs) {
      return { disabled: true, reason: 'crash-fallback', clearSentinel: false };
    }
    return { disabled: false, reason: 'crash-fallback-expired', clearSentinel: true };
  }

  const reason = env.SIGNAL_LOOM_ELECTRON_ENABLE_GPU === '1' ? 'enabled-opt-in' : 'default-gpu';
  return { disabled: false, reason, clearSentinel: false };
}

// Applies the resolved GPU policy to the Electron `app` in the main process.
function applyLinuxGpuCommandLine(app, options = {}, platform = process.platform) {
  if (platform !== 'linux') {
    return;
  }

  const disabled = options.disabled === true;
  if (disabled) {
    app?.disableHardwareAcceleration?.();
  }

  for (const sw of getLinuxGpuSwitches(disabled)) {
    if (sw.value !== undefined) {
      app?.commandLine?.appendSwitch?.(sw.name, sw.value);
    } else {
      app?.commandLine?.appendSwitch?.(sw.name);
    }
  }
}

function getElectronLaunchArgs(env = process.env, platform = process.platform, openTargets = []) {
  const args = [];

  if (platform === 'linux') {
    const disabled = env.SIGNAL_LOOM_ELECTRON_DISABLE_GPU === '1';
    for (const sw of getLinuxGpuSwitches(disabled)) {
      args.push(sw.value !== undefined ? `--${sw.name}=${sw.value}` : `--${sw.name}`);
    }
  }

  if (shouldForceXWaylandForGlobalMenu(env, platform)) {
    args.push('--ozone-platform=x11');
  } else if (platform === 'linux') {
    args.push('--ozone-platform-hint=auto');
  }

  args.push('.');
  // File/URL arguments (a double-clicked .sloom/.slppr, a signal-loom:// deep link) ride after
  // the app path so the Electron main process sees them in process.argv exactly like a packaged
  // binary would — the main process owns validation, the launcher only forwards.
  for (const target of openTargets) {
    if (typeof target === 'string' && target) {
      args.push(target);
    }
  }
  return args;
}

function applyElectronMainLinuxWindowingCompatibility(app, env = process.env, platform = process.platform) {
  if (platform !== 'linux') {
    return env;
  }

  const nextEnv = buildElectronEnvironment(env, platform);

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }
    env[key] = value;
  }

  if (shouldForceXWaylandForGlobalMenu(nextEnv, platform)) {
    app.commandLine?.appendSwitch?.('ozone-platform', 'x11');
  } else if (platform === 'linux') {
    app.commandLine?.appendSwitch?.('ozone-platform-hint', 'auto');
  }

  return nextEnv;
}

module.exports = {
  applyElectronMainLinuxWindowingCompatibility,
  applyLinuxGpuCommandLine,
  buildElectronEnvironment,
  getElectronLaunchArgs,
  getLinuxGpuSwitches,
  resolveLinuxGpuPolicy,
  shouldForceXWaylandForGlobalMenu,
  supportsExternalFloatingPanelWindows,
};
