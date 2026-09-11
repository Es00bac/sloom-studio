# 9. The source library

The **source library** (the *Source Bin*) is the shared asset collection at the heart of every
project. It is the single most important reason the four workspaces feel like one app: **every
workspace reads from and writes to the same library.**

## What's in it

Anything that is media in your project: images and clips you generate in Flow, images you import
or paint in Image, audio, and any file you drag in. Each asset is kept once and referenced
everywhere.

## How it stays in sync

- Generate a clip in **Flow** → it appears in the library → it's immediately available to drop
  into **Image**, **Video**, and **Paper**.
- Paint a panel in **Image** → it's in the library → place it on a **Paper** page.

No exporting, no re-importing, no "where did I save that" — the library *is* the shared storage.

## Organizing with bins

- Assets live in named **bins** you create (**New Bin**), so a big project stays tidy — for
  example a bin per chapter, per character, or per generation pass.
- **Search** finds assets across bins.
- **Collapse All / Expand All** manage a large library.
- A **Generated Pool** tab collects everything produced by generation, separate from assets you
  curated by hand.

## Reusable source nodes (in Flow)

In the Flow workspace, drag any library asset onto the canvas to create a **source node** — a
reusable input you can wire into the graph. The same reference image can feed many nodes without
re-uploading.

## Where it's stored

The library's heavy binary assets live in the project's **scratch folder** (see
[Projects & files](03-projects-and-files.md)), keeping the `.sloom` file small. When you export a
portable project, the library is embedded so the copy is self-contained.

Desktop Video ingest distinguishes **linked originals** from **managed project copies** and records
whether an item was ingested or generated. If a linked original moves, relink it explicitly; Sloom
does not guess based on a matching filename. **Consolidate** can copy used media into managed project
storage for a portable handoff.

The optional cross-project asset catalogue indexes metadata and references without silently copying
private media into a hosted service. Availability and permissions still follow the device or
self-hosted service you configured.

---

Next: [Settings & layout →](10-settings-and-layout.md)
