# Sloom Studio documentation map

> **Current-source baseline:** `0.9.16-b`, August 27, 2026.
>
> This repository deliberately preserves a large body of dated engineering evidence. A file being
> present does **not** automatically make it a current product promise. Use the classification
> below before quoting documentation in a release, support answer, or feature claim.

## Current reference documentation

These documents are maintained against the current integration and should be updated with an
implementation change when they describe its surface:

| Area | Current reference |
| --- | --- |
| Product entry point | [`../README.md`](../README.md) |
| Engineering orientation | [`PROJECT_DOCUMENTATION.md`](PROJECT_DOCUMENTATION.md) |
| Product and feature truth | [`FEATURE_BREAKDOWN.md`](FEATURE_BREAKDOWN.md), [`userguide/15-qualified-missing-hundred-features.md`](userguide/15-qualified-missing-hundred-features.md) |
| Practical user guide | [`userguide/README.md`](userguide/README.md) and its numbered chapters |
| Complete bilingual manual source | [`user-manual-bilingual/en/`](user-manual-bilingual/en/) and [`user-manual-bilingual/ja/`](user-manual-bilingual/ja/) |
| Print and provider references | [`PRINT-STATUS.md`](PRINT-STATUS.md), [`ELEVENLABS_FEATURES.md`](ELEVENLABS_FEATURES.md), [`vertex-authentication.md`](vertex-authentication.md), [`provider-pack-author-reference.md`](provider-pack-author-reference.md), and [`provider-pack-security-and-privacy.md`](provider-pack-security-and-privacy.md) |
| Packaging recipes | [`packaging/`](packaging/) — recipes only; signing/notarization claims require release evidence |
| Public static documentation | [`release/website/sloom-studio/`](release/website/sloom-studio/) |

The current feature guide is intentionally specific about the bounded supported route and refusal
boundary. “Qualified” means the documented in-repository acceptance evidence passed; it never
means that a third-party cloud, print, store, certification, or physical-hardware service has
accepted a particular user job.

## Generated manual and public documentation

The full public English/Japanese manual is generated from the bilingual Markdown source, not
maintained as hand-copied web prose. Regenerate it after a manual edit:

```bash
npm run docs:build-public-manual
npm run verify:docs
```

Generated public manual pages live under
`docs/release/website/sloom-studio/manual/{en,ja}/`. Do not hand-edit them; change the matching
source chapter and regenerate. The main public docs/changelog pages and their Japanese versions
are ordinary static files, but their links and generated-manual consistency are checked by
`npm run verify:docs`.

## Preserved historical evidence

The following areas are kept because they explain decisions, reproduce a repair, or provide audit
provenance. They are **historical evidence**, not an automatically current manual:

| Area | How to interpret it |
| --- | --- |
| [`notes/`](notes/) | Dated implementation handoffs and evidence packets. Read the date and later corrections. |
| [`audits/`](audits/) | Point-in-time independent or internal audit records. A later audit can supersede conclusions. |
| [`coordination/`](coordination/) | Team-operation records, messages, and task snapshots; not product behavior documentation. |
| [`superpowers/`](superpowers/) | Historical plans/specifications and assistant work products, often intentionally incomplete or superseded. |
| [`release/play/`](release/play/) and dated release briefs | Release-era record. Use a current user guide or current package evidence for present tense claims. |
| [`research/`](research/), [`render-parity/`](render-parity/), [`prototypes/`](prototypes/) | Research, experiment, and test artifacts. They prove only the scope/date stated in the file. |
| [`assets/`](assets/) and [`readme-assets/`](readme-assets/) | Documentation assets; their filenames and previews are not independent feature assertions. |
| [`product/`](product/) | Product-planning material. Check the current feature guide before treating an idea or scope statement as shipped behavior. |
| Historical design briefs such as [`gpu-frame-server-export-brief.md`](gpu-frame-server-export-brief.md) | Kept for rationale; each must have a current disposition before it is cited. |

Do not rewrite a historical note to make its old statement appear current. Instead, add a dated
correction or current-disposition section and link readers to the maintained reference document.

## Documentation maintenance rules

1. Verify a claim in source and focused tests before adding it to a current document.
2. State a bounded route and its refusal/availability condition where omission could cause data
   loss, unexpected cost, or a false compatibility claim.
3. Never put credentials, personal paths, private media, or raw provider responses in docs.
4. Keep English and Japanese public/manual navigation in parity. Translate meaning, not a stale
   English claim.
5. When a source version changes, update the current-reference baseline and regenerate the public
   manual. Do not mass-edit dated historical records just to change a version string.
6. Record material feature/documentation changes in the changelog, including exact
   verification commands and known caveats.

## Verification commands

```bash
# Documentation links, bilingual manual/public-site structure, provider-pack references, and in-app help
npm run verify:docs

# Current feature-guide ledger consistency
node scripts/verify-qualified-feature-guide.mjs

# Provider-pack schema/reference consistency
node scripts/verify-provider-packs.mjs

# Source quality and application build when the working tree is otherwise ready
npm run lint
npm run build
```

`npm run build` can be affected by unrelated uncommitted worker lanes in this shared workspace.
Record an unrelated baseline failure precisely rather than weakening a gate or claiming a clean
product build you did not obtain.
