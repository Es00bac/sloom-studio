import { describe, expect, it } from 'vitest';
import {
  MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS,
  mergeTranscriptRemovedRanges,
  proposeSilenceGapRemoval,
  proposeTranscriptSelectionEdit,
  searchTranscript,
  validateEditableTranscript,
  type EditableTranscriptWord,
} from './videoTranscriptEditing';

const words: EditableTranscriptWord[] = [
  { id: 'w1', text: 'Hello', startMs: 0, endMs: 400, speakerId: 'A' },
  { id: 'w2', text: 'brave', startMs: 450, endMs: 800, speakerId: 'A' },
  { id: 'w3', text: 'new', startMs: 2_000, endMs: 2_250, speakerId: 'A' },
  { id: 'w4', text: 'world', startMs: 2_300, endMs: 2_800, speakerId: 'A' },
];

describe('transcript search', () => {
  it('finds bounded normalized multi-word matches with exact timings', () => {
    expect(searchTranscript(words, 'BRAVE, new', { maxResults: 10 })).toEqual([{
      wordStartIndex: 1, wordEndIndex: 2, startMs: 450, endMs: 2_250, text: 'brave new', speakerId: 'A',
    }]);
    expect(searchTranscript(words, 'world', { maxResults: 0 })).toHaveLength(1);
    expect(() => searchTranscript(words, 'x'.repeat(201))).toThrow(/200/);
  });

  it('rejects malformed or unordered transcript data', () => {
    expect(() => validateEditableTranscript([{ ...words[1], id: 'later' }, words[0]])).toThrow(/ordered/);
    expect(() => validateEditableTranscript([{ ...words[0], endMs: 0 }])).toThrow(/invalid timing/);
  });

  it('exports the query-length bound the transcript search UI enforces', () => {
    expect(MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS).toBe(200);
    expect(() => searchTranscript(words, 'x'.repeat(MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS + 1))).toThrow(/200/);
  });
});

describe('transcript edit proposals', () => {
  it('produces the same ordinary ripple edit data as an exact manual time selection', () => {
    const fromText = proposeTranscriptSelectionEdit({ words, selection: { kind: 'word-range', startWordIndex: 1, endWordIndex: 2 } });
    const fromManualTime = proposeTranscriptSelectionEdit({ words, selection: { kind: 'time-range', startMs: 450, endMs: 2_250 } });
    expect(fromText.commands).toEqual(fromManualTime.commands);
    expect(fromText.commands).toEqual([{
      kind: 'ripple-delete', startMs: 450, endMs: 2_250, durationMs: 1_800, source: 'transcript',
    }]);
    expect(fromText.removedRangesAfter).toEqual([{ startMs: 450, endMs: 2_250, reason: 'transcript-selection' }]);
  });

  it('proposes silence removal with handles and emits commands in descending order', () => {
    const extended = [...words, { id: 'w5', text: 'Again', startMs: 5_000, endMs: 5_500 }];
    const proposal = proposeSilenceGapRemoval({
      words: extended, minimumGapMs: 800, retainLeadingMs: 100, retainTrailingMs: 100,
    });
    expect(proposal.ranges).toEqual([
      { startMs: 900, endMs: 1_900, reason: 'silence-gap' },
      { startMs: 2_900, endMs: 4_900, reason: 'silence-gap' },
    ]);
    expect(proposal.commands.map((command) => command.startMs)).toEqual([2_900, 900]);
  });

  it('maintains merged removed ranges and avoids proposing fully removed silence twice', () => {
    expect(mergeTranscriptRemovedRanges([
      { startMs: 100, endMs: 500, reason: 'silence-gap' },
      { startMs: 400, endMs: 700, reason: 'transcript-selection' },
    ])).toEqual([{ startMs: 100, endMs: 700, reason: 'transcript-selection' }]);
    const proposal = proposeSilenceGapRemoval({
      words, minimumGapMs: 800, retainLeadingMs: 100, retainTrailingMs: 100,
      removedRanges: [{ startMs: 800, endMs: 2_000, reason: 'silence-gap' }],
    });
    expect(proposal.ranges).toEqual([]);
  });

  it('subtracts prior removals and maps new edits onto current ripple coordinates', () => {
    const proposal = proposeTranscriptSelectionEdit({
      words,
      selection: { kind: 'time-range', startMs: 450, endMs: 2_250 },
      removedRanges: [{ startMs: 600, endMs: 1_000, reason: 'transcript-selection' }],
    });
    expect(proposal.ranges).toEqual([
      { startMs: 450, endMs: 600, reason: 'transcript-selection' },
      { startMs: 1_000, endMs: 2_250, reason: 'transcript-selection' },
    ]);
    expect(proposal.commands).toEqual([
      { kind: 'ripple-delete', startMs: 600, endMs: 1_850, durationMs: 1_250, source: 'transcript' },
      { kind: 'ripple-delete', startMs: 450, endMs: 600, durationMs: 150, source: 'transcript' },
    ]);
  });

  it('rejects invalid selections and silence settings', () => {
    expect(() => proposeTranscriptSelectionEdit({ words, selection: { kind: 'word-range', startWordIndex: -1, endWordIndex: 0 } })).toThrow(/out of bounds/);
    expect(() => proposeSilenceGapRemoval({ words, minimumGapMs: 20 })).toThrow(/at least 100ms/);
  });
});
