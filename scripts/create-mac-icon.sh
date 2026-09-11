#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
source_png="${1:-"$repo_root/build/icons/icon.png"}"
output_icns="${2:-"$repo_root/build/icon.icns"}"

if ! command -v sips >/dev/null 2>&1 || ! command -v iconutil >/dev/null 2>&1; then
  echo "create-mac-icon.sh must run on macOS because it requires sips and iconutil." >&2
  exit 1
fi

if [[ ! -f "$source_png" ]]; then
  echo "Source icon not found: $source_png" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
iconset="$tmp_dir/icon.iconset"
mkdir -p "$iconset" "$(dirname "$output_icns")"

sips -z 16 16 "$source_png" --out "$iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$source_png" --out "$iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$source_png" --out "$iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$source_png" --out "$iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$source_png" --out "$iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$source_png" --out "$iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$source_png" --out "$iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$source_png" --out "$iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$source_png" --out "$iconset/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$source_png" --out "$iconset/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$iconset" -o "$output_icns"
rm -rf "$tmp_dir"
echo "Created $output_icns"
