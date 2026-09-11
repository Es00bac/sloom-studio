// A recursive QtQuick.Controls Menu built at runtime from Signal Loom's panel-menu JSON.
//
// Each entry is { label, separator?, enabled?, command?, shortcut?, children? }. Leaves emit
// `activated(command)`; submenus are nested SlMenus whose `activated` bubbles up. Rebuilds itself
// whenever `items` changes. No C++ and no compiled plugin — pure QML so it installs with kpackagetool.

import QtQuick
import QtQuick.Controls as QQC2

QQC2.Menu {
    id: menu

    // Array of menu-entry objects (see above). Assign, and the menu repopulates.
    property var items: []
    // Emitted with the command id when the user clicks a leaf item anywhere in this tree.
    signal activated(string command)

    // Lazily built at runtime for nested submenus — a submenu is another SlMenu, and QML forbids a
    // component from statically instantiating its own type (see rebuild()).
    property var _subMenuComponent: null

    onItemsChanged: rebuild()
    Component.onCompleted: rebuild()

    function rebuild() {
        while (menu.count > 0) {
            menu.takeItem(0).destroy();
        }
        var list = items || [];
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            if (!entry) {
                continue;
            }
            if (entry.separator) {
                menu.addItem(separatorComponent.createObject(menu));
            } else if (entry.children && entry.children.length) {
                // A submenu is another SlMenu. QML rejects a component that statically instantiates its
                // own type ("SlMenu is instantiated recursively"), so load it by URL at RUNTIME — the
                // type is fully registered by then, so the compile-time recursion check doesn't apply.
                if (menu._subMenuComponent === null) {
                    menu._subMenuComponent = Qt.createComponent(Qt.resolvedUrl("SlMenu.qml"));
                }
                if (menu._subMenuComponent.status === Component.Ready) {
                    var sub = menu._subMenuComponent.createObject(menu, {
                        title: entry.label || "",
                        items: entry.children,
                    });
                    sub.activated.connect(menu.activated);
                    menu.addMenu(sub);
                }
            } else {
                menu.addItem(itemComponent.createObject(menu, {
                    text: entry.label || "",
                    enabled: entry.enabled !== false,
                    command: entry.command || "",
                    shortcutText: entry.shortcut || "",
                }));
            }
        }
    }

    Component {
        id: separatorComponent
        QQC2.MenuSeparator {}
    }

    Component {
        id: itemComponent
        QQC2.MenuItem {
            property string command: ""
            property string shortcutText: ""
            // Show the accelerator right-aligned, greyed — the panel menu is display-only (the real
            // shortcut is still handled by the focused Signal Loom window, not by this applet).
            QQC2.Label {
                anchors.right: parent.right
                anchors.rightMargin: 12
                anchors.verticalCenter: parent.verticalCenter
                text: parent.shortcutText
                opacity: 0.5
                visible: text.length > 0
            }
            // `menu` is in scope here because this Component is declared inside the SlMenu instance.
            onTriggered: if (command.length > 0) menu.activated(command)
        }
    }

}
