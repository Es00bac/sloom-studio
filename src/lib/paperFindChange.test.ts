import { describe, expect, it } from 'vitest';
import { findPaperMatches, replaceAllInText } from './paperFindChange';

const frames = [
  { pageId: 'p1', frameId: 'a', text: 'The cat sat on the cat mat.' },
  { pageId: 'p1', frameId: 'b', text: 'Category: CATS' },
];

describe('findPaperMatches', () => {
  it('finds case-insensitive matches across frames by default', () => {
    const matches = findPaperMatches(frames, 'cat');
    expect(matches.map((m) => `${m.frameId}:${m.index}`)).toEqual(['a:4', 'a:19', 'b:0', 'b:10']);
  });

  it('honours case sensitivity and whole-word', () => {
    expect(findPaperMatches(frames, 'CAT', { caseSensitive: true }).map((m) => m.frameId)).toEqual(['b']);
    const wholeWord = findPaperMatches(frames, 'cat', { wholeWord: true });
    expect(wholeWord.map((m) => `${m.frameId}:${m.index}`)).toEqual(['a:4', 'a:19']); // not "Category"/"CATS"
  });

  it('returns nothing for an empty query', () => {
    expect(findPaperMatches(frames, '')).toEqual([]);
  });
});

describe('replaceAllInText', () => {
  it('replaces every occurrence (regex-safe) and respects options', () => {
    expect(replaceAllInText('a.b.a', 'a', 'X')).toBe('X.b.X');
    expect(replaceAllInText('1+1=2', '+', 'plus')).toBe('1plus1=2'); // query is escaped, not a regex
    expect(replaceAllInText('Cat cat', 'cat', 'dog', { caseSensitive: true })).toBe('Cat dog');
  });
});
