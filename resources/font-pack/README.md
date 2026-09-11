# Flow redistributable font collection

This directory contains the approved, downloaded font library for Flow. The collection is ready to bundle with the application and to embed in PDFs, subject to the simple distribution rules in [DISTRIBUTION.md](DISTRIBUTION.md).

## What is here

- `collection/base/` — 107-family Latin Extended and Japanese base collection
- `collection/optional-chinese/` — 4 optional Simplified/Traditional Chinese families
- `collection/optional-korean/` — 5 optional Korean families
- `catalog/families.tsv` — the human-readable approved family list
- `inventory/font-inventory.json` — per-family and per-face license, source, hash, naming, variable-axis, glyph, and embedding metadata
- `inventory/SHA256SUMS` — integrity hashes for every font and bundled license
- `inventory/font-embedding-smoke-test.pdf` — a 116-page PDF with one embedded representative from every family
- `docs/specs/2026-07-15-professional-font-library-design.md` — the original planning record retained for its catalog and compliance decisions

## Verified contents

- 116 families: 107 base and 9 optional CJK
- 430 font files/faces
- 339 static faces and 91 variable faces
- 111 SIL Open Font License 1.1 families and 5 Apache License 2.0 families
- zero unrecognized licenses
- zero font parsing failures
- zero restricted-embedding or bitmap-only flags
- zero no-subsetting flags
- all 430 files pass Fontconfig scanning
- one representative from all 116 families embeds successfully with Flow's `pdf-lib` + `@pdf-lib/fontkit` stack and has a Unicode map in the resulting PDF

The variable-only families are usable by Flow's tested PDF path. For a printer or legacy layout application that cannot consume variable OpenType fonts, use one of the many static families in the collection or obtain an unmodified static release from that family's authoritative upstream project.

## Re-run verification

From this directory:

```sh
scripts/verify-collection.sh
```

The Google Fonts portion is pinned to upstream commit `26c5c976d82d50c24a8f0a7ac455e0a7c639c226`. Liberation Fonts is pinned to release `2.1.5`; its source archive SHA-256 is recorded inside each Liberation family directory.
