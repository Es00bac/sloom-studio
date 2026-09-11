# Distribution and license rules

This collection intentionally accepts only unmodified upstream font binaries under the SIL Open Font License 1.1 or Apache License 2.0. The audit rejects unknown licenses and fonts whose OpenType embedding flags prohibit ordinary PDF embedding.

## When bundling these fonts with Flow

1. Ship each selected font family with the license file already present in that family's directory. Do not separate the font binaries from that license.
2. Keep the font files under their existing OFL-1.1 or Apache-2.0 license. Flow's application license does not replace the font license.
3. Do not sell the OFL font files by themselves. Bundling them with software, documents, or a print workflow is allowed.
4. Embedding the fonts in PDFs and sending those PDFs to a printer is allowed. Supplying the original font package to a printer as part of the job is also allowed; include its license.
5. If a font is modified, check its license header for Reserved Font Names. OFL derivatives using a reserved name must be renamed. Record modifications and comply with the Apache change/notice requirements where applicable.
6. Preserve upstream copyright, attribution, trademark, and notice material. Do not imply that an upstream foundry endorses Flow.
7. Do not extract a font from this library and redistribute it under more restrictive terms.

## Practical packaging rule

Copy whole family directories from `collection/`, not isolated `.ttf`/`.otf` files. This keeps the license and provenance beside the binaries and is the simplest way to remain compliant.

The authoritative per-family evidence is in `inventory/font-inventory.json`. It records the detected SPDX license, license hash, source URL/commit or release, font hashes, embedding flags, and variable axes. `inventory/SHA256SUMS` can detect accidental changes before release.

This is a technical compliance record, not a substitute for advice from your attorney about a particular commercial distribution.
