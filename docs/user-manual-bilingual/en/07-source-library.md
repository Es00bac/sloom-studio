# Source Library

> **Current-source baseline — 0.9.16-b (2026-08-27).** The Source Library is
> local-first and records asset provenance. It does not imply a Sloom-hosted media
> cloud. Use the storage mode shown for an item when deciding whether a project will
> reopen on another machine.

The Source Library is the shared media repository for a Sloom Studio project. It holds imported files, generated assets, reusable components, and references to external resources. Every workspace—Flow, Video, Image, and Paper—can read from and write to the Source Library.

This chapter explains the concepts of Source Library, Source Bin node, and Generated Pool; sidebar modes; import workflows; item cards; drag-and-drop; regeneration; storage backends; cross-window sync; LAN serving; and Paper integration.

## Choose the right asset lifetime

| Mode | Use it when | Reopen and handoff behaviour |
|---|---|---|
| **Linked** | The original file should remain authoritative and available at a stable path. | The project retains a reference. If the file moves, use the relink workflow; never assume a guessed replacement is the same media. |
| **Managed** | The project needs a durable project-owned copy. | Use **Consolidate used media** (or the equivalent project packaging workflow) to copy used source files into managed project storage before moving the project. |
| **Session-only** | A browser file selection is sufficient for temporary work. | Browser-only selections, especially large files, can expire when the session closes and may need to be selected again. They are not a substitute for durable ingest. |

Use the item provenance and storage status instead of the thumbnail alone. The library preserves
origin/lineage information so that generated results, managed copies, and linked originals are
not silently confused.

### A portable-project pass

Before transfer or archival: save the project, inspect missing-link warnings, relink moved
originals, consolidate the media actually used by the project, then reopen the saved copy from its
destination. The cross-project **Source Catalogue** is a bounded device-local metadata index for
assets from projects you deliberately open or save; it is not a shared cloud drive and does not
make another project's scratch data portable.

## Core Concepts

### Source Library

The Source Library is the project-scoped collection of all bins and items. It is saved as part of the `.sloom` project, though large assets are usually stored outside the project file and referenced by path or identifier.

### Source Bin

The Source Bin is the visible panel that displays a view into the Source Library. A project can have multiple bins, each filtered by kind, tag, or search query. The Source Bin node in Flow reads a single Source Bin item.

### Generated Pool

The Generated Pool is a special area for assets created by Flow nodes, AI operations, and generative tools. Generated items are tracked separately so you can regenerate them, locate their generator node, or purge old generations.

## Sidebar Modes

The Source Bin sidebar has several modes:

- **Thumbnails** — Grid of preview thumbnails.
- **List** — Compact list with name, kind, date, and size.
- **Metadata** — List with columns for tags, generator, and usage.
- **Binned** — Grouped by bin.
- **Starred** — Only starred items.

Switch modes from the sidebar header menu.

## Bins

Bins organize items within the Source Library. Default bins include:

- **Imports** — Files imported from disk.
- **Generated** — Assets created by AI and Flow.
- **Editor Assets** — Pre-made titles, shapes, and templates.
- **Bookmarks** — Bookmarked items.

Create custom bins by right-clicking in the sidebar and choosing **New Bin**. Drag items between bins to organize.

## Import Workflows

### File Import

Import files with **File > Import Media** or by dragging files onto the Source Bin. Supported kinds include:

- Images: PNG, JPEG, WebP, TIFF, AVIF, PSD, RAW (when supported)
- Video: MP4, MOV, WebM, AVI, MKV (depending on backend)
- Audio: WAV, MP3, FLAC, OGG, M4A
- Documents: PDF, TXT, Markdown
- Subtitles: SRT, VTT
- Packages: ZIP, .slimg, .slppr
- Scripts: .sloom-script

### Flow Canvas Drop

Drag a file from your file manager onto the Flow canvas. Sloom Studio imports the file into the Source Library and creates a Source Bin node that references it.

### Native File Import

In native builds, Sloom Studio can import files by reference without copying them into the scratch folder. This saves disk space but means the project depends on the original file path. If the file moves, use **Repair** to relink.

## Item Cards

Each item in the Source Bin appears as a card. The card shows:

- Thumbnail or icon
- Name
- Kind badge
- Star status
- Generator indicator (for generated items)
- Usage count

### Primary Actions

Hover over a card to reveal primary actions:

- **Preview** — Open in a viewer.
- **Place** — Add to the active workspace.
- **Open** — Open with the default external application.

Right-click a card for the full context menu.

## Context Menu

Right-click a Source Bin item for these actions:

- **Preview / Place / Open**
- **Locate Generator Node** — For generated items, jump to the Flow node that created it.
- **Regenerate** — Rerun the generator node with the same or updated inputs.
- **Copy Reference** — Copy an identifier or path for use in nodes.
- **Metadata** — View and edit tags, notes, and provenance.
- **Remove** — Remove the item from the Source Bin. Does not delete the underlying file unless you choose **Delete File**.

## Drag-and-Drop to Workspaces

Items can be dragged from the Source Bin into any workspace:

- **Flow** — Creates a Source Bin node or connects to a compatible input.
- **Video** — Adds to the Source Bin and timeline.
- **Image** — Opens the image for editing or places it as a layer.
- **Paper** — Places the image in an image frame or creates one.

Drag behavior depends on the target. For example, dragging an image onto the Video timeline creates a clip; dragging it onto the Paper page creates an image frame.

## Regenerate

Generated items can be regenerated from the Source Bin:

1. Right-click the generated item.
2. Choose **Regenerate**.
3. Confirm whether to use the original inputs or update them.

Regeneration is useful when you change a prompt, model, or seed and want to refresh a batch of assets.

## Locate Generator Node

For assets created by Flow, the Source Bin item stores a reference to the generator node. Right-click the item and choose **Locate Generator Node** to pan the Flow canvas to that node and select it.

## Storage Backends

The Source Library supports multiple storage backends:

| Backend | Description |
|---------|-------------|
| Scratch | Default local scratch folder. |
| IndexedDB | Browser-based storage for web builds. |
| Native | Native file system access in Electron and mobile. |
| Android | Android media store and app storage. |
| Data / Blob | In-memory or blob storage for temporary assets. |

The active backend depends on the platform and settings. Some backends have size limits or performance trade-offs.

### Hydrate Assets

Hydration copies referenced assets from a remote or deferred backend into the active workspace. For example, a project opened on a new machine may need to hydrate assets from cloud or LAN storage before they can be edited.

## Cross-Window and Native Sync

Sloom Studio supports multiple windows for the same project. Changes to the Source Library in one window sync to others. This includes:

- New imports
- Regenerated items
- Renamed items
- Removed items

Native sync uses file system watchers. Browser sync uses broadcast channels or shared workers when available.

### Repair

If a linked asset is moved, renamed, or deleted, Sloom Studio marks it as missing. Use **Source Library > Repair** to search for the file or relink it manually.

## LAN Serving

Sloom Studio can expose selected project assets over a configured local network route. This is useful for:

- Sharing assets between a desktop and a tablet.
- Collaborative review on the same Wi-Fi network.
- Offloading storage to another machine.

The phone/desktop LAN handoff is a paired local workflow. It is separate from the optional
self-hosted collaboration and project-sync service: the former transfers or hosts a local session;
the latter is a service you run and configure under your own authority for durable sync/review.
Neither one is an automatic Sloom-hosted cloud.

### Security

LAN serving is limited to the local network. Do not enable it on untrusted networks, and disable it when not needed.

## Paper Integration

The Source Library is tightly integrated with the Paper workspace:

- Drag images from Source Bin to place them in image frames.
- Import fonts from Source Bin for typography.
- Link .slppr documents as embedded documents.
- Export pages back to Source Bin as flattened images.

Paper documents track which Source Library items they reference. The Linked Assets panel shows these references and their status.

## Project Snapshots and Export

### Project Snapshots

A project snapshot captures the current state of the Source Library and all workspaces. Use snapshots to:

- Save milestones.
- Experiment safely.
- Compare versions.

Create a snapshot from **File > Project Snapshot**.

### Export Source Library

To share a project with all assets included:

1. Choose **File > Export Assets**.
2. Select the items or bins to export.
3. Choose a destination folder.
4. Sloom Studio copies all referenced files into the folder.

For a fully portable package, use **File > Package Project**.

## Caveats

- Large Source Libraries can slow down project load times.
- Browser builds may have storage quotas.
- Linked file references become missing if files move; use relink/repair, then consolidate or
  package when portability matters.
- Session-only browser media can require reselection after the browser session closes.
- LAN performance and availability depend on the paired local network. Self-hosted sync/review
  requires its explicitly configured endpoint and is a separate authority from phone LAN handoff.
- Generated Pool items may accumulate; purge old generations periodically.

## Best Practices

- Organize items into bins early.
- Star frequently used items.
- Use descriptive names and tags.
- Regenerate from the Source Bin instead of hunting for the generator node.
- Package projects before moving them to another machine.
