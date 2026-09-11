# Signal Loom Global Menu (Universal) — fork of plasma-workspace v6.6.5 applets/appmenu.
#
# A standalone out-of-tree build of KDE's stock Global Menu applet with one added behavior: when the
# focused window is Signal Loom (native Wayland, so it can never register a menu with KWin) and Signal
# Loom's org.signalloom.PanelMenu D-Bus service is up, the applet imports Signal Loom's
# com.canonical.dbusmenu object. Everything else is byte-identical stock behavior, so this single
# widget serves Qt apps, GTK apps (via appmenu-gtk-module), XWayland apps — and Signal Loom.
#
# Two vendored pieces (both from the same plasma-workspace v6.6.5 tag, licenses preserved):
#   third_party/libdbusmenuqt/    — the DBusMenu importer plasma-workspace builds as a static lib
#   third_party/libtaskmanager/   — HEADERS ONLY; we link the system libtaskmanager.so.6, which is the
#                                    exact same version, so the ABI matches by construction

cmake_minimum_required(VERSION 3.16)
project(signal-loom-globalmenu VERSION 1.0.0)

find_package(ECM 6.0 REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)
include(ECMQtDeclareLoggingCategory)

# plasma-workspace builds as C++20 (std::ranges etc.); match it.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Quick DBus)
# Config + Svg/KirigamiPlatform are pulled in transitively by Plasma's exported CMake targets.
find_package(KF6 REQUIRED COMPONENTS CoreAddons Config I18n WindowSystem Svg)
find_package(Plasma REQUIRED)

# ── libdbusmenuqt (static, vendored from plasma-workspace v6.6.5) ─────────────────────────────────
set(libdbusmenu_SRCS
    third_party/libdbusmenuqt/dbusmenuimporter.cpp
    third_party/libdbusmenuqt/dbusmenushortcut_p.cpp
    third_party/libdbusmenuqt/dbusmenutypes_p.cpp
    third_party/libdbusmenuqt/utils.cpp
    third_party/libdbusmenuqt/dbusmenuimporter.h
    third_party/libdbusmenuqt/dbusmenushortcut_p.h
    third_party/libdbusmenuqt/dbusmenutypes_p.h
)

ecm_qt_declare_logging_category(libdbusmenu_SRCS HEADER debug.h
    IDENTIFIER DBUSMENUQT
    CATEGORY_NAME org.kde.libdbusmenuqt
    DEFAULT_SEVERITY Info
    DESCRIPTION "libdbusmenu debug (signal-loom-globalmenu vendored copy)"
)

set_source_files_properties(third_party/libdbusmenuqt/com.canonical.dbusmenu.xml PROPERTIES
    NO_NAMESPACE true
    INCLUDE "dbusmenutypes_p.h"
    CLASSNAME DBusMenuInterface
)
qt_add_dbus_interface(libdbusmenu_SRCS third_party/libdbusmenuqt/com.canonical.dbusmenu.xml dbusmenu_interface)

add_library(dbusmenuqt STATIC ${libdbusmenu_SRCS})
target_include_directories(dbusmenuqt PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/libdbusmenuqt
    ${CMAKE_CURRENT_BINARY_DIR}
)
target_link_libraries(dbusmenuqt PUBLIC Qt::DBus Qt::Widgets)
set_property(TARGET dbusmenuqt PROPERTY POSITION_INDEPENDENT_CODE ON)

# ── system libtaskmanager (exact-version ABI match with the vendored headers) ─────────────────────
find_library(TASKMANAGER_LIBRARY NAMES taskmanager REQUIRED)

# ── the applet ────────────────────────────────────────────────────────────────────────────────────
# Keep the upstream translation domain so the stock applet's installed .mo files translate this fork.
add_definitions(-DTRANSLATION_DOMAIN=\"plasma_applet_org.kde.plasma.appmenu\")

plasma_add_applet(org.signalloom.globalmenu
    QML_SOURCES
        qml/configGeneral.qml
        qml/config.qml
        qml/main.qml
        qml/MenuDelegate.qml
    CPP_SOURCES
        appmenuapplet.cpp
        appmenumodel.cpp
    RESOURCES
        main.xml
    QML_ARGS DEPENDENCIES QtCore org.kde.plasma.core
)

target_include_directories(org.signalloom.globalmenu PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/libtaskmanager
)

target_link_libraries(org.signalloom.globalmenu PRIVATE
    Qt::Core
    Qt::Widgets
    Qt::Quick
    Qt::DBus
    Plasma::Plasma
    KF6::WindowSystem
    KF6::I18n
    ${TASKMANAGER_LIBRARY}
    dbusmenuqt
)
