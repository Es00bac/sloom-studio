# 11. Keyboard & stylus

## Stylus & pen input

Sloom Studio's Image brush engine is a full pen engine. It reads, where your hardware provides
them:

- **Pressure** — drives brush size, opacity, flow, roundness, and hardness, shaped by the
  [pressure response curve](06-image.md#the-brush-engine).
- **Tilt** (altitude/azimuth) — flattens, grows, lightens, and steers the tip for natural shading.
- **Barrel rotation / twist** — rotates the tip.

Supported pens include the **Samsung S Pen** and graphics tablets (e.g. Wacom). Touch and pen work
together — rest your hand and draw with the pen. A live brush cursor previews the tip's size,
shape, and angle before you put it down.

> Tip: hold **Ctrl** over a paint tool to temporarily sample a colour (eyedropper) without
> switching tools.

## Common shortcuts

Shortcuts use `Ctrl` on Windows/Linux and `⌘` on macOS.

### Everywhere
| Action | Shortcut |
|---|---|
| New project | `Ctrl+N` |
| Open project | `Ctrl+O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| Import media | `Ctrl+I` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Toggle interface | `Tab` |
| Switch workspace | `Ctrl+1` Flow · `Ctrl+2` Video · `Ctrl+3` Image · `Ctrl+4` Paper |

### Image workspace
| Action | Shortcut |
|---|---|
| Brush / Move / Hand | `B` / `V` / `H` |
| Marquee / Crop | `M` / `C` |
| Cut / Copy / Paste | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` |
| Select All / Deselect / Invert | `Ctrl+A` / `Ctrl+D` / `Ctrl+Shift+I` |
| Levels / Curves / Hue-Saturation | `Ctrl+L` / `Ctrl+M` / `Ctrl+U` |
| Open the Image document / Save As `.slimg` | `Ctrl+O` / `Ctrl+Shift+S` (File menu) |

### Paper workspace
| Action | Shortcut |
|---|---|
| Export Print PDF | `Ctrl+P` |
| Open / Save As `.slppr` | `Ctrl+O` / `Ctrl+Shift+S` (File menu) |

The full, current list is in **Settings → Keyboard Shortcuts**. Select a command there to replace
its normalized key chord or restore its default. The conflict check reports an existing binding
before the change is accepted. The command map is shared by the menu, toolbar, and keyboard path so
a remap does not create a second hidden behavior.

## Gamepad

A connected **game controller** can be mapped to brush and tool controls (size, flow, undo, and
more) under **Settings → Gamepad Bindings** — handy for tablet and couch setups.

---

Back to the [User Guide index](README.md).
