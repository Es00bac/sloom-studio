# Copyright 2026 Sloom Software LLC
# Distributed under the terms of the GNU General Public License v2 or later

EAPI=8

ECM_QTHELP="false"
KFMIN=6.0.0
QTMIN=6.6.0
inherit ecm

DESCRIPTION="KDE Plasma 6 Global Menu applet that also serves Sloom Studio's native-Wayland menus"
HOMEPAGE="https://github.com/Es00bac/sloom-studio"
SRC_URI="https://github.com/Es00bac/sloom-studio/releases/download/globalmenu-v${PV}/sloom-globalmenu-${PV}.tar.gz"
S="${WORKDIR}/sloom-globalmenu-${PV}"

# Stock plasma-workspace appmenu applet (GPL-2+ / LGPL-2.1+) plus the vendored libdbusmenuqt (LGPL-2.1+).
LICENSE="GPL-2+ LGPL-2.1+"
SLOT="0"
KEYWORDS="~amd64"

# libtaskmanager's ABI must match the vendored headers (plasma-workspace 6.6 series).
DEPEND="
	>=dev-qt/qtbase-${QTMIN}:6[dbus,gui,widgets]
	>=dev-qt/qtdeclarative-${QTMIN}:6
	>=kde-frameworks/kconfig-${KFMIN}:6
	>=kde-frameworks/kcoreaddons-${KFMIN}:6
	>=kde-frameworks/ki18n-${KFMIN}:6
	>=kde-frameworks/ksvg-${KFMIN}:6
	>=kde-frameworks/kwindowsystem-${KFMIN}:6
	>=kde-plasma/libplasma-6.0:6
	>=kde-plasma/plasma-workspace-6.6:6
	<kde-plasma/plasma-workspace-6.7
"
RDEPEND="${DEPEND}"
BDEPEND=">=kde-frameworks/extra-cmake-modules-${KFMIN}"

pkg_postinst() {
	ecm_pkg_postinst
	elog "Add 'Sloom Studio Global Menu (Universal)' to a Plasma panel and remove the stock"
	elog "Global Menu widget. Launch Sloom Studio with SIGNAL_LOOM_ELECTRON_PANEL_MENU=1"
	elog "(the installed desktop entry does this) so it exports its menu over D-Bus."
}
