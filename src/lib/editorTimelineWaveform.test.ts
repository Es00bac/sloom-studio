import { describe, expect, it } from 'vitest';
import {
  pruneTimelineWaveformMap,
  takePendingTimelineWaveformRequests,
} from './editorTimelineWaveform';

describe('takePendingTimelineWaveformRequests', () => {
  it('groups clip waveform requests by shared source signature', () => {
    const signaturesByClipId: Record<string, string> = {};

    expect(
      takePendingTimelineWaveformRequests(
        [
          { clipId: 'audio-a', signature: 'source-1', sourceUrl: 'clip.mp4' },
          { clipId: 'audio-b', signature: 'source-1', sourceUrl: 'clip.mp4' },
          { clipId: 'audio-c', signature: 'source-2', sourceUrl: 'music.mp3' },
        ],
        signaturesByClipId,
      ),
    ).toEqual([
      { clipIds: ['audio-a', 'audio-b'], signature: 'source-1', sourceUrl: 'clip.mp4' },
      { clipIds: ['audio-c'], signature: 'source-2', sourceUrl: 'music.mp3' },
    ]);
    expect(signaturesByClipId).toEqual({
      'audio-a': 'source-1',
      'audio-b': 'source-1',
      'audio-c': 'source-2',
    });
  });

  it('skips clips that already have the current waveform signature', () => {
    expect(
      takePendingTimelineWaveformRequests(
        [{ clipId: 'audio-a', signature: 'source-1', sourceUrl: 'clip.mp4' }],
        { 'audio-a': 'source-1' },
      ),
    ).toEqual([]);
  });

  it('keeps source ranges on distinct trimmed waveform requests', () => {
    expect(takePendingTimelineWaveformRequests([
      { clipId: 'trim-a', signature: 'source:0:1000', sourceUrl: 'voice.wav', sourceInMs: 0, sourceOutMs: 1_000 },
      { clipId: 'trim-b', signature: 'source:1000:2000', sourceUrl: 'voice.wav', sourceInMs: 1_000, sourceOutMs: 2_000 },
    ], {})).toEqual([
      { clipIds: ['trim-a'], signature: 'source:0:1000', sourceUrl: 'voice.wav', sourceInMs: 0, sourceOutMs: 1_000 },
      { clipIds: ['trim-b'], signature: 'source:1000:2000', sourceUrl: 'voice.wav', sourceInMs: 1_000, sourceOutMs: 2_000 },
    ]);
  });
});

describe('pruneTimelineWaveformMap', () => {
  it('removes waveforms for clips that are no longer on the timeline', () => {
    expect(
      pruneTimelineWaveformMap(
        {
          removed: [0.2],
          active: [0.8],
        },
        ['active'],
      ),
    ).toEqual({ active: [0.8] });
  });
});
