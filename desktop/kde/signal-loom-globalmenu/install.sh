#!/usr/bin/env bash
# Build + install the Signal Loom Global Menu (Universal) — a fork of KDE's stock Global Menu applet
# (plasma-workspace v6.6.5) that additionally serves Signal Loom's D-Bus menu for its native-Wayland
# windows. Installs user-locally (no root, system packages untouched).
#
# Usage:  ./install.sh            # build + install + wire env + restart plasmashell
#         ./install.sh --remove   # uninstall
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_dir="${here}/build"
prefix="${HOME}/.local"
plugin_so="${prefix}/lib/qt6/plugins/plasma/applets/org.signalloom.globalmenu.so"
env_conf="${HOME}/.config/environment.d/90-signal-loom-globalmenu.conf"

if [ "${1:-}" = "--remove" ]; then
    rm -f "$plugin_so" "$env_conf"
    systemctl --user restart plasma-plasmashell.service || true
    echo "Removed. (QT_PLUGIN_PATH env entry cleared; remove the widget from the panel if still placed.)"
    exit 0
fi

for tool in cmake ninja g++; do
    command -v "$tool" >/dev/null || { echo "error: $tool missing (pacman -S cmake ninja gcc extra-cmake-modules)"; exit 1; }
done

cmake -S "$here" -B "$build_dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" \
    -DKDE_INSTALL_PLUGINDIR=lib/qt6/plugins \
    -DKDE_INSTALL_QMLDIR=lib/qt6/qml
cmake --build "$build_dir"
cmake --install "$build_dir"

# plasmashell is a systemd user service: put the user-local plugin dir on its search path,
# both persistently (environment.d, read at session start) and immediately (set-environment).
mkdir -p "$(dirname "$env_conf")"
printf 'QT_PLUGIN_PATH=%s/lib/qt6/plugins\n' '${HOME}/.local' | sed 's|\${HOME}|'"$HOME"'|' > "$env_conf"
systemctl --user set-environment QT_PLUGIN_PATH="${prefix}/lib/qt6/plugins"
systemctl --user restart plasma-plasmashell.service

cat <<'DONE'

Installed. Add the widget: right-click a panel → Add or Manage Widgets → "Signal Loom Global Menu (Universal)".
It replaces the stock Global Menu 1:1 (Qt, GTK via appmenu-gtk-module, XWayland) and additionally shows
Signal Loom's per-workspace menus when the app runs with SIGNAL_LOOM_ELECTRON_PANEL_MENU=1
(the installed signal-loom.desktop launcher sets this). No XWayland is forced — GPU stays on.
DONE
