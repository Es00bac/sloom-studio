// `com.canonical.dbusmenu` exporter backed by a dbusMenuModel node map.
//
// This is the object KDE's Plasma global-menu applet (kded6 `appmenu` + plasmashell `kappmenuview`)
// reads over DBus. It is pure IPC: it never touches the GPU, the canvas, or the window's pixels — it
// only describes the menu tree and forwards clicks. That is the whole point of the decoupling: the
// global menu lives on the session bus, entirely separate from the hardware-accelerated render
// process. A GPU-process crash cannot take the menu down, and vice-versa.
//
// Spec: https://github.com/AyatanaIndicators/libdbusmenu / com.canonical.dbusmenu (version 3).

const { Variant, interface: dbusInterface } = require('dbus-next');
const { Interface } = dbusInterface;

const DBUS_MENU_INTERFACE = 'com.canonical.dbusmenu';

/** Build the filtered a{sv} property dict for one model node. */
function propertiesFor(node, propertyNames) {
  const all = {};
  if (node.type === 'separator') {
    all.type = new Variant('s', 'separator');
  } else {
    all.label = new Variant('s', node.label ?? '');
  }
  all.enabled = new Variant('b', node.enabled !== false);
  all.visible = new Variant('b', node.visible !== false);
  if (node.childrenDisplay === 'submenu') {
    all['children-display'] = new Variant('s', 'submenu');
  }
  if (Array.isArray(node.shortcut) && node.shortcut.length) {
    all.shortcut = new Variant('aas', node.shortcut);
  }

  if (Array.isArray(propertyNames) && propertyNames.length) {
    const filtered = {};
    for (const name of propertyNames) {
      if (name in all) filtered[name] = all[name];
    }
    return filtered;
  }
  return all;
}

class SignalLoomDbusMenu extends Interface {
  constructor({ getModel, onCommand, onAboutToShow } = {}) {
    super(DBUS_MENU_INTERFACE);
    this._getModel = typeof getModel === 'function' ? getModel : () => ({ revision: 1, rootId: 0, nodes: new Map() });
    this._onCommand = typeof onCommand === 'function' ? onCommand : () => {};
    this._onAboutToShow = typeof onAboutToShow === 'function' ? onAboutToShow : () => {};
  }

  _model() {
    return this._getModel();
  }

  _node(id) {
    return this._model().nodes.get(id);
  }

  // --- properties ---
  get Version() { return 3; }
  get TextDirection() { return 'ltr'; }
  get Status() { return 'normal'; }
  get IconThemePath() { return []; }

  // --- methods ---
  GetLayout(parentId, recursionDepth, propertyNames) {
    const model = this._model();
    const build = (id, depth) => {
      const node = model.nodes.get(id);
      if (!node) return [id, {}, []];
      const props = propertiesFor(node, propertyNames);
      const children = [];
      if (depth !== 0 && node.children && node.children.length) {
        const childDepth = depth < 0 ? -1 : depth - 1;
        for (const childId of node.children) {
          children.push(new Variant('(ia{sv}av)', build(childId, childDepth)));
        }
      }
      return [id, props, children];
    };
    const rootId = model.nodes.has(parentId) ? parentId : model.rootId;
    return [model.revision >>> 0, build(rootId, recursionDepth)];
  }

  GetGroupProperties(ids, propertyNames) {
    const model = this._model();
    const out = [];
    for (const id of ids) {
      const node = model.nodes.get(id);
      if (node) out.push([id, propertiesFor(node, propertyNames)]);
    }
    return out;
  }

  GetProperty(id, name) {
    const node = this._node(id);
    const props = node ? propertiesFor(node, [name]) : {};
    return props[name] ?? new Variant('s', '');
  }

  Event(id, eventId, _data, _timestamp) {
    if (eventId === 'clicked') {
      const node = this._node(id);
      if (node && node.command) {
        this._onCommand(node.command);
      }
    }
    // outSignature '' — return nothing.
  }

  EventGroup(events) {
    const idErrors = [];
    for (const event of events) {
      const [id, eventId] = event;
      const node = this._node(id);
      if (!node) {
        idErrors.push(id);
        continue;
      }
      if (eventId === 'clicked' && node.command) {
        this._onCommand(node.command);
      }
    }
    return idErrors;
  }

  AboutToShow(id) {
    // The tree is prebuilt, so a submenu never needs a just-in-time refresh — return false ("no
    // update needed"). We still surface the call: the FIRST AboutToShow from plasmashell is proof
    // the Plasma global menu has actually adopted our window.
    this._onAboutToShow(id);
    return false;
  }

  AboutToShowGroup(ids) {
    for (const id of ids) this._onAboutToShow(id);
    return [[], []]; // updatesNeeded, idErrors
  }

  // --- signals (calling these emits on the bus) ---
  LayoutUpdated(revision, parent) { return [revision >>> 0, parent]; }
  ItemsPropertiesUpdated(updated, removed) { return [updated, removed]; }
  ItemActivationRequested(id, timestamp) { return [id, timestamp >>> 0]; }
}

SignalLoomDbusMenu.configureMembers({
  properties: {
    Version: { signature: 'u', access: dbusInterface.ACCESS_READ },
    TextDirection: { signature: 's', access: dbusInterface.ACCESS_READ },
    Status: { signature: 's', access: dbusInterface.ACCESS_READ },
    IconThemePath: { signature: 'as', access: dbusInterface.ACCESS_READ },
  },
  methods: {
    GetLayout: { inSignature: 'iias', outSignature: 'u(ia{sv}av)' },
    GetGroupProperties: { inSignature: 'aias', outSignature: 'a(ia{sv})' },
    GetProperty: { inSignature: 'is', outSignature: 'v' },
    Event: { inSignature: 'isvu', outSignature: '' },
    EventGroup: { inSignature: 'a(isvu)', outSignature: 'ai' },
    AboutToShow: { inSignature: 'i', outSignature: 'b' },
    AboutToShowGroup: { inSignature: 'ai', outSignature: 'aiai' },
  },
  signals: {
    LayoutUpdated: { signature: 'ui' },
    ItemsPropertiesUpdated: { signature: 'a(ia{sv})a(ias)' },
    ItemActivationRequested: { signature: 'iu' },
  },
});

module.exports = {
  SignalLoomDbusMenu,
  DBUS_MENU_INTERFACE,
  propertiesFor,
};
