import { describe, expect, it } from 'vitest';
import {
  buildCompositionMediaSignature,
  mergeDurationMap,
  parseCompositionMediaSignature,
} from './compositionMediaState';

describe('buildCompositionMediaSignature', () => {
  it('stays stable for equivalent rebuilt media arrays', () => {
    const first = [
      {
        handle: 'composition-video',
        nodeId: 'video-1',
        resultType: 'video' as const,
        url: 'blob:video-1',
      },
      {
        handle: 'composition-audio-1',
        nodeId: 'audio-1',
        resultType: 'audio' as const,
        url: 'blob:audio-1',
      },
    ];

    const rebuilt = first.map((entry) => ({ ...entry }));

    expect(buildCompositionMediaSignature(first)).toBe(buildCompositionMediaSignature(rebuilt));
  });

  it('round-trips the media entries needed by the duration loader', () => {
    const signature = buildCompositionMediaSignature([
      {
        handle: 'composition-video',
        nodeId: 'video-1',
        resultType: 'video',
        url: 'blob:video-1',
      },
      {
        handle: 'composition-audio-1',
        nodeId: 'audio-1',
        resultType: 'audio',
        url: 'blob:audio-1',
      },
    ]);

    expect(parseCompositionMediaSignature(signature)).toEqual([
      {
        handle: 'composition-video',
        nodeId: 'video-1',
        resultType: 'video',
        url: 'blob:video-1',
      },
      {
        handle: 'composition-audio-1',
        nodeId: 'audio-1',
        resultType: 'audio',
        url: 'blob:audio-1',
      },
    ]);
  });
});

describe('mergeDurationMap', () => {
  it('reuses the previous duration map when nothing changed', () => {
    const previous = {
      'video-1': 6.2,
      'audio-1': 4.8,
    };

    const merged = mergeDurationMap(previous, [
      ['video-1', 6.2],
      ['audio-1', 4.8],
    ]);

    expect(merged).toBe(previous);
  });

  it('returns a new duration map when media durations change', () => {
    const previous = {
      'video-1': 6.2,
      'audio-1': 4.8,
    };

    const merged = mergeDurationMap(previous, [
      ['video-1', 6.2],
      ['audio-1', 5.1],
    ]);

    expect(merged).not.toBe(previous);
    expect(merged).toEqual({
      'video-1': 6.2,
      'audio-1': 5.1,
    });
  });
});
