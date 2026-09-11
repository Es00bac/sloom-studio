import { hyphenated } from 'hyphenated';

export interface PaperHyphenationWord {
  word: string;
  /** UTF-16 offsets at legal discretionary break points. */
  breakOffsets: number[];
}

/**
 * Language-pattern hyphenation for production composition. Japanese/CJK is already character-breaking;
 * the current Paper language surface uses American English patterns for Latin prose.
 */
export function hyphenatePaperWord(word: string): PaperHyphenationWord {
  if (!/^[A-Za-z]{5,}$/u.test(word)) return { word, breakOffsets: [] };
  const pieces = hyphenated(word).split('\u00ad');
  if (pieces.length < 2) return { word, breakOffsets: [] };
  const breakOffsets: number[] = [];
  let cursor = 0;
  for (const piece of pieces.slice(0, -1)) {
    cursor += piece.length;
    // Avoid typographically weak one-character remnants even if a custom pattern permits one.
    if (cursor >= 2 && word.length - cursor >= 2) breakOffsets.push(cursor);
  }
  return { word, breakOffsets };
}
