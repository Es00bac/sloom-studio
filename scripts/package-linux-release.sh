#!/usr/bin/env bash
# Build every Linux distributable of the free-software edition and the tarballs the Gentoo ebuilds
# and Arch PKGBUILDs in packaging/ download. Run from the repository root.
#
#   scripts/package-linux-release.sh            # web build, font library, AppImage + deb + rpm, tarballs
#   scripts/package-linux-release.sh --no-build # skip npm run build / electron-builder, only re-tar
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
version="$(node -p "require('./package.json').version")"
tag_version="${version%%-*}"          # 0.9.16-b -> 0.9.16 (ebuild / PKGBUILD version)
out="$root/release"
artifacts="$out/artifacts"
mkdir -p "$artifacts"

if [ "${1:-}" != "--no-build" ]; then
  npm run build
  npm run prepare:font-library
  targets="AppImage deb"
  command -v rpmbuild >/dev/null 2>&1 && targets="$targets rpm" || echo "rpmbuild not found; skipping the .rpm target (emerge app-arch/rpm to enable it)"
  # shellcheck disable=SC2086
  npx electron-builder --linux $targets --publish never
fi

# Binary tarball consumed by media-gfx/sloom-studio-bin and sloom-studio-bin (Arch).
tar --zstd -cf "$artifacts/sloom-studio-${tag_version}-linux-x64.tar.zst" \
  --transform "s|^linux-unpacked|sloom-studio-${tag_version}-linux-x64|" -C "$out" linux-unpacked

# KDE applets, with the directory names the packaging expects.
tar -czf "$artifacts/sloom-globalmenu-1.0.0.tar.gz" \
  --exclude=build --transform 's|^signal-loom-globalmenu|sloom-globalmenu-1.0.0|' -C "$root/desktop/kde" signal-loom-globalmenu
tar -czf "$artifacts/sloom-panelmenu-1.0.0.tar.gz" \
  --transform 's|^signal-loom-panelmenu|sloom-panelmenu-1.0.0|' -C "$root/desktop/kde" signal-loom-panelmenu

for f in "$out"/*.AppImage "$out"/*.deb "$out"/*.rpm; do [ -e "$f" ] && cp -f "$f" "$artifacts/"; done
(cd "$artifacts" && sha256sum -- * > SHA256SUMS)
echo "artifacts in $artifacts:"; ls -la "$artifacts"
