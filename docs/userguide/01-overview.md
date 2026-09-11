# 1. Overview & concepts

Sloom Studio is one application with four **workspaces**. They are not separate programs that
happen to be bundled together — they share a single project file, a single asset library, and a
single set of provider connections. Understanding the handful of ideas below makes everything
else fall into place.

## The big idea: one project, four tools

Most AI media work today means hopping between a chat tool, an image tool, a video editor, and a
layout program — exporting and re-importing at every step. Sloom Studio collapses that into one
place:

- **Flow** is where you *generate*. You build a graph of nodes — prompts, text, image, video,
  audio, and composition — wire them together, and run them. Every result is captured.
- **Image** is where you *paint and edit* stills, with layers, masks, and a real brush engine.
- **Video** is where you *sequence* clips on a timeline with overlays, keyframes, and audio.
- **Paper** is where you *lay out* pages for a comic, book, or document and export print-ready
  files.

A clip you generate in Flow appears in Image, Video, and Paper automatically. A panel you paint in
Image can be dropped onto a Paper page. Nothing is exported and re-imported between the four.

## Core concepts

### Projects (`.sloom`)
A **project** is one `.sloom` file that holds the state of all four workspaces plus the shared
asset library. Open a project and you're back exactly where you left off in Flow, Image, Video,
and Paper at once. See [Projects & files](03-projects-and-files.md).

Individual workspaces also have their own standalone document formats — `.slimg` for an Image
document and `.slppr` for a Paper layout — so you can hand a single image or layout to someone, or
pull one into a larger `.sloom` project.

### The source library
Every project has a **source library** (the Source Bin): a shared, named-bin collection of
assets. Anything you generate or import lands here and is available from every workspace. This is
what keeps the four tools in sync. See [The source library](09-source-library.md).

### Bring your own keys
Cloud generation calls the AI **providers** you connect with your **own API keys** — Google Gemini
and Vertex AI, OpenAI, Hugging Face, Stability AI, Black Forest Labs (FLUX), Atlas Cloud, and
ElevenLabs for audio. Local/Open endpoints and the optional Android Accelerator can run supported
jobs without a hosted Sloom generation service. You choose the route and therefore control its cost
and data handling. See [Providers & API keys](04-providers-and-keys.md).

### Capabilities follow the model, not the menu
A model that supports reference images or masks exposes those abilities wherever it runs —
whether you reach it through a direct provider key or through a cloud gateway. Sloom Studio reads
each model's real capabilities and shows you only the controls that model actually supports, so
the interface never promises something the model can't do.

### Local-first and private
Your keys and project files stay on your device by default. There is no Sloom Studio content
account or content telemetry, and no cloud round-trip except the provider calls or optional
self-hosted collaboration/sync service you deliberately configure. Google Play builds can contact a
limited licensing service to verify a purchase and deliver the permanent license key; that service
does not receive project media.

### Current professional feature set
The base chapters explain the normal workflow. Sloom Studio `0.9.16-b` also includes qualified,
bounded professional systems: autosave and crash recovery, named project history, configurable
shortcuts, Flow cache/spend/scheduling/batches, high-bit and CMYK Image documents, professional
Video audio/colour/export tools, advanced Paper publishing and accessible PDF, collaboration,
extensions, and automation. The [qualified-feature guide](15-qualified-missing-hundred-features.md)
documents every capability and its honest limit; the
[maturity reference](16-feature-maturity-reference.md) is the complete ledger map.

## Where it runs

| Surface | Notes |
|---|---|
| **Desktop** | Linux, Windows, macOS. The full experience, with a native menu bar and floating/dockable panels. |
| **Android phone** | A focused, touch-first shell. Desktop-only features are hidden rather than crammed in. |
| **Android tablet / Samsung DeX / ChromeOS / Aluminium OS** | Treated as a touch-usable desktop — close to the full desktop experience, with pen and touch input. |

Pen input — pressure, tilt, and barrel rotation, including the Samsung S Pen and graphics tablets —
is supported across the Image brush engine. See [Keyboard & stylus](11-keyboard-and-stylus.md).

---

Next: [Getting started →](02-getting-started.md)
