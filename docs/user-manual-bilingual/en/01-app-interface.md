# App Interface

> Current manual baseline: **Sloom Studio source 0.9.16-b**, verified August 27, 2026. Labels and panel availability are contextual; the command palette and active menu are the authority for the current workspace.

Sloom Studio's interface is built around a shared shell that adapts to each workspace. The top navbar, app menu, and status areas are always present, while the center of the window changes to show the Flow canvas, Video timeline, Image Editor viewport, or Paper layout. This chapter describes the shared chrome, the workspace-specific toolbars and panels, and the input methods available across the application.

## Top Navbar

The top navbar runs across the full width of the window. It is divided into several zones.

### Brand and Workspace Tabs

On the far left is the Sloom Studio wordmark. Next to it are the workspace tabs:

- **Flow**
- **Video**
- **Image**
- **Paper**

The active tab is highlighted. Click a tab to switch workspaces. You can also cycle workspaces with `Ctrl+Tab` and `Ctrl+Shift+Tab` (Windows/Linux) or `Cmd+Tab` and `Cmd+Shift+Tab` (macOS).

### Tool Slots

The center of the navbar contains tool slots that change based on the active workspace. In Flow these slots may show zoom controls and run status. In Video they show transport controls. In Image and Paper they show the active tool and quick modifiers. The exact contents depend on the workspace and the current selection.

### Project and Function Buttons

To the right of the tool slots are project-level buttons. These may include:

- **Project Library** — Opens the project library modal for managing assets, functions, and reusable components.
- **Function Library** — Opens the Function Library drawer for reusing Flow functions.
- **Phone/Desktop Baton** — On the LAN handoff route, shows which paired device currently owns edits. This is separate from server-authoritative collaboration.

### Zoom and Fullscreen

On the far right are zoom and fullscreen controls. Zoom affects the active workspace viewport: the Flow canvas, Video stage, Image canvas, or Paper page. Fullscreen toggles the app to fill the entire screen, hiding the operating system chrome.

### App Menu Integration

The app menu appears either as a compact menu button in the navbar or as a full menubar, depending on the setting in **Settings > Interface > App Menu Style**.

## Workspace Tabs

Workspace tabs are the primary way to move between the four workspaces. Each tab preserves its state, so you can:

1. Build a flow in the Flow workspace.
2. Switch to Image to edit a generated asset.
3. Return to Flow to rerun the graph with the edited asset.

Switching workspaces does not cancel a durable job merely because its panel is hidden. Native render-queue jobs and resumable Flow batches retain their own lifecycle; browser-only or explicitly cancelled operations can stop. Use the job/attempt record—not a spinner—as the completion authority.

## App Menu

The app menu contains the main application commands. The exact organization depends on whether you chose Compact or Menubar style.

### Compact Menu

In Compact mode, a single menu button in the top navbar opens a dropdown with grouped commands:

- **File** — New, Open, Save, Import Media, Set Scratch Folder, Export Project, Export Assets.
- **Edit** — Undo, Redo, Cut, Copy, Paste, Delete, Select All, Preferences.
- **View** — Toggle Source Bin, Toggle Inspector, Toggle Bookmarks, Command Palette, Activity Trail, Layout Defaults, Fullscreen.
- **Workspace** — Switch to Flow/Video/Image/Paper.
- **Help** — Documentation, Keyboard Shortcuts, OSS Licenses, About.

### Menubar Style

In Menubar mode, the top of the window shows separate File, Edit, View, Workspace, Window, and Help menus. On macOS, these menus merge with the system menu bar. Menubar style is recommended if you prefer keyboard navigation with `Alt` access keys.

### Classic Menu Bar

`AppClassicMenuBar` is the implementation used for menubar mode. It mirrors the compact menu items but exposes them as native menu items where possible. Keyboard shortcuts are shown next to each item.

## Bottom Toolbar (Flow)

In the Flow workspace, the bottom toolbar is the main way to add nodes and control the flow. It contains:

- **Add Node** — Opens the node catalog with categories such as Generate, Inputs & Data, Lists & Envelopes, Flow Control, Logic & Math, Text Tools, Story Tools, Reuse & Layout, Monitor & Debug, and Settings.
- **Run / Stop** — Starts or stops flow evaluation.
- **Clean Flow** — Auto-organizes the canvas and checks for layout problems.
- **Zoom to Fit** — Centers and scales the canvas so all nodes are visible.
- **Add Source Bin Node** — Creates a node that references a Source Bin item.

The bottom toolbar is context-aware. Buttons that do not apply to the current selection are disabled.

## Command Palette

The Command Palette is a searchable list of every command in Sloom Studio. Open it with:

- `Ctrl+Shift+P` (Windows/Linux)
- `Cmd+Shift+P` (macOS)

Type a few characters to filter. Commands are grouped by workspace and category. Press `Enter` to run the highlighted command, or `Esc` to close the palette without running anything.

Useful palette commands include:

- `Switch to Video`
- `Toggle Source Bin`
- `Open Settings`
- `Run Flow`
- `Clean Flow`
- `Export Project`
- `Command Palette` itself

The Command Palette is especially helpful when you know the name of a command but cannot remember its shortcut or menu location.

## Activity Trail

The Activity Trail panel records a chronological log of actions, errors, and background tasks. It appears as a dockable panel and can be toggled from the View menu or Command Palette.

Each trail entry shows:

- Timestamp
- Workspace
- Message
- Severity (info, warning, error)
- Link to related asset or node, if applicable

Click an entry to navigate to the source. For example, clicking an error from a failed node run will pan the Flow canvas to that node and open its inspector.

## Usage Bar

The Usage Bar sits in the top-right area of the navbar. It shows:

- **Estimated cost** for the current or upcoming AI operation.
- **Actual cost** after an operation completes.
- **Provider balance** for services that report remaining credit.
- **Breakdown** by provider, model, and operation type.

Hover over the Usage Bar to see a tooltip with the full breakdown. Click it to open a detailed usage report. The Usage Bar helps avoid unexpected charges when working with paid AI providers.

## Dialogs

Sloom Studio uses several shared dialog types.

### Alert Dialog

Shows a message and an **OK** button. Used for information that requires acknowledgment, such as "Export complete" or "License key accepted."

### Confirmation Dialog

Shows a question with **OK** and **Cancel** buttons. Used for destructive actions such as deleting nodes, removing Source Bin items, or closing unsaved projects.

### Text Input Dialog

Prompts for a text value. Used for naming new projects, renaming nodes, entering license keys, or typing quick search queries.

### Advanced Color Picker

A color picker dialog that supports multiple color models, swatches, and sometimes spot color selection. Used in Image, Paper, and Flow nodes that accept color values.

### Settings Modal

The main settings dialog. See `02-settings.md` for details.

### Project Library Modal

Lets you browse, import, and organize reusable project components such as functions, asset packages, and templates.

### Function Library Drawer

A slide-out panel that lists reusable Flow functions. Drag a function onto the canvas to create a Function node.

## Dockable Panels

Most side panels in Sloom Studio are dockable. You can:

- Drag a panel by its header to dock it on the left, right, or bottom of the window.
- Stack panels as tabs.
- Float a panel in its own window (desktop only).
- Resize panels by dragging their edges.
- Reset the layout with **View > Layout Defaults**.

Panel layouts are saved per workspace and restored when you reopen the project.

### Shared Workspace Dockable Panels

The `SharedWorkspaceDockablePanels` system provides common panels such as:

- Source Bin
- Inspector
- Bookmarks
- Activity Trail
- Diagnostics
- Sequence Settings
- Export Preset

Each workspace enables the panels that make sense for its context.

## Source Bin Sidebar

The Source Bin sidebar shows the contents of the project's Source Library. It has two main modes:

- **Compact** — A narrow strip with thumbnails and quick filters.
- **Expanded** — A wider panel with search, sort, kind filters, starred items, and metadata.

You can drag items from the Source Bin onto the Flow canvas, Video timeline, Paper page, or Image Editor viewport. Right-click an item for actions such as Preview, Place, Regenerate, Locate Generator Node, Copy Reference, and Remove.

## Bookmarks Sidebar

The Bookmarks sidebar lists bookmarked nodes, clips, layers, or pages. In Flow, node bookmarks let you jump quickly to important parts of a large graph. In Video, bookmarks can mark key timeline positions. In Paper, bookmarks can mark pages or spreads.

Add a bookmark with the workspace-specific bookmark command, usually `Ctrl+D` or from the context menu. Remove it from the Bookmarks sidebar.

## Gamepad Support

Sloom Studio supports gamepad input for navigation and playback. Gamepad bindings can be customized in **Settings > Gamepad**. Common defaults include:

- Left stick — Pan the viewport or move the playhead.
- Right stick — Zoom or scrub.
- Face buttons — Play/pause, mark in/out, or select tools.
- Shoulder buttons — Previous/next frame or node.

Gamepad support is optional and intended for couch viewing, presentation, or accessibility.

## Mobile Layout

On Android and narrow browser windows, Sloom Studio switches to a mobile layout:

- The top navbar collapses into a compact header.
- Panels become bottom sheets.
- The bottom toolbar gains touch-friendly buttons.
- Context menus become action sheets.
- Pinch gestures replace some keyboard shortcuts.

Some advanced features, such as multi-panel docking and floating windows, are limited or unavailable in mobile layout.

## First-Run and Startup Notice

### First-Run Language Gate

The first time Sloom Studio starts, it displays a language gate. Choose your preferred language and locale. This affects:

- Menu labels and dialog text.
- Date, time, and number formatting.
- Default typography settings in Paper.
- Available font presets.

You can change the language later in **Settings > Interface > Language / Locale**.

### Community Startup Notice

Community builds may show a startup notice explaining the license terms and Sloom Studio Pro unlock. It can be dismissed and includes a path to the License settings. A valid locally verified Sloom Studio Pro key removes that notice.

## Phone/Desktop baton and collaboration authority

The phone/desktop baton belongs to the paired-device LAN workflow. One device owns edits while the other mirrors; switching the baton snapshots state and transfers that local editing authority. It is not multi-user merge or a general cloud lock.

Optional self-hosted collaboration is a distinct, server-authoritative workflow. Its account session and project revision determine whether a remote write can proceed. A stale client must reconcile instead of overwriting a newer revision. See [Settings](02-settings.md) and [Accessibility, collaboration & automation](../../userguide/13-accessibility-collaboration-and-automation.md).

## Help Content

Help content is embedded throughout Sloom Studio. Look for the help icon in panels, inspectors, and dialogs. Clicking it opens a contextual explanation of the current feature. The help system pulls from `interfaceThemes` and `helpContent` registries, so it stays consistent with the active theme and locale.

## Summary of Navigation Shortcuts

| Action | Shortcut |
|--------|----------|
| Switch to next workspace | `Ctrl+Tab` / `Cmd+Tab` |
| Switch to previous workspace | `Ctrl+Shift+Tab` / `Cmd+Shift+Tab` |
| Open Command Palette | `Ctrl+Shift+P` / `Cmd+Shift+P` |
| Toggle Source Bin | workspace-specific, often `Ctrl+B` |
| Toggle Inspector | workspace-specific, often `Ctrl+I` |
| Toggle Activity Trail | workspace-specific |
| Fullscreen | `F11` or `Ctrl+Cmd+F` |
| Open Settings | `Ctrl+,` / `Cmd+,` |

For the complete shortcut list, see `09-shortcuts.md`.
