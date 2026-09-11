# Copyright 2026 Sloom Software LLC
# Distributed under the terms of the GNU General Public License v3 or later

EAPI=8

inherit desktop xdg

DESCRIPTION="Local-first creative suite: illustration, comic and book layout, video (binary build)"
HOMEPAGE="https://sloom.studio https://github.com/Es00bac/sloom-studio"
SRC_URI="https://github.com/Es00bac/sloom-studio/releases/download/v${PV}/sloom-studio-${PV}-linux-x64.tar.zst"
S="${WORKDIR}/sloom-studio-${PV}-linux-x64"

LICENSE="GPL-3+ MIT BSD OFL-1.1 Apache-2.0 LGPL-2.1+"
SLOT="0"
KEYWORDS="-* ~amd64"
IUSE="+globalmenu"
RESTRICT="bindist mirror strip"

RDEPEND="
	!media-gfx/sloom-studio
	app-accessibility/at-spi2-core
	dev-libs/expat
	dev-libs/nss
	media-libs/alsa-lib
	media-libs/mesa
	sys-apps/dbus
	x11-libs/cairo
	x11-libs/gtk+:3
	x11-libs/libdrm
	x11-libs/libxkbcommon
	x11-libs/libXcomposite
	x11-libs/libXdamage
	x11-libs/libXrandr
	x11-libs/pango
	globalmenu? ( kde-plasma/sloom-globalmenu )
"

QA_PREBUILT="opt/sloom-studio/*"

src_install() {
	insinto /opt/sloom-studio
	doins -r .
	fperms 0755 /opt/sloom-studio/sloom-studio /opt/sloom-studio/chrome_crashpad_handler
	fperms 4755 /opt/sloom-studio/chrome-sandbox
	dosym ../../opt/sloom-studio/sloom-studio /usr/bin/sloom-studio

	newicon -s 256 "${FILESDIR}/sloom-studio-256.png" sloom-studio.png
	newicon -s scalable "${FILESDIR}/sloom-studio.svg" sloom-studio.svg
	domenu "${FILESDIR}/sloom-studio.desktop"
}

pkg_postinst() {
	xdg_pkg_postinst
	elog "Sloom Studio (free software edition). The Tiltmark brush engine is not included;"
	elog "the Image workspace uses the built-in Studio engine."
	elog "On KDE Plasma, add the 'Sloom Studio Global Menu (Universal)' widget to a panel"
	elog "to get the application menu on native Wayland with GPU acceleration intact."
}
