# Missing Hundred feature maturity reference

This reference complements [Qualified Missing Hundred features](15-qualified-missing-hundred-features.md).
The qualified guide already contains step-by-step documentation for every completed workflow:
what it is, its workspace, how to use it, persistence/output behavior, and the deliberate
boundary. This page audits the complete current ledger and fills the documentation gap for
the full canonical history while retaining concise bounded references for selected workflows.

## Audit result

The source of truth is [ops/team/features.json](../../ops/team/features.json). It contains 100
canonical historical rows. MH-011 (external print-shop acceptance), MH-012
(signing/notarization), and MH-099 (iPad/iOS) are owner-excluded, leaving the same 97 active rows
as the supplied feature-evidence table.

| State | Rows | Meaning |
|---|---:|---|
| Qualified | 97 | Complete bounded workflow with executable evidence and independent review. Use the [qualified-feature guide](15-qualified-missing-hundred-features.md). |
| Executable | 0 | No actionable row currently stops at this maturity. |
| Wired | 0 | Controls, state, or compiler/runtime representations exist, but the requested end-to-end result does not execute. Do not rely on it for delivery. |
| Modelled | 0 | The app can describe or plan the work, but does not perform it. Treat it as setup information only. |
| Absent | 0 | The named capability is unavailable. An adjacent feature may help, but is not a substitute. |

The qualified guide was also checked against the ledger during this audit. It contains exactly the
97 actionable qualified IDs: no missing, duplicate, or extra sections. Its local Markdown links
resolve. All three owner-excluded rows remain visible in the canonical ledger but outside the
actionable denominator.

MH-065 is stored in the ledger under the broad Suite label because it participates in shared
project persistence, but its mounted editing surface is Image. This reference places it under
Image so the workspace map answers where an editor actually uses it.

## Full feature index

For every entry marked **Qualified**, find the same ID in the
[qualified-feature guide](15-qualified-missing-hundred-features.md). It is the detailed user
documentation for that feature.

/home/cabewse/.zshenv:.:2: no such file or directory: /tmp/hane-cargo/env
### Suite

| ID | Feature | State | Documentation |
|---|---|---|---|
| MH-001 | Autosave | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-002 | Crash recovery of unsaved documents | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-005 | Project version history and named snapshots | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-006 | Projects that stay a sane size | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-007 | Customizable keyboard shortcuts | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-013 | Screen-reader and keyboard accessibility | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-014 | Crash reporting | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-030 | Font discovery and management | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-080 | Real-time collaboration | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-081 | Cloud project sync | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-082 | Team review with server authority | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-083 | A plugin and extension SDK | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-084 | Scripting and headless automation | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-085 | A cross-project asset catalogue | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |

### Flow

| ID | Feature | State | Documentation |
|---|---|---|---|
| MH-004 | Undo and redo in Flow | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-028 | Result cache and partial rerun | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-029 | Enforced Flow spend caps | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-094 | Starter templates and a recipe gallery | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-095 | Scheduled and triggered Flow runs | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-096 | Resumable batch runs | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-097 | Shareable node packs | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |

### Image

| ID | Feature | State | Documentation |
|---|---|---|---|
| MH-008 | True Smart Objects and smart filters | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-009 | 16- and 32-bit per channel documents | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-010 | Real CMYK document mode with ICC conversion | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-031 | Bézier text on a path | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-032 | Editable text warps | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-033 | Local Image text spellcheck | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-034 | Vertical Japanese Image text | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-035 | Canvas view rotation | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-036 | PSD export with live editable text | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-037 | PSD round-trip that keeps structure editable | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-038 | XCF import | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-039 | Nested groups with pass-through blending | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-040 | Transforming several layers as one | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-041 | A magnetic lasso that actually snaps to edges | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-042 | Select Subject that works offline and well | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-043 | Puppet Warp and Perspective Warp | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-044 | Perspective crop | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-045 | Content-aware fill of corners after straightening | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-046 | Content-aware fill with real controls | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-047 | Professional path editing | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-048 | Work paths and saved paths independent of layers | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-049 | Smart filter masks | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-050 | LUT and gradient-map adjustment layers | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-051 | Advanced blending and the missing adjustment staples | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-052 | GPU live preview while adjusting | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-053 | A histogram that updates as you work | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-054 | Live boolean operations on vector shapes | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-055 | Custom shape libraries | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-056 | Magic and Background Eraser safety | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-057 | Mask refinement workspace and linked masks | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-058 | Spot channels and press-ready separations | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-059 | Print output from Image artboards | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-060 | Unattended batch actions over a folder | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-061 | Camera Raw development | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-062 | Photographic correction | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-063 | HDR merge, panorama stitch, focus stacking | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-064 | Frame animation and onion skinning | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-065 | A vector design discipline | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |

### Video

| ID | Feature | State | Documentation |
|---|---|---|---|
| MH-003 | Pointer drag-trim on clip edges | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-015 | Timeline and clip-relative markers | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-016 | Audio crossfades per cut | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-017 | Waveforms on video clips' embedded audio | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-018 | A real colour grading workspace | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-019 | Scopes driven by decoded frames | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-020 | A real audio mixer | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-021 | Loudness normalization and true-peak limiting | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-022 | Speed ramping that actually renders | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-023 | Nested sequences and adjustment layers that execute | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-024 | Relink and consolidate offline media | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-025 | Transcript-based editing | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-026 | Multicam switching in playback and export | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-027 | A render queue that survives a restart | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-086 | AAF and broadcast wrappers | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-087 | Broadcast caption embedding | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-088 | Decoded-signal QC | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-089 | External monitoring and control surfaces | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-090 | Rotoscoping and tracking that run | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-091 | Production-grade chroma key | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-092 | Audio repair and auto-ducking | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-093 | Broader hardware encoding and alpha export | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |

### Paper

| ID | Feature | State | Documentation |
|---|---|---|---|
| MH-066 | Table of contents, index and cross-references | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-067 | Footnotes and endnotes you can author | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-068 | Anchored objects that flow with text | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-069 | GREP styles and nested styles | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-070 | Text variables and conditional text | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-071 | Data merge | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-072 | Book files across multiple documents | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-073 | Object libraries and snippets | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-074 | Optical margin alignment | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-075 | Track changes and editorial redlining | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-076 | In-document review comments | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-077 | EPUB export | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-078 | IDML import | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-079 | ISBN validation and standards-aware EAN-13 barcode placement | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |
| MH-098 | Tagged PDF and PDF/UA | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |

### Mobile

| ID | Feature | State | Documentation |
|---|---|---|---|
| MH-100 | A usable phone Video timeline and Flow shell | Qualified | [Qualified-feature guide](15-qualified-missing-hundred-features.md) |

## Additional bounded feature references

### Video

#### MH-023 — Nested sequences and adjustment layers that execute (Qualified)

**What it is.** Nested sequences would composite a sequence as a clip; adjustment layers would
apply effects across clips beneath them.

**What works now.** A bounded adapter expands validated child timelines, applies source-less
adjustment passes to the lower composite, then projects multicam cuts. Program Monitor,
stage-frame export, and native FFmpeg consume the same fail-closed result beside mature Runtime IR.

**How to use the available route.** Create/select nested and adjustment clips in Professional
Video Tools, then use the ordinary monitor or export route. Invalid/missing/cyclic/deep or
over-bound state refuses before output.

#### MH-092 — Audio repair and auto-ducking (Qualified)

**What it is.** Audio repair reduces unwanted sound. Auto-ducking detects foreground dialogue and
automatically lowers other tracks.

**What works now.** Video retains Voice Isolation and repair filters and executes bounded native
side-chain ducking before its persisted bus mixer. The mounted picker shows only enabled, audible
control clips with their source labels.

**How to use the available route.** Configure an audible dialogue/control clip and an eligible
target in the Video inspector, then render with a native target. Browser monitor preview remains
un-ducked and is disclosed as such.

## Keeping this reference current

Update [ops/team/features.json](../../ops/team/features.json) before changing a maturity claim. If
an actionable feature is reopened or regresses, move its ledger state honestly, document its
current behavior and boundary here, and restore Qualified only after executable evidence and an
independent review. Controls, metadata, plans, or adjacent behavior do not by themselves establish
a completed feature.
