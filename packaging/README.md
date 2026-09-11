# Packaging

Everything here targets the free-software edition built from this repository.

| Path | What |
|---|---|
| `sloom-studio.desktop` | Desktop entry. Sets `SIGNAL_LOOM_ELECTRON_PANEL_MENU=1` so the app exports its menu bar over D-Bus for the Plasma applets. |
| `gentoo/` | A Portage overlay: `media-gfx/sloom-studio-bin` (prebuilt Electron app into `/opt`), `kde-plasma/sloom-globalmenu` (the forked KDE Global Menu applet, built from source with ECM), `kde-plasma/sloom-panelmenu` (QML-only applet). |
| `arch/` | `PKGBUILD`s for the same three packages. |

Release artifacts the ebuilds and PKGBUILDs download are produced by `scripts/package-linux-release.sh`
(AppImage, `.deb`, `.rpm`, the `/opt` tarball, the two applet tarballs, and `SHA256SUMS`) under `release/artifacts/`.

## Try the Gentoo overlay locally

```
sudo mkdir -p /var/db/repos/sloom
sudo cp -r packaging/gentoo/. /var/db/repos/sloom/
printf '[sloom]\nlocation = /var/db/repos/sloom\nmasters = gentoo\nauto-sync = no\n' | sudo tee /etc/portage/repos.conf/sloom.conf
# until a GitHub release exists, point the ebuild at the local tarball:
sudo cp release/artifacts/sloom-studio-0.9.16-linux-x64.tar.zst release/artifacts/sloom-globalmenu-1.0.0.tar.gz /var/cache/distfiles/
(cd /var/db/repos/sloom/media-gfx/sloom-studio-bin && sudo ebuild sloom-studio-bin-0.9.16.ebuild manifest)
(cd /var/db/repos/sloom/kde-plasma/sloom-globalmenu && sudo ebuild sloom-globalmenu-1.0.0.ebuild manifest)
sudo emerge -av media-gfx/sloom-studio-bin
```

## Try without installing anything

```
./release/Sloom\ Studio-*.AppImage
```

The KDE applet can also be installed per-user, no root: `desktop/kde/signal-loom-globalmenu/install.sh`.
