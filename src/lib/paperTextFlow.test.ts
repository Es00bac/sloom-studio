import { describe, expect, it } from 'vitest';
import {
  flowPaperText,
  type PaperTextFlowExclusion,
  type PaperTextFlowFrame,
  type PaperTextFlowTypeSpec,
  type PaperTextMeasurer,
} from './paperTextFlow';

// Deterministic measurer: 2mm per character of the joined line string.
const measure: PaperTextMeasurer = (text) => text.length * 2;

const spec: PaperTextFlowTypeSpec = {
  fontFamily: 'Test',
  fontSizePt: 10,
  leadingPt: 12, // ≈4.233 mm per line
  tracking: 0,
  align: 'left',
};

const col = (xMm: number, yMm: number, widthMm: number, heightMm: number) => ({ xMm, yMm, widthMm, heightMm });
const frame = (id: string, ...columns: PaperTextFlowFrame['columns']): PaperTextFlowFrame => ({ id, columns });

describe('flowPaperText', () => {
  it('greedily wraps words to the column width and reports no overset when it fits', () => {
    const result = flowPaperText('aa bb cc', spec, [frame('f1', col(0, 0, 10, 12))], measure);
    expect(result.fits).toBe(true);
    expect(result.overset).toBe('');
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['aa bb', 'cc']);
  });

  it('returns the unfit remainder as overset (faithful slice of the original text)', () => {
    const result = flowPaperText('aa bb cc', spec, [frame('f1', col(0, 0, 10, 5))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['aa bb']);
    expect(result.fits).toBe(false);
    expect(result.overset).toBe(' cc');
  });

  it('flows the overset from one frame into the next (threading)', () => {
    const result = flowPaperText(
      'aa bb cc dd',
      spec,
      [frame('f1', col(0, 0, 10, 5)), frame('f2', col(0, 0, 10, 5))],
      measure,
    );
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['aa bb']);
    expect(result.frames[1].lines.map((line) => line.text)).toEqual(['cc dd']);
    expect(result.overset).toBe('');
  });

  it('reports the contiguous source slice that flowed into each frame (threaded rendering)', () => {
    const result = flowPaperText(
      'aa bb cc dd',
      spec,
      [frame('f1', col(0, 0, 10, 5)), frame('f2', col(0, 0, 10, 5))],
      measure,
    );
    expect(result.frames[0].sourceText).toBe('aa bb');
    expect(result.frames[1].sourceText).toBe(' cc dd');
  });

  it('exposes authoritative source start/end offsets that reproduce each frame slice', () => {
    const text = 'aa bb cc dd';
    const result = flowPaperText(
      text,
      spec,
      [frame('f1', col(0, 0, 10, 5)), frame('f2', col(0, 0, 10, 5))],
      measure,
    );
    const [f0, f1] = result.frames;
    // Offsets index into the ORIGINAL story and reproduce the frame's slice exactly.
    expect(text.slice(f0.sourceStart, f0.sourceEnd)).toBe(f0.sourceText);
    expect(text.slice(f1.sourceStart, f1.sourceEnd)).toBe(f1.sourceText);
    expect(f0.sourceStart).toBe(0);
    // Plain source ranges are contiguous: every authored boundary byte belongs to one frame.
    expect(f1.sourceStart).toBe(f0.sourceEnd);
    expect(f1.sourceEnd).toBe(text.length);
  });

  it('gives an empty [start,end) range for a frame that receives no text', () => {
    const result = flowPaperText(
      'aa bb',
      spec,
      [frame('f1', col(0, 0, 10, 5)), frame('f2', col(0, 0, 10, 5))],
      measure,
    );
    const empty = result.frames[1];
    expect(empty.sourceText).toBe('');
    expect(empty.sourceStart).toBe(empty.sourceEnd);
  });

  it('fills column one before column two within a frame', () => {
    const result = flowPaperText(
      'aa bb cc dd',
      spec,
      [frame('f1', col(0, 0, 10, 5), col(20, 0, 10, 5))],
      measure,
    );
    const [line1, line2] = result.frames[0].lines;
    expect(line1).toMatchObject({ text: 'aa bb', xMm: 0 });
    expect(line2).toMatchObject({ text: 'cc dd', xMm: 20 });
    expect(result.overset).toBe('');
  });

  it('forces a new line at explicit paragraph breaks', () => {
    const result = flowPaperText('aa\nbb', spec, [frame('f1', col(0, 0, 100, 30))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['aa', 'bb']);
    expect(result.overset).toBe('');
  });

  it.each([
    { text: 'A\n\nB', tailHeightMm: 9, expectedTail: '\n\nB', expectedLines: ['', 'B'] },
    { text: 'A\n\n\nB', tailHeightMm: 13, expectedTail: '\n\n\nB', expectedLines: ['', '', 'B'] },
  ])('retains every authored paragraph delimiter at a plain inter-frame boundary in $text', ({
    text,
    tailHeightMm,
    expectedTail,
    expectedLines,
  }) => {
    const result = flowPaperText(
      text,
      spec,
      [frame('head', col(0, 0, 100, 5)), frame('tail', col(0, 0, 100, tailHeightMm))],
      measure,
    );
    expect(result.frames[0].sourceText).toBe('A');
    expect(result.frames[1].sourceText).toBe(expectedTail);
    expect(text.slice(result.frames[1].sourceStart, result.frames[1].sourceEnd)).toBe(expectedTail);
    expect(result.frames[1].lines.map((line) => line.text)).toEqual(expectedLines);
  });

  it.each([
    '\n\nA',
    'A\n\n',
    'A\n\nB',
    '\n\n',
    '   ',
  ])('owns every initial, terminal, middle, or blank-only paragraph in a fitting frame: %j', (text) => {
    const result = flowPaperText(text, spec, [frame('only', col(0, 0, 100, 40))], measure);
    expect(result.frames[0].sourceText).toBe(text);
    expect(text.slice(result.frames[0].sourceStart, result.frames[0].sourceEnd)).toBe(text);
    expect(result.fits).toBe(true);
    expect(result.overset).toBe('');
  });

  it('skips one delimiter only between adjacent nonempty frame contributions', () => {
    const text = 'A\n\nB';
    const result = flowPaperText(
      text,
      spec,
      [frame('head', col(0, 0, 100, 5)), frame('blank', col(0, 0, 100, 5)), frame('tail', col(0, 0, 100, 5))],
      measure,
    );
    expect(result.frames.map((entry) => entry.sourceText)).toEqual(['A', '\n', '\nB']);
    expect(result.frames.map((entry) => text.slice(entry.sourceStart, entry.sourceEnd))).toEqual(['A', '\n', '\nB']);
  });

  it.each([
    { delimiter: '\n', widthMm: 100 },
    { delimiter: '\r', widthMm: 2 },
    { delimiter: '\r\n', widthMm: 100 },
  ])('keeps a plain authored $delimiter in the destination range and overset', ({ delimiter, widthMm }) => {
    const text = `A${delimiter}B`;
    const threaded = flowPaperText(
      text,
      spec,
      [frame('head', col(0, 0, widthMm, 5)), frame('tail', col(0, 0, 100, 5))],
      measure,
    );
    expect(threaded.frames.map((entry) => entry.sourceText)).toEqual(['A', `${delimiter}B`]);
    expect(threaded.frames[0].sourceEnd).toBe(1);
    expect(threaded.frames[1].sourceStart).toBe(1);

    const overset = flowPaperText(text, spec, [frame('head', col(0, 0, widthMm, 5))], measure);
    expect(overset.frames[0].sourceText).toBe('A');
    expect(overset.overset).toBe(`${delimiter}B`);
    expect(overset.frames[0].sourceText + overset.overset).toBe(text);
  });

  it('omits only an explicitly mapped structural paragraph separator for rich source metrics', () => {
    const text = 'A\nB';
    const frames = [frame('head', col(0, 0, 100, 5)), frame('tail', col(0, 0, 100, 5))];
    const authored = flowPaperText(text, spec, frames, measure, [], { structuralDelimiters: [] });
    const structural = flowPaperText(text, spec, frames, measure, [], {
      structuralDelimiters: [{ start: 1, end: 2 }],
    });

    expect(authored.frames.map((entry) => entry.sourceText)).toEqual(['A', '\nB']);
    expect(structural.frames.map((entry) => entry.sourceText)).toEqual(['A', 'B']);
    expect(text.slice(structural.frames[0].sourceEnd, structural.frames[1].sourceStart)).toBe('\n');
  });

  it('owns a plain-text word separator at an inter-frame boundary', () => {
    const text = 'A B';
    const result = flowPaperText(
      text,
      spec,
      [frame('head', col(0, 0, 2, 5)), frame('tail', col(0, 0, 2, 5))],
      measure,
    );
    expect(result.frames.map((entry) => entry.sourceText)).toEqual(['A', ' B']);
    expect(result.frames[0].sourceEnd).toBe(result.frames[1].sourceStart);
  });

  it.each([
    { name: 'space before', paragraph: { start: 0, end: 1, spaceBeforeMm: 8 } },
    { name: 'space after', paragraph: { start: 0, end: 1, spaceAfterMm: 8 } },
    { name: 'border padding', paragraph: { start: 0, end: 1, borderPaddingMm: 4 } },
  ])('rejects a horizontal paragraph whose $name exceeds the complete block capacity', ({ paragraph }) => {
    const result = flowPaperText('A', spec, [frame('f', col(0, 0, 100, 5))], measure, [], {
      paragraphs: [paragraph],
    });
    expect(result.frames[0].lines).toEqual([]);
    expect(result.fits).toBe(false);
    expect(result.overset).toBe('A');
  });

  it('reserves paragraph end geometry before accepting the final horizontal line', () => {
    const leadingMm = (spec.leadingPt * 25.4) / 72;
    const exact = flowPaperText('A', spec, [frame('exact', col(0, 0, 100, leadingMm + 2))], measure, [], {
      paragraphs: [{ start: 0, end: 1, spaceAfterMm: 2 }],
    });
    const over = flowPaperText('A', spec, [frame('over', col(0, 0, 100, leadingMm + 2 - 0.001))], measure, [], {
      paragraphs: [{ start: 0, end: 1, spaceAfterMm: 2 }],
    });
    expect(exact.fits).toBe(true);
    expect(over.fits).toBe(false);
    expect(over.frames[0].lines).toEqual([]);
  });

  it('accepts exact vertical start/end geometry and rejects a one-unit-over capacity', () => {
    const leadingMm = (spec.leadingPt * 25.4) / 72;
    const geometryMm = 2 + 3 + (2 * 1);
    const metrics = { paragraphs: [{ start: 0, end: 1, spaceBeforeMm: 2, spaceAfterMm: 3, borderPaddingMm: 1 }] };
    const exact = flowPaperText(
      'A',
      { ...spec, vertical: true },
      [frame('exact', col(0, 0, leadingMm + geometryMm, 100))],
      measure,
      [],
      metrics,
    );
    const over = flowPaperText(
      'A',
      { ...spec, vertical: true },
      [frame('over', col(0, 0, leadingMm + geometryMm - 1, 100))],
      measure,
      [],
      metrics,
    );
    expect(exact.fits).toBe(true);
    expect(over.fits).toBe(false);
    expect(over.frames[0].lines).toEqual([]);
  });

  it.each([
    { name: 'space before', paragraph: { start: 0, end: 1, spaceBeforeMm: 8 } },
    { name: 'space after', paragraph: { start: 0, end: 1, spaceAfterMm: 8 } },
    { name: 'border padding', paragraph: { start: 0, end: 1, borderPaddingMm: 4 } },
  ])('rejects a vertical paragraph whose $name exceeds the complete block capacity', ({ paragraph }) => {
    const result = flowPaperText('A', { ...spec, vertical: true }, [frame('f', col(0, 0, 5, 100))], measure, [], {
      paragraphs: [paragraph],
    });
    expect(result.frames[0].lines).toEqual([]);
    expect(result.fits).toBe(false);
  });

  it.each([
    { name: 'first-line indent', paragraph: { start: 0, end: 3, firstLineIndentMm: 2 } },
    { name: 'left/right indents', paragraph: { start: 0, end: 3, leftIndentMm: 1, rightIndentMm: 1 } },
    { name: 'hanging indent', paragraph: { start: 0, end: 3, leftIndentMm: 2, hangingIndentMm: 1 } },
    { name: 'drop-cap reserve', paragraph: { start: 0, end: 3, contentStart: 0, dropCapLines: 2 } },
  ])('applies $name to inline capacity in horizontal and vertical writing', ({ paragraph }) => {
    const metrics = { paragraphs: [paragraph] };
    const horizontal = flowPaperText('A B', spec, [frame('h', col(0, 0, 6, 20))], measure, [], metrics);
    const vertical = flowPaperText('A B', { ...spec, vertical: true }, [frame('v', col(0, 0, 20, 6))], measure, [], metrics);
    expect(horizontal.frames[0].lines[0]?.text).toBe('A');
    expect(vertical.frames[0].lines[0]?.text).toBe('A');
    for (const line of [...horizontal.frames[0].lines, ...vertical.frames[0].lines]) {
      expect(Number.isFinite(line.widthMm)).toBe(true);
      expect(line.widthMm).toBeGreaterThanOrEqual(0);
    }
  });

  it('sanitizes non-finite/negative geometry without emitting a negative or NaN line metric', () => {
    const metrics = {
      paragraphs: [{
        start: 0,
        end: 3,
        leftIndentMm: Number.NaN,
        rightIndentMm: Number.POSITIVE_INFINITY,
        firstLineIndentMm: Number.NEGATIVE_INFINITY,
        borderPaddingMm: -4,
        spaceBeforeMm: Number.NaN,
        spaceAfterMm: -2,
      }],
    };
    for (const vertical of [false, true]) {
      const result = flowPaperText('A B', { ...spec, vertical }, [frame('f', col(0, 0, 20, 20))], measure, [], metrics);
      expect(result.fits).toBe(true);
      for (const line of result.frames[0].lines) {
        expect(Number.isFinite(line.widthMm)).toBe(true);
        expect(line.widthMm).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(line.xMm)).toBe(true);
        expect(Number.isFinite(line.yMm)).toBe(true);
      }
    }
  });

  it('makes no progress rather than publishing NaN width when a measurer is invalid', () => {
    const result = flowPaperText('A', spec, [frame('f', col(0, 0, 20, 20))], () => Number.NaN);
    expect(result.frames[0].lines).toEqual([]);
    expect(result.fits).toBe(false);
    expect(result.overset).toBe('A');
  });

  it('right-aligns and centers lines using the measured width', () => {
    const right = flowPaperText('aa', { ...spec, align: 'right' }, [frame('f1', col(0, 0, 10, 12))], measure);
    expect(right.frames[0].lines[0].xMm).toBeCloseTo(10 - 4); // width 'aa' = 4mm, right edge 10
    const center = flowPaperText('aa', { ...spec, align: 'center' }, [frame('f1', col(0, 0, 10, 12))], measure);
    expect(center.frames[0].lines[0].xMm).toBeCloseTo((10 - 4) / 2);
  });

  it('places a single over-wide word alone rather than looping forever', () => {
    const result = flowPaperText('aaaaaaaa bb', spec, [frame('f1', col(0, 0, 6, 30))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['aaaaaaaa', 'bb']);
    expect(result.overset).toBe('');
  });
});

describe('flowPaperText Japanese line breaking (no inter-character spaces)', () => {
  it('breaks CJK text per character instead of treating a paragraph as one giant word', () => {
    // 2mm/char: a 5mm-wide column holds 2 chars per line (4mm), a 3rd would be 6mm.
    const result = flowPaperText('あいうえお', spec, [frame('f1', col(0, 0, 5, 30))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['あい', 'うえ', 'お']);
    expect(result.overset).toBe('');
  });

  it('does not start a line with closing punctuation (行頭禁則 → 追い込み)', () => {
    // Without kinsoku the 。would begin line 2; instead it is pulled up onto line 1 (slight overflow).
    const result = flowPaperText('あい。う', spec, [frame('f1', col(0, 0, 5, 30))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['あい。', 'う']);
  });

  it('does not end a line with an opening bracket (行末禁則 → push down)', () => {
    // The 「 would otherwise end line 1; it is pushed down to open line 2 next to its quote.
    const result = flowPaperText('あ「いう', spec, [frame('f1', col(0, 0, 5, 30))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['あ', '「い', 'う']);
  });

  it('still wraps Latin words on spaces (kinsoku only bites CJK punctuation)', () => {
    const result = flowPaperText('aa bb cc', spec, [frame('f1', col(0, 0, 10, 12))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['aa bb', 'cc']);
  });
});

describe('flowPaperText vertical writing (縦書き) capacity + overset', () => {
  const vspec: PaperTextFlowTypeSpec = { ...spec, vertical: true };

  it('bounds a line by the frame HEIGHT and advances lines across the WIDTH (right-to-left)', () => {
    // leading ≈4.233mm/line. Height 5mm → 2 chars per line; width 9mm → 2 lines fit → 'お' is overset.
    const result = flowPaperText('あいうえお', vspec, [frame('f1', col(0, 0, 9, 5))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['あい', 'うえ']);
    expect(result.fits).toBe(false);
    expect(result.overset).toBe('お');
  });

  it('fits when the frame is wide enough for every text-line', () => {
    // Width 15mm → 3 lines fit; height 5mm → 2 chars each → all of あいうえお lands.
    const result = flowPaperText('あいうえお', vspec, [frame('f1', col(0, 0, 15, 5))], measure);
    expect(result.frames[0].lines.map((line) => line.text)).toEqual(['あい', 'うえ', 'お']);
    expect(result.fits).toBe(true);
    expect(result.overset).toBe('');
  });

  it('marches successive text-lines leftward from the right edge (vertical-rl)', () => {
    const result = flowPaperText('あいうえ', vspec, [frame('f1', col(0, 0, 15, 5))], measure);
    const [first, second] = result.frames[0].lines;
    // First line sits at the right; the second is one leading to its left.
    expect(first.xMm).toBeGreaterThan(second.xMm);
  });
});

describe('flowPaperText runaround (text wrap)', () => {
  // Obstacle covering the left 20mm of the column for the first line band only (y ≈ 0..4.23mm).
  const leftObstacle: PaperTextFlowExclusion = {
    points: [
      { xMm: 0, yMm: -10 },
      { xMm: 20, yMm: -10 },
      { xMm: 20, yMm: 4 },
      { xMm: 0, yMm: 4 },
    ],
  };

  it('flows text into the widest clear band beside a left-side obstacle', () => {
    const result = flowPaperText(
      'aa bb cc dd ee ff gg hh ii jj kk',
      spec,
      [frame('f1', col(0, 0, 40, 100))],
      measure,
      [leftObstacle],
    );
    const [first, second] = result.frames[0].lines;
    // First band is narrowed to [20,40]; the line shifts right and holds fewer words.
    expect(first).toMatchObject({ text: 'aa bb cc', xMm: 20 });
    // Below the obstacle the full 40mm column returns.
    expect(second.xMm).toBe(0);
    expect(second.text.startsWith('dd')).toBe(true);
  });

  it('skips a fully blocked band so text resumes below a full-width obstacle (jump object)', () => {
    const fullWidth: PaperTextFlowExclusion = {
      points: [
        { xMm: -5, yMm: -10 },
        { xMm: 45, yMm: -10 },
        { xMm: 45, yMm: 4 },
        { xMm: -5, yMm: 4 },
      ],
    };
    const result = flowPaperText('aa bb cc', spec, [frame('f1', col(0, 0, 40, 100))], measure, [fullWidth]);
    const [first] = result.frames[0].lines;
    expect(first.yMm).toBeCloseTo(4.2333, 2); // pushed down past the blocked first band
    expect(first.text).toBe('aa bb cc');
  });

  it('keeps a standoff gap between the text and the obstacle', () => {
    const withStandoff: PaperTextFlowExclusion = {
      points: [
        { xMm: 0, yMm: -10 },
        { xMm: 10, yMm: -10 },
        { xMm: 10, yMm: 4 },
        { xMm: 0, yMm: 4 },
      ],
      standoffMm: 5,
    };
    const result = flowPaperText('aa bb', spec, [frame('f1', col(0, 0, 40, 100))], measure, [withStandoff]);
    expect(result.frames[0].lines[0].xMm).toBe(15); // obstacle right edge 10 + 5mm standoff
  });
});
