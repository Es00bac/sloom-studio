import { describe, expect, it } from 'vitest';
import { breakPaperTextUnits, layoutParagraphText, type PaperTextAlign } from './paperTextLayout';

// Monospace metric: every character (space included) is 10pt wide → all positions are exact integers.
const CH = 10;
const mono = (t: string) => t.length * CH;

function run(text: string, maxWidthPt: number, align: PaperTextAlign, extra: Partial<{ leadingPt: number; fontSizePt: number; ascentPt: number }> = {}) {
  return layoutParagraphText({
    text,
    maxWidthPt,
    fontSizePt: extra.fontSizePt ?? 10,
    leadingPt: extra.leadingPt ?? 12,
    align,
    measureText: mono,
    ascentPt: extra.ascentPt,
  });
}

describe('layoutParagraphText', () => {
  it('greedily wraps words that exceed the content width', () => {
    // "ab"|"cd"|"ef" each 20pt; "ab cd" = 50 > 40 → one word per line.
    const { lines } = run('ab cd ef', 40, 'left');
    expect(lines.map((l) => l.text)).toEqual(['ab', 'cd', 'ef']);
  });

  it('keeps words together when they fit', () => {
    const { lines } = run('ab cd ef', 100, 'left'); // "ab cd ef" = 80 <= 100
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('ab cd ef');
  });

  it('treats \\n as hard paragraph breaks', () => {
    const { lines } = run('one\ntwo three', 100, 'left');
    expect(lines.map((l) => l.text)).toEqual(['one', 'two three']);
    expect(lines[0].isParagraphEnd).toBe(true);
  });

  it('advances the baseline by the leading each line, starting at the ascent', () => {
    const { lines, totalHeightPt } = run('a\nb\nc', 100, 'left', { leadingPt: 12, ascentPt: 8 });
    expect(lines.map((l) => l.baselineYPt)).toEqual([8, 20, 32]);
    expect(totalHeightPt).toBe(36);
  });

  it('positions left / center / right runs correctly', () => {
    expect(run('ab', 100, 'left').lines[0].runs[0].xPt).toBe(0);
    expect(run('ab', 100, 'center').lines[0].runs[0].xPt).toBe(40); // (100-20)/2
    expect(run('ab', 100, 'right').lines[0].runs[0].xPt).toBe(80); // 100-20
  });

  it('justifies interior lines to the full width but leaves the last line ragged', () => {
    // Force two lines: "ab cd ef" (80) fits 80, but add a 4th word to wrap.
    const { lines } = run('ab cd ef gh', 80, 'justify');
    // First line "ab cd ef" (80) is interior → justified across 80 (already full, gaps stay ~even).
    const first = lines[0];
    expect(first.isParagraphEnd).toBe(false);
    expect(first.runs.map((r) => r.text)).toEqual(['ab', 'cd', 'ef']);
    // 3 words @20 = 60, 2 gaps, gap = (80-60)/2 = 10 → x: 0, 30, 60
    expect(first.runs.map((r) => r.xPt)).toEqual([0, 30, 60]);
    expect(first.widthPt).toBe(80);
    // Last line "gh" stays a single left-anchored run (ragged).
    const last = lines[lines.length - 1];
    expect(last.isParagraphEnd).toBe(true);
    expect(last.runs).toHaveLength(1);
    expect(last.runs[0].xPt).toBe(0);
  });

  it('places an over-long single word on its own line without looping', () => {
    const { lines } = run('supercalifragilistic', 40, 'left'); // 20 chars = 200pt > 40
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('supercalifragilistic');
  });

  it('defaults the ascent to 0.8·fontSize when not provided', () => {
    const { lines } = run('x', 100, 'left', { fontSizePt: 20 });
    expect(lines[0].baselineYPt).toBe(16); // 20 * 0.8
  });

  it('keeps an explicitly prohibited next-line character with the preceding unit', () => {
    const units = ['花', '、', '記'];
    expect(breakPaperTextUnits(units, 10, () => 6, {
      canBreakBefore: (unit) => !/^[、。」]/.test(unit),
    })).toEqual([['花', '、'], ['記']]);
  });
});
