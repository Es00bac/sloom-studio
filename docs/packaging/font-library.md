# Bundled font artifact for desktop packages

> **Current-source baseline:** `0.9.16-b`, August 27, 2026. Release packaging must re-run the
> checks below against the exact candidate; this document is not proof that a particular artifact
> contains the fonts.

Desktop packages must include the audited Sloom font collection. A package is not valid merely because `build/font-library` is named in `extraResources`: the staged bytes must exist and match the approved inventory.

## Immutable source recipe

The redistributable source lock is `resources/font-pack/source-artifact.json`. It identifies font-pack revision `31507e786066f973e1b01fb479d6d718cd433a6c`, Google Fonts commit `26c5c976d82d50c24a8f0a7ac455e0a7c639c226`, Liberation Fonts 2.1.5 and its archive hash, the pinned M PLUS license, the audited inventory counts, and the exact face/license used by package smoke checks.

`npm run acquire:font-library` reconstructs that source from the pinned upstream revisions. It then verifies all 430 font faces and 116 license files against the tracked inventory and checksum manifest. The generated source is ignored under `build/font-pack-source`; it is not committed.

`npm run prepare:font-library` atomically stages only the 546 inventory-declared font/license files plus seven metadata files under `build/font-library`. Undeclared collection sidecars are not shipped. An existing verified stage remains in place if source verification or replacement staging fails.

For local development, preparation also accepts the historical sibling `../fonts` collection. If that exact collection predates `source-artifact.json`, the tracked immutable lock is injected into the staged artifact only after all inventory bytes verify. `SLOOM_FONT_PACK_DIR` can select another exact source root. Release CI never depends on a sibling workspace path.

## Unavoidable package checks

Electron Builder runs two configured hooks for every direct invocation:

- `beforePack` verifies the strict staged allowlist, source lock, inventory identities, byte lengths, and all hashes.
- `afterPack` inspects each produced application resource root through the same bundled-font resolver used by the Electron main process. It requests Liberation Sans Regular and its adjacent OFL license and verifies their exact hashes.

The release workflow first creates one verified GitHub Actions artifact, makes every Windows/Linux/macOS matrix lane depend on it, verifies the downloaded stage, and runs an additional post-package search across all produced resource roots. Missing inputs, missing outputs, changed bytes, undeclared files, or a failed exact-face request stop the build.

No external font artifact needs to be published separately, and the workflow does not upload a font pack as a public release asset. The transient Actions artifact is used only to supply identical verified bytes to the desktop matrix jobs.
