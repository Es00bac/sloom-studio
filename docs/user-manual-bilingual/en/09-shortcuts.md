# Shortcuts and Input Methods

> **Current-source baseline — 0.9.16-b (2026-08-27).** Shortcuts are user
> configurable and platform-dependent. The current **Settings → Keyboard
> Shortcuts** view is the authoritative list; the tables in this chapter are
> familiar examples, not a contract that every default is unchanged in your build.

Sloom Studio supports keyboard shortcuts, the Command Palette, gamepad input, and the desktop/global
application menu where the platform provides one. This chapter groups useful commands by scope:
global, Flow, Video, Image, and Paper.

## Set up reliable input

Open **Settings → Keyboard Shortcuts** to search a command, inspect its actual mapping, click its
binding, and type a replacement chord. The conflict checker names an existing binding and prevents
an unresolved duplicate from being accepted. Restore the command or all defaults when a local setup
becomes confusing. Settings persist on the device; use the Settings backup/export route if you want
to carry preferences to another installation.

For desktop users, the global application menu is another discoverable command surface: it exposes
File, Edit, View, Workspace, Window, and Help actions with the mappings that are active in that
runtime. Browser and operating-system reservations can intercept chords before Sloom Studio sees
them, so verify an important shortcut in Settings rather than relying on this manual's examples.

### Keyboard and assistive operation

The UI exposes keyboard focus for menus, dialogs, and persisted Flow nodes. Use `Tab` / `Shift+Tab`
to move focus, `Enter` or `Space` to activate the focused control, and `Esc` to leave a dialog or
cancel an eligible interaction. Nodes retain accessible names and keyboard focus handling; the
Command Palette is useful when a toolbar or menu is hard to reach. Accessible Paper output is a
separate authoring task: set document language and authored alternative text before tagged-PDF
export.

## Modifier Key Conventions

- `Ctrl` is used on Windows and Linux.
- `Cmd` is used on macOS and is equivalent to `Ctrl` on other platforms.
- `Alt` is used on Windows and Linux.
- `Option` is used on macOS and is equivalent to `Alt` on other platforms.

In this chapter, shortcuts are written as `Ctrl/Cmd+X` meaning press `Ctrl+X` on Windows/Linux or `Cmd+X` on macOS.

## Global Shortcuts

These shortcuts work from any workspace.

| Action | Shortcut |
|--------|----------|
| New Project | `Ctrl/Cmd+N` |
| Open Project | `Ctrl/Cmd+O` |
| Save Project | `Ctrl/Cmd+S` |
| Save As | `Ctrl/Cmd+Shift+S` |
| Undo | `Ctrl/Cmd+Z` |
| Redo | `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` |
| Cut | `Ctrl/Cmd+X` |
| Copy | `Ctrl/Cmd+C` |
| Paste | `Ctrl/Cmd+V` |
| Paste in Place | `Ctrl/Cmd+Shift+V` |
| Select All | `Ctrl/Cmd+A` |
| Deselect | `Ctrl/Cmd+D` or `Esc` |
| Delete | `Delete` or `Backspace` |
| Preferences / Settings | `Ctrl/Cmd+,` |
| Command Palette | `Ctrl/Cmd+Shift+P` |
| Toggle Fullscreen | `F11` or `Ctrl/Cmd+Shift+F` |
| Toggle Source Bin | `Ctrl/Cmd+B` |
| Toggle Inspector | `Ctrl/Cmd+I` |
| Toggle Activity Trail | `Ctrl/Cmd+Shift+A` |
| Next Workspace | `Ctrl/Cmd+Tab` |
| Previous Workspace | `Ctrl/Cmd+Shift+Tab` |
| Help | `F1` |
| Search | `Ctrl/Cmd+F` |

## Command Palette

The Command Palette can be opened with `Ctrl/Cmd+Shift+P`. From there, type any command name and press `Enter` to run it. The palette supports:

- Fuzzy matching: type a few letters of any word in the command.
- Recent commands: recently used commands appear at the top.
- Workspace filtering: commands for the current workspace are prioritized.

Examples of useful palette commands:

- `Switch to Flow`
- `Switch to Video`
- `Run Flow`
- `Clean Flow`
- `Import Media`
- `Export Project`
- `Open Settings`
- `Toggle Source Bin`
- `Toggle Bookmarks`
- `Layout Defaults`

## Menu Commands

Menu commands are available through the app menu in Compact or Menubar style. Many menu items show their keyboard shortcut on the right. Menus include:

- **File** — New, Open, Save, Import, Export, Scratch Folder, Recent Projects, Exit.
- **Edit** — Undo, Redo, Cut, Copy, Paste, Delete, Select All, Preferences.
- **View** — Source Bin, Inspector, Bookmarks, Activity Trail, Command Palette, Layout Defaults, Fullscreen.
- **Workspace** — Flow, Video, Image, Paper.
- **Window** — New Window, Close Window, Minimize, Zoom (desktop only).
- **Help** — Documentation, Keyboard Shortcuts, OSS Licenses, About.

## Flow Workspace Shortcuts

| Action | Shortcut |
|--------|----------|
| Run Flow | `Ctrl/Cmd+Enter` |
| Stop Flow | `Esc` |
| Add Node | `Tab` or `Double-click canvas` |
| Middle-click search | `Middle-click` on canvas |
| Select all nodes | `Ctrl/Cmd+A` |
| Copy nodes | `Ctrl/Cmd+C` |
| Paste nodes | `Ctrl/Cmd+V` |
| Duplicate nodes | `Ctrl/Cmd+D` |
| Delete selected | `Delete` or `Backspace` |
| Group selected | `Ctrl/Cmd+G` |
| Ungroup | `Ctrl/Cmd+Shift+G` |
| Zoom in | `Ctrl/Cmd+=` |
| Zoom out | `Ctrl/Cmd+-` |
| Zoom to fit | `Ctrl/Cmd+0` |
| Pan canvas | `Middle-click drag` or `Space drag` |
| Clean Flow | `Ctrl/Cmd+Shift+L` |
| Force run selected node | `Ctrl/Cmd+R` |
| Toggle node bookmarks | `Ctrl/Cmd+D` |
| Toggle Source Bin | `Ctrl/Cmd+B` |

## Video Workspace Shortcuts

| Action | Shortcut |
|--------|----------|
| Play / Pause | `Space` |
| Shuttle reverse | `J` |
| Shuttle stop | `K` |
| Shuttle forward | `L` |
| Step backward 1 frame | `Left Arrow` |
| Step forward 1 frame | `Right Arrow` |
| Go to start | `Home` |
| Go to end | `End` |
| Mark In | `I` |
| Mark Out | `O` |
| Clear In | `Alt+I` |
| Clear Out | `Alt+O` |
| Insert | `,` (comma) |
| Overwrite | `.` (period) |
| Select tool | `V` |
| Cut / Razor tool | `C` |
| Slip tool | `Y` |
| Hand tool | `H` |
| Toggle snap | `S` |
| Split at playhead | `C` (with select tool) |
| Ripple trim start | `Q` |
| Ripple trim end | `W` |
| Roll edit | `E` |
| Add marker | `M` |
| Nudge clip | `Arrow keys` |
| Nudge 10 frames | `Shift+Arrow` |

## Image Editor Workspace Shortcuts

| Action | Shortcut |
|--------|----------|
| Move | `V` |
| Hand | `H` |
| Marquee | `M` |
| Lasso | `L` |
| Magic Wand | `W` |
| Quick Mask | `Q` |
| Brush | `B` |
| Eraser | `E` |
| Background Eraser | `Alt+E` |
| Magic Eraser | `Shift+E` |
| Clone Stamp | `S` |
| Spot Heal | `J` |
| Blur | `R` |
| Sharpen | `Shift+R` |
| Smudge | `U` |
| Dodge | `O` |
| Burn | `Shift+O` |
| Sponge Saturate | `P` |
| Sponge Desaturate | `Shift+P` |
| Paint Bucket | `G` |
| Gradient | `Shift+G` |
| Pen | `Shift+B` |
| Rectangle | `X` |
| Ellipse | `Shift+X` |
| Crop | `C` |
| Text | `T` |
| Eyedropper | `I` |
| Decrease brush size | `[` |
| Increase brush size | `]` |
| Decrease brush hardness | `{` |
| Increase brush hardness | `}` |
| Fill with foreground | `Alt+Delete` / `Option+Delete` |
| Fill with background | `Ctrl+Delete` / `Cmd+Delete` |
| Free transform | `Ctrl/Cmd+T` |
| Deselect | `Ctrl/Cmd+D` |
| Invert selection | `Ctrl/Cmd+Shift+I` |
| New layer | `Ctrl/Cmd+Shift+N` |
| Group layers | `Ctrl/Cmd+G` |
| Merge down | `Ctrl/Cmd+E` |

## Paper Workspace Shortcuts

| Action | Shortcut |
|--------|----------|
| Select | `V` |
| Hand | `H` |
| Text | `T` |
| Image | `Shift+I` |
| Eyedropper | `I` |
| Gutter Knife | `K` |
| Duplicate | `Ctrl/Cmd+D` |
| Group | `Ctrl/Cmd+G` |
| Ungroup | `Ctrl/Cmd+Shift+G` |
| Lock | `Ctrl/Cmd+L` |
| Unlock | `Ctrl/Cmd+Shift+L` |
| Nudge | `Arrow keys` |
| Nudge 10x | `Shift+Arrow` |
| Send backward | `Ctrl/Cmd+[` |
| Bring forward | `Ctrl/Cmd+]` |
| Send to back | `Ctrl/Cmd+Shift+[` |
| Bring to front | `Ctrl/Cmd+Shift+]` |
| Toggle guides | `Ctrl/Cmd+;` |
| Toggle grids | `Ctrl/Cmd+'` |
| Fit page in view | `Ctrl/Cmd+0` |
| Zoom in | `Ctrl/Cmd+=` |
| Zoom out | `Ctrl/Cmd+-` |
| Insert page break | `Ctrl/Cmd+Return` (in text) |
| Toggle preview mode | `W` |

## Gamepad Basics

Sloom Studio supports gamepad input for navigation, playback, and some editing actions. Default bindings depend on the workspace.

### Global Gamepad Defaults

| Control | Action |
|---------|--------|
| Left stick | Pan viewport |
| Right stick | Zoom / scrub |
| A / Cross | Confirm / select |
| B / Circle | Cancel / deselect |
| X / Square | Context menu |
| Y / Triangle | Command Palette |
| Left shoulder | Previous item / frame |
| Right shoulder | Next item / frame |
| Left trigger | Decrease speed |
| Right trigger | Increase speed |
| D-pad | Nudge selection |
| Start | Play / Pause |
| Select | Toggle Source Bin |

Gamepad bindings can be customized in **Settings > Gamepad**. Not all actions are available on gamepad.

## Customizing Shortcuts

1. Open **Settings > Keyboard**.
2. Search for the command you want to change.
3. Click the current shortcut.
4. Press the new key combination.
5. Save.

If a shortcut conflicts with another command, the conflict checker reports the existing binding.
Choose a different chord or remove/reassign the existing one; an unresolved duplicate is not a
valid saved shortcut.

## Importing and Exporting Shortcuts

Use the Settings backup/export controls to export and import keyboard and gamepad bindings. This is
useful for sharing a setup across machines or team members; inspect imported mappings for local OS
and browser conflicts.

## Accessibility

Sloom Studio supports keyboard-only operation for most tasks. Menus and dialogs can be navigated
with `Tab`, `Shift+Tab`, `Enter`, and `Esc`; persisted Flow nodes are keyboard-focusable named
groups. The Command Palette and the desktop/global menu provide complementary paths to commands.

## Shortcut Conflicts with the OS

Some shortcuts may conflict with operating system defaults. If a shortcut does not work:

- Check **Settings > Keyboard** to confirm the binding.
- Check if another application has captured the shortcut.
- On macOS, some `Cmd+Space` or `Cmd+Tab` shortcuts are reserved.
- On Linux, window managers may intercept `Alt` shortcuts.

For the latest shortcut defaults, check the in-app Keyboard settings page.
