import { describe, expect, it } from 'vitest';
import { createEditorAudioClip, createEditorVisualClip } from '../../lib/manualEditorState';
import { buildAudioWaveformSignature, getProgramStageClips } from './ManualEditorWorkspaceUtils';

describe('getProgramStageClips', () => {
  it.each(['speech-bubble', 'thought-bubble', 'caption'] as const)(
    'keeps a %s comic visible throughout its resolved interval, including its end boundary',
    (comicKind) => {
      const clip = createEditorVisualClip(`comic-${comicKind}`, 'comic', {
        startMs: 2_000,
        durationSeconds: 4,
        comicKind,
      });
      const stageAt = (playheadSeconds: number) => getProgramStageClips(
        [clip],
        new Map(),
        new Map(),
        {},
        {},
        playheadSeconds,
      );

      expect(stageAt(1.999)).toEqual([]);
      expect(stageAt(2)).toHaveLength(1);
      expect(stageAt(5.999)).toHaveLength(1);
      expect(stageAt(6)).toHaveLength(1);
      expect(stageAt(6.001)).toEqual([]);
    },
  );

  it('mounts an adjustment pass without looking up or rendering its own source pixels', () => {
    const clip = {
      ...createEditorVisualClip('adjustment-source', 'image', { durationSeconds: 2 }),
      runtimeRole: 'adjustment' as const,
    };

    const stage = getProgramStageClips(
      [clip],
      new Map(),
      new Map(),
      {},
      {},
      1,
    );

    expect(stage).toEqual([expect.objectContaining({
      clip,
      sourceWidth: 1,
      sourceHeight: 1,
    })]);
    expect(stage[0]?.item).toBeUndefined();
    expect(stage[0]?.asset).toBeUndefined();
  });
});

describe('buildAudioWaveformSignature', () => {
  it('invalidates a waveform when an audio clip source range changes', () => {
    const item = { id: 'voice-item', nodeId: 'voice-node', label: 'Voice', kind: 'audio' as const, assetUrl: 'data:audio/wav;base64,AAAA' };
    const full = createEditorAudioClip('voice-node');
    const trimmed = { ...full, sourceInMs: 1_000, sourceOutMs: 4_000 };
    expect(buildAudioWaveformSignature(item, full, 5)).not.toBe(buildAudioWaveformSignature(item, trimmed, 5));
  });
});
