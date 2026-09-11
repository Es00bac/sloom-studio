import type { EditorAudioProcessingSettings } from '../types/flow';
import type { ResolvedEditorAudioSourceRange } from './editorAudioSourceRange';
import {
  dbToLinear,
  normalizeEditorAudioProcessingSettings,
} from './editorAudioProcessing';

const MAX_AUDITION_SOURCE_BYTES = 96 * 1024 * 1024;
const MAX_AUDITION_SECONDS = 10 * 60;
const MAX_PLAYBACK_WINDOW_SECONDS = 30;
const GATE_FRAME_SECONDS = 0.02;
const SWITCH_RAMP_SECONDS = 0.008;

export type DialogueAuditionSide = 'original-dry' | 'clean-dry' | 'clean-processed';

export interface DialogueAuditionSummary {
  originalRmsDbfs: number;
  cleanInputRmsDbfs: number;
  cleanDryRmsDbfs: number;
  cleanOutputRmsDbfs: number;
  cleanOutputSamplePeakDbfs: number;
  durationSeconds: number;
}

export interface DialogueAuditionSession {
  readonly summary: DialogueAuditionSummary;
  getSide(): DialogueAuditionSide;
  setSide(side: DialogueAuditionSide): void;
  stop(): void;
}

export async function startDialogueAudioAudition({
  originalUrl,
  cleanUrl,
  originalRange,
  cleanRange,
  cleanMatchGainDb = 0,
  calibrateCleanWithMatch = true,
  processing,
  initialSide = 'clean-dry',
  focusOffsetSeconds = 0,
  onEnded,
  signal,
}: {
  originalUrl: string;
  cleanUrl: string;
  originalRange: ResolvedEditorAudioSourceRange;
  cleanRange: ResolvedEditorAudioSourceRange;
  cleanMatchGainDb?: number;
  calibrateCleanWithMatch?: boolean;
  processing?: EditorAudioProcessingSettings;
  initialSide?: DialogueAuditionSide;
  /** Timeline-local focus point; playback is capped to a 30-second common window around it. */
  focusOffsetSeconds?: number;
  onEnded?: () => void;
  signal?: AbortSignal;
}): Promise<DialogueAuditionSession> {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor || typeof OfflineAudioContext === 'undefined') {
    throw new Error('This browser does not provide the Web Audio features needed for A/B audition.');
  }
  const context = new AudioContextConstructor();
  try {
    // Called directly from the user's Play gesture, before fetch/decode loses activation.
    await context.resume();
    const [originalDecoded, cleanDecoded] = await Promise.all([
      fetchAndDecode(context, originalUrl, signal),
      fetchAndDecode(context, cleanUrl, signal),
    ]);
    throwIfAborted(signal);
    const original = copyAudioBufferRange(context, originalDecoded, originalRange);
    const clean = copyAudioBufferRange(context, cleanDecoded, cleanRange);
    const durationSeconds = Math.min(original.duration, clean.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('The Original and Clean source ranges do not contain overlapping audio.');
    }
    const originalCommonFull = truncateAudioBuffer(context, original, durationSeconds);
    const cleanCommonFull = truncateAudioBuffer(context, clean, durationSeconds);
    const { startSeconds: windowStartSeconds, durationSeconds: windowDurationSeconds } = resolveDialogueAuditionWindow(
      durationSeconds,
      focusOffsetSeconds,
    );
    const originalCommon = copyAudioBufferWindow(context, originalCommonFull, windowStartSeconds, windowDurationSeconds);
    const cleanCommon = copyAudioBufferWindow(context, cleanCommonFull, windowStartSeconds, windowDurationSeconds);
    const calibratedClean = applyStaticGainToBuffer(
      context,
      cleanCommon,
      calibrateCleanWithMatch ? Math.min(12, Math.max(-12, cleanMatchGainDb)) : 0,
    );
    const cleanProcessed = await renderCleanAuditionBuffer(
      calibratedClean,
      normalizeEditorAudioProcessingSettings(processing),
    );
    throwIfAborted(signal);
    const summary: DialogueAuditionSummary = {
      originalRmsDbfs: audioBufferRmsDbfs(originalCommon),
      cleanInputRmsDbfs: audioBufferRmsDbfs(cleanCommon),
      cleanDryRmsDbfs: audioBufferRmsDbfs(calibratedClean),
      cleanOutputRmsDbfs: audioBufferRmsDbfs(cleanProcessed),
      cleanOutputSamplePeakDbfs: audioBufferSamplePeakDbfs(cleanProcessed),
      durationSeconds: windowDurationSeconds,
    };

    const originalSource = context.createBufferSource();
    const cleanDrySource = context.createBufferSource();
    const cleanProcessedSource = context.createBufferSource();
    const originalGain = context.createGain();
    const cleanDryGain = context.createGain();
    const cleanProcessedGain = context.createGain();
    originalSource.buffer = originalCommon;
    cleanDrySource.buffer = calibratedClean;
    cleanProcessedSource.buffer = cleanProcessed;
    originalSource.connect(originalGain).connect(context.destination);
    cleanDrySource.connect(cleanDryGain).connect(context.destination);
    cleanProcessedSource.connect(cleanProcessedGain).connect(context.destination);
    const startAt = context.currentTime + 0.02;
    originalGain.gain.setValueAtTime(initialSide === 'original-dry' ? 1 : 0, context.currentTime);
    cleanDryGain.gain.setValueAtTime(initialSide === 'clean-dry' ? 1 : 0, context.currentTime);
    cleanProcessedGain.gain.setValueAtTime(initialSide === 'clean-processed' ? 1 : 0, context.currentTime);
    originalSource.start(startAt);
    cleanDrySource.start(startAt);
    cleanProcessedSource.start(startAt);

    let side = initialSide;
    let stopped = false;
    originalSource.onended = () => {
      if (!stopped) {
        stopped = true;
        void context.close();
        onEnded?.();
      }
    };

    return {
      summary,
      getSide: () => side,
      setSide: (nextSide) => {
        if (stopped || nextSide === side) return;
        side = nextSide;
        const now = context.currentTime;
        rampExclusiveGain(originalGain.gain, nextSide === 'original-dry' ? 1 : 0, now);
        rampExclusiveGain(cleanDryGain.gain, nextSide === 'clean-dry' ? 1 : 0, now);
        rampExclusiveGain(cleanProcessedGain.gain, nextSide === 'clean-processed' ? 1 : 0, now);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        originalSource.onended = null;
        try { originalSource.stop(); } catch { /* already ended */ }
        try { cleanDrySource.stop(); } catch { /* already ended */ }
        try { cleanProcessedSource.stop(); } catch { /* already ended */ }
        void context.close();
      },
    };
  } catch (error) {
    void context.close();
    throw error;
  }
}

export function resolveDialogueAuditionWindow(
  commonDurationSeconds: number,
  focusOffsetSeconds: number,
): { startSeconds: number; durationSeconds: number } {
  const durationSeconds = Math.max(0, Number.isFinite(commonDurationSeconds) ? commonDurationSeconds : 0);
  const focus = Math.max(0, Number.isFinite(focusOffsetSeconds) ? focusOffsetSeconds : 0);
  const windowDurationSeconds = Math.min(MAX_PLAYBACK_WINDOW_SECONDS, durationSeconds);
  return {
    startSeconds: Math.max(
      0,
      Math.min(
        Math.max(0, durationSeconds - windowDurationSeconds),
        focus - windowDurationSeconds / 2,
      ),
    ),
    durationSeconds: windowDurationSeconds,
  };
}

export function buildDialogueGateGainFrames(
  channels: readonly Float32Array[],
  sampleRate: number,
  settings: Pick<EditorAudioProcessingSettings, 'gateThresholdDbfs' | 'gateRangeDb' | 'gateRatio' | 'gateAttackMs' | 'gateReleaseMs'>,
): number[] {
  if (channels.length === 0 || sampleRate <= 0) return [];
  const frameSamples = Math.max(1, Math.round(sampleRate * GATE_FRAME_SECONDS));
  const sampleLength = Math.min(...channels.map((channel) => channel.length));
  const frameCount = Math.ceil(sampleLength / frameSamples);
  let previousGain = 1;
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const start = frameIndex * frameSamples;
    const end = Math.min(sampleLength, start + frameSamples);
    let linkedEnergy = 0;
    for (const channel of channels) {
      let energy = 0;
      for (let index = start; index < end; index += 1) energy += (channel[index] ?? 0) ** 2;
      linkedEnergy = Math.max(linkedEnergy, energy / Math.max(1, end - start));
    }
    const levelDb = linkedEnergy > 0 ? 10 * Math.log10(linkedEnergy) : -120;
    const reductionDb = levelDb >= settings.gateThresholdDbfs
      ? 0
      : Math.max(settings.gateRangeDb, (levelDb - settings.gateThresholdDbfs) * (settings.gateRatio - 1));
    const targetGain = dbToLinear(reductionDb);
    const timeConstantMs = targetGain > previousGain ? settings.gateAttackMs : settings.gateReleaseMs;
    const smoothing = 1 - Math.exp(-(GATE_FRAME_SECONDS * 1_000) / Math.max(0.1, timeConstantMs));
    previousGain += (targetGain - previousGain) * smoothing;
    return previousGain;
  });
}

async function renderCleanAuditionBuffer(
  input: AudioBuffer,
  settings: EditorAudioProcessingSettings,
): Promise<AudioBuffer> {
  if (!settings.processingEnabled) return input;
  const eqOutput = await renderOfflinePass(input, (context, source) => {
    let tail: AudioNode = source;
    if (settings.highPassEnabled) {
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = Math.min(settings.highPassHz, input.sampleRate / 2 - 1);
      filter.Q.value = 0.707107;
      tail.connect(filter);
      tail = filter;
    }
    if (settings.lowPassEnabled) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(settings.lowPassHz, input.sampleRate / 2 - 1);
      filter.Q.value = 0.707107;
      tail.connect(filter);
      tail = filter;
    }
    return tail;
  });

  const dynamicsOutput = await renderOfflinePass(eqOutput, (context, source) => {
    let tail: AudioNode = source;
    if (settings.gateEnabled) {
      const gate = context.createGain();
      const frames = buildDialogueGateGainFrames(
        Array.from({ length: eqOutput.numberOfChannels }, (_, index) => eqOutput.getChannelData(index)),
        eqOutput.sampleRate,
        settings,
      );
      frames.forEach((gain, index) => gate.gain.linearRampToValueAtTime(gain, index * GATE_FRAME_SECONDS));
      tail.connect(gate);
      tail = gate;
    }
    if (settings.compressorEnabled) {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = settings.compressorThresholdDbfs;
      compressor.knee.value = 6;
      compressor.ratio.value = settings.compressorRatio;
      compressor.attack.value = settings.compressorAttackMs / 1_000;
      compressor.release.value = settings.compressorReleaseMs / 1_000;
      tail.connect(compressor);
      tail = compressor;
      if (settings.compressorMakeupGainDb > 0) {
        const makeup = context.createGain();
        makeup.gain.value = dbToLinear(settings.compressorMakeupGainDb);
        tail.connect(makeup);
        tail = makeup;
      }
    }
    if (settings.limiterEnabled) {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = settings.limiterCeilingDbfs;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.005;
      limiter.release.value = settings.limiterReleaseMs / 1_000;
      tail.connect(limiter);
      tail = limiter;
    }
    return tail;
  });

  if (settings.limiterEnabled) {
    const ceiling = dbToLinear(settings.limiterCeilingDbfs);
    for (let channelIndex = 0; channelIndex < dynamicsOutput.numberOfChannels; channelIndex += 1) {
      const channel = dynamicsOutput.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
        channel[sampleIndex] = Math.min(ceiling, Math.max(-ceiling, channel[sampleIndex]));
      }
    }
  }
  return dynamicsOutput;
}

async function renderOfflinePass(
  input: AudioBuffer,
  connect: (context: OfflineAudioContext, source: AudioBufferSourceNode) => AudioNode,
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate);
  const source = context.createBufferSource();
  source.buffer = input;
  const tail = connect(context, source);
  tail.connect(context.destination);
  source.start();
  return context.startRendering();
}

function copyAudioBufferRange(
  context: AudioContext,
  source: AudioBuffer,
  range: ResolvedEditorAudioSourceRange,
): AudioBuffer {
  const start = Math.max(0, Math.min(source.length, Math.round((range.sourceInMs / 1_000) * source.sampleRate)));
  const end = Math.max(start, Math.min(source.length, Math.round((range.sourceOutMs / 1_000) * source.sampleRate)));
  const output = context.createBuffer(source.numberOfChannels, end - start, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel).subarray(start, end), channel);
  }
  return output;
}

function truncateAudioBuffer(context: AudioContext, source: AudioBuffer, durationSeconds: number): AudioBuffer {
  const length = Math.min(source.length, Math.round(durationSeconds * source.sampleRate));
  const output = context.createBuffer(source.numberOfChannels, length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel).subarray(0, length), channel);
  }
  return output;
}

function copyAudioBufferWindow(
  context: AudioContext,
  source: AudioBuffer,
  startSeconds: number,
  durationSeconds: number,
): AudioBuffer {
  const start = Math.max(0, Math.min(source.length, Math.round(startSeconds * source.sampleRate)));
  const length = Math.max(1, Math.min(source.length - start, Math.round(durationSeconds * source.sampleRate)));
  const output = context.createBuffer(source.numberOfChannels, length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel).subarray(start, start + length), channel);
  }
  return output;
}

function applyStaticGainToBuffer(context: AudioContext, source: AudioBuffer, gainDb: number): AudioBuffer {
  const output = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  const gain = dbToLinear(gainDb);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const inputData = source.getChannelData(channel);
    const outputData = output.getChannelData(channel);
    for (let index = 0; index < inputData.length; index += 1) outputData[index] = inputData[index] * gain;
  }
  return output;
}

async function fetchAndDecode(context: AudioContext, url: string, signal?: AbortSignal): Promise<AudioBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load audition audio (HTTP ${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDITION_SOURCE_BYTES) {
    throw new Error('A/B audition is limited to 96 MB per source.');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_AUDITION_SOURCE_BYTES) throw new Error('A/B audition is limited to 96 MB per source.');
  const buffer = await context.decodeAudioData(bytes.slice(0));
  if (buffer.duration > MAX_AUDITION_SECONDS) throw new Error('A/B audition is limited to ten minutes per source.');
  return buffer;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The audition was cancelled.', 'AbortError');
}

function rampExclusiveGain(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + SWITCH_RAMP_SECONDS);
}

function audioBufferRmsDbfs(buffer: AudioBuffer): number {
  let energy = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (const sample of data) {
      energy += sample ** 2;
      count += 1;
    }
  }
  return energy > 0 && count > 0 ? 10 * Math.log10(energy / count) : Number.NEGATIVE_INFINITY;
}

function audioBufferSamplePeakDbfs(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
}

function getAudioContextConstructor(): (new () => AudioContext) | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}
