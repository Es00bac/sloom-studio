import { describe, expect, it } from 'vitest';
import {
  MAX_PROFESSIONAL_TRACKS,
  sanitizeEditorAudioClipProfessionalState,
  sanitizeEditorProfessionalVideoState,
  sanitizeEditorVisualClipProfessionalState,
  sanitizeSourceBinProfessionalMediaState,
} from './videoProfessionalState';

describe('video professional project-state sanitizers', () => {
  it('keeps imported media separate from generated media and bounds transcript sidecars', () => {
    const imported = sanitizeSourceBinProfessionalMediaState({
      version: 99,
      origin: 'imported',
      onlineState: 'offline',
      proxy: { status: 'ready', scratchFileName: 'camera-a-proxy.mp4', progressPercent: 500 },
      logging: { scene: '12', status: 'approved' },
      transcript: { cues: [{ id: 'cue-1', startMs: 50, endMs: 10, text: 'Line one' }] },
    });
    const generated = sanitizeSourceBinProfessionalMediaState({
      version: 1,
      origin: 'generated',
      generatedBy: {
        provider: 'elevenlabs',
        operation: 'tts',
        modelId: 'eleven_multilingual_v2',
        apiKey: 'must-not-survive',
        generatedAt: 123,
        timing: { words: [{ text: 'Hello', startMs: 0, endMs: 400 }] },
      },
    });

    expect(imported?.origin).toBe('imported');
    expect(imported?.onlineState).toBe('offline');
    expect(imported?.proxy?.progressPercent).toBe(100);
    expect(imported?.logging).toMatchObject({ scene: '12', status: 'approved' });
    expect(imported?.transcript?.cues[0]).toMatchObject({ startMs: 50, endMs: 50 });
    expect(generated?.origin).toBe('generated');
    expect(generated?.generatedBy).toMatchObject({
      provider: 'elevenlabs',
      operation: 'tts',
      timing: { words: [{ text: 'Hello', startMs: 0, endMs: 400 }] },
    });
    expect(JSON.stringify(generated)).not.toContain('must-not-survive');
  });

  it('bounds long-form track state and provides a stable master bus fallback', () => {
    const tracks = Array.from({ length: 100 }, (_, index) => ({
      id: `v${index}`,
      name: `Video ${index}`,
      kind: 'video',
      order: index,
      enabled: true,
      locked: false,
    }));
    const state = sanitizeEditorProfessionalVideoState({ version: 1, tracks });

    expect(state?.tracks).toHaveLength(MAX_PROFESSIONAL_TRACKS);
    expect(state?.audioBuses).toEqual([expect.objectContaining({ id: 'master', kind: 'master' })]);
    expect(state?.workingColorSpace).toBe('rec709');
    expect(state?.loudnessNormalization).toMatchObject({ enabled: false, targetLufs: -14, truePeakCeilingDbtp: -1 });
  });

  it('persists loudness delivery intent while rejecting unsafe FFmpeg target ranges', () => {
    const state = sanitizeEditorProfessionalVideoState({
      version: 1,
      loudnessNormalization: {
        enabled: true,
        targetLufs: -120,
        loudnessRangeLu: 99,
        truePeakCeilingDbtp: -20,
      },
    });

    expect(state?.loudnessNormalization).toEqual({
      enabled: true,
      targetLufs: -70,
      loudnessRangeLu: 50,
      truePeakCeilingDbtp: -9,
    });
  });

  it('sanitizes clip retime, masks, linking, channel mapping, and mixer pan', () => {
    const visual = sanitizeEditorVisualClipProfessionalState({
      linkGroupId: 'linked-a-v',
      retime: [{ id: 'r1', timelineStartMs: 0, timelineEndMs: 1_000, speedPercent: 25_000, interpolation: 'optical-flow' }],
      masks: [{ id: 'm1', kind: 'bezier', points: [{ x: -1, y: 2 }], featherPercent: 180 }],
      stabilization: { enabled: true, strengthPercent: 120, cropMode: 'auto-scale' },
      parameterKeyframes: [{
        id: 'opacity-track',
        parameter: 'opacityPercent',
        keyframes: [{ id: 'key-1', timeMs: 500, value: 50, interpolation: 'bezier', bezier: { outX: -1, outY: 0.2, inX: 3, inY: 0.8 } }],
      }],
    });
    const audio = sanitizeEditorAudioClipProfessionalState({
      linkGroupId: 'linked-a-v',
      pan: -5,
      channelMap: [0, 1, -2, 100],
    });

    expect(visual?.retime?.[0].speedPercent).toBe(10_000);
    expect(visual?.masks?.[0]).toMatchObject({ featherPercent: 100, points: [{ x: 0, y: 1 }] });
    expect(visual?.stabilization?.strengthPercent).toBe(100);
    expect(sanitizeEditorVisualClipProfessionalState({ stabilization: {
      enabled: true, strengthPercent: 50, cropMode: 'auto-scale',
      analysis: { version: 1, status: 'ready', samples: [{ timeMs: 0, offsetX: 0.1, offsetY: -0.1, scale: 1.1 }] },
    } })?.stabilization?.analysis?.samples[0]).toEqual({ timeMs: 0, offsetX: 0.1, offsetY: -0.1, scale: 1.1 });
    expect(visual?.parameterKeyframes?.[0]?.keyframes[0]).toMatchObject({
      timeMs: 500,
      interpolation: 'bezier',
      bezier: { outX: 0, inX: 1 },
    });
    expect(audio).toMatchObject({ linkGroupId: 'linked-a-v', pan: -1, channelMap: [0, 1, 0, 31] });
  });

  it('rejects malformed unversioned professional media records', () => {
    expect(sanitizeSourceBinProfessionalMediaState({ origin: 'mystery' })).toBeUndefined();
    expect(sanitizeEditorProfessionalVideoState(null)).toBeUndefined();
  });

  it('retains only finite bounded multicam cuts across save/reopen state sanitization', () => {
    const state = sanitizeEditorProfessionalVideoState({
      multicamSources: [{
        id: 'multi', name: 'Multi', angleSourceIds: ['camera-a', 'camera-b'], syncMethod: 'audio', audioFollowsVideo: true,
        cuts: [{ id: 'opening', timelineMs: 0, angleSourceId: 'camera-a' }, { id: 'bad', timelineMs: Number.NaN, angleSourceId: 'camera-b' }],
      }],
    });
    expect(state?.multicamSources[0]?.cuts).toEqual([{ id: 'opening', timelineMs: 0, angleSourceId: 'camera-a' }]);
  });

  it('preserves bounded Sloom handoff history across project sanitization', () => {
    const state = sanitizeEditorProfessionalVideoState({
      version: 1,
      interchangeHistory: [{
        id: 'aaf-handoff',
        format: 'aaf-handoff',
        direction: 'import',
        createdAt: 123,
        warnings: ['This manifest is not an AAF binary.'],
      }],
    });

    expect(state?.interchangeHistory).toEqual([expect.objectContaining({
      id: 'aaf-handoff',
      format: 'aaf-handoff',
      direction: 'import',
    })]);
  });

  it('retains bounded nested child timelines for Runtime IR normalization after save/reopen', () => {
    const state = sanitizeEditorProfessionalVideoState({
      version: 1,
      sequences: [{
        id: 'nested-a',
        name: 'Nested A',
        durationMs: 4_000,
        frameRate: 24,
        visualClips: [{ id: 'child-a', sourceNodeId: 'image-node', sourceKind: 'image', startMs: 0 }],
      }],
    });

    expect(state?.sequences[0]?.visualClips).toEqual([
      expect.objectContaining({ id: 'child-a', sourceNodeId: 'image-node' }),
    ]);
  });
});
