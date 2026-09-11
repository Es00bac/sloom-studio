# Sloom Studio — Current Feature Breakdown

> **Source baseline:** `0.9.16-b`, verified August 27, 2026.
>
> This file is a durable product map, not a frozen copy of implementation unions. Exact node,
> provider-model, preset, tool, and codec inventories are read from the current registries at
> runtime. Exact bounded operation and limitation text for the completed program is maintained in
> the [qualified-feature guide](userguide/15-qualified-missing-hundred-features.md).

## Suite at a glance

| Workspace | Primary job | Portable output/state |
|---|---|---|
| **Flow** | Typed node graph for generation, local transforms, logic, reusable pipelines, and controlled automation. | Shared `.sloom` state, Source Library results, credential-free `.sloompack` selections. |
| **Image** | Layered raster/vector/type editing, natural-media brushes, retouching, production imaging, and optional model-assisted edits. | `.slimg`, PSD and supported raster/production outputs. |
| **Video** | Linked/managed ingest, multitrack edit, keyframed finishing, audio/colour/QC, and durable native/browser rendering. | Shared `.sloom` timeline and registered rendered media. |
| **Paper** | Page/spread layout, comics, long documents, print/KDP, ebooks, interchange, and accessible output. | `.slppr`, PDF/PDF-X, EPUB, IDML, CBZ, HTML, story, image, and package outputs. |

All four workspaces share one `.sloom` project and Source Library. The application runs as an
Electron desktop app, Android/DeX Capacitor app, and bounded browser build.

## App-wide systems

- Native and portable project open/save/export, scratch-backed large media, save backups,
  autosave/crash recovery, retained version history, and named snapshots.
- Shared Source Library with named bins, search, generated/ingested origin, linked/managed storage,
  relink/consolidate, and a bounded cross-project catalogue.
- Customizable conflict-checked keyboard shortcuts, dockable/saved layouts, keyboard and
  screen-reader semantics, stylus dynamics, and gamepad mapping.
- Provider/model cards, encrypted local credentials/settings backup, cost estimates, project usage
  history, exact-route dispatch, and fail-closed spend caps.
- Managed font discovery, local crash/problem reports, self-hosted collaboration/sync/review,
  extension/provider/node packs, scripting, and headless project automation.

## Flow

The current node registry covers generation, inputs/data, lists/envelopes, flow control,
logic/math/data transforms, text/story helpers, composition, reuse/layout, monitoring/debugging,
and settings. Provider-backed cards expose controls from the selected model's declared capability
contract; local-only nodes can operate without an API key.

Qualified delivery systems:

- graph undo/redo;
- receipt-backed result cache and downstream-only invalidation/partial rerun;
- project-level spend caps with concurrent reservations and unknown-price refusal;
- nine bilingual starter recipes inserted as one normal history action;
- bounded RUN ME interval schedules that operate only while the project is open;
- serial, pausable, resumable prompt batches with retained cursor/failure state; and
- validated credential-free `.sloompack` export/import.

See [Flow workspace](userguide/05-flow.md) and the
[Flow qualification entries](userguide/15-qualified-missing-hundred-features.md#flow).

## Image

The everyday editor includes layers/groups, masks/channels/paths, selections, transforms,
text/shapes, paint and natural-media brush dynamics, retouch tools, effects/filters/adjustments,
model-assisted region editing, and standard document/export workflows.

Qualified production groups:

- Smart Objects and smart filters, nested pass-through groups, and shared-pivot multi-layer
  transforms;
- native 16/32-bit-per-channel RGB and bounded profile-validated CMYK documents;
- live editable text/structure PSD paths, bounded XCF import, text on a path, text warp, local
  spellcheck, vertical Japanese text, saved paths, vector booleans, and shape libraries;
- canvas rotation, magnetic lasso, offline Select Subject, Puppet/Perspective Warp, perspective
  crop, controlled content-aware fill, and mask refinement/linked masks;
- smart-filter masks, LUT/gradient maps, expanded adjustments/blending, GPU live preview, live
  histogram, spot separations, and artboard output; and
- unattended folder actions, Camera Raw-style development, photographic correction, HDR merge,
  panorama stitch, focus stack, and frame animation/onion skinning.

Unsupported high-bit, CMYK, structure, effect, transform, or interchange combinations must refuse
before lossy mutation. See [Image workspace](userguide/06-image.md) and the
[Image qualification entries](userguide/15-qualified-missing-hundred-features.md#image).

## Video

The everyday editor includes Source/Program monitors, linked or managed ingest, long-form-aware
Source Bin browsing, multitrack visual/audio sequencing, trim/cut/slip/ripple/snap, keyframes,
filters/blends/crop/transitions/keying, text/shape overlays, and native/browser export.

Qualified finishing groups:

- pointer drag-trim, timeline/clip markers, per-cut crossfades, and embedded-audio waveforms;
- primary colour correction, decoded-frame scopes, persisted track/bus mixing, loudness
  normalization and true-peak limiting, audio repair, and auto-ducking;
- rendered speed ramps, bounded nested sequences/adjustment layers, relink/consolidate, transcript
  editing, multicam switching, and durable restart-safe render jobs;
- AAF/MXF handoff wrappers, embedded MP4/MOV captions, decoded-signal QC, external monitoring and
  control surfaces, rotoscoping/tracking, production chroma key, broader hardware encoding, and
  alpha export.

Direct GPU fast path: an unmodified one-video desktop sequence can use direct native FFmpeg with
VA-API when eligible and native CPU fallback. Complex edits stay on the general compositor/render
plan; feature-length export is desktop-native. See [Video workspace](userguide/07-video.md) and the
[Video qualification entries](userguide/15-qualified-missing-hundred-features.md#video).

## Paper

The everyday publisher includes pages/spreads, frames, threading, grids/guides/snapping, styles,
OpenType and Japanese vertical type/furigana, comic panels/balloons/captions/SFX, colour/print
preflight, and broad print/digital outputs.

Qualified long-document and delivery groups:

- authored TOC/index/cross-reference tokens, footnotes/endnotes, and anchored objects;
- bounded GREP/nested styles, variables/conditional text, and CSV data merge;
- ordered multi-document book files, a device-local snippet library, and optical margin alignment;
- tracked revisions and document-local page/frame review comments;
- validated reflowable EPUB 3, bounded editable IDML import, ISBN/EAN-13 validation/barcode frames,
  and tagged Accessible PDF with document language, reading order, and authored visual alternatives.

Paper refuses unsafe or unrepresentable IDML/archive content rather than flattening it silently.
Accessible PDF and press PDF/X are separate routes. See [Paper workspace](userguide/08-paper.md) and
the [Paper qualification entries](userguide/15-qualified-missing-hundred-features.md#paper).

## Platform behavior

| Capability | Desktop | Android/DeX | Browser |
|---|---|---|---|
| Four workspaces and shared project | Full | Touch/phone-adapted | Bounded browser I/O |
| Native dialogs and per-project scratch | Yes | File intents/platform storage | File picker/download and browser storage |
| Provider calls | Renderer plus native bridges where required | Native HTTP/provider routes | Subject to browser/network policy |
| Video export | Native FFmpeg/runtime, VA-API where eligible, CPU fallback | Available runtime/codec route | Bounded browser fallback; not feature-length |
| Secrets at rest | Electron safe storage | WebCrypto-backed settings | WebCrypto-backed settings |
| LAN/self-hosted collaboration | Explicitly configured | Explicitly configured/phone host | Connects only to configured origin |

The historical iPad/iOS item is owner-excluded and is not part of the actionable platform claim.

## Canonical detailed references

- [User Guide index](userguide/README.md)
- [Troubleshooting & recovery](userguide/12-troubleshooting-and-recovery.md)
- [Accessibility, collaboration & automation](userguide/13-accessibility-collaboration-and-automation.md)
- [Provider packs & model cards](userguide/14-provider-packs-model-cards.md)
- [All 97 qualified actionable features](userguide/15-qualified-missing-hundred-features.md)
- [Complete 100-row maturity reference](userguide/16-feature-maturity-reference.md)
- [Project technical orientation](PROJECT_DOCUMENTATION.md)
