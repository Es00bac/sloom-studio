// Pure builder: turn the shared workspace-menu JSON into a `com.canonical.dbusmenu` node map.
//
// This is the menu-export half of the global-menu decoupling. It deliberately has ZERO dependency on
// dbus-next, Electron, or any GPU/windowing surface — it is a plain data transform from the SAME
// `shared/workspaceMenus.json` the in-window Electron menu is built from (electron/menu.cjs), so the
// global menu and the in-window menu can never drift. The exporter (dbusMenuExporter.cjs) consumes
// this map; the controller (globalMenuController.cjs) wires clicks back to the renderer command bus.
//
// Output node shape mirrors the DBusMenu spec item properties:
//   { id, parentId, type:'standard'|'separator', label, enabled, visible,
//     childrenDisplay:'submenu'|null, children:[ids], command|null, shortcut:[[...]]|null }

const WORKSPACE_MENUS = require('../../shared/workspaceMenus.json');

// Roles the in-window Linux menu surfaces (electron/menu.cjs). The DBusMenu has no concept of an
// Electron "role", so each is given an explicit label + a synthetic `role:*` command the controller
// performs natively (quit/reload/fullscreen). `close` is intentionally dropped on non-mac to match
// the in-window menu (which does `if (role === 'close' && !isMac) continue`).
const ROLE_ITEMS = Object.freeze({
  quit: { label: 'Quit Sloom Studio', labelJa: 'Sloom Studio を終了', command: 'role:quit' },
  reload: { label: 'Reload', labelJa: '再読み込み', command: 'role:reload' },
  togglefullscreen: { label: 'Toggle Full Screen', labelJa: '全画面表示の切り替え', command: 'role:togglefullscreen' },
});

/** Resolve a group's `items` — an inline array or a `$shared` reference like "$project". */
function resolveMenuItems(items) {
  if (typeof items === 'string' && items.startsWith('$')) {
    return WORKSPACE_MENUS.$shared[items.slice(1)] ?? [];
  }
  return Array.isArray(items) ? items : [];
}

/** Pick a label for the active locale, falling back to English. `labelJa` lives beside `label` in the
 *  shared JSON (and on ROLE_ITEMS) so the global menu translates from the same source as the others. */
function pickLabel(item, locale) {
  if (locale === 'ja' && item && typeof item.labelJa === 'string' && item.labelJa) return item.labelJa;
  return (item && item.label) || '';
}

/** "Ctrl+Shift+S" -> [["Control","Shift","S"]] (the DBusMenu `shortcut` aas form). */
function toDbusShortcut(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator.trim()) {
    return null;
  }
  const combo = accelerator
    .split('+')
    .map((raw) => {
      const part = raw.trim();
      if (!part) return null;
      if (/^(ctrl|control|cmdorctrl|commandorcontrol|cmd|command|meta)$/i.test(part)) return 'Control';
      if (/^alt$/i.test(part)) return 'Alt';
      if (/^shift$/i.test(part)) return 'Shift';
      if (/^(super|win|meta)$/i.test(part)) return 'Super';
      if (/^del$/i.test(part)) return 'Delete';
      if (/^esc$/i.test(part)) return 'Escape';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .filter(Boolean);
  return combo.length ? [combo] : null;
}

/** keyboardShortcuts[command] overrides item.accelerator, exactly like the in-window menu. */
function resolveAccelerator(command, fallback, keyboardShortcuts) {
  const override = keyboardShortcuts?.[command];
  if (typeof override === 'string' && override.trim()) {
    return override;
  }
  return fallback;
}

function buildDbusMenuModel({ activeWorkspace = 'flow', keyboardShortcuts = {}, isMac = false, revision = 1, locale = 'en' } = {}) {
  const shortcuts = keyboardShortcuts && typeof keyboardShortcuts === 'object' ? keyboardShortcuts : {};
  const nodes = new Map();
  let nextId = 0;

  const root = {
    id: nextId++,
    parentId: -1,
    type: 'standard',
    label: '',
    enabled: true,
    visible: true,
    childrenDisplay: 'submenu',
    children: [],
    command: null,
    shortcut: null,
  };
  nodes.set(root.id, root);

  const addNode = (parentId, partial) => {
    const node = {
      id: nextId++,
      parentId,
      type: 'standard',
      label: '',
      enabled: true,
      visible: true,
      childrenDisplay: null,
      children: [],
      command: null,
      shortcut: null,
      ...partial,
    };
    nodes.set(node.id, node);
    nodes.get(parentId).children.push(node.id);
    return node;
  };

  const addItems = (parentId, items) => {
    for (const item of items) {
      if (!item) continue;

      if (item.type === 'separator') {
        addNode(parentId, { type: 'separator' });
        continue;
      }

      if (item.role) {
        const mapped = ROLE_ITEMS[item.role];
        if (!mapped) continue; // dropped roles (e.g. `close` on non-mac)
        addNode(parentId, { label: pickLabel(mapped, locale), command: mapped.command });
        continue;
      }

      if (Array.isArray(item.items)) {
        const submenu = addNode(parentId, {
          label: pickLabel(item, locale),
          childrenDisplay: 'submenu',
        });
        addItems(submenu.id, resolveMenuItems(item.items));
        continue;
      }

      if (item.command) {
        const accel = resolveAccelerator(item.command, item.accelerator, shortcuts);
        addNode(parentId, {
          label: pickLabel(item, locale),
          command: item.command,
          shortcut: toDbusShortcut(accel),
        });
      }
    }
  };

  const groups = WORKSPACE_MENUS[activeWorkspace] ?? WORKSPACE_MENUS.flow;
  for (const group of groups) {
    const top = addNode(root.id, { label: pickLabel(group, locale), childrenDisplay: 'submenu' });
    addItems(top.id, resolveMenuItems(group.items));
  }

  return { revision, rootId: root.id, nodes };
}

module.exports = {
  buildDbusMenuModel,
  toDbusShortcut,
  resolveMenuItems,
  ROLE_ITEMS,
};
