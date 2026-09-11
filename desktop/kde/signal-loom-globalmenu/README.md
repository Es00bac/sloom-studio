# Signal Loom Global Menu (Universal) — KDE Plasma 6 applet

A fork of KDE's stock **Global Menu** applet (`org.kde.plasma.appmenu`, plasma-workspace v6.6.5) with
one added behavior: it also shows **Signal Loom's** menus — which the stock applet never can, because
Signal Loom runs as a **native-Wayland** Electron app and Chromium never registers a menu with KWin.

One widget, truly global:

| Focused app | Where its menu comes from | Changed vs stock? |
|---|---|---|
| Qt/KDE apps | KWin appmenu protocol → importer | identical |
| GTK apps | `appmenu-gtk-module` → registrar | identical |
| XWayland apps | X11 registrar | identical |
| **Signal Loom** | `org.signalloom.PanelMenu` D-Bus service at `/org/signalloom/menus/active` | **the added fallback** |

The fallback triggers only when the focused window has *no* native appmenu, its app id matches Signal
Loom, and the service is on the bus — so it cannot affect any other application. Signal Loom publishes
**per-workspace menus** (Flow/Image/Paper/Video each have their own full set, switched live on window
focus, with `LayoutUpdated` re-fetch), exactly like four separate applications. No XWayland is involved
anywhere: hardware acceleration stays on.

## Build & install

```bash
./install.sh        # needs: cmake ninja gcc extra-cmake-modules (+ the KDE dev headers Manjaro ships)
./install.sh --remove
```

Installs user-locally (`~/.local/lib/qt6/plugins/plasma/applets/`) and wires `QT_PLUGIN_PATH` for the
plasmashell systemd user service via `~/.config/environment.d/`. Root never required; the system
package stays untouched.

Then add **“Signal Loom Global Menu (Universal)”** to a panel (far left is the classic spot) and remove
the stock Global Menu widget if present — this one does everything it does.

App side: launch Signal Loom with `SIGNAL_LOOM_ELECTRON_PANEL_MENU=1` (the installed
`signal-loom.desktop` sets this). The flag exports the menu service only — it does **not** force
XWayland (`shouldForceXWaylandForGlobalMenu` doesn't know it).

## What was changed (vs plasma-workspace v6.6.5)

Only `appmenumodel.cpp`:
1. `onActiveWindowChanged()` — the fallback described above (~25 lines).
2. Constructor — a `QDBusServiceWatcher` on `org.signalloom.PanelMenu` so a Signal Loom window that is
   already focused when the app starts (or quits) gets its menu attached/detached immediately.

Everything else — `appmenuapplet.cpp`, all QML, the config schema — is verbatim stock, so behavior,
styling, keyboard navigation, and the Wayland search feature are pixel-identical. The
`third_party/` sources (libdbusmenuqt vendored per upstream's own build; libtaskmanager headers only,
linked against the system `libtaskmanager.so.6` of the exact same version) come from the same
plasma-workspace v6.6.5 tag.

## Version note

The vendored sources match plasma-workspace **6.6.5**. After a major Plasma upgrade, re-fetch the
applet sources from the matching tag, re-apply the (tiny) patch, and rebuild — or just rebuild first;
the libtaskmanager ABI is the usual break point.

## License

GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL — same as upstream, with SPDX headers and
modification notices preserved. This directory is GPL-licensed KDE-derived code, independent of (and
not linked into) the Signal Loom application; the app only talks to it over D-Bus.
