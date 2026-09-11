#!/usr/bin/env bash
# Install (or upgrade) the Signal Loom Global Menu Plasma applet.
#
# Usage:  ./install.sh            # install/upgrade for the current user
#         ./install.sh --remove   # uninstall
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_id="org.signalloom.panelmenu"

tool="$(command -v kpackagetool6 || true)"
[ -n "$tool" ] || tool="$(command -v kpackagetool5 || true)"
if [ -z "$tool" ]; then
    echo "error: kpackagetool6 not found. Install it with your package manager, e.g.:" >&2
    echo "  Arch/Manjaro:  sudo pacman -S plasma-sdk" >&2
    echo "  Debian/Ubuntu: sudo apt install plasma-sdk" >&2
    exit 1
fi

if [ "${1:-}" = "--remove" ]; then
    "$tool" --type Plasma/Applet --remove "$plugin_id"
    echo "Removed $plugin_id. Restart plasmashell to drop it from the panel."
    exit 0
fi

if "$tool" --type Plasma/Applet --list 2>/dev/null | grep -qx "$plugin_id"; then
    echo "Upgrading $plugin_id ..."
    "$tool" --type Plasma/Applet --upgrade "$here"
else
    echo "Installing $plugin_id ..."
    "$tool" --type Plasma/Applet --install "$here"
fi

cat <<'DONE'

Installed. Next:
  1. Right-click your panel → "Add or Manage Widgets…" → search "Signal Loom Global Menu" → add it.
     (If it doesn't show up yet, restart the shell:  kquitapp6 plasmashell && kstart plasmashell)
  2. Launch Signal Loom with the panel-menu service enabled — this does NOT force XWayland:
       SIGNAL_LOOM_ELECTRON_PANEL_MENU=1 signal-loom
  3. Focus a Signal Loom window; its menu (File, Edit, View, …) appears in the panel.

See README.md for troubleshooting.
DONE
