import type { ResolvedEditorAudioSourceRange } from './editorAudioSourceRange';

export const SPEECH_LEVEL_MATCH_METHOD = 'active-rms-v1';
export const SPEECH_LEVEL_MATCH_MAX_GAIN_DB = 12;
export const SPEECH_LEVEL_MATCH_SAMPLE_PEAK_CEILING_DBFS = -3;
const MAX_AUDIO_ANALYSIS_BYTES = 96 * 1024 * 1024;
const MAX_AUDIO_ANALYSIS_SECONDS = 10 * 60;
const FRAME_SECONDS = 0.02;
const MIN_ACTIVE_SECONDS = 0.25;

export interface SpeechLevelAnalysisAudio {
  sampleRate: number;
  channels: readonly Float32Array[];
}

export interface SpeechLevelMatchMeasurement {
  method: typeof SPEECH_LEVEL_MATCH_METHOD;
  gainDb: number;
  originalActiveRmsDbfs: number;
  cleanActiveRmsDbfs: number;
  cleanSamplePeakDbfs: number;
  activeDurationSeconds: number;
  peakLimited: boolean;
}

export class SpeechLevelMatchError extends Error {
  public readonly code: 'decode-failed' | 'empty-range' | 'insufficient-speech' | 'source-too-large' | 'source-too-long';

  constructor(
    code:
      | 'decode-failed'
      | 'empty-range'
      | 'insufficient-speech'
      | 'source-too-large'
      | 'source-too-long',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'SpeechLevelMatchError';
  }
}

export function measureSpeechLevelMatch(
  original: SpeechLevelAnalysisAudio,
  clean: SpeechLevelAnalysisAudio,
): SpeechLevelMatchMeasurement {
  const commonDurationSeconds = Math.min(audioDurationSeconds(original), audioDurationSeconds(clean));
  if (!Number.isFinite(commonDurationSeconds) || commonDurationSeconds <= 0) {
    throw new SpeechLevelMatchError('empty-range', 'The selected source ranges do not contain audio.');
  }
  if (commonDurationSeconds > MAX_AUDIO_ANALYSIS_SECONDS) {
    throw new SpeechLevelMatchError('source-too-long', 'Speech level matching is limited to 10 minutes per clip.');
  }

  const frameCount = Math.floor(commonDurationSeconds / FRAME_SECONDS);
  const cleanFrameEnergy = buildFrameEnergy(clean, frameCount);
  const originalFrameEnergy = buildFrameEnergy(original, frameCount);
  const finiteCleanDb = cleanFrameEnergy
    .map(energyToDb)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finiteCleanDb.length === 0) {
    throw new SpeechLevelMatchError('insufficient-speech', 'The cleaned range is silent.');
  }

  const upperSpeechDb = percentile(finiteCleanDb, 0.9);
  const gateDb = Math.max(-55, upperSpeechDb - 25);
  const activeIndexes = cleanFrameEnergy.flatMap((energy, index) => (
    energyToDb(energy) >= gateDb ? [index] : []
  ));
  const activeDurationSeconds = activeIndexes.length * FRAME_SECONDS;
  if (activeDurationSeconds < MIN_ACTIVE_SECONDS) {
    throw new SpeechLevelMatchError(
      'insufficient-speech',
      'The cleaned range needs at least 250 ms of active speech for an automatic match.',
    );
  }

  const originalEnergy = average(activeIndexes.map((index) => originalFrameEnergy[index] ?? 0));
  const cleanEnergy = average(activeIndexes.map((index) => cleanFrameEnergy[index] ?? 0));
  if (originalEnergy <= 0 || cleanEnergy <= 0) {
    throw new SpeechLevelMatchError('insufficient-speech', 'The selected ranges do not contain enough matching speech.');
  }

  const rawGainDb = 10 * Math.log10(originalEnergy / cleanEnergy);
  const cleanSamplePeak = samplePeak(clean, commonDurationSeconds);
  const cleanSamplePeakDbfs = amplitudeToDb(cleanSamplePeak);
  const peakAllowedGainDb = Number.isFinite(cleanSamplePeakDbfs)
    ? SPEECH_LEVEL_MATCH_SAMPLE_PEAK_CEILING_DBFS - cleanSamplePeakDbfs
    : SPEECH_LEVEL_MATCH_MAX_GAIN_DB;
  const boundedGainDb = clamp(rawGainDb, -SPEECH_LEVEL_MATCH_MAX_GAIN_DB, SPEECH_LEVEL_MATCH_MAX_GAIN_DB);
  const gainDb = clamp(
    Math.min(boundedGainDb, peakAllowedGainDb),
    -SPEECH_LEVEL_MATCH_MAX_GAIN_DB,
    SPEECH_LEVEL_MATCH_MAX_GAIN_DB,
  );

  return {
    method: SPEECH_LEVEL_MATCH_METHOD,
    gainDb,
    originalActiveRmsDbfs: energyToDb(originalEnergy),
    cleanActiveRmsDbfs: energyToDb(cleanEnergy),
    cleanSamplePeakDbfs,
    activeDurationSeconds,
    peakLimited: gainDb < boundedGainDb - 0.005,
  };
}

export async function measureSpeechLevelMatchFromUrls({
  originalUrl,
  cleanUrl,
  originalRange,
  cleanRange,
}: {
  originalUrl: string;
  cleanUrl: string;
  originalRange: ResolvedEditorAudioSourceRange;
  cleanRange: ResolvedEditorAudioSourceRange;
}): Promise<SpeechLevelMatchMeasurement> {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new SpeechLevelMatchError('decode-failed', 'This browser does not provide Web Audio decoding.');
  }
  const context = new AudioContextConstructor();
  try {
    const [originalBuffer, cleanBuffer] = await Promise.all([
      fetchAndDecode(context, originalUrl),
      fetchAndDecode(context, cleanUrl),
    ]);
    return measureSpeechLevelMatch(
      sliceAudioBuffer(originalBuffer, originalRange),
      sliceAudioBuffer(cleanBuffer, cleanRange),
    );
  } finally {
    void context.close();
  }
}

function sliceAudioBuffer(
  buffer: AudioBuffer,
  range: ResolvedEditorAudioSourceRange,
): SpeechLevelAnalysisAudio {
  const startFrame = clamp(Math.round((range.sourceInMs / 1_000) * buffer.sampleRate), 0, buffer.length);
  const endFrame = clamp(Math.round((range.sourceOutMs / 1_000) * buffer.sampleRate), startFrame, buffer.length);
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, channelIndex) =>
      buffer.getChannelData(channelIndex).slice(startFrame, endFrame)),
  };
}

async function fetchAndDecode(context: AudioContext, url: string): Promise<AudioBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new SpeechLevelMatchError('decode-failed', `Could not read the audio source: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new SpeechLevelMatchError('decode-failed', `Could not read the audio source (HTTP ${response.status}).`);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_ANALYSIS_BYTES) {
    throw new SpeechLevelMatchError('source-too-large', 'Speech level matching is limited to 96 MB per source.');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_AUDIO_ANALYSIS_BYTES) {
    throw new SpeechLevelMatchError('source-too-large', 'Speech level matching is limited to 96 MB per source.');
  }
  try {
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (buffer.duration > MAX_AUDIO_ANALYSIS_SECONDS) {
      throw new SpeechLevelMatchError('source-too-long', 'Speech level matching is limited to 10 minutes per clip.');
    }
    return buffer;
  } catch (error) {
    if (error instanceof SpeechLevelMatchError) throw error;
    throw new SpeechLevelMatchError('decode-failed', `The browser could not decode this audio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildFrameEnergy(audio: SpeechLevelAnalysisAudio, frameCount: number): number[] {
  const samplesPerFrame = Math.max(1, Math.round(audio.sampleRate * FRAME_SECONDS));
  const channelCount = Math.max(1, audio.channels.length);
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const start = frameIndex * samplesPerFrame;
    const end = Math.min(start + samplesPerFrame, ...audio.channels.map((channel) => channel.length));
    if (end <= start) return 0;
    let energySum = 0;
    for (const channel of audio.channels) {
      let channelEnergy = 0;
      for (let index = start; index < end; index += 1) {
        channelEnergy += (channel[index] ?? 0) ** 2;
      }
      energySum += channelEnergy / (end - start);
    }
    return energySum / channelCount;
  });
}

function samplePeak(audio: SpeechLevelAnalysisAudio, durationSeconds: number): number {
  let peak = 0;
  for (const channel of audio.channels) {
    const sampleCount = Math.min(channel.length, Math.round(durationSeconds * audio.sampleRate));
    for (let index = 0; index < sampleCount; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }
  return peak;
}

function audioDurationSeconds(audio: SpeechLevelAnalysisAudio): number {
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0 || audio.channels.length === 0) return 0;
  return Math.min(...audio.channels.map((channel) => channel.length)) / audio.sampleRate;
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(sortedValues: number[], position: number): number {
  if (sortedValues.length === 0) return Number.NEGATIVE_INFINITY;
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * position)))];
}

function energyToDb(energy: number): number {
  return energy > 0 ? 10 * Math.log10(energy) : Number.NEGATIVE_INFINITY;
}

function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
