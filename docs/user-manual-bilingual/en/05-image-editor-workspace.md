# Image Editor Workspace

> Current manual baseline: **Sloom Studio source 0.9.16-b**, verified August 27, 2026. Standard 8-bit, native high-bit RGB, and native CMYK documents have different admitted operations; Image reports the active authority and refuses unsupported lossy crossings.

The Image Editor workspace is a layered raster and vector editor with built-in generative AI tools. It is designed for photo retouching, digital painting, compositing, and preparing assets for Flow, Video, and Paper workspaces. The editor supports selections, masks, layers, adjustments, color proofing, vector paths, and non-destructive editing through history and snapshots.

This chapter describes the layout, every tool, the brush engine, selection and mask workflows, layer management, adjustments, color proofing, generative operations, history, asset export, and PSD import.

## Layout

The Image Editor workspace is organized into:

- **Toolbar** — Vertical strip on the left with all editing tools.
- **Viewport** — Center canvas where the image is displayed and edited.
- **Dockable Panels** — Right and bottom panels for Layers, Channels, Paths, History, Adjustments, Brushes, and Tool Options.
- **Generative Fill Bar** — Optional bottom bar for AI operations.
- **Asset Bar** — Bottom or side bar with save, export, and send actions.

Panels can be rearranged, docked, floated, and hidden. The layout is saved per project.

### Viewport Navigation

- **Space + drag** — Pan the canvas.
- **Ctrl++ / Ctrl+-** — Zoom in and out.
- **Ctrl+0** — Fit image in view.
- **100%** — View pixels 1:1.
- **Pinch gesture** — Zoom on touch devices.

## Tools

The Image Editor provides a full set of tools. Shortcuts are shown in parentheses.

### Move (`V`)

Moves layers, selections, and vector objects. When a selection is active, Move relocates the selected pixels on the current layer.

### Hand (`H`)

Pans the viewport without changing the image.

### Marquee (`M`)

Creates rectangular or elliptical selections. Hold `Shift` to constrain to a square or circle. Hold `Alt` to draw from the center. Modes: replace, add, subtract, intersect.

### Lasso (`L`)

Creates freehand selections. Hold `Alt` to switch to polygonal lasso mode for straight-line segments.

### Magic Wand (`W`)

Selects contiguous regions of similar color. Adjust tolerance in the Tool Options panel. Higher tolerance selects a wider range of colors.

### Brush (`B`)

Paints with the current brush preset. The Brush tool supports pressure, tilt, dynamics, and blending. See the Brush Engine section below.

### Eraser (`E`)

Removes pixels, revealing transparency or the layer below depending on the layer type.

### Background Eraser (`Alt+E`)

Erases sampled background colors while preserving foreground edges. Useful for removing solid-color backdrops.

### Magic Eraser (`Shift+E`)

Erases contiguous regions of similar color with a single click, similar to the Magic Wand combined with Delete.

### Clone Stamp (`S`)

Samples pixels from one area and paints them elsewhere. Hold `Alt` and click to set the sample source. Useful for removing blemishes and duplicating objects.

### Spot Heal (`J`)

Automatically samples nearby texture to remove spots and small imperfections. The Spot Heal tool does not require a manual source point.

### Blur (`R`)

Softens pixels by painting over them. Strength and brush size control the amount of blur.

### Sharpen (`Shift+R`)

Increases local contrast. Use sparingly to avoid artifacts.

### Smudge (`U`)

Pushes pixels as if they were wet paint. Useful for blending colors and creating painterly effects.

### Dodge (`O`)

Lightens areas of the image. Options control the range: shadows, midtones, or highlights.

### Burn (`Shift+O`)

Darkens areas of the image. Range options are the same as Dodge.

### Sponge Saturate (`P`)

Increases color saturation where painted.

### Sponge Desaturate (`Shift+P`)

Decreases color saturation where painted.

### Paint Bucket (`G`)

Fills contiguous regions with the foreground color or pattern. Tolerance controls how similar colors must be to fill.

### Gradient (`Shift+G`)

Fills a selection or layer with a gradient. Types include linear, radial, angle, reflected, and diamond.

### Pen (`Shift+B`)

Creates vector paths and shapes. Paths can be converted to selections, masks, or shape layers.

### Rectangle (`X`)

Draws rectangle shapes. Hold `Shift` for squares.

### Ellipse (`Shift+X`)

Draws ellipse shapes. Hold `Shift` for circles.

### Crop (`C`)

Defines a crop region and applies it. The Tool Options panel shows aspect ratio, resolution, and preset choices. Press `Enter` to apply, `Esc` to cancel.

### Text (`T`)

Creates text layers. Edit text directly on the canvas or in the Tool Options panel. Supports fonts, size, color, stroke, shadow, and alignment.

### Eyedropper (`I`)

Samples a color from the image. Hold `Alt` to sample the background color. The sampled color becomes the foreground color.

## Brush Engine

The brush engine supports both WebGL2 and CPU rendering. WebGL2 is faster for large brushes and complex dynamics; CPU mode is the fallback when WebGL2 is unavailable.

### Brush Dynamics

Brushes can respond to:

- **Pressure** — Size, opacity, or flow from stylus pressure.
- **Tilt** — Angle and shape from stylus tilt.
- **Velocity** — Size or opacity from cursor speed.
- **Jitter** — Random variation in size, angle, color, or position.

### Symmetry

Enable symmetry to mirror strokes horizontally, vertically, or radially. Symmetry options are in the Brush panel.

### Presets

Sloom Studio ships with presets for round, textured, scatter, and shape brushes. Create custom presets from the Brushes panel and save them to settings.

### Textures

Brushes can use texture images. Use the texture picker to load a texture from the Source Bin or import a file.

### Size Shortcuts

- `[` — Decrease brush size.
- `]` — Increase brush size.
- `{` — Decrease brush hardness.
- `}` — Increase brush hardness.
- Hold `Alt+Right-click-drag` (Windows) or `Ctrl+Option-drag` (macOS) to resize interactively.

### Studio Brush and Tiltmark V3

Choose the brush engine in the brush controls. **Studio Brush** is the Community painting engine. **Tiltmark V3** is part of Sloom Studio Pro and exposes the installed Hane physical-media runtime: calibrated implements, pressure/tilt/twist routing, substrate texture, wet pickup/mixing, solvent, drying/evolution, spray tools, stabilization, and persistent implement/surface state.

Tiltmark controls are contextual. The active layer owns its editable physical surface; switching layers/documents changes the displayed substrate/implement state. Use the Tiltmark Drying panel to inspect evolution, pause it, settle/dry, adjust the bounded rate, or apply canvas tilt. Undo checkpoints preserve the editable physical state, not only a flattened preview.

GPU acceleration is used only when the admitted browser/device backend supports the operation. The visible engine/backend status is authoritative; CPU/WebGL fallback is not labelled as the requested GPU path.

## Selections and Masks

### Selection Modes

When a selection tool is active, the Tool Options panel shows modes:

- **New** — Replace the current selection.
- **Add** — Add to the current selection.
- **Subtract** — Remove from the current selection.
- **Intersect** — Keep only the overlapping area.

### Feather and Anti-Alias

- **Feather** — Softens the edge of a selection by a pixel radius.
- **Anti-alias** — Smoothes jagged edges for elliptical and lasso selections.

### Object Selection

The Object Selection tool uses AI to detect objects in the image. Draw a rough rectangle or lasso around an object; Sloom Studio refines the selection to the object's edges.

### Select and Mask

Open **Select and Mask** from the Select menu to refine edges with:

- Edge detection radius.
- Smooth and feather.
- Contrast and shift edge.
- Output to selection, layer mask, or new layer.

### Quick Mask (`Q`)

Quick Mask mode paints a temporary mask over the image. Paint with black to remove from the selection, white to add. Press `Q` again to convert back to a selection.

### Channels

The Channels panel shows color and alpha channels. You can load a channel as a selection or save a selection to a channel.

### Layer Masks

Add a layer mask to hide parts of a layer without deleting pixels. Paint on the mask with black to hide, white to show, and gray for partial transparency.

### Vector Masks

Vector masks use a path to define visibility. They remain sharp at any resolution. Create a vector mask from a path or shape.

### Clipping Masks

A clipping mask uses the content of one layer to define the visible area of the layers above. Right-click a layer and choose **Create Clipping Mask**.

## Layers

The Layers panel is the hub for image composition.

### Layer Types

| Type | Purpose |
|------|---------|
| Pixel layer | Standard raster content. |
| Adjustment layer | Non-destructive color and tone adjustments. |
| Text layer | Editable text. |
| Shape layer | Vector shapes. |
| Smart object / source-linked layer | References a Source Bin item. |
| Group layer | Organizes layers. |

### Visibility and Opacity

Click the eye icon to toggle visibility. Drag the Opacity slider to change transparency.

### Blend Modes

Blend modes determine how a layer interacts with layers below. Common modes include:

- Normal
- Multiply
- Screen
- Overlay
- Soft Light
- Hard Light
- Color Dodge
- Color Burn
- Difference
- Luminosity

### Locks

Layers can be locked for:

- Transparent pixels
- Image pixels
- Position
- All properties

### Layer Effects

Add effects such as drop shadow, outer glow, inner shadow, bevel, stroke, and color overlay. Effects remain editable.

### Layer Filters

Apply smart filters that can be adjusted later. Filters include blur, sharpen, noise, render, and stylize effects.

### Groups and Labels

Group layers by selecting them and pressing `Ctrl+G` / `Cmd+G`. Assign color labels to organize complex documents.

### Search and Linked Layers

Use the Layers panel search box to find layers by name or kind. Link layers to move or transform them together.

### Source-Linked Layers

A source-linked layer references an item in the Source Library. If the source is regenerated in Flow, the layer can be updated. Right-click the layer and choose **Update from Source**.

## Adjustments

Adjustments change color and tone. They can be applied destructively from the Image menu or non-destructively as adjustment layers.

### Brightness / Contrast

Simple controls for overall lightness and contrast.

### Levels

Adjust input and output levels with a histogram. Useful for setting black, white, and midtone points.

### Curves

Precise tonal control via a curve. Adjust individual color channels for color grading.

### Hue / Saturation

Shift hue, increase or decrease saturation, and adjust lightness. Can target a specific color range.

### Exposure / Offset / Gamma

HDR-style controls for exposure, offset, and gamma.

### Temperature / Tint

Correct white balance by adjusting temperature and tint.

### Black & White

Convert to monochrome with channel mixer controls.

### Invert

Invert all colors. Useful for creating negatives or masks.

## Color Proofing

Color proofing simulates how the image will look in different output conditions.

### Grayscale Soft Proof

Preview the image in grayscale without changing pixel data.

### CMYK Soft Proof

Preview approximate CMYK output. Useful for print preparation. Sloom Studio uses ICC profiles for simulation.

### Proof Intents

Choose a rendering intent for soft proofing:

- Perceptual
- Relative Colorimetric
- Saturation
- Absolute Colorimetric

Set the target profile in **Image > Proof Setup**.

## Generative Fill and AI Operations

The Generative Fill bar provides AI-assisted editing operations:

| Operation | Purpose |
|-----------|---------|
| Inpaint | Fill a selected region based on surroundings. |
| Edit | Modify a region with a text prompt. |
| Erase | Remove an object and fill the background. |
| Outpaint | Extend the canvas beyond the image edges. |
| Search Replace | Replace one object with another using a prompt. |
| Recolor | Change the color of objects. |
| Remove Background | Delete the background automatically. |
| Replace Background | Replace the background with generated content. |
| Relight | Adjust lighting on the subject. |
| Upscale | Increase image resolution with AI. |

### Providers

Generative operations use providers configured in **Settings > Providers**. Choose the provider in the Generative Fill bar. Cost estimates appear in the Usage Bar.

### Object Detection Masks

Some generative operations can use object detection to create masks automatically. Select an object in the image and choose the operation; Sloom Studio generates a mask around the detected object.

### Cost Estimation

Each AI operation shows an estimated cost before running. The estimate depends on provider, model, image size, and operation type. Actual cost is recorded in the Usage Bar after completion.

## History, Snapshots, and Actions

### History Panel

The History panel lists every edit. Click a state to revert to that point. The number of history states is configurable in settings.

### Snapshots

Snapshots save the entire document state at a moment in time. Create a snapshot before risky edits. Restore a snapshot from the History panel.

### Actions

Actions record a sequence of operations for replay. Record an action, assign a shortcut, and play it back on other images or layers.

## Native document authority and professional workflows

### Editable `.slimg`

Use the editable Image save command to write `.slimg` v2. The package retains supported layers, masks, editable text/vector/adjustment state, Smart Object/Smart Filter sources, selections, snapshots, and native high-bit/CMYK authority required for an honest reopen. Save verification fails if required bytes or integrity metadata are missing.

The project can also retain Image workspace state, but a standalone `.slimg` has its own dirty-close/save lifecycle. A linked `.slimg` Flow edit refreshes its bound node only after the document write succeeds.

### High-bit RGB

Supported PNG16, TIFF16/TIFF32f, and bounded single-part scanline OpenEXR inputs can create native `u16`/`f32` layer authority with a derived display proxy. Admitted brush/eraser, alpha mask, resize/scale, rectangular crop, blend, compositor, undo/redo, persistence, and matching native export routes preserve that authority.

Unsupported high-bit codec variants, layered transformations/effects without a native path, high-bit PSD ingress, served editing without round-trippable authority, or mixed high-bit/CMYK claims refuse before downsampling. Check **Image Properties** for source/working precision.

### Native CMYK

The bounded CMYKA route requires a validated ICC profile. Supported native layers, plate edits/history, separations, proof/gamut preview, `.slimg` reopen, profiled DeviceCMYK TIFF ingress, and ordinary native CMYK TIFF export preserve the admitted authority. Unsupported profile/precision/alpha/transform/effect combinations refuse before mutation. This is not arbitrary press-workflow parity; trapping, overprint, PDF/X certification, and press acceptance remain separate Paper/production concerns.

### Smart and retained content

Smart Objects retain an embedded/linked source identity and can carry non-destructive Smart Filters. Editable text, vector layers/paths, adjustment layers, clipping/groups, Blend If, channels, layer comps, and linked instances keep their own supported save/render contracts. If a round trip cannot preserve an admitted structure, the import/save/export path reports the exact boundary rather than silently rasterizing the whole document.

### Selection, transform, fill, and photographic tools

Current professional groups include refined selection/matting, transform/warp/puppet/perspective workflows, content-aware/generative fill, patch/heal/clone, gradients/patterns, masks/channels, frequency separation, panorama/HDR/focus merge, camera-raw-style development, lens/perspective correction, batch processing, artboards/slices, animation/timeline, and print/proof utilities. Each tool exposes its supported layer/precision/document requirements. A tool being visible does not override those requirements.

## Asset Bar and Export

The Asset Bar provides quick actions for the current image:

- **Save to Source Bin** — Adds the image to the project's Source Library.
- **Download** — Saves a flattened copy to disk.
- **Export Mask** — Saves the active selection or mask as an image.
- **Send to Flow** — Creates a Source Bin node or node input reference.
- **Send to Video** — Adds the image to the Video Source Bin.
- **Import PSD** — Opens a Photoshop file as layers.

### Supported Formats

The Image Editor can open and save:

- Editable Sloom Image (`.slimg`)
- PNG
- JPEG
- WebP
- TIFF
- PSD/PSB (bounded interchange)
- XCF (bounded interchange)
- OpenEXR (bounded native high-bit route)
- AVIF (when supported)

### Free Resource Search

Search free stock resources from the Asset Bar. Results can be imported into the Source Bin or placed directly on the canvas.

## PSD Import

Import PSD/PSB or XCF through the bounded interchange route. Supported layers, masks, blend modes, text, paths, and retained structures are preserved when their exact contract is admitted. Unsupported precision, archive members, or structures are named in the report and can refuse the import; Sloom Studio does not silently claim a fully editable round trip after dropping required content.

To import a PSD:

1. Choose **File > Import > PSD** or drag a PSD file onto the canvas.
2. Review the detected document mode/precision and the preservation report.
3. Choose the offered supported import mode and click **Import**. If the route refuses, convert a copy in the source application or use a deliberately flattened raster import while retaining the original file.

## Shortcuts Summary

| Action | Shortcut |
|--------|----------|
| Move | `V` |
| Hand | `H` |
| Marquee | `M` |
| Lasso | `L` |
| Magic Wand | `W` |
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
| Quick Mask | `Q` |
| Decrease brush size | `[` |
| Increase brush size | `]` |
| Decrease hardness | `{` |
| Increase hardness | `}` |

For a complete shortcut list, see `09-shortcuts.md`.
