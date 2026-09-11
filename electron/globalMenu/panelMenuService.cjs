// Native-Wayland KDE panel menu — a plain custom D-Bus service the Sloom Studio Plasma applet reads.
//
// WHY THIS EXISTS — the companion to globalMenuController.cjs, but WITHOUT its fatal flaw. The stock
// KDE global-menu path registers each window with `com.canonical.AppMenu.Registrar`, which is keyed on
// an X11 window id; getting one forces XWayland, and on this AMD/Mesa stack XWayland drops the GPU to
// SwiftShader (docs/notes/759–760). This service needs NO window id: it just publishes the focused
// workspace's menu as a base64 JSON blob on the session bus and performs command clicks. Our own Plasma
// applet (desktop/kde/signal-loom-panelmenu/) polls it and renders the menu in the panel. Because there
// is no X11-window-id requirement, the app keeps running as a native-Wayland toplevel with the GPU
// intact — the "global menu AND hardware acceleration" combination that was previously impossible.
//
// Opt-in via SIGNAL_LOOM_ELECTRON_PANEL_MENU=1. CRUCIALLY this flag is NOT wired into
// linux-windowing.cjs `shouldForceXWaylandForGlobalMenu`, so it never forces XWayland — that is the
// whole point. Every D-Bus call is guarded; any failure leaves the in-window menu bar as the fallback
// and never throws into the app's startup path.

const { interface: dbusInterface } = require('dbus-next');
const { Interface, ACCESS_READ } = dbusInterface;
const { buildPanelMenu, encodePanelMenu } = require('./panelMenuModel.cjs');
const { buildDbusMenuModel } = require('./dbusMenuModel.cjs');
const { SignalLoomDbusMenu } = require('./dbusMenuExporter.cjs');

const PANEL_MENU_SERVICE = 'org.signalloom.PanelMenu';
const PANEL_MENU_PATH = '/org/signalloom/PanelMenu';
const PANEL_MENU_INTERFACE = 'org.signalloom.PanelMenu';
// A spec com.canonical.dbusmenu object mirroring the FOCUSED workspace's menu. This is what the
// Sloom Studio Global Menu applet fork (desktop/kde/signal-loom-globalmenu, a patched stock KDE
// Global Menu) imports for Sloom Studio windows — each workspace publishes its own full menu set
// here, switched live on window focus, exactly like four separate applications.
const ACTIVE_DBUSMENU_PATH = '/org/signalloom/menus/active';

/** Pure: should the panel-menu export run in this environment? Opt-in and Linux-only; unlike the stock
 *  global menu it does NOT require KDE-specific env and NEVER forces XWayland (native Wayland is fine). */
function isPanelMenuSupported(env = process.env, platform = process.platform) {
  if (platform !== 'linux') return false;
  if (env.SIGNAL_LOOM_ELECTRON_DISABLE_PANEL_MENU === '1') return false;
  return env.SIGNAL_LOOM_ELECTRON_PANEL_MENU === '1';
}

/**
 * dbus-next prefers its optional native `usocket` module for `unix:path=` addresses. That addon is
 * not ABI-safe in the packaged Electron runtime on this machine and can terminate the process before
 * JavaScript gets a chance to fall back to Node's socket implementation. `unix:socket=` is an
 * equivalent dbus-next-internal spelling that deliberately selects `node:net`, which is all this
 * JSON/menu service needs because it never transfers file descriptors.
 *
 * Abstract Unix sockets still require usocket, so they are omitted. TCP addresses remain usable.
 */
function normalizePanelMenuBusAddress(busAddress) {
  if (typeof busAddress !== 'string' || busAddress.trim().length === 0) return null;

  const safeAddresses = busAddress
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((address) => {
      if (/^tcp:/i.test(address)) return [address];
      if (!/^unix:/i.test(address)) return [];
      if (/(^|,)socket=/.test(address.slice('unix:'.length))) return [address];
      if (/(^|,)path=/.test(address.slice('unix:'.length))) {
        return [address.replace(/(^unix:|,)path=/i, '$1socket=')];
      }
      return [];
    });

  return safeAddresses.length > 0 ? safeAddresses.join(';') : null;
}

function connectPanelMenuSessionBus(env = process.env) {
  const configuredAddress = env.DBUS_SESSION_BUS_ADDRESS
    || (env.XDG_RUNTIME_DIR ? `unix:path=${env.XDG_RUNTIME_DIR}/bus` : '');
  const busAddress = normalizePanelMenuBusAddress(configuredAddress);
  if (!busAddress) {
    throw new Error('No panel-menu-safe D-Bus session address is available.');
  }
  return require('dbus-next').sessionBus({ busAddress, negotiateUnixFd: false });
}

// The D-Bus interface. Deliberately tiny: a cheap poll (`State`), a full fetch (`GetMenu`, base64), a
// click sink (`Activate`), and a `Changed` signal. The applet polls `State` and only re-fetches `GetMenu`
// when the revision changes, so steady-state cost is one trivial method call per poll tick.
class SignalLoomPanelMenu extends Interface {
  constructor({ getMenuBase64, getState, onActivate, appId, logger } = {}) {
    super(PANEL_MENU_INTERFACE);
    this._getMenuBase64 = typeof getMenuBase64 === 'function' ? getMenuBase64 : () => '';
    this._getState = typeof getState === 'function' ? getState : () => ({ active: false, revision: 1 });
    this._onActivate = typeof onActivate === 'function' ? onActivate : () => {};
    this._appId = typeof appId === 'string' ? appId : '';
    this._log = typeof logger === 'function' ? logger : () => {};
  }

  // --- property (read) ---
  // Newline-separated app-id hints (StartupWMClass / appId / name), purely for the applet's debugging /
  // optional app-id matching; show/hide is driven by `State` active, not by this.
  get AppId() { return this._appId; }

  // --- methods ---
  // "<active 0|1>:<revision>" — the cheap poll. Kept as a single scalar so the applet parses one line.
  State() {
    const state = this._getState() || {};
    return `${state.active ? 1 : 0}:${(state.revision >>> 0)}`;
  }

  // base64 of the compact menu JSON for the focused workspace.
  GetMenu() {
    try {
      return this._getMenuBase64() || '';
    } catch (err) {
      this._log('panel-menu: GetMenu threw', String(err && err.message ? err.message : err));
      return '';
    }
  }

  // Perform a menu command (routes through the same command bus as the in-window menu).
  Activate(command) {
    try {
      this._onActivate(command);
      return true;
    } catch (err) {
      this._log('panel-menu: Activate threw', String(err && err.message ? err.message : err));
      return false;
    }
  }

  // --- signal (calling this emits it) ---
  Changed() { /* signature '' — emit only */ }
}

SignalLoomPanelMenu.configureMembers({
  properties: {
    AppId: { signature: 's', access: ACCESS_READ },
  },
  methods: {
    State: { inSignature: '', outSignature: 's' },
    GetMenu: { inSignature: '', outSignature: 's' },
    Activate: { inSignature: 's', outSignature: 'b' },
  },
  signals: {
    Changed: { signature: '' },
  },
});

/**
 * Create the panel-menu service. Mirrors createGlobalMenuController's shape (isSupported/start/stop +
 * best-effort guards), but the state it tracks is "is a Sloom Studio window focused" + a revision that
 * bumps whenever the menu content should be re-read (workspace switch, shortcut remap).
 */
function createPanelMenuService(options = {}) {
  const {
    getActiveWorkspace = () => 'flow',
    getKeyboardShortcuts = () => ({}),
    getLocale = () => 'en',
    onCommand = () => {},
    isMac = false,
    appIdHints = [],
    env = process.env,
    platform = process.platform,
    logger = () => {},
    // Injected for tests; defaults to the real dbus-next session bus.
    connect = () => connectPanelMenuSessionBus(env),
    // Opening the applet's popup momentarily blurs the app window; hold "active" briefly so the menu
    // doesn't vanish mid-interaction. The applet also keeps itself visible while its popup is open.
    blurGraceMs = 400,
  } = options;

  const supported = isPanelMenuSupported(env, platform);

  let bus = null;
  let iface = null;
  let dbusMenuIface = null;
  let started = false;
  let active = false;
  let revision = 1;
  let blurTimer = null;

  const log = (...args) => {
    try { logger(...args); } catch { /* logging must never throw */ }
  };

  const buildBase64 = () =>
    encodePanelMenu(
      buildPanelMenu({
        activeWorkspace: getActiveWorkspace(),
        keyboardShortcuts: getKeyboardShortcuts() || {},
        isMac,
        revision,
        locale: getLocale() || 'en',
      }),
    );

  const emitChanged = () => {
    try { if (iface) iface.Changed(); } catch (err) { log('panel-menu: Changed emit threw', String(err)); }
    // Tell dbusmenu consumers (the Global Menu applet fork) to re-fetch: the focused workspace or the
    // shortcut map changed, so the menu tree they imported is stale.
    try { if (dbusMenuIface) dbusMenuIface.LayoutUpdated(revision >>> 0, 0); } catch (err) { log('panel-menu: LayoutUpdated emit threw', String(err)); }
  };

  async function start() {
    if (!supported || started) return started && bus != null;
    try {
      bus = connect();
      iface = new SignalLoomPanelMenu({
        getMenuBase64: buildBase64,
        getState: () => ({ active, revision }),
        onActivate: (command) => {
          try { onCommand(command); } catch (err) { log('panel-menu: onCommand threw', String(err)); }
        },
        appId: appIdHints.filter(Boolean).join('\n'),
        logger: log,
      });
      // The com.canonical.dbusmenu twin: same menu content, spec protocol, for the Global Menu
      // applet fork. getModel() re-reads the focused workspace on every fetch, so a LayoutUpdated
      // emit (see emitChanged) is all a workspace switch needs.
      dbusMenuIface = new SignalLoomDbusMenu({
        getModel: () =>
          buildDbusMenuModel({
            activeWorkspace: getActiveWorkspace(),
            keyboardShortcuts: getKeyboardShortcuts() || {},
            isMac,
            revision,
            locale: getLocale() || 'en',
          }),
        onCommand: (command) => {
          try { onCommand(command); } catch (err) { log('panel-menu: dbusmenu onCommand threw', String(err)); }
        },
        onAboutToShow: () => {},
      });
      bus.export(ACTIVE_DBUSMENU_PATH, dbusMenuIface);
      bus.export(PANEL_MENU_PATH, iface);
      await bus.requestName(PANEL_MENU_SERVICE, 0);
      started = true;
      log('panel-menu: exported', PANEL_MENU_SERVICE, 'at', PANEL_MENU_PATH, '+ dbusmenu at', ACTIVE_DBUSMENU_PATH, '(busName', bus.name + ')');
      return true;
    } catch (err) {
      log('panel-menu: start failed —', String(err && err.message ? err.message : err));
      bus = null;
      iface = null;
      return false;
    }
  }

  /** A Sloom Studio workspace window gained/lost OS focus. Blur is debounced so opening the panel applet
   *  (which briefly steals focus) doesn't hide the menu out from under the pointer. */
  function setActive(next) {
    if (next) {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      if (!active) { active = true; emitChanged(); }
      return;
    }
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      if (active) { active = false; emitChanged(); }
    }, blurGraceMs);
    if (blurTimer && typeof blurTimer.unref === 'function') blurTimer.unref();
  }

  /** Point the panel at a (possibly different) workspace's menu and tell the applet to re-read it.
   *  Content is pulled live from getActiveWorkspace(), so we only need to bump the revision. */
  function setActiveWorkspace() {
    revision += 1;
    emitChanged();
  }

  /** Rebuild the menu (e.g. after the user remapped keyboard shortcuts). */
  function refresh() {
    revision += 1;
    emitChanged();
  }

  async function stop() {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    try { if (bus && started) await bus.releaseName(PANEL_MENU_SERVICE); } catch { /* ignore */ }
    try { if (bus && iface) bus.unexport(PANEL_MENU_PATH, iface); } catch { /* ignore */ }
    try { if (bus && dbusMenuIface) bus.unexport(ACTIVE_DBUSMENU_PATH, dbusMenuIface); } catch { /* ignore */ }
    try { if (bus) bus.disconnect(); } catch { /* ignore */ }
    bus = null;
    iface = null;
    dbusMenuIface = null;
    started = false;
  }

  return {
    isSupported: () => supported,
    start,
    setActive,
    setActiveWorkspace,
    refresh,
    stop,
    // Introspection/testing: the pure menu payload without needing a live bus.
    buildMenuBase64: buildBase64,
    getState: () => ({ supported, started, active, revision, busName: bus ? bus.name : null }),
  };
}

module.exports = {
  createPanelMenuService,
  isPanelMenuSupported,
  normalizePanelMenuBusAddress,
  connectPanelMenuSessionBus,
  SignalLoomPanelMenu,
  PANEL_MENU_SERVICE,
  PANEL_MENU_PATH,
  PANEL_MENU_INTERFACE,
  ACTIVE_DBUSMENU_PATH,
};
