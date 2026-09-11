import {
  computeVideoScopes,
  type VideoScopeBin,
  type VideoScopeResult,
} from './videoColorPipeline';

/**
 * Browser-only, bounded measurement of the decoded pixels in a rendered Program Monitor video.
 *
 * This intentionally does not seek, decode a source independently, inspect a filesystem path, or
 * retain the RGBA buffer. The caller receives derived scope bins only, so the reading can never be
 * mistaken for source/proxy provenance or a persisted image asset.
 */
export const VIDEO_DECODED_FRAME_SCOPE_SCHEMA = 'sloom.video-decoded-frame-scopes.v1' as const;
export const DEFAULT_VIDEO_SCOPE_CAPTURE_WIDTH = 320;
export const DEFAULT_VIDEO_SCOPE_CAPTURE_HEIGHT = 180;
export const DEFAULT_VIDEO_SCOPE_MAX_SAMPLES = 32_768;
export const MAX_VIDEO_SCOPE_DISPLAY_POINTS = 512;
export const MAX_VIDEO_SCOPE_CAPTURE_WIDTH = 640;
export const MAX_VIDEO_SCOPE_CAPTURE_HEIGHT = 360;
export const MAX_VIDEO_SCOPE_SAMPLES = 65_536;

export interface DecodedVideoFrameScopeVideo {
  currentTime: number;
  readyState: number;
  videoHeight: number;
  videoWidth: number;
}

export interface DecodedVideoFrameScopeCanvasContext {
  drawImage(image: CanvasImageSource, dx: number, dy: number, dWidth: number, dHeight: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

export interface DecodedVideoFrameScopeCanvas {
  height: number;
  width: number;
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): DecodedVideoFrameScopeCanvasContext | null;
}

export interface DecodedVideoFrameScopeEnvironment {
  createCanvas?: () => DecodedVideoFrameScopeCanvas | null;
}

export interface DecodedVideoFrameScopeOptions extends DecodedVideoFrameScopeEnvironment {
  maxHeight?: number;
  maxSamples?: number;
  maxWidth?: number;
}

/**
 * A changed monitor rendition or mode remounts the transient panel rather than letting a prior
 * readback survive as an apparently-current scope measurement.
 */
export function buildDecodedFrameScopesPanelKey({
  isImageSequenceOutput,
  isRenderedPreview,
  previewIdentity,
}: {
  isImageSequenceOutput: boolean;
  isRenderedPreview: boolean;
  previewIdentity?: string;
}): string {
  return `decoded-frame-scopes:${isRenderedPreview ? 'rendered' : 'stage'}:${isImageSequenceOutput ? 'image-sequence' : 'video'}:${previewIdentity ?? 'none'}`;
}

export type DecodedVideoFrameScopeFailureReason =
  | 'canvas-readback-blocked'
  | 'canvas-unavailable'
  | 'no-decoded-frame'
  | 'monitor-unavailable'
  | 'monitor-not-ready';

export interface DecodedVideoFrameScopeMeasurement {
  capturedAtMilliseconds: number;
  sampledDimensions: { height: number; width: number };
  schema: typeof VIDEO_DECODED_FRAME_SCOPE_SCHEMA;
  scopes: VideoScopeResult;
  source: 'rendered-program-monitor';
  sourceDimensions: { height: number; width: number };
}

export type DecodedVideoFrameScopeResult =
  | { ok: true; value: DecodedVideoFrameScopeMeasurement }
  | { ok: false; reason: DecodedVideoFrameScopeFailureReason; message: string };

function failure(
  reason: DecodedVideoFrameScopeFailureReason,
  message: string,
): DecodedVideoFrameScopeResult {
  return { ok: false, reason, message };
}

function positiveInteger(value: number): number | undefined {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : undefined;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function createBrowserCanvas(): DecodedVideoFrameScopeCanvas | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

function isSecurityError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'SecurityError';
}

function compactVideoScopeResultForDisplay(scopes: VideoScopeResult): VideoScopeResult {
  return {
    ...scopes,
    waveform: {
      ...scopes.waveform,
      bins: compactVideoScopeBinsForDisplay(
        scopes.waveform.bins,
        scopes.waveform.width,
        scopes.waveform.height,
        MAX_VIDEO_SCOPE_DISPLAY_POINTS,
      ),
    },
    rgbParade: {
      ...scopes.rgbParade,
      red: compactVideoScopeBinsForDisplay(
        scopes.rgbParade.red,
        scopes.rgbParade.width,
        scopes.rgbParade.height,
        MAX_VIDEO_SCOPE_DISPLAY_POINTS,
      ),
      green: compactVideoScopeBinsForDisplay(
        scopes.rgbParade.green,
        scopes.rgbParade.width,
        scopes.rgbParade.height,
        MAX_VIDEO_SCOPE_DISPLAY_POINTS,
      ),
      blue: compactVideoScopeBinsForDisplay(
        scopes.rgbParade.blue,
        scopes.rgbParade.width,
        scopes.rgbParade.height,
        MAX_VIDEO_SCOPE_DISPLAY_POINTS,
      ),
    },
    vectorscope: {
      ...scopes.vectorscope,
      bins: compactVideoScopeBinsForDisplay(
        scopes.vectorscope.bins,
        scopes.vectorscope.size,
        scopes.vectorscope.size,
        MAX_VIDEO_SCOPE_DISPLAY_POINTS,
      ),
    },
  };
}

/**
 * Samples the frame that is already decoded by the rendered Program Monitor. The result is derived
 * scope data only; no raw image buffer, URL, source path, or source rendition identifier escapes.
 */
export function measureDecodedVideoFrameScopes(
  video: DecodedVideoFrameScopeVideo | null | undefined,
  options: DecodedVideoFrameScopeOptions = {},
): DecodedVideoFrameScopeResult {
  if (!video) {
    return failure('monitor-unavailable', 'No rendered Program Monitor video is mounted to measure.');
  }
  // HAVE_CURRENT_DATA is 2. Use the literal so the boundary also behaves predictably in SSR/tests.
  if (!Number.isFinite(video.readyState) || video.readyState < 2) {
    return failure('monitor-not-ready', 'The rendered Program Monitor has not decoded a readable frame yet.');
  }

  const sourceWidth = positiveInteger(video.videoWidth);
  const sourceHeight = positiveInteger(video.videoHeight);
  if (!sourceWidth || !sourceHeight) {
    return failure('no-decoded-frame', 'The rendered Program Monitor does not expose decoded frame dimensions yet.');
  }

  const maxWidth = boundedPositiveInteger(options.maxWidth, DEFAULT_VIDEO_SCOPE_CAPTURE_WIDTH, MAX_VIDEO_SCOPE_CAPTURE_WIDTH);
  const maxHeight = boundedPositiveInteger(options.maxHeight, DEFAULT_VIDEO_SCOPE_CAPTURE_HEIGHT, MAX_VIDEO_SCOPE_CAPTURE_HEIGHT);
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const sampledWidth = Math.max(1, Math.round(sourceWidth * scale));
  const sampledHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = options.createCanvas?.() ?? createBrowserCanvas();
  if (!canvas) {
    return failure('canvas-unavailable', 'This browser cannot create a bounded canvas for decoded-frame scopes.');
  }

  canvas.width = sampledWidth;
  canvas.height = sampledHeight;
  let context: DecodedVideoFrameScopeCanvasContext | null;
  try {
    context = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return failure('canvas-unavailable', 'This browser cannot create a readable 2D canvas for decoded-frame scopes.');
  }
  if (!context) {
    return failure('canvas-unavailable', 'This browser cannot create a readable 2D canvas for decoded-frame scopes.');
  }

  try {
    context.drawImage(video as unknown as CanvasImageSource, 0, 0, sampledWidth, sampledHeight);
    const imageData = context.getImageData(0, 0, sampledWidth, sampledHeight);
    if (imageData.data.length < sampledWidth * sampledHeight * 4) {
      return failure('no-decoded-frame', 'The browser returned an incomplete decoded frame for scopes.');
    }
    const scopes = compactVideoScopeResultForDisplay(computeVideoScopes({
      data: imageData.data,
      width: sampledWidth,
      height: sampledHeight,
    }, boundedPositiveInteger(options.maxSamples, DEFAULT_VIDEO_SCOPE_MAX_SAMPLES, MAX_VIDEO_SCOPE_SAMPLES)));
    const seconds = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
    return {
      ok: true,
      value: {
        schema: VIDEO_DECODED_FRAME_SCOPE_SCHEMA,
        source: 'rendered-program-monitor',
        capturedAtMilliseconds: Math.round(seconds * 1_000),
        sourceDimensions: { width: sourceWidth, height: sourceHeight },
        sampledDimensions: { width: sampledWidth, height: sampledHeight },
        scopes,
      },
    };
  } catch (error) {
    if (isSecurityError(error)) {
      return failure(
        'canvas-readback-blocked',
        'Browser security blocked decoded-pixel readback for this rendered preview, so scopes were not measured.',
      );
    }
    return failure('no-decoded-frame', 'The rendered Program Monitor could not provide a readable decoded frame for scopes.');
  }
}

/**
 * Reduces only the number of display marks. Counts are aggregated, so rendering stays bounded while
 * the underlying measurement remains unchanged and exact.
 */
export function compactVideoScopeBinsForDisplay(
  bins: readonly VideoScopeBin[],
  width: number,
  height: number,
  maxPoints = 512,
): VideoScopeBin[] {
  const sourceWidth = positiveInteger(width);
  const sourceHeight = positiveInteger(height);
  if (!sourceWidth || !sourceHeight || bins.length === 0) return [];
  const pointLimit = boundedPositiveInteger(maxPoints, 512, 4_096);
  if (bins.length <= pointLimit) return bins.map((bin) => ({ ...bin }));

  let scale = Math.max(1, Math.ceil(Math.sqrt(bins.length / pointLimit)));
  while (Math.ceil(sourceWidth / scale) * Math.ceil(sourceHeight / scale) > pointLimit) scale += 1;
  const displayWidth = Math.max(1, Math.ceil(sourceWidth / scale));
  const displayHeight = Math.max(1, Math.ceil(sourceHeight / scale));
  const combined = new Map<number, number>();
  for (const bin of bins) {
    if (!Number.isFinite(bin.x) || !Number.isFinite(bin.y) || !Number.isFinite(bin.count) || bin.count <= 0) continue;
    const x = Math.min(displayWidth - 1, Math.max(0, Math.floor(bin.x / scale)));
    const y = Math.min(displayHeight - 1, Math.max(0, Math.floor(bin.y / scale)));
    const key = y * displayWidth + x;
    combined.set(key, (combined.get(key) ?? 0) + bin.count);
  }
  return [...combined.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, count]) => ({
      x: Math.min(sourceWidth - 1, (index % displayWidth) * scale),
      y: Math.min(sourceHeight - 1, Math.floor(index / displayWidth) * scale),
      count,
    }));
}
