import type { ProfessionalMask } from '../types/videoProfessional';

const MAX_TRACKING_FRAMES = 16;
const MAX_TRACKING_DIMENSION = 160;
const MAX_TRACKING_DURATION_MS = 60_000;

/** Wall-clock bound for every metadata/seek wait so a stalled decode can never hang the run. */
export const MAX_EVENT_WAIT_MS = 10_000;

export class MaskTrackingMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaskTrackingMediaError';
  }
}

export interface DecodedRotoFrame {
  timeMs: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface BoundedMaskTrackingResult {
  keyframes: Array<{ timeMs: number; offsetX: number; offsetY: number; scale: number }>;
  sampledFrames: number;
}

export interface RunBrowserMaskTrackingOptions {
  assetUrl: string;
  mask: ProfessionalMask;
  startMs?: number;
  durationMs?: number;
  signal?: AbortSignal;
}

/**
 * Tracks the initial rectangular/elliptical mask's luminance patch through a small, sequential
 * browser decode. It is deliberately bounded (16 160px-wide frames, 60 seconds, a per-wait
 * wall-clock timeout) and writes only compact offset keyframes. No partial result is returned
 * after cancellation, a decode error, or a stalled metadata/seek wait.
 */
export async function runBrowserMaskTracking(
  options: RunBrowserMaskTrackingOptions,
): Promise<BoundedMaskTrackingResult> {
  if (typeof document === 'undefined') throw new Error('Decoded-frame tracking requires a browser document.');
  if (!options.assetUrl.trim()) throw new Error('Tracking requires a browser-readable video source.');
  assertTrackableMask(options.mask);
  throwIfAborted(options.signal);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = options.assetUrl;
  try {
    await waitForVideoEvent(video, 'loadedmetadata', options.signal);
    const totalDurationMs = Math.max(0, Math.round(video.duration * 1_000));
    if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) throw new Error('Tracking requires a finite video duration.');
    const startMs = clamp(Math.round(options.startMs ?? 0), 0, Math.max(0, totalDurationMs - 1));
    const requestedDuration = Math.max(1, Math.round(options.durationMs ?? totalDurationMs - startMs));
    const durationMs = Math.min(requestedDuration, MAX_TRACKING_DURATION_MS, totalDurationMs - startMs);
    const width = Math.max(1, Math.min(MAX_TRACKING_DIMENSION, video.videoWidth || MAX_TRACKING_DIMENSION));
    const height = Math.max(1, Math.round(width * Math.max(1, video.videoHeight) / Math.max(1, video.videoWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The browser did not provide a readable 2D canvas for tracking.');

    const frames: DecodedRotoFrame[] = [];
    for (const timeMs of sampleTimes(startMs, durationMs, MAX_TRACKING_FRAMES)) {
      throwIfAborted(options.signal);
      video.currentTime = timeMs / 1_000;
      await waitForVideoEvent(video, 'seeked', options.signal);
      context.drawImage(video, 0, 0, width, height);
      frames.push({ timeMs, width, height, data: context.getImageData(0, 0, width, height).data });
    }
    throwIfAborted(options.signal);
    return trackMaskAcrossDecodedFrames(options.mask, frames, options.signal);
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

export function trackMaskAcrossDecodedFrames(
  mask: ProfessionalMask,
  frames: readonly DecodedRotoFrame[],
  signal?: AbortSignal,
): BoundedMaskTrackingResult {
  assertTrackableMask(mask);
  if (frames.length === 0) throw new Error('Tracking needs at least one decoded frame.');
  if (frames.length > MAX_TRACKING_FRAMES) throw new Error(`Tracking is limited to ${MAX_TRACKING_FRAMES} decoded frames.`);
  const [first] = frames;
  if (!first) throw new Error('Tracking needs an initial decoded frame.');
  validateFrame(first);
  const bounds = normalizedBounds(mask);
  const anchor = patchBounds(bounds, first.width, first.height);
  const template = lumaPatch(first, anchor.x, anchor.y, anchor.width, anchor.height);
  const searchRadius = Math.max(8, Math.min(24, Math.round(Math.min(anchor.width, anchor.height) * 0.75)));
  const ambiguityMargin = Math.max(2, Math.round(anchor.width * anchor.height * 0.05));
  const keyframes: BoundedMaskTrackingResult['keyframes'] = [];

  for (const frame of frames) {
    throwIfAborted(signal);
    validateFrame(frame);
    if (frame.width !== first.width || frame.height !== first.height) throw new Error('Tracking frames must use one decoded size.');
    const minX = Math.max(0, anchor.x - searchRadius);
    const maxX = Math.min(frame.width - anchor.width, anchor.x + searchRadius);
    const minY = Math.max(0, anchor.y - searchRadius);
    const maxY = Math.min(frame.height - anchor.height, anchor.y + searchRadius);
    if ((maxX - minX + 1) * (maxY - minY + 1) <= 1) throw new Error('Tracking search window has a single candidate cell, so motion cannot be verified.');
    let best = { x: anchor.x, y: anchor.y, score: Number.POSITIVE_INFINITY };
    let nextBestScore = Number.POSITIVE_INFINITY;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const score = patchDifference(template, frame, x, y, anchor.width, anchor.height);
        if (score < best.score) {
          nextBestScore = best.score;
          best = { x, y, score };
        } else if (score < nextBestScore) nextBestScore = score;
      }
    }
    if (nextBestScore - best.score < ambiguityMargin) throw new Error('Tracking patch is not visually distinguishable in this decoded frame.');
    if (best.x === minX || best.x === maxX || best.y === minY || best.y === maxY) throw new Error('Tracking patch matched at the edge of its bounded search window, so the motion may extend beyond it.');
    keyframes.push({
      timeMs: Math.max(0, Math.round(frame.timeMs)),
      offsetX: (best.x - anchor.x) / first.width,
      offsetY: (best.y - anchor.y) / first.height,
      scale: 1,
    });
  }
  return { keyframes, sampledFrames: frames.length };
}

function assertTrackableMask(mask: ProfessionalMask): void {
  if (mask.kind !== 'rectangle' && mask.kind !== 'ellipse') throw new Error('Bounded decoded-frame tracking supports rectangle and ellipse masks only.');
  if (mask.inverted) throw new Error('Bounded decoded-frame tracking does not support inverted masks.');
  if (mask.points.length < 2) throw new Error('Tracking needs two finite normalized mask points.');
  normalizedBounds(mask);
}

function normalizedBounds(mask: ProfessionalMask): { x: number; y: number; width: number; height: number } {
  const points = mask.points.slice(0, 2);
  if (points.length !== 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    throw new Error('Tracking needs two finite normalized mask points.');
  }
  const [a, b] = points;
  if (!a || !b) throw new Error('Tracking needs two finite normalized mask points.');
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (width <= 0 || height <= 0) throw new Error('Tracking mask bounds must have positive area.');
  return { x, y, width, height };
}

function patchBounds(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  const patchWidth = Math.max(2, Math.min(width, Math.round(bounds.width * width)));
  const patchHeight = Math.max(2, Math.min(height, Math.round(bounds.height * height)));
  return {
    x: clamp(Math.round(bounds.x * width), 0, Math.max(0, width - patchWidth)),
    y: clamp(Math.round(bounds.y * height), 0, Math.max(0, height - patchHeight)),
    width: patchWidth,
    height: patchHeight,
  };
}

function lumaPatch(frame: DecodedRotoFrame, x: number, y: number, width: number, height: number): Uint8Array {
  const values = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) values[row * width + column] = luma(frame.data, ((y + row) * frame.width + x + column) * 4);
  }
  return values;
}

function patchDifference(template: Uint8Array, frame: DecodedRotoFrame, x: number, y: number, width: number, height: number): number {
  let difference = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) difference += Math.abs(template[row * width + column]! - luma(frame.data, ((y + row) * frame.width + x + column) * 4));
  }
  return difference;
}

function luma(data: Uint8ClampedArray, index: number): number {
  return Math.round((data[index] ?? 0) * 0.2126 + (data[index + 1] ?? 0) * 0.7152 + (data[index + 2] ?? 0) * 0.0722);
}

function validateFrame(frame: DecodedRotoFrame): void {
  if (!Number.isFinite(frame.timeMs) || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 1 || frame.height <= 1 || frame.width > MAX_TRACKING_DIMENSION || !(frame.data instanceof Uint8ClampedArray) || frame.data.length < frame.width * frame.height * 4) {
    throw new Error('Tracking received an invalid or over-bound decoded frame.');
  }
}

function sampleTimes(startMs: number, durationMs: number, maximum: number): number[] {
  const count = Math.min(maximum, Math.max(2, Math.ceil(durationMs / 5_000) + 1));
  const endMs = startMs + Math.max(0, durationMs - 1);
  return Array.from({ length: count }, (_, index) => Math.round(startMs + (endMs - startMs) * index / (count - 1)));
}

function waitForVideoEvent(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout: { current: ReturnType<typeof setTimeout> | undefined } = { current: undefined };
    const cleanup = () => {
      if (timeout.current !== undefined) clearTimeout(timeout.current);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const settle = (finish: () => void) => { cleanup(); finish(); };
    const done = () => settle(resolve);
    const failed = () => settle(() => reject(new MaskTrackingMediaError(video.error?.message ? `The source media could not be decoded: ${video.error.message}` : 'The source media could not be decoded.')));
    const timedOut = () => settle(() => reject(new MaskTrackingMediaError(event === 'loadedmetadata' ? 'Timed out waiting for the source media to report its metadata.' : 'Timed out waiting for the source media to finish seeking.')));
    const aborted = () => settle(() => reject(abortError()));
    if (signal?.aborted) return aborted();
    timeout.current = setTimeout(timedOut, MAX_EVENT_WAIT_MS);
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void { if (signal?.aborted) throw abortError(); }
function abortError(): Error { return new DOMException('Tracking cancelled.', 'AbortError'); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
