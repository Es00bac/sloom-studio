import {
  MAX_DECODED_SIGNAL_QC_AUDIO_WINDOWS,
  MAX_DECODED_SIGNAL_QC_SOURCES,
  MAX_DECODED_SIGNAL_QC_VIDEO_SAMPLES,
  analyzeVideoDecodedSignalQc,
  summarizeDecodedVideoFrame,
  type VideoDecodedSignalQcAudioWindow,
  type VideoDecodedSignalQcFrameSample,
  type VideoDecodedSignalQcReport,
  type VideoDecodedSignalQcSourceInput,
} from './videoDecodedSignalQc';

const MAX_DECODED_SIGNAL_QC_DURATION_MS = 12 * 60 * 60 * 1_000;
const MAX_DECODED_SIGNAL_QC_MEDIA_BYTES = 256 * 1024 * 1024;
const FRAME_CANVAS_WIDTH = 160;
const AUDIO_WINDOW_MS = 100;

export interface VideoDecodedSignalQcRuntimeSource {
  id: string;
  label: string;
  kind: 'video' | 'audio';
  assetUrl?: string;
}

export type VideoDecodedSignalQcRuntimeDecoder = (
  source: VideoDecodedSignalQcRuntimeSource,
  signal: AbortSignal,
) => Promise<VideoDecodedSignalQcSourceInput>;

export interface RunVideoDecodedSignalQcOptions {
  sources: readonly VideoDecodedSignalQcRuntimeSource[];
  compositionSignature?: string;
  signal?: AbortSignal;
  decoder?: VideoDecodedSignalQcRuntimeDecoder;
  now?: () => number;
}

export type RunVideoDecodedSignalQcResult =
  | { cancelled: true }
  | { cancelled: false; report: VideoDecodedSignalQcReport };

/**
 * Decodes each source sequentially so cancellation is prompt and the browser never holds many
 * video elements or AudioBuffers at once. A source-level failure becomes an explicit report row;
 * it never turns into a silent clean result.
 */
export async function runVideoDecodedSignalQc(
  options: RunVideoDecodedSignalQcOptions,
): Promise<RunVideoDecodedSignalQcResult> {
  const signal = options.signal ?? new AbortController().signal;
  const decoder = options.decoder ?? decodeBrowserSourceForQc;
  const sources: VideoDecodedSignalQcSourceInput[] = [];
  const seen = new Set<string>();
  let sourceLimitReached = false;
  for (const source of options.sources) {
    const id = source.id.trim();
    if (!id || seen.has(id)) continue;
    if (sources.length >= MAX_DECODED_SIGNAL_QC_SOURCES) {
      sourceLimitReached = true;
      break;
    }
    seen.add(id);
    if (signal.aborted) return { cancelled: true };
    try {
      sources.push(await decoder(source, signal));
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return { cancelled: true };
      sources.push({
        id: source.id,
        label: source.label,
        kind: source.kind,
        unavailableReason: error instanceof Error ? boundedError(error.message) : 'The browser decoder did not return a usable signal.',
      });
    }
  }
  if (signal.aborted) return { cancelled: true };
  return {
    cancelled: false,
    report: analyzeVideoDecodedSignalQc({
      // The pure analyzer owns the visible truncation finding. Its extra sentinel is never
      // decoded or retained because analysis takes the first bounded source set.
      sources: sourceLimitReached
        ? [...sources, { id: 'decoded-signal-qc-source-limit', label: 'Additional media sources', kind: 'video', unavailableReason: 'Not decoded because this run reached the source limit.' }]
        : sources,
      compositionSignature: options.compositionSignature,
      createdAt: (options.now ?? Date.now)(),
    }),
  };
}

export async function decodeBrowserSourceForQc(
  source: VideoDecodedSignalQcRuntimeSource,
  signal: AbortSignal,
): Promise<VideoDecodedSignalQcSourceInput> {
  if (!source.assetUrl?.trim()) {
    return { id: source.id, label: source.label, kind: source.kind, unavailableReason: 'No browser-readable asset URL is available for this source.' };
  }
  throwIfAborted(signal);
  if (source.kind === 'audio') {
    const decoded = await decodeAudioWindows(source.assetUrl, signal);
    return { id: source.id, label: source.label, kind: source.kind, durationMs: decoded.durationMs, audioWindows: decoded.windows };
  }

  const frameResult = await settle(() => decodeVideoFrames(source.assetUrl!, signal));
  const audioResult = await settle(() => decodeAudioWindows(source.assetUrl!, signal));
  if (signal.aborted || isAbortError(frameResult.error) || isAbortError(audioResult.error)) throw abortError();
  const frames = frameResult.value?.frames ?? [];
  const windows = audioResult.value?.windows ?? [];
  const durationMs = frameResult.value?.durationMs ?? audioResult.value?.durationMs;
  if (frames.length > 0 || windows.length > 0) {
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      durationMs,
      frameSamples: frames,
      audioWindows: windows,
      // A sampled side must not erase a rejected side. The pure analyzer persists
      // these compact reasons and marks the source partial rather than analyzed.
      frameUnavailableReason: frameResult.error instanceof Error ? boundedError(frameResult.error.message) : undefined,
      audioUnavailableReason: audioResult.error instanceof Error ? boundedError(audioResult.error.message) : undefined,
    };
  }
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    unavailableReason: [frameResult.error, audioResult.error]
      .filter((error): error is Error => error instanceof Error)
      .map((error) => boundedError(error.message))
      .join(' ') || 'The browser could not decode a video frame or PCM window.',
  };
}

async function decodeVideoFrames(assetUrl: string, signal: AbortSignal): Promise<{ durationMs: number; frames: VideoDecodedSignalQcFrameSample[] }> {
  if (typeof document === 'undefined') throw new Error('Video-frame QC requires a browser document.');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = assetUrl;
  try {
    await waitForVideoEvent(video, 'loadedmetadata', signal);
    const durationMs = durationFromSeconds(video.duration);
    const sampleTimes = buildSampleTimes(durationMs, MAX_DECODED_SIGNAL_QC_VIDEO_SAMPLES);
    const width = Math.max(1, Math.min(FRAME_CANVAS_WIDTH, video.videoWidth || FRAME_CANVAS_WIDTH));
    const height = Math.max(1, Math.round(width * Math.max(1, video.videoHeight) / Math.max(1, video.videoWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The browser did not provide a readable 2D canvas for video QC.');
    const frames: VideoDecodedSignalQcFrameSample[] = [];
    for (const timeMs of sampleTimes) {
      throwIfAborted(signal);
      video.currentTime = timeMs / 1_000;
      await waitForVideoEvent(video, 'seeked', signal);
      context.drawImage(video, 0, 0, width, height);
      const summary = summarizeDecodedVideoFrame(context.getImageData(0, 0, width, height).data, width, height);
      frames.push({ timeMs, ...summary });
    }
    return { durationMs, frames };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function decodeAudioWindows(assetUrl: string, signal: AbortSignal): Promise<{ durationMs: number; windows: VideoDecodedSignalQcAudioWindow[] }> {
  const bytes = await fetchBoundedBytes(assetUrl, signal);
  const AudioContextConstructor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio decoding is unavailable in this browser.');
  const context = new AudioContextConstructor();
  try {
    throwIfAborted(signal);
    const buffer = await context.decodeAudioData(bytes.slice(0));
    throwIfAborted(signal);
    const durationMs = durationFromSeconds(buffer.duration);
    const windows = sampleAudioBuffer(buffer, durationMs, signal);
    return { durationMs, windows };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function sampleAudioBuffer(buffer: AudioBuffer, durationMs: number, signal: AbortSignal): VideoDecodedSignalQcAudioWindow[] {
  if (buffer.numberOfChannels <= 0 || buffer.length <= 0) return [];
  const count = Math.min(MAX_DECODED_SIGNAL_QC_AUDIO_WINDOWS, Math.max(1, Math.ceil(durationMs / 1_000)));
  const spanFrames = Math.max(1, Math.min(buffer.length, Math.round(buffer.sampleRate * AUDIO_WINDOW_MS / 1_000)));
  const windows: VideoDecodedSignalQcAudioWindow[] = [];
  for (let index = 0; index < count; index += 1) {
    throwIfAborted(signal);
    const center = count === 1 ? Math.floor(buffer.length / 2) : Math.floor((buffer.length - 1) * index / (count - 1));
    const start = Math.max(0, Math.min(buffer.length - 1, center - Math.floor(spanFrames / 2)));
    const end = Math.min(buffer.length, start + spanFrames);
    let sumSquares = 0;
    let peak = 0;
    let observations = 0;
    for (let frame = start; frame < end; frame += 1) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const sample = buffer.getChannelData(channel)[frame] ?? 0;
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        observations += 1;
      }
    }
    windows.push({
      startMs: Math.round(start / buffer.sampleRate * 1_000),
      endMs: Math.round(end / buffer.sampleRate * 1_000),
      rms: observations ? Math.sqrt(sumSquares / observations) : 0,
      peak,
    });
  }
  return windows;
}

async function fetchBoundedBytes(assetUrl: string, signal: AbortSignal): Promise<ArrayBuffer> {
  if (typeof fetch !== 'function') throw new Error('Fetching media for decoded-signal QC is unavailable in this browser.');
  const response = await fetch(assetUrl, { signal });
  if (!response.ok) throw new Error(`Media fetch failed with HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DECODED_SIGNAL_QC_MEDIA_BYTES) {
    throw new Error(`Media exceeds the ${Math.round(MAX_DECODED_SIGNAL_QC_MEDIA_BYTES / 1024 / 1024)} MiB browser QC limit.`);
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_DECODED_SIGNAL_QC_MEDIA_BYTES) throw new Error(`Media exceeds the ${Math.round(MAX_DECODED_SIGNAL_QC_MEDIA_BYTES / 1024 / 1024)} MiB browser QC limit.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > MAX_DECODED_SIGNAL_QC_MEDIA_BYTES) throw new Error(`Media exceeds the ${Math.round(MAX_DECODED_SIGNAL_QC_MEDIA_BYTES / 1024 / 1024)} MiB browser QC limit.`);
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

function buildSampleTimes(durationMs: number, maximum: number): number[] {
  const count = Math.min(maximum, Math.max(1, Math.ceil(durationMs / 1_000)));
  if (count === 1) return [Math.max(0, Math.floor(durationMs / 2))];
  return Array.from({ length: count }, (_, index) => Math.round((durationMs - 1) * index / (count - 1)));
}

function durationFromSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Decoded media did not provide a finite positive duration.');
  const durationMs = Math.round(seconds * 1_000);
  if (durationMs > MAX_DECODED_SIGNAL_QC_DURATION_MS) throw new Error('Decoded media exceeds the 12-hour browser QC duration limit.');
  return durationMs;
}

function waitForVideoEvent(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSuccess = () => finish(resolve);
    const onFailure = () => finish(() => reject(new Error('The browser could not decode this media source.')));
    const onAbort = () => finish(() => reject(abortError()));
    const finish = (callback: () => void) => {
      video.removeEventListener(event, onSuccess);
      video.removeEventListener('error', onFailure);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    video.addEventListener(event, onSuccess, { once: true });
    video.addEventListener('error', onFailure, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function settle<T>(operation: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await operation() };
  } catch (error) {
    return { error };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error('Decoded-signal QC was cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function boundedError(value: string): string {
  return value.trim().slice(0, 512) || 'The browser decoder did not return a usable signal.';
}
