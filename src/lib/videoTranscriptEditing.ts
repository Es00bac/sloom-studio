/** Pure transcript-to-timeline proposals. Callers apply the returned ordinary ripple edits. */

export interface EditableTranscriptWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
}

export interface EditableTranscriptCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  wordIds: string[];
  speakerId?: string;
}

export interface TranscriptRemovedRange {
  startMs: number;
  endMs: number;
  reason: 'transcript-selection' | 'silence-gap';
}

export interface TranscriptSearchMatch {
  wordStartIndex: number;
  wordEndIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
}

export type TranscriptSelection =
  | { kind: 'word-range'; startWordIndex: number; endWordIndex: number }
  | { kind: 'time-range'; startMs: number; endMs: number };

export interface TimelineRippleDeleteCommand {
  kind: 'ripple-delete';
  startMs: number;
  endMs: number;
  durationMs: number;
  source: 'transcript';
}

export interface TranscriptEditProposal {
  title: string;
  ranges: TranscriptRemovedRange[];
  /** Descending timeline order avoids coordinate drift when dispatched sequentially. */
  commands: TimelineRippleDeleteCommand[];
  removedRangesAfter: TranscriptRemovedRange[];
}

const MAX_WORDS = 100_000;
export const MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS = 200;
const MAX_QUERY_LENGTH = MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS;
const MAX_SEARCH_RESULTS = 100;
const MAX_SILENCE_PROPOSALS = 5_000;

export function validateEditableTranscript(words: readonly EditableTranscriptWord[]): void {
  if (words.length > MAX_WORDS) throw new Error(`Transcript exceeds the ${MAX_WORDS.toLocaleString()}-word safety limit.`);
  let previousStart = -1;
  const ids = new Set<string>();
  for (const [index, word] of words.entries()) {
    if (!word.id || ids.has(word.id)) throw new Error(`Transcript word ${index + 1} has a missing or duplicate id.`);
    if (!word.text) throw new Error(`Transcript word ${index + 1} has no text.`);
    if (!finiteNonNegative(word.startMs) || !finiteNonNegative(word.endMs) || word.endMs <= word.startMs) {
      throw new Error(`Transcript word ${index + 1} has invalid timing.`);
    }
    if (word.startMs < previousStart) throw new Error('Transcript words must be ordered by start time.');
    previousStart = word.startMs;
    ids.add(word.id);
  }
}

export function searchTranscript(
  words: readonly EditableTranscriptWord[],
  query: string,
  options: { maxResults?: number; speakerId?: string } = {},
): TranscriptSearchMatch[] {
  validateEditableTranscript(words);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  if (query.length > MAX_QUERY_LENGTH) throw new Error(`Transcript search queries are limited to ${MAX_QUERY_LENGTH} characters.`);
  const maxResults = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.floor(options.maxResults ?? 50)));
  const queryTokens = normalizedQuery.split(' ');
  const matches: TranscriptSearchMatch[] = [];
  for (let start = 0; start < words.length && matches.length < maxResults; start += 1) {
    if (options.speakerId && words[start].speakerId !== options.speakerId) continue;
    for (let end = start; end < Math.min(words.length, start + Math.max(8, queryTokens.length + 3)); end += 1) {
      const candidate = normalizeSearchText(words.slice(start, end + 1).map((word) => word.text).join(' '));
      if (candidate === normalizedQuery) {
        matches.push({
          wordStartIndex: start,
          wordEndIndex: end,
          startMs: words[start].startMs,
          endMs: words[end].endMs,
          text: words.slice(start, end + 1).map((word) => word.text).join(' '),
          ...(words[start].speakerId ? { speakerId: words[start].speakerId } : {}),
        });
        break;
      }
      if (!normalizedQuery.startsWith(candidate)) break;
    }
  }
  return matches;
}

export function proposeTranscriptSelectionEdit({
  words,
  selection,
  removedRanges = [],
}: {
  words: readonly EditableTranscriptWord[];
  selection: TranscriptSelection;
  removedRanges?: readonly TranscriptRemovedRange[];
}): TranscriptEditProposal {
  validateEditableTranscript(words);
  if (words.length === 0) throw new Error('Cannot edit an empty transcript.');
  let startMs: number;
  let endMs: number;
  if (selection.kind === 'word-range') {
    const startIndex = Math.floor(selection.startWordIndex);
    const endIndex = Math.floor(selection.endWordIndex);
    if (startIndex < 0 || endIndex < startIndex || endIndex >= words.length) throw new Error('Transcript word selection is out of bounds.');
    startMs = words[startIndex].startMs;
    endMs = words[endIndex].endMs;
  } else {
    if (!finiteNonNegative(selection.startMs) || !finiteNonNegative(selection.endMs) || selection.endMs <= selection.startMs) {
      throw new Error('Transcript time selection must have a positive finite duration.');
    }
    startMs = selection.startMs;
    endMs = selection.endMs;
  }
  const range: TranscriptRemovedRange = { startMs, endMs, reason: 'transcript-selection' };
  return buildProposal('Remove transcript selection', [range], removedRanges);
}

export function proposeSilenceGapRemoval({
  words,
  minimumGapMs = 800,
  retainLeadingMs = 100,
  retainTrailingMs = 100,
  removedRanges = [],
}: {
  words: readonly EditableTranscriptWord[];
  minimumGapMs?: number;
  retainLeadingMs?: number;
  retainTrailingMs?: number;
  removedRanges?: readonly TranscriptRemovedRange[];
}): TranscriptEditProposal {
  validateEditableTranscript(words);
  if (!finiteNonNegative(minimumGapMs) || minimumGapMs < 100) throw new Error('Minimum silence gap must be at least 100ms.');
  if (!finiteNonNegative(retainLeadingMs) || !finiteNonNegative(retainTrailingMs)) throw new Error('Silence handles must be finite and non-negative.');
  const ranges: TranscriptRemovedRange[] = [];
  for (let index = 1; index < words.length; index += 1) {
    const gapStart = words[index - 1].endMs;
    const gapEnd = words[index].startMs;
    if (gapEnd - gapStart < minimumGapMs) continue;
    const startMs = gapStart + retainTrailingMs;
    const endMs = gapEnd - retainLeadingMs;
    if (endMs > startMs && !rangeFullyRemoved({ startMs, endMs }, removedRanges)) {
      ranges.push({ startMs, endMs, reason: 'silence-gap' });
      if (ranges.length >= MAX_SILENCE_PROPOSALS) break;
    }
  }
  return buildProposal('Remove transcript silence gaps', ranges, removedRanges);
}

export function mergeTranscriptRemovedRanges(ranges: readonly TranscriptRemovedRange[]): TranscriptRemovedRange[] {
  const sorted = ranges
    .filter((range) => finiteNonNegative(range.startMs) && finiteNonNegative(range.endMs) && range.endMs > range.startMs)
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: TranscriptRemovedRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startMs > previous.endMs) {
      merged.push(range);
    } else {
      previous.endMs = Math.max(previous.endMs, range.endMs);
      if (previous.reason !== range.reason) previous.reason = 'transcript-selection';
    }
  }
  return merged;
}

function buildProposal(
  title: string,
  ranges: readonly TranscriptRemovedRange[],
  existing: readonly TranscriptRemovedRange[],
): TranscriptEditProposal {
  const normalizedExisting = mergeTranscriptRemovedRanges(existing);
  const normalized = mergeTranscriptRemovedRanges(
    ranges.flatMap((range) => subtractRemovedRanges(range, normalizedExisting)),
  );
  const commands = [...normalized]
    .sort((a, b) => b.startMs - a.startMs)
    .map<TimelineRippleDeleteCommand>((range) => {
      const startMs = mapOriginalTimeToRippledTimeline(range.startMs, normalizedExisting);
      const endMs = mapOriginalTimeToRippledTimeline(range.endMs, normalizedExisting);
      return { kind: 'ripple-delete', startMs, endMs, durationMs: endMs - startMs, source: 'transcript' };
    });
  return { title, ranges: normalized, commands, removedRangesAfter: mergeTranscriptRemovedRanges([...normalizedExisting, ...normalized]) };
}

function subtractRemovedRanges(
  incoming: TranscriptRemovedRange,
  removed: readonly TranscriptRemovedRange[],
): TranscriptRemovedRange[] {
  let fragments = [{ ...incoming }];
  for (const cut of removed) {
    fragments = fragments.flatMap((fragment) => {
      if (cut.endMs <= fragment.startMs || cut.startMs >= fragment.endMs) return [fragment];
      const next: TranscriptRemovedRange[] = [];
      if (cut.startMs > fragment.startMs) next.push({ ...fragment, endMs: cut.startMs });
      if (cut.endMs < fragment.endMs) next.push({ ...fragment, startMs: cut.endMs });
      return next;
    });
  }
  return fragments;
}

function mapOriginalTimeToRippledTimeline(timeMs: number, removed: readonly TranscriptRemovedRange[]): number {
  let removedBefore = 0;
  for (const range of removed) {
    if (range.endMs <= timeMs) removedBefore += range.endMs - range.startMs;
    else if (range.startMs < timeMs) removedBefore += timeMs - range.startMs;
  }
  return timeMs - removedBefore;
}

function rangeFullyRemoved(
  range: Pick<TranscriptRemovedRange, 'startMs' | 'endMs'>,
  removed: readonly TranscriptRemovedRange[],
): boolean {
  return removed.some((item) => item.startMs <= range.startMs && item.endMs >= range.endMs);
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
