# Linux Build Notes

> **Current-source baseline:** `0.9.16-b`, August 27, 2026. These commands describe configured
> targets; a release exists only after the exact artifacts pass package and launch verification.

## Linux host limitation

Linux can build the configured Linux packages and can smoke-check some cross-platform packaging paths, but it cannot produce the final signed/notarized macOS app package.

Configured Linux package targets:

- `AppImage`
- `deb`

Run:

```bash
npm run dist:linux
```

Linux can also run `npm run dist:mac:zip` as an unsigned macOS ZIP smoke check, but that does not replace the macOS packaging process documented in [macOS Build Process](./macos-build.md).
