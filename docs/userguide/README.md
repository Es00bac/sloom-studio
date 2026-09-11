# Sloom Studio — User Guide

> **Documentation baseline:** Sloom Studio source `0.9.16-b`, verified August 27, 2026.
> The public Android and desktop download channels can carry different build labels; check the
> download page or store listing for the version installed on your device.

**Sloom Studio** is a local-first creative suite for building with generative AI on your own
terms. Four connected apps — **Flow**, **Image**, **Video**, and **Paper** — live inside one
project and share one asset library, so you can go from an idea to a finished image, video, or
printed page without juggling tools or re-importing files.

Sloom Studio runs on **desktop** (Linux, Windows, macOS), **Android** phones and tablets,
**Samsung DeX**, and **ChromeOS / Aluminium OS** desktop mode. The supported paid license is a
one-time purchase, not a subscription. Creative work is local-first: provider credentials stay on
your device, and generation uses either a provider you configure or an optional local runtime.
Sloom does not host your prompts or media. The Play build can contact a limited licensing service,
and collaboration or sync occurs only when you deliberately configure a self-hosted service.

---

## Start here

| Guide | What it covers |
|---|---|
| [1. Overview & concepts](01-overview.md) | What Sloom Studio is, the four workspaces, and the ideas (projects, the source library, capabilities) that tie them together. |
| [2. Getting started](02-getting-started.md) | Installing, creating your first project, and the lay of the land. |
| [3. Projects & files](03-projects-and-files.md) | The `.sloom` project, the per-app `.slimg` / `.slppr` files, saving, backups, and scratch assets. |
| [4. Providers & API keys](04-providers-and-keys.md) | Connecting Gemini, Vertex AI, OpenAI, Hugging Face, Stability, FLUX, Atlas Cloud, and ElevenLabs — and how cost and privacy work. |

## The four workspaces

| Workspace | What you make in it |
|---|---|
| [5. Flow](05-flow.md) | Node-based generation graphs — wire prompts, models, and media together into repeatable pipelines. |
| [6. Image](06-image.md) | A layered image editor with masks, a full brush engine, adjustments, and model-in-the-loop editing. |
| [7. Video](07-video.md) | A multi-track timeline editor with keyframes, overlays, and transform animation. |
| [8. Paper](08-paper.md) | Page-based publishing and print-ready layout for comics, books, and documents. |

## Reference

| Guide | What it covers |
|---|---|
| [9. The source library](09-source-library.md) | The shared asset bin that every workspace reads from and writes to. |
| [10. Settings & layout](10-settings-and-layout.md) | Provider settings, workspace layouts, panels, and per-workspace menus. |
| [11. Keyboard & stylus](11-keyboard-and-stylus.md) | Shortcuts, pen pressure/tilt, S Pen, and tablet input. |
| [12. Troubleshooting & recovery](12-troubleshooting-and-recovery.md) | Recovering work, repairing missing media, render diagnostics, and safe problem reports. |
| [13. Accessibility, collaboration & automation](13-accessibility-collaboration-and-automation.md) | Keyboard and screen-reader operation, self-hosted teamwork, extensions, scripting, and headless use. |
| [14. Provider packs & model cards](14-provider-packs-model-cards.md) | Connect, discover, visually design, test, activate, resize, import, and share portable provider cards. |
| [15. Qualified Missing Hundred features](15-qualified-missing-hundred-features.md) | What each currently completed Missing Hundred feature does, where to find it, how to use it, and its honest boundaries. |
| [16. Feature maturity reference](16-feature-maturity-reference.md) | Audit of all 97 in-scope Missing Hundred rows, plus practical documentation for wired, executable, modelled, and unavailable features. |

---

> **Conventions.** Menu paths are written like **Project → Open…**. Keyboard shortcuts use
> `Ctrl` on Windows/Linux and `⌘` on macOS. Where a feature needs an AI provider, it is marked
> *(needs a provider key)*.
