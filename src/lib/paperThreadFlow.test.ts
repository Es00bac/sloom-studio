import { describe, expect, it } from 'vitest';
import type { PaperFrame, PaperRichParagraph } from '../types/paper';
import { computePaperThreadSlices, paperTypographyToTextFlowSpec, resolvePaperThreadedFrames } from './paperThreadFlow';
import { flattenPaperRichText } from './paperRichText';
import type { PaperTextMeasurer } from './paperTextFlow';

const measure: PaperTextMeasurer = (text) => text.length * 2;

const typography = {
  fontFamily: 'Test', fontSizePt: 10, leadingPt: 12, tracking: 0,
  align: 'left' as const, hyphenate: false, color: '#000', fontWeight: '400', fontStyle: 'normal' as const,
};

const textFrame = (patch: Partial<PaperFrame>): PaperFrame => ({
  id: 'f', kind: 'text', xMm: 0, yMm: 0, widthMm: 12, heightMm: 5, columns: 1, text: '', typography, ...patch,
} as PaperFrame);

describe('computePaperThreadSlices', () => {
  it('projects the authoritative head story into output-frame slices without mutating source frames', () => {
    const frames = [
      textFrame({ id: 'head', threadId: 'story', threadOrder: 1, text: 'aa bb cc dd' }),
      textFrame({ id: 'tail', threadId: 'story', threadOrder: 2, text: 'stale continuation' }),
    ];
    const projected = resolvePaperThreadedFrames(frames, measure);

    expect(projected.map((item) => item.text).join('')).toBe('aa bb cc dd');
    expect(projected[1].text).not.toBe('stale continuation');
    expect(frames[0].text).toBe('aa bb cc dd');
    expect(frames[1].text).toBe('stale continuation');
  });
  it('copies width-affecting frame typography into the optional flow contract exactly', () => {
    expect(paperTypographyToTextFlowSpec({
      ...typography,
      fontStretch: '82.5%',
      fontVariationSettings: { wdth: 82.5, wght: 540 },
      fontKerning: 'none',
    })).toMatchObject({
      fontStretch: '82.5%',
      fontVariationSettings: { wdth: 82.5, wght: 540 },
      fontKerning: 'none',
    });
  });

  it('flows the head story across thread members', () => {
    const frames = [
      textFrame({ id: 'head', threadId: 't1', threadOrder: 1, text: 'aa bb cc dd' }),
      textFrame({ id: 'tail', threadId: 't1', threadOrder: 2 }),
    ];
    const slices = computePaperThreadSlices(frames, measure);
    expect(slices.get('head')?.sourceText).toBe('aa bb');
    expect(slices.get('head')?.isHead).toBe(true);
    expect(slices.get('tail')?.sourceText).toBe(' cc dd');
    expect(slices.get('tail')?.isHead).toBe(false);
    expect(slices.get('tail')?.isOverset).toBe(false);
  });

  it('flags overset on the last frame when the story does not fit the thread', () => {
    const frames = [
      textFrame({ id: 'head', threadId: 't1', threadOrder: 1, text: 'aa bb cc dd ee ff' }),
      textFrame({ id: 'tail', threadId: 't1', threadOrder: 2 }),
    ];
    expect(computePaperThreadSlices(frames, measure).get('tail')?.isOverset).toBe(true);
  });

  it('ignores single-frame threads and non-threaded frames', () => {
    const frames = [
      textFrame({ id: 'solo', threadId: 't1', threadOrder: 1, text: 'aa bb' }),
      textFrame({ id: 'plain', text: 'cc dd' }),
    ];
    expect(computePaperThreadSlices(frames, measure).size).toBe(0);
  });

  it('leaves plain (non-rich) thread slices without a rich payload', () => {
    const frames = [
      textFrame({ id: 'head', threadId: 't1', threadOrder: 1, text: 'aa bb cc dd' }),
      textFrame({ id: 'tail', threadId: 't1', threadOrder: 2 }),
    ];
    const slices = computePaperThreadSlices(frames, measure);
    expect(slices.get('head')?.richText).toBeUndefined();
    expect(slices.get('tail')?.richText).toBeUndefined();
  });

  it.each([
    { delimiter: '\n', widthMm: 100 },
    { delimiter: '\r', widthMm: 2 },
    { delimiter: '\r\n', widthMm: 100 },
  ])(
    'conserves a plain authored $delimiter across threaded and overset boundaries',
    ({ delimiter, widthMm }) => {
      const story = `A${delimiter}B`;
      const frames = [
        textFrame({ id: 'head', threadId: 'plain-delimiter', threadOrder: 1, widthMm, text: story }),
        textFrame({ id: 'tail', threadId: 'plain-delimiter', threadOrder: 2, widthMm: 100 }),
      ];
      const slices = computePaperThreadSlices(frames, measure);
      const head = slices.get('head')!;
      const tail = slices.get('tail')!;

      expect([head.sourceText, tail.sourceText]).toEqual(['A', `${delimiter}B`]);
      expect(head.sourceEnd).toBe(tail.sourceStart);
      expect(head.sourceText + tail.sourceText).toBe(story);

      const oversetFrames = frames.slice(0, 1);
      const oversetSlice = computePaperThreadSlices([
        ...oversetFrames,
        textFrame({
          id: 'blocked-tail', threadId: 'plain-delimiter', threadOrder: 2, widthMm: 100, heightMm: 0,
        }),
      ], measure).get('blocked-tail')!;
      expect(story.slice(oversetSlice.sourceEnd)).toBe(`${delimiter}B`);
      expect(oversetSlice.isOverset).toBe(true);
    },
  );
});

describe('computePaperThreadSlices — rich (formatted) stories', () => {
  const fragment = (paragraph: PaperRichParagraph, ownsParagraphStart = true, ownsParagraphEnd = true) => ({
    ...paragraph,
    ownsParagraphStart,
    ownsParagraphEnd,
  });
  // Head richText whose flatten is 'Hello bold\nitalic link\nthird para': each ~one-line paragraph fills one
  // single-line frame, so the story flows head → mid → tail with a paragraph break at each frame boundary.
  const richHeadStory: PaperRichParagraph[] = [
    { runs: [{ text: 'Hello ' }, { text: 'bold', fontWeight: '700' }] },
    { runs: [{ text: 'italic', fontStyle: 'italic' }, { text: ' link', link: 'https://u' }] },
    { runs: [{ text: 'third para' }] },
  ];
  const wideLine = (patch: Partial<PaperFrame>): PaperFrame =>
    textFrame({ widthMm: 40, heightMm: 5, columns: 1, ...patch });

  it('flows a three-frame mixed-format story so each visible frame owns exactly its contiguous rich slice', () => {
    const frames = [
      wideLine({ id: 'head', threadId: 't', threadOrder: 1, richText: richHeadStory, text: flattenPaperRichText(richHeadStory) }),
      wideLine({ id: 'mid', threadId: 't', threadOrder: 2 }),
      wideLine({ id: 'tail', threadId: 't', threadOrder: 3 }),
    ];
    const slices = computePaperThreadSlices(frames, measure);

    // Head keeps its bold; continuations keep italic + link, and the plain third paragraph.
    expect(slices.get('head')?.richText).toEqual([fragment({ runs: [{ text: 'Hello ' }, { text: 'bold', fontWeight: '700' }] })]);
    expect(slices.get('mid')?.richText).toEqual([fragment({ runs: [{ text: 'italic', fontStyle: 'italic' }, { text: ' link', link: 'https://u' }] })]);
    expect(slices.get('tail')?.richText).toEqual([fragment({ runs: [{ text: 'third para' }] })]);
    expect(slices.get('head')?.isHead).toBe(true);
    expect(slices.get('mid')?.isHead).toBe(false);
    expect(slices.get('tail')?.isHead).toBe(false);
  });

  it('threads inline run newlines without converting them into structural paragraphs or changing style ownership', () => {
    const inlineNewlineStory: PaperRichParagraph[] = [
      { id: 'p-bold', runs: [{ id: 'r-bold', text: 'A\nB', fontWeight: '700', emphasis: 'dot' }] },
      { id: 'p-italic', runs: [{ id: 'r-italic', text: 'C', fontStyle: 'italic', link: 'https://example.test' }] },
    ];
    const story = flattenPaperRichText(inlineNewlineStory);
    const snapshot = structuredClone(inlineNewlineStory);
    const frames = [
      textFrame({
        id: 'head', threadId: 'inline-newline', threadOrder: 1, widthMm: 100, heightMm: 40,
        richText: inlineNewlineStory, text: story,
      }),
      textFrame({ id: 'tail', threadId: 'inline-newline', threadOrder: 2, widthMm: 100, heightMm: 5 }),
    ];

    const head = computePaperThreadSlices(frames, measure).get('head')!;
    expect([head.sourceStart, head.sourceEnd, head.sourceText]).toEqual([0, 5, 'A\nB\nC']);
    expect(flattenPaperRichText(head.richText)).toBe(head.sourceText);
    expect(head.richText).toEqual([
      fragment({ id: 'p-bold', runs: [{ id: 'r-bold', text: 'A\nB', fontWeight: '700', emphasis: 'dot' }] }),
      fragment({ id: 'p-italic', runs: [{ id: 'r-italic', text: 'C', fontStyle: 'italic', link: 'https://example.test' }] }),
    ]);
    expect(inlineNewlineStory).toEqual(snapshot);
    expect(frames[0].richText).toBe(inlineNewlineStory);
  });

  it.each([
    { delimiter: '\n', widthMm: 100 },
    { delimiter: '\r', widthMm: 2 },
    { delimiter: '\r\n', widthMm: 100 },
  ])('owns an inline $delimiter exactly once when a rich run splits at its boundary', ({ delimiter, widthMm }) => {
    const richText: PaperRichParagraph[] = [{
      id: 'inline-paragraph',
      runs: [{ id: 'inline-run', text: `A${delimiter}B`, fontWeight: '700', link: 'https://example.test' }],
    }];
    const story = flattenPaperRichText(richText);
    const snapshot = structuredClone(richText);
    const frames = [
      textFrame({
        id: 'head', threadId: 'inline-boundary', threadOrder: 1, widthMm, heightMm: 5,
        richText, text: story,
      }),
      textFrame({ id: 'tail', threadId: 'inline-boundary', threadOrder: 2, widthMm: 100, heightMm: 5 }),
    ];

    const slices = computePaperThreadSlices(frames, measure);
    const head = slices.get('head')!;
    const tail = slices.get('tail')!;
    expect([head.sourceStart, head.sourceEnd, head.sourceText]).toEqual([0, 1, 'A']);
    expect([tail.sourceStart, tail.sourceEnd, tail.sourceText]).toEqual([1, story.length, `${delimiter}B`]);
    expect(flattenPaperRichText(head.richText) + flattenPaperRichText(tail.richText)).toBe(story);
    expect(tail.richText?.[0].runs).toEqual([{
      id: 'inline-run', text: `${delimiter}B`, fontWeight: '700', link: 'https://example.test',
    }]);
    expect(richText).toEqual(snapshot);
    expect(frames[0].richText).toBe(richText);
  });

  it('owns consecutive inline delimiters at frame start/end without treating them as blank paragraphs', () => {
    const richText: PaperRichParagraph[] = [{
      id: 'inline-consecutive',
      runs: [{ id: 'inline-consecutive-run', text: 'A\n\nB', fontStyle: 'italic' }],
    }];
    const story = flattenPaperRichText(richText);
    const frames = Array.from({ length: 3 }, (_, index) => textFrame({
      id: `inline-${index}`,
      threadId: 'inline-consecutive',
      threadOrder: index + 1,
      widthMm: 100,
      heightMm: 5,
      ...(index === 0 ? { richText, text: story } : {}),
    }));
    const slices = computePaperThreadSlices(frames, measure);
    const ordered = frames.map((entry) => slices.get(entry.id)!);

    expect(ordered.map((entry) => entry.sourceText)).toEqual(['A', '\n', '\nB']);
    expect(ordered.map((entry) => flattenPaperRichText(entry.richText)).join('')).toBe(story);
    expect(ordered.map((entry) => [entry.sourceStart, entry.sourceEnd])).toEqual([[0, 1], [1, 2], [2, 4]]);
  });

  it('distinguishes an inline newline adjacent to an equal structural paragraph separator', () => {
    const richText: PaperRichParagraph[] = [
      { id: 'inline-source', runs: [{ id: 'inline-source-run', text: 'A\nB', fontWeight: '700' }] },
      { id: 'structural-tail', runs: [{ id: 'structural-tail-run', text: 'C', fontStyle: 'italic' }] },
    ];
    const story = flattenPaperRichText(richText);
    const frames = [
      textFrame({
        id: 'head', threadId: 'adjacent', threadOrder: 1, widthMm: 100, heightMm: 9,
        richText, text: story,
      }),
      textFrame({ id: 'tail', threadId: 'adjacent', threadOrder: 2, widthMm: 100, heightMm: 5 }),
    ];
    const slices = computePaperThreadSlices(frames, measure);
    const head = slices.get('head')!;
    const tail = slices.get('tail')!;

    expect(head.sourceText).toBe('A\nB');
    expect(flattenPaperRichText(head.richText)).toBe('A\nB');
    expect(tail.sourceText).toBe('C');
    expect(story.slice(head.sourceEnd, tail.sourceStart)).toBe('\n');
    expect(head.sourceEnd).toBe(3);
    expect(tail.sourceStart).toBe(4);
  });

  it('conserves styled multi-run source ranges and the exact overset tail without mutating the story', () => {
    const richText: PaperRichParagraph[] = [
      {
        id: 'p-one',
        runs: [
          { id: 'r-bold', text: 'A\nB', fontWeight: '700' },
          { id: 'r-italic', text: '\rC', fontStyle: 'italic' },
        ],
      },
      { id: 'p-blank', runs: [{ id: 'r-blank', text: '' }] },
      {
        id: 'p-list',
        listMarker: '•',
        runs: [{ id: 'r-link', text: 'D\r\nE', link: 'https://example.test' }],
      },
    ];
    const story = flattenPaperRichText(richText);
    const snapshot = structuredClone(richText);
    const frames = Array.from({ length: 4 }, (_, index) => textFrame({
      id: `styled-${index}`,
      threadId: 'styled-overset',
      threadOrder: index + 1,
      widthMm: 100,
      heightMm: 5,
      ...(index === 0 ? { richText, text: story } : {}),
    }));
    const slices = computePaperThreadSlices(frames, measure);
    const ordered = frames.map((entry) => slices.get(entry.id)!);
    const overset = story.slice(ordered.at(-1)!.sourceEnd);

    for (const slice of ordered) {
      expect(flattenPaperRichText(slice.richText)).toBe(story.slice(slice.sourceStart, slice.sourceEnd));
    }
    expect(ordered[0].sourceStart).toBe(0);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      expect(ordered[index].sourceEnd).toBe(ordered[index + 1].sourceStart);
    }
    expect(ordered.map((entry) => entry.sourceText).join('') + overset).toBe(story);
    expect(overset).toBe('\r\nE');
    expect(ordered.at(-1)?.isOverset).toBe(true);
    expect(ordered.some((entry) => entry.richText?.some((paragraph) => paragraph.listMarker === '•'))).toBe(true);
    expect(richText).toEqual(snapshot);
    expect(frames[0].richText).toBe(richText);
  });

  it('flattens the non-overset slices back to the whole story with no duplication or loss', () => {
    const frames = [
      wideLine({ id: 'head', threadId: 't', threadOrder: 1, richText: richHeadStory, text: flattenPaperRichText(richHeadStory) }),
      wideLine({ id: 'mid', threadId: 't', threadOrder: 2 }),
      wideLine({ id: 'tail', threadId: 't', threadOrder: 3 }),
    ];
    const slices = computePaperThreadSlices(frames, measure);
    const story = flattenPaperRichText(richHeadStory);
    const ordered = ['head', 'mid', 'tail'].map((id) => slices.get(id)!);

    // Each slice reproduces exactly its authoritative offset window...
    for (const slice of ordered) {
      expect(flattenPaperRichText(slice.richText!)).toBe(story.slice(slice.sourceStart, slice.sourceEnd));
    }
    // ...windows are ordered, disjoint (no duplication), and cover the whole story; the only gaps are the
    // inter-frame separators (a single '\n' paragraph break here), which is the intentional separator policy.
    expect(ordered[0].sourceStart).toBe(0);
    expect(ordered[2].sourceEnd).toBe(story.length);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(ordered[i].sourceEnd).toBeLessThanOrEqual(ordered[i + 1].sourceStart);
      expect(story.slice(ordered[i].sourceEnd, ordered[i + 1].sourceStart)).toMatch(/^\s*$/);
    }
  });

  it('keeps a run split across a frame boundary formatted in both frames, once each (mid-paragraph)', () => {
    // Single paragraph 'aa bb cc' where 'bb cc' is bold; the narrow single-line frames split it as
    // 'aa bb' | 'cc', so the bold run appears trimmed in the head and again (only its tail) in the continuation.
    const midRunStory: PaperRichParagraph[] = [{ runs: [{ text: 'aa ' }, { text: 'bb cc', fontWeight: '700' }] }];
    const frames = [
      textFrame({ id: 'head', threadId: 't2', threadOrder: 1, widthMm: 12, heightMm: 5, columns: 1, richText: midRunStory, text: flattenPaperRichText(midRunStory) }),
      textFrame({ id: 'tail', threadId: 't2', threadOrder: 2, widthMm: 12, heightMm: 5, columns: 1 }),
    ];
    const slices = computePaperThreadSlices(frames, measure);
    expect(slices.get('head')?.richText).toEqual([fragment({ runs: [{ text: 'aa ' }, { text: 'bb', fontWeight: '700' }] }, true, false)]);
    expect(slices.get('tail')?.richText).toEqual([fragment({ runs: [{ text: ' cc', fontWeight: '700' }] }, false, true)]);
    // Rich source ownership is conservative: the authored word separator belongs to the continuation range.
    const story = flattenPaperRichText(midRunStory);
    const head = slices.get('head')!;
    const tail = slices.get('tail')!;
    expect(story.slice(head.sourceEnd, tail.sourceStart)).toBe('');
  });

  it('never mutates or fragments the stored head richText while computing slices', () => {
    const frames = [
      wideLine({ id: 'head', threadId: 't', threadOrder: 1, richText: richHeadStory, text: flattenPaperRichText(richHeadStory) }),
      wideLine({ id: 'mid', threadId: 't', threadOrder: 2 }),
      wideLine({ id: 'tail', threadId: 't', threadOrder: 3 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(richHeadStory));
    computePaperThreadSlices(frames, measure);
    expect(frames[0].richText).toEqual(snapshot);
    expect(frames[0].richText).toBe(richHeadStory); // same reference — not replaced
  });

  it.each([
    { paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: '' }] }, { runs: [{ text: 'B' }] }], tailHeightMm: 9, expected: '\nB' },
    { paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: '' }] }, { runs: [{ text: '' }] }, { runs: [{ text: 'B' }] }], tailHeightMm: 13, expected: '\n\nB' },
  ] as Array<{ paragraphs: PaperRichParagraph[]; tailHeightMm: number; expected: string }>)('retains rich blank paragraphs at a frame boundary ($expected)', ({ paragraphs, tailHeightMm, expected }) => {
    const frames = [
      textFrame({ id: 'head', threadId: 'blank', threadOrder: 1, widthMm: 100, heightMm: 5, richText: paragraphs, text: flattenPaperRichText(paragraphs) }),
      textFrame({ id: 'tail', threadId: 'blank', threadOrder: 2, widthMm: 100, heightMm: tailHeightMm }),
    ];
    const slice = computePaperThreadSlices(frames, measure).get('tail')!;
    expect(slice.sourceText).toBe(expected);
    expect(flattenPaperRichText(slice.richText)).toBe(expected);
    expect(slice.richText?.slice(0, -1).every((paragraph) => paragraph.runs[0].text === '')).toBe(true);
  });

  it('keeps every list prefix atomic and preserves the rich/plain coordinate invariant across a flow matrix', () => {
    const stories: PaperRichParagraph[][] = [
      [{ runs: [{ text: 'alpha beta gamma' }], listMarker: '•' }],
      [{ runs: [{ text: 'one two' }], listMarker: '10.' }, { runs: [{ text: 'three four' }], listMarker: '→' }],
      [{ runs: [{ text: 'plain' }] }, { runs: [{ text: 'mixed item words' }], listMarker: 'LONG' }],
    ];
    for (const richText of stories) {
      const story = flattenPaperRichText(richText);
      for (const widthMm of [2, 4, 7, 11, 19]) {
        for (const heightMm of [5, 9, 13]) {
          const frames = Array.from({ length: 8 }, (_, index) => textFrame({
            id: `f-${index}`,
            threadId: 'atomic',
            threadOrder: index + 1,
            widthMm,
            heightMm,
            ...(index === 0 ? { richText, text: story } : {}),
          }));
          const slices = computePaperThreadSlices(frames, measure);
          for (const slice of slices.values()) {
            expect(flattenPaperRichText(slice.richText)).toBe(story.slice(slice.sourceStart, slice.sourceEnd));
          }
          let cursor = 0;
          richText.forEach((paragraph, paragraphIndex) => {
            if (paragraphIndex > 0) cursor += 1;
            if (paragraph.listMarker) {
              const prefixEnd = cursor + paragraph.listMarker.length + 1;
              for (const slice of slices.values()) {
                expect(slice.sourceStart > cursor && slice.sourceStart < prefixEnd).toBe(false);
                expect(slice.sourceEnd > cursor && slice.sourceEnd < prefixEnd).toBe(false);
              }
              cursor = prefixEnd;
            }
            cursor += paragraph.runs.reduce((length, run) => length + run.text.length, 0);
          });
        }
      }
    }
  });

  it('uses mixed run size/leading and destination-frame typography without omitting styled text', () => {
    const richText: PaperRichParagraph[] = [{
      runs: [
        { text: 'small ' },
        { text: 'GIANT', fontSizePt: 36, leadingPt: 44, fontWeight: '700' },
        { text: ' tail' },
      ],
    }];
    const story = flattenPaperRichText(richText);
    const destinationTypography = { ...typography, fontSizePt: 18, leadingPt: 22 };
    const sizeAwareMeasure: PaperTextMeasurer = (text, typeSpec) => text.length * typeSpec.fontSizePt * 0.12;
    const frames = [
      textFrame({ id: 'head', threadId: 'metrics', threadOrder: 1, widthMm: 20, heightMm: 5, richText, text: story }),
      textFrame({ id: 'large', threadId: 'metrics', threadOrder: 2, widthMm: 30, heightMm: 17, typography: destinationTypography }),
      textFrame({ id: 'tail', threadId: 'metrics', threadOrder: 3, widthMm: 30, heightMm: 10 }),
    ];
    const slices = computePaperThreadSlices(frames, sizeAwareMeasure);
    const ordered = frames.map((frame) => slices.get(frame.id)!);

    expect(ordered[0].sourceText).toBe('small');
    expect(ordered[1].sourceText).toBe(' GIANT');
    expect(ordered[2].sourceText).toBe(' tail');
    expect(ordered[2].sourceEnd).toBe(story.length);
    expect(ordered.map((slice) => flattenPaperRichText(slice.richText)).join('')).toBe('small GIANT tail');
  });

  it('reflows unset rich runs using each continuation frame typography', () => {
    const richText: PaperRichParagraph[] = [{ runs: [{ text: 'one two three' }] }];
    const story = flattenPaperRichText(richText);
    const sizeAwareMeasure: PaperTextMeasurer = (text, typeSpec) => text.length * typeSpec.fontSizePt * 0.2;
    const frames = [
      textFrame({ id: 'head', threadId: 'dest', threadOrder: 1, widthMm: 13, heightMm: 5, richText, text: story }),
      textFrame({ id: 'large-dest', threadId: 'dest', threadOrder: 2, widthMm: 30, heightMm: 13, typography: { ...typography, fontSizePt: 30, leadingPt: 36 } }),
      textFrame({ id: 'tail', threadId: 'dest', threadOrder: 3, widthMm: 15, heightMm: 5 }),
    ];
    const slices = computePaperThreadSlices(frames, sizeAwareMeasure);
    expect(slices.get('head')?.sourceText).toBe('one');
    expect(slices.get('large-dest')?.sourceText).toBe(' two');
    expect(slices.get('tail')?.sourceText).toBe(' three');
    expect(slices.get('tail')?.sourceEnd).toBe(story.length);
  });

  it('uses paragraph leading, spacing, and first-line indent when choosing rich boundaries', () => {
    const cases: Array<{
      richText: PaperRichParagraph[];
      frames: PaperFrame[];
      expected: string[];
    }> = [
      {
        richText: [{ runs: [{ text: 'aa bb' }], leadingPt: 20 }],
        frames: [
          textFrame({ id: 'leading-head', threadId: 'paragraph', threadOrder: 1, widthMm: 10, heightMm: 5 }),
          textFrame({ id: 'leading-tail', threadId: 'paragraph', threadOrder: 2, widthMm: 10, heightMm: 8 }),
        ],
        expected: ['', 'aa bb'],
      },
      {
        richText: [{ runs: [{ text: 'aa bb' }], spaceBeforeMm: 4 }],
        frames: [
          textFrame({ id: 'spacing-head', threadId: 'paragraph', threadOrder: 1, widthMm: 10, heightMm: 5 }),
          textFrame({ id: 'spacing-tail', threadId: 'paragraph', threadOrder: 2, widthMm: 10, heightMm: 9 }),
        ],
        expected: ['', 'aa bb'],
      },
      {
        richText: [{ runs: [{ text: 'aa bb' }], firstLineIndentMm: 6 }],
        frames: [
          textFrame({ id: 'indent-head', threadId: 'paragraph', threadOrder: 1, widthMm: 10, heightMm: 5 }),
          textFrame({ id: 'indent-tail', threadId: 'paragraph', threadOrder: 2, widthMm: 10, heightMm: 5 }),
        ],
        expected: ['aa', ' bb'],
      },
    ];

    for (const fixture of cases) {
      const story = flattenPaperRichText(fixture.richText);
      fixture.frames[0] = { ...fixture.frames[0], richText: fixture.richText, text: story };
      const slices = computePaperThreadSlices(fixture.frames, measure);
      expect(fixture.frames.map((frame) => slices.get(frame.id)?.sourceText)).toEqual(fixture.expected);
      expect(slices.get(fixture.frames.at(-1)!.id)?.sourceEnd).toBe(story.length);
    }
  });

  it.each(['\n\nA', 'A\n\n', 'A\n\nB', '\n\n'])('keeps plain/rich range parity for edge and blank-only paragraphs: %j', (story) => {
    const richText = story.split('\n').map((text) => ({ runs: [{ text }] }));
    const frames = [
      textFrame({ id: 'head', threadId: 'edges', threadOrder: 1, widthMm: 100, heightMm: 40, richText, text: story }),
      textFrame({ id: 'tail', threadId: 'edges', threadOrder: 2, widthMm: 100, heightMm: 5 }),
    ];
    const slice = computePaperThreadSlices(frames, measure).get('head')!;
    expect(slice.sourceText).toBe(story);
    expect(flattenPaperRichText(slice.richText)).toBe(story);
    expect(story.slice(slice.sourceStart, slice.sourceEnd)).toBe(story);
  });

  it('propagates stretch, variation coordinates, and kerning into rich flow and changes boundaries observably', () => {
    const richText: PaperRichParagraph[] = [{
      runs: [
        { text: 'aa', fontStretch: '150%' },
        { text: ' bb', fontVariationSettings: { wdth: 75, wght: 620 } },
        { text: ' cc', fontKerning: 'none' },
      ],
    }];
    const seen: Array<{ text: string; stretch?: string; variations?: Record<string, number>; kerning?: string }> = [];
    const metricAwareMeasure: PaperTextMeasurer = (text, typeSpec) => {
      seen.push({
        text,
        stretch: typeSpec.fontStretch,
        variations: typeSpec.fontVariationSettings,
        kerning: typeSpec.fontKerning,
      });
      const factor = typeSpec.fontStretch === '150%'
        ? 2
        : typeSpec.fontVariationSettings?.wdth === 75
          ? 3
          : typeSpec.fontKerning === 'none'
            ? 4
            : 1;
      return text.length * factor;
    };
    const frames = [
      textFrame({ id: 'head', threadId: 'width-metrics', threadOrder: 1, widthMm: 5, heightMm: 5, richText, text: flattenPaperRichText(richText) }),
      textFrame({ id: 'mid', threadId: 'width-metrics', threadOrder: 2, widthMm: 7, heightMm: 5 }),
      textFrame({ id: 'tail', threadId: 'width-metrics', threadOrder: 3, widthMm: 9, heightMm: 5 }),
    ];
    const slices = computePaperThreadSlices(frames, metricAwareMeasure);
    expect(frames.map((entry) => slices.get(entry.id)?.sourceText)).toEqual(['aa', ' bb', ' cc']);
    expect(seen).toContainEqual(expect.objectContaining({ stretch: '150%' }));
    expect(seen).toContainEqual(expect.objectContaining({ variations: { wdth: 75, wght: 620 } }));
    expect(seen).toContainEqual(expect.objectContaining({ kerning: 'none' }));
  });

  it.each([
    { writingMode: 'horizontal-tb' as const, richText: [{ runs: [{ text: 'A' }], spaceAfterMm: 8 }], widthMm: 100, heightMm: 5 },
    { writingMode: 'vertical-rl' as const, richText: [{ runs: [{ text: 'A' }], spaceBeforeMm: 8 }], widthMm: 5, heightMm: 100 },
  ])('reports rich $writingMode geometry as overset before accepting source ownership', ({ writingMode, richText, widthMm, heightMm }) => {
    const story = flattenPaperRichText(richText);
    const frames = [
      textFrame({
        id: 'head', threadId: 'geometry', threadOrder: 1, widthMm, heightMm,
        richText, text: story, typography: { ...typography, writingMode },
      }),
      textFrame({
        id: 'tail', threadId: 'geometry', threadOrder: 2, widthMm, heightMm,
        typography: { ...typography, writingMode },
      }),
    ];
    const slices = computePaperThreadSlices(frames, measure);
    expect(slices.get('head')?.sourceText).toBe('');
    expect(slices.get('tail')?.sourceText).toBe('');
    expect(slices.get('tail')?.isOverset).toBe(true);
  });
});
