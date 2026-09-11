import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_AUDIO_PROCESSING,
  RECOMMENDED_DIALOGUE_AUDIO_PROCESSING,
  buildEditorAudioPostMixFilters,
  buildEditorAudioPreMixFilters,
  hasEnabledEditorAudioProcessing,
  normalizeEditorAudioProcessingSettings,
} from './editorAudioProcessing';

describe('editor audio processing', () => {
  it('defaults every processor to bypass and clamps unsafe saved values', () => {
    expect(hasEnabledEditorAudioProcessing(undefined)).toBe(false);
    expect(normalizeEditorAudioProcessingSettings({
      highPassEnabled: true,
      highPassHz: 900,
      lowPassHz: 50,
      gateThresholdDbfs: -100,
      compressorRatio: 40,
      limiterCeilingDbfs: 0,
    })).toMatchObject({
      highPassEnabled: true,
      highPassHz: 400,
      lowPassHz: 1_000,
      gateThresholdDbfs: -70,
      compressorRatio: 20,
      limiterCeilingDbfs: -0.1,
    });
  });

  it('maps the recommended dialogue chain to deterministic FFmpeg filters', () => {
    expect(buildEditorAudioPreMixFilters(RECOMMENDED_DIALOGUE_AUDIO_PROCESSING)).toEqual([
      'highpass=f=80:t=q:w=0.707107:p=2',
      'acompressor=mode=downward:threshold=0.125893:ratio=3:attack=10:release=120:makeup=1.000000:knee=1.995262:detection=rms:link=maximum:mix=1',
    ]);
    expect(buildEditorAudioPostMixFilters(RECOMMENDED_DIALOGUE_AUDIO_PROCESSING)).toEqual([
      'alimiter=limit=0.891251:attack=5:release=50:level=false:latency=true',
    ]);
  });

  it('keeps the gate explicitly opt-in with bounded range reduction', () => {
    const filters = buildEditorAudioPreMixFilters({
      ...DEFAULT_EDITOR_AUDIO_PROCESSING,
      gateEnabled: true,
    });
    expect(filters).toContain(
      'agate=mode=downward:threshold=0.005623:range=0.063096:ratio=3:attack=5:release=150:knee=1.995262:detection=rms:link=maximum',
    );
  });

  it('bypasses the entire DSP chain without erasing individual module choices', () => {
    const bypassed = { ...RECOMMENDED_DIALOGUE_AUDIO_PROCESSING, processingEnabled: false };
    expect(hasEnabledEditorAudioProcessing(bypassed)).toBe(false);
    expect(buildEditorAudioPreMixFilters(bypassed)).toEqual([]);
    expect(buildEditorAudioPostMixFilters(bypassed)).toEqual([]);
    expect(normalizeEditorAudioProcessingSettings(bypassed)).toMatchObject({
      processingEnabled: false,
      highPassEnabled: true,
      compressorEnabled: true,
      limiterEnabled: true,
    });
  });
});
