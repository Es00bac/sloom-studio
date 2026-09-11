#!/usr/bin/env bash
# Installs Sloom Studio as a real desktop app: packages the current code with
# electron-builder, syncs the unpacked build into a stable install dir, and
# points the application-menu entry at the installed binary. Re-run after any
# change to refresh the installed app (or `--no-build` to just re-sync/repoint).
set -euo pipefail

self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || realpath -- "${BASH_SOURCE[0]}")"
script_dir="$(cd -- "$(dirname -- "$self")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
bin_dir="${HOME}/.local/bin"
desktop_dir="${HOME}/.local/share/applications"
icon_dir="${HOME}/.local/share/icons/hicolor/512x512/apps"
install_dir="${SIGNAL_LOOM_INSTALL_DIR:-${HOME}/.local/opt/signal-loom}"
bin_target="${bin_dir}/signal-loom-electron"
desktop_target="${desktop_dir}/signal-loom.desktop"
unpacked="${project_root}/release/linux-unpacked"

is_installed_app_running() {
  local executable="${install_dir}/signal-loom"
  ps -u "$(id -u)" -o args= 2>/dev/null \
    | awk -v executable="$executable" '$1 == executable { found = 1 } END { exit(found ? 0 : 1) }'
}

require_installed_app_stopped() {
  if is_installed_app_running; then
    echo "Sloom Studio is still running from ${install_dir}." >&2
    echo "Close Sloom Studio completely before installing; the existing build was left unchanged." >&2
    exit 3
  fi
}

build=1
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    *) echo "Unknown option: $arg (supported: --no-build)" >&2; exit 2 ;;
  esac
done

# Replacing app.asar under a live Electron main process lets a later workspace
# window combine old main/preload code with a new renderer. Fail before doing
# build work, then check again immediately before the installed tree changes.
require_installed_app_stopped

if [ "$build" -eq 1 ]; then
  (cd "$project_root" && npm run build && npm run prepare:font-library && npx electron-builder --linux dir)
fi

if [ ! -x "${unpacked}/signal-loom" ]; then
  echo "No unpacked build at ${unpacked} — run without --no-build first." >&2
  exit 1
fi

require_installed_app_stopped

mkdir -p "$bin_dir" "$desktop_dir" "$icon_dir" "$install_dir"
rsync -a --delete "${unpacked}/" "${install_dir}/"

# Keep the dev wrapper on PATH for terminal use; the menu entry below no
# longer depends on it.
ln -sfn "$project_root/scripts/signal-loom-electron" "$bin_target"
chmod +x "$project_root/scripts/signal-loom-electron"

icon_src="$project_root/build/icons/icon.png"
icon_theme_dir="${HOME}/.local/share/icons/hicolor"
if [ -f "$icon_src" ]; then
  # Install the CURRENT logo at every standard menu size, overwriting any stale
  # icons from older installs (a leftover old-logo PNG in one size dir is a common
  # cause of the menu showing the wrong icon). Downscale from the source when a
  # resizer is available; otherwise drop the source in at each size.
  for size in 32 48 64 128 256 512; do
    size_dir="${icon_theme_dir}/${size}x${size}/apps"
    mkdir -p "$size_dir"
    if command -v magick >/dev/null 2>&1; then
      magick "$icon_src" -resize "${size}x${size}" "${size_dir}/signal-loom.png"
    elif command -v convert >/dev/null 2>&1; then
      convert "$icon_src" -resize "${size}x${size}" "${size_dir}/signal-loom.png"
    else
      install -m 644 "$icon_src" "${size_dir}/signal-loom.png"
    fi
  done
  # Rebuild the icon-theme cache so the menu/taskbar pick up the NEW icon instead
  # of a stale cached name→file mapping (the real "wrong icon" culprit).
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$icon_theme_dir" >/dev/null 2>&1 || true
  fi
fi

cat > "$desktop_target" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Sloom Studio
GenericName=Multimedia Editor
Comment=Multimedia editor, media flow builder, and timeline editor
Exec=env SIGNAL_LOOM_ELECTRON_PANEL_MENU=1 ${install_dir}/signal-loom %U
Icon=signal-loom
Terminal=false
MimeType=application/x-sloom;application/x-slppr;x-scheme-handler/signal-loom;
Categories=AudioVideo;AudioVideoEditing;
Keywords=video;audio;multimedia;editor;timeline;comic;manga;publishing;
StartupNotify=true
StartupWMClass=signal-loom
DESKTOP

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
fi

if command -v xdg-desktop-menu >/dev/null 2>&1; then
  xdg-desktop-menu forceupdate >/dev/null 2>&1 || true
fi

# Refresh KDE Plasma's service cache so the menu entry + icon update without a re-login.
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 >/dev/null 2>&1 || true
fi

version="$(node -e "const { formatInternalBuildVersion } = require('${project_root}/electron/version-display.cjs'); process.stdout.write(formatInternalBuildVersion(require('${project_root}/package.json').version))" 2>/dev/null || echo '?')"
printf 'Installed Sloom Studio %s to %s (menu entry: %s)\n' "$version" "$install_dir" "$desktop_target"
