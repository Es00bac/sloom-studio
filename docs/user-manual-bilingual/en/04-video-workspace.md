# Video Workspace

> Current manual baseline: **Sloom Studio source 0.9.16-b**, verified August 27, 2026. Preview and export share the saved sequence contract, but supported codec/effect/hardware combinations remain bounded and report explicit refusals.

The Video workspace is a non-linear editor for assembling compositions from source media. It combines a Source Bin, Source Monitor, Program Monitor, multi-track timeline, inspector, effects, keyframes, captions, and export presets. The workspace is designed for feature-length and short-form editing, review cuts, archival masters, and motion graphics that include text, shapes, and comic elements.

This chapter explains compositions, monitors, timeline editing, effects, audio, sequence settings, render/export, captions, FCP XML, and the mobile layout.

## Dockable Panels

The Video workspace uses dockable panels that persist their layout per project:

| Panel | Purpose |
|-------|---------|
| Project Source Bin | Browse and import media for the current project. |
| Source Monitor | Preview a source clip and mark in/out points. |
| Program Monitor | View the current frame of the edited sequence. |
| Inspector | Edit properties of the selected clip, track, or effect. |
| Timeline | Arrange clips on tracks. |
| Premiere Parity | Check compatibility with Premiere Pro features. |
| Sequence Settings | Set aspect ratio, resolution, and frame rate. |
| Export Preset | Choose and configure render presets. |
| Diagnostics | Report timeline errors, missing media, and parity issues. |

Drag panels by their headers to rearrange, dock, or float them. Choose **View > Layout Defaults** to reset the layout.

## Compositions

A composition is the top-level video project inside the Video workspace. It contains tracks, clips, effects, and sequence settings. A project can have multiple compositions.

### Create Composition

To create a new composition:

1. Click **New Composition** in the workspace menu or Source Bin.
2. Choose a starter sequence preset, or start blank.
3. Name the composition.

### Starter Sequence

Starter sequences create common setups automatically, such as:

- Social vertical 9:16 with title safe overlays.
- Review 16:9 with two video tracks and one audio track.
- Blank timeline with default tracks.

### History

The Video workspace keeps up to 80 history entries. Use `Ctrl+Z` / `Cmd+Z` to undo and `Ctrl+Y` / `Cmd+Shift+Z` to redo. The history is scoped to the Video workspace; undo does not affect Flow or Paper edits.

## Source Bin

The Source Bin in the Video workspace shows media available for editing. It supports:

- **Media Import** — Add video, audio, image, and subtitle files.
- **Origin Filters** — Separate ingested/imported footage from generated assets.
- **Kind Filters** — Show only video, audio, images, or sequences.
- **Search** — Filter by name, tag, or metadata.
- **Star / Collapse** — Mark favorites and collapse groups.
- **Editor Assets** — Pre-made titles, shapes, and transitions.
- **Paper Storyboard Import** — Import storyboard frames from the Paper workspace.

Right-click a source for actions such as Preview, Place, Add to Track, and Locate in Source Library.

Cards and the Source Monitor identify each item's **Ingested** or **Generated** origin, storage
mode, duration, resolution, and media type. Use **All media**, **Ingested**, or **Generated** before
the kind filters. Source groups display 48 cards at a time, and technical metadata probing stays
bounded to visible, selected, and timeline-referenced sources so large documentary and feature
pools remain responsive. Legacy project items without an origin marker are classified as ingested.

### Desktop Ingest: Link or Copy

The desktop **Import Media**, **Video**, and **Audio** commands first ask how the originals should be
handled. **Link originals** is recommended for feature-length footage: the project saves the source
reference and reads metadata and frames on demand without duplicating the original. **Copy into
project media** creates a managed copy when project scratch is available. Keep linked originals
mounted at the same path, or relink/reimport them if they move.

Browser-only sessions retain the existing durable import path for ordinary media. Files at least
512 MB are session-linked instead so a feature-length file is never converted to a giant data URL
after a quota failure. Session-linked browser files must be reimported after closing the session.

## Source Monitor

The Source Monitor previews individual source clips before they are added to the timeline.

### Mark In/Out

- Press `I` to set the **In** point.
- Press `O` to set the **Out** point.
- Drag the In/Out handles on the scrubber.
- Press `Alt+I` / `Alt+O` to clear In/Out.

### Insert and Overwrite

After marking In/Out:

- Press `,` (comma) to **Insert** the clip at the playhead, pushing later clips to the right.
- Press `.` (period) to **Overwrite** the clip at the playhead, replacing whatever is there.
- Click **Add to Track** to place the clip on the targeted track without changing the playhead position.

## Program Monitor and Stage

The Program Monitor shows the current frame of the timeline. It has two modes:

- **Stage** — Shows interactive transform handles, clip boundaries, and stage objects.
- **Rendered** — Shows the final rendered output, useful for previewing effects and composites.

### Interactive Clip Transform

In Stage mode, select a clip to show transform handles. You can:

- Drag to move.
- Drag corners to scale.
- Drag outside the bounding box to rotate.
- Hold `Shift` to constrain proportions.
- Hold `Alt` to transform from the center.

### Comic Tail Drag

Clips that contain comic speech or thought bubbles show a tail handle. Drag the tail to point at a character or object in the frame.

### Stage Objects

Stage objects are overlays such as text, shapes, and comic panels. They behave like clips but are created inside the Video workspace rather than imported. Select a stage object to edit its content in the Inspector.

### Fit Modes

Use fit modes to control how the sequence frame is displayed:

- **Fit** — Scale to fit entirely in the monitor.
- **Fill** — Scale to fill the monitor, cropping edges if needed.
- **100%** — Show pixels 1:1.

### Quick Controls

Quick controls appear near the Program Monitor for common actions:

- Play / Pause
- Step frame backward / forward
- Mark In / Out
- Toggle stage overlays
- Snapshot current frame

## Timeline Tools

The timeline toolbar contains editing tools:

| Tool | Shortcut | Purpose |
|------|----------|---------|
| Select | `V` | Select and move clips. |
| Cut / Razor | `C` | Split a clip at the playhead. |
| Slip | `Y` | Change a clip's In/Out without changing its timeline duration. |
| Hand | `H` | Pan the timeline view. |
| Snap | `S` toggle | Snap clips and playhead to edges and markers. |

## Tracks

The timeline has:

- **4 visual tracks** for video, images, text, shapes, and effects.
- **4 audio tracks** for audio clips and narration.

Tracks can be:

- **Locked** — Prevent accidental edits.
- **Collapsed** — Hide track details to save space.
- **Resized** — Drag the track border to change height.
- **Targeted** — The target track receives inserts and overwrites from the Source Monitor.

### Overlay Track

One visual track can be designated as the overlay track. Overlay clips composite on top using blend modes and alpha channels. Use it for logos, lower thirds, and comic speech bubbles.

## Editing Operations

### Drag and Drop

Drag a source from the Source Bin onto a track. Drop it at the desired time position. Hold `Alt` while dragging to duplicate.

### Move and Trim

- Drag a clip to move it in time or to another track.
- Drag the left or right edge to trim the In or Out point.
- Hold `Shift` while trimming to ripple trims.

### Split

Place the playhead where you want to split and press `C` or click the Cut tool. The clip is divided into two independent clips.

### Ripple Trim

Ripple trim adjusts the timeline duration automatically.

- Press `Q` to ripple trim the start of a clip to the playhead.
- Press `W` to ripple trim the end of a clip to the playhead.

### Roll Edit

Press `E` to enter roll edit mode. Roll edit adjusts the boundary between two adjacent clips without changing the total duration.

### Slip Edit

With the Slip tool (`Y`), drag a clip to change which portion of the source it shows without changing its position or duration on the timeline.

### Fill Gap

Right-click an empty space between clips and choose **Fill Gap** to close it by moving later clips left.

### Snapping

Toggle snapping with `S`. When snapping is on, the playhead, clip edges, and markers snap to each other. Snap sensitivity can be adjusted in settings.

### Markers

Add markers to the timeline with `M`. Markers can have names and colors. They are useful for notes, chapter points, and sync references.

### Timeline Zoom

Zoom the timeline horizontally from **Fit (100%)** through a duration-scaled maximum (a two-hour
sequence can reach a ten-second working window) and zoom vertically by resizing individual tracks.
The ruler automatically switches from seconds to minute/hour labels,
uses production timecode, and keeps a bounded number of tick elements. Offscreen clips are culled
from the live UI while their edit metadata remains in the composition, so a feature-length cut does
not require every clip to stay mounted in the browser DOM.

## Transport and JKL Shuttle

Transport controls move the playhead and preview the timeline.

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `J` | Shuttle reverse (press repeatedly to speed up) |
| `K` | Stop shuttle |
| `L` | Shuttle forward (press repeatedly to speed up) |
| `Left Arrow` | Step one frame backward |
| `Right Arrow` | Step one frame forward |
| `Home` | Go to start |
| `End` | Go to end |

Press `K` while holding `J` or `L` to slow shuttle to one speed step.

At normal 1× playback, active Program video and timeline audio play continuously. Audio playback
applies the authored source range, clip and track levels, mute/solo, automation, measured gain, and
fades. Paused scrubbing and frame stepping use exact seeks. Chroma-key canvas previews remain a
seeked-preview path rather than continuous video playback.

### Opacity and Volume Nudge

With a clip selected:

- `Ctrl+Shift+Up` / `Ctrl+Shift+Down` nudges opacity for visual clips.
- `Ctrl+Shift+Left` / `Ctrl+Shift+Right` nudges volume for audio clips.
- Hold `Alt` for smaller nudge increments.

## Keyframes and Animation

Many properties can be animated with keyframes:

- Position, scale, rotation, opacity.
- Effect parameters.
- Audio volume and pan.

To add a keyframe:

1. Move the playhead to the desired time.
2. In the Inspector, click the diamond next to the property.
3. Change the property value.
4. Move the playhead and repeat.

Keyframes can be linear, eased, or stepped. Drag keyframes in the timeline to adjust timing.

## Effects

The Inspector contains a clearly labeled **Effects, Compositing & Keying** section for the selected
visual clip. Its quick presets provide neutral, balanced, documentary warmth, cinematic contrast,
monochrome, green-screen, and blue-screen starting points. Applying a preset is non-destructive and
updates the same editable clip filter, blend, and chroma-key settings used by preview and export.

### Clip Filters

Clip filters apply image adjustments such as:

- Brightness / Contrast
- Saturation
- Hue rotation
- Blur and sharpen
- Color grading LUTs

### Crop

The Crop effect removes edges of a clip. It can be animated with keyframes for reveal effects.

### Chroma Key

The Chroma Key effect removes a color background, typically green or blue. Adjust tolerance, edge softness, and spill suppression in the Inspector.

### Stroke and Outline

Add a border around a clip, text, or shape. Set color, width, and corner style.

### Blend Modes

Blend modes control how a clip composites with tracks below. Common modes include Normal, Multiply, Screen, Overlay, Soft Light, and Difference.

### Transitions

Place transitions between adjacent clips on the same track. Available transitions include:

- Cross dissolve
- Dip to color
- Wipe
- Slide
- Fade to black

Drag a transition from the Source Bin or Effects panel onto a cut point.

### Flip

Flip a clip horizontally or vertically. Useful for correcting mirrored footage or creating reflections.

## Text, Shapes, and Comics

### Text

Add text from the toolbar or Source Bin. Edit content directly on the Program Monitor or in the Inspector. Options include:

- Font family, size, weight.
- Fill, stroke, shadow.
- Alignment and tracking.
- Text animation presets.

### Shapes

Add rectangles, ellipses, polygons, and lines. Shapes can be filled, stroked, animated, and converted to masks.

### Comics

Comic tools include:

- **Panels** — Divide the frame into comic panels.
- **Speech bubbles** — Add dialogue with draggable tails.
- **Thought bubbles** — Add cloud-shaped bubbles.
- **SFX decals** — Pre-made sound effect graphics.
- **Captions** — Subtitle-style text overlays.

Comic elements are stage objects and can be animated like other clips.

## Audio

### Audio Clips

Drag audio files onto audio tracks. The timeline shows measured waveforms when browser decoding is
available. Large or unsupported sources are labeled **Waveform unavailable**; Sloom Studio never
substitutes a decorative waveform that could be mistaken for real audio.

### Track Volume

Adjust overall track volume with the fader on the track header. Track volume can also be automated with keyframes.

### Volume Keyframes

Select an audio clip and add volume keyframes in the Inspector or by clicking the volume line in the timeline.

### Fade and Crossfade

- **Fade In / Fade Out** — Add from the clip context menu or by dragging fade handles.
- **Crossfade** — Overlap two audio clips and apply a crossfade transition.

### Waveform Display

Toggle waveform display per track. Waveform resolution depends on zoom level.

### Narration Generation

Generate narration from text using the narration tool:

1. Select an audio track.
2. Choose **Generate Narration** from the track menu.
3. Enter the text and choose a voice.
4. The generated audio clip appears on the track.

Narration uses the configured ElevenLabs or system TTS provider.

## Sequence Settings

Sequence settings define the frame size and timing of the composition.

| Setting | Options |
|---------|---------|
| Aspect ratio | 16:9, 9:16, 1:1, custom |
| Resolution | 720p, 1080p, 4K, custom |
| Frame rate | 24, 25, 30, 60 fps |
| Pixel aspect | Square, anamorphic |
| Audio sample rate | 44.1 kHz, 48 kHz |

Choose a starter sequence to set these automatically, or open **Sequence Settings** to change them later. Changing sequence settings after editing may scale or crop existing clips.

## Professional editing and finishing

### Media management, relink, and proxies

Desktop ingest lets you **Link** an original in place or **Copy** it into managed project storage. The Media Browser provides filesystem/volume browsing and bounded metadata probes. Missing linked media appears offline with its identity retained; use the relink workflow to search and confirm the replacement rather than deleting/reimporting the clip. Consolidation copies only the used media/ranges into a planned destination and reports collisions or unavailable bytes before commit.

Proxy playback uses an explicitly associated derivative while retaining the original as delivery authority. A proxy never silently replaces a missing original for final output. Use the status shown on the source/clip to tell which representation is active.

### Long-form organization and precision

For larger edits, use subclips, logging metadata, smart bins, markers/ranges, indexed search, sequence/bin navigation, the full-sequence minimap, and duration-scaled zoom. Timebase-aware timecode includes rational and drop-frame handling where the sequence supports it. Track locks, sync locks, patch/record targets, and linked selections constrain destructive edit commands.

The trim tools use finite sessions: begin the ripple/roll/slip/slide operation, review the preview, then commit or cancel. Clipboard operations carry authored clip/track relationships rather than reducing a selection to plain text.

### Audio post

Video supports waveform/proxy generation, clip and track gain, equal-power crossfades, keyframed automation, mixer/routing, loudness/true-peak analysis, repair/cleanup, ducking, dialogue audition, and final delivery checks within their documented limits. Generated narration/SFX and cleaned dialogue become distinct Source Library derivatives; the original is retained.

Use the meters/QC result for the rendered signal, not merely inspector values. An unavailable decode or incomplete loudness analysis is reported as unavailable instead of a passing measurement.

### Color, scopes, and QC

Color controls, scopes, legal-range/gamut checks, freeze/hold and interpolation behavior, keying, tracking, masks, speed changes, and supported transitions feed the same preview/export plan. Unsupported high-bit/color metadata, effect graphs, or hardware paths refuse or disclose their bounded fallback before delivery.

### Captions, transcript, review, and delivery

Captions support semantic structure, timing edits, accessibility checks, import/export, and supported embedded/broadcast handoff. Transcript operations resolve back to record-timeline clips and respect locks/links. Local review approvals are signature bound; optional server review uses the configured self-hosted authority and project revision rather than an unauthenticated text flag.

Use structural preflight before a final deliverable. It checks media, timeline, captions, output plan, and known delivery constraints. A delivery plan can describe multiple outputs, but each produced artifact retains its own job state and evidence.

## Render and Export

Open the Export panel from **File > Export** or the workspace toolbar.

### Export Presets

| Preset | Best For |
|--------|----------|
| Review H.264 | Quick sharing and review. |
| Social Vertical | 9:16 content for short-form platforms. |
| Archive | Lossless or high-bitrate master. |
| WebM VP9 | Web playback and open-source workflows. |
| GIF | Short looping animations. |
| ProRes | Professional post-production exchange. |
| HEVC | Efficient high-quality delivery. |
| PNG/JPEG Sequence | Frame-level output for compositing. |

### Render routes and durable queue

Choose the local render-backend and export-compositor preference in Settings, then inspect the admitted route in the render job. The current routes are deliberately different rather than interchangeable labels:

- **Direct native fast path** — An eligible simple sequence (for example, one ordinary video clip with no general-compositor-only effects) can be sent directly through native FFmpeg. On supported AMD/Linux systems, decode/scale/encode can use VA-API. The job records the actual admitted route; it does not claim GPU use merely because hardware was requested.
- **General native compositor** — Multi-track/effect/keyframe work is rendered from the authored sequence plan and encoded through the native runtime. Compute-heavy composition can remain CPU-bound even when decoding or final encode uses hardware.
- **Browser/session route** — Available only for bounded compatible work. It is not used to pretend that a native feature-length or unsupported codec delivery succeeded.

Long-form delivery requires a saved/open desktop project and reachable native runtime so linked originals can be read by path and output can be written directly to project scratch. No giant result blob is returned through renderer memory.

Click **Render** to submit a job, then follow the durable queue state: planned/queued, running, recovering, completed, failed, or cancelled. Restart recovery verifies the stored job/output rather than marking an interrupted process complete. A semantic renderer failure wins over a zero process exit code.

### Incremental Cache

Rendered frames are cached incrementally. If you change only part of the timeline, only affected frames rerender. The cache can be cleared from the Export panel.

### Readiness Check

Before rendering, Sloom Studio checks for:

- Missing media.
- Offline effects.
- Sequence setting mismatches.
- License gating for certain formats.

Blocking readiness findings must be fixed or the unsupported route changed deliberately. Informational warnings do not become failures merely because they are visible, and a failed preflight cannot be overridden by renaming the preset.

### Save Preview

The **Save Preview** button renders a low-resolution preview for quick review without running a full export.

## Captions

### Import Captions

Import SRT or WebVTT files into the timeline. Captions appear as clip-like objects on a caption track.

### Edit Captions

Double-click a caption to edit its text and timing. The Inspector shows start time, end time, and style.

### Export Captions

Export captions as SRT or WebVTT from **File > Export > Captions**.

## FCP7 XML Export

Sloom Studio can export a Final Cut Pro 7 XML file for interchange with other editors. The export includes:

- Clips and edits.
- Track structure.
- Markers.
- Basic transitions.

Some effects and generative content may not translate exactly. Use the **Premiere Parity** panel to review compatibility before exporting.

## Diagnostics and comparison panels

The Diagnostics panel reports current timeline problems. Product-comparison/parity surfaces are explanatory references, not runtime gates. The render/preflight result for the current composition is the authority for whether this project can deliver through the selected route.

Common issues include:

- Missing source media.
- Unsupported codecs.
- Effects that will not export to FCP7 XML.
- Frame rate mismatches.

## Mobile Layout

On Android and narrow windows, the Video workspace adapts:

- Panels become bottom sheets.
- Timeline tracks are taller for touch.
- JKL shuttle is replaced by on-screen transport buttons.
- Precision edits use long-press menus.

Some advanced docking and floating panel features are limited on mobile.

## Best Practices

- Set sequence settings before editing to avoid scaling surprises.
- Use markers to organize long timelines.
- Lock tracks you are not editing.
- Preview often with the Rendered mode to catch effect problems early.
- Use incremental cache to speed up repeat exports.
- Export a review cut before the final render.
