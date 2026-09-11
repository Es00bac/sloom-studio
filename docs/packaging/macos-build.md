# Sloom Studio macOS build process

> **Current-source baseline:** `0.9.16-b`, August 27, 2026.

Sloom Studio is configured for macOS packages from this repository. Final DMG creation, code
signing, and notarization must run on macOS. Linux can make an unsigned ZIP with
`npm run dist:mac:zip`, but cannot replace the macOS signing/notarization process and may not be
able to make a DMG because Electron Builder uses Apple utilities such as `sips`.

This is a build recipe, not evidence of a shipped notarized artifact. A macOS artifact may be
called a signed/notarized release only after the exact Mac build, signing, notarization, and
launch checks have completed and their evidence is recorded.

## Unsigned Local macOS Build

Run these commands on a Mac with Xcode Command Line Tools installed:

```bash
npm ci
npm run icons:mac
npm run dist:mac
```

This creates Sloom Studio DMG and ZIP artifacts under Electron Builder's configured output path.
The icon helper creates `build/icon.icns` from the shared PNG icon before Electron Builder packages
the app.

## Signed and Notarized Build

Use a Developer ID Application certificate in the login keychain, then export the notarization credentials before running the same build:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=true
export APPLE_ID="developer@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID1234"

npm ci
npm run icons:mac
npm run dist:mac
```

The Electron Builder macOS config enables hardened runtime and uses
`build/mac/entitlements.mac.plist` for Electron-compatible JIT, native module loading,
user-selected file access, and network client access. Keep Apple credentials outside the
repository; never place them in source, project files, or documentation examples.

## Linux Fallback

From Linux, use:

```bash
npm run dist:mac:zip
```

That path is useful for packaging smoke checks and dependency bundling, but it does not replace a
signed and notarized macOS build created on macOS. Linux can only smoke-check the unsigned ZIP path
and cannot prove Gatekeeper behavior, signing identity, notarization, or launch behavior on a Mac.
