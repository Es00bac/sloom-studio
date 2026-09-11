# Sloom Studio Windows installer process

> **Current-source baseline:** `0.9.16-b`, August 27, 2026.

Sloom Studio is configured for a standard Windows NSIS installer through Electron Builder:

```bash
npm run dist:win
```

This repository describes packaging readiness only. Do not claim a signed installer artifact exists
until an actual release build produces it, its signature is verified, and it has been installed and
launched on the intended Windows target.

## Dependency Bundling Readiness

Windows packaging depends on these installed npm packages before packaging starts:

- `electron` for the desktop runtime
- `electron-builder` for the installer build

The configured packaging inputs are the renderer output, Electron entrypoints, shared code, and
package metadata. Inspect the current `package.json` Electron Builder `files` configuration before
releasing; do not infer a package manifest from an older document.

- `dist/**/*`
- `electron/**/*`
- `shared/**/*`
- `package.json`

Electron Builder is configured for NSIS and x64:

- `electron-builder --win nsis`
- `win.target = nsis`
- `win.arch = x64`

## Signing Caveat

Windows installer packaging can be prepared on Linux, but signing credentials and final validation
still need a Windows-oriented release step. NSIS packaging readiness does not by itself prove
SmartScreen reputation, Authenticode signing, installation/upgrade behavior, or final installer
verification. Keep code-signing credentials outside the repository and record the exact release
artifact hash with the release evidence.
