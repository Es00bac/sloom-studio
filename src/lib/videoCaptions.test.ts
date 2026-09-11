import { describe, expect, it } from 'vitest';
import {
  captionCuesToAlignmentText,
  captionCuesToTextClips,
  parseSrtCaptions,
  parseWebVttCaptions,
  serializeSrtCaptions,
  serializeWebVttCaptions,
  textClipsToCaptionCues,
} from './videoCaptions';

describe('video captions', () => {
  it('parses and serializes SRT captions', () => {
    const cues = parseSrtCaptions('1\n00:00:01,250 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond line\n');

    expect(cues).toEqual([
      { id: '1', startMs: 1250, endMs: 3500, text: 'Hello world' },
      { id: '2', startMs: 4000, endMs: 5000, text: 'Second line' },
    ]);
    expect(serializeSrtCaptions(cues)).toContain('00:00:01,250 --> 00:00:03,500');
  });

  it('parses and serializes WebVTT captions', () => {
    const cues = parseWebVttCaptions('WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.250 align:center\nCaption text\n');

    expect(cues).toEqual([{ id: 'intro', startMs: 1000, endMs: 2250, text: 'Caption text' }]);
    expect(serializeWebVttCaptions(cues)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.250\nCaption text\n');
  });

  it('maps caption cues to timeline text clips and back', () => {
    const clips = captionCuesToTextClips([
      { startMs: 2000, endMs: 4500, text: 'Timed caption' },
    ], { sourceNodeId: 'captions-1', trackIndex: 3 });

    expect(clips[0]).toMatchObject({
      sourceNodeId: 'captions-1',
      sourceKind: 'text',
      trackIndex: 3,
      startMs: 2000,
      durationSeconds: 2.5,
      textContent: 'Timed caption',
    });
    expect(textClipsToCaptionCues(clips)).toEqual([
      { id: clips[0].id, startMs: 2000, endMs: 4500, text: 'Timed caption' },
    ]);
  });

  it('reconstructs English and Japanese forced-alignment scripts without leaking cue boundaries', () => {
    expect(captionCuesToAlignmentText([
      { startMs: 0, endMs: 500, text: 'Sloom Studio' },
      { startMs: 500, endMs: 1000, text: 'is still moving forward.' },
    ])).toBe('Sloom Studio is still moving forward.');

    expect(captionCuesToAlignmentText([
      { startMs: 0, endMs: 500, text: 'Sloom Studioは' },
      { startMs: 500, endMs: 1000, text: '開発中です。' },
    ])).toBe('Sloom Studioは開発中です。');
  });
});
