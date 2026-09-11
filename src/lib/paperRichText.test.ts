import { describe, expect, it } from 'vitest';
import type { PaperRichParagraph } from '../types/paper';
import { flattenPaperRichText, normalizePaperRichText, paperRichTextFromPlainText, paperRunsShareStyle, slicePaperRichTextRange } from './paperRichText';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperFrame } from './paperDocument';

describe('paperRichText helpers', () => {
  it('flattens runs and paragraphs to plaintext (with list markers)', () => {
    const paras: PaperRichParagraph[] = [
      { runs: [{ text: 'Hello ' }, { text: 'bold', fontWeight: '700' }] },
      { runs: [{ text: 'Item' }], listMarker: '•' },
    ];
    expect(flattenPaperRichText(paras)).toBe('Hello bold\n•\tItem');
  });

  it('normalizes untrusted input: coerces, merges adjacent same-style runs, keeps blank lines', () => {
    const normalized = normalizePaperRichText([
      { runs: [{ text: 'a', fontWeight: '700' }, { text: 'b', fontWeight: '700' }, { text: 'c' }] },
      { runs: [] }, // blank paragraph → preserved as a single empty run
    ]);
    expect(normalized).toBeDefined();
    expect(normalized![0].runs).toEqual([{ text: 'ab', fontWeight: '700' }, { text: 'c' }]);
    expect(normalized![1].runs).toEqual([{ text: '' }]);
  });

  it('returns undefined for content with no real text (falls back to the plain path)', () => {
    expect(normalizePaperRichText([{ runs: [{ text: '' }] }])).toBeUndefined();
    expect(normalizePaperRichText([])).toBeUndefined();
    expect(normalizePaperRichText('nope')).toBeUndefined();
  });

  it('drops invalid style fields but keeps text', () => {
    const normalized = normalizePaperRichText([{ runs: [{ text: 'x', fontStyle: 'slanted', vertAlign: 'baseline', color: '   ' }] }]);
    expect(normalized![0].runs[0]).toEqual({ text: 'x' });
  });

  it('retains exact oblique, stretch, and finite variable coordinates', () => {
    const normalized = normalizePaperRichText([{ runs: [{
      text: 'variable', fontStyle: 'oblique 12deg', fontStretch: '75%',
      fontVariationSettings: { wdth: 75, wght: 640, bad: 12, opsz: Number.NaN },
    }] }]);
    expect(normalized?.[0].runs[0]).toMatchObject({
      text: 'variable', fontStyle: 'oblique 12deg', fontStretch: '75%',
      fontVariationSettings: { wdth: 75, wght: 640 },
    });
  });

  it('paperRunsShareStyle compares style, not text', () => {
    expect(paperRunsShareStyle({ text: 'a', color: '#f00' }, { text: 'b', color: '#f00' })).toBe(true);
    expect(paperRunsShareStyle({ text: 'a', color: '#f00' }, { text: 'a', color: '#0f0' })).toBe(false);
  });

  it('builds single-run paragraphs from plaintext lines', () => {
    expect(paperRichTextFromPlainText('one\ntwo')).toEqual([{ runs: [{ text: 'one' }] }, { runs: [{ text: 'two' }] }]);
  });
});

describe('rich text on frames (createPaperFrame + patchPaperFrame sync)', () => {
  it('keeps frame.text as the flattened plaintext of richText', () => {
    const base = createDefaultPaperDocument({ title: 'Rich' });
    const { document, frameId } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      xMm: 10, yMm: 10, widthMm: 80, heightMm: 25,
      richText: [{ runs: [{ text: 'Plain ' }, { text: 'italic', fontStyle: 'italic' }] }],
    });
    const frame = document.pages[0].frames.find((f) => f.id === frameId)!;
    expect(frame.richText).toBeDefined();
    expect(frame.text).toBe('Plain italic');
  });

  it('editing plain text drops the now-stale rich runs', () => {
    const base = createDefaultPaperDocument({ title: 'Rich' });
    const added = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 25,
      richText: [{ runs: [{ text: 'was ' }, { text: 'rich', fontWeight: '700' }] }],
    });
    const edited = updatePaperFrame(added.document, added.document.pages[0].id, added.frameId, { text: 'now plain' });
    const frame = edited.pages[0].frames.find((f) => f.id === added.frameId)!;
    expect(frame.text).toBe('now plain');
    expect(frame.richText).toBeUndefined();
  });

  it('patching richText re-syncs the flattened text', () => {
    const base = createDefaultPaperDocument({ title: 'Rich' });
    const added = addFrameToPaperPage(base, base.pages[0].id, { kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 25, text: 'plain' });
    const patched = updatePaperFrame(added.document, added.document.pages[0].id, added.frameId, {
      richText: [{ runs: [{ text: 'A' }, { text: 'B', color: '#ff0000' }] }],
    });
    const frame = patched.pages[0].frames.find((f) => f.id === added.frameId)!;
    expect(frame.richText).toBeDefined();
    expect(frame.text).toBe('AB');
  });
});

describe('slicePaperRichTextRange', () => {
  // flatten = 'The quick brown\nfox jumps\n•\tlazy dog'  (offsets below are into that flattened string)
  //            0.............15 16.......25 26........35
  const RICH: PaperRichParagraph[] = [
    { runs: [{ text: 'The ' }, { text: 'quick', fontWeight: '700' }, { text: ' brown' }] },
    { runs: [{ text: 'fox jumps' }], align: 'center' },
    { runs: [{ text: 'lazy', fontStyle: 'italic' }, { text: ' dog', link: 'https://x' }], listMarker: '•' },
  ];
  const fragment = (paragraph: PaperRichParagraph, ownsParagraphStart: boolean, ownsParagraphEnd: boolean) => ({
    ...paragraph,
    ownsParagraphStart,
    ownsParagraphEnd,
  });

  it('keeps the flatten/slice invariant: flatten(slice(p,s,e)) === flatten(p).slice(s,e)', () => {
    const flat = flattenPaperRichText(RICH);
    for (const [s, e] of [[0, 0], [0, 4], [4, 9], [5, 7], [0, 15], [0, 25], [16, 25], [26, 36], [28, 36], [0, 36], [11, 33]] as const) {
      expect(flattenPaperRichText(slicePaperRichTextRange(RICH, s, e))).toBe(flat.slice(s, e));
    }
  });

  it('slices mid-run and preserves that run\'s styling', () => {
    expect(slicePaperRichTextRange(RICH, 5, 7)).toEqual([fragment({ runs: [{ text: 'ui', fontWeight: '700' }] }, false, false)]);
  });

  it('slices on an exact run boundary', () => {
    expect(slicePaperRichTextRange(RICH, 0, 4)).toEqual([fragment({ runs: [{ text: 'The ' }] }, true, false)]);
    expect(slicePaperRichTextRange(RICH, 4, 9)).toEqual([fragment({ runs: [{ text: 'quick', fontWeight: '700' }] }, false, false)]);
  });

  it('preserves run boundaries when a slice spans several runs in one paragraph', () => {
    expect(slicePaperRichTextRange(RICH, 0, 9)).toEqual([
      fragment({ runs: [{ text: 'The ' }, { text: 'quick', fontWeight: '700' }] }, true, false),
    ]);
  });

  it('splits on a paragraph newline boundary, keeping per-paragraph formatting', () => {
    expect(slicePaperRichTextRange(RICH, 0, 25)).toEqual([
      fragment({ runs: [{ text: 'The ' }, { text: 'quick', fontWeight: '700' }, { text: ' brown' }] }, true, true),
      fragment({ runs: [{ text: 'fox jumps' }], align: 'center' }, true, true),
    ]);
  });

  it('preserves inline run newlines as authored text while slicing across a structural delimiter', () => {
    const inlineNewline: PaperRichParagraph[] = [
      { id: 'p-bold', runs: [{ id: 'r-bold', text: 'A\nB', fontWeight: '700', emphasis: 'dot' }] },
      { id: 'p-italic', runs: [{ id: 'r-italic', text: 'C', fontStyle: 'italic', link: 'https://example.test' }] },
    ];
    const snapshot = structuredClone(inlineNewline);
    const slice = slicePaperRichTextRange(inlineNewline, 1, 5);

    expect(flattenPaperRichText(inlineNewline)).toBe('A\nB\nC');
    expect(flattenPaperRichText(slice)).toBe('\nB\nC');
    expect(slice).toEqual([
      fragment({ id: 'p-bold', runs: [{ id: 'r-bold', text: '\nB', fontWeight: '700', emphasis: 'dot' }] }, false, true),
      fragment({ id: 'p-italic', runs: [{ id: 'r-italic', text: 'C', fontStyle: 'italic', link: 'https://example.test' }] }, true, true),
    ]);
    expect(inlineNewline).toEqual(snapshot);
  });

  it('keeps the list marker (and link/italic) when the slice owns the item\'s start', () => {
    expect(slicePaperRichTextRange(RICH, 26, 36)).toEqual([
      fragment({ runs: [{ text: 'lazy', fontStyle: 'italic' }, { text: ' dog', link: 'https://x' }], listMarker: '•' }, true, true),
    ]);
  });

  it('drops the list marker when the slice starts mid-item (continuation of the same bullet)', () => {
    expect(slicePaperRichTextRange(RICH, 30, 36)).toEqual([
      fragment({ runs: [{ text: 'zy', fontStyle: 'italic' }, { text: ' dog', link: 'https://x' }] }, false, true),
    ]);
  });

  it('returns an empty slice for an empty range', () => {
    expect(slicePaperRichTextRange(RICH, 10, 10)).toEqual([]);
  });

  it('treats an overset (end beyond length) range as reaching the end, truthfully', () => {
    expect(slicePaperRichTextRange(RICH, 26, 999)).toEqual([
      fragment({ runs: [{ text: 'lazy', fontStyle: 'italic' }, { text: ' dog', link: 'https://x' }], listMarker: '•' }, true, true),
    ]);
  });

  it('preserves blank-line paragraphs inside the range', () => {
    const withBlank: PaperRichParagraph[] = [{ runs: [{ text: 'A' }] }, { runs: [{ text: '' }] }, { runs: [{ text: 'B' }] }];
    expect(flattenPaperRichText(withBlank)).toBe('A\n\nB');
    expect(slicePaperRichTextRange(withBlank, 0, 4)).toEqual([
      fragment({ runs: [{ text: 'A' }] }, true, true),
      fragment({ runs: [{ text: '' }] }, true, true),
      fragment({ runs: [{ text: 'B' }] }, true, true),
    ]);
  });

  it.each([
    { text: '\n\nA', start: 0, end: 3 },
    { text: 'A\n\n', start: 0, end: 3 },
    { text: 'A\n\nB', start: 1, end: 2 },
    { text: '\n\n', start: 0, end: 2 },
  ])('preserves exact separator-only and edge paragraph ranges for $text[$start,$end)', ({ text, start, end }) => {
    const rich = paperRichTextFromPlainText(text);
    expect(flattenPaperRichText(slicePaperRichTextRange(rich, start, end))).toBe(text.slice(start, end));
  });

  it('disambiguates repeated text purely by offset, not by searching visible text', () => {
    // flatten = 'ababab'; the middle 'ab' is bold, the outer two are plain — identical text, distinct offsets.
    const repeated: PaperRichParagraph[] = [{ runs: [{ text: 'ab' }, { text: 'ab', fontWeight: '700' }, { text: 'ab' }] }];
    expect(slicePaperRichTextRange(repeated, 0, 2)).toEqual([fragment({ runs: [{ text: 'ab' }] }, true, false)]);
    expect(slicePaperRichTextRange(repeated, 2, 4)).toEqual([fragment({ runs: [{ text: 'ab', fontWeight: '700' }] }, false, false)]);
    expect(slicePaperRichTextRange(repeated, 4, 6)).toEqual([fragment({ runs: [{ text: 'ab' }] }, false, true)]);
  });

  it('preserves deterministic paragraph/run ids on kept content', () => {
    const withIds: PaperRichParagraph[] = [{ id: 'p1', runs: [{ id: 'r1', text: 'aa ' }, { id: 'r2', text: 'bb', fontWeight: '700' }] }];
    expect(slicePaperRichTextRange(withIds, 0, 5)).toEqual([
      fragment({ id: 'p1', runs: [{ id: 'r1', text: 'aa ' }, { id: 'r2', text: 'bb', fontWeight: '700' }] }, true, true),
    ]);
  });

  it('carries paragraph ownership and suppresses only non-owned start/end decoration', () => {
    const decorated: PaperRichParagraph[] = [{
      runs: [{ text: 'aa bb cc' }],
      align: 'center',
      leadingPt: 15,
      firstLineIndentMm: 3,
      hangingIndentMm: 2,
      leftIndentMm: 4,
      rightIndentMm: 5,
      spaceBeforeMm: 6,
      spaceAfterMm: 7,
      dropCapLines: 3,
      listMarker: '•',
      shading: '#eee',
      borders: {
        top: { color: '#111', widthPt: 1 },
        left: { color: '#222', widthPt: 1 },
        bottom: { color: '#333', widthPt: 1 },
        right: { color: '#444', widthPt: 1 },
      },
    }];
    const flat = flattenPaperRichText(decorated);
    const contentStart = flat.indexOf('aa');
    const middle = slicePaperRichTextRange(decorated, contentStart + 3, contentStart + 5)[0];

    expect(middle).toMatchObject({
      ownsParagraphStart: false,
      ownsParagraphEnd: false,
      align: 'center',
      leadingPt: 15,
      leftIndentMm: 4,
      rightIndentMm: 5,
      shading: '#eee',
      borders: {
        left: { color: '#222', widthPt: 1 },
        right: { color: '#444', widthPt: 1 },
      },
    });
    expect(middle).not.toHaveProperty('listMarker');
    expect(middle).not.toHaveProperty('dropCapLines');
    expect(middle).not.toHaveProperty('firstLineIndentMm');
    expect(middle).not.toHaveProperty('hangingIndentMm');
    expect(middle).not.toHaveProperty('spaceBeforeMm');
    expect(middle).not.toHaveProperty('spaceAfterMm');
    expect(middle.borders).not.toHaveProperty('top');
    expect(middle.borders).not.toHaveProperty('bottom');
  });

  it('keeps boundary ownership when flow omits only leading or trailing paragraph whitespace', () => {
    const spaced: PaperRichParagraph[] = [{
      runs: [{ text: '  hello  ' }],
      dropCapLines: 2,
      spaceBeforeMm: 3,
      spaceAfterMm: 4,
    }];
    expect(slicePaperRichTextRange(spaced, 2, 7)[0]).toMatchObject({
      ownsParagraphStart: true,
      ownsParagraphEnd: true,
      dropCapLines: 2,
      spaceBeforeMm: 3,
      spaceAfterMm: 4,
    });
  });

  it('never mutates the source paragraphs', () => {
    const snapshot = JSON.parse(JSON.stringify(RICH));
    slicePaperRichTextRange(RICH, 5, 30);
    expect(RICH).toEqual(snapshot);
  });
});
