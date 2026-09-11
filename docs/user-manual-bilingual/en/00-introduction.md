# Introduction to Sloom Studio

> Current manual baseline: **Sloom Studio source 0.9.16-b**, verified August 27, 2026. Public desktop and Android channels can carry separately labelled builds; use the version shown by the installed application when comparing behavior.

Sloom Studio is a local-first creative suite with four connected workspaces: Flow automation, Video editing, layered Image editing, and Paper publishing. They share one project and one Source Library, so an asset can move from generation to retouching, layout, or editing without being exported and re-imported between separate applications.

AI is optional. You can draw, edit imported media, assemble video, and publish documents without configuring a provider. When you do use a provider, Sloom Studio uses credentials and routes that you configure; it does not include usage credits or silently choose a substitute provider/model.

The desktop application is the most complete environment for durable filesystem saves, native rendering, linked media, platform menus, and local services. Android provides the same four-workspace project model with touch/stylus, Samsung DeX, file-picker, and accelerator/LAN capabilities. A browser route exists for compatible workflows, but browser downloads are not acknowledged as durable native saves and native-only operations are clearly unavailable.

## Product and privacy model

- Projects are ordinary `.sloom` files under your control.
- There is no Sloom content account and no automatic Sloom-hosted project cloud.
- Optional collaboration and synchronization use a self-hosted authority that you configure and operate.
- Provider requests send only the material required for the action to the provider/endpoint you selected.
- The Play build contacts a limited Sloom service for purchase verification and permanent-license delivery; that service is not project storage.
- Local and credential-free routes remain available where the relevant runtime/model is installed.

## The four workspaces

### Flow

Flow is a typed node graph for repeatable creative automation. Add nodes, connect compatible handles, and run a requested output. The runtime evaluates dependencies, preserves attempt evidence, and reuses validated results when inputs have not changed.

Use Flow to:

- Generate or transform text, images, video, and audio through configured providers or local routes.
- Build prompts and structured data from variables, lists, conditionals, loops, files, and reusable functions.
- Run bounded prompt batches, partial reruns, and local schedules.
- Apply an enforceable spend cap before a paid request leaves the device.
- Export a credential-free node pack or reuse project/source assets across workspaces.

Flow validates connection types and refuses unresolved cycles, missing required inputs, unsupported model capabilities, invalid packs, and spend-cap violations instead of pretending that a different route succeeded.

### Video

Video is a non-linear editor with source and program monitors, a multi-track timeline, inspectors, effects, keyframes, captions, audio tools, scopes, QC, and export delivery.

Use Video to:

- Link or copy source media and organize it in bins.
- Mark source ranges, insert/overwrite, trim, split, ripple, roll, slip, slide, and move clips.
- Edit clip transforms/keyframes, speed, masks, tracking/keying, nested sequences, multicam, captions, and transcript-driven changes.
- Mix, repair, duck, crossfade, meter, and deliver audio.
- Render through a durable native queue, including a direct hardware path for eligible simple sequences and a general compositor for richer work.

Preview and export share the authored timeline contract. Unsupported media, effects, hardware, or delivery combinations report a specific refusal rather than silently changing the result.

### Image

Image is a layered raster/vector editor with selections, masks, adjustments, retained editable objects, painting, retouching, color management, interchange, and generative editing.

Use Image to:

- Paint with Studio Brush or the licensed Tiltmark V3 physical-media engine.
- Work with layers, groups, clipping, Smart Objects/filters, editable text/vector content, masks, channels, and named snapshots.
- Use precise selection, transform, fill, healing, merge, animation, batch, and photographic workflows.
- Open/save editable `.slimg` documents and exchange supported PSD/XCF content.
- Use bounded native high-bit RGB and CMYK document routes with explicit precision/profile limits.

High-bit/CMYK and complex interchange routes preserve native authority only when the exact supported contract is available. Unsupported combinations fail closed before a lossy mutation.

### Paper

Paper is a multi-page publishing environment for comics, manga, books, magazines, zines, and professional print/digital output.

Use Paper to:

- Build pages/spreads with parent pages, margins, columns, grids, frames, anchored objects, wraps, and threaded stories.
- Typeset horizontal and vertical Japanese text, ruby, tate-chu-yoko, notes, references, tables of contents, indexes, variables, GREP/nested styles, and book files.
- Draw panels, balloons, tails, captions, and SFX with editable geometry.
- Manage exact fonts and ICC profiles, preflight output, and soft-proof color.
- Export supported PDF/X, accessible PDF, EPUB, CBZ/webcomic, KDP, packaged-print, and bounded IDML workflows.

Strict print output is fail-closed: missing managed fonts/profiles, unsupported structures, or failed preflight do not produce an output falsely labelled as conforming.

## First run and language

The first launch asks you to choose English or Japanese. You can change this later in **Settings → Interface**. The locale affects interface text and relevant defaults; it does not translate existing document content.

Japanese Paper workflows include right-side binding, vertical composition, ruby/furigana, tate-chu-yoko, emphasis marks, kinsoku, and Japanese font handling. Individual fonts and output routes can still impose limitations, which Paper reports during preflight.

## Community edition and Sloom Studio Pro

The **Community edition** is free for personal and noncommercial use. It keeps all four workspaces and Studio Brush, and it does not place a visible watermark on artwork. The **Sloom Studio Pro** permanent unlock is the commercial license and currently adds Tiltmark V3 plus professional print-production exports. It also marks output metadata as licensed and removes the startup notice.

License keys are verified locally with the bundled public-key verifier. The Play purchase route can deliver a key, but routine local verification does not require uploading a project or media. The exact commercial terms are governed by the repository license and the purchase terms, not by this manual summary.

To view or activate the edition, open **Settings → License**.

## Navigation

### Workspace controls

The top application chrome provides the workspace switcher, project commands, undo/redo, workspace tools, layout/history access, and status surfaces. Each workspace replaces the central canvas and contextual tools while retaining the project and Source Library.

### Application menu

Choose **Compact** or **Menubar** presentation in Settings. Desktop builds also expose a native application menu; on compatible Linux desktop environments it can be exported to the system global menu. Menu commands are workspace-aware, and custom keyboard shortcuts use the same command registry.

### Command palette

Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS) to search available commands. Text-input focus retains ordinary editing shortcuts, so a global command does not consume keystrokes while you are typing.

### Panels and layouts

Workspace panels can be resized, docked, hidden, and—where supported—floated into separate windows. Named layouts preserve panel geometry. Phone layouts replace some desktop surfaces with touch-oriented sheets and compact controls.

## Project and document files

| Extension | Purpose |
| --- | --- |
| `.sloom` | Main project: Flow graphs, Source Library metadata/assets, workspace state, Image/Paper/Video project data, and project settings. |
| `.slimg` | Editable Image document with layered state and the native assets required by supported round trips. |
| `.slppr` | Editable Paper publication package with its manifest, managed document assets, fonts/profiles where authorized, and layout state. |
| `.sloom-script` / `.sloom-script.json` | Portable Flow script accepted by the Source Library import route. |
| `.sloom-provider.json` | Credential-free provider/model-card pack. Imported packs are validated before activation. |
| `.sloompack` | Shared project/workspace package used by supported import/export surfaces. |

Media can be embedded/managed, linked to an external source, or session-only depending on the import path, size, platform, and user choice. The Source Library shows durability and missing-media state. Before moving a project, use consolidation/packaging and confirm that every linked asset, font, and profile needed by the destination is included or reachable.

## Create, open, save, and recover

### Create

Use **Project → New** (or the current New Project command) to start an empty project. If open Image or Paper documents contain unsaved work, the replacement flow asks you to save, retain a recovery copy, discard, or cancel as appropriate.

### Open

Use **Project → Open** to select a `.sloom` file. Desktop startup can optionally reopen the last project. If the primary file is unreadable, startup recovery can offer a retained backup, retry, another file, or a new project without silently replacing the original.

Standalone `.slimg` and `.slppr` files open in their native workspace. Paper documents can remain as separate tabs; saving a standalone document writes the editable package rather than flattening it into the project.

### Save

On desktop, **Save** writes the current project through the native transaction and is acknowledged only after the write succeeds. **Save As** selects a new path. Browser builds download a project copy; a download is useful, but it is not treated as an acknowledged native filesystem save.

Autosave/recovery captures bounded snapshots after changes settle and at lifecycle boundaries. The project history stores named snapshots and supports restore. Recovery is not a replacement for deliberate backups: keep important `.sloom`, `.slimg`, and `.slppr` files in a separately backed-up location.

### Scratch and project folders

Desktop project folders own scratch/cache/output storage for native media work. Use **Set Scratch Folder** or the Project Library controls when the current project needs a different location. Moving or deleting linked originals can make media offline; use relink/consolidate rather than editing serialized paths by hand.

## Continue reading

- [App Interface](01-app-interface.md)
- [Settings](02-settings.md)
- [Flow Workspace](03-flow-workspace.md)
- [Video Workspace](04-video-workspace.md)
- [Image Editor Workspace](05-image-editor-workspace.md)
- [Paper Workspace](06-paper-workspace.md)
- [Source Library](07-source-library.md)
- [Flow Node Reference](08-node-reference.md)
- [Shortcuts and Input Methods](09-shortcuts.md)
- [Japanese Translation Assessment](10-translation-assessment.md)
