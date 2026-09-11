/**
 * Bounded analysis of samples already decoded by a trusted local runtime.
 *
 * This module is intentionally independent from browser and Electron APIs. It never opens a URL
 * or starts a decoder; callers provide short frame and PCM-window observations, and it records
 * exactly what was sampled. That distinction keeps persisted reports useful without turning a
 * sampled pass into a claim about every frame, loudness, gamut, or elementary-stream integrity.
 */

export const MAX_DECODED_SIGNAL_QC_SOURCES = 64;
export const MAX_DECODED_SIGNAL_QC_VIDEO_SAMPLES = 120;
export const MAX_DECODED_SIGNAL_QC_AUDIO_WINDOWS = 256;
export const MAX_DECODED_SIGNAL_QC_ISSUES = 1_000;

export const VIDEO_DECODED_SIGNAL_QC_DISCLAIMER =
  'Decoded-signal QC samples bounded browser-decoded frames and PCM windows. Findings identify sampled intervals only; this report does not certify every frame, loudness compliance, gamut, codec conformance, or elementary-stream integrity.';

export type VideoDecodedSignalQcSeverity = 'error' | 'warning' | 'info';
export type VideoDecodedSignalQcIssueCode =
  | 'source-unavailable'
  | 'input-truncated'
  | 'black-frame-run'
  | 'frozen-frame-run'
  | 'silent-audio-run'
  | 'audio-clipping';

export interface VideoDecodedSignalQcFrameSample {
  timeMs: number;
  /** Linear-ish luma normalized to 0..1 from a decoded frame. */
  luma: number;
  /** A small normalized luma grid used only to compare adjacent sampled frames. */
  signature?: number[];
}

export interface VideoDecodedSignalQcAudioWindow {
  startMs: number;
  endMs: number;
  /** Root-mean-square amplitude normalized to 0..1. */
  rms: number;
  /** Absolute sample peak normalized to 0..1. */
  peak: number;
}

export interface VideoDecodedSignalQcSourceInput {
  id: string;
  label: string;
  kind: 'video' | 'audio';
  durationMs?: number;
  frameSamples?: readonly VideoDecodedSignalQcFrameSample[];
  audioWindows?: readonly VideoDecodedSignalQcAudioWindow[];
  /** A bounded, user-visible reason when the runtime could not decode this source. */
  unavailableReason?: string;
  /** A bounded reason for a video-frame decoder failure when PCM was still sampled. */
  frameUnavailableReason?: string;
  /** A bounded reason for an audio/PCM decoder failure when frames were still sampled. */
  audioUnavailableReason?: string;
}

export interface VideoDecodedSignalQcNavigation {
  sourceId: string;
  timeMs?: number;
}

export interface VideoDecodedSignalQcIssue {
  id: string;
  code: VideoDecodedSignalQcIssueCode;
  severity: VideoDecodedSignalQcSeverity;
  title: string;
  detail: string;
  navigation: VideoDecodedSignalQcNavigation;
}

export interface VideoDecodedSignalQcSourceResult {
  sourceId: string;
  label: string;
  kind: 'video' | 'audio';
  /** `partial` is deliberately not treated as a fully analyzed source. */
  status: 'analyzed' | 'partial' | 'unavailable';
  durationMs?: number;
  decodedFrameSamples: number;
  decodedAudioWindows: number;
  message?: string;
}

export interface VideoDecodedSignalQcSummary {
  errors: number;
  warnings: number;
  info: number;
  blocking: boolean;
  analyzedSources: number;
  partialSources: number;
  unavailableSources: number;
}

export interface VideoDecodedSignalQcReport {
  version: 1;
  scope: 'decoded-sampled';
  disclaimer: string;
  compositionSignature?: string;
  createdAt: number;
  sourceResults: VideoDecodedSignalQcSourceResult[];
  issues: VideoDecodedSignalQcIssue[];
  summary: VideoDecodedSignalQcSummary;
  truncated: boolean;
}

export interface VideoDecodedSignalQcPolicy {
  blackLumaThreshold: number;
  freezeSignatureDelta: number;
  silenceRmsThreshold: number;
  clippingPeakThreshold: number;
  minimumBlackRunMs: number;
  minimumFreezeRunMs: number;
  minimumSilenceRunMs: number;
}

export interface VideoDecodedSignalQcInput {
  sources: readonly VideoDecodedSignalQcSourceInput[];
  compositionSignature?: string;
  createdAt?: number;
  policy?: Partial<VideoDecodedSignalQcPolicy>;
}

const DEFAULT_POLICY: VideoDecodedSignalQcPolicy = {
  blackLumaThreshold: 0.02,
  freezeSignatureDelta: 0.008,
  silenceRmsThreshold: 0.001,
  clippingPeakThreshold: 0.999,
  minimumBlackRunMs: 500,
  minimumFreezeRunMs: 1_000,
  minimumSilenceRunMs: 500,
};

export function analyzeVideoDecodedSignalQc(input: VideoDecodedSignalQcInput): VideoDecodedSignalQcReport {
  const policy = normalizePolicy(input.policy);
  const issues: VideoDecodedSignalQcIssue[] = [];
  const sourceResults: VideoDecodedSignalQcSourceResult[] = [];
  let sequence = 0;
  let truncated = input.sources.length > MAX_DECODED_SIGNAL_QC_SOURCES;
  const addIssue = (issue: Omit<VideoDecodedSignalQcIssue, 'id'>): void => {
    if (issues.length >= MAX_DECODED_SIGNAL_QC_ISSUES) {
      truncated = true;
      return;
    }
    sequence += 1;
    issues.push({ ...issue, id: `decoded-signal-qc-${String(sequence).padStart(5, '0')}` });
  };

  if (truncated) {
    addIssue({
      code: 'input-truncated',
      severity: 'error',
      title: 'Decoded-signal input was truncated',
      detail: `Only the first ${MAX_DECODED_SIGNAL_QC_SOURCES} media sources can be sampled in one run.`,
      navigation: { sourceId: normalizedId(input.sources[0]?.id, 'source-1') },
    });
  }

  const seen = new Set<string>();
  for (const [index, rawSource] of input.sources.slice(0, MAX_DECODED_SIGNAL_QC_SOURCES).entries()) {
    const sourceId = uniqueId(normalizedId(rawSource.id, `source-${index + 1}`), seen);
    const label = normalizedText(rawSource.label, 128) || sourceId;
    const frameSamples = boundedFrames(rawSource.frameSamples, () => { truncated = true; });
    const audioWindows = boundedAudioWindows(rawSource.audioWindows, () => { truncated = true; });
    const unavailableReason = normalizedText(rawSource.unavailableReason, 512);
    const frameUnavailableReason = rawSource.kind === 'video'
      ? normalizedText(rawSource.frameUnavailableReason, 512) || (frameSamples.length === 0 ? 'No decoded video frame sample was available.' : '')
      : '';
    const audioUnavailableReason = normalizedText(rawSource.audioUnavailableReason, 512)
      || (audioWindows.length === 0 ? 'No decoded PCM window was available.' : '');
    const hasDecodedSignal = frameSamples.length > 0 || audioWindows.length > 0;
    const durationMs = optionalDuration(rawSource.durationMs);
    const partialReasons = [
      frameUnavailableReason ? `Video frames unavailable: ${frameUnavailableReason}` : '',
      audioUnavailableReason ? `PCM audio unavailable: ${audioUnavailableReason}` : '',
    ].filter(Boolean);
    const status = unavailableReason || !hasDecodedSignal
      ? 'unavailable'
      : partialReasons.length > 0 ? 'partial' : 'analyzed';
    const message = unavailableReason
      || (status === 'partial' ? partialReasons.join(' ').slice(0, 512) : undefined)
      || (!hasDecodedSignal ? 'The source did not yield a decoded frame or PCM window.' : undefined);

    sourceResults.push({
      sourceId,
      label,
      kind: rawSource.kind === 'audio' ? 'audio' : 'video',
      status,
      durationMs,
      decodedFrameSamples: frameSamples.length,
      decodedAudioWindows: audioWindows.length,
      message,
    });

    if (status !== 'analyzed') {
      addIssue({
        code: 'source-unavailable',
        severity: 'error',
        title: status === 'partial' ? 'Source was only partially decoded for QC' : 'Source could not be decoded for QC',
        detail: `${label}: ${message ?? 'The source did not yield a decoded frame or PCM window.'}`,
        navigation: { sourceId },
      });
    }

    if (frameSamples.length > 0) addFrameRuns(sourceId, label, frameSamples, policy, addIssue);
    if (audioWindows.length > 0) addAudioRuns(sourceId, label, audioWindows, policy, addIssue);
  }

  const summary = summarize(issues, sourceResults);
  return {
    version: 1,
    scope: 'decoded-sampled',
    disclaimer: VIDEO_DECODED_SIGNAL_QC_DISCLAIMER,
    compositionSignature: normalizedText(input.compositionSignature, 512) || undefined,
    createdAt: finiteInteger(input.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    sourceResults,
    issues,
    summary,
    truncated,
  };
}

/** Produces a compact luma signature from a decoded ImageData pixel buffer. */
export function summarizeDecodedVideoFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Pick<VideoDecodedSignalQcFrameSample, 'luma' | 'signature'> {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const gridSize = 8;
  const signature = Array.from({ length: gridSize * gridSize }, () => 0);
  const weights = Array.from({ length: gridSize * gridSize }, () => 0);
  let total = 0;
  let samples = 0;
  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const offset = (y * safeWidth + x) * 4;
      if (offset + 2 >= pixels.length) continue;
      const luma = (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255;
      total += luma;
      samples += 1;
      const cellX = Math.min(gridSize - 1, Math.floor(x * gridSize / safeWidth));
      const cellY = Math.min(gridSize - 1, Math.floor(y * gridSize / safeHeight));
      const cell = cellY * gridSize + cellX;
      signature[cell] += luma;
      weights[cell] += 1;
    }
  }
  return {
    luma: samples > 0 ? total / samples : 0,
    signature: signature.map((value, index) => weights[index] ? value / weights[index] : 0),
  };
}

export function sanitizeVideoDecodedSignalQcReport(value: unknown): VideoDecodedSignalQcReport | undefined {
  if (!isRecord(value) || value.scope !== 'decoded-sampled') return undefined;
  const sourceResults = Array.isArray(value.sourceResults)
    ? value.sourceResults.slice(0, MAX_DECODED_SIGNAL_QC_SOURCES).flatMap((source) => sanitizeSourceResult(source))
    : [];
  const sourceIds = new Set(sourceResults.map((source) => source.sourceId));
  const issues = Array.isArray(value.issues)
    ? value.issues.slice(0, MAX_DECODED_SIGNAL_QC_ISSUES).flatMap((issue, index) => sanitizeIssue(issue, index, sourceIds))
    : [];
  if (sourceResults.length === 0) return undefined;
  return {
    version: 1,
    scope: 'decoded-sampled',
    disclaimer: VIDEO_DECODED_SIGNAL_QC_DISCLAIMER,
    compositionSignature: normalizedText(value.compositionSignature, 512) || undefined,
    createdAt: finiteInteger(value.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
    sourceResults,
    issues,
    summary: summarize(issues, sourceResults),
    truncated: value.truncated === true,
  };
}

function addFrameRuns(
  sourceId: string,
  label: string,
  samples: readonly VideoDecodedSignalQcFrameSample[],
  policy: VideoDecodedSignalQcPolicy,
  addIssue: (issue: Omit<VideoDecodedSignalQcIssue, 'id'>) => void,
): void {
  for (const run of findRuns(samples, (sample) => sample.luma <= policy.blackLumaThreshold, policy.minimumBlackRunMs)) {
    addIssue({
      code: 'black-frame-run', severity: 'warning', title: 'Black decoded-frame interval',
      detail: `${label} sampled near-black frames from ${formatMs(run.startMs)} to ${formatMs(run.endMs)}.`,
      navigation: { sourceId, timeMs: run.startMs },
    });
  }
  let prior: VideoDecodedSignalQcFrameSample | undefined;
  const freezeCandidates = samples.map((sample) => {
    const frozen = prior !== undefined && signatureDistance(prior.signature, sample.signature) <= policy.freezeSignatureDelta;
    prior = sample;
    return { ...sample, frozen };
  });
  for (const run of findRuns(freezeCandidates, (sample) => sample.frozen, policy.minimumFreezeRunMs)) {
    addIssue({
      code: 'frozen-frame-run', severity: 'warning', title: 'Frozen decoded-frame interval',
      detail: `${label} sampled materially unchanged frames from ${formatMs(run.startMs)} to ${formatMs(run.endMs)}.`,
      navigation: { sourceId, timeMs: run.startMs },
    });
  }
}

function addAudioRuns(
  sourceId: string,
  label: string,
  windows: readonly VideoDecodedSignalQcAudioWindow[],
  policy: VideoDecodedSignalQcPolicy,
  addIssue: (issue: Omit<VideoDecodedSignalQcIssue, 'id'>) => void,
): void {
  for (const run of findRuns(windows, (window) => window.rms <= policy.silenceRmsThreshold, policy.minimumSilenceRunMs, (window) => window.endMs)) {
    addIssue({
      code: 'silent-audio-run', severity: 'warning', title: 'Silent decoded-audio interval',
      detail: `${label} sampled near-silent PCM from ${formatMs(run.startMs)} to ${formatMs(run.endMs)}.`,
      navigation: { sourceId, timeMs: run.startMs },
    });
  }
  for (const window of windows) {
    if (window.peak < policy.clippingPeakThreshold) continue;
    addIssue({
      code: 'audio-clipping', severity: 'error', title: 'Clipped decoded-audio window',
      detail: `${label} reached a sampled PCM peak of ${(window.peak * 100).toFixed(1)}% near ${formatMs(window.startMs)}.`,
      navigation: { sourceId, timeMs: window.startMs },
    });
  }
}

function findRuns<T extends { timeMs?: number; startMs?: number }>(
  samples: readonly T[],
  matches: (sample: T) => boolean,
  minimumDurationMs: number,
  endAt: (sample: T) => number = (sample) => sample.timeMs ?? sample.startMs ?? 0,
): Array<{ startMs: number; endMs: number }> {
  const runs: Array<{ startMs: number; endMs: number }> = [];
  let start: number | undefined;
  let end = 0;
  for (const sample of samples) {
    const at = finiteInteger(sample.timeMs ?? sample.startMs, 0, 0, Number.MAX_SAFE_INTEGER);
    if (matches(sample)) {
      if (start === undefined) start = at;
      end = Math.max(at, finiteInteger(endAt(sample), at, at, Number.MAX_SAFE_INTEGER));
      continue;
    }
    if (start !== undefined && end - start >= minimumDurationMs) runs.push({ startMs: start, endMs: end });
    start = undefined;
  }
  if (start !== undefined && end - start >= minimumDurationMs) runs.push({ startMs: start, endMs: end });
  return runs;
}

function boundedFrames(value: readonly VideoDecodedSignalQcFrameSample[] | undefined, onTruncate: () => void): VideoDecodedSignalQcFrameSample[] {
  if (!value) return [];
  if (value.length > MAX_DECODED_SIGNAL_QC_VIDEO_SAMPLES) onTruncate();
  return value.slice(0, MAX_DECODED_SIGNAL_QC_VIDEO_SAMPLES)
    .flatMap((sample) => Number.isFinite(sample?.timeMs) && Number.isFinite(sample?.luma)
      ? [{ timeMs: finiteInteger(sample.timeMs, 0, 0, Number.MAX_SAFE_INTEGER), luma: clamp(sample.luma, 0, 1), signature: boundedSignature(sample.signature) }]
      : [])
    .sort((left, right) => left.timeMs - right.timeMs);
}

function boundedAudioWindows(value: readonly VideoDecodedSignalQcAudioWindow[] | undefined, onTruncate: () => void): VideoDecodedSignalQcAudioWindow[] {
  if (!value) return [];
  if (value.length > MAX_DECODED_SIGNAL_QC_AUDIO_WINDOWS) onTruncate();
  return value.slice(0, MAX_DECODED_SIGNAL_QC_AUDIO_WINDOWS)
    .flatMap((window) => Number.isFinite(window?.startMs) && Number.isFinite(window?.endMs)
      ? [{
          startMs: finiteInteger(window.startMs, 0, 0, Number.MAX_SAFE_INTEGER),
          endMs: finiteInteger(window.endMs, 0, 0, Number.MAX_SAFE_INTEGER),
          rms: clamp(window.rms, 0, 1), peak: clamp(window.peak, 0, 1),
        }]
      : [])
    .filter((window) => window.endMs >= window.startMs)
    .sort((left, right) => left.startMs - right.startMs);
}

function boundedSignature(value: readonly number[] | undefined): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.slice(0, 64).map((entry) => clamp(entry, 0, 1));
}

function signatureDistance(left: readonly number[] | undefined, right: readonly number[] | undefined): number {
  if (!left || !right || left.length === 0 || right.length === 0) return Number.POSITIVE_INFINITY;
  const length = Math.min(left.length, right.length, 64);
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += Math.abs(left[index] - right[index]);
  return sum / length;
}

function summarize(issues: readonly VideoDecodedSignalQcIssue[], sources: readonly VideoDecodedSignalQcSourceResult[]): VideoDecodedSignalQcSummary {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const info = issues.filter((issue) => issue.severity === 'info').length;
  return {
    errors, warnings, info, blocking: errors > 0,
    analyzedSources: sources.filter((source) => source.status === 'analyzed').length,
    partialSources: sources.filter((source) => source.status === 'partial').length,
    unavailableSources: sources.filter((source) => source.status === 'unavailable').length,
  };
}

function normalizePolicy(value: Partial<VideoDecodedSignalQcPolicy> | undefined): VideoDecodedSignalQcPolicy {
  return {
    blackLumaThreshold: clamp(value?.blackLumaThreshold ?? DEFAULT_POLICY.blackLumaThreshold, 0, 0.25),
    freezeSignatureDelta: clamp(value?.freezeSignatureDelta ?? DEFAULT_POLICY.freezeSignatureDelta, 0, 1),
    silenceRmsThreshold: clamp(value?.silenceRmsThreshold ?? DEFAULT_POLICY.silenceRmsThreshold, 0, 0.25),
    clippingPeakThreshold: clamp(value?.clippingPeakThreshold ?? DEFAULT_POLICY.clippingPeakThreshold, 0.5, 1),
    minimumBlackRunMs: finiteInteger(value?.minimumBlackRunMs, DEFAULT_POLICY.minimumBlackRunMs, 0, 60_000),
    minimumFreezeRunMs: finiteInteger(value?.minimumFreezeRunMs, DEFAULT_POLICY.minimumFreezeRunMs, 0, 60_000),
    minimumSilenceRunMs: finiteInteger(value?.minimumSilenceRunMs, DEFAULT_POLICY.minimumSilenceRunMs, 0, 60_000),
  };
}

function sanitizeSourceResult(value: unknown): VideoDecodedSignalQcSourceResult[] {
  if (!isRecord(value)) return [];
  const sourceId = normalizedText(value.sourceId, 128);
  if (!sourceId) return [];
  const kind = value.kind === 'audio' ? 'audio' : 'video';
  const decodedFrameSamples = finiteInteger(value.decodedFrameSamples, 0, 0, MAX_DECODED_SIGNAL_QC_VIDEO_SAMPLES);
  const decodedAudioWindows = finiteInteger(value.decodedAudioWindows, 0, 0, MAX_DECODED_SIGNAL_QC_AUDIO_WINDOWS);
  const hasDecodedSignal = decodedFrameSamples > 0 || decodedAudioWindows > 0;
  const hasMissingRequiredSide = (kind === 'video' && decodedFrameSamples === 0) || decodedAudioWindows === 0;
  const status = value.status === 'unavailable' || !hasDecodedSignal
    ? 'unavailable'
    : value.status === 'partial' || hasMissingRequiredSide ? 'partial' : 'analyzed';
  const storedMessage = normalizedText(value.message, 512);
  return [{
    sourceId,
    label: normalizedText(value.label, 128) || sourceId,
    kind,
    status,
    durationMs: optionalDuration(value.durationMs),
    decodedFrameSamples,
    decodedAudioWindows,
    message: storedMessage || (status === 'partial'
      ? 'Only one applicable decoded-signal side was retained.'
      : status === 'unavailable' ? 'The source did not yield a decoded frame or PCM window.' : undefined),
  }];
}

function sanitizeIssue(value: unknown, index: number, sourceIds: ReadonlySet<string>): VideoDecodedSignalQcIssue[] {
  if (!isRecord(value) || !isRecord(value.navigation)) return [];
  const sourceId = normalizedText(value.navigation.sourceId, 128);
  const allowedCodes: VideoDecodedSignalQcIssueCode[] = ['source-unavailable', 'input-truncated', 'black-frame-run', 'frozen-frame-run', 'silent-audio-run', 'audio-clipping'];
  if (!sourceId || !sourceIds.has(sourceId) || !allowedCodes.includes(value.code as VideoDecodedSignalQcIssueCode)) return [];
  return [{
    id: normalizedText(value.id, 128) || `decoded-signal-qc-${String(index + 1).padStart(5, '0')}`,
    code: value.code as VideoDecodedSignalQcIssueCode,
    severity: value.severity === 'warning' || value.severity === 'info' ? value.severity : 'error',
    title: normalizedText(value.title, 256) || 'Decoded-signal QC finding',
    detail: normalizedText(value.detail, 1_000) || 'A sampled decoded-signal finding was retained.',
    navigation: { sourceId, timeMs: optionalDuration(value.navigation.timeMs) },
  }];
}

function uniqueId(value: string, seen: Set<string>): string {
  let candidate = value;
  let suffix = 2;
  while (seen.has(candidate)) candidate = `${value}-${suffix++}`;
  seen.add(candidate);
  return candidate;
}

function normalizedId(value: unknown, fallback: string): string {
  return normalizedText(value, 128) || fallback;
}

function normalizedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function optionalDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? finiteInteger(value, 0, 0, Number.MAX_SAFE_INTEGER)
    : undefined;
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

function clamp(value: unknown, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

function formatMs(value: number): string {
  return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 2)}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
