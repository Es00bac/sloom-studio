# 3. Projects & files

Sloom Studio keeps everything you do inside **one project**, and gives each workspace its own
portable document format for when you want to share or reuse a single piece.

## The `.sloom` project

A `.sloom` file is the whole project: the state of **all four workspaces** (your Flow graph, Image
documents, Video timeline, and Paper layout) plus the shared [source library](09-source-library.md).
Open a `.sloom` and you're back exactly where you left off, everywhere at once.

| Action | Menu |
|---|---|
| New project | **Project → New** (`Ctrl+N`) |
| Open a project | **Project → Open…** (`Ctrl+O`) |
| Save | **Project → Save** (`Ctrl+S`) |
| Save a copy | **Project → Save As…** (`Ctrl+Shift+S`) |

### Backups
When you overwrite an existing project, Sloom Studio writes a timestamped `.bak-…` copy alongside
it first, so a save can always be rolled back. These backups are ordinary files you can delete or
archive.

### Autosave, recovery, and named history

After project changes settle for about 30 seconds, Sloom Studio writes a bounded recovery snapshot
using the same complete project serializer as normal saves. It also flushes at focus-loss and
lifecycle boundaries. Recovery entries appear in **Project Library**, where you can inspect,
recover, export, or remove them without overwriting the current project by surprise.

Use **Project → History** for retained project versions and named snapshots. Creating a named
snapshot is a deliberate checkpoint; autosave is the safety net. Both cover the shared project,
including Flow, Image, Video, Paper, source-library state, and usage state.

### Scratch assets
Large binary assets (generated images, video, audio) are stored in a **scratch folder** next to
the project — a `…signal-loom-scratch` directory — rather than being inlined into the `.sloom`
file. This keeps the project file small and fast to open. Choose the location with **Project → Set
Scratch Folder…**. When you move a project, keep its scratch folder with it (or use **Export**,
below, to produce a fully self-contained copy).

### Exporting a portable project
**Project → Export .sloom Project…** writes a self-contained copy with assets embedded, suitable
for handing to someone else or archiving. **Project → Export Assets…** writes out just the media.

## Per-app documents

Each workspace also has a standalone file format. These are the equivalent of a `.psd` or `.xcf` —
a single document you can save, reopen, hand to a collaborator, or pull into a larger `.sloom`
project.

| Format | Workspace | Opened/saved from |
|---|---|---|
| `.slimg` | Image | **File → Open… / Save As…** in the Image workspace |
| `.slppr` | Paper | **File → Open… / Save As…** in the Paper workspace |

Both are compact ZIP-based containers: the document structure plus the layers/assets stored as
binary (not base64), so they stay small. A `.slimg` carries your full layer stack and masks; a
`.slppr` carries your pages, frames, and placed assets.

> The **File** menu (per-app documents) is distinct from the **Project** menu (the whole `.sloom`).
> Use **File** when you want to work with a single image or layout; use **Project** for the whole
> multi-workspace project.

## Keeping projects healthy

- **Stability first.** Sloom Studio is built to stay responsive on large projects. If a project
  feels heavy, most of the weight is embedded assets — keeping a scratch folder (above) is the fix.
- **Sync across devices.** A portable, exported `.sloom` (assets embedded) is the format to move
  between machines. The lean working `.sloom` + its scratch folder is best kept together on one
  device. Optional self-hosted sync and collaboration are available, but only after you configure
  and trust the server; they are not an automatic Sloom cloud upload.
- **Relink instead of guessing.** If linked Video media moves, use Video's relink/consolidate
  workflow. Sloom reports an offline source rather than silently replacing it with a same-named
  file.
- **Clean up deliberately.** The project-size tools identify retained, referenced, and removable
  project media. Review the list before deleting anything; portable exports remain the safest
  archival copy.

---

Next: [Providers & API keys →](04-providers-and-keys.md)
