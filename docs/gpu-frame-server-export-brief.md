# GPU frame-server export — historical engineering brief

> **Status:** preserved design record, not current product documentation. Written July 10, 2026;
> disposition updated August 27, 2026 against Sloom Studio `0.9.16-b`.
>
> The proposed all-composited frame-server architecture below was not silently shipped as the
> current renderer. The integrated product instead has a **narrow direct-native fast path** for
> one untouched video clip. On eligible desktop hardware it can use FFmpeg/VA-API for scaling and
> encode. Edited, layered, transformed, filtered, retimed, masked, color-finished, audio-bearing,
> or otherwise non-identity timelines use the general compositor/render plan; native CPU remains
> an explicit fallback. See `docs/userguide/07-video.md` and
> `docs/notes/2026-08-27-video-render-preview-global-menu-repair.md` for current behavior and
> evidence.

Date: 2026-07-10. Origin: Jarrod, watching the Case File 2033 motion-comic render peg 24
CPU threads at ~90% while the GPU idled near 2%: "I would like the GPU to accelerate this
application all of the time if there is a GPU."

## The problem (verified on a live render)

The Video workspace has TWO compositors:

1. **Preview (Edit Stage)** — the in-app GPU canvas. Draws the timeline live, hardware
   accelerated, and is by definition what the user approved visually.
2. **Export** — `mediaComposition.ts` translates the timeline into an ffmpeg
   `filter_complex` graph; the native render service (`ops/native-render/local-renderer.mjs`)
   runs it. ffmpeg's transform/transition filters (zoompan/scale/crop/overlay/xfade) are
   **software-only**; VAAPI covers decode + encode, not these filters. So export =
   CPU redraws every frame, GPU only encodes (`h264_vaapi`).

Consequences, observed 2026-07-10 on the 806s / 265-keyframe motion comic:
- ~19-24 threads at full load for the whole render; VCN encode a few percent (and invisible
  in GNOME System Monitor, which graphs the 3D engine, causing "GPU is unused" reports).
- Filter-heavy timelines (keyframed stills, long transitions) scale with CPU only.
- Correctness risk: two engines re-implement the same visual spec; every mismatch is a
  "preview doesn't match export" bug class.
- Argument-size ceiling: the generated graph hit Linux's 128KB arg cap (E2BIG) — mitigated
  2026-07-10 via `-filter_complex_script` in the render service, but graph size still grows
  with timeline complexity.

## Proposed architecture: frame-server export (one compositor)

Step the EXISTING preview engine through the timeline deterministically (offscreen/
headless canvas, fixed timestep = 1/fps), read back each rendered frame, and pipe raw
frames into ffmpeg solely for encode/mux:

    app GPU compositor -> rawvideo pipe (or NUT/y4m) -> ffmpeg -c:v h264_vaapi (or preset)

- GPU composites (same code as preview: guaranteed WYSIWYG), GPU encodes; CPU only moves bytes.
- 1080p30 RGBA readback ≈ 250 MB/s — comfortably within PCIe/pipe budgets; 4K30 ≈ 1 GB/s,
  still feasible; readback via async PBOs / `transferToImageBitmap` to avoid stalls.
- Kills the filter-graph size problem entirely (no more giant graphs for complex timelines).
- Audio: unchanged (ffmpeg mixes audio tracks as today, muxed with the piped video).
- Platform notes: Electron = OffscreenCanvas in a hidden window or worker; browser build =
  same OffscreenCanvas path (encode via the native service when present, else WebCodecs);
  Android = the Capacitor webview supports OffscreenCanvas; native service absent there,
  so WebCodecs/MediaRecorder fallback continues.

## Scope / risks

- Engine work: deterministic timeline stepping (decouple from requestAnimationFrame),
  frame-accurate media sampling for video sources (seek-exact decode), readback pipeline,
  backpressure between compositor and encoder pipe.
- Days of work + cross-platform verification, NOT a drive-by patch. Ship behind a toggle
  ("Export engine: Composited (GPU) / Legacy (ffmpeg graph)") until parity is proven on
  the existing render test corpus.
- Interim truth to state honestly anywhere relevant: encoder acceleration is live today;
  filter-stage compositing is CPU.

## Historical status

- 2026-07-10: brief written; awaiting Jarrod's prioritization vs. revenue work.
- 2026-07-10 ~10:20 MT: **GREEN-LIT by Jarrod and REFRAMED as a correctness bug**, his words:
  "Translating what my preview engine drew is exactly what it should be doing... right now it
  also does not look like it does on my edit stage when a render is output... If it's
  different, then it's broken and it's going to piss people off." The Edit Stage is the
  contract; the export must be what the stage drew. builder dispatched same hour on branch
  feat/frame-server-export (worktree): Phase 1 = reproduce + characterize the visual
  mismatch with before-evidence diffs; Phase 2 = deterministic stage-compositor frame
  server streaming rawvideo to ffmpeg (encode/mux only, /render-stream endpoint, legacy
  path kept as fallback setting); Phase 3 = parity gate (stage screenshots vs exported
  frames), existing suites, CF2033 2-page e2e, GPU/CPU load evidence, then merge.

## Current disposition

This brief remains useful as background for a future renderer project, but it must not be cited as
evidence that a universal GPU compositor or frame-server export is present. Any future work needs
its own task, performance evidence, preview/export parity gate, bounded memory/backpressure plan,
and cross-platform verification.
