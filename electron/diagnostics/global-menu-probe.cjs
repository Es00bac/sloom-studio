// Integration proof: export our com.canonical.dbusmenu, register a REAL X11 Electron window with KDE's
// AppMenu registrar, and verify end-to-end that (a) the registrar maps our window → our menu object,
// and (b) our object serves a valid menu layout. Bonus: watch for plasmashell consuming it.
//
// Run:  node_modules/.bin/electron electron/diagnostics/global-menu-probe.cjs

const { app, BrowserWindow } = require('electron');
const dbus = require('dbus-next');
const { createGlobalMenuController } = require('../globalMenu/globalMenuController.cjs');
const { resolveX11WindowId } = require('../globalMenu/x11WindowId.cjs');

app.commandLine.appendSwitch('ozone-platform', 'x11');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'vulkan');
app.commandLine.appendSwitch('disable-gpu-sandbox');

const result = { steps: [], commandsReceived: [] };
const step = (k, v) => { result.steps.push([k, v]); console.log('STEP', k, '=', JSON.stringify(v)); };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 400, show: true, title: 'Sloom Studio (probe)' });
  await win.loadURL('data:text/html,<title>Sloom Studio probe</title><h1>probe</h1>');
  win.show();
  win.focus();
  await new Promise((r) => setTimeout(r, 600));

  const handle = win.getNativeWindowHandle();
  const handleXid = handle.length >= 4 ? handle.readUInt32LE(0) : 0;
  step('nativeHandleXid', '0x' + handleXid.toString(16));
  step('nativeHandleBytes', handle.length);

  // getNativeWindowHandle is unreliable on this Ozone/X11 session (returns 0x1); resolve the real XID.
  const resolved = resolveX11WindowId({ pid: process.pid, titleIncludes: 'Sloom Studio (probe)' });
  step('resolvedXid', resolved ? '0x' + resolved.toString(16) : null);
  const xid = (handleXid > 1 ? handleXid : resolved) || 0;
  step('xid', '0x' + xid.toString(16));

  const controller = createGlobalMenuController({
    onCommand: (command, fromXid) => { result.commandsReceived.push([command, fromXid]); console.log('COMMAND', command, fromXid); },
    getKeyboardShortcuts: () => ({}),
    isMac: false,
    logger: (...a) => console.log('CTRL', ...a),
  });

  step('isSupported', controller.isSupported());
  step('started', await controller.start());
  const busName = controller.getState().busName;
  step('busName', busName);
  step('registered', await controller.registerWindow('image', xid));

  // (a) Does KDE's registrar now map our window → our menu object?
  try {
    const proxy = await dbus.sessionBus().getProxyObject('com.canonical.AppMenu.Registrar', '/com/canonical/AppMenu/Registrar');
    const reg = proxy.getInterface('com.canonical.AppMenu.Registrar');
    const [service, path] = await reg.GetMenuForWindow(xid);
    step('registrar.GetMenuForWindow', { service, path });
    step('registrarMatchesUs', service === busName && path === `/org/signalloom/menus/w${xid}`);
  } catch (err) {
    step('registrar.GetMenuForWindow.error', String(err && err.message ? err.message : err));
  }

  // (b) Does our exported object serve a valid menu layout?
  try {
    const selfProxy = await dbus.sessionBus().getProxyObject(busName, `/org/signalloom/menus/w${xid}`);
    const menu = selfProxy.getInterface('com.canonical.dbusmenu');
    const [rev, layout] = await menu.GetLayout(0, -1, []);
    const [rootId, rootProps, children] = layout;
    const topLabels = children.map((childVariant) => {
      const [, props] = childVariant.value;
      return props.label ? props.label.value : '(no label)';
    });
    step('selfGetLayout', { revision: rev, rootId, topMenuCount: children.length, topLabels });
    step('versionProp', await menu.Version);
  } catch (err) {
    step('selfGetLayout.error', String(err && err.message ? err.message : err));
  }

  // Bonus: give plasmashell a few seconds to call AboutToShow/GetLayout (proof it adopted the window).
  console.log('Waiting 5s for Plasma to consume the menu (watch for CTRL AboutToShow)...');
  await new Promise((r) => setTimeout(r, 5000));

  console.log('GLOBAL_MENU_PROBE_RESULT ' + JSON.stringify(result, null, 2));
  await controller.stop();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
setTimeout(() => { console.log('GLOBAL_MENU_PROBE_TIMEOUT'); app.exit(0); }, 25000);
