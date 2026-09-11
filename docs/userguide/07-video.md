# 7. Video workspace

**Video** is a multi-track timeline editor for sequencing clips, overlays, and audio into a
finished piece. Clips generated in Flow or edited in Image are already in your source library, so
editing is mostly arranging and timing — no importing between tools.

## Ingesting camera originals and long-form media

Use **Import Media**, **Video**, or **Audio** in the Project Source Bin. Desktop import opens a
media-handling dialog before the file picker: **Link originals** is the recommended feature-length
workflow, while **Copy into project media** creates a managed project copy when project scratch is
available. Keep linked originals at the same path while editing; copied media remains with the
project scratch files.

The Source Bin classifies every item as **Ingested** or **Generated**. Use the **All media**,
**Ingested**, and **Generated** origin controls before the video/audio/image kind filters, and use
search to narrow the remaining pool. Cards and the Source Monitor identify origin, storage mode,
duration, resolution, and media type, so linked originals, managed copies, browser-session media,
and recovery media are not ambiguous. Legacy items without an origin marker are treated
conservatively as ingested instead of guessing from their filenames.

In a browser, ordinary imports use durable browser storage when possible. Video or audio at least
512 MB is intentionally session-linked to the selected `File` so ingest does not duplicate or
base64-encode the entire source. That browser-only link must be reimported after the session closes;
use desktop linked ingest or a project scratch folder when the media must reopen durably.

Feature-length sequences use the same non-destructive clip metadata as short edits. Source groups
show 48 cards at a time and reveal another page on request; technical metadata is probed only for
visible, selected, and timeline-referenced sources with bounded concurrency. The ruler
chooses bounded time intervals rather than rendering one marker per second, offscreen clips are
culled from the live timeline DOM, metadata probing is concurrency-limited, and horizontal zoom
scales with sequence duration (a two-hour timeline can reach a ten-second working window). The
transport and duration badges use `HH:MM:SS:FF` production timecode, and sequences of 30 minutes
or longer show **Long-form** mode.

At normal 1× playback, the Program Monitor plays the active video and timeline audio continuously,
including source trims, clip/track level, mute/solo, automation, measured gain, and fades. Paused
scrubbing and frame stepping remain exact seeks.

Feature-length export is desktop-native only. The per-frame RGBA compositor and browser FFmpeg
path are disabled at 30 minutes because they materialize too much media in browser memory. Native
FFmpeg reads linked originals by path and writes the completed movie directly into project scratch;
the output returns to the project as a registered file reference rather than a multi-gigabyte Blob.
Save or open the project first so it has a scratch directory, then use Native CPU or AMD VA-API.

## The timeline

The bottom of the workspace is a **multi-track timeline**. Each track holds clips laid out in
time; stack tracks to composite video over video and mix audio.

- **Add clips** by dragging from the **Source Bin** onto a track.
- **Trim** by dragging clip edges; **move** clips along and between tracks.
- **Snapping** aligns clip edges to each other and to the playhead so cuts land cleanly.
- The **playhead** scrubs the composition; the preview above shows the current frame.
- The ruler and track area stay horizontally synchronized while you pan or zoom a long sequence.
- If browser waveform decoding is unavailable or the source is too large, the lane says
  **Waveform unavailable** instead of displaying fabricated peaks.

## Tracks and layers

- **Video tracks** composite top-over-bottom, so an overlay on an upper track sits above the clip
  below it.
- **Audio tracks** mix together; set per-clip **volume**.
- **Text** and **shape** overlays are first-class clips you place on a track and time like any
  other.

## Animation with keyframes

Clip properties animate over time with **keyframes**:

- **Transform** — position, scale, and rotation animate, so you can pan, push in, or move an
  overlay across the frame.
- **Opacity** fades clips in and out.
- **Crop** trims the visible area and can animate.

Set a keyframe at one point in time, change the value at another, and Sloom Studio interpolates
between them.

## Effects, compositing, and keying

Select a visual clip and open **Effects, Compositing & Keying** in the Inspector. Quick presets
provide neutral, balanced, documentary, cinematic, monochrome, green-screen, and blue-screen
starting points. The same section exposes the ordered filter stack, 16 blend modes, chroma-key
color/similarity/edge controls, crop, stroke, and transitions. Presets are non-destructive: they
write the same clip settings used by the rendered preview and export paths, and every value remains
editable after applying a preset.

## Generating clips *(needs a provider key)*

Video clips themselves usually come from **Flow** — text-to-video or image-to-video nodes,
including providers (such as Veo, Seedance, and Wan via Atlas Cloud or Vertex) that generate
asynchronously. Generate in Flow, then sequence the result here. Everything stays in the one
project.

## Export

Render the composition out to a standard video file. Program preview and export share the same
timeline/keyframe semantics, and unsupported native combinations fail with an explanation instead
of silently changing the edit.

On desktop, a simple sequence containing one unmodified video clip can use the direct native
FFmpeg fast path. When VA-API is available, scaling and encoding stay on the GPU; if hardware setup
fails, the same bounded job can fall back to native CPU. Multi-clip compositions, transforms,
effects, overlays, and other complex edits use the general compositor/render plan. Browser and
Android capabilities depend on their available runtime and codec support.

The durable render queue records queued, active, completed, failed, and cancelled jobs so an app
restart can resume or report them honestly.

## Professional finishing workflows

Markers, audio crossfades and embedded-audio waveforms, decoded-frame scopes, primary colour
correction, a track/bus mixer, loudness normalization and true-peak limiting, rendered speed ramps,
nested sequences and adjustment layers, relink/consolidate, transcript editing, multicam, AAF/MXF
handoff wrappers, embedded captions, decoded-signal QC, external monitoring/control, rotoscoping,
tracking, chroma key, audio repair/ducking, hardware encoding, and alpha export are documented with
their bounded routes in
[Qualified Missing Hundred features](15-qualified-missing-hundred-features.md#video).

---

Next: [Paper workspace →](08-paper.md)
