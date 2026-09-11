# 2. Getting started

## Install

| Platform | How |
|---|---|
| **Android / DeX / ChromeOS** | Install from Google Play, or sideload the APK. On a tablet, in DeX, or on ChromeOS you get the desktop-class layout automatically. |
| **Linux** | AppImage (run directly) or `.deb` (Debian/Ubuntu); Arch/Manjaro packages are also produced. |
| **Windows** | Run the installer (`.exe`). |
| **macOS** | Open the `.dmg` and drag Sloom Studio to Applications. |

The supported commercial license is a one-time purchase. There is no Sloom content-account sign-in
step. A Google Play build can verify the purchase and deliver its permanent license key; desktop
Community builds can be opened and used immediately.

## The lay of the land

When Sloom Studio opens you see:

- A **top bar** with the menu (Project, File, Edit, …), the **workspace switcher** (Flow, Video,
  Image, Paper), a layout control, zoom, and Settings.
- The **workspace switcher** is how you move between the four tools. Each workspace keeps its own
  panels and layout.
- A **Source Bin** rail (the shared [source library](09-source-library.md)) you can open on any
  workspace.

Switch workspaces freely — you don't lose anything; all four stay live inside the same project.

## Add a provider key (so generation works)

Generation needs at least one AI provider. Open **Settings** (the gear in the top bar) → the
**Providers** section, pick a provider, and paste your API key. The most common starting points:

- **Google Gemini** — paste a Gemini API key from Google AI Studio.
- **OpenAI** — paste an OpenAI key (or point at an OpenAI-compatible endpoint).
- **Atlas Cloud** — paste an Atlas key to reach a broad catalog of image and video models through
  one gateway.

Full details, including Google **Vertex AI** sign-in, are in [Providers & API keys](04-providers-and-keys.md).

> You can do a lot **without** a key — paint and edit in Image, lay out pages in Paper, cut a
> timeline in Video, and design or execute local-only Flow operations. A cloud provider key is
> needed only when an action calls that provider; supported Local/Open and Android Accelerator
> routes use their own local configuration instead.

## Your first project

1. **Project → New** creates a fresh `.sloom` project.
2. Open **Flow** and add a node from the toolbar — for example a **Text → Image** node. Type a
   prompt, choose a model, and run it. The result lands in the source library.
3. Switch to **Image**. Your generated image is already in the Source Bin — drop it onto the
   canvas, add a layer, and paint or mask on top.
4. Switch to **Paper**, add a page, and place the image into a frame.
5. **Project → Save** writes everything — all four workspaces and the library — into one `.sloom`
   file.

That round trip — generate in Flow, refine in Image, lay out in Paper, all in one project with no
exporting — is the core of how Sloom Studio is meant to be used.

## A good first habit: set a scratch folder

Large generated assets are kept in a **scratch folder** next to your project so the `.sloom` file
stays lean and opens fast. **Project → Set Scratch Folder…** lets you choose where. See
[Projects & files](03-projects-and-files.md).

## Know where recovery lives

Sloom Studio captures a recovery snapshot after changes settle for about 30 seconds and again at
important lifecycle boundaries. If a session ends unexpectedly, open **Project Library** and use
the recovery entry's **Recover** or **Export** action. Named snapshots and project history are
separate from autosave; use them before a risky edit or handoff. See
[Troubleshooting & recovery](12-troubleshooting-and-recovery.md).

---

Next: [Projects & files →](03-projects-and-files.md)
