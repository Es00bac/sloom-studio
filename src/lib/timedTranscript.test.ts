import { describe, expect, it } from 'vitest';
import {
  normalizeElevenLabsForcedAlignmentResponse,
  normalizeElevenLabsScribeResponse,
  timedTranscriptToCaptionCues,
} from './timedTranscript';

describe('timed transcript normalization', () => {
  it('normalizes Scribe word timestamps without losing language metadata', () => {
    const transcript = normalizeElevenLabsScribeResponse({
      text: 'Hello world.',
      language_code: 'en',
      language_probability: 0.99,
      words: [
        { text: 'Hello', start: 0.25, end: 0.65, type: 'word', speaker_id: 'speaker_0' },
        { text: ' ', type: 'spacing' },
        { text: 'world.', start: 0.7, end: 1.2, type: 'word', speaker_id: 'speaker_0' },
      ],
    });

    expect(transcript).toMatchObject({
      version: 1,
      provider: 'elevenlabs',
      modelId: 'scribe_v2',
      text: 'Hello world.',
      languageCode: 'en',
      languageProbability: 0.99,
    });
    expect(transcript.words[0]).toMatchObject({ startMs: 250, endMs: 650 });
    expect(timedTranscriptToCaptionCues(transcript)).toEqual([
      { startMs: 250, endMs: 1200, text: 'Hello world.' },
    ]);
  });

  it('starts a new cue when the speaker changes', () => {
    const transcript = normalizeElevenLabsScribeResponse({
      text: 'First. Second.',
      words: [
        { text: 'First.', start: 0, end: 1, type: 'word', speaker_id: 'speaker_0' },
        { text: ' ', type: 'spacing' },
        { text: 'Second.', start: 1.1, end: 2, type: 'word', speaker_id: 'speaker_1' },
      ],
    });

    expect(timedTranscriptToCaptionCues(transcript)).toEqual([
      { startMs: 0, endMs: 1000, text: 'First.' },
      { startMs: 1100, endMs: 2000, text: 'Second.' },
    ]);
  });

  it('preserves exact Japanese text while normalizing forced-alignment character timings', () => {
    const transcript = normalizeElevenLabsForcedAlignmentResponse({
      characters: [
        { text: '熊', start: 0, end: 0.3, loss: 0.01 },
        { text: 'で', start: 0.3, end: 0.5 },
        { text: 'す', start: 0.5, end: 0.8 },
        { text: '。', start: 0.8, end: 1 },
      ],
      words: [{ text: '熊です。', start: 0, end: 1, loss: 0.1 }],
      loss: 0.12,
    }, '熊です。');

    expect(transcript).toMatchObject({
      modelId: 'forced_alignment',
      operation: 'align',
      text: '熊です。',
      alignmentLoss: 0.12,
    });
    expect(transcript.words[0]).toMatchObject({ text: '熊', alignmentLoss: 0.01 });
    expect(timedTranscriptToCaptionCues(transcript)).toEqual([
      { startMs: 0, endMs: 1000, text: '熊です。' },
    ]);
  });
});
