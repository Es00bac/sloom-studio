// Signal Loom Global Menu — a KDE Plasma 6 panel applet that renders Signal Loom's application menu
// in the panel WITHOUT XWayland.
//
// The stock KDE global-menu applet learns a window's menu from the AppMenu registrar, which is keyed on
// an X11 window id — so an Electron app has to force XWayland to use it, and on AMD/Mesa that drops the
// GPU to software. This applet sidesteps all of that: Signal Loom (running native-Wayland, GPU intact)
// publishes the focused workspace's menu over a plain `org.signalloom.PanelMenu` D-Bus service, and this
// applet polls that service and draws the menu. No X11 window id, no XWayland, full hardware
// acceleration — plus the menu in the panel.
//
// Everything talks to the service through `gdbus` (ships with glib2, present on every KDE install) run
// via the executable data engine, so the applet needs no compiled plugin and installs with kpackagetool.

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.plasma5support as Plasma5Support

PlasmoidItem {
    id: root

    readonly property string dbusDest: "org.signalloom.PanelMenu"
    readonly property string dbusPath: "/org/signalloom/PanelMenu"
    readonly property string dbusIface: "org.signalloom.PanelMenu"
    readonly property int pollMs: 350

    // Service state.
    property bool serviceActive: false      // a Signal Loom window is focused
    property int menuRevision: -1           // last menu revision we fetched
    property var menuGroups: []             // [{ label, children:[…] }]
    property int openPopups: 0              // keep the bar visible while a menu is open
    readonly property bool barVisible: serviceActive || openPopups > 0

    preferredRepresentation: fullRepresentation

    // ── gdbus plumbing ───────────────────────────────────────────────────────────────────────────
    Plasma5Support.DataSource {
        id: runner
        engine: "executable"
        connectedSources: []
        onNewData: function (source, data) {
            runner.disconnectSource(source);
            var out = (data && data["stdout"]) ? String(data["stdout"]) : "";
            if (source.indexOf(".State") !== -1) {
                root.handleState(root.unwrap(out));
            } else if (source.indexOf(".GetMenu") !== -1) {
                root.handleMenu(root.unwrap(out));
            }
        }
        function run(cmd) { connectSource(cmd); }
    }

    function gdbus(method, arg) {
        var cmd = "gdbus call --session --dest " + dbusDest
                + " --object-path " + dbusPath
                + " --method " + dbusIface + "." + method;
        if (arg !== undefined) {
            cmd += " " + shquote(arg);
        }
        return cmd;
    }
    function shquote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }

    // gdbus prints a GVariant tuple: ('<payload>',)  →  return <payload>.
    function unwrap(raw) {
        if (!raw) return "";
        var match = String(raw).match(/^\(\s*'([\s\S]*)'\s*,\s*\)\s*$/);
        return match ? match[1] : String(raw).trim();
    }

    function poll() { runner.run(gdbus("State")); }

    function handleState(payload) {
        var parts = String(payload).split(":");
        if (parts.length < 2) { root.serviceActive = false; return; }
        root.serviceActive = (parts[0] === "1");
        var rev = parseInt(parts[1], 10);
        if (root.serviceActive && rev !== root.menuRevision) {
            root.menuRevision = rev;
            runner.run(gdbus("GetMenu"));
        }
    }

    function handleMenu(base64) {
        try {
            var parsed = JSON.parse(b64decode(base64));
            root.menuGroups = (parsed && parsed.groups) ? parsed.groups : [];
        } catch (err) {
            root.menuGroups = [];
        }
    }

    function activate(command) {
        if (command && command.length > 0) {
            runner.run(gdbus("Activate", command));
        }
    }

    // QML's JS engine has no atob(); decode base64 → UTF-8 by hand.
    function b64decode(input) {
        var table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var str = String(input).replace(/[^A-Za-z0-9+/=]/g, "");
        var bytes = "";
        var i = 0;
        while (i < str.length) {
            var b1 = table.indexOf(str.charAt(i++));
            var b2 = table.indexOf(str.charAt(i++));
            var b3 = table.indexOf(str.charAt(i++));
            var b4 = table.indexOf(str.charAt(i++));
            bytes += String.fromCharCode((b1 << 2) | (b2 >> 4));
            if (b3 !== 64 && b3 !== -1) bytes += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
            if (b4 !== 64 && b4 !== -1) bytes += String.fromCharCode(((b3 & 3) << 6) | b4);
        }
        try { return decodeURIComponent(escape(bytes)); } catch (err) { return bytes; }
    }

    Timer {
        interval: root.pollMs
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.poll()
    }

    // ── the panel menu bar ───────────────────────────────────────────────────────────────────────
    fullRepresentation: RowLayout {
        id: bar
        spacing: 0
        visible: root.barVisible
        Layout.preferredWidth: root.barVisible ? implicitWidth : 0

        Repeater {
            model: root.menuGroups
            delegate: PlasmaComponents3.ToolButton {
                id: groupButton
                required property var modelData
                text: modelData.label || ""
                flat: true

                onClicked: {
                    groupMenu.items = modelData.children || [];
                    groupMenu.popup(groupButton, 0, groupButton.height);
                }

                SlMenu {
                    id: groupMenu
                    onActivated: function (command) { root.activate(command); }
                    onOpened: root.openPopups += 1
                    onClosed: root.openPopups = Math.max(0, root.openPopups - 1)
                }
            }
        }
    }
}
