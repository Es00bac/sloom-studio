/**
 * Animated-GIF decode + timing core.
 *
 * The Video timeline currently treats an animated GIF as a single frozen
 * frame. This module is the pure decode/timing layer that makes real
 * animated-GIF support possible: it decodes a GIF into timed frames with
 * correct GIF disposal-method compositing, and exposes a pure function that
 * maps an elapsed playback time to the frame that should be displayed.
 *
 * Nothing here is wired into the app yet -- a later phase does that. This
 * file is intentionally self-contained (no project imports) so it can be
 * unit-tested in isolation.
 *
 * Design notes:
 * - The disposal-compositing *decision* logic (`planGifFrameComposition`)
 *   is pure data-in/data-out: it only looks at each frame's region + GIF
 *   disposal method and never touches pixels, so it is fully unit-testable
 *   with synthetic frame descriptors.
 * - The pixel work (`compositeGifRawFrames`) is generic over a small
 *   `GifCompositeSurface` interface (clear/draw/snapshot/restore/read), so
 *   tests can back it with a trivial in-memory fake instead of a real
 *   canvas, while production code backs it with a real one.
 * - The actual byte decode I/O (`GifDecodeBackend`) is a swappable seam:
 *   the default implementation uses the browser's `ImageDecoder` (WebCodecs)
 *   when present, but `decodeGifFrames` accepts an injected backend so
 *   callers (and tests) never need a real GIF binary or a real
 *   `ImageDecoder`.
 */

/** GIF89a Graphic Control Extension disposal method, normalized to names. */
export type GifDisposalMethod =
  | 'unspecified'
  | 'none'
  | 'restoreToBackground'
  | 'restoreToPrevious';

/** A rectangular region of the logical GIF screen (canvas), in pixels. */
export interface GifFrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Just enough per-frame metadata to decide how disposal compositing works. */
export interface GifFrameDisposalDescriptor extends GifFrameRegion {
  disposal: GifDisposalMethod;
}

/**
 * A raw, not-yet-composited frame as reported by a decode backend: its own
 * local image (only the pixels for `region`, not the full canvas) plus the
 * metadata needed to composite it onto the accumulated animation canvas.
 *
 * Backends whose frames are already fully composited full-canvas images
 * (e.g. the default `ImageDecoder`-backed one, since WebCodecs composites
 * disposal internally) simply report `disposal: 'none'` and a region
 * spanning the whole canvas for every frame -- `requiresCompositing` below
 * detects that case and skips the compositing pass entirely.
 */
export interface GifRawFrame<TImage = ImageBitmap | ImageData> extends GifFrameDisposalDescriptor {
  durationMs: number;
  image: TImage;
}

/** One decoded, fully-composited, displayable animation frame. */
export interface GifFrame {
  index: number;
  durationMs: number;
  /** Cumulative start time of this frame within one loop of the animation. */
  timestampMs: number;
  bitmap: ImageBitmap | ImageData;
}

export interface GifDecodeResult {
  width: number;
  height: number;
  frames: GifFrame[];
  /** Sum of every frame's durationMs -- the length of one loop. */
  totalDurationMs: number;
  /** 0 means "loop forever" (the conventional GIF NETSCAPE2.0 meaning). */
  loopCount: number;
}

// ---------------------------------------------------------------------------
// Pure disposal-compositing planner
// ---------------------------------------------------------------------------

/**
 * What must happen to the accumulated animation canvas immediately before
 * drawing a given frame, derived purely from the disposal method + region of
 * the *previous* frame (and this frame's own disposal, for the snapshot it
 * may need to save for a later restore).
 */
export interface GifCompositionStep {
  frameIndex: number;
  /** Clear exactly this region to background/transparent before drawing. */
  clearRegionBeforeDraw: GifFrameRegion | null;
  /** Restore the canvas to the last saved snapshot before drawing. */
  restoreSnapshotBeforeDraw: boolean;
  /**
   * Capture a snapshot of the canvas right before drawing this frame, because
   * this frame's own disposal is `restoreToPrevious` -- a later frame will
   * need to restore to exactly this pre-draw state.
   */
  captureSnapshotBeforeDraw: boolean;
}

/**
 * Pure decision logic for GIF disposal compositing. Given each frame's
 * region + disposal method (and nothing else -- no pixels), returns the
 * sequence of clear/restore/capture actions needed to correctly composite
 * the animation frame-by-frame.
 *
 * Disposal semantics (GIF89a Graphic Control Extension, applied *after* a
 * frame has been displayed and *before* the next frame is drawn):
 * - `unspecified` / `none`: leave the canvas as-is.
 * - `restoreToBackground`: clear the frame's own region to background
 *   (transparent) before the next frame is drawn.
 * - `restoreToPrevious`: restore the canvas to whatever it looked like right
 *   before this frame was drawn.
 */
export function planGifFrameComposition(
  frames: readonly GifFrameDisposalDescriptor[],
): GifCompositionStep[] {
  const steps: GifCompositionStep[] = [];
  let previous: GifFrameDisposalDescriptor | null = null;

  frames.forEach((frame, frameIndex) => {
    let clearRegionBeforeDraw: GifFrameRegion | null = null;
    let restoreSnapshotBeforeDraw = false;

    if (previous) {
      switch (previous.disposal) {
        case 'restoreToBackground':
          clearRegionBeforeDraw = {
            x: previous.x,
            y: previous.y,
            width: previous.width,
            height: previous.height,
          };
          break;
        case 'restoreToPrevious':
          restoreSnapshotBeforeDraw = true;
          break;
        case 'none':
        case 'unspecified':
        default:
          break;
      }
    }

    steps.push({
      frameIndex,
      clearRegionBeforeDraw,
      restoreSnapshotBeforeDraw,
      captureSnapshotBeforeDraw: frame.disposal === 'restoreToPrevious',
    });

    previous = frame;
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Generic pixel compositor (works against a real canvas OR a test fake)
// ---------------------------------------------------------------------------

/**
 * The minimal drawing-surface contract `compositeGifRawFrames` needs.
 * Production code backs this with a real canvas; tests back it with a tiny
 * in-memory fake -- nothing here requires the DOM or a browser.
 */
export interface GifCompositeSurface<TImage, TSnapshot> {
  clearRegion(region: GifFrameRegion): void;
  drawImage(image: TImage, region: GifFrameRegion): void;
  snapshot(): TSnapshot;
  restore(snapshot: TSnapshot): void;
  toFrameImage(): TImage;
}

/**
 * Executes `planGifFrameComposition`'s decisions against a `GifCompositeSurface`,
 * producing one fully-composited output image per input frame.
 */
export function compositeGifRawFrames<TImage, TSnapshot>(
  rawFrames: readonly GifRawFrame<TImage>[],
  surface: GifCompositeSurface<TImage, TSnapshot>,
): TImage[] {
  const steps = planGifFrameComposition(rawFrames);
  const output: TImage[] = [];
  let savedSnapshot: TSnapshot | null = null;

  steps.forEach((step) => {
    const frame = rawFrames[step.frameIndex];

    if (step.restoreSnapshotBeforeDraw && savedSnapshot !== null) {
      surface.restore(savedSnapshot);
    } else if (step.clearRegionBeforeDraw) {
      surface.clearRegion(step.clearRegionBeforeDraw);
    }

    if (step.captureSnapshotBeforeDraw) {
      savedSnapshot = surface.snapshot();
    }

    surface.drawImage(frame.image, frame);
    output.push(surface.toFrameImage());
  });

  return output;
}

/**
 * A surface that just remembers "the last drawn image" with no real
 * clear/restore behavior. Only correct when every raw frame is already a
 * complete, independent composite of the full canvas (as the default
 * `ImageDecoder` backend below guarantees) -- `requiresCompositing` is what
 * decides when it's safe to use this instead of a real pixel surface.
 */
export function createPassthroughGifCompositeSurface<TImage>(): GifCompositeSurface<TImage, TImage> {
  let current: TImage | null = null;

  return {
    clearRegion: () => undefined,
    drawImage: (image) => {
      current = image;
    },
    snapshot: () => current as TImage,
    restore: (snapshot) => {
      current = snapshot;
    },
    toFrameImage: () => current as TImage,
  };
}

/**
 * True when at least one frame either isn't a full-canvas region or uses a
 * disposal method other than `none`/`unspecified` -- i.e. real cross-frame
 * pixel compositing is required to render this animation correctly, and a
 * passthrough surface would produce wrong results.
 */
export function requiresGifCompositing(
  frames: readonly GifFrameDisposalDescriptor[],
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  return frames.some((frame) => (
    frame.disposal === 'restoreToBackground'
    || frame.disposal === 'restoreToPrevious'
    || frame.x !== 0
    || frame.y !== 0
    || frame.width !== canvasWidth
    || frame.height !== canvasHeight
  ));
}

// ---------------------------------------------------------------------------
// Pure timing helpers
// ---------------------------------------------------------------------------

/** Cumulative start timestamp (ms) of each frame within one loop. */
export function getGifFrameTimeline(frames: readonly { durationMs: number }[]): number[] {
  const timeline: number[] = [];
  let elapsedMs = 0;

  for (const frame of frames) {
    timeline.push(elapsedMs);
    elapsedMs += Math.max(0, frame.durationMs);
  }

  return timeline;
}

/** Total duration (ms) of one loop -- the sum of every frame's durationMs. */
export function getGifTotalDurationMs(frames: readonly { durationMs: number }[]): number {
  return frames.reduce((total, frame) => total + Math.max(0, frame.durationMs), 0);
}

export interface SelectGifFrameOptions {
  /** Wrap past the end back to the start. Defaults to `true`. */
  loop?: boolean;
}

/**
 * PURE: maps an elapsed playback time to the frame that should be on screen.
 * This is what a timeline preview / FFmpeg frame mapping calls at render
 * time -- it never touches pixels, only per-frame durations.
 *
 * - `loop: true` (default): wraps `timeMs` into `[0, totalDurationMs)`,
 *   including for negative `timeMs`.
 * - `loop: false`: clamps to the last frame once `timeMs` reaches or passes
 *   the total duration, and to the first frame for negative `timeMs`.
 */
export function selectGifFrameIndexAtTime(
  frames: readonly { durationMs: number }[],
  timeMs: number,
  opts: SelectGifFrameOptions = {},
): number {
  if (frames.length === 0) {
    return 0;
  }

  const totalDurationMs = getGifTotalDurationMs(frames);

  if (totalDurationMs <= 0) {
    return 0;
  }

  const loop = opts.loop ?? true;
  let effectiveTimeMs: number;

  if (loop) {
    // Double-mod so negative timeMs wraps forward instead of going negative.
    effectiveTimeMs = ((timeMs % totalDurationMs) + totalDurationMs) % totalDurationMs;
  } else if (timeMs >= totalDurationMs) {
    return frames.length - 1;
  } else {
    effectiveTimeMs = Math.max(0, timeMs);
  }

  const timeline = getGifFrameTimeline(frames);

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (effectiveTimeMs >= timeline[index]) {
      return index;
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// FFmpeg-facing description (informational only, not wired anywhere yet)
// ---------------------------------------------------------------------------

export interface GifFfmpegDescription {
  isAnimated: boolean;
  frameCount: number;
  avgFrameDelayMs: number;
}

/** Small informational summary a later FFmpeg-mapping phase can consume. */
export function describeGifForFfmpeg(result: GifDecodeResult): GifFfmpegDescription {
  const frameCount = result.frames.length;

  return {
    isAnimated: frameCount > 1,
    frameCount,
    avgFrameDelayMs: frameCount > 0 ? result.totalDurationMs / frameCount : 0,
  };
}

export interface GifAnimationProbe {
  /** True when the source has more than one frame -- a real animation, not a static image. */
  isAnimated: boolean;
  /** Best-effort total frame count; 1 when no decode backend is available. */
  frameCount: number;
}

/**
 * Lightweight probe for "does this GIF actually animate?". Reads only a decode
 * backend's frame-count metadata -- it never decodes any frame's pixels -- so
 * it is cheap enough to run before deciding whether an FFmpeg export should
 * loop the source (see `describeGifForFfmpeg`) or whether a full
 * `decodeGifFrames` pass is worth the pixel-compositing cost. Never throws:
 * any failure (or the absence of a decode backend) resolves to a
 * single-frame, "not animated" result, matching `decodeGifFrames`'s
 * graceful-fallback contract.
 */
export async function probeGifAnimation(
  data: ArrayBuffer | Uint8Array | Blob,
  options: Pick<DecodeGifFramesOptions, 'createBackend'> = {},
): Promise<GifAnimationProbe> {
  try {
    const bytes = await toUint8Array(data);
    const backend = options.createBackend
      ? await options.createBackend(bytes)
      : await createDefaultGifDecodeBackend(bytes);

    if (!backend) {
      return { isAnimated: false, frameCount: 1 };
    }

    try {
      const frameCount = Math.max(1, Math.floor(backend.frameCount) || 1);
      return { isAnimated: frameCount > 1, frameCount };
    } finally {
      backend.close?.();
    }
  } catch {
    return { isAnimated: false, frameCount: 1 };
  }
}

// ---------------------------------------------------------------------------
// Decode backend seam (swappable I/O layer)
// ---------------------------------------------------------------------------

/**
 * Produces raw per-frame images + disposal metadata from source bytes. The
 * default implementation wraps the browser's `ImageDecoder`; tests (and any
 * future non-browser fallback) supply their own via
 * `DecodeGifFramesOptions.createBackend`.
 */
export interface GifDecodeBackend<TImage = ImageBitmap | ImageData> {
  width: number;
  height: number;
  /** 0 means "loop forever". */
  loopCount: number;
  frameCount: number;
  decodeFrame(index: number): Promise<GifRawFrame<TImage>>;
  close?: () => void;
}

export interface DecodeGifFramesOptions<TImage = ImageBitmap | ImageData> {
  /**
   * Overrides how raw frames are obtained from the source bytes. This is the
   * seam tests use to exercise the full decode pipeline with a synthetic
   * "mock decoder" instead of a real GIF binary or a real `ImageDecoder`.
   * Returning `null` (or resolving to `null`) means "no backend available,"
   * which `decodeGifFrames` treats as a graceful single-frame fallback.
   */
  createBackend?: (bytes: Uint8Array) => Promise<GifDecodeBackend<TImage> | null>;
  /**
   * Overrides how composited frames are rendered onto an accumulation
   * canvas when real disposal compositing is required. Defaults to an
   * `OffscreenCanvas`-backed surface when available.
   */
  createSurface?: (width: number, height: number) => GifCompositeSurface<TImage, unknown> | null;
}

/**
 * Decodes a GIF into timed, fully-composited frames. Never throws: any
 * decode failure, or a non-animated/single-frame GIF, resolves to a
 * best-effort single-frame result instead.
 */
export async function decodeGifFrames(
  data: ArrayBuffer | Uint8Array | Blob,
  options: DecodeGifFramesOptions = {},
): Promise<GifDecodeResult> {
  try {
    const bytes = await toUint8Array(data);
    const backend = options.createBackend
      ? await options.createBackend(bytes)
      : await createDefaultGifDecodeBackend(bytes);

    if (!backend) {
      return createFallbackGifDecodeResult();
    }

    try {
      return await decodeAllFramesFromBackend(backend, options);
    } finally {
      backend.close?.();
    }
  } catch {
    return createFallbackGifDecodeResult();
  }
}

async function decodeAllFramesFromBackend(
  backend: GifDecodeBackend,
  options: DecodeGifFramesOptions,
): Promise<GifDecodeResult> {
  const frameCount = Math.max(1, Math.floor(backend.frameCount) || 1);
  const rawFrames: GifRawFrame[] = [];

  for (let index = 0; index < frameCount; index += 1) {
    rawFrames.push(await backend.decodeFrame(index));
  }

  if (rawFrames.length === 0) {
    return createFallbackGifDecodeResult(backend.width, backend.height);
  }

  const bitmaps = requiresGifCompositing(rawFrames, backend.width, backend.height)
    ? compositeGifRawFrames(
      rawFrames,
      (options.createSurface ?? createDefaultGifCompositeSurface)(backend.width, backend.height)
        ?? createPassthroughGifCompositeSurface<ImageBitmap | ImageData>(),
    )
    : rawFrames.map((frame) => frame.image);

  const timeline = getGifFrameTimeline(rawFrames);

  const frames: GifFrame[] = rawFrames.map((frame, index) => ({
    index,
    durationMs: Math.max(0, frame.durationMs),
    timestampMs: timeline[index],
    bitmap: bitmaps[index],
  }));

  return {
    width: backend.width,
    height: backend.height,
    loopCount: Number.isFinite(backend.loopCount) ? backend.loopCount : 0,
    totalDurationMs: getGifTotalDurationMs(rawFrames),
    frames,
  };
}

function createFallbackGifDecodeResult(width = 1, height = 1): GifDecodeResult {
  return {
    width,
    height,
    loopCount: 0,
    totalDurationMs: 0,
    frames: [
      {
        index: 0,
        durationMs: 0,
        timestampMs: 0,
        bitmap: createEmptyImageData(width, height),
      },
    ],
  };
}

async function toUint8Array(data: ArrayBuffer | Uint8Array | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  return new Uint8Array(data as ArrayBuffer);
}

function createEmptyImageData(width: number, height: number): ImageData {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  if (typeof ImageData !== 'undefined') {
    return new ImageData(safeWidth, safeHeight);
  }

  return {
    width: safeWidth,
    height: safeHeight,
    data: new Uint8ClampedArray(safeWidth * safeHeight * 4),
  } as ImageData;
}

function getImageDecoderConstructor(): typeof ImageDecoder | undefined {
  return (globalThis as typeof globalThis & { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
}

/**
 * Default decode backend, built on the browser's `ImageDecoder` (WebCodecs).
 * WebCodecs already composites GIF disposal internally, so every frame it
 * hands back is a complete, independent full-canvas image -- we report
 * `disposal: 'none'` and a full-canvas region for each, which
 * `requiresGifCompositing` recognizes as "no extra compositing needed."
 */
async function createDefaultGifDecodeBackend(
  bytes: Uint8Array,
): Promise<GifDecodeBackend | null> {
  const ImageDecoderCtor = getImageDecoderConstructor();

  if (!ImageDecoderCtor || typeof createImageBitmap === 'undefined') {
    return null;
  }

  const decoder = new ImageDecoderCtor({ data: bytes, type: 'image/gif' });

  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack ?? decoder.tracks[0];

    if (!track) {
      decoder.close();
      return null;
    }

    const frameCount = Math.max(1, track.frameCount);
    const loopCount = track.animated ? track.repetitionCount : 0;

    const decodeFrame = async (index: number): Promise<GifRawFrame> => {
      const { image } = await decoder.decode({ frameIndex: index });

      try {
        const bitmap = await createImageBitmap(image);

        return {
          x: 0,
          y: 0,
          width: image.displayWidth,
          height: image.displayHeight,
          disposal: 'none',
          durationMs: (image.duration ?? 0) / 1000,
          image: bitmap,
        };
      } finally {
        image.close();
      }
    };

    const firstFrame = await decodeFrame(0);

    return {
      width: firstFrame.width,
      height: firstFrame.height,
      frameCount,
      loopCount,
      decodeFrame: (index) => (index === 0 ? Promise.resolve(firstFrame) : decodeFrame(index)),
      close: () => decoder.close(),
    };
  } catch {
    decoder.close();
    return null;
  }
}

function createDefaultGifCompositeSurface(
  width: number,
  height: number,
): GifCompositeSurface<ImageBitmap | ImageData, ImageData> | null {
  if (typeof OffscreenCanvas === 'undefined') {
    return null;
  }

  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  return {
    clearRegion(region) {
      ctx.clearRect(region.x, region.y, region.width, region.height);
    },
    drawImage(image, region) {
      if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        ctx.putImageData(image, region.x, region.y);
      } else {
        ctx.drawImage(image as CanvasImageSource, region.x, region.y, region.width, region.height);
      }
    },
    snapshot() {
      return ctx.getImageData(0, 0, width, height);
    },
    restore(snapshot) {
      ctx.putImageData(snapshot, 0, 0);
    },
    toFrameImage() {
      return ctx.getImageData(0, 0, width, height);
    },
  };
}
