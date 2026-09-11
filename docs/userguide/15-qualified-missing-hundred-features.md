# The 97 qualified Missing Hundred features

This guide describes all 97 actionable Missing Hundred features qualified in Sloom Studio.
“Qualified” means each bounded stopping point has executable evidence and an independent review;
it does not claim behavior outside the stated limits.

The canonical source ledger retains three explicitly non-actionable rows so the original history is
not rewritten: MH-011, “A print job that a real shop has accepted”; MH-012, signed and notarized
installers; and MH-099, an iPad/iOS build. Real-shop acceptance requires an external business,
signing/notarization requires owner credentials and accounts, and the owner explicitly removed iOS
from product scope. These rows are owner-excluded from both the actionable completion denominator
and evidence percentage. Sloom Studio's local PDF/X/preflight and unsigned packaging tools remain
available, but they are not presented as completing those excluded outcomes.

Interface wording below uses the English labels. In another interface language, use the equivalent
localized control. Automatic features such as autosave and caching do not require a button unless a
recovery or override action is described.

## Quick index

| Workspace | Qualified features |
|---|---|
| Suite | MH-001 Autosave; MH-002 crash recovery; MH-005 version history; MH-006 sane project size; MH-007 keyboard shortcuts; MH-013 Flow node accessibility; MH-014 crash reporting; MH-030 font discovery and management; MH-065 vector design discipline; MH-080 real-time collaboration; MH-081 self-hosted project sync; MH-082 server-authoritative team review; MH-083 extension SDK; MH-084 scripting automation; MH-085 asset catalogue |
| Flow | MH-004 undo/redo; MH-028 result cache; MH-029 spend caps; MH-094 starter recipes; MH-095 scheduled runs; MH-096 resumable batches; MH-097 node packs |
| Image | MH-008 Smart Objects and smart filters; MH-009 native 16/32-bit RGB documents; MH-010 real CMYK document mode; MH-031 Bézier text on a path; MH-032 editable text warps; MH-033 local spellcheck; MH-034 vertical Japanese text; MH-035 canvas view rotation; MH-036 editable PSD text; MH-037 editable PSD structure round-trip; MH-038 XCF import; MH-039 nested groups with pass-through blending; MH-040 multi-layer transforms; MH-041 magnetic lasso; MH-042 offline Select Subject; MH-043 Puppet/Perspective Warp; MH-044 perspective crop; MH-045 content-aware corners; MH-046 content-aware fill; MH-047 path editing; MH-048 saved paths; MH-049 smart-filter masks; MH-050 LUT/gradient-map; MH-051 advanced blending; MH-052 GPU live preview; MH-053 live histogram; MH-054 vector booleans; MH-055 shape libraries; MH-056 eraser safety; MH-057 mask refinement/linked masks; MH-058 spot channels; MH-059 artboard Trim PNG output; MH-060 local-folder batch actions; MH-061 Camera Raw-style development; MH-062 photographic correction; MH-063 HDR/panorama/focus stacking; MH-064 frame animation/onion skinning |
| Video | MH-003 pointer drag-trim; MH-015 markers; MH-016 audio crossfades; MH-017 embedded-audio waveforms; MH-018 primary colour correction; MH-019 decoded-frame scopes; MH-020 real audio mixer; MH-021 loudness normalization/true-peak limiting; MH-022 rendered speed ramps; MH-024 relink/consolidate; MH-025 transcript editing; MH-026 multicam switching; MH-027 durable render queue; MH-086 AAF/MXF handoff wrappers; MH-087 embedded MP4/MOV captions; MH-088 decoded-signal QC; MH-089 external adapter/control sessions; MH-090 bounded rotoscoping/tracking; MH-091 chroma-key parity; MH-093 hardware encoding/alpha export |
| Paper | MH-066 TOC/index/references; MH-067 authored footnotes/endnotes; MH-068 anchored objects; MH-069 GREP/nested styles; MH-070 text variables; MH-071 data merge; MH-072 book files; MH-073 object libraries; MH-074 optical margin; MH-075 track changes; MH-076 review comments; MH-077 EPUB export; MH-078 IDML import; MH-079 ISBN barcodes; MH-098 tagged PDF |
| Mobile | MH-100 Android/mobile-web phone Video and Flow shell |

## Suite

### MH-001 — Autosave

**What it is.** Autosave keeps a bounded recovery copy of the complete active project without
requiring a manual save. It captures Flow, Video, Image, Paper, the Source Library, managed Paper
assets, Flow workspaces, and usage state through the same canonical project serializer used by
normal project operations.

**How to use it.** Work normally. After project changes settle for about 30 seconds, Sloom Studio
captures a recovery snapshot. It also flushes on focus-loss and page lifecycle boundaries. To use a
snapshot, open **Project Library**, find the recovery entry, and choose **Recover**, **Export**, or
**Delete**. Recover replaces the open project through the normal dirty-work guard. Export downloads
a sanitized `.sloom` recovery file; Delete asks for confirmation.

**Persistence and limits.** Storage keeps the newest eight sessions. A recovered snapshot opens as
working state and does not silently overwrite the named project; save it explicitly when satisfied.
Snapshots are local IndexedDB data, not cloud backup. A continuous edit stream relies on the
independently tested focus/page flushes, and the current UI does not show a persistent autosave-failure
indicator. See [the autosave implementation note](../notes/1052-mh-001-autosave-recovery.md).

### MH-002 — Crash recovery of unsaved documents

**What it is.** Desktop startup preserves a remembered project that failed to open instead of
silently replacing it with a blank project. The failure and the previous project remain available
until a recovery choice succeeds.

**How to use it.** When startup detects a failed remembered project, use the recovery dialog:

1. Choose **Retry** to try the same project again.
2. Choose **Open Another** to select a different project.
3. Choose **Recover Backup** and select one of the discovered local backups.
4. Choose **Continue Blank** only when you intentionally want a blank workspace.

Canceling or failing a choice leaves the recovery prompt available. The backup list is scanned
sequentially and shows at most the newest 20 eligible local files; symlinks, directories, vanished
files, and unreadable candidates are refused or skipped safely.

**Persistence and limits.** The selected project still goes through the ordinary authority and
dirty-work replacement transaction. Recovery covers a remembered local `.sloom` file and bytes that
already reached local recovery storage. It cannot reconstruct data that was never written locally
and is not off-device backup. See [the crash-recovery qualification note](../notes/1057-mh-002-crash-recovery-qualification.md).

### MH-005 — Project version history and named snapshots

**What it is.** Each project can carry a bounded revision ledger containing automatic save revisions
and named snapshots. It supports inspection, restore, rename, delete, and non-destructive branching.

**How to use it.** Open **History** beside **Projects** in the top navigation. Create a named
snapshot before a risky edit, or inspect the automatic revisions generated by saves. From the
History dialog you can rename or delete a named snapshot, **Restore** a revision into the current
project, or **Branch** it into a new project. Restore and branch use the same loss-prevention guard
as opening another project. The dedicated restore history lets you undo or redo bounded restore
hops.

**Persistence and limits.** History survives project save/reopen and corrupt snapshot payloads are
refused before changing live stores. The ledger is intentionally bounded: up to 20 revisions, an
8 MiB payload limit, a 24 MiB aggregate history budget, and 10 restore hops. Browser and Android
snapshot creation becomes visible only after its library transaction succeeds. On desktop, a new
snapshot becomes durable in the native file at the next explicit save. Served-LAN clients are
read-only and cannot create, rename, or delete history. See [the qualification note](../notes/2026-08-26-mh-005-qualified.md).

### MH-006 — Projects that stay a sane size

**What it is.** Project Library measures each locally saved project's serialized project bytes,
embedded-media count, Source Library reference count, and whether the bounded scan had to truncate.
The measurement is descriptive rather than an invented disk-space estimate, and a malformed legacy
row can no longer prevent the rest of the saved-project list from opening.

**How to use it.** Open **Project Library** from the top navigation. Each saved row shows the fields
that can be measured from its stored project document. A row marked **Measurement truncated** is
still available to open or explicitly delete; the label means some hostile, malformed, or oversized
content could not be counted within the safe scan budget. Use the ordinary Save, Open, Export, and
Delete actions—there is no separate measurement command.

**Persistence and limits.** The report is derived again from the saved document and its media
references, so it follows normal local save/open behavior without adding mutable project state.
Traversal stops after 250,000 visited values and failures preserve a truthful partial/truncated
result. The numbers do not represent filesystem allocation, compression after export, remote cloud
quota, or files outside the saved project record. See [the combined qualification
note](../notes/1086-mh-006-mh-019-mh-064-qualified.md).

### MH-014 — Crash reporting

**What it is.** Crash reporting is an optional, local-only diagnostic queue. It records bounded,
redacted renderer and Electron failures so a user can inspect or export evidence without sending it
to Sloom Studio or a third-party service.

**How to use it.** Open **Settings**, find **Crash Reports**, and enable local crash reporting. The
section shows newest-first reports, repeat counts, messages, and available stacks. Use **Export** to
save a combined renderer/desktop JSON report for your own records or support conversation. Use
**Clear** and confirm to remove queued reports and pending native minidumps. The feature also catches
render-boundary failures, unhandled renderer errors/rejections, renderer-process exits, child-process
exits, and main-process failures.

**Persistence and limits.** The queue is capped at 50 entries and repeat fingerprints collapse into
one entry with an occurrence count. Text passes through structural secret redaction at capture,
rehydration, forged IPC, and export boundaries. Native Crashpad is opt-in and never uploads, but a
minidump may contain process memory and is therefore not text-redacted; it remains local and is
deleted by Clear. Crashpad enable/disable has process-lifetime behavior disclosed in the UI. See
[the crash-reporting note](../notes/1049-mh-014-crash-reporting.md).

### MH-007 — Customizable keyboard shortcuts

**What it is.** The Settings workspace allows editing and resetting keyboard shortcuts for supported actions. The global dispatcher resolves configured shortcuts with protection against accidental edits to input-bearing controls and a bounded physical-key fallback for shifted punctuation when required.

**How to use it.** Open **Settings**, find **Keyboard Shortcuts**, and view the current mappings. Click an action to edit its shortcut, type or paste a new key combination, and apply. The dispatcher validates that the shortcut does not conflict with editable input targets. Use **Reset All** to restore defaults.

**Persistence and limits.** Changes persist to settings storage and survive application restart. Conflict detection is executable but not yet surfaced in the production Settings UI. Capture uses normalized text entry instead of press-to-bind recording, and the punctuation fallback intentionally targets the US-position physical key for compatibility across keyboard layouts.

### MH-013 — Flow node keyboard accessibility

**What it is.** Every persisted Flow node is a named keyboard-focusable accessibility group. The
node advertises Enter and Space as shortcuts, and either key selects it through the same ordinary
click event used by pointer input instead of creating a second selection state path.

**How to use it.** Move keyboard focus through the Flow canvas until the desired node receives its
focus outline, then press **Enter** or **Space** to select it. Continue tabbing into the node's own
buttons, text fields, and other controls when you want to operate those; their keys remain local and
do not accidentally select the surrounding node.

**Persistence and limits.** Accessibility attributes derive from the saved node identity and title,
so they return with the Flow project. The established persisted global shortcuts, starter-gallery
focus handling, and typed edge/handle descriptions remain compatible. This qualification covers
Flow nodes, not every Paper, Image, Video, native-dialog, screen-reader, contrast, or reduced-motion
surface. See [the combined qualification note](../notes/1085-mh-013-mh-060-mh-078-qualified.md).

### MH-030 — Font discovery and management

**What it is.** Settings can explicitly ask a supporting browser for a bounded catalogue of locally
available font names. This names-only discovery is separate from Sloom's managed-font library, where
an exact vetted font asset can be adopted by Paper without silent substitution.

**How to use it.** Open **Settings → Font Library** and choose **Discover local fonts**. The result
states whether the browser supports the request, permission was denied, the catalogue was empty, or
names were found. Discovery does not install anything. To use a portable exact font in Paper, add a
vetted managed font asset to the library, open Paper's font import control, and adopt that available
asset. It then appears in the ordinary Paper font menu; remove the Settings collection reference or
the document face deliberately when you no longer need it.

**Persistence and limits.** Discovered operating-system names stay in component memory and are not
stored; results are normalized, deterministically sorted/deduplicated, and capped at 500. Sloom never
calls the native catalogue's font-byte accessor. Managed assets persist separately, and Paper refuses
missing or mismatched bytes before changing the document or history. Successful adoption participates
in undo/redo and JSON save/reopen. This does not transfer a font license, install or activate native
fonts, embed arbitrary system fonts, or promise the same browser support everywhere. See
[the qualification note](../notes/1081-mh-030-qualified.md).

### MH-065 — A vector design discipline

**What it is.** Image provides retained editable rectangles, ellipses, straight-segment paths,
preset shapes, saved custom shapes, fill and stroke styles, and selected exact boolean
materialization in one mounted editing route. The result stays ordinary editable Image content
rather than becoming a flattened effect merely because a shape property changed.

**How to use it.** Create or select a vector shape layer in Image and use the vector controls to
choose a supported kind and adjust its geometry, fill, opacity, stroke, and stroke width. Save a
useful preset into the custom-shape library and apply it to another selected vector layer. Use the
Layers boolean action when the selected shapes fit the bounded exact-materialization subset. Normal
Undo and Redo cover committed changes.

**Persistence and limits.** Retained shape metadata and supported custom presets survive native
project save/reopen. Malformed custom-library records are filtered before mounted controls can
apply them; invalid colors and hostile numeric values are normalized or refused without mutating
the selected layer. This is not a separate Illustrator-class workspace, a live boolean stack, a
full Bezier authoring system, or broad SVG/PSD native-editability parity. See
[the qualification note](../notes/1093-mh-065-qualified.md).

### MH-080 — Real-time collaboration

**What it is.** Paired LAN sessions negotiate a simultaneous multi-writer project-log mode. Paper publishes and applies validated workspace changes through the host authority, including managed assets, multiple tabs, ordered incoming envelopes, rebase of unrelated edits, and deterministic same-field conflict resolution.

**How to use it.** Set up a paired phone/desktop LAN host and connect multiple Sloom windows to the same project through the host's authority. Open or edit the shared Paper document simultaneously; the editor receives and applies incoming workspace changes in order without echoing its own edits back.

**Persistence and limits.** This is paired LAN collaboration with a local host authority, not cloud collaboration, a CRDT/Yjs deployment, presence/live cursors, permissions, notifications, or an independently observed two-person session. It does not support presence indicators, live cursors, or user/team permissions.

### MH-081 — Self-hosted project sync

**What it is.** Sloom includes an operator-run remote project authority that stores bounded project
JSON and revision history durably. Authenticated sessions establish account ownership; updates use
base revisions and stable mutation IDs so conflicts and retries cannot silently overwrite or
duplicate a project change.

**How to use it.** Start the authority with `npm run serve:self-hosted-project-sync`. It binds to
loopback by default; use the documented `SLOOM_SELF_HOSTED_SYNC_*` environment settings only when
you intentionally provide a data directory, host, port, and browser-origin allowlist. In Sloom,
open **Settings → Providers → Self-hosted project authority**, enter the operator URL, check its
health, then create or sign in to an authority account. Project fetch, update, history, and explicit
FIFO resume use that signed-in session and stop visibly on a revision conflict.

**Persistence and limits.** The authority uses bounded storage, salted password records, hashed
durable session identifiers, atomic replacement, a recovery backup, and fail-closed origin/quota/
authentication checks. The browser keeps the bearer in session storage and never writes it into
the retry journal. This is not Sloom-hosted cloud storage: deployment, TLS/reverse proxy, external
identity, multi-region replication, push notification, automatic background publication, CRDT
merge, and E2EE remain operator or future concerns. See
[the implementation note](../notes/2026-08-27-mh-081-self-hosted-project-authority.md).

### MH-082 — Server-authoritative team review

**What it is.** A bounded team-review authority stores members and roles, threads, comments, and
status changes through one deterministic revisioned reducer. The Android host binds each bearer to
a registered device identity server-side before a review operation can reach that reducer; paired
desktop and host surfaces show the same live review state.

**How to use it.** Start the Android LAN host or connect a paired desktop session, then open the
mounted **Team Review** panel. Owners can manage supported reviewer/commenter roles; authorized
members create threads, add bounded comments, and change review status. Stale revisions return a
conflict for refresh/retry, repeated mutation IDs resolve exactly once, and an operation whose actor
does not match the authenticated device is refused before the project log changes.

**Persistence and limits.** Review records are bounded and persist through the existing project
authority. Native session/device bindings intentionally expire on host restart. Initial browser
registration is not hardware attestation, and a plain-LAN bearer is not a substitute for TLS.
This stopping point does not claim an internet-hosted review service, broad account administration,
push notifications, presence/live cursors, or hardware identity. See
[the authority note](../notes/1094-mh-082-team-review-server-authority.md) and
[the identity repair note](../notes/2026-08-27-mh-082-server-authority-repair.md).

### MH-083 — A plugin and extension SDK

**What it is.** Sloom Studio supports a bounded, declarative provider-pack extension mechanism. Portable packs are validated, stored, installed, surfaced as model cards in Flow, and executed only through the approved-origin request broker.

**How to use it.** Open **Settings**, find **Provider Packs**, and browse available packs. Install a pack to add new AI model options to your Flow. Installed packs appear as model cards with their own configuration surfaces. Remove a pack to uninstall it.

**Persistence and limits.** This is a declarative provider/model extension SDK. It does not load arbitrary third-party code, expose a workspace UI plugin API, or claim a permissioned general-purpose sandbox. Packs are validated against structural rules and credential policies before installation.

### MH-084 — Scripting and headless automation

**What it is.** Sloom exposes a bounded public project CLI that can inspect a specified project and perform a guarded name change using an expected SHA-256, sibling backup, atomic replacement, and dry-run validation without opening the graphical application.

**How to use it.** From the command line, run `npm run project:cli -- --help` to see available commands. Use `inspect` to view a project's digest, or `rename` to change a project's name with validation. Dry-run mode shows what would be changed without committing.

**Persistence and limits.** The qualified stopping point is deliberately a narrow, safe inspect/rename automation API rather than an arbitrary script runtime, generic JSON patcher, plugin SDK, or credential-bearing provider runner. Hard process kill can leave a fail-safe stale lock, and successful backups are not automatically pruned.

### MH-085 — A cross-project asset catalogue

**What it is.** Sloom maintains a bounded device-local metadata catalogue of Source Library entries observed when projects are opened or saved. It includes cross-project search and filters, project provenance, generated-media badges, same-source lineage, truncation reporting, and guarded forget/clear controls.

**How to use it.** Open **File → Source Catalogue** to browse all media across projects you have opened. Search by name or filter by workspace/type. Hover over an entry to see its source project and lineage. Use **Forget** to remove an entry or **Clear All** to reset the catalogue.

**Persistence and limits.** This is a device-local metadata index refreshed on observed open/save operations. It does not provide cloud or cross-device authority, team sharing, or cross-project byte reuse; reusing media still requires opening its original project. Metadata only stores search/filtering information, not actual media bytes.

## Flow

### MH-004 — Undo and redo in Flow

**What it is.** Flow can reverse and reapply graph structure and authored node-setting changes while
keeping runtime ownership safe. A pointer drag is coalesced into one history step rather than dozens
of intermediate positions.

**How to use it.** While the Flow workspace is active, use **Edit → Undo** / **Edit → Redo** or the
standard undo/redo keyboard commands. Undo can restore added or removed nodes and edges, positions,
settings, and validated portable result references. Making a new edit after undo clears the redo
branch, as expected. If a graph is running, history restoration aborts the active run before changing
the graph.

**Persistence and limits.** History is session-local: saving and reopening preserves the graph, not
the undo stack. Project replacement and remote-sync replacement start a new history boundary. The
history holds at most 50 entries, with per-entry and aggregate serialization budgets; an oversized
revision is skipped without rejecting the live edit. This is intentionally different from Suite
project version history. See [the Flow history note](../notes/1051-mh-004-flow-undo-redo.md).

### MH-028 — Result cache and partial rerun

**What it is.** Flow avoids repeating valid unchanged work. Each result is bound to a deterministic
input signature; editing an input invalidates the affected node and its downstream dependents while
unrelated valid branches remain reusable.

**How to use it.** Run a graph normally. Re-running an unchanged downstream target may reuse its
valid dependencies instead of calling a provider again. Change a prompt, model setting, connection,
or upstream asset to invalidate only the affected path. To deliberately regenerate an existing
generated Source Library item, open its context menu and choose **Regenerate**; that explicit action
forces the originating node rather than accepting its cached root result.

**Persistence and limits.** The live-process LRU holds 128 entries. Save/reopen reuse works through a
credential-free persisted signature plus a validated durable Source Library receipt; media payloads
are not serialized into the Flow graph. Missing, stale, failed, or forged receipts fail closed and
run again. Cancellation and stale owners cannot publish cache entries. See [the cache qualification
note](../notes/1049-mh-028-result-cache-qualification.md).

### MH-029 — Enforced Flow spend caps

**What it is.** A project-level Flow spend ceiling blocks provider dispatch before money is spent
when the planned run would exceed the remaining budget or when pricing is unknown.

**How to use it.** In the Flow usage bar, find **Flow spend cap (USD)**, enter a value from `$0.01`
to `$100,000`, and apply it. The usage hint explains the active policy. Run Flow normally; before
the confirmation/dispatch boundary, Sloom Studio adds recorded spend, current in-process
reservations, and the new plan. It refuses the run if the sum exceeds the cap. Use **Clear cap** to
remove the ceiling when you intentionally no longer want it.

**Persistence and limits.** The cap and recorded usage survive project save/reopen. Reservations
prevent concurrent runs from all spending the same remaining allowance and are released on success,
failure, or cancellation. Reservations are local to the current process, and the cap uses Sloom
Studio's pre-dispatch price estimate; it is not a guarantee of the provider's final bill. Unknown
pricing is blocked while a cap is active. See [the spend-cap note](../notes/1052-mh-029-enforced-spend-caps.md).

### MH-095 — Scheduled and triggered Flow runs

**What it is.** A **RUN ME** trigger can repeat its graph on a bounded local interval without
creating overlapping copies of the same run.

**How to use it.** Add or select a **RUN ME** node. Enable **Local interval schedule**, then enter a
whole-minute interval from 1 minute to 24 hours. Keep the app and that project session open. The
first timer dispatch uses the ordinary run path; the next interval is armed only after the graph
settles. The normal manual RUN ME action remains available for an immediate run. Disable the toggle
to remove the timer.

**Persistence and limits.** The schedule setting survives project and Flow-workspace save/reopen,
but reopening does not replay missed runs. Closing the app stops the timer. Node deletion, schedule
replacement, project/workspace replacement, and remote graph updates reconcile or remove timer
ownership. Provider confirmations, spacing, spend caps, cancellation, and cache checks still apply.
This is not cron, a webhook, a hosted scheduler, or a background Electron service. See [the schedule
note](../notes/1053-mh-095-scheduled-triggered-runs.md).

### MH-096 — Resumable batch runs

**What it is.** A **RUN ME** node can execute a local line-delimited prompt dataset serially and
remember the next unfinished row.

**How to use it.** Connect a Prompt Input upstream of RUN ME. In the RUN ME card, choose the
**Batch dataset prompt input**, enter one prompt per non-empty line in **Batch dataset rows**, and
choose **Start**. The card shows progress and failures. Choose **Pause** to cancel the active graph
through normal run ownership, **Resume** to retry from the retained cursor, or **Reset** to return to
the first row. The stored Prompt Input text itself is not overwritten; each row is a snapshot-only
override for that execution.

**Persistence and limits.** Batches allow up to 500 rows and 4,000 characters per row. Only one row
runs at a time. The configuration, cursor, and failure state survive save/reopen; an in-progress
batch reopens paused and never auto-dispatches. Every row still follows provider confirmation,
spend-cap, cache, cancellation, Source Library, and usage-recording rules. This is not CSV/SQL
mapping, a distributed queue, or a background service. See [the batch note](../notes/1054-mh-096-resumable-batch-runs.md).

### MH-094 — Starter templates and a recipe gallery

**What it is.** Flow includes a bounded bilingual catalogue of nine useful starter graphs. Each
card previews its nodes and connections, validates the typed graph contract, states any provider or
API-key prerequisite, and inserts the recipe as one ordinary editable Flow history action.

**How to use it.** On an empty Flow canvas, use the starter gallery, or choose **Start** from the
bottom toolbar at any time. Browse a recipe, inspect its preview and requirements, then insert it.
At narrow desktop sizes the menu remains on-screen and scrollable. Tab and Shift+Tab traverse its
controls instead of hiding the interface; Escape closes it and restores focus. New nodes are placed
in visible canvas space clear of an open Source Bin.

**Persistence and limits.** Inserted recipes are ordinary project nodes: edit, run, undo, redo,
save, and reopen them normally. Provider-backed recipes still require the user's configured
credentials at execution time. This is a built-in local catalogue, not a hosted marketplace or an
external publication channel. See [the combined qualification record](../notes/1076-mh-094-mh-097-qualified.md).

### MH-097 — Shareable node packs

**What it is.** Flow can export the selected graph as a bounded versioned `.sloompack` and install
one of those files as an editable graph with fresh identities. Export strips credentials, runtime
state, and unsafe private payloads; import revalidates nodes, typed edges, counts, size, and portal
references before changing the project.

**How to use it.** Select the nodes to share and use the localized **Export node pack** action in
the Flow workspace. To install a pack, open **Start**, choose the node-pack import action, and pick
the local file. A successful import closes the menu, places the graph in visible canvas space clear
of the Source Bin, and selects the inserted nodes so the result is immediately visible. One Undo
removes the complete installation; Redo restores it.

**Persistence and limits.** Installed nodes save and reopen like ordinary Flow content. Packs do
not contain Source Library media, provider credentials, live results, or runtime ownership, and
hostile or oversized files fail without partially mutating the graph. This is local file exchange,
not signed marketplace distribution. See [the combined qualification record](../notes/1076-mh-094-mh-097-qualified.md).

## Image

### MH-008 — True Smart Objects and smart filters

**What it is.** Image can retain a bounded local Smart Object source behind one or more raster
instances. The source owns one supported raster Smart Filter stack, so eligible instances keep the
same filter order, enabled state, values, and mask while still using the ordinary Image compositor.

**How to use it.** Select an eligible raster layer in **Layers** and choose **Convert to Smart
Object**. Select the resulting instance to use **Edit Contents**, then save the edited source back
to its instances through the ordinary return control. With a Smart Object selected, use the
**Smart Filters** section to add, edit, reorder, enable, disable, remove, or mask a supported
filter. Duplicate Instance shares the source; New via Copy creates a separate source. Choose
**Rasterize Smart Object** when the selected instance should detach into an ordinary raster layer.
Undo and Redo operate through the normal Image history.

**Persistence and limits.** Sources and supported filter-mask assets save and reopen through
`.slimg`; missing, divergent, oversized, malformed, locked, or stale records refuse before
changing the document. Preview and flattened export use the same ordinary filter compositor. The
bounded PSD bridge handles only eligible **embedded raster** placed-layer records and reports
empty, duplicate, unsupported, or malformed records as preview-only or refused. The document-wide
`nativeSmartObjects` compatibility flag intentionally remains false: this is not whole-document
Photoshop Smart Object parity, external linked-file authority, arbitrary non-raster source editing,
native Smart Filter/adjustment records, Camera Raw, Liquify, or Photoshop application parity. See
[the qualification note](../notes/1107-mh-008-qualified.md).

### MH-009 — 16- and 32-bit per channel documents

**What it is.** Image provides a bounded native RGB high-bit workflow with u16 or f32 per-layer
pixel authority, derived 8-bit display proxies, supported high-bit ingress and native
single-raster export, depth-aware tools, bounded composition, ordinary history, and `.slimg`
persistence.

**How to use it.** Open a supported PNG16, TIFF16, TIFF32f, or single-part scanline OpenEXR asset
in Image. Confirm the admitted working depth in Image Properties, use the supported brush,
eraser, mask, resize, crop, layer, composition, and history controls, then export through the
supported native single-raster route. Mounted refusal or status text identifies a route that
cannot execute without losing native authority.

**Persistence and limits.** Native depth and pixel authority survive `.slimg` save/reopen, and
supported preview/export paths consume that authority. Unsupported PSD/PSB precision or shape,
served/remote editing that cannot preserve native authority, unsupported filters or adjustments,
CMYK, GPU-only paths, unsupported alpha-mask shapes, and unavailable worker fallbacks refuse
before lossy mutation or disclose their exact retained-but-nonexecuting boundary. This is not
Photoshop-wide high-bit parity, arbitrary codec coverage, or a claim about hardware/device output.
See [the independent terminal review](../../ops/team/messages/mh-009-high-bit-documents/1787876620-aurelia-finch-terminal-verdict.md).

### MH-010 — Real CMYK document mode with ICC conversion

**What it is.** Image provides a bounded native CMYKA document route with validated ICC conversion,
editable plate authority, deterministic separations, ordinary history, save/reopen persistence,
profiled DeviceCMYK TIFF ingress, a live proof/gamut preview, and native CMYK TIFF export.

**How to use it.** Open Image with an eligible RGB document and use the **Native CMYK** workspace to
choose a bundled supported profile and convert the document. Edit the C, M, Y, K, and alpha plate
values with the mounted CMYK controls, inspect the read-only ICC proof and gamut-warning overlay,
and use Undo/Redo normally. You can also open a supported DeviceCMYK TIFF whose embedded profile is
validated. Export through the ordinary native CMYK TIFF action; use the always-mounted refusal
status when a selected tool or document shape falls outside the admitted route.

**Persistence and limits.** CMYKA authority, measured profile identity, plate edits, layers, and
history survive `.slimg` save/reopen, and the same bounded profile contract drives proof and output.
Unsupported profiles, 16-bit CMYK, CMYK PSD/JPEG, incompatible alpha, oversized documents, and
positioned, transformed, grouped, filtered, or non-normal-blend export layers refuse before lossy
mutation or output. Trapping, overprint, PDF/X certification, arbitrary working spaces, and press
acceptance are not claimed. See [the implementation note](../notes/2026-08-27-mh-010-repair.md).

### MH-031 — Bézier text on a path

**What it is.** A retained Image text layer can follow a bounded cubic Bézier vector path while
remaining editable in the Sloom project.

**How to use it.** Create or select a retained text layer and make sure the Image document contains
an eligible vector path layer. With the text layer selected, open its **Text Path** controls. Choose
the **Target** path, set the **Offset**, optionally enable **Reverse**, and choose **Attach**. Edit the
path handles or text to update the raster preview. Choose **Clear** to detach the text from the path.
The panel identifies a successful cubic attachment as **Retained Bézier path**.

**Persistence and limits.** Attachment, path revision, open/closed state, offset, direction, and
text styling participate in undo/redo and survive project save/reopen. The sampled path is bounded
to 4,096 points/pixels of accepted geometry and malformed or oversized paths fail closed rather than
falling back to ordinary point text. Canvas and flattened exports retain the appearance, but native
editable PSD text-on-path round-trip is not supported. See [the Bézier text note](../notes/1044-mh-031-bezier-text-path.md).

### MH-032 — Editable text warps

**What it is.** Retained Image text can use Arc, Flag, or Bulge warp intent while the source text,
typography, and warp choice remain editable. The renderer creates a deterministic raster preview
inside a bounded displacement envelope, and flattened export uses that same rendered appearance.

**How to use it.** Create or select a retained text layer, open the text-layer controls, and choose
**Text warp**. Select **Arc**, **Flag**, **Bulge**, or **None**. Editing the text or choosing another
warp rerasterizes the selected layer; use normal undo and redo to move between warp choices. Save
and reopen the project to continue editing the retained text and supported warp intent.

**Persistence and limits.** The native project format preserves supported warp metadata and rejects
unsupported serialized values before materializing partial state. Raster allocation includes the
warp envelope and fails without mutating the document when it would exceed the established budget.
These are Sloom-retained raster approximations, not a native vector mesh or Photoshop-editable warp
record. Vertical and text-on-path combinations retain the choice but do not apply the horizontal
warp renderer. See [the qualification note](../notes/1092-mh-032-qualified.md).

### MH-033 — Local Image text spellcheck

**What it is.** The selected retained Image text layer gets deterministic, offline spelling
feedback from a compact local dictionary.

**How to use it.** Select a retained text layer and open the text/typography properties. Under
**Typography Readability**, inspect **Local dictionary spellcheck**. The panel shows a misspelling
count, each detected word, and available local suggestions. Edit the selected layer's text with the
normal text control; the status refreshes immediately and reports **No misspellings found** when
clean.

**Persistence and limits.** Spellcheck itself creates no edit or undo entry; only your text change
does. The saved project retains the corrected text, not a separate spellcheck database or result.
There is no network request, account, grammar service, or automatic replacement button. Dictionary
coverage is intentionally compact, so an unlisted valid word can still be reported. See [the local
spellcheck note](../notes/1037-image-text-spellcheck-qualification.md).

### MH-034 — Vertical Japanese Image text

**What it is.** Retained Image text can be laid out in bounded vertical columns and rasterized
consistently for the canvas and exports.

**How to use it.** Select a retained text layer, open its text controls, and change **Orientation**
from **Horizontal** to **Vertical RL** for the conventional right-to-left column order. **Vertical
LR** is also available when that direction is required. Enter Japanese text and continue using the
ordinary font, size, spacing, transform, and layer controls. The preview rerasterizes from retained
text metadata rather than flattening the layer at the moment orientation changes.

**Persistence and limits.** Orientation, text, styling, bitmap version, and preview bytes survive
JSON save/reopen and participate in the normal Image undo path. This is a bounded retained-text
raster workflow, not a full Japanese shaping engine: native editable PSD text, vertical glyph
substitution, kinsoku, tate-chu-yoko, ruby, and native text interchange are not claimed. See [the
vertical text note](../notes/1046-mh-034-vertical-japanese-image-type.md).

### MH-035 — Canvas view rotation

**What it is.** Image can rotate the editing view around its center without rotating or resampling
the artwork. Canvas pixels, guides, selections, crop overlays, text and vector handles, symmetry
guides, and single- or multi-layer transform controls stay on the same document coordinates while
the viewport turns.

**How to use it.** In the Image navigation controls, use **Rotate counter-clockwise** or **Rotate
clockwise** to move through the 15-degree view ladder. Use **Reset rotation** to return upright.
The default keyboard routes are `Ctrl/Cmd+Shift+,`, `Ctrl/Cmd+Shift+.`, and
`Ctrl/Cmd+Shift+0`. A supported two-finger twist also changes the view angle while retaining the
screen anchor for pan and zoom. Perspective Crop and multi-layer transform handles remain directly
draggable at right-angle and arbitrary view angles.

**Persistence and limits.** The normalized angle is stored per Image document and survives project
save/reopen; malformed or non-finite saved angles are discarded. View changes create no Image
history entry and do not change layer bytes. This is a viewport comfort tool, not artwork rotation,
native PSD view-state interchange, or a promise of an optimized full-document draw at extreme
rotated zoom. See [the qualification note](../notes/1077-mh-035-qualified.md).

### MH-036 — PSD export with live editable text

**What it is.** Image writes a bounded ordinary text subset as real native PSD text records and
reopens standard PSD text records as retained, editable Image text without depending on private
Sloom metadata. Supported point and box text retains content, family, size, weight, style, caps,
kerning, tracking, baseline, colour, alignment, leading, and ordinary bounds.

**How to use it.** Create or select an ordinary retained Image text layer and choose **Export PSD**.
Open the resulting PSD in Sloom Studio or another PSD editor that supports native text. Supported
text remains editable after reopen. Before export, inspect the PSD readiness information: path,
vertical, warped, effected, masked, linked-mask, empty, or unsupported-colour text is explicitly
rasterized with a recorded reason instead of being mislabeled editable.

**Persistence and limits.** The production PSD bytes are deterministic and export does not mutate
the document or history. Hostile imported dimensions are bounded by the existing typed text-raster
budget. This is not full Photoshop typography, font resolution, OpenType shaping, path/vertical/
warped/effected editable text, or Smart Object interchange. See [the qualification
note](../notes/1097-mh-036-qualified.md).

### MH-037 — PSD round-trip that keeps structure editable

**What it is.** Image reopens a bounded PSD structure as editable Image content and exports that
same supported structure back to PSD. The route keeps ordinary raster layers, nested groups, paint
and group masks, and the qualified ordinary native-text subset as retained structures instead of
silently treating the whole document as one flattened image.

**How to use it.** Open a supported PSD through the ordinary Image open route, make layer, group,
mask, or supported text edits in **Layers** and the Image tools, then choose **Export PSD**. Before
export, inspect the PSD readiness information. Each layer reports whether it remains native,
requires a bounded flatten/metadata fallback, or is refused. If a document has duplicate or stale
retained identities after an external edit or reorder, Image refuses the ambiguous association
instead of attaching one layer's retained state to another.

**Persistence and limits.** Supported retained structures participate in ordinary history and
`.slimg` save/reopen, while the same normalized content drives Image preview and exported PSD
bytes. This is not whole Photoshop application parity: adjustments, effects, Smart Objects/Smart
Filters, broad typography, path/vertical/warped/effected text, unsupported masks, and unbounded
external PSD constructs remain explicit fallback or refusal outcomes. See [the qualification
record](../notes/1109-mh-037-qualified.md).

### MH-038 — Bounded GIMP XCF import

**What it is.** Image opens supported 8-bit GIMP XCF workfiles as editable raster-layer stacks.
It preserves decoded pixels, layer names and order, offsets, opacity, visibility, supported blend
modes, and layer masks; grayscale and indexed sources expand to RGBA for editing.

**How to use it.** Use the normal Image file-open route and choose an `.xcf` file. Review the
import warnings before continuing. Supported workfiles open as an ordinary Image document that you
can edit and save in Sloom Studio. A linear-light precision that Image cannot reproduce refuses
before pixel decoding and tells you to re-save from GIMP using a supported non-linear/perceptual
8-bit precision. Detected GIMP 3 non-destructive effects produce per-layer warnings and retain the
unfiltered source pixels; they are never silently called flattened or editable.

**Persistence and limits.** The imported raster result participates in normal Image editing and
project persistence. Native editable GIMP text, native group semantics, non-destructive effects,
source links, fractal tiles, unsupported modern precision, and greater-than-8-bit pixel authority
remain explicit warnings or typed refusals. Some third-party linear-light blend results can differ
from Image's gamma-space blend implementation. See [the qualification
record](../notes/2026-08-27-mh-038-xcf-import-qualified.md).

### MH-039 — Nested groups with pass-through blending

**What it is.** On Image's standard 8-bit raster document route, Image has a retained, cycle-safe
group hierarchy. An isolated folder composites its descendants before applying its own opacity,
blend mode, and group mask. A folder with **Pass
through** enabled instead leaves its descendants blending into the parent stack while retaining the
folder opacity. The same normalized tree is used for the editor preview and raster export.

**How to use it.** In **Layers**, add a **Group** or select an existing group. Use each layer's
**Group** selector or its **Move to Group** menu to place layers and nested groups in the folder;
cycles and invalid placements are refused. With a group selected, enable or disable **Pass through
(children blend with parent stack)**. Leave it off when the folder needs isolated composition, its
own blend mode, or a group mask. Group assignments, mode changes, and order edits use ordinary
Undo and Redo.

**Persistence and limits.** Group hierarchy, expansion state, mode, opacity, and supported masks
survive `.slimg` save/reopen. Deep or malformed hierarchy records fail closed before recursive
rendering or a partial panel edit. Clipping, transformed children, and supported layer effects use
the same bounded compositor path in preview and export. A mask directly attached to a pass-through
group is not claimed as Photoshop-equivalent across every adjustment and clipping combination, and
native PSD group semantics are not claimed. Native 16/32-bit documents containing group rows refuse
before lossy mutation instead of flattening those rows; high-bit nested-group execution is not part
of this qualification. See [the qualification record](../notes/1108-mh-039-qualified.md).

### MH-040 — Transforming several layers as one

**What it is.** Image can move, rotate, or uniformly scale a validated selection of unlocked
sibling layers around one shared pivot. Every participating layer previews together, and the whole
gesture applies or cancels atomically instead of leaving a partially transformed selection.

**How to use it.** Select two or more eligible sibling layers in the Layers panel, then use the
shared transform overlay on the canvas. Drag inside the shared bounds to translate, use the rotate
handle to turn the selection, use a corner to scale uniformly, or move the shared pivot before the
gesture. Apply commits one history step; Cancel restores all participating layers. Locked layers,
groups, and adjustment layers without transformable geometry are visibly excluded.

**Persistence and limits.** Committed layer transforms survive normal project save/reopen and one
Undo restores the complete multi-layer operation. View rotation changes only pointer and overlay
mapping; it does not rotate the artwork. Skew, distort, perspective, warp, automatic link-group
propagation, and keyboard-operated transform gestures remain single-layer or unavailable, and
scaling retains the existing destructive bitmap-resample boundary. Deleting or locking a layer
during a pending gesture has the pre-existing single-layer lifecycle limitations recorded by the
independent review. See [the repair and review note](../notes/1051-mh-040-independent-review-repair.md).

### MH-041 — Magnetic Lasso edge snapping

**What it is.** The mounted Magnetic Lasso samples the real document composite, builds a bounded
Sobel edge field, and pulls pointer samples toward strong nearby edges. Radius and contrast controls
change the committed selection rather than merely changing descriptive metadata.

**How to use it.** Choose **Magnetic Lasso**, set **Snap radius** and **Edge contrast** in
Properties, and trace around the subject. Finish the loop to replace the current selection as one
normal history operation. Press Escape or cancel the pointer gesture to restore the exact previous
selection. When the composite cannot be sampled, the tool reports its bounded freehand fallback.

**Persistence and limits.** The committed selection survives `.slimg` save/reopen. Field creation
is refused before compositing above the published pixel and dimension caps, and hostile settings are
normalized deterministically. This is local gradient-edge assistance, not semantic subject
recognition, hair refinement, or a learned edge model. See [the qualification
note](../notes/1098-mh-041-qualified.md).

### MH-042 — Offline Select Subject

**What it is.** Image provides a local, deterministic **Offline Select Subject** action. It samples
the image border to estimate background colour, forms bounded alpha/contrast components, and ranks
them using size, centrality, and edge penalties before writing the winning mask to the real document
selection. No account, network request, or downloaded model is involved.

**How to use it.** Open an Image document with a visible pixel layer, then use **Offline Select
Subject** in the selection controls. Enable multi-island retention or hole filling only when the
artwork needs those cleanup choices. A successful run replaces the current selection and creates one
normal Undo step. If the heuristic cannot find a bounded foreground component, it reports the
refusal and leaves the previous selection unchanged. Continue in **Select and Mask** for manual edge
refinement.

**Persistence and limits.** The resulting document selection survives `.slimg` save/reopen, while
the heuristic implementation and diagnostics do not leak into exported artwork or the file manifest.
This is not learned semantic segmentation: hair, fur, close-colour subjects, textured backgrounds,
large border artifacts, and strongly edge-touching subjects can require manual refinement. See
[the qualification note](../notes/1095-mh-042-qualified.md).

### MH-043 — Puppet Warp and Perspective Warp

**What it is.** Image provides a bounded retained deformation workspace for an ordinary transformable
layer. Puppet mode displays a regular 4×4 cage whose named control pins can be dragged directly on
the canvas. Perspective Plane mode displays one retained quadrilateral grid with draggable corners
and separate PX/PY perspective controls. Both modes edit the ordinary transform preview rather than
creating a second hidden rendering state.

**How to use it.** Select an eligible Image layer and open the Move/transform properties. Choose
**Puppet cage** to drag its named canvas pins, or **Perspective plane** to drag the plane corners and
adjust **PX** and **PY**. Use **Reset Puppet Mesh** to restore the regular cage. Choose **Apply** to
commit the complete deformation as one history operation, or **Cancel** to restore the exact prior
layer. Normal Undo and Redo reverse and restore the applied mesh, plane, and accompanying transform.

**Persistence and limits.** The retained mesh and plane survive `.slimg` save/reopen and feed the
shared preview, high-resolution, and flatten/export transform path. Malformed, oversized, non-finite,
or out-of-bounds records refuse or normalize at the documented boundary without mutating the open
document or writing an invalid archive. This stopping point uses a regular bounded cage and one
plane; it does not claim Photoshop weighted/triangulated pins, split or multi-plane Perspective Warp,
GIMP Cage Transform parity, or native editable PSD deformation. See [the qualification
record](../notes/2026-08-27-mh-043-qualified.md).

### MH-056 — Magic and Background Eraser safety

**What it is.** Image provides bounded erasers that remove matching pixels while preserving a
recoverable bitmap operation and refusing unsupported edit targets.

**How to use it.** Select an ordinary RGB pixel layer. From the Eraser tool group choose
**Background Eraser** (`Alt+E`) or **Magic Eraser** (`Shift+E`). For Background Eraser, configure
**Tolerance**, **Sampling** (Once or Continuous), **Contiguous/Limits**, **Use Background Swatch**,
and **Protect Foreground** in Properties, then brush over the background. Magic Eraser uses its
tolerance/contiguous controls for a click-based matching removal. Canceling a live Background
Eraser stroke restores the exact pre-stroke pixels; a committed stroke is one undoable paint step.

**Persistence and limits.** The changed alpha bitmap, bitmap version, and dirty state survive the
normal Image project save/reopen. Unsupported RGB-channel, layer-mask, and QuickMask routes fail
without mutation. Edge cleanup is a bounded one-pixel heuristic, not semantic subject segmentation,
and the tools do not promise Photoshop-identical sampling behavior. See [the Background Eraser
qualification](../notes/1038-image-background-eraser-qualification.md).

### MH-044 — Perspective crop

**What it is.** Perspective Crop has a document-owned on-canvas four-corner session with corner and whole-quad dragging, live preview/guides, strict convex winding and allocation bounds, mutually exclusive crop modes, cancellation, and an undoable homography rectification.

**How to use it.** Select the Crop tool and choose **Perspective** mode. Drag any corner of the crop frame to adjust perspective. The preview shows the corrected image. Hold Shift to move the whole frame, or use the Properties panel to fine-tune values. Choose **Apply** to execute the perspective rectification as one undoable operation.

**Persistence and limits.** Perspective crop is deliberately destructive: it flattens the active layer and is unavailable for editable Tiltmark surfaces until rasterization. The operation is one undoable history step. Strict convex winding and allocation bounds prevent oversized output; malformed geometry fails closed.

### MH-045 — Content-aware fill of corners after straightening

**What it is.** Crop/Straighten now offers an explicit **Content-Aware Fill Crop Corners** option that bakes the active raster layer and deterministically repairs only transparent pixels connected to the output boundary inside the existing one-step crop history operation.

**How to use it.** In the Crop Properties panel, enable **Content-Aware Fill Crop Corners** before applying. The crop operation will automatically fill corner gaps created by rotation using the deterministic local repair engine.

**Persistence and limits.** The deterministic local repair affects the active raster layer only; it does not claim cloud Generative Fill quality and remains unavailable for editable Tiltmark surfaces to avoid discarding substrate state. Interior transparent holes are preserved; only boundary-connected pixels are filled.

### MH-046 — Content-aware fill with real controls

**What it is.** Image now opens a bounded local Content-Aware Fill control surface where editors can target the active selection or transparent pixels, constrain sampling to an active-layer source rectangle, choose a sample radius, and apply the result destructively or to a retained new layer through normal undo/redo and project persistence.

**How to use it.** Open **Image → Content-Aware Fill**. Choose whether to fill the selection, transparent pixels, or a specific region. Set the **Sample Radius** to control the search area. Apply the result to the current layer or create a new layer. Preview updates before you commit.

**Persistence and limits.** This is a deterministic local active-layer repair, not Photoshop or generative semantic synthesis, cross-layer sampling, or a cloud-provider request. Results are subject to the bounded algorithm limits and local pixel information only.

### MH-047 — Professional path editing

**What it is.** Image now exposes whole-path selection, direct retained-anchor editing, Curvature Pen interaction, and smooth/corner anchor conversion on retained cubic Bézier vector layers, with the edits flowing through ordinary layer history and project persistence.

**How to use it.** Create or select a vector layer and open the Paths panel. Use the Pen tool to edit paths directly on the canvas. Select an anchor point to convert it between smooth and corner. The Curvature Pen tool allows one-click anchor creation with automatic handle adjustment.

**Persistence and limits.** Professional path editing covers retained layer-backed path editing. Text-on-path and native PSD path fidelity remain separate capabilities; detached saved paths and live Boolean paths are tracked under separate features.

### MH-048 — Work paths and saved paths independent of layers

**What it is.** Image now has a document-owned saved/work-path catalogue independent of the layer stack, with detach-from-vector-layer creation, rename/select/delete, undo/redo, project persistence, and a Make Selection reuse route.

**How to use it.** In the Paths panel, right-click a vector layer's path and choose **Detach**. The path moves to the document's saved paths. You can rename, organize, and save multiple paths independently. Use **Make Selection** to convert a saved path into an editable selection.

**Persistence and limits.** Creation currently detaches a layer-backed path; direct independent-path Pen drawing, thumbnails, stroke-path reuse, vector-mask reuse, and native PSD path fidelity remain outside this stopping point. Corrupt raw tail entries can displace older valid records inside the 24-entry recovery window, but app-written snapshots pre-normalize the bound.

### MH-049 — Smart-filter masks

**What it is.** Each local non-destructive Image filter can retain a bounded alpha-grid mask. The
mask controls where that filter contributes without changing the underlying layer pixels, and the
same capability truth is used by the mounted editor, readiness reports, source-linked workflows,
and export/interchange planning.

**How to use it.** Select a layer with a local filter in the Layers effects controls. Create or edit
the filter mask, adjust its bounded coverage, and use Reset to return it to full coverage. Mask edits
are ordinary layer operations, so Undo and Redo restore the prior filter contribution.

**Persistence and limits.** Local mask grids and filter order survive JSON and `.slimg` save/reopen.
Sloom does not claim native Photoshop Smart Filter mask import or round-trip: PSD planning reports
the unsupported boundary and uses the explicit flattened/rasterized interchange path instead of
advertising false native readiness. See [the qualification note](../notes/1091-mh-049-qualified.md).

### MH-050 — LUT and gradient-map adjustment layers

**What it is.** Image now provides non-destructive LUT and Gradient Map adjustment layers with mounted creation and preset controls, deterministic pixel composition, bounded normalized settings, and JSON-safe .slimg save/reopen.

**How to use it.** Open **Image → Adjustment Layers** and choose **LUT** or **Gradient Map**. Configure the adjustment using built-in presets or upload a custom LUT. The adjustment applies non-destructively to all layers below it. Adjust opacity or create layer masks for selective application.

**Persistence and limits.** The bounded workflow provides built-in editable presets and portable Sloom persistence; it does not claim arbitrary native LUT file import or native Photoshop adjustment-layer round-trip. LUT files must be in supported formats; invalid LUTs fail closed.

### MH-051 — Advanced blending and adjustment staples

**What it is.** Image adds retained Channel Mixer and Selective Colour adjustment layers, a
This-Layer Blend If range, deterministic raster Bevel & Emboss, and document-owned Layer Comps.
All feed the ordinary canvas/export compositor instead of being preview-only controls.

**How to use it.** Add or select an adjustment layer and choose **Channel Mixer** or **Selective
Colour** from **Adjust**; edit the mounted channel or colour-family values. For a raster layer,
open its effects controls to adjust **This-Layer Blend If** or add/configure **Bevel & Emboss**.
In **Layer Comps**, enter a name and choose **Capture** to retain the current visibility, opacity,
and blend-mode state. Choose a saved comp to **Apply**, or use **Rename** and **Delete**.

**Persistence and limits.** Adjustment/effect settings and Layer Comps survive `.slimg` save/reopen;
comp capture, apply, rename, and delete use ordinary undo/redo. Hostile numeric values normalize or
fail safely. This bounded workflow does not claim Underlying-Layer or split-slider Blend If,
Photoshop contour/noise Bevel parity, native PSD live effects, or pixel/transform/revision capture
inside a comp. See [the qualification note](../notes/1078-mh-051-qualified.md).

### MH-052 — GPU live preview while adjusting

**What it is.** Image can execute eligible whole-layer Invert, Brightness/Contrast, Exposure, and
Black & White adjustment previews through WebGL2 while preserving the same mounted adjustment,
histogram, compositor, merge/flatten, and raster-export workflow. Black & White uses one integer
byte-domain contract on CPU and GPU, so even exact half-tie pixels remain identical and upright.

**How to use it.** Add or select one of the supported adjustment layers and edit its controls in
Image. When WebGL2 is available and the layer is full-opacity, unmasked, and unclipped, the live
preview uses the GPU automatically. No separate switch or destructive conversion is required. If
the route is unsupported or any GPU step fails, Image reports the capability truthfully and uses
the ordinary CPU compositor without losing the edit.

**Persistence and limits.** The adjustment layer and its settings survive normal `.slimg`
save/reopen; GPU resources are call-scoped preview resources rather than saved project data. The
qualified route does not claim acceleration for masks, clipping, partial opacity, unsupported
adjustments, unavailable hardware, or high-bit-depth documents. Exposure can retain rare inherited
one-byte store-boundary differences, so universal Exposure bit parity is not claimed. See [the
qualification note](../notes/1082-mh-052-qualified.md).

### MH-053 — A histogram that updates as you work

**What it is.** The Image adjustment dialog now renders live adjustment-feedback histograms with bounded memoized recomputation, explicit loading and error states, and accessible labels while the user changes supported adjustment controls.

**How to use it.** Open any adjustment control panel. A histogram preview shows the effect of your changes in real-time. Adjust sliders and watch the histogram update immediately. The histogram accurately represents the bounded 8-bit preview path used during editing.

**Persistence and limits.** The live feedback is the bounded 8-bit computed preview path; this stopping point does not claim high-bit-depth or GPU histogram processing. Heavy adjustments may take a moment to recompute; loading states indicate in-progress updates.

### MH-054 — Live boolean operations on vector shapes

**What it is.** The Layers context menu now retains both editable vector operands and creates derived Union/Intersect/Subtract/Xor paths whose operation metadata regenerates after source edits and survives undo/redo plus .slimg save/reopen.

**How to use it.** Select two or more vector layers in the Layers panel. Right-click and choose **Boolean → Union**, **Intersect**, **Subtract**, or **Xor**. A new derived path layer is created. Edit the source operand layers and the result updates automatically. Undo/redo and save preserve the relationship.

**Persistence and limits.** The qualified stopping point covers bounded retained layer-backed simple-polygon Boolean relationships. Curved Bezier operands are explicitly refused, and native editable PSD vector-Boolean interchange is not claimed. Invalid relationships hide gracefully.

### MH-055 — Custom shape libraries

**What it is.** Image now provides a bounded device-local custom-shape library: an editor can save the selected retained vector layer as a named reusable shape, apply a saved shape to another vector layer, and delete saved entries, with corrupt storage failing closed and retention capped at 100 entries.

**How to use it.** Select a vector layer. Open the Shapes panel and choose **Save Shape**. Enter a name and description, then save. Later, select another vector layer and choose a saved shape to apply from the library. Use **Delete** to remove unused shapes.

**Persistence and limits.** The library is local to this device and stores bounded retained-vector snapshots; it does not claim Photoshop CSH compatibility, cloud sharing, or linked live instances. Corrupt storage fails closed and does not corrupt the project.

### MH-057 — Mask refinement and linked layer masks

**What it is.** Image combines its Select & Mask refinement workspace with same-document linked
layer masks. A consumer can reference another layer's mask, so one source edit updates every linked
consumer through the ordinary preview and high-resolution composition paths.

**How to use it.** Refine a selection or mask in **Select & Mask**. In the Layers panel, choose an
eligible source mask for a consumer layer. Use the source-edit action to jump to the mask owner,
then edit it normally. Choose **Unlink** when the consumer needs an independent copy. Image refuses
linking a mask away while other consumers depend on it, and refuses applying a new Select & Mask
layer mask directly onto a linked consumer. Deleting a source first materializes a detached copy
for every consumer; Undo restores the live links and Redo restores the normalized copies.

**Persistence and limits.** Valid direct links survive `.slimg` save/reopen, while missing, self,
chained, cyclic, dual-mask, malformed-dimension, and other hostile records fail closed. Preview,
high-resolution composition, and raster export resolve the same source mask. Links exist only inside
one Image document. Advanced semantic hair/fur refinement and native PSD Smart Object or linked-mask
interchange are not claimed; PSD uses the disclosed flattened raster boundary. See [the qualification
record](../notes/2026-08-27-mh-057-qualified.md).

### MH-058 — Spot channels and press-ready separations

**What it is.** The mounted Channels panel exports one deterministic local grayscale PGM coverage plate per retained spot channel. The plate applies the persisted mask, visibility, opacity, and solidity without mutating the document; it materializes only when requested and reports browser/native download outcomes honestly.

**How to use it.** Open the Channels panel and select a spot channel. Click **Export Plate** to download a grayscale PGM file showing the coverage for that ink. The exported plate respects the channel's mask, visibility, opacity, and solidity settings.

**Persistence and limits.** This stopping point is a deterministic local per-spot grayscale coverage artifact. It does not claim CMYK/process separation, direct spot painting, native editable PSD plates, trapping, imposition, ICC-managed press output, or commercial press readiness. See [the spot separations note](../notes/2026-08-27-mh-058-spot-separations.md).

### MH-059 — Bounded Image artboard Trim PNG output

**What it is.** Image produces one deterministic flattened PNG for every valid persisted artboard.
The crop is taken from the ordinary flattened Image result, keeps transparent unpainted pixels,
uses collision-safe sequence-based names, and reports each artboard as exported, failed, skipped,
or cancelled without hiding successful siblings.

**How to use it.** Open the **Artboards** panel in Image and define the artboard rectangles you
want to deliver. Choose **Trim PNG**. The panel downloads each completed artifact and shows the
per-artboard outcome. Invalid or outside-document rectangles are skipped rather than silently
clipped; an encoder failure affects only that artboard. Cancel stops between artboards and labels
the remaining entries without publishing partial results for them.

**Persistence and limits.** Artboard geometry, page/bleed/DPI, and color-proof metadata survive
`.slimg` save/reopen. Export does not mutate the document, history, or dirty state, and admission
limits reject oversized work before flattening or allocating an oversized canvas. This stopping
point is Image-owned Trim PNG output, not bleed extension, printer marks, ICC/CMYK/process
conversion, PDF/X, imposition, a packaged print folder, press-ready certification, commercial-shop
acceptance, or human proof. See [the qualification note](../notes/2026-08-27-mh-059-qualified.md).

### MH-060 — Unattended local-folder batch actions

**What it is.** Image can apply a saved bounded Quick Action to files selected from a local input
folder and write deterministic flattened PNG results to an explicitly authorized output folder. It
processes serially, prevents duplicate simultaneous starts, supports cancellation, and records a
visible success, failure, or cancellation message for every entry.

**How to use it.** In Image, save the fixed Quick Action you want to reuse, open the folder batch
runner, choose the input folder, and choose an output folder when the browser asks for read-write
authority. Start the run and inspect each file's result row. Use **Cancel** to stop after the active
bounded step; completed writes remain reported as completed and later entries are marked cancelled.

**Persistence and limits.** Deterministic reports serialize and reopen, while the current source
document, selection, history, and snapshots are restored or disposed after each temporary document.
Output names are flat, unique, sanitized PNG names. This is a browser File System Access workflow
for saved fixed Image actions, not arbitrary scripting, native background processing, cloud/provider
jobs, source-file overwrite, or unbounded folder execution. See
[the combined qualification note](../notes/1085-mh-013-mh-060-mh-078-qualified.md).

### MH-061 — Camera Raw-style development

**What it is.** Image provides a bounded non-destructive development action for photographic RGB
pixels that are already loaded in a document. It stages temperature/tint, exposure, brightness,
and contrast as three retained adjustment layers, so the ordinary compositor supplies the same
result to preview and export.

**How to use it.** Select an Image layer with loaded pixels, open **Adjustments**, and choose
**Camera Raw-style development**. Stage the five controls in the dialog. Choose **Apply** to create
one ordinary history operation containing the retained adjustment stack, or **Cancel** to leave the
document byte-for-byte unchanged. Use normal Undo and Redo to remove or restore the operation.

**Persistence and limits.** The retained layers and their stable identities survive `.slimg`
save/reopen. Hostile numeric values are normalized, and pixel-less or oversized documents refuse
before mutation. This route develops already-imported RGB pixels; it does not open or demosaic
sensor RAW data, interpret camera metadata/profiles, perform lens correction, or provide arbitrary
RAW codec or Adobe Camera Raw parity. Develop unsupported RAW files externally first, then import a
supported raster. See [the qualification note](../notes/2026-08-27-mh-061-qualified.md).

### MH-062 — Retained local photographic noise reduction

**What it is.** Image provides a retained **Reduce Noise** layer filter for bounded local
impulse-noise correction. It applies a deterministic 3×3 median operation to RGB while preserving
alpha and the source bitmap, and the same retained filter path feeds ordinary preview and export.

**How to use it.** Select an Image layer, open the layer effects controls, choose **Reduce Noise**,
and adjust its amount. The change is one ordinary history operation, so Undo removes it and Redo
restores it. Save and reopen the Image document normally; legacy and v2 `.slimg` both retain the
filter parameters.

**Persistence and limits.** Invalid and hostile values are bounded or no-op without changing the
source. This is a practical local impulse-noise reducer, not Camera Raw development, a camera or
lens-profile pipeline, chromatic-aberration/defringe correction, or learned denoising. See
[the combined qualification note](../notes/1099-mh-062-mh-093-qualified.md).

### MH-063 — HDR merge, panorama stitch, and focus stacking

**What it is.** Image provides one bounded **Multi-shot stack** workspace for three local CPU
operations. HDR combines exposure information with per-pixel well-exposedness weights; Panorama
estimates translation between overlapping sources and feather-blends their seam; Focus selects
locally sharper source regions and applies bounded one-pixel label cleanup.

**How to use it.** Open two to six compatible 8-bit RGB Image documents, then open **Multi-shot
stack** in Image Properties. Choose HDR, Panorama, or Focus, select the source documents, and choose
**Preview**. Inspect the deterministic result and either cancel without changing the sources or
choose **Create** to open it as a normal editable Image document with ordinary Undo and Redo.

**Persistence and limits.** The created layer's pixels and operation metadata survive `.slimg` v2
save/reopen. Invalid counts, dimensions, pixel budgets, payloads, colour depth, weak panorama
overlap/detail, and cancellation fail before source/store mutation. This bounded route does not
claim HDR interchange, lens or perspective correction, cylindrical projection, AI synthesis,
unbounded mosaics, or human visual certification. See [the qualification note](../notes/1090-mh-063-qualified.md).

### MH-064 — Frame animation and onion skinning

**What it is.** Image can retain multiple visibility-state cels in one document, play them at a
bounded frame rate, and show the previous and next cels as translucent onion references while the
current cel remains editable. Playback is display-only: it does not silently rewrite layers,
history, the dirty flag, or exported pixels.

**How to use it.** In Image, open the frame-animation controls in the Properties area. Choose
**Add frame** to capture the current layer-visibility state, use each frame's **Show** and remove
buttons to select or delete it, and choose **Play** when at least two frames exist. Enable
**Onion skin** and adjust the previous/next opacity controls to use neighbouring cels as drawing
references. Authored frame, selection, and onion changes participate in ordinary Undo and Redo.

**Persistence and limits.** Authored frame records, frame rate, current choice, and onion settings
round-trip through `.slimg`; malformed saved animation metadata reopens as a safe single-frame
default with a warning instead of crashing the workspace. Onion imagery is an editor display seam
and cannot enter normal raster export. This is not a Video timeline, audio workflow, variable-
duration player, encoded-animation exporter, or external renderer. See [the combined qualification
note](../notes/1086-mh-006-mh-019-mh-064-qualified.md).

## Video

### MH-023 — Nested sequences and adjustment layers that execute

Professional Video Tools executes bounded nested child timelines and source-less adjustment passes
through Program Monitor, stage-frame export, and native FFmpeg delivery. Invalid/missing, cyclic,
too-deep, or over-bound plans refuse before output; multicam projection occurs after expansion and
retains runtime role/origin/path metadata.

### MH-092 — Audio repair and auto-ducking

Native Video render executes bounded side-chain ducking before the persisted audio-bus mixer. The
inspector offers only enabled, audible control clips with source labels. Browser monitor preview
remains un-ducked; Voice Isolation and per-clip repair filters are separate retained tools. Live
mute, solo, and per-track volume authority now reaches both native render backends through the
bounded track-64 collector and participates in composition cache identity, so changing a fifth or
higher track cannot silently reuse stale audio.

The workspace keeps a four-track minimum for legacy projects and a hard 64-track authority cap;
malformed indexes and non-finite volumes fail closed. See the [cache lifecycle
repair](../notes/1110-mh-092-cache-lifecycle-repair.md) and [collector authority
repair](../notes/1111-mh-092-fifth-track-authority-repair.md).

### MH-003 — Pointer drag-trim on clip edges

**What it is.** Timeline clip edges can be trimmed with one pointer gesture while respecting source
handles, locks, clip-owned markers, and undo history.

**How to use it.** In Video, move the pointer to the left or right edge of an eligible visual or
audio clip until the trim affordance appears. Press and drag the edge to the desired timeline
position, then release. The calculation always starts from the gesture's original clip state, so
pointer movement does not accumulate rounding drift. `Esc`, pointer cancel, or lost pointer capture
cleans up the session. Locked tracks do not accept the mutation.

**Persistence and limits.** A completed drag is one history entry, so one Undo restores the whole
gesture. Source-aware in/out ranges and owned markers are updated atomically and feed the same
project, Program playback, export, and render-cache paths. Trims clamp rather than inventing source
media. The current cleanup is verified for pointer-up, cancel, and lost capture; retaining an extra
unmount-only finish handle is a future defense-in-depth improvement. See [the pointer-trim note](../notes/1052-mh-003-pointer-drag-trim.md).

### MH-015 — Timeline and clip-relative markers

**What it is.** Video supports point, range, and clip-owned markers with labels, color, kind, notes,
search/navigation, exchange, and clip-relative maintenance.

**How to use it.** Put the playhead at the desired time and press `Ctrl/⌘+M` to add a marker. Use
`Shift+M` for the previous marker and `Alt/Option+M` for the next. Open **Search / Markers** to page
through, search, edit, or remove markers; ruler flags expose the same identity and support keyboard
removal. Clip-owned markers follow their clip on move, trim, split, structural edits, copy/paste, and
delete. JSON/CSV exchange preserves supported marker fields and reports rejected or truncated rows
before replacing the current set.

**Persistence and limits.** Markers survive project save/reopen, native projection, and undo/redo
without affecting render-cache identity. The logical cap is 20,000 markers and the UI mounts 250 at
a time. Native sync has an independent 1.5 MiB edit-payload limit; an in-workspace warning explains
when the project can still save locally but cannot sync that edit. See the [timeline marker](../notes/1035-timeline-marker-qualification.md)
and [clip marker](../notes/1036-clip-marker-qualification.md) notes.

### MH-016 — Audio crossfades per cut

**What it is.** A simple cut between two audio clips can become a bounded equal-power crossfade
without manually manufacturing an overlap.

**How to use it.** Select or right-click the later/incoming audio clip at a simple same-track cut.
Choose **Crossfade Previous Cut**; if an overlap already exists, the action is **Normalize Crossfade
With Previous**. The menu displays the executable duration. Sloom Studio prefers a centered
0.5-second overlap, uses only real outgoing-tail and incoming-head handles, and falls back to a
one-sided overlap when only one clip has enough media. Gaps, locked tracks, missing source duration,
complex containment, and handleless cuts are refused.

**Persistence and limits.** Both clip replacements are one undoable history edit. The same
equal-power quarter-sine curve drives Program playback, browser export, and native FFmpeg export;
cache identity changes with it. Crossfades are bounded from 10 ms to 5 seconds and cannot exceed the
available clip/source duration. This does not provide interactive fade handles or arbitrary curve
presets. See [the audio crossfade note](../notes/1051-mh-016-audio-crossfades.md).

### MH-017 — Waveforms for video clips' embedded audio

**What it is.** Audio-lane clips sourced from qualifying video files display measured audio peaks
through the same waveform route as direct audio files.

**How to use it.** Import a browser-decodable video with audio, place its audio representation on an
audio lane, and view the Timeline. Waveform extraction begins automatically and the measured peaks
appear in the clip. Trimming changes the signature and requests the correct source subrange. If the
container, codec, source kind, size, duration, or decoder is unsupported, the clip remains visibly
**Waveform unavailable** rather than showing invented data.

**Persistence and limits.** Results are signature-cached for the current process, with at most one
extraction running at once, 4,096 output peaks, a 15-second abort, a 48 MiB streamed-response limit,
and a ten-minute video-duration limit. Replaced requests cannot delete a newer request's ownership.
This is browser decoding only; nested compositions, non-audio visual sources, native peak extraction,
and unsupported codecs are outside the stopping point. See [the waveform note](../notes/1053-mh-017-embedded-video-waveforms.md).

### MH-018 — Bounded primary colour correction

**What it is.** The Video Finish panel provides one mounted selected-clip primary correction for
exposure, contrast, and saturation. Those saved values follow the same ordinary clip-effect route
into Program Monitor, stage-frame Canvas, browser delivery, and native FFmpeg descriptors.

**How to use it.** Select a visual clip, open **Professional Video Tools → Finish**, and adjust
**Exposure**, **Contrast**, or **Saturation**. Each change is one ordinary composition/history edit,
so use Undo or Redo normally. Choose **Reset primary correction** to remove those three values; the
reset preserves unrelated effects and retained colour metadata.

**Persistence and limits.** The primary values save and reopen with the selected clip. The mounted
operation normalizes hostile values, removes the legacy exposure-only entry, preserves chroma-key
and unrelated filters, and keeps all four current consumers on the same saved projection. This is
not a complete colour-finishing suite: working-space and tone-map choices remain setup metadata,
while LUT execution, lift/gamma/gain, temperature/tint, curves, qualifiers, tracked grades, HDR
reference monitoring, and pixel-identical browser/FFmpeg rendering are not claimed. See [the
primary-colour execution note](../notes/2026-08-27-mh-018-primary-colour-execution.md).

### MH-019 — Scopes driven by decoded frames

**What it is.** Video can measure the frame currently displayed by the rendered Program Monitor and
turn its decoded RGBA pixels into a histogram, luma waveform, RGB parade, and vectorscope. The
visible scopes therefore describe one observed rendered frame rather than timeline metadata or a
fabricated proxy result.

**How to use it.** Render or otherwise load a playable result in the Program Monitor, open its
**Info** tab, and choose **Measure frame** in the decoded-frame scopes panel. The panel displays the
four scope families, the measured media time, and the bounded sample dimensions. Seek to another
frame and measure again when you want a new reading. Changing the preview identity clears the old
reading so it cannot be mistaken for the new rendition.

**Persistence and limits.** Scope readings are component state only; decoded pixels, URLs, and paths
are not written into the project. Readback is bounded to at most 640×360 with at most 32,768 sampled
pixels, and the SVG bins are compacted for bounded rendering. A not-ready, unsupported, tainted, or
cross-origin video refuses truthfully. This is an on-demand rendered-monitor measurement rather than
continuous full-resolution broadcast scopes, and scaling can smooth isolated one-pixel highlights.
See [the combined qualification note](../notes/1086-mh-006-mh-019-mh-064-qualified.md).

### MH-020 — A real audio mixer

**What it is.** Video has one bounded main-output mixer for selected-clip routing and persisted
bus gain, pan, mute, and solo decisions. The same retained mixer record is used by Program Monitor
playback, browser/native FFmpeg delivery, stage-frame output, and final-mix loudness analysis.

**How to use it.** In Video, select a clip and open **Professional Video Tools → Finish**. Create
or choose a supported submix, then route the selected clip and adjust the available main-output
gain, pan, mute, or solo controls. Use ordinary Undo or Redo for a committed change. Export through
a supported Video delivery route; invalid, cyclic, over-bound, unsupported, or cancelled routes
refuse before publishing an output.

**Persistence and limits.** Mixer records participate in ordinary project history and save/reopen.
For a mono source, FFmpeg explicitly normalizes it to stereo before applying the retained pan
route, so centre pan retains equal nonzero signal in both channels. This is one bounded output bus,
not a full mixing desk: sends, effect returns, live meters, surround/arbitrary channel maps,
automation, and mastering controls remain unavailable. Program Monitor uses Web Audio's
equal-power pan while FFmpeg uses a linear taper, so large off-centre positions can differ
slightly; offline FFmpeg/stage delivery and its loudness analysis are authoritative. See [the
qualification note](../notes/1106-mh-020-qualified.md).

### MH-021 — Final-mix loudness normalization and true-peak limiting

**What it is.** Video can apply a measured offline loudness-normalization pass to the final mixed
audio. It uses one real FFmpeg first-pass report and a deterministic second-pass loudnorm filter
after the final `amix`, with an authored integrated-loudness target, loudness range, and true-peak
ceiling.

**How to use it.** Open **Professional Video Tools → Finish**, enable **Normalize final rendered
mix**, and set the delivery targets. Export through a supported native route. The renderer measures
the decoded final mix, refuses silence, missing audio, invalid reports, or unsupported backends, then
publishes only after the measured second pass succeeds. Changing the targets invalidates the render
cache; cancellation cannot publish a stale completion.

**Persistence and limits.** The opt-in and targets use ordinary Video state/history and survive
project save/reopen. This is an offline delivery pass, so the live Program Monitor is not normalized
continuously. Unsupported formats and image-sequence/no-audio cases refuse rather than claiming a
mastered result. It is not a general mastering suite. See
[the qualification note](../notes/1101-mh-021-qualified.md).

### MH-022 — Speed ramping that actually renders

**What it is.** Valid persisted retime segments now use one source-time curve for timeline duration,
Program seeking, frame sampling, cache identity, and native export. The renderer supports forward or
reverse spans, holds, frame blending, and optical-flow requests.

**How to use it.** Select a visual clip and open **Professional Video Tools → Retime & speed ramps**.
The current visible **Selected clip speed** control authors a uniform 25%, 50%, 100%, 200%, or 400%
segment and mirrors it to the ordinary playback-rate state. Projects that already contain valid
multi-segment professional retime data now preview and export that curve instead of losing it at the
flattening boundary. Nearest-frame and hold segments can use deterministic frame sampling; blend or
optical-flow segments route to FFmpeg export.

**Persistence and limits.** Retime data survives project save/reopen and invalid curves safely fall
back to legacy uniform playback. Multi-segment spans must be contiguous, monotonic in direction,
inside the source range, and between 1/16× and 16× unless they are holds. Program preview uses browser
seeking and retains codec/GOP accuracy limits; optical flow is export-only. The visible panel does
not yet provide a multi-point curve editor. See [the rendered-retime note](../notes/1055-mh-022-rendered-speed-ramps.md).

### MH-024 — Relink and consolidate offline media

**What it is.** Desktop Video can reconnect an offline Source Library identity to a verified file or
copy every used file-backed original into one chosen folder without changing timeline identity.

**How to use it.** In the Video **Source Bin**, expand an eligible image, video, audio, or composition
item and choose **Relink…**. Select the replacement file; if the saved identity already has a
fingerprint, the replacement must match. To gather the project, choose **Consolidate Used (n)** below
the Source Bin, confirm, and select a destination folder. Sloom Studio copies only file-backed media
referenced by project sequences, verifies each copy, and retargets the same saved Source identities
after the filesystem transaction commits.

**Persistence and limits.** Playback, export, and render-cache identity consume the current
authorized path and fingerprint. Consolidation is synchronous and copy-only; it never deletes or
moves originals. A failed post-copy project update reports retained files instead of pretending they
were rolled back. Arbitrary external paths do not self-authorize after a cold open, so use Relink to
reacquire access. See [the media-management qualification](../notes/2026-08-26-mh-024-qualified.md).

### MH-025 — Transcript-based editing

**What it is.** A timed transcript can propose and apply source-aware ripple removals to the real
record timeline as one guarded edit.

**How to use it.** Open Video's professional finishing controls and find **Transcript editing**.
With a valid timed transcript and eligible selected source clips, enter words or a phrase in
**Search transcript**, choose a result, and select the desired range. Choose **Preview timeline
patch** to inspect affected clips, splits, commands, and record-timeline duration. Choose **Apply as
one edit** only after the preview is correct. **Clear selection** discards the pending selection.
Locked tracks, stale patches, ambiguous repeated source occurrences, invalid transcripts, nonlinear
or reverse retimes, and non-atomic linked A/V changes fail closed.

**Persistence and limits.** Apply commits the visual/audio arrays through normal composition history,
so undo/redo, Program Monitor, project save/reopen, browser export, and native export see the same
post-edit clips. The feature does not transcribe media, map nonlinear retimes, or claim a separate
frame-server contract beyond the existing composition runtime. See [the transcript-editing
qualification](../notes/1050-mh-025-independent-qualification.md).

### MH-026 — Multicam switching in playback and export

**What it is.** Video can attach two to four resolved visual angles to a bounded multicam source,
record angle changes at the playhead, and flatten the resulting camera cuts into the same projected
clips consumed by both Program Monitor mounts and sequence export.

**How to use it.** In **Professional Video Tools**, create a multicam source, attach the eligible
angles, select the source on the timeline, play or move the playhead, and use the angle buttons to
record cuts. Click a projected monitor segment to return to its host clip. Missing sources,
unsupported rates, reverse hosts, invalid cuts, or an over-bound projection refuse before preview or
export rather than producing a partial program.

**Persistence and limits.** Source records, selected angle, and cuts use ordinary Video history and
survive project save/reopen. Clip effects and masks are retained on projected fragments. Automatic
sync, audio-follow-video, proxy grids, more than four angles, and native live switching are not
claimed. See [the qualification note](../notes/1096-mh-026-qualified.md).

### MH-027 — A render queue that survives a restart

**What it is.** Video's delivery queue is bounded project state rather than a transient list of
promises. Planned, queued, running, interrupted, succeeded, failed, and cancelled jobs retain their
attempt and result metadata through project save/reopen. A restart converts an in-flight attempt to
**Interrupted** and invalidates its old execution lease, so a late callback cannot publish stale
success or failure over a newer Retry, Resume, or Cancel decision.

**How to use it.** In Video, open **Professional Workflow Tools**, create a supported delivery plan,
and add it to the render queue. Queue controls show the persisted status and provide **Resume** for
interrupted work, **Retry** for a failed attempt within the bounded attempt limit, and **Cancel** for
pending or running work. Video deliverables use the composition's real configured render route;
supported caption and QC deliverables execute and register checksummed Source Library results.
After reopening a project, inspect interrupted jobs and resume only the work you still want.

**Persistence and limits.** Restart does not pretend the application rendered while it was closed:
work is parked for explicit resume. Cancellation cannot erase a file a provider already finished
writing, but a late completion cannot change the cancelled record. Queue history is capped at 100
records per composition and finished records are forgotten first; in the extreme case where more
than 100 records are simultaneously non-terminal, the oldest pending record is pruned. Multi-device
arbitration relies on the existing single-active-editor project lock. See [the qualification
record](../notes/1075-mh-027-qualified.md).

### MH-086 — Bounded AAF handoff and MXF broadcast wrapper

**What it is.** Video supplies two narrow professional handoff routes: a native-CPU MXF preset that
encodes MPEG-2 4:2:2 video with 48 kHz PCM when audio is present, and a deterministic Sloom AAF
handoff manifest carrying the existing bounded OTIO timeline subset. The handoff is deliberately
named and typed as Sloom JSON, never as an AAF binary.

**How to use it.** For MXF, select **Broadcast MXF** as the Video delivery preset, choose **Native
CPU**, and use an exact non-drop 25 or 30 fps sequence; unsupported frame rates or backends refuse
before publishing output. For timeline interchange, open **Professional Video Tools**, export the
**Sloom AAF handoff**, and import the resulting `.sloom-aaf.json` file to recreate supported clips as
ordinary editable timeline content. An actual `.aaf` file remains disabled and is not silently read
as JSON.

**Persistence and limits.** Preset selection and handoff-import history survive normal project
save/reopen. The manifest contains references and bounded editable timeline structure rather than
embedded essence. This does not claim arbitrary AAF binary support, OP-Atom or certified broadcast
profiles, embedded captions, IMF/DCP, drop-frame output, or broad browser/hardware MXF. See [the
qualification record](../notes/2026-08-27-mh-086-bounded-aaf-mxf-wrappers.md).

### MH-087 — Bounded embedded MP4/MOV captions

**What it is.** Video can retain one primary semantic caption track and mux its plain timing, text,
and three-letter language into one default `mov_text` subtitle stream in supported Native CPU MP4
or MOV delivery. The same mounted workflow imports SRT, WebVTT, or the existing bounded TTML subset,
lets the editor choose a language, and retains the explicit embedding intent in project state.

**How to use it.** Open **Professional Workflow Tools → Captions**, author or import a non-empty
primary track, set its language, and enable embedded delivery. Choose a compatible Native CPU MP4
or MOV preset at aligned 24, 25, or 30 non-drop fps, then run the ordinary Video delivery. A stale
track choice, unsupported timebase/preset/backend, oversized or styled cue, overlap, control
character, or invalid grid timing refuses before publication rather than silently falling back to
a sidecar or dropping captions.

**Persistence and limits.** Caption cues, language, and embedding intent survive ordinary Video
history and project save/reopen. The render service publishes only after a clean FFmpeg exit and
cleans cancelled temporary work. This stopping point preserves plain timing/text/language only; it
does not claim CEA-608/708, SCC, styled/positioned serialization, browser/VAAPI embedding, WebM or
image-sequence output, drop-frame, text-export broadcast parity, or certification. See [the
qualification note](../notes/2026-08-27-mh-087-qualified.md).

### MH-088 — Bounded decoded-signal QC

**What it is.** Video can decode a bounded sample of actual browser-readable source-bin video
frames and PCM windows, then retain compact findings for sampled near-black/frozen intervals,
silence, and clipping. Each source says analyzed, partial, or unavailable, so a working video side
cannot hide a rejected audio side (or vice versa).

**How to use it.** In Video open **Professional Workflow Tools**, choose **QC & Delivery**, and click
**Run decoded-signal QC**. Use **Cancel analysis** to stop without retaining a partial report. Click
a finding to navigate to its source and sampled time. A source must remain browser-readable; an
oversized, unavailable, tainted, or undecodable side produces a bounded visible reason instead of a
fabricated pass.

**Persistence and limits.** The compact report survives normal history and project save/reopen,
but decoded pixels, PCM, URLs, handles, and media bytes do not. One run samples at most 64 sources,
120 video frames and 256 PCM windows per source, 256 MiB per browser-readable input, and 12 hours of
declared duration. This does not certify every frame, loudness, gamut, codec or stream conformance,
hardware output, or closed-app native QC. See [the qualification and repair
record](../notes/2026-08-27-mh-088-decoded-signal-qc-repair.md).

### MH-089 — External adapter and control sessions

**What it is.** Video exposes a bounded adapter contract for external-monitoring and control
devices. A registered adapter can discover normalized devices, open one lifecycle-owned session,
and receive capability-checked Play, Pause, Jog, and Shuttle commands. Late connections, device
swaps, hot adapter removal, unmount, discovery errors, and unsupported commands fail closed or
clean up without changing the Video composition.

**How to use it.** Open **Professional Video Tools → External monitoring & control**. When a
compatible separately installed adapter has registered devices, choose **Discover devices**, select
a device, choose **Connect**, and use only the controls that device advertises. Choose
**Disconnect** before changing equipment. In the normal shipped browser build no native adapter is
registered, so the panel reports the unavailable state instead of pretending the Program Monitor
or FFmpeg is external hardware.

**Persistence and limits.** The adapter registry and live session are runtime resources; they are
not written into the project, and control actions do not mutate authored composition state. This
stopping point does not bundle or certify DeckLink, AJA, NDI, SDI, HDMI, vendor SDKs, physical
output, genlock/timecode, or a hardware control-surface driver. Those require a compatible
separately supplied adapter and its own licensing/hardware. See [the qualification
note](../notes/2026-08-27-mh-089-qualified.md).

### MH-090 — Bounded rotoscoping and tracking

**What it is.** Video can analyze a bounded sequence of decoded frames, bake ordered tracking
keyframes for one supported mask, and resolve that persisted mask at the active clip time. The
mounted Program Monitor, stage preview, browser delivery, and native delivery use the same
interpolation, geometry validation, and explicit-refusal policy. Stabilization similarly consumes
a validated persisted analysis artifact through the shared render route.

**How to use it.** Select a Video clip, open **Professional Video Tools → Rotoscoping & tracking**,
create one rectangle or ellipse mask, choose the bounded analysis range, and run tracking. Review
or edit the baked keyframes, then preview and save normally. For stabilization, supply or generate
the bounded analysis artifact before enabling the effect. Ordinary browser or native delivery uses
the retained result; an unsupported shape, missing artifact, over-bound request, or tracked mask
that leaves source bounds reports a visible refusal instead of silently dropping or substituting
the effect.

**Persistence and limits.** Mask geometry, tracking keyframes, and stabilization artifacts survive
history and project save/reopen, participate in render-cache invalidation, and share bounded
cancellation and stale-result retirement. The qualified stopping point executes one non-inverted
rectangle or ellipse mask per clip. It does not claim an unbounded solver, arbitrary subject
analysis, multiple simultaneous masks, inverted-mask execution, or stabilization without a valid
analysis artifact. See the [terminal independent review](../../ops/team/messages/mh-090-rotoscoping-tracking/1787873050-mira-quill-terminal-verdict-pass.md).

### MH-091 — Native chroma-key parity

**What it is.** Video's retained chroma-key color, similarity, and edge-blend settings now use the
same RGB-distance alpha rule in the browser/stage preview and actual native FFmpeg sequence export.
Opaque red, blue, and other non-key foregrounds remain visible; keyed greens, threshold edges,
source alpha, and clip opacity agree across the supported routes.

**How to use it.** Select a Video clip, open its Inspector effects, enable **Chroma Key**, choose
the key color, and adjust **Similarity** and **Edge blend**. Preview the result in the Program
Monitor, then use the ordinary native sequence export. No legacy FFmpeg `chromakey` approximation
is substituted; unsupported or disabled settings follow the existing explicit refusal/ordinary
unfiltered route.

**Persistence and limits.** Key settings survive project save/reopen and participate in the normal
history, stage, cache, and export state. This is a deterministic bounded color-distance key, not a
full production keyer with spill suppression, matte cleanup or garbage mattes, tracked masks,
separate foreground/background correction, diagnostics, or guaranteed parity with a simultaneous
stroke effect. See [the qualification note](../notes/1083-mh-091-qualified.md).

### MH-093 — Capability-probed hardware encoding and alpha export

**What it is.** Video exposes Browser FFmpeg, native CPU, AMD VAAPI, NVIDIA NVENC, and Intel Quick
Sync targets, but a hardware choice is available only when this machine completes a real tiny
encode probe. A separate **WebM VP9 + Alpha** preset preserves alpha through the CPU/browser libvpx
route.

**How to use it.** In Video's export controls, choose a render target or leave it on **Auto**, then
choose a compatible preset. Auto selects a runtime-proven target and reports a CPU fallback when a
requested preset cannot run on the preferred hardware. A forced unavailable hardware target
refuses before a render starts. Choose **WebM VP9 + Alpha** for alpha-capable output; hardware H.264
targets refuse that preset instead of silently discarding transparency.

**Persistence and limits.** The render-target preference survives normal settings reopen. Hardware
availability is host-specific and is not inferred from an encoder name alone. This stopping point
does not claim universal GPU support, broad codec parity, or hardware alpha encoding. See
[the combined qualification note](../notes/1099-mh-062-mh-093-qualified.md).

## Paper

### MH-066 — Table of contents, index and cross-references

**What it is.** Paper now has a bounded document-local publication-reference model with authored table-of-contents entries, index markers, and named page/frame cross-reference targets. The mounted Inspector authors and inserts page/reference tokens, and one shared resolver drives canvas and print output without mutating authored frame coordinates.

**How to use it.** In a Paper text frame, position your cursor where you want to insert a reference. Open the Inspector and choose **Insert Reference Token** to add a table-of-contents entry, index marker, or cross-reference. The resolver automatically resolves page numbers and reference targets during output.

**Persistence and limits.** This qualifies bounded document-local authored references and shared canvas/print resolution only; cross-document references, automatic pagination, a full InDesign-class index editor, native Electron click-through, physical PDF production, and institutional certification remain outside scope. See [the Table of Contents note](../notes/1071-mh-066-qualified.md).

### MH-067 — Authored footnotes and endnotes

**What it is.** Paper provides a bounded document-owned catalog of footnotes and endnotes. Each
note retains its kind, text, page anchor, optional frame anchor, stable identity, and creation time;
Paper numbers each kind deterministically and renders footnotes on their page and endnotes on the
final page.

**How to use it.** Open the Paper Inspector's **Footnotes & endnotes** section. Choose **Footnote**
or **Endnote**, select an existing page and optionally an existing frame on that page, enter the
plain-text note, and add it. Select an existing record to edit its text, kind, or anchor, or remove
it. Normal Undo and Redo reverse add, update, and remove actions.

**Persistence and limits.** Authored notes survive normal Paper JSON save/reopen and print output
escapes their text before rendering. The catalog accepts at most 500 notes and 4,000 characters per
note; missing or stale anchors and malformed records fail without a false history change. This is
not citation management, cross-reference authoring, automatic pagination for oversized note blocks,
external-format note fidelity, rewriting imported DOCX notes, or unbounded content. See [the
qualification note](../notes/1089-mh-067-qualified.md).

### MH-068 — Anchored objects that flow with text

**What it is.** Paper can retain a bounded relationship between an existing object frame and an
existing same-page text, caption, speech-bubble, or thought-bubble frame. The object follows the
owner's resolved character position plus an optional physical X/Y offset, using the same geometry
for canvas and output without changing the object's authored fallback coordinates.

**How to use it.** On a page containing both an object and a supported text frame, open the Paper
Inspector's **Anchored objects** section. Choose the **Object frame** and **Text owner**, enter a
zero-based **Text offset**, optionally enter **Offset X (mm)** and **Offset Y (mm)**, and choose
whether a missing owner should hide the object or keep its authored position. Select **Link object**;
use **Update link** to relink or edit the relationship, or **Unlink** to detach it without moving its
authored frame coordinates. Normal Undo and Redo reverse those actions.

**Persistence and limits.** Relationships survive Paper JSON save/reopen and are normalized on
load. A document accepts at most 512 relationships; adding another is refused without changing
history, while updating an existing relationship at the cap remains allowed. This is a same-page,
one-relationship-per-object editor, not arbitrary word-processor anchoring, cross-page authoring,
external-format fidelity, automatic page-duplication repair, or automatic offset re-authoring after
a direct object drag. See [the qualification record](../notes/1079-mh-068-qualified.md).

### MH-069 — GREP styles and nested styles

**What it is.** Paper now persists bounded GREP-style rules and ordered nested-style steps, exposes authoring and validation in the Type inspector, and applies the resolved character-style overlays as an explicit undoable rich-text edit that reaches managed layout and export.

**How to use it.** In the Type inspector under **Styles**, create GREP style rules using a bounded regular-expression subset to match text and apply character styles automatically. Nested styles apply style sequences based on delimiter positions. Rules validate before matching and report invalid patterns.

**Persistence and limits.** Patterns use a deliberately bounded ECMAScript subset rather than InDesign's complete GREP dialect, and rules are applied deliberately rather than re-evaluated on every layout pass. Combining-mark grapheme segmentation remains a non-blocking advisory. See the qualification note at `ops/team/messages/mh-069-grep-nested-styles/`.

### MH-070 — Text variables and conditional text

**What it is.** Paper now persists a bounded document-local variable catalog and named conditional-text rules, resolves authored markers without mutating stored text, and shares those semantics across canvas layout, print output, the native render plan, and IDML export.

**How to use it.** In the Inspector, define text variables with author name, page number, date, or custom values. Use conditional text rules to show/hide content based on variable values. Insert markers in your text to resolve variables and conditionals during layout.

**Persistence and limits.** This is document-local text substitution, not external data merge. Conditions select text branches rather than arbitrary object visibility; bounded non-recursive values are a deliberate safety trade-off. See the qualification note at `ops/team/messages/mh-070-text-variables-conditional-text/`.

### MH-071 — Data merge

**What it is.** Paper can attach a bounded document-local CSV source, preview an authored template
against one record, create deterministic derived copies without changing the template, download all
records as JSONL, and route the selected record through the ordinary guarded PDF or PDF/X path.

**How to use it.** Open the Paper Inspector's **Data merge** section. Paste CSV text or attach a CSV
file, then preview a record and inspect resolved or missing merge fields. Use **Download all records
as JSONL** for the bounded derived set, or **Print / PDF this record…** for the selected record. Use
**Clear source** before replacing or removing recipient data. Clear, replace, undo/redo, and
save/reopen use the normal Paper document lifecycle.

**Persistence and limits.** The parser preserves quoted values, embedded newlines, and explicitly
quoted empty one-cell records while ignoring genuinely blank separator lines. It refuses duplicate or
ragged headers, invalid quoting, more than 64 columns or 500 records, values over 2,048 characters,
aggregate value data over 1 MiB, and files over 4 MiB. Derived IDs and JSONL are deterministic and the
authored base document stays immutable. This is not an external database connector or automated
batch-PDF service; only one selected record enters PDF at a time. See
[the qualification note](../notes/1080-mh-071-qualified.md).

### MH-072 — Book files across multiple documents

**What it is.** Paper now has a bounded book-file model for ordered document chapters, duplicate and unavailable-document refusal, continuous page ranges, non-mutating style synchronization, JSON persistence, and aggregate print-HTML composition.

**How to use it.** Create a new book file by selecting **File → New Book**. Add Paper documents as chapters. The book maintains chapter order, synchronizes styles across chapters, and computes continuous page numbering. Export as a single print or EPUB output.

**Persistence and limits.** The book references supplied Paper documents and does not copy their assets, provide cloud coordination, or perform cross-document text reflow. Chapter order is preserved through save/reopen. See [the Book Files note](../notes/1066-mh-072-book-files.md).

### MH-073 — Object libraries and snippets

**What it is.** Paper now provides a bounded device-local reusable object library: users can save an eligible selected frame with a name and description, search saved snippets, insert a detached copy on the selected page, or delete it, with fresh document-local identity and safe refusal of asset-bearing frames.

**How to use it.** Select a frame in Paper and open the Object Library panel. Click **Save as Snippet** to add it to your library with a name and description. Search saved snippets and click to insert a copy on the current page. Right-click to delete or edit a snippet.

**Persistence and limits.** This is a device-local reusable snippet library, not cloud/team sharing or linked live instances; asset-bearing frames are intentionally excluded. Snippets are stored locally and do not sync across devices. See [the Object Library note](../notes/1064-mh-073-object-library.md).

### MH-074 — Optical margin alignment

**What it is.** Paper can hang eligible leading and trailing punctuation by its managed font's real
glyph outline, making the visible ink align more cleanly with a text margin without changing line
breaking.

**How to use it.** Select a horizontal text frame, open the **Type** inspector, and enable
**Optical margin alignment (hang punctuation)**. Use left or justified LTR text. Eligible quotes,
dashes, punctuation marks, brackets, guillemets, bullets, and related marks can move by their actual
side bearing; letters do not. The control is disabled for vertical-rl frames, and centered, right,
RTL-base, and vertical lines remain unchanged.

**Persistence and limits.** The setting participates in normal Paper editing/undo and survives
`.sloom`/`.slppr` save/reopen. Managed canvas glyphs and the native PDF/render plan share the same
positions, and IDML writes the authored story preference. Wrap, line boxes, selection, carets, and
overset remain advance-based. Browser print HTML does not claim hanging parity, and this feature
does not optically pull round letters or expose an alignment-size percentage. See [the optical
margin note](../notes/1050-mh-074-optical-margin-alignment.md).

### MH-075 — Track changes and editorial redlining

**What it is.** Paper provides a bounded document-local revision list for proposed text changes.
Each record retains the before and proposed text, author, timestamp, target frame, insert/delete
classification, and pending, accepted, or rejected status. Accepting or rejecting a proposal
updates the authored text through ordinary Paper history; redline metadata does not enter output.

**How to use it.** Select a text frame and open **Track changes & redlining** in the Paper
Inspector. Enter an author and the proposed replacement text, then choose **Record revision**.
Pending records appear below the form. Choose **Accept** to apply the proposed text or **Reject**
to restore the recorded before-text. Use the normal Undo and Redo commands to reverse or reapply a
decision.

**Persistence and limits.** The document saves at most 512 bounded revision records and sanitizes
hostile or malformed records during reopen. Deciding a change clears stale rich-text runs so canvas,
print, and export all derive from the same authored plain text. This is local snapshot-based
redlining, not collaborative cloud editing, per-character Word-compatible tracking, external-format
revision fidelity, or legal/versioning certification. See [the qualification note](../notes/1073-mh-075-qualified.md).

### MH-076 — In-document review comments

**What it is.** Paper now supports bounded document-local review threads anchored to a page or frame, with replies, resolve/reopen, deletion, missing-anchor reporting, persistence sanitization, and one-step undo/redo through a dockable Review Comments panel.

**How to use it.** Open the Review Comments panel from the sidebar. Click **Add Comment** on a page or frame to start a thread. Type your comment and choose **Reply** to add to the thread. Use **Resolve** to mark a comment as addressed, or **Reopen** to flag it again. Comments do not appear in PDF or print output.

**Persistence and limits.** Comments are local single-user review state with page/frame references rather than text-position anchors, and they deliberately do not enter PDF, EPUB, IDML, CBZ, or print-HTML output. Duplicate hostile thread IDs and silent oldest-thread eviction are bounded non-blocking advisories.

### MH-077 — EPUB export

**What it is.** Paper now builds and validates a deterministic bounded EPUB package with ordered reflow text, metadata/navigation, required visual fallbacks, and guarded browser or native delivery.

**How to use it.** Open **File → Export** and choose **EPUB**. Paper creates a valid EPUB3 package with your document's content. Select the destination and confirm. The export validates the package structure before saving.

**Persistence and limits.** This is a bounded reflowable EPUB stopping point, not fixed-layout EPUB or third-party retailer certification. Visual elements are converted to images in the EPUB; interactive elements are simplified. See [the EPUB Export note](../notes/2026-08-26-mh-077-independent-review-verdict.md).

### MH-078 — Bounded IDML import

**What it is.** Paper opens an explicitly supported subset of InDesign IDML packages through a
bounded ZIP/XML importer. Representable pages, text frames, fonts, and document structure become
editable Paper content; unsupported or unsafe structures are refused instead of being silently
flattened, dropped, or decoded with replacement characters.

**How to use it.** From Paper's document import/open surface, select an `.idml` file. A compatible
package opens through the ordinary document-replacement guard. If a retained XML or metadata part
contains malformed UTF-8, an unsafe archive reference, excessive expansion, unsupported masters,
complex layers, linked graphics, or another unrepresentable construct, Paper names the refusal and
leaves the current document unchanged.

**Persistence and limits.** Imported representable content saves and reopens in the normal Paper
project format, and current-export-compatible packages can round-trip through the bounded importer.
This is not general InDesign compatibility: rich/threaded text, masters, complex layers, non-default
frame preferences, styles, swatches, and linked assets outside the supported subset fail closed.
Accepted near-limit XML still parses synchronously within the documented cap. See
[the combined qualification note](../notes/1085-mh-013-mh-060-mh-078-qualified.md).

### MH-079 — ISBN validation and standards-aware EAN-13 barcode placement

**What it is.** Paper has a retained barcode frame for ISBN-10, ISBN-13, and general EAN-13 values,
including check-digit repair, standards-derived bars, quiet zones, size presets, preflight, and
deterministic print output.

**How to use it.** Choose the **Barcode** tool and drag a frame, insert one from the page context
menu, or convert an eligible frame. In the Barcode inspector, enter an ISBN/EAN value. A 9- or
12-digit value gets a derived check digit; a wrong carried digit shows the expected repair and an
**Apply derived check digit** action. Choose whether to show human-readable digits, select a managed
digit font, and use the 80/90/100/125/150/200% size presets. Keep other printed objects out of the
quiet zones and run Paper preflight before strict export.

**Persistence and limits.** Raw author input and display settings survive `.sloom`/`.slppr`
save/reopen; bars and check digits are deterministically re-derived. Canvas, browser print, native
render plan, raster flattening, and validated PDF/X use the same geometry. Strict export blocks an
invalid value, out-of-range physical size, obstructed quiet zone, or missing exact managed font for
human-readable digits. Standards-derived geometry is tested, but physical scanner certification is
not claimed. See [the barcode note](../notes/1049-mh-079-isbn-ean13-barcode.md).

### MH-098 — Tagged accessible PDF

**What it is.** Paper has a separate **Accessible PDF** export that keeps the designed page as a
bounded raster snapshot and adds a deterministic tagged-PDF structure for reading order, text
semantics, document language, and authored descriptions of visual frames. It does not replace the
press-oriented PDF/X route.

**How to use it.** In the Paper document inspector, set **Document language (accessible PDF)**. For
every printable image or placed-document frame, select the frame and enter meaningful text in
**Alternative text (accessible PDF)**; the ordinary frame label is deliberately not substituted.
Open **Export**, choose **Accessible PDF**, and select the native destination when prompted. Export
stops with an actionable status if a required description is missing or the structural validator
does not pass.

**Persistence and limits.** Language and alternatives participate in normal Paper document
persistence. Reading order follows printable, visible frames, text-thread order, and LTR/RTL page
geometry. Export is bounded to 50 pages, 24 million raster pixels, 144 DPI, 16,000 semantic-text
characters per item, and 1,000 alternative-text characters. Japanese, Korean, Chinese, and other
Unicode semantics are retained in the tag tree; generic text extraction may not expose non-WinAnsi
paragraphs because no unsupported Helvetica overlay is emitted for them. The local validator is not
institutional PDF/UA certification or human assistive-technology testing. See [the qualification
record](../notes/2026-08-26-mh-098-qualified.md).

## Mobile

### MH-100 — A usable phone Video timeline and Flow shell

**What it is.** On an Android-class phone viewport, Video keeps the real Program Monitor visible
and presents the real timeline, inspector, Source Bin, scopes, effects, and diagnostics as one
keyboard-operable panel at a time. Flow keeps the live React Flow canvas and replaces colliding
desktop floating controls with a compact touch-focused dock.

**How to use it.** Open Sloom Studio on an Android phone or a matching mobile-web viewport. In
Video, use the tab row below the pinned Program Monitor; arrow keys, Home, and End move through the
tabs, and only the selected live panel is mounted. In Flow, drag nodes and pan normally, pinch with
two fingers or use keyboard zoom, and use the phone dock for **Fit**, **Clean**, and **Checks**.
The diagnostics sheet can be closed without leaving the canvas.

**Persistence and limits.** The shells reuse the ordinary Video and Flow stores, so authored work
saves and reopens through the same project route as desktop. Phone classification is bounded to a
touch-capable Android/mobile user agent and phone-sized viewport; desktop and tablet/DeX layouts
remain unchanged. This does not claim desktop-grade multi-track efficiency, background native
rendering, iOS, or iPad support. See [the qualification note](../notes/1094-mh-100-qualified.md).

## Keeping this guide current

The machine-readable source of truth is `ops/team/features.json`. Add a feature section only when its
record is `QUALIFIED` and not owner-excluded, then update the index and the count in this introduction.
Do not convert evidence-required, modelled, wired, executable, blocked, or externally excluded rows
into user-facing completion claims.
