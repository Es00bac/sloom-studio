import { describe, expect, it } from 'vitest';
import { flattenPaperRichText } from '../../../lib/paperRichText';
import type { PaperRichParagraph, PaperTypography } from '../../../types/paper';
import {
  BOLD_TOGGLE_PATCH,
  applyFontFamilyToRichText,
  applyTypographyPatchToRichText,
  changedRichTypographyPatch,
  ensureRichTextForTransform,
  ITALIC_TOGGLE_PATCH,
  MAX_RUN_FONT_SIZE_PT,
  MIN_RUN_FONT_SIZE_PT,
  resolveRichEditorCommit,
  stepFontSize,
  synchronizeRichTextWithTypographyChange,
  toggleParagraphBullet,
  toggleRunStyle,
  UNDERLINE_TOGGLE_PATCH,
} from './richTextTransforms';

const single = (text: string): PaperRichParagraph[] => [{ runs: [{ text }] }];

describe('applyFontFamilyToRichText', () => {
  it('replaces every explicit run family while preserving other run and paragraph formatting', () => {
    const original: PaperRichParagraph[] = [{
      align: 'center',
      runs: [
        { text: 'Woven ', fontFamily: 'Arial', fontWeight: '700' },
        { text: 'signals', fontFamily: 'Georgia', fontStyle: 'italic', color: '#123456' },
      ],
    }];

    expect(applyFontFamilyToRichText(original, 'BIZ UDPGothic')).toEqual([{
      align: 'center',
      runs: [
        { text: 'Woven ', fontFamily: 'BIZ UDPGothic', fontWeight: '700' },
        { text: 'signals', fontFamily: 'BIZ UDPGothic', fontStyle: 'italic', color: '#123456' },
      ],
    }]);
    expect(original[0].runs[0].fontFamily).toBe('Arial');
  });

  it('leaves a plain-text frame without rich runs alone', () => {
    expect(applyFontFamilyToRichText(undefined, 'BIZ UDPGothic')).toBeUndefined();
  });
});

describe('rich Inspector typography synchronization', () => {
  const baseTypography: PaperTypography = {
    fontFamily: 'Inter', fontSizePt: 12, leadingPt: 15, tracking: 0, fontKerning: 'auto', align: 'left',
    hyphenate: true, color: '#111111', fontWeight: '400', fontStyle: 'normal',
  };

  it('propagates only the changed property and preserves unrelated mixed run/paragraph styling', () => {
    const original: PaperRichParagraph[] = [{
      align: 'right',
      leadingPt: 17,
      runs: [
        { text: 'Blue', color: '#0000ff', fontFamily: 'Inter', fontWeight: '700' },
        { text: ' red', color: '#ff0000', fontFamily: 'Georgia', fontStyle: 'italic' },
      ],
    }];
    const next = { ...baseTypography, color: '#22c55e' };
    const result = synchronizeRichTextWithTypographyChange(original, baseTypography, next);

    expect(result?.[0]).toMatchObject({ align: 'right', leadingPt: 17 });
    expect(result?.[0].runs).toEqual([
      { text: 'Blue', color: '#22c55e', fontFamily: 'Inter', fontWeight: '700' },
      { text: ' red', color: '#22c55e', fontFamily: 'Georgia', fontStyle: 'italic' },
    ]);
  });

  it('supports exact false, zero, and undefined values instead of treating them as absent patches', () => {
    const original: PaperRichParagraph[] = [{
      dropCapLines: 3,
      lineBreakStrict: true,
      runs: [{ text: 'Typeset', smallCaps: true, tracking: 80, emphasis: 'sesame' }],
    }];
    expect(applyTypographyPatchToRichText(original, {
      dropCapLines: 0,
      lineBreakStrict: false,
      smallCaps: false,
      tracking: 0,
      emphasis: undefined,
    })).toEqual([{
      dropCapLines: 0,
      lineBreakStrict: false,
      runs: [{ text: 'Typeset', smallCaps: false, tracking: 0, emphasis: undefined }],
    }]);
  });

  it('retains exact stretch and variable-axis coordinates on selected rich-text runs', () => {
    const original: PaperRichParagraph[] = [{
      runs: [{ text: 'Condensed variable face', fontFamily: 'Old Face' }],
    }];
    expect(applyTypographyPatchToRichText(original, {
      fontFamily: 'Exact Face Alias',
      fontStretch: '75%',
      fontVariationSettings: { wdth: 75, wght: 640 },
    })).toEqual([{
      runs: [{
        text: 'Condensed variable face',
        fontFamily: 'Exact Face Alias',
        fontStretch: '75%',
        fontVariationSettings: { wdth: 75, wght: 640 },
      }],
    }]);
  });

  it('does not touch retained rich text for a frame-only or unchanged typography edit', () => {
    const original: PaperRichParagraph[] = [{ runs: [{ text: 'Vertical', color: '#123456' }] }];
    const next = { ...baseTypography, writingMode: 'vertical-rl' as const };
    expect(changedRichTypographyPatch(baseTypography, next)).toEqual({});
    expect(synchronizeRichTextWithTypographyChange(original, baseTypography, next)).toBe(original);
  });
});

describe('toggleRunStyle — splitting at start/mid/end', () => {
  it('splits at the START of a run (overlap first, remainder after, no "before" piece)', () => {
    const result = toggleRunStyle(single('Hello world'), { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello', fontWeight: '700' }, { text: ' world' }] }]);
  });

  it('splits at the END of a run (unchanged prefix, overlap last, no "after" piece)', () => {
    const result = toggleRunStyle(single('Hello world'), { start: 6, end: 11 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello ' }, { text: 'world', fontWeight: '700' }] }]);
  });

  it('splits in the MIDDLE of a run (both a before and an after piece survive)', () => {
    const result = toggleRunStyle(single('Hello world'), { start: 2, end: 7 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'He' }, { text: 'llo w', fontWeight: '700' }, { text: 'orld' }] }]);
  });

  it('patches a run with no split at all when the range matches it exactly', () => {
    const result = toggleRunStyle(single('Hello world'), { start: 0, end: 11 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello world', fontWeight: '700' }] }]);
  });

  it('never changes the flattened text — only run boundaries/styling move', () => {
    const original = single('Hello world');
    const result = toggleRunStyle(original, { start: 2, end: 7 }, BOLD_TOGGLE_PATCH);
    expect(flattenPaperRichText(result)).toBe(flattenPaperRichText(original));
  });

  it('is a no-op for a zero-length (caret-only) range', () => {
    const original = single('Hello world');
    expect(toggleRunStyle(original, { start: 4, end: 4 }, BOLD_TOGGLE_PATCH)).toBe(original);
  });
});

describe('toggleRunStyle — cross-paragraph ranges', () => {
  const twoParagraphs: PaperRichParagraph[] = [{ runs: [{ text: 'Para one' }] }, { runs: [{ text: 'Para two' }] }];
  // flattened = "Para one\nPara two": para0 spans [0,8), the joining "\n" is index 8, para1 spans [9,17).

  it('flattens paragraphs joined by \\n at the offset this library assumes', () => {
    expect(flattenPaperRichText(twoParagraphs)).toBe('Para one\nPara two');
  });

  it('splits and patches both paragraphs a range straddles, leaving the "\\n" separator untouched', () => {
    // "Para one"[4] is the space, so {4,13} covers " one" (para0 tail, space included) + "\n" (skipped,
    // belongs to no run) + "Para" (para1 head).
    const result = toggleRunStyle(twoParagraphs, { start: 4, end: 13 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([
      { runs: [{ text: 'Para' }, { text: ' one', fontWeight: '700' }] },
      { runs: [{ text: 'Para', fontWeight: '700' }, { text: ' two' }] },
    ]);
  });

  it('never changes flattened text across a cross-paragraph toggle', () => {
    const result = toggleRunStyle(twoParagraphs, { start: 4, end: 13 }, BOLD_TOGGLE_PATCH);
    expect(flattenPaperRichText(result)).toBe(flattenPaperRichText(twoParagraphs));
  });

  it('leaves a paragraph the range does not reach completely untouched (same reference)', () => {
    const result = toggleRunStyle(twoParagraphs, { start: 0, end: 4 }, BOLD_TOGGLE_PATCH);
    expect(result[1]).toBe(twoParagraphs[1]);
  });
});

describe('toggleRunStyle — bulleted paragraphs (marker offset correctness)', () => {
  const bulleted: PaperRichParagraph[] = [{ runs: [{ text: 'Item one' }], listMarker: '•' }];
  // flattened = "•\tItem one": the "•\t" prefix (2 chars) belongs to no run.

  it('flattens the marker + tab ahead of the paragraph text', () => {
    expect(flattenPaperRichText(bulleted)).toBe('•\tItem one');
  });

  it('does not touch any run when the range only covers the marker prefix', () => {
    const result = toggleRunStyle(bulleted, { start: 0, end: 2 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual(bulleted);
  });

  it('bolds exactly the run text when the range starts right after the marker', () => {
    const result = toggleRunStyle(bulleted, { start: 2, end: 6 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Item', fontWeight: '700' }, { text: ' one' }], listMarker: '•' }]);
  });
});

describe('toggleRunStyle — toggle-off detection', () => {
  it('turns OFF (explicit "400") when the whole range is already bold', () => {
    const bold = single('Hello');
    bold[0].runs[0].fontWeight = '700';
    const result = toggleRunStyle(bold, { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello', fontWeight: '400' }] }]);
  });

  it('turns ON when the range is a MIX of bold and not (mixed selections resolve to on, not off)', () => {
    const mixed: PaperRichParagraph[] = [{ runs: [{ text: 'Hello', fontWeight: '700' }, { text: ' world' }] }];
    const result = toggleRunStyle(mixed, { start: 0, end: 11 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello world', fontWeight: '700' }] }]);
  });

  it('turns ON when nothing in the range is bold yet', () => {
    const result = toggleRunStyle(single('Hello'), { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello', fontWeight: '700' }] }]);
  });

  it('applies independently per style key — italic toggle-off does not touch bold', () => {
    const boldItalic = single('Hello');
    boldItalic[0].runs[0].fontWeight = '700';
    boldItalic[0].runs[0].fontStyle = 'italic';
    const result = toggleRunStyle(boldItalic, { start: 0, end: 5 }, ITALIC_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'Hello', fontWeight: '700', fontStyle: 'normal' }] }]);
  });

  it('underline off clears the flag rather than setting it false (matches the rest of the run model)', () => {
    const underlined = single('Hi');
    underlined[0].runs[0].underline = true;
    const result = toggleRunStyle(underlined, { start: 0, end: 2 }, UNDERLINE_TOGGLE_PATCH);
    expect(result[0].runs[0].underline).toBeUndefined();
  });
});

describe('toggleRunStyle — merge correctness', () => {
  it('merges a patched slice back into an adjacent run that already has the same resulting style', () => {
    // Two source runs, same style; a range spanning across their boundary should merge into ONE bold run,
    // not leave a seam at the original run boundary.
    const paragraphs: PaperRichParagraph[] = [{ runs: [{ text: 'Hello ' }, { text: 'world' }] }];
    const result = toggleRunStyle(paragraphs, { start: 2, end: 9 }, BOLD_TOGGLE_PATCH);
    expect(result).toEqual([{ runs: [{ text: 'He' }, { text: 'llo wor', fontWeight: '700' }, { text: 'ld' }] }]);
  });

  it('does not merge two runs that end up with different styles after patching', () => {
    const paragraphs: PaperRichParagraph[] = [{ runs: [{ text: 'Hello', fontSizePt: 10 }, { text: ' world' }] }];
    const result = stepFontSize(paragraphs, { start: 0, end: 11 }, 1, 12);
    expect(result[0].runs).toEqual([{ text: 'Hello', fontSizePt: 11 }, { text: ' world', fontSizePt: 13 }]);
  });

  it('never leaves a paragraph with zero runs', () => {
    const result = toggleRunStyle(single(''), { start: 0, end: 0 }, BOLD_TOGGLE_PATCH);
    expect(result[0].runs.length).toBeGreaterThan(0);
  });
});

describe('toggleRunStyle — idempotence', () => {
  it('alternates cleanly between explicit on/off states across repeated toggles of the same range', () => {
    const startOff = single('Hello');
    startOff[0].runs[0].fontWeight = '400'; // explicit "off" state, as a real toggle-off would leave it
    const on = toggleRunStyle(startOff, { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(on[0].runs[0].fontWeight).toBe('700');
    const off = toggleRunStyle(on, { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(off).toEqual(startOff);
    const onAgain = toggleRunStyle(off, { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(onAgain).toEqual(on);
  });

  it('applying the same "on" twice in a row is stable (second call detects already-on and flips off, not a crash/drift)', () => {
    const paragraphs = single('Hello world');
    const first = toggleRunStyle(paragraphs, { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    const second = toggleRunStyle(first, { start: 0, end: 5 }, BOLD_TOGGLE_PATCH);
    expect(flattenPaperRichText(second)).toBe(flattenPaperRichText(paragraphs));
    expect(second[0].runs.find((run) => run.text === 'Hello')?.fontWeight).toBe('400');
  });
});

describe('stepFontSize', () => {
  it('steps an explicit run size by deltaPt', () => {
    const result = stepFontSize(single('Hi'), { start: 0, end: 2 }, 1, 12);
    expect(result[0].runs[0].fontSizePt).toBe(13);
  });

  it('derives an unset run size from the frame typography before stepping', () => {
    const result = stepFontSize(single('Hi'), { start: 0, end: 2 }, 1, 12);
    // The run had no fontSizePt of its own — it should step from the frame's 12pt, landing on 13, not NaN/1.
    expect(result[0].runs[0].fontSizePt).toBe(13);
  });

  it('clamps at the maximum', () => {
    const paragraphs = single('Hi');
    paragraphs[0].runs[0].fontSizePt = MAX_RUN_FONT_SIZE_PT;
    const result = stepFontSize(paragraphs, { start: 0, end: 2 }, 1, 12);
    expect(result[0].runs[0].fontSizePt).toBe(MAX_RUN_FONT_SIZE_PT);
  });

  it('clamps at the minimum', () => {
    const paragraphs = single('Hi');
    paragraphs[0].runs[0].fontSizePt = MIN_RUN_FONT_SIZE_PT;
    const result = stepFontSize(paragraphs, { start: 0, end: 2 }, -1, 12);
    expect(result[0].runs[0].fontSizePt).toBe(MIN_RUN_FONT_SIZE_PT);
  });

  it('never changes flattened text', () => {
    const paragraphs = single('Hello world');
    const result = stepFontSize(paragraphs, { start: 3, end: 8 }, 1, 12);
    expect(flattenPaperRichText(result)).toBe(flattenPaperRichText(paragraphs));
  });
});

describe('toggleParagraphBullet', () => {
  it('bullets a plain paragraph: sets the marker and a 4mm hanging indent', () => {
    const result = toggleParagraphBullet(single('Item'), [0]);
    expect(result).toEqual([{ runs: [{ text: 'Item' }], listMarker: '•', hangingIndentMm: 4 }]);
  });

  it('changes the flattened text when adding a marker (the documented exception to the flatten-invariant rule)', () => {
    const paragraphs = single('Item');
    const result = toggleParagraphBullet(paragraphs, [0]);
    expect(flattenPaperRichText(paragraphs)).toBe('Item');
    expect(flattenPaperRichText(result)).toBe('•\tItem');
  });

  it('un-bullets an already-bulleted paragraph back to plain, restoring the flattened text', () => {
    const bulleted: PaperRichParagraph[] = [{ runs: [{ text: 'Item' }], listMarker: '•', hangingIndentMm: 4 }];
    const result = toggleParagraphBullet(bulleted, [0]);
    expect(result).toEqual([{ runs: [{ text: 'Item' }], listMarker: undefined, hangingIndentMm: undefined }]);
    expect(flattenPaperRichText(result)).toBe('Item');
  });

  it('only bullets ALL targets when EVERY target is already bulleted — a mixed selection resolves to on', () => {
    const paragraphs: PaperRichParagraph[] = [
      { runs: [{ text: 'One' }], listMarker: '•', hangingIndentMm: 4 },
      { runs: [{ text: 'Two' }] },
    ];
    const result = toggleParagraphBullet(paragraphs, [0, 1]);
    expect(result[0].listMarker).toBe('•');
    expect(result[1].listMarker).toBe('•');
  });

  it('leaves untargeted paragraphs untouched', () => {
    const paragraphs: PaperRichParagraph[] = [{ runs: [{ text: 'One' }] }, { runs: [{ text: 'Two' }] }];
    const result = toggleParagraphBullet(paragraphs, [0]);
    expect(result[1]).toBe(paragraphs[1]);
  });

  it('is a no-op for an empty/out-of-range index list', () => {
    const paragraphs = single('Item');
    expect(toggleParagraphBullet(paragraphs, [])).toBe(paragraphs);
    expect(toggleParagraphBullet(paragraphs, [5])).toBe(paragraphs);
  });
});

describe('ensureRichTextForTransform', () => {
  it('lifts plain text into one single-run paragraph per line when there is no richText yet', () => {
    const result = ensureRichTextForTransform(undefined, 'Line one\nLine two');
    expect(result).toEqual([{ runs: [{ text: 'Line one' }] }, { runs: [{ text: 'Line two' }] }]);
  });

  it('treats an empty richText array the same as undefined (lifts from plain text)', () => {
    const result = ensureRichTextForTransform([], 'Solo line');
    expect(result).toEqual([{ runs: [{ text: 'Solo line' }] }]);
  });

  it('returns existing richText untouched when it already has content, ignoring the plain-text fallback', () => {
    const existing: PaperRichParagraph[] = [{ runs: [{ text: 'Already rich', fontWeight: '700' }] }];
    expect(ensureRichTextForTransform(existing, 'ignored')).toBe(existing);
  });
});

describe('resolveRichEditorCommit — plain-frame promotion policy', () => {
  it('is a no-op when a plain frame is entered and left untouched (edited text equals the lifted seed)', () => {
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Hello' }] }];
    const decision = resolveRichEditorCommit(edited, undefined, 'Hello');
    expect(decision.changed).toBe(false);
  });

  it('promotes on the FIRST real formatting action: a plain frame + bold applied -> richText created, bold applied, flatten invariant respected', () => {
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Hello', fontWeight: '700' }] }];
    const decision = resolveRichEditorCommit(edited, undefined, 'Hello');
    expect(decision.changed).toBe(true);
    expect(decision.richText).toEqual(edited); // promoted: richText is now persisted
    expect(decision.text).toBe('Hello'); // flatten invariant: the plain text itself never changed
  });

  it('does NOT promote merely editing plain text with no formatting applied (new words, still uniform)', () => {
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Hello world' }] }];
    const decision = resolveRichEditorCommit(edited, undefined, 'Hello');
    expect(decision.changed).toBe(true); // the text really did change...
    expect(decision.richText).toBeUndefined(); // ...but it stays plain, no promotion
    expect(decision.text).toBe('Hello world');
  });

  it('DOES promote a bullet toggle — a list marker is a real formatting action, not plain text', () => {
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Item' }], listMarker: '•', hangingIndentMm: 4 }];
    const decision = resolveRichEditorCommit(edited, undefined, 'Item');
    expect(decision.richText).toEqual(edited);
  });

  it('does NOT promote a MULTI-LINE plain edit with zero formatting — line breaks alone are not "formatting"', () => {
    // Regression case: a naive re-use of paperRichTextIsUniform (which treats >1 paragraph as automatically
    // non-uniform, correct for ITS OWN "collapses to one frame typography" purpose) would wrongly promote any
    // multi-line plain caption just for having a line break. hasRealFormatting must not do that.
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Line one' }] }, { runs: [{ text: 'Line two' }] }];
    const decision = resolveRichEditorCommit(edited, undefined, 'Line one\nLine two');
    expect(decision.changed).toBe(false); // identical to the lifted seed — nothing changed at all
    expect(decision.richText).toBeUndefined();
  });

  it('does NOT promote a multi-line plain edit that also changed WORDS but still carries no formatting', () => {
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Line one' }] }, { runs: [{ text: 'Line TWO edited' }] }];
    const decision = resolveRichEditorCommit(edited, undefined, 'Line one\nLine two');
    expect(decision.changed).toBe(true); // the words really did change...
    expect(decision.richText).toBeUndefined(); // ...but still no formatting was applied, so it stays plain
  });

  it('DOES promote a cross-paragraph edit where only one paragraph carries real formatting', () => {
    const edited: PaperRichParagraph[] = [
      { runs: [{ text: 'One', fontStyle: 'italic' }] },
      { runs: [{ text: 'Two' }] },
    ];
    const decision = resolveRichEditorCommit(edited, undefined, 'One\nTwo');
    expect(decision.richText).toEqual(edited);
    expect(decision.text).toBe('One\nTwo');
  });

  it('an already-rich frame always keeps committing as rich, even if the edit removes all formatting (no demotion)', () => {
    const priorRich: PaperRichParagraph[] = [{ runs: [{ text: 'Hello', fontWeight: '700' }] }];
    const edited: PaperRichParagraph[] = [{ runs: [{ text: 'Hello' }] }]; // formatting removed
    const decision = resolveRichEditorCommit(edited, priorRich, 'Hello');
    expect(decision.changed).toBe(true);
    expect(decision.richText).toEqual(edited); // still committed as rich — no plain-demotion logic
  });

  it('is a no-op for an already-rich frame left completely untouched', () => {
    const priorRich: PaperRichParagraph[] = [{ runs: [{ text: 'Hello', fontWeight: '700' }] }];
    const decision = resolveRichEditorCommit(priorRich, priorRich, 'Hello');
    expect(decision.changed).toBe(false);
  });
});
