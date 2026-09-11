# Sloom Studio Project Documentation

> **Current source baseline:** `0.9.16-b`, verified August 27, 2026.
>
> This is the technical orientation. Start with the [User Guide](userguide/README.md) for normal
> operation, use the [current feature breakdown](FEATURE_BREAKDOWN.md) for the product map, and use
> the [qualified-feature guide](userguide/15-qualified-missing-hundred-features.md) for the exact
> control path, persistence, output behavior, and deliberate boundary of each qualified workflow.

Sloom Studio is one local-first creative suite with four connected workspaces: **Flow**, **Image**,
**Video**, and **Paper**. The same React/TypeScript application runs in a browser, an Electron
desktop shell, and an Android/DeX Capacitor shell. All workspaces share one `.sloom` project and one
Source Library.

## Product truth at this baseline

- The canonical historical feature ledger contains 100 rows.
- MH-011 (external print-shop acceptance), MH-012 (platform signing/notarization), and MH-099
  (iPad/iOS delivery) are owner-excluded, leaving 97 actionable rows.
- All 97 actionable rows are currently recorded as **Qualified**, with bounded evidence and user
  documentation in the qualified-feature guide.
- “Qualified” applies only to the documented route. Unsupported precision, document structure,
  codec, archive content, hardware, platform, or provider behavior must still fail or disclose its
  limit explicitly.

The source of truth for this status is [`ops/team/features.json`](../ops/team/features.json). The
human-readable maturity map is
[`docs/userguide/16-feature-maturity-reference.md`](userguide/16-feature-maturity-reference.md).

## Architecture snapshot

| Layer | Current role |
|---|---|
| React/Vite renderer | Shared application UI, workspace state, browser-capable project I/O, previews, and bounded browser fallbacks. |
| Electron shell | Native project/media dialogs, safe secret storage, native FFmpeg/runtime jobs, GPU capability probing, crash reports, desktop menus, and KDE Plasma global-menu integration. |
| Android/DeX shell | Capacitor file intents, touch/pen/keyboard adaptation, LAN handoff/server integration, native HTTP, and optional Android Accelerator routes. |
| Project model | One `.sloom` document plus optional per-project scratch storage; `.slimg` and `.slppr` are portable Image and Paper documents. |
| Source Library | Shared asset identity and storage across Flow, Image, Video, and Paper, including generated/ingested origin and linked/managed storage state. |

Legacy `.signal-loom.json` and compatible JSON project names can still be opened. The legacy
`…signal-loom-scratch` directory name remains part of the on-disk compatibility contract.

## Project lifecycle and data safety

- Manual Save/Save As uses the canonical serializer and desktop save creates a timestamped backup
  before replacing an existing project.
- Autosave captures a bounded complete recovery snapshot after settled changes (about 30 seconds)
  and at focus/lifecycle boundaries.
- Project Library can recover or export autosave records without presenting an external provider
  job as complete merely because its input state was saved.
- Project History retains versions and named snapshots as deliberate checkpoints.
- Project-size controls, scratch-backed assets, relink/consolidate, and portable export keep large
  media projects manageable without silently discarding referenced files.

See [Projects & files](userguide/03-projects-and-files.md) and
[Troubleshooting & recovery](userguide/12-troubleshooting-and-recovery.md).

## Workspace map

### Flow — orchestration and repeatable generation

Flow uses `@xyflow/react` to build typed generation and local-processing graphs. Provider-backed
nodes expose only supported model controls; local operations, inputs, lists, flow control,
composition, monitoring, and reusable graph structure can run without a cloud key.

Current professional systems include graph undo/redo, receipt-backed cache and partial rerun,
pre-dispatch spend caps, bilingual starter recipes, bounded RUN ME interval schedules, resumable
serial prompt batches, and credential-free `.sloompack` exchange. Schedules stop when the app or
project closes and do not replay missed intervals.

### Image — layered illustration and production imaging

Image provides raster/vector/text layers, masks, effects and adjustments, pressure/tilt brush
dynamics, selection/retouch/transform tools, model-assisted edits, and `.slimg` documents. Qualified
professional routes cover Smart Objects/filters, native high-bit RGB and bounded CMYK, PSD/XCF
interchange, advanced type/path/vector tools, selection and warp/content-aware operations, mask and
adjustment systems, GPU preview/histogram, spot/print output, batch/Camera Raw/photo merges, and
frame animation.

Lossy or unrepresentable high-bit, CMYK, effect, transform, or interchange combinations fail closed
as documented; the basic raster route is not evidence that every precision route is supported.

### Video — ingest, edit, finish, and render

Video provides Source and Program monitors, linked or managed media ingest, multitrack sequencing,
precise trim/cut/slip/ripple/snap, keyframes, effects/compositing/keying, audio mixing, and durable
render jobs. Qualified routes add markers, crossfades/waveforms, colour/scopes, loudness/true peak,
speed ramps, nested/adjustment execution, relink/consolidate, transcript and multicam editing,
broadcast handoff/captions/QC, external monitoring, tracking/keying, audio repair/ducking, hardware
encoding, and alpha output.

A simple unmodified one-video desktop sequence can bypass browser frame readback and use direct
native FFmpeg. Eligible hosts use VA-API for scaling/encode; native CPU is the fallback. Effects,
overlays, transforms, multiple clips, and other complex edits stay on the general compositor/render
plan. Feature-length export is desktop-native; the browser per-frame path refuses sequences of 30
minutes or more to avoid unbounded memory use.

### Paper — publishing, comics, books, and accessible output

Paper provides pages/spreads, frames, threaded text, styles, grids/guides, Japanese vertical type
and furigana, comic balloons/captions/panels/SFX, print preflight, `.slppr`, PDF/PDF-X, KDP, image,
HTML, story, CBZ, IDML, and package outputs.

Current long-document systems include authored TOC/index/references, footnotes/endnotes, anchored
objects, bounded GREP/nested styles, variables/conditional text, CSV data merge, ordered book files,
local snippets, optical margin alignment, revisions, review comments, EPUB 3, bounded editable IDML
import, ISBN/EAN-13 frames, and tagged Accessible PDF. Accessible PDF and press-oriented PDF/X are
separate output routes with different required metadata and validation.

## Providers, local runtimes, and secrets

Sloom Studio can connect to Google Gemini/Vertex AI, OpenAI or compatible endpoints, Hugging Face,
Stability AI, Black Forest Labs, Atlas Cloud, and ElevenLabs. Local/Open endpoints and the optional
Android Accelerator provide supported local/self-hosted execution routes.

- Provider credentials are entered locally and stored through Electron safe storage on desktop or
  WebCrypto-backed settings on web/Android.
- Provider packs and project snapshots retain credential-slot names, not credential values.
- Encrypted settings backup includes secrets only inside the passphrase-encrypted payload.
- Provider/model selection is explicit; one route must not silently substitute another.
- Cost estimates and the project usage ledger help with budgeting but do not replace the provider's
  final bill.

## Privacy, networking, and collaboration

Sloom Studio does not host prompts, media, or inference. Google Play builds can contact a limited
licensing service that verifies a purchase and delivers a permanent key; it does not receive project
content. Cloud provider calls send only the input chosen for that action.

Collaboration, server-authoritative review, sync, LAN hosting, and cross-project cataloguing are
explicit optional routes. When enabled, data goes to the server or device the operator configured.
That operator owns access control, retention, backup, transport security, and regulatory policy.

See [Accessibility, collaboration & automation](userguide/13-accessibility-collaboration-and-automation.md)
and [provider-pack security](provider-pack-security-and-privacy.md).

## Documentation and verification

| Surface | Purpose |
|---|---|
| [`docs/userguide/README.md`](userguide/README.md) | User-guide entry point and version baseline. |
| [`docs/userguide/15-qualified-missing-hundred-features.md`](userguide/15-qualified-missing-hundred-features.md) | Detailed user operation and bounded truth for all 97 actionable qualified rows. |
| [`docs/userguide/16-feature-maturity-reference.md`](userguide/16-feature-maturity-reference.md) | Complete 100-row ledger map and owner exclusions. |
| [`src/lib/helpContent.ts`](../src/lib/helpContent.ts) | In-app help shown in every runtime. |
| [`docs/release/website/sloom-studio/docs.html`](release/website/sloom-studio/docs.html) | Public English Docs page; Japanese mirror is under `ja/`. |

Run the documentation gates from the repository root:

```bash
node scripts/verify-user-docs.mjs
node scripts/verify-qualified-feature-guide.mjs
node scripts/verify-provider-packs.mjs
node docs/release/website/sloom-studio/verify-site.mjs
npx vitest run src/lib/helpContent.test.ts
```
