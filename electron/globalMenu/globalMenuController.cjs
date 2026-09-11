// Orchestrates the KDE Plasma global menu, fully decoupled from the GPU/render process.
//
// WHY THIS EXISTS — the long-standing "you can't have the KDE global menu AND hardware acceleration"
// problem. The real coupling was never fundamental: it was that getting the global menu meant forcing
// XWayland, and the old `gl-egl` ANGLE backend couldn't find an EGL config under XWayland → SwiftShader
// → ~1fps sketching. With the current ANGLE-Vulkan backend the GPU survives XWayland (verified:
// 2d_canvas + rasterization stay GPU-accelerated on ozone=x11), so the only remaining gap is that
// Electron/Chromium never EXPORTS a DBusMenu. This module closes that gap over pure DBus — no GTK menu
// module (Electron doesn't use GTK menus), no patched Chromium. The menu becomes a session-bus service
// that Plasma reads; the render process just renders. They are now independent.
//
// Mechanism: export a `com.canonical.dbusmenu` object per workspace window, then tell KDE's
// `com.canonical.AppMenu.Registrar` (kded6) which window id maps to which menu object. KDE shows the
// focused window's registered menu in the global-menu applet automatically — no focus juggling.
//
// Everything here is best-effort desktop chrome: every DBus call is guarded, and any failure leaves the
// in-window menu bar as the working fallback. It must NEVER throw into the app's startup path.

const { buildDbusMenuModel } = require('./dbusMenuModel.cjs');
const { SignalLoomDbusMenu } = require('./dbusMenuExporter.cjs');

const REGISTRAR_SERVICE = 'com.canonical.AppMenu.Registrar';
const REGISTRAR_PATH = '/com/canonical/AppMenu/Registrar';
const REGISTRAR_INTERFACE = 'com.canonical.AppMenu.Registrar';
const MENU_PATH_PREFIX = '/org/signalloom/menus';

/** Pure: is the KDE global-menu export worth attempting in this environment?
 *
 * Opt-in by design. Enabling the global menu forces the app onto XWayland (the AppMenu registrar is
 * keyed on an X11 window id), and while the ANGLE-Vulkan GPU path survives XWayland, the safe
 * native-Wayland + GPU default was a hard-won, user-confirmed configuration. So we only flip into the
 * XWayland+global-menu mode when the user explicitly asks for it via SIGNAL_LOOM_ELECTRON_GLOBAL_MENU=1
 * (the same single flag that forces XWayland in linux-windowing.cjs — one switch drives the whole
 * decoupled path). Everything else stays on the in-window menu bar, which works on every desktop. */
function isGlobalMenuSupported(env = process.env, platform = process.platform) {
  if (platform !== 'linux') return false;
  if (env.SIGNAL_LOOM_ELECTRON_DISABLE_GLOBAL_MENU === '1') return false;
  if (env.SIGNAL_LOOM_ELECTRON_GLOBAL_MENU !== '1') return false;
  if (env.SIGNAL_LOOM_ELECTRON_FORCE_NATIVE_WAYLAND === '1') return false;
  const desktop = (env.XDG_CURRENT_DESKTOP ?? '').split(':').some((e) => e.toLowerCase() === 'kde');
  return desktop;
}

function createGlobalMenuController(options = {}) {
  const {
    onCommand = () => {},
    getKeyboardShortcuts = () => ({}),
    getLocale = () => 'en',
    isMac = false,
    env = process.env,
    platform = process.platform,
    logger = () => {},
    // Injected for tests; defaults to the real dbus-next session bus.
    connect = () => require('dbus-next').sessionBus(),
  } = options;

  const supported = isGlobalMenuSupported(env, platform);

  let bus = null;
  let registrar = null;
  let revision = 1;
  let started = false;
  // xid -> { workspace, path, iface }
  const windows = new Map();

  const log = (...args) => {
    try { logger(...args); } catch { /* logging must never throw */ }
  };

  const modelFor = (workspace) =>
    buildDbusMenuModel({
      activeWorkspace: workspace,
      keyboardShortcuts: getKeyboardShortcuts() || {},
      isMac,
      revision,
      locale: getLocale() || 'en',
    });

  async function start() {
    if (!supported || started) return started && bus != null;
    try {
      bus = connect();
      const proxy = await bus.getProxyObject(REGISTRAR_SERVICE, REGISTRAR_PATH);
      registrar = proxy.getInterface(REGISTRAR_INTERFACE);
      started = true;
      log('global-menu: connected, bus name', bus.name);
      return true;
    } catch (err) {
      log('global-menu: start failed —', String(err && err.message ? err.message : err));
      bus = null;
      registrar = null;
      return false;
    }
  }

  async function registerWindow(workspace, xid) {
    if (!started || bus == null || registrar == null) return false;
    if (!Number.isInteger(xid) || xid <= 0) {
      log('global-menu: refusing to register invalid xid', xid, 'for', workspace);
      return false;
    }
    if (windows.has(xid)) {
      // Re-register (e.g. workspace changed in a reused window): swap the model source.
      windows.get(xid).workspace = workspace;
      emitLayoutUpdated(xid);
      return true;
    }

    const path = `${MENU_PATH_PREFIX}/w${xid}`;
    const entry = { workspace, path, iface: null };
    const iface = new SignalLoomDbusMenu({
      getModel: () => modelFor(entry.workspace),
      onCommand: (command) => {
        try { onCommand(command, xid); } catch (err) { log('global-menu: command handler threw', String(err)); }
      },
      onAboutToShow: (id) => log('global-menu: AboutToShow', id, '→ Plasma adopted window', '0x' + xid.toString(16)),
    });
    entry.iface = iface;

    try {
      bus.export(path, iface);
      await registrar.RegisterWindow(xid, path);
      windows.set(xid, entry);
      log('global-menu: registered', '0x' + xid.toString(16), '→', path, `(${workspace})`);
      return true;
    } catch (err) {
      log('global-menu: registerWindow failed —', String(err && err.message ? err.message : err));
      try { bus.unexport(path, iface); } catch { /* ignore */ }
      return false;
    }
  }

  function emitLayoutUpdated(xid) {
    const entry = windows.get(xid);
    if (!entry || !entry.iface) return;
    try { entry.iface.LayoutUpdated(revision >>> 0, 0); } catch (err) { log('global-menu: LayoutUpdated threw', String(err)); }
  }

  /** Rebuild every window's menu after any process-owned menu input changes. */
  function refresh() {
    revision += 1;
    for (const xid of windows.keys()) emitLayoutUpdated(xid);
  }

  /** Point a reused window at a different workspace's menu and tell Plasma to re-read it. */
  function setWindowWorkspace(xid, workspace) {
    const entry = windows.get(xid);
    if (!entry) return;
    entry.workspace = workspace;
    revision += 1;
    emitLayoutUpdated(xid);
  }

  async function unregisterWindow(xid) {
    const entry = windows.get(xid);
    if (!entry) return;
    windows.delete(xid);
    try { if (registrar) await registrar.UnregisterWindow(xid); } catch { /* ignore */ }
    try { if (bus) bus.unexport(entry.path, entry.iface); } catch { /* ignore */ }
    log('global-menu: unregistered', '0x' + xid.toString(16));
  }

  async function stop() {
    for (const xid of [...windows.keys()]) await unregisterWindow(xid);
    try { if (bus) bus.disconnect(); } catch { /* ignore */ }
    bus = null;
    registrar = null;
    started = false;
  }

  return {
    isSupported: () => supported,
    start,
    registerWindow,
    unregisterWindow,
    setWindowWorkspace,
    refresh,
    // Compatibility alias for existing shortcut-only callers.
    refreshShortcuts: refresh,
    stop,
    getState: () => ({
      supported,
      started,
      busName: bus ? bus.name : null,
      revision,
      windows: [...windows.entries()].map(([xid, e]) => ({ xid, workspace: e.workspace, path: e.path })),
    }),
  };
}

module.exports = {
  createGlobalMenuController,
  isGlobalMenuSupported,
  REGISTRAR_SERVICE,
  REGISTRAR_PATH,
  MENU_PATH_PREFIX,
};
