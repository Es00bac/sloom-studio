import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_AUDIO_DUCKING,
  buildEditorAudioDuckingGraph,
  buildEditorAudioDuckingFilter,
  hasEnabledEditorAudioDucking,
  normalizeEditorAudioDuckingSettings,
  resolveEditorAudioDuckingControl,
} from './editorAudioDucking';

describe('editor audio ducking', () => {
  it('normalizes hostile persisted values into a bounded deterministic contract', () => {
    expect(normalizeEditorAudioDuckingSettings({
      enabled: true,
      controlClipId: '  dialogue  ',
      depthPercent: 500,
      thresholdDbfs: -100,
      attackMs: 0,
      releaseMs: 50_000,
    })).toEqual({
      enabled: true,
      controlClipId: 'dialogue',
      depthPercent: 100,
      thresholdDbfs: -60,
      attackMs: 1,
      releaseMs: 2_000,
    });
    expect(hasEnabledEditorAudioDucking(DEFAULT_EDITOR_AUDIO_DUCKING)).toBe(false);
  });

  it('builds a stable native side-chain filter with dB threshold conversion', () => {
    expect(buildEditorAudioDuckingFilter({
      ...DEFAULT_EDITOR_AUDIO_DUCKING,
      enabled: true,
      thresholdDbfs: -30,
      depthPercent: 60,
      attackMs: 10,
      releaseMs: 250,
    })).toBe('sidechaincompress=mode=downward:threshold=0.031623:ratio=20:attack=10:release=250:knee=1.995262:detection=rms:link=maximum:level_sc=1:mix=0.600');
  });

  it('splits and pads shared control legs so the emitted graph is valid and duration-stable', () => {
    const graph = buildEditorAudioDuckingGraph([
      { label: 'a0', id: 'dialogue' },
      {
        label: 'a1',
        id: 'music',
        audioDucking: { ...DEFAULT_EDITOR_AUDIO_DUCKING, enabled: true, controlClipId: 'dialogue' },
      },
      {
        label: 'a2',
        id: 'effects',
        audioDucking: { ...DEFAULT_EDITOR_AUDIO_DUCKING, enabled: true, controlClipId: 'dialogue' },
      },
    ], 6);

    expect(graph.filterParts).toContain('[a0]asplit=2[a0main][a0control]');
    expect(graph.filterParts).toContain('[a0control]apad=whole_dur=6.000[a0pad]');
    expect(graph.filterParts).toContain('[a0pad]asplit=2[a0pad0][a0pad1]');
    expect(graph.filterParts.join(';')).toContain('[a1][a0pad0]sidechaincompress=');
    expect(graph.filterParts.join(';')).toContain('[a2][a0pad1]sidechaincompress=');
    expect(graph.audioLabels).toEqual(['[a0main]', '[a1duck]', '[a2duck]']);
  });

  it('refuses missing, disabled, and self controls before graph execution', () => {
    const settings = { ...DEFAULT_EDITOR_AUDIO_DUCKING, enabled: true, controlClipId: 'dialogue' };
    expect(resolveEditorAudioDuckingControl(settings, 'music', new Set(['dialogue']))).toEqual({ ok: true, controlClipId: 'dialogue' });
    expect(resolveEditorAudioDuckingControl(settings, 'music', new Set())).toMatchObject({ ok: false });
    expect(resolveEditorAudioDuckingControl({ ...settings, controlClipId: 'music' }, 'music', new Set(['music']))).toMatchObject({ ok: false });
    expect(resolveEditorAudioDuckingControl({ ...settings, controlClipId: 'disabled' }, 'music', new Set(['music']))).toMatchObject({ ok: false });
  });
});
