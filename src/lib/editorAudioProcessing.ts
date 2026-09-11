import type { EditorAudioProcessingSettings } from '../types/flow';

export const DEFAULT_EDITOR_AUDIO_PROCESSING: EditorAudioProcessingSettings = {
  processingEnabled: true,
  highPassEnabled: false,
  highPassHz: 80,
  lowPassEnabled: false,
  lowPassHz: 18_000,
  gateEnabled: false,
  gateThresholdDbfs: -45,
  gateRangeDb: -24,
  gateRatio: 3,
  gateAttackMs: 5,
  gateReleaseMs: 150,
  compressorEnabled: false,
  compressorThresholdDbfs: -18,
  compressorRatio: 3,
  compressorAttackMs: 10,
  compressorReleaseMs: 120,
  compressorMakeupGainDb: 0,
  limiterEnabled: false,
  limiterCeilingDbfs: -1,
  limiterReleaseMs: 50,
};

export const RECOMMENDED_DIALOGUE_AUDIO_PROCESSING: EditorAudioProcessingSettings = {
  ...DEFAULT_EDITOR_AUDIO_PROCESSING,
  highPassEnabled: true,
  compressorEnabled: true,
  limiterEnabled: true,
};

export function normalizeEditorAudioProcessingSettings(value: unknown): EditorAudioProcessingSettings {
  const input = isRecord(value) ? value : {};
  const highPassHz = boundedNumber(input.highPassHz, 20, 400, DEFAULT_EDITOR_AUDIO_PROCESSING.highPassHz);
  const lowPassHz = Math.max(
    highPassHz + 100,
    boundedNumber(input.lowPassHz, 1_000, 20_000, DEFAULT_EDITOR_AUDIO_PROCESSING.lowPassHz),
  );
  return {
    processingEnabled: input.processingEnabled !== false,
    highPassEnabled: input.highPassEnabled === true,
    highPassHz,
    lowPassEnabled: input.lowPassEnabled === true,
    lowPassHz,
    gateEnabled: input.gateEnabled === true,
    gateThresholdDbfs: boundedNumber(input.gateThresholdDbfs, -70, -10, DEFAULT_EDITOR_AUDIO_PROCESSING.gateThresholdDbfs),
    gateRangeDb: boundedNumber(input.gateRangeDb, -80, 0, DEFAULT_EDITOR_AUDIO_PROCESSING.gateRangeDb),
    gateRatio: boundedNumber(input.gateRatio, 1, 20, DEFAULT_EDITOR_AUDIO_PROCESSING.gateRatio),
    gateAttackMs: boundedNumber(input.gateAttackMs, 0.1, 200, DEFAULT_EDITOR_AUDIO_PROCESSING.gateAttackMs),
    gateReleaseMs: boundedNumber(input.gateReleaseMs, 10, 2_000, DEFAULT_EDITOR_AUDIO_PROCESSING.gateReleaseMs),
    compressorEnabled: input.compressorEnabled === true,
    compressorThresholdDbfs: boundedNumber(input.compressorThresholdDbfs, -50, 0, DEFAULT_EDITOR_AUDIO_PROCESSING.compressorThresholdDbfs),
    compressorRatio: boundedNumber(input.compressorRatio, 1, 20, DEFAULT_EDITOR_AUDIO_PROCESSING.compressorRatio),
    compressorAttackMs: boundedNumber(input.compressorAttackMs, 0.1, 200, DEFAULT_EDITOR_AUDIO_PROCESSING.compressorAttackMs),
    compressorReleaseMs: boundedNumber(input.compressorReleaseMs, 10, 2_000, DEFAULT_EDITOR_AUDIO_PROCESSING.compressorReleaseMs),
    compressorMakeupGainDb: boundedNumber(input.compressorMakeupGainDb, 0, 12, DEFAULT_EDITOR_AUDIO_PROCESSING.compressorMakeupGainDb),
    limiterEnabled: input.limiterEnabled === true,
    limiterCeilingDbfs: boundedNumber(input.limiterCeilingDbfs, -12, -0.1, DEFAULT_EDITOR_AUDIO_PROCESSING.limiterCeilingDbfs),
    limiterReleaseMs: boundedNumber(input.limiterReleaseMs, 10, 1_000, DEFAULT_EDITOR_AUDIO_PROCESSING.limiterReleaseMs),
  };
}

export function hasEnabledEditorAudioProcessing(value: unknown): boolean {
  const settings = normalizeEditorAudioProcessingSettings(value);
  return settings.processingEnabled && (settings.highPassEnabled
    || settings.lowPassEnabled
    || settings.gateEnabled
    || settings.compressorEnabled
    || settings.limiterEnabled);
}

/** Filters applied before the user's clip/keyframe/track volume and fades. */
export function buildEditorAudioPreMixFilters(value: unknown): string[] {
  const settings = normalizeEditorAudioProcessingSettings(value);
  if (!settings.processingEnabled) return [];
  return [
    ...(settings.highPassEnabled ? [`highpass=f=${formatNumber(settings.highPassHz)}:t=q:w=0.707107:p=2`] : []),
    ...(settings.lowPassEnabled ? [`lowpass=f=${formatNumber(settings.lowPassHz)}:t=q:w=0.707107:p=2`] : []),
    ...(settings.gateEnabled ? [
      `agate=mode=downward:threshold=${dbToLinear(settings.gateThresholdDbfs).toFixed(6)}`
        + `:range=${dbToLinear(settings.gateRangeDb).toFixed(6)}`
        + `:ratio=${formatNumber(settings.gateRatio)}`
        + `:attack=${formatNumber(settings.gateAttackMs)}`
        + `:release=${formatNumber(settings.gateReleaseMs)}`
        + `:knee=${dbToLinear(6).toFixed(6)}`
        + ':detection=rms:link=maximum',
    ] : []),
    ...(settings.compressorEnabled ? [
      `acompressor=mode=downward:threshold=${dbToLinear(settings.compressorThresholdDbfs).toFixed(6)}`
        + `:ratio=${formatNumber(settings.compressorRatio)}`
        + `:attack=${formatNumber(settings.compressorAttackMs)}`
        + `:release=${formatNumber(settings.compressorReleaseMs)}`
        + `:makeup=${dbToLinear(settings.compressorMakeupGainDb).toFixed(6)}`
        + `:knee=${dbToLinear(6).toFixed(6)}`
        + ':detection=rms:link=maximum:mix=1',
    ] : []),
  ];
}

/** Per-clip safety stage after creative volume, automation, and fades. */
export function buildEditorAudioPostMixFilters(value: unknown): string[] {
  const settings = normalizeEditorAudioProcessingSettings(value);
  if (!settings.processingEnabled) return [];
  return settings.limiterEnabled ? [
    `alimiter=limit=${dbToLinear(settings.limiterCeilingDbfs).toFixed(6)}`
      + ':attack=5'
      + `:release=${formatNumber(settings.limiterReleaseMs)}`
      + ':level=false:latency=true',
  ] : [];
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
