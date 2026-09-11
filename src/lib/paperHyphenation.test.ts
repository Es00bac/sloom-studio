import { describe, expect, it } from 'vitest';
import { hyphenatePaperWord } from './paperHyphenation';

describe('hyphenatePaperWord', () => {
  it('uses TeX-style American English patterns for repeatable discretionary breaks', () => {
    expect(hyphenatePaperWord('typesetting')).toEqual({
      word: 'typesetting',
      breakOffsets: [4, 7],
    });
    expect(hyphenatePaperWord('representation').breakOffsets).toEqual([3, 5, 8, 10]);
  });

  it('does not invent breaks for short, punctuated, numeric, or CJK tokens', () => {
    expect(hyphenatePaperWord('book').breakOffsets).toEqual([]);
    expect(hyphenatePaperWord('typesetting.').breakOffsets).toEqual([]);
    expect(hyphenatePaperWord('2026edition').breakOffsets).toEqual([]);
    expect(hyphenatePaperWord('組版設計').breakOffsets).toEqual([]);
  });
});
