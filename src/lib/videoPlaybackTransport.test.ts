import { describe, expect, it } from 'vitest';
import { createEditorAudioClip } from './manualEditorState';
import type { AudioTimelineBlock } from './manualEditorTimeline';
import {
  buildProgramAudioPlaybackItems,
  buildProgramAudioPlaybackPlan,
  resolveProgramAudioFadeFactor,
  shouldCorrectProgramMediaTime,
} from './videoPlaybackTransport';

function audioBlock(overrides: Partial<AudioTimelineBlock> = {}): AudioTimelineBlock {
  const clip = {
    ...createEditorAudioClip('source-audio', 1, {
    offsetMs: 10_000,
    sourceInMs: 5_000,
    sourceOutMs: 15_000,
    volumePercent: 80,
    enabled: true,
    ...overrides.clip,
    }),
    id: 'audio-1',
  };

  return {
    item: {
      id: 'source-audio',
      nodeId: 'source-audio',
      kind: 'audio',
      label: 'Production audio',
      assetUrl: 'signal-loom-asset://file/production.wav',
    },
    startSeconds: 10,
    durationSeconds: 10,
    endSeconds: 20,
    ...overrides,
    clip,
  };
}

describe('feature-length program playback planning', () => {
  it('resolves active source time and the complete clip/track/fade gain', () => {
    const block = audioBlock({
      clip: {
        ...createEditorAudioClip('source-audio', 1, {
        id: 'audio-1',
        offsetMs: 10_000,
        sourceInMs: 5_000,
        sourceOutMs: 15_000,
        volumePercent: 80,
        volumeAutomationPoints: [
          { timePercent: 0, valuePercent: 100 },
          { timePercent: 100, valuePercent: 50 },
        ],
        fadeInSeconds: 2,
        enabled: true,
        }),
        id: 'audio-1',
      },
    });

    const items = buildProgramAudioPlaybackItems({
      audioBlocks: [block],
      playheadSeconds: 11,
      trackVolumes: [100, 50],
      mutedTracks: [],
      soloTracks: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'audio-1', sourceTimeSeconds: 6 });
    // 95% automation * 50% track * 50% fade-in.
    expect(items[0].volume).toBeCloseTo(0.2375, 4);
  });

  it('removes clips outside the playhead and respects mute/solo policy', () => {
    const block = audioBlock();
    const base = {
      audioBlocks: [block],
      trackVolumes: [100, 100],
      soloTracks: [] as number[],
    };

    expect(buildProgramAudioPlaybackItems({ ...base, playheadSeconds: 9.99, mutedTracks: [] })).toEqual([]);
    expect(buildProgramAudioPlaybackItems({ ...base, playheadSeconds: 20, mutedTracks: [] })).toEqual([]);
    expect(buildProgramAudioPlaybackItems({ ...base, playheadSeconds: 12, mutedTracks: [1] })).toEqual([]);
    expect(buildProgramAudioPlaybackItems({ ...base, playheadSeconds: 12, mutedTracks: [], soloTracks: [0] })).toEqual([]);
  });

  it('uses professional hold interpolation for program audio gain', () => {
    const base = audioBlock();
    const block: AudioTimelineBlock = {
      ...base,
      clip: {
        ...base.clip,
        professional: {
          pan: 0,
          parameterKeyframes: [{
            id: 'volume',
            parameter: 'volume',
            durationMs: 10_000,
            keyframes: [
              { id: 'v1', timeMs: 0, value: 25, interpolation: 'hold' },
              { id: 'v2', timeMs: 5_000, value: 100, interpolation: 'linear' },
            ],
          }],
        },
      },
    };

    const [item] = buildProgramAudioPlaybackItems({
      audioBlocks: [block],
      playheadSeconds: 12,
      trackVolumes: [100, 100],
      mutedTracks: [],
      soloTracks: [],
    });
    expect(item?.volume).toBeCloseTo(0.25);
  });

  it('applies the same persisted bus gain, pan, mute, and solo route as export', () => {
    const base = audioBlock({
      clip: {
        ...audioBlock().clip,
        professional: { pan: -0.25, busId: 'dialogue' },
      },
    });
    const input = {
      audioBlocks: [base],
      playheadSeconds: 12,
      trackVolumes: [100, 100],
      mutedTracks: [],
      soloTracks: [],
      audioMixerBuses: [
        { id: 'master', name: 'Master', kind: 'master' as const, gainDb: 0, pan: 0, muted: false, solo: false },
        { id: 'dialogue', name: 'Dialogue', kind: 'submix' as const, outputBusId: 'master', gainDb: -6, pan: 0.5, muted: false, solo: false },
      ],
    };
    const plan = buildProgramAudioPlaybackPlan(input);
    expect(plan.mixerError).toBeUndefined();
    expect(plan.items[0]).toMatchObject({ id: 'audio-1', pan: 0.25 });
    expect(plan.items[0]?.gain).toBeCloseTo(0.8 * 10 ** (-6 / 20));

    const muted = buildProgramAudioPlaybackPlan({
      ...input,
      audioMixerBuses: input.audioMixerBuses.map((bus) => bus.id === 'dialogue' ? { ...bus, muted: true } : bus),
    });
    expect(muted.items).toEqual([]);

    const invalid = buildProgramAudioPlaybackPlan({
      ...input,
      audioMixerBuses: [{ ...input.audioMixerBuses[0]!, outputBusId: 'missing' }],
    });
    expect(invalid).toMatchObject({ items: [], mixerError: expect.stringContaining('unknown bus') });
  });

  it('applies symmetrical bounded fades', () => {
    expect(resolveProgramAudioFadeFactor(0.5, 10, 2, 2)).toBeCloseTo(0.25);
    expect(resolveProgramAudioFadeFactor(5, 10, 2, 2)).toBe(1);
    expect(resolveProgramAudioFadeFactor(9.5, 10, 2, 2)).toBeCloseTo(0.25);
  });

  it('lets continuously playing media coast inside a drift window but seeks exactly while paused', () => {
    expect(shouldCorrectProgramMediaTime(60, 60.1, true)).toBe(false);
    expect(shouldCorrectProgramMediaTime(60, 60.25, true)).toBe(true);
    expect(shouldCorrectProgramMediaTime(60, 60.02, false)).toBe(true);
  });
});
