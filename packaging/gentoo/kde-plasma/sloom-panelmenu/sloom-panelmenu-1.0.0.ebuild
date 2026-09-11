# Copyright 2026 Sloom Software LLC
# Distributed under the terms of the MIT license

EAPI=8

DESCRIPTION="Lightweight QML-only Plasma 6 applet showing Sloom Studio's menu bar over D-Bus"
HOMEPAGE="https://github.com/Es00bac/sloom-studio"
SRC_URI="https://github.com/Es00bac/sloom-studio/releases/download/v0.9.16/sloom-panelmenu-${PV}.tar.gz"
S="${WORKDIR}/sloom-panelmenu-${PV}"

LICENSE="MIT"
SLOT="0"
KEYWORDS="~amd64"

RDEPEND=">=kde-plasma/libplasma-6.0:6"

src_install() {
	insinto /usr/share/plasma/plasmoids/org.signalloom.panelmenu
	doins -r contents metadata.json
}
