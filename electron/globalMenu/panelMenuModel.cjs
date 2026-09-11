// Pure builder: turn the shared workspace-menu JSON into a plain nested-JSON tree for the
// native-Wayland KDE panel menu (see panelMenuService.cjs + desktop/kde/signal-loom-panelmenu/).
//
// WHY A SECOND SHAPE — the `com.canonical.dbusmenu` exporter (dbusMenuExporter.cjs) is what KDE's
// stock global-menu applet reads, but that path is dead on native Wayland: KDE's AppMenu registrar is
// keyed on an X11 window id, so it forces XWayland (which kills the GPU on AMD/Mesa — see
// docs/notes/759–760). This module produces a much simpler menu description that OUR OWN Plasma applet
// reads over a plain custom D-Bus method, needing no X11 window id and therefore no XWayland. The app
// stays native-Wayland + GPU-accelerated; the menu still lands in the panel.
//
// It shares the exact same source of truth as the in-window Electron menu and the DBusMenu export: it
// walks the node map that `buildDbusMenuModel` already produces from `shared/workspaceMenus.json`, so
// all three menu surfaces can never drift.

const { buildDbusMenuModel } = require('./dbusMenuModel.cjs');

const PANEL_MENU_SCHEMA = 'signal-loom.panel-menu/v1';

// Display-format a DBusMenu `aas` shortcut (e.g. [["Control","Shift","S"]]) back into the compact
// human string the panel shows on the right of a menu row ("Ctrl+Shift+S"). Only the first combo is
// used (menu rows show a single accelerator), mirroring the in-window menu.
const SHORTCUT_LABELS = Object.freeze({ Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Super' });
function formatShortcut(shortcut) {
  if (!Array.isArray(shortcut) || !shortcut.length) return null;
  const combo = shortcut[0];
  if (!Array.isArray(combo) || !combo.length) return null;
  return combo.map((key) => SHORTCUT_LABELS[key] ?? key).join('+');
}

/** Convert one node-map entry into the panel-menu JSON node (recursing into submenus). */
function nodeToPanelJson(model, id) {
  const node = model.nodes.get(id);
  if (!node) return null;
  if (node.type === 'separator') return { separator: true };

  const out = { label: node.label ?? '' };
  if (node.enabled === false) out.enabled = false;
  if (node.command) out.command = node.command;
  const shortcut = formatShortcut(node.shortcut);
  if (shortcut) out.shortcut = shortcut;
  if (node.childrenDisplay === 'submenu' && Array.isArray(node.children) && node.children.length) {
    const children = node.children.map((childId) => nodeToPanelJson(model, childId)).filter(Boolean);
    if (children.length) out.children = children;
  }
  return out;
}

/** Build the panel-menu tree: { schema, revision, workspace, groups:[{ label, children:[…] }] }. */
function buildPanelMenu({ activeWorkspace = 'flow', keyboardShortcuts = {}, isMac = false, revision = 1, locale = 'en' } = {}) {
  const model = buildDbusMenuModel({ activeWorkspace, keyboardShortcuts, isMac, revision, locale });
  const root = model.nodes.get(model.rootId);
  const groups = (root ? root.children : []).map((groupId) => {
    const group = model.nodes.get(groupId);
    const children = (group && group.children ? group.children : [])
      .map((childId) => nodeToPanelJson(model, childId))
      .filter(Boolean);
    return { label: group ? group.label ?? '' : '', children };
  });
  return { schema: PANEL_MENU_SCHEMA, revision: revision >>> 0, workspace: activeWorkspace, groups };
}

/** Compact JSON string (no whitespace/newlines/single-quotes → survives any shell/GVariant quoting). */
function serializePanelMenu(menu) {
  return JSON.stringify(menu);
}

/** base64 of the compact JSON. The applet reads this over D-Bus and decodes it, which sidesteps every
 *  GVariant/gdbus/shell escaping pitfall entirely (the wire payload is [A-Za-z0-9+/=] only). */
function encodePanelMenu(menu) {
  return Buffer.from(serializePanelMenu(menu), 'utf8').toString('base64');
}

module.exports = {
  buildPanelMenu,
  serializePanelMenu,
  encodePanelMenu,
  formatShortcut,
  nodeToPanelJson,
  PANEL_MENU_SCHEMA,
};
